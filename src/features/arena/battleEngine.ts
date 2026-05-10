import type { BattleLogEntry, DamageContribution, UnitInstance } from "@/types/arena";
import { LANE_COUNT } from "@/types/arena";

export const MAX_BATTLE_ROUNDS = 600;

function aliveInSlot(units: UnitInstance[], slot: number): UnitInstance | undefined {
  return units.find((u) => u.slot === slot && u.hp > 0);
}

function pickTarget(attacker: UnitInstance, enemies: UnitInstance[]): UnitInstance | undefined {
  const same = aliveInSlot(enemies, attacker.slot);
  if (same) return same;
  for (let s = 0; s < LANE_COUNT; s += 1) {
    const t = aliveInSlot(enemies, s);
    if (t) return t;
  }
  return undefined;
}

function sortByActOrder(units: UnitInstance[]): UnitInstance[] {
  return [...units].filter((u) => u.hp > 0).sort((a, b) => b.speed - a.speed || a.instanceId.localeCompare(b.instanceId));
}

export function damageAmount(attack: number, armor: number): number {
  return Math.max(1, attack - armor);
}

export interface StepResult {
  playerUnits: UnitInstance[];
  enemyUnits: UnitInstance[];
  logEntry: BattleLogEntry | null;
  roundIncrement: number;
  winner: "player" | "enemy" | null;
  damageContribution: DamageContribution | null;
}

let logSeq = 0;
function nextLogId(): string {
  logSeq += 1;
  return `log-${logSeq}`;
}

/** One combat action: next living unit in initiative acts. */
export function advanceOneStep(playerUnits: UnitInstance[], enemyUnits: UnitInstance[]): StepResult {
  const all = [...playerUnits, ...enemyUnits].filter((u) => u.hp > 0);
  if (all.length === 0) {
    return {
      playerUnits,
      enemyUnits,
      logEntry: null,
      roundIncrement: 0,
      winner: null,
      damageContribution: null,
    };
  }

  const pAlive = playerUnits.some((u) => u.hp > 0);
  const eAlive = enemyUnits.some((u) => u.hp > 0);
  if (!pAlive) {
    return {
      playerUnits,
      enemyUnits,
      logEntry: null,
      roundIncrement: 0,
      winner: "enemy",
      damageContribution: null,
    };
  }
  if (!eAlive) {
    return {
      playerUnits,
      enemyUnits,
      logEntry: null,
      roundIncrement: 0,
      winner: "player",
      damageContribution: null,
    };
  }

  const order = sortByActOrder(all);
  const attacker = order[0];
  const enemies = attacker.side === "player" ? enemyUnits : playerUnits;
  const target = pickTarget(attacker, enemies);
  if (!target) {
    return {
      playerUnits,
      enemyUnits,
      logEntry: null,
      roundIncrement: 0,
      winner: attacker.side === "player" ? "player" : "enemy",
      damageContribution: null,
    };
  }

  const dmg = damageAmount(attacker.attack, target.armor);
  const nextTarget: UnitInstance = { ...target, hp: Math.max(0, target.hp - dmg) };

  const patchedPlayer =
    attacker.side === "player"
      ? playerUnits
      : playerUnits.map((u) => (u.instanceId === nextTarget.instanceId ? nextTarget : u));
  const patchedEnemy =
    attacker.side === "player"
      ? enemyUnits.map((u) => (u.instanceId === nextTarget.instanceId ? nextTarget : u))
      : enemyUnits;

  const verb = attacker.side === "player" ? "Your" : "Enemy";
  const text = `${verb} ${attacker.name} (column ${attacker.slot + 1}) hits ${target.name} for ${dmg}. (${nextTarget.hp}/${nextTarget.maxHp} HP)`;

  const pOk = patchedPlayer.some((u) => u.hp > 0);
  const eOk = patchedEnemy.some((u) => u.hp > 0);
  let winner: "player" | "enemy" | null = null;
  if (!pOk) winner = "enemy";
  else if (!eOk) winner = "player";

  const damageContribution: DamageContribution = {
    attackerInstanceId: attacker.instanceId,
    attackerName: attacker.name,
    attackerTemplateId: attacker.templateId,
    attackerSide: attacker.side,
    targetInstanceId: target.instanceId,
    targetTemplateId: target.templateId,
    targetSide: target.side,
    amount: dmg,
  };

  return {
    playerUnits: patchedPlayer,
    enemyUnits: patchedEnemy,
    logEntry: { id: nextLogId(), text },
    roundIncrement: 1,
    winner,
    damageContribution,
  };
}
