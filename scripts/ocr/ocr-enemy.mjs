/**
 * Scan `data/clan_clash/YYYY-MM-DD` arena folders, OCR each screenshot for name + power,
 * convert name to Latin artifacts, and record entries in each folder's data.json.
 */
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { createWorker } from "tesseract.js";
import {
  canonicalEnemyMapKey,
  loadConfiguredFolders,
  parsePowerFromOriginalBasename,
  toMapKey,
  WORKSPACE_ROOT,
} from "../file-map-enemies.mjs";
import { convertTextToLatinArtifacts } from "./convert-text-to-latin.mjs";
import { parseLatinNameHintFromEncodedOriginalBasename } from "./enemy-filename-tokens.mjs";
import {
  normalizeOpponentDisplayName,
  ocrEnemyName,
  refineEnemyNameWithTestFolderCrops,
} from "./ocr-enemy-name.mjs";
import { ocrEnemyPower } from "./ocr-enemy-power.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

  const worker = await createWorker("eng+rus");
  const workerRus = await createWorker("rus");
  try {
    await worker.setParameters({ preserve_interword_spaces: "1" });
    await workerRus.setParameters({ preserve_interword_spaces: "1" });

    const debugDir = debugCrops ? path.join(__dirname, ".ocr-debug") : undefined;

    /** @type {Set<string>} */
    const writtenDataFiles = new Set();
    /** @type {Map<string, { path: string, entries: Record<string, object> }>} */
    const dataByFolder = new Map();
    async function readFolderData(folder) {
      const cached = dataByFolder.get(folder);
      if (cached) return cached;
      const dataPath = path.join(folder, "data.json");
      let entries = {};
      try {
        const parsed = JSON.parse(await fs.readFile(dataPath, "utf8"));
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) entries = parsed;
      } catch {
        entries = {};
      }
      const record = { path: dataPath, entries };
      dataByFolder.set(folder, record);
      return record;
    }

    for (const filePath of targets) {
      const base = path.basename(filePath);
      try {
        const folderData = await readFolderData(path.dirname(filePath));
        if (!forceOcr && folderData.entries[base]) {
          console.log(
            `Skipping OCR for recorded image (use --force-ocr to refresh): ${filePath}`,
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

        const latinHintRaw = parseLatinNameHintFromEncodedOriginalBasename(base);
        const latinHint =
          latinHintRaw !== undefined
            ? normalizeOpponentDisplayName(latinHintRaw)
            : undefined;

        const ocrName = String(name ?? "").trim();
        const displayName = (() => {
          if (ocrName && /[\p{sc=Cyrillic}]/u.test(ocrName)) return ocrName;
          if (latinHint) return latinHint;
          return ocrName;
        })();

        if ((!displayName && !latinHint) || power === undefined) {
          console.warn(
            `OCR incomplete, skipping: ${filePath} (name="${name}", power="${power ?? ""}")`,
          );
          continue;
        }

        const art = convertTextToLatinArtifacts(displayName || latinHint || "");
        let finalArt = art;
        if (latinHint) {
          const hintArt = convertTextToLatinArtifacts(latinHint);
          finalArt = {
            ...art,
            latinRaw: hintArt.latinRaw,
            ...(hintArt.nameEnglish ? { nameEnglish: hintArt.nameEnglish } : {}),
          };
          console.log(`Latin label from percent-encoded filename slug: ${latinHint}`);
        }

        const mapKeyCanonical = canonicalEnemyMapKey(filePath, {
          power,
          nameLatinRaw: finalArt.latinRaw,
          nameEnglish: finalArt.nameEnglish,
          nameRaw: displayName || latinHint || "",
        });
        folderData.entries[base] = {
          name: displayName || latinHint || "",
          nameLatin: finalArt.latinRaw,
          power,
          language: null,
          canonical: path.posix.basename(mapKeyCanonical),
          ...(finalArt.nameEnglish ? { nameEnglish: finalArt.nameEnglish } : {}),
        };
        await fs.writeFile(
          folderData.path,
          `${JSON.stringify(folderData.entries, null, 2)}\n`,
          "utf8",
        );
        writtenDataFiles.add(folderData.path);
        console.log(
          `OK: ${filePath} -> ${path.posix.basename(mapKeyCanonical)} { power: ${power}, name: "${displayName || latinHint}", alphabet: "${finalArt.alphabet}", latinRaw: "${finalArt.latinRaw}"${finalArt.nameEnglish ? `, nameEnglish: "${finalArt.nameEnglish}"` : ""} }`,
        );
      } catch (e) {
        console.warn(`Failed OCR: ${filePath}`);
        console.warn(e);
      }
    }

    if (writtenDataFiles.size > 0) {
      console.log(`Updated ${writtenDataFiles.size} data.json file(s)`);
    }
  } finally {
    await worker.terminate();
    await workerRus.terminate();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

