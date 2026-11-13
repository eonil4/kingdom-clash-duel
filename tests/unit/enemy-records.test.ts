import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import {
  buildEnemySourceIndex,
  canonicalEnemyMapKey,
  collectEnemyEntriesFromMap,
  findEnemyRowBySourceRel,
  isValidStoredEntry,
  loadConfiguredFolders,
  loadConfiguredFoldersFromRoot,
  loadEnemyMap,
  saveEnemyMap,
  WORKSPACE_ROOT,
} from "../../scripts/enemy-records.mjs";

const dirs: string[] = [];

async function tmpDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kc-records-"));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

const WS = path.join(os.tmpdir(), "kc-ws");
const SOURCE = path.join(WS, "data", "clan_clash", "2026-11-06", "Screenshot_x.png");
const FOLDER = path.join(WS, "data", "clan_clash", "2026-11-06");

describe("canonicalEnemyMapKey", () => {
  it("pads power and nests the canonical webp under the source name", () => {
    expect(
      canonicalEnemyMapKey(SOURCE, { power: 8104472, nameLatinRaw: "Gorkiy", nameRaw: "Горький" }, WS),
    ).toBe("data/clan_clash/2026-11-06/Screenshot_x.png/008_104_472-Gorkiy.webp");
    expect(canonicalEnemyMapKey(SOURCE, { power: 123, nameLatinRaw: "Foo" }, WS)).toBe(
      "data/clan_clash/2026-11-06/Screenshot_x.png/000_000_123-Foo.webp",
    );
  });

  it("appends english and raw tokens only when they differ", () => {
    expect(
      canonicalEnemyMapKey(
        SOURCE,
        { power: 8104472, nameLatinRaw: "Gorkiy", nameEnglish: "Gorky", nameRaw: "Горький" },
        WS,
      ),
    ).toBe("data/clan_clash/2026-11-06/Screenshot_x.png/008_104_472-Gorkiy-Gorky.webp");
    expect(
      canonicalEnemyMapKey(
        SOURCE,
        { power: 123, nameLatinRaw: "Foo", nameEnglish: "Foo", nameRaw: "Foo" },
        WS,
      ),
    ).toBe("data/clan_clash/2026-11-06/Screenshot_x.png/000_000_123-Foo.webp");
  });

  it("percent-encodes reserved characters in the name token", () => {
    expect(
      canonicalEnemyMapKey(SOURCE, { power: 1, nameLatinRaw: String.raw`Babka\MAG` }, WS),
    ).toBe("data/clan_clash/2026-11-06/Screenshot_x.png/000_000_001-Babka%5CMAG.webp");
  });
});

describe("collectEnemyEntriesFromMap", () => {
  const mapRoot = {
    data: {
      clan_clash: {
        "2026-11-06": {
          "Screenshot_x.png": {
            "008_104_472-Gorkiy.webp": { name: "Горький", nameLatin: "Gorkiy", power: 8104472 },
          },
        },
      },
    },
  };

  it("resolves the real folder, source name and canonical key", () => {
    const rows = collectEnemyEntriesFromMap(mapRoot, WS);
    expect(rows).toHaveLength(1);
    expect(rows[0].folderAbs).toBe(FOLDER);
    expect(rows[0].originalFileName).toBe("Screenshot_x.png");
    expect(rows[0].canonicalKey).toBe("008_104_472-Gorkiy.webp");
    expect(rows[0].fullMapKey).toBe(
      "data/clan_clash/2026-11-06/Screenshot_x.png/008_104_472-Gorkiy.webp",
    );
  });

  it("keeps the originalFileName of webp-keyed entries", () => {
    const webpKeyed = {
      data: {
        clan_clash: {
          clan: {
            "005_778_220-HuN.webp": {
              "005_778_220-HuN.webp": {
                name: "HuN",
                power: 5778220,
                originalFileName: "005_778_220-HuN-1.png",
              },
            },
          },
        },
      },
    };
    const [row] = collectEnemyEntriesFromMap(webpKeyed, WS);
    expect(row.folderAbs).toBe(path.join(WS, "data", "clan_clash", "clan"));
    expect(row.originalFileName).toBe("005_778_220-HuN-1.png");
    expect(row.canonicalKey).toBe("005_778_220-HuN.webp");
  });
});

