import { describe, expect, it } from "vitest";
import { splitVsParts } from "../../scripts/generate-wiki-matrix.mjs";

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
