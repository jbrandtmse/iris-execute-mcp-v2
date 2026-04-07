import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { IrisHttpClient } from "../http-client.js";
import type { IrisConnectionConfig } from "../config.js";
import type { AtelierEnvelope } from "../http-client.js";
import {
  probeCustomRest,
  deployClasses,
  compileClasses,
  configureWebApp,
  bootstrap,
  MANUAL_INSTRUCTIONS,
} from "../bootstrap.js";
import { BOOTSTRAP_CLASSES, getBootstrapClasses } from "../bootstrap-classes.js";

// ── Helpers ─────────────────────────────────────────────────────────

function makeConfig(): IrisConnectionConfig {
  return {
    host: "localhost",
    port: 52773,
    username: "testuser",
    password: "testpass",
    namespace: "USER",
    https: false,
    baseUrl: "http://localhost:52773",
    timeout: 60_000,
  };
}

function envelope<T>(result: T, errors: unknown[] = []): AtelierEnvelope<T> {
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

describe("bootstrap", () => {
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

  /** Helper: set up fetch to handle CSRF preflight then the actual request. */
  function setupCsrfThenRequest(responseBody: unknown, status = 200) {
    // First call: HEAD for CSRF preflight
    fetchMock.mockResolvedValueOnce(
      mockResponse("", {
        status: 200,
        headers: { "X-CSRF-Token": "test-csrf-token" },
        setCookie: ["CSPSESSIONID=s1; path=/"],
      }),
    );
    // Second call: the actual POST/PUT
    fetchMock.mockResolvedValueOnce(
      mockResponse(responseBody, { status }),
    );
  }

  // ── probeCustomRest ─────────────────────────────────────────────

  describe("probeCustomRest", () => {
    it("should return true when SQL says configured", async () => {
      const config = makeConfig();
      const http = new IrisHttpClient(config);

      setupCsrfThenRequest(
        envelope({ content: [{ IsConfigured: 1 }] }),
      );

      const result = await probeCustomRest(http, config, 7);
      expect(result).toBe(true);

      http.destroy();
    });

    it("should return false when SQL fails (class not found)", async () => {
      const config = makeConfig();
      const http = new IrisHttpClient(config);

      // CSRF preflight
      fetchMock.mockResolvedValueOnce(
        mockResponse("", {
          status: 200,
          headers: { "X-CSRF-Token": "test-csrf-token" },
          setCookie: ["CSPSESSIONID=s1; path=/"],
        }),
      );
      // SQL call fails with 400
      fetchMock.mockResolvedValueOnce(
        mockResponse(
          {
            status: {
              errors: [{ error: "Class not found" }],
              summary: "Error",
            },
            console: [],
            result: null,
          },
          { status: 400 },
        ),
      );

      const result = await probeCustomRest(http, config, 7);
      expect(result).toBe(false);

      http.destroy();
    });

    it("should return false when IsConfigured is 0", async () => {
      const config = makeConfig();
      const http = new IrisHttpClient(config);

      setupCsrfThenRequest(
        envelope({ content: [{ IsConfigured: 0 }] }),
      );

      const result = await probeCustomRest(http, config, 7);
      expect(result).toBe(false);

      http.destroy();
    });
  });

  // ── deployClasses ───────────────────────────────────────────────

  describe("deployClasses", () => {
    it("should call PUT for each class", async () => {
      const config = makeConfig();
      const http = new IrisHttpClient(config);

      // CSRF preflight for the first PUT
      fetchMock.mockResolvedValueOnce(
        mockResponse("", {
          status: 200,
          headers: { "X-CSRF-Token": "test-csrf-token" },
          setCookie: ["CSPSESSIONID=s1; path=/"],
        }),
      );

      // One PUT response per class
      for (let i = 0; i < BOOTSTRAP_CLASSES.size; i++) {
        fetchMock.mockResolvedValueOnce(
          mockResponse(envelope({ result: [] })),
        );
      }

      await deployClasses(http, config, 7);

      // Count PUT calls (all calls minus 1 for the CSRF HEAD)
      const putCalls = fetchMock.mock.calls.filter(
        (call: unknown[]) => {
          const opts = call[1] as { method: string };
          return opts.method === "PUT";
        },
      );
      expect(putCalls.length).toBe(BOOTSTRAP_CLASSES.size);

      // Verify the URL pattern for each PUT
      for (const putCall of putCalls) {
        const url = putCall[0] as string;
        expect(url).toContain("/api/atelier/v7/USER/doc/");
        expect(url).toMatch(/\.cls$/);
      }

      http.destroy();
    });
  });

  // ── compileClasses ──────────────────────────────────────────────

  describe("compileClasses", () => {
    it("should POST with all class names", async () => {
      const config = makeConfig();
      const http = new IrisHttpClient(config);

      setupCsrfThenRequest(envelope({ result: [] }));

      await compileClasses(http, config, 7);

      const postCalls = fetchMock.mock.calls.filter(
        (call: unknown[]) => {
          const opts = call[1] as { method: string };
          return opts.method === "POST";
        },
      );
      expect(postCalls.length).toBe(1);

      const url = postCalls[0]![0] as string;
      expect(url).toContain("/api/atelier/v7/USER/action/compile");

      const body = JSON.parse(
        postCalls[0]![1].body as string,
      ) as string[];
      expect(body).toEqual([...BOOTSTRAP_CLASSES.keys()]);

      http.destroy();
    });
  });

  // ── configureWebApp ─────────────────────────────────────────────

  describe("configureWebApp", () => {
    it("should call SQL with correct Configure query", async () => {
      const config = makeConfig();
      const http = new IrisHttpClient(config);

      setupCsrfThenRequest(envelope({ content: [] }));

      await configureWebApp(http, config, 7);

      const postCalls = fetchMock.mock.calls.filter(
        (call: unknown[]) => {
          const opts = call[1] as { method: string };
          return opts.method === "POST";
        },
      );
      expect(postCalls.length).toBe(1);

      const url = postCalls[0]![0] as string;
      expect(url).toContain("/api/atelier/v7/USER/action/query");

      const body = JSON.parse(
        postCalls[0]![1].body as string,
      ) as { query: string; parameters?: string[] };
      expect(body.query).toContain("ExecuteMCPv2.Setup_Configure");
      expect(body.parameters).toContain("USER");

      http.destroy();
    });

    it("should throw when configure SQL fails", async () => {
      const config = makeConfig();
      const http = new IrisHttpClient(config);

      // CSRF preflight
      fetchMock.mockResolvedValueOnce(
        mockResponse("", {
          status: 200,
          headers: { "X-CSRF-Token": "test-csrf-token" },
          setCookie: ["CSPSESSIONID=s1; path=/"],
        }),
      );
      // Configure SQL fails
      fetchMock.mockResolvedValueOnce(
        mockResponse(
          {
            status: {
              errors: [{ error: "Privilege violation" }],
              summary: "Error",
            },
            console: [],
            result: null,
          },
          { status: 403 },
        ),
      );

      await expect(
        configureWebApp(http, config, 7),
      ).rejects.toThrow();

      http.destroy();
    });
  });

  // ── bootstrap (full orchestration) ──────────────────────────────

  describe("bootstrap (full orchestration)", () => {
    it("should skip when probe finds service already configured", async () => {
      const config = makeConfig();
      const http = new IrisHttpClient(config);

      // Probe: CSRF + SQL returning IsConfigured=1
      setupCsrfThenRequest(
        envelope({ content: [{ IsConfigured: 1 }] }),
      );

      const result = await bootstrap(http, config, 7);

      expect(result.probeFound).toBe(true);
      expect(result.deployed).toBe(true);
      expect(result.compiled).toBe(true);
      expect(result.configured).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.manualInstructions).toBeUndefined();

      http.destroy();
    });

    it("should run deploy + compile + configure when probe returns false", async () => {
      const config = makeConfig();
      const http = new IrisHttpClient(config);

      // Probe: CSRF preflight
      fetchMock.mockResolvedValueOnce(
        mockResponse("", {
          status: 200,
          headers: { "X-CSRF-Token": "test-csrf-token" },
          setCookie: ["CSPSESSIONID=s1; path=/"],
        }),
      );
      // Probe: SQL returns IsConfigured=0
      fetchMock.mockResolvedValueOnce(
        mockResponse(envelope({ content: [{ IsConfigured: 0 }] })),
      );

      // Deploy: PUT responses for each class (CSRF already established)
      for (let i = 0; i < BOOTSTRAP_CLASSES.size; i++) {
        fetchMock.mockResolvedValueOnce(
          mockResponse(envelope({ result: [] })),
        );
      }

      // Compile: POST response
      fetchMock.mockResolvedValueOnce(
        mockResponse(envelope({ result: [] })),
      );

      // Configure: POST response
      fetchMock.mockResolvedValueOnce(
        mockResponse(envelope({ content: [] })),
      );

      // Package mapping: POST response
      fetchMock.mockResolvedValueOnce(
        mockResponse(envelope({ content: [] })),
      );

      const result = await bootstrap(http, config, 7);

      expect(result.probeFound).toBe(false);
      expect(result.deployed).toBe(true);
      expect(result.compiled).toBe(true);
      expect(result.configured).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.manualInstructions).toBeUndefined();

      http.destroy();
    });

    it("should populate manualInstructions when configure fails", async () => {
      const config = makeConfig();
      const http = new IrisHttpClient(config);

      // Probe: CSRF preflight
      fetchMock.mockResolvedValueOnce(
        mockResponse("", {
          status: 200,
          headers: { "X-CSRF-Token": "test-csrf-token" },
          setCookie: ["CSPSESSIONID=s1; path=/"],
        }),
      );
      // Probe: SQL returns IsConfigured=0
      fetchMock.mockResolvedValueOnce(
        mockResponse(envelope({ content: [{ IsConfigured: 0 }] })),
      );

      // Deploy: PUT responses for each class
      for (let i = 0; i < BOOTSTRAP_CLASSES.size; i++) {
        fetchMock.mockResolvedValueOnce(
          mockResponse(envelope({ result: [] })),
        );
      }

      // Compile: POST response
      fetchMock.mockResolvedValueOnce(
        mockResponse(envelope({ result: [] })),
      );

      // Configure: fails with 403
      fetchMock.mockResolvedValueOnce(
        mockResponse(
          {
            status: {
              errors: [{ error: "Privilege violation" }],
              summary: "Error",
            },
            console: [],
            result: null,
          },
          { status: 403 },
        ),
      );

      // Package mapping: POST response (still attempted after configure failure)
      fetchMock.mockResolvedValueOnce(
        mockResponse(envelope({ content: [] })),
      );

      const result = await bootstrap(http, config, 7);

      expect(result.probeFound).toBe(false);
      expect(result.deployed).toBe(true);
      expect(result.compiled).toBe(true);
      expect(result.configured).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain("Configure failed");
      expect(result.manualInstructions).toBeDefined();
      expect(result.manualInstructions).toContain("Terminal");
      expect(result.manualInstructions).toContain("Management Portal");
      expect(result.manualInstructions).toContain("IPM");

      http.destroy();
    });

    it("should stop early when deploy fails", async () => {
      const config = makeConfig();
      const http = new IrisHttpClient(config);

      // Probe: CSRF preflight
      fetchMock.mockResolvedValueOnce(
        mockResponse("", {
          status: 200,
          headers: { "X-CSRF-Token": "test-csrf-token" },
          setCookie: ["CSPSESSIONID=s1; path=/"],
        }),
      );
      // Probe: SQL returns IsConfigured=0
      fetchMock.mockResolvedValueOnce(
        mockResponse(envelope({ content: [{ IsConfigured: 0 }] })),
      );

      // Deploy: first PUT fails with 500
      fetchMock.mockResolvedValueOnce(
        mockResponse(
          {
            status: {
              errors: [{ error: "Internal error" }],
              summary: "Error",
            },
            console: [],
            result: null,
          },
          { status: 500 },
        ),
      );

      const result = await bootstrap(http, config, 7);

      expect(result.probeFound).toBe(false);
      expect(result.deployed).toBe(false);
      expect(result.compiled).toBe(false);
      expect(result.configured).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain("Deploy failed");

      http.destroy();
    });
  });

  // ── MANUAL_INSTRUCTIONS ─────────────────────────────────────────

  describe("MANUAL_INSTRUCTIONS", () => {
    it("should contain all three alternatives", () => {
      expect(MANUAL_INSTRUCTIONS).toContain("Terminal");
      expect(MANUAL_INSTRUCTIONS).toContain("Management Portal");
      expect(MANUAL_INSTRUCTIONS).toContain("IPM");
      expect(MANUAL_INSTRUCTIONS).toContain(
        "ExecuteMCPv2.Setup",
      );
    });
  });

  // ── BOOTSTRAP_CLASSES ───────────────────────────────────────────

  describe("BOOTSTRAP_CLASSES", () => {
    it("should contain exactly 9 classes", () => {
      expect(BOOTSTRAP_CLASSES.size).toBe(9);
    });

    it("should contain all required class names", () => {
      const expected = [
        "ExecuteMCPv2.Utils.cls",
        "ExecuteMCPv2.Setup.cls",
        "ExecuteMCPv2.REST.Global.cls",
        "ExecuteMCPv2.REST.Command.cls",
        "ExecuteMCPv2.REST.UnitTest.cls",
        "ExecuteMCPv2.REST.Config.cls",
        "ExecuteMCPv2.REST.Security.cls",
        "ExecuteMCPv2.REST.Interop.cls",
        "ExecuteMCPv2.REST.Dispatch.cls",
      ];
      for (const name of expected) {
        expect(BOOTSTRAP_CLASSES.has(name)).toBe(true);
      }
    });

    it("should have non-empty content for each class", () => {
      for (const [name, content] of BOOTSTRAP_CLASSES.entries()) {
        expect(content.length).toBeGreaterThan(0);
        expect(content).toContain("Class ");
        expect(content).toContain("Extends");
      }
    });

    it("should have Dispatch last in iteration order (compilation order)", () => {
      const keys = [...BOOTSTRAP_CLASSES.keys()];
      expect(keys[0]).toBe("ExecuteMCPv2.Utils.cls");
      expect(keys[1]).toBe("ExecuteMCPv2.Setup.cls");
      expect(keys[keys.length - 1]).toBe("ExecuteMCPv2.REST.Dispatch.cls");
    });
  });

  // ── getBootstrapClasses ──────────────────────────────────────────

  describe("getBootstrapClasses", () => {
    it("should return an array of BootstrapClass objects", () => {
      const classes = getBootstrapClasses();
      expect(Array.isArray(classes)).toBe(true);
      expect(classes.length).toBe(9);
    });

    it("should return classes in compilation order", () => {
      const classes = getBootstrapClasses();
      expect(classes[0]!.name).toBe("ExecuteMCPv2.Utils.cls");
      expect(classes[1]!.name).toBe("ExecuteMCPv2.Setup.cls");
      expect(classes[classes.length - 1]!.name).toBe("ExecuteMCPv2.REST.Dispatch.cls");
    });

    it("should include name and content for each class", () => {
      const classes = getBootstrapClasses();
      for (const cls of classes) {
        expect(cls.name).toBeDefined();
        expect(cls.content).toBeDefined();
        expect(cls.content.length).toBeGreaterThan(0);
        expect(cls.content).toContain("Class ");
      }
    });

    it("should include Interop.cls", () => {
      const classes = getBootstrapClasses();
      const interop = classes.find(c => c.name === "ExecuteMCPv2.REST.Interop.cls");
      expect(interop).toBeDefined();
      expect(interop!.content).toContain("ExecuteMCPv2.REST.Interop");
    });
  });
});
