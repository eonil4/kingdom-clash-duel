/**
 * Evaluate the arena OCR strategy against a labelled sample set.
 *
 * Usage:
 *   node scripts/ocr/eval-arena-ocr.mjs [--labels tests/fixtures/arena-ocr/labels.json] [--limit N] [--verbose]
 *
 * Labels are the Latin tokens recorded in the existing canonical `.webp` filenames
 * (pseudo-labels from earlier pipeline runs), so treat small differences as label noise.
 */
import { isMain } from "../cli.mjs";
import { createOcrStrategy } from "../pipeline/ocr-strategy.mjs";
import { loadLlmConfig } from "../llm/vision-client.mjs";
import { runOcrEval } from "./ocr-eval.mjs";

export {
  evaluateRows as evaluateArenaRows,
  levenshtein,
  normalizeForCompare,
  reportEvaluation as reportArenaEvaluation,
  similarity,
} from "./ocr-eval.mjs";

/**
 * CLI body for the arena fixture.
 * @param {string[]} [argv]
 * @param {{
 *   loadLabels?: (labelsPath: string) => Promise<{ images: { path: string, name: string, power: number }[] }>,
 *   makeStrategy?: () => any,
 *   log?: (...args: any[]) => void,
 *   root?: string,
 * }} [deps]
 */
export function runArenaOcrEval(argv = process.argv.slice(2), deps = {}) {
  return runOcrEval(argv, {
    defaultLabels: "tests/fixtures/arena-ocr/labels.json",
    makeStrategy: () => createOcrStrategy({ config: loadLlmConfig() }),
    ...deps,
  });
}

async function main() {
  await runArenaOcrEval();
}

if (isMain(import.meta.url)) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
