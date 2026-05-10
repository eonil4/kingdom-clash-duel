import { describe, expect, it } from "vitest";
import { emptyReportCounters, mergeReportCounters } from "@/features/arena/reportMetrics";
import type { DamageContribution } from "@/types/arena";

function strike(partial: Partial<DamageContribution>): DamageContribution {
  return {
    attackerInstanceId: "a1",
    attackerName: "A",
    attackerTemplateId: "champion",
    attackerSide: "player",
    targetInstanceId: "t1",
    targetTemplateId: "spearline",
    targetSide: "enemy",
    amount: 10,
    ...partial,
  };
}

describe("mergeReportCounters", () => {
  it("buckets champion damage as hero", () => {
    let c = emptyReportCounters();
    c = mergeReportCounters(c, strike({ amount: 5 }));
    expect(c.playerHeroDamage).toBe(5);
    expect(c.playerTroopDamage).toBe(0);
    expect(c.enemyTroopTaken).toBe(5);
  });

  it("buckets spearline damage as troop", () => {
    let c = emptyReportCounters();
    c = mergeReportCounters(
      c,
      strike({
        attackerTemplateId: "spearline",
        attackerSide: "enemy",
        targetSide: "player",
        targetTemplateId: "longbow",
        amount: 8,
      }),
    );
    expect(c.enemyTroopDamage).toBe(8);
    expect(c.playerTroopTaken).toBe(8);
  });
});
