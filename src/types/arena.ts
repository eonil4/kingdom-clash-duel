export const LANE_COUNT = 7;

export type LaneIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** Squad archetypes inspired by typical arena compositions (original stats, not extracted data). */
export type UnitTemplateId = "spearline" | "longbow" | "runecaller" | "colossus" | "champion";

export interface UnitTemplate {
  id: UnitTemplateId;
  name: string;
  description: string;
  maxHp: number;
  attack: number;
  armor: number;
  speed: number;
}

export interface UnitInstance {
  instanceId: string;
  templateId: UnitTemplateId;
  name: string;
  slot: LaneIndex;
  side: "player" | "enemy";
  hp: number;
  maxHp: number;
  attack: number;
  armor: number;
  speed: number;
}

export interface BattleLogEntry {
  id: string;
  text: string;
}

export type BattlePhase = "idle" | "running" | "ended";

export interface DamageContribution {
  attackerInstanceId: string;
  attackerName: string;
  attackerTemplateId: UnitTemplateId;
  attackerSide: "player" | "enemy";
  targetInstanceId: string;
  targetTemplateId: UnitTemplateId;
  targetSide: "player" | "enemy";
  amount: number;
}

export interface CombatReportCounters {
  playerHeroDamage: number;
  enemyHeroDamage: number;
  playerTroopDamage: number;
  enemyTroopDamage: number;
  playerHeroTaken: number;
  enemyHeroTaken: number;
  playerTroopTaken: number;
  enemyTroopTaken: number;
  playerHealing: number;
  enemyHealing: number;
  playerCc: number;
  enemyCc: number;
}

export interface ArenaBattleState {
  phase: BattlePhase;
  round: number;
  playerUnits: UnitInstance[];
  enemyUnits: UnitInstance[];
  log: BattleLogEntry[];
  winner: "player" | "enemy" | null;
  /** Total HP damage dealt across all strikes in this battle. */
  totalDamageDealt: number;
  /** Per-unit damage dealt (for “top damager” style summary). */
  damageByAttackerId: Record<string, number>;
  reportCounters: CombatReportCounters;
}

export interface GearLevels {
  weapon: number;
  armor: number;
}
