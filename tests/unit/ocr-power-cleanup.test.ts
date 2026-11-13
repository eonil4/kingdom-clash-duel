import { describe, expect, it } from "vitest";
import { cleanupPower } from "../../scripts/ocr/ocr-enemy-power.mjs";

describe("cleanupPower", () => {
  it("joins grouped digit runs", () => {
    expect(cleanupPower("8 104 472")).toBe(8104472);
    expect(cleanupPower("8_104_472")).toBe(8104472);
  });

  it("takes the longest numeric chunk when ungrouped", () => {
    expect(cleanupPower("LV abc 8104472")).toBe(8104472);
    expect(cleanupPower("x12y345z")).toBe(345);
  });

  it("strips surrounding noise as a last resort", () => {
    expect(cleanupPower("~8104472~")).toBe(8104472);
  });

  it("returns undefined when there are no digits", () => {
    expect(cleanupPower("")).toBeUndefined();
    expect(cleanupPower("no digits")).toBeUndefined();
    expect(cleanupPower(undefined as unknown as string)).toBeUndefined();
  });
});
