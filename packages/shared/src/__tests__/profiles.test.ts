import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildProfileRegistry,
  loadProfileRegistry,
  resolveProfile,
  ProfileClientRegistry,
  ProfileResolutionError,
  DEFAULT_PROFILE_NAME,
} from "../profiles.js";
import type { IrisProfile } from "../profiles.js";
import { loadConfig } from "../config.js";
import { IrisHttpClient } from "../http-client.js";
import { logger } from "../logger.js";

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

    // Strip `name` → identical object to today's loadConfig output.
    const { name: _name, ...connOnly } = profile;
    void _name;
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
  it("with no IRIS_PROFILES, produces a single default profile equal to loadConfig", () => {
    const env = {
      IRIS_HOST: "h",
      IRIS_PORT: "52773",
      IRIS_USERNAME: "u",
      IRIS_PASSWORD: "p",
    };
    const registry = loadProfileRegistry(env);
    expect(registry.size).toBe(1);
    const def = registry.get(DEFAULT_PROFILE_NAME) as IrisProfile;
    const { name: _name, ...connOnly } = def;
    void _name;
    expect(connOnly).toEqual(loadConfig(env));
  });

  it("parses IRIS_PROFILES alongside the synthesized default", () => {
    const env = {
      IRIS_USERNAME: "u",
      IRIS_PASSWORD: "p",
      IRIS_PROFILES: JSON.stringify({ prod: { host: "prod.example.com" } }),
    };
    const registry = loadProfileRegistry(env);
    expect([...registry.keys()].sort()).toEqual(["default", "prod"]);
  });

  it("propagates loadConfig fail-fast (missing IRIS_USERNAME)", () => {
    const env = { IRIS_PASSWORD: "p" };
    expect(() => loadProfileRegistry(env)).toThrow("IRIS_USERNAME");
  });

  it("propagates malformed IRIS_PROFILES fail-fast", () => {
    const env = {
      IRIS_USERNAME: "u",
      IRIS_PASSWORD: "p",
      IRIS_PROFILES: "{bad",
    };
    expect(() => loadProfileRegistry(env)).toThrow("IRIS_PROFILES");
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

  it("AC 31.0.4: with IRIS_SERVER_MANAGER unset and a populated .vscode/settings.json fixture on disk, loadProfileRegistry deep-equals buildProfileRegistry's plain output (default-only)", () => {
    const workspaceDir = tmpWorkspaceWithSettings(POPULATED_SETTINGS);
    const env = {
      IRIS_USERNAME: "admin",
      IRIS_PASSWORD: "secret",
      IRIS_SM_WORKSPACE: workspaceDir,
      // IRIS_SERVER_MANAGER intentionally unset.
    };
    const defaultConfig = loadConfig(env);
    const expected = buildProfileRegistry(defaultConfig, env);
    const actual = loadProfileRegistry(env);

    expect(actual).toEqual(expected);
    // The fixture's "someServer" profile must NOT have leaked in.
    expect(actual.has("someServer")).toBe(false);
  });

  it("AC 31.0.4: same proof extended across the existing multi-profile matrix (IRIS_PROFILES set, fixture present, IRIS_SERVER_MANAGER unset)", () => {
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
    const actual = loadProfileRegistry(env);

    expect(actual).toEqual(expected);
    expect([...actual.keys()].sort()).toEqual(["default", "prod", "staging"]);
  });

  it("AC 31.0.4: explicit IRIS_SERVER_MANAGER=off is likewise inert with the fixture present", () => {
    const workspaceDir = tmpWorkspaceWithSettings(POPULATED_SETTINGS);
    const env = {
      IRIS_USERNAME: "admin",
      IRIS_PASSWORD: "secret",
      IRIS_SERVER_MANAGER: "off",
      IRIS_SM_WORKSPACE: workspaceDir,
    };
    const defaultConfig = loadConfig(env);
    const expected = buildProfileRegistry(defaultConfig, env);
    expect(loadProfileRegistry(env)).toEqual(expected);
  });

  it("AC 31.0.5 (positive path): with IRIS_SERVER_MANAGER=auto, a resolvable (legacy-password) Server-Manager profile IS added to the registry", () => {
    const workspaceDir = tmpWorkspaceWithSettings(POPULATED_SETTINGS);
    const env = {
      IRIS_USERNAME: "admin",
      IRIS_PASSWORD: "secret",
      IRIS_SERVER_MANAGER: "auto",
      IRIS_SM_WORKSPACE: workspaceDir,
    };
    const registry = loadProfileRegistry(env);
    expect(registry.has("someServer")).toBe(true);
    const sm = registry.get("someServer") as IrisProfile;
    expect(sm.host).toBe("sm.example.com");
    expect(sm.password).toBe("smpass");
  });

  it("AC 31.0.5: with IRIS_SERVER_MANAGER=auto, a passwordless Server-Manager profile is EXCLUDED from the registry, with a single startup log line", () => {
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
    const registry = loadProfileRegistry(env);

    expect(registry.has("noPassword")).toBe(false);
    expect([...registry.keys()]).toEqual([DEFAULT_PROFILE_NAME]);
    const warnSpy = vi.mocked(logger.warn);
    const summaryCalls = warnSpy.mock.calls.filter((c) =>
      String(c[0]).includes("server profile(s) skipped"),
    );
    expect(summaryCalls).toHaveLength(1);
  });

  it("an env-defined profile name wins over a same-named Server-Manager definition (minimal wire-in never overwrites an existing entry)", () => {
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
    const registry = loadProfileRegistry(env);
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
  it("loadProfileRegistry(auto): resolves a real multi-file discovery precedence (workspace beats user settings) end-to-end, with no IRIS_SM_SETTINGS_PATHS override", () => {
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
    const registry = loadProfileRegistry(env, "linux");

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
  });
});
