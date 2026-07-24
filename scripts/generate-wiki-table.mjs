import fs from 'fs';
import path from 'path';

// 1. Get the target folder path from command line arguments
const targetFolder = process.argv[2];
const extension = process.argv[3] || '.webp';

if (!targetFolder) {
  console.error("Error: Please provide the folder path!");
  console.log("Usage: node generate-wiki-table.mjs <folder_path>");
  process.exit(1);
}

// Configuration updated to match the exact working GitHub structure
const GITHUB_BASE_URL = 'https://raw.githubusercontent.com';
const GITHUB_USER = 'eonil4';
const GITHUB_REPO = 'kingdom-clash-duel';
const GITHUB_BRANCH = 'main';

// Ensure correct slashes for URL path construction (cross-platform compatibility)
const normalizedPath = targetFolder.replace(/\\/g, '/');

// Generate the base GitHub RAW URL with standard /refs/heads/ path
const baseUrl = `${GITHUB_BASE_URL}/${GITHUB_USER}/${GITHUB_REPO}/refs/heads/${GITHUB_BRANCH}/${normalizedPath}`;

try {
  // Read all files from the target directory
  const files = fs.readdirSync(targetFolder);
  
  // Filter exclusively for .webp images
  const images = files.filter(file => 
    path.extname(file).toLowerCase() === extension
  );

  if (images.length === 0) {
    console.log(`No .webp images found in the specified folder: ${targetFolder}`);
    process.exit(0);
  }

  // 2. Build the HTML table block (Single column layout)
  let html = '<table>\n';

  for (let i = 0; i < images.length; i++) {
    const imageName = images[i];
    
    // Crucial fix: Encode the filename to correctly escape % and special characters
    const encodedImageName = encodeURIComponent(imageName);
    const imageUrl = `${baseUrl}/${encodedImageName}`;
    
    const displayName = path.basename(imageName, path.extname(imageName));

    html += '  <tr>\n';
    html += '    <td align="center" valign="middle">\n';
    html += `      <img src="${imageUrl}" height="800" alt="${displayName}" /><br />\n`;
    html += `      <sub><b>${displayName}</b></sub>\n`;
    html += '    </td>\n';
    html += '  </tr>\n';
  }
  html += '</table>\n';

  // 3. Save the output as index.html in the target folder
  const outputPath = path.join(targetFolder, 'index.html');
  fs.writeFileSync(outputPath, html, 'utf8');

  console.log(`Successfully generated: ${outputPath}`);
  console.log(`Total .webp images in the table: ${images.length}`);

} catch (error) {
  console.error(`An error occurred while processing the folder: ${error.message}`);
}
