/**
 * Extract opponent name + power from arena screenshots via a local LLM API.
 *
 * Default: LM Studio v1 REST (`POST /api/v1/chat` on port 1234).
 * Optional: Ollama (`LLM_PROVIDER=ollama`, port 11434).
 *
 * Env:
 *   LLM_PROVIDER   — `lmstudio` (default) | `ollama`
 *   LLM_HOST       — default http://127.0.0.1:1234 (lmstudio) or :11434 (ollama)
 *   LLM_MODEL      — e.g. google/gemma-4-e4b
 *   LM_API_TOKEN   — optional Bearer token for LM Studio
 *   OLLAMA_HOST / OLLAMA_MODEL — legacy aliases when provider=ollama
 */
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const PROVIDERS = /** @type {const} */ (["lmstudio", "ollama"]);

const DEFAULTS = {
  lmstudio: {
    host: "http://127.0.0.1:1234",
    model: "google/gemma-4-e4b",
    chatPath: "/api/v1/chat",
    modelsPath: "/api/v1/models",
  },
  ollama: {
    host: "http://127.0.0.1:11434",
    model: "llava",
    chatPath: "/api/chat",
    modelsPath: "/api/tags",
  },
};

const REQUEST_TIMEOUT_MS = 180_000;

const VISION_MODEL_HINTS = [
  "gemma-4",
  "gemma3",
  "vision",
  "vl",
  "llava",
  "moondream",
  "minicpm-v",
  "bakllava",
  "llama3.2",
  "qwen3-vl",
  "qwen2.5vl",
];

const SYSTEM_PROMPT = `You extract structured data from Kingdom Clash arena screenshots.
Reply with JSON only — no markdown, no prose outside the JSON object.`;

const USER_PROMPT = `Find the OPPONENT (not the player) in the top-right HUD:
- Opponent display name (text tag near the top-right)
- Opponent power (large number below the name, often shown as three groups like "3 881 108" — return ONE integer with all digits, no spaces)

Return exactly this JSON shape:
{
  "power": <positive integer, 1-9 digits>,
  "name": "<name exactly as shown in the game UI>",
  "language": "<language of the name text, e.g. Korean, Russian, English>",
  "englishName": "<Latin/English transliteration for filenames; omit if name is already Latin>"
}`;

/**
 * @returns {"lmstudio" | "ollama"}
 */
export function resolveLlmProvider() {
  const raw = (process.env.LLM_PROVIDER ?? "lmstudio").toLowerCase().trim();
  if (PROVIDERS.includes(/** @type {typeof PROVIDERS[number]} */ (raw))) {
    return raw;
  }
  throw new Error(`Invalid LLM_PROVIDER "${raw}". Use: ${PROVIDERS.join(", ")}`);
}

/**
 * @param {string} host
 */
function apiBase(host) {
  return host.replace(/\/+$/, "");
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
 * @returns {{ power: number, name: string, language?: string, englishName?: string }}
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
  if (typeof data.englishName === "string" && data.englishName.trim()) {
    out.englishName = data.englishName.trim();
  }
  return out;
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
 * @param {"lmstudio" | "ollama"} provider
 * @param {string} host
 * @param {string | undefined} preferred
 */
export async function resolveVisionModel(provider, host, preferred) {
  if (preferred?.trim()) return preferred.trim();

  const envModel =
    process.env.LLM_MODEL ??
    (provider === "ollama" ? process.env.OLLAMA_MODEL : undefined);
  if (envModel?.trim()) return envModel.trim();

  const defaults = DEFAULTS[provider];
  const base = apiBase(host);

  try {
    const res = await fetch(`${base}${defaults.modelsPath}`);
    if (!res.ok) return defaults.model;

    const data = await res.json();

    if (provider === "lmstudio") {
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
          `No vision model loaded in LM Studio. Load one (e.g. ${defaults.model}) in the app.`,
        );
      }
      const lower = keys.map((k) => [k, k.toLowerCase()]);
      for (const hint of VISION_MODEL_HINTS) {
        const hit = lower.find(([, l]) => l.includes(hint));
        if (hit) return hit[0];
      }
      return keys[0];
    }

    const names = (data?.models ?? []).map((m) => String(m.name ?? "")).filter(Boolean);
    if (names.length === 0) {
      throw new Error(`No Ollama models installed. Run: ollama pull ${defaults.model}`);
    }
    const lower = names.map((n) => [n, n.toLowerCase()]);
    for (const hint of VISION_MODEL_HINTS) {
      const hit = lower.find(([, l]) => l.includes(hint));
      if (hit) return hit[0];
    }
    return names[0];
  } catch (err) {
    if (err instanceof Error && err.message.includes("No ")) throw err;
    return defaults.model;
  }
}

