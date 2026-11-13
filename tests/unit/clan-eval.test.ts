import { describe, expect, it } from "vitest";
import {
  evaluateClanRows,
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

describe("evaluateClanRows", () => {
  const rows = [
    {
      item: { name: "Babka MAG", power: 100, path: "data/2026-01-01/000_000_100-Babka%5CMAG.png" },
      actual: "Babka\\MAG",
      power: 100,
    },
    {
      item: { name: "HuN | Lehel", power: 200, path: "data/2026-01-01/Screenshot_1.png" },
      actual: "HuN TOLDI",
      power: 999,
      note: "mismatch",
    },
  ];

  it("summarises exact matches, similarity and power", () => {
    const summary = evaluateClanRows(rows);
    expect(summary.samples).toBe(2);
    expect(summary.nameOk).toBe(1);
    expect(summary.namePct).toBe("50");
    expect(summary.powerOk).toBe(1);
    expect(summary.powerPct).toBe("50");
    expect(Number(summary.similarityPct)).toBeLessThan(100);
    expect(summary.failureLines).toHaveLength(1);
    expect(summary.failureLines[0]).toContain("power 999");
    expect(summary.failureLines[0]).toContain("(mismatch)");
  });

  it("splits hinted and OCR-only samples", () => {
    const summary = evaluateClanRows(rows);
    expect(summary.groups).toEqual([
      { label: "hinted", n: 1, exact: 1, similarityPct: "100.0" },
      {
        label: "ocr-only",
        n: 1,
        exact: 0,
        similarityPct: expect.any(String),
      },
    ]);
  });

  it("lists every row in verbose mode", () => {
    expect(evaluateClanRows(rows, { verbose: true }).failureLines).toHaveLength(2);
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
