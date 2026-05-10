import { describe, expect, it } from "vitest";
import { parsePowerFromOriginalBasename } from "../../scripts/file-map-enemies.mjs";

describe("parsePowerFromOriginalBasename", () => {
  it("parses XXX_XXX_XXX prefix before first hyphen", () => {
    expect(parsePowerFromOriginalBasename("002_033_742-Yat.png")).toBe(2033742);
    expect(parsePowerFromOriginalBasename("003_561_902-ya_WP_iyy_V.png")).toBe(3561902);
    expect(parsePowerFromOriginalBasename("002_295_202-Gu_22_u.png")).toBe(2295202);
  });

  it("handles double hyphen after power segment", () => {
    expect(parsePowerFromOriginalBasename("000_471_711--_Ko_Ch.png")).toBe(471711);
  });

  it("returns undefined for Screenshot-style names", () => {
    expect(parsePowerFromOriginalBasename("Screenshot_2026.05.09_00.42.28.730.png")).toBe(
      undefined,
    );
  });

  it("returns undefined when pattern missing", () => {
    expect(parsePowerFromOriginalBasename("test.png")).toBe(undefined);
  });
});
