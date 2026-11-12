import { describe, expect, it } from "vitest";
import os from "os";
import path from "path";
import {
  escapeHtml,
  parseExtensions,
  resolveFolderPaths,
} from "../../scripts/generate-wiki-table.mjs";
import { WORKSPACE_ROOT } from "../../scripts/enemy-records.mjs";

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
