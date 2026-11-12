/**
 * Extract clan member name + power from formation screenshots via local LM Studio (vision model).
 *
 * Targets the `userPrompt.image.clan` entries in `config/llm.json`:
 *  - extractClanDataFromScreenshot(imagePath, options)
 *  - extractClanDataFromNamePowerCrops(imagePath, options)
 *
 * Env:
 *   LLM_HOST       — default http://127.0.0.1:1234
 *   LLM_MODEL      — default config/llm.json defaultModel
 *   LM_API_TOKEN   — optional Bearer token
 *   LLM_SKIP_CACHE_CLEAR — set 1 to skip prediction-cache clearing
 *
 * Shared transport/config/crop/persistence lives in `vision-client.mjs`.
 */
import {
  createVisionTarget,
  cropRoiToPngBuffer,
  isInvokedDirectly,
  loadLlmConfig,
  parseJsonFromLlm as parseJson,
  parsePowerValue,
  runVisionExtractCli,
} from "./vision-client.mjs";

const _llmConfig = loadLlmConfig();

export const DEFAULT_LLM_MODEL = _llmConfig.defaultModel ?? "qwen/qwen3-vl-4b";

const VISION_MODEL_HINTS = ["qwen3-vl", "gemma3", "vision", "vl"];

const SYSTEM_PROMPT = `You extract structured data from Kingdom Clash formation screenshots.
Reply with JSON only — no markdown, no prose outside the JSON object.`;

const DEFAULT_NAME_CROP = {
  prompt: `This image is a cropped CLAN MEMBER NAME window from a Kingdom Clash formation screenshot (text may include symbols like +, |, _, brackets).
Extract:
- name: exact string as shown, including symbols; preserve case.
- nameLatin: Latin transliteration (keep symbols).
- language: language of the name text.

Return ONLY this JSON shape:

{
  "name": "<exact_name>",
  "nameLatin": "<transliteration>",
  "language": "<detected_language>"
}`,
  roi: { x: 500, y: 57, width: 400, height: 48 },
};

const DEFAULT_POWER_CROP = {
  prompt: `This image is a cropped CLAN MEMBER POWER window from a Kingdom Clash formation screenshot (digits only).

Extract:
- power: the combat power as a single continuous positive integer (NO spaces or commas).

Return ONLY this JSON shape:

{
  "power": <integer>
}`,
  roi: { x: 360, y: 122, width: 180, height: 36 },
};

/**
 * @param {string} text
 */
export function parseJsonFromLlm(text) {
  return parseJson(text);
}

/**
 * @param {unknown} data
 * @returns {{ power: number, name: string, language?: string, nameLatin?: string }}
 */
export function normalizeClanExtraction(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("LLM JSON must be an object.");
  }

  let name = typeof data.name === "string" ? data.name.trim() : "";
  if (!name) name = "UNKNOWN";

  const out = { power: parsePowerValue(data.power), name };
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
 * @returns {{ name: string, language?: string, nameLatin?: string }}
 */
export function normalizeClanNameExtraction(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("LLM name JSON must be an object.");
  }
  let name = typeof data.name === "string" ? data.name.trim() : "";
  if (!name) name = "UNKNOWN";
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
export function normalizeClanPowerExtraction(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("LLM power JSON must be an object.");
  }
  return { power: parsePowerValue(data.power) };
}

const target = createVisionTarget({
  targetKey: "clan",
  defaultModelFallback: "qwen/qwen3-vl-4b",
  visionModelHints: VISION_MODEL_HINTS,
  systemPromptFallback: SYSTEM_PROMPT,
  // Legacy behaviour: with no `userPrompt.image.prompt`, a name-crop prompt is used for the
  // full screenshot. Kept as-is until P2-6 is addressed.
  fullPromptFallback: DEFAULT_NAME_CROP.prompt,
  nameFallback: DEFAULT_NAME_CROP,
  powerFallback: DEFAULT_POWER_CROP,
  normalizeFull: normalizeClanExtraction,
  normalizeName: normalizeClanNameExtraction,
  normalizePower: normalizeClanPowerExtraction,
});

export const resolveUserPromptImage = target.resolveUserPromptImage;

/** @param {"name" | "power"} kind */
export const resolveClanCropConfig = target.resolveCropConfig;

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
export function cropClanRoiToPngBuffer(imagePath, roi) {
  return cropRoiToPngBuffer(imagePath, roi);
}

/**
 * @param {string} imagePath
 * @param {{ host?: string, model?: string, timeoutMs?: number, clearCacheBeforeEachCall?: boolean }} [options]
 */
export const extractClanDataFromScreenshot = target.extractFromScreenshot;

/**
 * @param {string} imagePath
 * @param {{ host?: string, model?: string, timeoutMs?: number, clearCacheBeforeEachCall?: boolean }} [options]
 */
export const extractClanDataFromNamePowerCrops = target.extractFromNamePowerCrops;

if (isInvokedDirectly(import.meta.url)) {
  runVisionExtractCli({
    scriptName: "llm-formation-extract.mjs",
    target,
  }).catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
