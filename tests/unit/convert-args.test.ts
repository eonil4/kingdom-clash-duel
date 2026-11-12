import { describe, expect, it } from "vitest";
import { parseArgs, resolveExtractor } from "../../scripts/llm/convert.mjs";

describe("resolveExtractor", () => {
  it("defaults to llm and accepts ocr case-insensitively", () => {
    expect(resolveExtractor(undefined)).toBe("llm");
    expect(resolveExtractor("ocr")).toBe("ocr");
    expect(resolveExtractor("OCR")).toBe("ocr");
    expect(() => resolveExtractor("bogus")).toThrow("Unknown --extractor");
  });
});

describe("convert parseArgs", () => {
  it("returns the documented defaults", () => {
    expect(parseArgs([])).toEqual({
      folder: undefined,
      extractor: "llm",
      mode: "crops",
      modeExplicit: false,
      force: false,
      model: undefined,
      clearCache: undefined,
    });
  });

  it("takes the folder positional and all extractor forms", () => {
    expect(parseArgs(["folder", "--extractor", "ocr"])).toMatchObject({
      folder: "folder",
      extractor: "ocr",
    });
    expect(parseArgs(["--extractor=ocr", "folder"]).extractor).toBe("ocr");
    expect(parseArgs(["-E", "ocr"]).extractor).toBe("ocr");
    expect(() => parseArgs(["--extractor", "bogus"])).toThrow("Unknown --extractor");
  });

  it("resolves mode aliases and marks explicit modes", () => {
    expect(parseArgs(["--mode", "full"])).toMatchObject({
      mode: "screenshot",
      modeExplicit: true,
    });
    expect(parseArgs(["-M", "name-power"]).mode).toBe("crops");
    expect(parseArgs(["--mode=screenshot"])).toMatchObject({
      mode: "screenshot",
      modeExplicit: true,
    });
    expect(parseArgs([]).modeExplicit).toBe(false);
    expect(() => parseArgs(["--mode", "bogus"])).toThrow("Unknown --mode");
  });

  it("parses force/model/cache flags with last-wins cache toggles", () => {
    expect(parseArgs(["--force", "--model", "qwen", "--clear-cache"])).toMatchObject({
      force: true,
      model: "qwen",
      clearCache: true,
    });
    expect(parseArgs(["-m", "other"]).model).toBe("other");
    expect(parseArgs(["--clear-cache", "--no-clear-cache"]).clearCache).toBe(false);
    expect(parseArgs(["--no-clear-cache", "--clear-cache"]).clearCache).toBe(true);
  });

  it("ignores the bare -- separator and unknown flags", () => {
    expect(parseArgs(["--", "folder"]).folder).toBe("folder");
    expect(parseArgs(["--unknown", "folder"]).folder).toBe("folder");
  });
});
