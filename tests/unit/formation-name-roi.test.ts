import { afterEach, describe, expect, it } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import sharp from "sharp";
import { detectClanNameRoi } from "../../scripts/llm/llm-formation-extract.mjs";

sharp.cache(false);

const dirs: string[] = [];

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

type Box = { x: number; y: number; width: number; height: number };

/** Renders the centered header as dark blocks: arrow, "Player", "formation", name. */
async function headerImage(boxes: Box[]) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kc-formation-roi-"));
  dirs.push(dir);
  const file = path.join(dir, "shot.png");
  const rects = boxes
    .map((b) => `<rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" fill="#333"/>`)
    .join("");
  const svg = `<svg width="900" height="1600" xmlns="http://www.w3.org/2000/svg">
    <rect width="900" height="1600" fill="#e8dcc0"/><g>${rects}</g></svg>`;
  await sharp(Buffer.from(svg)).png().toFile(file);
  return file;
}

const arrow = { x: 56, y: 57, width: 60, height: 48 };

describe("detectClanNameRoi", () => {
  it("starts the crop at the name run for short names", async () => {
    const file = await headerImage([
      arrow,
      { x: 214, y: 57, width: 109, height: 48 },
      { x: 337, y: 57, width: 169, height: 48 },
      { x: 523, y: 57, width: 163, height: 48 },
    ]);

    await expect(detectClanNameRoi(file)).resolves.toEqual({
      x: 517,
      y: 57,
      width: 377,
      height: 48,
    });
  });

  it("follows the name when the centered header shifts left", async () => {
    const file = await headerImage([
      arrow,
      { x: 131, y: 57, width: 109, height: 48 },
      { x: 254, y: 57, width: 169, height: 48 },
      { x: 440, y: 57, width: 160, height: 48 },
    ]);

    await expect(detectClanNameRoi(file)).resolves.toEqual({
      x: 434,
      y: 57,
      width: 460,
      height: 48,
    });
  });

  it("returns undefined when the formation header is absent", async () => {
    const file = await headerImage([]);
    await expect(detectClanNameRoi(file)).resolves.toBeUndefined();
  });
});
