import { describe, expect, it } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import {
  composeConfigSummary,
  formatSource,
  loadConfig,
  loadEnvLocal,
  runShowConfig,
} from "../../scripts/llm/show-llm-config.mjs";

describe("show-llm-config", () => {
  it("formats values with their source", () => {
    expect(formatSource(undefined, "env")).toEqual({ value: null, source: "env" });
    expect(formatSource("qwen", "config")).toEqual({ value: "qwen", source: "config" });
  });

  it("composes sources from .env.local first", () => {
    const out = composeConfigSummary(
      { requestTimeoutMs: 1000, predictionCachePaths: ["p"] },
      {
        LLM_HOST: "local-host",
        LLM_MODEL: "local-model",
        LM_API_TOKEN: "t0",
        LLM_SKIP_CACHE_CLEAR: "1",
      },
      { LLM_HOST: "env-host" },
    );
    expect(out.host).toEqual({ value: "local-host", source: ".env.local" });
    expect(out.model).toEqual({ value: "local-model", source: ".env.local" });
    expect(out.tokenSource).toBe(".env.local");
    expect(out.skipCacheClearFlag).toEqual({ value: "1", source: ".env.local" });
    expect(out.requestTimeoutMs).toEqual({ value: 1000, source: "config" });
  });

  it("falls back to env, config and defaults", () => {
    const fromEnv = composeConfigSummary(
      {},
      {},
      { LLM_HOST: "env-host", LLM_MODEL: "env-model", LM_API_TOKEN: "t" },
    );
    expect(fromEnv.host).toEqual({ value: "env-host", source: "env" });
    expect(fromEnv.model).toEqual({ value: "env-model", source: "env" });
    expect(fromEnv.tokenSource).toBe("env");

    const defaults = composeConfigSummary({}, {}, {});
    expect(defaults.host).toEqual({ value: "http://127.0.0.1:1234", source: "config" });
    expect(defaults.model).toEqual({ value: null, source: "config" });
    expect(defaults.tokenPresent).toBe(false);
    expect(defaults.tokenSource).toBeNull();
    expect(defaults.skipCacheClearFlag).toEqual({ value: null, source: null });
    expect(defaults.clearPredictionCacheBeforeRun).toEqual({ value: false, source: "config" });
  });

  it("loads .env.local when present and returns {} otherwise", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kc-env-"));
    const file = path.join(dir, ".env.local");
    await fs.writeFile(file, "LLM_HOST=local-host\n");
    const saved = process.env.LLM_HOST;
    try {
      expect(loadEnvLocal(file)).toMatchObject({ LLM_HOST: "local-host" });
    } finally {
      if (saved === undefined) delete process.env.LLM_HOST;
      else process.env.LLM_HOST = saved;
    }
    expect(loadEnvLocal(path.join(dir, "missing"))).toEqual({});
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  it("prints the summary and file pointers", () => {
    const logs: string[] = [];
    const out = runShowConfig({
      config: { host: "cfg" },
      envLocal: { LLM_MODEL: "m" },
      log: (line) => logs.push(String(line)),
    });
    expect(out.model).toEqual({ value: "m", source: ".env.local" });
    expect(logs.join("\n")).toContain("Files:");
    expect(logs.join("\n")).toContain("config:");
  });

  it("loads config/llm.json including the ROI reference", async () => {
    const config = await loadConfig();
    expect(typeof config.host).toBe("string");
    expect(typeof config.defaultModel).toBe("string");
    expect(config.roiReference).toEqual({ width: 900, height: 1600 });
  });
});
