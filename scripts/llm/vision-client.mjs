/**
 * Shared LM Studio vision plumbing for the arena (enemy) and formation (clan) extractors.
 *
 * Owns: config loading, model resolution, HTTP transport, JSON parsing, ROI cropping,
 * per-folder data.json persistence and the single-image CLI shell.
 * Target-specific prompts, ROIs and normalisers live in `createVisionTarget` descriptors.
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
import { writeJsonAtomic } from "../atomic-json.mjs";
import { formatPowerForFilename } from "../enemy-records.mjs";
import { resolveCropConfig, resolveRoiReference, scaleRoiToImage } from "../roi.mjs";
import { toSafeEnemyFilenameToken } from "../ocr/enemy-filename-tokens.mjs";
import { log } from "../log.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_PATH = path.join(__dirname, "..", "..", "config", "llm.json");

const CHAT_PATH = "/api/v1/chat";
const MODELS_PATH = "/api/v1/models";

/** @type {object | undefined} */
let _cachedConfig;

export function loadLlmConfig() {
  if (_cachedConfig) return _cachedConfig;
  try {
    _cachedConfig = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    _cachedConfig = {};
  }
  return _cachedConfig;
}

const _config = loadLlmConfig();
export const DEFAULT_HOST = _config.host ?? "http://127.0.0.1:1234";
export const REQUEST_TIMEOUT_MS = _config.requestTimeoutMs ?? 180_000;

export function isInvokedDirectly(metaUrl) {
  return path.resolve(process.argv[1] ?? "") === path.resolve(fileURLToPath(metaUrl));
}

/**
 * @param {string} host
 */
function apiBase(host) {
  return host.replace(/\/+$/, "");
}

/**
 * @param {string | undefined} optionsHost
 */
export function resolveHost(optionsHost) {
  return optionsHost ?? process.env.LLM_HOST ?? DEFAULT_HOST;
}

/**
 * @param {string} imagePath
 */
export function mimeForImagePath(imagePath) {
  const ext = path.extname(imagePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/png";
}

/**
 * Pull the first JSON object out of an LLM reply (tolerates fenced code blocks and prose).
 * @param {string} text
 */
export function parseJsonFromLlm(text) {
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
 * @param {unknown} raw
 * @returns {number}
 */
export function parsePowerValue(raw) {
  let power;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    power = Math.round(raw);
  } else if (typeof raw === "string") {
    const digits = raw.replace(/[^\d]+/g, "");
    power = digits ? Number(digits) : NaN;
  } else {
    power = NaN;
  }
  if (!Number.isFinite(power) || power <= 0 || power > 999_999_999) {
    throw new Error(`Invalid power from LLM: ${JSON.stringify(raw)}`);
  }
  return power;
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
 * @param {{ modelFallback: string, hints: string[] }} options
 */
export async function resolveVisionModel(host, preferred, options) {
  if (preferred?.trim()) return preferred.trim();

  const envModel = process.env.LLM_MODEL;
  if (envModel?.trim()) return envModel.trim();

  const base = apiBase(host);
  try {
    const res = await fetch(`${base}${MODELS_PATH}`);
    if (!res.ok) return options.modelFallback;

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
        `No vision model loaded in LM Studio. Load one (e.g. ${options.modelFallback}) in the app.`,
      );
    }

    const lower = keys.map((k) => [k, k.toLowerCase()]);
    for (const hint of options.hints) {
      const hit = lower.find(([, l]) => l.includes(hint));
      if (hit) return hit[0];
    }
    return keys[0];
  } catch (err) {
    if (err instanceof Error && err.message.includes("No vision")) throw err;
    return options.modelFallback;
  }
}

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
export async function cropRoiToPngBuffer(imagePath, roi) {
  const meta = await sharp(imagePath).metadata();
  if (!meta.width || !meta.height) {
    throw new Error(`Could not read image dimensions: ${imagePath}`);
  }
  const scaled = scaleRoiToImage(roi, meta, resolveRoiReference(loadLlmConfig()));
  if (!scaled) {
    throw new Error(`Invalid ROI: ${JSON.stringify(roi)}`);
  }
  const box = clampRoi(
    { left: Math.floor(scaled.x), top: Math.floor(scaled.y), width: Math.floor(scaled.width), height: Math.floor(scaled.height) },
    { width: meta.width, height: meta.height },
  );
  return sharp(imagePath).extract(box).png().toBuffer();
}

