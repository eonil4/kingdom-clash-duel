/**
 * The extraction strategy contract shared by the OCR and LLM pipelines.
 *
 * A strategy turns one source image into an enemy record (or a skip), and owns its own
 * resources (e.g. tesseract workers) and retry policy. The runner
 * (`run-extraction.mjs`) owns iteration, skip/persist/webp orchestration.
 *
 * @typedef {Object} ExtractionContext
 * @property {string} filePath       absolute source image path
 * @property {string} basename       source file name
 * @property {string} folderAbs      absolute folder that owns data.json
 * @property {Record<string, object>} entries current data.json entries for that folder
 *
 * @typedef {Object} ExtractionRecord
 * @property {string} name
 * @property {string} nameLatin
 * @property {number} power
 * @property {string|null} language
 * @property {string} canonical      canonical .webp basename
 * @property {string} [nameEnglish]
 *
 * @typedef {Object} ExtractionOutcome
 * @property {ExtractionRecord} record  present when extraction succeeded
 * @property {number} [durationMs]
 * @property {string} [log]             console.log line for the runner to emit
 * @property {string} [warn]            console.error line for the runner to emit
 *
 * @typedef {Object} ExtractionStrategy
 * @property {string} id
 * @property {string} logTag
 * @property {() => Promise<void>} prepare
 * @property {() => Promise<void>} dispose
 * @property {(ctx: ExtractionContext) => Promise<string | undefined>} [shouldSkip]
 *   Return a ready-to-log reason to skip the file without calling extract().
 * @property {(ctx: ExtractionContext) => Promise<ExtractionOutcome | { skip: true, reason: string }>} extract
 *   Throws on failure; returns `{ skip: true, reason }` for "nothing usable here".
 */

/**
 * @param {Partial<ExtractionStrategy>} strategy
 * @returns {ExtractionStrategy}
 */
export function assertStrategy(strategy) {
  if (!strategy || typeof strategy !== "object") {
    throw new TypeError("Extraction strategy must be an object.");
  }
  for (const method of ["prepare", "dispose", "extract"]) {
    if (typeof strategy[method] !== "function") {
      throw new TypeError(`Extraction strategy is missing ${method}().`);
    }
  }
  if (typeof strategy.id !== "string" || !strategy.id) {
    throw new TypeError("Extraction strategy must have a non-empty id.");
  }
  return /** @type {ExtractionStrategy} */ (strategy);
}
