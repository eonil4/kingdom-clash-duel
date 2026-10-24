#!/usr/bin/env node
/**
 * Build an HTML duel matrix from filenames split by a separator (default `_vs_`).
 *
 * Example:
 *   006_498_473-Kenny_G_vs_006_285_941.png
 *   → row: 006_498_473-Kenny_G
 *   → col: 006_285_941
 *
 * Usage:
 *   node scripts/generate-wiki-matrix.mjs <folder> [ext...] [--separator _vs_] [--rows desc|asc] [--cols desc|asc] [--scale <percent>] [--row-scroll|--single-table] [--compact]
 *
 * Defaults:
 *   separator: _vs_
 *   rows: desc
 *   cols: desc
 *   scale: full size (100%)
 *   rowScroll: true (each row has its own horizontal scrollbar)
 *   compact: false (all matrix columns present in each row)
 *   extensions: jpg png webp
 *
 * Row-by-row horizontal scrollbar:
 *   --row-scroll (default: true): Each row is rendered as its own scrollable table with
 *     its own horizontal scrollbar right under that row, plus column headers.
 *   --single-table / --no-row-scroll: Renders a single unified matrix table.
 *   --compact: When in row-scroll mode, only show columns that have duels for that attacker,
 *     and omit the first (row-header) column since the attacker is in the <h3> title.
 *
 * Scaling:
 *   --scale 50% | --scale 50 | --percent 50 | -p 50
 *   --width <px|%> | -w <px|%> (e.g. --width 300, --width 300px, --width 50%)
 *   --height <px|%> | -h <px|%> (e.g. --height 600, --height 600px, --height 50%)
 *   If both width and height are specified, images are resized to both.
 *   If only width is specified, height scales proportionally.
 *   If only height is specified, width scales proportionally.
 *   If none are specified, images are displayed in full size (100%).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WORKSPACE_ROOT = path.resolve(__dirname, "..");

const GITHUB_BASE_URL = "https://raw.githubusercontent.com";
const GITHUB_USER = "eonil4";
const GITHUB_REPO = "kingdom-clash-duel";
const GITHUB_BRANCH = "main";
const DEFAULT_SEPARATOR = "_vs_";
const DEFAULT_EXTENSIONS = [".jpg", ".png", ".webp"];

/**
 * @param {string} raw
 * @returns {"asc" | "desc"}
 */
function parseSortDir(raw) {
  const v = String(raw ?? "").trim().toLowerCase();
  if (v === "asc" || v === "ascending") return "asc";
  if (v === "desc" || v === "descending" || v === "") return "desc";
  throw new Error(`Invalid sort direction: ${JSON.stringify(raw)} (use asc|desc)`);
}

/**
 * @param {string | undefined} raw
 * @returns {number | undefined}
 */
function parseScalePercent(raw) {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const str = String(raw).trim().replace(/%$/, "");
  const num = Number(str);
  if (!Number.isFinite(num) || num <= 0) {
    throw new Error(
      `Invalid scale/percent value: ${JSON.stringify(raw)} (expected positive number, e.g. 50 or 50%)`,
    );
  }
  return num <= 1 && !String(raw).includes("%") ? num * 100 : num;
}

/**
 * @param {string | undefined} raw
 * @param {string} name
 * @returns {{ value: number, isPercent: boolean } | undefined}
 */
function parseDimension(raw, name) {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const str = String(raw).trim();
  const isPercent = str.endsWith("%");
  const cleaned = isPercent ? str.slice(0, -1).trim() : str.replace(/px$/i, "").trim();
  const num = Number(cleaned);
  if (!Number.isFinite(num) || num <= 0) {
    throw new Error(
      `Invalid ${name} value: ${JSON.stringify(raw)} (expected positive number, e.g. 300, 300px or 50%)`,
    );
  }
  return { value: isPercent ? num : Math.round(num), isPercent };
}

/**
 * @param {{ value: number, isPercent: boolean } | undefined} d
 */
function formatDim(d) {
  if (!d) return "";
  return d.isPercent ? `${d.value}%` : `${d.value}px`;
}

/**
 * @param {string} raw
 * @returns {string[]}
 */
