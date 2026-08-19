/**
 * Abstract Clan Clash combat engine (no animation).
 * Damage formula is a placeholder until APK/IL2CPP confirms the real curve.
 */

const DEFENSE_FACTOR = 0.5;
const DEFAULT_MAX_DURATION_SEC = 300;
const DT = 0.25;

/**
 * Mulberry32 PRNG for deterministic sims.
 * @param {number} seed
 */
function createRng(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Placeholder damage: max(1, attack - k * defense)
 * @param {number} attack
 * @param {number} defense
 */
export function computeDamage(attack, defense) {
  return Math.max(1, Math.round(Number(attack) - DEFENSE_FACTOR * Number(defense)));
}

/**
 * @param {object[]} units
 * @param {"attacker"|"defender"} side
 */
function living(units, side) {
  return units.filter((u) => u.side === side && u.alive && u.hp > 0);
}

/**
 * @param {object} attacker
 * @param {object[]} enemies
 * @param {() => number} rng
 */
function pickTarget(attacker, enemies, rng) {
  const candidates = enemies.filter(
    (e) => e.alive && e.hp > 0 && !e.flags.has("unTargetable") && !e.flags.has("invulnerable"),
  );
  if (candidates.length === 0) return null;

  // Prefer same slotIndex (lane-ish), then lowest hp fraction, with light RNG tie-break.
  const sameLane = candidates.filter((e) => e.slotIndex === attacker.slotIndex);
  const pool = sameLane.length > 0 ? sameLane : candidates;
  pool.sort((a, b) => {
    const fa = a.hp / a.maxHp;
    const fb = b.hp / b.maxHp;
    if (fa !== fb) return fa - fb;
    return a.instanceId.localeCompare(b.instanceId);
  });
  if (pool.length === 1) return pool[0];
  // small random among top 2 for variance
  const top = pool.slice(0, Math.min(2, pool.length));
  return top[Math.floor(rng() * top.length)];
}

/**
 * @param {object} unit
 */
function attackInterval(unit) {
  const aspd = Math.max(0.1, Number(unit.aspd) || 1);
  const cd = Math.max(0, Number(unit.attackCooldown) || 0);
  // Combine cooldown + aspd into seconds between swings
  return Math.max(0.2, (cd > 0 ? cd : 1) / aspd);
}

/**
 * @param {object} unit
 * @param {object} target
 */
function strike(unit, target) {
  if (target.flags.has("invulnerable") || target.flags.has("noDamage")) return 0;
  const dmg = computeDamage(unit.attack, target.defense);
  const applied = Math.min(target.hp, dmg);
  target.hp -= applied;
  target.damageTaken += applied;
  unit.damageDealt += applied;
  if (target.hp <= 0) {
    target.hp = 0;
    target.alive = false;
    unit.kills += 1;
  }
  return applied;
}

/**
 * @param {{ attackerUnits: object[], defenderUnits: object[], seed?: number, maxDurationSec?: number }} opts
 */
export function simulateCombat(opts) {
  const seed = Number.isFinite(opts.seed) ? Number(opts.seed) : 42;
  const maxDurationSec = Number.isFinite(opts.maxDurationSec)
    ? Number(opts.maxDurationSec)
    : DEFAULT_MAX_DURATION_SEC;
  const rng = createRng(seed);

  const units = [...opts.attackerUnits, ...opts.defenderUnits].map((u) => ({
    ...u,
    flags: u.flags instanceof Set ? new Set(u.flags) : new Set(u.flags ?? []),
  }));

  for (const u of units) {
    u.cooldownRemaining = rng() * attackInterval(u) * 0.5;
  }

  let t = 0;
  let timedOut = false;

  while (t < maxDurationSec) {
    const atkAlive = living(units, "attacker");
    const defAlive = living(units, "defender");
    if (atkAlive.length === 0 || defAlive.length === 0) break;

    for (const unit of units) {
      if (!unit.alive || unit.hp <= 0) continue;
      if (unit.flags.has("canNotAttack") || unit.flags.has("aiDisabled")) continue;

      unit.cooldownRemaining -= DT;
      if (unit.cooldownRemaining > 0) continue;

      const liveEnemies = living(units, unit.side === "attacker" ? "defender" : "attacker");
      const target = pickTarget(unit, liveEnemies, rng);
      if (!target) continue;

      strike(unit, target);
      unit.cooldownRemaining = attackInterval(unit);

      // Simple AoE: if aoeRadius > 0, splash partial damage to one extra nearby (same lane)
      if (unit.aoeRadius > 0) {
        const splashPool = liveEnemies.filter(
          (e) => e.alive && e.instanceId !== target.instanceId && e.slotIndex === target.slotIndex,
        );
        if (splashPool.length > 0) {
          const splashTarget = splashPool[0];
          const splash = Math.max(1, Math.floor(computeDamage(unit.attack, splashTarget.defense) * 0.35));
          const applied = Math.min(splashTarget.hp, splash);
          splashTarget.hp -= applied;
          splashTarget.damageTaken += applied;
          unit.damageDealt += applied;
          if (splashTarget.hp <= 0) {
            splashTarget.hp = 0;
            splashTarget.alive = false;
            unit.kills += 1;
          }
        }
      }
    }

    t += DT;
    if (t >= maxDurationSec) {
      timedOut = true;
      break;
    }
  }

  const attackerLiving = living(units, "attacker");
  const defenderLiving = living(units, "defender");
  const attackerAll = units.filter((u) => u.side === "attacker");
  const defenderAll = units.filter((u) => u.side === "defender");

  const outcome = decideOutcome(attackerLiving, defenderLiving, attackerAll, defenderAll, timedOut);

  return {
    units,
    durationSec: Math.min(t, maxDurationSec),
    timedOut,
    outcome,
  };
}

/**
 * Hypothesis win rule (see clan_clash-battle.md §6.2).
 */
function decideOutcome(atkLiving, defLiving, atkAll, defAll, timedOut) {
  if (defLiving.length === 0 && atkLiving.length > 0) {
    return { outcome: "Victory", outcomeReason: "enemy_wiped" };
  }
  if (atkLiving.length === 0 && defLiving.length > 0) {
    return { outcome: "Defeat", outcomeReason: "attacker_wiped" };
  }
  if (atkLiving.length === 0 && defLiving.length === 0) {
    return { outcome: "Draw", outcomeReason: "mutual_wipe" };
  }

  // Timeout / unfinished: living units, then HP, then damage dealt
  if (atkLiving.length !== defLiving.length) {
    return {
      outcome: atkLiving.length > defLiving.length ? "Victory" : "Defeat",
      outcomeReason: timedOut ? "timeout_living_units" : "living_units",
    };
  }

  const atkHp = atkLiving.reduce((s, u) => s + u.hp, 0);
  const defHp = defLiving.reduce((s, u) => s + u.hp, 0);
  if (atkHp !== defHp) {
    return {
      outcome: atkHp > defHp ? "Victory" : "Defeat",
      outcomeReason: timedOut ? "timeout_hp" : "hp_remaining",
    };
  }

  const atkDmg = atkAll.reduce((s, u) => s + u.damageDealt, 0);
  const defDmg = defAll.reduce((s, u) => s + u.damageDealt, 0);
  if (atkDmg !== defDmg) {
    return {
      outcome: atkDmg > defDmg ? "Victory" : "Defeat",
      outcomeReason: timedOut ? "timeout_damage" : "damage_dealt",
    };
  }

  return { outcome: "Draw", outcomeReason: timedOut ? "timeout_tie" : "tie" };
}

/**
 * @param {object[]} units
 * @param {"attacker"|"defender"} side
 */
export function summarizeSide(units, side) {
  const sideUnits = units.filter((u) => u.side === side);
  const livingUnits = sideUnits.filter((u) => u.alive && u.hp > 0);
  const damageDealt = sideUnits.reduce((s, u) => s + u.damageDealt, 0);
  const damageTaken = sideUnits.reduce((s, u) => s + u.damageTaken, 0);
  const unitsKilled = sideUnits.reduce((s, u) => s + u.kills, 0);
  const unitsLost = sideUnits.filter((u) => !u.alive || u.hp <= 0).length;
  const hpRemaining = livingUnits.reduce((s, u) => s + u.hp, 0);
  const heroDamage = sideUnits.filter((u) => u.isHero).reduce((s, u) => s + u.damageDealt, 0);
  const troopDamage = sideUnits.filter((u) => !u.isHero).reduce((s, u) => s + u.damageDealt, 0);

  return {
    livingUnits: livingUnits.length,
    totalUnits: sideUnits.length,
    hpRemaining,
    damageDealt,
    damageTaken,
    unitsKilled,
    unitsLost,
    heroDamage,
    troopDamage,
  };
}
