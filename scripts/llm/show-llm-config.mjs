import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { isMain } from "../cli.mjs";

// ROOT is two levels up from scripts/llm -> project root
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..", "..");
const CONFIG_PATH = path.join(ROOT, "config", "llm.json");
const ENV_EXAMPLE = path.join(ROOT, ".env.local.example");
const ENV_LOCAL = path.join(ROOT, ".env.local");

export function formatSource(val, src) {
  return { value: val ?? null, source: src };
}

export async function loadConfig() {
  try {
    const raw = await fs.readFile(CONFIG_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function loadEnvLocal(envPath = ENV_LOCAL) {
  // Load .env.local if present (but do not require it)
  const res = dotenv.config({ path: envPath });
  if (res.error) {
    return {};
  }
  return res.parsed ?? {};
}

/**
 * Build the printable summary for config/env sources.
 * @param {Record<string, any>} config
 * @param {Record<string, string | undefined>} [envLocal]
 * @param {Record<string, string | undefined>} [env]
 */
export function composeConfigSummary(config = {}, envLocal = {}, env = process.env) {
  const host = envLocal.LLM_HOST ?? env.LLM_HOST ?? config.host ?? "http://127.0.0.1:1234";
  const model = envLocal.LLM_MODEL ?? env.LLM_MODEL ?? config.defaultModel ?? null;
  const token = envLocal.LM_API_TOKEN ?? env.LM_API_TOKEN ?? null;
  const skipCache = envLocal.LLM_SKIP_CACHE_CLEAR ?? env.LLM_SKIP_CACHE_CLEAR ?? null;

  return {
    host: formatSource(host, envLocal.LLM_HOST ? ".env.local" : env.LLM_HOST ? "env" : "config"),
    model: formatSource(model, envLocal.LLM_MODEL ? ".env.local" : env.LLM_MODEL ? "env" : "config"),
    tokenPresent: !!token,
    tokenSource: token ? (envLocal.LM_API_TOKEN ? ".env.local" : env.LM_API_TOKEN ? "env" : null) : null,
    requestTimeoutMs: formatSource(config.requestTimeoutMs ?? 180000, "config"),
    clearPredictionCacheBeforeRun: formatSource(
      config.clearPredictionCacheBeforeRun === true,
      "config",
    ),
    clearPredictionCacheBeforeEachCall: formatSource(
      config.clearPredictionCacheBeforeEachCall === true,
      "config",
    ),
    predictionCachePaths: formatSource(config.predictionCachePaths ?? [], "config"),
    skipCacheClearFlag: formatSource(skipCache ?? null, envLocal.LLM_SKIP_CACHE_CLEAR ? ".env.local" : env.LLM_SKIP_CACHE_CLEAR ? "env" : null),
  };
}

/**
 * Print the config summary and file pointers.
 * @param {{ config?: object, envLocal?: Record<string, string | undefined>, log?: (...args: any[]) => void }} [options]
 */
export function runShowConfig({ config = {}, envLocal = {}, log = (...args) => console.log(...args) } = {}) {
  const out = composeConfigSummary(config, envLocal);

  log(JSON.stringify(out, null, 2));
  // also print helpful pointers
  log("\nFiles:");
  log(`  config: ${CONFIG_PATH}`);
  log(`  env example: ${ENV_EXAMPLE}`);
  log(`  env local (ignored by git): ${ENV_LOCAL}`);
  return out;
}

async function main() {
  const config = await loadConfig();
  // Load .env.local (preferred) and then fallback to process.env
  runShowConfig({ config, envLocal: loadEnvLocal() });
}

if (isMain(import.meta.url)) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}

