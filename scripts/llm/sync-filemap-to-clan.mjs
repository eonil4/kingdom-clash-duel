#!/usr/bin/env node
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import {
  loadExistingFileMap,
  collectEnemyEntriesFromMap,
  DEFAULT_FILE_MAP_PATH,
  WORKSPACE_ROOT,
} from "../file-map-enemies.mjs";

async function syncFileMapToClanData(folderAbs) {
  try {
    const mapRoot = await loadExistingFileMap(DEFAULT_FILE_MAP_PATH);
    const rows = collectEnemyEntriesFromMap(mapRoot, WORKSPACE_ROOT);

    const outPath = path.join(folderAbs, "data.json");
    let existing = {};
    try {
      const raw = await fs.readFile(outPath, "utf8");
      existing = JSON.parse(raw);
    } catch {
      existing = {};
    }

    let added = 0;
    for (const r of rows) {
      if (path.resolve(r.folderAbs) !== path.resolve(folderAbs)) continue;
      const key = r.canonicalKey;
      const entry = r.entry || {};
      if (!Object.prototype.hasOwnProperty.call(existing, key)) {
        existing[key] = {
          name: entry.name || null,
          nameLatin: entry.nameLatin || null,
          power: entry.power || null,
          language: entry.language || null,
          originalFileName: r.originalFileName || null,
        };
        added++;
      }
    }
    if (added > 0) {
      await fs.writeFile(outPath, `${JSON.stringify(existing, null, 2)}\n`, "utf8");
      console.log(`[Data] merged ${added} fileMap entries into ${outPath}`);
    } else {
      console.log("[Data] no new fileMap entries to merge for clan folder");
    }
  } catch (err) {
    console.error(`[Data] failed to sync fileMap -> data.json: ${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
  }
}

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error("Usage: node scripts/llm/sync-filemap-to-clan.mjs <clan-folder-path>");
    process.exit(1);
  }
  const folder = path.isAbsolute(arg) ? arg : path.resolve(process.cwd(), arg);
  await syncFileMapToClanData(folder);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}

