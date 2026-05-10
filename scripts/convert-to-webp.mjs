/**
 * Keep originals on disk; create canonical `.webp` files from fileMap.json when missing.
 *
 * Usage:
 *   node scripts/convert-to-webp.mjs
 *   node scripts/convert-to-webp.mjs --map scripts/fileMap.json
 *   node scripts/convert-to-webp.mjs --dry-run
 */
import fs from "fs/promises";
import path from "path";
import sharp from "sharp";
import { fileURLToPath } from "url";
import {
  collectEnemyEntriesFromMap,
  DEFAULT_FILE_MAP_PATH,
  loadExistingFileMap,
  WORKSPACE_ROOT,
} from "./file-map-enemies.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseArgs(argv) {
  const args = { mapPath: DEFAULT_FILE_MAP_PATH, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--map") args.mapPath = path.resolve(argv[++i]);
    else if (a === "--dry-run") args.dryRun = true;
  }
  return args;
}

async function main() {
  const { mapPath, dryRun } = parseArgs(process.argv.slice(2));
  const mapRoot = await loadExistingFileMap(mapPath);
  const rows = collectEnemyEntriesFromMap(mapRoot, WORKSPACE_ROOT);

  let planned = 0;
  let skipped = 0;
  let missing = 0;

  for (const { folderAbs, canonicalKey, originalFileName, entry } of rows) {
    const orig =
      (typeof originalFileName === "string" ? originalFileName.trim() : "") ||
      (typeof entry.originalFileName === "string" ? entry.originalFileName.trim() : "");
    if (!orig) {
      console.warn(`No original file node / originalFileName for ${canonicalKey}, skipping`);
      missing++;
      continue;
    }

    const fromPath = path.join(folderAbs, orig);
    const toPath = path.join(folderAbs, canonicalKey);

    try {
      await fs.access(fromPath);
    } catch {
      console.warn(`Source missing: ${fromPath}`);
      missing++;
      continue;
    }

    try {
      await fs.access(toPath);
      skipped++;
      continue;
    } catch {
      // create
    }

    planned++;
    if (dryRun) {
      console.log(`Would convert:\n  ${fromPath}\n  -> ${toPath}`);
      continue;
    }

    console.log(`Converting:\n  ${fromPath}\n  -> ${toPath}`);
    const sourceMeta = await sharp(fromPath).metadata();
    const sourceDensity =
      Number.isFinite(sourceMeta.density) && sourceMeta.density > 0
        ? sourceMeta.density
        : undefined;
    let converter = sharp(fromPath).webp({ quality: 82 });
    if (sourceDensity) {
      converter = converter.withMetadata({ density: sourceDensity });
    } else {
      converter = converter.withMetadata();
    }
    await converter.toFile(toPath);
  }

  console.log(
    dryRun
      ? `Dry-run: ${planned} would convert, ${skipped} already exist, ${missing} skipped (missing data/files).`
      : `Done: ${planned} converted, ${skipped} already existed, ${missing} skipped.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
