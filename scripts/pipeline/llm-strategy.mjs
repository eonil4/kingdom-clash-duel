/**
 * LLM extraction strategy (LM Studio) for the shared extraction runner.
 *
 * Owns mode selection (crops | screenshot), the retry/backoff policy with escalating
 * per-attempt timeouts, the low-power diagnostic and the mode-specific filename rules.
 */
import path from "path";
import { toSafeEnemyFilenameToken } from "../ocr/enemy-filename-tokens.mjs";
import { canonicalEnemyMapKey } from "../enemy-records.mjs";
import {
  extractEnemyDataFromNamePowerCrops,
  extractEnemyDataFromScreenshot,
} from "../llm/llm-enemy-extract.mjs";

/** @type {Record<"crops" | "screenshot", { logTag: string, extract: Function }>} */
export const LLM_MODES = {
  crops: {
    logTag: "[LLM crops]",
    extract: extractEnemyDataFromNamePowerCrops,
  },
  screenshot: {
    logTag: "[LLM]",
    extract: extractEnemyDataFromScreenshot,
  },
};

/**
 * @param {string | undefined} raw
 * @returns {"crops" | "screenshot"}
 */
export function resolveLlmMode(raw) {
  const v = String(raw ?? "crops").trim().toLowerCase();
  if (v === "crops" || v === "crop" || v === "name-power") return "crops";
  if (v === "screenshot" || v === "full") return "screenshot";
  throw new Error(`Unknown --mode ${JSON.stringify(raw)} (use crops or screenshot)`);
}

/** @param {number} ms */
function formatDuration(ms) {
  return ms >= 60_000 ? `${(ms / 60_000).toFixed(1)}m` : `${(ms / 1000).toFixed(1)}s`;
}

/**
 * @param {"crops" | "screenshot"} mode
 * @param {string} imagePath
 * @param {{ power: number, name: string, nameLatin?: string, englishName?: string, language?: string }} extracted
 */
function buildRecord(mode, imagePath, extracted) {
  if (!extracted?.power || !extracted?.name) {
    throw new Error("LLM did not return power and name.");
  }

  if (mode === "crops") {
    const nameRaw = extracted.name?.trim() || "";
    const nameLatinRaw = extracted.nameLatin?.trim() || "";
    if (!nameRaw && !nameLatinRaw) {
      throw new Error("LLM did not return name or nameLatin.");
    }
    const name = nameRaw || nameLatinRaw;
    const nameLatin = nameLatinRaw || toSafeEnemyFilenameToken(nameRaw);
    const canonicalKey = canonicalEnemyMapKey(imagePath, {
      power: Number(extracted.power),
      // Filename: nameLatin (fallback to name when latin is empty). Never use english.
      nameLatinRaw: nameLatinRaw || nameRaw,
      nameRaw: undefined,
      nameEnglish: undefined,
    });
    return {
      name,
      nameLatin,
      power: Number(extracted.power),
      language: extracted.language ?? null,
      canonical: path.posix.basename(canonicalKey),
    };
  }

  const nameLatin = extracted.englishName?.trim() || toSafeEnemyFilenameToken(extracted.name);
  const canonicalKey = canonicalEnemyMapKey(imagePath, {
    power: Number(extracted.power),
    nameLatinRaw: nameLatin,
    nameEnglish: extracted.englishName?.trim(),
    nameRaw: extracted.name,
  });
  return {
    name: extracted.name,
    nameLatin,
    power: Number(extracted.power),
    language: extracted.language ?? null,
    ...(extracted.englishName?.trim() ? { nameEnglish: extracted.englishName.trim() } : {}),
    canonical: path.posix.basename(canonicalKey),
  };
}

/**
 * @param {{
 *   mode?: "crops" | "screenshot",
 *   model?: string,
 *   attempts?: number,
 *   timeoutPerAttemptMs?: number,
 *   retryBaseDelayMs?: number,
 *   warnBelowPower?: number,
 *   clearCacheBeforeEachCall?: boolean,
 *   extractFns?: typeof LLM_MODES,
 *   delay?: (ms: number) => Promise<unknown>,
 * }} [options]
 */
export function createLlmStrategy({
  mode = "crops",
  model,
  attempts = 3,
  timeoutPerAttemptMs = 60_000,
  retryBaseDelayMs = 1500,
  warnBelowPower = 444,
  clearCacheBeforeEachCall,
  extractFns = LLM_MODES,
  delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  const modeConfig = extractFns[mode];
  if (!modeConfig) {
    throw new Error(`Unknown LLM mode ${JSON.stringify(mode)}`);
  }
  const { logTag, extract } = modeConfig;

  return {
    id: "llm",
    logTag,

    async prepare() {},

    async dispose() {},

    async extract({ filePath, basename }) {
      const startedAt = performance.now();
      let lastErr;

      for (let attempt = 1; attempt <= attempts; attempt++) {
        const timeoutMs = attempt * timeoutPerAttemptMs;
        try {
          console.log(
            `\t${logTag} ${basename} (attempt ${attempt}/${attempts}, timeout ${timeoutMs / 1000}s)...`,
          );
          const extracted = await extract(filePath, {
            timeoutMs,
            model,
            clearCacheBeforeEachCall,
          });
          const durationMs = performance.now() - startedAt;
          const detail =
            mode === "crops"
              ? extracted.nameLatin
                ? ` latin=${JSON.stringify(extracted.nameLatin)}`
                : ""
              : extracted.englishName
                ? ` english=${JSON.stringify(extracted.englishName)}`
                : "";
          const log =
            `\t${logTag} power=${extracted.power} name=${JSON.stringify(extracted.name)}` +
            `${detail} (${formatDuration(durationMs)})`;
          const warn =
            Number(extracted.power) < warnBelowPower
              ? `\t${logTag} LOW power=${extracted.power} name=${JSON.stringify(extracted.name)}` +
                (extracted.englishName
                  ? ` english=${JSON.stringify(extracted.englishName)}`
                  : "")
              : undefined;

          return {
            record: buildRecord(mode, filePath, extracted),
            durationMs,
            log,
            warn,
          };
        } catch (err) {
          lastErr = err;
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`\t${logTag} attempt ${attempt}/${attempts} failed: ${msg}`);
          if (attempt < attempts) {
            await delay(retryBaseDelayMs * attempt);
          }
        }
      }

      throw lastErr instanceof Error
        ? lastErr
        : new Error(String(lastErr ?? "LLM extraction failed"));
    },
  };
}
