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
  findEnemyRowBySourceRel,
  loadExistingFileMap,
  saveFileMap,
  setNestedMapping,
  toMapKey,
} from "../file-map-enemies.mjs";
import { assertStrategy } from "./extraction-strategy.mjs";
import {
  buildStoredRecord,
  readFolderEntries,
  writeFolderEntries,
} from "./data-json-store.mjs";

/**
 * @param {object} mapRoot
 * @param {string} imagePath
 */
async function resolveExistingOutput(mapRoot, imagePath) {
  const sourceRel = toMapKey(imagePath);
  const row = findEnemyRowBySourceRel(mapRoot, sourceRel);
  if (!row?.canonicalKey) {
    return { sourceRel, row: undefined, webpPath: undefined, exists: false };
  }

  const webpPath = path.join(row.folderAbs, row.canonicalKey);
  try {
    await fs.access(webpPath);
    return { sourceRel, row, webpPath, exists: true };
  } catch {
    return { sourceRel, row, webpPath, exists: false };
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
 *   cacheEntries?: boolean,
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
  cacheEntries = true,
  logError,
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

  const mapRoot = map ? await loadExistingFileMap() : undefined;
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
          // With `map`, saveFileMap may add keys mid-run; re-read to avoid dropping them.
          const entries = cacheEntries
            ? await entriesFor(folderAbs)
            : await readFolderEntries(folderAbs);
          const ctx = { filePath, basename, folderAbs, entries };

          if (strategy.shouldSkip) {
            const reason = await strategy.shouldSkip(ctx);
            if (reason) {
              console.log(reason);
              stats.skipped++;
              continue;
            }
          }

          let mapKey;
          let outputPath;
          let usedMapOnly = false;

          if (map && !force) {
            const existing = await resolveExistingOutput(mapRoot, filePath);
            if (existing.exists && existing.webpPath) {
              console.log(
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
              if (logProcessing) console.log(`\n[Processing] ${basename}`);
              console.log(`\t[Map] Using existing entry -> ${path.basename(outputPath)}`);
            }
          }

          if (!usedMapOnly) {
            if (logProcessing) console.log(`\n[Processing] ${basename}`);

            const startedAt = performance.now();
            const outcome = await strategy.extract(ctx);
            const durationMs = performance.now() - startedAt;

            if ("skip" in outcome && outcome.skip) {
              console.warn(outcome.reason);
              stats.skipped++;
              continue;
            }

            const timing = outcome.durationMs ?? durationMs;
            stats.durations.push(timing);
            const { record } = outcome;
            if (outcome.log) console.log(outcome.log);
            if (outcome.warn) console.error(outcome.warn);

            mapKey = `${toMapKey(filePath)}/${record.canonical}`;
            outputPath = path.join(folderAbs, record.canonical);
            if (map) {
              setNestedMapping(mapRoot, mapKey, {
                name: record.name,
                nameLatin: record.nameLatin,
                power: record.power,
                ...(record.nameEnglish ? { nameEnglish: record.nameEnglish } : {}),
              });
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
              console.log(`\t[Skip] WebP already exists: ${path.basename(outputPath)}`);
              if (!usedMapOnly && map) {
                await saveFileMap(mapRoot);
                console.log("\t[Data] saved data.json");
              }
              stats.skipped++;
              continue;
            } catch {
              // create
            }
          }

          console.log(`\t[Conversion] -> ${path.basename(outputPath)}`);
          await writeWebpFromRasterFile(filePath, outputPath);
          if (map) {
            await saveFileMap(mapRoot);
            console.log("\t[Data] saved data.json");
          }
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
            console.error(
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

  return stats;
}
