/**
 * Extract opponent name + power from arena screenshots via local LM Studio (vision model).
 *
 * Env:
 *   LLM_HOST       — default http://127.0.0.1:1234
 *   LLM_MODEL      — default qwen/qwen3-vl-4b
 *   LM_API_TOKEN   — optional Bearer token
 *   LLM_SKIP_CACHE_CLEAR — set 1 to skip prediction-cache clearing
 *
 * config/llm.json `userPrompt` may be a string (legacy) or an object:
 *   - image                 — string prompt, or { prompt, enemy }
 *   - image.enemy.name      — { prompt, roi } for name crop
 *   - image.enemy.power     — { prompt, roi } for power crop
 */
import fs from "fs/promises";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";
import {
  clearLmPredictionCache,
  shouldClearPredictionCacheBeforeEachCall,
} from "./clear-lm-prediction-cache.mjs";

// local paths (adjusted for scripts/llm location)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_PATH = path.join(__dirname, "..", "..", "config", "llm.json");

let _llmConfig = {};
try {
  const raw = readFileSync(CONFIG_PATH, "utf8");
  _llmConfig = JSON.parse(raw);
} catch {
  _llmConfig = {};
}

export const DEFAULT_LLM_MODEL = _llmConfig.defaultModel ?? "qwen/qwen3-vl-4b";
const DEFAULT_HOST = _llmConfig.host ?? "http://127.0.0.1:1234";
const CHAT_PATH = "/api/v1/chat";
const MODELS_PATH = "/api/v1/models";
const REQUEST_TIMEOUT_MS = _llmConfig.requestTimeoutMs ?? 180_000;

