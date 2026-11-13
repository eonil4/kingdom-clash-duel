/**
 * Named tunables shared across the extraction and battle code.
 * Values are the production defaults; behaviour is unchanged.
 */

/** Below this power an LLM extraction is almost certainly wrong. */
export const LOW_POWER_WARN_THRESHOLD = 444;

/** Clan/formation name picker thresholds (tesseract confidence + Latin-ratio score). */
export const CLAN_NAME_PICK = {
  minLetters: 4,
  minScore: 20,
  strongScore: 80,
  latinBonus: 25,
};

/** Upscale widths used for the OCR name crop variants. */
export const OCR_UPSCALE_WIDTHS = {
  name: 1800,
  nameWide: 2000,
  nameText: 2200,
  nameTextLine: 2400,
};

/** Padding/growth for the name crop boxes, per style. */
export const OCR_NAME_BOX_GROWTH = {
  arena: { wide: [0.15, 0.3], text: [0.03, 0.08] },
  tight: { wide: [0.03, 0.05], text: [0, 0.02], padX: 4, padY: 3 },
};

/** Placeholder battle factors (see clan_clash-battle.md). */
export const SPLASH_DAMAGE_FACTOR = 0.35;
export const CLASH_OUTCOME_MULTIPLIERS = { Victory: 1.0, Draw: 0.5, Defeat: 0.35 };
