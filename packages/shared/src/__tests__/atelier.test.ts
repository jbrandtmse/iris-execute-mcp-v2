import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { IrisHttpClient } from "../http-client.js";
import { IrisConnectionConfig } from "../config.js";
import { IrisApiError } from "../errors.js";
import { negotiateVersion, requireMinVersion, atelierPath } from "../atelier.js";

// ── Helpers ─────────────────────────────────────────────────────────

function makeConfig(): IrisConnectionConfig {
  return {
    host: "localhost",
    port: 52773,
    username: "testuser",
    password: "testpass",
    namespace: "HSCUSTOM",
    https: false,
    baseUrl: "http://localhost:52773",
    timeout: 60_000,
  };
}

function atelierResponse<T>(result: T, errors: unknown[] = []) {
  return { status: { errors, summary: "" }, console: [], result };
}

function mockResponse(
  body: unknown,
  init: {
    status?: number;
    headers?: Record<string, string>;
    setCookie?: string[];
  } = {},
): Response {
  const { status = 200, headers: extraHeaders = {}, setCookie = [] } = init;
  const headersObj = new Headers(extraHeaders);
  const resp = new Response(JSON.stringify(body), {
    status,
    headers: headersObj,
  });

  if (setCookie.length > 0) {
    const original = resp.headers.getSetCookie?.bind(resp.headers);
    resp.headers.getSetCookie = () => {
      const real = original?.() ?? [];
      return [...real, ...setCookie];
    };
  }

  return resp;
}

// ── Tests ───────────────────────────────────────────────────────────

