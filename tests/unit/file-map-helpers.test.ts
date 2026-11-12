import { describe, expect, it } from "vitest";
import os from "os";
import path from "path";
import {
  canonicalEnemyMapKey,
  collectEnemyEntriesFromMap,
  findEnemyRowBySourceRel,
} from "../../scripts/file-map-enemies.mjs";

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
