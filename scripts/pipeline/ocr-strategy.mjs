/**
 * OCR extraction strategy (tesseract) for the shared extraction runner.
 *
 * Mirrors the historical ocr-enemy.mjs per-image logic: filename power wins over OCR,
 * sibling test-folder crops may refine the name, names are transliterated to Latin
 * artifacts, and incomplete results are skipped rather than failed.
 */
import path from "path";
import { fileURLToPath } from "url";
import { createWorker } from "tesseract.js";
import {
  canonicalEnemyMapKey,
  parsePowerFromOriginalBasename,
} from "../file-map-enemies.mjs";
import { convertTextToLatinArtifacts } from "../ocr/convert-text-to-latin.mjs";
import { parseLatinNameHintFromEncodedOriginalBasename } from "../ocr/enemy-filename-tokens.mjs";
import {
  normalizeOpponentDisplayName,
  ocrEnemyName,
  refineEnemyNameWithTestFolderCrops,
} from "../ocr/ocr-enemy-name.mjs";
import { ocrEnemyPower } from "../ocr/ocr-enemy-power.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * @param {{
 *   force?: boolean,
 *   debugCrops?: boolean,
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
export function createOcrStrategy({ force = false, debugCrops = false, deps = {} } = {}) {
  const {
    createWorker: makeWorker = createWorker,
    ocrName = ocrEnemyName,
    refineName = refineEnemyNameWithTestFolderCrops,
    ocrPower = ocrEnemyPower,
    toLatin = convertTextToLatinArtifacts,
    parseHint = parseLatinNameHintFromEncodedOriginalBasename,
    normalizeName = normalizeOpponentDisplayName,
    parsePowerFromFilename = parsePowerFromOriginalBasename,
  } = deps;

  const debugDir = debugCrops ? path.join(__dirname, ".ocr-debug") : undefined;

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
      const powerOcr = await ocrPower(filePath, worker);
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
      });
      name = await refineName(
        path.dirname(filePath),
        filePath,
        name,
        worker,
        workerRus,
        { debugDir, baseLabel: basename },
      );

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
