import { describe, it, expect } from "vitest";
import {
  IrisConnectionError,
  IrisApiError,
  McpProtocolError,
} from "../errors.js";

describe("IrisConnectionError", () => {
  it("should format message as '{what happened}. {what to do}.'", () => {
    const err = new IrisConnectionError(
      "TIMEOUT",
      "Connection timed out after 30s",
      "Check that the IRIS web port is accessible",
    );
    expect(err.message).toBe(
      "Connection timed out after 30s. Check that the IRIS web port is accessible.",
    );
  });

  it("should expose code and suggestion properties", () => {
    const err = new IrisConnectionError(
      "NETWORK_ERROR",
      "Cannot reach host",
      "Verify DNS and network settings",
    );
    expect(err.code).toBe("NETWORK_ERROR");
    expect(err.suggestion).toBe("Verify DNS and network settings");
    expect(err.name).toBe("IrisConnectionError");
  });

  it("should be an instance of Error", () => {
    const err = new IrisConnectionError("X", "msg", "sug");
    expect(err).toBeInstanceOf(Error);
  });
});

describe("IrisApiError", () => {
  it("should store statusCode, errors, and originalUrl", () => {
    const errors = [{ code: 5001, msg: "Class not found" }];
    const err = new IrisApiError(404, errors, "/api/atelier/v1/doc/Foo.cls");
    expect(err.statusCode).toBe(404);
    expect(err.errors).toEqual(errors);
    expect(err.originalUrl).toBe("/api/atelier/v1/doc/Foo.cls");
    expect(err.name).toBe("IrisApiError");
  });

  it("should use default message when none provided", () => {
    const err = new IrisApiError(500, [], "/test");
    expect(err.message).toContain("HTTP 500");
  });

  it("should use custom message when provided", () => {
    const err = new IrisApiError(400, [], "/test", "Bad input. Fix it.");
    expect(err.message).toBe("Bad input. Fix it.");
  });

  it("should be an instance of Error", () => {
    const err = new IrisApiError(500, [], "/");
    expect(err).toBeInstanceOf(Error);
  });
});

describe("McpProtocolError", () => {
  it("should store JSON-RPC error code", () => {
    const err = new McpProtocolError(-32602, "Invalid params");
    expect(err.code).toBe(-32602);
    expect(err.message).toBe("Invalid params");
    expect(err.name).toBe("McpProtocolError");
  });

  it("should be an instance of Error", () => {
    const err = new McpProtocolError(-32601, "Method not found");
    expect(err).toBeInstanceOf(Error);
  });
});
