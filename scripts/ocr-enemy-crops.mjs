/** Normalized crop rectangles — biased to top-right opponent (avoid left/player HUD). */
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