describe("buildEnemySourceIndex", () => {
  const mapRoot = {
    data: {
      clan_clash: {
        "2026-11-06": {
          "Screenshot_x.png": {
            "008_104_472-Gorkiy.webp": { name: "Gorkiy", power: 8104472 },
          },
        },
      },
    },
  };

  it("indexes rows by posix source path", () => {
    const index = buildEnemySourceIndex(mapRoot, WS);
    const hit = index.get("data/clan_clash/2026-11-06/Screenshot_x.png");
    expect(hit?.canonicalKey).toBe("008_104_472-Gorkiy.webp");
    expect(hit?.folderAbs).toBe(FOLDER);
    expect(index.get("data/clan_clash/2026-11-06/other.png")).toBeUndefined();
  });
});

describe("findEnemyRowBySourceRel", () => {
  const mapRoot = {
    data: {
      clan_clash: {
        "2026-11-06": {
          "Screenshot_x.png": { "008_104_472-Gorkiy.webp": { name: "Gorkiy", power: 8104472 } },
        },
      },
    },
  };

  it("matches by posix-relative source path", () => {
    const row = findEnemyRowBySourceRel(
      mapRoot,
      "data/clan_clash/2026-11-06/Screenshot_x.png",
      WS,
    );
    expect(row?.canonicalKey).toBe("008_104_472-Gorkiy.webp");
  });

  it("normalises backslashes and returns undefined for unknown paths", () => {
    expect(
      findEnemyRowBySourceRel(
        mapRoot,
        "data\\clan_clash\\2026-11-06\\Screenshot_x.png",
        WS,
      )?.canonicalKey,
    ).toBe("008_104_472-Gorkiy.webp");
    expect(
      findEnemyRowBySourceRel(mapRoot, "data/clan_clash/2026-11-06/other.png", WS),
    ).toBeUndefined();
  });
});

describe("isValidStoredEntry", () => {
  it("accepts records with positive power and a name", () => {
    expect(isValidStoredEntry({ name: "HuN", power: 1000 })).toBe(true);
    expect(isValidStoredEntry({ nameLatin: "HuN", power: 1000 })).toBe(true);
    expect(isValidStoredEntry({ name: "HuN", power: 1000, canonical: "a.webp" })).toBe(true);
  });

  it("rejects placeholders and malformed entries", () => {
    expect(isValidStoredEntry(null)).toBe(false);
    expect(isValidStoredEntry([])).toBe(false);
    expect(isValidStoredEntry({ name: "HuN", power: 0 })).toBe(false);
    expect(isValidStoredEntry({ name: "HuN", power: -5 })).toBe(false);
    expect(isValidStoredEntry({ name: "", power: 10 })).toBe(false);
    expect(isValidStoredEntry({ power: 10 })).toBe(false);
    expect(isValidStoredEntry({ name: "HuN", power: 10, canonical: 42 })).toBe(false);
  });
});

describe("loadConfiguredFolders", () => {
  it("lists dated folders that contain images", async () => {
    const ws = await tmpDir();
    const good = path.join(ws, "data", "clan_clash", "2026-01-02");
    await fs.mkdir(good, { recursive: true });
    await fs.writeFile(path.join(good, "a.png"), "");
    await fs.mkdir(path.join(ws, "data", "clan_clash", "2026-01-01"), { recursive: true });
    const notADate = path.join(ws, "data", "clan_clash", "not-a-date");
    await fs.mkdir(notADate, { recursive: true });
    await fs.writeFile(path.join(notADate, "a.png"), "");
    await fs.writeFile(path.join(ws, "data", "clan_clash", "2026-01-03"), "");

    expect(await loadConfiguredFolders(ws)).toEqual([
      { absPath: good, relPath: "data/clan_clash/2026-01-02" },
    ]);
    expect(await loadConfiguredFolders(path.join(ws, "missing"))).toEqual([]);
  });
});

