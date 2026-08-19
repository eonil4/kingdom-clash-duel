import { describe, expect, it } from "vitest";
import { computeDamage } from "../../scripts/battle/combat-engine.mjs";
import { estimateClashScore } from "../../scripts/battle/clash-score.mjs";

describe("computeDamage", () => {
  it("floors at 1", () => {
    expect(computeDamage(5, 100)).toBe(1);
  });

  it("applies defense factor 0.5", () => {
    expect(computeDamage(100, 40)).toBe(80);
  });
});

describe("estimateClashScore", () => {
  it("applies token rate and limit", () => {
    const score = estimateClashScore({
      attackerPower: 1_000_000,
      defenderPower: 800_000,
      unitsDefeated: 20,
      outcome: "Victory",
      clanConstants: { pvpClashPointToTokenRate: 0.00037, pvpClashTokenBattleLimit: 2000 },
    });
    expect(score.pointsEstimate).toBeGreaterThan(0);
    expect(score.tokenEstimate).toBeLessThanOrEqual(2000);
    expect(score.tokenRate).toBe(0.00037);
  });
});
