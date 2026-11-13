import { describe, expect, it, vi } from "vitest";
import {
  evaluateClanFixture,
  evaluateClanRows,
  levenshtein,
  normalizeForCompare,
  reportClanEvaluation,
  runClanOcrEval,
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

describe("evaluateClanFixture", () => {
  const labels = {
    images: [
      { path: "data/a/000_000_100-Babka%5CMAG.png", name: "Babka MAG", power: 100 },
      { path: "data/a/Screenshot_1.png", name: "HuN | Lehel", power: 200 },
      { path: "data/a/Screenshot_2.png", name: "Third", power: 300 },
    ],
  };

  it("collects rows, skips, errors and honours the limit", async () => {
    const calls: string[] = [];
    const strategy = {
      async prepare() {
        calls.push("prepare");
      },
      async dispose() {
        calls.push("dispose");
      },
      async extract({ basename }: { basename: string }) {
        calls.push(basename);
        if (basename.startsWith("Screenshot_1")) return { skip: true, reason: "incomplete" };
        if (basename.startsWith("Screenshot_2")) throw new Error("boom");
        return { record: { name: "N", nameLatin: "Babka MAG", power: 100 } };
      },
    };

    const rows = await evaluateClanFixture({ labels, strategy });
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ actual: "Babka MAG", power: 100 });
    expect(rows[1].note).toBe("incomplete");
    expect(rows[2].note).toBe("boom");
    expect(calls[0]).toBe("prepare");
    expect(calls.at(-1)).toBe("dispose");

    const limited = await evaluateClanFixture({ labels, limit: 1, strategy });
    expect(limited).toHaveLength(1);
  });

  it("prints a report with totals and group splits", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const summary = evaluateClanRows([
      {
        item: { name: "Babka MAG", power: 100, path: "data/000_000_100-Babka%5CMAG.png" },
        actual: "Babka MAG",
        power: 100,
      },
      {
        item: { name: "HuN | Lehel", power: 200, path: "data/Screenshot_1.png" },
        actual: "HuN TOLDI",
        power: 999,
      },
    ]);
    reportClanEvaluation(summary);
    const text = log.mock.calls.map((call) => String(call[0])).join("\n");
    expect(text).toContain("samples: 2");
    expect(text).toContain("name exact: 1/2");
    expect(text).toContain("hinted");
    expect(text).toContain("ocr-only");
  });
});

describe("runClanOcrEval", () => {
  const strategy = {
    async prepare() {},
    async dispose() {},
    async extract() {
      return { record: { name: "Babka MAG", nameLatin: "Babka MAG", power: 100 } };
    },
  };

  it("evaluates labels and reports the summary", async () => {
    const logs: string[] = [];
    const { summary } = await runClanOcrEval([], {
      loadLabels: async () => ({
        images: [{ path: "data/000_000_100-Babka%5CMAG.png", name: "Babka MAG", power: 100 }],
      }),
      makeStrategy: () => strategy,
      log: (line) => logs.push(String(line)),
    });
    expect(summary?.samples).toBe(1);
    expect(logs.join("\n")).toContain("samples: 1");
  });

  it("reports empty label sets", async () => {
    const logs: string[] = [];
    const result = await runClanOcrEval([], {
      loadLabels: async () => ({ images: [] }),
      makeStrategy: () => strategy,
      log: (line) => logs.push(String(line)),
    });
    expect(result.summary).toBeUndefined();
    expect(logs.at(-1)).toContain("no samples matched");
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
