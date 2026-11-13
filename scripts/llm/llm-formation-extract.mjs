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
import sharp from "sharp";
import { resolveRoiReference } from "../roi.mjs";

const _llmConfig = loadLlmConfig();

export const DEFAULT_LLM_MODEL = _llmConfig.defaultModel ?? "qwen/qwen3-vl-4b";

const VISION_MODEL_HINTS = ["qwen3-vl", "gemma3", "vision", "vl"];

/** Header geometry for auto-detecting the centered formation name (roiReference pixels). */
const HEADER_Y = 57;
const HEADER_HEIGHT = 48;
const HEADER_SCAN_LEFT = 40;
const HEADER_SCAN_WIDTH = 840;
const HEADER_RUN_MERGE_GAP = 6;
const NAME_CROP_PAD = 6;

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
  roi: { x: 460, y: 57, width: 400, height: 48 },
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
 * The formation header is centered text — "<back arrow> Player formation <name>" — so a
 * fixed name crop clips the clan tag on long names and includes the label tail on short
 * ones. Locate the name start from the header word runs instead.
 *
 * Returns ROI in `roiReference` coordinates, or undefined when the header is not recognised.
 * @param {string} imagePath
 * @returns {Promise<{ x: number, y: number, width: number, height: number } | undefined>}
 */
export async function detectClanNameRoi(imagePath) {
  const meta = await sharp(imagePath).metadata();
  const width = meta.width;
  const height = meta.height;
  if (!width || !height) return undefined;

  const reference = resolveRoiReference(_llmConfig) ?? { width, height };
  const sx = width / reference.width;
  const sy = height / reference.height;
  const left = Math.min(Math.round(HEADER_SCAN_LEFT * sx), width - 1);
  const top = Math.min(Math.round(HEADER_Y * sy), height - 1);
  const scanWidth = Math.max(1, Math.min(Math.round(HEADER_SCAN_WIDTH * sx), width - left));
  const scanHeight = Math.max(1, Math.min(Math.round(HEADER_HEIGHT * sy), height - top));

  const { data, info } = await sharp(imagePath)
    .extract({ left, top, width: scanWidth, height: scanHeight })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const isText = [];
  for (let x = 0; x < info.width; x++) {
    let dark = 0;
    for (let y = 0; y < info.height; y++) if (data[y * info.width + x] < 150) dark++;
    isText.push(dark >= 1);
  }

  const runs = [];
  let start = -1;
  for (let x = 0; x < isText.length; x++) {
    if (isText[x] && start < 0) start = x;
    if (!isText[x] && start >= 0) {
      runs.push([left + start, left + x - 1]);
      start = -1;
    }
  }
  if (start >= 0) runs.push([left + start, left + isText.length - 1]);

  const merged = [];
  for (const run of runs) {
    const last = merged[merged.length - 1];
    if (last && run[0] - last[1] <= HEADER_RUN_MERGE_GAP * sx) last[1] = run[1];
    else merged.push([...run]);
  }

  const runWidth = (i) => (merged[i][1] - merged[i][0]) / sx;
  const plausible =
    merged.length >= 4 &&
    merged[0][0] >= 45 * sx &&
    merged[0][1] <= 135 * sx &&
    runWidth(1) > 85 &&
    runWidth(1) < 135 &&
    runWidth(2) > 145 &&
    runWidth(2) < 205;
  if (!plausible) return undefined;

  const x = Math.round((merged[3][0] - NAME_CROP_PAD * sx) / sx);
  return {
    x: Math.max(0, x),
    y: HEADER_Y,
    width: Math.max(1, reference.width - x - NAME_CROP_PAD),
    height: HEADER_HEIGHT,
  };
}

/**
 * @param {string} imagePath
 * @param {{ host?: string, model?: string, timeoutMs?: number, clearCacheBeforeEachCall?: boolean, nameRoi?: { x: number, y: number, width: number, height: number } }} [options]
 */
export async function extractClanDataFromNamePowerCrops(imagePath, options = {}) {
  let nameRoi = options.nameRoi;
  if (!nameRoi) {
    try {
      nameRoi = await detectClanNameRoi(imagePath);
    } catch {
      nameRoi = undefined;
    }
  }
  return target.extractFromNamePowerCrops(imagePath, nameRoi ? { ...options, nameRoi } : options);
}

if (isInvokedDirectly(import.meta.url)) {
  runVisionExtractCli({
    scriptName: "llm-formation-extract.mjs",
    target,
  }).catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