function parseExtensions(raw) {
  let value = String(raw).trim();
  if (!value) return [...DEFAULT_EXTENSIONS];

  if (value.startsWith(".(") && value.endsWith(")")) {
    value = value.slice(2, -1);
  } else if (value.startsWith("(") && value.endsWith(")")) {
    value = value.slice(1, -1);
  } else if (!value.includes("|") && !value.includes(",")) {
    const single = value.startsWith(".") ? value : `.${value}`;
    return [single.toLowerCase()];
  }

  return value
    .split(/[|,]/)
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
    .map((part) => (part.startsWith(".") ? part : `.${part}`));
}

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  const args = {
    folder: undefined,
    separator: DEFAULT_SEPARATOR,
    rows: /** @type {"asc" | "desc"} */ ("desc"),
    cols: /** @type {"asc" | "desc"} */ ("desc"),
    /** @type {number | undefined} */
    scale: undefined,
    /** @type {{ value: number, isPercent: boolean } | undefined} */
    width: undefined,
    /** @type {{ value: number, isPercent: boolean } | undefined} */
    height: undefined,
    frame: true,
    maxHeight: "90vh",
    /** Each row has its own scrollable table with horizontal scrollbar */
    rowScroll: true,
    /** In row-scroll mode, only show columns that have duels for that attacker */
    compact: false,
    extensions: /** @type {string[]} */ ([]),
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--" || a === undefined) continue;
    if (a === "--help") {
      usage();
      process.exit(0);
    }
    if (a === "--separator" || a === "-s") {
      args.separator = String(argv[++i] ?? DEFAULT_SEPARATOR);
      continue;
    }
    if (a.startsWith("--separator=")) {
      args.separator = a.slice("--separator=".length) || DEFAULT_SEPARATOR;
      continue;
    }
    if (a === "--rows") {
      args.rows = parseSortDir(argv[++i]);
      continue;
    }
    if (a.startsWith("--rows=")) {
      args.rows = parseSortDir(a.slice("--rows=".length));
      continue;
    }
    if (a === "--cols" || a === "--columns") {
      args.cols = parseSortDir(argv[++i]);
      continue;
    }
    if (a.startsWith("--cols=") || a.startsWith("--columns=")) {
      const raw = a.includes("--columns=")
        ? a.slice("--columns=".length)
        : a.slice("--cols=".length);
      args.cols = parseSortDir(raw);
      continue;
    }
    if (
      a === "--scale" ||
      a === "--percent" ||
      a === "--percentage" ||
      a === "-p"
    ) {
      args.scale = parseScalePercent(argv[++i]);
      continue;
    }
    if (
      a.startsWith("--scale=") ||
      a.startsWith("--percent=") ||
      a.startsWith("--percentage=") ||
      a.startsWith("-p=")
    ) {
      const rawVal = a.slice(a.indexOf("=") + 1);
      args.scale = parseScalePercent(rawVal);
      continue;
    }
    if (a === "--width" || a === "-w") {
      args.width = parseDimension(argv[++i], "width");
      continue;
    }
    if (a.startsWith("--width=") || a.startsWith("-w=")) {
      const rawVal = a.slice(a.indexOf("=") + 1);
      args.width = parseDimension(rawVal, "width");
      continue;
    }
    if (a === "--height" || a === "-h") {
      args.height = parseDimension(argv[++i], "height");
      continue;
    }
    if (a.startsWith("--height=") || a.startsWith("-h=")) {
      const rawVal = a.slice(a.indexOf("=") + 1);
      args.height = parseDimension(rawVal, "height");
      continue;
    }
    if (a === "--row-scroll" || a === "--rowScroll") {
      args.rowScroll = true;
      continue;
    }
    if (
      a === "--no-row-scroll" ||
      a === "--no-rowScroll" ||
      a === "--single-table" ||
      a === "--singleTable"
    ) {
      args.rowScroll = false;
      continue;
    }
    if (a === "--compact") {
      args.compact = true;
      continue;
    }
    if (a === "--no-compact" || a === "--all-cols") {
      args.compact = false;
      continue;
    }
    if (a === "--no-frame" || a === "--frame=false") {
      args.frame = false;
      continue;
    }
    if (a === "--frame" || a === "--frame=true") {
      args.frame = true;
      continue;
    }
    if (a === "--max-height" || a === "--maxHeight") {
      args.maxHeight = String(argv[++i] ?? "90vh");
      continue;
    }
    if (a.startsWith("--max-height=") || a.startsWith("--maxHeight=")) {
      args.maxHeight = a.slice(a.indexOf("=") + 1) || "90vh";
      continue;
    }
    if (!a.startsWith("-") && !args.folder) {
      args.folder = a;
      continue;
    }
    if (!a.startsWith("-")) {
      args.extensions.push(...parseExtensions(a));
    }
  }

  if (args.extensions.length === 0) {
    args.extensions = [...DEFAULT_EXTENSIONS];
  }

  return args;
}

/**
 * @param {string} folderArg
 */
