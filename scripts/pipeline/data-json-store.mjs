/**
 * Per-folder data.json access for the extraction pipelines.
 *
 * Two record shapes are preserved exactly:
 *  - OCR CLI:      name, nameLatin, power, language, canonical [, nameEnglish]
 *  - convert (LLM/OCR): name, nameLatin, power, language, processingMs, canonical, extractedAt
 */
import fs from "fs/promises";
import path from "path";

/**
 * @param {string} folderAbs
 */
export function dataJsonPath(folderAbs) {
  return path.join(folderAbs, "data.json");
}

/**
 * @param {string} folderAbs
 * @returns {Promise<Record<string, object>>}
 */
export async function readFolderEntries(folderAbs) {
  try {
    const parsed = JSON.parse(await fs.readFile(dataJsonPath(folderAbs), "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch {
    // missing or unreadable -> start empty
  }
  return {};
}

/**
 * @param {string} folderAbs
 * @param {Record<string, object>} entries
 */
export async function writeFolderEntries(folderAbs, entries) {
  await fs.writeFile(dataJsonPath(folderAbs), `${JSON.stringify(entries, null, 2)}\n`, "utf8");
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
