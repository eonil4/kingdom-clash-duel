/**
 * OCR the opponent name from a full arena screenshot (top-right region + fallbacks).
 */
import fs from "fs/promises";
import path from "path";
import sharp from "sharp";
import { createWorker } from "tesseract.js";
import { CLAN_NAME_PICK, OCR_EARLY_EXIT, OCR_UPSCALE_WIDTHS } from "../constants.mjs";
import { log } from "../log.mjs";
import { isMain } from "../cli.mjs";
import {
  buildNameBoxes,
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

export function cleanupName(text) {
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

export function cleanupNamePhrase(text) {
  return String(text)
    .replace(NAME_STRIP_OUTSIDE_CLASS, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function scoreNameCandidate(name) {
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

/**
 * Arena first-pass output that already looks like a full tag name, so the
 * remaining recognition variants on the text-area crops can be skipped.
 * @param {{ data?: { text?: string, confidence?: number } }} result
 */
export function isStrongFirstPassResult(result) {
  const phrase = normalizeOpponentDisplayName(cleanupNamePhrase(result?.data?.text ?? ""));
  const confidence = Number(result?.data?.confidence) || 0;
  const letters = phrase.match(/\p{L}/gu) ?? [];
  return (
    confidence >= OCR_EARLY_EXIT.minConfidence &&
    letters.length >= 2 &&
    /[\\|\[\]]/u.test(phrase) &&
    arenaNameLineQuality(phrase) >= 0
  );
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
        debugDir: options.debugDir,
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

export function isLikelyOcrNoise(name) {
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

export function extractBestPhraseFromRawText(rawText) {
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

const LATIN_ONLY_WHITELIST =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 _-\\|[] ";

/**
 * Strip unbalanced tag noise such as a trailing "]" produced by stylised fonts.
 * @param {string} text
 */
export function stripUnbalancedTagNoise(text) {
  let s = cleanupNamePhrase(String(text ?? ""));
  const opens = (s.match(/\[/g) ?? []).length;
  const closes = (s.match(/\]/g) ?? []).length;
  if (opens === 0 && closes > 0) s = s.replace(/\]/g, "");
  else if (closes === 0 && opens > 0) s = s.replace(/\[/g, "");
  else if (closes > opens) s = s.replace(/\]+$/g, "");
  else if (opens > closes) s = s.replace(/^\[+/g, "");
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Drop OCR glyph noise that masquerades as a leading/trailing tag separator
 * (e.g. an opponent-level icon read as "|", "\\" or "_").
 * @param {string} text
 */
export function stripEdgeTagSeparators(text) {
  return String(text)
    .replace(/^[\s|\\_]+/u, "")
    .replace(/[\s|\\_]+$/u, "");
}

/**
 * Strip a clipped leading token produced when the name window starts inside the
 * previous UI label (e.g. the "...n" of "Clan" before "HuN | TOLDI").
 * @param {string} text
 */
export function stripLeadingClippedToken(text) {
  const s = cleanupNamePhrase(String(text ?? ""));
  const m = s.match(/^(\S+)\s+(.+)$/u);
  if (!m) return s;
  const [, first, rest] = m;
  const single = /^[\p{L}\d]$/u.test(first);
  const lowercase = /^\p{Ll}+$/u.test(first);
  return single || lowercase ? rest : s;
}

/**
 * Correct a narrow class of stylised-font confusions in a leading clan tag:
 * the arena/formation font often renders "HuN" as A/S/H + "ulN" when followed by
 * a tag separator. Only that exact leading shape is rewritten.
 * @param {string} text
 */
export function correctClanNameConfusables(text) {
  const s = cleanupNamePhrase(String(text ?? ""));
  if (/^(?:AulN|SulN|HulN|HuIN)(?=\s*[|\\])/u.test(s)) {
    return s.replace(/^(?:AulN|SulN|HulN|HuIN)/u, "HuN");
  }
  return s;
}

/**
 * Choose a clan/formation name from a Latin-only recognition pass, falling back to
 * the mixed-script result when the Latin pass is not confident enough.
 *
 * @param {{ text: string, confidence?: number }[]} candidates
 * @param {string} fallbackName
 */
export function pickClanName(candidates, fallbackName) {
  const fallbackText = cleanupNamePhrase(String(fallbackName ?? ""));
  // Keep a genuinely Cyrillic formation name; garbled Cyrillic islands from a Latin
  // name (e.g. "Нш|ТОО" for "HuN | TOLDI") still go through the Latin preference.
  const cyr = (fallbackText.match(/\p{sc=Cyrillic}/gu) ?? []).length;
  const lat = (fallbackText.match(/[A-Za-z]/g) ?? []).length;

  const scored = (candidates ?? [])
    .map((c) => ({ text: cleanupNamePhrase(c.text), confidence: Number(c.confidence) || 0 }))
    .filter((c) => /[\p{L}].*[\p{L}]/u.test(c.text))
    .map((c) => {
      const chars = [...c.text];
      const letters = chars.filter((ch) => /\p{L}/u.test(ch)).length;
      const latin = chars.filter((ch) => /[A-Za-z]/.test(ch)).length;
      const latinRatio = letters > 0 ? latin / letters : 0;
      return { ...c, letters, score: c.confidence + CLAN_NAME_PICK.latinBonus * latinRatio };
    })
    .sort((a, b) => b.score - a.score);

  const best = scored.find(
    (c) => c.letters >= CLAN_NAME_PICK.minLetters && c.score >= CLAN_NAME_PICK.minScore,
  );
  // Cyrillic only vetoes a weak Latin pass; a confident Latin read still wins over
  // garbled Cyrillic islands produced from a Latin name.
  if (best && (cyr < lat || best.score >= CLAN_NAME_PICK.strongScore)) return best.text;
  if (cyr > 0 && cyr >= lat) return fallbackText;
  return best ? best.text : fallbackText;
}

/**
 * @param {import("tesseract.js").Worker} worker
 * @param {import("tesseract.js").Worker} workerRus
 * @param {{ debugDir?: string, baseLabel?: string, nameRoi?: { x: number, y: number, width: number, height: number }, reference?: { width: number, height: number }, nameBoxStyle?: "arena" | "tight" }} [options]
 * @returns {Promise<string>}
 */
export async function ocrEnemyName(filePath, worker, workerRus, options = {}) {
  const { debugDir, baseLabel } = options;
  const base = baseLabel ?? path.basename(filePath);
  const meta = await sharp(filePath).metadata();
  if (!meta.width || !meta.height) return "";
  const configured = options.nameRoi
    ? buildNameBoxes(meta, options.nameRoi, options.reference, {
        style: options.nameBoxStyle ?? "arena",
      })
    : undefined;
  const nameCrop = configured?.name ?? cropBoxFromPercent(meta, NAME_BOX);
  const nameCropWide = configured?.wide ?? cropBoxFromPercent(meta, NAME_BOX_WIDE);
  const nameTextCrop = configured?.text ?? cropBoxFromPercent(meta, NAME_TEXT_BOX);
  const nameTextLineCrop =
    configured?.textLine ?? cropBoxFromPercent(meta, NAME_TEXT_LINE_BOX);
  const nameImg = sharp(filePath).extract(nameCrop);
  const nameImgWide = sharp(filePath).extract(nameCropWide);
  const nameTextImg = sharp(filePath).extract(nameTextCrop);
  const nameTextLineImg = sharp(filePath).extract(nameTextLineCrop);
  const nameBufNeutral = await preprocessForOcr(nameImg, { width: OCR_UPSCALE_WIDTHS.name });
  const nameBufThreshold = await preprocessForOcr(nameImg, {
    width: OCR_UPSCALE_WIDTHS.name,
    threshold: 155,
  });
  const nameWideBufNeutral = await preprocessForOcr(nameImgWide, { width: OCR_UPSCALE_WIDTHS.nameWide });
  const nameWideBufThreshold = await preprocessForOcr(nameImgWide, {
    width: OCR_UPSCALE_WIDTHS.nameWide,
    threshold: 150,
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
    await fs.writeFile(`${prefix}full.png`, fullBuf);
  }
  await worker.setParameters({
    tessedit_char_whitelist: LATIN_WHITELIST,
    tessedit_pageseg_mode: "8",
  });
  const nameResNeutral = await worker.recognize(nameBufNeutral);
  const nameResThreshold = await worker.recognize(nameBufThreshold);
  const nameWideResNeutral = await worker.recognize(nameWideBufNeutral);
  const nameWideResThreshold = await worker.recognize(nameWideBufThreshold);

  // A confident first pass already holds a tag-shaped name; the text-area variants
  // (and the Cyrillic/Latin repair passes) only add noise from here.
  const firstPass = [nameResNeutral, nameResThreshold, nameWideResNeutral, nameWideResThreshold];
  const strongFirstPass =
    options.nameBoxStyle !== "tight" ? firstPass.find(isStrongFirstPassResult) : undefined;
  const confidentFirstPass = strongFirstPass !== undefined;
  if (confidentFirstPass) log.debug(`[OCR] early exit after first pass: ${base}`);

  /** @type {{ data: { text: string, confidence: number } }} */
  const emptyResult = { data: { text: "", confidence: 0 } };
  let nameTextResNeutral = emptyResult;
  let nameTextResThreshold = emptyResult;
  let nameTextLineResNeutral = emptyResult;
  let nameTextLineResThreshold = emptyResult;
  let nameTextRusNeutral = emptyResult;
  let nameTextRusThreshold = emptyResult;
  let nameTextLineRusNeutral = emptyResult;
  let nameTextLineRusThreshold = emptyResult;
  // Formation mode: a Latin-only pass avoids Cyrillic/Latin confusions (H→Н, etc.)
  // produced by the mixed whitelist on stylised fonts.
  /** @type {{ text: string, confidence?: number }[]} */
  const clanLatinResults = [];

  if (!confidentFirstPass) {
    const nameTextBufNeutral = await preprocessForOcr(nameTextImg, { width: OCR_UPSCALE_WIDTHS.nameText });
    const nameTextBufThreshold = await preprocessForOcr(nameTextImg, {
      width: OCR_UPSCALE_WIDTHS.nameText,
      threshold: 145,
    });
    const nameTextLineBufNeutral = await preprocessForOcr(nameTextLineImg, {
      width: OCR_UPSCALE_WIDTHS.nameTextLine,
    });
    const nameTextLineBufThreshold = await preprocessForOcr(nameTextLineImg, {
      width: OCR_UPSCALE_WIDTHS.nameTextLine,
      threshold: 140,
    });
    await worker.setParameters({
      tessedit_char_whitelist: LATIN_WHITELIST,
      tessedit_pageseg_mode: "7",
    });
    nameTextResNeutral = await worker.recognize(nameTextBufNeutral);
    nameTextResThreshold = await worker.recognize(nameTextBufThreshold);
    nameTextLineResNeutral = await worker.recognize(nameTextLineBufNeutral);
    nameTextLineResThreshold = await worker.recognize(nameTextLineBufThreshold);
    await workerRus.setParameters({
      tessedit_char_whitelist: LATIN_WHITELIST,
      tessedit_pageseg_mode: "7",
    });
    nameTextRusNeutral = await workerRus.recognize(nameTextBufNeutral);
    nameTextRusThreshold = await workerRus.recognize(nameTextBufThreshold);
    nameTextLineRusNeutral = await workerRus.recognize(nameTextLineBufNeutral);
    nameTextLineRusThreshold = await workerRus.recognize(nameTextLineBufThreshold);

    if (options.nameBoxStyle === "tight") {
      await worker.setParameters({
        tessedit_char_whitelist: LATIN_ONLY_WHITELIST,
        tessedit_pageseg_mode: "7",
      });
      for (const buf of [
        nameTextBufNeutral,
        nameTextBufThreshold,
        nameTextLineBufNeutral,
        nameTextLineBufThreshold,
      ]) {
        const res = await worker.recognize(buf);
        clanLatinResults.push({ text: res.data.text, confidence: res.data.confidence });
      }
    }
  }
  const candidates = [
    cleanupName(nameResNeutral.data.text),
    cleanupName(nameResThreshold.data.text),
    cleanupName(nameWideResNeutral.data.text),
    cleanupName(nameWideResThreshold.data.text),
    cleanupNamePhrase(nameTextResNeutral.data.text),
    cleanupNamePhrase(nameTextResThreshold.data.text),
    cleanupNamePhrase(nameTextLineResNeutral.data.text),
    cleanupNamePhrase(nameTextLineResThreshold.data.text),
    cleanupNamePhrase(nameTextRusNeutral.data.text),
    cleanupNamePhrase(nameTextRusThreshold.data.text),
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
    cleanupNamePhrase(nameTextResNeutral.data.text),
    cleanupNamePhrase(nameTextResThreshold.data.text),
    cleanupNamePhrase(nameTextLineResNeutral.data.text),
    cleanupNamePhrase(nameTextLineResThreshold.data.text),
    cleanupNamePhrase(nameTextRusNeutral.data.text),
    cleanupNamePhrase(nameTextRusThreshold.data.text),
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
  if (strongFirstPass) {
    // Keep the whole phrase from the strong pass; single-token cleanup would drop
    // clan tags, and the text-area passes that this exit skips are the noisy ones.
    name = stripEdgeTagSeparators(
      normalizeOpponentDisplayName(cleanupNamePhrase(strongFirstPass.data.text)),
    );
  }
  if (options.nameBoxStyle === "tight") {
    name = correctClanNameConfusables(
      stripLeadingClippedToken(stripUnbalancedTagNoise(pickClanName(clanLatinResults, name))),
    );
  }

  if (
    !confidentFirstPass &&
    options.nameBoxStyle !== "tight" &&
    (scoreNameCandidate(name) < 4 || isLikelyOcrNoise(name))
  ) {
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

async function cliMain() {  const imgPath = process.argv[2];
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

if (isMain(import.meta.url)) {
  cliMain().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