function resolveFolderPaths(folderArg) {
  const abs = path.isAbsolute(folderArg)
    ? path.resolve(folderArg)
    : path.resolve(WORKSPACE_ROOT, folderArg);
  const rel = path.relative(WORKSPACE_ROOT, abs).replace(/\\/g, "/");
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(
      `Folder must be inside the workspace root (${WORKSPACE_ROOT}): ${folderArg}`,
    );
  }
  return { abs, rel };
}

/**
 * @param {string} a
 * @param {string} b
 * @param {"asc" | "desc"} dir
 */
function compareLabels(a, b, dir) {
  const cmp = a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
  return dir === "asc" ? cmp : -cmp;
}

/**
 * Split stem by first occurrence of separator → [row, col].
 * @param {string} stem
 * @param {string} separator
 * @returns {{ row: string, col: string } | undefined}
 */
function splitVsParts(stem, separator) {
  const idx = stem.indexOf(separator);
  if (idx <= 0) return undefined;
  const row = stem.slice(0, idx);
  const col = stem.slice(idx + separator.length);
  // Exactly two sides: skip names with extra separator occurrences in either part.
  if (!row || !col || row.includes(separator) || col.includes(separator)) {
    return undefined;
  }
  return { row, col };
}

/**
 * Prefer webp over png over jpg when the same duel exists in multiple formats.
 * @param {string} ext
 */
function extensionPriority(ext) {
  const e = ext.toLowerCase();
  if (e === ".webp") return 3;
  if (e === ".png") return 2;
  if (e === ".jpg" || e === ".jpeg") return 1;
  return 0;
}

function usage() {
  console.error(
    "Usage: node scripts/generate-wiki-matrix.mjs <folder> [ext...] [--separator _vs_] [--rows desc|asc] [--cols desc|asc] [--scale <percent>] [--width <px|%>] [--height <px|%>] [--row-scroll|--single-table] [--compact]",
  );
}

/**
 * Resolve target width and height for an image based on --width, --height, or --scale.
 * @param {{ width: number, height: number } | undefined} meta
 * @param {object} args
 * @returns {{ w: number | undefined, h: number | undefined, hasExplicitHeight: boolean }}
 */
function resolveImageDims(meta, args) {
  if (!meta || !meta.width || !meta.height) {
    const w = args.width ? (args.width.isPercent ? undefined : args.width.value) : undefined;
    const h = args.height ? (args.height.isPercent ? undefined : args.height.value) : undefined;
    return { w, h, hasExplicitHeight: args.height !== undefined };
  }

  let w;
  let h;
  let hasExplicitHeight = false;

  if (args.width !== undefined && args.height !== undefined) {
    w = args.width.isPercent
      ? Math.round(meta.width * (args.width.value / 100))
      : args.width.value;
    h = args.height.isPercent
      ? Math.round(meta.height * (args.height.value / 100))
      : args.height.value;
    hasExplicitHeight = true;
  } else if (args.width !== undefined) {
    w = args.width.isPercent
      ? Math.round(meta.width * (args.width.value / 100))
      : args.width.value;
    h = Math.round(meta.height * (w / meta.width));
    hasExplicitHeight = false;
  } else if (args.height !== undefined) {
    h = args.height.isPercent
      ? Math.round(meta.height * (args.height.value / 100))
      : args.height.value;
    w = Math.round(meta.width * (h / meta.height));
    hasExplicitHeight = true;
  } else {
    const scale = args.scale ?? 100;
    w = Math.round(meta.width * (scale / 100));
    h = Math.round(meta.height * (scale / 100));
    hasExplicitHeight = false;
  }

  return { w, h, hasExplicitHeight };
}

/**
 * @param {{ width: number, height: number } | undefined} meta
 * @param {object} args
 * @returns {string}
 */
