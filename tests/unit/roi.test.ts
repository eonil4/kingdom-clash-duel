import { afterEach, describe, expect, it } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import sharp from "sharp";
import {
  normalizeRoi,
  resolveCropConfig,
  resolveRoiReference,
  scaleRoiToImage,
} from "../../scripts/roi.mjs";
import { buildNameBoxes, buildPowerBox } from "../../scripts/ocr/ocr-enemy-crops.mjs";
import { cropRoiToPngBuffer } from "../../scripts/llm/vision-client.mjs";

const dirs: string[] = [];

async function tmpImage(width: number, height: number) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kc-roi-"));
  dirs.push(dir);
  const file = path.join(dir, "shot.png");
  await sharp({
    create: { width, height, channels: 3, background: { r: 20, g: 40, b: 60 } },
  })
    .png()
    .toFile(file);
  return file;
}

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

const REFERENCE = { width: 900, height: 1600 };
const NAME_ROI = { x: 486, y: 118, width: 290, height: 36 };
const POWER_ROI = { x: 666, y: 234, width: 162, height: 24 };

describe("resolveRoiReference", () => {
  it("reads positive width/height and rejects the rest", () => {
    expect(resolveRoiReference({ roiReference: REFERENCE })).toEqual(REFERENCE);
    expect(resolveRoiReference({ roiReference: { width: 0, height: 10 } })).toBeUndefined();
    expect(resolveRoiReference({ roiReference: { width: "900", height: "1600" } })).toEqual(
      REFERENCE,
    );
    expect(resolveRoiReference({})).toBeUndefined();
    expect(resolveRoiReference(undefined)).toBeUndefined();
  });
});

describe("scaleRoiToImage", () => {
  it("scales reference pixels to the image size", () => {
    expect(scaleRoiToImage(NAME_ROI, REFERENCE, REFERENCE)).toEqual(NAME_ROI);
    expect(scaleRoiToImage(NAME_ROI, { width: 1800, height: 3200 }, REFERENCE)).toEqual({
      x: 972,
      y: 236,
      width: 580,
      height: 72,
    });
  });

  it("keeps raw pixels without a reference or metadata", () => {
    expect(scaleRoiToImage(NAME_ROI, REFERENCE, undefined)).toEqual(NAME_ROI);
    expect(scaleRoiToImage(NAME_ROI, {}, REFERENCE)).toBeUndefined();
  });

  it("rejects invalid ROIs", () => {
    expect(normalizeRoi({ x: 1, y: 2, width: 0, height: 4 })).toBeUndefined();
    expect(scaleRoiToImage({ x: "a" }, REFERENCE, REFERENCE)).toBeUndefined();
  });
});

describe("resolveCropConfig", () => {
  const userPrompt = {
    image: {
      enemy: {
        name: { prompt: "name prompt", roi: NAME_ROI },
      },
    },
    "image.enemy.power": { prompt: "legacy power", roi: POWER_ROI },
  };
  const fallback = { prompt: "fallback", roi: NAME_ROI };

  it("reads nested and legacy dotted configs", () => {
    const nameCfg = resolveCropConfig(userPrompt, "enemy", "name", fallback);
    expect(nameCfg).toEqual({ prompt: "name prompt", roi: NAME_ROI });

    const powerCfg = resolveCropConfig(userPrompt, "enemy", "power", fallback);
    expect(powerCfg).toEqual({ prompt: "legacy power", roi: POWER_ROI });
  });

  it("falls back when the config is missing", () => {
    expect(resolveCropConfig(undefined, "enemy", "name", fallback)).toEqual(fallback);
    expect(resolveCropConfig({ image: {} }, "clan", "name", fallback)).toEqual(fallback);
  });
});

describe("OCR crop boxes from configured ROIs", () => {
  it("anchors name variants to the configured box", () => {
    const boxes = buildNameBoxes(REFERENCE, NAME_ROI, REFERENCE);
    expect(boxes?.name).toEqual({ left: 486, top: 118, width: 290, height: 36 });

    const wide = boxes?.wide;
    expect(wide?.left).toBeLessThan(486);
    expect(wide?.top).toBeLessThan(118);
    expect((wide?.width ?? 0) > 290).toBe(true);
    expect((wide?.height ?? 0) > 36).toBe(true);

    const line = boxes?.textLine;
    expect(line?.left).toBe(486);
    expect(line?.width).toBe(290);
    expect(line?.top).toBeGreaterThanOrEqual(118);
    expect((line?.top ?? 0) + (line?.height ?? 0)).toBeLessThanOrEqual(118 + 36);
  });

  it("uses tighter variants for the clan/formation style", () => {
    const arena = buildNameBoxes(REFERENCE, NAME_ROI, REFERENCE);
    const tight = buildNameBoxes(REFERENCE, NAME_ROI, REFERENCE, { style: "tight" });
    // tight style pads the configured box a few pixels for tesseract
    expect(tight?.name).toEqual({ left: 482, top: 115, width: 298, height: 42 });
    expect((tight?.wide?.width ?? 0) < (arena?.wide?.width ?? 0)).toBe(true);
    expect((tight?.wide?.height ?? 0) < (arena?.wide?.height ?? 0)).toBe(true);
  });

  it("scales and clamps to the image", () => {
    expect(buildNameBoxes({ width: 1800, height: 3200 }, NAME_ROI, REFERENCE)?.name).toEqual({
      left: 972,
      top: 236,
      width: 580,
      height: 72,
    });
    expect(buildPowerBox(REFERENCE, POWER_ROI, REFERENCE)).toEqual({
      left: 666,
      top: 234,
      width: 162,
      height: 24,
    });

    const atEdge = buildPowerBox({ width: 900, height: 1600 }, { x: 850, y: 1590, width: 100, height: 30 }, REFERENCE);
    expect(atEdge?.width).toBe(50);
    expect(atEdge?.height).toBe(10);
  });

  it("returns undefined for unusable ROIs", () => {
    expect(buildNameBoxes(REFERENCE, { x: 0, y: 0, width: 0, height: 0 }, REFERENCE)).toBeUndefined();
  });
});

describe("cropRoiToPngBuffer scaling", () => {
  it("keeps 1:1 crops at the reference size", async () => {
    const file = await tmpImage(900, 1600);
    const buffer = await cropRoiToPngBuffer(file, NAME_ROI);
    const meta = await sharp(buffer).metadata();
    expect({ width: meta.width, height: meta.height }).toEqual({ width: 290, height: 36 });
  });

  it("scales config ROIs for larger screenshots", async () => {
    const file = await tmpImage(1800, 3200);
    const buffer = await cropRoiToPngBuffer(file, NAME_ROI);
    const meta = await sharp(buffer).metadata();
    expect({ width: meta.width, height: meta.height }).toEqual({ width: 580, height: 72 });
  });
});
