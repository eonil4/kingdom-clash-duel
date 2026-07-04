/**
 * Shared Sharp settings for enemy screenshot → canonical `.webp` outputs.
 */
import sharp from "sharp";

const WEBP_QUALITY = 82;

/**
 * @param {string} fromPath
 * @param {string} toPath
 */
export async function writeWebpFromRasterFile(fromPath, toPath) {
  const sourceMeta = await sharp(fromPath).metadata();
  const sourceDensity =
    Number.isFinite(sourceMeta.density) && sourceMeta.density > 0
      ? sourceMeta.density
      : undefined;
  let converter = sharp(fromPath).webp({ quality: WEBP_QUALITY });
  if (sourceDensity) {
    converter = converter.withMetadata({ density: sourceDensity });
  } else {
    converter = converter.withMetadata();
  }
  await converter.toFile(toPath);
}

