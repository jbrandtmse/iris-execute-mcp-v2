import { describe, expect, it } from "vitest";
import { buildGovernanceEnv, synthesizeIrisEnv } from "../env.js";
import type { LauncherSettings, ResolvedConnectionProfile } from "../types.js";

function profile(overrides: Partial<ResolvedConnectionProfile> = {}): ResolvedConnectionProfile {
  return {
    name: "myServer",
    host: "iris.example.com",
    port: 52773,
    https: false,
    username: "_SYSTEM",
    password: "SYS",
    namespace: "USER",
    ...overrides,
  };
}

function settings(overrides: Partial<LauncherSettings> = {}): LauncherSettings {
  return {
    servers: [],
    packages: [],
    namespace: "HSCUSTOM",
    combineProfiles: false,
    developmentRepoPath: "",
    hadStaleAllPackage: false,
    governance: "",
    governancePreset: "",
    auditLog: "",
    auditLogMaxMb: "",
    auditLogParams: "",
    toolsPreset: "",
    toolsDisable: "",
    toolsEnable: "",
    ...overrides,
  };
}

// Integration AC 31.4.5: assert against the REAL documented variable names
// (packages/shared/src/config.ts's loadConfig table) and the REAL
// IRIS_PROFILES JSON shape (packages/shared/src/profiles.ts's ProfileOverride).
describe("synthesizeIrisEnv — single profile (documented IRIS_* contract)", () => {
  it("emits exactly the six documented IRIS_* variables, no IRIS_PROFILES", () => {
    const env = synthesizeIrisEnv([profile()], "HSCUSTOM");

    expect(env).toEqual({
      IRIS_HOST: "iris.example.com",
      IRIS_PORT: "52773",
      IRIS_HTTPS: "false",
      IRIS_USERNAME: "_SYSTEM",
      IRIS_PASSWORD: "SYS",
      IRIS_NAMESPACE: "USER",
    });
    expect(env.IRIS_PROFILES).toBeUndefined();
  });

  it("stringifies IRIS_PORT (a number) and IRIS_HTTPS (a boolean) as strings, matching loadConfig's env parsing", () => {
    const env = synthesizeIrisEnv([profile({ port: 443, https: true })], "HSCUSTOM");
    expect(env.IRIS_PORT).toBe("443");
    expect(typeof env.IRIS_PORT).toBe("string");
    expect(env.IRIS_HTTPS).toBe("true");
    expect(typeof env.IRIS_HTTPS).toBe("string");
  });

  it("falls back to the namespace default when the profile's own namespace is empty", () => {
    const env = synthesizeIrisEnv([profile({ namespace: "" })], "HSCUSTOM");
    expect(env.IRIS_NAMESPACE).toBe("HSCUSTOM");
  });

  it("throws a clear error when given zero profiles", () => {
    expect(() => synthesizeIrisEnv([], "HSCUSTOM")).toThrow(/at least one/i);
  });
});

describe("synthesizeIrisEnv — multi profile (documented IRIS_PROFILES contract)", () => {
  it("emits IRIS_PROFILES as JSON keyed by profile name, each shaped like ProfileOverride", () => {
    const env = synthesizeIrisEnv(
      [
        profile({ name: "prod", host: "prod.example.com" }),
        profile({ name: "dev", host: "dev.example.com", port: 443, https: true }),
      ],
      "HSCUSTOM",
    );

    // Single-profile vars still reflect the FIRST profile ("default").
    expect(env.IRIS_HOST).toBe("prod.example.com");

    expect(env.IRIS_PROFILES).toBeDefined();
    const parsed = JSON.parse(env.IRIS_PROFILES as string);
    expect(parsed).toEqual({
      prod: {
        host: "prod.example.com",
        port: 52773,
        username: "_SYSTEM",
        password: "SYS",
        namespace: "USER",
        https: false,
      },
      dev: {
        host: "dev.example.com",
        port: 443,
        username: "_SYSTEM",
        password: "SYS",
        namespace: "USER",
        https: true,
      },
    });
  });

  it("round-trips through JSON.parse producing the exact documented field names (host, port, username, password, namespace, https)", () => {
    const env = synthesizeIrisEnv([profile({ name: "a" }), profile({ name: "b" })], "HSCUSTOM");
    const parsed = JSON.parse(env.IRIS_PROFILES as string) as Record<
      string,
      Record<string, unknown>
    >;
    for (const entry of Object.values(parsed)) {
      expect(Object.keys(entry).sort()).toEqual(
        ["host", "https", "namespace", "password", "port", "username"].sort(),
      );
    }
  });
});

