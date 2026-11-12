/**
 * Process enemy screenshots in a folder: LLM extraction, WebP conversion, per-folder data.json.
 *
 * Modes (--mode):
 *   crops       (default) crop the name + power ROIs and recognize each crop
 *               (config/llm.json userPrompt.image.enemy.{name,power})
 *   screenshot  extract name + power from the full screenshot in one call
 *
 * By default skips sources that already have a canonical WebP on disk (per folder data.json).
 * Use --force to re-run LLM and conversion for every PNG.
 *
 * Usage:
 *   node scripts/llm/convert.mjs <folder>
 *   node scripts/llm/convert.mjs <folder> --mode screenshot --force
 *   node scripts/llm/convert.mjs <folder> --clear-cache
 *   node scripts/llm/convert.mjs <folder> --no-clear-cache
 *
 * Env: LLM_MODEL, LLM_HOST, LLM_SKIP_CACHE_CLEAR (see llm-enemy-extract.mjs)
 */
import fs from "fs/promises";
import path from "path";
import { writeWebpFromRasterFile } from "./enemy-image-webp.mjs";
import { toSafeEnemyFilenameToken } from "../ocr/enemy-filename-tokens.mjs";
import {
  canonicalEnemyMapKey,
  findEnemyRowBySourceRel,
  loadExistingFileMap,
  saveFileMap,
  setNestedMapping,
  toMapKey,
  WORKSPACE_ROOT,
} from "../file-map-enemies.mjs";
import {
  extractEnemyDataFromNamePowerCrops,
  extractEnemyDataFromScreenshot,
} from "./llm-enemy-extract.mjs";
import { loadLlmConfig, REQUEST_TIMEOUT_MS } from "./vision-client.mjs";
import {
  clearLmPredictionCache,
  shouldClearPredictionCacheBeforeEachCall,
  shouldClearPredictionCacheBeforeRun,
} from "./clear-lm-prediction-cache.mjs";

const _llmConfig = loadLlmConfig();

const LLM_MAX_ATTEMPTS = Number.isFinite(Number(_llmConfig.llmMaxAttempts ?? _llmConfig.maxAttempts))
  ? Number(_llmConfig.llmMaxAttempts ?? _llmConfig.maxAttempts)
  : 3;
const RETRY_BASE_DELAY_MS = Number.isFinite(Number(_llmConfig.retryBaseDelayMs)) ? Number(_llmConfig.retryBaseDelayMs) : 1500;
/** Per-attempt LLM request timeout; attempt N uses N × this value. */
const LLM_TIMEOUT_PER_ATTEMPT_MS = Number.isFinite(Number(_llmConfig.llmTimeoutPerAttemptMs))
  ? Number(_llmConfig.llmTimeoutPerAttemptMs)
  : REQUEST_TIMEOUT_MS;

/** Below this, an extraction is almost certainly wrong (e.g. read "1" or a unit count). */
const LOW_POWER_WARN_THRESHOLD = 444;

/** @type {Record<"crops" | "screenshot", { logTag: string, extract: Function }>} */
const MODES = {
  crops: {
    logTag: "[LLM crops]",
    extract: extractEnemyDataFromNamePowerCrops,
  },
  screenshot: {
    logTag: "[LLM]",
    extract: extractEnemyDataFromScreenshot,
  },
};

/**
 * @param {string | undefined} raw
 * @returns {"crops" | "screenshot"}
 */
function resolveMode(raw) {
  const v = String(raw ?? "crops").trim().toLowerCase();
  if (v === "crops" || v === "crop" || v === "name-power") return "crops";
  if (v === "screenshot" || v === "full") return "screenshot";
  throw new Error(`Unknown --mode ${JSON.stringify(raw)} (use crops or screenshot)`);
}

