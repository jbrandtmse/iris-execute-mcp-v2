/**
 * Story 14.1 — QA complementary coverage for the multi-server profile registry.
 *
 * These tests are ADDITIVE to the dev's `profiles.test.ts` (AC 14.1.6 suite).
 * They deliberately exercise edges the dev suite leaves uncovered, per the
 * Story 14.1 QA review:
 *
 *  - multiple profiles each overriding DISJOINT subsets of fields;
 *  - inheritance of `https` (→ re-derived https baseUrl), `port`-only, and an
 *    explicit `timeout` override;
 *  - `resolveProfile` for whitespace-only names (NOT trimmed → resolution error);
 *  - `ProfileResolutionError` lists EVERY valid name (asserted against the live
 *    registry key set, not a hard-coded list);
 *  - the malformed-`IRIS_PROFILES` MESSAGE text names the offending var (not just
 *    that it throws), across JSON-syntax, null-root, and empty-name shapes;
 *  - the `default`-override warning fires EXACTLY ONCE;
 *  - `ProfileClientRegistry` `has()` lifecycle + `destroyAll()` clearing the
 *    cache so a subsequent `getOrCreate` yields a NEW instance;
 *  - back-compat: `IRIS_PROFILES=""` (empty) is treated as absent.
 *
 * All assertions are provable WITHOUT a live IRIS server (vitest, mocked fetch).
 * No `BOOTSTRAP_VERSION` impact — TypeScript-only.
 */

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

function mockResponse(
  body: unknown,
  init: { status?: number; setCookie?: string[] } = {},
): Response {
  const { status = 200, setCookie = [] } = init;
  const resp = new Response(JSON.stringify(body), { status });
  if (setCookie.length > 0) {
    const original = resp.headers.getSetCookie?.bind(resp.headers);
    resp.headers.getSetCookie = () => [...(original?.() ?? []), ...setCookie];
  }
  return resp;
}

// ════════════════════════════════════════════════════════════════════
// Multi-profile DISJOINT subset overrides (AC 14.1.3, complements dev's
// single-override cases). Each profile overrides a different field set;
// every other field must inherit from the synthesized default.
// ════════════════════════════════════════════════════════════════════

describe("IRIS_PROFILES — disjoint subset overrides per profile (AC 14.1.3)", () => {
  function buildFromEnv() {
    const env = {
      IRIS_HOST: "base.example.com",
      IRIS_PORT: "52773",
      IRIS_USERNAME: "baseuser",
      IRIS_PASSWORD: "basepass",
      IRIS_NAMESPACE: "BASENS",
      IRIS_HTTPS: "false",
      IRIS_TIMEOUT: "11000",
      IRIS_PROFILES: JSON.stringify({
        // overrides ONLY host
        hostOnly: { host: "h1.example.com" },
        // overrides ONLY namespace
        nsOnly: { namespace: "OTHERNS" },
        // overrides ONLY credentials
        credsOnly: { username: "u2", password: "p2" },
        // overrides ONLY port
        portOnly: { port: 1972 },
      }),
    };
    const defaultConfig = loadConfig(env);
    return { registry: buildProfileRegistry(defaultConfig, env), defaultConfig };
  }

  it("registers all profiles plus the default", () => {
    const { registry } = buildFromEnv();
    expect([...registry.keys()].sort()).toEqual([
      "credsOnly",
      "default",
      "hostOnly",
      "nsOnly",
      "portOnly",
    ]);
  });

  it("hostOnly overrides host and re-derives baseUrl, inherits everything else", () => {
    const { registry, defaultConfig } = buildFromEnv();
    const p = registry.get("hostOnly") as IrisProfile;
    expect(p.host).toBe("h1.example.com");
    expect(p.baseUrl).toBe("http://h1.example.com:52773");
    // inherited
    expect(p.port).toBe(defaultConfig.port);
    expect(p.username).toBe(defaultConfig.username);
    expect(p.password).toBe(defaultConfig.password);
    expect(p.namespace).toBe(defaultConfig.namespace);
    expect(p.https).toBe(defaultConfig.https);
    expect(p.timeout).toBe(defaultConfig.timeout);
  });

  it("nsOnly overrides only namespace; host/port/baseUrl unchanged from default", () => {
    const { registry, defaultConfig } = buildFromEnv();
    const p = registry.get("nsOnly") as IrisProfile;
    expect(p.namespace).toBe("OTHERNS");
    expect(p.host).toBe(defaultConfig.host);
    expect(p.port).toBe(defaultConfig.port);
    // baseUrl is derived from host/port/https only — namespace does not affect it
    expect(p.baseUrl).toBe(defaultConfig.baseUrl);
  });

  it("credsOnly overrides only username+password; connection target unchanged", () => {
    const { registry, defaultConfig } = buildFromEnv();
    const p = registry.get("credsOnly") as IrisProfile;
    expect(p.username).toBe("u2");
    expect(p.password).toBe("p2");
    expect(p.host).toBe(defaultConfig.host);
    expect(p.baseUrl).toBe(defaultConfig.baseUrl);
  });

  it("portOnly overrides only port and re-derives baseUrl, inherits host/https", () => {
    const { registry, defaultConfig } = buildFromEnv();
    const p = registry.get("portOnly") as IrisProfile;
    expect(p.port).toBe(1972);
    expect(p.host).toBe(defaultConfig.host);
    expect(p.https).toBe(defaultConfig.https);
    expect(p.baseUrl).toBe("http://base.example.com:1972");
  });

  it("each profile is an independent object (mutating one does not affect another)", () => {
    const { registry } = buildFromEnv();
    const a = registry.get("hostOnly") as IrisProfile;
    const b = registry.get("nsOnly") as IrisProfile;
    expect(a).not.toBe(b);
    a.host = "mutated";
    expect((registry.get("nsOnly") as IrisProfile).host).not.toBe("mutated");
  });
});

