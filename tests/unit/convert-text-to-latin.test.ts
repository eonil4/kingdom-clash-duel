import { describe, expect, it } from "vitest";
import {
  convertTextToLatinArtifacts,
  detectAlphabetKind,
  transliterateToLatin,
} from "../../scripts/convert-text-to-latin.mjs";

describe("convert-text-to-latin", () => {
  it("transliterates Cyrillic", () => {
    expect(transliterateToLatin("Яо")).toBe("Yao");
  });

  it("detects cyrillic", () => {
    expect(detectAlphabetKind("Бабка")).toBe("cyrillic");
  });

  it("encodes backslash in latin token via pipeline", () => {
    const art = convertTextToLatinArtifacts(String.raw`Babka\MAG`);
    expect(art.alphabet).toBe("latin");
    expect(art.latinRaw).toBe(String.raw`Babka\MAG`);
    expect(art.nameLatinToken).toBe("Babka%5CMAG");
  });

  it("transliterates Cyrillic name with backslash guild tag", () => {
    const art = convertTextToLatinArtifacts(String.raw`Бабка\MAG`);
    expect(art.alphabet).toBe("mixed");
    expect(art.latinRaw).toBe(String.raw`Babka\MAG`);
    expect(art.nameLatinToken).toBe("Babka%5CMAG");
  });
});
