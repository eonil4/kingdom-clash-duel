import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import {
  formatDuration,
  parseArgs,
  resolveExtractor,
  runConvert,
  summarizeDurations,
} from "../../scripts/llm/convert.mjs";

const dirs: string[] = [];

async function tmpDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kc-convert-"));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

function fakeStats(overrides: Record<string, unknown> = {}) {
  return {
    converted: 2,
    convertedFromMap: 0,
    skipped: 1,
    failed: 0,
    durations: [1000, 61_000],
    writtenDataFiles: new Set<string>(),
    ...overrides,
  };
}

describe("resolveExtractor", () => {
  it("defaults to llm and accepts ocr case-insensitively", () => {
    expect(resolveExtractor(undefined)).toBe("llm");
    expect(resolveExtractor("ocr")).toBe("ocr");
    expect(resolveExtractor("OCR")).toBe("ocr");
    expect(() => resolveExtractor("bogus")).toThrow("Unknown --extractor");
  });
});

describe("convert parseArgs", () => {
  it("returns the documented defaults", () => {
    expect(parseArgs([])).toEqual({
      folder: undefined,
      extractor: "llm",
      mode: "crops",
      modeExplicit: false,
      force: false,
      model: undefined,
      clearCache: undefined,
    });
  });

  it("takes the folder positional and all extractor forms", () => {
    expect(parseArgs(["folder", "--extractor", "ocr"])).toMatchObject({
      folder: "folder",
      extractor: "ocr",
    });
    expect(parseArgs(["--extractor=ocr", "folder"]).extractor).toBe("ocr");
    expect(parseArgs(["-E", "ocr"]).extractor).toBe("ocr");
    expect(() => parseArgs(["--extractor", "bogus"])).toThrow("Unknown --extractor");
  });

  it("resolves mode aliases and marks explicit modes", () => {
    expect(parseArgs(["--mode", "full"])).toMatchObject({
      mode: "screenshot",
      modeExplicit: true,
    });
    expect(parseArgs(["-M", "name-power"]).mode).toBe("crops");
    expect(parseArgs(["--mode=screenshot"])).toMatchObject({
      mode: "screenshot",
      modeExplicit: true,
    });
    expect(parseArgs([]).modeExplicit).toBe(false);
    expect(() => parseArgs(["--mode", "bogus"])).toThrow("Unknown --mode");
  });

  it("parses force/model/cache flags with last-wins cache toggles", () => {
    expect(parseArgs(["--force", "--model", "qwen", "--clear-cache"])).toMatchObject({
      force: true,
      model: "qwen",
      clearCache: true,
    });
    expect(parseArgs(["-m", "other"]).model).toBe("other");
    expect(parseArgs(["--clear-cache", "--no-clear-cache"]).clearCache).toBe(false);
    expect(parseArgs(["--no-clear-cache", "--clear-cache"]).clearCache).toBe(true);
  });

  it("ignores the bare -- separator and unknown flags", () => {
    expect(parseArgs(["--", "folder"]).folder).toBe("folder");
    expect(parseArgs(["--unknown", "folder"]).folder).toBe("folder");
  });
});

describe("summarizeDurations", () => {
  it("handles empty, odd and even samples", () => {
    expect(summarizeDurations([])).toBeNull();
    expect(summarizeDurations([3000])).toEqual({ min: 3000, median: 3000, max: 3000 });
    expect(summarizeDurations([3000, 1000, 2000])).toEqual({
      min: 1000,
      median: 2000,
      max: 3000,
    });
    expect(summarizeDurations([1000, 2000])).toEqual({ min: 1000, median: 1500, max: 2000 });
    expect(formatDuration(61_000)).toBe("1.0m");
    expect(formatDuration(1500)).toBe("1.5s");
  });
});

describe("runConvert", () => {
  it("runs the LLM extractor with cache clearing and timing summary", async () => {
    const dir = await tmpDir();
    for (const name of ["b.png", "a.png", "note.txt"]) {
      await fs.writeFile(path.join(dir, name), "");
    }
    const run = vi.fn(async () => fakeStats());
    const clearCacheFn = vi.fn(async () => {});
    const makeLlm = vi.fn(() => ({ id: "llm" }));
    const logs: string[] = [];
    const warns: string[] = [];

    const stats = await runConvert(parseArgs([dir, "--force", "--clear-cache"]), {
      run,
      clearCache: clearCacheFn,
      shouldClearBeforeEach: () => true,
      shouldClearBeforeRun: () => true,
      makeLlm,
      config: { marker: 1 },
      log: (line) => logs.push(String(line)),
      warn: (line) => warns.push(String(line)),
    });

    expect(stats.converted).toBe(2);
    expect(clearCacheFn).toHaveBeenCalledWith({ config: { marker: 1 }, label: "before run" });
    expect(makeLlm).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "crops", clearCacheBeforeEachCall: true }),
    );
    const runnerOptions = run.mock.calls[0][0] as {
      folders: { files: string[] }[];
      webp: boolean;
      map: boolean;
      recordTiming: boolean;
      force: boolean;
    };
    expect(runnerOptions.folders[0].files.map((f) => path.basename(f))).toEqual([
      "a.png",
      "b.png",
    ]);
    expect(runnerOptions).toMatchObject({
      webp: true,
      map: true,
      recordTiming: true,
      force: true,
    });
    expect(logs.some((line) => line.includes("LLM min/median/max"))).toBe(true);
    expect(warns).toEqual([]);
  });

  it("uses the OCR extractor and warns when --mode is explicit", async () => {
    const dir = await tmpDir();
    await fs.writeFile(path.join(dir, "a.png"), "");
    const run = vi.fn(async () => fakeStats({ durations: [] }));
    const makeOcr = vi.fn(() => ({ id: "ocr" }));
    const clearCacheFn = vi.fn(async () => {});
    const logs: string[] = [];
    const warns: string[] = [];

    await runConvert(
      { ...parseArgs(["--extractor", "ocr", "--mode", "screenshot"]), folder: dir },
      {
        run,
        clearCache: clearCacheFn,
        shouldClearBeforeEach: () => false,
        shouldClearBeforeRun: () => false,
        makeOcr,
        config: { marker: 2 },
        log: (line) => logs.push(String(line)),
        warn: (line) => warns.push(String(line)),
      },
    );

    expect(warns[0]).toContain("ignored");
    expect(makeOcr).toHaveBeenCalledWith({ force: false, config: { marker: 2 } });
    expect(clearCacheFn).not.toHaveBeenCalled();
    expect(logs.some((line) => line.includes("Done (convert / ocr)"))).toBe(true);
  });

  it("resolves relative folders and reports empty folders", async () => {
    const root = await tmpDir();
    const empty = path.join(root, "sub");
    await fs.mkdir(empty);
    await fs.writeFile(path.join(empty, "note.txt"), "");
    const warns: string[] = [];

    const result = await runConvert({ ...parseArgs(["sub"]), folder: "sub" }, {
      root,
      run: vi.fn(),
      config: {},
      shouldClearBeforeEach: () => false,
      shouldClearBeforeRun: () => false,
      warn: (line) => warns.push(String(line)),
    });

    expect(result).toEqual({ empty: true });
    expect(warns[0]).toContain("No PNG files");
  });
});
