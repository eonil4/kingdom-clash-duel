import { describe, expect, it } from "vitest";
import {
  decodeEnemyFilenamePercent,
  parseLatinNameHintFromEncodedOriginalBasename,
  toSafeEnemyFilenameToken,
} from "../../scripts/enemy-filename-tokens.mjs";

describe("toSafeEnemyFilenameToken", () => {
  it("percent-encodes Windows reserved characters", () => {
    expect(toSafeEnemyFilenameToken(String.raw`Babka\MAG`)).toBe("Babka%5CMAG");
    expect(toSafeEnemyFilenameToken(`HuN|Leonil`)).toBe("HuN%7CLeonil");
    expect(toSafeEnemyFilenameToken(`a:b*c?d`)).toBe("a%3Ab%2Ac%3Fd");
    expect(toSafeEnemyFilenameToken(`<> "'/`)).toBe("%3C%3E_%22%27%2F");
  });

  it("escapes literal percent signs", () => {
    expect(toSafeEnemyFilenameToken("100%")).toBe("100%25");
  });

  it("collapses spaces to underscores", () => {
    expect(toSafeEnemyFilenameToken("foo bar")).toBe("foo_bar");
  });

  it("replaces other unsafe characters with underscore", () => {
    expect(toSafeEnemyFilenameToken("a@b#c")).toBe("a_b_c");
  });
});

describe("decodeEnemyFilenamePercent", () => {
  it("decodes percent hex sequences", () => {
    expect(decodeEnemyFilenamePercent("Babka%5CMAG")).toBe(String.raw`Babka\MAG`);
    expect(decodeEnemyFilenamePercent("a%7Cb")).toBe("a|b");
  });

  it("iterates so literal percent can be represented", () => {
    expect(decodeEnemyFilenamePercent("100%25off")).toBe("100%off");
  });
});

describe("parseLatinNameHintFromEncodedOriginalBasename", () => {
  it("returns decoded slug when power-prefix basename uses escapes", () => {
    expect(parseLatinNameHintFromEncodedOriginalBasename("002_295_202-Babka%5CMAG.png")).toBe(
      String.raw`Babka\MAG`,
    );
  });

  it("returns undefined when slug has no percent escapes (OCR path)", () => {
    expect(parseLatinNameHintFromEncodedOriginalBasename("002_295_202-Gu_22_u.png")).toBe(
      undefined,
    );
  });
});
