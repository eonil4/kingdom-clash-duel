import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { toSafeEnemyFilenameToken } from "./enemy-filename-tokens.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const WORKSPACE_ROOT = path.join(__dirname, "..");
export const DEFAULT_FILE_MAP_PATH = path.join(__dirname, "fileMap.json");

const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif|bmp|tiff?)$/i;

export function isFileEntryNode(node) {
  if (!node || typeof node !== "object" || Array.isArray(node)) return false;
  return "power" in node || "name" in node || "nameLatin" in node || "nameEnglish" in node;
}

/**
 * Discover directories that exist on disk under the map tree and contain at least one image file.
 */
export async function loadConfiguredFoldersFromRoot(mapRoot, workspaceRoot = WORKSPACE_ROOT) {
  /** @type {{ absPath: string, relPath: string }[]} */
  const candidates = [];

  async function walk(node, parts) {
    if (!node || typeof node !== "object" || Array.isArray(node)) return;
    for (const [k, v] of Object.entries(node)) {
      if (!v || typeof v !== "object") continue;
      if (isFileEntryNode(v)) continue;
      const nextParts = [...parts, k];
      const absPath = path.join(workspaceRoot, ...nextParts);
      try {
        const st = await fs.stat(absPath);
        if (st.isDirectory()) {
          candidates.push({ absPath, relPath: nextParts.join("/") });
        }
      } catch {
        // Logical-only segment (e.g. `test.png`) — not a filesystem folder
      }
      await walk(v, nextParts);
    }
  }

  await walk(mapRoot, []);

  const seen = new Set();
  const out = [];
  for (const c of candidates) {
    if (seen.has(c.relPath)) continue;
    seen.add(c.relPath);
    try {
      const files = await fs.readdir(c.absPath);
      const hasImg = files.some((f) => IMAGE_EXT_RE.test(f));
      if (hasImg) out.push(c);
    } catch {
      // ignore
    }
  }
  return out;
}

export async function loadConfiguredFolders(mapPath, workspaceRoot = WORKSPACE_ROOT) {
  try {
    const raw = await fs.readFile(mapPath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
    return loadConfiguredFoldersFromRoot(parsed, workspaceRoot);
  } catch {
    return [];
  }
}

export async function loadExistingFileMap(mapPath) {
  try {
    const raw = await fs.readFile(mapPath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}

export function toMapKey(filePath, workspaceRoot = WORKSPACE_ROOT) {
  return path.relative(workspaceRoot, filePath).split(path.sep).join("/");
}

export function formatPowerForFilename(power) {
  const s = String(power).padStart(9, "0");
  return `${s.slice(0, 3)}_${s.slice(3, 6)}_${s.slice(6, 9)}`;
}

/**
 * Original screenshots use `XXX_XXX_XXX-<rest>.ext` — three digit groups = 9-digit power.
 * Returns `undefined` if the basename does not start with this pattern (e.g. `Screenshot_…`).
 */
export function parsePowerFromOriginalBasename(fileBasename) {
  const stem = fileBasename.replace(/\.[^/.]+$/, "");
  const m = stem.match(/^(\d{3})_(\d{3})_(\d{3})(?:-|$)/);
  if (!m) return undefined;
  const n = Number(`${m[1]}${m[2]}${m[3]}`);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/**
 * Map path for a canonical entry: `<dir>/<originalBasename>/<power>-<nameLatin>.webp`.
 */
export function canonicalEnemyMapKey(
  filePath,
  { power, nameLatinRaw, nameEnglish },
  workspaceRoot = WORKSPACE_ROOT,
) {
  const rel = toMapKey(filePath, workspaceRoot).replace(/\\/g, "/");
  const dir = path.posix.dirname(rel);
  const originalBase = path.posix.basename(rel);
  const formattedPower = formatPowerForFilename(power);
  const latinNameToken = toSafeEnemyFilenameToken(nameLatinRaw);
  const englishNameToken = nameEnglish ? toSafeEnemyFilenameToken(nameEnglish) : "";
  const webpBase = englishNameToken
    ? `${formattedPower}-${latinNameToken}-${englishNameToken}.webp`
    : `${formattedPower}-${latinNameToken}.webp`;
  return `${dir}/${originalBase}/${webpBase}`;
}

export function deleteNestedMappingKey(target, mapKey) {
  const parts = mapKey.split("/").filter(Boolean);
  if (parts.length === 0) return;
  let cursor = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!cursor[part] || typeof cursor[part] !== "object") return;
    cursor = cursor[part];
  }
  const last = parts[parts.length - 1];
  if (Object.prototype.hasOwnProperty.call(cursor, last)) {
    delete cursor[last];
  }
}

export function getNestedMappingReadonly(source, mapKey) {
  const parts = mapKey.split("/").filter(Boolean);
  let cursor = source;
  for (const part of parts) {
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) return undefined;
    cursor = cursor[part];
  }
  if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) return undefined;
  return cursor;
}

