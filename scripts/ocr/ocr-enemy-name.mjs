/**
 * OCR the opponent name from a full arena screenshot (top-right region + fallbacks).
 */
import fs from "fs/promises";
import path from "path";
import sharp from "sharp";
import { createWorker } from "tesseract.js";
import {
  CLAN_NAME_PICK,
  DEFAULT_CLAN_NAME_CORRECTIONS,
  OCR_EARLY_EXIT,
  OCR_UPSCALE_WIDTHS,
} from "../constants.mjs";
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

/**
 * Score a whole phrase by its best token (single tokens score as before).
 * `scoreNameCandidate` rejects spaces, which used to push every multi-word pick
 * into the full-image fallback and replace a good name with garbage.
 * @param {string} name
 */
export function scoreNamePhrase(name) {
  const text = String(name ?? "").trim();
  if (!text) return -1;
  const tokens = text.split(/\s+/).filter(Boolean);
  return Math.max(
    scoreNameCandidate(text.replace(/\s+/g, "_")),
    ...tokens.map((token) => scoreNameCandidate(token)),
  );
}

/**
 * Penalise OCR junk shapes in a phrase: 1–2 letter fragments, tokens mixing
 * Cyrillic and Latin inside one word, and a leading letterless icon fragment.
 * @param {string} name
 */
