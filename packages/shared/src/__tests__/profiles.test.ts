import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, win32 as winPath } from "node:path";
import {
  buildProfileRegistry,
  loadProfileRegistry,
  resolveProfile,
  ProfileClientRegistry,
  ProfileResolutionError,
  DEFAULT_PROFILE_NAME,
  mergeProfile,
} from "../profiles.js";
import type { IrisProfile } from "../profiles.js";
import { loadConfig } from "../config.js";
import { IrisHttpClient } from "../http-client.js";
import { logger } from "../logger.js";
import { buildRoster, buildRosterEntry } from "../server-discovery.js";
import { effective } from "../governance.js";
import type { GovernanceConfig, MutatesLookup } from "../governance.js";

// ── Helpers ─────────────────────────────────────────────────────────

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
  const resp = new Response(JSON.stringify(body), {
    status,
    headers: headersObj,
  });
  if (setCookie.length > 0) {
    const originalGetSetCookie = resp.headers.getSetCookie?.bind(resp.headers);
    resp.headers.getSetCookie = () => {
      const real = originalGetSetCookie?.() ?? [];
      return [...real, ...setCookie];
    };
  }
  return resp;
}

// ════════════════════════════════════════════════════════════════════
// AC 14.1.6 — PRIORITY: per-profile session isolation (de-risking case).
// This is the highest-value test in the epic's foundation. A server
// profile is a different host+credentials → a different session. The
// per-profile client registry must hand each profile its OWN
// IrisHttpClient instance so cookie/CSRF state never bleeds across
// profiles. Provable WITHOUT a live server: distinct instances +
// isolated cookie state asserted via mocked fetch.
// ════════════════════════════════════════════════════════════════════

describe("per-profile session isolation (AC 14.1.6 — priority)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("hands each profile a distinct IrisHttpClient instance", () => {
    const env = {
      IRIS_USERNAME: "admin",
      IRIS_PASSWORD: "secret",
      IRIS_PROFILES: JSON.stringify({
        prod: { host: "prod.example.com" },
        staging: { host: "staging.example.com" },
      }),
    };
    const defaultConfig = loadConfig(env);
    const registry = buildProfileRegistry(defaultConfig, env);
    const clients = new ProfileClientRegistry(registry);

    const prodClient = clients.getOrCreate("prod");
    const stagingClient = clients.getOrCreate("staging");
    const defaultClient = clients.getOrCreate(DEFAULT_PROFILE_NAME);

    expect(prodClient).toBeInstanceOf(IrisHttpClient);
    expect(stagingClient).toBeInstanceOf(IrisHttpClient);
    expect(defaultClient).toBeInstanceOf(IrisHttpClient);

    // All three must be distinct instances — no sharing across profiles.
    expect(prodClient).not.toBe(stagingClient);
    expect(prodClient).not.toBe(defaultClient);
    expect(stagingClient).not.toBe(defaultClient);
  });

  it("caches and returns the same client instance for repeat get-or-create of one profile", () => {
    const env = {
      IRIS_USERNAME: "admin",
      IRIS_PASSWORD: "secret",
      IRIS_PROFILES: JSON.stringify({ prod: { host: "prod.example.com" } }),
    };
    const defaultConfig = loadConfig(env);
    const registry = buildProfileRegistry(defaultConfig, env);
    const clients = new ProfileClientRegistry(registry);

    const first = clients.getOrCreate("prod");
    const second = clients.getOrCreate("prod");
    expect(first).toBe(second);
  });

  it("does NOT leak cookies/session across profiles when one establishes a session", async () => {
    const env = {
      IRIS_USERNAME: "admin",
      IRIS_PASSWORD: "secret",
      IRIS_PROFILES: JSON.stringify({
        prod: { host: "prod.example.com" },
        staging: { host: "staging.example.com" },
      }),
    };
    const defaultConfig = loadConfig(env);
    const registry = buildProfileRegistry(defaultConfig, env);
    const clients = new ProfileClientRegistry(registry);

    const prodClient = clients.getOrCreate("prod");
    const stagingClient = clients.getOrCreate("staging");

    // prod establishes a session and receives a cookie.
    fetchMock.mockResolvedValueOnce(
      mockResponse(atelierResponse({}), {
        setCookie: ["CSPSESSIONID-prod=prodsess; path=/"],
        headers: { "X-CSRF-Token": "prod-csrf" },
      }),
    );
    await prodClient.get("/api/atelier/");

    // staging makes its FIRST request — it must NOT carry prod's cookie,
    // and must send its OWN Basic Auth (session not yet established).
    fetchMock.mockResolvedValueOnce(mockResponse(atelierResponse({})));
    await stagingClient.get("/api/atelier/");

    const [prodUrl, prodOpts] = fetchMock.mock.calls[0] as [string, RequestInit];
    const [stagingUrl, stagingOpts] = fetchMock.mock.calls[1] as [
      string,
      RequestInit,
    ];

    // Each client targets its own host (distinct baseUrl per profile).
    expect(prodUrl).toContain("prod.example.com");
    expect(stagingUrl).toContain("staging.example.com");

    const stagingHeaders = stagingOpts.headers as Record<string, string>;
    // No cross-profile cookie bleed.
    expect(stagingHeaders["Cookie"]).toBeUndefined();
    // staging authenticates independently with its own Basic Auth.
    expect(stagingHeaders["Authorization"]).toMatch(/^Basic /);

    // prod's own second request DOES carry prod's cookie (sanity: state lives
    // on the prod instance, proving the cookie was stored — just not shared).
    fetchMock.mockResolvedValueOnce(mockResponse(atelierResponse({})));
    await prodClient.get("/api/atelier/second");
    const [, prodSecondOpts] = fetchMock.mock.calls[2] as [string, RequestInit];
    const prodSecondHeaders = prodSecondOpts.headers as Record<string, string>;
    expect(prodSecondHeaders["Cookie"]).toContain("CSPSESSIONID-prod=prodsess");

    prodClient.destroy();
    stagingClient.destroy();
    expect(prodUrl).toBeDefined(); // referenced to satisfy lint on prodUrl
    expect(prodOpts).toBeDefined();
  });

  it("destroying one profile's client does not affect another profile's session state", async () => {
    const env = {
      IRIS_USERNAME: "admin",
      IRIS_PASSWORD: "secret",
      IRIS_PROFILES: JSON.stringify({
        prod: { host: "prod.example.com" },
        staging: { host: "staging.example.com" },
      }),
    };
    const defaultConfig = loadConfig(env);
    const registry = buildProfileRegistry(defaultConfig, env);
    const clients = new ProfileClientRegistry(registry);

    const prodClient = clients.getOrCreate("prod");
    const stagingClient = clients.getOrCreate("staging");

    // staging establishes a session.
    fetchMock.mockResolvedValueOnce(
      mockResponse(atelierResponse({}), {
        setCookie: ["CSPSESSIONID-stg=stgsess; path=/"],
      }),
    );
    await stagingClient.get("/api/atelier/");

    // Destroy prod — staging must keep its established session.
    prodClient.destroy();

    fetchMock.mockResolvedValueOnce(mockResponse(atelierResponse({})));
    await stagingClient.get("/api/atelier/second");
    const [, stagingSecondOpts] = fetchMock.mock.calls[1] as [
      string,
      RequestInit,
    ];
    const headers = stagingSecondOpts.headers as Record<string, string>;
    expect(headers["Cookie"]).toContain("CSPSESSIONID-stg=stgsess");
    // Session already established → no Basic Auth re-sent.
    expect(headers["Authorization"]).toBeUndefined();

    stagingClient.destroy();
  });
});

// ════════════════════════════════════════════════════════════════════
// AC 14.1.2 — default-only (no IRIS_PROFILES) → only `default` exists.
// Back-compat gate: byte-for-byte equality with today's loadConfig output.
// ════════════════════════════════════════════════════════════════════

describe("default profile synthesis (AC 14.1.2 — back-compat gate)", () => {
  it("with no IRIS_PROFILES, registry has exactly one profile named 'default'", () => {
    const env = { IRIS_USERNAME: "admin", IRIS_PASSWORD: "secret" };
    const defaultConfig = loadConfig(env);
    const registry = buildProfileRegistry(defaultConfig, env);

    expect(registry.size).toBe(1);
    expect([...registry.keys()]).toEqual([DEFAULT_PROFILE_NAME]);
  });

  it("default profile is byte-for-byte today's loadConfig output (plus the reserved name)", () => {
    const env = {
      IRIS_HOST: "myhost",
      IRIS_PORT: "1972",
      IRIS_USERNAME: "admin",
      IRIS_PASSWORD: "secret",
      IRIS_NAMESPACE: "USER",
      IRIS_HTTPS: "true",
      IRIS_TIMEOUT: "30000",
    };
    const defaultConfig = loadConfig(env);
    const registry = buildProfileRegistry(defaultConfig, env);
    const profile = registry.get(DEFAULT_PROFILE_NAME) as IrisProfile;

    // Every IrisConnectionConfig field matches loadConfig exactly.
    expect(profile.host).toBe(defaultConfig.host);
    expect(profile.port).toBe(defaultConfig.port);
    expect(profile.username).toBe(defaultConfig.username);
    expect(profile.password).toBe(defaultConfig.password);
    expect(profile.namespace).toBe(defaultConfig.namespace);
    expect(profile.https).toBe(defaultConfig.https);
    expect(profile.baseUrl).toBe(defaultConfig.baseUrl);
    expect(profile.timeout).toBe(defaultConfig.timeout);
    // The only addition is the reserved profile name.
    expect(profile.name).toBe(DEFAULT_PROFILE_NAME);
    // Story 31.3, AC 31.3.1: the reserved default is always "env"-sourced.
    expect(profile.source).toBe("env");

    // Strip `name`/`source` (Story 31.3's deliberate, reviewed addition to
    // this pinned fixture — see Dev Notes) → identical object to today's
    // loadConfig output.
    const { name: _name, source: _source, ...connOnly } = profile;
    void _name;
    void _source;
    expect(connOnly).toEqual(defaultConfig);
  });
});

