import { describe, it, expect, vi, beforeEach } from "vitest";
import { LogLevel, parseLogLevel } from "../logger.js";

// We need dynamic import to test log-level filtering because the logger
// singleton reads LOG_LEVEL at module load time.  For the existing tests
// the default level (DEBUG) is fine — all messages pass through.

describe("logger", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("should prefix error messages with [ERROR]", async () => {
    const { logger } = await import("../logger.js");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logger.error("something broke");
    expect(spy).toHaveBeenCalledWith("[ERROR] something broke");
  });

  it("should prefix warn messages with [WARN]", async () => {
    const { logger } = await import("../logger.js");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logger.warn("heads up");
    expect(spy).toHaveBeenCalledWith("[WARN] heads up");
  });

  it("should prefix info messages with [INFO]", async () => {
    const { logger } = await import("../logger.js");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logger.info("fyi");
    expect(spy).toHaveBeenCalledWith("[INFO] fyi");
  });

  it("should prefix debug messages with [DEBUG]", async () => {
    const { logger } = await import("../logger.js");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logger.debug("trace data");
    expect(spy).toHaveBeenCalledWith("[DEBUG] trace data");
  });

  it("should use console.error for all levels (never console.log)", async () => {
    const { logger } = await import("../logger.js");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    logger.error("e");
    logger.warn("w");
    logger.info("i");
    logger.debug("d");

    expect(errorSpy).toHaveBeenCalledTimes(4);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("should pass extra arguments through", async () => {
    const { logger } = await import("../logger.js");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logger.info("request completed", { duration: 42 });
    expect(spy).toHaveBeenCalledWith("[INFO] request completed", {
      duration: 42,
    });
  });
});

describe("LogLevel enum", () => {
  it("should have correct numeric ordering (ERROR < WARN < INFO < DEBUG)", () => {
    expect(LogLevel.ERROR).toBe(0);
    expect(LogLevel.WARN).toBe(1);
    expect(LogLevel.INFO).toBe(2);
    expect(LogLevel.DEBUG).toBe(3);
    expect(LogLevel.ERROR).toBeLessThan(LogLevel.WARN);
    expect(LogLevel.WARN).toBeLessThan(LogLevel.INFO);
    expect(LogLevel.INFO).toBeLessThan(LogLevel.DEBUG);
  });
});

describe("parseLogLevel", () => {
  it("should return DEBUG when env is undefined", () => {
    expect(parseLogLevel(undefined)).toBe(LogLevel.DEBUG);
  });

  it("should return DEBUG when env is empty string", () => {
    expect(parseLogLevel("")).toBe(LogLevel.DEBUG);
  });

  it("should parse ERROR (case-insensitive)", () => {
    expect(parseLogLevel("ERROR")).toBe(LogLevel.ERROR);
    expect(parseLogLevel("error")).toBe(LogLevel.ERROR);
    expect(parseLogLevel("Error")).toBe(LogLevel.ERROR);
  });

  it("should parse WARN (case-insensitive)", () => {
    expect(parseLogLevel("WARN")).toBe(LogLevel.WARN);
    expect(parseLogLevel("warn")).toBe(LogLevel.WARN);
  });

  it("should parse INFO (case-insensitive)", () => {
    expect(parseLogLevel("INFO")).toBe(LogLevel.INFO);
    expect(parseLogLevel("info")).toBe(LogLevel.INFO);
  });

  it("should parse DEBUG (case-insensitive)", () => {
    expect(parseLogLevel("DEBUG")).toBe(LogLevel.DEBUG);
    expect(parseLogLevel("debug")).toBe(LogLevel.DEBUG);
  });

  it("should default to DEBUG for unrecognised values", () => {
    expect(parseLogLevel("VERBOSE")).toBe(LogLevel.DEBUG);
    expect(parseLogLevel("TRACE")).toBe(LogLevel.DEBUG);
    expect(parseLogLevel("nonsense")).toBe(LogLevel.DEBUG);
  });
});
