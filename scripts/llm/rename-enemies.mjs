import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import { writeWebpFromRasterFile } from "./enemy-image-webp.mjs";
import { toSafeEnemyFilenameToken } from "../ocr/enemy-filename-tokens.mjs";
import {
  collectEnemyEntriesFromMap,
  formatPowerForFilename,
  isFileEntryNode,
  loadConfiguredFoldersFromRoot,
  loadEnemyMap,
  WORKSPACE_ROOT,
} from "../enemy-records.mjs";
import { isMain } from "../cli.mjs";

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

const OCR_SCRIPT_PATH = path.join(__dirname, "..", "ocr", "ocr-enemy.mjs");

export function parseArgs(argv) {
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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Windows often returns EBUSY right after Sharp finishes writing the new file. */
export async function unlinkWithRetry(filePath, { attempts = 10, baseMs = 40 } = {}) {
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

export async function collectImageFilesInFolderOnly(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!SUPPORTED_IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
    files.push(path.join(dir, entry.name));
  }

  return files;
}

export function toMapKey(filePath, workspaceRoot = WORKSPACE_ROOT) {
  return path
    .relative(workspaceRoot, filePath)
    .split(path.sep)
    .join("/");
}

export function getNestedMapping(source, mapKey) {
  const parts = mapKey.split("/").filter(Boolean);
  let cursor = source;
  for (const part of parts) {
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) return undefined;
    cursor = cursor[part];
  }
  if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) return undefined;
  return cursor;
}

export function getNestedFolderNode(source, folderRelPosix) {
  const parts = folderRelPosix.split("/").filter(Boolean);
  let cursor = source;
  for (const part of parts) {
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) return undefined;
    cursor = cursor[part];
  }
  return cursor;
}

/**
 * Canonical basename for a map entry: the Latin token wins, and the English token
 * is appended only when it differs.
 * @param {{ power: number, name?: string, nameLatin?: string, nameEnglish?: string }} entry
 */
export function buildTargetBasename(entry) {
  const { power, name, nameLatin, nameEnglish } = entry ?? {};
  const formattedPower = formatPowerForFilename(power);
  const latinNameToken = toSafeEnemyFilenameToken(String(nameLatin || name || ""));
  const englishNameToken = toSafeEnemyFilenameToken(String(nameEnglish || ""));
  const englishSuffix =
    englishNameToken && englishNameToken !== latinNameToken ? `-${englishNameToken}` : "";
  return `${formattedPower}-${latinNameToken}${englishSuffix}.webp`;
}

/**
 * Plans from map rows that still carry an `originalFileName`.
 * @param {object} mapRoot
 * @param {string | undefined} only
 * @param {string} [workspaceRoot]
 * @returns {Promise<{ filePath: string, newPath: string, mode: "rename" | "convert" }[]>}
 */
export async function collectRenamePlansFromMap(
  mapRoot,
  only,
  workspaceRoot = WORKSPACE_ROOT,
) {
  const plans = [];
  for (const row of collectEnemyEntriesFromMap(mapRoot, workspaceRoot)) {
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
      const mapKeyFrom = toMapKey(fromPath, workspaceRoot);
      const fromBase = path.basename(fromPath);
      if (fromBase !== only && mapKeyFrom !== only && canonicalKey !== only && orig !== only) {
        continue;
      }
    }

    try {
      await fs.access(fromPath);
    } catch {
      console.warn(
        `Map entry missing source file (originalFileName "${orig}" for key "${canonicalKey}"), skipping`,
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

/**
 * Find the map entry for a disk file: direct key, canonical key in the folder,
 * single-missing/single-unmapped pairing, or `originalFileName`/`sourceFile` match.
 * @param {object} mapRoot
 * @param {string} filePath
 */
export async function getMappingForRename(mapRoot, filePath) {
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
          indexedEntries.push({ webpKey: wk, mapPath: path.posix.join(parentRel, k, wk) });
        }
      }
    }
  }

  const canonicalKeysNotOnDisk = indexedEntries.filter((e) => !diskBasenames.has(e.webpKey));
  const diskFilesWithoutDirectKey = diskFiles.filter(
    (p) => !getNestedMapping(mapRoot, toMapKey(p)),
  );

  if (canonicalKeysNotOnDisk.length === 1 && diskFilesWithoutDirectKey.length === 1) {
    return getNestedMapping(mapRoot, canonicalKeysNotOnDisk[0].mapPath);
  }

  return undefined;
}

/**
 * Apply rename/convert plans (conversions first); logs each operation.
 * @param {{ filePath: string, newPath: string, mode: "rename" | "convert" }[]} plans
 */
export async function applyRenamePlans(plans) {
  for (const { filePath, newPath, mode } of plans) {
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
      await writeWebpFromRasterFile(filePath, newPath);
      await unlinkWithRetry(filePath);
      continue;
    }

    console.log(`Renaming:\n  ${filePath}\n  -> ${newPath}`);
    await fs.rename(filePath, newPath);
  }
}

async function main() {
  const { only, skipOcr } = parseArgs(process.argv.slice(2));
  if (!skipOcr) {
    console.log("Refreshing file map with OCR...");
    await refreshFileMapWithOcr({ only });
  } else {
    console.log("Skipping OCR (--skip-ocr / RENAME_SKIP_OCR=1).");
  }
  const mapRoot = await loadEnemyMap();
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
  const mapPlans = await collectRenamePlansFromMap(mapRoot, only);

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
        `No mapping for file, skipping: ${filePath} (re-run OCR so each entry has "originalFileName", or name the file like the map key)`,
      );
      continue;
    }

    const parentRel = path.posix.dirname(mapKey);
    const folderNode = getNestedFolderNode(mapRoot, parentRel);
    const canonicalKey = folderNode
      ? (function findCanonical(folderNode, mapping) {
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
        })(folderNode, mapping)
      : null;

    const newName = buildTargetBasename(mapping);
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
  await applyRenamePlans(renamePlans);

  console.log("Done.");
}

if (isMain(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

