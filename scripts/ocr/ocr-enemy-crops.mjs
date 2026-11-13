/** Normalized crop rectangles — fallback when config/llm.json has no ROI. */
import { scaleRoiToImage } from "../roi.mjs";

export const NAME_BOX = { x: 0.68, y: 0.0, w: 0.30, h: 0.09 };
export const NAME_BOX_WIDE = { x: 0.60, y: 0.0, w: 0.38, h: 0.11 };
export const NAME_TEXT_BOX = { x: 0.58, y: 0.018, w: 0.40, h: 0.08 };
export const NAME_TEXT_LINE_BOX = { x: 0.62, y: 0.038, w: 0.36, h: 0.048 };
export const POWER_BOX = { x: 0.67, y: 0.14, w: 0.30, h: 0.06 };

export function cropBoxFromPercent(meta, box) {
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  const left = Math.max(0, Math.floor(w * box.x));
  const top = Math.max(0, Math.floor(h * box.y));
  const width = Math.max(1, Math.floor(w * box.w));
  const height = Math.max(1, Math.floor(h * box.h));

  return {
    left,
    top,
    width: Math.min(width, w - left),
    height: Math.min(height, h - top),
  };
}

/**
 * @param {{ width: number, height: number }} meta
 * @param {{ left: number, top: number, width: number, height: number }} box
 */
function clampPixelBox(meta, box) {
  const left = Math.max(0, Math.min(Math.round(box.left), meta.width - 1));
  const top = Math.max(0, Math.min(Math.round(box.top), meta.height - 1));
  const width = Math.max(1, Math.min(Math.round(box.width), meta.width - left));
  const height = Math.max(1, Math.min(Math.round(box.height), meta.height - top));
  return { left, top, width, height };
}

/**
 * @param {{ x: number, y: number, width: number, height: number }} box
 * @param {number} fx horizontal growth as a fraction of the box width
 * @param {number} fy vertical growth as a fraction of the box height
 */
function growBox(box, fx, fy) {
  const dx = Math.round(box.width * fx);
  const dy = Math.round(box.height * fy);
  return {
    left: box.x - dx,
    top: box.y - dy,
    width: box.width + 2 * dx,
    height: box.height + 2 * dy,
  };
}

/**
 * Name crop variants anchored to the configured ROI (reference pixels).
 * Variants are expansions/insets of that ROI so OCR and the LLM crops read the
 * same region instead of unrelated hardcoded fractions.
 *
 * @param {{ width: number, height: number }} meta
 * @param {{ x: number, y: number, width: number, height: number }} roi
 * @param {{ width: number, height: number } | undefined} reference
 * @param {{ style?: "arena" | "tight" }} [options]
 */
export function buildNameBoxes(meta, roi, reference, { style = "arena" } = {}) {
  const scaled = scaleRoiToImage(roi, meta, reference);
  if (!scaled) return undefined;
  // "tight" (formation screens) avoids pulling neighbouring UI labels into the crops;
  // a few pixels of padding help tesseract with stylised formation fonts.
  const pad = style === "tight" ? { x: 4, y: 3 } : { x: 0, y: 0 };
  const base = {
    x: scaled.x - pad.x,
    y: scaled.y - pad.y,
    width: scaled.width + 2 * pad.x,
    height: scaled.height + 2 * pad.y,
  };
  const wideGrow = style === "tight" ? [0.03, 0.05] : [0.15, 0.3];
  const textGrow = style === "tight" ? [0.0, 0.02] : [0.03, 0.08];
  return {
    name: clampPixelBox(meta, { left: base.x, top: base.y, width: base.width, height: base.height }),
    wide: clampPixelBox(meta, growBox(base, wideGrow[0], wideGrow[1])),
    text: clampPixelBox(meta, growBox(base, textGrow[0], textGrow[1])),
    textLine: clampPixelBox(meta, {
      left: base.x,
      top: base.y + Math.round(base.height * 0.15),
      width: base.width,
      height: Math.max(1, Math.round(base.height * 0.7)),
    }),
  };
}

/**
 * @param {{ width: number, height: number }} meta
 * @param {{ x: number, y: number, width: number, height: number }} roi
 * @param {{ width: number, height: number } | undefined} reference
 */
export function buildPowerBox(meta, roi, reference) {
  const base = scaleRoiToImage(roi, meta, reference);
  if (!base) return undefined;
  return clampPixelBox(meta, { left: base.x, top: base.y, width: base.width, height: base.height });
}

export async function preprocessForOcr(img, { threshold, width = 900, negate = false } = {}) {
  let p = img
    .removeAlpha()
    .grayscale()
    .normalise()
    .resize({ width, withoutEnlargement: false })
    .sharpen();
  if (negate) p = p.negate();
  if (typeof threshold === "number") p = p.threshold(threshold);
  return await p.png().toBuffer();
}

export async function preprocessRawForOcr(img, { width = 900 } = {}) {
  return await img.removeAlpha().resize({ width, withoutEnlargement: false }).png().toBuffer();
}

