import { afterEach, describe, expect, it } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import {
  DEFAULT_CONFIG_DIR,
  loadApkBattleConfig,
} from "../../scripts/battle/load-apk-config.mjs";
import { WORKSPACE_ROOT } from "../../scripts/enemy-records.mjs";

const dirs: string[] = [];

async function makeConfigDir(tables: Record<string, unknown>) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kc-apk-"));
  dirs.push(dir);
  await Promise.all(
    Object.entries(tables).map(([name, table]) =>
      fs.writeFile(path.join(dir, name), JSON.stringify(table), "utf8"),
    ),
  );
  return dir;
}

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

const BASE_TABLES = {
  "troops.json": { T1: { squadInfoName: "Spearman" } },
  "troopsLevel.json": { T1_1: { attack: 10, power: 100, count: 2 } },
  "troopsAbility.json": {
    r1: { troopLevelId: "T1_1", defaultAbilityId: "A1" },
    r2: { other: true },
  },
  "troopsSquadCellPattern.json": { p1: { patternId: "pat" } },
  "hero.json": { H1: { squadInfoName: "Hero" } },
  "heroLevel.json": { H1_1: { attack: 20, power: 200 } },
  "heroAbility.json": { h1: { heroLevelId: "H1_1", defaultAbilityId: "A2" } },
  "gear.json": { G1: {} },
  "gearLevel.json": { G1_level2: { abilityId: "A3" } },
  "clanConstants.json": { pvpClashPointToTokenRate: 0.001 },
};

describe("loadApkBattleConfig", () => {
  it("loads every table and indexes the ability links", async () => {
    const dir = await makeConfigDir(BASE_TABLES);
    const config = await loadApkBattleConfig({ configDir: dir });

    expect(config.configDir).toBe(dir);
    expect(config.troops.T1.squadInfoName).toBe("Spearman");
    expect(config.troopsLevel.T1_1.attack).toBe(10);
    expect(config.heroLevel.H1_1.power).toBe(200);
    expect(config.gearLevel.G1_level2.abilityId).toBe("A3");
    expect(config.clanConstants.pvpClashPointToTokenRate).toBe(0.001);

    expect(config.troopAbilityByLevel.get("T1_1")).toMatchObject({
      defaultAbilityId: "A1",
    });
    expect(config.heroAbilityByLevel.get("H1_1")).toMatchObject({
      defaultAbilityId: "A2",
    });
    expect(config.troopAbilityByLevel.size).toBe(1);
    expect(config.heroAbilityByLevel.size).toBe(1);
  });

  it("indexes ability rows by key and prefers combat rows", async () => {
    const dir = await makeConfigDir({
      ...BASE_TABLES,
      "abilityMelee.json": {
        a: { key: "A1", attack: 5, attackType: "Melee" },
        b: { key: "A1", extra: true },
        c: { noKey: true },
      },
      "abilityInfo.json": { x: { key: "IGNORED" } },
    });
    const config = await loadApkBattleConfig({ configDir: dir });

    expect(config.abilityByKey.get("A1")).toMatchObject({
      attack: 5,
      attackType: "Melee",
      _sourceTable: "abilityMelee.json",
    });
    expect(config.abilityByKey.has("IGNORED")).toBe(false);
    expect(config.abilityByKey.size).toBe(1);
  });

  it("defaults the config dir to the APK extraction path", () => {
    expect(DEFAULT_CONFIG_DIR.startsWith(WORKSPACE_ROOT)).toBe(true);
    expect(DEFAULT_CONFIG_DIR.endsWith(path.join("_configs_extracted", "common"))).toBe(true);
  });
});
