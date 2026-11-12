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

const SUPPORTED_IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".bmp",
  ".tif",
  ".tiff",
  ".gif",
]);

function parseArgs(argv) {
  const args = {
    limit: undefined,
    only: undefined,
    debugCrops: false,
    forceOcr: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--" || a === undefined) continue;
    if (a === "--limit") args.limit = Number(argv[++i]);
    else if (a === "--only") args.only = argv[++i];
    else if (a === "--debug-crops") args.debugCrops = true;
    else if (a === "--force-ocr") args.forceOcr = true;
  }
  return args;
}

function isFullScreenshotForOcr(folderAbsPath, filePath) {
  if (path.basename(folderAbsPath).toLowerCase() !== "test") return true;
  const base = path.basename(filePath);
  const lower = base.toLowerCase();
  if (lower === "test.png") return true;
  return /^screenshot_/i.test(base);
}

async function collectImageFilesInFolderOnly(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!SUPPORTED_IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
    files.push(path.join(dir, entry.name));
  }
  return files;
}

async function main() {
  const { limit, only, debugCrops, forceOcr } = parseArgs(process.argv.slice(2));

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
        const inFolder = await collectImageFilesInFolderOnly(folderPath);
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

  const targets = only
    ? (() => {
        const m = all.filter(
          (p) =>
            path.basename(p) === only ||
            toMapKey(p) === only ||
            toMapKey(p).endsWith(`/${only}`),
        );
        if (m.length <= 1) return m;
        m.sort((a, b) => b.split(path.sep).length - a.split(path.sep).length);
        return [m[0]];
      })()
    : all.slice(0, typeof limit === "number" ? limit : all.length);

  console.log(`Scanning workspace: ${WORKSPACE_ROOT}`);
  console.log(
    `Configured folders: ${
      configuredFolders.length > 0
        ? configuredFolders.map((f) => f.relPath).join(", ")
        : "(none)"
    }`,
  );
  console.log(`Images: ${targets.length}`);

  /** @type {Map<string, string[]>} */
  const filesByFolder = new Map();
  for (const filePath of targets) {
    const folderAbs = path.dirname(filePath);
    if (!filesByFolder.has(folderAbs)) filesByFolder.set(folderAbs, []);
    filesByFolder.get(folderAbs).push(filePath);
  }

  const stats = await runExtraction({
    folders: [...filesByFolder].map(([absPath, files]) => ({ absPath, files })),
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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
