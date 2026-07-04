/**
 * OCR the opponent name from a full arena screenshot (top-right region + fallbacks).
 */
import fs from "fs/promises";
import path from "path";
import sharp from "sharp";
import { createWorker } from "tesseract.js";
import { fileURLToPath } from "url";
import {
  cropBoxFromPercent,
  NAME_BOX,
  NAME_BOX_WIDE,
  NAME_TEXT_BOX,
  NAME_TEXT_LINE_BOX,
  preprocessForOcr,
  preprocessRawForOcr,
} from "./ocr-enemy-crops.mjs";

/** Letters, digits, tag punctuation (Windows-safe); excludes reserved filename chars. */
const NAME_STRIP_OUTSIDE_CLASS = /[^\p{L}\d_\- \\|\[\]]+/gu;

function cleanupName(text) {
  const cleaned = String(text)
    .replace(/\s+/g, " ")
    .replace(NAME_STRIP_OUTSIDE_CLASS, "")
    .trim();
  const tokens = cleaned.split(" ").filter(Boolean);
  const candidates = tokens.filter((t) =>
    /^[\p{L}][\p{L}\d_\-\\|\[\]]+$/u.test(t),
  );
  if (candidates.length === 0) return "";

  const mixedCase = candidates.filter((c) => /[A-Z]/.test(c) && /[a-z]/.test(c));
  if (mixedCase.length > 0) {
    return mixedCase[mixedCase.length - 1] ?? "";
  }

  const titleCase = candidates.filter((c) =>
    /^[\p{Lu}][\p{L}\d_\-\\|\[\]]+$/u.test(c),
  );
  const pool = titleCase.length > 0 ? titleCase : candidates;
  return pool[pool.length - 1] ?? "";
}

