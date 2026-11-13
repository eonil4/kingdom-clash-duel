/**
 * Minimal HTML document wrapper for the generated wiki galleries.
 * GitHub renders the inner tables either way, but the files stay self-describing.
 */

/**
 * @param {unknown} text
 */
export function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * @param {{ title: string, body: string, lang?: string }} options
 */
export function wrapHtmlDocument({ title, body, lang = "en" }) {
  return [
    "<!DOCTYPE html>",
    `<html lang="${escapeHtml(lang)}">`,
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
    "</head>",
    "<body>",
    body.replace(/\n$/, ""),
    "</body>",
    "</html>",
    "",
  ].join("\n");
}
