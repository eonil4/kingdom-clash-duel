import { afterEach, describe, expect, it } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { readArmy, runBattle } from "../../scripts/battle/run-battle.mjs";

const dirs: string[] = [];

async function tmpDir(prefix: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

const TABLES: Record<string, unknown> = {
  "troops.json": { T1: { squadInfoName: "Spearman", factionId: "north" } },
  "troopsLevel.json": {
    T1_1: {
      attack: 10,
      defense: 2,
      health: 30,
      power: 1000,
      count: 3,
      moveSpeed: 1,
      cellPatternId: "p1",
      aspd: 1,
      attackCooldown: 1,
      attackRange: 1,
      minAttackDistance: 0,
    },
  },
  "troopsAbility.json": { r1: { troopLevelId: "T1_1", defaultAbilityId: "A1" } },
  "troopsSquadCellPattern.json": { p1: { patternId: "pat" } },
  "abilityMelee.json": {
    a1: {
      key: "A1",
      attack: 12,
      attackRange: 1,
      minAttackDistance: 0,
      aspd: 1,
      attackCooldown: 1,
      aoeRadius: 0,
      aoeAngle: 0,
    },
  },
  "hero.json": {},
  "heroLevel.json": {},
  "heroAbility.json": {},
  "gear.json": {},
  "gearLevel.json": {},
  "clanConstants.json": {},
};

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

describe("readArmy", () => {
  it("reads JSON and surfaces missing/invalid files", async () => {
    const dir = await tmpDir("kc-battle-army-");
    const valid = path.join(dir, "army.json");
    await fs.writeFile(valid, JSON.stringify({ slots: [] }));
    expect((await readArmy(valid)).data).toEqual({ slots: [] });

    await expect(readArmy(path.join(dir, "missing.json"))).rejects.toThrow();
    const invalid = path.join(dir, "invalid.json");
    await fs.writeFile(invalid, "{oops");
    await expect(readArmy(invalid)).rejects.toThrow();
  });
});

describe("runBattle", () => {
  it("simulates two armies, writes the report and summarises damage", async () => {
    const configDir = await tmpDir("kc-battle-config-");
    await Promise.all(
      Object.entries(TABLES).map(([name, table]) =>
        fs.writeFile(path.join(configDir, name), JSON.stringify(table), "utf8"),
      ),
    );
    const workDir = await tmpDir("kc-battle-work-");
    const attacker = path.join(workDir, "attacker.json");
    const defender = path.join(workDir, "defender.json");
    const output = path.join(workDir, "out", "result.json");
    const army = (id: string) => ({
      playerId: id,
      displayName: id,
      slots: [{ kind: "troop", troopId: "T1", level: 1, slotIndex: 0 }],
    });
    await fs.writeFile(attacker, JSON.stringify(army("atk")));
    await fs.writeFile(defender, JSON.stringify(army("def")));

    const { result, outputPath } = await runBattle({
      attacker,
      defender,
      output,
      seed: 7,
      configDir,
    });

    expect(outputPath).toBe(output);
    expect(result).toMatchObject({
      mode: "clan_clash",
      seed: 7,
      outcome: expect.stringMatching(/^(Victory|Defeat|Draw)$/),
    });
    expect(result.attacker.armyPower).toBe(1000);
    expect(result.defender.armyPower).toBe(1000);
    expect(result.report.topDamageDealers.length).toBeGreaterThan(0);
    expect(result.report.unitSummaries.attacker).toHaveLength(3);
    expect(result.report.unitSummaries.defender).toHaveLength(3);
    expect(typeof result.clash.pointsEstimate).toBe("number");
    expect(result.engine.configSource).toBe(configDir);

    const written = JSON.parse(await fs.readFile(output, "utf8"));
    expect(written).toEqual(result);
  });
});
