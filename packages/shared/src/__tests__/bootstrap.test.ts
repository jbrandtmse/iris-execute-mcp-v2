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
    it("should return {status: 'current'} when deployed version matches BOOTSTRAP_VERSION", async () => {
      const config = makeConfig();
      const http = new IrisHttpClient(config);

      setupCsrfThenRequest(
        envelope({ content: [{ Version: BOOTSTRAP_VERSION }] }),
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
    it("should skip everything when probe is current (hash match)", async () => {
      const config = makeConfig();
      const http = new IrisHttpClient(config);

      // Probe: CSRF + SQL returning matching version
      setupCsrfThenRequest(
        envelope({ content: [{ Version: BOOTSTRAP_VERSION }] }),
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
    it("should redeploy + recompile but skip webapp+mapping when probe is stale", async () => {
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

      // NO Configure, NO Package mapping — they are intentionally skipped
      // on stale upgrades. If the implementation mistakenly calls them,
      // the next fetchMock call will be undefined and the test will fail.

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
      // already ran successfully in the past.
      expect(result.configured).toBe(true);
      expect(result.mapped).toBe(true);
      expect(result.unitTestRootEnsured).toBe(true);
      expect(result.unitTestRoot).toBe("/iris/mgr/");
      expect(result.errors).toHaveLength(0);
      expect(result.manualInstructions).toBeUndefined();

      // Verify the fetch call count: 1 CSRF + 1 probe SQL + 13 PUTs + 1 compile + 1 EnsureUnitTestRoot = 17
      // (no configure, no mapping)
      const expectedCallCount = 1 + 1 + BOOTSTRAP_CLASSES.size + 1 + 1;
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
    it("should contain exactly 13 classes", () => {
      expect(BOOTSTRAP_CLASSES.size).toBe(13);
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
        "ExecuteMCPv2.REST.Monitor.cls",
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
      expect(classes.length).toBe(13);
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
      ["ExecuteMCPv2.REST.Global.cls", "src/ExecuteMCPv2/REST/Global.cls"],
      ["ExecuteMCPv2.REST.Command.cls", "src/ExecuteMCPv2/REST/Command.cls"],
      ["ExecuteMCPv2.REST.UnitTest.cls", "src/ExecuteMCPv2/REST/UnitTest.cls"],
      ["ExecuteMCPv2.REST.Config.cls", "src/ExecuteMCPv2/REST/Config.cls"],
      ["ExecuteMCPv2.REST.Security.cls", "src/ExecuteMCPv2/REST/Security.cls"],
      ["ExecuteMCPv2.REST.Interop.cls", "src/ExecuteMCPv2/REST/Interop.cls"],
      ["ExecuteMCPv2.REST.Monitor.cls", "src/ExecuteMCPv2/REST/Monitor.cls"],
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
