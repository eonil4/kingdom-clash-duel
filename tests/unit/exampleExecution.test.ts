import { describe, expect, it } from "vitest";
import { advanceOneStep, MAX_BATTLE_ROUNDS } from "@/features/arena/battleEngine";
import { resetInstanceIdCounter, spawnSide } from "@/features/arena/spawnUnits";
import type { SlotSelection } from "@/features/arena/spawnUnits";

/**
 * Console demo of one full battle (run: `pnpm example:run`).
 * Output appears in the terminal when Vitest runs this file.
 */
describe("example execution (terminal demo)", () => {
  it("prints a full battle summary to stdout", () => {
    const playerSlots: SlotSelection = [
      "spearline",
      "spearline",
      "longbow",
      "runecaller",
      "colossus",
      "longbow",
      "champion",
    ];
    const enemySlots: SlotSelection = [
      "spearline",
      "spearline",
      "spearline",
      "runecaller",
      "runecaller",
      "longbow",
      "champion",
    ];
    const gear = { weapon: 19, armor: 20 };

    resetInstanceIdCounter();
    let playerUnits = spawnSide("player", playerSlots, gear);
    let enemyUnits = spawnSide("enemy", enemySlots, { weapon: 17, armor: 18 });

    let steps = 0;
    let totalDamage = 0;
    const damageById: Record<string, number> = {};
    const logLines: string[] = [];
    let winner: "player" | "enemy" | null = null;

    for (let i = 0; i < MAX_BATTLE_ROUNDS && !winner; i += 1) {
      const step = advanceOneStep(playerUnits, enemyUnits);
      playerUnits = step.playerUnits;
      enemyUnits = step.enemyUnits;
      steps += step.roundIncrement;
      if (step.logEntry) logLines.push(step.logEntry.text);
      if (step.damageContribution) {
        const id = step.damageContribution.attackerInstanceId;
        damageById[id] = (damageById[id] ?? 0) + step.damageContribution.amount;
        totalDamage += step.damageContribution.amount;
      }
      winner = step.winner;
      if (winner) break;
    }

    let topId = "";
    let topD = 0;
    for (const [id, d] of Object.entries(damageById)) {
      if (d > topD) {
        topD = d;
        topId = id;
      }
    }
    const topName = [...playerUnits, ...enemyUnits].find((u) => u.instanceId === topId)?.name ?? topId;

    console.log(`
========== Example battle execution ==========
Preset: 7 columns, same gear as /examples/scenarios.json "mixed-7col"
Steps:  ${steps}
Winner: ${winner ?? "draw / limit"}
Total damage dealt: ${totalDamage.toLocaleString("en-US")}
Top damager: ${topName} (${topD.toLocaleString("en-US")})

--- First 6 log lines ---
${logLines.slice(0, 6).join("\n")}

--- Last 4 log lines ---
${logLines.slice(-4).join("\n")}
=============================================
`);

    expect(winner).not.toBeNull();
    expect(totalDamage).toBeGreaterThan(0);
  });
});