const VISION_MODEL_HINTS = Array.isArray(_llmConfig.visionModelHints)
  ? _llmConfig.visionModelHints
  : [
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

const SYSTEM_PROMPT = _llmConfig.systemPrompt ?? `You extract structured data from Kingdom Clash arena screenshots.
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
 * @returns {string}
 */
export function resolveUserPromptImage() {
  const up = _llmConfig.userPrompt;
  if (typeof up === "string" && up.trim()) return up;
  if (!up || typeof up !== "object" || Array.isArray(up)) {
    return DEFAULT_USER_PROMPT_IMAGE;
  }

  const image = up.image;
  if (typeof image === "string" && image.trim()) return image;
  if (image && typeof image === "object" && !Array.isArray(image)) {
    if (typeof image.prompt === "string" && image.prompt.trim()) return image.prompt;
  }
  return DEFAULT_USER_PROMPT_IMAGE;
}

/**
 * @param {unknown} raw
 * @param {{ prompt: string, roi: { x: number, y: number, width: number, height: number } }} fallback
 * @returns {{ prompt: string, roi: { x: number, y: number, width: number, height: number } }}
 */
function normalizeCropConfig(raw, fallback) {
  if (typeof raw === "string" && raw.trim()) {
    return { prompt: raw.trim(), roi: { ...fallback.roi } };
  }

  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const prompt =
      typeof raw.prompt === "string" && raw.prompt.trim()
        ? raw.prompt.trim()
        : fallback.prompt;
    const roiSrc = raw.roi && typeof raw.roi === "object" ? raw.roi : raw;
    const x = Number(roiSrc.x);
    const y = Number(roiSrc.y);
    const width = Number(roiSrc.width ?? roiSrc.w);
    const height = Number(roiSrc.height ?? roiSrc.h);
    const roi =
      Number.isFinite(x) &&
      Number.isFinite(y) &&
      Number.isFinite(width) &&
      Number.isFinite(height) &&
      width > 0 &&
      height > 0
        ? { x, y, width, height }
        : { ...fallback.roi };
    return { prompt, roi };
  }

  return { prompt: fallback.prompt, roi: { ...fallback.roi } };
}

/**
 * @param {"name" | "power"} kind
 * @returns {{ prompt: string, roi: { x: number, y: number, width: number, height: number } }}
 */
export function resolveEnemyCropConfig(kind) {
  const fallback = kind === "name" ? DEFAULT_NAME_CROP : DEFAULT_POWER_CROP;
  const up = _llmConfig.userPrompt;
  if (!up || typeof up !== "object" || Array.isArray(up)) {
    return { prompt: fallback.prompt, roi: { ...fallback.roi } };
  }

  const nested =
    up.image &&
    typeof up.image === "object" &&
    !Array.isArray(up.image) &&
    up.image.enemy &&
    typeof up.image.enemy === "object" &&
    !Array.isArray(up.image.enemy)
      ? up.image.enemy[kind]
      : undefined;

  if (nested !== undefined) {
    return normalizeCropConfig(nested, fallback);
  }

  // Legacy dotted keys: "image.enemy.name" / "image.enemy.power"
  return normalizeCropConfig(up[`image.enemy.${kind}`], fallback);
}

/**
 * @param {string} host
 */
function apiBase(host) {
  return host.replace(/\/+$/, "");
}

function resolveHost(optionsHost) {
  return optionsHost ?? process.env.LLM_HOST ?? DEFAULT_HOST;
}

function resolvePreferredModel(optionsModel) {
  return optionsModel ?? process.env.LLM_MODEL;
}

/**
 * @param {string} imagePath
 */
function mimeForImagePath(imagePath) {
  const ext = path.extname(imagePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/png";
}

/**
 * @param {string} text
 */
export function parseEnemyJsonFromLlm(text) {
  const trimmed = String(text ?? "").trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1].trim() : trimmed;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("LLM response did not contain a JSON object.");
  }
  return JSON.parse(raw.slice(start, end + 1));
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

  let power;
  if (typeof data.power === "number" && Number.isFinite(data.power)) {
    power = Math.round(data.power);
  } else if (typeof data.power === "string") {
    const digits = data.power.replace(/[^\d]+/g, "");
    power = digits ? Number(digits) : NaN;
  } else {
    power = NaN;
  }
  if (!Number.isFinite(power) || power <= 0 || power > 999_999_999) {
    throw new Error(`Invalid power from LLM: ${JSON.stringify(data.power)}`);
  }

  const out = { power, name };
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
  let power;
  if (typeof data.power === "number" && Number.isFinite(data.power)) {
    power = Math.round(data.power);
  } else if (typeof data.power === "string") {
    const digits = data.power.replace(/[^\d]+/g, "");
    power = digits ? Number(digits) : NaN;
  } else {
    power = NaN;
  }
  if (!Number.isFinite(power) || power <= 0 || power > 999_999_999) {
    throw new Error(`Invalid power from LLM: ${JSON.stringify(data.power)}`);
  }
  return { power };
}

/**
 * @param {unknown} payload
 */
function extractTextFromLmStudioResponse(payload) {
  const output = payload?.output;
  if (!Array.isArray(output)) {
    return typeof payload?.output === "string" ? payload.output : "";
  }
  return output
    .filter((part) => part?.type === "message" && typeof part.content === "string")
    .map((part) => part.content)
    .join("\n")
    .trim();
}

/**
 * @param {string} host
 * @param {string | undefined} preferred
 */
export async function resolveVisionModel(host, preferred) {
  if (preferred?.trim()) return preferred.trim();

  const envModel = resolvePreferredModel();
  if (envModel?.trim()) return envModel.trim();

  const base = apiBase(host);
  try {
    const res = await fetch(`${base}${MODELS_PATH}`);
    if (!res.ok) return DEFAULT_LLM_MODEL;

    const data = await res.json();
    const models = data?.models ?? [];
    const loadedVision = models.filter(
      (m) =>
        m?.capabilities?.vision &&
        Array.isArray(m.loaded_instances) &&
        m.loaded_instances.length > 0,
    );
    const pool = loadedVision.length > 0 ? loadedVision : models.filter((m) => m?.capabilities?.vision);
    const keys = pool.map((m) => String(m.key ?? "")).filter(Boolean);
    if (keys.length === 0) {
      throw new Error(
        `No vision model loaded in LM Studio. Load one (e.g. ${DEFAULT_LLM_MODEL}) in the app.`,
      );
    }

    const lower = keys.map((k) => [k, k.toLowerCase()]);
    for (const hint of VISION_MODEL_HINTS) {
      const hit = lower.find(([, l]) => l.includes(hint));
      if (hit) return hit[0];
    }
    return keys[0];
  } catch (err) {
    if (err instanceof Error && err.message.includes("No vision")) throw err;
    return DEFAULT_LLM_MODEL;
  }
}

/** @deprecated use resolveVisionModel */
export const resolveOllamaVisionModel = resolveVisionModel;

/**
 * @param {string} url
 * @param {RequestInit} init
 * @param {number} timeoutMs
 */
async function fetchWithTimeout(url, init, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`LM Studio request timed out after ${timeoutMs / 1000}s.`);
    }
    throw new Error(
      `Cannot reach LM Studio at ${url}. ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {{ left: number, top: number, width: number, height: number }} roi
 * @param {{ width: number, height: number }} meta
 */
function clampRoi(roi, meta) {
  const left = Math.max(0, Math.min(roi.left, meta.width - 1));
  const top = Math.max(0, Math.min(roi.top, meta.height - 1));
  const width = Math.max(1, Math.min(roi.width, meta.width - left));
  const height = Math.max(1, Math.min(roi.height, meta.height - top));
  return { left, top, width, height };
}

/**
 * @param {string} imagePath
 * @param {{ x: number, y: number, width: number, height: number }} roi
 * @returns {Promise<Buffer>}
 */
export async function cropEnemyRoiToPngBuffer(imagePath, roi) {
  const meta = await sharp(imagePath).metadata();
  if (!meta.width || !meta.height) {
    throw new Error(`Could not read image dimensions: ${imagePath}`);
  }
  const box = clampRoi(
    { left: Math.floor(roi.x), top: Math.floor(roi.y), width: Math.floor(roi.width), height: Math.floor(roi.height) },
    { width: meta.width, height: meta.height },
  );
  return sharp(imagePath).extract(box).png().toBuffer();
}

/**
 * @param {string} host
 * @param {string} model
 * @param {string} userPrompt
 * @param {{ mime: string, bytes: Buffer }[]} images
 * @param {number} timeoutMs
 */
async function chatVisionWithImages(host, model, userPrompt, images, timeoutMs) {
  const url = `${apiBase(host)}${CHAT_PATH}`;
  const headers = { "Content-Type": "application/json" };
  const token = process.env.LM_API_TOKEN?.trim();
  if (token) headers.Authorization = `Bearer ${token}`;

  /** @type {object[]} */
  const input = [{ type: "text", content: userPrompt }];
  for (const img of images) {
    input.push({
      type: "image",
      data_url: `data:${img.mime};base64,${img.bytes.toString("base64")}`,
    });
  }

  const response = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        system_prompt: SYSTEM_PROMPT,
        input,
        temperature: 0,
      }),
    },
    timeoutMs,
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `LM Studio HTTP ${response.status} for model "${model}": ${body.slice(0, 400) || response.statusText}`,
    );
  }

  const payload = await response.json();
  const content = extractTextFromLmStudioResponse(payload);
  if (!content) throw new Error("LM Studio returned an empty message.");
  return content;
}

