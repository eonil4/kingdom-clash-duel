#!/usr/bin/env node
/**
 * Usage:
 *   pnpm llm:clan_clash
 *   pnpm llm:clan_clash -- <dir>
 *   pnpm llm:clan_clash:full -- <dir>
 *   node scripts/llm/clan-clash.mjs [<dir>] [--full] [--recursive <n>] [--force] [--model <id>] [--script convert|convert2]
 *
 * `--script` selects the extraction mode of the shared `convert.mjs` entry point:
 *   convert  → --mode screenshot
 *   convert2 → --mode crops (default)
 *
 * When <dir> is omitted, uses the latest data/clan_clash/YYYY-MM-DD folder.
 *
 * `--recursive <n>` / `--recursive=<n>` (default 0 = root only; bare `--recursive` means 1):
 *   Run convert (and optional wiki) on the root and every subdirectory down to depth n,
 *   even if the root folder has no images. Depth 0 = root only; 1 = root + children; etc.
 *
 * With `--full` / `--full=true` (default false), after each folder's convert also runs:
 *   - enemies wiki table for that folder
 *   - clan wiki if <folder>/clan exists and is not empty
 *   - clan_duels wiki if <folder>/clan_duels exists and is not empty
 *
 * Writes/append stdout+stderr to `<root>/log.txt` while still printing to the console.
 * Model: --model / LLM_MODEL / config/llm.json defaultModel.
 */
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { isMain } from "../cli.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..", "..");
const CONFIG_PATH = path.join(ROOT, "config", "llm.json");
const CLAN_CLASH_ROOT = path.join(ROOT, "data", "clan_clash");
const WIKI_SCRIPT = path.join(ROOT, "scripts", "generate-wiki-table.mjs");

function loadDefaultModel() {
  try {
    const cfg = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
    if (typeof cfg.defaultModel === "string" && cfg.defaultModel.trim()) {
      return cfg.defaultModel.trim();
    }
  } catch {
    // ignore
  }
  return "qwen/qwen3-vl-8b";
}

/** Latest `YYYY-MM-DD` folder under data/clan_clash, else undefined. */
function resolveDefaultDir() {
  try {
    const names = fs
      .readdirSync(CLAN_CLASH_ROOT, { withFileTypes: true })
      .filter((e) => e.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(e.name))
      .map((e) => e.name)
      .sort();
    if (names.length === 0) return undefined;
    return path.join("data", "clan_clash", names[names.length - 1]);
  } catch {
    return undefined;
  }
}

export function parseFullFlag(raw) {
  if (raw === undefined || raw === null || raw === "") return true;
  const v = String(raw).trim().toLowerCase();
  if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  throw new Error(`Invalid --full value: ${JSON.stringify(raw)} (use true|false)`);
}

/**
 * @param {string | undefined} raw
 * @returns {number}
 */
export function parseRecursiveLevel(raw) {
  if (raw === undefined || raw === null || raw === "") return 0;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(
      `Invalid --recursive value: ${JSON.stringify(raw)} (use integer >= 0)`,
    );
  }
  return n;
}

export function parseArgs(argv) {
  const args = {
    dir: undefined,
    script: "convert2",
    model: undefined,
    full: false,
    /** @type {number} 0 = root only */
    recursive: 0,
    passthrough: /** @type {string[]} */ ([]),
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--" || a === undefined) continue;
    if (a === "--script") {
      args.script = String(argv[++i] ?? "convert2");
      continue;
    }
    if (a === "--model" || a === "-m") {
      args.model = argv[++i];
      continue;
    }
    if (a === "--full") {
      args.full = true;
      continue;
    }
    if (a.startsWith("--full=")) {
      args.full = parseFullFlag(a.slice("--full=".length));
      continue;
    }
    if (a === "--no-full") {
      args.full = false;
      continue;
    }
    if (a === "--recursive" || a === "-r") {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("-") && /^\d+$/.test(next)) {
        args.recursive = parseRecursiveLevel(next);
        i++;
      } else {
        args.recursive = 1;
      }
      continue;
    }
    if (a.startsWith("--recursive=")) {
      args.recursive = parseRecursiveLevel(a.slice("--recursive=".length));
      continue;
    }
    if (a === "--force" || a === "--clear-cache" || a === "--no-clear-cache") {
      args.passthrough.push(a);
      continue;
    }
    if (!a.startsWith("-") && !args.dir) {
      args.dir = a;
      continue;
    }
    args.passthrough.push(a);
  }
  return args;
}

