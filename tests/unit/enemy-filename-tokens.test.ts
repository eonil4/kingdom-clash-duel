import { describe, expect, it } from "vitest";
import { toSafeEnemyFilenameToken } from "../../scripts/enemy-filename-tokens.mjs";

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
