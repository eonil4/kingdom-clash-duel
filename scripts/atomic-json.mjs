/**
 * Atomic JSON persistence: write to a sibling temp file, then rename over the target.
 *
 * Per-folder `data.json` is the only record store, so a partial write must never be
 * observable. Windows may briefly lock the destination; retry EBUSY/EPERM.
 */
import fs from "fs/promises";
import path from "path";

const RENAME_ATTEMPTS = 10;
const RETRY_BASE_MS = 40;

/**
 * @param {unknown} err
 */
export function isRetryableFsError(err) {
  if (!err || typeof err !== "object" || !("code" in err)) return false;
  return err.code === "EBUSY" || err.code === "EPERM";
}

/**
 * @param {string} filePath
 * @param {unknown} value
 * @param {{
 *   indent?: number,
 *   rename?: (from: string, to: string) => Promise<unknown>,
 *   delay?: (ms: number) => Promise<unknown>,
 * }} [options]
 */
export async function writeJsonAtomic(
  filePath,
  value,
  {
    indent = 2,
    rename = (from, to) => fs.rename(from, to),
    delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = {},
) {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const tmpPath = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
  );
  await fs.writeFile(tmpPath, `${JSON.stringify(value, null, indent)}\n`, "utf8");

  let lastErr;
  for (let attempt = 0; attempt < RENAME_ATTEMPTS; attempt++) {
    try {
      await rename(tmpPath, filePath);
      return;
    } catch (err) {
      lastErr = err;
      if (!isRetryableFsError(err) || attempt === RENAME_ATTEMPTS - 1) {
        try {
          await fs.unlink(tmpPath);
        } catch {
          // temp file already gone
        }
        throw err;
      }
      await delay(RETRY_BASE_MS * (attempt + 1));
    }
  }
  throw lastErr;
}