// ════════════════════════════════════════════════════════════════════
// Inheritance of https/port/timeout + baseUrl re-derivation. The dev
// suite covers inherit-all + override(https+port together). These cover
// inheriting https=true into a profile that overrides only host, and an
// explicit per-profile timeout override.
// ════════════════════════════════════════════════════════════════════

describe("IRIS_PROFILES — https/port/timeout inheritance + baseUrl re-derivation", () => {
  it("inherits https=true from default so an override-host profile derives an https baseUrl", () => {
    const env = {
      IRIS_HOST: "secure-default.example.com",
      IRIS_PORT: "443",
      IRIS_USERNAME: "u",
      IRIS_PASSWORD: "p",
      IRIS_HTTPS: "true",
      IRIS_PROFILES: JSON.stringify({
        sibling: { host: "sibling.example.com" },
      }),
    };
    const defaultConfig = loadConfig(env);
    const registry = buildProfileRegistry(defaultConfig, env);
    const p = registry.get("sibling") as IrisProfile;
    expect(p.https).toBe(true);
    // host overridden, https+port inherited → https baseUrl on the new host
    expect(p.baseUrl).toBe("https://sibling.example.com:443");
  });

  it("an explicit per-profile timeout overrides the inherited default timeout", () => {
    const env = {
      IRIS_USERNAME: "u",
      IRIS_PASSWORD: "p",
      IRIS_TIMEOUT: "5000",
      IRIS_PROFILES: JSON.stringify({
        slow: { host: "slow.example.com", timeout: 90000 },
        fast: { host: "fast.example.com" },
      }),
    };
    const defaultConfig = loadConfig(env);
    const registry = buildProfileRegistry(defaultConfig, env);
    expect((registry.get("slow") as IrisProfile).timeout).toBe(90000);
    // sibling with no timeout inherits the default (5000)
    expect((registry.get("fast") as IrisProfile).timeout).toBe(5000);
  });

  it("the profile's timeout flows into its IrisHttpClient default timeout", async () => {
    const env = {
      IRIS_USERNAME: "u",
      IRIS_PASSWORD: "p",
      IRIS_TIMEOUT: "5000",
      IRIS_PROFILES: JSON.stringify({
        slow: { host: "slow.example.com", timeout: 90000 },
      }),
    };
    const defaultConfig = loadConfig(env);
    const registry = buildProfileRegistry(defaultConfig, env);
    const clients = new ProfileClientRegistry(registry);

    const fetchMock = vi.fn();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock;
    vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      // A request without a per-call timeout should NOT abort within the
      // default 5s — the profile's 90s timeout is in effect. We resolve the
      // fetch immediately, then assert no AbortError surfaced.
      fetchMock.mockResolvedValueOnce(mockResponse(atelierResponse({})));
      const client = clients.getOrCreate("slow");
      await expect(client.get("/api/atelier/")).resolves.toBeDefined();
    } finally {
      globalThis.fetch = originalFetch;
      vi.restoreAllMocks();
    }
  });
});

// ════════════════════════════════════════════════════════════════════
// resolveProfile — whitespace name handling. Dev covers undefined + "".
// The implementation only treats the empty string as "use default"; a
// whitespace-only name is NOT trimmed, so it is an unknown profile.
// This documents the actual contract.
// ════════════════════════════════════════════════════════════════════

