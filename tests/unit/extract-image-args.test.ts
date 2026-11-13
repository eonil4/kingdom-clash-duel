import { afterEach, describe, expect, it } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import sharp from "sharp";
import { parseArgs, runExtractImage } from "../../scripts/extract_image.mjs";
import { UsageError } from "../../scripts/cli.mjs";

sharp.cache(false);

const dirs: string[] = [];

async function tmpDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kc-extract-"));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

describe("extract_image parseArgs", () => {
  it("parses input/output and integer coordinates", () => {
    expect(parseArgs(["in.png", "out.png", "10", "20", "30", "40"])).toEqual({
      input: "in.png",
      output: "out.png",
      left: 10,
      top: 20,
      width: 30,
      height: 40,
    });
    expect(parseArgs(["i", "o", "0", "0", "1", "1"]).left).toBe(0);
  });

  it("rejects negative or non-integer coordinates with a UsageError", () => {
    expect(() => parseArgs(["i", "o", "-1", "0", "1", "1"])).toThrow(UsageError);
    expect(() => parseArgs(["i", "o", "-1", "0", "1", "1"])).toThrow("Invalid position_x");
    expect(() => parseArgs(["i", "o", "1.5", "0", "1", "1"])).toThrow("Invalid position_x");
    expect(() => parseArgs(["i", "o", "a", "0", "1", "1"])).toThrow("Invalid position_x");
  });

  it("rejects zero width or height", () => {
    expect(() => parseArgs(["i", "o", "0", "0", "0", "1"])).toThrow(
      "width and height must be greater than 0",
    );
    expect(() => parseArgs(["i", "o", "0", "0", "1", "0"])).toThrow(
      "width and height must be greater than 0",
    );
  });

  it("requires all six arguments", () => {
    expect(() => parseArgs(["only-input"])).toThrow(UsageError);
    expect(() => parseArgs(["only-input"])).toThrow("Missing arguments");
  });
});

describe("runExtractImage", () => {
  async function samplePng(dir: string) {
    const input = path.join(dir, "in.png");
    await sharp({ create: { width: 100, height: 80, channels: 3, background: "#000" } })
      .png()
      .toFile(input);
    return input;
  }

  it("crops to the requested region and writes the output", async () => {
    const dir = await tmpDir();
    const input = await samplePng(dir);
    const output = path.join(dir, "nested", "out.png");
    const logs: string[] = [];

    const result = await runExtractImage(
      [input, output, "10", "10", "30", "20"],
      { log: (line) => logs.push(String(line)) },
    );

    expect(result.outputAbs).toBe(output);
    expect(result.meta).toMatchObject({ width: 100, height: 80 });
    expect((await sharp(output).metadata()).width).toBe(30);
    expect(logs.join("\n")).toContain("Extracted 30x20 at (10,10)");
  });

  it("rejects missing inputs and out-of-bounds crops", async () => {
    const dir = await tmpDir();
    const input = await samplePng(dir);
    await expect(
      runExtractImage([path.join(dir, "missing.png"), path.join(dir, "o.png"), "0", "0", "1", "1"]),
    ).rejects.toThrow("Input image not found");
    await expect(
      runExtractImage([input, path.join(dir, "o.png"), "90", "0", "30", "10"]),
    ).rejects.toThrow("Crop out of bounds");
    await expect(
      runExtractImage([input, path.join(dir, "o.png"), "0", "70", "10", "20"]),
    ).rejects.toThrow("Crop out of bounds");
  });
});
