/**
 * Process enemy screenshots in a folder: LLM extraction, WebP conversion, fileMap update.
 *
 * By default skips sources that already have a canonical WebP on disk (per fileMap).
 * Use --force to re-run LLM and conversion for every PNG.
 *
 * Usage:
 *   node scripts/llm/convert.js data/enemies/2026-05-22/test
 *   node scripts/llm/convert.js data/enemies/2026-05-22/test --force
 *   node scripts/llm/convert.js data/enemies/2026-05-22/test --clear-cache
 *   node scripts/llm/convert.js data/enemies/2026-05-22/test --no-clear-cache
 *
 * Env: LLM_MODEL, LLM_HOST, LLM_SKIP_CACHE_CLEAR (see llm-enemy-extract.mjs)
 */
import fs from "fs/promises";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { writeWebpFromRasterFile } from "./enemy-image-webp.mjs";
import { toSafeEnemyFilenameToken } from "../ocr/enemy-filename-tokens.mjs";
import {
  canonicalEnemyMapKey,
  DEFAULT_FILE_MAP_PATH,
  findEnemyRowBySourceRel,
  loadExistingFileMap,
  saveFileMap,
  setNestedMapping,
  toMapKey,
  WORKSPACE_ROOT,
} from "../file-map-enemies.mjs";
import { extractEnemyDataFromScreenshot } from "./llm-enemy-extract.mjs";
import {
  clearLmPredictionCache,
  shouldClearPredictionCacheBeforeEachCall,
  shouldClearPredictionCacheBeforeRun,
} from "./clear-lm-prediction-cache.mjs";

// Load optional LM config overrides from config/llm.json
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_PATH = path.join(__dirname, "..", "..", "config", "llm.json");
let _llmConfig = {};
try {
  const raw = readFileSync(CONFIG_PATH, "utf8");
  _llmConfig = JSON.parse(raw);
} catch {
  _llmConfig = {};
}

const LLM_MAX_ATTEMPTS = Number.isFinite(Number(_llmConfig.llmMaxAttempts ?? _llmConfig.maxAttempts))
  ? Number(_llmConfig.llmMaxAttempts ?? _llmConfig.maxAttempts)
  : 3;
const RETRY_BASE_DELAY_MS = Number.isFinite(Number(_llmConfig.retryBaseDelayMs)) ? Number(_llmConfig.retryBaseDelayMs) : 1500;
/** Per-attempt LLM request timeout: attempt × configured ms (default 10 min) */
const LLM_TIMEOUT_PER_ATTEMPT_MS = Number.isFinite(Number(_llmConfig.llmTimeoutPerAttemptMs))
  ? Number(_llmConfig.llmTimeoutPerAttemptMs)
  : 600_000;

function parseArgs(argv) {
  const args = {
    folder: undefined,
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
    else if (!a.startsWith("-") && !args.folder) args.folder = a;
  }
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
 * @param {string | undefined} model
 * @param {{ clearCacheBeforeEachCall?: boolean }} [options]
 */
async function callLLMApiForDataExtraction(imagePath, model, options = {}) {
  const startedAt = performance.now();
  let lastErr;
  for (let attempt = 1; attempt <= LLM_MAX_ATTEMPTS; attempt++) {
    const timeoutMs = attempt * LLM_TIMEOUT_PER_ATTEMPT_MS;
    try {
      console.log(
        `\t[LLM] ${path.basename(imagePath)} (attempt ${attempt}/${LLM_MAX_ATTEMPTS}, timeout ${timeoutMs / 1000}s)...`,
      );
      const extracted = await extractEnemyDataFromScreenshot(imagePath, {
        timeoutMs,
        model,
        clearCacheBeforeEachCall: options.clearCacheBeforeEachCall,
      });
      const durationMs = performance.now() - startedAt;
      console.log(
        `\t[LLM] power=${extracted.power} name=${JSON.stringify(extracted.name)}` +
          (extracted.englishName ? ` english=${JSON.stringify(extracted.englishName)}` : "") +
          ` (${formatDuration(durationMs)})`,
      );
      return { extracted, durationMs };
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`\t[LLM] attempt ${attempt}/${LLM_MAX_ATTEMPTS} failed: ${msg}`);
      if (attempt < LLM_MAX_ATTEMPTS) {
        await delay(RETRY_BASE_DELAY_MS * attempt);
      }
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error(String(lastErr ?? "LLM extraction failed"));
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
 * @param {{ force?: boolean, model?: string, clearCache?: boolean }} [options]
 */
async function processImageFolder(folderArg, options = {}) {
  const { force = false, model = undefined, clearCache = undefined } = options;
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
    `\nProcessing folder: ${folderAbs} (${pngFiles.length} PNGs, ${force ? "force" : "missing only"})` +
      ` [cache: beforeRun=${clearBeforeRun}, beforeEachCall=${clearBeforeEach}]`,
  );

  if (clearBeforeRun) {
    await clearLmPredictionCache({
      config: _llmConfig,
      label: "before run",
    });
  }

  const mapRoot = await loadExistingFileMap(DEFAULT_FILE_MAP_PATH);
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
          throw new Error("fileMap row exists but is missing name/power.");
        }
        mapKey = existing.row.fullMapKey;
        outputPath = existing.webpPath;
        usedMapOnly = true;
        console.log(`\t[Map] Using existing entry -> ${path.basename(outputPath)}`);
      } else {
        const { extracted, durationMs } = await callLLMApiForDataExtraction(imagePath, model, {
          clearCacheBeforeEachCall: clearBeforeEach,
        });
        llmDurationsMs.push(durationMs);
        if (!extracted?.power || !extracted?.name) {
          throw new Error("LLM did not return power and name.");
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

        mapKey = canonicalEnemyMapKey(imagePath, {
          power: mapEntry.power,
          nameLatinRaw,
          nameEnglish: mapEntry.nameEnglish,
          nameRaw: mapEntry.name,
        });
        outputPath = path.join(folderAbs, path.posix.basename(mapKey));
        setNestedMapping(mapRoot, mapKey, mapEntry);
      }

      if (!force) {
        try {
          await fs.access(outputPath);
          console.log(`\t[Skip] WebP already exists: ${path.basename(outputPath)}`);
          if (!usedMapOnly) {
            await saveFileMap(mapRoot);
            console.log(`\t[Map] saved ${DEFAULT_FILE_MAP_PATH}`);
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
      console.log(`\t[Map] saved ${DEFAULT_FILE_MAP_PATH}`);
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
    `\nDone: ${converted} new (LLM), ${convertedFromMap} from map only, ${skippedComplete} skipped (complete), ${failed} failed.${timingSuffix}`,
  );
  console.log(`Map: ${DEFAULT_FILE_MAP_PATH}`);
}

async function main() {
  const { folder, force, model, clearCache } = parseArgs(process.argv.slice(2));
  await processImageFolder(folder ?? "data/enemies/2026-05-22/test", {
    force,
    model,
    clearCache,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