describe("atelier", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // ── negotiateVersion ──────────────────────────────────────────────

  describe("negotiateVersion", () => {
    it("should return version from content.api (modern IRIS)", async () => {
      const client = new IrisHttpClient(makeConfig());
      fetchMock.mockResolvedValueOnce(
        mockResponse(
          atelierResponse({ content: { api: 8, version: "2024.1.0" } }),
          { setCookie: ["CSPSESSIONID=s1; path=/"] },
        ),
      );

      const version = await negotiateVersion(client);
      expect(version).toBe(8);

      client.destroy();
    });

    it("should cap content.api at v8 even if server reports higher", async () => {
      const client = new IrisHttpClient(makeConfig());
      fetchMock.mockResolvedValueOnce(
        mockResponse(
          atelierResponse({ content: { api: 12, version: "2025.2.0" } }),
          { setCookie: ["CSPSESSIONID=s1; path=/"] },
        ),
      );

      const version = await negotiateVersion(client);
      expect(version).toBe(8);

      client.destroy();
    });

    it("should fall back to top-level version string when content.api is missing", async () => {
      const client = new IrisHttpClient(makeConfig());
      fetchMock.mockResolvedValueOnce(
        mockResponse(
          atelierResponse({ version: "8.0.0" }),
          { setCookie: ["CSPSESSIONID=s1; path=/"] },
        ),
      );

      const version = await negotiateVersion(client);
      expect(version).toBe(8);

      client.destroy();
    });

    it("should fall back to top-level version string when content.api is zero", async () => {
      const client = new IrisHttpClient(makeConfig());
      fetchMock.mockResolvedValueOnce(
        mockResponse(
          atelierResponse({ content: { api: 0 }, version: "4.0.0" }),
          { setCookie: ["CSPSESSIONID=s1; path=/"] },
        ),
      );

      const version = await negotiateVersion(client);
      expect(version).toBe(4);

      client.destroy();
    });

    it("should cap at v8 even if server reports higher (legacy path)", async () => {
      const client = new IrisHttpClient(makeConfig());
      fetchMock.mockResolvedValueOnce(
        mockResponse(
          atelierResponse({ version: "10.2.1" }),
          { setCookie: ["CSPSESSIONID=s1; path=/"] },
        ),
      );

      const version = await negotiateVersion(client);
      expect(version).toBe(8);

      client.destroy();
    });

    it("should return v4 when server reports v4 (legacy path)", async () => {
      const client = new IrisHttpClient(makeConfig());
      fetchMock.mockResolvedValueOnce(
        mockResponse(
          atelierResponse({ version: "4.0.0" }),
          { setCookie: ["CSPSESSIONID=s1; path=/"] },
        ),
      );

      const version = await negotiateVersion(client);
      expect(version).toBe(4);

      client.destroy();
    });

    it("should default to v1 when version info is unavailable", async () => {
      const client = new IrisHttpClient(makeConfig());
      fetchMock.mockResolvedValueOnce(
        mockResponse(
          atelierResponse({}),
          { setCookie: ["CSPSESSIONID=s1; path=/"] },
        ),
      );

      const version = await negotiateVersion(client);
      expect(version).toBe(1);

      client.destroy();
    });

    it("should default to v1 on network error", async () => {
      const client = new IrisHttpClient(makeConfig());
      fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));

      const version = await negotiateVersion(client);
      expect(version).toBe(1);

      client.destroy();
    });

    it("should log WARN when version is below v7", async () => {
      const client = new IrisHttpClient(makeConfig());
      const consoleSpy = vi.spyOn(console, "error");

      fetchMock.mockResolvedValueOnce(
        mockResponse(
          atelierResponse({ version: "4.0.0" }),
          { setCookie: ["CSPSESSIONID=s1; path=/"] },
        ),
      );

      await negotiateVersion(client);

      const warnCalls = consoleSpy.mock.calls.filter((call) =>
        String(call[0]).includes("[WARN]"),
      );
      const hasVersionWarning = warnCalls.some((call) =>
        String(call[0]).includes("recommended minimum"),
      );
      expect(hasVersionWarning).toBe(true);

      client.destroy();
    });

    it("should log INFO when version is v7 or above", async () => {
      const client = new IrisHttpClient(makeConfig());
      const consoleSpy = vi.spyOn(console, "error");

      fetchMock.mockResolvedValueOnce(
        mockResponse(
          atelierResponse({ version: "7.0.0" }),
          { setCookie: ["CSPSESSIONID=s1; path=/"] },
        ),
      );

      await negotiateVersion(client);

      const infoCalls = consoleSpy.mock.calls.filter((call) =>
        String(call[0]).includes("[INFO]"),
      );
      const hasVersionInfo = infoCalls.some((call) =>
        String(call[0]).includes("Detected Atelier API v7"),
      );
      expect(hasVersionInfo).toBe(true);

      client.destroy();
    });
  });

  // ── requireMinVersion ─────────────────────────────────────────────

  describe("requireMinVersion", () => {
    it("should throw IrisApiError when version is too low", () => {
      expect(() => requireMinVersion(4, 7, "document search")).toThrow(
        IrisApiError,
      );

      try {
        requireMinVersion(4, 7, "document search");
      } catch (err) {
        expect(err).toBeInstanceOf(IrisApiError);
        const apiErr = err as IrisApiError;
        expect(apiErr.message).toContain("document search");
        expect(apiErr.message).toContain("v7");
        expect(apiErr.message).toContain("v4");
      }
    });

    it("should not throw when version meets requirement", () => {
      expect(() => requireMinVersion(7, 7, "document search")).not.toThrow();
    });

    it("should not throw when version exceeds requirement", () => {
      expect(() => requireMinVersion(8, 7, "document search")).not.toThrow();
    });
  });

  // ── atelierPath ───────────────────────────────────────────────────

  describe("atelierPath", () => {
    it("should construct correct URL path", () => {
      expect(atelierPath(7, "HSCUSTOM", "doc/MyClass.cls")).toBe(
        "/api/atelier/v7/HSCUSTOM/doc/MyClass.cls",
      );
    });

    it("should work with different versions and namespaces", () => {
      expect(atelierPath(4, "USER", "action/query")).toBe(
        "/api/atelier/v4/USER/action/query",
      );
    });

    it("should work with v8", () => {
      expect(atelierPath(8, "%SYS", "doc/Ens.Config.cls")).toBe(
        "/api/atelier/v8/%SYS/doc/Ens.Config.cls",
      );
    });

    it("should throw for version <= 0", () => {
      expect(() => atelierPath(0, "USER", "doc/A.cls")).toThrow("positive integer");
      expect(() => atelierPath(-1, "USER", "doc/A.cls")).toThrow("positive integer");
    });

    it("should throw for non-integer version", () => {
      expect(() => atelierPath(7.5, "USER", "doc/A.cls")).toThrow("positive integer");
      expect(() => atelierPath(NaN, "USER", "doc/A.cls")).toThrow("positive integer");
    });

    it("should throw for empty namespace", () => {
      expect(() => atelierPath(7, "", "doc/A.cls")).toThrow("namespace must not be empty");
    });

    it("should throw for empty action", () => {
      expect(() => atelierPath(7, "USER", "")).toThrow("action must not be empty");
    });
  });
});
