#!/usr/bin/env node
/**
 * Common entry for llm:convert* scripts.
 *
 * Usage:
 *   pnpm llm:convert
 *   pnpm llm:convert -- <dir>
 *   node scripts/llm/run-convert.mjs [<dir>] [--force] [--clear-cache|--no-clear-cache] [--model <id>] [--script convert|convert2]
 *
 * When <dir> is omitted, uses the latest data/clan_clash/YYYY-MM-DD folder.
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

function parseArgs(argv) {
  const args = {
    dir: undefined,
    script: "convert2",
    model: undefined,
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

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const dir = parsed.dir ?? resolveDefaultDir();
  const { script, model, passthrough } = parsed;
  if (!dir) {
    console.error(
      "Usage: pnpm llm:convert -- <dir> [--force] [--model <id>] [--script convert|convert2]\n" +
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
  const childArgs = [convertScript, dirAbs, ...passthrough];

  console.log(`LLM convert: script=${path.basename(convertScript)} model=${resolvedModel}`);
  console.log(`Dir: ${dirAbs}`);
  console.log(`Log: ${logPath}`);

  const child = spawn(process.execPath, childArgs, {
    cwd: ROOT,
    env: childEnv,
    stdio: ["inherit", "pipe", "pipe"],
  });

  const tee = (chunk, stream) => {
    stream.write(chunk);
    fs.writeSync(logFd, chunk);
  };
  child.stdout?.on("data", (c) => tee(c, process.stdout));
  child.stderr?.on("data", (c) => tee(c, process.stderr));

  const code = await new Promise((resolve) => {
    child.on("close", (exitCode) => resolve(exitCode ?? 1));
  });
  fs.closeSync(logFd);
  process.exit(code);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
