import type { GearLevels, LaneIndex, UnitInstance, UnitTemplateId } from "@/types/arena";
import { LANE_COUNT } from "@/types/arena";
import { UNIT_TEMPLATES } from "@/features/arena/unitTemplates";

export type SlotSelection = [
  UnitTemplateId | null,
  UnitTemplateId | null,
  UnitTemplateId | null,
  UnitTemplateId | null,
  UnitTemplateId | null,
  UnitTemplateId | null,
  UnitTemplateId | null,
];

export function emptySlotSelection(): SlotSelection {
  return [null, null, null, null, null, null, null];
}

let instanceSeq = 0;
export function resetInstanceIdCounter(): void {
  instanceSeq = 0;
}

function nextInstanceId(): string {
  instanceSeq += 1;
  return `u-${instanceSeq}`;
}

const MAX_GEAR_LEVEL = 30;

function clampGear(gear: GearLevels): GearLevels {
  return {
    weapon: Math.min(MAX_GEAR_LEVEL, Math.max(0, Math.floor(gear.weapon))),
    armor: Math.min(MAX_GEAR_LEVEL, Math.max(0, Math.floor(gear.armor))),
  };
}

export function applyGearToUnits(units: UnitInstance[], gear: GearLevels): UnitInstance[] {
  const g = clampGear(gear);
  const atkBonus = Math.floor(g.weapon * 0.85);
  const armBonus = Math.floor(g.armor * 0.55);
  return units.map((u) => ({
    ...u,
    attack: u.attack + atkBonus,
    armor: u.armor + armBonus,
  }));
}

export function spawnSide(side: "player" | "enemy", slots: SlotSelection, gear: GearLevels): UnitInstance[] {
  const raw: UnitInstance[] = [];
  for (let slotIndex = 0; slotIndex < LANE_COUNT; slotIndex += 1) {
    const tid = slots[slotIndex];
    if (!tid) continue;
    const t = UNIT_TEMPLATES[tid];
    const s = slotIndex as LaneIndex;
    raw.push({
      instanceId: nextInstanceId(),
      templateId: tid,
      name: t.name,
      slot: s,
      side,
      hp: t.maxHp,
      maxHp: t.maxHp,
      attack: t.attack,
      armor: t.armor,
      speed: t.speed,
    });
  }
  return applyGearToUnits(raw, gear);
}
