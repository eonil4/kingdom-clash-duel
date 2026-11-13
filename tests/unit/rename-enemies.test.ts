import { afterEach, describe, expect, it } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import {
  buildTargetBasename,
  collectImageFilesInFolderOnly,
  getNestedFolderNode,
  getNestedMapping,
  parseArgs,
  toMapKey,
  unlinkWithRetry,
} from "../../scripts/llm/rename-enemies.mjs";
import { WORKSPACE_ROOT } from "../../scripts/enemy-records.mjs";

const dirs: string[] = [];
const savedSkipOcr = process.env.RENAME_SKIP_OCR;

async function tmpDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kc-rename-"));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  if (savedSkipOcr === undefined) delete process.env.RENAME_SKIP_OCR;
  else process.env.RENAME_SKIP_OCR = savedSkipOcr;
  for (const dir of dirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

describe("rename-enemies parseArgs", () => {
  it("parses --only and --skip-ocr", () => {
    expect(parseArgs(["--only", "x.png", "--skip-ocr"])).toEqual({
      only: "x.png",
      skipOcr: true,
    });
  });

  it("honours RENAME_SKIP_OCR=1", () => {
    process.env.RENAME_SKIP_OCR = "1";
    expect(parseArgs([]).skipOcr).toBe(true);
    process.env.RENAME_SKIP_OCR = "0";
    expect(parseArgs([]).skipOcr).toBe(false);
  });
});

describe("buildTargetBasename", () => {
  it("uses the Latin token and appends a different English token", () => {
    expect(buildTargetBasename({ power: 5, name: "Имя", nameLatin: "Imya" })).toBe(
      "000_000_005-Imya.webp",
    );
    expect(
      buildTargetBasename({ power: 5, nameLatin: "Imya", nameEnglish: "Name" }),
    ).toBe("000_000_005-Imya-Name.webp");
    expect(
      buildTargetBasename({ power: 5, nameLatin: "Imya", nameEnglish: "Imya" }),
    ).toBe("000_000_005-Imya.webp");
  });

  it("falls back to the raw name and escapes reserved characters", () => {
    expect(buildTargetBasename({ power: 5, name: "a b" })).toBe("000_000_005-a_b.webp");
    expect(buildTargetBasename({ power: 5, nameLatin: String.raw`Babka\MAG` })).toBe(
      "000_000_005-Babka%5CMAG.webp",
    );
  });
});

describe("map navigation helpers", () => {
  const tree = {
    data: {
      clan_clash: {
        "2026-01-02": {
          "000_000_005-N.webp": { power: 5, name: "N" },
        },
      },
    },
  };

  it("reads nested entries by posix key", () => {
    expect(getNestedMapping(tree, "data/clan_clash/2026-01-02/000_000_005-N.webp")).toMatchObject({
      power: 5,
      name: "N",
    });
    expect(getNestedMapping(tree, "data/clan_clash/2026-01-02")).toMatchObject({
      "000_000_005-N.webp": { power: 5 },
    });
    expect(getNestedMapping(tree, "data/missing")).toBeUndefined();
    expect(
      getNestedMapping(tree, "data/clan_clash/2026-01-02/000_000_005-N.webp/extra"),
    ).toBeUndefined();
  });

  it("reads folder nodes", () => {
    expect(getNestedFolderNode(tree, "data/clan_clash/2026-01-02")).toMatchObject({
      "000_000_005-N.webp": { power: 5 },
    });
    expect(getNestedFolderNode(tree, "data/none")).toBeUndefined();
  });

  it("builds workspace-relative map keys", () => {
    expect(toMapKey(path.join(WORKSPACE_ROOT, "data", "clan_clash", "x.png"))).toBe(
      "data/clan_clash/x.png",
    );
  });
});

describe("file helpers", () => {
  it("collects image files only, without recursing", async () => {
    const dir = await tmpDir();
    await fs.writeFile(path.join(dir, "a.png"), "");
    await fs.writeFile(path.join(dir, "b.WEBP"), "");
    await fs.writeFile(path.join(dir, "c.txt"), "");
    await fs.mkdir(path.join(dir, "sub"));
    await fs.writeFile(path.join(dir, "sub", "d.png"), "");

    const files = await collectImageFilesInFolderOnly(dir);
    expect(files.map((f) => path.basename(f)).sort()).toEqual(["a.png", "b.WEBP"]);
  });

  it("unlinks an existing file and rejects a missing one", async () => {
    const dir = await tmpDir();
    const file = path.join(dir, "gone.txt");
    await fs.writeFile(file, "");
    await unlinkWithRetry(file);
    await expect(fs.access(file)).rejects.toThrow();
    await expect(unlinkWithRetry(file, { attempts: 1 })).rejects.toThrow();
  });
});
