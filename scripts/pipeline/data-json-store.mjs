/**
 * Per-folder data.json access for the extraction pipelines.
 *
 * Two record shapes are preserved exactly:
 *  - OCR CLI:      name, nameLatin, power, language, canonical [, nameEnglish]
 *  - convert (LLM/OCR): name, nameLatin, power, language, processingMs, canonical, extractedAt
 */
import fs from "fs/promises";
import path from "path";
import { writeJsonAtomic } from "../atomic-json.mjs";
import { logOnce } from "../log.mjs";

/** @param {unknown} err */
function errorMessage(err) {
  return err instanceof Error ? err.message : String(err);
}

/**
 * @param {string} folderAbs
 */
function dataJsonPath(folderAbs) {
  return path.join(folderAbs, "data.json");
}

/**
 * @param {string} folderAbs
 * @returns {Promise<Record<string, object>>}
 */
export async function readFolderEntries(folderAbs) {
  const file = dataJsonPath(folderAbs);
  let raw;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (err) {
    // A missing data.json is the normal case for a new folder.
    if (/** @type {NodeJS.ErrnoException} */ (err)?.code !== "ENOENT") {
      logOnce("warn", `data-json-read:${file}`, `[Data] cannot read ${file}: ${errorMessage(err)}`);
    }
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    logOnce("warn", `data-json-shape:${file}`, `[Data] ignoring ${file}: expected a JSON object`);
  } catch (err) {
    logOnce(
      "warn",
      `data-json-parse:${file}`,
      `[Data] ignoring unparseable ${file}: ${errorMessage(err)}`,
    );
  }
  return {};
}

/**
 * @param {string} folderAbs
 * @param {Record<string, object>} entries
 */
export async function writeFolderEntries(folderAbs, entries) {
  await writeJsonAtomic(dataJsonPath(folderAbs), entries);
}

/**
 * @param {import("./extraction-strategy.mjs").ExtractionRecord} record
 * @param {{ timing?: boolean, processingMs?: number }} [options]
 */
export function buildStoredRecord(record, { timing = false, processingMs } = {}) {
  /** @type {Record<string, unknown>} */
  const entry = {
    name: record.name,
    nameLatin: record.nameLatin,
    power: record.power,
    language: record.language ?? null,
  };
  if (timing) {
    entry.processingMs = typeof processingMs === "number" ? Math.round(processingMs) : null;
  }
  entry.canonical = record.canonical ?? null;
  if (timing) entry.extractedAt = new Date().toISOString();
  if (!timing && record.nameEnglish) entry.nameEnglish = record.nameEnglish;
  return entry;
}
