import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import {
  buildStoredRecord,
  readFolderEntries,
  writeFolderEntries,
} from "../../scripts/pipeline/data-json-store.mjs";

const dirs: string[] = [];

async function tmpDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kc-store-"));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

const record = {
  name: "Горький",
  nameLatin: "Gorkiy",
  power: 8104472,
  language: null,
  canonical: "008_104_472-Gorkiy.webp",
};

describe("buildStoredRecord", () => {
  it("writes the OCR shape without timing fields", () => {
    const entry = buildStoredRecord({ ...record, nameEnglish: "Gorky" }, { timing: false });
    expect(Object.keys(entry)).toEqual([
      "name",
      "nameLatin",
      "power",
      "language",
      "canonical",
      "nameEnglish",
    ]);
    expect(entry).toMatchObject({
      name: "Горький",
      power: 8104472,
      language: null,
      canonical: "008_104_472-Gorkiy.webp",
      nameEnglish: "Gorky",
    });
  });

  it("writes the convert shape with timing fields", () => {
    const entry = buildStoredRecord(
      { ...record, nameEnglish: "Gorky" },
      { timing: true, processingMs: 12.4 },
    );
    expect(Object.keys(entry)).toEqual([
      "name",
      "nameLatin",
      "power",
      "language",
      "processingMs",
      "canonical",
      "extractedAt",
    ]);
    expect(entry.processingMs).toBe(12);
    expect(typeof entry.extractedAt).toBe("string");
    expect("nameEnglish" in entry).toBe(false);
  });

  it("keeps a null language", () => {
    expect(buildStoredRecord({ ...record, language: undefined }).language).toBeNull();
  });
});

describe("read/writeFolderEntries", () => {
  it("round-trips and merges entries", async () => {
    const dir = await tmpDir();
    expect(await readFolderEntries(dir)).toEqual({});

    await writeFolderEntries(dir, { "a.png": { power: 1 } });
    const entries = await readFolderEntries(dir);
    entries["b.png"] = { power: 2 };
    await writeFolderEntries(dir, entries);

    expect(await readFolderEntries(dir)).toEqual({
      "a.png": { power: 1 },
      "b.png": { power: 2 },
    });
    const raw = await fs.readFile(path.join(dir, "data.json"), "utf8");
    expect(raw.endsWith("}\n")).toBe(true);
  });

  it("returns an empty object for missing or malformed data.json", async () => {
    const dir = await tmpDir();
    expect(await readFolderEntries(dir)).toEqual({});

    await fs.writeFile(path.join(dir, "data.json"), "not json", "utf8");
    expect(await readFolderEntries(dir)).toEqual({});
  });

  it("warns once per folder when data.json is malformed", async () => {
    const prevLevel = process.env.LOG_LEVEL;
    process.env.LOG_LEVEL = "warn";
    const dir = await tmpDir();
    await fs.writeFile(path.join(dir, "data.json"), "{oops", "utf8");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(await readFolderEntries(dir)).toEqual({});
      expect(await readFolderEntries(dir)).toEqual({});
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain("ignoring unparseable");
    } finally {
      if (prevLevel === undefined) delete process.env.LOG_LEVEL;
      else process.env.LOG_LEVEL = prevLevel;
    }
  });
});
