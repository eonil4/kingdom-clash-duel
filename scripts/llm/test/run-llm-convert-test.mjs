import fs from "fs/promises";
import path from "path";
import assert from "assert";
import { writeWebpFromRasterFile } from "./enemy-image-webp.mjs";
import { toSafeEnemyFilenameToken } from "../ocr/enemy-filename-tokens.mjs";

async function run() {
  const model = "qwen/qwen3-vl-4b";
  const modelFolder = toSafeEnemyFilenameToken(model);
  const src = path.resolve("data/enemies/test/Screenshot_2026.06.19_09.49.47.958.png");
  try {
    await fs.access(src);
  } catch (e) {
    console.error("Source not found:", src);
    process.exit(2);
  }

  const outDir = path.join("data", "enemies", "test", modelFolder);
  await fs.mkdir(outDir, { recursive: true });
  const target = path.join(outDir, path.basename(src).replace(/\.[^/.]+$/, ".webp"));

  try {
    await writeWebpFromRasterFile(src, target);
    const st = await fs.stat(target);
    assert(st.size > 100, "output file too small");
    console.log("Conversion OK:", target, st.size, "bytes");
    process.exit(0);
  } catch (err) {
    console.error("Test failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  } finally {
    try { await fs.unlink(target); } catch {}
    try {
      const files = await fs.readdir(outDir);
      if (files.length === 0) await fs.rmdir(outDir);
    } catch {}
  }
}

run();

