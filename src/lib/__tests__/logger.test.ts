import { describe, it, expect, vi, afterEach } from "vitest";
import { logger } from "../logger";

describe("logger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("forwards log, warn, debug, info, and error in dev/test mode", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    logger.log("hello", 1);
    logger.warn("careful");
    logger.debug("trace");
    logger.info("info");
    logger.error("boom");

    expect(logSpy).toHaveBeenCalledWith("hello", 1);
    expect(warnSpy).toHaveBeenCalledWith("careful");
    expect(debugSpy).toHaveBeenCalledWith("trace");
    expect(infoSpy).toHaveBeenCalledWith("info");
    expect(errSpy).toHaveBeenCalledWith("boom");
  });
});
