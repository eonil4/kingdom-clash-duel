import type { GearLevels } from "@/types/arena";
import { LANE_COUNT } from "@/types/arena";
import { UNIT_TEMPLATES } from "@/features/arena/unitTemplates";
import type { SlotSelection } from "@/features/arena/spawnUnits";

function gearMultiplier(gear: GearLevels): number {
  return 1 + gear.weapon * 0.012 + gear.armor * 0.01;
}

/** Display-only “army power” in the ballpark of typical PvP headers (tunable). */
export function estimateArmyPower(slots: SlotSelection, gear: GearLevels): number {
  let sum = 0;
  for (let i = 0; i < LANE_COUNT; i += 1) {
    const tid = slots[i];
    if (!tid) continue;
    const u = UNIT_TEMPLATES[tid];
    sum += u.maxHp * 2000 + u.attack * 25000 + u.armor * 20000 + u.speed * 8000;
  }
  return Math.floor(sum * gearMultiplier(gear));
}

export function countPlacedUnits(slots: SlotSelection): number {
  let n = 0;
  for (let i = 0; i < LANE_COUNT; i += 1) {
    if (slots[i]) n += 1;
  }
  return n;
}
