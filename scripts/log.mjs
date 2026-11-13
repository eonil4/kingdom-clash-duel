/**
 * Minimal leveled logger for the extraction pipeline.
 *
 * Level is read from `LOG_LEVEL` on every call: silent | error | warn | info | debug
 * (default: info). CLI-level user summaries stay on console directly; this logger
 * gates pipeline chatter so runs can be quieted or made verbose without code changes.
 */

const LEVELS = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 };

function threshold() {
  const raw = String(process.env.LOG_LEVEL ?? "info").trim().toLowerCase();
  return LEVELS[raw] ?? LEVELS.info;
}

export const log = {
  error: (...args) => {
    if (threshold() >= LEVELS.error) console.error(...args);
  },
  warn: (...args) => {
    if (threshold() >= LEVELS.warn) console.warn(...args);
  },
  info: (...args) => {
    if (threshold() >= LEVELS.info) console.log(...args);
  },
  debug: (...args) => {
    if (threshold() >= LEVELS.debug) console.log(...args);
  },
};

const seenOnce = new Set();

/**
 * Log at `level` only the first time `key` is seen in this process. Used for
 * per-file/fallback diagnostics that would otherwise repeat for every item.
 * @param {"error" | "warn" | "info" | "debug"} level
 * @param {string} key
 * @param {...unknown} args
 */
export function logOnce(level, key, ...args) {
  const dedupeKey = `${level}:${key}`;
  if (seenOnce.has(dedupeKey)) return;
  seenOnce.add(dedupeKey);
  log[level](...args);
}
