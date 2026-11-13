import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import {
  generateWikiTable,
  parseExtensions,
  resolveFolderPaths,
  runWikiTableCli,
} from "../../scripts/generate-wiki-table.mjs";
import { escapeHtml } from "../../scripts/html-document.mjs";
import { WORKSPACE_ROOT } from "../../scripts/enemy-records.mjs";

const dirs: string[] = [];

async function tmpDir() {
  const dir = await fs.mkdtemp(path.join(WORKSPACE_ROOT, ".tmp-table-"));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

describe("generateWikiTable", () => {
  it("writes a self-describing table for matching extensions", async () => {
    const dir = await tmpDir();
    await fs.writeFile(path.join(dir, "b.webp"), "");
    await fs.writeFile(path.join(dir, "a.webp"), "");
    await fs.writeFile(path.join(dir, "c.png"), "");

    const result = generateWikiTable(dir, ".webp");
    expect(result).toMatchObject({ empty: false, images: 2 });
    const html = await fs.readFile(result.outputPath, "utf8");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain('<h3 id="img-a">');
    expect(html).toContain("a.webp");
    expect(html).not.toContain("c.png");
  });

  it("joins multiple extensions and reports empty folders", async () => {
    const dir = await tmpDir();
    await fs.writeFile(path.join(dir, "a.jpg"), "");
    await fs.writeFile(path.join(dir, "c.png"), "");
    expect(generateWikiTable(dir, "jpg,png")).toMatchObject({ empty: false, images: 2 });

    const empty = generateWikiTable(await tmpDir(), ".webp");
    expect(empty).toMatchObject({ empty: true, extensions: [".webp"] });
  });
});

describe("runWikiTableCli", () => {
  it("prints results for valid folders and reports usage/errors", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const dir = await tmpDir();
    await fs.writeFile(path.join(dir, "a.webp"), "");
    const ok = runWikiTableCli([dir, "webp"]);
    expect(ok.outputPath).toContain("index.html");
    expect(log.mock.calls.some(([line]) => String(line).includes("Successfully generated"))).toBe(
      true,
    );

    const empty = runWikiTableCli([await tmpDir(), "webp"]);
    expect(empty).toMatchObject({ empty: true });

    expect(runWikiTableCli([])).toEqual({ usage: true });

    const missing = runWikiTableCli([path.join(WORKSPACE_ROOT, "no-such-folder-xyz"), "webp"]);
    expect(missing.error).toBeTruthy();
    expect(error).toHaveBeenCalled();
  });
});

describe("parseExtensions", () => {
  it("defaults to .webp for empty input", () => {
    expect(parseExtensions("")).toEqual([".webp"]);
    expect(parseExtensions("   ")).toEqual([".webp"]);
  });

  it("normalises single extensions", () => {
    expect(parseExtensions("webp")).toEqual([".webp"]);
    expect(parseExtensions(".JPG")).toEqual([".jpg"]);
  });

  it("splits comma, pipe and group forms", () => {
    expect(parseExtensions("jpg,png")).toEqual([".jpg", ".png"]);
    expect(parseExtensions("jpg|png")).toEqual([".jpg", ".png"]);
    expect(parseExtensions(".(jpg|png)")).toEqual([".jpg", ".png"]);
    expect(parseExtensions("(jpg,png)")).toEqual([".jpg", ".png"]);
  });
});

describe("escapeHtml", () => {
  it("escapes markup characters", () => {
    expect(escapeHtml('A&B <c> "d"')).toBe("A&amp;B &lt;c&gt; &quot;d&quot;");
    expect(escapeHtml("plain-name")).toBe("plain-name");
  });
});

describe("resolveFolderPaths", () => {
  it("resolves workspace-relative folders to posix paths", () => {
    const { abs, rel } = resolveFolderPaths("data");
    expect(abs).toBe(path.join(WORKSPACE_ROOT, "data"));
    expect(rel).toBe("data");
  });

  it("accepts absolute paths inside the workspace", () => {
    const target = path.join(WORKSPACE_ROOT, "data", "clan_clash");
    expect(resolveFolderPaths(target).rel).toBe("data/clan_clash");
  });

  it("rejects folders outside the workspace", () => {
    expect(() => resolveFolderPaths(path.join(os.tmpdir(), "elsewhere"))).toThrow(
      "inside the workspace root",
    );
  });
});
