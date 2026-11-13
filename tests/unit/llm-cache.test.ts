import { afterEach, describe, expect, it } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import {
  clearLmPredictionCache,
  expandEnvPath,
  resolvePredictionCachePaths,
  shouldClearPredictionCacheBeforeEachCall,
  shouldClearPredictionCacheBeforeRun,
} from "../../scripts/llm/clear-lm-prediction-cache.mjs";

const dirs: string[] = [];

const envKeys = ["KC_TEST_PATH", "USERPROFILE", "LLM_SKIP_CACHE_CLEAR"];
const saved = new Map(envKeys.map((key) => [key, process.env[key]]));

afterEach(async () => {
  for (const key of envKeys) {
    const value = saved.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  for (const dir of dirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

describe("expandEnvPath", () => {
  it("expands %VAR%, ${VAR} and $VAR forms", () => {
    process.env.KC_TEST_PATH = "C:/tmp/kc";
    expect(expandEnvPath("%KC_TEST_PATH%/packs")).toBe("C:/tmp/kc/packs");
    expect(expandEnvPath("${KC_TEST_PATH}/packs")).toBe("C:/tmp/kc/packs");
    expect(expandEnvPath("$KC_TEST_PATH/packs")).toBe("C:/tmp/kc/packs");
  });

  it("falls back to the home directory for USERPROFILE", () => {
    delete process.env.USERPROFILE;
    expect(expandEnvPath("%USERPROFILE%/.lmstudio")).toBe(`${os.homedir()}/.lmstudio`);
  });

  it("expands unknown variables to an empty string", () => {
    delete process.env.KC_TEST_PATH;
    expect(expandEnvPath("%KC_TEST_PATH%/packs")).toBe("/packs");
  });
});

describe("resolvePredictionCachePaths", () => {
  it("uses and normalises configured paths", () => {
    process.env.KC_TEST_PATH = "C:/tmp/kc";
    expect(resolvePredictionCachePaths({ predictionCachePaths: ["%KC_TEST_PATH%/packs"] })).toEqual([
      path.normalize("C:/tmp/kc/packs"),
    ]);
  });

  it("drops paths that expand to nothing", () => {
    delete process.env.KC_TEST_PATH;
    expect(resolvePredictionCachePaths({ predictionCachePaths: ["%KC_TEST_PATH%"] })).toEqual([]);
  });
});

describe("clearLmPredictionCache", () => {
  it("removes existing cache paths and reports missing ones", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kc-cache-"));
    dirs.push(dir);
    const packs = path.join(dir, "packs");
    await fs.mkdir(packs);
    await fs.writeFile(path.join(packs, "entry.bin"), "x");
    const missing = path.join(dir, "missing");

    const result = await clearLmPredictionCache({ paths: [packs, missing], label: "test cache" });

    expect(result.cleared).toEqual([packs]);
    expect(result.missing).toEqual([missing]);
    expect(result.failed).toEqual([]);
    await expect(fs.access(packs)).rejects.toThrow();
  });
});

describe("cache-clearing flags", () => {
  it("honours config, CLI overrides and the skip env var", () => {
    delete process.env.LLM_SKIP_CACHE_CLEAR;
    const config = {
      clearPredictionCacheBeforeEachCall: true,
      clearPredictionCacheBeforeRun: true,
    };

    expect(shouldClearPredictionCacheBeforeEachCall({ config })).toBe(true);
    expect(shouldClearPredictionCacheBeforeEachCall({ config, cliOverride: false })).toBe(false);
    expect(shouldClearPredictionCacheBeforeEachCall({ cliOverride: true })).toBe(true);
    expect(shouldClearPredictionCacheBeforeRun({ config })).toBe(true);

    process.env.LLM_SKIP_CACHE_CLEAR = "1";
    expect(shouldClearPredictionCacheBeforeEachCall({ config })).toBe(false);
    expect(shouldClearPredictionCacheBeforeRun({ config })).toBe(false);
    expect(shouldClearPredictionCacheBeforeEachCall({ config, cliOverride: true })).toBe(true);
  });
});
