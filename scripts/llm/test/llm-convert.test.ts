import { it, expect } from "vitest";
import fs from "fs/promises";
import path from "path";
import { writeWebpFromRasterFile } from "../enemy-image-webp.mjs";
import { toSafeEnemyFilenameToken } from "../../ocr/enemy-filename-tokens.mjs";

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

