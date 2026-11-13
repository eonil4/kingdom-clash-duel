/**
 * Crop-ROI helpers shared by the LLM and OCR extraction paths.
 *
 * `config/llm.json` stores pixel ROIs authored against `roiReference`
 * (currently 900x1600). Every consumer scales them to the actual image so the
 * LLM crops and the OCR crops use the same regions.
 */

/**
 * @param {unknown} config
 * @returns {{ width: number, height: number } | undefined}
 */
export function resolveRoiReference(config) {
  const ref = /** @type {any} */ (config)?.roiReference;
  const width = Number(ref?.width);
  const height = Number(ref?.height);
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    return { width, height };
  }
  return undefined;
}

/**
 * @param {unknown} roi
 * @returns {{ x: number, y: number, width: number, height: number } | undefined}
 */
export function normalizeRoi(roi) {
  if (!roi || typeof roi !== "object") return undefined;
  const src = /** @type {any} */ (roi);
  const x = Number(src.x);
  const y = Number(src.y);
  const width = Number(src.width ?? src.w);
  const height = Number(src.height ?? src.h);
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    return undefined;
  }
  return { x, y, width, height };
}

/**
 * Scale a reference-pixel ROI to the given image size.
 * @param {unknown} roi
 * @param {{ width?: number, height?: number }} meta
 * @param {{ width: number, height: number } | undefined} reference
 */
export function scaleRoiToImage(roi, meta, reference) {
  const base = normalizeRoi(roi);
  if (!base || !meta?.width || !meta?.height) return undefined;
  const sx = reference ? meta.width / reference.width : 1;
  const sy = reference ? meta.height / reference.height : 1;
  return {
    x: Math.round(base.x * sx),
    y: Math.round(base.y * sy),
    width: Math.max(1, Math.round(base.width * sx)),
    height: Math.max(1, Math.round(base.height * sy)),
  };
}

/**
 * @param {unknown} raw
 * @param {{ prompt: string, roi: { x: number, y: number, width: number, height: number } }} fallback
 * @returns {{ prompt: string, roi: { x: number, y: number, width: number, height: number } }}
 */
function normalizeCropConfig(raw, fallback) {
  if (typeof raw === "string" && raw.trim()) {
    return { prompt: raw.trim(), roi: { ...fallback.roi } };
  }

  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const src = /** @type {any} */ (raw);
    const prompt =
      typeof src.prompt === "string" && src.prompt.trim() ? src.prompt.trim() : fallback.prompt;
    const roi = normalizeRoi(src.roi && typeof src.roi === "object" ? src.roi : src);
    return { prompt, roi: roi ?? { ...fallback.roi } };
  }

  return { prompt: fallback.prompt, roi: { ...fallback.roi } };
}

/**
 * @param {unknown} userPrompt config.userPrompt
 * @param {"enemy" | "clan"} targetKey
 * @param {"name" | "power"} kind
 * @param {{ prompt: string, roi: { x: number, y: number, width: number, height: number } }} fallback
 */
export function resolveCropConfig(userPrompt, targetKey, kind, fallback) {
  if (!userPrompt || typeof userPrompt !== "object" || Array.isArray(userPrompt)) {
    return { prompt: fallback.prompt, roi: { ...fallback.roi } };
  }

  const up = /** @type {any} */ (userPrompt);
  const nested =
    up.image &&
    typeof up.image === "object" &&
    !Array.isArray(up.image) &&
    up.image[targetKey] &&
    typeof up.image[targetKey] === "object" &&
    !Array.isArray(up.image[targetKey])
      ? up.image[targetKey][kind]
      : undefined;

  if (nested !== undefined) {
    return normalizeCropConfig(nested, fallback);
  }

  // Legacy dotted keys: "image.enemy.name" / "image.clan.power"
  return normalizeCropConfig(up[`image.${targetKey}.${kind}`], fallback);
}
