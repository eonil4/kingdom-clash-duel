import { afterEach, describe, expect, it } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { writeJsonAtomic } from "../../scripts/atomic-json.mjs";

const dirs: string[] = [];

async function tmpDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kc-atomic-"));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

describe("writeJsonAtomic", () => {
  it("writes 2-space JSON with a trailing newline and no temp leftovers", async () => {
    const dir = await tmpDir();
    const file = path.join(dir, "nested", "data.json");
    await writeJsonAtomic(file, { a: 1, b: [2] });

    expect(await fs.readFile(file, "utf8")).toBe('{\n  "a": 1,\n  "b": [\n    2\n  ]\n}\n');
    const leftovers = (await fs.readdir(path.dirname(file))).filter((n) => n.endsWith(".tmp"));
    expect(leftovers).toEqual([]);
  });

  it("replaces an existing file atomically", async () => {
    const dir = await tmpDir();
    const file = path.join(dir, "data.json");
    await writeJsonAtomic(file, { v: 1 });
    await writeJsonAtomic(file, { v: 2 });
    expect(JSON.parse(await fs.readFile(file, "utf8"))).toEqual({ v: 2 });
  });
});
