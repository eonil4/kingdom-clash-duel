/**
 * Shared Sharp settings for enemy screenshot → canonical `.webp` outputs.
 */
import sharp from "sharp";

const WEBP_QUALITY = 82;
const WRITE_ATTEMPTS = 10;
const WRITE_RETRY_BASE_MS = 40;

/**
 * Windows can hold a handle on the target briefly after another process reads it.
 * @param {unknown} err
 */
function isRetryableFsError(err) {
  if (!err || typeof err !== "object" || !("code" in err)) return false;
  return err.code === "EBUSY" || err.code === "EPERM";
}

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

  const buildConverter = () => {
    const converter = sharp(fromPath).webp({ quality: WEBP_QUALITY });
    return sourceDensity ? converter.withMetadata({ density: sourceDensity }) : converter.withMetadata();
  };

  let lastErr;
  for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt++) {
    try {
      await buildConverter().toFile(toPath);
      return;
    } catch (err) {
      lastErr = err;
      if (!isRetryableFsError(err) || attempt === WRITE_ATTEMPTS - 1) throw err;
      await new Promise((resolve) => setTimeout(resolve, WRITE_RETRY_BASE_MS * (attempt + 1)));
    }
  }
  throw lastErr;
}
