/**
 * Resolve ArmyInput JSON → spawned UnitInstance[] using APK config tables.
 */

/**
 * @typedef {"attacker" | "defender"} Side
 */

/**
 * @param {import("./load-apk-config.mjs").loadApkBattleConfig extends Function ? any : never} config
 * @param {object} armyInput
 * @param {Side} side
 */
export function resolveArmy(config, armyInput, side) {
  if (!armyInput || typeof armyInput !== "object") {
    throw new Error(`Invalid army input for ${side}`);
  }
  const slots = Array.isArray(armyInput.slots) ? armyInput.slots : [];
  if (slots.length === 0) {
    throw new Error(`Army ${side} has no slots`);
  }

  /** @type {object[]} */
  const units = [];
  /** @type {object[]} */
  const cards = [];
  let seq = 0;

  const sorted = [...slots].sort(
    (a, b) => (Number(a.slotIndex) || 0) - (Number(b.slotIndex) || 0),
  );

  for (const slot of sorted) {
    const kind = slot.kind === "hero" ? "hero" : "troop";
    if (kind === "troop") {
      const resolved = resolveTroopCard(config, slot, side, () => {
        seq += 1;
        return seq;
      });
      cards.push(resolved.card);
      units.push(...resolved.units);
    } else {
      const resolved = resolveHeroCard(config, slot, side, () => {
        seq += 1;
        return seq;
      });
      cards.push(resolved.card);
      units.push(...resolved.units);
    }
  }

  const armyPower = cards.reduce((sum, c) => sum + (c.power || 0), 0);
  return {
    playerId: String(armyInput.playerId ?? side),
    displayName: String(armyInput.displayName ?? armyInput.playerId ?? side),
    totalPowerHint:
      typeof armyInput.totalPowerHint === "number" ? armyInput.totalPowerHint : undefined,
    armyPower,
    cards,
    units,
  };
}

/**
 * @param {any} config
 * @param {object} slot
 * @param {Side} side
 * @param {() => number} nextId
 */
function resolveTroopCard(config, slot, side, nextId) {
  const troopId = String(slot.troopId ?? "");
  const level = Number(slot.level);
  if (!troopId || !Number.isFinite(level) || level <= 0) {
    throw new Error(`Invalid troop slot: ${JSON.stringify(slot)}`);
  }

  const troop = config.troops[troopId];
  if (!troop) throw new Error(`Unknown troopId "${troopId}"`);

  const levelId = `${troopId}_${level}`;
  const levelRow = config.troopsLevel[levelId];
  if (!levelRow) throw new Error(`Unknown troopsLevel "${levelId}"`);

  const link = config.troopAbilityByLevel.get(levelId);
  const defaultAbilityId = link?.defaultAbilityId ?? null;
  const specialAbilityId = link?.abilityId ?? null;
  const ability = resolveAbilityStats(config, defaultAbilityId, levelRow);

  const count = Math.max(1, Number(levelRow.count) || 1);
  const pattern = levelRow.cellPatternId
    ? config.troopsSquadCellPattern[levelRow.cellPatternId]
    : undefined;

  /** @type {object[]} */
  const units = [];
  for (let i = 0; i < count; i++) {
    const id = nextId();
    units.push(
      makeUnit({
        instanceId: `${side}-t-${id}`,
        side,
        kind: "troop",
        templateId: troopId,
        levelId,
        name: String(troop.squadInfoName ?? troopId),
        factionId: troop.factionId ?? null,
        isHero: false,
        powerShare: Number(levelRow.power) / count,
        cardPower: Number(levelRow.power) || 0,
        hp: Number(levelRow.health) || 1,
        attack: ability.attack,
        defense: Number(levelRow.defense) || 0,
        aspd: ability.aspd,
        attackCooldown: ability.attackCooldown,
        attackRange: ability.attackRange,
        minAttackDistance: ability.minAttackDistance,
        moveSpeed: Number(levelRow.moveSpeed) || 1,
        attackType: ability.attackType || troop.attackType || "Melee",
        defaultAbilityId,
        specialAbilityId,
        slotIndex: Number(slot.slotIndex) || 0,
        aoeRadius: ability.aoeRadius,
        aoeAngle: ability.aoeAngle,
      }),
    );
  }

  return {
    card: {
      kind: "troop",
      troopId,
      level,
      levelId,
      power: Number(levelRow.power) || 0,
      count,
      cellPatternId: levelRow.cellPatternId ?? null,
      patternId: pattern?.patternId ?? null,
      defaultAbilityId,
      specialAbilityId,
    },
    units,
  };
}