/**
 * `--script convert` → full-screenshot extraction, `--script convert2` → crop extraction.
 * Both run the single `convert.mjs` entry point.
 * @param {string} name
 * @returns {{ script: string, mode: "crops" | "screenshot" }}
 */
export function resolveConvertTarget(name) {
  const mode =
    name === "convert" || name === "convert.js"
      ? "screenshot"
      : name === "convert2" || name === "convert2.js"
        ? "crops"
        : null;
  if (!mode) {
    throw new Error(`Unknown --script ${JSON.stringify(name)} (use convert or convert2)`);
  }
  return { script: path.join(__dirname, "convert.mjs"), mode };
}

/**
 * Collect root + subdirectories down to `maxDepth` (0 = root only).
 * Root is always included, even when empty.
 * @param {string} rootAbs
 * @param {number} maxDepth
 * @returns {string[]}
 */
function collectDirsUpToDepth(rootAbs, maxDepth) {
  /** @type {string[]} */
  const out = [];

  /**
   * @param {string} abs
   * @param {number} depth
   */
  function walk(abs, depth) {
    out.push(abs);
    if (depth >= maxDepth) return;
    let entries;
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    const children = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b));
    for (const name of children) {
      walk(path.join(abs, name), depth + 1);
    }
  }

  walk(rootAbs, 0);
  return out;
}

/**
 * @param {string} dirAbs
 * @returns {boolean}
 */
function dirExistsAndNotEmpty(dirAbs) {
  try {
    const st = fs.statSync(dirAbs);
    if (!st.isDirectory()) return false;
    return fs.readdirSync(dirAbs).length > 0;
  } catch {
    return false;
  }
}

/**
 * @param {string[]} nodeArgs
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv, logFd?: number }} [options]
 * @returns {Promise<number>}
 */
function runNode(nodeArgs, options = {}) {
  const { cwd = ROOT, env = process.env, logFd } = options;
  return new Promise((resolve) => {
    const child = spawn(process.execPath, nodeArgs, {
      cwd,
      env,
      stdio: ["inherit", "pipe", "pipe"],
    });
    const tee = (chunk, stream) => {
      stream.write(chunk);
      if (typeof logFd === "number") fs.writeSync(logFd, chunk);
    };
    child.stdout?.on("data", (c) => tee(c, process.stdout));
    child.stderr?.on("data", (c) => tee(c, process.stderr));
    child.on("close", (exitCode) => resolve(exitCode ?? 1));
  });
}

/**
 * @param {string} dirAbs
 * @param {string[]} extensions
 * @param {number} [logFd]
 */
async function runWikiTable(dirAbs, extensions, logFd) {
  const rel = path.relative(ROOT, dirAbs).replace(/\\/g, "/") || dirAbs;
  console.log(`\n[Wiki] ${rel} (${extensions.join(" ")})`);
  // Pass repo-relative path so GitHub URLs never embed absolute Windows paths.
  return runNode([WIKI_SCRIPT, rel, ...extensions], { logFd });
}

/**
 * @param {string} dirAbs
 * @param {number} [logFd]
 */
