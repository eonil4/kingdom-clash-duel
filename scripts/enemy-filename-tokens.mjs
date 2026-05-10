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
