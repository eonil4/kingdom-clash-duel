import { afterEach, describe, expect, it } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { runExtraction } from "../../scripts/pipeline/run-extraction.mjs";
import { readFolderEntries } from "../../scripts/pipeline/data-json-store.mjs";

const dirs: string[] = [];

async function tmpDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kc-runner-"));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

function fakeStrategy(overrides: Record<string, unknown> = {}) {
  const calls: string[] = [];
  let count = 0;
  return {
    id: "fake",
    logTag: "[fake]",
    calls,
    async prepare() {
      calls.push("prepare");
    },
    async dispose() {
      calls.push("dispose");
    },
    async shouldSkip({ basename }: { basename: string }) {
      if (basename === "skip.png") return `skip ${basename}`;
      return undefined;
    },
    async extract({ basename }: { basename: string }) {
      calls.push(`extract:${basename}`);
      if (basename === "boom.png") throw new Error("boom");
      count += 1;
      return {
        record: {
          name: `N${count}`,
          nameLatin: `L${count}`,
          power: 1000 + count,
          language: null,
          canonical: `00${count}.webp`,
        },
        durationMs: 5,
      };
    },
    ...overrides,
  };
}

async function seedFolder(names: string[]) {
  const dir = await tmpDir();
  const files = names.map((name) => path.join(dir, name));
  await Promise.all(files.map((file) => fs.writeFile(file, "x", "utf8")));
  return { dir, files };
}

describe("runExtraction", () => {
  it("skips, extracts, persists and disposes in order", async () => {
    const { dir, files } = await seedFolder(["a.png", "skip.png", "boom.png"]);
    const strategy = fakeStrategy();

    const stats = await runExtraction({
      folders: [{ absPath: dir, files }],
      strategy,
    });

    expect(stats).toMatchObject({ converted: 1, skipped: 1, failed: 1 });
    expect(stats.writtenDataFiles.size).toBe(1);
    expect(strategy.calls[0]).toBe("prepare");
    expect(strategy.calls.at(-1)).toBe("dispose");
    expect(strategy.calls).not.toContain("extract:skip.png");

    const entries = await readFolderEntries(dir);
    expect(Object.keys(entries)).toEqual(["a.png"]);
    expect(entries["a.png"]).toMatchObject({
      name: "N1",
      nameLatin: "L1",
      power: 1001,
      canonical: "001.webp",
    });
    expect(entries["a.png"]).not.toHaveProperty("processingMs");
  });

  it("adds timing fields when recordTiming is on", async () => {
    const { dir, files } = await seedFolder(["a.png"]);
    await runExtraction({
      folders: [{ absPath: dir, files }],
      strategy: fakeStrategy(),
      recordTiming: true,
    });

    const entries = await readFolderEntries(dir);
    expect(entries["a.png"]).toHaveProperty("processingMs", 5);
    expect(typeof entries["a.png"].extractedAt).toBe("string");
  });

  it("isolates per-file failures and still disposes", async () => {
    const { dir, files } = await seedFolder(["boom.png", "a.png"]);
    const strategy = fakeStrategy();
    const stats = await runExtraction({
      folders: [{ absPath: dir, files }],
      strategy,
      logError: () => {},
    });

    expect(stats.failed).toBe(1);
    expect(stats.converted).toBe(1);
    expect(strategy.calls.at(-1)).toBe("dispose");
    expect(Object.keys(await readFolderEntries(dir))).toEqual(["a.png"]);
  });

  it("does not dispose when prepare fails", async () => {
    const { dir, files } = await seedFolder(["a.png"]);
    const strategy = fakeStrategy({
      async prepare() {
        throw new Error("no workers");
      },
    });

    await expect(
      runExtraction({ folders: [{ absPath: dir, files }], strategy }),
    ).rejects.toThrow("no workers");
    expect(strategy.calls).toEqual([]);
  });

  it("rejects strategies that do not implement the contract", async () => {
    await expect(
      runExtraction({
        folders: [],
        strategy: { id: "broken" },
      } as never),
    ).rejects.toThrow(TypeError);
  });
});
