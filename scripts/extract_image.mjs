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
import { UsageError, isMain } from "./cli.mjs";

function usage() {
  console.error(
    "Usage: node scripts/extract_image.mjs <input> <output> <position_x> <position_y> <width> <height>",
  );
}

/**
 * @param {string} name
 * @param {string} raw
 */
export function parseNonNegInt(name, raw) {
  const value = Number(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    throw new UsageError(
      `Invalid ${name}: expected non-negative integer, got ${JSON.stringify(raw)}`,
    );
  }
  return value;
}

/**
 * @param {string[]} argv
 */
export function parseArgs(argv) {
  if (argv.length < 6) {
    throw new UsageError("Missing arguments: <input> <output> <x> <y> <width> <height>");
  }

  const [input, output, xRaw, yRaw, wRaw, hRaw] = argv;
  const left = parseNonNegInt("position_x", xRaw);
  const top = parseNonNegInt("position_y", yRaw);
  const width = parseNonNegInt("width", wRaw);
  const height = parseNonNegInt("height", hRaw);

  if (width === 0 || height === 0) {
    throw new UsageError("width and height must be greater than 0");
  }

  return { input, output, left, top, width, height };
}

/**
 * Crop one region and write it; throws on missing input or out-of-bounds crops.
 * @param {string[]} argv
 * @param {{ log?: (...args: any[]) => void }} [deps]
 */
export async function runExtractImage(argv, { log = (...args) => console.log(...args) } = {}) {
  const { input, output, left, top, width, height } = parseArgs(argv);

  const inputAbs = path.resolve(input);
  const outputAbs = path.resolve(output);

  try {
    await fs.access(inputAbs);
  } catch {
    throw new Error(`Input image not found: ${inputAbs}`);
  }

  const meta = await sharp(inputAbs).metadata();
  if (!meta.width || !meta.height) {
    throw new Error(`Could not read image dimensions: ${inputAbs}`);
  }

  if (left + width > meta.width || top + height > meta.height) {
    throw new Error(
      `Crop out of bounds: requested (${left},${top}) ${width}x${height} ` +
        `but image is ${meta.width}x${meta.height}`,
    );
  }

  await fs.mkdir(path.dirname(outputAbs), { recursive: true });

  await sharp(inputAbs)
    .extract({ left, top, width, height })
    .toFile(outputAbs);

  log(
    `Extracted ${width}x${height} at (${left},${top}) from ${meta.width}x${meta.height}`,
  );
  log(`  ${inputAbs}`);
  log(`  -> ${outputAbs}`);
  return { inputAbs, outputAbs, meta };
}

async function main() {
  await runExtractImage(process.argv.slice(2));
}

if (isMain(import.meta.url)) {
  main().catch((err) => {
    if (err instanceof UsageError) {
      console.error(err.message);
      usage();
    } else {
      console.error(err instanceof Error ? err.message : err);
    }
    process.exit(1);
  });
}
