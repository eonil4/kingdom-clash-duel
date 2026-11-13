import { describe, expect, it } from "vitest";
import {
  normalizeEnemyExtraction,
  normalizeEnemyNameExtraction,
  normalizeEnemyPowerExtraction,
  parseEnemyJsonFromLlm,
} from "../../scripts/llm/llm-enemy-extract.mjs";
import {
  normalizeClanExtraction,
  normalizeClanNameExtraction,
  normalizeClanPowerExtraction,
  parseJsonFromLlm,
} from "../../scripts/llm/llm-formation-extract.mjs";

describe("normalizeEnemyExtraction", () => {
  it("parses grouped power strings and trims optional fields", () => {
    expect(
      normalizeEnemyExtraction({
        name: "  HuN  ",
        power: "1,234,567",
        language: " Russian ",
        nameLatin: " HuN ",
        englishName: " Hun ",
        ignored: "x",
      }),
    ).toEqual({
      name: "HuN",
      power: 1234567,
      language: "Russian",
      nameLatin: "HuN",
      englishName: "Hun",
    });
  });

  it("rounds numeric power", () => {
    expect(normalizeEnemyExtraction({ name: "X", power: 12.6 })).toEqual({
      name: "X",
      power: 13,
    });
  });

  it("rejects missing names and invalid power", () => {
    expect(() => normalizeEnemyExtraction({ name: "   ", power: 1 })).toThrow(
      'missing non-empty "name"',
    );
    expect(() => normalizeEnemyExtraction({ name: "X", power: 0 })).toThrow("Invalid power");
    expect(() => normalizeEnemyExtraction({ name: "X", power: "0" })).toThrow("Invalid power");
    expect(() => normalizeEnemyExtraction({ name: "X", power: "abc" })).toThrow("Invalid power");
    expect(() => normalizeEnemyExtraction({ name: "X", power: 1_000_000_000 })).toThrow(
      "Invalid power",
    );
  });

  it("strips non-digits from power strings (sign included)", () => {
    expect(normalizeEnemyExtraction({ name: "X", power: "-5" })).toEqual({ name: "X", power: 5 });
  });

  it("rejects non-object payloads", () => {
    for (const payload of [null, undefined, [], "x"]) {
      expect(() => normalizeEnemyExtraction(payload)).toThrow("must be an object");
    }
  });
});

describe("normalizeEnemyNameExtraction / normalizeEnemyPowerExtraction", () => {
  it("accepts a name-only JSON object", () => {
    expect(normalizeEnemyNameExtraction({ name: "HuN", language: "en" })).toEqual({
      name: "HuN",
      language: "en",
    });
    expect(() => normalizeEnemyNameExtraction({ name: "" })).toThrow("missing non-empty");
  });

  it("parses power crops", () => {
    expect(normalizeEnemyPowerExtraction({ power: "9 999" })).toEqual({ power: 9999 });
    expect(() => normalizeEnemyPowerExtraction({})).toThrow("Invalid power");
  });
});

describe("parseEnemyJsonFromLlm", () => {
  it("unwraps fenced blocks and surrounding prose", () => {
    expect(parseEnemyJsonFromLlm('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseEnemyJsonFromLlm('Result: {"a":2} done')).toEqual({ a: 2 });
  });

  it("throws when no JSON object is present", () => {
    expect(() => parseEnemyJsonFromLlm("no json here")).toThrow("did not contain a JSON object");
  });
});

describe("clan normalisers", () => {
  it("defaults a missing name to UNKNOWN instead of throwing", () => {
    expect(normalizeClanExtraction({ power: 500 })).toEqual({ name: "UNKNOWN", power: 500 });
    expect(normalizeClanNameExtraction({})).toEqual({ name: "UNKNOWN" });
    expect(
      normalizeClanNameExtraction({ name: " HuN|NIX ", nameLatin: "HuN|NIX", language: "ru" }),
    ).toEqual({ name: "HuN|NIX", nameLatin: "HuN|NIX", language: "ru" });
  });

  it("still validates power", () => {
    expect(() => normalizeClanExtraction({ power: 0 })).toThrow("Invalid power");
    expect(() => normalizeClanPowerExtraction({ power: "x" })).toThrow("Invalid power");
    expect(normalizeClanPowerExtraction({ power: 5778220 })).toEqual({ power: 5778220 });
  });

  it("does not export an englishName field", () => {
    expect(
      normalizeClanExtraction({ name: "A", power: 1, englishName: "B" }),
    ).toEqual({ name: "A", power: 1 });
  });

  it("parses fenced JSON", () => {
    expect(parseJsonFromLlm('```json\n{"power":1}\n```')).toEqual({ power: 1 });
  });
});