export function setNestedMapping(target, mapKey, value) {
  const parts = mapKey.split("/").filter(Boolean);
  if (parts.length === 0) return;
  let cursor = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    const next = cursor[part];
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      cursor[part] = {};
    }
    cursor = cursor[part];
  }
  cursor[parts[parts.length - 1]] = value;
}

export function sortMapNode(node) {
  if (!node || typeof node !== "object" || Array.isArray(node)) return node;
  const entries = Object.entries(node).map(([key, value]) => [key, sortMapNode(value)]);

  entries.sort((a, b) => {
    const [ka, va] = a;
    const [kb, vb] = b;
    const aIsFile = isFileEntryNode(va);
    const bIsFile = isFileEntryNode(vb);

    if (aIsFile && bIsFile) {
      const pa = Number(va.power);
      const pb = Number(vb.power);
      if (!Number.isNaN(pa) && !Number.isNaN(pb) && pa !== pb) return pa - pb;
      return ka.localeCompare(kb);
    }
    if (aIsFile !== bIsFile) return aIsFile ? 1 : -1;
    return ka.localeCompare(kb);
  });

  return Object.fromEntries(entries);
}

/** Write sorted map to disk (call after each processed image to persist progress). */
export async function saveFileMap(mapRoot, mapPath = DEFAULT_FILE_MAP_PATH) {
  const sorted = sortMapNode(mapRoot);
  await fs.writeFile(mapPath, `${JSON.stringify(sorted, null, 2)}\n`, "utf8");
}

function resolveDiskOriginalFromMapParts(parts, entry, workspaceRoot) {
  const last = parts[parts.length - 1];
  if (last && /\.(png|jpe?g)$/i.test(last)) {
    return {
      folderAbs: path.join(workspaceRoot, ...parts.slice(0, -1)),
      originalFileName: last,
    };
  }
  const legacy = typeof entry.originalFileName === "string" ? entry.originalFileName.trim() : "";
  return {
    folderAbs: path.join(workspaceRoot, ...parts),
    originalFileName: legacy,
  };
}

/**
 * Every canonical `.webp` entry: disk folder for sources, original basename node, payload.
 */
export function collectEnemyEntriesFromMap(mapRoot, workspaceRoot = WORKSPACE_ROOT) {
  /** @type {{ fullMapKey: string, folderAbs: string, originalFileName: string, canonicalKey: string, entry: object }[]} */
  const out = [];
  function walk(node, parts) {
    if (!node || typeof node !== "object" || Array.isArray(node)) return;
    for (const [k, v] of Object.entries(node)) {
      if (isFileEntryNode(v)) {
        const { folderAbs, originalFileName } = resolveDiskOriginalFromMapParts(parts, v, workspaceRoot);
        out.push({
          fullMapKey: [...parts, k].join("/"),
          folderAbs,
          originalFileName,
          canonicalKey: k,
          entry: v,
        });
      } else if (v && typeof v === "object") {
        walk(v, [...parts, k]);
      }
    }
  }
  walk(mapRoot, []);
  return out;
}

/** Find map row whose source image path matches `sourceRel` (posix, relative to workspace). */
export function findEnemyRowBySourceRel(mapRoot, sourceRel, workspaceRoot = WORKSPACE_ROOT) {
  const norm = sourceRel.replace(/\\/g, "/");
  for (const row of collectEnemyEntriesFromMap(mapRoot, workspaceRoot)) {
    if (!row.originalFileName) continue;
    const rel = path
      .relative(workspaceRoot, path.join(row.folderAbs, row.originalFileName))
      .split(path.sep)
      .join("/");
    if (rel === norm) return row;
  }
  return undefined;
}
