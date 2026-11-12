import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WORKSPACE_ROOT } from './enemy-records.mjs';

// Configuration updated to match the exact working GitHub structure
const GITHUB_BASE_URL = 'https://raw.githubusercontent.com';
const GITHUB_USER = 'eonil4';
const GITHUB_REPO = 'kingdom-clash-duel';
const GITHUB_BRANCH = 'main';

function usage() {
  console.error("Error: Please provide the folder path!");
  console.log(
    "Usage: node generate-wiki-table.mjs <folder_path> [ext|ext1 ext2|ext1,ext2|\"ext1|ext2\"]",
  );
  console.log(
    "Examples: .webp | jpg png | jpg,png | \".jpg|.png\" (quote pipe on Windows/cmd)",
  );
}

/**
 * Parse extension filter: `.webp`, `.jpg`, `.png`, `.jpg|.png`, `.(jpg|png)`, `jpg,png`
 * @param {string} raw
 * @returns {string[]}
 */
export function parseExtensions(raw) {
  let value = String(raw).trim();
  if (!value) return ['.webp'];

  if (value.startsWith('.(') && value.endsWith(')')) {
    value = value.slice(2, -1);
  } else if (value.startsWith('(') && value.endsWith(')')) {
    value = value.slice(1, -1);
  } else if (!value.includes('|') && !value.includes(',')) {
    const single = value.startsWith('.') ? value : `.${value}`;
    return [single.toLowerCase()];
  }

  return value
    .split(/[|,]/)
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
    .map((part) => (part.startsWith('.') ? part : `.${part}`));
}

/**
 * Resolve folder for filesystem access, and a repo-relative POSIX path for GitHub URLs.
 * Absolute paths under the workspace are converted so URLs never include drive letters.
 * @param {string} folderArg
 */
export function resolveFolderPaths(folderArg) {
  const abs = path.isAbsolute(folderArg)
    ? path.resolve(folderArg)
    : path.resolve(WORKSPACE_ROOT, folderArg);
  const rel = path.relative(WORKSPACE_ROOT, abs).replace(/\\/g, '/');
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(
      `Folder must be inside the workspace root (${WORKSPACE_ROOT}): ${folderArg}`,
    );
  }
  return { abs, rel };
}

/**
 * @param {string} text
 */
export function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * @param {string[]} argv
 */
function main(argv) {
  const targetFolderArg = argv[0];
  const extensionParts = argv.slice(1);
  const extensionArg =
    extensionParts.length === 0
      ? '.webp'
      : extensionParts.length === 1
        ? extensionParts[0]
        : extensionParts.join(',');

  if (!targetFolderArg) {
    usage();
    process.exit(1);
  }

  const extensions = parseExtensions(extensionArg);
  const extensionSet = new Set(extensions);
  const { abs: targetFolder, rel: repoRelativePath } = resolveFolderPaths(targetFolderArg);
  const baseUrl = `${GITHUB_BASE_URL}/${GITHUB_USER}/${GITHUB_REPO}/refs/heads/${GITHUB_BRANCH}/${repoRelativePath}`;

  try {
    const files = fs.readdirSync(targetFolder);

    const images = files
      .filter((file) => extensionSet.has(path.extname(file).toLowerCase()))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    if (images.length === 0) {
      console.log(
        `No images with extension(s) ${extensions.join(', ')} found in: ${targetFolder}`,
      );
      process.exit(0);
    }

    // 2. Build the HTML table block (Single column layout)
    let html = '<table>\n';

    for (let i = 0; i < images.length; i++) {
      const imageName = images[i];

      // Encode the filename to correctly escape % and special characters
      const encodedImageName = encodeURIComponent(imageName);
      const imageUrl = `${baseUrl}/${encodedImageName}`;

      const displayName = path.basename(imageName, path.extname(imageName));
      const safeName = escapeHtml(displayName);

      const id = displayName.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
      // Add H3 anchor similar to duels for quick navigation
      html += `  <tr>\n`;
      html += `    <td align="center" valign="middle">\n`;
      html += `      <h3 id="img-${id}"><a href="#img-${id}">${safeName}</a></h3>\n`;
      html += `      <img src="${imageUrl}" height="800" alt="${safeName}" /><br />\n`;
      html += `      <sub><b>${safeName}</b></sub>\n`;
      html += `    </td>\n`;
      html += `  </tr>\n`;
    }
    html += '</table>\n';

    // 3. Save the output as index.html in the target folder
    const outputPath = path.join(targetFolder, 'index.html');
    fs.writeFileSync(outputPath, html, 'utf8');

    console.log(`Successfully generated: ${outputPath}`);
    console.log(`Repo path: ${repoRelativePath}`);
    console.log(`Extensions: ${extensions.join(', ')}`);
    console.log(`Total images in the table: ${images.length}`);
  } catch (error) {
    console.error(`An error occurred while processing the folder: ${error.message}`);
    process.exit(1);
  }
}

const invokedDirectly =
  path.resolve(process.argv[1] ?? '') === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  main(process.argv.slice(2));
}
