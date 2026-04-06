import { describe, it, expect, vi, beforeEach } from "vitest";
import { logger } from "../logger.js";

describe("logger", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("should prefix error messages with [ERROR]", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logger.error("something broke");
    expect(spy).toHaveBeenCalledWith("[ERROR] something broke");
  });

  it("should prefix warn messages with [WARN]", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logger.warn("heads up");
    expect(spy).toHaveBeenCalledWith("[WARN] heads up");
  });

  it("should prefix info messages with [INFO]", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logger.info("fyi");
    expect(spy).toHaveBeenCalledWith("[INFO] fyi");
  });

  it("should prefix debug messages with [DEBUG]", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logger.debug("trace data");
    expect(spy).toHaveBeenCalledWith("[DEBUG] trace data");
  });

  it("should use console.error for all levels (never console.log)", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    logger.error("e");
    logger.warn("w");
    logger.info("i");
    logger.debug("d");

    expect(errorSpy).toHaveBeenCalledTimes(4);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("should pass extra arguments through", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logger.info("request completed", { duration: 42 });
    expect(spy).toHaveBeenCalledWith("[INFO] request completed", {
      duration: 42,
    });
  });
});
