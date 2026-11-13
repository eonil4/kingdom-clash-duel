/**
 * OCR extraction strategy (tesseract) for the shared extraction runner.
 *
 * Mirrors the historical ocr-enemy.mjs per-image logic: filename power wins over OCR,
 * sibling test-folder crops may refine the name, names are transliterated to Latin
 * artifacts, and incomplete results are skipped rather than failed.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { createWorker } from "tesseract.js";
import {
  canonicalEnemyMapKey,
  parsePowerFromOriginalBasename,
  WORKSPACE_ROOT,
} from "../enemy-records.mjs";
import { convertTextToLatinArtifacts } from "../ocr/convert-text-to-latin.mjs";
import { parseLatinNameHintFromEncodedOriginalBasename } from "../ocr/enemy-filename-tokens.mjs";
import { resolveCropConfig, resolveRoiReference } from "../roi.mjs";
import {
  normalizeOpponentDisplayName,
  ocrEnemyName,
  refineEnemyNameWithTestFolderCrops,
} from "../ocr/ocr-enemy-name.mjs";
import { ocrEnemyPower } from "../ocr/ocr-enemy-power.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * @param {unknown} config
 * @param {"enemy" | "clan"} targetKey
 * @param {"name" | "power"} kind
 */
function configuredRoi(config, targetKey, kind) {
  const userPrompt = /** @type {any} */ (config)?.userPrompt;
  if (!userPrompt || typeof userPrompt !== "object") return undefined;
  const cfg = resolveCropConfig(userPrompt, targetKey, kind, { prompt: "", roi: null });
  const roi = /** @type {any} */ (cfg)?.roi;
  const x = Number(roi?.x);
  const y = Number(roi?.y);
  const width = Number(roi?.width);
  const height = Number(roi?.height);
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    return undefined;
  }
  return { x, y, width, height };
}

/**
 * Prefer the traineddata bundled at the repo root so OCR works without network.
 * Falls back to tesseract.js defaults (CDN + its own cache) when files are absent.
 * @param {string} [workspaceRoot]
 */
export function defaultWorkerOptions(workspaceRoot = WORKSPACE_ROOT) {
  const files = ["eng.traineddata", "rus.traineddata"];
  if (!files.every((name) => fs.existsSync(path.join(workspaceRoot, name)))) {
    return undefined;
  }
  return {
    langPath: workspaceRoot,
    gzip: false,
    cachePath: path.join(os.tmpdir(), "kc-tesseract"),
  };
}

/**
 * @param {{
 *   force?: boolean,
 *   debugCrops?: boolean,
 *   targetKey?: "enemy" | "clan",
 *   config?: object,
 *   deps?: Partial<{
 *     createWorker: typeof createWorker,
 *     ocrName: typeof ocrEnemyName,
 *     refineName: typeof refineEnemyNameWithTestFolderCrops,
 *     ocrPower: typeof ocrEnemyPower,
 *     toLatin: typeof convertTextToLatinArtifacts,
 *     parseHint: typeof parseLatinNameHintFromEncodedOriginalBasename,
 *     normalizeName: typeof normalizeOpponentDisplayName,
 *     parsePowerFromFilename: typeof parsePowerFromOriginalBasename,
 *   }>,
 * }} [options]
 */