function buildImgAttrs(meta, args) {
  const dims = resolveImageDims(meta, args);
  if (dims.w !== undefined) {
    const heightAttr = dims.hasExplicitHeight && dims.h !== undefined ? ` height="${dims.h}"` : "";
    return ` width="${dims.w}"${heightAttr} style="min-width: ${dims.w}px; max-width: none;"`;
  }
  if (args.scale && args.scale !== 100) {
    return ` width="${Math.round(args.scale)}%"`;
  }
  return "";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.folder) {
    usage();
    process.exit(1);
  }

  const { abs: targetFolder, rel: repoRelativePath } = resolveFolderPaths(args.folder);
  const extensionSet = new Set(args.extensions.map((e) => e.toLowerCase()));
  const baseUrl = `${GITHUB_BASE_URL}/${GITHUB_USER}/${GITHUB_REPO}/refs/heads/${GITHUB_BRANCH}/${repoRelativePath}`;

  const files = fs.readdirSync(targetFolder);
  /** @type {Map<string, Map<string, string>>} row -> col -> filename */
  const matrix = new Map();
  /** @type {Set<string>} */
  const rowSet = new Set();
  /** @type {Set<string>} */
  const colSet = new Set();
  let skipped = 0;

  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    if (!extensionSet.has(ext)) continue;
    const stem = path.basename(file, ext);
    const parts = splitVsParts(stem, args.separator);
    if (!parts) {
      skipped++;
      continue;
    }

    rowSet.add(parts.row);
    colSet.add(parts.col);

    if (!matrix.has(parts.row)) matrix.set(parts.row, new Map());
    const rowMap = matrix.get(parts.row);
    const prev = rowMap.get(parts.col);
    if (!prev || extensionPriority(ext) > extensionPriority(path.extname(prev))) {
      rowMap.set(parts.col, file);
    }
  }

  const rows = [...rowSet].sort((a, b) => compareLabels(a, b, args.rows));
  const cols = [...colSet].sort((a, b) => compareLabels(a, b, args.cols));

  if (rows.length === 0 || cols.length === 0) {
    console.log(`No duel images matching separator ${JSON.stringify(args.separator)} in: ${targetFolder}`);
    process.exit(0);
  }

  /** @type {Map<string, { width: number, height: number }>} */
  const metaMap = new Map();
  await Promise.all(
    files.map(async (file) => {
      try {
        const meta = await sharp(path.join(targetFolder, file)).metadata();
        if (meta.width && meta.height) {
          metaMap.set(file, { width: meta.width, height: meta.height });
        }
      } catch {
        // ignore
      }
    }),
  );

  const defaultMeta = metaMap.values().next().value;
  const defaultDims = resolveImageDims(defaultMeta, args);
  const fallbackColW = defaultDims.w ?? 473;

  /** @type {Map<string, number>} */
  const colWidthMap = new Map();
  for (const col of cols) {
    let maxW = 0;
    for (const row of rows) {
      const f = matrix.get(row)?.get(col);
      if (f && metaMap.has(f)) {
        const m = metaMap.get(f);
        const dims = resolveImageDims(m, args);
        if (dims.w && dims.w > maxW) maxW = dims.w;
      }
    }
    if (maxW > 0) colWidthMap.set(col, maxW);
  }

  let html = "";

  if (args.rowScroll) {
    for (const row of rows) {
      const rowMap = matrix.get(row) ?? new Map();
      const activeCols = args.compact
        ? cols.filter((col) => rowMap.has(col))
        : cols;

      if (activeCols.length === 0) continue;

      html += `<h3>${escapeHtml(row)}</h3>\n`;
      html += '<table style="border-collapse: collapse; white-space: nowrap;">\n';
      html += "  <tr>\n";
      if (!args.compact) {
        html += `    <th align="center" valign="bottom"><sub><b>${escapeHtml(row)}</b></sub></th>\n`;
      }
      for (const col of activeCols) {
        const colW = colWidthMap.get(col) ?? fallbackColW;
        const thWidth = colW ? ` width="${colW}"` : "";
        const thStyle = colW ? ` style="min-width: ${colW}px;"` : "";
        // In GitHub Markdown, inline style is stripped and `.markdown-body img { max-width: 100% }`
        // squashes columns down to the container width. A sequence of non-breaking spaces
        // establishes an intrinsic min-content width, enabling horizontal table scrolling on GitHub.
        const nbspCount = Math.max(1, Math.round((colW + 20) / 4.1));
        const spacer = `<span>${"&nbsp;".repeat(nbspCount)}</span>`;
        html += `    <th align="center" valign="bottom"${thWidth}${thStyle}><sub><b>${escapeHtml(col)}</b></sub><br />${spacer}</th>\n`;
      }
      html += "  </tr>\n";

      html += "  <tr>\n";
      if (!args.compact) {
        html +=
          `    <th align="center" valign="middle" ` +
          `style="writing-mode: vertical-rl; text-orientation: mixed; white-space: nowrap;">` +
          `<sub><b>${escapeHtml(row)}</b></sub></th>\n`;
      }

      for (const col of activeCols) {
        const file = rowMap.get(col);
        if (!file) {
          const colW = colWidthMap.get(col) ?? fallbackColW;
          const tdWidth = colW ? ` width="${colW}"` : "";
          const tdStyle = colW ? ` style="min-width: ${colW}px;"` : "";
          html += `    <td align="center" valign="middle"${tdWidth}${tdStyle}></td>\n`;
          continue;
        }
        const imageUrl = `${baseUrl}/${encodeURIComponent(file)}`;
        const alt = path.basename(file, path.extname(file));

        const meta = metaMap.get(file);
        const imgAttrs = buildImgAttrs(meta, args);

        html += '    <td align="center" valign="middle">\n';
        html += `      <a href="${imageUrl}" target="_blank" rel="noopener noreferrer"><img src="${imageUrl}"${imgAttrs} alt="${escapeHtml(alt)}" /></a>\n`;
        html += "    </td>\n";
      }
      html += "  </tr>\n";
      html += "</table>\n\n";
    }
  } else {
    // Single unified table mode
    if (args.frame) {
      const maxHeightStyle =
        args.maxHeight &&
        args.maxHeight.toLowerCase() !== "none" &&
        args.maxHeight !== "0"
          ? ` max-height: ${args.maxHeight};`
          : "";
      html += `<div style="overflow: auto; max-width: 100%;${maxHeightStyle} border: 1px solid #d0d7de;">\n`;
    }
    html += '<table style="border-collapse: collapse; white-space: nowrap;">\n';
    html += "  <tr>\n";
    html += '    <th align="center" valign="bottom"></th>\n';
    for (const col of cols) {
      const colW = colWidthMap.get(col) ?? fallbackColW;
      const thWidth = colW ? ` width="${colW}"` : "";
      const thStyle = colW ? ` style="min-width: ${colW}px;"` : "";
      const nbspCount = Math.max(1, Math.round((colW + 20) / 4.1));
      const spacer = `<span>${"&nbsp;".repeat(nbspCount)}</span>`;
      html += `    <th align="center" valign="bottom"${thWidth}${thStyle}><sub><b>${escapeHtml(col)}</b></sub><br />${spacer}</th>\n`;
    }
    html += "  </tr>\n";

    for (const row of rows) {
      html += "  <tr>\n";
      html +=
        `    <th align="center" valign="middle" ` +
        `style="writing-mode: vertical-rl; text-orientation: mixed; white-space: nowrap;">` +
        `<sub><b>${escapeHtml(row)}</b></sub></th>\n`;

      const rowMap = matrix.get(row) ?? new Map();
      for (const col of cols) {
        const file = rowMap.get(col);
        if (!file) {
          const colW = colWidthMap.get(col) ?? fallbackColW;
          const tdWidth = colW ? ` width="${colW}"` : "";
          const tdStyle = colW ? ` style="min-width: ${colW}px;"` : "";
          html += `    <td align="center" valign="middle"${tdWidth}${tdStyle}></td>\n`;
          continue;
        }
        const imageUrl = `${baseUrl}/${encodeURIComponent(file)}`;
        const alt = path.basename(file, path.extname(file));

        const meta = metaMap.get(file);
        const imgAttrs = buildImgAttrs(meta, args);

        html += '    <td align="center" valign="middle">\n';
        html += `      <a href="${imageUrl}" target="_blank" rel="noopener noreferrer"><img src="${imageUrl}"${imgAttrs} alt="${escapeHtml(alt)}" /></a>\n`;
        html += "    </td>\n";
      }
      html += "  </tr>\n";
    }
    html += "</table>\n";
    if (args.frame) {
      html += "</div>\n";
    }
  }

  const outputPath = path.join(targetFolder, "index.html");
  fs.writeFileSync(outputPath, html, "utf8");

  console.log(`Successfully generated: ${outputPath}`);
  console.log(`Repo path: ${repoRelativePath}`);
  console.log(`Separator: ${args.separator}`);
  console.log(`Sort: rows=${args.rows}, cols=${args.cols}`);
  const sizeInfo =
    args.width || args.height
      ? [
          args.width ? `width=${formatDim(args.width)}` : "",
          args.height ? `height=${formatDim(args.height)}` : "",
        ]
          .filter(Boolean)
          .join(", ")
      : args.scale
        ? `${args.scale}%`
        : "full (100%)";
  console.log(`Scale / Size: ${sizeInfo}`);
  console.log(`Mode: ${args.rowScroll ? `row-scroll (table per row, compact=${args.compact})` : "single-table"}`);
  console.log(`Extensions: ${args.extensions.join(", ")}`);
  console.log(`Matrix: ${rows.length} rows × ${cols.length} cols`);
  if (skipped > 0) {
    console.log(`Skipped files (no separator match): ${skipped}`);
  }
}

/**
 * @param {string} text
 */
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

main().catch((error) => {
  console.error(`An error occurred: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
