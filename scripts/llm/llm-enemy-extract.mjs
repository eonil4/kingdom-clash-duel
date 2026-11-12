/**
 * Extract opponent name + power from arena screenshots via local LM Studio (vision model).
 *
 * Env:
 *   LLM_HOST       — default http://127.0.0.1:1234
 *   LLM_MODEL      — default config/llm.json defaultModel
 *   LM_API_TOKEN   — optional Bearer token
 *   LLM_SKIP_CACHE_CLEAR — set 1 to skip prediction-cache clearing
 *
 * config/llm.json `userPrompt` may be a string (legacy) or an object:
 *   - image                 — string prompt, or { prompt, enemy }
 *   - image.enemy.name      — { prompt, roi } for name crop
 *   - image.enemy.power     — { prompt, roi } for power crop
 *
 * Shared transport/config/crop/persistence lives in `vision-client.mjs`.
 */
import {
  createVisionTarget,
  cropRoiToPngBuffer,
  isInvokedDirectly,
  loadLlmConfig,
  parseJsonFromLlm,
  parsePowerValue,
  runVisionExtractCli,
} from "./vision-client.mjs";

const _llmConfig = loadLlmConfig();

export const DEFAULT_LLM_MODEL = _llmConfig.defaultModel ?? "qwen/qwen3-vl-8b";

const VISION_MODEL_HINTS = [
  "gemma-4",
  "qwen2.5-vl",
  "qwen2.5vl",
  "qwen3-vl",
  "gemma3",
  "vision",
  "vl",
  "llava",
  "moondream",
  "minicpm-v",
  "bakllava",
  "llama3.2",
];

const SYSTEM_PROMPT = `You extract structured data from Kingdom Clash arena screenshots.
Reply with JSON only — no markdown, no prose outside the JSON object.`;

const DEFAULT_USER_PROMPT_IMAGE = `You are an expert data extraction engine specializing in complex video game UIs. Your single task is to analyze the image and extract the primary combat statistics for the OPPONENT (the enemy).

CRITICAL INSTRUCTION: Focus ONLY on the dedicated opponent status panel located on the right side of the screen. This panel has a specific visual structure, usually containing three elements in order: [Name] -> [Unit Count/Icon] -> [Total Power Score].

You must identify the **TOTAL POWER SCORE**, which is always the most prominent large number displayed at the bottom of this status grouping.

Extract these fields with extreme precision:
1. Opponent Display Name: The text label (e.g., 'Hun') in the panel.
2. Opponent Power Score: This must be the final, single, combined integer power score shown on the status card. Ignore the unit count and any other numbers like level or individual stats. Return it as a continuous positive integer with NO spaces, commas, or separators (e.g., 575150).
3. Language: The language of the name text in the UI.

Return ONLY this JSON shape. Do not include any preceding text, explanation, or markdown outside of the JSON object itself.

{
  "power": <positive integer, 6-8 digits>,
  "name": "<name exactly as shown in the game UI>",
  "language": "<language of the name text, e.g. Korean, Russian, English>",
  "englishName": "<Latin/English transliteration for filenames; omit if name is already Latin>"
}`;

const DEFAULT_NAME_CROP = {
  prompt: `This image is a cropped OPPONENT NAME window. Extract name, nameLatin, and language. Return ONLY JSON: {"name":"...","nameLatin":"...","language":"..."}`,
  roi: { x: 486, y: 118, width: 290, height: 36 },
};

const DEFAULT_POWER_CROP = {
  prompt: `This image is a cropped OPPONENT POWER window. Extract power as a positive integer. Return ONLY JSON: {"power": <integer>}`,
  roi: { x: 666, y: 234, width: 162, height: 24 },
};

/**
 * @param {string} text
 */
export function parseEnemyJsonFromLlm(text) {
  return parseJsonFromLlm(text);
}

/**
 * @param {unknown} data
 * @returns {{ power: number, name: string, language?: string, nameLatin?: string, englishName?: string }}
 */
export function normalizeEnemyExtraction(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("LLM JSON must be an object.");
  }

  const name = typeof data.name === "string" ? data.name.trim() : "";
  if (!name) throw new Error('LLM JSON missing non-empty "name".');

  const out = { power: parsePowerValue(data.power), name };
  if (typeof data.language === "string" && data.language.trim()) {
    out.language = data.language.trim();
  }
  if (typeof data.nameLatin === "string" && data.nameLatin.trim()) {
    out.nameLatin = data.nameLatin.trim();
  }
  if (typeof data.englishName === "string" && data.englishName.trim()) {
    out.englishName = data.englishName.trim();
  }
  return out;
}

/**
 * @param {unknown} data
 * @returns {{ name: string, language?: string, nameLatin?: string }}
 */
export function normalizeEnemyNameExtraction(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("LLM name JSON must be an object.");
  }
  const name = typeof data.name === "string" ? data.name.trim() : "";
  if (!name) throw new Error('LLM name JSON missing non-empty "name".');
  const out = { name };
  if (typeof data.language === "string" && data.language.trim()) {
    out.language = data.language.trim();
  }
  if (typeof data.nameLatin === "string" && data.nameLatin.trim()) {
    out.nameLatin = data.nameLatin.trim();
  }
  return out;
}

/**
 * @param {unknown} data
 * @returns {{ power: number }}
 */
export function normalizeEnemyPowerExtraction(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("LLM power JSON must be an object.");
  }
  return { power: parsePowerValue(data.power) };
}

const target = createVisionTarget({
  targetKey: "enemy",
  defaultModelFallback: "qwen/qwen3-vl-8b",
  visionModelHints: VISION_MODEL_HINTS,
  systemPromptFallback: SYSTEM_PROMPT,
  fullPromptFallback: DEFAULT_USER_PROMPT_IMAGE,
  nameFallback: DEFAULT_NAME_CROP,
  powerFallback: DEFAULT_POWER_CROP,
  normalizeFull: normalizeEnemyExtraction,
  normalizeName: normalizeEnemyNameExtraction,
  normalizePower: normalizeEnemyPowerExtraction,
});

export const resolveUserPromptImage = target.resolveUserPromptImage;

/** @param {"name" | "power"} kind */
export const resolveEnemyCropConfig = target.resolveCropConfig;

/**
 * @param {string} host
 * @param {string | undefined} [preferred]
 */
export function resolveVisionModel(host, preferred) {
  return target.resolveModel(host, preferred);
}

/**
 * @param {string} imagePath
 * @param {{ x: number, y: number, width: number, height: number }} roi
 */
export function cropEnemyRoiToPngBuffer(imagePath, roi) {
  return cropRoiToPngBuffer(imagePath, roi);
}

/**
 * @param {string} imagePath
 * @param {{ host?: string, model?: string, timeoutMs?: number, clearCacheBeforeEachCall?: boolean }} [options]
 */
export const extractEnemyDataFromScreenshot = target.extractFromScreenshot;

/**
 * @param {string} imagePath
 * @param {{ host?: string, model?: string, timeoutMs?: number, clearCacheBeforeEachCall?: boolean }} [options]
 */
export const extractEnemyDataFromNamePowerCrops = target.extractFromNamePowerCrops;

if (isInvokedDirectly(import.meta.url)) {
  runVisionExtractCli({
    scriptName: "llm-enemy-extract.mjs",
    target,
    logPerFolder: true,
  }).catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
