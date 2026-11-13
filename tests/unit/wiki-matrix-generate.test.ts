import { afterEach, describe, expect, it } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import sharp from "sharp";
import {
  formatDim,
  parseArgs,
  parseDimension,
  parseExtensions,
  parseScalePercent,
  parseSortDir,
  resolveFolderPaths,
  runMatrixGenerator,
} from "../../scripts/generate-wiki-matrix.mjs";
import { WORKSPACE_ROOT } from "../../scripts/enemy-records.mjs";

sharp.cache(false);

const dirs: string[] = [];

async function tmpDir() {
  const dir = await fs.mkdtemp(path.join(WORKSPACE_ROOT, ".tmp-matrix-"));
  dirs.push(dir);
  return dir;
}

async function tinyImage(file: string) {
  await sharp({ create: { width: 20, height: 10, channels: 3, background: "#000" } })
    .png()
    .toFile(file);
}

async function sampleFolder() {
  const dir = await tmpDir();
  await tinyImage(path.join(dir, "Alfa#Beta.png"));
  await tinyImage(path.join(dir, "Alfa#Gamma.webp"));
  await tinyImage(path.join(dir, "Alfa#Beta.jpg"));
  await fs.writeFile(path.join(dir, "nosep.png"), "");
  await fs.writeFile(path.join(dir, "notes.txt"), "");
  return dir;
}

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

describe("matrix option parsers", () => {
  it("parses sort directions", () => {
    expect(parseSortDir("")).toBe("desc");
    expect(parseSortDir("asc")).toBe("asc");
    expect(() => parseSortDir("sideways")).toThrow("Invalid sort direction");
  });

  it("parses scales and dimensions", () => {
    expect(parseScalePercent(undefined)).toBeUndefined();
    expect(parseScalePercent("50%")).toBe(50);
    expect(parseScalePercent("0.5")).toBe(50);
    expect(parseScalePercent("0.5%")).toBe(0.5);
    expect(() => parseScalePercent("0")).toThrow("Invalid scale");
    expect(parseDimension("300px", "width")).toEqual({ value: 300, isPercent: false });
    expect(parseDimension("50%", "height")).toEqual({ value: 50, isPercent: true });
    expect(() => parseDimension("-5", "width")).toThrow("Invalid width");
    expect(formatDim({ value: 300, isPercent: false })).toBe("300px");
    expect(formatDim({ value: 50, isPercent: true })).toBe("50%");
    expect(formatDim(undefined)).toBe("");
  });

  it("parses extension lists", () => {
    expect(parseExtensions("")).toEqual([".jpg", ".png", ".webp"]);
    expect(parseExtensions("png")).toEqual([".png"]);
    expect(parseExtensions("(.jpg|png)")).toEqual([".jpg", ".png"]);
    expect(parseExtensions("jpg,png")).toEqual([".jpg", ".png"]);
  });

  it("rejects folders outside the workspace", () => {
    expect(() => resolveFolderPaths(os.tmpdir())).toThrow("inside the workspace root");
  });
});

describe("runMatrixGenerator", () => {
  it("renders both sections in row-scroll mode with the zoom toolbar", async () => {
    const dir = await sampleFolder();
    const result = await runMatrixGenerator(parseArgs([dir]));

    expect(result.empty).toBeUndefined();
    expect(result.sections).toEqual(["Enemies", "Clan"]);
    expect(result.enemies).toBe(2);
    expect(result.clans).toBe(1);
    expect(result.totalDuels).toBe(3);
    expect(result.skipped).toBe(1);
    expect(result.initialPercent).toBe(100);

    const html = await fs.readFile(result.outputPath, "utf8");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<h2>Enemies</h2>");
    expect(html).toContain("<h2>Clan</h2>");
    expect(html).toContain('id="zoom-toolbar"');
    expect(html).toContain('id="row-alfa"');
    expect(html).toContain("data-orig-w");
    expect(html).toContain("Alfa%23Beta");
  });

  it("renders a single table with and without the frame", async () => {
    const dir = await sampleFolder();
    const framed = await runMatrixGenerator(parseArgs([dir, "--single-table", "--no-slider"]));
    expect(framed.html).not.toContain("zoom-toolbar");
    expect(framed.html).toContain('scope="row"');
    expect(framed.html).toContain("max-height: 90vh;");

    const unframed = await runMatrixGenerator(
      parseArgs([dir, "--single-table", "--no-slider", "--no-frame"]),
    );
    expect(unframed.html).not.toContain("max-height: 90vh;");
  });

  it("covers compact rows, max-height and a clan-only view", async () => {
    const dir = await sampleFolder();
    const compact = await runMatrixGenerator(
      parseArgs([dir, "--compact", "--view", "clan"]),
    );
    expect(compact.sections).toEqual(["Clan"]);
    expect(compact.html).toContain("<h2>Clan</h2>");
    expect(compact.html).not.toContain("<h2>Enemies</h2>");

    const sized = await runMatrixGenerator(
      parseArgs([dir, "--single-table", "--max-height", "300px"]),
    );
    expect(sized.html).toContain("max-height: 300px;");
  });

  it("derives the initial zoom from width, height and scale", async () => {
    const dir = await sampleFolder();
    const byWidth = await runMatrixGenerator(parseArgs([dir, "--width", "10px"]));
    expect(byWidth.initialPercent).toBe(50);
    const byHeight = await runMatrixGenerator(parseArgs([dir, "--height", "5px"]));
    expect(byHeight.initialPercent).toBe(50);
    const byScale = await runMatrixGenerator(parseArgs([dir, "--scale", "40%"]));
    expect(byScale.initialPercent).toBe(40);
    expect(byWidth.html).toContain("Reset (50%)");
  });

  it("reports an empty result when no file matches the separator", async () => {
    const dir = await tmpDir();
    await fs.writeFile(path.join(dir, "noduel.png"), "");
    const result = await runMatrixGenerator(parseArgs([dir]));
    expect(result).toEqual({ empty: true, targetFolder: dir });
  });
});
