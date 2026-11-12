import { describe, expect, it, vi } from "vitest";
import path from "path";
import {
  createLlmStrategy,
  resolveLlmMode,
} from "../../scripts/pipeline/llm-strategy.mjs";
import { WORKSPACE_ROOT } from "../../scripts/file-map-enemies.mjs";

const folderAbs = path.join(WORKSPACE_ROOT, "data", "clan_clash", "2026-11-06");
const filePath = path.join(folderAbs, "Screenshot_x.png");
const basename = "Screenshot_x.png";

function strategyFor(mode: "crops" | "screenshot", extract: unknown, overrides = {}) {
  const logTag = mode === "crops" ? "[LLM crops]" : "[LLM]";
  return createLlmStrategy({
    mode,
    attempts: 1,
    timeoutPerAttemptMs: 1000,
    retryBaseDelayMs: 0,
    delay: async () => {},
    extractFns: { [mode]: { logTag, extract } } as never,
    ...overrides,
  });
}

describe("resolveLlmMode", () => {
  it("accepts aliases and rejects unknown modes", () => {
    expect(resolveLlmMode(undefined)).toBe("crops");
    expect(resolveLlmMode("crop")).toBe("crops");
    expect(resolveLlmMode("full")).toBe("screenshot");
    expect(() => resolveLlmMode("bogus")).toThrow("Unknown --mode");
  });
});

describe("createLlmStrategy", () => {
  it("rejects an unknown mode", () => {
    expect(() =>
      createLlmStrategy({ mode: "nope" as never, extractFns: {} as never }),
    ).toThrow("Unknown LLM mode");
  });

  it("retries with escalating timeouts and logs retries", async () => {
    const timeouts: number[] = [];
    const extract = vi.fn(async (_file: string, opts: { timeoutMs: number }) => {
      timeouts.push(opts.timeoutMs);
      if (timeouts.length < 3) throw new Error("nope");
      return { name: "Gorkiy", power: 8104472, language: "en", englishName: "Gorky" };
    });
    const strategy = strategyFor("screenshot", extract, { attempts: 3 });

    const outcome = await strategy.extract({ filePath, basename, folderAbs, entries: {} });
    expect(timeouts).toEqual([1000, 2000, 3000]);
    expect(outcome.record).toMatchObject({
      name: "Gorkiy",
      nameLatin: "Gorky",
      power: 8104472,
      language: "en",
      nameEnglish: "Gorky",
      canonical: "008_104_472-Gorky-Gorkiy.webp",
    });
    expect(outcome.warn).toBeUndefined();
    expect(outcome.log).toContain("[LLM]");
  });

  it("throws after exhausting attempts", async () => {
    const extract = vi.fn(async () => {
      throw new Error("LM Studio down");
    });
    const strategy = strategyFor("screenshot", extract, { attempts: 2 });

    await expect(
      strategy.extract({ filePath, basename, folderAbs, entries: {} }),
    ).rejects.toThrow("LM Studio down");
    expect(extract).toHaveBeenCalledTimes(2);
  });

  it("warns below the low-power threshold but still returns the record", async () => {
    const extract = vi.fn(async () => ({
      name: "HuN",
      nameLatin: "HuN",
      power: 12,
    }));
    const strategy = strategyFor("crops", extract);

    const outcome = await strategy.extract({ filePath, basename, folderAbs, entries: {} });
    expect(outcome.record.power).toBe(12);
    expect(outcome.warn).toContain("LOW power=12");
  });

  it("uses nameLatin for crops filenames and rejects empty names", async () => {
    const ok = strategyFor(
      "crops",
      vi.fn(async () => ({ name: "Горький", nameLatin: "Gorkiy", power: 8104472 })),
    );
    const outcome = await ok.extract({ filePath, basename, folderAbs, entries: {} });
    expect(outcome.record.canonical).toBe("008_104_472-Gorkiy.webp");
    expect(outcome.record).not.toHaveProperty("nameEnglish");

    const empty = strategyFor(
      "crops",
      vi.fn(async () => ({ name: "   ", nameLatin: "", power: 5 })),
    );
    await expect(
      empty.extract({ filePath, basename, folderAbs, entries: {} }),
    ).rejects.toThrow("name or nameLatin");
  });

  it("rejects results without power or name", async () => {
    const strategy = strategyFor("screenshot", vi.fn(async () => ({ power: 5 })));
    await expect(
      strategy.extract({ filePath, basename, folderAbs, entries: {} }),
    ).rejects.toThrow("power and name");
  });
});
