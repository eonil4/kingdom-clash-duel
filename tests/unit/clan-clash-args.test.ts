import { describe, expect, it } from "vitest";
import path from "path";
import {
  parseArgs,
  parseFullFlag,
  parseRecursiveLevel,
  resolveConvertTarget,
} from "../../scripts/llm/clan-clash.mjs";

describe("clan-clash parseArgs", () => {
  it("returns the documented defaults", () => {
    expect(parseArgs([])).toEqual({
      dir: undefined,
      script: "convert2",
      model: undefined,
      full: false,
      recursive: 0,
      passthrough: [],
    });
  });

  it("parses dir, script, full, recursive and passthrough flags", () => {
    const args = parseArgs([
      "data/clan_clash/2026-11-06",
      "--script",
      "convert",
      "--full",
      "--recursive",
      "2",
      "--force",
    ]);
    expect(args).toMatchObject({
      dir: "data/clan_clash/2026-11-06",
      script: "convert",
      full: true,
      recursive: 2,
      passthrough: ["--force"],
    });
  });

  it("handles recursive and full value forms", () => {
    expect(parseArgs(["--recursive"]).recursive).toBe(1);
    expect(parseArgs(["--recursive=0"]).recursive).toBe(0);
    expect(parseArgs(["--recursive=3"]).recursive).toBe(3);
    expect(parseArgs(["--full=false"]).full).toBe(false);
    expect(parseArgs(["--full=true"]).full).toBe(true);
    expect(parseArgs(["--no-full"]).full).toBe(false);
    expect(parseArgs(["--script=convert2"]).script).toBe("convert2");
    expect(parseArgs(["--model", "qwen"]).model).toBe("qwen");
    expect(parseArgs(["-m", "other"]).model).toBe("other");
  });
});

describe("parseFullFlag / parseRecursiveLevel", () => {
  it("parses truthy and falsy full flags", () => {
    expect(parseFullFlag("yes")).toBe(true);
    expect(parseFullFlag("on")).toBe(true);
    expect(parseFullFlag("no")).toBe(false);
    expect(parseFullFlag("off")).toBe(false);
    expect(() => parseFullFlag("maybe")).toThrow("Invalid --full value");
  });

  it("validates recursive depth", () => {
    expect(parseRecursiveLevel(undefined)).toBe(0);
    expect(parseRecursiveLevel("")).toBe(0);
    expect(parseRecursiveLevel("2")).toBe(2);
    expect(() => parseRecursiveLevel("abc")).toThrow("Invalid --recursive value");
    expect(() => parseRecursiveLevel("-1")).toThrow("Invalid --recursive value");
  });
});

describe("resolveConvertTarget", () => {
  it("maps legacy script names onto convert modes", () => {
    expect(resolveConvertTarget("convert")).toMatchObject({ mode: "screenshot" });
    expect(resolveConvertTarget("convert.js")).toMatchObject({ mode: "screenshot" });
    expect(resolveConvertTarget("convert2")).toMatchObject({ mode: "crops" });
    expect(resolveConvertTarget("convert2.js")).toMatchObject({ mode: "crops" });
  });

  it("points at convert.mjs and rejects unknown scripts", () => {
    const { script } = resolveConvertTarget("convert");
    expect(path.isAbsolute(script)).toBe(true);
    expect(script.endsWith(path.join("scripts", "llm", "convert.mjs"))).toBe(true);
    expect(() => resolveConvertTarget("bogus")).toThrow("Unknown --script");
  });
});
