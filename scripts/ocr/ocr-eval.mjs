/**
 * Shared labelled-evaluation helpers for the OCR strategies (clan formation and arena).
 *
 * Rows compare an expected `{ name, power, path }` item with the strategy outcome.
 * `evaluateRows` reports exact/similarity metrics and splits hinted vs OCR-only samples.
 */
import fs from "fs/promises";
import path from "path";
import { WORKSPACE_ROOT } from "../enemy-records.mjs";
import { parseLatinNameHintFromEncodedOriginalBasename } from "./enemy-filename-tokens.mjs";

/**
 * @param {string} value
 */
export function normalizeForCompare(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\d]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * @param {string} a
 * @param {string} b
 */
export function levenshtein(a, b) {
  const s = [...a];
  const t = [...b];
  const prev = Array.from({ length: t.length + 1 }, (_, i) => i);
  for (let i = 1; i <= s.length; i++) {
    let last = prev[0];
    prev[0] = i;
    for (let j = 1; j <= t.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(
        prev[j] + 1,
        prev[j - 1] + 1,
        last + (s[i - 1] === t[j - 1] ? 0 : 1),
      );
      last = tmp;
    }
  }
  return prev[t.length];
}

/**
 * @param {string} a
 * @param {string} b
 */
export function similarity(a, b) {
  const max = Math.max([...a].length, [...b].length);
  if (max === 0) return 1;
  return 1 - levenshtein(a, b) / max;
}

/**
 * @typedef {{ item: { name: string, power: number, path: string }, actual: string, power?: number, note?: string }} OcrEvalRow
 */

/**
 * Compute exact/similarity metrics and the hinted vs OCR-only split.
 * @param {OcrEvalRow[]} rows
 * @param {{ verbose?: boolean }} [options]
 */
export function evaluateRows(rows, { verbose = false } = {}) {
  let nameOk = 0;
  let powerOk = 0;
  let simSum = 0;
  /** @type {string[]} */
  const failureLines = [];
  for (const row of rows) {
    const expected = normalizeForCompare(row.item.name);
    const actual = normalizeForCompare(row.actual);
    const sim = similarity(expected, actual);
    simSum += sim;
    if (expected === actual) nameOk++;
    if (row.power === row.item.power) powerOk++;
    if (verbose || expected !== actual || row.power !== row.item.power) {
      const flags = [
        expected === actual ? "name ok" : `name ${(sim * 100).toFixed(0)}%`,
        row.power === row.item.power ? "power ok" : `power ${row.power ?? "?"}`,
      ].join(", ");
      failureLines.push(
        `${flags.padEnd(22)} expected="${row.item.name}" actual="${row.actual}"` +
          `${row.note ? ` (${row.note})` : ""}`,
      );
    }
  }

  const n = rows.length || 1;
  /** @type {{ label: string, n: number, exact: number, similarityPct: string }[]} */
  const groups = [];
  // Split out samples without percent-encoded filename hints: those are the ones
  // where the OCR name actually decides the result.
  /** @type {Record<"hinted" | "ocr-only", OcrEvalRow[]>} */
  const split = { hinted: [], "ocr-only": [] };
  for (const row of rows) {
    const hint = parseLatinNameHintFromEncodedOriginalBasename(path.basename(row.item.path));
    split[hint !== undefined ? "hinted" : "ocr-only"].push(row);
  }
  for (const [label, group] of Object.entries(split)) {
    if (group.length === 0) continue;
    let exact = 0;
    let sim = 0;
    for (const row of group) {
      const expected = normalizeForCompare(row.item.name);
      const actual = normalizeForCompare(row.actual);
      if (expected === actual) exact++;
      sim += similarity(expected, actual);
    }
    groups.push({
      label,
      n: group.length,
      exact,
      similarityPct: ((sim / group.length) * 100).toFixed(1),
    });
  }

  return {
    samples: rows.length,
    nameOk,
    namePct: ((nameOk / n) * 100).toFixed(0),
    similarityPct: ((simSum / n) * 100).toFixed(1),
    powerOk,
    powerPct: ((powerOk / n) * 100).toFixed(0),
    failureLines,
    groups,
  };
}

