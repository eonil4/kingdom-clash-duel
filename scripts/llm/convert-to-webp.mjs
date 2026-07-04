/**
 * Convert originals to canonical .webp files (moved into LLM scripts).
 *
 * Usage:
 *   node scripts/llm/convert-to-webp.mjs
 *   node scripts/llm/convert-to-webp.mjs --map scripts/fileMap.json
 *   node scripts/llm/convert-to-webp.mjs --dry-run
 */
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { writeWebpFromRasterFile } from "./enemy-image-webp.mjs";
import {
  collectEnemyEntriesFromMap,
  DEFAULT_FILE_MAP_PATH,
  loadExistingFileMap,
  WORKSPACE_ROOT,
} from "../file-map-enemies.mjs";

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
    await writeWebpFromRasterFile(fromPath, toPath);
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

