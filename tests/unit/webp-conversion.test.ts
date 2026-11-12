import { it, expect } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import sharp from "sharp";
import { writeWebpFromRasterFile } from "../../scripts/llm/enemy-image-webp.mjs";

// libvips keeps output files cached/open on Windows when cache is enabled.
sharp.cache(false);

// Windows keeps a handle on the libvips output briefly after metadata reads.
async function rmWithRetry(target: string) {
  for (let i = 0; ; i++) {
    try {
      await fs.rm(target, { recursive: true, force: true });
      return;
    } catch (err) {
      if (i >= 9) throw err;
      await new Promise((resolve) => setTimeout(resolve, 40 * (i + 1)));
    }
  }
}

it("converts a raster to webp and preserves dimensions", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kc-webp-"));
  try {
    const src = path.join(dir, "in.png");
    const out = path.join(dir, "out.webp");
    await sharp({
      create: {
        width: 64,
        height: 32,
        channels: 3,
        background: { r: 10, g: 20, b: 30 },
      },
    })
      .png()
      .toFile(src);

    await writeWebpFromRasterFile(src, out);

    const meta = await sharp(await fs.readFile(out)).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.width).toBe(64);
    expect(meta.height).toBe(32);
  } finally {
    await rmWithRetry(dir);
  }
});
