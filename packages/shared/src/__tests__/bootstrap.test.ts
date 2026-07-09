import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createHash } from "crypto";
import { IrisHttpClient } from "../http-client.js";
import type { IrisConnectionConfig } from "../config.js";
import type { AtelierEnvelope } from "../http-client.js";
import {
  probeCustomRest,
  isConfigured,
  deployClasses,
  compileClasses,
  configureWebApp,
  bootstrap,
  MANUAL_INSTRUCTIONS,
} from "../bootstrap.js";
import {
  BOOTSTRAP_CLASSES,
  BOOTSTRAP_VERSION,
  getBootstrapClasses,
} from "../bootstrap-classes.js";

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
    it("should return {status: 'current'} when version matches AND web app is registered", async () => {
      const config = makeConfig();
      const http = new IrisHttpClient(config);

      // Probe SQL (version) — CSRF preflight + matching version
      setupCsrfThenRequest(
        envelope({ content: [{ Version: BOOTSTRAP_VERSION }] }),
      );
      // IsConfigured SQL — CSRF already cached, just the response (web app present)
      fetchMock.mockResolvedValueOnce(
        mockResponse(envelope({ content: [{ Configured: 1 }] })),
      );

      const result = await probeCustomRest(http, config, 7);
      expect(result).toEqual({ status: "current" });

      http.destroy();
    });

    // Regression for the reported bug: a matching class version does NOT
    // imply the privileged web-app registration completed. When the version
    // matches but IsConfigured() reports the web app is absent (e.g. %SYS
    // refreshed while the code DB persisted across a container migration),
    // the probe must report "unconfigured" so bootstrap re-runs the
    // privileged steps instead of skipping forever.
    it("should return {status: 'unconfigured'} when version matches but web app is absent", async () => {
      const config = makeConfig();
      const http = new IrisHttpClient(config);

      // Probe SQL (version) — matching version
      setupCsrfThenRequest(
        envelope({ content: [{ Version: BOOTSTRAP_VERSION }] }),
      );
      // IsConfigured SQL — web app NOT present (0)
      fetchMock.mockResolvedValueOnce(
        mockResponse(envelope({ content: [{ Configured: 0 }] })),
      );

      const result = await probeCustomRest(http, config, 7);
      expect(result).toEqual({ status: "unconfigured" });

      http.destroy();
    });

    // Defensive: IsConfigured() cannot be missing on a version-matched
    // deployment, so a thrown SQL error is an indeterminate result, not
    // proof the web app is absent. Preserve the fast "current" skip path
    // rather than re-attempting privileged steps every launch.
    it("should fall back to {status: 'current'} when version matches but IsConfigured query throws", async () => {
      const config = makeConfig();
      const http = new IrisHttpClient(config);

      // Probe SQL (version) — matching version
      setupCsrfThenRequest(
        envelope({ content: [{ Version: BOOTSTRAP_VERSION }] }),
      );
      // IsConfigured SQL — fails with 403 (Atelier-level error → throws)
      fetchMock.mockResolvedValueOnce(
        mockResponse(
          {
            status: { errors: [{ error: "SQL failure" }], summary: "Error" },
            console: [],
            result: null,
          },
          { status: 403 },
        ),
      );

      const result = await probeCustomRest(http, config, 7);
      expect(result).toEqual({ status: "current" });

      http.destroy();
    });

    it("should return {status: 'stale', deployedVersion} when deployed version differs", async () => {
      const config = makeConfig();
      const http = new IrisHttpClient(config);

      setupCsrfThenRequest(
        envelope({ content: [{ Version: "abcdef123456" }] }),
      );

      const result = await probeCustomRest(http, config, 7);
      expect(result).toEqual({ status: "stale", deployedVersion: "abcdef123456" });

      http.destroy();
    });

    it("should return {status: 'missing'} when SQL fails (class/method not found)", async () => {
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
      // SQL call fails with 400 — this is the pre-version-stamp upgrade
      // path, where old Setup.cls lacks GetBootstrapVersion()
      fetchMock.mockResolvedValueOnce(
        mockResponse(
          {
            status: {
              errors: [{ error: "Method not found" }],
              summary: "Error",
            },
            console: [],
            result: null,
          },
          { status: 400 },
        ),
      );

      const result = await probeCustomRest(http, config, 7);
      expect(result).toEqual({ status: "missing" });

      http.destroy();
    });

    it("should return {status: 'missing'} when SQL returns empty version string", async () => {
      const config = makeConfig();
      const http = new IrisHttpClient(config);

      setupCsrfThenRequest(
        envelope({ content: [{ Version: "" }] }),
      );

      const result = await probeCustomRest(http, config, 7);
      expect(result).toEqual({ status: "missing" });

      http.destroy();
    });
  });

  // ── isConfigured ────────────────────────────────────────────────

  describe("isConfigured", () => {
    it("should return true when IsConfigured() reports the web app exists (1)", async () => {
      const config = makeConfig();
      const http = new IrisHttpClient(config);

      setupCsrfThenRequest(envelope({ content: [{ Configured: 1 }] }));

      const result = await isConfigured(http, config, 7);
      expect(result).toBe(true);

      // Verify it calls the IsConfigured SqlProc via action/query
      const postCalls = fetchMock.mock.calls.filter((call: unknown[]) => {
        const opts = call[1] as { method: string };
        return opts.method === "POST";
      });
      expect(postCalls.length).toBe(1);
      const url = postCalls[0]![0] as string;
      expect(url).toContain("/api/atelier/v7/USER/action/query");
      const body = JSON.parse(postCalls[0]![1].body as string) as {
        query: string;
      };
      expect(body.query).toContain("ExecuteMCPv2.Setup_IsConfigured");

      http.destroy();
    });

    it("should return false when IsConfigured() reports the web app is absent (0)", async () => {
      const config = makeConfig();
      const http = new IrisHttpClient(config);

      setupCsrfThenRequest(envelope({ content: [{ Configured: 0 }] }));

      const result = await isConfigured(http, config, 7);
      expect(result).toBe(false);

      http.destroy();
    });

    it("should tolerate string/boolean encodings of the boolean result", async () => {
      const config = makeConfig();
      const http = new IrisHttpClient(config);

      setupCsrfThenRequest(envelope({ content: [{ Configured: "1" }] }));

      const result = await isConfigured(http, config, 7);
      expect(result).toBe(true);

      http.destroy();
    });

    it("should return false when the query returns no rows", async () => {
      const config = makeConfig();
      const http = new IrisHttpClient(config);

      setupCsrfThenRequest(envelope({ content: [] }));

      const result = await isConfigured(http, config, 7);
      expect(result).toBe(false);

      http.destroy();
    });

    it("should throw when the IsConfigured SQL call fails", async () => {
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
      // SQL fails with an Atelier-level error
      fetchMock.mockResolvedValueOnce(
        mockResponse(
          {
            status: { errors: [{ error: "SQL failure" }], summary: "Error" },
            console: [],
            result: null,
          },
          { status: 403 },
        ),
      );

      await expect(isConfigured(http, config, 7)).rejects.toThrow();

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
        expect(url).toMatch(/\.cls\?ignoreConflict=1$/);
      }

      http.destroy();
    });

    // Regression: Atelier's PUT /doc endpoint performs a timestamp-based
    // concurrency check and returns HTTP 409 for existing documents whose
    // server copy is considered newer than the incoming upload. The
    // auto-upgrade path (tri-state probe stale path) ALWAYS lands on
    // already-present documents, so every PUT must set ignoreConflict=1
    // or the entire upgrade fails on the first class. The old binary
    // probe hid this because it skipped deploy for existing installs.
    it("should append ignoreConflict=1 to every PUT URL", async () => {
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
      for (let i = 0; i < BOOTSTRAP_CLASSES.size; i++) {
        fetchMock.mockResolvedValueOnce(
          mockResponse(envelope({ result: [] })),
        );
      }

      await deployClasses(http, config, 7);

      const putCalls = fetchMock.mock.calls.filter((call: unknown[]) => {
        const opts = call[1] as { method: string };
        return opts.method === "PUT";
      });
      expect(putCalls.length).toBe(BOOTSTRAP_CLASSES.size);
      for (const putCall of putCalls) {
        const url = putCall[0] as string;
        expect(
          url,
          "Every deployClasses PUT must set ?ignoreConflict=1 to " +
            "bypass Atelier's timestamp concurrency check on upgrade",
        ).toContain("?ignoreConflict=1");
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
    it("should skip everything when probe is current (hash match + web app present)", async () => {
      const config = makeConfig();
      const http = new IrisHttpClient(config);

      // Probe: CSRF + SQL returning matching version
      setupCsrfThenRequest(
        envelope({ content: [{ Version: BOOTSTRAP_VERSION }] }),
      );
      // Probe: IsConfigured SQL — web app present
      fetchMock.mockResolvedValueOnce(
        mockResponse(envelope({ content: [{ Configured: 1 }] })),
      );

      const result = await bootstrap(http, config, 7);

      expect(result.probeStatus).toBe("current");
      expect(result.probeFound).toBe(true);
      expect(result.deployed).toBe(true);
      expect(result.compiled).toBe(true);
      expect(result.configured).toBe(true);
      expect(result.mapped).toBe(true);
      // ^UnitTestRoot was set on a prior install; current path skips the
      // re-check to keep the probe fast. Marked as ensured for callers.
      expect(result.unitTestRootEnsured).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.manualInstructions).toBeUndefined();

      // No deploy / compile on the current path: only 1 CSRF + 2 probe SQLs.
      expect(fetchMock).toHaveBeenCalledTimes(3);

      http.destroy();
    });

    // Regression for the reported bug: version-stamped classes present but
    // the /api/executemcp/v2 web app absent (e.g. %SYS refreshed across a
    // container migration while the code DB persisted). Bootstrap must NOT
    // skip — it must self-heal by RECOMPILING (no redeploy — source matches)
    // and re-running the privileged steps (configure + mapping + ^UnitTestRoot).
    // The recompile is required because the migration that lost the web app
    // can also leave stale/version-incompatible compiled objects (verified
    // live: dispatch 500s with <NULL VALUE> until recompiled).
    it("should self-heal (recompile + configure, no redeploy) when probe is unconfigured", async () => {
      const config = makeConfig();
      const http = new IrisHttpClient(config);

      // Probe: CSRF + SQL returning matching version
      setupCsrfThenRequest(
        envelope({ content: [{ Version: BOOTSTRAP_VERSION }] }),
      );
      // Probe: IsConfigured SQL — web app ABSENT
      fetchMock.mockResolvedValueOnce(
        mockResponse(envelope({ content: [{ Configured: 0 }] })),
      );

      // Recompile: POST action/compile response (NO deploy PUTs — source is current)
      fetchMock.mockResolvedValueOnce(mockResponse(envelope({ result: [] })));
      // Configure: POST response
      fetchMock.mockResolvedValueOnce(mockResponse(envelope({ content: [] })));
      // Package mapping: POST response
      fetchMock.mockResolvedValueOnce(mockResponse(envelope({ content: [] })));
      // EnsureUnitTestRoot: POST response
      fetchMock.mockResolvedValueOnce(
        mockResponse(envelope({ content: [{ UnitTestRoot: "/iris/mgr/" }] })),
      );

      const result = await bootstrap(http, config, 7);

      expect(result.probeStatus).toBe("unconfigured");
      expect(result.probeFound).toBe(true);
      expect(result.deployed).toBe(true);
      expect(result.compiled).toBe(true);
      expect(result.configured).toBe(true);
      expect(result.mapped).toBe(true);
      expect(result.unitTestRootEnsured).toBe(true);
      expect(result.unitTestRoot).toBe("/iris/mgr/");
      expect(result.errors).toHaveLength(0);
      expect(result.manualInstructions).toBeUndefined();

      // Verify NO deploy PUTs (source is current) but recompile DID happen.
      const putCalls = fetchMock.mock.calls.filter((call: unknown[]) => {
        const opts = call[1] as { method: string };
        return opts.method === "PUT";
      });
      expect(putCalls.length).toBe(0);
      const compileCalls = fetchMock.mock.calls.filter((call: unknown[]) => {
        const url = call[0] as string;
        return url.includes("action/compile");
      });
      expect(compileCalls.length).toBe(1);

      // 1 CSRF + 1 version SQL + 1 IsConfigured SQL + compile + configure + mapping + ensureRoot = 7
      expect(fetchMock).toHaveBeenCalledTimes(7);

      http.destroy();
    });

    // AC #2: if the connecting user lacks %Admin_Manage, the unconfigured
    // self-heal attempt reports configured=false with manual instructions
    // (rather than silently reporting "current"). A later launch by a
    // privileged user re-probes "unconfigured" and self-heals.
    it("should report configured=false + manualInstructions when unconfigured and Configure fails", async () => {
      const config = makeConfig();
      const http = new IrisHttpClient(config);

      // Probe: CSRF + SQL returning matching version
      setupCsrfThenRequest(
        envelope({ content: [{ Version: BOOTSTRAP_VERSION }] }),
      );
      // Probe: IsConfigured SQL — web app ABSENT
      fetchMock.mockResolvedValueOnce(
        mockResponse(envelope({ content: [{ Configured: 0 }] })),
      );

      // Recompile: POST action/compile response (runs before Configure on unconfigured)
      fetchMock.mockResolvedValueOnce(mockResponse(envelope({ result: [] })));
      // Configure: fails with 403 (no %Admin_Manage)
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
      // Package mapping: still attempted after configure failure
      fetchMock.mockResolvedValueOnce(mockResponse(envelope({ content: [] })));
      // EnsureUnitTestRoot: still attempted
      fetchMock.mockResolvedValueOnce(
        mockResponse(envelope({ content: [{ UnitTestRoot: "/iris/mgr/" }] })),
      );

      const result = await bootstrap(http, config, 7);

      expect(result.probeStatus).toBe("unconfigured");
      expect(result.deployed).toBe(true);
      expect(result.compiled).toBe(true);
      expect(result.configured).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain("Configure failed");
      expect(result.manualInstructions).toBeDefined();
      expect(result.manualInstructions).toContain("Terminal");
      expect(result.manualInstructions).toContain("USER");

      http.destroy();
    });

    it("should run full install when probe is missing", async () => {
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
      // Probe: SQL fails with 400 (GetBootstrapVersion not found)
      fetchMock.mockResolvedValueOnce(
        mockResponse(
          {
            status: { errors: [{ error: "Method not found" }], summary: "Error" },
            console: [],
            result: null,
          },
          { status: 400 },
        ),
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

      // EnsureUnitTestRoot: SQL POST returning the resulting global value
      fetchMock.mockResolvedValueOnce(
        mockResponse(
          envelope({ content: [{ UnitTestRoot: "/iris/mgr/" }] }),
        ),
      );

      const result = await bootstrap(http, config, 7);

      expect(result.probeStatus).toBe("missing");
      expect(result.probeFound).toBe(false);
      expect(result.deployed).toBe(true);
      expect(result.compiled).toBe(true);
      expect(result.configured).toBe(true);
      expect(result.mapped).toBe(true);
      expect(result.unitTestRootEnsured).toBe(true);
      expect(result.unitTestRoot).toBe("/iris/mgr/");
      expect(result.errors).toHaveLength(0);
      expect(result.manualInstructions).toBeUndefined();

      http.destroy();
    });

    // Regression: when the deployed version differs from the embedded
    // version (stale), bootstrap must redeploy and recompile the classes
    // but SKIP the privileged webapp registration and package mapping
    // steps — those are one-time operations that don't need to rerun on
    // a class-content upgrade.
    it("should redeploy + recompile but skip webapp+mapping when probe is stale and web app present", async () => {
      const config = makeConfig();
      const http = new IrisHttpClient(config);

      // Probe: CSRF + SQL returning an OLD version hash
      setupCsrfThenRequest(
        envelope({ content: [{ Version: "oldhash12345" }] }),
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

      // IsConfigured check on the stale path — web app IS present, so
      // Configure + Mapping are skipped.
      fetchMock.mockResolvedValueOnce(
        mockResponse(envelope({ content: [{ Configured: 1 }] })),
      );

      // NO Configure, NO Package mapping — skipped because the web app was
      // verified present. If the implementation mistakenly calls them, the
      // next fetchMock call would be the EnsureUnitTestRoot response and the
      // call-count assertion below would fail.

      // EnsureUnitTestRoot: runs on stale upgrades too (independent step)
      fetchMock.mockResolvedValueOnce(
        mockResponse(
          envelope({ content: [{ UnitTestRoot: "/iris/mgr/" }] }),
        ),
      );

      const result = await bootstrap(http, config, 7);

      expect(result.probeStatus).toBe("stale");
      expect(result.probeFound).toBe(true);
      expect(result.deployed).toBe(true);
      expect(result.compiled).toBe(true);
      // These are marked true on stale because the one-time install
      // already ran successfully in the past (verified via IsConfigured).
      expect(result.configured).toBe(true);
      expect(result.mapped).toBe(true);
      expect(result.unitTestRootEnsured).toBe(true);
      expect(result.unitTestRoot).toBe("/iris/mgr/");
      expect(result.errors).toHaveLength(0);
      expect(result.manualInstructions).toBeUndefined();

      // 1 CSRF + 1 probe SQL + 20 PUTs + 1 compile + 1 IsConfigured + 1 EnsureUnitTestRoot = 25
      // (no configure, no mapping)
      const expectedCallCount = 1 + 1 + BOOTSTRAP_CLASSES.size + 1 + 1 + 1;
      expect(fetchMock).toHaveBeenCalledTimes(expectedCallCount);

      http.destroy();
    });

    // Hardening for the reported root cause on the version-MISMATCH path: if
    // the classes are stale AND the web app is absent (e.g. %SYS refreshed
    // while the code DB persisted, then the MCP build was also upgraded),
    // bootstrap must redeploy/recompile AND self-heal the web app in the same
    // run — not skip it and leave the instance broken until the next restart.
    it("should redeploy + self-heal webapp when probe is stale and web app absent", async () => {
      const config = makeConfig();
      const http = new IrisHttpClient(config);

      // Probe: CSRF + SQL returning an OLD version hash
      setupCsrfThenRequest(
        envelope({ content: [{ Version: "oldhash12345" }] }),
      );

      // Deploy: PUT responses for each class
      for (let i = 0; i < BOOTSTRAP_CLASSES.size; i++) {
        fetchMock.mockResolvedValueOnce(
          mockResponse(envelope({ result: [] })),
        );
      }
      // Compile: POST response
      fetchMock.mockResolvedValueOnce(mockResponse(envelope({ result: [] })));
      // IsConfigured check on the stale path — web app ABSENT (0) → self-heal
      fetchMock.mockResolvedValueOnce(
        mockResponse(envelope({ content: [{ Configured: 0 }] })),
      );
      // Configure: POST response (self-heal)
      fetchMock.mockResolvedValueOnce(mockResponse(envelope({ content: [] })));
      // Package mapping: POST response (self-heal)
      fetchMock.mockResolvedValueOnce(mockResponse(envelope({ content: [] })));
      // EnsureUnitTestRoot: POST response
      fetchMock.mockResolvedValueOnce(
        mockResponse(envelope({ content: [{ UnitTestRoot: "/iris/mgr/" }] })),
      );

      const result = await bootstrap(http, config, 7);

      expect(result.probeStatus).toBe("stale");
      expect(result.deployed).toBe(true);
      expect(result.compiled).toBe(true);
      expect(result.configured).toBe(true);
      expect(result.mapped).toBe(true);
      expect(result.unitTestRootEnsured).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.manualInstructions).toBeUndefined();

      // Deploy DID happen (stale redeploys), and Configure DID happen (self-heal).
      const putCalls = fetchMock.mock.calls.filter((call: unknown[]) => {
        const opts = call[1] as { method: string };
        return opts.method === "PUT";
      });
      expect(putCalls.length).toBe(BOOTSTRAP_CLASSES.size);
      const configureCalls = fetchMock.mock.calls.filter((call: unknown[]) => {
        if ((call[1] as { method: string }).method !== "POST") return false;
        const body = (call[1] as { body?: string }).body;
        // "Setup_Configure(" — the trailing paren excludes "Setup_ConfigureMapping("
        return typeof body === "string" && body.includes("Setup_Configure(");
      });
      expect(configureCalls.length).toBe(1);

      // 1 CSRF + 1 probe SQL + 20 PUTs + 1 compile + 1 IsConfigured + configure + mapping + ensureRoot = 27
      const expectedCallCount = 1 + 1 + BOOTSTRAP_CLASSES.size + 1 + 1 + 1 + 1 + 1;
      expect(fetchMock).toHaveBeenCalledTimes(expectedCallCount);

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
      // Probe: SQL fails → missing → full install
      fetchMock.mockResolvedValueOnce(
        mockResponse(
          {
            status: { errors: [{ error: "Method not found" }], summary: "Error" },
            console: [],
            result: null,
          },
          { status: 400 },
        ),
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

      // EnsureUnitTestRoot: still attempted after configure failure (independent step)
      fetchMock.mockResolvedValueOnce(
        mockResponse(
          envelope({ content: [{ UnitTestRoot: "/iris/mgr/" }] }),
        ),
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
      // Probe: SQL fails → missing → full install
      fetchMock.mockResolvedValueOnce(
        mockResponse(
          {
            status: { errors: [{ error: "Method not found" }], summary: "Error" },
            console: [],
            result: null,
          },
          { status: 400 },
        ),
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
    it("should contain exactly 26 classes", () => {
      expect(BOOTSTRAP_CLASSES.size).toBe(26);
    });

    it("should contain all required class names", () => {
      const expected = [
        "ExecuteMCPv2.Utils.cls",
        "ExecuteMCPv2.Setup.cls",
        "ExecuteMCPv2.Diagram.Event.cls",
        "ExecuteMCPv2.Diagram.RenderEvent.cls",
        "ExecuteMCPv2.Diagram.Loader.cls",
        "ExecuteMCPv2.Diagram.Correlator.cls",
        "ExecuteMCPv2.Diagram.Compressor.cls",
        "ExecuteMCPv2.Diagram.Writer.cls",
        "ExecuteMCPv2.Diagram.Generate.cls",
        "ExecuteMCPv2.Loc.Classifier.cls",
        "ExecuteMCPv2.Loc.Scanner.cls",
        "ExecuteMCPv2.Loc.Generate.cls",
        "ExecuteMCPv2.REST.Global.cls",
        "ExecuteMCPv2.REST.Command.cls",
        "ExecuteMCPv2.REST.UnitTest.cls",
        "ExecuteMCPv2.REST.Config.cls",
        "ExecuteMCPv2.REST.Security.cls",
        "ExecuteMCPv2.REST.Interop.cls",
        "ExecuteMCPv2.REST.MessageResend.cls",
        "ExecuteMCPv2.REST.Loc.cls",
        "ExecuteMCPv2.REST.Monitor.cls",
        "ExecuteMCPv2.REST.Health.cls",
        "ExecuteMCPv2.REST.Task.cls",
        "ExecuteMCPv2.REST.SystemConfig.cls",
        "ExecuteMCPv2.REST.Analytics.cls",
        "ExecuteMCPv2.REST.Dispatch.cls",
      ];
      for (const name of expected) {
        expect(BOOTSTRAP_CLASSES.has(name)).toBe(true);
      }
    });

    it("should have non-empty content for each class", () => {
      for (const content of BOOTSTRAP_CLASSES.values()) {
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
      expect(classes.length).toBe(26);
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

    it("should include Monitor.cls (Epic 6)", () => {
      const classes = getBootstrapClasses();
      const monitor = classes.find(c => c.name === "ExecuteMCPv2.REST.Monitor.cls");
      expect(monitor).toBeDefined();
      expect(monitor!.content).toContain("ExecuteMCPv2.REST.Monitor");
    });

    it("should include Health.cls (Story 23.1)", () => {
      const classes = getBootstrapClasses();
      const health = classes.find(c => c.name === "ExecuteMCPv2.REST.Health.cls");
      expect(health).toBeDefined();
      expect(health!.content).toContain("ExecuteMCPv2.REST.Health");
    });

    it("should include Task.cls (Epic 6)", () => {
      const classes = getBootstrapClasses();
      const task = classes.find(c => c.name === "ExecuteMCPv2.REST.Task.cls");
      expect(task).toBeDefined();
      expect(task!.content).toContain("ExecuteMCPv2.REST.Task");
    });

    it("should include SystemConfig.cls (Epic 6)", () => {
      const classes = getBootstrapClasses();
      const sysConfig = classes.find(c => c.name === "ExecuteMCPv2.REST.SystemConfig.cls");
      expect(sysConfig).toBeDefined();
      expect(sysConfig!.content).toContain("ExecuteMCPv2.REST.SystemConfig");
    });

    it("should include Analytics.cls (Epic 7)", () => {
      const classes = getBootstrapClasses();
      const analytics = classes.find(c => c.name === "ExecuteMCPv2.REST.Analytics.cls");
      expect(analytics).toBeDefined();
      expect(analytics!.content).toContain("ExecuteMCPv2.REST.Analytics");
    });
  });

  // ── BOOTSTRAP_VERSION ───────────────────────────────────────────

  describe("BOOTSTRAP_VERSION", () => {
    it("should be a non-empty hex string", () => {
      expect(typeof BOOTSTRAP_VERSION).toBe("string");
      expect(BOOTSTRAP_VERSION.length).toBeGreaterThan(0);
      // 12-char short SHA-256 is the current format (gen-bootstrap.mjs)
      expect(BOOTSTRAP_VERSION).toMatch(/^[0-9a-f]{12}$/);
    });

    it("should be injected into the embedded Setup.cls BOOTSTRAPVERSION parameter", () => {
      // The embedded copy of Setup.cls must contain the real hash, not the
      // "dev" placeholder that lives in src/ExecuteMCPv2/Setup.cls on disk.
      // This is the contract that makes the auto-upgrade mechanism work.
      const setupSource = BOOTSTRAP_CLASSES.get("ExecuteMCPv2.Setup.cls");
      expect(setupSource).toBeDefined();
      expect(setupSource).toContain(
        `Parameter BOOTSTRAPVERSION = "${BOOTSTRAP_VERSION}";`,
      );
      // And the disk placeholder must NOT have leaked into the embedded copy.
      expect(setupSource).not.toContain('Parameter BOOTSTRAPVERSION = "dev";');
    });
  });

  // ── Bootstrap drift check ──────────────────────────────────────
  //
  // These tests enforce the workflow discipline "after editing any
  // ObjectScript class, run `npm run gen:bootstrap` and commit the
  // regenerated bootstrap-classes.ts". They compare the embedded class
  // content (and the BOOTSTRAP_VERSION hash) against the disk .cls files
  // and fail with a clear "run gen:bootstrap" message on drift. Without
  // this test, a dev could edit Security.cls, forget to regenerate, and
  // ship a bug that auto-upgrade wouldn't detect because the embedded
  // BOOTSTRAP_VERSION would still match the deployed (stale) version.

  describe("bootstrap drift check", () => {
    // Repo root is 4 levels up from this test file:
    // packages/shared/src/__tests__/bootstrap.test.ts → repo root
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const repoRoot = resolve(__dirname, "../../../..");

    // MUST stay in sync with scripts/gen-bootstrap.mjs
    const classPaths: ReadonlyArray<readonly [string, string]> = [
      ["ExecuteMCPv2.Utils.cls", "src/ExecuteMCPv2/Utils.cls"],
      ["ExecuteMCPv2.Setup.cls", "src/ExecuteMCPv2/Setup.cls"],
      ["ExecuteMCPv2.Diagram.Event.cls", "src/ExecuteMCPv2/Diagram/Event.cls"],
      ["ExecuteMCPv2.Diagram.RenderEvent.cls", "src/ExecuteMCPv2/Diagram/RenderEvent.cls"],
      ["ExecuteMCPv2.Diagram.Loader.cls", "src/ExecuteMCPv2/Diagram/Loader.cls"],
      ["ExecuteMCPv2.Diagram.Correlator.cls", "src/ExecuteMCPv2/Diagram/Correlator.cls"],
      ["ExecuteMCPv2.Diagram.Compressor.cls", "src/ExecuteMCPv2/Diagram/Compressor.cls"],
      ["ExecuteMCPv2.Diagram.Writer.cls", "src/ExecuteMCPv2/Diagram/Writer.cls"],
      ["ExecuteMCPv2.Diagram.Generate.cls", "src/ExecuteMCPv2/Diagram/Generate.cls"],
      ["ExecuteMCPv2.Loc.Classifier.cls", "src/ExecuteMCPv2/Loc/Classifier.cls"],
      ["ExecuteMCPv2.Loc.Scanner.cls", "src/ExecuteMCPv2/Loc/Scanner.cls"],
      ["ExecuteMCPv2.Loc.Generate.cls", "src/ExecuteMCPv2/Loc/Generate.cls"],
      ["ExecuteMCPv2.REST.Global.cls", "src/ExecuteMCPv2/REST/Global.cls"],
      ["ExecuteMCPv2.REST.Command.cls", "src/ExecuteMCPv2/REST/Command.cls"],
      ["ExecuteMCPv2.REST.UnitTest.cls", "src/ExecuteMCPv2/REST/UnitTest.cls"],
      ["ExecuteMCPv2.REST.Config.cls", "src/ExecuteMCPv2/REST/Config.cls"],
      ["ExecuteMCPv2.REST.Security.cls", "src/ExecuteMCPv2/REST/Security.cls"],
      ["ExecuteMCPv2.REST.Interop.cls", "src/ExecuteMCPv2/REST/Interop.cls"],
      ["ExecuteMCPv2.REST.MessageResend.cls", "src/ExecuteMCPv2/REST/MessageResend.cls"],
      ["ExecuteMCPv2.REST.Loc.cls", "src/ExecuteMCPv2/REST/Loc.cls"],
      ["ExecuteMCPv2.REST.Monitor.cls", "src/ExecuteMCPv2/REST/Monitor.cls"],
      ["ExecuteMCPv2.REST.Health.cls", "src/ExecuteMCPv2/REST/Health.cls"],
      ["ExecuteMCPv2.REST.Task.cls", "src/ExecuteMCPv2/REST/Task.cls"],
      ["ExecuteMCPv2.REST.SystemConfig.cls", "src/ExecuteMCPv2/REST/SystemConfig.cls"],
      ["ExecuteMCPv2.REST.Analytics.cls", "src/ExecuteMCPv2/REST/Analytics.cls"],
      ["ExecuteMCPv2.REST.Dispatch.cls", "src/ExecuteMCPv2/REST/Dispatch.cls"],
    ];

    const VERSION_PLACEHOLDER_LINE = 'Parameter BOOTSTRAPVERSION = "dev";';
    const DRIFT_HINT =
      "bootstrap-classes.ts is out of sync with disk. " +
      "Run `npm run gen:bootstrap` and commit the regenerated file.";

    /**
     * Read a .cls file and normalize line endings to LF, mirroring the
     * normalization in gen-bootstrap.mjs. This is required because
     * template literals in bootstrap-classes.ts get their CRLFs
     * normalized to LF at JS parse time, so the runtime embedded string
     * always has LF regardless of the disk EOL style.
     */
    const readClsNormalized = (relPath: string): string => {
      return readFileSync(resolve(repoRoot, relPath), "utf-8")
        .replace(/\r\n/g, "\n")
        .trimEnd();
    };

    it("embedded class contents match disk .cls files", () => {
      for (const [name, relPath] of classPaths) {
        const diskContent = readClsNormalized(relPath);
        const embedded = BOOTSTRAP_CLASSES.get(name);

        expect(embedded, `Missing class in BOOTSTRAP_CLASSES: ${name}`).toBeDefined();

        // Setup.cls gets hash injection in gen-bootstrap.mjs — apply
        // the same transform here before comparing.
        const expected =
          name === "ExecuteMCPv2.Setup.cls"
            ? diskContent.replace(
                VERSION_PLACEHOLDER_LINE,
                `Parameter BOOTSTRAPVERSION = "${BOOTSTRAP_VERSION}";`,
              )
            : diskContent;

        expect(
          embedded,
          `${DRIFT_HINT} (class: ${name})`,
        ).toBe(expected);
      }
    });

    it("BOOTSTRAP_VERSION matches SHA-256 hash of concatenated disk contents", () => {
      // Re-compute the hash with the same formula as gen-bootstrap.mjs.
      // If a dev edits any .cls file without running gen:bootstrap, this
      // test fails with a clear instruction.
      const hasher = createHash("sha256");
      for (const [, relPath] of classPaths) {
        hasher.update(readClsNormalized(relPath));
        hasher.update("\n--CLASS-SEPARATOR--\n");
      }
      const expectedVersion = hasher.digest("hex").substring(0, 12);

      expect(
        BOOTSTRAP_VERSION,
        `BOOTSTRAP_VERSION drift: ${DRIFT_HINT}`,
      ).toBe(expectedVersion);
    });
  });
});