/**
 * @param {string} imagePath
 * @param {{ host?: string, model?: string, timeoutMs?: number, clearCacheBeforeEachCall?: boolean }} [options]
 * @returns {Promise<{ power: number, name: string, language?: string, englishName?: string }>}
 */
export async function extractEnemyDataFromScreenshot(imagePath, options = {}) {
  const host = resolveHost(options.host);
  const model = await resolveVisionModel(host, options.model);
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const clearBeforeEach =
    options.clearCacheBeforeEachCall !== undefined
      ? options.clearCacheBeforeEachCall === true
      : shouldClearPredictionCacheBeforeEachCall({ config: _llmConfig });

  if (clearBeforeEach) {
    await clearLmPredictionCache({
      config: _llmConfig,
      label: "before LLM call",
    });
  }

  const imageBytes = await fs.readFile(imagePath);
  const mime = mimeForImagePath(imagePath);
  const content = await chatVisionWithImages(
    host,
    model,
    resolveUserPromptImage(),
    [{ mime, bytes: imageBytes }],
    timeoutMs,
  );
  return normalizeEnemyExtraction(parseEnemyJsonFromLlm(content));
}

/**
 * Crop name + power ROIs from the screenshot and recognize each crop with the LLM
 * using `userPrompt.image.enemy.name` / `userPrompt.image.enemy.power`.
 *
 * @param {string} imagePath
 * @param {{ host?: string, model?: string, timeoutMs?: number, clearCacheBeforeEachCall?: boolean }} [options]
 * @returns {Promise<{ power: number, name: string, language?: string, nameLatin?: string }>}
 */
