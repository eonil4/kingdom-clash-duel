/**
 * Verify that every relative `from`/`import()` specifier under the given roots
 * (default: scripts + tests) resolves.
 *
 * Files that intentionally contain import-like strings (fixtures) can opt out with
 * the comment marker `check-imports:ignore-file`.
 *
 * Usage: node scripts/check-imports.mjs [root ...]
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

export const SCRIPT_FILE_RE = /\.(mjs|js|ts)$/;

/**
 * @param {string} root
 * @returns {string[]}
 */
export function collectScriptFiles(root) {
  const out = [];
  /** @param {string} dir */
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules") walk(full);
      } else if (SCRIPT_FILE_RE.test(entry.name)) {
        out.push(full);
      }
    }
  })(root);
  return out;
}

/**
 * @param {string[]} files
 * @returns {{ file: string, specifier: string }[]}
 */
export function findBrokenImports(files) {
  /** @type {{ file: string, specifier: string }[]} */
  const broken = [];
  for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    if (src.includes("check-imports:ignore-file")) continue;
    const re = /(?:from\s+|import\s*\(\s*)['"](\.[^'"]+)['"]/g;
    let match;
    while ((match = re.exec(src))) {
      const target = path.resolve(path.dirname(file), match[1]);
      if (!fs.existsSync(target)) broken.push({ file, specifier: match[1] });
    }
  }
  return broken;
}

/** Directories checked when no explicit root is given. */
export const DEFAULT_ROOTS = ["scripts", "tests"];

/**
 * @param {string[]} roots
 * @returns {string[]}
 */
export function collectFromRoots(roots) {
  const files = [];
  for (const root of roots) {
    const abs = path.resolve(root);
    if (!fs.existsSync(abs)) continue;
    files.push(...collectScriptFiles(abs));
  }
  return files;
}

/**
 * @param {string[]} argv
 */
function main(argv) {
  const args = argv.filter((a) => a !== undefined && a !== "--");
  const roots = args.length > 0 ? args : DEFAULT_ROOTS;
  const files = collectFromRoots(roots);
  const broken = findBrokenImports(files);
  for (const { file, specifier } of broken) {
    console.error(`MISSING ${file} -> ${specifier}`);
  }
  if (broken.length > 0) {
    console.error(`${broken.length} broken relative import(s).`);
    process.exit(1);
  }
  console.log(
    `All relative imports resolve (${files.length} files across ${roots.join(", ")}).`,
  );
}

const invokedDirectly =
  path.resolve(process.argv[1] ?? "") === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  main(process.argv.slice(2));
}
