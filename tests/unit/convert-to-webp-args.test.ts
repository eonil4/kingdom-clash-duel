import { describe, expect, it } from "vitest";
import { parseArgs } from "../../scripts/llm/convert-to-webp.mjs";

describe("convert-to-webp parseArgs", () => {
  it("defaults to a real run", () => {
    expect(parseArgs([])).toEqual({ dryRun: false });
  });

  it("accepts --dry-run and ignores unknown args", () => {
    expect(parseArgs(["--dry-run", "x", "--other"])).toEqual({ dryRun: true });
  });
});
