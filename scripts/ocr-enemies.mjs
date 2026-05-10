/**
 * @deprecated Use `ocr-enemy.mjs`. Kept so existing npm scripts / docs keep working.
 */
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const runner = path.join(__dirname, "ocr-enemy.mjs");

const child = spawn(process.execPath, [runner, ...process.argv.slice(2)], {
  stdio: "inherit",
});

child.on("exit", (code) => process.exit(code ?? 0));
child.on("error", (err) => {
  console.error(err);
  process.exit(1);
});
