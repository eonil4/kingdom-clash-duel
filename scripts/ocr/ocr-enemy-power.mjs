/**
 * OCR the power strip from a full arena opponent screenshot.
 */
import fs from "fs/promises";
import path from "path";
import sharp from "sharp";
import { createWorker } from "tesseract.js";
import {
  buildPowerBox,
  cropBoxFromPercent,
  POWER_BOX,
  preprocessForOcr,
} from "./ocr-enemy-crops.mjs";
import { isMain } from "../cli.mjs";

/**
 * Longest digit group wins (OCR may split "8104472" into "8 104 472").
 * @param {string} text
 * @returns {number | undefined}
 */
export function cleanupPower(text) {
  const raw = String(text ?? "");
  const groupedPattern = /\d{1,3}(?:[ _]\d{3})+/g;
  let bestGrouped = undefined;
  let bestGroupedLen = 0;
  for (const m of raw.matchAll(groupedPattern)) {
    const digits = m[0].replace(/[^\d]+/g, "");
    if (!digits) continue;
    if (digits.length > bestGroupedLen) {
      bestGroupedLen = digits.length;
      bestGrouped = Number(digits);
    }
  }
  if (bestGrouped !== undefined) return bestGrouped;

  const numericChunks = raw.match(/\d+/g) ?? [];
  if (numericChunks.length > 0) {
    numericChunks.sort((a, b) => b.length - a.length);
    return Number(numericChunks[0]);
  }

  const digits = raw.replace(/[^\d]+/g, "");
  if (!digits) return undefined;
  return Number(digits);
}

/**
 * @param {import("tesseract.js").Worker} worker
 * @param {{ powerRoi?: { x: number, y: number, width: number, height: number }, reference?: { width: number, height: number } }} [options]
 * @returns {Promise<number | undefined>}
 */
export async function ocrEnemyPower(filePath, worker, options = {}) {
  const meta = await sharp(filePath).metadata();
  if (!meta.width || !meta.height) return undefined;

  const powerCrop =
    (options.powerRoi
      ? buildPowerBox(meta, options.powerRoi, options.reference)
      : undefined) ?? cropBoxFromPercent(meta, POWER_BOX);
  const powerBuf = await preprocessForOcr(sharp(filePath).extract(powerCrop), {
    threshold: 190,
  });

  await worker.setParameters({
    tessedit_char_whitelist: "0123456789 ",
    tessedit_pageseg_mode: "6",
  });
  const powerRes = await worker.recognize(powerBuf);
  return cleanupPower(powerRes.data.text);
}


async function cliMain() {
  const imgPath = process.argv[2];
  if (!imgPath) {
    console.error("Usage: node scripts/ocr-enemy-power.mjs <image.png>");
    process.exit(1);
  }
  const resolved = path.resolve(imgPath);
  await fs.access(resolved).catch(() => {
    console.error(`Not found: ${resolved}`);
    process.exit(1);
  });

  const worker = await createWorker("eng");
  try {
    await worker.setParameters({ preserve_interword_spaces: "1" });
    const power = await ocrEnemyPower(resolved, worker);
    console.log(power === undefined ? "" : String(power));
  } finally {
    await worker.terminate();
  }
}

if (isMain(import.meta.url)) {
  cliMain().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

