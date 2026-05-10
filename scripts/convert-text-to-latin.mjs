/**
 * Detect script and transliterate opponent display names to Latin (arena pipeline).
 * Filename-safe tokens use `toSafeEnemyFilenameToken` from enemy-filename-tokens.mjs.
 */
import path from "path";
import { fileURLToPath } from "url";
import { toSafeEnemyFilenameToken } from "./enemy-filename-tokens.mjs";

const CYR_TO_LAT = {
  А: "A",
  а: "a",
  Б: "B",
  б: "b",
  В: "V",
  в: "v",
  Г: "G",
  г: "g",
  Д: "D",
  д: "d",
  Е: "E",
  е: "e",
  Ё: "Yo",
  ё: "yo",
  Ж: "Zh",
  ж: "zh",
  З: "Z",
  з: "z",
  И: "I",
  и: "i",
  Й: "Y",
  й: "y",
  К: "K",
  к: "k",
  Л: "L",
  л: "l",
  М: "M",
  м: "m",
  Н: "N",
  н: "n",
  О: "O",
  о: "o",
  П: "P",
  п: "p",
  Р: "R",
  р: "r",
  С: "S",
  с: "s",
  Т: "T",
  т: "t",
  У: "U",
  у: "u",
  Ф: "F",
  ф: "f",
  Х: "Kh",
  х: "kh",
  Ц: "Ts",
  ц: "ts",
  Ч: "Ch",
  ч: "ch",
  Ш: "Sh",
  ш: "sh",
  Щ: "Shch",
  щ: "shch",
  Ъ: "",
  ъ: "",
  Ы: "Y",
  ы: "y",
  Ь: "",
  ь: "",
  Э: "E",
  э: "e",
  Ю: "Yu",
  ю: "yu",
  Я: "Ya",
  я: "ya",
};

export function transliterateToLatin(name) {
  const normalized = name
    .replace(/Дж/g, "Dzh")
    .replace(/дж/g, "dzh")
    .replace(/ДЖ/g, "DZH");
  return [...normalized]
    .map((ch) => CYR_TO_LAT[ch] ?? ch)
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

/** Heuristic: primary alphabet in user-visible opponent name string. */
export function detectAlphabetKind(text) {
  const s = String(text);
  let cyr = 0;
  let lat = 0;
  for (const ch of s) {
    if (/[\p{sc=Cyrillic}]/u.test(ch)) cyr++;
    else if (/[A-Za-z]/.test(ch)) lat++;
  }
  if (cyr > 0 && lat > 0) return "mixed";
  if (cyr > 0) return "cyrillic";
  if (lat > 0) return "latin";
  return "unknown";
}

/** Latin tag for filenames: QAZAQ CN fixups and similar. */
export function latinTagForArenaOpponentName(name) {
  const n = String(name).replace(/\s+/g, " ").trim();
  let lat = transliterateToLatin(n).replace(/\s+/g, " ").trim();
  if (/^QAZAQ\s+C\s*П$/u.test(n)) return "QAZAQ CN";
  if (/^QAZAQ\s+(СП|CП)$/iu.test(n)) return "QAZAQ CN";
  if (/^QAZAQ\s+(SP|CP)$/i.test(lat)) return "QAZAQ CN";
  return lat;
}

export function translateLatinNameIfPossible(nameLatin) {
  const rawMap = process.env.OCR_TRANSLATION_MAP;
  if (!rawMap) return "";

  let map;
  try {
    map = JSON.parse(rawMap);
  } catch {
    return "";
  }
  if (!map || typeof map !== "object" || Array.isArray(map)) return "";

  const parts = nameLatin.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  const translated = parts.map((p) => {
    const key = p.toLowerCase();
    const value = map[key];
    return typeof value === "string" && value.trim() ? value.trim() : p;
  });
  const changed = translated.some((v, i) => v !== parts[i]);
  return changed ? translated.join(" ") : "";
}

/**
 * Full conversion for OCR pipeline: raw Latin reading, escaped filename tokens, optional English gloss.
 */
export function convertTextToLatinArtifacts(displayName) {
  const latinRaw = latinTagForArenaOpponentName(displayName);
  const nameEnglish = translateLatinNameIfPossible(latinRaw);
  return {
    alphabet: detectAlphabetKind(displayName),
    latinRaw,
    nameLatinToken: toSafeEnemyFilenameToken(latinRaw),
    nameEnglish,
    nameEnglishToken: nameEnglish ? toSafeEnemyFilenameToken(nameEnglish) : "",
  };
}

const __filename = fileURLToPath(import.meta.url);

async function cliMain() {
  const argv = process.argv.slice(2).filter((a) => a !== "--");
  const text = argv.join(" ").trim();
  if (!text) {
    console.error('Usage: node scripts/convert-text-to-latin.mjs "Some Name"');
    process.exit(1);
  }
  console.log(JSON.stringify(convertTextToLatinArtifacts(text), null, 2));
}

const invokedDirectly =
  path.resolve(process.argv[1] ?? "") === path.resolve(__filename);
if (invokedDirectly) {
  cliMain().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
