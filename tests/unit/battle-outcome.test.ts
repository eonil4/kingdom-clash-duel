import { describe, expect, it } from "vitest";
import { decideOutcome } from "../../scripts/battle/combat-engine.mjs";

type Unit = { alive: boolean; hp: number; maxHp: number; damageDealt: number };

const unit = (overrides: Partial<Unit> = {}): Unit => ({
  alive: true,
  hp: 10,
  maxHp: 10,
  damageDealt: 0,
  ...overrides,
});

describe("decideOutcome", () => {
  it("resolves wipes before any comparison", () => {
    expect(decideOutcome([unit()], [], [unit()], [], false)).toEqual({
      outcome: "Victory",
      outcomeReason: "enemy_wiped",
    });
    expect(decideOutcome([], [unit()], [], [unit()], false)).toEqual({
      outcome: "Defeat",
      outcomeReason: "attacker_wiped",
    });
    expect(decideOutcome([], [], [], [], false)).toEqual({
      outcome: "Draw",
      outcomeReason: "mutual_wipe",
    });
  });

  it("compares living unit counts next", () => {
    const atk = [unit(), unit()];
    const def = [unit()];
    expect(decideOutcome(atk, def, [...atk, ...def], [...atk, ...def], false)).toEqual({
      outcome: "Victory",
      outcomeReason: "living_units",
    });
    expect(decideOutcome(def, atk, [...atk, ...def], [...atk, ...def], true)).toEqual({
      outcome: "Defeat",
      outcomeReason: "timeout_living_units",
    });
  });

  it("falls back to remaining HP when counts match", () => {
    const atk = [unit({ hp: 30, maxHp: 30 })];
    const def = [unit({ hp: 10, maxHp: 10 })];
    expect(decideOutcome(atk, def, [...atk, ...def], [...atk, ...def], false)).toEqual({
      outcome: "Victory",
      outcomeReason: "hp_remaining",
    });
    expect(decideOutcome(def, atk, [...atk, ...def], [...atk, ...def], true)).toEqual({
      outcome: "Defeat",
      outcomeReason: "timeout_hp",
    });
  });

  it("falls back to damage dealt when HP matches", () => {
    const atk = [unit({ damageDealt: 7 })];
    const def = [unit({ damageDealt: 5 })];
    expect(decideOutcome(atk, def, atk, def, false)).toEqual({
      outcome: "Victory",
      outcomeReason: "damage_dealt",
    });
    expect(decideOutcome(def, atk, def, atk, true)).toEqual({
      outcome: "Defeat",
      outcomeReason: "timeout_damage",
    });
  });

  it("draws on a complete tie and marks timeouts", () => {
    const atk = [unit()];
    const def = [unit()];
    expect(decideOutcome(atk, def, [...atk, ...def], [...atk, ...def], false)).toEqual({
      outcome: "Draw",
      outcomeReason: "tie",
    });
    expect(decideOutcome(atk, def, [...atk, ...def], [...atk, ...def], true)).toEqual({
      outcome: "Draw",
      outcomeReason: "timeout_tie",
    });
  });
});
