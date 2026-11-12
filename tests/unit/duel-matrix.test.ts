import { describe, expect, it } from "vitest";
import { parseArgs, splitVsParts } from "../../scripts/generate-wiki-matrix.mjs";

describe("splitVsParts", () => {
  it("splits the stem into clan and enemy sides", () => {
    expect(splitVsParts("006_498_473-Kenny_G#006_285_941", "#")).toEqual({
      clan: "006_498_473-Kenny_G",
      enemy: "006_285_941",
      left: "006_498_473-Kenny_G",
      right: "006_285_941",
    });
  });

  it("supports a custom separator", () => {
    expect(splitVsParts("A_vs_B", "_vs_")?.clan).toBe("A");
    expect(splitVsParts("A_vs_B", "_vs_")?.enemy).toBe("B");
  });

  it("rejects stems without a valid two-sided split", () => {
    expect(splitVsParts("006_498_473-Kenny_G", "#")).toBeUndefined();
    expect(splitVsParts("#abc", "#")).toBeUndefined();
    expect(splitVsParts("abc#", "#")).toBeUndefined();
    expect(splitVsParts("a#b#c", "#")).toBeUndefined();
  });
});

describe("parseArgs", () => {
  it("returns the documented defaults", () => {
    expect(parseArgs([])).toEqual({
      folder: undefined,
      separator: "#",
      rows: "desc",
      cols: "desc",
      scale: undefined,
      width: undefined,
      height: undefined,
      frame: true,
      maxHeight: "90vh",
      rowScroll: true,
      compact: false,
      slider: true,
      view: "both",
      extensions: [".jpg", ".png", ".webp"],
    });
  });

  it("takes the first positional as folder and the rest as extensions", () => {
    const args = parseArgs(["data/clan_clash/2026-10-30/duels", "jpg", "png"]);
    expect(args.folder).toBe("data/clan_clash/2026-10-30/duels");
    expect(args.extensions).toEqual([".jpg", ".png"]);
  });

  it("toggles pass-through boolean flags", () => {
    expect(parseArgs(["--compact"]).compact).toBe(true);
    expect(parseArgs(["--compact", "--no-compact"]).compact).toBe(false);
    expect(parseArgs(["--no-slider"]).slider).toBe(false);
    expect(parseArgs(["--no-slider", "--slider"]).slider).toBe(true);
    expect(parseArgs(["--single-table"]).rowScroll).toBe(false);
    expect(parseArgs(["--single-table", "--row-scroll"]).rowScroll).toBe(true);
    expect(parseArgs(["--no-frame"]).frame).toBe(false);
    expect(parseArgs(["--frame=false"]).frame).toBe(false);
    expect(parseArgs(["--frame=true"]).frame).toBe(true);
  });

  it("parses the explicit pass-through combination", () => {
    const args = parseArgs(["folder", "--compact", "--no-slider", "webp"]);
    expect(args.folder).toBe("folder");
    expect(args.compact).toBe(true);
    expect(args.slider).toBe(false);
    expect(args.extensions).toEqual([".webp"]);
  });

  it("parses view, separator and sort options", () => {
    expect(parseArgs(["--view", "enemy"]).view).toBe("enemy");
    expect(parseArgs(["--view=clan"]).view).toBe("clan");
    expect(parseArgs(["--separator", "_vs_"]).separator).toBe("_vs_");
    expect(parseArgs(["--separator=_vs_"]).separator).toBe("_vs_");
    expect(parseArgs(["--rows", "asc"]).rows).toBe("asc");
    expect(parseArgs(["--cols=asc"]).cols).toBe("asc");
  });

  it("parses scale and dimension options", () => {
    expect(parseArgs(["--scale", "50"]).scale).toBe(50);
    expect(parseArgs(["--scale=50%"]).scale).toBe(50);
    expect(parseArgs(["--scale", "0.5"]).scale).toBe(50);
    expect(parseArgs(["-p", "25"]).scale).toBe(25);
    expect(parseArgs(["--width", "300"]).width).toEqual({ value: 300, isPercent: false });
    expect(parseArgs(["--width=50%"]).width).toEqual({ value: 50, isPercent: true });
    expect(parseArgs(["-w", "300px"]).width).toEqual({ value: 300, isPercent: false });
    expect(parseArgs(["-h", "600"]).height).toEqual({ value: 600, isPercent: false });
    expect(parseArgs(["--max-height", "none"]).maxHeight).toBe("none");
  });

  it("ignores unknown flags instead of treating them as paths", () => {
    const args = parseArgs(["folder", "--bogus"]);
    expect(args.folder).toBe("folder");
    expect(args.extensions).toEqual([".jpg", ".png", ".webp"]);
  });

  it("rejects invalid values", () => {
    expect(() => parseArgs(["--rows", "sideways"])).toThrow("Invalid sort direction");
    expect(() => parseArgs(["--scale", "0"])).toThrow("Invalid scale");
    expect(() => parseArgs(["--width", "nope"])).toThrow("Invalid width");
    expect(() => parseArgs(["--height=0"])).toThrow("Invalid height");
  });
});
