import { describe, expect, it } from "vitest";
import {
  levenshtein,
  normalizeForCompare,
  similarity,
} from "../../scripts/ocr/eval-clan-ocr.mjs";

describe("normalizeForCompare", () => {
  it("lowercases and collapses symbols to spaces", () => {
    expect(normalizeForCompare("HuN | TOLDI")).toBe("hun toldi");
    expect(normalizeForCompare(String.raw`Бабка\MAG`)).toBe("бабка mag");
    expect(normalizeForCompare("  HuN|Lehel  ")).toBe("hun lehel");
  });
});

describe("levenshtein / similarity", () => {
  it("computes edit distance", () => {
    expect(levenshtein("hun toldi", "hun toldi")).toBe(0);
    expect(levenshtein("hun", "huln")).toBe(1);
    expect(levenshtein("", "abc")).toBe(3);
  });

  it("returns a 0..1 similarity ratio", () => {
    expect(similarity("abc", "abc")).toBe(1);
    expect(similarity("", "")).toBe(1);
    expect(similarity("abcd", "ab")).toBeCloseTo(0.5);
  });
});
