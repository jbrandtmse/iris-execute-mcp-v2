import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { IrisHttpClient } from "../http-client.js";
import { IrisConnectionConfig } from "../config.js";
import { IrisConnectionError } from "../errors.js";
import { checkHealth, ping } from "../health.js";

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

function mockHeadResponse(
  status = 200,
  setCookie: string[] = [],
): Response {
  const resp = new Response(null, { status });
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

describe("health", () => {
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

  // ── checkHealth ─────────────────────────────────────────────────

  describe("checkHealth", () => {
    it("should resolve on successful HEAD /api/atelier/", async () => {
      const client = new IrisHttpClient(makeConfig());
      fetchMock.mockResolvedValueOnce(
        mockHeadResponse(200, ["CSPSESSIONID=s1; path=/"]),
      );

      await expect(checkHealth(client)).resolves.toBeUndefined();

      const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("http://localhost:52773/api/atelier/");
      expect(opts.method).toBe("HEAD");

      client.destroy();
    });

    it("should throw IrisConnectionError on network failure", async () => {
      const client = new IrisHttpClient(makeConfig());
      fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));

      await expect(checkHealth(client)).rejects.toThrow(IrisConnectionError);

      try {
        fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
        await checkHealth(client);
      } catch (err) {
        expect(err).toBeInstanceOf(IrisConnectionError);
        const connErr = err as IrisConnectionError;
        expect(connErr.code).toBe("NETWORK_ERROR");
        expect(connErr.message).toContain("localhost");
        expect(connErr.message).toContain("52773");
      }

      client.destroy();
    });

    it("should throw IrisConnectionError on timeout", async () => {
      const client = new IrisHttpClient(makeConfig(), 50);
      fetchMock.mockImplementation(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            const signal = init.signal;
            if (signal) {
              signal.addEventListener("abort", () => {
                reject(
                  new DOMException("The operation was aborted.", "AbortError"),
                );
              });
            }
          }),
      );

      await expect(checkHealth(client)).rejects.toThrow(IrisConnectionError);

      client.destroy();
    });
  });

  // ── ping ────────────────────────────────────────────────────────

  describe("ping", () => {
    it("should return true when IRIS is reachable", async () => {
      const client = new IrisHttpClient(makeConfig());
      fetchMock.mockResolvedValueOnce(
        mockHeadResponse(200, ["CSPSESSIONID=s1; path=/"]),
      );

      const result = await ping(client);
      expect(result).toBe(true);

      client.destroy();
    });

    it("should return false when IRIS is unreachable", async () => {
      const client = new IrisHttpClient(makeConfig());
      fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));

      const result = await ping(client);
      expect(result).toBe(false);

      client.destroy();
    });

    it("should return false on timeout", async () => {
      const client = new IrisHttpClient(makeConfig(), 50);
      fetchMock.mockImplementation(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            const signal = init.signal;
            if (signal) {
              signal.addEventListener("abort", () => {
                reject(
                  new DOMException("The operation was aborted.", "AbortError"),
                );
              });
            }
          }),
      );

      const result = await ping(client, 50);
      expect(result).toBe(false);

      client.destroy();
    });

    it("should use custom timeout parameter", async () => {
      const client = new IrisHttpClient(makeConfig());
      fetchMock.mockResolvedValueOnce(
        mockHeadResponse(200, ["CSPSESSIONID=s1; path=/"]),
      );

      const result = await ping(client, 500);
      expect(result).toBe(true);

      client.destroy();
    });
  });
});
