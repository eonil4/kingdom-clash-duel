import { it, expect } from "vitest";
import fs from "fs/promises";
import path from "path";
/*
import { extractEnemyDataFromScreenshot } from "../../llm-enemy-extract.mjs";

it("real LM (qwen/qwen3-vl-4b) extracts name and power from test screenshot", async () => {
  const src = path.resolve("data/enemies/test/Screenshot_2026.06.19_09.49.47.958.png");
  await fs.access(src);

  const host = process.env.LLM_HOST ?? undefined;
  const model = process.env.LLM_MODEL ?? "qwen/qwen3-vl-4b";
  const timeoutMs = Number(process.env.LLM_TEST_TIMEOUT_MS ?? 180_000);

  const result = await extractEnemyDataFromScreenshot(src, { host, model, timeoutMs });
  expect(result).toBeTruthy();
  expect(typeof result.name).toBe("string");
  expect(result.name.length).toBeGreaterThan(0);
  expect(typeof result.power).toBe("number");
  expect(result.power).toBeGreaterThan(0);
});
*/
import { writeWebpFromRasterFile } from "../../scripts/llm/enemy-image-webp.mjs";
import { toSafeEnemyFilenameToken } from "../../scripts/ocr/enemy-filename-tokens.mjs";

it("converts test screenshot into model-named output folder", async () => {
  const model = "qwen/qwen3-vl-4b";
  const modelFolder = toSafeEnemyFilenameToken(model);
  const src = path.resolve("data/enemies/test/Screenshot_2026.06.19_09.49.47.958.png");

  // ensure source exists
  await fs.access(src);

  const outDir = path.join("data", "enemies", "test", modelFolder);
  await fs.mkdir(outDir, { recursive: true });
  const target = path.join(outDir, path.basename(src).replace(/\.[^/.]+$/, ".webp"));

  try {
    await writeWebpFromRasterFile(src, target);
    const st = await fs.stat(target);
    expect(st.size).toBeGreaterThan(100);
  } finally {
    // cleanup generated file and directory (if empty)
    try {
      await fs.unlink(target);
    } catch {}
    try {
      const files = await fs.readdir(outDir);
      if (files.length === 0) await fs.rmdir(outDir);
    } catch {}
  }
});

