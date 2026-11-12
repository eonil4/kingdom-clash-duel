import { describe, expect, it, vi } from "vitest";
import path from "path";
import { createOcrStrategy } from "../../scripts/pipeline/ocr-strategy.mjs";
import { WORKSPACE_ROOT } from "../../scripts/file-map-enemies.mjs";

function fakeWorker() {
  return {
    setParameters: vi.fn(async () => {}),
    terminate: vi.fn(async () => {}),
  };
}

function makeDeps(overrides: Record<string, unknown> = {}) {
  const worker = fakeWorker();
  const workerRus = fakeWorker();
  const deps = {
    createWorker: vi.fn(async (lang: string) => (lang === "rus" ? workerRus : worker)),
    ocrName: vi.fn(async () => "Горький"),
    refineName: vi.fn(async (_folder: string, _file: string, name: string) => name),
    ocrPower: vi.fn(async () => 576),
    parsePowerFromFilename: vi.fn(() => 8104472),
    parseHint: vi.fn(() => undefined),
    ...overrides,
  };
  return { worker, workerRus, deps };
}

const folderAbs = path.join(WORKSPACE_ROOT, "data", "clan_clash", "2026-11-06");
const filePath = path.join(folderAbs, "Screenshot_x.png");
const basename = "Screenshot_x.png";

describe("createOcrStrategy", () => {
  it("creates both workers in prepare and terminates them in dispose", async () => {
    const { worker, workerRus, deps } = makeDeps();
    const strategy = createOcrStrategy({ deps });

    await strategy.prepare();
    expect(deps.createWorker).toHaveBeenCalledWith("eng+rus");
    expect(deps.createWorker).toHaveBeenCalledWith("rus");
    expect(worker.setParameters).toHaveBeenCalledWith({ preserve_interword_spaces: "1" });
    expect(workerRus.setParameters).toHaveBeenCalledWith({ preserve_interword_spaces: "1" });

    await strategy.dispose();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(workerRus.terminate).toHaveBeenCalledTimes(1);
  });

  it("disposes the first worker when the second cannot be created", async () => {
    const first = fakeWorker();
    let calls = 0;
    const deps = {
      ...makeDeps().deps,
      createWorker: vi.fn(async () => {
        calls += 1;
        if (calls === 2) throw new Error("no rus model");
        return first;
      }),
    };

    const strategy = createOcrStrategy({ deps });
    await expect(strategy.prepare()).rejects.toThrow("no rus model");
    expect(first.terminate).toHaveBeenCalledTimes(1);
  });

  it("skips recorded and already-canonical sources unless forced", async () => {
    const { deps } = makeDeps();
    const strategy = createOcrStrategy({ deps });

    expect(
      await strategy.shouldSkip({ filePath, basename, folderAbs, entries: { [basename]: {} } }),
    ).toContain("Skipping OCR for recorded image");
    expect(
      await strategy.shouldSkip({
        filePath,
        basename: "001_234_567-Name.webp",
        folderAbs,
        entries: {},
      }),
    ).toContain("Skipping OCR for canonical .webp file");
    expect(await strategy.shouldSkip({ filePath, basename, folderAbs, entries: {} })).toBeUndefined();

    const forced = createOcrStrategy({ force: true, deps });
    expect(
      await forced.shouldSkip({ filePath, basename, folderAbs, entries: { [basename]: {} } }),
    ).toBeUndefined();
  });

  it("prefers filename power and warns on mismatch", async () => {
    const { deps } = makeDeps();
    const strategy = createOcrStrategy({ deps });
    await strategy.prepare();

    const outcome = await strategy.extract({ filePath, basename, folderAbs, entries: {} });
    expect(outcome).toMatchObject({
      record: {
        name: "Горький",
        nameLatin: "Gorkiy",
        power: 8104472,
        language: null,
        canonical: "008_104_472-Gorkiy.webp",
      },
    });
    expect(outcome.warn).toContain("Using filename power 8104472 (OCR said 576)");
    expect(outcome.log).toContain("OK:");
  });

  it("falls back to OCR power when the filename has none", async () => {
    const { deps } = makeDeps({ parsePowerFromFilename: vi.fn(() => undefined) });
    const strategy = createOcrStrategy({ deps });
    await strategy.prepare();

    const outcome = await strategy.extract({ filePath, basename, folderAbs, entries: {} });
    expect(outcome.record.power).toBe(576);
    expect(outcome.warn).toBeUndefined();
  });

  it("returns a skip (not a failure) when name and power are missing", async () => {
    const { deps } = makeDeps({
      parsePowerFromFilename: vi.fn(() => undefined),
      ocrPower: vi.fn(async () => undefined),
      ocrName: vi.fn(async () => ""),
      refineName: vi.fn(async () => ""),
    });
    const strategy = createOcrStrategy({ deps });
    await strategy.prepare();

    const outcome = await strategy.extract({ filePath, basename, folderAbs, entries: {} });
    expect(outcome).toMatchObject({ skip: true });
    expect(outcome.reason).toContain("OCR incomplete");
  });

  it("uses percent-encoded filename hints for the Latin label", async () => {
    const { deps } = makeDeps({
      parsePowerFromFilename: vi.fn(() => 1),
      ocrName: vi.fn(async () => ""),
      refineName: vi.fn(async () => ""),
      parseHint: vi.fn(() => String.raw`Babka\MAG`),
    });
    const strategy = createOcrStrategy({ deps });
    await strategy.prepare();

    const outcome = await strategy.extract({
      filePath,
      basename: "000_000_001-Babka%5CMAG.png",
      folderAbs,
      entries: {},
    });
    expect(outcome.record.nameLatin).toBe(String.raw`Babka\MAG`);
    expect(outcome.record.canonical).toBe("000_000_001-Babka%5CMAG.webp");
  });
});
