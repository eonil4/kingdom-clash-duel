#!/usr/bin/env node
import fs from "fs/promises";
import path from "path";
import dotenv from "dotenv";

// ROOT is two levels up from scripts/llm -> project root
const ROOT = path.resolve(path.join(path.dirname(new URL(import.meta.url).pathname), "..", ".."));
const CONFIG_PATH = path.join(ROOT, "config", "llm.json");
const ENV_EXAMPLE = path.join(ROOT, ".env.local.example");
const ENV_LOCAL = path.join(ROOT, ".env.local");

function formatSource(val, src) {
  return { value: val ?? null, source: src };
}

async function loadConfig() {
  try {
    const raw = await fs.readFile(CONFIG_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function loadEnvLocal() {
  // Load .env.local if present (but do not require it)
  const envPath = ENV_LOCAL;
  const res = dotenv.config({ path: envPath });
  if (res.error) {
    return {};
  }
  return res.parsed ?? {};
}

async function main() {
  const config = await loadConfig();
  // Load .env.local (preferred) and then fallback to process.env
  const envLocal = loadEnvLocal();

  const host = envLocal.LLM_HOST ?? process.env.LLM_HOST ?? config.host ?? "http://127.0.0.1:1234";
  const model = envLocal.LLM_MODEL ?? process.env.LLM_MODEL ?? config.defaultModel ?? null;
  const token = envLocal.LM_API_TOKEN ?? process.env.LM_API_TOKEN ?? null;
  const skipCache = envLocal.LLM_SKIP_CACHE_CLEAR ?? process.env.LLM_SKIP_CACHE_CLEAR ?? null;

  const out = {
    host: formatSource(host, envLocal.LLM_HOST ? ".env.local" : process.env.LLM_HOST ? "env" : "config"),
    model: formatSource(model, envLocal.LLM_MODEL ? ".env.local" : process.env.LLM_MODEL ? "env" : "config"),
    tokenPresent: !!token,
    tokenSource: token ? (envLocal.LM_API_TOKEN ? ".env.local" : process.env.LM_API_TOKEN ? "env" : null) : null,
    requestTimeoutMs: formatSource(config.requestTimeoutMs ?? 180000, "config"),
    clearPredictionCacheBeforeRun: formatSource(
      config.clearPredictionCacheBeforeRun === true,
      "config",
    ),
    predictionCachePaths: formatSource(config.predictionCachePaths ?? [], "config"),
    skipCacheClearFlag: formatSource(skipCache ?? null, envLocal.LLM_SKIP_CACHE_CLEAR ? ".env.local" : process.env.LLM_SKIP_CACHE_CLEAR ? "env" : null),
  };

  console.log(JSON.stringify(out, null, 2));
  // also print helpful pointers
  console.log("\nFiles:");
  console.log(`  config: ${CONFIG_PATH}`);
  console.log(`  env example: ${ENV_EXAMPLE}`);
  console.log(`  env local (ignored by git): ${ENV_LOCAL}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

