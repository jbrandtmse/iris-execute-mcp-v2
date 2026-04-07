import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolveTransport } from "../transport.js";

describe("resolveTransport", () => {
  const originalArgv = process.argv;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    delete process.env["MCP_TRANSPORT"];
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("should default to stdio when no args or env", () => {
    process.argv = ["node", "script"];
    delete process.env["MCP_TRANSPORT"];
    expect(resolveTransport()).toBe("stdio");
  });

  it("should return http from --transport=http CLI arg", () => {
    process.argv = ["node", "script", "--transport=http"];
    expect(resolveTransport()).toBe("http");
  });

  it("should return http from --transport http CLI arg", () => {
    process.argv = ["node", "script", "--transport", "http"];
    expect(resolveTransport()).toBe("http");
  });

  it("should return stdio from --transport=stdio CLI arg", () => {
    process.argv = ["node", "script", "--transport=stdio"];
    expect(resolveTransport()).toBe("stdio");
  });

  it("should read MCP_TRANSPORT env when no CLI arg", () => {
    process.argv = ["node", "script"];
    process.env["MCP_TRANSPORT"] = "http";
    expect(resolveTransport()).toBe("http");
  });

  it("should warn and fall back to stdio for unrecognised MCP_TRANSPORT", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.argv = ["node", "script"];
    process.env["MCP_TRANSPORT"] = "websocket";
    expect(resolveTransport()).toBe("stdio");
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("unrecognised"),
    );
  });

  it("should prefer CLI arg over env var", () => {
    process.argv = ["node", "script", "--transport=http"];
    process.env["MCP_TRANSPORT"] = "stdio";
    expect(resolveTransport()).toBe("http");
  });
});
