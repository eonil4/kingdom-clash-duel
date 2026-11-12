/**
 * Process enemy screenshots in a folder: extraction (LLM or OCR), WebP conversion,
 * per-folder data.json, nested-map maintenance.
 *
 * Extractors (--extractor):
 *   llm (default)  LM Studio vision; shape via --mode crops|screenshot
 *   ocr            local tesseract; --mode is ignored
 *
 * By default skips sources that already have a canonical WebP on disk (per folder data.json).
 * Use --force to re-run extraction and conversion for every PNG.
 *
 * Usage:
 *   node scripts/llm/convert.mjs <folder>
 *   node scripts/llm/convert.mjs <folder> --mode screenshot --force
 *   node scripts/llm/convert.mjs <folder> --extractor ocr
 *   node scripts/llm/convert.mjs <folder> --clear-cache
 *   node scripts/llm/convert.mjs <folder> --no-clear-cache
 *
 * Env: LLM_MODEL, LLM_HOST, LLM_SKIP_CACHE_CLEAR (see llm-enemy-extract.mjs)
 */
import fs from "fs/promises";
import path from "path";
import { WORKSPACE_ROOT } from "../enemy-records.mjs";
import { runExtraction } from "../pipeline/run-extraction.mjs";
import { createLlmStrategy, resolveLlmMode } from "../pipeline/llm-strategy.mjs";
import { createOcrStrategy } from "../pipeline/ocr-strategy.mjs";
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

/**
 * @param {string | undefined} raw
 * @returns {"llm" | "ocr"}
 */
function resolveExtractor(raw) {
  const v = String(raw ?? "llm").trim().toLowerCase();
  if (v === "llm") return "llm";
  if (v === "ocr") return "ocr";
  throw new Error(`Unknown --extractor ${JSON.stringify(raw)} (use llm or ocr)`);
}

function parseArgs(argv) {
  const args = {
    folder: undefined,
    /** @type {"llm" | "ocr"} */
    extractor: "llm",
    /** @type {"crops" | "screenshot"} */
    mode: "crops",
    modeExplicit: false,
    force: false,
    model: undefined,
    /** @type {boolean | undefined} */
    clearCache: undefined,
  };
  const setMode = (raw) => {
    args.mode = resolveLlmMode(raw);
    args.modeExplicit = true;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--" || a === undefined) continue;
    if (a === "--force") args.force = true;
    else if (a === "--clear-cache") args.clearCache = true;
    else if (a === "--no-clear-cache") args.clearCache = false;
    else if (a === "--model" || a === "-m") args.model = argv[++i];
    else if (a === "--mode" || a === "-M") setMode(argv[++i]);
    else if (a.startsWith("--mode=")) setMode(a.slice("--mode=".length));
    else if (a === "--extractor" || a === "-E") args.extractor = argv[++i];
    else if (a.startsWith("--extractor=")) args.extractor = a.slice("--extractor=".length);
    else if (!a.startsWith("-") && !args.folder) args.folder = a;
  }
  args.extractor = resolveExtractor(args.extractor);
  return args;
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

async function main() {
  const { folder, extractor, mode, modeExplicit, force, model, clearCache } = parseArgs(
    process.argv.slice(2),
  );
  if (!folder) {
    console.error(
      "Usage: node scripts/llm/convert.mjs <folder> [--extractor llm|ocr] [--mode crops|screenshot] [--force] [--model <id>] [--clear-cache|--no-clear-cache]",
    );
    process.exit(1);
  }
  if (extractor === "ocr" && modeExplicit) {
    console.warn("--mode is ignored with --extractor ocr");
  }

  const clearBeforeEach = shouldClearPredictionCacheBeforeEachCall({
    cliOverride: clearCache,
    config: _llmConfig,
  });
  const clearBeforeRun = shouldClearPredictionCacheBeforeRun({
    config: _llmConfig,
  });

  const folderAbs = path.isAbsolute(folder)
    ? folder
    : path.resolve(WORKSPACE_ROOT, folder.replace(/^(\.\.\/)+/, ""));

  const entries = await fs.readdir(folderAbs, { withFileTypes: true });
  const pngFiles = entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".png"))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));

  if (pngFiles.length === 0) {
    console.warn(`No PNG files in ${folderAbs}`);
    return;
  }

  const label = extractor === "llm" ? mode : "ocr";
  console.log(
    `\nProcessing folder (convert / ${label}): ${folderAbs} (${pngFiles.length} PNGs, ${force ? "force" : "missing only"})` +
      (extractor === "llm" ? ` [cache: beforeRun=${clearBeforeRun}, beforeEachCall=${clearBeforeEach}]` : ""),
  );

  if (extractor === "llm" && clearBeforeRun) {
    await clearLmPredictionCache({
      config: _llmConfig,
      label: "before run",
    });
  }

  const strategy =
    extractor === "llm"
      ? createLlmStrategy({
          mode,
          model,
          attempts: LLM_MAX_ATTEMPTS,
          timeoutPerAttemptMs: LLM_TIMEOUT_PER_ATTEMPT_MS,
          retryBaseDelayMs: RETRY_BASE_DELAY_MS,
          clearCacheBeforeEachCall: clearBeforeEach,
        })
      : createOcrStrategy({ force, config: _llmConfig });

  const stats = await runExtraction({
    folders: [
      { absPath: folderAbs, files: pngFiles.map((name) => path.join(folderAbs, name)) },
    ],
    strategy,
    webp: true,
    map: true,
    recordTiming: true,
    force,
    cacheEntries: false,
  });

  const llmStats = summarizeDurations(stats.durations);
  const timingSuffix = llmStats
    ? ` ${extractor === "llm" ? "LLM" : "OCR"} min/median/max: ${formatDuration(llmStats.min)} / ${formatDuration(llmStats.median)} / ${formatDuration(llmStats.max)}`
    : "";

  console.log(
    `\nDone (convert / ${label}): ${stats.converted} new (${extractor === "llm" ? "LLM" : "OCR"}), ` +
      `${stats.convertedFromMap} from map only, ${stats.skipped} skipped (complete), ${stats.failed} failed.${timingSuffix}`,
  );
  console.log("Store: per-folder data.json");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
