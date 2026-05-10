/**
 * Rename / convert files using scripts/fileMap.json (original basename node → canonical `.webp`).
 * Does not run OCR; does not scan for unmapped files.
 *
 * Usage:
 *   node scripts/rename-originals-from-filemap.mjs
 *   node scripts/rename-originals-from-filemap.mjs --dry-run
 *   node scripts/rename-originals-from-filemap.mjs --map path/to/other-map.json
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
  const args = { dryRun: false, mapPath: DEFAULT_FILE_MAP_PATH };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--" || a === undefined) continue;
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--map") args.mapPath = path.resolve(argv[++i]);
  }
  return args;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

/**
 * @returns {{ filePath: string, newPath: string, mode: "rename" | "convert" }[]}
 */
async function collectPlans(mapRoot) {
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

    try {
      await fs.access(fromPath);
    } catch {
      console.warn(
        `Skipping (source missing): "${orig}" -> "${canonicalKey}" under ${row.folderAbs}`,
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
  const { dryRun, mapPath } = parseArgs(process.argv.slice(2));
  console.log(`Map: ${mapPath}`);
  if (dryRun) console.log("(dry-run — no files will be changed)");

  const mapRoot = await loadExistingFileMap(mapPath);
  let plans = await collectPlans(mapRoot);

  const dirs = new Set(plans.map((p) => path.dirname(p.filePath)));
  console.log(
    `Folders touched: ${dirs.size ? [...dirs].join(", ") : "(none)"}`,
  );

  plans.sort((a, b) => {
    if (a.mode === b.mode) return 0;
    if (a.mode === "convert" && b.mode === "rename") return -1;
    return 1;
  });

  console.log(`${plans.length} operation(s) planned.`);

  for (const { filePath, newPath, mode } of plans) {
    if (dryRun) {
      console.log(`${mode === "convert" ? "convert" : "rename"}:\n  ${filePath}\n  -> ${newPath}`);
      continue;
    }

    if (mode === "convert") {
      try {
        await fs.access(newPath);
        console.warn(`Target exists, skipping: ${newPath}`);
        continue;
      } catch {
        // ok
      }
      console.log(`Converting:\n  ${filePath}\n  -> ${newPath}`);
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
    try {
      await fs.rename(filePath, newPath);
    } catch (e) {
      const code = e && typeof e === "object" && "code" in e ? e.code : undefined;
      if (code === "EEXIST") {
        console.warn(`Target exists, skipping: ${newPath}`);
      } else {
        throw e;
      }
    }
  }

  console.log(dryRun ? "Dry-run done." : "Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
