import { describe, expect, it } from "vitest";
import { parseArgs } from "../../scripts/extract_image.mjs";
import { UsageError } from "../../scripts/cli.mjs";

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
