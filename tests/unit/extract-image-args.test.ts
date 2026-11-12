import { afterEach, describe, expect, it, vi } from "vitest";
import { parseArgs } from "../../scripts/extract_image.mjs";

function silence() {
  vi.spyOn(console, "error").mockImplementation(() => {});
}

function mockExit() {
  return vi
    .spyOn(process, "exit")
    .mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);
}

afterEach(() => {
  vi.restoreAllMocks();
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

  it("rejects negative or non-integer coordinates", () => {
    silence();
    mockExit();
    expect(() => parseArgs(["i", "o", "-1", "0", "1", "1"])).toThrow("exit:1");
    expect(() => parseArgs(["i", "o", "1.5", "0", "1", "1"])).toThrow("exit:1");
    expect(() => parseArgs(["i", "o", "a", "0", "1", "1"])).toThrow("exit:1");
  });

  it("rejects zero width or height", () => {
    silence();
    mockExit();
    expect(() => parseArgs(["i", "o", "0", "0", "0", "1"])).toThrow("exit:1");
    expect(() => parseArgs(["i", "o", "0", "0", "1", "0"])).toThrow("exit:1");
  });

  it("shows usage when arguments are missing", () => {
    silence();
    mockExit();
    expect(() => parseArgs(["only-input"])).toThrow("exit:1");
  });
});
