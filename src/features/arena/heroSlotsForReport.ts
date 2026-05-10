import type { GearLevels } from "@/types/arena";
import { LANE_COUNT } from "@/types/arena";
import type { SlotSelection } from "@/features/arena/spawnUnits";

export interface HeroPreviewSlot {
  placement: number;
  level: number;
  label: string;
}

export function heroSlotsForReport(side: SlotSelection, gear: GearLevels): [HeroPreviewSlot, HeroPreviewSlot] {
  const found: HeroPreviewSlot[] = [];
  for (let i = 0; i < LANE_COUNT; i++) {
    if (side[i] === "champion") {
      const level = 6 + Math.min(10, Math.floor((gear.weapon + gear.armor) / 5)) + (i % 4);
      found.push({ placement: i + 1, level, label: "Champion" });
    }
  }
  while (found.length < 2) {
    found.push({ placement: 0, level: 0, label: "" });
  }
  return [found[0], found[1]];
}