// ════════════════════════════════════════════════════════════════════
// AC 14.1.1 / 14.1.3 — multi-profile parse + field inheritance.
// ════════════════════════════════════════════════════════════════════

describe("IRIS_PROFILES parsing and inheritance (AC 14.1.1, 14.1.3)", () => {
  it("parses multiple named profiles from IRIS_PROFILES JSON", () => {
    const env = {
      IRIS_USERNAME: "admin",
      IRIS_PASSWORD: "secret",
      IRIS_PROFILES: JSON.stringify({
        prod: {
          host: "prod.example.com",
          port: 443,
          username: "produser",
          password: "prodpass",
          namespace: "PROD",
          https: true,
        },
        dev: { host: "dev.example.com" },
      }),
    };
    const defaultConfig = loadConfig(env);
    const registry = buildProfileRegistry(defaultConfig, env);

    expect(registry.size).toBe(3); // default + prod + dev
    expect([...registry.keys()].sort()).toEqual(["default", "dev", "prod"]);

    const prod = registry.get("prod") as IrisProfile;
    expect(prod.host).toBe("prod.example.com");
    expect(prod.port).toBe(443);
    expect(prod.username).toBe("produser");
    expect(prod.namespace).toBe("PROD");
    expect(prod.https).toBe(true);
    expect(prod.baseUrl).toBe("https://prod.example.com:443");
  });

  it("inherits omitted fields from the default profile (override just host)", () => {
    const env = {
      IRIS_HOST: "default.example.com",
      IRIS_PORT: "52773",
      IRIS_USERNAME: "defuser",
      IRIS_PASSWORD: "defpass",
      IRIS_NAMESPACE: "DEFNS",
      IRIS_HTTPS: "false",
      IRIS_PROFILES: JSON.stringify({
        other: { host: "other.example.com" },
      }),
    };
    const defaultConfig = loadConfig(env);
    const registry = buildProfileRegistry(defaultConfig, env);
    const other = registry.get("other") as IrisProfile;

    // host overridden
    expect(other.host).toBe("other.example.com");
    // everything else inherited from default
    expect(other.port).toBe(52773);
    expect(other.username).toBe("defuser");
    expect(other.password).toBe("defpass");
    expect(other.namespace).toBe("DEFNS");
    expect(other.https).toBe(false);
    expect(other.timeout).toBe(defaultConfig.timeout);
    // baseUrl re-derived from merged host/port/https
    expect(other.baseUrl).toBe("http://other.example.com:52773");
  });

  it("re-derives baseUrl when a profile overrides https", () => {
    const env = {
      IRIS_HOST: "h",
      IRIS_PORT: "52773",
      IRIS_USERNAME: "u",
      IRIS_PASSWORD: "p",
      IRIS_PROFILES: JSON.stringify({
        secure: { https: true, port: 443 },
      }),
    };
    const defaultConfig = loadConfig(env);
    const registry = buildProfileRegistry(defaultConfig, env);
    const secure = registry.get("secure") as IrisProfile;
    expect(secure.https).toBe(true);
    expect(secure.baseUrl).toBe("https://h:443");
  });

  it("if IRIS_PROFILES defines 'default', it overrides the IRIS_*-derived one with a warning", () => {
    // logger.warn writes to stderr (console.error) to keep stdout clean for the
    // MCP protocol, so spy on the logger's public method, not the console sink.
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const env = {
      IRIS_HOST: "fromvars.example.com",
      IRIS_USERNAME: "u",
      IRIS_PASSWORD: "p",
      IRIS_PROFILES: JSON.stringify({
        default: { host: "override.example.com" },
      }),
    };
    const defaultConfig = loadConfig(env);
    const registry = buildProfileRegistry(defaultConfig, env);
    const def = registry.get(DEFAULT_PROFILE_NAME) as IrisProfile;

    expect(def.host).toBe("override.example.com");
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

// ════════════════════════════════════════════════════════════════════
// AC 14.1.1 — malformed IRIS_PROFILES fails fast naming the offending var.
// ════════════════════════════════════════════════════════════════════

describe("malformed IRIS_PROFILES fail-fast (AC 14.1.1)", () => {
  it("throws naming IRIS_PROFILES when the JSON is invalid", () => {
    const env = {
      IRIS_USERNAME: "admin",
      IRIS_PASSWORD: "secret",
      IRIS_PROFILES: "{ not valid json",
    };
    const defaultConfig = loadConfig(env);
    expect(() => buildProfileRegistry(defaultConfig, env)).toThrow(
      "IRIS_PROFILES",
    );
  });

  it("throws naming IRIS_PROFILES when JSON is not an object (array)", () => {
    const env = {
      IRIS_USERNAME: "admin",
      IRIS_PASSWORD: "secret",
      IRIS_PROFILES: JSON.stringify(["not", "an", "object"]),
    };
    const defaultConfig = loadConfig(env);
    expect(() => buildProfileRegistry(defaultConfig, env)).toThrow(
      "IRIS_PROFILES",
    );
  });

  it("throws naming IRIS_PROFILES when a profile entry is not an object", () => {
    const env = {
      IRIS_USERNAME: "admin",
      IRIS_PASSWORD: "secret",
      IRIS_PROFILES: JSON.stringify({ prod: "not-an-object" }),
    };
    const defaultConfig = loadConfig(env);
    expect(() => buildProfileRegistry(defaultConfig, env)).toThrow(
      "IRIS_PROFILES",
    );
  });
});

// ════════════════════════════════════════════════════════════════════
// 31-3-7 (Story 32.3) — host validation: URL userinfo / slashes / whitespace
// are rejected in `host` (a host is not a URL). Shared by IRIS_PROFILES and
// Server-Manager entries via the SAME mergeProfile validation. The error
// deliberately does NOT echo the received value: a userinfo host can embed a
// credential (`admin:hunter2@…`), and the message must not become the leak
// it prevents.
// ════════════════════════════════════════════════════════════════════

describe("31-3-7 — mergeProfile host validation rejects URL userinfo, slashes, and whitespace", () => {
  it.each([
    "admin:hunter2@remote.example.com",
    "https://remote.example.com",
    "remote/example.com",
    "remote example.com",
    "remote\texample.com",
  ])("IRIS_PROFILES host %j is rejected naming IRIS_PROFILES, without echoing the value", (host) => {
    const env = {
      IRIS_USERNAME: "admin",
      IRIS_PASSWORD: "secret",
      IRIS_PROFILES: JSON.stringify({ prod: { host } }),
    };
    const defaultConfig = loadConfig(env);
    let caught: unknown;
    try {
      buildProfileRegistry(defaultConfig, env);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    expect(message).toContain("IRIS_PROFILES");
    expect(message).toContain('"host"');
    expect(message).not.toContain("hunter2");
  });

  it("a plain hostname (with dots, dashes, digits) still passes", () => {
    const env = {
      IRIS_USERNAME: "admin",
      IRIS_PASSWORD: "secret",
      IRIS_PROFILES: JSON.stringify({ prod: { host: "iris-prod-01.example.com" } }),
    };
    const defaultConfig = loadConfig(env);
    const registry = buildProfileRegistry(defaultConfig, env);
    expect(registry.get("prod")?.host).toBe("iris-prod-01.example.com");
  });
});

// ════════════════════════════════════════════════════════════════════
// AC 14.1.5 — resolveProfile(name?) + structured unknown-profile error.
// ════════════════════════════════════════════════════════════════════

describe("resolveProfile (AC 14.1.5)", () => {
  function fixture() {
    const env = {
      IRIS_USERNAME: "admin",
      IRIS_PASSWORD: "secret",
      IRIS_PROFILES: JSON.stringify({
        prod: { host: "prod.example.com" },
        staging: { host: "staging.example.com" },
      }),
    };
    const defaultConfig = loadConfig(env);
    return buildProfileRegistry(defaultConfig, env);
  }

  it("returns the named profile when name is provided", () => {
    const registry = fixture();
    const prod = resolveProfile(registry, "prod");
    expect(prod.name).toBe("prod");
    expect(prod.host).toBe("prod.example.com");
  });

  it("returns the default profile when name is undefined", () => {
    const registry = fixture();
    const def = resolveProfile(registry);
    expect(def.name).toBe(DEFAULT_PROFILE_NAME);
  });

  it("returns the default profile when name is empty string", () => {
    const registry = fixture();
    const def = resolveProfile(registry, "");
    expect(def.name).toBe(DEFAULT_PROFILE_NAME);
  });

  it("throws a structured error listing valid profile names for an unknown profile", () => {
    const registry = fixture();
    let caught: unknown;
    try {
      resolveProfile(registry, "nonexistent");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ProfileResolutionError);
    const err = caught as ProfileResolutionError;
    // Names the offending profile.
    expect(err.message).toContain("nonexistent");
    // Lists the valid names so the caller can correct the request.
    expect(err.message).toContain("default");
    expect(err.message).toContain("prod");
    expect(err.message).toContain("staging");
    // Structured: exposes the requested name and valid set.
    expect(err.requested).toBe("nonexistent");
    expect(err.validProfiles.sort()).toEqual(["default", "prod", "staging"]);
  });
});

// ════════════════════════════════════════════════════════════════════
// loadProfileRegistry — central startup entry point (D7). Composes
// loadConfig + buildProfileRegistry; loadConfig stays unchanged.
// ════════════════════════════════════════════════════════════════════

describe("loadProfileRegistry (central entry point, AC 14.1.1/14.1.2)", () => {
  it("with no IRIS_PROFILES, produces a single default profile equal to loadConfig", async () => {
    const env = {
      IRIS_HOST: "h",
      IRIS_PORT: "52773",
      IRIS_USERNAME: "u",
      IRIS_PASSWORD: "p",
    };
    const registry = await loadProfileRegistry(env);
    expect(registry.size).toBe(1);
    const def = registry.get(DEFAULT_PROFILE_NAME) as IrisProfile;
    expect(def.source).toBe("env");
    const { name: _name, source: _source, ...connOnly } = def;
    void _name;
    void _source;
    expect(connOnly).toEqual(loadConfig(env));
  });

  it("parses IRIS_PROFILES alongside the synthesized default", async () => {
    const env = {
      IRIS_USERNAME: "u",
      IRIS_PASSWORD: "p",
      IRIS_PROFILES: JSON.stringify({ prod: { host: "prod.example.com" } }),
    };
    const registry = await loadProfileRegistry(env);
    expect([...registry.keys()].sort()).toEqual(["default", "prod"]);
  });

  it("propagates loadConfig fail-fast (missing IRIS_USERNAME)", async () => {
    const env = { IRIS_PASSWORD: "p" };
    await expect(loadProfileRegistry(env)).rejects.toThrow("IRIS_USERNAME");
  });

  it("propagates malformed IRIS_PROFILES fail-fast", async () => {
    const env = {
      IRIS_USERNAME: "u",
      IRIS_PASSWORD: "p",
      IRIS_PROFILES: "{bad",
    };
    await expect(loadProfileRegistry(env)).rejects.toThrow("IRIS_PROFILES");
  });
});

// ════════════════════════════════════════════════════════════════════
// SQL caps propagation (Story 24.2, CR patch): mergeProfile() inherits the
// operator-set SQL resource caps (sqlMaxRows/sqlTimeoutMs, read from
// IRIS_SQL_MAX_ROWS/IRIS_SQL_TIMEOUT into the default config) into every
// named IRIS_PROFILES entry — exactly like it inherits `timeout` — so a call
// resolving to a non-default profile is capped too. (Originally flagged by
// QA as a KNOWN GAP; fixed at the code-review gate because Epic 24's headline
// "point it at PRODUCTION in read-only mode" commonly targets a NAMED
// profile, so the caps must apply there.) The conditional spread preserves
// the "unset -> field absent" shape (Rule #19): with the env vars unset, a
// named profile carries no sqlMaxRows/sqlTimeoutMs keys at all.
// ════════════════════════════════════════════════════════════════════

describe("SQL caps propagate to non-default profiles (Story 24.2 CR patch)", () => {
  it("a named IRIS_PROFILES entry inherits sqlMaxRows/sqlTimeoutMs from the default profile, like every other field", () => {
    const env = {
      IRIS_USERNAME: "admin",
      IRIS_PASSWORD: "secret",
      IRIS_SQL_MAX_ROWS: "250",
      IRIS_SQL_TIMEOUT: "12",
      IRIS_PROFILES: JSON.stringify({
        // Deliberately overrides nothing but host, so every other field
        // (including the SQL caps) is inherited from the default.
        secondary: { host: "secondary.example.com" },
      }),
    };
    const defaultConfig = loadConfig(env);
    expect(defaultConfig.sqlMaxRows).toBe(250);
    expect(defaultConfig.sqlTimeoutMs).toBe(12_000);

    const registry = buildProfileRegistry(defaultConfig, env);
    const def = registry.get(DEFAULT_PROFILE_NAME) as IrisProfile;
    const secondary = registry.get("secondary") as IrisProfile;

    // Default profile: caps present (built by spreading defaultConfig verbatim).
    expect(def.sqlMaxRows).toBe(250);
    expect(def.sqlTimeoutMs).toBe(12_000);

    // Non-default profile: every inherited field matches the default...
    expect(secondary.port).toBe(defaultConfig.port);
    expect(secondary.username).toBe(defaultConfig.username);
    expect(secondary.namespace).toBe(defaultConfig.namespace);
    expect(secondary.timeout).toBe(defaultConfig.timeout);
    // ...including the SQL caps (the fix).
    expect(secondary.sqlMaxRows).toBe(250);
    expect(secondary.sqlTimeoutMs).toBe(12_000);
  });

  it("a named profile carries NO sqlMaxRows/sqlTimeoutMs keys when the caps are unset (Rule #19 shape preserved)", () => {
    const env = {
      IRIS_USERNAME: "admin",
      IRIS_PASSWORD: "secret",
      IRIS_PROFILES: JSON.stringify({
        secondary: { host: "secondary.example.com" },
      }),
    };
    const defaultConfig = loadConfig(env);
    const registry = buildProfileRegistry(defaultConfig, env);
    const secondary = registry.get("secondary") as IrisProfile;

    expect(secondary.sqlMaxRows).toBeUndefined();
    expect(secondary.sqlTimeoutMs).toBeUndefined();
    expect(secondary).not.toHaveProperty("sqlMaxRows");
    expect(secondary).not.toHaveProperty("sqlTimeoutMs");
  });
});

// ════════════════════════════════════════════════════════════════════
// Story 31.0 — IRIS_SERVER_MANAGER minimal wire-in into loadProfileRegistry.
//
// Scope seam (Rule #52): loadProfileRegistry's ONLY new behavior in this
// story is appending resolveServerManagerProfiles(env, platform)'s output
// for any name not already present — no collision log notice, no `source`
// provenance, no allow-list surfacing, no audit profileSource (Story 31.3).
//
// AC 31.0.4 (Rule #19 mechanical back-compat proof): with IRIS_SERVER_MANAGER
// unset, loadProfileRegistry's output deep-equals buildProfileRegistry's own
// (unchanged) output — even with a REAL, POPULATED .vscode/settings.json
// fixture present on disk — proving the file is never read when off.
//
// AC 31.0.5: profiles lacking a password are excluded from the registry at
// this stage (Story 31.1 owns real credential resolution).
// ════════════════════════════════════════════════════════════════════

describe("Story 31.0 — Server Manager minimal wire-in (AC 31.0.4, 31.0.5)", () => {
  let dirs: string[] = [];

  function tmpWorkspaceWithSettings(settingsJson: unknown): string {
    const dir = mkdtempSync(join(tmpdir(), "iris-profiles-sm-backcompat-"));
    dirs.push(dir);
    mkdirSync(join(dir, ".vscode"), { recursive: true });
    writeFileSync(
      join(dir, ".vscode", "settings.json"),
      JSON.stringify(settingsJson),
      "utf8",
    );
    return dir;
  }

  beforeEach(() => {
    // Every fixture in this block carries an inline legacy password, so the real
    // deprecation warning would otherwise reach CI stderr. Stubbing here (rather
    // than inside the one test that asserts on it) also guarantees restoration
    // even when an assertion fails mid-test — a spy left installed by a failing
    // test silently poisons every later log assertion in the file.
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    vi.spyOn(logger, "debug").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs = [];
  });

  const POPULATED_SETTINGS = {
    "intersystems.servers": {
      someServer: {
        webServer: { scheme: "https", host: "sm.example.com", port: 443 },
        username: "smuser",
        password: "smpass", // legacy inline — would normally resolve if SM were on
      },
    },
  };

  it("AC 31.0.4: with IRIS_SERVER_MANAGER unset and a populated .vscode/settings.json fixture on disk, loadProfileRegistry deep-equals buildProfileRegistry's plain output (default-only)", async () => {
    const workspaceDir = tmpWorkspaceWithSettings(POPULATED_SETTINGS);
    const env = {
      IRIS_USERNAME: "admin",
      IRIS_PASSWORD: "secret",
      IRIS_SM_WORKSPACE: workspaceDir,
      // IRIS_SERVER_MANAGER intentionally unset.
    };
    const defaultConfig = loadConfig(env);
    const expected = buildProfileRegistry(defaultConfig, env);
    const actual = await loadProfileRegistry(env);

    expect(actual).toEqual(expected);
    // The fixture's "someServer" profile must NOT have leaked in.
    expect(actual.has("someServer")).toBe(false);

    // Code review 2026-07-25 (MEDIUM): `buildProfileRegistry` is a
    // SELF-REFERENTIAL oracle — the Story 31.0 review dismissed that on the
    // explicit premise that its body was byte-unchanged, and Story 31.3
    // invalidated that premise by adding `source: "env"` to it. The
    // comparison above therefore no longer contributes anything to
    // "byte-identical to PRE-FEATURE". These assertions restore a real
    // pre-feature anchor: `loadConfig` is untouched by this epic, so
    // comparing against it is an independent oracle, and the Server-Manager
    // fields are pinned ABSENT by name rather than by an equality that both
    // sides could drift through together.
    const def = actual.get(DEFAULT_PROFILE_NAME) as IrisProfile;
    expect(def.source).toBe("env");
    expect(def).not.toHaveProperty("sourceFile");
    expect(def).not.toHaveProperty("pathPrefix");
    const { name: _n, source: _s, ...connOnly } = def;
    void _n;
    void _s;
    expect(connOnly).toEqual(loadConfig(env));
  });

  it("AC 31.0.4: same proof extended across the existing multi-profile matrix (IRIS_PROFILES set, fixture present, IRIS_SERVER_MANAGER unset)", async () => {
    const workspaceDir = tmpWorkspaceWithSettings(POPULATED_SETTINGS);
    const env = {
      IRIS_USERNAME: "admin",
      IRIS_PASSWORD: "secret",
      IRIS_PROFILES: JSON.stringify({
        prod: { host: "prod.example.com" },
        staging: { host: "staging.example.com" },
      }),
      IRIS_SM_WORKSPACE: workspaceDir,
    };
    const defaultConfig = loadConfig(env);
    const expected = buildProfileRegistry(defaultConfig, env);
    const actual = await loadProfileRegistry(env);

    expect(actual).toEqual(expected);
    expect([...actual.keys()].sort()).toEqual(["default", "prod", "staging"]);

    // Same independent-oracle anchor as above, across the multi-profile
    // matrix: EVERY profile is env-sourced and carries no Server-Manager
    // field, and the default's connection fields still equal `loadConfig`'s
    // (pre-feature, untouched by this epic) output.
    for (const profile of actual.values()) {
      expect(profile.source).toBe("env");
      expect(profile).not.toHaveProperty("sourceFile");
      expect(profile).not.toHaveProperty("pathPrefix");
    }
    const def = actual.get(DEFAULT_PROFILE_NAME) as IrisProfile;
    const { name: _n, source: _s, ...connOnly } = def;
    void _n;
    void _s;
    expect(connOnly).toEqual(loadConfig(env));
  });

  it("AC 31.0.4: explicit IRIS_SERVER_MANAGER=off is likewise inert with the fixture present", async () => {
    const workspaceDir = tmpWorkspaceWithSettings(POPULATED_SETTINGS);
    const env = {
      IRIS_USERNAME: "admin",
      IRIS_PASSWORD: "secret",
      IRIS_SERVER_MANAGER: "off",
      IRIS_SM_WORKSPACE: workspaceDir,
    };
    const defaultConfig = loadConfig(env);
    const expected = buildProfileRegistry(defaultConfig, env);
    await expect(loadProfileRegistry(env)).resolves.toEqual(expected);
  });

  it("AC 31.0.5 (positive path): with IRIS_SERVER_MANAGER=auto, a resolvable (legacy-password) Server-Manager profile IS added to the registry", async () => {
    const workspaceDir = tmpWorkspaceWithSettings(POPULATED_SETTINGS);
    const env = {
      IRIS_USERNAME: "admin",
      IRIS_PASSWORD: "secret",
      IRIS_SERVER_MANAGER: "auto",
      IRIS_SM_WORKSPACE: workspaceDir,
    };
    // "someServer" resolves via its own legacy inline password, so the chain
    // is never invoked for it. Code review 2026-07-25: that invariant is
    // asserted with a THROWING seam rather than relied on — omitting the
    // injection made AC 31.1.2 ("no test touches a real keychain") depend on
    // the code under test being correct, so a regression would have hit the
    // developer's real Windows Credential Manager instead of failing loudly.
    const getKeychainPassword = vi.fn(async (): Promise<string | undefined> => {
      throw new Error("the credential chain must not run for an already-resolved entry");
    });
    const registry = await loadProfileRegistry(env, process.platform, { getKeychainPassword });
    expect(getKeychainPassword).not.toHaveBeenCalled();
    expect(registry.has("someServer")).toBe(true);
    const sm = registry.get("someServer") as IrisProfile;
    expect(sm.host).toBe("sm.example.com");
    expect(sm.password).toBe("smpass");
  });

  it("Story 31.1: with IRIS_SERVER_MANAGER=auto, a passwordless-but-chain-exhausted Server-Manager profile is EXCLUDED from the registry, with a per-profile remediation log line", async () => {
    const workspaceDir = tmpWorkspaceWithSettings({
      "intersystems.servers": {
        noPassword: {
          webServer: { scheme: "http", host: "other.example.com", port: 52773 },
          username: "u",
        },
      },
    });
    const env = {
      IRIS_USERNAME: "admin",
      IRIS_PASSWORD: "secret",
      IRIS_SERVER_MANAGER: "auto",
      IRIS_SM_WORKSPACE: workspaceDir,
    };
    // AC 31.1.2: no test may touch a real keychain — inject a fake that never
    // resolves anything, so "noPassword" is genuinely chain-exhausted.
    const registry = await loadProfileRegistry(env, process.platform, {
      getKeychainPassword: async () => undefined,
    });

    expect(registry.has("noPassword")).toBe(false);
    expect([...registry.keys()]).toEqual([DEFAULT_PROFILE_NAME]);
    const warnSpy = vi.mocked(logger.warn);
    const exhaustionCalls = warnSpy.mock.calls.filter((c) =>
      String(c[0]).includes("credential chain") && String(c[0]).includes("noPassword"),
    );
    expect(exhaustionCalls).toHaveLength(1);
    // AC 31.1.1 link 4: all three remediations named verbatim.
    const message = String(exhaustionCalls[0]?.[0]);
    expect(message).toContain("iris-mcp-credentials set noPassword");
    expect(message).toContain("IRIS_CREDENTIAL_HELPER");
    expect(message).toContain("IRIS_PROFILES");
  });

  it("an env-defined profile name wins over a same-named Server-Manager definition (minimal wire-in never overwrites an existing entry, and never runs the chain for the shadowed name)", async () => {
    const workspaceDir = tmpWorkspaceWithSettings({
      "intersystems.servers": {
        prod: {
          webServer: { scheme: "https", host: "sm-prod.example.com", port: 443 },
          username: "smuser",
          password: "smpass",
        },
      },
    });
    const env = {
      IRIS_USERNAME: "admin",
      IRIS_PASSWORD: "secret",
      IRIS_PROFILES: JSON.stringify({ prod: { host: "env-prod.example.com" } }),
      IRIS_SERVER_MANAGER: "auto",
      IRIS_SM_WORKSPACE: workspaceDir,
    };
    // Code review 2026-07-25: this used to omit the injection deliberately,
    // reasoning that "a real keychain lookup would fire" if the filter
    // regressed. That makes the regression signal a real-keychain access on
    // the developer's machine (an AC 31.1.2 violation) instead of a failed
    // assertion. Inject a throwing seam and assert it was never called: the
    // invariant is now self-enforcing.
    const getKeychainPassword = vi.fn(async (): Promise<string | undefined> => {
      throw new Error("the credential chain must not run for a registry-shadowed name");
    });
    const registry = await loadProfileRegistry(env, process.platform, { getKeychainPassword });
    expect(getKeychainPassword).not.toHaveBeenCalled();
    const prod = registry.get("prod") as IrisProfile;
    expect(prod.host).toBe("env-prod.example.com");
  });

  // ── QA addition: genuine end-to-end pass through loadProfileRegistry ──
  //
  // Every test above drives loadProfileRegistry through a SINGLE settings
  // file (IRIS_SM_WORKSPACE only). It never exercises the real multi-file
  // discovery precedence (workspace .vscode/settings.json outranking a VS
  // Code product's user settings.json) THROUGH the full loadProfileRegistry
  // entry point — server-manager-source.test.ts proves precedence at the
  // resolveServerManagerProfiles layer directly, but AC 31.0.4/31.0.5 are
  // about what ships through loadProfileRegistry specifically. Close that
  // gap with a real on-disk two-file fixture and no IRIS_SM_SETTINGS_PATHS
  // override anywhere in the env.
  //
  // Code review 2026-07-25: this drives the LINUX/HOME branch (with tmp paths
  // normalized to forward slashes, matching path.posix.join's output) rather
  // than win32/APPDATA. Node's fs accepts forward-slash paths on Windows, so
  // this runs for real on every host OS. The earlier win32 form composed the
  // fixture directories with the HOST path module while discovery used
  // path.win32.join — on a posix host those disagree, the read ENOENTs, and
  // the swallow turns a genuine cross-platform failure into a red assertion.
  it("loadProfileRegistry(auto): resolves a real multi-file discovery precedence (workspace beats user settings) end-to-end, with no IRIS_SM_SETTINGS_PATHS override", async () => {
    /** A tmpdir path normalized to forward slashes, matching path.posix.join's output style. */
    const posixTmp = (prefix: string): string => {
      const raw = mkdtempSync(join(tmpdir(), prefix));
      dirs.push(raw);
      return raw.split("\\").join("/");
    };

    const workspaceDir = posixTmp("iris-profiles-e2e-ws-");
    mkdirSync(`${workspaceDir}/.vscode`, { recursive: true });
    writeFileSync(
      `${workspaceDir}/.vscode/settings.json`,
      JSON.stringify({
        "intersystems.servers": {
          dup: {
            webServer: { scheme: "http", host: "workspace-host.example.com", port: 52773 },
            username: "u",
            password: "wspw",
          },
          onlyInWorkspace: {
            webServer: { scheme: "http", host: "only-ws.example.com", port: 52773 },
            username: "u",
            password: "wspw2",
          },
        },
      }),
      "utf8",
    );

    const homeDir = posixTmp("iris-profiles-e2e-home-");
    mkdirSync(`${homeDir}/.config/Code/User`, { recursive: true });
    writeFileSync(
      `${homeDir}/.config/Code/User/settings.json`,
      JSON.stringify({
        "intersystems.servers": {
          dup: {
            webServer: { scheme: "http", host: "user-settings-host.example.com", port: 52773 },
            username: "u",
            password: "uspw",
          },
          onlyInUserSettings: {
            webServer: { scheme: "http", host: "only-us.example.com", port: 52773 },
            username: "u",
            password: "uspw2",
          },
        },
      }),
      "utf8",
    );

    const env = {
      IRIS_USERNAME: "admin",
      IRIS_PASSWORD: "secret",
      IRIS_SERVER_MANAGER: "auto",
      IRIS_SM_WORKSPACE: workspaceDir,
      HOME: homeDir,
      // No IRIS_SM_SETTINGS_PATHS — this exercises real discoverSettingsFiles
      // precedence ordering, pinned to the linux branch so HOME is the one
      // consulted regardless of the host OS running this suite (Node's fs
      // accepts the forward-slash paths path.posix.join composes on Windows).
    };
    const registry = await loadProfileRegistry(env, "linux");

    // Entries unique to each file both made it in.
    const onlyWs = registry.get("onlyInWorkspace") as IrisProfile;
    const onlyUs = registry.get("onlyInUserSettings") as IrisProfile;
    expect(onlyWs?.host).toBe("only-ws.example.com");
    expect(onlyUs?.host).toBe("only-us.example.com");

    // The name defined in BOTH files resolves to the workspace file's
    // definition — workspace outranks user settings (AC 31.0.1 precedence),
    // proven here through the full loadProfileRegistry entry point, not just
    // resolveServerManagerProfiles in isolation.
    const dup = registry.get("dup") as IrisProfile;
    expect(dup?.host).toBe("workspace-host.example.com");
    // Story 31.3, Task 4 (deferred item 31-0-3): sourceFile ties the winning
    // definition back to the WORKSPACE file specifically, not the shadowed
    // user-settings file — the whole point of surfacing provenance is that an
    // operator can tell the two apart even though both declared "dup".
    expect(dup?.source).toBe("server-manager");
    expect(dup?.sourceFile).toBe(`${workspaceDir}/.vscode/settings.json`);
    expect(dup?.sourceFile).not.toBe(`${homeDir}/.config/Code/User/settings.json`);
  });
});

// ════════════════════════════════════════════════════════════════════
// Story 31.1 — Integration AC 31.1.5: the credential chain's output feeds
// loadProfileRegistry, driven through the REAL entry point (not
// resolveServerManagerProfiles in isolation).
// ════════════════════════════════════════════════════════════════════

describe("Integration AC 31.1.5 — credential chain wired into loadProfileRegistry", () => {
  let dirs: string[] = [];

  function tmpWorkspaceWithSettings(settingsJson: unknown): string {
    const dir = mkdtempSync(join(tmpdir(), "iris-profiles-311-"));
    dirs.push(dir);
    mkdirSync(join(dir, ".vscode"), { recursive: true });
    writeFileSync(join(dir, ".vscode", "settings.json"), JSON.stringify(settingsJson), "utf8");
    return dir;
  }

  beforeEach(() => {
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    vi.spyOn(logger, "debug").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs = [];
  });

  // A settings-file definition carrying NO password (and an explicit
  // username, per Task 6 — 31-0-2 forces a passwordless entry unresolved
  // regardless when username is absent, which would make this fixture always
  // fail the CHAIN's own env/keychain/helper resolution, defeating the point
  // of THIS test).
  const NO_PASSWORD_SETTINGS = {
    "intersystems.servers": {
      chainServer: {
        webServer: { scheme: "https", host: "chain.example.com", port: 443 },
        username: "chainuser",
      },
    },
  };

  it("with a password available from an injected keychain seam, loadProfileRegistry returns a registry containing the chain-resolved profile", async () => {
    const workspaceDir = tmpWorkspaceWithSettings(NO_PASSWORD_SETTINGS);
    const env = {
      IRIS_USERNAME: "admin",
      IRIS_PASSWORD: "secret",
      IRIS_SERVER_MANAGER: "auto",
      IRIS_SM_WORKSPACE: workspaceDir,
    };
    const registry = await loadProfileRegistry(env, process.platform, {
      getKeychainPassword: async (name) => (name === "chainServer" ? "chainresolvedpw" : undefined),
    });

    expect(registry.has("chainServer")).toBe(true);
    const chainProfile = registry.get("chainServer") as IrisProfile;
    expect(chainProfile.host).toBe("chain.example.com");
    expect(chainProfile.username).toBe("chainuser");
    expect(chainProfile.password).toBe("chainresolvedpw");

    // Task 7 / AC 31.1.4: a chain-resolved password never appears in the
    // iris_server_profiles roster (the allow-list is source-agnostic).
    const roster = buildRoster(registry);
    const rosterJson = JSON.stringify(roster);
    expect(rosterJson).not.toContain("chainresolvedpw");
    expect(rosterJson).not.toContain("password");
  });

  it("with the SAME call but an empty keychain seam (and no helper/env), the profile is EXCLUDED", async () => {
    const workspaceDir = tmpWorkspaceWithSettings(NO_PASSWORD_SETTINGS);
    const env = {
      IRIS_USERNAME: "admin",
      IRIS_PASSWORD: "secret",
      IRIS_SERVER_MANAGER: "auto",
      IRIS_SM_WORKSPACE: workspaceDir,
    };
    const registry = await loadProfileRegistry(env, process.platform, {
      getKeychainPassword: async () => undefined,
    });

    expect(registry.has("chainServer")).toBe(false);
    expect([...registry.keys()]).toEqual([DEFAULT_PROFILE_NAME]);
  });

  it("under IRIS_SERVER_MANAGER=required, the SAME exhausted-chain scenario throws (distinct from the zero-definitions-found required check)", async () => {
    const workspaceDir = tmpWorkspaceWithSettings(NO_PASSWORD_SETTINGS);
    const env = {
      IRIS_USERNAME: "admin",
      IRIS_PASSWORD: "secret",
      IRIS_SERVER_MANAGER: "required",
      IRIS_SM_WORKSPACE: workspaceDir,
    };
    let caught: unknown;
    try {
      await loadProfileRegistry(env, process.platform, {
        getKeychainPassword: async () => undefined,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    expect(message).toContain("IRIS_SERVER_MANAGER=required");
    expect(message).toContain("chainServer");
    // Distinct from resolveServerManagerProfiles's own "zero definitions
    // found" required check — a definition WAS found here.
    expect(message).not.toContain("zero server definitions were found");
  });

  // ── QA addition: loadProfileRegistry becoming `async` (Story 31.1) is a
  // silent-failure hazard at every call site — an unawaited call yields a
  // `Promise<ProfileRegistry>` that duck-types as "truthy object" right up
  // until the first `.get()`/`.has()`/spread call throws a confusing
  // `TypeError`. Pin that the REAL entry point, once awaited, always hands
  // back an actual `Map` instance (not a thenable, not a Promise still
  // pending) — both on the trivial no-op path and on the path that actually
  // awaits the credential chain internally.
  it("await loadProfileRegistry(...) resolves to a real Map instance, never a Promise (async-wiring regression guard)", async () => {
    const plain = await loadProfileRegistry({ IRIS_USERNAME: "u", IRIS_PASSWORD: "p" });
    expect(plain).toBeInstanceOf(Map);
    expect(typeof (plain as unknown as { then?: unknown }).then).toBe("undefined");

    const workspaceDir = tmpWorkspaceWithSettings(NO_PASSWORD_SETTINGS);
    const withChain = await loadProfileRegistry(
      {
        IRIS_USERNAME: "admin",
        IRIS_PASSWORD: "secret",
        IRIS_SERVER_MANAGER: "auto",
        IRIS_SM_WORKSPACE: workspaceDir,
      },
      process.platform,
      { getKeychainPassword: async () => "resolvedviachain" },
    );
    expect(withChain).toBeInstanceOf(Map);
    expect(withChain.get("chainServer")?.password).toBe("resolvedviachain");
  });

  // ══════════════════════════════════════════════════════════════════
  // Code review 2026-07-25 — end-to-end regressions for the three HIGH
  // defects the review found. Each drives the REAL loadProfileRegistry
  // entry point, because each one was invisible at the unit layer: the
  // source module and the chain were individually correct, and the defect
  // only existed in what happened between them.
  // ══════════════════════════════════════════════════════════════════

  it("CR HIGH (31-0-2): an entry with no username of its own is NOT completed by the chain — even when the keychain WOULD have supplied a password", async () => {
    const workspaceDir = tmpWorkspaceWithSettings({
      "intersystems.servers": {
        noUserSrv: {
          webServer: { scheme: "https", host: "remote.example.com", port: 443 },
          // No "username" — must never be paired with the local default's.
        },
      },
    });
    const env = {
      IRIS_USERNAME: "localadmin",
      IRIS_PASSWORD: "localsecret",
      IRIS_SERVER_MANAGER: "auto",
      IRIS_SM_WORKSPACE: workspaceDir,
    };
    // The seam WOULD resolve this name — that is the whole point. Before the
    // fix the chain wrote this password onto a profile still carrying
    // username "localadmin" and host remote.example.com: the exact remote
    // account-lockout pairing deferred item 31-0-2 exists to prevent.
    const getKeychainPassword = vi.fn(async () => "KEYCHAINPW");
    const registry = await loadProfileRegistry(env, process.platform, { getKeychainPassword });

    expect(registry.has("noUserSrv")).toBe(false);
    expect([...registry.keys()]).toEqual([DEFAULT_PROFILE_NAME]);
    // The chain is never even consulted for a skipped definition.
    expect(getKeychainPassword).not.toHaveBeenCalled();
    // And the operator is told why, in every case (not only when an inline
    // password happened to be present).
    const warnSpy = vi.mocked(logger.warn);
    expect(
      warnSpy.mock.calls.filter((c) => String(c[0]).includes(`declares no "username" of its own`)),
    ).toHaveLength(1);
  });

  it("CR HIGH (link 1): an IRIS_PROFILES entry supplying only a password does NOT complete a Server-Manager definition — the discard is announced, never silent", async () => {
    const workspaceDir = tmpWorkspaceWithSettings({
      "intersystems.servers": {
        prodRemote: {
          webServer: { scheme: "https", host: "prod.remote.example.com", port: 443 },
          username: "svcacct",
        },
      },
    });
    const env = {
      IRIS_HOST: "localhost",
      IRIS_USERNAME: "localadmin",
      IRIS_PASSWORD: "localsecret",
      IRIS_SERVER_MANAGER: "auto",
      IRIS_SM_WORKSPACE: workspaceDir,
      // Exactly what the pre-fix remediation text told operators to do.
      IRIS_PROFILES: JSON.stringify({ prodRemote: { password: "REMOTE-SECRET" } }),
    };
    const registry = await loadProfileRegistry(env, process.platform, {
      getKeychainPassword: async () => undefined,
    });

    // Behavior is unchanged (environment always wins — AC 31.3.1's settled
    // precedence): the env profile inherits the LOCAL host. What must NOT
    // happen is this being silent, because the resulting profile carries a
    // remote credential aimed at the local instance.
    const prodRemote = registry.get("prodRemote") as IrisProfile;
    expect(prodRemote.host).toBe("localhost");
    const warnSpy = vi.mocked(logger.warn);
    const collisionWarnings = warnSpy.mock.calls.filter(
      (c) =>
        String(c[0]).includes("prodRemote") &&
        String(c[0]).includes("already defined by IRIS_*/IRIS_PROFILES"),
    );
    expect(collisionWarnings).toHaveLength(1);
    const message = String(collisionWarnings[0]?.[0]);
    expect(message).toContain("prod.remote.example.com");
    expect(message).toContain("discarded ENTIRELY");
    // Secret discipline: the collision notice never echoes the password.
    for (const call of warnSpy.mock.calls) {
      expect(call.map(String).join(" ")).not.toContain("REMOTE-SECRET");
    }
  });

  it("CR HIGH (never-throws): a keychain seam returning null (the shape @napi-rs/keyring itself returns) degrades to exclusion — it must not reject loadProfileRegistry", async () => {
    const workspaceDir = tmpWorkspaceWithSettings(NO_PASSWORD_SETTINGS);
    const env = {
      IRIS_USERNAME: "admin",
      IRIS_PASSWORD: "secret",
      IRIS_SERVER_MANAGER: "auto",
      IRIS_SM_WORKSPACE: workspaceDir,
    };
    // `Entry.getPassword()` is typed `string | null`; a consumer wiring it
    // straight through used to crash startup with a TypeError from `.trim()`.
    const registry = await loadProfileRegistry(env, process.platform, {
      getKeychainPassword: async () => null as unknown as string | undefined,
    });
    expect(registry.has("chainServer")).toBe(false);
    expect([...registry.keys()]).toEqual([DEFAULT_PROFILE_NAME]);
  });

  // ── Story 31.3, Task 1 — full merge semantics ────────────────────────

  it("AC 31.3.1: a name collision produces ONE aggregate log notice naming both sources, not one line per collision, even with MULTIPLE collisions", async () => {
    const workspaceDir = tmpWorkspaceWithSettings({
      "intersystems.servers": {
        prod: {
          webServer: { scheme: "https", host: "sm-prod.example.com", port: 443 },
          username: "smuser",
          password: "smpass",
        },
        staging: {
          webServer: { scheme: "https", host: "sm-staging.example.com", port: 443 },
          username: "smuser2",
          password: "smpass2",
        },
      },
    });
    const env = {
      IRIS_USERNAME: "admin",
      IRIS_PASSWORD: "secret",
      IRIS_PROFILES: JSON.stringify({
        prod: { host: "env-prod.example.com" },
        staging: { host: "env-staging.example.com" },
      }),
      IRIS_SERVER_MANAGER: "auto",
      IRIS_SM_WORKSPACE: workspaceDir,
    };
    await loadProfileRegistry(env);

    const warnSpy = vi.mocked(logger.warn);
    const collisionWarnings = warnSpy.mock.calls.filter((c) =>
      String(c[0]).includes("collided with an existing"),
    );
    // ONE aggregate notice, even though TWO names collided.
    expect(collisionWarnings).toHaveLength(1);
    const message = String(collisionWarnings[0]?.[0]);
    expect(message).toContain("2 definition(s) collided");
    expect(message).toContain('"prod"');
    expect(message).toContain('"staging"');
    expect(message).toContain("sm-prod.example.com");
    expect(message).toContain("sm-staging.example.com");
    // Names both provenance sources.
    expect(message).toContain('"env"');
    expect(message).toContain('"server-manager"');
    // Nothing here involves the reserved name, so the reserved-name note must
    // NOT appear (it would be noise on an ordinary collision).
    expect(message).not.toContain("RESERVED profile name");
  });

  // Code review 2026-07-25 (LOW, raised independently by two review layers):
  // the reserved `default` profile is unconditionally in the registry, so a
  // Server Manager server literally named "default" ALWAYS collides — and the
  // generic remedy tells the operator to remove an IRIS_PROFILES entry that,
  // in this fixture, does not exist. The message must name the only remedy
  // that works.
  it("AC 31.3.1: a Server Manager definition named \"default\" collides with the RESERVED profile and says so, instead of prescribing an IRIS_PROFILES edit that cannot help", async () => {
    const workspaceDir = tmpWorkspaceWithSettings({
      "intersystems.servers": {
        default: {
          webServer: { scheme: "https", host: "sm-default.example.com", port: 443 },
          username: "smuser",
          password: "smpass",
        },
      },
    });
    // Deliberately NO IRIS_PROFILES at all — the collision is with the
    // synthesized reserved default, not with any operator-written entry.
    const env = {
      IRIS_USERNAME: "admin",
      IRIS_PASSWORD: "secret",
      IRIS_SERVER_MANAGER: "auto",
      IRIS_SM_WORKSPACE: workspaceDir,
    };
    const registry = await loadProfileRegistry(env);

    // The env-synthesized default wins; the SM definition never lands.
    expect([...registry.keys()]).toEqual([DEFAULT_PROFILE_NAME]);
    expect(registry.get(DEFAULT_PROFILE_NAME)?.host).toBe("localhost");
    expect(registry.get(DEFAULT_PROFILE_NAME)?.source).toBe("env");

    const warnSpy = vi.mocked(logger.warn);
    const message = String(
      warnSpy.mock.calls.find((c) => String(c[0]).includes("collided with an existing"))?.[0],
    );
    expect(message).toContain("1 definition(s) collided");
    expect(message).toContain("RESERVED profile name");
    expect(message).toContain("rename it in");
  });

  // ── 31-3-1 (Story 32.3, PAIRED DECISION with 31-4-4 — AC 32.3.4) ────────
  // The reserved-name / collision policy, uniform on both sides of the
  // process boundary: a collision is never silent (the aggregate warning
  // above), and under IRIS_SERVER_MANAGER=required a settings file whose
  // EVERY definition is discarded by a collision is a startup FAILURE —
  // `required` means "at least one Server-Manager profile must reach the
  // registry", not merely "the source produced definitions".
  it("31-3-1: required mode throws when EVERY Server-Manager definition is discarded by a collision (here: the reserved \"default\")", async () => {
    const workspaceDir = tmpWorkspaceWithSettings({
      "intersystems.servers": {
        default: {
          webServer: { scheme: "https", host: "sm-default.example.com", port: 443 },
          username: "smuser",
          password: "smpass",
        },
      },
    });
    const env = {
      IRIS_USERNAME: "admin",
      IRIS_PASSWORD: "secret",
      IRIS_SERVER_MANAGER: "required",
      IRIS_SM_WORKSPACE: workspaceDir,
    };
    let caught: unknown;
    try {
      await loadProfileRegistry(env);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    expect(message).toContain("IRIS_SERVER_MANAGER=required");
    expect(message).toContain("collided");
    // The remedy for the reserved name: rename the Server Manager definition.
    expect(message).toContain("rename");
    // Secret discipline: the colliding definition's password is never echoed.
    expect(message).not.toContain("smpass");
  });

  it("31-3-1: required mode does NOT throw when at least one Server-Manager definition survives the collision filter", async () => {
    const workspaceDir = tmpWorkspaceWithSettings({
      "intersystems.servers": {
        prod: {
          webServer: { scheme: "https", host: "sm-prod.example.com", port: 443 },
          username: "smuser",
          password: "smpass",
        },
        unique: {
          webServer: { scheme: "https", host: "sm-unique.example.com", port: 443 },
          username: "smuser2",
          password: "smpass2",
        },
      },
    });
    const env = {
      IRIS_USERNAME: "admin",
      IRIS_PASSWORD: "secret",
      IRIS_PROFILES: JSON.stringify({ prod: { host: "env-prod.example.com" } }),
      IRIS_SERVER_MANAGER: "required",
      IRIS_SM_WORKSPACE: workspaceDir,
    };
    const registry = await loadProfileRegistry(env);
    expect(registry.has("unique")).toBe(true);
    expect(registry.get("prod")?.host).toBe("env-prod.example.com");
  });

  // ── 31-1-5 (Story 32.3): the pending-resolution debug summary is emitted
  // from THIS layer, post-filter, so names discarded by the collision filter
  // (which never reach the chain) are not counted.
  it("31-1-5: the pending-resolution debug summary counts only profiles that actually reach the chain (post-filter)", async () => {
    const workspaceDir = tmpWorkspaceWithSettings({
      "intersystems.servers": {
        shadowed: {
          webServer: { scheme: "https", host: "shadowed.example.com", port: 443 },
          username: "u",
        },
        pending: {
          webServer: { scheme: "https", host: "pending.example.com", port: 443 },
          username: "u",
        },
      },
    });
    const env = {
      IRIS_USERNAME: "admin",
      IRIS_PASSWORD: "secret",
      IRIS_PROFILES: JSON.stringify({ shadowed: { host: "env-shadowed.example.com" } }),
      IRIS_SERVER_MANAGER: "auto",
      IRIS_SM_WORKSPACE: workspaceDir,
    };
    await loadProfileRegistry(env);

    const debugSpy = vi.mocked(logger.debug);
    const summaryCalls = debugSpy.mock.calls.filter((c) =>
      String(c[0]).includes("have no password yet"),
    );
    expect(summaryCalls).toHaveLength(1);
    // "shadowed" was discarded by the collision filter BEFORE the chain — the
    // pre-31-1-5 line (emitted inside resolveServerManagerProfiles) counted
    // it anyway, claiming 2 profiles would be attempted.
    expect(String(summaryCalls[0]?.[0])).toContain("1 server profile(s) have no password yet");
  });

  it("AC 31.3.1: ProfileClientRegistry session isolation behaves identically for a Server-Manager-sourced profile as for an env one", async () => {
    const workspaceDir = tmpWorkspaceWithSettings({
      "intersystems.servers": {
        smServer: {
          webServer: { scheme: "https", host: "sm.example.com", port: 443 },
          username: "smuser",
          password: "smpass",
        },
      },
    });
    const env = {
      IRIS_USERNAME: "admin",
      IRIS_PASSWORD: "secret",
      IRIS_PROFILES: JSON.stringify({ envServer: { host: "env.example.com" } }),
      IRIS_SERVER_MANAGER: "auto",
      IRIS_SM_WORKSPACE: workspaceDir,
    };
    const registry = await loadProfileRegistry(env);
    const smProfile = registry.get("smServer") as IrisProfile;
    expect(smProfile.source).toBe("server-manager");

    const clients = new ProfileClientRegistry(registry);
    const smClient = clients.getOrCreate("smServer");
    const envClient = clients.getOrCreate("envServer");
    const defaultClient = clients.getOrCreate(DEFAULT_PROFILE_NAME);

    // Same structural guarantee (D1/D8) regardless of provenance: distinct
    // instances, no sharing across profiles.
    expect(smClient).toBeInstanceOf(IrisHttpClient);
    expect(smClient).not.toBe(envClient);
    expect(smClient).not.toBe(defaultClient);
    // Caching behaves identically too.
    expect(clients.getOrCreate("smServer")).toBe(smClient);
    smClient.destroy();
  });

  it("AC 31.3.1: the governance cascade resolves identically for a Server-Manager-sourced profile name as for an env one", async () => {
    const workspaceDir = tmpWorkspaceWithSettings({
      "intersystems.servers": {
        smServer: {
          webServer: { scheme: "https", host: "sm.example.com", port: 443 },
          username: "smuser",
          password: "smpass",
        },
      },
    });
    const env = {
      IRIS_USERNAME: "admin",
      IRIS_PASSWORD: "secret",
      IRIS_PROFILES: JSON.stringify({ envServer: { host: "env.example.com" } }),
      IRIS_SERVER_MANAGER: "auto",
      IRIS_SM_WORKSPACE: workspaceDir,
    };
    const registry = await loadProfileRegistry(env);
    const smProfile = registry.get("smServer") as IrisProfile;
    const envProfile = registry.get("envServer") as IrisProfile;
    expect(smProfile.source).toBe("server-manager");
    expect(envProfile.source).toBe("env");

    const mutatesLookup: MutatesLookup = new Map([["iris_new_tool:write", "write"]]);
    const baseline: ReadonlySet<string> = new Set(["iris_old_tool"]);

    // Same synthetic governance config, applied per-profile — the cascade
    // (`effective`) keys ONLY on the profile NAME string; it has no notion
    // of `source` at all. An explicit profile-layer override behaves
    // identically whichever provenance the name resolves to.
    const config: GovernanceConfig = {
      profiles: {
        smServer: { iris_old_tool: false },
        envServer: { iris_old_tool: false },
      },
    };
    expect(effective("iris_old_tool", "smServer", config, mutatesLookup, baseline)).toBe(false);
    expect(effective("iris_old_tool", "envServer", config, mutatesLookup, baseline)).toBe(false);
    // And with no override, both fall through to the SAME default-seed result.
    const emptyConfig: GovernanceConfig = {};
    expect(
      effective("iris_new_tool:write", "smServer", emptyConfig, mutatesLookup, baseline),
    ).toBe(
      effective("iris_new_tool:write", "envServer", emptyConfig, mutatesLookup, baseline),
    );
  });

  it("AC 31.3.2: the iris_server_profiles roster surfaces source/sourceFile for a Server-Manager-sourced profile, still with NO password leak (redaction sweep re-run over the extended shape)", async () => {
    const workspaceDir = tmpWorkspaceWithSettings({
      "intersystems.servers": {
        smServer: {
          webServer: { scheme: "https", host: "sm.example.com", port: 443 },
          username: "smuser",
          password: "supersecretsmpassword",
        },
      },
    });
    const env = {
      IRIS_USERNAME: "admin",
      IRIS_PASSWORD: "secret",
      IRIS_SERVER_MANAGER: "auto",
      IRIS_SM_WORKSPACE: workspaceDir,
    };
    const registry = await loadProfileRegistry(env);
    const roster = buildRoster(registry);
    const smEntry = roster.find((r) => r.name === "smServer");
    expect(smEntry?.source).toBe("server-manager");
    expect(smEntry?.sourceFile).toContain("settings.json");

    const defEntry = roster.find((r) => r.name === DEFAULT_PROFILE_NAME);
    expect(defEntry?.source).toBe("env");
    expect(defEntry?.sourceFile).toBeUndefined();
    expect(defEntry).not.toHaveProperty("sourceFile");

    // Redaction sweep, re-run over the WIDENED shape (Task 2): no roster
    // entry has a `password` own key, and the serialized roster never
    // contains the SM profile's secret value.
    for (const entry of roster) {
      expect(Object.prototype.hasOwnProperty.call(entry, "password")).toBe(false);
    }
    const rosterJson = JSON.stringify(roster);
    expect(rosterJson).not.toContain("password");
    expect(rosterJson).not.toContain("supersecretsmpassword");
    // buildRosterEntry individually, too (the allow-list unit itself).
    const smProfile = registry.get("smServer") as IrisProfile;
    const directEntry = buildRosterEntry(smProfile);
    expect(Object.prototype.hasOwnProperty.call(directEntry, "password")).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════
// Story 31.3 QA additions (bmad-qa-generate-e2e-tests pass, 2026-07-25):
// closing two gaps the dev-stage tests left implicit.
// ════════════════════════════════════════════════════════════════════

describe("Story 31.3 QA — pathPrefix reaches the actual HTTP request URL", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // Deferred item 31-0-4's resolution pins `baseUrl` as a STRING; this proves
  // the invariant one layer further down, at the actual fetch call an
  // IrisHttpClient makes — the only place a wrong prefix would actually break
  // a real IRIS web-gateway connection with a non-root pathPrefix configured.
  it("a profile carrying pathPrefix composes the request URL as baseUrl + path at the actual HTTP layer, not just the string field", async () => {
    const defaultConfig = loadConfig({ IRIS_USERNAME: "admin", IRIS_PASSWORD: "secret" });
    const profile = mergeProfile(
      "prefixed",
      defaultConfig,
      { host: "prefixed.example.com", port: 443, https: true },
      "IRIS_PROFILES",
      "server-manager",
      "/myprefix",
    );
    expect(profile.baseUrl).toBe("https://prefixed.example.com:443/myprefix");

    const client = new IrisHttpClient(profile, profile.timeout);
    fetchMock.mockResolvedValueOnce(mockResponse(atelierResponse({})));
    await client.get("/api/atelier/");

    const [requestedUrl] = fetchMock.mock.calls[0] as [string, RequestInit];
    // The prefix appears BEFORE the API path — this is what an IRIS web
    // gateway configured with a non-root pathPrefix actually requires to
    // route the request correctly.
    expect(requestedUrl).toBe("https://prefixed.example.com:443/myprefix/api/atelier/");

    client.destroy();
  });

  it("a profile with NO pathPrefix composes the request URL identically to today's derivation (env profiles are provably unaffected — Rule #19)", async () => {
    const defaultConfig = loadConfig({ IRIS_USERNAME: "admin", IRIS_PASSWORD: "secret" });
    const profile = mergeProfile("unprefixed", defaultConfig, {
      host: "unprefixed.example.com",
      port: 80,
      https: false,
    });
    expect(profile.baseUrl).toBe("http://unprefixed.example.com:80");
    expect(profile).not.toHaveProperty("pathPrefix");

    const client = new IrisHttpClient(profile, profile.timeout);
    fetchMock.mockResolvedValueOnce(mockResponse(atelierResponse({})));
    await client.get("/api/atelier/");

    const [requestedUrl] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(requestedUrl).toBe("http://unprefixed.example.com:80/api/atelier/");

    client.destroy();
  });
});

describe("Story 31.3 QA — sourceFile never carries a secret, even directly (not just via full-JSON redaction)", () => {
  let dirs: string[] = [];

  function tmpWorkspaceWithSettings(settingsJson: unknown): string {
    const dir = mkdtempSync(join(tmpdir(), "iris-profiles-313-qa-"));
    dirs.push(dir);
    mkdirSync(join(dir, ".vscode"), { recursive: true });
    writeFileSync(join(dir, ".vscode", "settings.json"), JSON.stringify(settingsJson), "utf8");
    return dir;
  }

  beforeEach(() => {
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    vi.spyOn(logger, "debug").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs = [];
  });

  it("sourceFile is a bare filesystem path — the secret VALUE never appears inside it, isolated from the rest of the roster JSON", async () => {
    const SECRET = "sm-super-secret-password-xyz789";
    const workspaceDir = tmpWorkspaceWithSettings({
      "intersystems.servers": {
        smServer: {
          webServer: { scheme: "https", host: "sm.example.com", port: 443 },
          username: "smuser",
          password: SECRET,
        },
      },
    });
    const env = {
      IRIS_USERNAME: "admin",
      IRIS_PASSWORD: "secret",
      IRIS_SERVER_MANAGER: "auto",
      IRIS_SM_WORKSPACE: workspaceDir,
    };
    const registry = await loadProfileRegistry(env);
    const smProfile = registry.get("smServer") as IrisProfile;
    const entry = buildRosterEntry(smProfile);

    // Checked in isolation (not merely "the whole roster JSON is clean") —
    // sourceFile is exactly the settings file path, nothing appended/mixed in.
    expect(entry.sourceFile).toBe(smProfile.sourceFile);
    expect(entry.sourceFile).not.toContain(SECRET);
    expect(entry.sourceFile).not.toContain(smProfile.password);
    expect(entry.sourceFile).not.toContain("password");
    // And it never contains the OTHER connection secret-adjacent field either
    // (username) mixed into the path in some derived/templated form — it is
    // exactly the on-disk file path, verified against the real fixture path.
    expect(entry.sourceFile).toBe(join(workspaceDir, ".vscode", "settings.json"));
  });

  it("documents the accepted trade-off: on a user-scope discovery hit, sourceFile can incidentally reveal the OS account name in the path (not a credential, but a real observation an operator/reviewer should be aware of) — driven through the REAL discovery code (resolveServerManagerProfiles + APPDATA), not a reimplementation", async () => {
    // discoverSettingsFiles (server-manager-source.ts) composes user-settings
    // candidates from APPDATA (win32) / HOME (posix) — exactly the env vars
    // whose REAL values embed "C:\Users\<name>\..." / "/home/<name>/..." on
    // an actual machine. This pins the OBSERVABLE fact that the resulting path
    // is whatever the host env var says, unredacted, because no code path
    // sanitizes it before it reaches sourceFile / the iris_server_profiles
    // roster (which IS returned to the connected MCP client).
    //
    // DECISION (code review 2026-07-25): keep the full path, do not redact.
    // A basename would be useless — every candidate file is literally named
    // "settings.json", so the directory is the entire information content of
    // the field, and conveying it is exactly what deferred item 31-0-3 asked
    // for. The disclosure is non-credential (no secret can reach a path
    // composed by discoverSettingsFiles). It is now documented for users in
    // the README's "Server Manager connections" section and in the doc
    // comments on IrisProfile.sourceFile / ProfileRosterEntry.sourceFile,
    // with the mitigations (workspace-scope definitions, or leave the switch
    // off). This test is the standing pin on that behavior: if it ever starts
    // failing, the redaction decision was changed and the docs must follow.
    const fakeAppData = "C:\\Users\\exampleOperator\\AppData\\Roaming";
    const dir = mkdtempSync(join(tmpdir(), "iris-profiles-313-qa-appdata-"));
    dirs.push(dir);
    // No workspace .vscode/settings.json — force the user-settings (Code)
    // candidate, which is the branch that reads APPDATA.
    //
    // Code review 2026-07-25 (MEDIUM): built with `path.win32.join`, NOT the
    // host `join`. Discovery is pinned to "win32" below, so it composes
    // candidates with `path.win32.join` (backslashes) regardless of host; a
    // host-`join` expectation is backslash-correct only when the test happens
    // to run on Windows and goes RED on any posix CI host. This is the exact
    // defect class the Story 31.0 review already caught once.
    const userSettingsDir = winPath.join(fakeAppData, "Code", "User");
    // fakeAppData does not exist on disk; readFileSync on it will ENOENT and
    // be silently skipped (the normal "no candidate present" case) — this
    // test only asserts what PATH is derived, not that the file is read.
    const env = {
      IRIS_USERNAME: "admin",
      IRIS_PASSWORD: "secret",
      IRIS_SERVER_MANAGER: "auto",
      IRIS_SM_WORKSPACE: dir,
      APPDATA: fakeAppData,
    };
    await loadProfileRegistry(env, "win32");
    // No settings files existed anywhere, so no profile was imported — this
    // test is purely about the CANDIDATE PATH shape, confirmed via the
    // debug log line resolveServerManagerProfiles emits naming every
    // candidate file it checked (highest precedence first).
    const debugSpy = vi.mocked(logger.debug);
    const candidateLog = debugSpy.mock.calls
      .map((c) => String(c[0]))
      .find((msg) => msg.includes("candidate settings files"));
    expect(candidateLog).toContain(winPath.join(userSettingsDir, "settings.json"));
    expect(candidateLog).toContain("exampleOperator");
  });
});
