/**
 * Shared extraction runner: iterate files, apply the strategy's skip gate, extract,
 * persist into per-folder data.json, optionally write the canonical webp and maintain
 * the nested enemy map.
 */
import fs from "fs/promises";
import path from "path";
import { writeWebpFromRasterFile } from "../llm/enemy-image-webp.mjs";
import { toSafeEnemyFilenameToken } from "../ocr/enemy-filename-tokens.mjs";
import {
  buildEnemySourceIndex,
  loadEnemyMap,
  saveEnemyMap,
  setNestedMapping,
  toMapKey,
} from "../enemy-records.mjs";
import { assertStrategy } from "./extraction-strategy.mjs";
import {
  buildStoredRecord,
  readFolderEntries,
  writeFolderEntries,
} from "./data-json-store.mjs";
import { log } from "../log.mjs";

/**
 * @param {Map<string, { folderAbs: string, canonicalKey: string, row: object }>} sourceIndex
 * @param {string} imagePath
 */
async function resolveExistingOutput(sourceIndex, imagePath) {
  const sourceRel = toMapKey(imagePath);
  const hit = sourceIndex.get(sourceRel);
  if (!hit?.canonicalKey) {
    return { sourceRel, row: undefined, webpPath: undefined, exists: false };
  }

  const webpPath = path.join(hit.folderAbs, hit.canonicalKey);
  try {
    await fs.access(webpPath);
    return { sourceRel, row: hit.row, webpPath, exists: true };
  } catch {
    return { sourceRel, row: hit.row, webpPath, exists: false };
  }
}

/** @param {object | undefined} entry */
function mapEntryFromRow(entry) {
  if (!entry || typeof entry !== "object") return undefined;
  const power = Number(entry.power);
  const name = typeof entry.name === "string" ? entry.name.trim() : "";
  if (!Number.isFinite(power) || !name) return undefined;
  const mapEntry = {
    name,
    nameLatin:
      (typeof entry.nameLatin === "string" && entry.nameLatin.trim()) ||
      toSafeEnemyFilenameToken(name),
    power,
  };
  if (typeof entry.nameEnglish === "string" && entry.nameEnglish.trim()) {
    mapEntry.nameEnglish = entry.nameEnglish.trim();
  }
  return mapEntry;
}

/**
 * @param {{
 *   folders: { absPath: string, files: string[] }[],
 *   strategy: import("./extraction-strategy.mjs").ExtractionStrategy,
 *   webp?: boolean,
 *   map?: boolean,
 *   recordTiming?: boolean,
 *   force?: boolean,
 *   logProcessing?: boolean,
 *   logError?: (err: unknown, ctx: { filePath: string, basename: string, folderAbs: string }) => void,
 * }} options
 */
