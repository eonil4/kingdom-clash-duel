/**
 * Escape characters that are invalid or reserved in Windows file names.
 * Reserved set: <>:"'/\\|?* — encoded as percent-hex (literal `%` → `%25`).
 */
const RESERVED_ESCAPES = new Map([
  ["<", "%3C"],
  [">", "%3E"],
  [":", "%3A"],
  ['"', "%22"],
  ["'", "%27"],
  ["/", "%2F"],
  ["\\", "%5C"],
  ["|", "%7C"],
  ["?", "%3F"],
  ["*", "%2A"],
]);

/**
 * Decode `%HH` sequences from slug segments (iterates so `%25` → `%` works).
 */
export function decodeEnemyFilenamePercent(slug) {
  let s = String(slug);
  for (let i = 0; i < 8; i++) {
    const next = s.replace(/%([0-9A-Fa-f]{2})/g, (_, h) =>
      String.fromCharCode(parseInt(h, 16)),
    );
    if (next === s) break;
    s = next;
  }
  return s;
}

/**
 * `XXX_XXX_XXX-<slug>.ext` — when slug contains `%HH` (encoded reserved chars),
 * returns the decoded display/Latin hint; otherwise `undefined` (OCR stays primary).
 */
export function parseLatinNameHintFromEncodedOriginalBasename(fileBasename) {
  const stem = fileBasename.replace(/\.[^/.]+$/, "");
  const m = stem.match(/^\d{3}_\d{3}_\d{3}-(.+)$/);
  if (!m) return undefined;
  const slug = m[1];
  if (!/%[0-9A-Fa-f]{2}/.test(slug)) return undefined;
  return decodeEnemyFilenamePercent(slug);
}

export function toSafeEnemyFilenameToken(input) {
  const normalized = String(input).replace(/\s+/g, "_");
  let out = "";
  for (const ch of normalized) {
    if (ch === "%") {
      out += "%25";
      continue;
    }
    const esc = RESERVED_ESCAPES.get(ch);
    if (esc) {
      out += esc;
      continue;
    }
    if (/[A-Za-z0-9_.-]/.test(ch) || ch === "_") {
      out += ch;
      continue;
    }
    out += "_";
  }
  return out.replace(/_+/g, "_").replace(/^_+|_+$/g, "");
}
