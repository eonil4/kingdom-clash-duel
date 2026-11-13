import path from "path";
import { fileURLToPath } from "url";

/**
 * Invalid CLI arguments. Parsers throw this instead of exiting so they stay reusable;
 * the CLI entry point prints the message + usage and exits 1.
 */
export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = "UsageError";
  }
}

/**
 * True when the module identified by `metaUrl` is the process entry point.
 * @param {string} metaUrl  pass `import.meta.url`
 * @param {string | undefined} [argv1]
 */
export function isMain(metaUrl, argv1 = process.argv[1]) {
  if (!metaUrl || !argv1) return false;
  return path.resolve(argv1) === path.resolve(fileURLToPath(metaUrl));
}
