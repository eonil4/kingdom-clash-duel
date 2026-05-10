/**
 * Scan configured folders from fileMap.json, OCR each screenshot for name + power,
 * convert name to Latin artifacts, and write entries under canonical `.webp` keys.
 */
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { createWorker } from "tesseract.js";
import {
  canonicalEnemyMapKey,
  DEFAULT_FILE_MAP_PATH,
  deleteNestedMappingKey,
  findEnemyRowBySourceRel,
  loadConfiguredFolders,
  loadExistingFileMap,
  parsePowerFromOriginalBasename,
  setNestedMapping,
  sortMapNode,
  toMapKey,
  WORKSPACE_ROOT,
} from "./file-map-enemies.mjs";
import { convertTextToLatinArtifacts } from "./convert-text-to-latin.mjs";
import { ocrEnemyName, refineEnemyNameWithTestFolderCrops } from "./ocr-enemy-name.mjs";
import { ocrEnemyPower } from "./ocr-enemy-power.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SUPPORTED_IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".bmp",
  ".tif",
  ".tiff",
  ".gif",
]);

function parseArgs(argv) {
  const args = {
    out: DEFAULT_FILE_MAP_PATH,
    limit: undefined,
    only: undefined,
    debugCrops: false,
    forceOcr: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--" || a === undefined) continue;
    if (a === "--out") args.out = path.resolve(argv[++i]);
    else if (a === "--limit") args.limit = Number(argv[++i]);
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
  const { out, limit, only, debugCrops, forceOcr } = parseArgs(process.argv.slice(2));

  const configuredFolders = await loadConfiguredFolders(out);
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

  const worker = await createWorker("eng+rus");
  const workerRus = await createWorker("rus");
  try {
    await worker.setParameters({ preserve_interword_spaces: "1" });
    await workerRus.setParameters({ preserve_interword_spaces: "1" });

    const fileMap = await loadExistingFileMap(out);
    const debugDir = debugCrops ? path.join(__dirname, ".ocr-debug") : undefined;

    for (const filePath of targets) {
      const base = path.basename(filePath);
      const mapKeySource = toMapKey(filePath);
      try {
        if (!forceOcr && findEnemyRowBySourceRel(fileMap, mapKeySource)) {
          console.log(
            `Skipping OCR for mapped source image (use --force-ocr to refresh): ${filePath}`,
          );
          continue;
        }
        if (!forceOcr && /^\d{3}_\d{3}_\d{3}-.+\.webp$/i.test(base)) {
          console.log(
            `Skipping OCR for canonical .webp file (use --force-ocr to refresh): ${filePath}`,
          );
          continue;
        }

        const powerFromFilename = parsePowerFromOriginalBasename(base);
        const powerOcr = await ocrEnemyPower(filePath, worker);
        const power =
          powerFromFilename !== undefined ? powerFromFilename : powerOcr;

        if (
          powerFromFilename !== undefined &&
          powerOcr !== undefined &&
          powerFromFilename !== powerOcr
        ) {
          console.warn(
            `Using filename power ${powerFromFilename} (OCR said ${powerOcr}): ${base}`,
          );
        }

        let name = await ocrEnemyName(filePath, worker, workerRus, {
          debugDir,
          baseLabel: base,
        });
        name = await refineEnemyNameWithTestFolderCrops(
          path.dirname(filePath),
          filePath,
          name,
          worker,
          workerRus,
          { debugDir, baseLabel: base },
        );

        if (!name || power === undefined) {
          console.warn(
            `OCR incomplete, skipping: ${filePath} (name="${name}", power="${power ?? ""}")`,
          );
          continue;
        }

        const art = convertTextToLatinArtifacts(name);
        const mapKeyCanonical = canonicalEnemyMapKey(filePath, {
          power,
          nameLatinRaw: art.latinRaw,
          nameEnglish: art.nameEnglish,
        });
        const prevRow = findEnemyRowBySourceRel(fileMap, mapKeySource);
        if (prevRow && prevRow.fullMapKey !== mapKeyCanonical) {
          deleteNestedMappingKey(fileMap, prevRow.fullMapKey);
        }
        setNestedMapping(fileMap, mapKeyCanonical, {
          power,
          name,
          nameLatin: art.latinRaw,
          ...(art.nameEnglish ? { nameEnglish: art.nameEnglish } : {}),
        });
        console.log(
          `OK: ${filePath} -> ${path.posix.basename(mapKeyCanonical)} { power: ${power}, name: "${name}", alphabet: "${art.alphabet}", latinRaw: "${art.latinRaw}"${art.nameEnglish ? `, nameEnglish: "${art.nameEnglish}"` : ""} }`,
        );
      } catch (e) {
        console.warn(`Failed OCR: ${filePath}`);
        console.warn(e);
      }
    }

    const sortedFileMap = sortMapNode(fileMap);
    await fs.mkdir(path.dirname(out), { recursive: true });
    await fs.writeFile(out, JSON.stringify(sortedFileMap, null, 2) + "\n", "utf8");
    console.log(`Wrote: ${out}`);
  } finally {
    await worker.terminate();
    await workerRus.terminate();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
