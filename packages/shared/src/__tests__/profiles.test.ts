import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
