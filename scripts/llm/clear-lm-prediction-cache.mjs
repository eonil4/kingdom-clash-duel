/**
 * Clear LM Studio API prediction-history packs from disk.
 */
import fs from "fs/promises";
import path from "path";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_PATH = path.join(__dirname, "..", "..", "config", "llm.json");

const DEFAULT_CACHE_PATHS = [
  "%USERPROFILE%/.lmstudio/.internal/api-prediction-history/packs",
  "%USERPROFILE%/.cache/lm-studio/.internal/api-prediction-history/packs",
];

/**
 * Expand %VAR% / $VAR / ${VAR} using process.env.
 * @param {string} raw
 */
export function expandEnvPath(raw) {
  return String(raw)
    .replace(/%([^%]+)%/g, (_, name) => process.env[name] ?? "")
    .replace(/\$\{([^}]+)\}/g, (_, name) => process.env[name] ?? "")
    .replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (_, name) => process.env[name] ?? "");
}

/**
 * @param {unknown} [config]
 */
export function loadLlmConfigSync(config) {
  if (config && typeof config === "object") return config;
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return {};
  }
}

/**
 * @param {unknown} [config]
 * @returns {string[]}
 */
export function resolvePredictionCachePaths(config) {
  const cfg = loadLlmConfigSync(config);
  const raw = Array.isArray(cfg.predictionCachePaths) && cfg.predictionCachePaths.length > 0
    ? cfg.predictionCachePaths
    : DEFAULT_CACHE_PATHS;
  return raw.map((p) => path.normalize(expandEnvPath(String(p)))).filter(Boolean);
}

/**
 * @param {{ paths?: string[], config?: object, label?: string }} [options]
 * @returns {Promise<{ cleared: string[], missing: string[], failed: { path: string, error: string }[] }>}
 */
export async function clearLmPredictionCache(options = {}) {
  const paths = options.paths ?? resolvePredictionCachePaths(options.config);
  const label = options.label ?? "LM prediction cache";
  /** @type {string[]} */
  const cleared = [];
  /** @type {string[]} */
  const missing = [];
  /** @type {{ path: string, error: string }[]} */
  const failed = [];

  for (const cachePath of paths) {
    try {
      await fs.access(cachePath);
    } catch {
      missing.push(cachePath);
      continue;
    }
    try {
      await fs.rm(cachePath, { recursive: true, force: true });
      cleared.push(cachePath);
    } catch (err) {
      failed.push({
        path: cachePath,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (cleared.length > 0) {
    console.log(`\t[Cache] Cleared ${label}: ${cleared.length} path(s)`);
    for (const p of cleared) console.log(`\t[Cache]   - ${p}`);
  }
  for (const f of failed) {
    console.warn(`\t[Cache] Failed to clear ${f.path}: ${f.error}`);
  }

  return { cleared, missing, failed };
}

/**
 * Resolve whether to clear cache before each LLM call.
 * Precedence: CLI override > LLM_SKIP_CACHE_CLEAR=1 > config flag.
 *
 * @param {{ cliOverride?: boolean | undefined, config?: object }} [options]
 */
export function shouldClearPredictionCacheBeforeEachCall(options = {}) {
  if (options.cliOverride === true) return true;
  if (options.cliOverride === false) return false;

  const skip = process.env.LLM_SKIP_CACHE_CLEAR;
  if (skip === "1" || String(skip).toLowerCase() === "true") return false;

  const cfg = loadLlmConfigSync(options.config);
  return cfg.clearPredictionCacheBeforeEachCall === true;
}

/**
 * Resolve whether to clear cache once before a batch run.
 * @param {{ cliOverride?: boolean | undefined, config?: object }} [options]
 */
export function shouldClearPredictionCacheBeforeRun(options = {}) {
  if (options.cliOverride === true) return true;
  if (options.cliOverride === false) return false;

  const skip = process.env.LLM_SKIP_CACHE_CLEAR;
  if (skip === "1" || String(skip).toLowerCase() === "true") return false;

  const cfg = loadLlmConfigSync(options.config);
  return cfg.clearPredictionCacheBeforeRun === true;
}
