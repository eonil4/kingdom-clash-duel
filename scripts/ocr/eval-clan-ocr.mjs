/**
 * Evaluate the clan OCR strategy against a labelled sample set.
 *
 * Usage:
 *   node scripts/ocr/eval-clan-ocr.mjs [--labels tests/fixtures/clan-ocr/labels.json] [--limit N] [--verbose]
 *
 * Labels are names captured by the LLM formation extractor (normalised match),
 * so treat small differences as label noise rather than strictly OCR error.
 */
import { isMain } from "../cli.mjs";
import { createOcrStrategy } from "../pipeline/ocr-strategy.mjs";
import { loadLlmConfig } from "../llm/vision-client.mjs";
import { runOcrEval } from "./ocr-eval.mjs";

export {
  evaluateFixture as evaluateClanFixture,
  evaluateRows as evaluateClanRows,
  levenshtein,
  normalizeForCompare,
  reportEvaluation as reportClanEvaluation,
  similarity,
} from "./ocr-eval.mjs";

/**
 * CLI body for the clan fixture.
 * @param {string[]} [argv]
 * @param {{
 *   loadLabels?: (labelsPath: string) => Promise<{ images: { path: string, name: string, power: number }[] }>,
 *   makeStrategy?: () => any,
 *   log?: (...args: any[]) => void,
 *   root?: string,
 * }} [deps]
 */
export function runClanOcrEval(argv = process.argv.slice(2), deps = {}) {
  return runOcrEval(argv, {
    defaultLabels: "tests/fixtures/clan-ocr/labels.json",
    makeStrategy: () => createOcrStrategy({ targetKey: "clan", config: loadLlmConfig() }),
    ...deps,
  });
}

async function main() {
  await runClanOcrEval();
}

if (isMain(import.meta.url)) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