/**
 * @param {ReturnType<typeof evaluateRows>} summary
 * @param {(...args: any[]) => void} [log]
 */
export function reportEvaluation(summary, log = (...args) => console.log(...args)) {
  for (const line of summary.failureLines) log(line);
  log("");
  log(`samples: ${summary.samples}`);
  log(`name exact: ${summary.nameOk}/${summary.samples} (${summary.namePct}%)`);
  log(`name similarity: ${summary.similarityPct}%`);
  log(`power exact: ${summary.powerOk}/${summary.samples} (${summary.powerPct}%)`);
  for (const group of summary.groups) {
    log(
      `${group.label.padEnd(9)} n=${group.n} name exact ${group.exact}/${group.n}, similarity ${group.similarityPct}%`,
    );
  }
}

/**
 * Run the strategy over labelled samples and collect comparison rows.
 * @param {{
 *   labels: { images: { path: string, name: string, power: number }[] },
 *   limit?: number,
 *   strategy: any,
 *   root?: string,
 * }} options
 */
export async function evaluateFixture({ labels, limit, strategy, root = WORKSPACE_ROOT }) {
  const images = labels.images.slice(
    0,
    typeof limit === "number" ? limit : labels.images.length,
  );
  /** @type {OcrEvalRow[]} */
  const rows = [];
  await strategy.prepare();
  try {
    for (const item of images) {
      const filePath = path.resolve(root, item.path);
      try {
        const outcome = await strategy.extract({
          filePath,
          basename: path.basename(filePath),
          folderAbs: path.dirname(filePath),
          entries: {},
        });
        if ("skip" in outcome && outcome.skip) {
          rows.push({ item, actual: "", power: undefined, note: outcome.reason });
          continue;
        }
        rows.push({
          item,
          actual: outcome.record.nameLatin || outcome.record.name,
          power: outcome.record.power,
        });
      } catch (err) {
        rows.push({
          item,
          actual: "",
          power: undefined,
          note: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } finally {
    await strategy.dispose();
  }
  return rows;
}

/**
 * @param {string[]} argv
 * @param {string} defaultLabels
 */
export function parseEvalArgs(argv, defaultLabels) {
  const args = { labels: defaultLabels, limit: undefined, verbose: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--labels") args.labels = argv[++i];
    else if (a === "--limit") args.limit = Number(argv[++i]);
    else if (a === "--verbose") args.verbose = true;
  }
  return args;
}

/**
 * Generic CLI body: load labels, evaluate, report.
 * @param {string[]} argv
 * @param {{
 *   defaultLabels: string,
 *   makeStrategy: () => any,
 *   loadLabels?: (labelsPath: string) => Promise<{ images: { path: string, name: string, power: number }[] }>,
 *   log?: (...args: any[]) => void,
 *   root?: string,
 * }} options
 */
export async function runOcrEval(
  argv,
  {
    defaultLabels,
    makeStrategy,
    loadLabels = (labelsPath) => fs.readFile(labelsPath, "utf8").then(JSON.parse),
    log = (...args) => console.log(...args),
    root = WORKSPACE_ROOT,
  },
) {
  const { labels, limit, verbose } = parseEvalArgs(argv, defaultLabels);
  const fixture = await loadLabels(path.resolve(root, labels));
  const strategy = makeStrategy();
  const rows = await evaluateFixture({ labels: fixture, limit, strategy, root });

  if (rows.length === 0) {
    log("no samples matched (check --labels/--limit)");
    return { rows, summary: undefined };
  }

  const summary = evaluateRows(rows, { verbose });
  reportEvaluation(summary, log);
  return { rows, summary };
}
