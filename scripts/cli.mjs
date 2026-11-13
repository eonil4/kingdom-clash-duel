import path from "path";
import { fileURLToPath } from "url";

/**
 * True when the module identified by `metaUrl` is the process entry point.
 * @param {string} metaUrl  pass `import.meta.url`
 * @param {string | undefined} [argv1]
 */
export function isMain(metaUrl, argv1 = process.argv[1]) {
  if (!metaUrl || !argv1) return false;
  return path.resolve(argv1) === path.resolve(fileURLToPath(metaUrl));
}