function cleanupNamePhrase(text) {
  return String(text)
    .replace(NAME_STRIP_OUTSIDE_CLASS, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreNameCandidate(name) {
  if (!name) return -1;
  if (!/^[\p{L}][\p{L}\d_\-\\|\[\]]{1,48}$/u.test(name)) return -1;
  let score = name.length;
  if (/\p{Lu}/u.test(name) && /\p{Ll}/u.test(name)) score += 4;
  if (/^\d+$/.test(name)) score -= 10;
  if (/^(VS|LV|WWW)$/i.test(name)) score -= 3;
  if (/[\p{sc=Cyrillic}]/u.test(name) && /[A-Za-z]{2}/.test(name)) score += 6;
  if (/\\/.test(name)) score += 8;
  if (/[\[\]]/.test(name)) score += 5;
  return score;
}

/** Penalise HUD-like digit islands; reward mixed-script lines and tag separators. */
export function arenaNameLineQuality(line) {
  const s = String(line).trim();
  if (!s) return -1000;
  let q = 0;
  if (/\\|\//.test(s)) q += 35;
  if (/[\[\]]/.test(s)) q += 22;
  if (/[\p{sc=Cyrillic}]/u.test(s) && /[A-Za-z]{2,}/.test(s)) q += 25;
  if (/\s\d{2,3}\s/.test(s)) q -= 35;
  if (/^\d+\s/.test(s) || /\s\d+$/.test(s)) q -= 15;
  return q;
}

/** Tighten OCR spacing around `\`, `|`, and bracket tags. */
export function normalizeOpponentDisplayName(name) {
  return cleanupNamePhrase(
    String(name)
      .replace(/\s*\\\s*/g, "\\")
      .replace(/\s*\|\s*/g, "|")
      .replace(/\s*\[\s*/g, "[")
      .replace(/\s*\]\s*/g, "]"),
  );
}

/**
 * In folders named `test`, merge name OCR from small sibling PNG crops (e.g. %-encoded
 * reference filenames) when they score higher than the full screenshot.
 */
export async function refineEnemyNameWithTestFolderCrops(
  folderAbsPath,
  fullScreenshotPath,
  preliminaryName,
  worker,
  workerRus,
  options = {},
) {
  let best = normalizeOpponentDisplayName(preliminaryName);
  let bestQ = arenaNameLineQuality(best);

  if (path.basename(folderAbsPath).toLowerCase() !== "test") {
    return best;
  }

  const entries = await fs.readdir(folderAbsPath, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isFile() || !e.name.toLowerCase().endsWith(".png")) continue;
    const cropPath = path.join(folderAbsPath, e.name);
    if (path.resolve(cropPath) === path.resolve(fullScreenshotPath)) continue;
    if (isTestFolderPrimaryScreenshot(folderAbsPath, cropPath)) continue;
    if (/^\d{1,3}_\d{3}_\d{3}\.png$/i.test(e.name)) continue;

    let st;
    try {
      st = await fs.stat(cropPath);
    } catch {
      continue;
    }
    if (st.size > 120000) continue;

    const n = normalizeOpponentDisplayName(
      await ocrEnemyName(cropPath, worker, workerRus, {
        ...options,
        baseLabel: e.name,
      }),
    );
    const q = arenaNameLineQuality(n);
    if (q > bestQ && n) {
      best = n;
      bestQ = q;
    }
  }

  return best;
}

/** Primary full screenshots in `test/` — not used as name-reference crops. */
function isTestFolderPrimaryScreenshot(folderAbsPath, filePath) {
  if (path.basename(folderAbsPath).toLowerCase() !== "test") return false;
  const base = path.basename(filePath);
  const lower = base.toLowerCase();
  return lower === "test.png" || /^screenshot_/i.test(base);
}

function isLikelyOcrNoise(name) {
  const n = cleanupName(String(name || ""));
  if (!n) return true;
  const oneToken = n.split(/\s+/).length === 1;
  const lowInfo = /^[A-Za-z]{2,4}$/.test(n) && !/[aeiouy]/i.test(n);
  const generic = /^(prt|prs|pri|pry|rps|rds|pre|rks)$/i.test(n);
  return oneToken && (lowInfo || generic);
}

function extractNameFromTopRightWords(ocrData, width, height) {
  const words = Array.isArray(ocrData?.words) ? ocrData.words : [];
  const candidates = words
    .map((w) => ({
      text: cleanupName(w.text),
      x0: w?.bbox?.x0 ?? 0,
      y0: w?.bbox?.y0 ?? 0,
      conf: typeof w.confidence === "number" ? w.confidence : 0,
    }))
    .filter(
      (w) =>
        w.conf >= 30 &&
        /[\p{L}]/u.test(w.text) &&
        !/^\d+$/.test(w.text) &&
        w.x0 > width * 0.66 &&
        w.y0 > height * 0.01 &&
        w.y0 < height * 0.14,
    )
    .filter((w) => scoreNameCandidate(w.text) >= 0);

  if (candidates.length === 0) return "";
  candidates.sort((a, b) => b.x0 - a.x0 || a.y0 - b.y0 || b.conf - a.conf);
  return candidates[0]?.text ?? "";
}

function extractTopRightLineName(ocrData, width, height) {
  const lines = Array.isArray(ocrData?.lines) ? ocrData.lines : [];
  const candidates = lines
    .map((l) => ({
      text: cleanupNamePhrase(l.text),
      x0: l?.bbox?.x0 ?? 0,
      y0: l?.bbox?.y0 ?? 0,
      conf: typeof l.confidence === "number" ? l.confidence : 0,
    }))
    .filter(
      (l) =>
        l.text &&
        /[\p{L}]/u.test(l.text) &&
        l.x0 > width * 0.58 &&
        l.y0 > height * 0.005 &&
        l.y0 < height * 0.16 &&
        l.conf >= 20,
    );
  if (candidates.length === 0) return "";
  candidates.sort((a, b) => b.x0 - a.x0 || a.y0 - b.y0 || b.conf - a.conf);
  return candidates[0]?.text ?? "";
}

function extractBestPhraseFromRawText(rawText) {
  const lines = String(rawText || "")
    .split(/\r?\n/)
    .map((l) => cleanupNamePhrase(l))
    .filter(Boolean);
  const candidates = [];
  for (const line of lines) {
    if (/^vs$/i.test(line)) continue;
    if (/^\d+([ _]\d+)*$/.test(line)) continue;
    const words = line.split(/\s+/).filter(Boolean);
    if (words.length < 2) continue;
    if (!words.some((w) => /[\p{L}]/u.test(w))) continue;
    let score = line.length;
    if (/[\p{sc=Cyrillic}]/u.test(line)) score += 20;
    candidates.push({ line, score });
  }
  if (candidates.length === 0) return "";
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.line ?? "";
}

const LATIN_WHITELIST =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzАБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдеёжзийклмнопрстуфхцчшщъыьэюя0123456789_- \\|[] ";

/**
 * @param {import("tesseract.js").Worker} worker
 * @param {import("tesseract.js").Worker} workerRus
 * @param {{ debugDir?: string, baseLabel?: string }} [options]
 * @returns {Promise<string>}
 */
export async function ocrEnemyName(filePath, worker, workerRus, options = {}) {
  const { debugDir, baseLabel } = options;
  const base = baseLabel ?? path.basename(filePath);
  const meta = await sharp(filePath).metadata();
  if (!meta.width || !meta.height) return "";
  const nameCrop = cropBoxFromPercent(meta, NAME_BOX);
  const nameCropWide = cropBoxFromPercent(meta, NAME_BOX_WIDE);
  const nameTextCrop = cropBoxFromPercent(meta, NAME_TEXT_BOX);
  const nameTextLineCrop = cropBoxFromPercent(meta, NAME_TEXT_LINE_BOX);
  const nameImg = sharp(filePath).extract(nameCrop);
  const nameImgWide = sharp(filePath).extract(nameCropWide);
  const nameTextImg = sharp(filePath).extract(nameTextCrop);
  const nameTextLineImg = sharp(filePath).extract(nameTextLineCrop);
  const nameBufNeutral = await preprocessForOcr(nameImg, { width: 1800 });
  const nameBufThreshold = await preprocessForOcr(nameImg, {
    width: 1800,
    threshold: 155,
  });
  const nameBufRaw = await preprocessRawForOcr(nameImg, { width: 1800 });
  const nameWideBufNeutral = await preprocessForOcr(nameImgWide, { width: 2000 });
  const nameWideBufThreshold = await preprocessForOcr(nameImgWide, {
    width: 2000,
    threshold: 150,
  });
  const nameWideBufRaw = await preprocessRawForOcr(nameImgWide, { width: 2000 });
  const nameTextBufNeutral = await preprocessForOcr(nameTextImg, { width: 2200 });
  const nameTextBufThreshold = await preprocessForOcr(nameTextImg, {
    width: 2200,
    threshold: 145,
  });
  const nameTextBufRaw = await preprocessRawForOcr(nameTextImg, { width: 2200 });
  const nameTextLineBufRaw = await preprocessRawForOcr(nameTextLineImg, {
    width: 2400,
  });
  const nameTextLineBufNeutral = await preprocessForOcr(nameTextLineImg, {
    width: 2400,
  });
  const nameTextLineBufThreshold = await preprocessForOcr(nameTextLineImg, {
    width: 2400,
    threshold: 140,
  });
  const fullWidth = 1400;
  const fullHeight = Math.max(
    1,
    Math.round((meta.height / meta.width) * fullWidth),
  );
  const fullBuf = await preprocessRawForOcr(sharp(filePath), { width: fullWidth });
  if (debugDir) {
    await fs.mkdir(debugDir, { recursive: true });
    const prefix = path.join(debugDir, `${base}.`);
    await fs.writeFile(`${prefix}name-raw.png`, nameBufRaw);
    await fs.writeFile(`${prefix}name-wide-raw.png`, nameWideBufRaw);
    await fs.writeFile(`${prefix}name-text-line-raw.png`, nameTextLineBufRaw);
    await fs.writeFile(`${prefix}full.png`, fullBuf);
  }
  await worker.setParameters({
    tessedit_char_whitelist: LATIN_WHITELIST,
    tessedit_pageseg_mode: "8",
  });
  const nameResRaw = await worker.recognize(nameBufRaw);
  const nameResNeutral = await worker.recognize(nameBufNeutral);
  const nameResThreshold = await worker.recognize(nameBufThreshold);
  const nameWideResRaw = await worker.recognize(nameWideBufRaw);
  const nameWideResNeutral = await worker.recognize(nameWideBufNeutral);
  const nameWideResThreshold = await worker.recognize(nameWideBufThreshold);
  await worker.setParameters({
    tessedit_char_whitelist: LATIN_WHITELIST,
    tessedit_pageseg_mode: "7",
  });
  const nameTextResRaw = await worker.recognize(nameTextBufRaw);
  const nameTextResNeutral = await worker.recognize(nameTextBufNeutral);
  const nameTextResThreshold = await worker.recognize(nameTextBufThreshold);
  const nameTextLineResRaw = await worker.recognize(nameTextLineBufRaw);
  const nameTextLineResNeutral = await worker.recognize(nameTextLineBufNeutral);
  const nameTextLineResThreshold = await worker.recognize(nameTextLineBufThreshold);
  await worker.setParameters({
    tessedit_char_whitelist: LATIN_WHITELIST,
    tessedit_pageseg_mode: "7",
  });
  const nameTextResCyrRaw = await worker.recognize(nameTextBufRaw);
  const nameTextResCyrNeutral = await worker.recognize(nameTextBufNeutral);
  const nameTextResCyrThreshold = await worker.recognize(nameTextBufThreshold);
  await workerRus.setParameters({
    tessedit_char_whitelist: LATIN_WHITELIST,
    tessedit_pageseg_mode: "7",
  });
  const nameTextRusRaw = await workerRus.recognize(nameTextBufRaw);
  const nameTextRusNeutral = await workerRus.recognize(nameTextBufNeutral);
  const nameTextRusThreshold = await workerRus.recognize(nameTextBufThreshold);
  const nameTextLineRusRaw = await workerRus.recognize(nameTextLineBufRaw);
  const nameTextLineRusNeutral = await workerRus.recognize(nameTextLineBufNeutral);
  const nameTextLineRusThreshold = await workerRus.recognize(nameTextLineBufThreshold);
  const candidates = [
    cleanupName(nameResRaw.data.text),
    cleanupName(nameResNeutral.data.text),
    cleanupName(nameResThreshold.data.text),
    cleanupName(nameWideResRaw.data.text),
    cleanupName(nameWideResNeutral.data.text),
    cleanupName(nameWideResThreshold.data.text),
    cleanupNamePhrase(nameTextResRaw.data.text),
    cleanupNamePhrase(nameTextResNeutral.data.text),
    cleanupNamePhrase(nameTextResThreshold.data.text),
    cleanupNamePhrase(nameTextLineResRaw.data.text),
    cleanupNamePhrase(nameTextLineResNeutral.data.text),
    cleanupNamePhrase(nameTextLineResThreshold.data.text),
    cleanupNamePhrase(nameTextResCyrRaw.data.text),
    cleanupNamePhrase(nameTextResCyrNeutral.data.text),
    cleanupNamePhrase(nameTextResCyrThreshold.data.text),
    cleanupNamePhrase(nameTextRusRaw.data.text),
    cleanupNamePhrase(nameTextRusNeutral.data.text),
    cleanupNamePhrase(nameTextRusThreshold.data.text),
    cleanupNamePhrase(nameTextLineRusRaw.data.text),
    cleanupNamePhrase(nameTextLineRusNeutral.data.text),
    cleanupNamePhrase(nameTextLineRusThreshold.data.text),
  ];
  candidates.sort((a, b) => {
    const dq = arenaNameLineQuality(b) - arenaNameLineQuality(a);
    if (dq !== 0) return dq;
    return scoreNameCandidate(b) - scoreNameCandidate(a);
  });
  let name = candidates[0] ?? "";
  const textAreaCandidates = [
    cleanupNamePhrase(nameTextResRaw.data.text),
    cleanupNamePhrase(nameTextResNeutral.data.text),
    cleanupNamePhrase(nameTextResThreshold.data.text),
    cleanupNamePhrase(nameTextLineResRaw.data.text),
    cleanupNamePhrase(nameTextLineResNeutral.data.text),
    cleanupNamePhrase(nameTextLineResThreshold.data.text),
    cleanupNamePhrase(nameTextResCyrRaw.data.text),
    cleanupNamePhrase(nameTextResCyrNeutral.data.text),
    cleanupNamePhrase(nameTextResCyrThreshold.data.text),
    cleanupNamePhrase(nameTextRusRaw.data.text),
    cleanupNamePhrase(nameTextRusNeutral.data.text),
    cleanupNamePhrase(nameTextRusThreshold.data.text),
    cleanupNamePhrase(nameTextLineRusRaw.data.text),
    cleanupNamePhrase(nameTextLineRusNeutral.data.text),
    cleanupNamePhrase(nameTextLineRusThreshold.data.text),
  ].filter((c) => /[\p{L}].*[\p{L}]/u.test(c));
  if (textAreaCandidates.length > 0) {
    const uniq = [...new Set(textAreaCandidates)];
    const mixedScriptOrSep = uniq.filter(
      (c) =>
        /\\|\//.test(c) ||
        /[\[\]]/.test(c) ||
        (/[\p{sc=Cyrillic}]/u.test(c) && /[A-Za-z]{2,}/.test(c)),
    );
    const cyrLineCandidates = uniq.filter(
      (c) =>
        /[\p{sc=Cyrillic}]/u.test(c) &&
        c.split(/\s+/).filter(Boolean).length >= 2,
    );
    const pool =
      mixedScriptOrSep.length > 0
        ? mixedScriptOrSep
        : cyrLineCandidates.length > 0
          ? cyrLineCandidates
          : uniq;
    pool.sort((a, b) => {
      const dq = arenaNameLineQuality(b) - arenaNameLineQuality(a);
      if (dq !== 0) return dq;
      const aw = a.split(/\s+/).filter(Boolean).length;
      const bw = b.split(/\s+/).filter(Boolean).length;
      if (aw !== bw) return bw - aw;
      return b.length - a.length;
    });
    name = pool[0] ?? name;
  }
  if (scoreNameCandidate(name) < 4 || isLikelyOcrNoise(name)) {
    await worker.setParameters({
      tessedit_char_whitelist: LATIN_WHITELIST,
      tessedit_pageseg_mode: "11",
    });
    const fullRes = await worker.recognize(fullBuf);
    const fallbackLineName = extractTopRightLineName(fullRes.data, fullWidth, fullHeight);
    const fallbackWordName = extractNameFromTopRightWords(
      fullRes.data,
      fullWidth,
      fullHeight,
    );
    const fallbackRawPhrase = extractBestPhraseFromRawText(fullRes.data?.text);
    if (/[\p{L}].* [\p{L}]/u.test(fallbackRawPhrase)) {
      name = fallbackRawPhrase;
    } else if (/[\p{L}].* [\p{L}]/u.test(fallbackLineName)) {
      name = fallbackLineName;
    } else {
      const fallbackName =
        scoreNameCandidate(cleanupName(fallbackLineName)) >=
        scoreNameCandidate(cleanupName(fallbackWordName))
          ? fallbackLineName
          : fallbackWordName;
      if (scoreNameCandidate(cleanupName(fallbackName)) > scoreNameCandidate(name)) {
        name = fallbackName;
      }
    }
  }
  return normalizeOpponentDisplayName(cleanupNamePhrase(name));
}

const __filename = fileURLToPath(import.meta.url);
async function cliMain() {
  const imgPath = process.argv[2];
  if (!imgPath) {
    console.error("Usage: node scripts/ocr-enemy-name.mjs <image.png>");
    process.exit(1);
  }
  const resolved = path.resolve(imgPath);
  await fs.access(resolved).catch(() => {
    console.error(`Not found: ${resolved}`);
    process.exit(1);
  });
  const worker = await createWorker("eng+rus");
  const workerRus = await createWorker("rus");
  try {
    await worker.setParameters({ preserve_interword_spaces: "1" });
    await workerRus.setParameters({ preserve_interword_spaces: "1" });
    const name = await ocrEnemyName(resolved, worker, workerRus);
    console.log(name);
  } finally {
    await worker.terminate();
    await workerRus.terminate();
  }
}

const invokedDirectly =
  path.resolve(process.argv[1] ?? "") === path.resolve(__filename);
if (invokedDirectly) {
  cliMain().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

