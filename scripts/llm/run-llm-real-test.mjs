#!/usr/bin/env node
import path from "path";
import { extractEnemyDataFromScreenshot } from "./llm-enemy-extract.mjs";

async function main() {
  const src = process.argv[2] || "data/enemies/test/Screenshot_2026.06.19_09.49.47.958.png";
  const host = process.env.LLM_HOST ?? undefined;
  const model = process.env.LLM_MODEL ?? undefined;
  const timeoutMs = Number(process.env.LLM_TEST_TIMEOUT_MS ?? 180_000);

  const resolved = path.resolve(src);
  console.log(`Running real LLM test -> ${resolved}`);
  console.log(`Host: ${host ?? "(env/default)"}, model: ${model ?? "(env/default)"}\n`);

  try {
    const res = await extractEnemyDataFromScreenshot(resolved, { host, model, timeoutMs });
    console.log("LLM result:", JSON.stringify(res, null, 2));
    process.exit(0);
  } catch (err) {
    console.error("LLM test failed:", err instanceof Error ? err.message : err);
    process.exit(2);
  }
}

main();