export function arenaCandidatePenalty(name) {
  const tokens = String(name ?? "").split(/\s+/).filter(Boolean);
  let penalty = 0;
  tokens.forEach((token, index) => {
    const letters = (token.match(/\p{L}/gu) ?? []).length;
    // Two-letter all-caps tokens are legit clan tags ("ZR", "SP").
    const shortTag = /^[\p{Lu}]{2}$/u.test(token);
    if (letters > 0 && letters <= 2 && tokens.length > 1 && !shortTag) penalty += 8;
    if (/[\p{sc=Cyrillic}]/u.test(token) && /[A-Za-z]/.test(token)) penalty += 12;
    if (index === 0 && letters === 0 && !token.includes("[")) penalty += 25;
    // A digit-led Cyrillic token (e.g. "5ата\К") is an OCR artefact, not a name.
    if (index === 0 && /^\d/.test(token) && /[\p{sc=Cyrillic}]/u.test(token)) penalty += 40;
  });
  return penalty;
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
 * @typedef {{ key: string, crop: "name" | "wide" | "text" | "textLine", width: number, threshold?: number }} NameVariant
 * @typedef {{ id: string, worker: "eng" | "rus", psm: string, whitelist: string, onlyWhen?: "tight", variants: NameVariant[] }} NameRecognitionGroup
 */

/**
 * Recognition matrix for the name. Each group is one worker parameter set; variants
 * sharing a crop/threshold reuse one preprocessed buffer. Group order is the historical
 * pass order — the early-exit check runs on the first group's results, and the
 * Latin-only repair pass exists only for tight formation boxes.
 * @type {NameRecognitionGroup[]}
 */
export const NAME_RECOGNITION_GROUPS = [
  {
    id: "first",
    worker: "eng",
    psm: "8",
    whitelist: LATIN_WHITELIST,
    variants: [
      { key: "nameNeutral", crop: "name", width: OCR_UPSCALE_WIDTHS.name },
      { key: "nameThreshold", crop: "name", width: OCR_UPSCALE_WIDTHS.name, threshold: 155 },
      { key: "wideNeutral", crop: "wide", width: OCR_UPSCALE_WIDTHS.nameWide },
      { key: "wideThreshold", crop: "wide", width: OCR_UPSCALE_WIDTHS.nameWide, threshold: 150 },
    ],
  },
  {
    id: "text",
    worker: "eng",
    psm: "7",
    whitelist: LATIN_WHITELIST,
    variants: [
      { key: "textNeutral", crop: "text", width: OCR_UPSCALE_WIDTHS.nameText },
      { key: "textThreshold", crop: "text", width: OCR_UPSCALE_WIDTHS.nameText, threshold: 145 },
      { key: "textLineNeutral", crop: "textLine", width: OCR_UPSCALE_WIDTHS.nameTextLine },
      {
        key: "textLineThreshold",
        crop: "textLine",
        width: OCR_UPSCALE_WIDTHS.nameTextLine,
        threshold: 140,
      },
    ],
  },
  {
    id: "textRus",
    worker: "rus",
    psm: "7",
    whitelist: LATIN_WHITELIST,
    variants: [
      { key: "textRusNeutral", crop: "text", width: OCR_UPSCALE_WIDTHS.nameText },
      { key: "textRusThreshold", crop: "text", width: OCR_UPSCALE_WIDTHS.nameText, threshold: 145 },
      { key: "textLineRusNeutral", crop: "textLine", width: OCR_UPSCALE_WIDTHS.nameTextLine },
      {
        key: "textLineRusThreshold",
        crop: "textLine",
        width: OCR_UPSCALE_WIDTHS.nameTextLine,
        threshold: 140,
      },
    ],
  },
  {
    id: "textLatin",
    worker: "eng",
    psm: "7",
    whitelist: LATIN_ONLY_WHITELIST,
    onlyWhen: "tight",
    variants: [
      { key: "latinTextNeutral", crop: "text", width: OCR_UPSCALE_WIDTHS.nameText },
      { key: "latinTextThreshold", crop: "text", width: OCR_UPSCALE_WIDTHS.nameText, threshold: 145 },
      { key: "latinTextLineNeutral", crop: "textLine", width: OCR_UPSCALE_WIDTHS.nameTextLine },
      {
        key: "latinTextLineThreshold",
        crop: "textLine",
        width: OCR_UPSCALE_WIDTHS.nameTextLine,
        threshold: 140,
      },
    ],
  },
];

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
/**
 * Strip repeated single-letter/lowercase fragments in front of the name
 * (e.g. the "У я" of "У я Горький").
 * @param {string} text
 */
export function stripLeadingClippedTokens(text) {
  let current = cleanupNamePhrase(String(text ?? ""));
  for (let i = 0; i < 4; i++) {
    const match = current.match(/^(\S+)\s+(.+)$/u);
    if (!match) break;
    const [, first, rest] = match;
    const single = /^[\p{L}\d]$/u.test(first);
    const lowercase = /^\p{Ll}+$/u.test(first);
    // Repeated fragments are single characters ("У я Горький"). A lowercase word
    // is stripped only before an uppercase name ("hd Myasnik"), not before a
    // lowercase word ("фил army" keeps its prefix).
    if (!single && !(lowercase && /^\p{Lu}/u.test(rest))) break;
    current = rest;
  }
  return current;
}

export function stripEdgeTagSeparators(text) {
  return String(text)
    .replace(/^[\s|\\_-]+/u, "")
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
 * Correct stylised-font confusions in a leading clan tag: the arena/formation font
 * often renders "HuN" as A/S/H + "ulN" when followed by a tag separator. Only the
 * leading token is rewritten, and only when a separator follows it.
 * @param {string} text
 * @param {Record<string, string>} [corrections] wrong leading token -> replacement
 */
export function correctClanNameConfusables(
  text,
  corrections = DEFAULT_CLAN_NAME_CORRECTIONS,
) {
  const s = cleanupNamePhrase(String(text ?? ""));
  for (const [wrong, right] of Object.entries(corrections ?? {})) {
    if (!wrong || typeof right !== "string") continue;
    const replacement = right.trim();
    if (!replacement) continue;
    if (!s.startsWith(wrong)) continue;
    const rest = s.slice(wrong.length);
    if (!/^\s*[|\\]/u.test(rest)) continue;
    return `${replacement}${rest}`;
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
 * @param {{ debugDir?: string, baseLabel?: string, nameRoi?: { x: number, y: number, width: number, height: number }, reference?: { width: number, height: number }, nameBoxStyle?: "arena" | "tight", clanNameCorrections?: Record<string, string> }} [options]
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
  const crops = {
    name: sharp(filePath).extract(nameCrop),
    wide: sharp(filePath).extract(nameCropWide),
    text: sharp(filePath).extract(nameTextCrop),
    textLine: sharp(filePath).extract(nameTextLineCrop),
  };
  /** @type {Map<string, Promise<Buffer>>} */
  const buffers = new Map();
  /**
   * One preprocessed buffer per crop/threshold, shared by every group that uses it.
   * @param {NameVariant} variant
   */
  const bufferFor = (variant) => {
    const key = `${variant.crop}:${variant.width}:${variant.threshold ?? "neutral"}`;
    let buf = buffers.get(key);
    if (!buf) {
      buf = preprocessForOcr(
        crops[variant.crop],
        variant.threshold === undefined
          ? { width: variant.width }
          : { width: variant.width, threshold: variant.threshold },
      );
      buffers.set(key, buf);
    }
    return buf;
  };
  /**
   * Run groups in order; each group applies its own worker parameters.
   * @param {NameRecognitionGroup[]} groups
   */
  const recognizeGroups = async (groups) => {
    /** @type {Record<string, { data: { text: string, confidence: number } }>} */
    const out = {};
    for (const group of groups) {
      const target = group.worker === "rus" ? workerRus : worker;
      await target.setParameters({
        tessedit_char_whitelist: group.whitelist,
        tessedit_pageseg_mode: group.psm,
      });
      for (const variant of group.variants) {
        out[variant.key] = await target.recognize(await bufferFor(variant));
      }
    }
    return out;
  };

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

  /** @type {{ data: { text: string, confidence: number } }} */
  const emptyResult = { data: { text: "", confidence: 0 } };
  /** @type {Record<string, { data: { text: string, confidence: number } }>} */
  const res = {};
  for (const group of NAME_RECOGNITION_GROUPS) {
    for (const variant of group.variants) res[variant.key] = emptyResult;
  }

  const firstGroup = NAME_RECOGNITION_GROUPS[0];
  Object.assign(res, await recognizeGroups([firstGroup]));

  // A confident first pass already holds a tag-shaped name; the text-area variants
  // (and the Cyrillic/Latin repair passes) only add noise from here.
  const firstPass = firstGroup.variants.map((variant) => res[variant.key]);
  const strongFirstPass =
    options.nameBoxStyle !== "tight" ? firstPass.find(isStrongFirstPassResult) : undefined;
  const confidentFirstPass = strongFirstPass !== undefined;
  if (confidentFirstPass) log.debug(`[OCR] early exit after first pass: ${base}`);

  /** @type {{ text: string, confidence?: number }[]} */
  const clanLatinResults = [];
  if (!confidentFirstPass) {
    const remainingGroups = NAME_RECOGNITION_GROUPS.filter(
      (group) =>
        group.id !== firstGroup.id &&
        (group.onlyWhen !== "tight" || options.nameBoxStyle === "tight"),
    );
    Object.assign(res, await recognizeGroups(remainingGroups));
    if (options.nameBoxStyle === "tight") {
      const latinGroup = NAME_RECOGNITION_GROUPS.find((group) => group.id === "textLatin");
      for (const variant of latinGroup?.variants ?? []) {
        const result = res[variant.key];
        clanLatinResults.push({ text: result.data.text, confidence: result.data.confidence });
      }
    }
  }
  // Arena text-area lines often carry an icon/label fragment before the name
  // ("hd Myasnik", "sh - KalugaZR"); tight formation names keep their raw phrase.
  const phraseCleanup =
    options.nameBoxStyle === "tight"
      ? cleanupNamePhrase
      : (text) => stripEdgeTagSeparators(stripLeadingClippedTokens(cleanupNamePhrase(text)));
  const candidates = [
    cleanupName(res.nameNeutral.data.text),
    cleanupName(res.nameThreshold.data.text),
    cleanupName(res.wideNeutral.data.text),
    cleanupName(res.wideThreshold.data.text),
    phraseCleanup(res.textNeutral.data.text),
    phraseCleanup(res.textThreshold.data.text),
    phraseCleanup(res.textLineNeutral.data.text),
    phraseCleanup(res.textLineThreshold.data.text),
    phraseCleanup(res.textRusNeutral.data.text),
    phraseCleanup(res.textRusThreshold.data.text),
    phraseCleanup(res.textLineRusNeutral.data.text),
    phraseCleanup(res.textLineRusThreshold.data.text),
  ];
  candidates.sort((a, b) => {
    const dq = arenaNameLineQuality(b) - arenaNameLineQuality(a);
    if (dq !== 0) return dq;
    return scoreNameCandidate(b) - scoreNameCandidate(a);
  });
  let name = candidates[0] ?? "";
  log.debug(`[OCR] ${base} candidates: ${candidates.map((c) => JSON.stringify(c)).join(" | ")}`);
  const textAreaCandidates = [
    phraseCleanup(res.textNeutral.data.text),
    phraseCleanup(res.textThreshold.data.text),
    phraseCleanup(res.textLineNeutral.data.text),
    phraseCleanup(res.textLineThreshold.data.text),
    phraseCleanup(res.textRusNeutral.data.text),
    phraseCleanup(res.textRusThreshold.data.text),
    phraseCleanup(res.textLineRusNeutral.data.text),
    phraseCleanup(res.textLineRusThreshold.data.text),
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
    // Clean single-token Cyrillic names ("Мясник", "Павел", "ЮРЧИКЗР") compete with
    // mixed-script lines; before this they were excluded by the line-only tiers.
    const cyrTokenCandidates = uniq.filter(
      (c) =>
        /[\p{sc=Cyrillic}]/u.test(c) &&
        c.split(/\s+/).filter(Boolean).length === 1 &&
        (c.match(/\p{L}/gu) ?? []).length >= 3,
    );
    // Lowercase Latin words ("army", "fil") are valid reads and should compete
    // with the Cyrillic tiers instead of being excluded by them.
    const latinLowerCandidates = uniq.filter(
      (c) => /^[a-z][a-z ]*$/u.test(c) && scoreNamePhrase(c) >= 4,
    );
    let pool =
      mixedScriptOrSep.length > 0 ||
      cyrLineCandidates.length > 0 ||
      cyrTokenCandidates.length > 0 ||
      latinLowerCandidates.length > 0
        ? [
            ...new Set([
              ...mixedScriptOrSep,
              ...cyrLineCandidates,
              ...cyrTokenCandidates,
              ...latinLowerCandidates,
            ]),
          ]
        : uniq;
    if (pool.length > 0 && pool.every((c) => arenaCandidatePenalty(c) > 0)) {
      // Every tiered candidate is junk-shaped; fall back to clean Latin reads
      // (e.g. "sigmaZR" competing with "5ата\К").
      const cleanLatin = uniq.filter(
        (c) => /[A-Za-z]/.test(c) && arenaCandidatePenalty(c) === 0 && scoreNamePhrase(c) >= 4,
      );
      if (cleanLatin.length > 0) pool = cleanLatin;
    }
    pool.sort((a, b) => {
      const dq =
        arenaNameLineQuality(b) -
        arenaCandidatePenalty(b) -
        (arenaNameLineQuality(a) - arenaCandidatePenalty(a));
      if (dq !== 0) return dq;
      const ds = scoreNamePhrase(b) - scoreNamePhrase(a);
      if (ds !== 0) return ds;
      // On an exact tie prefer a readable Latin candidate over Cyrillic glyph noise.
      const la = /[A-Za-z]/.test(a) ? 1 : 0;
      const lb = /[A-Za-z]/.test(b) ? 1 : 0;
      if (la !== lb) return lb - la;
      const aw = a.split(/\s+/).filter(Boolean).length;
      const bw = b.split(/\s+/).filter(Boolean).length;
      if (aw !== bw) return bw - aw;
      return b.length - a.length;
    });
    name = pool[0] ?? name;
    log.debug(`[OCR] ${base} pool pick: ${JSON.stringify(name)}`);
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
      options.clanNameCorrections,
    );
  }

  if (
    !confidentFirstPass &&
    options.nameBoxStyle !== "tight" &&
    (scoreNamePhrase(name) < 4 || isLikelyOcrNoise(name))
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

/**
 * CLI body; returns the exit code instead of exiting.
 * @param {string[]} [argv]
 * @param {{
 *   makeWorker?: (langs: string) => Promise<any>,
 *   run?: typeof ocrEnemyName,
 *   log?: (...args: any[]) => void,
 *   error?: (...args: any[]) => void,
 * }} [deps]
 */
export async function runNameCli(
  argv = process.argv.slice(2),
  {
    makeWorker = (langs) => createWorker(langs),
    run = ocrEnemyName,
    log = console.log,
    error = console.error,
  } = {},
) {
  const [imgPath] = argv;
  if (!imgPath) {
    error("Usage: node scripts/ocr-enemy-name.mjs <image.png>");
    return 1;
  }
  const resolved = path.resolve(imgPath);
  try {
    await fs.access(resolved);
  } catch {
    error(`Not found: ${resolved}`);
    return 1;
  }
  const worker = await makeWorker("eng+rus");
  const workerRus = await makeWorker("rus");
  try {
    await worker.setParameters({ preserve_interword_spaces: "1" });
    await workerRus.setParameters({ preserve_interword_spaces: "1" });
    const name = await run(resolved, worker, workerRus);
    log(name);
    return 0;
  } finally {
    await worker.terminate();
    await workerRus.terminate();
  }
}

async function cliMain() {
  const code = await runNameCli();
  if (code !== 0) process.exit(code);
}

if (isMain(import.meta.url)) {
  cliMain().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