export function createOcrStrategy({
  force = false,
  debugCrops = false,
  targetKey = "enemy",
  config = {},
  deps = {},
} = {}) {
  if (targetKey !== "enemy" && targetKey !== "clan") {
    throw new Error(`Unknown OCR target ${JSON.stringify(targetKey)} (use enemy or clan)`);
  }
  const {
    createWorker: injectedWorkerFactory,
    ocrName = ocrEnemyName,
    refineName = refineEnemyNameWithTestFolderCrops,
    ocrPower = ocrEnemyPower,
    toLatin = convertTextToLatinArtifacts,
    parseHint = parseLatinNameHintFromEncodedOriginalBasename,
    normalizeName = normalizeOpponentDisplayName,
    parsePowerFromFilename = parsePowerFromOriginalBasename,
  } = deps;

  const workerOptions = deps.workerOptions ?? defaultWorkerOptions();
  const makeWorker = injectedWorkerFactory
    ? injectedWorkerFactory
    : (langs) =>
        workerOptions ? createWorker(langs, undefined, workerOptions) : createWorker(langs);

  const debugDir = debugCrops ? path.join(__dirname, ".ocr-debug") : undefined;
  const reference = resolveRoiReference(config);
  const nameRoi = configuredRoi(config, targetKey, "name");
  const powerRoi = configuredRoi(config, targetKey, "power");
  // Arena-only: sibling crop refinement and percent-encoded filename hints.
  const applyArenaRefinement = targetKey === "enemy";

  /** @type {any} */
  let worker;
  /** @type {any} */
  let workerRus;

  return {
    id: "ocr",
    logTag: "[OCR]",

    async prepare() {
      try {
        worker = await makeWorker("eng+rus");
        workerRus = await makeWorker("rus");
        await worker.setParameters({ preserve_interword_spaces: "1" });
        await workerRus.setParameters({ preserve_interword_spaces: "1" });
      } catch (err) {
        await this.dispose();
        throw err;
      }
    },

    async dispose() {
      for (const w of [worker, workerRus]) {
        if (w && typeof w.terminate === "function") {
          try {
            await w.terminate();
          } catch {
            // ignore teardown errors
          }
        }
      }
      worker = undefined;
      workerRus = undefined;
    },

    async shouldSkip({ filePath, basename, entries }) {
      if (force) return undefined;
      if (entries[basename]) {
        return `Skipping OCR for recorded image (use --force-ocr to refresh): ${filePath}`;
      }
      if (/^\d{3}_\d{3}_\d{3}-.+\.webp$/i.test(basename)) {
        return `Skipping OCR for canonical .webp file (use --force-ocr to refresh): ${filePath}`;
      }
      return undefined;
    },

    async extract({ filePath, basename }) {
      const powerFromFilename = parsePowerFromFilename(basename);
      const powerOcr = await ocrPower(filePath, worker, { powerRoi, reference });
      const power = powerFromFilename !== undefined ? powerFromFilename : powerOcr;

      let warn;
      if (
        powerFromFilename !== undefined &&
        powerOcr !== undefined &&
        powerFromFilename !== powerOcr
      ) {
        warn = `Using filename power ${powerFromFilename} (OCR said ${powerOcr}): ${basename}`;
      }

      let name = await ocrName(filePath, worker, workerRus, {
        debugDir,
        baseLabel: basename,
        nameRoi,
        reference,
        nameBoxStyle: applyArenaRefinement ? "arena" : "tight",
      });
      if (applyArenaRefinement) {
        name = await refineName(
          path.dirname(filePath),
          filePath,
          name,
          worker,
          workerRus,
          { debugDir, baseLabel: basename },
        );
      }

      const latinHintRaw = parseHint(basename);
      const latinHint =
        latinHintRaw !== undefined ? normalizeName(latinHintRaw) : undefined;

      const ocrNameText = String(name ?? "").trim();
      const displayName =
        ocrNameText && /[\p{sc=Cyrillic}]/u.test(ocrNameText)
          ? ocrNameText
          : (latinHint ?? ocrNameText);

      if ((!displayName && !latinHint) || power === undefined) {
        return {
          skip: true,
          reason: `OCR incomplete, skipping: ${filePath} (name="${name}", power="${power ?? ""}")`,
        };
      }

      const art = toLatin(displayName || latinHint || "");
      let finalArt = art;
      if (latinHint) {
        const hintArt = toLatin(latinHint);
        finalArt = {
          ...art,
          latinRaw: hintArt.latinRaw,
          ...(hintArt.nameEnglish ? { nameEnglish: hintArt.nameEnglish } : {}),
        };
        console.log(`Latin label from percent-encoded filename slug: ${latinHint}`);
      }

      const canonicalKey = canonicalEnemyMapKey(filePath, {
        power,
        nameLatinRaw: finalArt.latinRaw,
        nameEnglish: finalArt.nameEnglish,
        nameRaw: displayName || latinHint || "",
      });
      const canonical = path.posix.basename(canonicalKey);

      return {
        record: {
          name: displayName || latinHint || "",
          nameLatin: finalArt.latinRaw,
          power,
          language: null,
          canonical,
          ...(finalArt.nameEnglish ? { nameEnglish: finalArt.nameEnglish } : {}),
        },
        log:
          `OK: ${filePath} -> ${canonical} { power: ${power}, name: "${displayName || latinHint}", ` +
          `alphabet: "${finalArt.alphabet}", latinRaw: "${finalArt.latinRaw}"` +
          `${finalArt.nameEnglish ? `, nameEnglish: "${finalArt.nameEnglish}"` : ""} }`,
        warn,
      };
    },
  };
}
