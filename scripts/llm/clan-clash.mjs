#!/usr/bin/env node
/**
 * Usage:
 *   pnpm llm:convert
 *   pnpm llm:convert -- <dir>
 *   pnpm llm:clan_clash -- <dir> --full
 *   node scripts/llm/clan-clash.mjs [<dir>] [--full] [--force] [--clear-cache|--no-clear-cache] [--model <id>] [--script convert|convert2]
 *
 * When <dir> is omitted, uses the latest data/clan_clash/YYYY-MM-DD folder.
 * With `--full` / `--full=true` (default false), after convert also runs:
 *   - enemies wiki table for <dir>
 *   - clan wiki if <dir>/clan exists and is not empty
 *   - clan_duels wiki if <dir>/clan_duels exists and is not empty
 *
 * Writes/append stdout+stderr to `<dir>/log.txt` while still printing to the console.
 * Model: --model / LLM_MODEL / config/llm.json defaultModel.
 */
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { readFileSync } from "fs";

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
  return "qwen/qwen3-vl-4b";
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

function parseFullFlag(raw) {
  if (raw === undefined || raw === null || raw === "") return true;
  const v = String(raw).trim().toLowerCase();
  if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  throw new Error(`Invalid --full value: ${JSON.stringify(raw)} (use true|false)`);
}

function parseArgs(argv) {
  const args = {
    dir: undefined,
    script: "convert2",
    model: undefined,
    full: false,
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

function resolveConvertScript(name) {
  const file =
    name === "convert" || name === "convert.js"
      ? "convert.js"
      : name === "convert2" || name === "convert2.js"
        ? "convert2.js"
        : null;
  if (!file) {
    throw new Error(`Unknown --script ${JSON.stringify(name)} (use convert or convert2)`);
  }
  return path.join(__dirname, file);
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
async function runWikiTablesAfterConvert(dirAbs, logFd) {
  let code = await runWikiTable(dirAbs, ["webp"], logFd);
  if (code !== 0) return code;

  const clanDir = path.join(dirAbs, "clan");
  if (dirExistsAndNotEmpty(clanDir)) {
    code = await runWikiTable(clanDir, ["jpg", "png"], logFd);
    if (code !== 0) return code;
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

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const dir = parsed.dir ?? resolveDefaultDir();
  const { script, model, passthrough, full } = parsed;
  if (!dir) {
    console.error(
      "Usage: pnpm llm:convert -- <dir> [--full] [--force] [--model <id>] [--script convert|convert2]\n" +
        "(no dir given and no data/clan_clash/YYYY-MM-DD folder found)",
    );
    process.exit(1);
  }

  const dirAbs = path.isAbsolute(dir) ? dir : path.resolve(ROOT, dir);
  if (!fs.existsSync(dirAbs) || !fs.statSync(dirAbs).isDirectory()) {
    console.error(`Not a directory: ${dirAbs}`);
    process.exit(1);
  }

  const convertScript = resolveConvertScript(script);
  const logPath = path.join(dirAbs, "log.txt");
  const resolvedModel = model ?? process.env.LLM_MODEL ?? loadDefaultModel();

  await fs.promises.mkdir(dirAbs, { recursive: true });
  const logFd = fs.openSync(logPath, "a");

  const childEnv = { ...process.env, LLM_MODEL: resolvedModel };

  console.log(`LLM convert: script=${path.basename(convertScript)} model=${resolvedModel} full=${full}`);
  console.log(`Dir: ${dirAbs}`);
  console.log(`Log: ${logPath}`);

  const convertCode = await runNode([convertScript, dirAbs, ...passthrough], {
    env: childEnv,
    logFd,
  });

  if (convertCode !== 0) {
    fs.closeSync(logFd);
    process.exit(convertCode);
  }

  if (!full) {
    console.log("\n[Wiki] skipped (pass --full to generate wiki tables)");
    fs.closeSync(logFd);
    process.exit(0);
  }

  const wikiCode = await runWikiTablesAfterConvert(dirAbs, logFd);
  fs.closeSync(logFd);
  process.exit(wikiCode);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
