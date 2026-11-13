import { afterEach, describe, expect, it, vi } from "vitest";
import { log, logOnce } from "../../scripts/log.mjs";

const saved = process.env.LOG_LEVEL;

afterEach(() => {
  if (saved === undefined) delete process.env.LOG_LEVEL;
  else process.env.LOG_LEVEL = saved;
  vi.restoreAllMocks();
});

describe("log", () => {
  it("defaults to info: hides debug, shows info/warn/error", () => {
    delete process.env.LOG_LEVEL;
    const debug = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    log.debug("d");
    expect(debug).not.toHaveBeenCalled();
    log.info("i");
    log.warn("w");
    log.error("e");
    expect(debug).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("silent suppresses everything", () => {
    process.env.LOG_LEVEL = "silent";
    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    log.debug("d");
    log.info("i");
    log.warn("w");
    log.error("e");
    expect(out).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("debug shows all pipeline chatter", () => {
    process.env.LOG_LEVEL = "debug";
    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    log.debug("d");
    log.info("i");
    expect(out).toHaveBeenCalledTimes(2);
  });

  it("logOnce dedupes per key and level", () => {
    process.env.LOG_LEVEL = "debug";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    logOnce("warn", "kcd-logonce-a", "first");
    logOnce("warn", "kcd-logonce-a", "first again");
    logOnce("warn", "kcd-logonce-b", "other");
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenNthCalledWith(2, "other");
  });
});
