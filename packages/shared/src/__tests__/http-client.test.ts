import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { IrisHttpClient } from "../http-client.js";
import { IrisConnectionConfig } from "../config.js";
import { IrisApiError, IrisConnectionError } from "../errors.js";

// ── Helpers ─────────────────────────────────────────────────────────

function makeConfig(overrides?: Partial<IrisConnectionConfig>): IrisConnectionConfig {
  return {
    host: "localhost",
    port: 52773,
    username: "testuser",
    password: "testpass",
    namespace: "HSCUSTOM",
    https: false,
    baseUrl: "http://localhost:52773",
    ...overrides,
  };
}

function atelierResponse<T>(result: T, errors: unknown[] = []) {
  return { status: { errors, summary: "" }, console: [], result };
}

/** Build a minimal Response-like object that fetch would return. */
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
  // getSetCookie is part of the Headers API in Node 20+
  // For testing we patch it onto the response.
  const resp = new Response(JSON.stringify(body), {
    status,
    headers: headersObj,
  });

  // Patch getSetCookie for older Node versions / test environment
  if (setCookie.length > 0) {
    const originalGetSetCookie = resp.headers.getSetCookie?.bind(resp.headers);
    resp.headers.getSetCookie = () => {
      const real = originalGetSetCookie?.() ?? [];
      return [...real, ...setCookie];
    };
  }

  return resp;
}

// ── Tests ───────────────────────────────────────────────────────────