export async function runExtraction({
  folders,
  strategy,
  webp = false,
  map = false,
  recordTiming = false,
  force = false,
  logProcessing = true,
  logError,
  mapLoader = loadEnemyMap,
  mapSaver = saveEnemyMap,
}) {
  assertStrategy(strategy);

  const stats = {
    converted: 0,
    convertedFromMap: 0,
    skipped: 0,
    failed: 0,
    /** @type {number[]} */
    durations: [],
    /** @type {Set<string>} */
    writtenDataFiles: new Set(),
  };

  const totalFiles = folders.reduce((sum, folder) => sum + folder.files.length, 0);
  // Nothing to do: skip strategy.prepare() so CLIs don't spawn workers/connect for a no-op run.
  if (totalFiles === 0) return stats;

  const mapRoot = map ? await mapLoader() : undefined;
  const sourceIndex = map ? buildEnemySourceIndex(mapRoot) : undefined;
  if (sourceIndex) log.debug(`[Debug] indexed ${sourceIndex.size} known source(s)`);
  let mapDirty = false;
  /** @type {Map<string, Record<string, object>>} */
  const entriesByFolder = new Map();
  /**
   * @param {string} folderAbs
   */
  async function entriesFor(folderAbs) {
    const cached = entriesByFolder.get(folderAbs);
    if (cached) return cached;
    const entries = await readFolderEntries(folderAbs);
    entriesByFolder.set(folderAbs, entries);
    return entries;
  }

  await strategy.prepare();
  try {
    for (const { absPath: folderAbs, files } of folders) {
      for (const filePath of files) {
        const basename = path.basename(filePath);
        try {
          const entries = await entriesFor(folderAbs);
          const ctx = { filePath, basename, folderAbs, entries };

          if (strategy.shouldSkip) {
            const reason = await strategy.shouldSkip(ctx);
            if (reason) {
              log.info(reason);
              stats.skipped++;
              continue;
            }
          }

          let mapKey;
          let outputPath;
          let usedMapOnly = false;

          if (map && !force) {
            const existing = await resolveExistingOutput(sourceIndex, filePath);
            if (existing.exists && existing.webpPath) {
              log.info(
                `\n[Skip] ${basename} — WebP exists: ${path.basename(existing.webpPath)}`,
              );
              stats.skipped++;
              continue;
            }
            if (existing.row && existing.webpPath) {
              const mapEntry = mapEntryFromRow(existing.row.entry);
              if (!mapEntry) {
                throw new Error("data.json row exists but is missing name/power.");
              }
              mapKey = existing.row.fullMapKey;
              outputPath = existing.webpPath;
              usedMapOnly = true;
              if (logProcessing) log.info(`\n[Processing] ${basename}`);
              log.info(`\t[Map] Using existing entry -> ${path.basename(outputPath)}`);
            }
          }

          if (!usedMapOnly) {
            if (logProcessing) log.info(`\n[Processing] ${basename}`);

            const startedAt = performance.now();
            const outcome = await strategy.extract(ctx);
            const durationMs = performance.now() - startedAt;

            if ("skip" in outcome && outcome.skip) {
              log.warn(outcome.reason);
              stats.skipped++;
              continue;
            }

            const timing = outcome.durationMs ?? durationMs;
            stats.durations.push(timing);
            log.debug(`\t[Debug] ${basename} ${Math.round(timing)}ms`);
            const { record } = outcome;
            if (outcome.log) log.info(outcome.log);
            if (outcome.warn) log.error(outcome.warn);

            mapKey = `${toMapKey(filePath)}/${record.canonical}`;
            outputPath = path.join(folderAbs, record.canonical);
            if (map) {
              setNestedMapping(mapRoot, mapKey, {
                name: record.name,
                nameLatin: record.nameLatin,
                power: record.power,
                ...(record.nameEnglish ? { nameEnglish: record.nameEnglish } : {}),
              });
              mapDirty = true;
            }

            entries[basename] = buildStoredRecord(record, {
              timing: recordTiming,
              processingMs: timing,
            });
            await writeFolderEntries(folderAbs, entries);
            stats.writtenDataFiles.add(path.join(folderAbs, "data.json"));
          }

          if (!webp) {
            stats.converted++;
            continue;
          }

          if (!force) {
            try {
              await fs.access(outputPath);
              log.info(`\t[Skip] WebP already exists: ${path.basename(outputPath)}`);
              stats.skipped++;
              continue;
            } catch {
              // create
            }
          }

          log.info(`\t[Conversion] -> ${path.basename(outputPath)}`);
          await writeWebpFromRasterFile(filePath, outputPath);
          if (map) mapDirty = true;
          if (usedMapOnly) {
            stats.convertedFromMap++;
          } else {
            stats.converted++;
          }
        } catch (err) {
          stats.failed++;
          if (logError) {
            logError(err, { filePath, basename, folderAbs });
          } else {
            log.error(
              `\t[Error] ${basename}:`,
              err instanceof Error ? err.message : err,
            );
          }
        }
      }
    }
  } finally {
    await strategy.dispose();
  }

  // Persist the nested map once per run instead of after every file. Per-file records
  // are already stored in data.json by writeFolderEntries above.
  if (map && mapDirty) {
    await mapSaver(mapRoot);
    log.info("\t[Data] saved data.json");
  }

  return stats;
}
