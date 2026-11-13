/**
 * OCR clan formation screenshots (`data/clan_clash/YYYY-MM-DD/clan`) for name + power.
 *
 * Uses the same shared runner and OCR strategy as the arena pipeline, with the
 * `clan` ROIs from config/llm.json (scaled from `roiReference`).
 */
import fs from "fs/promises";
import path from "path";
import { WORKSPACE_ROOT } from "../enemy-records.mjs";
import { createOcrStrategy } from "../pipeline/ocr-strategy.mjs";
import { runExtraction } from "../pipeline/run-extraction.mjs";
import { loadLlmConfig } from "../llm/vision-client.mjs";
import {
  SUPPORTED_IMAGE_EXTENSIONS,
  collectImageFiles,
  groupFilesByFolder,
  parseScanArgs,
  selectTargets,
} from "./scan-cli.mjs";
import { isMain } from "../cli.mjs";

/**
 * `data/clan_clash/<date>/clan` folders that exist and contain images.
 * @param {string} [workspaceRoot]
 * @returns {Promise<{ absPath: string, relPath: string }[]>}
 */
export async function discoverClanFolders(workspaceRoot = WORKSPACE_ROOT) {
  const root = path.join(workspaceRoot, "data", "clan_clash");
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const out = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^\d{4}-\d{2}-\d{2}$/.test(entry.name)) continue;
    const absPath = path.join(root, entry.name, "clan");
    try {
      const files = await fs.readdir(absPath);
      if (!files.some((f) => SUPPORTED_IMAGE_EXTENSIONS.has(path.extname(f).toLowerCase()))) {
        continue;
      }
    } catch {
      continue;
    }
    out.push({
      absPath,
      relPath: path.relative(workspaceRoot, absPath).split(path.sep).join("/"),
    });
  }
  return out.sort((a, b) => a.relPath.localeCompare(b.relPath));
}

/**
 * @param {string[]} [argv]
 * @param {{
 *   discover?: typeof discoverClanFolders,
 *   collect?: typeof collectImageFiles,
 *   run?: typeof runExtraction,
 *   config?: object,
 *   makeStrategy?: (options: object) => any,
 *   log?: (...args: any[]) => void,
 *   warn?: (...args: any[]) => void,
 * }} [deps]
 */
export async function runOcrClanScan(argv = process.argv.slice(2), deps = {}) {
  const {
    discover = discoverClanFolders,
    collect = collectImageFiles,
    run = runExtraction,
    config = loadLlmConfig(),
    makeStrategy = (options) => createOcrStrategy(options),
    log = (...args) => console.log(...args),
    warn = (...args) => console.warn(...args),
  } = deps;

  const { limit, only, debugCrops, forceOcr } = parseScanArgs(argv);

  const clanFolders = await discover();
  let all = [];
  for (const folder of clanFolders) {
    all.push(...(await collect(folder.absPath)));
  }

  const targets = selectTargets(all, { only, limit });

  log(`Scanning workspace: ${WORKSPACE_ROOT}`);
  log(
    `Clan folders: ${
      clanFolders.length > 0 ? clanFolders.map((f) => f.relPath).join(", ") : "(none)"
    }`,
  );
  log(`Images: ${targets.length}`);

  const stats = await run({
    folders: groupFilesByFolder(targets),
    strategy: makeStrategy({
      force: forceOcr,
      debugCrops,
      targetKey: "clan",
      config,
    }),
    webp: false,
    map: false,
    recordTiming: false,
    logProcessing: false,
    logError: (err, { filePath }) => {
      warn(`Failed OCR: ${filePath}`);
      warn(err);
    },
  });

  if (stats.writtenDataFiles.size > 0) {
    log(`Updated ${stats.writtenDataFiles.size} data.json file(s)`);
  }
  return stats;
}

async function main() {
  await runOcrClanScan();
}

if (isMain(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
