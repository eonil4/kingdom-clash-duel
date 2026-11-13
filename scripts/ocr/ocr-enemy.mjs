/**
 * Scan `data/clan_clash/YYYY-MM-DD` arena folders, OCR each screenshot for name + power,
 * convert names to Latin artifacts, and record entries in each folder's data.json.
 *
 * Discovery/flag handling lives here; the per-image workflow runs through the shared
 * extraction runner with the OCR strategy.
 */
import fs from "fs/promises";
import path from "path";
import {
  loadConfiguredFolders,
  toMapKey,
  WORKSPACE_ROOT,
} from "../enemy-records.mjs";
import { createOcrStrategy } from "../pipeline/ocr-strategy.mjs";
import { runExtraction } from "../pipeline/run-extraction.mjs";
import { loadLlmConfig } from "../llm/vision-client.mjs";
import {
  collectImageFiles,
  groupFilesByFolder,
  parseScanArgs,
  selectTargets,
} from "./scan-cli.mjs";
import { isMain } from "../cli.mjs";

/**
 * In `test/` folders only the primary screenshots are OCR sources; sibling crops
 * are reference images used to refine names.
 * @param {string} folderAbsPath
 * @param {string} filePath
 */
export function isFullScreenshotForOcr(folderAbsPath, filePath) {
  if (path.basename(folderAbsPath).toLowerCase() !== "test") return true;
  const base = path.basename(filePath);
  const lower = base.toLowerCase();
  if (lower === "test.png") return true;
  return /^screenshot_/i.test(base);
}

/**
 * @param {string[]} [argv]
 * @param {{
 *   loadFolders?: typeof loadConfiguredFolders,
 *   collect?: typeof collectImageFiles,
 *   run?: typeof runExtraction,
 *   config?: object,
 *   makeStrategy?: (options: object) => any,
 *   log?: (...args: any[]) => void,
 *   warn?: (...args: any[]) => void,
 * }} [deps]
 */
export async function runOcrEnemyScan(argv = process.argv.slice(2), deps = {}) {
  const {
    loadFolders = loadConfiguredFolders,
    collect = collectImageFiles,
    run = runExtraction,
    config = loadLlmConfig(),
    makeStrategy = (options) => createOcrStrategy(options),
    log = (...args) => console.log(...args),
    warn = (...args) => console.warn(...args),
  } = deps;

  const { limit, only, debugCrops, forceOcr } = parseScanArgs(argv);

  const configuredFolders = await loadFolders();
  let all = [];
  if (configuredFolders.length > 0) {
    for (const folder of configuredFolders) {
      const folderPath = folder.absPath;
      try {
        const stat = await fs.stat(folderPath);
        if (!stat.isDirectory()) {
          warn(`Configured path is not a folder, skipping: ${folderPath}`);
          continue;
        }
        const inFolder = await collect(folderPath);
        for (const fp of inFolder) {
          if (!isFullScreenshotForOcr(folderPath, fp)) {
            log(`Skipping reference crop in test/: ${toMapKey(fp)}`);
            continue;
          }
          all.push(fp);
        }
      } catch {
        warn(`Configured folder not found, skipping: ${folderPath}`);
      }
    }
  }

  const targets = selectTargets(all, { only, limit });

  log(`Scanning workspace: ${WORKSPACE_ROOT}`);
  log(
    `Configured folders: ${
      configuredFolders.length > 0
        ? configuredFolders.map((f) => f.relPath).join(", ")
        : "(none)"
    }`,
  );
  log(`Images: ${targets.length}`);

  const stats = await run({
    folders: groupFilesByFolder(targets),
    strategy: makeStrategy({ force: forceOcr, debugCrops, config }),
    webp: false,
    map: false,
    recordTiming: false,
    logProcessing: false,
    logError: (err, { filePath }) => {
      warn(`Failed OCR: ${filePath}`);
      warn(err);
    },
  });

  if (stats.writtenDataFiles.size > 0) {
    log(`Updated ${stats.writtenDataFiles.size} data.json file(s)`);
  }
  return stats;
}

async function main() {
  await runOcrEnemyScan();
}

if (isMain(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
