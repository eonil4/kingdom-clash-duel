import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import sharp from "sharp";
import { toSafeEnemyFilenameToken } from "./enemy-filename-tokens.mjs";
import {
  collectEnemyEntriesFromMap,
  isFileEntryNode,
  loadConfiguredFoldersFromRoot,
} from "./file-map-enemies.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const WORKSPACE_ROOT = path.join(__dirname, "..");
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

const DEFAULT_MAP_PATH = path.join(__dirname, "fileMap.json");
const OCR_SCRIPT_PATH = path.join(__dirname, "ocr-enemy.mjs");

function parseArgs(argv) {
  const args = { only: undefined, skipOcr: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--" || a === undefined) continue;
    if (a === "--only") args.only = argv[++i];
    else if (a === "--skip-ocr") args.skipOcr = true;
  }
  if (process.env.RENAME_SKIP_OCR === "1") args.skipOcr = true;
  return args;
}

async function refreshFileMapWithOcr({ only } = {}) {
  const ocrArgs = [OCR_SCRIPT_PATH];
  if (only) ocrArgs.push("--only", only);
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ocrArgs, {
      cwd: path.join(__dirname, ".."),
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`OCR step failed with exit code ${code ?? "unknown"}`));
    });
  });
}

async function loadFileMap() {
  try {
    const raw = await fs.readFile(DEFAULT_MAP_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}

function formatPower(power) {
  const s = String(power).padStart(9, "0");
  return `${s.slice(0, 3)}_${s.slice(3, 6)}_${s.slice(6, 9)}`;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Windows often returns EBUSY right after Sharp finishes writing the new file. */
async function unlinkWithRetry(filePath, { attempts = 10, baseMs = 40 } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      await fs.unlink(filePath);
      return;
    } catch (e) {
      lastErr = e;
      const code = e && typeof e === "object" && "code" in e ? e.code : undefined;
      if ((code === "EBUSY" || code === "EPERM") && i < attempts - 1) {
        await delay(baseMs * (i + 1));
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
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

function toMapKey(filePath) {
  return path
    .relative(WORKSPACE_ROOT, filePath)
    .split(path.sep)
    .join("/");
}

function getNestedMapping(source, mapKey) {
  const parts = mapKey.split("/").filter(Boolean);
  let cursor = source;
  for (const part of parts) {
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) return undefined;
    cursor = cursor[part];
  }
  if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) return undefined;
  return cursor;
}

function getNestedFolderNode(source, folderRelPosix) {
  const parts = folderRelPosix.split("/").filter(Boolean);
  let cursor = source;
  for (const part of parts) {
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) return undefined;
    cursor = cursor[part];
  }
  return cursor;
}

/**
 * Resolve mapping when JSON keys are canonical `.webp` names but disk files still use original
 * names. Prefer `originalFileName` (set by OCR); then legacy `sourceFile`; else single-pair heuristic.
 */
async function getMappingForRename(mapRoot, filePath) {
  const mapKey = toMapKey(filePath);
  const direct = getNestedMapping(mapRoot, mapKey);
  if (direct && isFileEntryNode(direct)) return direct;

  const parentRel = path.posix.dirname(mapKey);
  if (parentRel === "." || parentRel === "") return undefined;

  const folderNode = getNestedFolderNode(mapRoot, parentRel);
  if (!folderNode || typeof folderNode !== "object") return undefined;

  const base = path.posix.basename(mapKey);

  const branch = folderNode[base];
  if (branch && typeof branch === "object" && !isFileEntryNode(branch)) {
    for (const [, wv] of Object.entries(branch)) {
      if (isFileEntryNode(wv)) return wv;
    }
  }

  for (const [, v] of Object.entries(folderNode)) {
    if (!isFileEntryNode(v)) continue;
    if (typeof v.originalFileName === "string" && v.originalFileName === base) return v;
    if (typeof v.sourceFile === "string" && v.sourceFile === base) return v;
  }

  const dirAbs = path.dirname(filePath);
  let diskFiles;
  try {
    diskFiles = await collectImageFilesInFolderOnly(dirAbs);
  } catch {
    return undefined;
  }

  const diskBasenames = new Set(diskFiles.map((p) => path.posix.basename(toMapKey(p))));

  /** @type {{ webpKey: string, mapPath: string }[]} */
  const indexedEntries = [];
  for (const [k, val] of Object.entries(folderNode)) {
    if (isFileEntryNode(val)) {
      indexedEntries.push({ webpKey: k, mapPath: path.posix.join(parentRel, k) });
    } else if (val && typeof val === "object") {
      for (const [wk] of Object.entries(val)) {
        if (isFileEntryNode(val[wk])) {
          indexedEntries.push({
            webpKey: wk,
            mapPath: path.posix.join(parentRel, k, wk),
          });
        }
      }
    }
  }

  const canonicalKeysNotOnDisk = indexedEntries.filter((e) => !diskBasenames.has(e.webpKey));
  const diskFilesWithoutDirectKey = diskFiles.filter((p) => !getNestedMapping(mapRoot, toMapKey(p)));

  if (canonicalKeysNotOnDisk.length === 1 && diskFilesWithoutDirectKey.length === 1) {
    return getNestedMapping(mapRoot, canonicalKeysNotOnDisk[0].mapPath);
  }

  return undefined;
}

/** Canonical `.webp` basename for this mapping (flat or under `<original>.png/` node). */
function findCanonicalKeyForMapping(folderNode, mapping) {
  if (!folderNode || typeof folderNode !== "object") return null;
  for (const [k, v] of Object.entries(folderNode)) {
    if (isFileEntryNode(v) && v === mapping) return k;
    if (v && typeof v === "object" && !isFileEntryNode(v)) {
      for (const [wk, wv] of Object.entries(v)) {
        if (isFileEntryNode(wv) && wv === mapping) return wk;
      }
    }
  }
  return null;
}

/**
 * Plans driven by fileMap: each file entry with `originalFileName` renames/converts to the
 * object key (canonical `.webp` basename), not a recomputed name from power/nameLatin.
 */
async function collectRenamePlansFromMapOriginalNames(mapRoot, only) {
  const plans = [];
  for (const row of collectEnemyEntriesFromMap(mapRoot, WORKSPACE_ROOT)) {
    let orig = row.originalFileName?.trim();
    if (!orig && typeof row.entry.originalFileName === "string") {
      orig = row.entry.originalFileName.trim();
    }
    if (!orig) continue;

    const canonicalKey = row.canonicalKey;
    if (orig === canonicalKey) continue;

    const fromPath = path.join(row.folderAbs, orig);
    const toPath = path.join(row.folderAbs, canonicalKey);

    if (only) {
      const mapKeyFrom = toMapKey(fromPath);
      const fromBase = path.basename(fromPath);
      if (
        fromBase !== only &&
        mapKeyFrom !== only &&
        canonicalKey !== only &&
        orig !== only
      ) {
        continue;
      }
    }

    try {
      await fs.access(fromPath);
    } catch {
      console.warn(
        `Map entry missing source file (originalFileName \"${orig}\" for key \"${canonicalKey}\"), skipping`,
      );
      continue;
    }

    if (path.resolve(fromPath) === path.resolve(toPath)) continue;

    const sourceExt = path.extname(fromPath).toLowerCase();
    const mode = sourceExt !== ".webp" ? "convert" : "rename";
    plans.push({ filePath: fromPath, newPath: toPath, mode });
  }
  return plans;
}

async function main() {
  const { only, skipOcr } = parseArgs(process.argv.slice(2));
  if (!skipOcr) {
    console.log("Refreshing file map with OCR...");
    await refreshFileMapWithOcr({ only });
  } else {
    console.log("Skipping OCR (--skip-ocr / RENAME_SKIP_OCR=1).");
  }
  const fileMap = await loadFileMap();
  const mapRoot =
    fileMap && typeof fileMap === "object" && !Array.isArray(fileMap)
      ? fileMap
      : {};
  const configuredFolders = await loadConfiguredFoldersFromRoot(mapRoot);
  const imageFiles = [];
  for (const folder of configuredFolders) {
    imageFiles.push(...(await collectImageFilesInFolderOnly(folder.absPath)));
  }
  console.log(`Scanning workspace: ${WORKSPACE_ROOT}`);
  console.log(
    `Configured folders: ${
      configuredFolders.length > 0
        ? configuredFolders.map((f) => f.relPath).join(", ")
        : "(none)"
    }`,
  );

  /** @type {{ filePath: string, newPath: string, mode: "rename" | "convert" }[]} */
  const mapPlans = await collectRenamePlansFromMapOriginalNames(mapRoot, only);
  const usedFrom = new Set(mapPlans.map((p) => path.resolve(p.filePath)));
  const renamePlans = [...mapPlans];

  for (const filePath of imageFiles) {
    if (usedFrom.has(path.resolve(filePath))) continue;

    const dir = path.dirname(filePath);
    const oldName = path.basename(filePath);
    const mapKey = toMapKey(filePath);
    if (only && oldName !== only && mapKey !== only) continue;

    const mapping = await getMappingForRename(mapRoot, filePath);
    if (!mapping) {
      console.warn(
        `No mapping for file, skipping: ${filePath} (re-run OCR so each entry has \"originalFileName\", or name the file like the map key)`,
      );
      continue;
    }

    const parentRel = path.posix.dirname(mapKey);
    const folderNode = getNestedFolderNode(mapRoot, parentRel);
    const canonicalKey = folderNode
      ? findCanonicalKeyForMapping(folderNode, mapping)
      : null;

    const { power, name, nameLatin, nameEnglish } = mapping;
    const formattedPower = formatPower(power);
    const latinNameToken = toSafeEnemyFilenameToken(String(nameLatin || name || ""));
    const englishNameToken = toSafeEnemyFilenameToken(String(nameEnglish || ""));
    const newName = englishNameToken
      ? `${formattedPower}-${latinNameToken}-${englishNameToken}.webp`
      : `${formattedPower}-${latinNameToken}.webp`;
    const newPath = canonicalKey
      ? path.join(dir, canonicalKey)
      : path.join(dir, newName);

    if (newPath === filePath) {
      console.log(`Name already correct, skipping: ${filePath}`);
      continue;
    }

    const sourceExt = path.extname(filePath).toLowerCase();
    const mode = sourceExt !== ".webp" ? "convert" : "rename";
    renamePlans.push({ filePath, newPath, mode });
  }

  renamePlans.sort((a, b) => {
    if (a.mode === b.mode) return 0;
    if (a.mode === "convert" && b.mode === "rename") return -1;
    return 1;
  });

  console.log(`Applying ${renamePlans.length} rename / convert operation(s)…`);
  for (const { filePath, newPath, mode } of renamePlans) {
    if (mode === "convert") {
      try {
        await fs.access(newPath);
        console.warn(`Target already exists, skipping conversion: ${newPath}`);
        try {
          await fs.access(filePath);
          await unlinkWithRetry(filePath);
          console.log(`Removed leftover source after prior run: ${filePath}`);
        } catch {
          // source already removed
        }
        continue;
      } catch {
        // target does not exist
      }
      console.log(`Converting to webp:\n  ${filePath}\n  -> ${newPath}`);
      const sourceMeta = await sharp(filePath).metadata();
      const sourceDensity =
        Number.isFinite(sourceMeta.density) && sourceMeta.density > 0
          ? sourceMeta.density
          : undefined;
      let converter = sharp(filePath).webp({ quality: 82 });
      if (sourceDensity) {
        converter = converter.withMetadata({ density: sourceDensity });
      } else {
        converter = converter.withMetadata();
      }
      await converter.toFile(newPath);
      await unlinkWithRetry(filePath);
      continue;
    }

    console.log(`Renaming:\n  ${filePath}\n  -> ${newPath}`);
    await fs.rename(filePath, newPath);
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