async function runWikiTablesAfterConvert(dirAbs, logFd, env) {
  let code = await runWikiTable(dirAbs, ["webp"], logFd);
  if (code !== 0) return code;

  const clanDir = path.join(dirAbs, "clan");
  if (dirExistsAndNotEmpty(clanDir)) {
    // Create a per-clan log file and use it for extraction + wiki generation
    const clanLogPath = path.join(clanDir, "log.txt");
    let clanLogFd;
    try {
      clanLogFd = fs.openSync(clanLogPath, "a");
      // If a clan folder exists, run the formation extractor on each image before generating the wiki.
      try {
        const files = fs.readdirSync(clanDir).filter((n) => /\.(png|jpe?g|webp)$/i.test(n));
        if (files.length > 0) {
          console.log(`\n[LLM-formation] processing ${files.length} files in ${clanDir}`);
          const extractor = path.join(__dirname, "llm-formation-extract.mjs");
          for (const f of files) {
            const img = path.join(clanDir, f);
            console.log(`\t[LLM-formation] ${f}`);
            const rc = await runNode([extractor, img], { env, logFd: clanLogFd });
            if (rc !== 0) {
              console.warn(`\t[LLM-formation] extractor failed for ${f} (exit ${rc})`);
            }
          }
        } else {
          console.log(`\n[LLM-formation] no supported images in ${clanDir}`);
        }
      } catch (err) {
        console.warn(`[LLM-formation] error while processing clan folder: ${err instanceof Error ? err.message : err}`);
      }

      code = await runWikiTable(clanDir, ["jpg", "png"], clanLogFd);
      if (code !== 0) return code;
    } finally {
      try {
        if (typeof clanLogFd === "number") fs.closeSync(clanLogFd);
      } catch {
        // ignore
      }
    }
  } else {
    console.log(`\n[Wiki] skip clan (missing or empty): ${clanDir}`);
  }

  const clanDuelsDir = path.join(dirAbs, "clan_duels");
  if (dirExistsAndNotEmpty(clanDuelsDir)) {
    code = await runWikiTable(clanDuelsDir, ["jpg", "png"], logFd);
    if (code !== 0) return code;
  } else {
    console.log(`\n[Wiki] skip clan_duels (missing or empty): ${clanDuelsDir}`);
  }

  return 0;
}

/**
 * @param {object} options
 * @param {string} options.folderAbs
 * @param {string} options.convertScript
 * @param {"crops" | "screenshot"} options.convertMode
 * @param {string[]} options.passthrough
 * @param {boolean} options.full
 * @param {NodeJS.ProcessEnv} options.env
 * @param {number} options.logFd
 */
async function processFolder({
  folderAbs,
  convertScript,
  convertMode,
  passthrough,
  full,
  env,
  logFd,
}) {
  const rel = path.relative(ROOT, folderAbs).replace(/\\/g, "/") || folderAbs;
  console.log(`\n======== ${rel} ========`);

  const convertCode = await runNode([convertScript, folderAbs, "--mode", convertMode, ...passthrough], {
    env,
    logFd,
  });
  if (convertCode !== 0) return convertCode;

  if (!full) {
    console.log("\n[Wiki] skipped (pass --full to generate wiki tables)");
    return 0;
  }

  return runWikiTablesAfterConvert(folderAbs, logFd, env);
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const dir = parsed.dir ?? resolveDefaultDir();
  const { script, model, passthrough, full, recursive } = parsed;
  if (!dir) {
    console.error(
      "Usage: node scripts/llm/clan-clash.mjs [<dir>] [--full] [--recursive <n>] [--force] [--model <id>]\n" +
        "(no dir given and no data/clan_clash/YYYY-MM-DD folder found)",
    );
    process.exit(1);
  }

  const dirAbs = path.isAbsolute(dir) ? dir : path.resolve(ROOT, dir);
  if (!fs.existsSync(dirAbs) || !fs.statSync(dirAbs).isDirectory()) {
    console.error(`Not a directory: ${dirAbs}`);
    process.exit(1);
  }

  const { script: convertScript, mode: convertMode } = resolveConvertTarget(script);
  const logPath = path.join(dirAbs, "log.txt");
  const resolvedModel = model ?? process.env.LLM_MODEL ?? loadDefaultModel();
  const folders = collectDirsUpToDepth(dirAbs, recursive);

  await fs.promises.mkdir(dirAbs, { recursive: true });
  const logFd = fs.openSync(logPath, "a");

  const childEnv = { ...process.env, LLM_MODEL: resolvedModel };

  console.log(
    `LLM convert: script=convert.mjs mode=${convertMode} model=${resolvedModel} full=${full} recursive=${recursive}`,
  );
  console.log(`Root: ${dirAbs}`);
  console.log(`Folders (${folders.length}):`);
  for (const f of folders) {
    console.log(`  - ${path.relative(ROOT, f).replace(/\\/g, "/") || f}`);
  }
  console.log(`Log: ${logPath}`);

  let worstCode = 0;
  for (const folderAbs of folders) {
    const code = await processFolder({
      folderAbs,
      convertScript,
      convertMode,
      passthrough,
      full,
      env: childEnv,
      logFd,
    });
    if (code !== 0) worstCode = code;
  }

  fs.closeSync(logFd);
  process.exit(worstCode);
}

if (isMain(import.meta.url)) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
