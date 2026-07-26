import { describe, expect, it } from "vitest";
import { deriveConnection } from "../connection.js";
import type { ServerSpec } from "../types.js";

function spec(overrides: Partial<ServerSpec["webServer"]>): ServerSpec {
  return {
    name: "myServer",
    webServer: { host: "iris.example.com", port: 443, ...overrides },
  };
}

describe("deriveConnection", () => {
  it("maps host/port/scheme directly when all are present", () => {
    const result = deriveConnection(spec({ scheme: "https" }));
    expect(result).toEqual({ host: "iris.example.com", port: 443, https: true });
  });

  it("defaults scheme to http (https: false) when scheme is absent", () => {
    const result = deriveConnection(spec({ scheme: undefined }));
    expect(result.https).toBe(false);
  });

  it("treats scheme comparison case-insensitively", () => {
    const result = deriveConnection(spec({ scheme: "HTTPS" }));
    expect(result.https).toBe(true);
  });

  it("falls back to localhost when host is empty/whitespace", () => {
    const result = deriveConnection(spec({ host: "   " }));
    expect(result.host).toBe("localhost");
  });

  it("falls back to port 52773 when port is missing/invalid", () => {
    const result = deriveConnection(spec({ port: 0 }));
    expect(result.port).toBe(52773);
  });

  it("does not set ignoredPathPrefix when pathPrefix is absent", () => {
    const result = deriveConnection(spec({}));
    expect(result.ignoredPathPrefix).toBeUndefined();
  });

  it("does not set ignoredPathPrefix for a root ('/') prefix", () => {
    const result = deriveConnection(spec({ pathPrefix: "/" }));
    expect(result.ignoredPathPrefix).toBeUndefined();
  });

  it("sets ignoredPathPrefix for a real, non-root prefix", () => {
    const result = deriveConnection(spec({ pathPrefix: "/csp/healthshare" }));
    expect(result.ignoredPathPrefix).toBe("/csp/healthshare");
  });
});