export async function extractEnemyDataFromNamePowerCrops(imagePath, options = {}) {
  const host = resolveHost(options.host);
  const model = await resolveVisionModel(host, options.model);
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const clearBeforeEach =
    options.clearCacheBeforeEachCall !== undefined
      ? options.clearCacheBeforeEachCall === true
      : shouldClearPredictionCacheBeforeEachCall({ config: _llmConfig });

  if (clearBeforeEach) {
    await clearLmPredictionCache({
      config: _llmConfig,
      label: "before LLM crop calls",
    });
  }

  const nameCfg = resolveEnemyCropConfig("name");
  const powerCfg = resolveEnemyCropConfig("power");
  const nameBytes = await cropEnemyRoiToPngBuffer(imagePath, nameCfg.roi);
  const powerBytes = await cropEnemyRoiToPngBuffer(imagePath, powerCfg.roi);

  const nameContent = await chatVisionWithImages(
    host,
    model,
    nameCfg.prompt,
    [{ mime: "image/png", bytes: nameBytes }],
    timeoutMs,
  );
  const namePart = normalizeEnemyNameExtraction(parseEnemyJsonFromLlm(nameContent));

  const powerContent = await chatVisionWithImages(
    host,
    model,
    powerCfg.prompt,
    [{ mime: "image/png", bytes: powerBytes }],
    timeoutMs,
  );
  const powerPart = normalizeEnemyPowerExtraction(parseEnemyJsonFromLlm(powerContent));

  return normalizeEnemyExtraction({
    name: namePart.name,
    power: powerPart.power,
    language: namePart.language,
    nameLatin: namePart.nameLatin,
  });
}

function parseExtractCliArgs(argv) {
  const args = {
    imagePath: undefined,
    /** @type {boolean | undefined} */
    clearCache: undefined,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--" || a === undefined) continue;
    if (a === "--clear-cache") args.clearCache = true;
    else if (a === "--no-clear-cache") args.clearCache = false;
    else if (!a.startsWith("-") && !args.imagePath) args.imagePath = a;
  }
  return args;
}

async function cliMain() {
  const { imagePath, clearCache } = parseExtractCliArgs(process.argv.slice(2));
  if (!imagePath) {
    console.error(
      "Usage: node scripts/llm/llm-enemy-extract.mjs <image.png> [--clear-cache|--no-clear-cache]",
    );
    process.exit(1);
  }

  const host = resolveHost();
  const model = await resolveVisionModel(host, resolvePreferredModel());
  const resolved = path.resolve(imagePath);
  const clearCacheBeforeEachCall = shouldClearPredictionCacheBeforeEachCall({
    cliOverride: clearCache,
    config: _llmConfig,
  });

  console.log(`Provider: LM Studio`);
  console.log(`Model: ${model}`);
  console.log(`Host: ${host}`);
  console.log(`Clear cache before call: ${clearCacheBeforeEachCall}`);
  console.log(`Image: ${resolved}\n`);

  const result = await extractEnemyDataFromScreenshot(resolved, {
    host,
    model,
    clearCacheBeforeEachCall,
  });
  console.log(JSON.stringify(result, null, 2));
}

const invokedDirectly =
  path.resolve(process.argv[1] ?? "") === path.resolve(__filename);
if (invokedDirectly) {
  cliMain().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}