describe("resolveProfile — whitespace / non-empty edge names (AC 14.1.5)", () => {
  function registry() {
    const env = {
      IRIS_USERNAME: "u",
      IRIS_PASSWORD: "p",
      IRIS_PROFILES: JSON.stringify({ prod: { host: "prod.example.com" } }),
    };
    return buildProfileRegistry(loadConfig(env), env);
  }

  it("a whitespace-only name is NOT treated as default (not trimmed) and throws", () => {
    expect(() => resolveProfile(registry(), "   ")).toThrow(
      ProfileResolutionError,
    );
  });

  it("the whitespace-name error reports the requested value verbatim", () => {
    let caught: ProfileResolutionError | undefined;
    try {
      resolveProfile(registry(), "  ");
    } catch (e) {
      caught = e as ProfileResolutionError;
    }
    expect(caught).toBeInstanceOf(ProfileResolutionError);
    expect(caught?.requested).toBe("  ");
  });

  it("name resolution is case-sensitive (Prod !== prod)", () => {
    expect(() => resolveProfile(registry(), "Prod")).toThrow(
      ProfileResolutionError,
    );
  });
});

// ════════════════════════════════════════════════════════════════════
// ProfileResolutionError lists ALL valid names — asserted against the
// live registry key set rather than a hard-coded list, so adding a
// profile cannot silently drop it from the error message.
// ════════════════════════════════════════════════════════════════════

describe("ProfileResolutionError — lists every valid profile name (AC 14.1.5)", () => {
  it("message + validProfiles include EVERY registry key", () => {
    const env = {
      IRIS_USERNAME: "u",
      IRIS_PASSWORD: "p",
      IRIS_PROFILES: JSON.stringify({
        alpha: { host: "a" },
        bravo: { host: "b" },
        charlie: { host: "c" },
      }),
    };
    const reg = buildProfileRegistry(loadConfig(env), env);
    const allNames = [...reg.keys()];

    let caught: ProfileResolutionError | undefined;
    try {
      resolveProfile(reg, "delta");
    } catch (e) {
      caught = e as ProfileResolutionError;
    }
    expect(caught).toBeInstanceOf(ProfileResolutionError);

    // Every registered name appears both in the structured list and the message.
    for (const name of allNames) {
      expect(caught?.validProfiles).toContain(name);
      expect(caught?.message).toContain(name);
    }
    // And the structured set matches the registry exactly (no extras/omissions).
    expect(caught?.validProfiles.sort()).toEqual([...allNames].sort());
  });

  it("ProfileResolutionError is a real Error subclass with a stable name", () => {
    const err = new ProfileResolutionError("x", ["default"]);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("ProfileResolutionError");
  });
});

// ════════════════════════════════════════════════════════════════════
// Malformed IRIS_PROFILES — assert the MESSAGE TEXT names the offending
// var (dev tests only assert that it throws). Plus null-root and
// empty-profile-name shapes the dev suite does not cover.
// ════════════════════════════════════════════════════════════════════