/**
 * @param {string} url
 * @param {RequestInit} init
 * @param {string} providerLabel
 * @param {number} [timeoutMs]
 */
async function fetchWithTimeout(url, init, providerLabel, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`${providerLabel} request timed out after ${timeoutMs / 1000}s.`);
    }
    throw new Error(
      `Cannot reach ${providerLabel} at ${url}. ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {string} imagePath
 * @param {string} host
 * @param {string} model
 * @param {number} timeoutMs
 */
async function extractViaLmStudio(imagePath, host, model, timeoutMs) {
  const imageBytes = await fs.readFile(imagePath);
  const mime = mimeForImagePath(imagePath);
  const dataUrl = `data:${mime};base64,${imageBytes.toString("base64")}`;
  const url = `${apiBase(host)}${DEFAULTS.lmstudio.chatPath}`;

  const headers = { "Content-Type": "application/json" };
  const token = process.env.LM_API_TOKEN?.trim();
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        system_prompt: SYSTEM_PROMPT,
        input: [
          { type: "text", content: USER_PROMPT },
          { type: "image", data_url: dataUrl },
        ],
        temperature: 0,
      }),
    },
    "LM Studio",
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
  return normalizeEnemyExtraction(parseEnemyJsonFromLlm(content));
}

/**
 * @param {string} imagePath
 * @param {string} host
 * @param {string} model
 * @param {number} timeoutMs
 */
async function extractViaOllama(imagePath, host, model, timeoutMs) {
  const imageBytes = await fs.readFile(imagePath);
  const base64 = imageBytes.toString("base64");
  const url = `${apiBase(host)}${DEFAULTS.ollama.chatPath}`;

  const response = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        format: "json",
        messages: [
          {
            role: "system",
            content: SYSTEM_PROMPT,
          },
          {
            role: "user",
            content: USER_PROMPT,
            images: [base64],
          },
        ],
      }),
    },
    "Ollama",
    timeoutMs,
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const hint =
      response.status === 404 ? ` Run: ollama pull ${model.split(":")[0]}` : "";
    throw new Error(
      `Ollama HTTP ${response.status} for model "${model}": ${body.slice(0, 400) || response.statusText}.${hint}`,
    );
  }

  const payload = await response.json();
  const content = payload?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("Ollama returned an empty message.");
  }
  return normalizeEnemyExtraction(parseEnemyJsonFromLlm(content));
}

/**
 * @param {string} imagePath
 * @param {{ host?: string, model?: string, provider?: "lmstudio" | "ollama", timeoutMs?: number }} [options]
 * @returns {Promise<{ power: number, name: string, language?: string, englishName?: string }>}
 */
export async function extractEnemyDataFromScreenshot(imagePath, options = {}) {
  const provider = options.provider ?? resolveLlmProvider();
  const defaults = DEFAULTS[provider];
  const host =
    options.host ??
    process.env.LLM_HOST ??
    (provider === "ollama" ? process.env.OLLAMA_HOST : undefined) ??
    defaults.host;
  const model = await resolveVisionModel(provider, host, options.model);
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;

  if (provider === "lmstudio") {
    return extractViaLmStudio(imagePath, host, model, timeoutMs);
  }
  return extractViaOllama(imagePath, host, model, timeoutMs);
}

/** @deprecated use resolveLlmProvider + resolveVisionModel */
export async function resolveOllamaVisionModel(host, preferred) {
  return resolveVisionModel("ollama", host, preferred ?? process.env.OLLAMA_MODEL);
}

async function cliMain() {
  const imagePath = process.argv[2];
  if (!imagePath) {
    console.error("Usage: node scripts/ollama-enemy-extract.mjs <image.png>");
    process.exit(1);
  }
  const provider = resolveLlmProvider();
  const defaults = DEFAULTS[provider];
  const host =
    process.env.LLM_HOST ??
    (provider === "ollama" ? process.env.OLLAMA_HOST : undefined) ??
    defaults.host;
  const model = await resolveVisionModel(provider, host, process.env.LLM_MODEL);
  const resolved = path.resolve(imagePath);

  console.log(`Provider: ${provider}`);
  console.log(`Model: ${model}`);
  console.log(`Host: ${host}`);
  console.log(`Image: ${resolved}\n`);

  const result = await extractEnemyDataFromScreenshot(resolved, { provider, host, model });
  console.log(JSON.stringify(result, null, 2));
}

const __filename = fileURLToPath(import.meta.url);
const invokedDirectly =
  path.resolve(process.argv[1] ?? "") === path.resolve(__filename);
if (invokedDirectly) {
  cliMain().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
