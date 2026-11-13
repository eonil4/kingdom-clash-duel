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

async function main() {
  const { limit, only, debugCrops, forceOcr } = parseScanArgs(process.argv.slice(2));

  const configuredFolders = await loadConfiguredFolders();
  let all = [];
  if (configuredFolders.length > 0) {
    for (const folder of configuredFolders) {
      const folderPath = folder.absPath;
      try {
        const stat = await fs.stat(folderPath);
        if (!stat.isDirectory()) {
          console.warn(`Configured path is not a folder, skipping: ${folderPath}`);
          continue;
        }
        const inFolder = await collectImageFiles(folderPath);
        for (const fp of inFolder) {
          if (!isFullScreenshotForOcr(folderPath, fp)) {
            console.log(`Skipping reference crop in test/: ${toMapKey(fp)}`);
            continue;
          }
          all.push(fp);
        }
      } catch {
        console.warn(`Configured folder not found, skipping: ${folderPath}`);
      }
    }
  }

  const targets = selectTargets(all, { only, limit });

  console.log(`Scanning workspace: ${WORKSPACE_ROOT}`);
  console.log(
    `Configured folders: ${
      configuredFolders.length > 0
        ? configuredFolders.map((f) => f.relPath).join(", ")
        : "(none)"
    }`,
  );
  console.log(`Images: ${targets.length}`);

  const stats = await runExtraction({
    folders: groupFilesByFolder(targets),
    strategy: createOcrStrategy({ force: forceOcr, debugCrops, config: loadLlmConfig() }),
    webp: false,
    map: false,
    recordTiming: false,
    logProcessing: false,
    logError: (err, { filePath }) => {
      console.warn(`Failed OCR: ${filePath}`);
      console.warn(err);
    },
  });

  if (stats.writtenDataFiles.size > 0) {
    console.log(`Updated ${stats.writtenDataFiles.size} data.json file(s)`);
  }
}

if (isMain(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