/**
 * @param {string} host
 * @param {string} model
 * @param {string} systemPrompt
 * @param {string} userPrompt
 * @param {{ mime: string, bytes: Buffer }[]} images
 * @param {number} timeoutMs
 */
async function chatVisionWithImages(host, model, systemPrompt, userPrompt, images, timeoutMs) {
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
        system_prompt: systemPrompt,
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
 * @param {unknown} userPrompt config.userPrompt
 * @param {string} fallbackPrompt
 * @returns {string}
 */
export function resolveUserPromptImage(userPrompt, fallbackPrompt) {
  if (typeof userPrompt === "string" && userPrompt.trim()) return userPrompt;
  if (!userPrompt || typeof userPrompt !== "object" || Array.isArray(userPrompt)) {
    return fallbackPrompt;
  }

  const image = userPrompt.image;
  if (typeof image === "string" && image.trim()) return image;
  if (image && typeof image === "object" && !Array.isArray(image)) {
    if (typeof image.prompt === "string" && image.prompt.trim()) return image.prompt;
  }
  return fallbackPrompt;
}

/**
 * Build the extract functions for one vision target from a declarative descriptor.
 *
 * @param {{
 *   targetKey: "enemy" | "clan",
 *   defaultModelFallback: string,
 *   visionModelHints: string[],
 *   systemPromptFallback: string,
 *   fullPromptFallback: string,
 *   nameFallback: { prompt: string, roi: { x: number, y: number, width: number, height: number } },
 *   powerFallback: { prompt: string, roi: { x: number, y: number, width: number, height: number } },
 *   normalizeFull: (data: unknown) => object,
 *   normalizeName: (data: unknown) => { name: string, language?: string, nameLatin?: string },
 *   normalizePower: (data: unknown) => { power: number },
 * }} descriptor
 */
export function createVisionTarget(descriptor) {
  const config = loadLlmConfig();
  const hints = Array.isArray(config.visionModelHints)
    ? config.visionModelHints
    : descriptor.visionModelHints;
  const modelFallback = config.defaultModel ?? descriptor.defaultModelFallback;
  const systemPrompt = config.systemPrompt ?? descriptor.systemPromptFallback;
  const userPrompt = config.userPrompt;

  /**
   * @param {string} host
   * @param {string | undefined} [preferred]
   */
  function resolveModel(host, preferred) {
    return resolveVisionModel(host, preferred, { modelFallback, hints });
  }

  /**
   * @param {{ clearCacheBeforeEachCall?: boolean, cacheLabel?: string }} options
   */
  async function maybeClearCache(options) {
    const clearBeforeEach =
      options.clearCacheBeforeEachCall !== undefined
        ? options.clearCacheBeforeEachCall === true
        : shouldClearPredictionCacheBeforeEachCall({ config });
    if (clearBeforeEach) {
      await clearLmPredictionCache({
        config,
        label: options.cacheLabel ?? "before LLM call",
      });
    }
  }

  /**
   * @param {string} imagePath
   * @param {{ host?: string, model?: string, timeoutMs?: number, clearCacheBeforeEachCall?: boolean }} [options]
   */
  async function extractFromScreenshot(imagePath, options = {}) {
    const host = resolveHost(options.host);
    const model = await resolveModel(host, options.model);
    const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;

    await maybeClearCache(options);

    const imageBytes = await fs.readFile(imagePath);
    const content = await chatVisionWithImages(
      host,
      model,
      systemPrompt,
      resolveUserPromptImage(userPrompt, descriptor.fullPromptFallback),
      [{ mime: mimeForImagePath(imagePath), bytes: imageBytes }],
      timeoutMs,
    );
    return descriptor.normalizeFull(parseJsonFromLlm(content));
  }

  /**
   * @param {string} imagePath
   * @param {{ host?: string, model?: string, timeoutMs?: number, clearCacheBeforeEachCall?: boolean }} [options]
   */
  async function extractFromNamePowerCrops(imagePath, options = {}) {
    const host = resolveHost(options.host);
    const model = await resolveModel(host, options.model);
    const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;

    await maybeClearCache({ ...options, cacheLabel: "before LLM crop calls" });

    const nameCfg = resolveCropConfig(userPrompt, descriptor.targetKey, "name", descriptor.nameFallback);
    const powerCfg = resolveCropConfig(userPrompt, descriptor.targetKey, "power", descriptor.powerFallback);
    const nameBytes = await cropRoiToPngBuffer(imagePath, nameCfg.roi);
    const powerBytes = await cropRoiToPngBuffer(imagePath, powerCfg.roi);

    const nameContent = await chatVisionWithImages(
      host,
      model,
      systemPrompt,
      nameCfg.prompt,
      [{ mime: "image/png", bytes: nameBytes }],
      timeoutMs,
    );
    const namePart = descriptor.normalizeName(parseJsonFromLlm(nameContent));

    const powerContent = await chatVisionWithImages(
      host,
      model,
      systemPrompt,
      powerCfg.prompt,
      [{ mime: "image/png", bytes: powerBytes }],
      timeoutMs,
    );
    const powerPart = descriptor.normalizePower(parseJsonFromLlm(powerContent));

    return descriptor.normalizeFull({
      name: namePart.name,
      power: powerPart.power,
      language: namePart.language,
      nameLatin: namePart.nameLatin,
    });
  }

  return {
    extractFromScreenshot,
    extractFromNamePowerCrops,
    resolveModel,
    resolveUserPromptImage: () => resolveUserPromptImage(userPrompt, descriptor.fullPromptFallback),
    /** @param {"name" | "power"} kind */
    resolveCropConfig: (kind) =>
      resolveCropConfig(
        userPrompt,
        descriptor.targetKey,
        kind,
        kind === "name" ? descriptor.nameFallback : descriptor.powerFallback,
      ),
  };
}

/**
 * @param {string} imagePath
 * @param {object} extracted
 * @param {number} durationMs
 * @param {string | null} canonical
 */
export async function upsertDataJsonForImage(imagePath, extracted, durationMs, canonical) {
  const folder = path.dirname(imagePath);
  const base = path.basename(imagePath);
  const dataPath = path.join(folder, "data.json");
  let existing = {};
  try {
    const raw = await fs.readFile(dataPath, "utf8");
    existing = JSON.parse(raw);
  } catch {
    existing = {};
  }
  existing[base] = {
    name: extracted.name,
    nameLatin: extracted.nameLatin,
    power: extracted.power,
    language: extracted.language ?? null,
    extractedAt: new Date().toISOString(),
    processingMs: typeof durationMs === "number" ? Math.round(durationMs) : null,
    canonical: canonical ?? null,
  };
  await writeJsonAtomic(dataPath, existing);
  return dataPath;
}

/**
 * If data.json keys point at original filenames whose canonical file now exists, re-key the
 * entries and drop stale originals. Best-effort: unreadable/unwritable state is ignored.
 * @param {string} folder
 */
export async function reconcileDataJsonWithCanonicalFiles(folder) {
  const dataPath = path.join(folder, "data.json");
  const raw = await fs.readFile(dataPath, "utf8").catch(() => "");
  if (!raw) return;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }
  const files = await fs.readdir(folder).catch(() => []);
  let changed = false;
  for (const [oldKey, entry] of Object.entries(parsed)) {
    if (files.includes(oldKey)) continue;
    const nameToken = toSafeEnemyFilenameToken(entry.nameLatin || entry.name || "UNKNOWN");
    const powerToken = formatPowerForFilename(Number(entry.power || 0));
    const exts = [".webp", ".png", ".jpg", ".jpeg"];
    let found = null;
    for (const ext of exts) {
      const cand = `${powerToken}-${nameToken}${ext}`;
      if (files.includes(cand)) {
        found = cand;
        break;
      }
      for (let i = 1; i <= 10 && !found; i++) {
        const c2 = `${powerToken}-${nameToken}-${i}${ext}`;
        if (files.includes(c2)) {
          found = c2;
          break;
        }
      }
      if (found) break;
    }
    if (found) {
      // Never delete sources: move the stale original aside so the operation is reversible.
      const stalePath = path.join(folder, oldKey);
      try {
        await fs.access(stalePath);
        const trashDir = path.join(folder, "_orphaned");
        await fs.mkdir(trashDir, { recursive: true });
        await fs.rename(stalePath, path.join(trashDir, oldKey));
        log.info(`[Data] moved stale original to _orphaned/: ${oldKey}`);
      } catch (err) {
        const code = err && typeof err === "object" && "code" in err ? err.code : undefined;
        if (code !== "ENOENT") {
          console.warn(
            `[Data] could not move stale original ${oldKey}: ` +
              `${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      if (!Object.prototype.hasOwnProperty.call(parsed, found)) {
        parsed[found] = entry;
      }
      delete parsed[oldKey];
      changed = true;
    }
  }
  if (changed) {
    await writeJsonAtomic(dataPath, parsed);
    log.info(`[Data] reconciled data.json in ${folder}`);
  }
}

/**
 * @param {string[]} argv
 */
export function parseExtractCliArgs(argv) {
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

/**
 * Shared CLI shell: one image in, one data.json entry out.
 *
 * @param {{
 *   scriptName: string,
 *   target: ReturnType<typeof createVisionTarget>,
 *   logPerFolder?: boolean,
 * }} args
 */
export async function runVisionExtractCli({ scriptName, target, logPerFolder = false }) {
  const { imagePath, clearCache } = parseExtractCliArgs(process.argv.slice(2));
  if (!imagePath) {
    console.error(
      `Usage: node scripts/llm/${scriptName} <image.png> [--clear-cache|--no-clear-cache]`,
    );
    process.exit(1);
  }

  const host = resolveHost();
  const model = await target.resolveModel(host, process.env.LLM_MODEL);
  const resolved = path.resolve(imagePath);
  const clearCacheBeforeEachCall = shouldClearPredictionCacheBeforeEachCall({
    cliOverride: clearCache,
    config: loadLlmConfig(),
  });

  console.log(`Provider: LM Studio`);
  console.log(`Model: ${model}`);
  console.log(`Host: ${host}`);
  console.log(`Clear cache before call: ${clearCacheBeforeEachCall}`);
  console.log(`Image: ${resolved}\n`);

  try {
    await reconcileDataJsonWithCanonicalFiles(path.dirname(resolved));
  } catch {
    // ignore reconciliation errors
  }

  try {
    const folder = path.dirname(resolved);
    const base = path.basename(resolved);
    const dataPath = path.join(folder, "data.json");
    const raw = await fs.readFile(dataPath, "utf8").catch(() => "");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && Object.prototype.hasOwnProperty.call(parsed, base)) {
        console.log(`[Skip] ${base} already present in ${dataPath}`);
        process.exit(0);
      }
    }
  } catch {
    // ignore parse errors and continue
  }

  const start = performance.now();
  const result = await target.extractFromScreenshot(resolved, {
    host,
    model,
    clearCacheBeforeEachCall,
  });
  const durationMs = performance.now() - start;
  console.log(JSON.stringify(result, null, 2));
  console.log(`[Time] LLM extraction: ${Math.round(durationMs)}ms`);

  const canonicalBase = `${formatPowerForFilename(Number(result.power))}-${toSafeEnemyFilenameToken(
    result.nameLatin || result.name,
  )}.webp`;

  try {
    const dataJson = await upsertDataJsonForImage(resolved, result, durationMs, canonicalBase);
    log.info(`[Data] wrote ${dataJson} (processing ${Math.round(durationMs)}ms)`);
  } catch (err) {
    console.warn(
      "[Data] failed to write data.json:",
      err instanceof Error ? err.message : String(err),
    );
  }

  if (logPerFolder) {
    try {
      const logPath = path.join(path.dirname(resolved), "log.txt");
      const entry = `[${new Date().toISOString()}] ${path.basename(resolved)} processed ${Math.round(durationMs)}ms name=${JSON.stringify(
        result.name,
      )}\n`;
      await fs.appendFile(logPath, entry, "utf8");
    } catch {
      // ignore logging errors
    }
  }
}
