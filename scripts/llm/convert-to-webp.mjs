/**
 * Convert originals to canonical .webp files (moved into LLM scripts).
 *
 * Usage:
 *   node scripts/llm/convert-to-webp.mjs
 *   node scripts/llm/convert-to-webp.mjs --dry-run
 */
import fs from "fs/promises";
import path from "path";
import { writeWebpFromRasterFile } from "./enemy-image-webp.mjs";
import {
  collectEnemyEntriesFromMap,
  loadEnemyMap,
  WORKSPACE_ROOT,
} from "../enemy-records.mjs";

function parseArgs(argv) {
  const args = { dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") args.dryRun = true;
  }
  return args;
}

async function main() {
  const { dryRun } = parseArgs(process.argv.slice(2));
  const mapRoot = await loadEnemyMap();
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

