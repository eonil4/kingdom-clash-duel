#!/usr/bin/env node
/**
 * Extract a rectangular region from an image and save it.
 *
 * Usage:
 *   node scripts/extract_image.mjs <input> <output> <position_x> <position_y> <width> <height>
 *
 * Coordinates are pixels from the top-left of the source image.
 * Output format follows the output file extension (png, jpg, webp, …).
 */
import fs from "fs/promises";
import path from "path";
import sharp from "sharp";

function usage() {
  console.error(
    "Usage: node scripts/extract_image.mjs <input> <output> <position_x> <position_y> <width> <height>",
  );
}

/**
 * @param {string} name
 * @param {string} raw
 */
function parseNonNegInt(name, raw) {
  const value = Number(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    console.error(`Invalid ${name}: expected non-negative integer, got ${JSON.stringify(raw)}`);
    process.exit(1);
  }
  return value;
}

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  if (argv.length < 6) {
    usage();
    process.exit(1);
  }

  const [input, output, xRaw, yRaw, wRaw, hRaw] = argv;
  const left = parseNonNegInt("position_x", xRaw);
  const top = parseNonNegInt("position_y", yRaw);
  const width = parseNonNegInt("width", wRaw);
  const height = parseNonNegInt("height", hRaw);

  if (width === 0 || height === 0) {
    console.error("width and height must be greater than 0");
    process.exit(1);
  }

  return { input, output, left, top, width, height };
}

async function main() {
  const { input, output, left, top, width, height } = parseArgs(process.argv.slice(2));

  const inputAbs = path.resolve(input);
  const outputAbs = path.resolve(output);

  try {
    await fs.access(inputAbs);
  } catch {
    console.error(`Input image not found: ${inputAbs}`);
    process.exit(1);
  }

  const meta = await sharp(inputAbs).metadata();
  if (!meta.width || !meta.height) {
    console.error(`Could not read image dimensions: ${inputAbs}`);
    process.exit(1);
  }

  if (left + width > meta.width || top + height > meta.height) {
    console.error(
      `Crop out of bounds: requested (${left},${top}) ${width}x${height} ` +
        `but image is ${meta.width}x${meta.height}`,
    );
    process.exit(1);
  }

  await fs.mkdir(path.dirname(outputAbs), { recursive: true });

  await sharp(inputAbs)
    .extract({ left, top, width, height })
    .toFile(outputAbs);

  console.log(
    `Extracted ${width}x${height} at (${left},${top}) from ${meta.width}x${meta.height}`,
  );
  console.log(`  ${inputAbs}`);
  console.log(`  -> ${outputAbs}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