describe("loadConfiguredFoldersFromRoot", () => {
  it("keeps map-derived folders that exist and contain images", async () => {
    const ws = await tmpDir();
    const folder = path.join(ws, "data", "clan_clash", "2026-01-02");
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(path.join(folder, "a.png"), "");
    const map = {
      data: {
        clan_clash: {
          "2026-01-02": { "000_000_005-Name.webp": { name: "Name", power: 5 } },
          "logical.png": { "x.webp": { name: "X", power: 1 } },
        },
      },
    };

    expect(await loadConfiguredFoldersFromRoot(map, ws)).toEqual([
      { absPath: folder, relPath: "data/clan_clash/2026-01-02" },
    ]);
  });
});

describe("saveEnemyMap", () => {
  it("merges rows into the folder data.json", async () => {
    const dir = await fs.mkdtemp(path.join(WORKSPACE_ROOT, ".tmp-er-"));
    dirs.push(dir);
    const rel = path.relative(WORKSPACE_ROOT, dir).split(path.sep).join("/");
    await fs.writeFile(
      path.join(dir, "data.json"),
      JSON.stringify({ "old.png": { name: "Old", power: 9 } }),
    );
    const map = {
      [rel]: {
        "000_000_005-Name.webp": {
          name: "Name",
          nameLatin: "Name",
          power: 5,
          originalFileName: "old.png",
        },
      },
    };

    await saveEnemyMap(map);

    const entries = JSON.parse(await fs.readFile(path.join(dir, "data.json"), "utf8"));
    expect(entries["old.png"]).toMatchObject({
      name: "Name",
      power: 5,
      canonical: "000_000_005-Name.webp",
    });
  });

  it("replaces non-object existing entries", async () => {
    const dir = await fs.mkdtemp(path.join(WORKSPACE_ROOT, ".tmp-er-"));
    dirs.push(dir);
    const rel = path.relative(WORKSPACE_ROOT, dir).split(path.sep).join("/");
    await fs.writeFile(path.join(dir, "data.json"), JSON.stringify({ "broken.png": "nope" }));
    const map = {
      [rel]: {
        "000_000_005-Name.webp": { name: "Name", power: 5, originalFileName: "broken.png" },
      },
    };

    await saveEnemyMap(map);

    const entries = JSON.parse(await fs.readFile(path.join(dir, "data.json"), "utf8"));
    expect(entries["broken.png"]).toMatchObject({ name: "Name", power: 5 });
  });

  it("replaces an unreadable data.json and warns", async () => {
    const dir = await fs.mkdtemp(path.join(WORKSPACE_ROOT, ".tmp-er-"));
    dirs.push(dir);
    const rel = path.relative(WORKSPACE_ROOT, dir).split(path.sep).join("/");
    await fs.writeFile(path.join(dir, "data.json"), "not json");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const map = {
      [rel]: { "000_000_005-Name.webp": { name: "Name", power: 5 } },
    };

    await saveEnemyMap(map);

    const entries = JSON.parse(await fs.readFile(path.join(dir, "data.json"), "utf8"));
    expect(entries["000_000_005-Name.webp"]).toMatchObject({ name: "Name", power: 5 });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("merging into unreadable");
  });
});

describe("loadEnemyMap validation", () => {
  it("ignores an unparseable data.json and warns once", async () => {
    const ws = await tmpDir();
    const folder = path.join(ws, "data", "clan_clash", "2026-01-01");
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(path.join(folder, "data.json"), "{oops", "utf8");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(await loadEnemyMap(ws)).toEqual({});
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("ignoring unparseable");
  });

  it("skips invalid entries and warns once per folder", async () => {
    const ws = await tmpDir();
    const folder = path.join(ws, "data", "clan_clash", "2026-01-01");
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(
      path.join(folder, "data.json"),
      JSON.stringify({
        "good.png": { name: "HuN", power: 1234 },
        "zero.png": { name: "X", power: 0 },
        "nameless.png": { power: 5, name: "" },
      }),
      "utf8",
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const map = await loadEnemyMap(ws);
    const rows = collectEnemyEntriesFromMap(map, ws);

    expect(rows).toHaveLength(1);
    expect(rows[0].entry).toMatchObject({ name: "HuN", power: 1234 });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("skipped 2 invalid entries");
  });
});