/**
 * @param {any} config
 * @param {object} slot
 * @param {Side} side
 * @param {() => number} nextId
 */
function resolveHeroCard(config, slot, side, nextId) {
  const heroId = String(slot.heroId ?? "");
  const level = Number(slot.level);
  if (!heroId || !Number.isFinite(level) || level <= 0) {
    throw new Error(`Invalid hero slot: ${JSON.stringify(slot)}`);
  }

  const hero = config.hero[heroId];
  if (!hero) throw new Error(`Unknown heroId "${heroId}"`);

  const levelId = `${heroId}_${level}`;
  const levelRow = config.heroLevel[levelId];
  if (!levelRow) throw new Error(`Unknown heroLevel "${levelId}"`);

  const link = config.heroAbilityByLevel.get(levelId);
  const defaultAbilityId = link?.defaultAbilityId ?? null;
  const specialAbilityId = link?.abilityId ?? null;
  const ability = resolveAbilityStats(config, defaultAbilityId, levelRow);

  const gearIds = [];
  if (slot.gear && typeof slot.gear === "object") {
    const g = slot.gear;
    if (g.weapon && g.weaponLevel) {
      gearIds.push(resolveGearAbility(config, g.weapon, g.weaponLevel));
    }
    if (g.armor && g.armorLevel) {
      gearIds.push(resolveGearAbility(config, g.armor, g.armorLevel));
    }
  }

  const id = nextId();
  const unit = makeUnit({
    instanceId: `${side}-h-${id}`,
    side,
    kind: "hero",
    templateId: heroId,
    levelId,
    name: String(hero.squadInfoName ?? heroId),
    factionId: hero.factionId ?? null,
    isHero: true,
    powerShare: Number(levelRow.power) || 0,
    cardPower: Number(levelRow.power) || 0,
    hp: Number(levelRow.health) || 1,
    attack: ability.attack,
    defense: Number(levelRow.defense) || 0,
    aspd: ability.aspd,
    attackCooldown: ability.attackCooldown,
    attackRange: ability.attackRange,
    minAttackDistance: ability.minAttackDistance,
    moveSpeed: Number(levelRow.moveSpeed) || 1,
    attackType: ability.attackType || hero.attackType || "Melee",
    defaultAbilityId,
    specialAbilityId,
    slotIndex: Number(slot.slotIndex) || 0,
    aoeRadius: ability.aoeRadius,
    aoeAngle: ability.aoeAngle,
    gearAbilityIds: gearIds.filter(Boolean),
  });

  return {
    card: {
      kind: "hero",
      heroId,
      level,
      levelId,
      power: Number(levelRow.power) || 0,
      count: 1,
      defaultAbilityId,
      specialAbilityId,
      gearAbilityIds: gearIds.filter(Boolean),
    },
    units: [unit],
  };
}

/**
 * @param {any} config
 * @param {string} gearId
 * @param {number} level
 */
function resolveGearAbility(config, gearId, level) {
  const key = `${gearId}_level${level}`;
  const row = config.gearLevel[key];
  if (!row) {
    throw new Error(`Unknown gearLevel "${key}"`);
  }
  return row.abilityId ?? null;
}

/**
 * @param {any} config
 * @param {string | null} abilityId
 * @param {object} levelRow
 */
function resolveAbilityStats(config, abilityId, levelRow) {
  const row = abilityId ? config.abilityByKey.get(abilityId) : undefined;
  return {
    attack: Number(row?.attack ?? levelRow.attack) || 1,
    attackRange: Number(row?.attackRange ?? levelRow.attackRange) || 1,
    minAttackDistance: Number(row?.minAttackDistance ?? levelRow.minAttackDistance) || 0,
    aspd: Number(row?.aspd ?? levelRow.aspd) || 1,
    attackCooldown: Number(row?.attackCooldown ?? levelRow.attackCooldown) || 0,
    attackType: row?.attackType ?? undefined,
    aoeRadius: Number(row?.aoeRadius ?? levelRow.aoeRadius ?? -1),
    aoeAngle: Number(row?.aoeAngle ?? levelRow.aoeAngle ?? 0),
  };
}

/**
 * @param {object} partial
 */
function makeUnit(partial) {
  const maxHp = Math.max(1, Number(partial.hp) || 1);
  return {
    ...partial,
    hp: maxHp,
    maxHp,
    flags: new Set(),
    damageDealt: 0,
    damageTaken: 0,
    kills: 0,
    cooldownRemaining: 0,
    alive: true,
  };
}