function parseArgs(argv) {
  const args = {
    folder: undefined,
    /** @type {"crops" | "screenshot"} */
    mode: "crops",
    force: false,
    model: undefined,
    /** @type {boolean | undefined} */
    clearCache: undefined,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--" || a === undefined) continue;
    if (a === "--force") args.force = true;
    else if (a === "--clear-cache") args.clearCache = true;
    else if (a === "--no-clear-cache") args.clearCache = false;
    else if (a === "--model" || a === "-m") args.model = argv[++i];
    else if (a === "--mode" || a === "-M") args.mode = argv[++i];
    else if (a.startsWith("--mode=")) args.mode = a.slice("--mode=".length);
    else if (!a.startsWith("-") && !args.folder) args.folder = a;
  }
  args.mode = resolveMode(args.mode);
  return args;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** @param {number[]} samplesMs */
function summarizeDurations(samplesMs) {
  if (samplesMs.length === 0) return null;
  const sorted = [...samplesMs].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  return { min, median, max };
}

/** @param {number} ms */
function formatDuration(ms) {
  return ms >= 60_000 ? `${(ms / 60_000).toFixed(1)}m` : `${(ms / 1000).toFixed(1)}s`;
}

/**
 * @param {object} mapRoot
 * @param {string} imagePath
 */
async function resolveExistingOutput(mapRoot, imagePath) {
  const sourceRel = toMapKey(imagePath);
  const row = findEnemyRowBySourceRel(mapRoot, sourceRel);
  if (!row?.canonicalKey) {
    return { sourceRel, row: undefined, webpPath: undefined, exists: false };
  }

  const webpPath = path.join(row.folderAbs, row.canonicalKey);
  try {
    await fs.access(webpPath);
    return { sourceRel, row, webpPath, exists: true };
  } catch {
    return { sourceRel, row, webpPath, exists: false };
  }
}

/**
 * @param {string} imagePath
 * @param {"crops" | "screenshot"} mode
 * @param {string | undefined} model
 * @param {{ clearCacheBeforeEachCall?: boolean }} [options]
 */
async function callLLMApiForExtraction(imagePath, mode, model, options = {}) {
  const { logTag, extract } = MODES[mode];
  const startedAt = performance.now();
  let lastErr;
  for (let attempt = 1; attempt <= LLM_MAX_ATTEMPTS; attempt++) {
    const timeoutMs = attempt * LLM_TIMEOUT_PER_ATTEMPT_MS;
    try {
      console.log(
        `\t${logTag} ${path.basename(imagePath)} (attempt ${attempt}/${LLM_MAX_ATTEMPTS}, timeout ${timeoutMs / 1000}s)...`,
      );
      const extracted = await extract(imagePath, {
        timeoutMs,
        model,
        clearCacheBeforeEachCall: options.clearCacheBeforeEachCall,
      });
      const durationMs = performance.now() - startedAt;
      const detail =
        mode === "crops"
          ? extracted.nameLatin
            ? ` latin=${JSON.stringify(extracted.nameLatin)}`
            : ""
          : extracted.englishName
            ? ` english=${JSON.stringify(extracted.englishName)}`
            : "";
      console.log(
        `\t${logTag} power=${extracted.power} name=${JSON.stringify(extracted.name)}` +
          `${detail} (${formatDuration(durationMs)})`,
      );
      return { extracted, durationMs };
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`\t${logTag} attempt ${attempt}/${LLM_MAX_ATTEMPTS} failed: ${msg}`);
      if (attempt < LLM_MAX_ATTEMPTS) {
        await delay(RETRY_BASE_DELAY_MS * attempt);
      }
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error(String(lastErr ?? "LLM extraction failed"));
}

/**
 * @param {{ power: number, name: string, englishName?: string }} extracted
 * @param {string} logTag
 */
function warnIfLowPower(extracted, logTag) {
  if (Number(extracted.power) < LOW_POWER_WARN_THRESHOLD) {
    console.error(
      `\t${logTag} LOW power=${extracted.power} name=${JSON.stringify(extracted.name)}` +
        (extracted.englishName ? ` english=${JSON.stringify(extracted.englishName)}` : ""),
    );
  }
}

/**
 * @param {"crops" | "screenshot"} mode
 * @param {string} imagePath
 * @param {{ power: number, name: string, nameLatin?: string, englishName?: string }} extracted
 * @returns {{ mapKey: string, mapEntry: object }}
 */
function buildMapEntry(mode, imagePath, extracted) {
  if (mode === "crops") {
    const nameRaw = extracted.name?.trim() || "";
    const nameLatinRaw = extracted.nameLatin?.trim() || "";
    if (!nameRaw && !nameLatinRaw) {
      throw new Error("LLM did not return name or nameLatin.");
    }

    const mapEntry = {
      name: nameRaw || nameLatinRaw,
      nameLatin: nameLatinRaw || toSafeEnemyFilenameToken(nameRaw),
      power: Number(extracted.power),
    };

    // Filename: nameLatin (fallback to name when latin is empty). Never use english.
    const filenameNameRaw = nameLatinRaw || nameRaw;
    const mapKey = canonicalEnemyMapKey(imagePath, {
      power: mapEntry.power,
      nameLatinRaw: filenameNameRaw,
      nameRaw: undefined,
      nameEnglish: undefined,
    });
    return { mapKey, mapEntry };
  }

  const nameLatinRaw =
    extracted.englishName?.trim() || toSafeEnemyFilenameToken(extracted.name);
  const mapEntry = {
    name: extracted.name,
    nameLatin: nameLatinRaw,
    power: Number(extracted.power),
  };
  if (extracted.englishName?.trim()) {
    mapEntry.nameEnglish = extracted.englishName.trim();
  }

  const mapKey = canonicalEnemyMapKey(imagePath, {
    power: mapEntry.power,
    nameLatinRaw,
    nameEnglish: mapEntry.nameEnglish,
    nameRaw: mapEntry.name,
  });
  return { mapKey, mapEntry };
}

/**
 * Persist the extraction next to the source image so results survive a failed conversion.
 * `saveFileMap` later refreshes the same key with canonical-map fields.
 */
async function persistExtractedData({
  folderAbs,
  originalFileName,
  extracted,
  mapEntry,
  durationMs,
  canonical,
}) {
  const dataPath = path.join(folderAbs, "data.json");
  let existing = {};
  try {
    const raw = await fs.readFile(dataPath, "utf8");
    existing = JSON.parse(raw);
  } catch {
    existing = {};
  }
  existing[originalFileName] = {
    name: mapEntry.name,
    nameLatin: mapEntry.nameLatin,
    power: mapEntry.power,
    language: extracted.language ?? null,
    processingMs: typeof durationMs === "number" ? Math.round(durationMs) : null,
    canonical: canonical ?? null,
    extractedAt: new Date().toISOString(),
  };
  await fs.writeFile(dataPath, `${JSON.stringify(existing, null, 2)}\n`, "utf8");
}

/** @param {object | undefined} entry */
function mapEntryFromRow(entry) {
  if (!entry || typeof entry !== "object") return undefined;
  const power = Number(entry.power);
  const name = typeof entry.name === "string" ? entry.name.trim() : "";
  if (!Number.isFinite(power) || !name) return undefined;
  const mapEntry = {
    name,
    nameLatin:
      (typeof entry.nameLatin === "string" && entry.nameLatin.trim()) ||
      toSafeEnemyFilenameToken(name),
    power,
  };
  if (typeof entry.nameEnglish === "string" && entry.nameEnglish.trim()) {
    mapEntry.nameEnglish = entry.nameEnglish.trim();
  }
  return mapEntry;
}

/**
 * @param {string} folderArg
 * @param {{ mode: "crops" | "screenshot", force?: boolean, model?: string, clearCache?: boolean }} options
 */
async function processImageFolder(folderArg, options) {
  const { force = false, model = undefined, clearCache = undefined, mode } = options;
  const clearBeforeEach = shouldClearPredictionCacheBeforeEachCall({
    cliOverride: clearCache,
    config: _llmConfig,
  });
  const clearBeforeRun = shouldClearPredictionCacheBeforeRun({
    config: _llmConfig,
  });

  const folderAbs = path.isAbsolute(folderArg)
    ? folderArg
    : path.resolve(WORKSPACE_ROOT, folderArg.replace(/^(\.\.\/)+/, ""));

  const entries = await fs.readdir(folderAbs, { withFileTypes: true });
  const pngFiles = entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".png"))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));

  if (pngFiles.length === 0) {
    console.warn(`No PNG files in ${folderAbs}`);
    return;
  }

  console.log(
    `\nProcessing folder (convert / ${mode}): ${folderAbs} (${pngFiles.length} PNGs, ${force ? "force" : "missing only"})` +
      ` [cache: beforeRun=${clearBeforeRun}, beforeEachCall=${clearBeforeEach}]`,
  );

  if (clearBeforeRun) {
    await clearLmPredictionCache({
      config: _llmConfig,
      label: "before run",
    });
  }

  const mapRoot = await loadExistingFileMap();
  let converted = 0;
  let skippedComplete = 0;
  let convertedFromMap = 0;
  let failed = 0;
  /** @type {number[]} */
  const llmDurationsMs = [];

  for (const originalFileName of pngFiles) {
    const imagePath = path.join(folderAbs, originalFileName);

    try {
      const existing = await resolveExistingOutput(mapRoot, imagePath);

      if (!force && existing.exists && existing.webpPath) {
        console.log(
          `\n[Skip] ${originalFileName} — WebP exists: ${path.basename(existing.webpPath)}`,
        );
        skippedComplete++;
        continue;
      }

      console.log(`\n[Processing] ${originalFileName}`);

      let mapKey;
      let outputPath;
      let usedMapOnly = false;

      if (!force && existing.row && existing.webpPath && !existing.exists) {
        const mapEntry = mapEntryFromRow(existing.row.entry);
        if (!mapEntry) {
          throw new Error("data.json row exists but is missing name/power.");
        }
        mapKey = existing.row.fullMapKey;
        outputPath = existing.webpPath;
        usedMapOnly = true;
        console.log(`\t[Map] Using existing entry -> ${path.basename(outputPath)}`);
      } else {
        const { extracted, durationMs } = await callLLMApiForExtraction(
          imagePath,
          mode,
          model,
          { clearCacheBeforeEachCall: clearBeforeEach },
        );
        llmDurationsMs.push(durationMs);
        if (!extracted?.power || !extracted?.name) {
          throw new Error("LLM did not return power and name.");
        }
        warnIfLowPower(extracted, MODES[mode].logTag);

        const { mapKey: builtKey, mapEntry } = buildMapEntry(mode, imagePath, extracted);
        mapKey = builtKey;
        outputPath = path.join(folderAbs, path.posix.basename(mapKey));
        setNestedMapping(mapRoot, mapKey, mapEntry);

        try {
          await persistExtractedData({
            folderAbs,
            originalFileName,
            extracted,
            mapEntry,
            durationMs,
            canonical: path.posix.basename(mapKey),
          });
        } catch (err) {
          console.warn(
            `\t[Data] failed to write data.json for ${originalFileName}: ` +
              `${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      if (!force) {
        try {
          await fs.access(outputPath);
          console.log(`\t[Skip] WebP already exists: ${path.basename(outputPath)}`);
          if (!usedMapOnly) {
            await saveFileMap(mapRoot);
            console.log("\t[Data] saved data.json");
          }
          skippedComplete++;
          continue;
        } catch {
          // create
        }
      }

      console.log(`\t[Conversion] -> ${path.basename(outputPath)}`);
      await writeWebpFromRasterFile(imagePath, outputPath);
      await saveFileMap(mapRoot);
      console.log("\t[Data] saved data.json");
      if (usedMapOnly) {
        convertedFromMap++;
      } else {
        converted++;
      }
    } catch (err) {
      failed++;
      console.error(`\t[Error] ${originalFileName}:`, err instanceof Error ? err.message : err);
    }
  }

  const llmStats = summarizeDurations(llmDurationsMs);
  const timingSuffix = llmStats
    ? ` LLM min/median/max: ${formatDuration(llmStats.min)} / ${formatDuration(llmStats.median)} / ${formatDuration(llmStats.max)}`
    : "";

  console.log(
    `\nDone (convert / ${mode}): ${converted} new (LLM), ${convertedFromMap} from map only, ${skippedComplete} skipped (complete), ${failed} failed.${timingSuffix}`,
  );
  console.log("Store: per-folder data.json");
}

async function main() {
  const { folder, mode, force, model, clearCache } = parseArgs(process.argv.slice(2));
  if (!folder) {
    console.error(
      "Usage: node scripts/llm/convert.mjs <folder> [--mode crops|screenshot] [--force] [--model <id>] [--clear-cache|--no-clear-cache]",
    );
    process.exit(1);
  }
  console.log(`Mode: ${mode}`);
  await processImageFolder(folder, { mode, force, model, clearCache });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
