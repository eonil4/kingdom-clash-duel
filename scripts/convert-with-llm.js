/**
 * Process enemy screenshots in a folder: Ollama vision extraction, WebP conversion, fileMap update.
 *
 * Usage:
 *   node scripts/convert.js data/enemies/2026-05-22/test
 *
 * Requires a local vision LLM (default: LM Studio on :1234):
 *   LLM_PROVIDER=lmstudio
 *   LLM_MODEL=google/gemma-4-e4b
 *   LLM_HOST=http://127.0.0.1:1234
 */
import fs from "fs/promises";
import path from "path";
import { writeWebpFromRasterFile } from "./enemy-image-webp.mjs";
import { toSafeEnemyFilenameToken } from "./enemy-filename-tokens.mjs";
import {
  canonicalEnemyMapKey,
  DEFAULT_FILE_MAP_PATH,
  loadExistingFileMap,
  setNestedMapping,
  sortMapNode,
  WORKSPACE_ROOT,
} from "./file-map-enemies.mjs";
import { extractEnemyDataFromScreenshot } from "./ollama-enemy-extract.mjs";

/**
 * @param {string} imagePath
 */
async function callLLMApiForDataExtraction(imagePath) {
  console.log(`\t[LLM] ${path.basename(imagePath)}...`);
  const extracted = await extractEnemyDataFromScreenshot(imagePath);
  console.log(
    `\t[LLM] power=${extracted.power} name=${JSON.stringify(extracted.name)}` +
      (extracted.englishName ? ` english=${JSON.stringify(extracted.englishName)}` : ""),
  );
  return extracted;
}

/**
 * @param {string} folderArg
 */
async function processImageFolder(folderArg) {
  const folderAbs = path.isAbsolute(folderArg)
    ? folderArg
    : path.resolve(WORKSPACE_ROOT, folderArg.replace(/^(\.\.\/)+/, ""));

  const entries = await fs.readdir(folderAbs, { withFileTypes: true });
  const pngFiles = entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".png"))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));

  if (pngFiles.length === 0) {
    console.warn(`No PNG files in ${folderAbs}`);
    return;
  }

  console.log(`\nStarting processing for folder: ${folderAbs} (${pngFiles.length} images)`);

  const mapRoot = await loadExistingFileMap(DEFAULT_FILE_MAP_PATH);
  let converted = 0;
  let skipped = 0;

  for (const originalFileName of pngFiles) {
    const imagePath = path.join(folderAbs, originalFileName);

    try {
      console.log(`\n[Processing] ${originalFileName}`);
      const extracted = await callLLMApiForDataExtraction(imagePath);
      if (!extracted?.power || !extracted?.name) {
        throw new Error("LLM did not return power and name.");
      }

      const nameLatinRaw =
        extracted.englishName?.trim() || toSafeEnemyFilenameToken(extracted.name);
      const mapEntry = {
        name: extracted.name,
        nameLatin: nameLatinRaw,
        power: Number(extracted.power),
      };
      if (extracted.englishName?.trim()) {
        mapEntry.nameEnglish = extracted.englishName.trim();
      }

      const mapKey = canonicalEnemyMapKey(imagePath, {
        power: mapEntry.power,
        nameLatinRaw,
        nameEnglish: mapEntry.nameEnglish,
      });
      const canonicalName = path.posix.basename(mapKey);
      const outputPath = path.join(folderAbs, canonicalName);

      setNestedMapping(mapRoot, mapKey, mapEntry);

      try {
        await fs.access(outputPath);
        console.log(`\t[Skip] WebP already exists: ${canonicalName}`);
        skipped++;
        continue;
      } catch {
        // create
      }

      console.log(`\t[Conversion] -> ${canonicalName}`);
      await writeWebpFromRasterFile(imagePath, outputPath);
      converted++;
    } catch (err) {
      console.error(`\t[Error] ${originalFileName}:`, err instanceof Error ? err.message : err);
    }
  }

  const sorted = sortMapNode(mapRoot);
  await fs.writeFile(DEFAULT_FILE_MAP_PATH, `${JSON.stringify(sorted, null, 2)}\n`, "utf8");

  console.log(
    `\nDone: ${converted} converted, ${skipped} already existed. Map written to ${DEFAULT_FILE_MAP_PATH}`,
  );
}

async function main() {
  const folderArg = process.argv[2] ?? "data/enemies/2026-05-22/test";
  await processImageFolder(folderArg);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
