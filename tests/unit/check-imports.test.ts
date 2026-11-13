// check-imports:ignore-file — the import-like strings below are fixtures, not imports.
import { afterEach, describe, expect, it } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import {
  collectScriptFiles,
  findBrokenImports,
} from "../../scripts/check-imports.mjs";

const dirs: string[] = [];

async function tmpDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kc-imports-"));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

describe("collectScriptFiles", () => {
  it("collects script files recursively and skips node_modules", async () => {
    const dir = await tmpDir();
    await fs.mkdir(path.join(dir, "nested"));
    await fs.mkdir(path.join(dir, "node_modules"));
    await fs.writeFile(path.join(dir, "a.mjs"), "", "utf8");
    await fs.writeFile(path.join(dir, "nested", "b.ts"), "", "utf8");
    await fs.writeFile(path.join(dir, "c.json"), "", "utf8");
    await fs.writeFile(path.join(dir, "node_modules", "d.mjs"), "", "utf8");

    const files = collectScriptFiles(dir).map((f) => path.relative(dir, f)).sort();
    expect(files).toEqual([path.join("a.mjs"), path.join("nested", "b.ts")].sort());
  });
});

describe("findBrokenImports", () => {
  it("reports missing relative specifiers only", async () => {
    const dir = await tmpDir();
    const good = path.join(dir, "good.mjs");
    const bad = path.join(dir, "bad.mjs");
    await fs.writeFile(path.join(dir, "target.mjs"), "", "utf8");
    await fs.writeFile(
      good,
      [
        'import { x } from "./target.mjs";',
        'const y = await import("./target.mjs");',
        'import fs from "node:fs";',
        "",
      ].join("\n"),
      "utf8",
    );
    await fs.writeFile(
      bad,
      ['import a from "./missing.mjs";', 'import b from "../outside.mjs";', ""].join("\n"),
      "utf8",
    );

    const broken = findBrokenImports([good, bad]);
    expect(broken).toEqual([
      { file: bad, specifier: "./missing.mjs" },
      { file: bad, specifier: "../outside.mjs" },
    ]);
  });

  it("returns nothing when every import resolves", async () => {
    const dir = await tmpDir();
    const file = path.join(dir, "a.mjs");
    await fs.writeFile(path.join(dir, "b.mjs"), "", "utf8");
    await fs.writeFile(file, 'export * from "./b.mjs";\n', "utf8");
    expect(findBrokenImports([file])).toEqual([]);
  });

  it("skips files that opt out with the ignore marker", async () => {
    const dir = await tmpDir();
    const file = path.join(dir, "fixture.mjs");
    await fs.writeFile(
      file,
      ['// check-imports:ignore-file', 'const s = "import a from \'./missing.mjs\'";', ""].join(
        "\n",
      ),
      "utf8",
    );
    expect(findBrokenImports([file])).toEqual([]);
  });
});