describe("synthesizeIrisEnv — typed JSON contract inside IRIS_PROFILES", () => {
  it("keeps port a JSON number and https a JSON boolean (never stringified) inside IRIS_PROFILES, matching mergeProfile's strict typeof checks in packages/shared/src/profiles.ts (https has NO string-coercion fallback there — 'true' as a string throws)", () => {
    const env = synthesizeIrisEnv(
      [profile({ name: "a" }), profile({ name: "b", port: 443, https: true })],
      "HSCUSTOM",
    );
    const parsed = JSON.parse(env.IRIS_PROFILES as string) as Record<
      string,
      Record<string, unknown>
    >;
    expect(typeof parsed.a?.port).toBe("number");
    expect(typeof parsed.a?.https).toBe("boolean");
    expect(typeof parsed.b?.port).toBe("number");
    expect(typeof parsed.b?.https).toBe("boolean");
  });
});

describe("synthesizeIrisEnv — required-vs-optional var contract (packages/shared/src/config.ts's loadConfig)", () => {
  it("always emits IRIS_USERNAME and IRIS_PASSWORD verbatim, even when empty — loadConfig has NO default for either (throws 'environment variable is required'), so an empty value here is a downstream startup failure this function deliberately does not mask", () => {
    const env = synthesizeIrisEnv([profile({ username: "", password: "" })], "HSCUSTOM");
    expect("IRIS_USERNAME" in env).toBe(true);
    expect(env.IRIS_USERNAME).toBe("");
    expect("IRIS_PASSWORD" in env).toBe(true);
    expect(env.IRIS_PASSWORD).toBe("");
  });

  it("always emits IRIS_HOST/IRIS_PORT/IRIS_NAMESPACE explicitly even though loadConfig defaults them (Rule #10 — send documented defaults explicitly on the wire rather than relying on the spawned process's own fallback)", () => {
    const env = synthesizeIrisEnv([profile()], "HSCUSTOM");
    expect(env.IRIS_HOST).toBeTruthy();
    expect(env.IRIS_PORT).toBeTruthy();
    expect(env.IRIS_NAMESPACE).toBeTruthy();
  });
});

describe("buildGovernanceEnv", () => {
  it("emits nothing when every governance/audit/visibility setting is empty", () => {
    expect(buildGovernanceEnv(settings())).toEqual({});
  });

  it("passes through every configured value UNCHANGED under its documented env var name", () => {
    const env = buildGovernanceEnv(
      settings({
        governance: "off",
        governancePreset: "strict",
        auditLog: "/var/log/iris-mcp-audit.log",
        auditLogMaxMb: "100",
        auditLogParams: "true",
        toolsPreset: "core",
        toolsDisable: "iris_doc_*",
        toolsEnable: "iris_doc_delete",
      }),
    );

    expect(env).toEqual({
      IRIS_GOVERNANCE: "off",
      IRIS_GOVERNANCE_PRESET: "strict",
      IRIS_AUDIT_LOG: "/var/log/iris-mcp-audit.log",
      IRIS_AUDIT_LOG_MAX_MB: "100",
      IRIS_AUDIT_LOG_PARAMS: "true",
      IRIS_TOOLS_PRESET: "core",
      IRIS_TOOLS_DISABLE: "iris_doc_*",
      IRIS_TOOLS_ENABLE: "iris_doc_delete",
    });
  });

  it("omits a variable entirely (never emits an empty string) when its setting is unset", () => {
    const env = buildGovernanceEnv(settings({ governance: "off" }));
    expect(env).toEqual({ IRIS_GOVERNANCE: "off" });
    expect("IRIS_TOOLS_PRESET" in env).toBe(false);
  });
});
