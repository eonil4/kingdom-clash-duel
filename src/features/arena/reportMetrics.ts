import type { CombatReportCounters, DamageContribution, UnitTemplateId } from "@/types/arena";

export function emptyReportCounters(): CombatReportCounters {
  return {
    playerHeroDamage: 0,
    enemyHeroDamage: 0,
    playerTroopDamage: 0,
    enemyTroopDamage: 0,
    playerHeroTaken: 0,
    enemyHeroTaken: 0,
    playerTroopTaken: 0,
    enemyTroopTaken: 0,
    playerHealing: 0,
    enemyHealing: 0,
    playerCc: 0,
    enemyCc: 0,
  };
}

function isHeroArchetype(t: UnitTemplateId): boolean {
  return t === "champion";
}

/** Merge one strike into hero/troop damage, damage taken, and crude CC from mages. */
export function mergeReportCounters(prev: CombatReportCounters, c: DamageContribution | null): CombatReportCounters {
  if (!c) return prev;
  const next = { ...prev };

  if (c.attackerSide === "player") {
    if (isHeroArchetype(c.attackerTemplateId)) next.playerHeroDamage += c.amount;
    else next.playerTroopDamage += c.amount;
  } else if (c.attackerSide === "enemy") {
    if (isHeroArchetype(c.attackerTemplateId)) next.enemyHeroDamage += c.amount;
    else next.enemyTroopDamage += c.amount;
  }

  if (c.targetSide === "player") {
    if (isHeroArchetype(c.targetTemplateId)) next.playerHeroTaken += c.amount;
    else next.playerTroopTaken += c.amount;
  } else if (c.targetSide === "enemy") {
    if (isHeroArchetype(c.targetTemplateId)) next.enemyHeroTaken += c.amount;
    else next.enemyTroopTaken += c.amount;
  }

  if (c.attackerTemplateId === "runecaller") {
    const cc = Math.max(1, Math.floor(c.amount * 0.35));
    if (c.attackerSide === "player") next.playerCc += cc;
    else next.enemyCc += cc;
  }

  return next;
}

/** Map tiny simulator totals to headline magnitudes similar to in-game reports. */
export function reportDisplayScale(totalDamageDealt: number, targetTotal = 12.3e6): number {
  if (totalDamageDealt <= 0) return 1;
  return targetTotal / totalDamageDealt;
}

export function scaleReportValue(raw: number, scale: number): number {
  return Math.round(raw * scale);
}

/** Troop “healing/support” row: synthetic from activity so the report isn’t empty (practice UX). */
export function troopSupportDisplay(playerTroopDmg: number, playerTroopTaken: number, scale: number): number {
  const raw = playerTroopDmg * 0.12 + playerTroopTaken * 0.06;
  return Math.round(raw * scale);
}
