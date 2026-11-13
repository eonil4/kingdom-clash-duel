import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { runOcrEnemyScan } from "../../scripts/ocr/ocr-enemy.mjs";
import { runOcrClanScan } from "../../scripts/ocr/ocr-clan.mjs";

const dirs: string[] = [];

async function tmpDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kc-scan-"));
  dirs.push(dir);
  return dir;
}

function fakeRun(written: string[] = []) {
  const calls: any[] = [];
  const run = vi.fn(async (options: any) => {
    calls.push(options);
    return {
      converted: 0,
      skipped: 0,
      failed: 0,
      durations: [],
      writtenDataFiles: new Set(written),
    };
  });
  return { run, calls };
}

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

describe("runOcrEnemyScan", () => {
  it("filters test-folder crops and builds the arena strategy", async () => {
    const root = await tmpDir();
    const testDir = path.join(root, "test");
    await fs.mkdir(testDir);
    for (const name of ["Screenshot_1.png", "test.png", "crop.png"]) {
      await fs.writeFile(path.join(testDir, name), "");
    }
    const logs: string[] = [];
    const { run, calls } = fakeRun(["a/data.json"]);
    const makeStrategy = vi.fn(() => ({ id: "fake" }));

    const stats = await runOcrEnemyScan([], {
      loadFolders: async () => [{ absPath: testDir, relPath: "test" }],
      run,
      makeStrategy,
      config: { marker: true },
      log: (line) => logs.push(String(line)),
      warn: (line) => logs.push(String(line)),
    });

    expect(stats.writtenDataFiles.size).toBe(1);
    expect(calls[0].folders[0].files.map((f: string) => path.basename(f)).sort()).toEqual([
      "Screenshot_1.png",
      "test.png",
    ]);
    expect(makeStrategy).toHaveBeenCalledWith({
      force: false,
      debugCrops: false,
      config: { marker: true },
    });
    expect(logs.some((line) => line.includes("Skipping reference crop"))).toBe(true);
    expect(logs.some((line) => line.includes("Updated 1 data.json"))).toBe(true);
  });

  it("honours --only/--limit and warns for missing or non-folder entries", async () => {
    const dir = await tmpDir();
    await fs.writeFile(path.join(dir, "a.png"), "");
    await fs.writeFile(path.join(dir, "b.png"), "");
    await fs.writeFile(path.join(dir, "c.png"), "");
    const filePath = path.join(dir, "not-a-folder.txt");
    await fs.writeFile(filePath, "");
    const logs: string[] = [];
    const { run, calls } = fakeRun();

    await runOcrEnemyScan(["--only", "b.png", "--limit", "1"], {
      loadFolders: async () => [
        { absPath: dir, relPath: "d" },
        { absPath: path.join(dir, "missing"), relPath: "m" },
        { absPath: filePath, relPath: "f" },
      ],
      run,
      config: {},
      makeStrategy: () => ({}),
      log: (line) => logs.push(String(line)),
      warn: (line) => logs.push(String(line)),
    });

    expect(calls[0].folders[0].files.map((f: string) => path.basename(f))).toEqual(["b.png"]);
    expect(logs.some((line) => line.includes("not found"))).toBe(true);
    expect(logs.some((line) => line.includes("not a folder"))).toBe(true);
    expect(logs).toContain("Images: 1");
  });
});

describe("runOcrClanScan", () => {
  it("collects discovered clan folders and builds the clan strategy", async () => {
    const root = await tmpDir();
    const dir = path.join(root, "clan");
    await fs.mkdir(dir);
    await fs.writeFile(path.join(dir, "a.png"), "");
    await fs.writeFile(path.join(dir, "b.png"), "");
    const logs: string[] = [];
    const { run, calls } = fakeRun();
    const makeStrategy = vi.fn(() => ({ id: "fake" }));

    await runOcrClanScan(["--limit", "1"], {
      discover: async () => [{ absPath: dir, relPath: "clan" }],
      run,
      makeStrategy,
      config: { marker: true },
      log: (line) => logs.push(String(line)),
      warn: (line) => logs.push(String(line)),
    });

    expect(calls[0].folders[0].files).toHaveLength(1);
    expect(makeStrategy).toHaveBeenCalledWith({
      force: false,
      debugCrops: false,
      targetKey: "clan",
      config: { marker: true },
    });
    expect(logs.some((line) => line.startsWith("Clan folders: clan"))).toBe(true);
    expect(logs).toContain("Images: 1");
  });

  it("logs an empty discovery result", async () => {
    const logs: string[] = [];
    const { run, calls } = fakeRun();
    await runOcrClanScan([], {
      discover: async () => [],
      run,
      config: {},
      makeStrategy: () => ({}),
      log: (line) => logs.push(String(line)),
      warn: (line) => logs.push(String(line)),
    });
    expect(calls[0].folders).toEqual([]);
    expect(logs).toContain("Clan folders: (none)");
  });
});
