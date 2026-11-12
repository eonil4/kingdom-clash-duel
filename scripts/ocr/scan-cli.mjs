/**
 * Shared plumbing for the OCR scan CLIs (arena `ocr-enemy`, clan `ocr-clan`).
 */
import fs from "fs/promises";
import path from "path";
import { toMapKey } from "../enemy-records.mjs";

export const SUPPORTED_IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".bmp",
  ".tif",
  ".tiff",
  ".gif",
]);

/**
 * @param {string[]} argv
 */
export function parseScanArgs(argv) {
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

/**
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
export async function collectImageFiles(dir) {
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
 * Apply `--only` (basename / workspace-relative path / path suffix; deepest match wins)
 * and then `--limit`.
 * @param {string[]} all
 * @param {{ only?: string, limit?: number }} options
 */
export function selectTargets(all, { only, limit }) {
  if (!only) {
    return all.slice(0, typeof limit === "number" ? limit : all.length);
  }
  const matches = all.filter(
    (p) => path.basename(p) === only || toMapKey(p) === only || toMapKey(p).endsWith(`/${only}`),
  );
  if (matches.length <= 1) return matches;
  matches.sort((a, b) => b.split(path.sep).length - a.split(path.sep).length);
  return [matches[0]];
}

/**
 * @param {string[]} filePaths
 * @returns {{ absPath: string, files: string[] }[]}
 */
export function groupFilesByFolder(filePaths) {
  /** @type {Map<string, string[]>} */
  const byFolder = new Map();
  for (const filePath of filePaths) {
    const folderAbs = path.dirname(filePath);
    if (!byFolder.has(folderAbs)) byFolder.set(folderAbs, []);
    byFolder.get(folderAbs).push(filePath);
  }
  return [...byFolder].map(([absPath, files]) => ({ absPath, files }));
}
