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
import { parseBootstrapMarker } from "../bootstrap-version.js";

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * The embedded marker moved by `change`: each number is added to the matching
 * part of `BOOTSTRAP_VERSION`, and `hash` replaces its hash.
 */
function embeddedMarkerMoved(change: {
  major?: number;
  minor?: number;
  patch?: number;
  sequence?: number;
  hash?: string;
}): string {
  const parsed = parseBootstrapMarker(BOOTSTRAP_VERSION);
  if (parsed.kind !== "stamped") throw new Error(`the embedded marker ${BOOTSTRAP_VERSION} is not stamped`);
  const [major, minor, patch] = parsed.semver;
  return (
    `${Number(major) + (change.major ?? 0)}.${Number(minor) + (change.minor ?? 0)}.${Number(patch) + (change.patch ?? 0)}` +
    `+${Number(parsed.sequence) + (change.sequence ?? 0)}.${change.hash ?? parsed.hash}`
  );
}

/** An Atelier reply to the `Setup_GetBootstrapVersion()` query. */
function versionReply(version: string): Response {
  return mockResponse(envelope({ content: [{ Version: version }] }));
}

/** An Atelier reply to a query whose method does not exist, as a missing deployment answers it. */
function missingMethodReply(): Response {
  return mockResponse(
    {
      status: { errors: [{ error: "Method not found" }], summary: "Error" },
      console: [],
      result: null,
    },
    { status: 400 },
  );
}

/**
 * The Atelier reply to `GET doc/ExecuteMCPv2.Setup.cls` when the class does not exist: HTTP 404, as Atelier's GetDoc
 * answers a missing document (live check 2026-10-22: `iris_doc_get` of a missing document in HSCUSTOM took its
 * `statusCode === 404` branch). Only the status decides; the envelope carries no error.
 */
function setupAbsentReply(): Response {
  return mockResponse({ status: { errors: [], summary: "" }, console: [], result: {} }, { status: 404 });
}

/** The Atelier reply to `GET doc/ExecuteMCPv2.Setup.cls` when the class exists. */
function setupFoundReply(): Response {
  return mockResponse(
    envelope({ name: "ExecuteMCPv2.Setup.cls", cat: "CLS", ts: "2026-10-21 12:00:00.000", status: "", enc: false, content: ["Class ExecuteMCPv2.Setup", "{", "}"] }),
  );
}

/** The number of recorded fetch calls that GET the `ExecuteMCPv2.Setup.cls` document. */
function setupDocGetCount(fetchMock: ReturnType<typeof vi.fn>): number {
  return fetchMock.mock.calls.filter(
    (call: unknown[]) => (call[1] as { method?: string }).method === "GET" && String(call[0]).endsWith("/doc/ExecuteMCPv2.Setup.cls"),
  ).length;
}

/** Every `[WARN]` line written to the (mocked) console.error since the test began. */
function warnLines(): string[] {
  return vi
    .mocked(console.error)
    .mock.calls.map((call) => String(call[0]))
    .filter((line) => line.startsWith("[WARN]"));
}

/** The number of recorded fetch calls that are PUTs. */
function putCount(fetchMock: ReturnType<typeof vi.fn>): number {
  return fetchMock.mock.calls.filter((call: unknown[]) => (call[1] as { method?: string }).method === "PUT").length;
}

/** The number of recorded fetch calls that compile. */
function compileCount(fetchMock: ReturnType<typeof vi.fn>): number {
  return fetchMock.mock.calls.filter((call: unknown[]) => String(call[0]).includes("action/compile")).length;
}

