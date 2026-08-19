#!/usr/bin/env node
/**
 * Clan Clash headless battle simulator (APK config tables).
 *
 * Usage:
 *   node scripts/battle/run-battle.mjs <attacker.json> <defender.json> <battleResult.json> [--seed N]
 *
 * Reads army JSON files, resolves units from APK `_configs_extracted/common`,
 * simulates auto combat (max 300s), writes BattleResult JSON.
 */
import fs from "fs/promises";
import path from "path";
import { loadApkBattleConfig, DEFAULT_CONFIG_DIR } from "./load-apk-config.mjs";
import { resolveArmy } from "./army-resolver.mjs";
import { simulateCombat, summarizeSide } from "./combat-engine.mjs";
import { estimateClashScore } from "./clash-score.mjs";

function usage() {
  console.error(
    "Usage: node scripts/battle/run-battle.mjs <attacker.json> <defender.json> <battleResult.json> [--seed N] [--config-dir DIR]",
  );
}

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  /** @type {{ attacker?: string, defender?: string, output?: string, seed?: number, configDir?: string }} */
  const args = {};
  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--seed") args.seed = Number(argv[++i]);
    else if (a === "--config-dir") args.configDir = argv[++i];
    else if (a === "--help" || a === "-h") {
      usage();
      process.exit(0);
    } else if (!a.startsWith("-")) positionals.push(a);
  }
  if (positionals.length < 3) {
    usage();
    process.exit(1);
  }
  args.attacker = positionals[0];
  args.defender = positionals[1];
  args.output = positionals[2];
  return args;
}

/**
 * @param {string} filePath
 */
async function readArmy(filePath) {
  const abs = path.resolve(filePath);
  const raw = await fs.readFile(abs, "utf8");
  return { abs, data: JSON.parse(raw) };
}

/**
 * @param {object[]} units
 * @param {"attacker"|"defender"} side
 */
function topDamageDealers(units, side, limit = 5) {
  return units
    .filter((u) => u.side === side)
    .slice()
    .sort((a, b) => b.damageDealt - a.damageDealt)
    .slice(0, limit)
    .map((u) => ({
      side: u.side,
      templateId: u.templateId,
      levelId: u.levelId,
      name: u.name,
      kind: u.kind,
      damageDealt: u.damageDealt,
      kills: u.kills,
      hpRemaining: u.hp,
      maxHp: u.maxHp,
      alive: u.alive,
    }));
}

/**
 * @param {object[]} units
 * @param {"attacker"|"defender"} side
 */
function unitSummaries(units, side) {
  return units
    .filter((u) => u.side === side)
    .map((u) => ({
      instanceId: u.instanceId,
      templateId: u.templateId,
      levelId: u.levelId,
      name: u.name,
      kind: u.kind,
      damageDealt: u.damageDealt,
      damageTaken: u.damageTaken,
      kills: u.kills,
      hp: u.hp,
      maxHp: u.maxHp,
      alive: u.alive,
    }));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = await loadApkBattleConfig({ configDir: args.configDir });

  const attackerFile = await readArmy(/** @type {string} */ (args.attacker));
  const defenderFile = await readArmy(/** @type {string} */ (args.defender));

  const attackerArmy = resolveArmy(config, attackerFile.data, "attacker");
  const defenderArmy = resolveArmy(config, defenderFile.data, "defender");

  const seed = Number.isFinite(args.seed)
    ? /** @type {number} */ (args.seed)
    : Number(attackerFile.data.seed ?? defenderFile.data.seed ?? 42);

  const maxDurationSec = Number(
    attackerFile.data.maxDurationSec ?? defenderFile.data.maxDurationSec ?? 300,
  );

  const sim = simulateCombat({
    attackerUnits: attackerArmy.units,
    defenderUnits: defenderArmy.units,
    seed,
    maxDurationSec,
  });

  const atkSum = summarizeSide(sim.units, "attacker");
  const defSum = summarizeSide(sim.units, "defender");

  const clash = estimateClashScore({
    attackerPower: attackerArmy.armyPower,
    defenderPower: defenderArmy.armyPower,
    unitsDefeated: atkSum.unitsKilled,
    outcome: sim.outcome.outcome,
    clanConstants: config.clanConstants,
  });

  const result = {
    mode: "clan_clash",
    generatedAt: new Date().toISOString(),
    seed,
    configDir: config.configDir,
    inputs: {
      attackerPath: attackerFile.abs,
      defenderPath: defenderFile.abs,
    },
    outcome: sim.outcome.outcome,
    outcomeReason: sim.outcome.outcomeReason,
    durationSec: Number(sim.durationSec.toFixed(2)),
    timedOut: sim.timedOut,
    maxDurationSec,
    attacker: {
      playerId: attackerArmy.playerId,
      displayName: attackerArmy.displayName,
      armyPower: attackerArmy.armyPower,
      totalPowerHint: attackerArmy.totalPowerHint,
      cards: attackerArmy.cards,
      ...atkSum,
    },
    defender: {
      playerId: defenderArmy.playerId,
      displayName: defenderArmy.displayName,
      armyPower: defenderArmy.armyPower,
      totalPowerHint: defenderArmy.totalPowerHint,
      cards: defenderArmy.cards,
      ...defSum,
    },
    report: {
      title: "Battle Report",
      heroDamage: {
        attacker: atkSum.heroDamage,
        defender: defSum.heroDamage,
      },
      troopDamage: {
        attacker: atkSum.troopDamage,
        defender: defSum.troopDamage,
      },
      topDamageDealers: [
        ...topDamageDealers(sim.units, "attacker"),
        ...topDamageDealers(sim.units, "defender"),
      ].sort((a, b) => b.damageDealt - a.damageDealt),
      unitSummaries: {
        attacker: unitSummaries(sim.units, "attacker"),
        defender: unitSummaries(sim.units, "defender"),
      },
      notes: [
        "Damage formula is a placeholder (max(1, attack - 0.5*defense)) until IL2CPP/network RE confirms.",
        "Clan Clash points formula is a placeholder; see clash.pointsFormula.",
        "Hero collection ownership bonuses are NOT applied (Arena/Boss only per EN 2118).",
      ],
    },
    clash,
    engine: {
      defenseFactor: 0.5,
      tickDtSec: 0.25,
      configSource: DEFAULT_CONFIG_DIR,
    },
  };

  const outAbs = path.resolve(/** @type {string} */ (args.output));
  await fs.mkdir(path.dirname(outAbs), { recursive: true });
  await fs.writeFile(outAbs, `${JSON.stringify(result, null, 2)}\n`, "utf8");

  console.log(
    `${result.outcome} (${result.outcomeReason}) in ${result.durationSec}s` +
      ` | atkPower=${result.attacker.armyPower} defPower=${result.defender.armyPower}` +
      ` | dmg ${result.attacker.damageDealt}/${result.defender.damageDealt}` +
      ` | points~${result.clash.pointsEstimate}`,
  );
  console.log(`Wrote ${outAbs}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
