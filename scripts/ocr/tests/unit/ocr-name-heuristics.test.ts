import { describe, expect, it } from "vitest";
import {
  NAME_RECOGNITION_GROUPS,
  arenaCandidatePenalty,
  arenaNameLineQuality,
  cleanupName,
  cleanupNamePhrase,
  correctClanNameConfusables,
  extractBestPhraseFromRawText,
  isLikelyOcrNoise,
  isStrongFirstPassResult,
  normalizeOpponentDisplayName,
  pickClanName,
  scoreNameCandidate,
  scoreNamePhrase,
  stripEdgeTagSeparators,
  stripLeadingClippedToken,
  stripLeadingClippedTokens,
  stripUnbalancedTagNoise,
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

describe("scoreNamePhrase", () => {
  it("scores multi-word phrases by their best token", () => {
    expect(scoreNamePhrase("я Горький")).toBeGreaterThanOrEqual(4);
    expect(scoreNamePhrase("Рима8 zr")).toBeGreaterThanOrEqual(4);
    expect(scoreNamePhrase("HuN | TOLDI")).toBeGreaterThanOrEqual(4);
    expect(scoreNamePhrase("")).toBe(-1);
  });

  it("still rejects pure digit phrases", () => {
    expect(scoreNamePhrase("123 456")).toBe(-1);
  });
});

describe("arenaCandidatePenalty", () => {
  it("penalises short fragments and mixed-script tokens", () => {
    expect(arenaCandidatePenalty("С оМяснйк")).toBeGreaterThan(0);
    expect(arenaCandidatePenalty("Мяснik")).toBeGreaterThanOrEqual(12);
    expect(arenaCandidatePenalty("Myasnik")).toBe(0);
    expect(arenaCandidatePenalty("MEDEBYY ZR")).toBe(0);
  });

  it("penalises a leading letterless icon fragment", () => {
    expect(arenaCandidatePenalty("] IHOPYMK SP")).toBeGreaterThanOrEqual(15);
    expect(arenaCandidatePenalty("[MAG] HuN")).toBe(0);
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

describe("stripUnbalancedTagNoise", () => {
  it("drops unmatched trailing brackets", () => {
    expect(stripUnbalancedTagNoise("HuN | TOLDI]")).toBe("HuN | TOLDI");
    expect(stripUnbalancedTagNoise("[HuN | TOLDI")).toBe("HuN | TOLDI");
  });

  it("drops unmatched brackets anywhere in the text", () => {
    expect(stripUnbalancedTagNoise("AulN]|TOLDI")).toBe("AulN|TOLDI");
  });

  it("keeps balanced tags intact", () => {
    expect(stripUnbalancedTagNoise("[MAG] HuN")).toBe("[MAG] HuN");
  });
});

describe("stripLeadingClippedToken", () => {
  it("drops a clipped single character before the real name", () => {
    expect(stripLeadingClippedToken("n HuN | TOLDI")).toBe("HuN | TOLDI");
    expect(stripLeadingClippedToken("1 MAG")).toBe("MAG");
  });

  it("drops a lowercase fragment before the real name", () => {
    expect(stripLeadingClippedToken("an HuN")).toBe("HuN");
    expect(stripLeadingClippedToken("clan HuN")).toBe("HuN");
  });

  it("keeps mixed-case first tokens such as misread names intact", () => {
    expect(stripLeadingClippedToken("AulN | TOLDI")).toBe("AulN | TOLDI");
    expect(stripLeadingClippedToken("AulN] || TOLD")).toBe("AulN] || TOLD");
  });

  it("keeps plausible names intact", () => {
    expect(stripLeadingClippedToken("HuN | TOLDI")).toBe("HuN | TOLDI");
    expect(stripLeadingClippedToken("HuN|Lehel")).toBe("HuN|Lehel");
    expect(stripLeadingClippedToken("A")).toBe("A");
  });
});

describe("correctClanNameConfusables", () => {
  it("restores a misread leading tag before a separator", () => {
    expect(correctClanNameConfusables("AulN | TOLDI")).toBe("HuN | TOLDI");
    expect(correctClanNameConfusables("SulN|X")).toBe("HuN|X");
    expect(correctClanNameConfusables(String.raw`HulN \ MAG`)).toBe(String.raw`HuN \ MAG`);
  });

  it("leaves correct or unrelated leading tokens alone", () => {
    expect(correctClanNameConfusables("HuN | TOLDI")).toBe("HuN | TOLDI");
    expect(correctClanNameConfusables("AulN")).toBe("AulN");
    expect(correctClanNameConfusables("HulN House")).toBe("HulN House");
  });

  it("accepts a caller-provided correction table", () => {
    expect(correctClanNameConfusables("ZzZ|TOLDI", { ZzZ: "HuN" })).toBe("HuN|TOLDI");
    expect(correctClanNameConfusables("ZzZ \\ TOLDI", { ZzZ: "HuN" })).toBe(String.raw`HuN \ TOLDI`);
    // The override replaces the built-in table entirely.
    expect(correctClanNameConfusables("AulN|TOLDI", { ZzZ: "HuN" })).toBe("AulN|TOLDI");
    expect(correctClanNameConfusables("AulN|TOLDI", { AulN: "  " })).toBe("AulN|TOLDI");
  });
});

describe("NAME_RECOGNITION_GROUPS", () => {
  it("keeps unique variant keys and puts the early-exit pass first", () => {
    const keys = NAME_RECOGNITION_GROUPS.flatMap((g) => g.variants.map((v) => v.key));
    expect(new Set(keys).size).toBe(keys.length);
    expect(NAME_RECOGNITION_GROUPS[0]).toMatchObject({ id: "first", psm: "8" });
    expect(NAME_RECOGNITION_GROUPS[0].variants.map((v) => v.key)).toEqual([
      "nameNeutral",
      "nameThreshold",
      "wideNeutral",
      "wideThreshold",
    ]);
  });

  it("runs the Latin-only repair pass only for tight formation boxes", () => {
    const latin = NAME_RECOGNITION_GROUPS.find((g) => g.id === "textLatin");
    expect(latin?.onlyWhen).toBe("tight");
    expect(latin?.whitelist).toContain("ABCDEFGHIJKLMNOPQRSTUVWXYZ");
    expect(latin?.whitelist).not.toMatch(/[А-Яа-я]/);
  });
});

describe("stripLeadingClippedTokens", () => {
  it("strips repeated single-character fragments", () => {
    expect(stripLeadingClippedTokens("У я Горький")).toBe("Горький");
    expect(stripLeadingClippedTokens("n HuN | TOLDI")).toBe("HuN | TOLDI");
  });

  it("strips a lowercase prefix only before an uppercase name", () => {
    expect(stripLeadingClippedTokens("hd Myasnik")).toBe("Myasnik");
    expect(stripLeadingClippedTokens("фил army")).toBe("фил army");
    expect(stripLeadingClippedTokens("Myasnik")).toBe("Myasnik");
  });
});

describe("stripEdgeTagSeparators", () => {
  it("drops icon glyphs misread as leading or trailing separators", () => {
    expect(stripEdgeTagSeparators("| GumitronWATAHA")).toBe("GumitronWATAHA");
    expect(stripEdgeTagSeparators("|| Николай SKF")).toBe("Николай SKF");
    expect(stripEdgeTagSeparators(String.raw`\МишкинСы H-1922`)).toBe("МишкинСы H-1922");
    expect(stripEdgeTagSeparators("GumitronWATAHA |")).toBe("GumitronWATAHA");
    expect(stripEdgeTagSeparators("- KalugaZR")).toBe("KalugaZR");
  });

  it("keeps real tags and inner separators", () => {
    expect(stripEdgeTagSeparators("[MAG] HuN")).toBe("[MAG] HuN");
    expect(stripEdgeTagSeparators(String.raw`HuN | TOLDI`)).toBe(String.raw`HuN | TOLDI`);
  });
});

describe("isStrongFirstPassResult", () => {
  it("accepts a confident tag-shaped first pass", () => {
    expect(isStrongFirstPassResult({ data: { text: "| GumitronWATAHA", confidence: 79 } })).toBe(true);
    expect(isStrongFirstPassResult({ data: { text: "[MAG] HuN", confidence: 70 } })).toBe(true);
  });

  it("rejects low confidence, missing tags, HUD lines and noise", () => {
    expect(isStrongFirstPassResult({ data: { text: "| GumitronWATAHA", confidence: 59 } })).toBe(false);
    expect(isStrongFirstPassResult({ data: { text: "Janski WATAHA", confidence: 90 } })).toBe(false);
    expect(isStrongFirstPassResult({ data: { text: "1 300 WATAHA", confidence: 90 } })).toBe(false);
    expect(isStrongFirstPassResult({ data: { text: "HuN 123 MAG", confidence: 90 } })).toBe(false);
    expect(isStrongFirstPassResult({ data: { text: "|", confidence: 99 } })).toBe(false);
    expect(isStrongFirstPassResult({})).toBe(false);
  });
});

describe("pickClanName", () => {
  it("prefers the more Latin candidate when confidences are close", () => {
    expect(
      pickClanName(
        [
          { text: "Нш|ТОО]", confidence: 85 },
          { text: "HuN | TOLDI", confidence: 70 },
        ],
        "fallback",
      ),
    ).toBe("HuN | TOLDI");
  });

  it("falls back when the Latin pass is weak or unusable", () => {
    expect(pickClanName([{ text: "HuN", confidence: 20 }], "fallback")).toBe("fallback");
    expect(pickClanName([{ text: "1", confidence: 99 }], "fallback")).toBe("fallback");
    expect(pickClanName([], "fallback")).toBe("fallback");
  });

  it("keeps Cyrillic formation names when the Latin pass is weak", () => {
    expect(
      pickClanName([{ text: "HuN | TOLDI", confidence: 40 }], String.raw`Бабка\MAG`),
    ).toBe(String.raw`Бабка\MAG`);
  });

  it("prefers a confident Latin read over garbled Cyrillic islands", () => {
    expect(
      pickClanName([{ text: "AulN] | TOLDI", confidence: 65 }], "Н|м\\ | ОНО]"),
    ).toBe("AulN] | TOLDI");
  });

  it("uses confidence to break ties between valid candidates", () => {
    expect(
      pickClanName(
        [
          { text: "HuN Low", confidence: 62 },
          { text: "HuN High", confidence: 90 },
        ],
        "fallback",
      ),
    ).toBe("HuN High");
  });
});
