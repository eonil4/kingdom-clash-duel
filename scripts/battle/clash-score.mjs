/**
 * Clan Clash points / token estimates (placeholder weights until RE confirms).
 */

/**
 * Placeholder: points from attacker power, enemy power, and units defeated.
 * @param {{
 *   attackerPower: number,
 *   defenderPower: number,
 *   unitsDefeated: number,
 *   outcome: string,
 *   clanConstants: { pvpClashPointToTokenRate?: number, pvpClashTokenBattleLimit?: number }
 * }} args
 */
export function estimateClashScore(args) {
  const rate = Number(args.clanConstants?.pvpClashPointToTokenRate) || 0.00037;
  const limit = Number(args.clanConstants?.pvpClashTokenBattleLimit) || 2000;

  const w1 = 0.00002;
  const w2 = 0.00001;
  const w3 = 50;
  const outcomeMult =
    args.outcome === "Victory" ? 1.0 : args.outcome === "Draw" ? 0.5 : 0.35;

  const pointsEstimate = Math.max(
    0,
    Math.round(
      outcomeMult *
        (w1 * args.attackerPower + w2 * args.defenderPower + w3 * args.unitsDefeated),
    ),
  );

  const tokenRaw = pointsEstimate * rate;
  const tokenEstimate = Math.min(limit, Math.round(tokenRaw));

  return {
    pointsEstimate,
    pointsFormula: "placeholder: outcomeMult*(0.00002*atkPower + 0.00001*defPower + 50*kills)",
    tokenEstimate,
    tokenRate: rate,
    tokenBattleLimit: limit,
    components: {
      attackerPower: args.attackerPower,
      defenderPower: args.defenderPower,
      unitsDefeated: args.unitsDefeated,
      outcomeMult,
    },
  };
}
