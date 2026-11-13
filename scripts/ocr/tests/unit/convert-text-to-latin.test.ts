import { describe, expect, it } from "vitest";
import {
  convertTextToLatinArtifacts,
  detectAlphabetKind,
  runConvertTextCli,
  transliterateToLatin,
} from "../../convert-text-to-latin.mjs";

describe("runConvertTextCli", () => {
  it("prints artifacts or a usage error", () => {
    const logs: string[] = [];
    const errors: string[] = [];
    expect(
      runConvertTextCli(["Babka", "MAG"], {
        log: (line) => logs.push(String(line)),
        error: (line) => errors.push(String(line)),
      }),
    ).toBe(0);
    expect(JSON.parse(logs[0])).toHaveProperty("latinRaw");

    expect(
      runConvertTextCli(["--"], {
        log: (line) => logs.push(String(line)),
        error: (line) => errors.push(String(line)),
      }),
    ).toBe(1);
    expect(errors[0]).toContain("Usage:");
  });
});

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

