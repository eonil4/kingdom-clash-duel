import { describe, expect, it } from "vitest";
import { simulateCombat } from "../../scripts/battle/combat-engine.mjs";

function unit(side: "attacker" | "defender", id: string, overrides: Record<string, unknown> = {}) {
  return {
    instanceId: id,
    side,
    templateId: "t",
    levelId: "t_1",
    name: id,
    kind: "troop",
    isHero: false,
    hp: 100,
    maxHp: 100,
    attack: 10,
    defense: 0,
    aspd: 1,
    attackCooldown: 1,
    attackRange: 1,
    minAttackDistance: 0,
    moveSpeed: 1,
    attackType: "Melee",
    slotIndex: 0,
    aoeRadius: -1,
    damageDealt: 0,
    damageTaken: 0,
    kills: 0,
    cooldownRemaining: 0,
    alive: true,
    flags: new Set<string>(),
    ...overrides,
  };
}

describe("simulateCombat", () => {
  it("is deterministic for a given seed", () => {
    const run = () => {
      const sim = simulateCombat({
        attackerUnits: [unit("attacker", "a1"), unit("attacker", "a2")],
        defenderUnits: [unit("defender", "d1"), unit("defender", "d2")],
        seed: 1234,
        maxDurationSec: 60,
      });
      return {
        outcome: sim.outcome,
        duration: sim.durationSec,
        hp: sim.units.map((u: { instanceId: string; hp: number }) => [u.instanceId, u.hp]),
      };
    };

    expect(run()).toEqual(run());
  });

  it("declares victory when the defender is wiped", () => {
    const sim = simulateCombat({
      attackerUnits: [unit("attacker", "a1", { attack: 1000, aspd: 10 })],
      defenderUnits: [unit("defender", "d1", { hp: 50, maxHp: 50 })],
      seed: 1,
      maxDurationSec: 10,
    });

    expect(sim.outcome).toEqual({ outcome: "Victory", outcomeReason: "enemy_wiped" });
    expect(sim.timedOut).toBe(false);
    const defender = sim.units.find((u: { instanceId: string }) => u.instanceId === "d1");
    expect(defender?.alive).toBe(false);
    expect(defender?.hp).toBe(0);
  });

  it("declares defeat when the attacker is wiped", () => {
    const sim = simulateCombat({
      attackerUnits: [unit("attacker", "a1", { hp: 20, maxHp: 20, attack: 1 })],
      defenderUnits: [unit("defender", "d1", { attack: 1000, aspd: 10 })],
      seed: 2,
      maxDurationSec: 10,
    });

    expect(sim.outcome).toEqual({ outcome: "Defeat", outcomeReason: "attacker_wiped" });
  });

  it("times out into a draw when nobody can attack", () => {
    const sim = simulateCombat({
      attackerUnits: [unit("attacker", "a1", { flags: new Set(["canNotAttack"]) })],
      defenderUnits: [unit("defender", "d1", { flags: new Set(["canNotAttack"]) })],
      seed: 3,
      maxDurationSec: 1,
    });

    expect(sim.timedOut).toBe(true);
    expect(sim.durationSec).toBe(1);
    expect(sim.outcome).toEqual({ outcome: "Draw", outcomeReason: "timeout_tie" });
  });

  it("applies AoE splash to another unit in the same lane", () => {
    const sim = simulateCombat({
      attackerUnits: [unit("attacker", "a1", { attack: 1000, aspd: 10, aoeRadius: 1 })],
      defenderUnits: [
        unit("defender", "d1", { hp: 50, maxHp: 50 }),
        unit("defender", "d2", { hp: 100, maxHp: 100 }),
      ],
      seed: 4,
      maxDurationSec: 10,
    });

    const defender2 = sim.units.find((u: { instanceId: string }) => u.instanceId === "d2");
    expect(defender2?.alive).toBe(false);
    const attacker = sim.units.find((u: { instanceId: string }) => u.instanceId === "a1");
    expect(attacker?.kills).toBe(2);
  });

  it("accounts damage so hp + damageDealt adds up to the initial pool", () => {
    const sim = simulateCombat({
      attackerUnits: [unit("attacker", "a1", { attack: 30, aspd: 1 })],
      defenderUnits: [unit("defender", "d1", { hp: 100, maxHp: 100, attack: 1 })],
      seed: 5,
      maxDurationSec: 5,
    });

    const defender = sim.units.find((u: { instanceId: string }) => u.instanceId === "d1");
    expect(defender.hp + defender.damageTaken).toBe(100);
    expect(defender.damageTaken).toBeGreaterThan(0);
  });
});
