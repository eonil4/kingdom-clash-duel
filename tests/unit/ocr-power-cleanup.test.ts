import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import sharp from "sharp";
import { cleanupPower, ocrEnemyPower } from "../../scripts/ocr/ocr-enemy-power.mjs";

sharp.cache(false);

const dirs: string[] = [];

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

describe("cleanupPower", () => {
  it("joins grouped digit runs", () => {
    expect(cleanupPower("8 104 472")).toBe(8104472);
    expect(cleanupPower("8_104_472")).toBe(8104472);
  });

  it("takes the longest numeric chunk when ungrouped", () => {
    expect(cleanupPower("LV abc 8104472")).toBe(8104472);
    expect(cleanupPower("x12y345z")).toBe(345);
  });

  it("strips surrounding noise as a last resort", () => {
    expect(cleanupPower("~8104472~")).toBe(8104472);
  });

  it("returns undefined when there are no digits", () => {
    expect(cleanupPower("")).toBeUndefined();
    expect(cleanupPower("no digits")).toBeUndefined();
    expect(cleanupPower(undefined as unknown as string)).toBeUndefined();
  });
});

describe("ocrEnemyPower", () => {
  it("crops, recognizes and parses with a configured ROI", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kc-power-"));
    dirs.push(dir);
    const file = path.join(dir, "shot.png");
    await sharp({ create: { width: 120, height: 240, channels: 3, background: "#111" } })
      .png()
      .toFile(file);
    const worker = {
      setParameters: vi.fn(async () => {}),
      recognize: vi.fn(async () => ({ data: { text: "8 104 472" } })),
    };

    const power = await ocrEnemyPower(file, worker, {
      powerRoi: { x: 10, y: 10, width: 80, height: 40 },
      reference: { width: 900, height: 1600 },
    });

    expect(power).toBe(8104472);
    expect(worker.setParameters).toHaveBeenCalledWith(
      expect.objectContaining({ tessedit_pageseg_mode: "6" }),
    );
  });

  it("falls back to the fractional box without a configured ROI", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kc-power-"));
    dirs.push(dir);
    const file = path.join(dir, "shot.png");
    await sharp({ create: { width: 120, height: 240, channels: 3, background: "#111" } })
      .png()
      .toFile(file);
    const worker = {
      setParameters: vi.fn(async () => {}),
      recognize: vi.fn(async () => ({ data: { text: "" } })),
    };

    expect(await ocrEnemyPower(file, worker)).toBeUndefined();
  });
});