describe("IrisHttpClient", () => {
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

  // ── Session establishment ───────────────────────────────────────

  describe("session establishment", () => {
    it("should send Basic Auth header on first request", async () => {
      const config = makeConfig();
      const client = new IrisHttpClient(config);

      fetchMock.mockResolvedValueOnce(
        mockResponse(atelierResponse({ ok: true }), {
          setCookie: ["CSPSESSIONID-abc=session123; path=/"],
        }),
      );

      await client.get("/api/test");

      const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      const headers = options.headers as Record<string, string>;
      expect(headers["Authorization"]).toMatch(/^Basic /);
      const decoded = Buffer.from(
        headers["Authorization"]!.replace("Basic ", ""),
        "base64",
      ).toString();
      expect(decoded).toBe("testuser:testpass");

      client.destroy();
    });

    it("should extract session cookie from response", async () => {
      const config = makeConfig();
      const client = new IrisHttpClient(config);

      // First request: establish session
      fetchMock.mockResolvedValueOnce(
        mockResponse(atelierResponse({}), {
          setCookie: ["CSPSESSIONID-sp123=sess456; path=/; HttpOnly"],
        }),
      );

      await client.get("/api/test");

      // Second request: should include cookie, no Basic Auth
      fetchMock.mockResolvedValueOnce(
        mockResponse(atelierResponse({})),
      );

      await client.get("/api/test2");

      const [, secondOpts] = fetchMock.mock.calls[1] as [string, RequestInit];
      const headers = secondOpts.headers as Record<string, string>;
      expect(headers["Cookie"]).toContain("CSPSESSIONID-sp123=sess456");
      expect(headers["Authorization"]).toBeUndefined();

      client.destroy();
    });
  });

  // ── Cookie reuse ────────────────────────────────────────────────

  describe("cookie reuse", () => {
    it("should reuse session cookie on subsequent requests", async () => {
      const config = makeConfig();
      const client = new IrisHttpClient(config);

      fetchMock.mockResolvedValueOnce(
        mockResponse(atelierResponse({}), {
          setCookie: ["CSPSESSIONID=abc; path=/"],
        }),
      );
      await client.get("/first");

      fetchMock.mockResolvedValueOnce(mockResponse(atelierResponse({})));
      await client.get("/second");

      fetchMock.mockResolvedValueOnce(mockResponse(atelierResponse({})));
      await client.get("/third");

      // Requests 2 and 3 should both have the cookie
      for (const callIdx of [1, 2]) {
        const [, opts] = fetchMock.mock.calls[callIdx] as [string, RequestInit];
        const h = opts.headers as Record<string, string>;
        expect(h["Cookie"]).toContain("CSPSESSIONID=abc");
      }

      client.destroy();
    });
  });

  // ── CSRF token ──────────────────────────────────────────────────

  describe("CSRF token", () => {
    it("should extract CSRF token and include in POST/PUT/DELETE", async () => {
      const config = makeConfig();
      const client = new IrisHttpClient(config);

      // First GET returns CSRF token
      fetchMock.mockResolvedValueOnce(
        mockResponse(atelierResponse({}), {
          setCookie: ["CSPSESSIONID=s1; path=/"],
          headers: { "X-CSRF-Token": "token-xyz" },
        }),
      );
      await client.get("/api/init");

      // POST should include the CSRF token
      fetchMock.mockResolvedValueOnce(mockResponse(atelierResponse({})));
      await client.post("/api/action", { data: 1 });

      const [, postOpts] = fetchMock.mock.calls[1] as [string, RequestInit];
      const postHeaders = postOpts.headers as Record<string, string>;
      expect(postHeaders["X-CSRF-Token"]).toBe("token-xyz");

      // PUT should include the CSRF token
      fetchMock.mockResolvedValueOnce(mockResponse(atelierResponse({})));
      await client.put("/api/update", { data: 2 });

      const [, putOpts] = fetchMock.mock.calls[2] as [string, RequestInit];
      expect((putOpts.headers as Record<string, string>)["X-CSRF-Token"]).toBe("token-xyz");

      // DELETE should include the CSRF token
      fetchMock.mockResolvedValueOnce(mockResponse(atelierResponse({})));
      await client.delete("/api/remove");

      const [, delOpts] = fetchMock.mock.calls[3] as [string, RequestInit];
      expect((delOpts.headers as Record<string, string>)["X-CSRF-Token"]).toBe("token-xyz");

      client.destroy();
    });

    it("should not include CSRF token in GET requests", async () => {
      const config = makeConfig();
      const client = new IrisHttpClient(config);

      fetchMock.mockResolvedValueOnce(
        mockResponse(atelierResponse({}), {
          setCookie: ["CSPSESSIONID=s1; path=/"],
          headers: { "X-CSRF-Token": "token-abc" },
        }),
      );
      await client.get("/api/init");

      fetchMock.mockResolvedValueOnce(mockResponse(atelierResponse({})));
      await client.get("/api/read");

      const [, getOpts] = fetchMock.mock.calls[1] as [string, RequestInit];
      const h = getOpts.headers as Record<string, string>;
      expect(h["X-CSRF-Token"]).toBeUndefined();

      client.destroy();
    });
  });

  // ── Auto re-auth on 401 ────────────────────────────────────────

  describe("auto re-auth on 401", () => {
    it("should retry with Basic Auth when receiving 401", async () => {
      const config = makeConfig();
      const client = new IrisHttpClient(config);

      // First request: establish session
      fetchMock.mockResolvedValueOnce(
        mockResponse(atelierResponse({}), {
          setCookie: ["CSPSESSIONID=s1; path=/"],
        }),
      );
      await client.get("/api/init");

      // Second request: 401 expired session
      fetchMock.mockResolvedValueOnce(
        mockResponse(atelierResponse({}), { status: 401 }),
      );
      // Retry: success with new session
      fetchMock.mockResolvedValueOnce(
        mockResponse(atelierResponse({ reauthed: true }), {
          setCookie: ["CSPSESSIONID=s2; path=/"],
        }),
      );

      const result = await client.get("/api/data");
      expect(result.result).toEqual({ reauthed: true });

      // Verify the retry had Basic Auth
      const [, retryOpts] = fetchMock.mock.calls[2] as [string, RequestInit];
      const h = retryOpts.headers as Record<string, string>;
      expect(h["Authorization"]).toMatch(/^Basic /);

      client.destroy();
    });

    it("should not retry infinitely on repeated 401", async () => {
      const config = makeConfig();
      const client = new IrisHttpClient(config);

      // First request: establish session
      fetchMock.mockResolvedValueOnce(
        mockResponse(atelierResponse({}), {
          setCookie: ["CSPSESSIONID=s1; path=/"],
        }),
      );
      await client.get("/api/init");

      // Second request: 401
      fetchMock.mockResolvedValueOnce(
        mockResponse(atelierResponse({}), { status: 401 }),
      );
      // Retry also returns 401
      fetchMock.mockResolvedValueOnce(
        mockResponse(
          { status: { errors: [{ code: 401, msg: "Unauthorized" }], summary: "" }, console: [], result: {} },
          { status: 401 },
        ),
      );

      await expect(client.get("/api/data")).rejects.toThrow(IrisApiError);
      // Should have made exactly 3 calls: init + original + 1 retry
      expect(fetchMock).toHaveBeenCalledTimes(3);

      client.destroy();
    });
  });

  // ── Timeout ─────────────────────────────────────────────────────

  describe("timeout handling", () => {
    it("should throw IrisConnectionError on timeout", async () => {
      const config = makeConfig();
      const client = new IrisHttpClient(config, 50); // 50ms timeout

      fetchMock.mockImplementation(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            // Listen for abort signal to reject like real fetch does
            const signal = init.signal;
            if (signal) {
              signal.addEventListener("abort", () => {
                const err = new DOMException("The operation was aborted.", "AbortError");
                reject(err);
              });
            }
          }),
      );

      await expect(client.get("/api/slow")).rejects.toThrow(
        IrisConnectionError,
      );

      try {
        await client.get("/api/slow");
      } catch (err) {
        expect(err).toBeInstanceOf(IrisConnectionError);
        expect((err as IrisConnectionError).code).toBe("TIMEOUT");
      }

      client.destroy();
    });
  });

  // ── HTTPS URL construction ──────────────────────────────────────

  describe("HTTPS support", () => {
    it("should use HTTPS base URL when configured", async () => {
      const config = makeConfig({
        https: true,
        baseUrl: "https://localhost:52773",
      });
      const client = new IrisHttpClient(config);

      fetchMock.mockResolvedValueOnce(
        mockResponse(atelierResponse({}), {
          setCookie: ["CSPSESSIONID=s1; path=/"],
        }),
      );

      await client.get("/api/test");

      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://localhost:52773/api/test");

      client.destroy();
    });
  });

  // ── Error mapping ───────────────────────────────────────────────

  describe("error mapping", () => {
    it("should throw IrisApiError on 4xx/5xx responses", async () => {
      const config = makeConfig();
      const client = new IrisHttpClient(config);

      const body = {
        status: { errors: [{ code: 5001, msg: "Class not found" }], summary: "error" },
        console: [],
        result: {},
      };
      fetchMock.mockResolvedValueOnce(mockResponse(body, { status: 404 }));

      await expect(client.get("/api/missing")).rejects.toThrow(IrisApiError);

      try {
        fetchMock.mockResolvedValueOnce(mockResponse(body, { status: 404 }));
        await client.get("/api/missing");
      } catch (err) {
        expect(err).toBeInstanceOf(IrisApiError);
        const apiErr = err as IrisApiError;
        expect(apiErr.statusCode).toBe(404);
        expect(apiErr.errors).toHaveLength(1);
        expect(apiErr.originalUrl).toBe("/api/missing");
      }

      client.destroy();
    });

    it("should throw IrisApiError when envelope has errors on 200", async () => {
      const config = makeConfig();
      const client = new IrisHttpClient(config);

      fetchMock.mockResolvedValueOnce(
        mockResponse(
          {
            status: { errors: [{ code: 1, msg: "Compilation error" }], summary: "" },
            console: [],
            result: {},
          },
          {
            status: 200,
            setCookie: ["CSPSESSIONID=s1; path=/"],
          },
        ),
      );

      await expect(client.get("/api/compile")).rejects.toThrow(IrisApiError);

      client.destroy();
    });

    it("should throw IrisApiError on non-JSON error responses", async () => {
      const config = makeConfig();
      const client = new IrisHttpClient(config);

      // Simulate IRIS returning an HTML error page
      const htmlResponse = new Response("<html><body>Error</body></html>", {
        status: 500,
        headers: { "Content-Type": "text/html" },
      });
      fetchMock.mockResolvedValueOnce(htmlResponse);

      await expect(client.get("/api/test")).rejects.toThrow(IrisApiError);

      try {
        const htmlResponse2 = new Response("<html><body>Error</body></html>", {
          status: 500,
          headers: { "Content-Type": "text/html" },
        });
        fetchMock.mockResolvedValueOnce(htmlResponse2);
        await client.get("/api/test");
      } catch (err) {
        expect(err).toBeInstanceOf(IrisApiError);
        expect((err as IrisApiError).message).toContain("non-JSON");
      }

      client.destroy();
    });

    it("should throw IrisConnectionError on network failures", async () => {
      const config = makeConfig();
      const client = new IrisHttpClient(config);

      fetchMock.mockRejectedValueOnce(
        new TypeError("fetch failed"),
      );

      await expect(client.get("/api/test")).rejects.toThrow(
        IrisConnectionError,
      );

      try {
        fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
        await client.get("/api/test");
      } catch (err) {
        expect((err as IrisConnectionError).code).toBe("NETWORK_ERROR");
      }

      client.destroy();
    });
  });

  // ── Credential scrubbing ────────────────────────────────────────

  describe("credential scrubbing in logs", () => {
    it("should not include credentials in log output", async () => {
      const config = makeConfig();
      const client = new IrisHttpClient(config);
      const consoleSpy = vi.spyOn(console, "error");

      fetchMock.mockResolvedValueOnce(
        mockResponse(atelierResponse({}), {
          setCookie: ["CSPSESSIONID=s1; path=/"],
        }),
      );
      await client.get("/api/test");

      // Check none of the console.error calls contain credentials
      for (const call of consoleSpy.mock.calls) {
        const output = call.map(String).join(" ");
        expect(output).not.toContain("testpass");
        expect(output).not.toContain("CSPSESSIONID=s1");
      }

      client.destroy();
    });
  });

  // ── HEAD method ─────────────────────────────────────────────────

  describe("head method", () => {
    it("should send HEAD request without expecting a body", async () => {
      const config = makeConfig();
      const client = new IrisHttpClient(config);

      const resp = new Response(null, { status: 200 });
      const originalGetSetCookie = resp.headers.getSetCookie?.bind(resp.headers);
      resp.headers.getSetCookie = () => {
        const real = originalGetSetCookie?.() ?? [];
        return [...real, "CSPSESSIONID=s1; path=/"];
      };
      fetchMock.mockResolvedValueOnce(resp);

      await expect(client.head("/api/atelier/")).resolves.toBeUndefined();

      const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("http://localhost:52773/api/atelier/");
      expect(opts.method).toBe("HEAD");

      client.destroy();
    });

    it("should include Basic Auth on first HEAD request", async () => {
      const config = makeConfig();
      const client = new IrisHttpClient(config);

      const resp = new Response(null, { status: 200 });
      fetchMock.mockResolvedValueOnce(resp);

      await client.head("/api/atelier/");

      const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
      const headers = opts.headers as Record<string, string>;
      expect(headers["Authorization"]).toMatch(/^Basic /);

      client.destroy();
    });

    it("should throw IrisConnectionError on network failure", async () => {
      const config = makeConfig();
      const client = new IrisHttpClient(config);

      fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));

      await expect(client.head("/api/test")).rejects.toThrow(IrisConnectionError);

      client.destroy();
    });

    it("should throw IrisConnectionError on timeout", async () => {
      const config = makeConfig();
      const client = new IrisHttpClient(config, 50);

      fetchMock.mockImplementation(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            const signal = init.signal;
            if (signal) {
              signal.addEventListener("abort", () => {
                reject(new DOMException("The operation was aborted.", "AbortError"));
              });
            }
          }),
      );

      await expect(client.head("/api/slow")).rejects.toThrow(IrisConnectionError);

      client.destroy();
    });

    it("should throw IrisApiError on non-OK response", async () => {
      const config = makeConfig();
      const client = new IrisHttpClient(config);

      const resp = new Response(null, { status: 500 });
      fetchMock.mockResolvedValueOnce(resp);

      await expect(client.head("/api/test")).rejects.toThrow(IrisApiError);

      client.destroy();
    });

    it("should extract cookies from HEAD response", async () => {
      const config = makeConfig();
      const client = new IrisHttpClient(config);

      // HEAD response with cookie
      const headResp = new Response(null, { status: 200 });
      const originalGetSetCookie = headResp.headers.getSetCookie?.bind(headResp.headers);
      headResp.headers.getSetCookie = () => {
        const real = originalGetSetCookie?.() ?? [];
        return [...real, "CSPSESSIONID=headcookie; path=/"];
      };
      fetchMock.mockResolvedValueOnce(headResp);

      await client.head("/api/atelier/");

      // Subsequent GET should include the cookie
      fetchMock.mockResolvedValueOnce(
        mockResponse(atelierResponse({})),
      );
      await client.get("/api/test");

      const [, getOpts] = fetchMock.mock.calls[1] as [string, RequestInit];
      const headers = getOpts.headers as Record<string, string>;
      expect(headers["Cookie"]).toContain("CSPSESSIONID=headcookie");

      client.destroy();
    });
  });

  // ── Typed methods ───────────────────────────────────────────────

  describe("typed methods", () => {
    it("should send POST with JSON body", async () => {
      const config = makeConfig();
      const client = new IrisHttpClient(config);

      fetchMock.mockResolvedValueOnce(
        mockResponse(atelierResponse({ id: 1 }), {
          setCookie: ["CSPSESSIONID=s1; path=/"],
        }),
      );

      await client.post("/api/create", { name: "test" });

      const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(opts.method).toBe("POST");
      expect(opts.body).toBe(JSON.stringify({ name: "test" }));
      expect((opts.headers as Record<string, string>)["Content-Type"]).toBe(
        "application/json",
      );

      client.destroy();
    });

    it("should send PUT with JSON body", async () => {
      const config = makeConfig();
      const client = new IrisHttpClient(config);

      fetchMock.mockResolvedValueOnce(
        mockResponse(atelierResponse({}), {
          setCookie: ["CSPSESSIONID=s1; path=/"],
        }),
      );

      await client.put("/api/update", { name: "updated" });

      const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(opts.method).toBe("PUT");
      expect(opts.body).toBe(JSON.stringify({ name: "updated" }));

      client.destroy();
    });

    it("should send DELETE without body", async () => {
      const config = makeConfig();
      const client = new IrisHttpClient(config);

      fetchMock.mockResolvedValueOnce(
        mockResponse(atelierResponse({}), {
          setCookie: ["CSPSESSIONID=s1; path=/"],
        }),
      );

      await client.delete("/api/remove");

      const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(opts.method).toBe("DELETE");
      expect(opts.body).toBeNull();

      client.destroy();
    });
  });
});
