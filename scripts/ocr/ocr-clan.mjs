/**
 * OCR clan formation screenshots (`data/clan_clash/YYYY-MM-DD/clan`) for name + power.
 *
 * Uses the same shared runner and OCR strategy as the arena pipeline, with the
 * `clan` ROIs from config/llm.json (scaled from `roiReference`).
 */
import fs from "fs/promises";
import path from "path";
import { toMapKey, WORKSPACE_ROOT } from "../enemy-records.mjs";
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

/**
 * `data/clan_clash/<date>/clan` folders that exist and contain images.
 * @returns {Promise<{ absPath: string, relPath: string }[]>}
 */
async function discoverClanFolders() {
  const root = path.join(WORKSPACE_ROOT, "data", "clan_clash");
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const out = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^\d{4}-\d{2}-\d{2}$/.test(entry.name)) continue;
    const absPath = path.join(root, entry.name, "clan");
    try {
      const files = await fs.readdir(absPath);
      if (!files.some((f) => SUPPORTED_IMAGE_EXTENSIONS.has(path.extname(f).toLowerCase()))) {
        continue;
      }
    } catch {
      continue;
    }
    out.push({
      absPath,
      relPath: path.relative(WORKSPACE_ROOT, absPath).split(path.sep).join("/"),
    });
  }
  return out.sort((a, b) => a.relPath.localeCompare(b.relPath));
}

async function main() {
  const { limit, only, debugCrops, forceOcr } = parseArgs(process.argv.slice(2));

  const clanFolders = await discoverClanFolders();
  let all = [];
  for (const folder of clanFolders) {
    all.push(...(await collectImageFilesInFolderOnly(folder.absPath)));
  }

  const targets = only
    ? all.filter(
        (p) =>
          path.basename(p) === only ||
          toMapKey(p) === only ||
          toMapKey(p).endsWith(`/${only}`),
      )
    : all.slice(0, typeof limit === "number" ? limit : all.length);

  console.log(`Scanning workspace: ${WORKSPACE_ROOT}`);
  console.log(
    `Clan folders: ${
      clanFolders.length > 0 ? clanFolders.map((f) => f.relPath).join(", ") : "(none)"
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
    strategy: createOcrStrategy({
      force: forceOcr,
      debugCrops,
      targetKey: "clan",
      config: loadLlmConfig(),
    }),
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
