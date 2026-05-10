import { describe, expect, it } from "vitest";
import { advanceOneStep, damageAmount } from "@/features/arena/battleEngine";
import type { UnitInstance } from "@/types/arena";

function u(partial: Partial<UnitInstance> & Pick<UnitInstance, "instanceId" | "side" | "slot">): UnitInstance {
  return {
    templateId: "longbow",
    name: "T",
    hp: 50,
    maxHp: 50,
    attack: 20,
    armor: 2,
    speed: 5,
    ...partial,
  };
}

describe("damageAmount", () => {
  it("respects armor floor at 1", () => {
    expect(damageAmount(5, 10)).toBe(1);
    expect(damageAmount(20, 3)).toBe(17);
  });
});

describe("advanceOneStep", () => {
  it("prefers same-lane target", () => {
    const playerUnits = [u({ instanceId: "p0", side: "player", slot: 0, speed: 10 })];
    const enemyUnits = [
      u({ instanceId: "e0", name: "Frontliner", side: "enemy", slot: 0, hp: 100, maxHp: 100, speed: 1 }),
      u({ instanceId: "e1", name: "Offlane", side: "enemy", slot: 1, hp: 100, maxHp: 100, speed: 1 }),
    ];
    const step = advanceOneStep(playerUnits, enemyUnits);
    expect(step.logEntry?.text).toContain("Frontliner");
    const hit = step.enemyUnits.find((x) => x.instanceId === "e0");
    expect(hit && hit.hp < 100).toBe(true);
  });

  it("declares winner when a side is wiped", () => {
    const playerUnits = [u({ instanceId: "p0", side: "player", slot: 0, speed: 10, attack: 100 })];
    const enemyUnits = [u({ instanceId: "e0", side: "enemy", slot: 0, hp: 1, maxHp: 10, speed: 1 })];
    const step = advanceOneStep(playerUnits, enemyUnits);
    expect(step.winner).toBe("player");
    expect(step.enemyUnits[0]?.hp).toBe(0);
  });

  it("attributes damage to the attacker", () => {
    const playerUnits = [u({ instanceId: "p0", name: "Striker", side: "player", slot: 0, speed: 10, attack: 30 })];
    const enemyUnits = [u({ instanceId: "e0", side: "enemy", slot: 0, hp: 50, maxHp: 50, armor: 5, speed: 1 })];
    const step = advanceOneStep(playerUnits, enemyUnits);
    expect(step.damageContribution?.attackerInstanceId).toBe("p0");
    expect(step.damageContribution?.amount).toBeGreaterThanOrEqual(1);
  });
});
