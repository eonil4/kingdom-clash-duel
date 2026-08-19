/**
 * Load Kingdom Clash APK-extracted config tables used by the Clan Clash battle sim.
 */
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const WORKSPACE_ROOT = path.resolve(__dirname, "..", "..");

export const DEFAULT_CONFIG_DIR = path.join(
  WORKSPACE_ROOT,
  "data",
  "Kingdom Clash - War army games_3.0.0_APKPure",
  "_configs_extracted",
  "common",
);

/**
 * @param {string} filePath
 */
async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

/**
 * @param {string} configDir
 * @param {string} name
 */
async function loadTable(configDir, name) {
  return readJson(path.join(configDir, name));
}

/**
 * Index ability family rows by `key` across ability*.json combat tables.
 * @param {string} configDir
 */
async function loadAbilityRegistry(configDir) {
  const entries = await fs.readdir(configDir);
  /** @type {Map<string, object>} */
  const byKey = new Map();
  const skip = new Set(["abilityInfo.json", "abilityDamageLevelupNested.json"]);

  for (const name of entries) {
    if (!name.startsWith("ability") || !name.endsWith(".json")) continue;
    if (name.endsWith(".meta") || skip.has(name)) continue;
    if (name.includes("Nested") && !name.includes("abilityMelee") && !name.includes("abilityRange")) {
      // keep most nested tables out of basic attack registry unless needed
    }
    const table = await loadTable(configDir, name);
    if (!table || typeof table !== "object") continue;
    for (const row of Object.values(table)) {
      if (!row || typeof row !== "object") continue;
      const key = typeof row.key === "string" ? row.key : undefined;
      if (!key) continue;
      // Prefer rows that look like combat ability instances (have attack and/or attackType)
      if (!byKey.has(key) || row.attack != null || row.attackType != null) {
        byKey.set(key, { ...row, _sourceTable: name });
      }
    }
  }
  return byKey;
}

/**
 * @param {{ configDir?: string }} [options]
 */
export async function loadApkBattleConfig(options = {}) {
  const configDir = options.configDir
    ? path.resolve(options.configDir)
    : DEFAULT_CONFIG_DIR;

  const [
    troops,
    troopsLevel,
    troopsAbility,
    troopsSquadCellPattern,
    hero,
    heroLevel,
    heroAbility,
    gear,
    gearLevel,
    clanConstants,
    abilityByKey,
  ] = await Promise.all([
    loadTable(configDir, "troops.json"),
    loadTable(configDir, "troopsLevel.json"),
    loadTable(configDir, "troopsAbility.json"),
    loadTable(configDir, "troopsSquadCellPattern.json"),
    loadTable(configDir, "hero.json"),
    loadTable(configDir, "heroLevel.json"),
    loadTable(configDir, "heroAbility.json"),
    loadTable(configDir, "gear.json"),
    loadTable(configDir, "gearLevel.json"),
    loadTable(configDir, "clanConstants.json"),
    loadAbilityRegistry(configDir),
  ]);

  /** @type {Map<string, object>} */
  const troopAbilityByLevel = new Map();
  for (const row of Object.values(troopsAbility)) {
    if (row?.troopLevelId) troopAbilityByLevel.set(row.troopLevelId, row);
  }

  /** @type {Map<string, object>} */
  const heroAbilityByLevel = new Map();
  for (const row of Object.values(heroAbility)) {
    if (row?.heroLevelId) heroAbilityByLevel.set(row.heroLevelId, row);
  }

  return {
    configDir,
    troops,
    troopsLevel,
    troopsAbility,
    troopsSquadCellPattern,
    hero,
    heroLevel,
    heroAbility,
    gear,
    gearLevel,
    clanConstants,
    abilityByKey,
    troopAbilityByLevel,
    heroAbilityByLevel,
  };
}
