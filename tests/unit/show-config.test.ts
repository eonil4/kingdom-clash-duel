import { describe, expect, it } from "vitest";
import { formatSource, loadConfig } from "../../scripts/llm/show-llm-config.mjs";

describe("show-llm-config", () => {
  it("formats values with their source", () => {
    expect(formatSource(undefined, "env")).toEqual({ value: null, source: "env" });
    expect(formatSource("qwen", "config")).toEqual({ value: "qwen", source: "config" });
  });

  it("loads config/llm.json including the ROI reference", async () => {
    const config = await loadConfig();
    expect(typeof config.host).toBe("string");
    expect(typeof config.defaultModel).toBe("string");
    expect(config.roiReference).toEqual({ width: 900, height: 1600 });
  });
});
