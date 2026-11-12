import { describe, expect, it } from "vitest";
import {
  arenaNameLineQuality,
  cleanupName,
  cleanupNamePhrase,
  extractBestPhraseFromRawText,
  isLikelyOcrNoise,
  normalizeOpponentDisplayName,
  scoreNameCandidate,
} from "../../ocr-enemy-name.mjs";

describe("cleanupName", () => {
  it("keeps tag punctuation and mixed case", () => {
    expect(cleanupName("HuN|Leonil")).toBe("HuN|Leonil");
    expect(cleanupName(String.raw`Babka\MAG`)).toBe(String.raw`Babka\MAG`);
  });

  it("prefers the last mixed-case token", () => {
    expect(cleanupName("HuN бабка")).toBe("HuN");
    expect(cleanupName("HuN BaZ")).toBe("BaZ");
  });

  it("prefers title-case tokens over lowercase ones", () => {
    expect(cleanupName("foo BAR baz")).toBe("BAR");
  });

  it("drops digit-only and symbol-only candidates", () => {
    expect(cleanupName("012 HuN")).toBe("HuN");
    expect(cleanupName("123 !!!")).toBe("");
    expect(cleanupName("!!!")).toBe("");
  });

  it("falls back to title-case for all-caps names", () => {
    expect(cleanupName("БАБКА")).toBe("БАБКА");
  });

  it("strips reserved filename characters before matching", () => {
    expect(cleanupName("Storm.ZR")).toBe("StormZR");
    expect(cleanupName("HuN !!!")).toBe("HuN");
  });
});

describe("cleanupNamePhrase", () => {
  it("preserves spaces and tag punctuation", () => {
    expect(cleanupNamePhrase("HuN | NIX")).toBe("HuN | NIX");
    expect(cleanupNamePhrase(String.raw`Бабка \ MAG`)).toBe(String.raw`Бабка \ MAG`);
  });

  it("replaces characters that are unsafe in filenames with spaces", () => {
    expect(cleanupNamePhrase("a<b>c")).toBe("a b c");
    expect(cleanupNamePhrase("  one   two  ")).toBe("one two");
  });
});

describe("scoreNameCandidate", () => {
  it("rejects empty, single-char and non-letter-leading tokens", () => {
    expect(scoreNameCandidate("")).toBe(-1);
    expect(scoreNameCandidate("A")).toBe(-1);
    expect(scoreNameCandidate("[MAG]HuN")).toBe(-1);
  });

  it("scores length, mixed case, tags and mixed scripts", () => {
    expect(scoreNameCandidate("AB")).toBe(2);
    expect(scoreNameCandidate("Ab")).toBe(6);
    expect(scoreNameCandidate("HuN|Leonil")).toBe(14);
    expect(scoreNameCandidate(String.raw`Babka\MAG`)).toBe(21);
    expect(scoreNameCandidate(String.raw`Бабка\MAG`)).toBe(27);
  });

  it("penalises HUD-like tokens", () => {
    expect(scoreNameCandidate("VS")).toBe(-1);
    expect(scoreNameCandidate("123")).toBe(-1);
  });
});

describe("arenaNameLineQuality", () => {
  it("rewards tags and mixed scripts", () => {
    expect(arenaNameLineQuality(String.raw`Babka\MAG`)).toBe(35);
    expect(arenaNameLineQuality("[MAG] HuN")).toBe(22);
    expect(arenaNameLineQuality("Бабка MAG")).toBe(25);
  });

  it("penalises digit islands", () => {
    expect(arenaNameLineQuality("HuN 123 MAG")).toBe(-35);
    expect(arenaNameLineQuality("MAG 123")).toBe(-15);
  });

  it("treats empty input as worst", () => {
    expect(arenaNameLineQuality("")).toBe(-1000);
  });
});

describe("normalizeOpponentDisplayName", () => {
  it("tightens spacing around tags and separators", () => {
    expect(normalizeOpponentDisplayName("HuN | NIX")).toBe("HuN|NIX");
    expect(normalizeOpponentDisplayName("[ MAG ] HuN")).toBe("[MAG]HuN");
    expect(normalizeOpponentDisplayName(String.raw`Babka \ MAG`)).toBe(String.raw`Babka\MAG`);
  });
});

describe("extractBestPhraseFromRawText", () => {
  it("skips HUD lines and prefers multi-word phrases", () => {
    expect(extractBestPhraseFromRawText("VS\n004 653\nHuN MAG")).toBe("HuN MAG");
    expect(extractBestPhraseFromRawText("one two")).toBe("one two");
  });

  it("biases towards Cyrillic phrases", () => {
    expect(extractBestPhraseFromRawText("Бабка MAG")).toBe("Бабка MAG");
  });

  it("returns empty when only HUD noise is present", () => {
    expect(extractBestPhraseFromRawText("VS\n12")).toBe("");
    expect(extractBestPhraseFromRawText("")).toBe("");
  });
});

describe("isLikelyOcrNoise", () => {
  it("flags empty and generic HUD tokens", () => {
    expect(isLikelyOcrNoise("")).toBe(true);
    expect(isLikelyOcrNoise("PRT")).toBe(true);
    expect(isLikelyOcrNoise("BCDF")).toBe(true);
  });

  it("accepts real names", () => {
    expect(isLikelyOcrNoise("HuN")).toBe(false);
    expect(isLikelyOcrNoise("HuN MAG")).toBe(false);
  });
});
