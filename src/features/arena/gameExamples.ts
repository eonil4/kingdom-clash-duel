import type { GearLevels, UnitTemplateId } from "@/types/arena";
import { TEMPLATE_IDS } from "@/features/arena/unitTemplates";
import type { SlotSelection } from "@/features/arena/spawnUnits";
import raw from "../../../examples/scenarios.json";

function isTemplateId(s: string): s is UnitTemplateId {
  return (TEMPLATE_IDS as string[]).includes(s);
}

function asSlotSelection(arr: unknown): SlotSelection | null {
  if (!Array.isArray(arr) || arr.length !== 7) return null;
  const out: (UnitTemplateId | null)[] = [];
  for (const x of arr) {
    if (x === null || x === "") out.push(null);
    else if (typeof x === "string" && isTemplateId(x)) out.push(x);
    else return null;
  }
  return out as unknown as SlotSelection;
}

function asGear(g: unknown): GearLevels | null {
  if (!g || typeof g !== "object") return null;
  const w = (g as { weapon?: unknown }).weapon;
  const a = (g as { armor?: unknown }).armor;
  if (typeof w !== "number" || typeof a !== "number") return null;
  return { weapon: w, armor: a };
}

export interface ArenaScenarioPreset {
  id: string;
  label: string;
  playerSlots: SlotSelection;
  enemySlots: SlotSelection;
  playerGear: GearLevels;
  enemyGear: GearLevels;
}

function parsePresets(): ArenaScenarioPreset[] {
  const list = (raw as { presets?: unknown }).presets;
  if (!Array.isArray(list)) return [];
  const out: ArenaScenarioPreset[] = [];
  for (const p of list) {
    if (!p || typeof p !== "object") continue;
    const o = p as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id : "";
    const label = typeof o.label === "string" ? o.label : id;
    const ps = asSlotSelection(o.playerSlots);
    const es = asSlotSelection(o.enemySlots);
    const pg = asGear(o.playerGear);
    const eg = asGear(o.enemyGear);
    if (!id || !ps || !es || !pg || !eg) continue;
    out.push({ id, label, playerSlots: ps, enemySlots: es, playerGear: pg, enemyGear: eg });
  }
  return out;
}

export const ARENA_SCENARIO_PRESETS: ArenaScenarioPreset[] = parsePresets();
