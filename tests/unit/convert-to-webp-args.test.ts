import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { parseArgs, runConvertToWebp } from "../../scripts/llm/convert-to-webp.mjs";

const dirs: string[] = [];

async function tmpDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kc-webp-"));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

describe("convert-to-webp parseArgs", () => {
  it("defaults to a real run", () => {
    expect(parseArgs([])).toEqual({ dryRun: false });
  });

  it("accepts --dry-run and ignores unknown args", () => {
    expect(parseArgs(["--dry-run", "x", "--other"])).toEqual({ dryRun: true });
  });
});

describe("runConvertToWebp", () => {
  const row = (dir: string, originalFileName: string, canonicalKey: string, entry = {}) => ({
    folderAbs: dir,
    canonicalKey,
    originalFileName,
    entry,
  });

  it("converts mapped sources that are missing their canonical target", async () => {
    const dir = await tmpDir();
    const source = path.join(dir, "old.png");
    await fs.writeFile(source, "");
    const write = vi.fn(async () => {});

    const stats = await runConvertToWebp({
      rows: [row(dir, "old.png", "000_000_005-Name.webp")],
      write,
    });

    expect(stats).toEqual({ planned: 1, skipped: 0, missing: 0 });
    expect(write).toHaveBeenCalledWith(source, path.join(dir, "000_000_005-Name.webp"));
  });

  it("does not write in dry-run mode", async () => {
    const dir = await tmpDir();
    await fs.writeFile(path.join(dir, "old.png"), "");
    const write = vi.fn(async () => {});

    const stats = await runConvertToWebp({
      dryRun: true,
      rows: [row(dir, "old.png", "000_000_005-Name.webp")],
      write,
    });

    expect(stats).toEqual({ planned: 1, skipped: 0, missing: 0 });
    expect(write).not.toHaveBeenCalled();
  });

  it("counts missing metadata, missing sources and existing targets", async () => {
    const dir = await tmpDir();
    await fs.writeFile(path.join(dir, "src.png"), "");
    await fs.writeFile(path.join(dir, "z.webp"), "");

    const stats = await runConvertToWebp({
      rows: [
        row(dir, "", "a.webp"),
        row(dir, "missing.png", "b.webp"),
        row(dir, "src.png", "z.webp"),
        row(dir, "from-entry.png", "c.webp", { originalFileName: "from-entry.png" }),
      ],
      write: vi.fn(async () => {}),
    });

    expect(stats).toEqual({ planned: 0, skipped: 1, missing: 3 });
  });
});