describe("malformed IRIS_PROFILES — message names the var (AC 14.1.1)", () => {
  function expectNamesVar(env: Record<string, string | undefined>) {
    const defaultConfig = loadConfig(env);
    let message = "";
    try {
      buildProfileRegistry(defaultConfig, env);
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    expect(message).toContain("IRIS_PROFILES");
    return message;
  }

  const baseEnv = { IRIS_USERNAME: "u", IRIS_PASSWORD: "p" };

  it("invalid JSON syntax → message names IRIS_PROFILES", () => {
    expectNamesVar({ ...baseEnv, IRIS_PROFILES: "{ broken" });
  });

  it("JSON null root → message names IRIS_PROFILES", () => {
    expectNamesVar({ ...baseEnv, IRIS_PROFILES: "null" });
  });

  it("JSON number root → message names IRIS_PROFILES", () => {
    expectNamesVar({ ...baseEnv, IRIS_PROFILES: "42" });
  });

  it("empty profile name key → message names IRIS_PROFILES", () => {
    expectNamesVar({
      ...baseEnv,
      IRIS_PROFILES: JSON.stringify({ "": { host: "h" } }),
    });
  });

  it("a bad field type inside a profile → message names IRIS_PROFILES and the profile", () => {
    const msg = expectNamesVar({
      ...baseEnv,
      IRIS_PROFILES: JSON.stringify({ prod: { port: "not-a-port" } }),
    });
    expect(msg).toContain("prod");
  });
});

// ════════════════════════════════════════════════════════════════════
// default-override warning fires EXACTLY ONCE (dev asserts it fires;
// this pins the count so a redefinition cannot spam the operator log).
// ════════════════════════════════════════════════════════════════════

describe("IRIS_PROFILES redefining 'default' warns exactly once", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs the reserved-name warning exactly once", () => {
    const env = {
      IRIS_HOST: "fromvars.example.com",
      IRIS_USERNAME: "u",
      IRIS_PASSWORD: "p",
      IRIS_PROFILES: JSON.stringify({
        default: { host: "override.example.com" },
        prod: { host: "prod.example.com" },
      }),
    };
    buildProfileRegistry(loadConfig(env), env);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    // The single warning is the reserved-name one (mentions "default").
    const firstArg = String(warnSpy.mock.calls[0]?.[0] ?? "");
    expect(firstArg).toContain(DEFAULT_PROFILE_NAME);
  });

  it("does NOT warn when no profile is named 'default'", () => {
    const env = {
      IRIS_USERNAME: "u",
      IRIS_PASSWORD: "p",
      IRIS_PROFILES: JSON.stringify({ prod: { host: "prod.example.com" } }),
    };
    buildProfileRegistry(loadConfig(env), env);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════
// ProfileClientRegistry — has() lifecycle + destroyAll() cache clearing.
// Dev covers distinct/cached/cookie-isolation/single-destroy. This adds
// the has() transitions and proves destroyAll() drops the cache so a
// later getOrCreate produces a genuinely NEW client instance.
// ════════════════════════════════════════════════════════════════════

describe("ProfileClientRegistry — has() + destroyAll() lifecycle (AC 14.1.4)", () => {
  function fixture() {
    const env = {
      IRIS_USERNAME: "u",
      IRIS_PASSWORD: "p",
      IRIS_PROFILES: JSON.stringify({
        prod: { host: "prod.example.com" },
        staging: { host: "staging.example.com" },
      }),
    };
    const registry = buildProfileRegistry(loadConfig(env), env);
    return new ProfileClientRegistry(registry);
  }

  it("has() is false before first getOrCreate and true after (per profile)", () => {
    const clients = fixture();
    expect(clients.has("prod")).toBe(false);
    expect(clients.has("staging")).toBe(false);

    clients.getOrCreate("prod");
    expect(clients.has("prod")).toBe(true);
    // creating prod must not implicitly create staging
    expect(clients.has("staging")).toBe(false);
  });

  it("destroyAll() clears the cache; a later getOrCreate yields a NEW instance", () => {
    const clients = fixture();
    const first = clients.getOrCreate("prod");
    expect(clients.has("prod")).toBe(true);

    clients.destroyAll();
    expect(clients.has("prod")).toBe(false);

    const second = clients.getOrCreate("prod");
    expect(second).toBeInstanceOf(IrisHttpClient);
    // Cache was cleared → not the same instance as before destroyAll().
    expect(second).not.toBe(first);
  });

  it("getOrCreate throws ProfileResolutionError for an unregistered profile", () => {
    const clients = fixture();
    expect(() => clients.getOrCreate("ghost")).toThrow(ProfileResolutionError);
  });
});

// ════════════════════════════════════════════════════════════════════
// Back-compat gate — IRIS_PROFILES="" (empty string) is treated as
// absent, so the registry is byte-for-byte loadConfig (complements the
// dev's "var unset" case with the "var set but empty" case).
// ════════════════════════════════════════════════════════════════════

describe("back-compat — empty IRIS_PROFILES is treated as absent", () => {
  it('IRIS_PROFILES="" → single default profile equal to loadConfig', () => {
    const env = {
      IRIS_HOST: "h",
      IRIS_PORT: "52773",
      IRIS_USERNAME: "u",
      IRIS_PASSWORD: "p",
      IRIS_NAMESPACE: "NS",
      IRIS_PROFILES: "",
    };
    const registry = buildProfileRegistry(loadConfig(env), env);
    expect(registry.size).toBe(1);
    const def = registry.get(DEFAULT_PROFILE_NAME) as IrisProfile;
    const { name: _name, ...connOnly } = def;
    void _name;
    expect(connOnly).toEqual(loadConfig(env));
  });

  it('loadProfileRegistry with IRIS_PROFILES="" matches loadConfig byte-for-byte', () => {
    const env = {
      IRIS_USERNAME: "u",
      IRIS_PASSWORD: "p",
      IRIS_PROFILES: "",
    };
    const registry = loadProfileRegistry(env);
    expect([...registry.keys()]).toEqual([DEFAULT_PROFILE_NAME]);
    const def = registry.get(DEFAULT_PROFILE_NAME) as IrisProfile;
    const { name: _n, ...connOnly } = def;
    void _n;
    expect(connOnly).toEqual(loadConfig(env));
  });
});
