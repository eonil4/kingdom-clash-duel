/**
 * Evaluate the clan OCR strategy against a labelled sample set.
 *
 * Usage:
 *   node scripts/ocr/eval-clan-ocr.mjs [--labels tests/fixtures/clan-ocr/labels.json] [--limit N] [--verbose]
 *
 * Labels are names captured by the LLM formation extractor (normalised match),
 * so treat small differences as label noise rather than strictly OCR error.
 */
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { WORKSPACE_ROOT } from "../enemy-records.mjs";
import { parseLatinNameHintFromEncodedOriginalBasename } from "./enemy-filename-tokens.mjs";
import { createOcrStrategy } from "../pipeline/ocr-strategy.mjs";
import { loadLlmConfig } from "../llm/vision-client.mjs";

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

function parseArgs(argv) {
  const args = { labels: "tests/fixtures/clan-ocr/labels.json", limit: undefined, verbose: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--labels") args.labels = argv[++i];
    else if (a === "--limit") args.limit = Number(argv[++i]);
    else if (a === "--verbose") args.verbose = true;
  }
  return args;
}

async function main() {
  const { labels, limit, verbose } = parseArgs(process.argv.slice(2));
  const labelsPath = path.resolve(WORKSPACE_ROOT, labels);
  const fixture = JSON.parse(await fs.readFile(labelsPath, "utf8"));
  const images = fixture.images.slice(0, typeof limit === "number" ? limit : fixture.images.length);

  const strategy = createOcrStrategy({ targetKey: "clan", config: loadLlmConfig() });
  const rows = [];
  await strategy.prepare();
  try {
    for (const item of images) {
      const filePath = path.resolve(WORKSPACE_ROOT, item.path);
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
        rows.push({ item, actual: "", power: undefined, note: err instanceof Error ? err.message : String(err) });
      }
    }
  } finally {
    await strategy.dispose();
  }

  let nameOk = 0;
  let powerOk = 0;
  let simSum = 0;
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
      console.log(`${flags.padEnd(22)} expected="${row.item.name}" actual="${row.actual}"${row.note ? ` (${row.note})` : ""}`);
    }
  }

  const n = rows.length || 1;
  console.log("");
  console.log(`samples: ${rows.length}`);
  console.log(`name exact: ${nameOk}/${rows.length} (${((nameOk / n) * 100).toFixed(0)}%)`);
  console.log(`name similarity: ${((simSum / n) * 100).toFixed(1)}%`);
  console.log(`power exact: ${powerOk}/${rows.length} (${((powerOk / n) * 100).toFixed(0)}%)`);

  // Split out samples without percent-encoded filename hints: those are the ones
  // where the OCR name actually decides the result.
  const groups = { hinted: [], "ocr-only": [] };
  for (const row of rows) {
    const hint = parseLatinNameHintFromEncodedOriginalBasename(path.basename(row.item.path));
    groups[hint !== undefined ? "hinted" : "ocr-only"].push(row);
  }
  for (const [label, group] of Object.entries(groups)) {
    if (group.length === 0) continue;
    let exact = 0;
    let sim = 0;
    for (const row of group) {
      const expected = normalizeForCompare(row.item.name);
      const actual = normalizeForCompare(row.actual);
      if (expected === actual) exact++;
      sim += similarity(expected, actual);
    }
    console.log(
      `${label.padEnd(9)} n=${group.length} name exact ${exact}/${group.length}, similarity ${((sim / group.length) * 100).toFixed(1)}%`,
    );
  }
}

const invokedDirectly =
  path.resolve(process.argv[1] ?? "") === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