/** The number of recorded fetch calls whose body names `Setup_<name>(` or `Setup_<name>()`. */
function setupCallCount(fetchMock: ReturnType<typeof vi.fn>, name: string): number {
  return fetchMock.mock.calls.filter((call: unknown[]) => {
    const body = (call[1] as { body?: unknown }).body;
    return typeof body === "string" && body.includes(`Setup_${name}(`);
  }).length;
}

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

    // The deployed marker is ORDERED against the embedded one: only an older
    // deployment is stale (redeployable); a newer or foreign one is left alone,
    // and neither makes an IsConfigured() call (CSRF preflight + one version query).
    it.each([
      { label: "a higher major", deployed: embeddedMarkerMoved({ major: 1 }), expected: "newer" },
      { label: "a higher minor", deployed: embeddedMarkerMoved({ minor: 1 }), expected: "newer" },
      { label: "a higher patch", deployed: embeddedMarkerMoved({ patch: 1 }), expected: "newer" },
      { label: "the same semver and a higher sequence", deployed: embeddedMarkerMoved({ sequence: 1 }), expected: "newer" },
      { label: "a higher semver with a lower sequence", deployed: embeddedMarkerMoved({ major: 1, sequence: -1 }), expected: "newer" },
      { label: "the same semver and sequence with a different hash", deployed: embeddedMarkerMoved({ hash: "ffffffffffff" }), expected: "foreign" },
      { label: "the dev placeholder", deployed: "dev", expected: "foreign" },
      { label: "an unparseable value", deployed: "not a marker", expected: "foreign" },
    ])("should return {status: '$expected'} without an IsConfigured call for $label", async ({ deployed, expected }) => {
      const config = makeConfig();
      const http = new IrisHttpClient(config);

      setupCsrfThenRequest(envelope({ content: [{ Version: deployed }] }));

      const result = await probeCustomRest(http, config, 7);
      expect(result).toEqual({ status: expected, deployedVersion: deployed });
      expect(fetchMock).toHaveBeenCalledTimes(2);

      http.destroy();
    });

    it.each([
      { label: "a legacy bare hash", deployed: "abcdef123456" },
      { label: "a lower semver with a higher sequence", deployed: "0.0.0+999999.aaaaaaaaaaaa" },
      { label: "the same semver and a lower sequence", deployed: embeddedMarkerMoved({ sequence: -1 }) },
    ])("should return {status: 'stale'} for an older deployment: $label", async ({ deployed }) => {
      const config = makeConfig();
      const http = new IrisHttpClient(config);

      setupCsrfThenRequest(envelope({ content: [{ Version: deployed }] }));

      expect(await probeCustomRest(http, config, 7)).toEqual({ status: "stale", deployedVersion: deployed });

      http.destroy();
    });

    it("should return {status: 'missing'} when SQL fails AND the Setup document route answers 404 (a positive absence)", async () => {
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
      // SQL call fails: the GetBootstrapVersion function does not exist
      fetchMock.mockResolvedValueOnce(missingMethodReply());
      // GET doc/ExecuteMCPv2.Setup.cls: 404, the class does not exist
      fetchMock.mockResolvedValueOnce(setupAbsentReply());

      const result = await probeCustomRest(http, config, 7);
      expect(result).toEqual({ status: "missing" });
      expect(setupDocGetCount(fetchMock)).toBe(1);
      expect(String(fetchMock.mock.calls[2]?.[0])).toBe("http://localhost:52773/api/atelier/v7/USER/doc/ExecuteMCPv2.Setup.cls");

      http.destroy();
    });

    it("should return {status: 'missing'} when SQL returns an empty version string AND the Setup document route answers 404", async () => {
      const config = makeConfig();
      const http = new IrisHttpClient(config);

      setupCsrfThenRequest(
        envelope({ content: [{ Version: "" }] }),
      );
      fetchMock.mockResolvedValueOnce(setupAbsentReply());

      const result = await probeCustomRest(http, config, 7);
      expect(result).toEqual({ status: "missing" });

      http.destroy();
    });

    it("should return {status: 'unknown'} when SQL fails while the Setup class exists, naming both findings (DW-673)", async () => {
      const config = makeConfig();
      const http = new IrisHttpClient(config);

      setupCsrfThenRequest({ status: { errors: [{ error: "Internal error" }], summary: "Error" }, console: [], result: null }, 500);
      fetchMock.mockResolvedValueOnce(setupFoundReply());

      const result = await probeCustomRest(http, config, 7);
      expect(result.status).toBe("unknown");
      const reason = (result as { reason: string }).reason;
      expect(reason).toContain("the version query failed: IRIS returned HTTP 500");
      expect(reason).toContain("and the ExecuteMCPv2.Setup class exists");
      // No IsConfigured call: CSRF, the version query and the document GET only.
      expect(fetchMock).toHaveBeenCalledTimes(3);

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

    // A caller that deploys documents of its own (the CI seed's test fixtures) passes its own map; the bootstrap
    // flow passes none and keeps today's requests.
    it("deploys exactly the documents of the map it is given, with the same URL shape", async () => {
      const config = makeConfig();
      const http = new IrisHttpClient(config);
      fetchMock.mockResolvedValueOnce(
        mockResponse("", {
          status: 200,
          headers: { "X-CSRF-Token": "test-csrf-token" },
          setCookie: ["CSPSESSIONID=s1; path=/"],
        }),
      );
      fetchMock.mockResolvedValueOnce(mockResponse(envelope({ result: [] })));
      fetchMock.mockResolvedValueOnce(mockResponse(envelope({ result: [] })));

      await deployClasses(
        http,
        config,
        7,
        new Map([
          ["ExecuteMCPv2.Tests.First.cls", "Class ExecuteMCPv2.Tests.First {\n}"],
          ["ExecuteMCPv2.QAFixtures.Second.cls", "Class ExecuteMCPv2.QAFixtures.Second {\n}"],
        ]),
      );

      const putCalls = fetchMock.mock.calls.filter((call: unknown[]) => (call[1] as { method: string }).method === "PUT");
      expect(putCalls.map((call: unknown[]) => call[0] as string)).toEqual([
        expect.stringMatching(/\/api\/atelier\/v7\/USER\/doc\/ExecuteMCPv2\.Tests\.First\.cls\?ignoreConflict=1$/),
        expect.stringMatching(/\/api\/atelier\/v7\/USER\/doc\/ExecuteMCPv2\.QAFixtures\.Second\.cls\?ignoreConflict=1$/),
      ]);
      expect(JSON.parse(putCalls[0]![1].body as string)).toEqual({ enc: false, content: ["Class ExecuteMCPv2.Tests.First {", "}"] });

      http.destroy();
    });
  });

  // ── compileClasses ──────────────────────────────────────────────

  describe("compileClasses", () => {
    it("compiles the names it is given and returns the Atelier response", async () => {
      const config = makeConfig();
      const http = new IrisHttpClient(config);
      const reply = envelope({ content: [{ name: "ExecuteMCPv2.Tests.First.cls", status: "" }] });
      setupCsrfThenRequest(reply);

      const response = await compileClasses(http, config, 7, ["ExecuteMCPv2.Tests.First.cls"]);

      const postCalls = fetchMock.mock.calls.filter((call: unknown[]) => (call[1] as { method: string }).method === "POST");
      expect(postCalls.length).toBe(1);
      expect(JSON.parse(postCalls[0]![1].body as string)).toEqual(["ExecuteMCPv2.Tests.First.cls"]);
      expect(response.result).toEqual({ content: [{ name: "ExecuteMCPv2.Tests.First.cls", status: "" }] });

      http.destroy();
    });

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

      // Re-probe immediately before the compile: the marker is still the embedded one
      fetchMock.mockResolvedValueOnce(versionReply(BOOTSTRAP_VERSION));
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

      // 1 CSRF + 1 version SQL + 1 IsConfigured SQL + 1 re-probe + compile + configure + mapping + ensureRoot = 8
      expect(fetchMock).toHaveBeenCalledTimes(8);

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

      // Re-probe immediately before the compile: the marker is still the embedded one
      fetchMock.mockResolvedValueOnce(versionReply(BOOTSTRAP_VERSION));
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
      // Probe: GET doc/ExecuteMCPv2.Setup.cls answers 404 — the class is provably absent
      fetchMock.mockResolvedValueOnce(setupAbsentReply());

      // Deploy: PUT responses for each class (CSRF already established)
      for (let i = 0; i < BOOTSTRAP_CLASSES.size; i++) {
        fetchMock.mockResolvedValueOnce(
          mockResponse(envelope({ result: [] })),
        );
      }

      // Re-probe immediately before the compile: the uploaded classes are not
      // compiled yet, so no marker exists — the expected state after a positive absence
      fetchMock.mockResolvedValueOnce(missingMethodReply());

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
      expect(setupDocGetCount(fetchMock), "the probe proved the Setup class absent").toBe(1);
      expect(warnLines()).toEqual([]);

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

      // Probe: CSRF + SQL returning an OLD (legacy bare hash) version
      setupCsrfThenRequest(
        envelope({ content: [{ Version: "abcdef123456" }] }),
      );

      // Deploy: PUT responses for each class (CSRF already established)
      for (let i = 0; i < BOOTSTRAP_CLASSES.size; i++) {
        fetchMock.mockResolvedValueOnce(
          mockResponse(envelope({ result: [] })),
        );
      }

      // Re-probe immediately before the compile: the compiled marker is still the old one
      fetchMock.mockResolvedValueOnce(versionReply("abcdef123456"));

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

      // 1 CSRF + 1 probe SQL + one PUT per class + 1 re-probe + 1 compile + 1 IsConfigured + 1 EnsureUnitTestRoot
      // (no configure, no mapping)
      const expectedCallCount = 1 + 1 + BOOTSTRAP_CLASSES.size + 1 + 1 + 1 + 1;
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

      // Probe: CSRF + SQL returning an OLD (legacy bare hash) version
      setupCsrfThenRequest(
        envelope({ content: [{ Version: "abcdef123456" }] }),
      );

      // Deploy: PUT responses for each class
      for (let i = 0; i < BOOTSTRAP_CLASSES.size; i++) {
        fetchMock.mockResolvedValueOnce(
          mockResponse(envelope({ result: [] })),
        );
      }
      // Re-probe immediately before the compile: the compiled marker is still the old one
      fetchMock.mockResolvedValueOnce(versionReply("abcdef123456"));
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

      // 1 CSRF + 1 probe SQL + one PUT per class + 1 re-probe + 1 compile + 1 IsConfigured + configure + mapping + ensureRoot
      const expectedCallCount = 1 + 1 + BOOTSTRAP_CLASSES.size + 1 + 1 + 1 + 1 + 1 + 1;
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
      // Probe: GET doc/ExecuteMCPv2.Setup.cls answers 404 — the class is provably absent
      fetchMock.mockResolvedValueOnce(setupAbsentReply());

      // Deploy: PUT responses for each class
      for (let i = 0; i < BOOTSTRAP_CLASSES.size; i++) {
        fetchMock.mockResolvedValueOnce(
          mockResponse(envelope({ result: [] })),
        );
      }

      // Re-probe immediately before the compile: still no deployment
      fetchMock.mockResolvedValueOnce(missingMethodReply());

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
      // Probe: GET doc/ExecuteMCPv2.Setup.cls answers 404 — the class is provably absent
      fetchMock.mockResolvedValueOnce(setupAbsentReply());

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

  // ── The downgrade guard (DW-508) ─────────────────────────────────

  describe("bootstrap never replaces a newer or foreign deployment", () => {
    function queuePutReplies(): void {
      for (let i = 0; i < BOOTSTRAP_CLASSES.size; i++) {
        fetchMock.mockResolvedValueOnce(mockResponse(envelope({ result: [] })));
      }
    }

    const NEWER_SEQUENCE = embeddedMarkerMoved({ sequence: 1 });
    const NEWER_MAJOR = embeddedMarkerMoved({ major: 1 });
    const FOREIGN_HASH = embeddedMarkerMoved({ hash: "ffffffffffff" });

    it.each([
      { label: "the same semver and a higher sequence", deployed: NEWER_SEQUENCE, status: "newer" },
      { label: "a higher semver", deployed: NEWER_MAJOR, status: "newer" },
      { label: "the same semver and sequence with a different hash", deployed: FOREIGN_HASH, status: "foreign" },
      { label: "the dev placeholder", deployed: "dev", status: "foreign" },
      { label: "an unparseable value", deployed: "garbage", status: "foreign" },
    ])("a $status deployment ($label): no PUT, no compile, no Configure, no mapping, no ^UnitTestRoot, one warning naming both markers", async ({ deployed, status }) => {
      const config = makeConfig();
      const http = new IrisHttpClient(config);
      setupCsrfThenRequest(envelope({ content: [{ Version: deployed }] }));

      const result = await bootstrap(http, config, 7);

      expect(result.probeStatus).toBe(status);
      expect(result.probeFound).toBe(true);
      expect(result.deployedVersion).toBe(deployed);
      expect(result.deployed).toBe(false);
      expect(result.compiled).toBe(false);
      expect(result.configured).toBe(false);
      expect(result.mapped).toBe(false);
      expect(result.unitTestRootEnsured).toBe(false);
      expect(result.errors).toEqual([]);
      expect(result.manualInstructions).toBeUndefined();

      // Only the CSRF preflight and the version query: nothing was written or asked.
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(putCount(fetchMock)).toBe(0);
      expect(compileCount(fetchMock)).toBe(0);
      for (const name of ["IsConfigured", "Configure", "ConfigureMapping", "EnsureUnitTestRoot"]) {
        expect(setupCallCount(fetchMock, name), `Setup_${name}`).toBe(0);
      }

      const warnings = warnLines();
      expect(warnings, "exactly one warning").toHaveLength(1);
      expect(warnings[0]).toContain(deployed);
      expect(warnings[0]).toContain(BOOTSTRAP_VERSION);
      expect(warnings[0], "the namespace and the instance").toContain("in 'USER' on localhost:52773 alone");
      expect(warnings[0], "nothing was uploaded").not.toContain("had already uploaded");

      http.destroy();
    });

    it("the warning for a newer deployment names the remedy: upgrade to the deployed semver and sequence, on every client", async () => {
      const config = makeConfig();
      const http = new IrisHttpClient(config);
      setupCsrfThenRequest(envelope({ content: [{ Version: NEWER_SEQUENCE }] }));

      await bootstrap(http, config, 7);

      const parsed = parseBootstrapMarker(NEWER_SEQUENCE);
      if (parsed.kind !== "stamped") throw new Error("the fixture marker must be stamped");
      const [warning] = warnLines();
      expect(warning).toContain("is newer than this server's");
      expect(warning).toContain("Upgrade this server to a build at least as new as the deployed one");
      expect(warning).toContain(`(semver ${parsed.semver.join(".")}, sequence ${parsed.sequence})`);
      expect(warning).toContain("run the same or a newer build on every client that shares the instance");

      http.destroy();
    });

    it("the warning for a foreign deployment names the remedy: one build per instance, or delete ExecuteMCPv2.Setup and restart", async () => {
      const config = makeConfig();
      const http = new IrisHttpClient(config);
      setupCsrfThenRequest(envelope({ content: [{ Version: FOREIGN_HASH }] }));

      await bootstrap(http, config, 7);

      const [warning] = warnLines();
      expect(warning).toContain("cannot be ordered against this server's");
      expect(warning).toContain("Run one build per instance");
      expect(warning).toContain("delete class ExecuteMCPv2.Setup in 'USER' and restart this server");

      http.destroy();
    });

    it("a deployed marker is quoted and cut at 80 characters, and a line break inside it stays inside the one warning line", async () => {
      const longMarker = "x".repeat(300);
      const multiLineMarker = "x\n[ERROR] injected line";
      for (const deployed of [longMarker, multiLineMarker]) {
        vi.mocked(console.error).mockClear();
        const config = makeConfig();
        const http = new IrisHttpClient(config);
        setupCsrfThenRequest(envelope({ content: [{ Version: deployed }] }));

        await bootstrap(http, config, 7);

        const warnings = warnLines();
        expect(warnings, "exactly one warning").toHaveLength(1);
        expect(warnings[0]).not.toContain("\n");
        const written = vi.mocked(console.error).mock.calls.map((call) => String(call[0]));
        expect(written.filter((line) => line.startsWith("[ERROR]") || line.includes("\n"))).toEqual([]);
        if (deployed === longMarker) {
          expect(warnings[0]).toContain(JSON.stringify(`${"x".repeat(80)}...`));
          expect(warnings[0]).not.toContain("x".repeat(81));
        } else {
          expect(warnings[0]).toContain(JSON.stringify(multiLineMarker));
        }

        http.destroy();
      }
    });

    it("an older deployment logs no warning and is upgraded as before", async () => {
      const config = makeConfig();
      const http = new IrisHttpClient(config);
      setupCsrfThenRequest(envelope({ content: [{ Version: "abcdef123456" }] }));
      queuePutReplies();
      fetchMock.mockResolvedValueOnce(versionReply("abcdef123456"));
      fetchMock.mockResolvedValueOnce(mockResponse(envelope({ result: [] })));
      fetchMock.mockResolvedValueOnce(mockResponse(envelope({ content: [{ Configured: 1 }] })));
      fetchMock.mockResolvedValueOnce(mockResponse(envelope({ content: [{ UnitTestRoot: "/iris/mgr/" }] })));

      const result = await bootstrap(http, config, 7);

      expect(result.probeStatus).toBe("stale");
      expect(result.deployedVersion).toBe("abcdef123456");
      expect(putCount(fetchMock)).toBe(BOOTSTRAP_CLASSES.size);
      expect(compileCount(fetchMock)).toBe(1);
      expect(warnLines()).toEqual([]);

      http.destroy();
    });

    // Race: a newer build compiled between this server's probe and its compile.
    it("an older probe followed by a newer re-read: the classes were uploaded, but no compile and nothing later runs; one warning", async () => {
      const config = makeConfig();
      const http = new IrisHttpClient(config);
      setupCsrfThenRequest(envelope({ content: [{ Version: "abcdef123456" }] }));
      queuePutReplies();
      fetchMock.mockResolvedValueOnce(versionReply(NEWER_SEQUENCE));

      const result = await bootstrap(http, config, 7);

      expect(result.probeStatus).toBe("newer");
      expect(result.deployedVersion).toBe(NEWER_SEQUENCE);
      expect(result.deployed).toBe(true);
      expect(result.compiled).toBe(false);
      expect(result.configured).toBe(false);
      expect(result.mapped).toBe(false);
      expect(result.unitTestRootEnsured).toBe(false);
      expect(result.errors).toEqual([]);
      expect(compileCount(fetchMock)).toBe(0);
      for (const name of ["IsConfigured", "Configure", "ConfigureMapping", "EnsureUnitTestRoot"]) {
        expect(setupCallCount(fetchMock, name), `Setup_${name}`).toBe(0);
      }
      // CSRF + probe + one PUT per class + the re-read, and nothing after it.
      expect(fetchMock).toHaveBeenCalledTimes(1 + 1 + BOOTSTRAP_CLASSES.size + 1);

      const warnings = warnLines();
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("found just before compiling");
      expect(warnings[0]).toContain(NEWER_SEQUENCE);
      expect(warnings[0]).toContain(BOOTSTRAP_VERSION);
      expect(warnings[0], "the uploads that already landed, and how to reinstall cleanly").toContain(
        "This server had already uploaded its class documents, so the namespace can hold its source under the deployed compiled classes; " +
          "to reinstall cleanly, delete class ExecuteMCPv2.Setup in 'USER' and restart the build that should own this instance.",
      );

      http.destroy();
    });

    it("a missing probe followed by a foreign re-read (dev): no compile, no Configure; one warning", async () => {
      const config = makeConfig();
      const http = new IrisHttpClient(config);
      fetchMock.mockResolvedValueOnce(
        mockResponse("", { status: 200, headers: { "X-CSRF-Token": "t" }, setCookie: ["CSPSESSIONID=s1; path=/"] }),
      );
      fetchMock.mockResolvedValueOnce(missingMethodReply());
      fetchMock.mockResolvedValueOnce(setupAbsentReply());
      queuePutReplies();
      fetchMock.mockResolvedValueOnce(versionReply("dev"));

      const result = await bootstrap(http, config, 7);

      expect(result.probeStatus).toBe("foreign");
      expect(result.deployedVersion).toBe("dev");
      expect(result.deployed).toBe(true);
      expect(result.compiled).toBe(false);
      expect(compileCount(fetchMock)).toBe(0);
      expect(setupCallCount(fetchMock, "Configure")).toBe(0);
      const warnings = warnLines();
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('"dev"');
      expect(warnings[0]).toContain(BOOTSTRAP_VERSION);
      expect(warnings[0], "the uploads that already landed, and how to reinstall cleanly").toContain(
        "This server had already uploaded its class documents",
      );

      http.destroy();
    });

    it("an unconfigured probe followed by a newer re-read: no compile and nothing later; one warning", async () => {
      const config = makeConfig();
      const http = new IrisHttpClient(config);
      setupCsrfThenRequest(envelope({ content: [{ Version: BOOTSTRAP_VERSION }] }));
      fetchMock.mockResolvedValueOnce(mockResponse(envelope({ content: [{ Configured: 0 }] })));
      fetchMock.mockResolvedValueOnce(versionReply(NEWER_SEQUENCE));

      const result = await bootstrap(http, config, 7);

      expect(result.probeStatus).toBe("newer");
      expect(result.deployed).toBe(false);
      expect(result.compiled).toBe(false);
      expect(putCount(fetchMock)).toBe(0);
      expect(compileCount(fetchMock)).toBe(0);
      expect(setupCallCount(fetchMock, "Configure")).toBe(0);
      expect(fetchMock).toHaveBeenCalledTimes(4);
      expect(warnLines()).toHaveLength(1);
      expect(warnLines()[0], "nothing was uploaded on the unconfigured path").not.toContain("had already uploaded");

      http.destroy();
    });
  });

  // ── A marker that cannot be read (DW-673, decision #54) ──────────

  describe("a marker that cannot be read is unknown: nothing is deployed or compiled over it (DW-673)", () => {
    function queuePutReplies(): void {
      for (let i = 0; i < BOOTSTRAP_CLASSES.size; i++) {
        fetchMock.mockResolvedValueOnce(mockResponse(envelope({ result: [] })));
      }
    }

    function queueCsrf(): void {
      fetchMock.mockResolvedValueOnce(
        mockResponse("", { status: 200, headers: { "X-CSRF-Token": "t" }, setCookie: ["CSPSESSIONID=s1; path=/"] }),
      );
    }

    /** One way the version query can fail to yield a marker, and the text that names it in the reason. */
    const READ_FAILURES: Array<{ label: string; queue: () => void; named: string }> = [
      {
        label: "an HTTP 500 error envelope",
        queue: () => fetchMock.mockResolvedValueOnce(mockResponse({ status: { errors: [{ error: "ERROR #5002: ObjectScript error: <STORE>" }], summary: "Error" }, console: [], result: null }, { status: 500 })),
        named: "IRIS returned HTTP 500",
      },
      {
        label: "an HTTP 200 envelope reporting a privilege error",
        queue: () => fetchMock.mockResolvedValueOnce(mockResponse(envelope({ content: [] }, [{ error: "ERROR #5540: SQLCODE: -99 Message: User testuser is not privileged for the operation" }]))),
        named: "SQLCODE: -99",
      },
      {
        label: "an HTTP 403",
        queue: () => fetchMock.mockResolvedValueOnce(mockResponse({ status: { errors: [], summary: "" }, console: [], result: null }, { status: 403 })),
        named: "IRIS returned HTTP 403",
      },
      {
        label: "a timeout",
        queue: () => fetchMock.mockRejectedValueOnce(new DOMException("The operation was aborted.", "AbortError")),
        named: "Connection to IRIS timed out",
      },
      {
        label: "a connection failure",
        queue: () => fetchMock.mockRejectedValueOnce(new TypeError("fetch failed")),
        named: "Failed to connect to IRIS at localhost:52773",
      },
      {
        label: "an empty value",
        queue: () => fetchMock.mockResolvedValueOnce(versionReply("")),
        named: "the version query returned no marker",
      },
      {
        label: "no row",
        queue: () => fetchMock.mockResolvedValueOnce(mockResponse(envelope({ content: [] }))),
        named: "the version query returned no marker",
      },
      {
        label: "a Setup class from before the version stamp (no GetBootstrapVersion method)",
        queue: () => fetchMock.mockResolvedValueOnce(missingMethodReply()),
        named: "IRIS returned HTTP 400",
      },
    ];

    it.each(READ_FAILURES)(
      "the probe's read fails ($label) while the Setup class exists: unknown, no PUT, no compile, no Setup_ call, one warning naming the failure and the remedy",
      async ({ queue, named }) => {
        const config = makeConfig();
        const http = new IrisHttpClient(config);
        queueCsrf();
        queue();
        fetchMock.mockResolvedValueOnce(setupFoundReply());

        const result = await bootstrap(http, config, 7);

        expect(result.probeStatus).toBe("unknown");
        expect(result.probeFound).toBe(true);
        expect(result.readFailure).toContain(named);
        expect(result.readFailure).toContain("and the ExecuteMCPv2.Setup class exists");
        expect(result.deployedVersion).toBeUndefined();
        expect(result.deployed).toBe(false);
        expect(result.compiled).toBe(false);
        expect(result.configured).toBe(false);
        expect(result.mapped).toBe(false);
        expect(result.unitTestRootEnsured).toBe(false);
        expect(result.errors).toEqual([]);
        expect(result.manualInstructions).toBeUndefined();

        // The CSRF preflight, the version query and the Setup document GET: nothing written, nothing else asked.
        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(setupDocGetCount(fetchMock)).toBe(1);
        expect(putCount(fetchMock)).toBe(0);
        expect(compileCount(fetchMock)).toBe(0);
        for (const name of ["IsConfigured", "Configure", "ConfigureMapping", "EnsureUnitTestRoot"]) {
          expect(setupCallCount(fetchMock, name), `Setup_${name}`).toBe(0);
        }

        const warnings = warnLines();
        expect(warnings, "exactly one warning").toHaveLength(1);
        const [warning] = warnings as [string];
        expect(warning).not.toContain("\n");
        expect(warning).toContain("Bootstrap: leaving the ExecuteMCPv2 classes in 'USER' on localhost:52773 alone: the deployed marker could not be read (");
        expect(warning).toContain(named);
        expect(warning).toContain(`so it cannot be ordered against this server's ${BOOTSTRAP_VERSION}`);
        expect(warning).toContain("Check that the instance answers and that this user can run SQL in 'USER', then restart this server.");
        expect(warning).toContain("delete class ExecuteMCPv2.Setup in 'USER' and restart this server");

        http.destroy();
      },
    );

    it("the read fails and the Setup class check fails too (HTTP 500): unknown, not a positive absence; nothing is deployed", async () => {
      const config = makeConfig();
      const http = new IrisHttpClient(config);
      queueCsrf();
      fetchMock.mockResolvedValueOnce(missingMethodReply());
      fetchMock.mockResolvedValueOnce(mockResponse({ status: { errors: [{ error: "Internal error" }], summary: "Error" }, console: [], result: null }, { status: 500 }));

      const result = await bootstrap(http, config, 7);

      expect(result.probeStatus).toBe("unknown");
      expect(result.readFailure).toContain("whether the ExecuteMCPv2.Setup class exists could not be checked: IRIS returned HTTP 500");
      expect(putCount(fetchMock)).toBe(0);
      expect(compileCount(fetchMock)).toBe(0);
      expect(warnLines()).toHaveLength(1);

      http.destroy();
    });

    it("the read fails and the Setup document route answers 404 (a positive absence): the full install runs, with no warning", async () => {
      const config = makeConfig();
      const http = new IrisHttpClient(config);
      queueCsrf();
      fetchMock.mockResolvedValueOnce(mockResponse({ status: { errors: [{ error: "Internal error" }], summary: "Error" }, console: [], result: null }, { status: 500 }));
      fetchMock.mockResolvedValueOnce(setupAbsentReply());
      queuePutReplies();
      fetchMock.mockResolvedValueOnce(missingMethodReply());
      fetchMock.mockResolvedValueOnce(mockResponse(envelope({ result: [] })));
      fetchMock.mockResolvedValueOnce(mockResponse(envelope({ content: [] })));
      fetchMock.mockResolvedValueOnce(mockResponse(envelope({ content: [] })));
      fetchMock.mockResolvedValueOnce(mockResponse(envelope({ content: [{ UnitTestRoot: "/iris/mgr/" }] })));

      const result = await bootstrap(http, config, 7);

      expect(result.probeStatus).toBe("missing");
      expect(result.probeFound).toBe(false);
      expect(putCount(fetchMock)).toBe(BOOTSTRAP_CLASSES.size);
      expect(compileCount(fetchMock), "the failed re-read after a positive absence is the not-yet-compiled state").toBe(1);
      expect(result.configured).toBe(true);
      expect(result.mapped).toBe(true);
      expect(warnLines()).toEqual([]);

      http.destroy();
    });

    it.each(READ_FAILURES.filter((failure) => ["an HTTP 500 error envelope", "a timeout", "an empty value"].includes(failure.label)))(
      "an older probe followed by a re-read that fails ($label): the uploads landed, but no compile and nothing later; one warning",
      async ({ queue, named }) => {
        const config = makeConfig();
        const http = new IrisHttpClient(config);
        setupCsrfThenRequest(envelope({ content: [{ Version: "abcdef123456" }] }));
        queuePutReplies();
        queue();

        const result = await bootstrap(http, config, 7);

        expect(result.probeStatus).toBe("unknown");
        expect(result.probeFound).toBe(true);
        expect(result.readFailure).toContain(named);
        expect(result.deployedVersion).toBeUndefined();
        expect(result.deployed).toBe(true);
        expect(result.compiled).toBe(false);
        expect(result.configured).toBe(false);
        expect(result.unitTestRootEnsured).toBe(false);
        expect(compileCount(fetchMock)).toBe(0);
        for (const name of ["IsConfigured", "Configure", "ConfigureMapping", "EnsureUnitTestRoot"]) {
          expect(setupCallCount(fetchMock, name), `Setup_${name}`).toBe(0);
        }
        // CSRF + probe + one PUT per class + the re-read, and nothing after it.
        expect(fetchMock).toHaveBeenCalledTimes(1 + 1 + BOOTSTRAP_CLASSES.size + 1);

        const warnings = warnLines();
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain("alone (found just before compiling, so nothing was compiled): the deployed marker could not be read (");
        expect(warnings[0]).toContain(named);
        expect(warnings[0]).toContain("This server had already uploaded its class documents");

        http.destroy();
      },
    );

    it("an unconfigured probe followed by a re-read that fails: no compile, no Configure, nothing later; one warning", async () => {
      const config = makeConfig();
      const http = new IrisHttpClient(config);
      setupCsrfThenRequest(envelope({ content: [{ Version: BOOTSTRAP_VERSION }] }));
      fetchMock.mockResolvedValueOnce(mockResponse(envelope({ content: [{ Configured: 0 }] })));
      fetchMock.mockResolvedValueOnce(mockResponse({ status: { errors: [{ error: "Internal error" }], summary: "Error" }, console: [], result: null }, { status: 500 }));

      const result = await bootstrap(http, config, 7);

      expect(result.probeStatus).toBe("unknown");
      expect(result.readFailure).toContain("IRIS returned HTTP 500");
      expect(result.deployed).toBe(false);
      expect(result.compiled).toBe(false);
      expect(result.configured).toBe(false);
      expect(putCount(fetchMock)).toBe(0);
      expect(compileCount(fetchMock)).toBe(0);
      expect(setupCallCount(fetchMock, "Configure")).toBe(0);
      expect(fetchMock).toHaveBeenCalledTimes(4);
      const warnings = warnLines();
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("found just before compiling, so nothing was compiled");
      expect(warnings[0]).not.toContain("had already uploaded");

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
    it("should contain exactly 35 classes", () => {
      expect(BOOTSTRAP_CLASSES.size).toBe(35);
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
        "ExecuteMCPv2.Coverage.Job.cls",
        "ExecuteMCPv2.Coverage.Runner.cls",
        "ExecuteMCPv2.REST.Base.cls",
        "ExecuteMCPv2.REST.Global.cls",
        "ExecuteMCPv2.REST.Command.cls",
        "ExecuteMCPv2.REST.UnitTest.cls",
        "ExecuteMCPv2.REST.Config.cls",
        "ExecuteMCPv2.REST.Security.cls",
        "ExecuteMCPv2.REST.Interop.cls",
        "ExecuteMCPv2.REST.MessageResend.cls",
        "ExecuteMCPv2.REST.MessageSearch.cls",
        "ExecuteMCPv2.REST.MessageBody.cls",
        "ExecuteMCPv2.REST.Loc.cls",
        "ExecuteMCPv2.REST.Monitor.cls",
        "ExecuteMCPv2.REST.Health.cls",
        "ExecuteMCPv2.REST.EnvSync.cls",
        "ExecuteMCPv2.REST.Task.cls",
        "ExecuteMCPv2.REST.SystemConfig.cls",
        "ExecuteMCPv2.REST.Analytics.cls",
        "ExecuteMCPv2.REST.SqlAdvisor.cls",
        "ExecuteMCPv2.REST.Sql.cls",
        "ExecuteMCPv2.REST.Coverage.cls",
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
      expect(classes.length).toBe(35);
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

    it("should include Base.cls (Story 34.4)", () => {
      const classes = getBootstrapClasses();
      const base = classes.find(c => c.name === "ExecuteMCPv2.REST.Base.cls");
      expect(base).toBeDefined();
      expect(base!.content).toContain("Class ExecuteMCPv2.REST.Base Extends");
    });

    // Rule #39: `classes[]` is ORDERED and the ordering is load-bearing — on a fresh
    // instance the bootstrap compiles in this sequence, so a superclass listed after
    // its subclasses compiles them against a class that does not exist yet. Story 34.4
    // introduced the first such dependency in the manifest (Base ← 15 handlers) and
    // it was previously protected only by a comment in `gen-bootstrap.mjs`: the
    // existing order test pins classes[0], classes[1] and last-is-Dispatch only, none
    // of which move if Base drifts below its extenders.
    it("should order Base.cls before every class that extends it (Story 34.4, Rule #39)", () => {
      const names = getBootstrapClasses().map(c => c.name);
      const baseIdx = names.indexOf("ExecuteMCPv2.REST.Base.cls");
      expect(baseIdx).toBeGreaterThanOrEqual(0);

      const extenders = [
        "ExecuteMCPv2.REST.Analytics.cls",
        "ExecuteMCPv2.REST.Command.cls",
        "ExecuteMCPv2.REST.Config.cls",
        "ExecuteMCPv2.REST.Coverage.cls",
        "ExecuteMCPv2.REST.EnvSync.cls",
        "ExecuteMCPv2.REST.Global.cls",
        "ExecuteMCPv2.REST.Health.cls",
        "ExecuteMCPv2.REST.Interop.cls",
        "ExecuteMCPv2.REST.Loc.cls",
        "ExecuteMCPv2.REST.MessageBody.cls",
        "ExecuteMCPv2.REST.MessageResend.cls",
        "ExecuteMCPv2.REST.MessageSearch.cls",
        "ExecuteMCPv2.REST.Monitor.cls",
        "ExecuteMCPv2.REST.Security.cls",
        "ExecuteMCPv2.REST.Sql.cls",
        "ExecuteMCPv2.REST.SqlAdvisor.cls",
        "ExecuteMCPv2.REST.SystemConfig.cls",
        "ExecuteMCPv2.REST.Task.cls",
        "ExecuteMCPv2.REST.UnitTest.cls",
      ];
      for (const name of extenders) {
        const idx = names.indexOf(name);
        expect(idx).toBeGreaterThanOrEqual(0);
        expect(baseIdx).toBeLessThan(idx);
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

    it("should include EnvSync.cls (Story 27.0)", () => {
      const classes = getBootstrapClasses();
      const envSync = classes.find(c => c.name === "ExecuteMCPv2.REST.EnvSync.cls");
      expect(envSync).toBeDefined();
      expect(envSync!.content).toContain("ExecuteMCPv2.REST.EnvSync");
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

    it("should include SqlAdvisor.cls (Story 28.1)", () => {
      const classes = getBootstrapClasses();
      const sqlAdvisor = classes.find(c => c.name === "ExecuteMCPv2.REST.SqlAdvisor.cls");
      expect(sqlAdvisor).toBeDefined();
      expect(sqlAdvisor!.content).toContain("ExecuteMCPv2.REST.SqlAdvisor");
    });

    it("should include Sql.cls (Story 38.5)", () => {
      const classes = getBootstrapClasses();
      const sql = classes.find(c => c.name === "ExecuteMCPv2.REST.Sql.cls");
      expect(sql).toBeDefined();
      expect(sql!.content).toContain("Class ExecuteMCPv2.REST.Sql Extends ExecuteMCPv2.REST.Base");
    });
  });

  // ── BOOTSTRAP_VERSION ───────────────────────────────────────────

  describe("BOOTSTRAP_VERSION", () => {
    it("should be a marker <semver>+<sequence>.<hash>", () => {
      expect(typeof BOOTSTRAP_VERSION).toBe("string");
      expect(BOOTSTRAP_VERSION.length).toBeGreaterThan(0);
      // The semver of @iris-mcp/shared, the generator's sequence and the
      // 12-char short SHA-256 (gen-bootstrap.mjs)
      expect(BOOTSTRAP_VERSION).toMatch(/^\d+\.\d+\.\d+\+\d+\.[0-9a-f]{12}$/);
      expect(parseBootstrapMarker(BOOTSTRAP_VERSION).kind).toBe("stamped");
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
      ["ExecuteMCPv2.Coverage.Job.cls", "src/ExecuteMCPv2/Coverage/Job.cls"],
      ["ExecuteMCPv2.Coverage.Runner.cls", "src/ExecuteMCPv2/Coverage/Runner.cls"],
      ["ExecuteMCPv2.REST.Base.cls", "src/ExecuteMCPv2/REST/Base.cls"],
      ["ExecuteMCPv2.REST.Global.cls", "src/ExecuteMCPv2/REST/Global.cls"],
      ["ExecuteMCPv2.REST.Command.cls", "src/ExecuteMCPv2/REST/Command.cls"],
      ["ExecuteMCPv2.REST.UnitTest.cls", "src/ExecuteMCPv2/REST/UnitTest.cls"],
      ["ExecuteMCPv2.REST.Config.cls", "src/ExecuteMCPv2/REST/Config.cls"],
      ["ExecuteMCPv2.REST.Security.cls", "src/ExecuteMCPv2/REST/Security.cls"],
      ["ExecuteMCPv2.REST.Interop.cls", "src/ExecuteMCPv2/REST/Interop.cls"],
      ["ExecuteMCPv2.REST.MessageResend.cls", "src/ExecuteMCPv2/REST/MessageResend.cls"],
      ["ExecuteMCPv2.REST.MessageSearch.cls", "src/ExecuteMCPv2/REST/MessageSearch.cls"],
      ["ExecuteMCPv2.REST.MessageBody.cls", "src/ExecuteMCPv2/REST/MessageBody.cls"],
      ["ExecuteMCPv2.REST.Loc.cls", "src/ExecuteMCPv2/REST/Loc.cls"],
      ["ExecuteMCPv2.REST.Monitor.cls", "src/ExecuteMCPv2/REST/Monitor.cls"],
      ["ExecuteMCPv2.REST.Health.cls", "src/ExecuteMCPv2/REST/Health.cls"],
      ["ExecuteMCPv2.REST.EnvSync.cls", "src/ExecuteMCPv2/REST/EnvSync.cls"],
      ["ExecuteMCPv2.REST.Task.cls", "src/ExecuteMCPv2/REST/Task.cls"],
      ["ExecuteMCPv2.REST.SystemConfig.cls", "src/ExecuteMCPv2/REST/SystemConfig.cls"],
      ["ExecuteMCPv2.REST.Analytics.cls", "src/ExecuteMCPv2/REST/Analytics.cls"],
      ["ExecuteMCPv2.REST.SqlAdvisor.cls", "src/ExecuteMCPv2/REST/SqlAdvisor.cls"],
      ["ExecuteMCPv2.REST.Sql.cls", "src/ExecuteMCPv2/REST/Sql.cls"],
      ["ExecuteMCPv2.REST.Coverage.cls", "src/ExecuteMCPv2/REST/Coverage.cls"],
      ["ExecuteMCPv2.REST.Dispatch.cls", "src/ExecuteMCPv2/REST/Dispatch.cls"],
    ];

    const VERSION_PLACEHOLDER_LINE = 'Parameter BOOTSTRAPVERSION = "dev";';
    const DRIFT_HINT =
      "bootstrap-classes.ts is out of sync with disk. " +
      "Run `pnpm gen:bootstrap` and commit the regenerated files " +
      "(the embed and scripts/bootstrap-sequence.json).";

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

    /** The embedded marker's parts; fails the test when the marker is not in the current grammar. */
    const markerParts = (): { semver: string; sequence: number; hash: string } => {
      const parsed = parseBootstrapMarker(BOOTSTRAP_VERSION);
      if (parsed.kind !== "stamped") {
        throw new Error(`BOOTSTRAP_VERSION ${BOOTSTRAP_VERSION} is not <semver>+<sequence>.<hash>. ${DRIFT_HINT}`);
      }
      return { semver: parsed.semver.join("."), sequence: Number(parsed.sequence), hash: parsed.hash };
    };

    it("the marker's hash is the SHA-256 hash of concatenated disk contents", () => {
      // Re-compute the hash with the same formula as gen-bootstrap.mjs.
      // If a dev edits any .cls file without running gen:bootstrap, this
      // test fails with a clear instruction.
      const hasher = createHash("sha256");
      for (const [, relPath] of classPaths) {
        hasher.update(readClsNormalized(relPath));
        hasher.update("\n--CLASS-SEPARATOR--\n");
      }
      const expectedHash = hasher.digest("hex").substring(0, 12);

      expect(
        markerParts().hash,
        `BOOTSTRAP_VERSION drift: ${DRIFT_HINT}`,
      ).toBe(expectedHash);
    });

    it("the marker's semver is the version of packages/shared/package.json", () => {
      const manifest = JSON.parse(readFileSync(resolve(repoRoot, "packages/shared/package.json"), "utf-8")) as {
        version: string;
      };

      expect(
        markerParts().semver,
        `BOOTSTRAP_VERSION semver drift (a packages/shared/package.json version change needs a regeneration): ${DRIFT_HINT}`,
      ).toBe(manifest.version);
    });

    it("the marker's sequence and hash are the ones recorded in scripts/bootstrap-sequence.json", () => {
      const state = JSON.parse(readFileSync(resolve(repoRoot, "scripts/bootstrap-sequence.json"), "utf-8")) as {
        sequence: number;
        hash: string;
      };
      const { sequence, hash } = markerParts();

      expect(sequence, `BOOTSTRAP_VERSION sequence drift: ${DRIFT_HINT}`).toBe(state.sequence);
      expect(hash, `BOOTSTRAP_VERSION hash drift: ${DRIFT_HINT}`).toBe(state.hash);
    });
  });
});
