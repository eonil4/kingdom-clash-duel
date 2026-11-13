import { afterEach, describe, expect, it } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import {
  collectImageFiles,
  groupFilesByFolder,
  parseScanArgs,
  selectTargets,
} from "../../scripts/ocr/scan-cli.mjs";
import { WORKSPACE_ROOT } from "../../scripts/enemy-records.mjs";

const dirs: string[] = [];

async function tmpDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kc-scan-"));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

const SHOT = path.join(WORKSPACE_ROOT, "data", "clan_clash", "2026-11-06", "Screenshot_x.png");
const CLAN_SHOT = path.join(
  WORKSPACE_ROOT,
  "data",
  "clan_clash",
  "2026-11-06",
  "clan",
  "Screenshot_x.png",
);

describe("parseScanArgs", () => {
  it("parses the shared OCR scan flags", () => {
    expect(parseScanArgs([])).toEqual({
      limit: undefined,
      only: undefined,
      debugCrops: false,
      forceOcr: false,
    });
    expect(parseScanArgs(["--limit", "5", "--only", "x.png"])).toEqual({
      limit: 5,
      only: "x.png",
      debugCrops: false,
      forceOcr: false,
    });
    expect(parseScanArgs(["--debug-crops", "--force-ocr"])).toMatchObject({
      debugCrops: true,
      forceOcr: true,
    });
    expect(parseScanArgs(["--", "--limit", "2"]).limit).toBe(2);
  });
});

describe("selectTargets", () => {
  const all = [SHOT, CLAN_SHOT];

  it("applies only the limit when no filter is given", () => {
    expect(selectTargets(all, {})).toEqual(all);
    expect(selectTargets(all, { limit: 1 })).toEqual([SHOT]);
  });

  it("matches by basename and prefers the deepest path", () => {
    expect(selectTargets(all, { only: "Screenshot_x.png" })).toEqual([CLAN_SHOT]);
    expect(selectTargets([SHOT], { only: "Screenshot_x.png" })).toEqual([SHOT]);
  });

  it("matches workspace-relative suffixes", () => {
    expect(selectTargets(all, { only: "2026-11-06/Screenshot_x.png" })).toEqual([SHOT]);
    expect(selectTargets(all, { only: "data/clan_clash/2026-11-06/Screenshot_x.png" })).toEqual([
      SHOT,
    ]);
  });

  it("returns nothing for unknown filters", () => {
    expect(selectTargets(all, { only: "missing.png" })).toEqual([]);
  });
});

describe("groupFilesByFolder", () => {
  it("groups files by their folder and preserves order", () => {
    const groups = groupFilesByFolder([SHOT, path.join(path.dirname(SHOT), "b.png"), CLAN_SHOT]);
    expect(groups).toHaveLength(2);
    expect(groups[0].absPath).toBe(path.dirname(SHOT));
    expect(groups[0].files).toEqual([SHOT, path.join(path.dirname(SHOT), "b.png")]);
    expect(groups[1].absPath).toBe(path.dirname(CLAN_SHOT));
  });
});

describe("collectImageFiles", () => {
  it("keeps supported images only and ignores directories", async () => {
    const dir = await tmpDir();
    await fs.writeFile(path.join(dir, "a.png"), "x");
    await fs.writeFile(path.join(dir, "b.JPG"), "x");
    await fs.writeFile(path.join(dir, "c.txt"), "x");
    await fs.mkdir(path.join(dir, "nested.png"));
    await fs.writeFile(path.join(dir, "nested.png", "d.png"), "x");

    const files = await collectImageFiles(dir);
    expect(files.sort()).toEqual([path.join(dir, "a.png"), path.join(dir, "b.JPG")].sort());
  });
});
