import { afterEach, describe, expect, it } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { discoverClanFolders } from "../../scripts/ocr/ocr-clan.mjs";
import { isFullScreenshotForOcr } from "../../scripts/ocr/ocr-enemy.mjs";

const dirs: string[] = [];

async function tmpDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kc-discovery-"));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

describe("isFullScreenshotForOcr", () => {
  it("accepts every image outside test folders", () => {
    const folder = path.join("data", "clan_clash", "2026-01-01");
    expect(isFullScreenshotForOcr(folder, path.join(folder, "anything.png"))).toBe(true);
  });

  it("accepts only primary screenshots inside test folders", () => {
    const folder = path.join("data", "clan_clash", "2026-01-01", "test");
    expect(isFullScreenshotForOcr(folder, path.join(folder, "test.png"))).toBe(true);
    expect(isFullScreenshotForOcr(folder, path.join(folder, "Screenshot_1.png"))).toBe(true);
    expect(isFullScreenshotForOcr(folder, path.join(folder, "crop.png"))).toBe(false);
  });
});

describe("discoverClanFolders", () => {
  it("finds dated clan folders that contain images", async () => {
    const root = await tmpDir();
    const good = path.join(root, "data", "clan_clash", "2026-01-02", "clan");
    await fs.mkdir(good, { recursive: true });
    await fs.writeFile(path.join(good, "a.png"), "");
    await fs.mkdir(path.join(root, "data", "clan_clash", "2026-01-01", "clan"), {
      recursive: true,
    });
    const notADate = path.join(root, "data", "clan_clash", "not-a-date", "clan");
    await fs.mkdir(notADate, { recursive: true });
    await fs.writeFile(path.join(notADate, "a.png"), "");

    const found = await discoverClanFolders(root);
    expect(found.map((f) => f.relPath)).toEqual(["data/clan_clash/2026-01-02/clan"]);
    expect(found[0].absPath).toBe(good);
  });

  it("returns an empty list when the data root is missing", async () => {
    const root = await tmpDir();
    expect(await discoverClanFolders(root)).toEqual([]);
  });
});
