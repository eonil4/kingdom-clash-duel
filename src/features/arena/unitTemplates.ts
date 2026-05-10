import type { UnitTemplateId } from "@/types/arena";

export const UNIT_TEMPLATES: Record<
  UnitTemplateId,
  { name: string; description: string; maxHp: number; attack: number; armor: number; speed: number }
> = {
  spearline: {
    name: "Spear line",
    description: "Shield wall — soaks hits in front columns.",
    maxHp: 118,
    attack: 15,
    armor: 9,
    speed: 4,
  },
  longbow: {
    name: "Archer wing",
    description: "Ranged pressure; softer if jumped.",
    maxHp: 72,
    attack: 26,
    armor: 2,
    speed: 7,
  },
  runecaller: {
    name: "Battle mage",
    description: "Mixed damage and tempo.",
    maxHp: 68,
    attack: 24,
    armor: 4,
    speed: 6,
  },
  colossus: {
    name: "Siege brute",
    description: "Huge HP pool, slow but steady.",
    maxHp: 195,
    attack: 17,
    armor: 11,
    speed: 2,
  },
  champion: {
    name: "Champion",
    description: "Hero-style spike threat and initiative.",
    maxHp: 95,
    attack: 32,
    armor: 5,
    speed: 10,
  },
};

export const TEMPLATE_IDS: UnitTemplateId[] = ["spearline", "longbow", "runecaller", "colossus", "champion"];
