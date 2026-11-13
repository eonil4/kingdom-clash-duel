import { describe, expect, it } from "vitest";
import { resolveArmy } from "../../scripts/battle/army-resolver.mjs";

function makeConfig() {
  return {
    troops: { T1: { squadInfoName: "Spearman", factionId: "north" } },
    troopsLevel: {
      T1_1: {
        attack: 10,
        defense: 2,
        health: 100,
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
    troopAbilityByLevel: new Map([
      ["T1_1", { troopLevelId: "T1_1", defaultAbilityId: "A1", abilityId: null }],
    ]),
    troopsSquadCellPattern: { p1: { patternId: "pattern-1" } },
    hero: { H1: { squadInfoName: "Hero One", factionId: "north" } },
    heroLevel: {
      H1_1: {
        attack: 20,
        defense: 3,
        health: 200,
        power: 2000,
        moveSpeed: 2,
        aspd: 1,
        attackCooldown: 1,
        attackRange: 2,
        minAttackDistance: 0,
      },
    },
    heroAbilityByLevel: new Map([
      ["H1_1", { heroLevelId: "H1_1", defaultAbilityId: "A2", abilityId: "A2s" }],
    ]),
    abilityByKey: new Map([
      [
        "A1",
        {
          key: "A1",
          attack: 12,
          attackRange: 1,
          minAttackDistance: 0,
          aspd: 1,
          attackCooldown: 1,
          aoeRadius: 0,
          aoeAngle: 0,
        },
      ],
      [
        "A2",
        {
          key: "A2",
          attack: 25,
          attackRange: 2,
          minAttackDistance: 0,
          aspd: 1,
          attackCooldown: 1,
          aoeRadius: 0,
          aoeAngle: 0,
        },
      ],
    ]),
    gearLevel: { G1_level2: { abilityId: "A3" } },
    gear: {},
    clanConstants: {},
  };
}

describe("resolveArmy errors and fallbacks", () => {
  it("rejects invalid armies, slots and unknown ids", () => {
    expect(() => resolveArmy(makeConfig(), null, "attacker")).toThrow("Invalid army input");
    expect(() => resolveArmy(makeConfig(), { slots: [] }, "attacker")).toThrow("no slots");
    expect(() =>
      resolveArmy(makeConfig(), { slots: [{ kind: "troop", troopId: "T1", level: 0 }] }, "attacker"),
    ).toThrow("Invalid troop slot");
    expect(() =>
      resolveArmy(makeConfig(), { slots: [{ kind: "troop", troopId: "NOPE", level: 1 }] }, "attacker"),
    ).toThrow("Unknown troopId");
    expect(() =>
      resolveArmy(makeConfig(), { slots: [{ kind: "troop", troopId: "T1", level: 9 }] }, "attacker"),
    ).toThrow("Unknown troopsLevel");
    expect(() =>
      resolveArmy(makeConfig(), { slots: [{ kind: "hero", heroId: "NOPE", level: 1 }] }, "attacker"),
    ).toThrow("Unknown heroId");
    expect(() =>
      resolveArmy(makeConfig(), { slots: [{ kind: "hero", heroId: "H1", level: 9 }] }, "attacker"),
    ).toThrow("Unknown heroLevel");
  });

  it("rejects unknown gear levels and resolves armour gear", () => {
    expect(() =>
      resolveArmy(
        makeConfig(),
        {
          slots: [
            { kind: "hero", heroId: "H1", level: 1, gear: { weapon: "G1", weaponLevel: 9 } },
          ],
        },
        "attacker",
      ),
    ).toThrow("Unknown gearLevel");

    const cfg = makeConfig();
    cfg.gearLevel = { ...cfg.gearLevel, G2_level1: { abilityId: "A4" } };
    const army = resolveArmy(
      cfg,
      { slots: [{ kind: "hero", heroId: "H1", level: 1, gear: { armor: "G2", armorLevel: 1 } }] },
      "defender",
    );
    expect(army.units[0].gearAbilityIds).toEqual(["A4"]);
  });

  it("falls back to level stats when no ability row exists", () => {
    const cfg = makeConfig();
    cfg.troopAbilityByLevel = new Map();
    cfg.abilityByKey = new Map();
    const army = resolveArmy(
      cfg,
      { slots: [{ kind: "troop", troopId: "T1", level: 1 }] },
      "attacker",
    );
    expect(army.units[0]).toMatchObject({
      attack: 10,
      attackRange: 1,
      attackCooldown: 1,
      attackType: "Melee",
    });
  });
});

describe("resolveArmy", () => {
  it("resolves a troop slot into per-unit instances and a card", () => {
    const army = resolveArmy(
      makeConfig(),
      {
        playerId: "p1",
        displayName: "Attacker",
        slots: [{ kind: "troop", troopId: "T1", level: 1, slotIndex: 0 }],
      },
      "attacker",
    );

    expect(army.cards).toEqual([
      {
        kind: "troop",
        troopId: "T1",
        level: 1,
        levelId: "T1_1",
        power: 1000,
        count: 3,
        cellPatternId: "p1",
        patternId: "pattern-1",
        defaultAbilityId: "A1",
        specialAbilityId: null,
      },
    ]);
    expect(army.units).toHaveLength(3);
    expect(army.units[0]).toMatchObject({
      instanceId: "attacker-t-1",
      side: "attacker",
      kind: "troop",
      templateId: "T1",
      levelId: "T1_1",
      name: "Spearman",
      isHero: false,
      hp: 100,
      maxHp: 100,
      attack: 12,
      defense: 2,
      attackType: "Melee",
      aoeRadius: 0,
    });
    expect(army.units[0].powerShare).toBeCloseTo(1000 / 3);
    expect(army.armyPower).toBe(1000);
    expect(army.displayName).toBe("Attacker");
  });

  it("resolves hero slots with gear abilities and sorts by slotIndex", () => {
    const army = resolveArmy(
      makeConfig(),
      {
        playerId: "p2",
        totalPowerHint: 3000,
        slots: [
          { kind: "troop", troopId: "T1", level: 1, slotIndex: 2 },
          {
            kind: "hero",
            heroId: "H1",
            level: 1,
            slotIndex: 1,
            gear: { weapon: "G1", weaponLevel: 2 },
          },
        ],
      },
      "defender",
    );

    expect(army.cards.map((c: { kind: string }) => c.kind)).toEqual(["hero", "troop"]);
    expect(army.units[0]).toMatchObject({
      instanceId: "defender-h-1",
      kind: "hero",
      isHero: true,
      name: "Hero One",
      attack: 25,
      defense: 3,
      attackRange: 2,
      gearAbilityIds: ["A3"],
    });
    expect(army.armyPower).toBe(3000);
    expect(army.totalPowerHint).toBe(3000);
    expect(army.units.map((u: { slotIndex: number }) => u.slotIndex)).toEqual([1, 2, 2, 2]);
  });

  it("rejects invalid slots and unknown ids", () => {
    const config = makeConfig();
    expect(() => resolveArmy(config, {}, "attacker")).toThrow("has no slots");
    expect(() =>
      resolveArmy(config, { slots: [{ kind: "troop", troopId: "NOPE", level: 1 }] }, "attacker"),
    ).toThrow('Unknown troopId "NOPE"');
    expect(() =>
      resolveArmy(config, { slots: [{ kind: "troop", troopId: "T1", level: 9 }] }, "attacker"),
    ).toThrow('Unknown troopsLevel "T1_9"');
    expect(() => resolveArmy(config, { slots: [{ kind: "troop" }] }, "attacker")).toThrow(
      "Invalid troop slot",
    );
    expect(() =>
      resolveArmy(config, { slots: [{ kind: "hero", heroId: "H1", level: 9 }] }, "defender"),
    ).toThrow('Unknown heroLevel "H1_9"');
    expect(() =>
      resolveArmy(
        config,
        { slots: [{ kind: "hero", heroId: "H1", level: 1, gear: { weapon: "NOPE", weaponLevel: 1 } }] },
        "defender",
      ),
    ).toThrow('Unknown gearLevel "NOPE_level1"');
  });
});
