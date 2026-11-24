import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LauncherProvider, type ProviderDeps } from "../serverDefinitionProvider.js";
import { userScopeServers } from "./serverManagerInspection.js";
import type {
  AuthApi,
  GetSessionOptions,
  LauncherSettings,
  ServerManagerApi,
  ServerManagerServersInspection,
  ServerSpec,
} from "../types.js";

// `node:fs/promises`'s built-in module namespace object cannot be spied on
// directly (`vi.spyOn(fsp, "stat")` throws "Cannot redefine property" — its
// properties are non-configurable). `vi.mock` with an `importOriginal`
// passthrough replaces the module's exports with a real, spyable `vi.fn()`
// wrapper instead, scoped to THIS test file only. `stat` is the only export
// wrapped (it backs `isExistingDirectory`/`isExistingFile` in
// `serverDefinitionProvider.ts` — converted from `existsSync`/`statSync` to
// `fs/promises.stat` in Story 32.3 (31-6-2), so validation no longer blocks
// the extension host); everything else passes through to the real
// implementation. The wrapper defaults to calling the real function, so
// every test that doesn't explicitly override it (the vast majority) is
// unaffected.
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, stat: vi.fn(actual.stat) };
});
import * as fsp from "node:fs/promises";

/**
 * Restore the `node:fs/promises.stat` wrapper to real behavior after every
 * test. `mockReset()` alone is WORSE in vitest 2.1.9: it drains the
 * once-impl queue but also clears the base implementation, so `stat` starts
 * returning `undefined` and every subsequent test silently sees "path does
 * not exist" (verified during the Story 31.6 review — it turned six passing
 * tests red). So: reset to drain, then explicitly reinstate the real
 * implementation.
 */
afterEach(async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  const statMock = vi.mocked(fsp.stat);
  statMock.mockReset();
  statMock.mockImplementation(actual.stat);
});

function settings(overrides: Partial<LauncherSettings> = {}): LauncherSettings {
  return {
    servers: [],
    packages: ["dev"],
    namespace: "HSCUSTOM",
    combineProfiles: false,
    developmentRepoPath: "",
    hadStaleAllPackage: false,
    governance: "",
    governancePreset: "",
    governanceFile: "",
    auditLog: "",
    auditLogMaxMb: "",
    auditLogParams: "",
    toolsPreset: "",
    toolsDisable: "",
    toolsEnable: "",
    ...overrides,
  };
}

function specFor(name: string, password?: string): ServerSpec {
  return {
    name,
    webServer: { host: `${name}.example.com`, port: 52773, scheme: "http" },
    username: "_SYSTEM",
    ...(password !== undefined ? { password } : {}),
  };
}

/**
 * The env a provided definition carries for a single-server plan over the `makeDeps` fixtures (`specFor(name)`:
 * `<name>.example.com:52773`, http, user `_SYSTEM`; namespace `HSCUSTOM`): the non-secret connection, the credential
 * name, `""` for every launcher-owned variable the server reads `""` as unset, and `null` for `IRIS_AUDIT_LOG_MAX_MB`.
 * `overrides` layers a local-build or governance difference on top.
 */
function providedEnv(
  name: string,
  overrides: Record<string, string | null> = {},
): Record<string, string | null> {
  return {
    IRIS_HOST: `${name}.example.com`,
    IRIS_PORT: "52773",
    IRIS_HTTPS: "false",
    IRIS_USERNAME: "_SYSTEM",
    IRIS_NAMESPACE: "HSCUSTOM",
    IRIS_CREDENTIAL_NAME: name,
    IRIS_PASSWORD: "",
    IRIS_PROFILES: "",
    IRIS_GOVERNANCE: "",
    IRIS_GOVERNANCE_PRESET: "",
    IRIS_GOVERNANCE_FILE: "",
    IRIS_AUDIT_LOG: "",
    IRIS_AUDIT_LOG_MAX_MB: null,
    IRIS_AUDIT_LOG_PARAMS: "",
    IRIS_TOOLS_PRESET: "",
    IRIS_TOOLS_DISABLE: "",
    IRIS_TOOLS_ENABLE: "",
    IRIS_SERVER_MANAGER: "",
    IRIS_SM_SERVERS: "",
    IRIS_SM_SETTINGS_PATHS: "",
    IRIS_SM_WORKSPACE: "",
    IRIS_CREDENTIAL_HELPER: "",
    MCP_TRANSPORT: "",
    ...overrides,
  };
}

function makeDeps(opts: {
  serverNames?: string[];
  specs?: Record<string, ServerSpec | undefined>;
  getSettings?: () => LauncherSettings;
  smAvailable?: boolean;
  authResponses?: (opts: GetSessionOptions) => boolean; // true = grant a session
}): { deps: ProviderDeps; warnings: string[] } {
  const warnings: string[] = [];
  const serverNames = opts.serverNames ?? ["serverA"];
  const specs = opts.specs ?? Object.fromEntries(serverNames.map((n) => [n, specFor(n, "SYS")]));
  const smAvailable = opts.smAvailable ?? true;

  const api: ServerManagerApi = {
    getServerNames: () => serverNames.map((name) => ({ name, description: "", detail: "" })),
    getServerSpec: async (name: string) => specs[name],
    getAccount: () => ({ id: "acct-1", label: "Account One" }),
  };

  const authApi: AuthApi = {
    getSession: async (_providerId, _scopes, options) => {
      const grant = opts.authResponses ? opts.authResponses(options) : true;
      if (!grant) return undefined;
      return {
        id: "s1",
        accessToken: "resolved-token",
        account: { id: "acct-1", label: "Account One" },
        scopes: ["x", "sessionUser"],
      };
    },
  };

  const deps: ProviderDeps = {
    getServerManagerApi: async () => (smAvailable ? api : undefined),
    authApi,
    getSettings: opts.getSettings ?? (() => settings()),
    showWarning: (message: string) => warnings.push(message),
    inspectServerManagerServers: () => userScopeServers(serverNames),
  };

  return { deps, warnings };
}

describe("LauncherProvider.providePlannedDefinitions", () => {
  it("builds one npx -y @iris-mcp/<pkg>@1 definition per (package, server)", async () => {
    const { deps } = makeDeps({
      serverNames: ["a", "b"],
      getSettings: () => settings({ packages: ["dev", "admin"] }),
    });
    const provider = new LauncherProvider(deps);

    const planned = await provider.providePlannedDefinitions();

    expect(planned).toHaveLength(4);
    for (const def of planned) {
      expect(def.command).toBe("npx");
      expect(def.args[0]).toBe("-y");
    }
    expect(planned.map((d) => d.args[1]).sort()).toEqual([
      "@iris-mcp/admin@1",
      "@iris-mcp/admin@1",
      "@iris-mcp/dev@1",
      "@iris-mcp/dev@1",
    ]);
  });

  it("only plans definitions for explicitly SELECTED servers — servers present in Server Manager but not in settings.servers never appear", async () => {
    const { deps } = makeDeps({
      serverNames: ["a", "b", "c"],
      getSettings: () => settings({ packages: ["dev"], servers: ["a"] }),
    });
    const provider = new LauncherProvider(deps);

    const planned = await provider.providePlannedDefinitions();

    expect(planned).toHaveLength(1);
    expect(planned[0]?.label).toMatch(/— a$/);
    expect(planned.some((d) => d.label.includes("— b"))).toBe(false);
    expect(planned.some((d) => d.label.includes("— c"))).toBe(false);
  });

  it("packages explicitly set to [] registers zero definitions with NO warning (a valid 'everything disabled' config, not an error condition)", async () => {
    const { deps, warnings } = makeDeps({
      serverNames: ["a"],
      getSettings: () => settings({ packages: [] }),
    });
    const provider = new LauncherProvider(deps);

    const planned = await provider.providePlannedDefinitions();

    expect(planned).toEqual([]);
    expect(warnings).toHaveLength(0);
  });

  it("returns [] and warns exactly once when the Server Manager extension is unavailable", async () => {
    const { deps, warnings } = makeDeps({ smAvailable: false });
    const provider = new LauncherProvider(deps);

    const planned = await provider.providePlannedDefinitions();

    expect(planned).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/Server Manager/i);
  });

  it("31-6-1 (code review): the unavailable-API warning does NOT re-fire across repeated provides — the 31-5-2 status-bar refresh replans on every config change", async () => {
    const { deps, warnings } = makeDeps({ smAvailable: false });
    const provider = new LauncherProvider(deps);

    await provider.providePlannedDefinitions();
    await provider.providePlannedDefinitions();
    await provider.providePlannedDefinitions();

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/Server Manager/i);
  });

  it("31-6-1 (code review): the could-not-read-settings warning does NOT re-fire across repeated provides either", async () => {
    const { deps, warnings } = makeDeps({
      serverNames: ["a"],
      getSettings: () => {
        throw new Error("hand-edited settings.json broke the read");
      },
    });
    const provider = new LauncherProvider(deps);

    await provider.providePlannedDefinitions();
    await provider.providePlannedDefinitions();

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/could not read/i);
  });
});

describe("LauncherProvider.resolveEnvForLabel", () => {
  it("resolves a single-server definition to the documented single-profile env", async () => {
    const { deps } = makeDeps({ serverNames: ["a"] });
    const provider = new LauncherProvider(deps);
    const [planned] = await provider.providePlannedDefinitions();

    const env = await provider.resolveEnvForLabel(planned!.label);

    expect(env).toMatchObject({
      IRIS_HOST: "a.example.com",
      IRIS_USERNAME: "_SYSTEM",
      IRIS_PASSWORD: "SYS",
    });
    // Explicitly NULL, not merely absent: `McpStdioServerDefinition.env` is
    // additive over the extension host's environment, and `null` is the
    // documented "remove this variable" signal. Absent would silently inherit
    // an ambient IRIS_PROFILES from the developer's shell.
    expect(env?.IRIS_PROFILES).toBeNull();
  });

  it("resolves a combineProfiles definition to IRIS_PROFILES covering every selected server", async () => {
    const { deps } = makeDeps({
      serverNames: ["a", "b"],
      getSettings: () => settings({ packages: ["dev"], combineProfiles: true }),
    });
    const provider = new LauncherProvider(deps);
    const [planned] = await provider.providePlannedDefinitions();

    const env = await provider.resolveEnvForLabel(planned!.label);

    expect(env?.IRIS_PROFILES).toBeDefined();
    const parsed = JSON.parse(env!.IRIS_PROFILES as string);
    expect(Object.keys(parsed).sort()).toEqual(["a", "b"]);
  });

  it("passes governance/audit/visibility settings through into the resolved env", async () => {
    const { deps } = makeDeps({
      serverNames: ["a"],
      getSettings: () => settings({ governance: "off", toolsPreset: "core" }),
    });
    const provider = new LauncherProvider(deps);
    const [planned] = await provider.providePlannedDefinitions();

    const env = await provider.resolveEnvForLabel(planned!.label);
    expect(env).toMatchObject({ IRIS_GOVERNANCE: "off", IRIS_TOOLS_PRESET: "core" });
  });

  it("returns undefined and warns exactly once for an unknown label (never seen from providePlannedDefinitions)", async () => {
    const { deps, warnings } = makeDeps({});
    const provider = new LauncherProvider(deps);

    const env = await provider.resolveEnvForLabel("Not A Real Label");

    expect(env).toBeUndefined();
    expect(warnings).toHaveLength(1);
  });

  it("cancellation is a first-class outcome: returns undefined with exactly ONE warning, no throw", async () => {
    const { deps, warnings } = makeDeps({
      serverNames: ["a"],
      specs: { a: specFor("a") }, // no password -> forces the auth flow
      authResponses: () => false, // user cancels every prompt
    });
    const provider = new LauncherProvider(deps);
    const [planned] = await provider.providePlannedDefinitions();

    const env = await provider.resolveEnvForLabel(planned!.label);

    expect(env).toBeUndefined();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/not started/i);
    expect(warnings[0]).toMatch(/credentials/i);
  });

  it("a removed Server Manager definition (no-spec) is a clear, non-throwing outcome", async () => {
    const { deps, warnings } = makeDeps({ serverNames: ["a"], specs: { a: undefined } });
    const provider = new LauncherProvider(deps);
    const [planned] = await provider.providePlannedDefinitions();

    const env = await provider.resolveEnvForLabel(planned!.label);

    expect(env).toBeUndefined();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/no server named/i);
  });

  it("warns once (does not fail the resolve) when a server declares an unsupported path prefix", async () => {
    const spec: ServerSpec = {
      name: "a",
      webServer: { host: "a.example.com", port: 443, scheme: "https", pathPrefix: "/csp/health" },
      username: "_SYSTEM",
      password: "SYS",
    };
    const { deps, warnings } = makeDeps({ serverNames: ["a"], specs: { a: spec } });
    const provider = new LauncherProvider(deps);
    const [planned] = await provider.providePlannedDefinitions();

    const env = await provider.resolveEnvForLabel(planned!.label);

    expect(env).toBeDefined();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/path prefix/i);
  });
});

/**
 * REGRESSION — the real `vscode.authentication.getSession({createIfNone:true})`
 * REJECTS when the user declines; it does not resolve `undefined` (oracle: the
 * installed `@types/vscode` `getSession` overloads + doc comment — see
 * `credentials.test.ts`'s "real API cancel semantics" block for the capture
 * command). Before this block, EVERY cancellation test in this suite faked
 * cancel as `resolve(undefined)`, so the AC 31.4.2 "one clear message, no
 * toast storm" guarantee was never exercised on the path users actually hit.
 */
describe("LauncherProvider.resolveEnvForLabel — real cancel semantics (getSession rejects)", () => {
  function makeRejectingDeps(): {
    deps: ProviderDeps;
    warnings: string[];
    sessionCalls: () => number;
  } {
    const warnings: string[] = [];
    let sessionCalls = 0;
    const api: ServerManagerApi = {
      getServerNames: () => [{ name: "a", description: "", detail: "" }],
      getServerSpec: async () => specFor("a"), // no password -> forces the auth flow
      getAccount: () => ({ id: "acct-1", label: "Account One" }),
    };
    const authApi: AuthApi = {
      getSession: async (_providerId, _scopes, options: GetSessionOptions) => {
        sessionCalls++;
        if (options.silent === true) return undefined;
        throw new Error("User did not consent to authentication.");
      },
    };
    return {
      deps: {
        getServerManagerApi: async () => api,
        authApi,
        getSettings: () => settings({ packages: ["dev"], servers: ["a"] }),
        showWarning: (message: string) => warnings.push(message),
        inspectServerManagerServers: () => userScopeServers(["a"]),
      },
      warnings,
      sessionCalls: () => sessionCalls,
    };
  }

  it("a rejected credential prompt resolves to undefined with exactly ONE warning — it does not propagate the rejection to the editor", async () => {
    const { deps, warnings } = makeRejectingDeps();
    const provider = new LauncherProvider(deps);
    const [planned] = await provider.providePlannedDefinitions();

    await expect(provider.resolveEnvForLabel(planned!.label)).resolves.toBeUndefined();

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/not started/i);
    expect(warnings[0]).toMatch(/credentials/i);
  });

  it("repeated resolves after a rejected prompt do not storm: exactly one new warning and two auth attempts per call, no retry loop", async () => {
    const { deps, warnings, sessionCalls } = makeRejectingDeps();
    const provider = new LauncherProvider(deps);
    const [planned] = await provider.providePlannedDefinitions();

    for (let call = 1; call <= 3; call++) {
      await expect(provider.resolveEnvForLabel(planned!.label)).resolves.toBeUndefined();
      expect(warnings).toHaveLength(call);
      expect(sessionCalls()).toBe(call * 2);
    }
  });

  it("a Server Manager API that throws is the 'unavailable' outcome: undefined, one warning, no rejection", async () => {
    const warnings: string[] = [];
    const api: ServerManagerApi = {
      getServerNames: () => [{ name: "a", description: "", detail: "" }],
      getServerSpec: async () => {
        throw new Error("Cannot read properties of undefined");
      },
      getAccount: () => undefined,
    };
    const deps: ProviderDeps = {
      getServerManagerApi: async () => api,
      authApi: { getSession: async () => undefined },
      getSettings: () => settings({ packages: ["dev"], servers: ["a"] }),
      showWarning: (message: string) => warnings.push(message),
      inspectServerManagerServers: () => userScopeServers(["a"]),
    };
    const provider = new LauncherProvider(deps);
    const [planned] = await provider.providePlannedDefinitions();

    await expect(provider.resolveEnvForLabel(planned!.label)).resolves.toBeUndefined();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/could not provide a connection/i);
  });
});

describe("LauncherProvider.providePlannedDefinitions — untrusted input must not reject the provider", () => {
  it("a throwing getServerNames degrades to zero definitions + one warning instead of a rejected promise", async () => {
    const warnings: string[] = [];
    const api: ServerManagerApi = {
      getServerNames: () => {
        throw new TypeError("api.getServerNames is not a function");
      },
      getServerSpec: async () => undefined,
      getAccount: () => undefined,
    };
    const provider = new LauncherProvider({
      getServerManagerApi: async () => api,
      authApi: { getSession: async () => undefined },
      getSettings: () => settings(),
      showWarning: (message: string) => warnings.push(message),
    });

    await expect(provider.providePlannedDefinitions()).resolves.toEqual([]);
    expect(warnings).toHaveLength(1);
  });

  it("a settings reader that throws (mistyped settings.json) degrades to zero definitions + one warning", async () => {
    const warnings: string[] = [];
    const { deps } = makeDeps({ serverNames: ["a"] });
    const provider = new LauncherProvider({
      ...deps,
      getSettings: () => {
        throw new TypeError("settings.servers.filter is not a function");
      },
      showWarning: (message: string) => warnings.push(message),
    });

    await expect(provider.providePlannedDefinitions()).resolves.toEqual([]);
    expect(warnings).toHaveLength(1);
  });

  it("configured servers that match nothing Server Manager reports produce a warning naming them (not silence)", async () => {
    const { deps, warnings } = makeDeps({
      serverNames: ["a"],
      getSettings: () => settings({ packages: ["dev"], servers: ["typo-server"] }),
    });
    const provider = new LauncherProvider(deps);

    await expect(provider.providePlannedDefinitions()).resolves.toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("typo-server");
  });

  it("still stays silent for the documented 'everything disabled' config (packages: [])", async () => {
    const { deps, warnings } = makeDeps({
      serverNames: ["a"],
      getSettings: () => settings({ packages: [], servers: ["a"] }),
    });
    const provider = new LauncherProvider(deps);

    await expect(provider.providePlannedDefinitions()).resolves.toEqual([]);
    expect(warnings).toHaveLength(0);
  });

  it("threads the enumerated configuration scope from getServerNames through to getServerSpec (multi-root workspaces)", async () => {
    const scopeToken = { uri: "file:///workspace/folder-b" };
    const seen: unknown[] = [];
    const api: ServerManagerApi = {
      getServerNames: () => [{ name: "a", description: "", detail: "", scope: scopeToken }],
      getServerSpec: async (_name, scope) => {
        seen.push(scope);
        return specFor("a", "SYS");
      },
      getAccount: () => undefined,
    };
    const inspectedIn: unknown[] = [];
    const provider = new LauncherProvider({
      getServerManagerApi: async () => api,
      authApi: { getSession: async () => undefined },
      getSettings: () => settings({ packages: ["dev"], servers: ["a"] }),
      showWarning: () => undefined,
      inspectServerManagerServers: (scope) => {
        inspectedIn.push(scope);
        return userScopeServers(["a"]);
      },
    });

    const [planned] = await provider.providePlannedDefinitions();
    // The provide path looks the spec up once, in the scope it enumerated the name in, and inspects that same scope.
    expect(seen).toEqual([scopeToken]);
    expect(inspectedIn).toEqual([scopeToken]);
    await provider.resolveEnvForLabel(planned!.label);

    expect(seen).toEqual([scopeToken, scopeToken]);
  });
});

describe("LauncherProvider — spawn env must not inherit ambient IRIS_* from the extension host", () => {
  it("emits an explicit null for every launcher-owned variable it is not setting (McpStdioServerDefinition.env is additive; null is the documented 'remove' signal)", async () => {
    const { deps } = makeDeps({ serverNames: ["a"] });
    const provider = new LauncherProvider(deps);
    const [planned] = await provider.providePlannedDefinitions();

    const env = await provider.resolveEnvForLabel(planned!.label);

    // Governance/audit/visibility are all unset in these settings.
    expect(env?.IRIS_GOVERNANCE).toBeNull();
    expect(env?.IRIS_TOOLS_PRESET).toBeNull();
    expect(env?.IRIS_AUDIT_LOG).toBeNull();
    // The suite's OWN Server-Manager import path must not compete with the
    // profiles this launcher just synthesized.
    expect(env?.IRIS_SERVER_MANAGER).toBeNull();
    expect(env?.IRIS_CREDENTIAL_HELPER).toBeNull();
    // ...but a variable the launcher DID set keeps its value.
    expect(env?.IRIS_HOST).toBe("a.example.com");
  });

  it("leaves variables the extension exposes no setting for alone (IRIS_TIMEOUT stays an intentional escape hatch)", async () => {
    const { deps } = makeDeps({ serverNames: ["a"] });
    const provider = new LauncherProvider(deps);
    const [planned] = await provider.providePlannedDefinitions();

    const env = await provider.resolveEnvForLabel(planned!.label);

    expect("IRIS_TIMEOUT" in (env ?? {})).toBe(false);
  });
});

describe("LauncherProvider — combineProfiles with a single selected server", () => {
  it("still emits IRIS_PROFILES so the definition's documented `server` tool parameter works (pins the count-dependent behaviour flip)", async () => {
    const { deps } = makeDeps({
      serverNames: ["only"],
      getSettings: () => settings({ packages: ["dev"], combineProfiles: true, servers: ["only"] }),
    });
    const provider = new LauncherProvider(deps);
    const [planned] = await provider.providePlannedDefinitions();

    const env = await provider.resolveEnvForLabel(planned!.label);

    expect(env?.IRIS_PROFILES).toBeTruthy();
    expect(Object.keys(JSON.parse(env!.IRIS_PROFILES as string))).toEqual(["only"]);
  });
});

describe("LauncherProvider — path-prefix warning is genuinely one-time and correctly attributed", () => {
  const prefixSpec = (name: string, pathPrefix: string): ServerSpec => ({
    name,
    webServer: { host: `${name}.example.com`, port: 443, scheme: "https", pathPrefix },
    username: "_SYSTEM",
    password: "SYS",
  });

  it("warns once across REPEATED resolves of the same definition, not once per start", async () => {
    const { deps, warnings } = makeDeps({
      serverNames: ["a"],
      specs: { a: prefixSpec("a", "/csp/health") },
    });
    const provider = new LauncherProvider(deps);
    const [planned] = await provider.providePlannedDefinitions();

    await provider.resolveEnvForLabel(planned!.label);
    await provider.resolveEnvForLabel(planned!.label);
    await provider.resolveEnvForLabel(planned!.label);

    expect(warnings).toHaveLength(1);
  });

  it("names the server that actually declared each prefix, and surfaces BOTH when two servers differ", async () => {
    const { deps, warnings } = makeDeps({
      serverNames: ["a", "b"],
      specs: { a: prefixSpec("a", "/x"), b: prefixSpec("b", "/y") },
      getSettings: () =>
        settings({ packages: ["dev"], combineProfiles: true, servers: ["a", "b"] }),
    });
    const provider = new LauncherProvider(deps);
    const [planned] = await provider.providePlannedDefinitions();

    await provider.resolveEnvForLabel(planned!.label);

    expect(warnings).toHaveLength(2);
    expect(warnings.find((w) => w.includes('"/x"'))).toContain('server "a"');
    expect(warnings.find((w) => w.includes('"/y"'))).toContain('server "b"');
  });
});

/**
 * Story 31.6, Task 1/2 — `irisMcpLauncher.developmentRepoPath` local-spawn
 * selection and fail-closed validation (AC 31.6.1/31.6.3). Uses REAL
 * temporary directories on disk (`LauncherProvider.resolveSpawnTargets` calls
 * real `node:fs` — no injected fs port; see `serverDefinitionProvider.ts`'s
 * doc comment) rather than mocking `node:fs`, so these tests exercise the
 * exact code path a real checkout hits.
 */
describe("LauncherProvider.providePlannedDefinitions — irisMcpLauncher.developmentRepoPath (Story 31.6)", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  /**
   * A fresh temp "monorepo checkout" directory, cleaned up in afterEach.
   * Includes an empty `packages/` because that is what a real checkout looks
   * like BEFORE anything is built — the case these tests exercise. A bare temp
   * directory with no `packages/` at all is a different condition (the user
   * pointed the setting at something that is not a checkout), covered by its
   * own test via {@link makeNonCheckoutDir}.
   */
  function makeRepoDir(): string {
    const dir = mkdtempSync(path.join(tmpdir(), "iris-mcp-launcher-devrepo-"));
    tempDirs.push(dir);
    mkdirSync(path.join(dir, "packages"), { recursive: true });
    return dir;
  }

  /** A real directory that is NOT a monorepo checkout (no `packages/` inside). */
  function makeNonCheckoutDir(): string {
    const dir = mkdtempSync(path.join(tmpdir(), "iris-mcp-launcher-notarepo-"));
    tempDirs.push(dir);
    return dir;
  }

  /** Creates <repoDir>/packages/<dirName>/dist/index.js so that package "builds". */
  function buildPackage(repoDir: string, dirName: string): void {
    const distDir = path.join(repoDir, "packages", dirName, "dist");
    mkdirSync(distDir, { recursive: true });
    writeFileSync(path.join(distDir, "index.js"), "// fake built entry point\n", "utf8");
  }

  it("developmentRepoPath unset (default) -> npx args with the @1 pin, otherwise Story 31.5's spawn shape", async () => {
    const { deps } = makeDeps({ serverNames: ["a"] });
    const provider = new LauncherProvider(deps);

    const planned = await provider.providePlannedDefinitions();

    expect(planned).toEqual([
      { label: "IRIS Dev Tools — a", command: "npx", args: ["-y", "@iris-mcp/dev@1"], env: providedEnv("a") },
    ]);
  });

  it("developmentRepoPath set + package built -> node <repoPath>/packages/<dir>/dist/index.js, no warning", async () => {
    const repoDir = makeRepoDir();
    buildPackage(repoDir, "iris-dev-mcp");

    const { deps, warnings } = makeDeps({
      serverNames: ["a"],
      getSettings: () => settings({ packages: ["dev"], developmentRepoPath: repoDir }),
    });
    const provider = new LauncherProvider(deps);

    const planned = await provider.providePlannedDefinitions();

    expect(planned).toEqual([
      {
        label: "IRIS Dev Tools — a",
        command: process.execPath,
        args: [path.join(repoDir, "packages", "iris-dev-mcp", "dist", "index.js")],
        env: providedEnv("a", { ELECTRON_RUN_AS_NODE: "1" }),
      },
    ]);
    expect(warnings).toHaveLength(0);
  });

  it("a resolved local-path definition can still be resolved to an env (resolveEnvForLabel keyed on the same label)", async () => {
    const repoDir = makeRepoDir();
    buildPackage(repoDir, "iris-dev-mcp");

    const { deps } = makeDeps({
      serverNames: ["a"],
      getSettings: () => settings({ packages: ["dev"], developmentRepoPath: repoDir }),
    });
    const provider = new LauncherProvider(deps);
    const [planned] = await provider.providePlannedDefinitions();

    const env = await provider.resolveEnvForLabel(planned!.label);
    expect(env).toMatchObject({ IRIS_HOST: "a.example.com" });
  });

  it("developmentRepoPath does not exist -> zero definitions, exactly ONE warning naming the setting and the path", async () => {
    const missingPath = path.join(tmpdir(), "iris-mcp-launcher-does-not-exist-31-6");
    const { deps, warnings } = makeDeps({
      serverNames: ["a", "b"],
      getSettings: () => settings({ packages: ["dev", "admin"], developmentRepoPath: missingPath }),
    });
    const provider = new LauncherProvider(deps);

    const planned = await provider.providePlannedDefinitions();

    expect(planned).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("developmentRepoPath");
    expect(warnings[0]).toContain(missingPath);
  });

  it("developmentRepoPath points at a FILE, not a directory -> fails closed the same as a nonexistent path", async () => {
    const repoDir = makeRepoDir();
    const filePath = path.join(repoDir, "not-a-directory.txt");
    writeFileSync(filePath, "x", "utf8");

    const { deps, warnings } = makeDeps({
      serverNames: ["a"],
      getSettings: () => settings({ packages: ["dev"], developmentRepoPath: filePath }),
    });
    const provider = new LauncherProvider(deps);

    const planned = await provider.providePlannedDefinitions();

    expect(planned).toEqual([]);
    expect(warnings).toHaveLength(1);
  });

  it("one package's missing dist/index.js drops ONLY that package's definitions — other selected packages still register normally", async () => {
    const repoDir = makeRepoDir();
    buildPackage(repoDir, "iris-dev-mcp"); // "admin" deliberately left unbuilt

    const { deps, warnings } = makeDeps({
      serverNames: ["a"],
      getSettings: () =>
        settings({ packages: ["dev", "admin"], developmentRepoPath: repoDir }),
    });
    const provider = new LauncherProvider(deps);

    const planned = await provider.providePlannedDefinitions();

    expect(planned).toEqual([
      {
        label: "IRIS Dev Tools — a",
        command: process.execPath,
        args: [path.join(repoDir, "packages", "iris-dev-mcp", "dist", "index.js")],
        env: providedEnv("a", { ELECTRON_RUN_AS_NODE: "1" }),
      },
    ]);
    expect(warnings).toHaveLength(1);
    // `'package "admin"'`, not a bare "admin" — the warning also embeds the
    // path `.../packages/iris-admin-mcp/dist/index.js`, so `toContain("admin")`
    // would still pass with the package-key clause removed entirely.
    expect(warnings[0]).toContain('package "admin"');
    expect(warnings[0]).toContain("dist/index.js");
  });

  it("a missing build shared by MULTIPLE servers of the same package produces exactly ONE reason in the aggregated warning, not one per server (toast-storm bar)", async () => {
    const repoDir = makeRepoDir(); // nothing built at all

    const { deps, warnings } = makeDeps({
      serverNames: ["a", "b", "c"],
      getSettings: () => settings({ packages: ["dev"], developmentRepoPath: repoDir }),
    });
    const provider = new LauncherProvider(deps);

    const planned = await provider.providePlannedDefinitions();

    expect(planned).toEqual([]);
    expect(warnings).toHaveLength(1);
    // Exactly one "dev" package clause, not three (one per server plan).
    expect(warnings[0]!.split('package "dev"').length - 1).toBe(1);
  });

  it("guards a REJECTING fs.promises.stat (e.g. a permission error on the repo-path check) — degrades to one warning, never an unhandled exception, and never forwards the raw error text (31-6-2's async fs guard)", async () => {
    const repoDir = makeRepoDir();
    buildPackage(repoDir, "iris-dev-mcp");

    const statMock = vi.mocked(fsp.stat);
    statMock.mockImplementationOnce(() =>
      Promise.reject(new Error("EACCES: permission denied, stat 'secret-detail'")),
    );

    {
      const { deps, warnings } = makeDeps({
        serverNames: ["a"],
        getSettings: () => settings({ packages: ["dev"], developmentRepoPath: repoDir }),
      });
      const provider = new LauncherProvider(deps);

      await expect(provider.providePlannedDefinitions()).resolves.toEqual([]);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).not.toContain("EACCES");
      expect(warnings[0]).not.toContain("secret-detail");
    }
  });

  it("31-6-2: the per-package dist/index.js validations do NOT run serially — both package probes are in flight at once", async () => {
    const repoDir = makeRepoDir();
    buildPackage(repoDir, "iris-dev-mcp");
    buildPackage(repoDir, "iris-admin-mcp");

    // Defer every stat call behind a manually-released promise, tracking the
    // peak number of PER-PACKAGE probes IN FLIGHT at once. Serial validation
    // peaks at 1; Promise.all fans the two distinct package probes out
    // together (peak 2). Deterministic formulation (Story 32.3 code review —
    // the original "release-as-they-arrive behind a 50-tick loop" version
    // flaked under full-suite parallel load, ~2/9 runs red): repo-level
    // checks pass straight through to the real stat; per-package dist probes
    // are HELD until the test releases them, so two unsettled dist probes at
    // once is the fan-out proof by construction — no tick-count race. A
    // serial implementation would leave the first probe held forever; the
    // wall-clock bound below expires and the assertion fails legibly instead
    // of deadlocking.
    const { stat: realStat } = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    let distInFlight = 0;
    let maxDistInFlight = 0;
    const distResolvers: (() => void)[] = [];
    const statMock = vi.mocked(fsp.stat);
    statMock.mockImplementation(((candidate: unknown) => {
      if (typeof candidate === "string" && candidate.endsWith("index.js")) {
        distInFlight++;
        maxDistInFlight = Math.max(maxDistInFlight, distInFlight);
        return new Promise<import("node:fs").Stats>((resolve, reject) => {
          distResolvers.push(() => {
            distInFlight--;
            // Rejection MUST flow through: without it an ENOENT (or any real-stat
            // failure) leaves the deferred promise unsettled forever and the test
            // deadlocks instead of failing legibly (isExistingFile's own catch
            // then degrades it to exists:false, exactly like production).
            void (realStat as (c: unknown) => Promise<import("node:fs").Stats>)(candidate).then(resolve, reject);
          });
        });
      }
      // Repo-level checks run first (serial by nature) and are not what this
      // test measures — pass them straight through.
      return (realStat as (c: unknown) => Promise<import("node:fs").Stats>)(candidate);
    }) as typeof fsp.stat);

    const { deps } = makeDeps({
      serverNames: ["a"],
      getSettings: () =>
        settings({ packages: ["dev", "admin"], developmentRepoPath: repoDir }),
    });
    const provider = new LauncherProvider(deps);

    const plannedPromise = provider.providePlannedDefinitions();
    // Wall-clock bound, not a tick count: generous enough for a loaded
    // worker, finite enough to fail (not hang) on a serial implementation.
    const deadline = Date.now() + 10_000;
    while (distResolvers.length < 2 && Date.now() < deadline) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    expect(maxDistInFlight).toBeGreaterThanOrEqual(2);
    while (distResolvers.length > 0) distResolvers.shift()!();
    const planned = await plannedPromise;
    expect(planned).toHaveLength(2);
  });

  it("guards a REJECTING stat specifically on a PER-PACKAGE dist/index.js check (a distinct code path from the repo-path check above): degrades to one warning naming only the affected package, never a raw error, and the OTHER selected (built, unaffected) package still registers", async () => {
    const repoDir = makeRepoDir();
    buildPackage(repoDir, "iris-dev-mcp");
    buildPackage(repoDir, "iris-admin-mcp");

    const { stat: realStat } = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    const statMock = vi.mocked(fsp.stat);
    statMock.mockImplementation(((candidate: unknown, options?: unknown) => {
      if (
        typeof candidate === "string" &&
        candidate.includes("iris-dev-mcp") &&
        candidate.endsWith("index.js")
      ) {
        return Promise.reject(new Error("EACCES: permission denied, stat 'dev-dist-detail'"));
      }
      return (realStat as (...args: unknown[]) => Promise<unknown>)(candidate, options);
    }) as typeof fsp.stat);

    {
      const { deps, warnings } = makeDeps({
        serverNames: ["a"],
        getSettings: () =>
          settings({ packages: ["dev", "admin"], developmentRepoPath: repoDir }),
      });
      const provider = new LauncherProvider(deps);

      const planned = await provider.providePlannedDefinitions();

      expect(planned).toEqual([
        {
          label: "IRIS Admin Tools — a",
          command: process.execPath,
          args: [path.join(repoDir, "packages", "iris-admin-mcp", "dist", "index.js")],
          env: providedEnv("a", { ELECTRON_RUN_AS_NODE: "1" }),
        },
      ]);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('package "dev"');
      expect(warnings[0]).not.toContain("EACCES");
      expect(warnings[0]).not.toContain("dev-dist-detail");
    }
  });

  it("ALL selected packages missing their build (two DISTINCT package keys, not just multiple servers of one package) -> zero definitions, exactly ONE aggregated warning naming BOTH missing packages", async () => {
    const repoDir = makeRepoDir(); // nothing built for either package

    const { deps, warnings } = makeDeps({
      serverNames: ["a"],
      getSettings: () => settings({ packages: ["dev", "admin"], developmentRepoPath: repoDir }),
    });
    const provider = new LauncherProvider(deps);

    const planned = await provider.providePlannedDefinitions();

    expect(planned).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('package "dev"');
    expect(warnings[0]).toContain('package "admin"');
  });

  it("developmentRepoPath with a trailing path separator still resolves the SAME dist/index.js path as without one (path.join normalizes it; no doubled-separator artifact, no warning)", async () => {
    const repoDir = makeRepoDir();
    buildPackage(repoDir, "iris-dev-mcp");
    const withTrailingSep = repoDir + path.sep;

    const { deps, warnings } = makeDeps({
      serverNames: ["a"],
      getSettings: () => settings({ packages: ["dev"], developmentRepoPath: withTrailingSep }),
    });
    const provider = new LauncherProvider(deps);

    const planned = await provider.providePlannedDefinitions();

    expect(planned).toEqual([
      {
        label: "IRIS Dev Tools — a",
        command: process.execPath,
        args: [path.join(repoDir, "packages", "iris-dev-mcp", "dist", "index.js")],
        env: providedEnv("a", { ELECTRON_RUN_AS_NODE: "1" }),
      },
    ]);
    expect(warnings).toHaveLength(0);
  });

  it("developmentRepoPath as a relative path that does not resolve to an existing directory (relative to process.cwd() at test-run time) fails closed exactly like an absolute missing path — no throw, one warning naming the literal relative value", async () => {
    const relativePath = "../this-directory-almost-certainly-does-not-exist-31-6-xyz";
    const { deps, warnings } = makeDeps({
      serverNames: ["a"],
      getSettings: () => settings({ packages: ["dev"], developmentRepoPath: relativePath }),
    });
    const provider = new LauncherProvider(deps);

    const planned = await provider.providePlannedDefinitions();

    expect(planned).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("developmentRepoPath");
    expect(warnings[0]).toContain(relativePath);
  });

  /**
   * Story 31.6 code review — the fail-OPEN case the original relative-path
   * test could not see, because it only used a relative path that ALSO does
   * not exist. A relative path that DOES resolve (here: the repo dir's own
   * basename, relative to its parent) previously passed validation and emitted
   * `args: ["<relative>/packages/.../dist/index.js"]` with ZERO warnings — but
   * `extension.ts` hands those args to `vscode.McpStdioServerDefinition`, whose
   * constructor takes no `cwd`, so the child resolves that relative string
   * against VS Code's MCP spawner cwd, NOT the extension host's. Validation
   * proved one file existed while the spawn targeted a different one (or none):
   * fail-open, and exactly the "guessed or partially-resolved path" AC 31.6.3
   * forbids. Relative paths are now rejected outright.
   */
  it("a relative developmentRepoPath that DOES resolve to a real built checkout is still REJECTED, never spawned — args must never contain a relative path the child would resolve against a different cwd (AC 31.6.3 fail-closed)", async () => {
    const repoDir = makeRepoDir();
    buildPackage(repoDir, "iris-dev-mcp");
    const originalCwd = process.cwd();
    process.chdir(path.dirname(repoDir));

    try {
      const relativeButReal = `./${path.basename(repoDir)}`;
      // Precondition: this relative path really does resolve to the built
      // checkout, so the test is not passing merely because nothing is there.
      expect(
        existsSync(path.join(relativeButReal, "packages", "iris-dev-mcp", "dist", "index.js")),
      ).toBe(true);

      const { deps, warnings } = makeDeps({
        serverNames: ["a"],
        getSettings: () => settings({ packages: ["dev"], developmentRepoPath: relativeButReal }),
      });
      const provider = new LauncherProvider(deps);

      const planned = await provider.providePlannedDefinitions();

      expect(planned).toEqual([]);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("developmentRepoPath");
      expect(warnings[0]).toContain("relative");
      expect(warnings[0]).toContain("absolute");
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("an absolute developmentRepoPath with no packages/ subdirectory (a real directory that is simply not a checkout) fails closed with ONE reason naming that, not one 'no built dist/index.js' clause per selected package", async () => {
    const notACheckout = makeNonCheckoutDir(); // exists, but has no packages/ inside

    const { deps, warnings } = makeDeps({
      serverNames: ["a"],
      getSettings: () =>
        settings({
          packages: ["dev", "admin", "data", "interop", "ops"],
          developmentRepoPath: notACheckout,
        }),
    });
    const provider = new LauncherProvider(deps);

    const planned = await provider.providePlannedDefinitions();

    expect(planned).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("packages/");
    // The five per-package clauses must NOT also be appended.
    expect(warnings[0]).not.toContain("dist/index.js");
  });

  it("packages:[] (the documented 'everything disabled' intent) stays SILENT even with an invalid developmentRepoPath — the path did not cause the zero-definition outcome, and 31.5's silent zero-state must not regress", async () => {
    const { deps, warnings } = makeDeps({
      serverNames: ["a"],
      getSettings: () =>
        settings({ packages: [], developmentRepoPath: path.join(tmpdir(), "nope-31-6-silent") }),
    });
    const provider = new LauncherProvider(deps);

    const planned = await provider.providePlannedDefinitions();

    expect(planned).toEqual([]);
    expect(warnings).toHaveLength(0);
  });

  it("combineProfiles:true under developmentRepoPath resolves ONE node+dist/index.js definition per package covering every server — the branch where planDefinitions emits one plan per package, so the per-package entry-point cache is NOT exercised", async () => {
    const repoDir = makeRepoDir();
    buildPackage(repoDir, "iris-dev-mcp");
    buildPackage(repoDir, "iris-admin-mcp");

    const { deps, warnings } = makeDeps({
      serverNames: ["a", "b"],
      getSettings: () =>
        settings({
          packages: ["dev", "admin"],
          servers: ["a", "b"],
          combineProfiles: true,
          developmentRepoPath: repoDir,
        }),
    });
    const provider = new LauncherProvider(deps);

    const planned = await provider.providePlannedDefinitions();

    expect(warnings).toHaveLength(0);
    expect([...planned].sort((x, y) => x.label.localeCompare(y.label))).toEqual([
      {
        label: "IRIS Admin Tools (a, b)",
        command: process.execPath,
        args: [path.join(repoDir, "packages", "iris-admin-mcp", "dist", "index.js")],
        env: {},
      },
      {
        label: "IRIS Dev Tools (a, b)",
        command: process.execPath,
        args: [path.join(repoDir, "packages", "iris-dev-mcp", "dist", "index.js")],
        env: {},
      },
    ]);

    // The definitions are still resolvable to a real multi-profile env.
    const env = await provider.resolveEnvForLabel("IRIS Dev Tools (a, b)");
    expect(Object.keys(JSON.parse(env!.IRIS_PROFILES as string)).sort()).toEqual(["a", "b"]);
  });

  it("a UNC-style developmentRepoPath (\\\\server\\share\\repo) that does not resolve is treated exactly like any other missing path — fails closed with one warning, no special-casing, and (via a mocked, rejecting stat) no real network filesystem call is made", async () => {
    const uncPath = "\\\\nonexistent-host-31-6\\share\\repo";
    const statMock = vi.mocked(fsp.stat);
    statMock.mockImplementationOnce(() => Promise.reject(new Error("ENETUNREACH (simulated)")));

    {
      const { deps, warnings } = makeDeps({
        serverNames: ["a"],
        getSettings: () => settings({ packages: ["dev"], developmentRepoPath: uncPath }),
      });
      const provider = new LauncherProvider(deps);

      const planned = await provider.providePlannedDefinitions();

      expect(planned).toEqual([]);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("developmentRepoPath");
      expect(warnings[0]).toContain(uncPath);
    }
  });
});

/**
 * Story 31.6, Task 3 — the removed `"all"` package key (AC 31.6.5). Verifies
 * `LauncherProvider` surfaces `settings.hadStaleAllPackage` as exactly one
 * warning naming the five valid replacement keys, while any OTHER selected
 * package still registers normally (never dropping the whole plan over one
 * stale key).
 */
describe("LauncherProvider.providePlannedDefinitions — removed 'all' package key (Story 31.6, AC 31.6.5)", () => {
  it("hadStaleAllPackage=true produces exactly ONE warning naming the five valid keys, and the remaining selected package still registers", async () => {
    const { deps, warnings } = makeDeps({
      serverNames: ["a"],
      getSettings: () => settings({ packages: ["dev"], hadStaleAllPackage: true }),
    });
    const provider = new LauncherProvider(deps);

    const planned = await provider.providePlannedDefinitions();

    expect(planned).toEqual([
      { label: "IRIS Dev Tools — a", command: "npx", args: ["-y", "@iris-mcp/dev@1"], env: providedEnv("a") },
    ]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("all");
    expect(warnings[0]).toContain("admin");
    expect(warnings[0]).toContain("data");
    expect(warnings[0]).toContain("dev");
    expect(warnings[0]).toContain("interop");
    expect(warnings[0]).toContain("ops");
  });

  it("hadStaleAllPackage=true with packages ending up completely empty (the user's ONLY selection was 'all') still warns exactly once, with zero definitions and no OTHER warning piling on", async () => {
    const { deps, warnings } = makeDeps({
      serverNames: ["a"],
      getSettings: () => settings({ packages: [], hadStaleAllPackage: true }),
    });
    const provider = new LauncherProvider(deps);

    const planned = await provider.providePlannedDefinitions();

    expect(planned).toEqual([]);
    expect(warnings).toHaveLength(1);
  });

  it("hadStaleAllPackage=false (the common case) never emits the removal warning", async () => {
    const { deps, warnings } = makeDeps({
      serverNames: ["a"],
      getSettings: () => settings({ packages: ["dev"], hadStaleAllPackage: false }),
    });
    const provider = new LauncherProvider(deps);

    await provider.providePlannedDefinitions();

    expect(warnings).toHaveLength(0);
  });
});

/**
 * AC 31.6.6 — Rule #19 back-compat, WHOLE-OBJECT comparison. With
 * `developmentRepoPath` unset (the default), every registered definition's
 * `command`, `args`, AND the fully synthesized `env` must be byte-identical
 * to Story 31.5's output. Deliberately `toEqual` against the COMPLETE
 * `PlannedDefinition` and the COMPLETE resolved env record, never a
 * `toMatchObject`/spot-check subset — the Story 31.5 review's own finding
 * (Dev Notes) was that a 5-key env spot-check hid a wrong `IRIS_HTTPS`
 * encoding (a `null` clear instead of the string `"false"`). A subset check
 * here would reintroduce exactly that blind spot for this story's new
 * `developmentRepoPath`/`hadStaleAllPackage` fields.
 */
describe("Rule #19 whole-object back-compat — developmentRepoPath unset matches Story 31.5 except the sanctioned @1 pin (AC 31.6.6)", () => {
  it("command/args/env for a combineProfiles, multi-server, governance-bearing definition match the pre-31.6 shape EXACTLY", async () => {
    const api: ServerManagerApi = {
      getServerNames: () => [
        { name: "prod", description: "", detail: "" },
        { name: "staging", description: "", detail: "" },
      ],
      getServerSpec: async (name: string) => ({
        name,
        webServer: { host: `${name}.example.com`, port: 443, scheme: "https" },
        username: "_SYSTEM",
        password: "SYS",
      }),
      getAccount: () => ({ id: "acct-1", label: "Account One" }),
    };

    const provider = new LauncherProvider({
      getServerManagerApi: async () => api,
      authApi: { getSession: vi.fn() as never },
      getSettings: () =>
        settings({
          packages: ["dev"],
          servers: ["prod", "staging"],
          combineProfiles: true,
          governance: "off",
          toolsPreset: "core",
          // developmentRepoPath deliberately OMITTED from the overrides —
          // the settings() helper's own default ("") is what is under test.
        }),
      showWarning: () => {},
      inspectServerManagerServers: () => userScopeServers(["prod", "staging"]),
    });

    const planned = await provider.providePlannedDefinitions();

    // Whole-array, whole-object: every field of every planned definition,
    // not a subset.
    expect(planned).toEqual([
      {
        label: "IRIS Dev Tools (prod, staging)",
        command: "npx",
        args: ["-y", "@iris-mcp/dev@1"],
        // combineProfiles is Local-only: its provided env is today's empty one.
        env: {},
      },
    ]);

    const env = await provider.resolveEnvForLabel(planned[0]!.label);

    // Whole-object: every key `withOwnedVarsCleared`/`synthesizeIrisEnv`/
    // `buildGovernanceEnv` can possibly emit, asserted in one `toEqual` —
    // an added, removed, or wrongly-encoded key fails this immediately.
    expect(env).toEqual({
      IRIS_HOST: "prod.example.com",
      IRIS_PORT: "443",
      IRIS_HTTPS: "true",
      IRIS_USERNAME: "_SYSTEM",
      IRIS_PASSWORD: "SYS",
      IRIS_NAMESPACE: "HSCUSTOM",
      IRIS_PROFILES: JSON.stringify({
        prod: {
          host: "prod.example.com",
          port: 443,
          https: true,
          username: "_SYSTEM",
          password: "SYS",
          namespace: "HSCUSTOM",
        },
        staging: {
          host: "staging.example.com",
          port: 443,
          https: true,
          username: "_SYSTEM",
          password: "SYS",
          namespace: "HSCUSTOM",
        },
      }),
      IRIS_GOVERNANCE: "off",
      IRIS_GOVERNANCE_PRESET: null,
      IRIS_GOVERNANCE_FILE: null,
      IRIS_AUDIT_LOG: null,
      IRIS_AUDIT_LOG_MAX_MB: null,
      IRIS_AUDIT_LOG_PARAMS: null,
      IRIS_TOOLS_PRESET: "core",
      IRIS_TOOLS_DISABLE: null,
      IRIS_TOOLS_ENABLE: null,
      IRIS_SERVER_MANAGER: null,
      IRIS_SM_SERVERS: null,
      IRIS_SM_SETTINGS_PATHS: null,
      IRIS_SM_WORKSPACE: null,
      IRIS_CREDENTIAL_HELPER: null,
      MCP_TRANSPORT: null,
    });
  });

  /**
   * Scope note (corrected in the Story 31.6 code review): this is NOT an
   * independent corroboration of the hand-typed 20-key fixture above, and must
   * not be banked as one. `resolveEnvForLabel` produces its result by CALLING
   * `withOwnedVarsCleared`, so "no owned key is missing" holds by construction
   * and cannot fail. What this test genuinely catches is the other direction:
   * an EXTRA key — one `synthesizeIrisEnv` or `buildGovernanceEnv` emits that
   * is outside `env.ts`'s declared owned-var set, and which
   * `withOwnedVarsCleared` therefore never clears. That is a real leak (a
   * variable this extension sets but does not own, and cannot unset), just a
   * narrower property than "the fixture is right". The fixture above is
   * verified by being a whole-object `toEqual`, not by this test.
   */
  it("the resolved env emits NO key outside env.ts's declared launcher-owned-var set (catches an unowned, never-cleared variable; it cannot catch a missing one — see the note above)", async () => {
    const { withOwnedVarsCleared } = await import("../env.js");
    const allOwnedKeys = Object.keys(withOwnedVarsCleared({})).sort();

    const api: ServerManagerApi = {
      getServerNames: () => [{ name: "solo", description: "", detail: "" }],
      getServerSpec: async () => ({
        name: "solo",
        webServer: { host: "solo.example.com", port: 52773, scheme: "http" },
        username: "_SYSTEM",
        password: "SYS",
      }),
      getAccount: () => ({ id: "acct-1", label: "Account One" }),
    };
    const provider = new LauncherProvider({
      getServerManagerApi: async () => api,
      authApi: { getSession: vi.fn() as never },
      getSettings: () => settings({ packages: ["dev"], servers: ["solo"] }),
      showWarning: () => {},
      inspectServerManagerServers: () => userScopeServers(["solo"]),
    });

    const [planned] = await provider.providePlannedDefinitions();
    const env = await provider.resolveEnvForLabel(planned!.label);

    expect(Object.keys(env ?? {}).sort()).toEqual(allOwnedKeys);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Story 32.3 deferred-item burn-down: 31-4-1 coalescing, 31-4-6 cancellation
// token, 31-4-4 reserved-name warning, 31-6-1 warning dedupe, 31-6-3
// Electron-as-node env.
// ══════════════════════════════════════════════════════════════════════════

describe("Story 32.3 — 31-4-1: concurrent credential resolutions of the SAME server are coalesced", () => {
  it("5 parallel resolveEnvForLabel calls (one per package) share ONE getSession round-trip; the in-flight entry is evicted on settle so a later start re-resolves", async () => {
    let getSessionCalls = 0;
    const countingAuth: AuthApi = {
      getSession: async () => {
        getSessionCalls++;
        // Yield so the parallel callers genuinely overlap on the in-flight promise.
        await new Promise((resolve) => setImmediate(resolve));
        return {
          id: "s1",
          accessToken: "resolved-token",
          account: { id: "acct-1", label: "Account One" },
          scopes: ["a", "sessionUser"],
        };
      },
    };
    const serverNames = ["a"];
    const api: ServerManagerApi = {
      getServerNames: () => serverNames.map((name) => ({ name, description: "", detail: "" })),
      getServerSpec: async () => specFor("a"), // no password — the auth path runs
      getAccount: () => ({ id: "acct-1", label: "Account One" }),
    };
    const deps: ProviderDeps = {
      getServerManagerApi: async () => api,
      authApi: countingAuth,
      getSettings: () =>
        settings({ packages: ["dev", "admin", "data", "interop", "ops"] }),
      showWarning: () => {},
      inspectServerManagerServers: () => userScopeServers(serverNames),
    };
    const provider = new LauncherProvider(deps);
    const planned = await provider.providePlannedDefinitions();
    expect(planned).toHaveLength(5);

    const envs = await Promise.all(planned.map((def) => provider.resolveEnvForLabel(def.label)));
    expect(envs.every((env) => env !== undefined)).toBe(true);
    // Coalesced: ONE getSession for all five concurrent resolutions (the
    // silent probe succeeds, so no prompting second call). Un-coalesced this
    // would be 5.
    expect(getSessionCalls).toBe(1);

    // Evicted on settle: a fresh resolve AFTER the in-flight promise settled
    // re-resolves (a cancellation is never cached as a permanent "no").
    const env = await provider.resolveEnvForLabel(planned[0]!.label);
    expect(env).toBeDefined();
    expect(getSessionCalls).toBe(2);
  });
});

describe("Story 32.3 — 31-4-6: CancellationToken is honored in the multi-server resolve loop", () => {
  it("a cancelled token stops the loop silently — returns undefined with NO warning and no further getSession calls", async () => {
    let getSessionCalls = 0;
    const countingAuth: AuthApi = {
      getSession: async () => {
        getSessionCalls++;
        return {
          id: "s1",
          accessToken: "resolved-token",
          account: { id: "acct-1", label: "Account One" },
          scopes: ["x", "sessionUser"],
        };
      },
    };
    const serverNames = ["a", "b"];
    const api: ServerManagerApi = {
      getServerNames: () => serverNames.map((name) => ({ name, description: "", detail: "" })),
      getServerSpec: async (name: string) => specFor(name),
      getAccount: () => ({ id: "acct-1", label: "Account One" }),
    };
    const warnings: string[] = [];
    const deps: ProviderDeps = {
      getServerManagerApi: async () => api,
      authApi: countingAuth,
      getSettings: () =>
        settings({ packages: ["dev"], servers: ["a", "b"], combineProfiles: true }),
      showWarning: (message) => warnings.push(message),
    };
    const provider = new LauncherProvider(deps);
    const planned = await provider.providePlannedDefinitions();
    expect(planned).toHaveLength(1);

    const env = await provider.resolveEnvForLabel(planned[0]!.label, {
      isCancellationRequested: true,
    });
    expect(env).toBeUndefined();
    expect(getSessionCalls).toBe(0);
    // A cancellation is not a user error: NO warning at all.
    expect(warnings).toEqual([]);
  });
});

describe("Story 32.3 — 31-4-4: a \"default\"-named server under combineProfiles warns once (paired decision with suite item 31-3-1)", () => {
  it("one warning naming the reserved-name shadowing and the rename remedy", async () => {
    const { deps, warnings } = makeDeps({
      serverNames: ["default"],
      specs: { default: specFor("default", "SYS") },
      getSettings: () => settings({ packages: ["dev"], combineProfiles: true }),
    });
    const provider = new LauncherProvider(deps);
    const planned = await provider.providePlannedDefinitions();

    const env = await provider.resolveEnvForLabel(planned[0]!.label);
    // The server IS still emitted (not silently renamed or dropped) — the
    // warning is the honest signal, mirroring the suite-side notice.
    expect(env).toBeDefined();
    const shadowWarnings = warnings.filter((w) => w.includes("RESERVED"));
    expect(shadowWarnings).toHaveLength(1);
    expect(shadowWarnings[0]).toContain('"default"');
    expect(shadowWarnings[0]).toContain("Rename");

    // A second resolve does not re-fire (31-6-1's warnOnce covers it).
    await provider.resolveEnvForLabel(planned[0]!.label);
    expect(warnings.filter((w) => w.includes("RESERVED"))).toHaveLength(1);
  });

  it("no reserved-name warning in single-profile mode (combineProfiles off)", async () => {
    const { deps, warnings } = makeDeps({
      serverNames: ["default"],
      specs: { default: specFor("default", "SYS") },
      getSettings: () => settings({ packages: ["dev"], combineProfiles: false }),
    });
    const provider = new LauncherProvider(deps);
    const planned = await provider.providePlannedDefinitions();
    await provider.resolveEnvForLabel(planned[0]!.label);
    expect(warnings.filter((w) => w.includes("RESERVED"))).toHaveLength(0);
  });
});

describe("Story 32.3 — 31-6-1: repeated providePlannedDefinitions calls fire each warning ONCE", () => {
  it("stale-all + no-match warnings each appear exactly once across three provides (empty-plan case)", async () => {
    const { deps, warnings } = makeDeps({
      serverNames: ["a"],
      getSettings: () =>
        settings({
          packages: ["dev"],
          servers: ["zzz-no-such-server"],
          hadStaleAllPackage: true,
        }),
    });
    const provider = new LauncherProvider(deps);

    await provider.providePlannedDefinitions();
    await provider.providePlannedDefinitions();
    await provider.providePlannedDefinitions();

    const staleAll = warnings.filter((w) => w.includes('lists the removed "all" package key'));
    const noMatch = warnings.filter((w) => w.includes("none of the configured irisMcpLauncher.servers"));
    expect(staleAll).toHaveLength(1);
    expect(noMatch).toHaveLength(1);
    expect(warnings).toHaveLength(2);
  });

  it("stale-all + devRepoPath warnings each appear exactly once across three provides (non-empty-plan case)", async () => {
    const missingPath = path.join(tmpdir(), "iris-mcp-launcher-dedupe-31-6-1");
    const { deps, warnings } = makeDeps({
      serverNames: ["a"],
      getSettings: () =>
        settings({
          packages: ["dev"],
          hadStaleAllPackage: true,
          developmentRepoPath: missingPath,
        }),
    });
    const provider = new LauncherProvider(deps);

    await provider.providePlannedDefinitions();
    await provider.providePlannedDefinitions();
    await provider.providePlannedDefinitions();

    const staleAll = warnings.filter((w) => w.includes('lists the removed "all" package key'));
    const devPath = warnings.filter((w) => w.includes("irisMcpLauncher.developmentRepoPath is set to"));
    expect(staleAll).toHaveLength(1);
    expect(devPath).toHaveLength(1);
    expect(warnings).toHaveLength(2);
  });
});

describe("Story 32.4 — 32-3-R7: static-text warnings re-fire after a fix-then-rebreak (rising-edge dedupe)", () => {
  it('stale-"all": warns once while the condition persists, stays silent after the fix, warns once more when re-introduced', async () => {
    let stale = true;
    const { deps, warnings } = makeDeps({
      serverNames: ["a"],
      getSettings: () => settings({ packages: ["dev"], hadStaleAllPackage: stale }),
    });
    const provider = new LauncherProvider(deps);
    const staleAll = () => warnings.filter((w) => w.includes('lists the removed "all" package key'));

    await provider.providePlannedDefinitions();
    await provider.providePlannedDefinitions();
    expect(staleAll()).toHaveLength(1); // persistent condition: exactly once

    stale = false; // the user fixes the setting
    await provider.providePlannedDefinitions();
    expect(staleAll()).toHaveLength(1); // no re-fire on the clear edge

    stale = true; // …and later re-introduces it
    await provider.providePlannedDefinitions();
    expect(staleAll()).toHaveLength(2); // one NEW warning for the new occurrence

    await provider.providePlannedDefinitions();
    expect(staleAll()).toHaveLength(2); // …still deduped while it persists
  });

  it('reserved-"default": re-warns after the rename fix is undone', async () => {
    let combine = true;
    const { deps, warnings } = makeDeps({
      serverNames: ["default"],
      specs: { default: specFor("default", "SYS") },
      getSettings: () => settings({ packages: ["dev"], combineProfiles: combine }),
    });
    const provider = new LauncherProvider(deps);
    const shadow = () => warnings.filter((w) => w.includes("RESERVED"));

    const planned = await provider.providePlannedDefinitions();
    await provider.resolveEnvForLabel(planned[0]!.label);
    await provider.resolveEnvForLabel(planned[0]!.label);
    expect(shadow()).toHaveLength(1);

    combine = false; // the fix: no longer combining (no shadowing)
    await provider.resolveEnvForLabel(planned[0]!.label);
    expect(shadow()).toHaveLength(1);

    combine = true; // the rebreak
    await provider.resolveEnvForLabel(planned[0]!.label);
    expect(shadow()).toHaveLength(2);
  });
});

describe("Story 32.4 — 32-3-R14: coalesced-credential containment + shared-result freeze", () => {
  it("an unexpected throw inside credential resolution degrades to ONE contained 'unavailable' warning — never a rejection out of resolveMcpServerDefinition", async () => {
    const warnings: string[] = [];
    const diagnostics: string[] = [];
    // A spec WITHOUT an inline password AND without a username forces the
    // authentication path with `specUsername === ""`, so the malformed
    // session's missing `scopes` array (the "a bug or a new rejection mode"
    // case the guard exists for, NOT a shape the real API is known to
    // produce) makes resolveServerCredentials throw UNEXPECTEDLY
    // (session.scopes[1]) outside every guarded region.
    const api: ServerManagerApi = {
      getServerNames: () => [{ name: "serverA", description: "", detail: "" }],
      getServerSpec: async () => ({
        name: "serverA",
        webServer: { host: "serverA.example.com", port: 52773, scheme: "http" },
      }),
      getAccount: () => ({ id: "acct-1", label: "Account One" }),
    };
    const authApi: AuthApi = {
      getSession: async () =>
        ({ id: "s1", accessToken: "tok", account: { id: "acct-1", label: "Account One" } }) as never,
    };
    const deps: ProviderDeps = {
      getServerManagerApi: async () => api,
      authApi,
      getSettings: () => settings({ servers: ["serverA"] }),
      showWarning: (m) => warnings.push(m),
      logDiagnostic: (m) => diagnostics.push(m),
      inspectServerManagerServers: () => userScopeServers(["serverA"]),
    };
    const provider = new LauncherProvider(deps);
    const planned = await provider.providePlannedDefinitions();
    expect(planned).toHaveLength(1);

    // Pre-Story-32.4 this REJECTED (the throw fanned out to every coalesced
    // caller). Now: contained to the ordinary "unavailable" outcome.
    const env = await provider.resolveEnvForLabel(planned[0]!.label);
    expect(env).toBeUndefined();
    const unavailable = warnings.filter((w) => w.includes("could not provide a connection"));
    expect(unavailable).toHaveLength(1);
    expect(unavailable[0]).toContain("serverA");
    // 32.4 review (Edge L4): the degraded surface is identical to an
    // ordinary failure, so the underlying error leaves a diagnostic crumb
    // (output channel) naming the server and the thrown error — never a
    // toast, never the profile/session payload.
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toContain("serverA");
    expect(diagnostics[0]).toContain("threw unexpectedly");
    expect(diagnostics[0]).toContain("TypeError");
    expect(diagnostics[0]).not.toContain("tok");
  });

  it("the coalesced result is frozen (shared-object mutation guard), and concurrent resolutions share ONE getSession round-trip", async () => {
    const { deps } = makeDeps({
      serverNames: ["serverA"],
      specs: { serverA: specFor("serverA") }, // no password → auth path
    });
    const provider = new LauncherProvider(deps);
    interface CoalescedAccess {
      resolveCredentialsCoalesced(
        api: ServerManagerApi,
        serverName: string,
        namespace: string,
        scope?: unknown,
      ): Promise<unknown>;
    }
    const internal = provider as unknown as CoalescedAccess;
    const api = (await deps.getServerManagerApi()) as ServerManagerApi;

    const [first, second] = await Promise.all([
      internal.resolveCredentialsCoalesced(api, "serverA", "HSCUSTOM", undefined),
      internal.resolveCredentialsCoalesced(api, "serverA", "HSCUSTOM", undefined),
    ]);
    // Same shared object for every coalesced caller…
    expect(second).toBe(first);
    // …and it (plus the profile it carries) is structurally read-only.
    expect(Object.isFrozen(first)).toBe(true);
    const result = first as { status: string; profile?: unknown };
    expect(result.status).toBe("resolved");
    expect(Object.isFrozen(result.profile)).toBe(true);
  });

  it("32.4 review: the contained 'unavailable' fallback is frozen too (same shared-object guard as the success branch)", async () => {
    const warnings: string[] = [];
    const api: ServerManagerApi = {
      getServerNames: () => [{ name: "serverA", description: "", detail: "" }],
      getServerSpec: async () => ({
        name: "serverA",
        webServer: { host: "serverA.example.com", port: 52773, scheme: "http" },
      }),
      getAccount: () => ({ id: "acct-1", label: "Account One" }),
    };
    const authApi: AuthApi = {
      getSession: async () =>
        ({ id: "s1", accessToken: "tok", account: { id: "acct-1", label: "Account One" } }) as never,
    };
    const deps: ProviderDeps = {
      getServerManagerApi: async () => api,
      authApi,
      getSettings: () => settings({ servers: ["serverA"] }),
      showWarning: (m) => warnings.push(m),
    };
    const provider = new LauncherProvider(deps);
    interface CoalescedAccess {
      resolveCredentialsCoalesced(
        api: ServerManagerApi,
        serverName: string,
        namespace: string,
        scope?: unknown,
      ): Promise<unknown>;
    }
    const internal = provider as unknown as CoalescedAccess;
    const [first, second] = await Promise.all([
      internal.resolveCredentialsCoalesced(api, "serverA", "HSCUSTOM", undefined),
      internal.resolveCredentialsCoalesced(api, "serverA", "HSCUSTOM", undefined),
    ]);
    expect(second).toBe(first);
    expect((first as { status: string }).status).toBe("unavailable");
    expect(Object.isFrozen(first)).toBe(true);
  });
});

describe("Story 32.3 — 31-6-3: local-build plans spawn the extension host's own interpreter", () => {
  it("resolveEnvForLabel adds ELECTRON_RUN_AS_NODE=1 for a local (process.execPath) plan, and NOT for an npx plan", async () => {
    // Self-contained fake "built checkout" (makeRepoDir/buildPackage are
    // scoped to the Story 31.6 describe above).
    const repoDir = mkdtempSync(path.join(tmpdir(), "iris-mcp-launcher-31-6-3-"));
    mkdirSync(path.join(repoDir, "packages", "iris-dev-mcp", "dist"), { recursive: true });
    writeFileSync(path.join(repoDir, "packages", "iris-dev-mcp", "dist", "index.js"), "// fake entry\n", "utf8");

    // Local plan.
    const local = makeDeps({
      serverNames: ["a"],
      getSettings: () => settings({ packages: ["dev"], developmentRepoPath: repoDir }),
    });
    const localProvider = new LauncherProvider(local.deps);
    const localPlanned = await localProvider.providePlannedDefinitions();
    expect(localPlanned[0]!.command).toBe(process.execPath);
    const localEnv = await localProvider.resolveEnvForLabel(localPlanned[0]!.label);
    expect(localEnv).toMatchObject({ ELECTRON_RUN_AS_NODE: "1" });

    // npx plan (default) — no such variable.
    const npxDeps = makeDeps({ serverNames: ["a"] });
    const npxProvider = new LauncherProvider(npxDeps.deps);
    const npxPlanned = await npxProvider.providePlannedDefinitions();
    const npxEnv = await npxProvider.resolveEnvForLabel(npxPlanned[0]!.label);
    expect(npxEnv).not.toHaveProperty("ELECTRON_RUN_AS_NODE");
  });
});

/**
 * Story 44.6 — the provided definition carries a secret-free env (what a Copilot-harness session spawns), and the Local
 * resolve path stays what it was. `tracked` records every Server Manager and authentication call so "never prompts, never
 * reads an account or session" is asserted, not assumed.
 */
function tracked(
  specs: Record<string, ServerSpec | (() => Promise<ServerSpec | undefined>) | undefined>,
  overrides: Partial<LauncherSettings> = {},
  inspection?: ServerManagerServersInspection,
) {
  const calls = { getServerSpec: [] as string[], getAccount: 0, getSession: [] as GetSessionOptions[] };
  const warnings: string[] = [];
  const names = Object.keys(specs);
  const api: ServerManagerApi = {
    getServerNames: () => names.map((name) => ({ name, description: "", detail: "" })),
    getServerSpec: async (name: string) => {
      calls.getServerSpec.push(name);
      const entry = specs[name];
      return typeof entry === "function" ? entry() : entry;
    },
    getAccount: () => {
      calls.getAccount += 1;
      return { id: "acct-1", label: "Account One" };
    },
  };
  const authApi: AuthApi = {
    getSession: async (_providerId, _scopes, options) => {
      calls.getSession.push(options);
      return { id: "s1", accessToken: "SESSION-TOKEN-44.6", account: { id: "acct-1", label: "Account One" }, scopes: ["x", "sessionUser"] };
    },
  };
  const provider = new LauncherProvider({
    getServerManagerApi: async () => api,
    authApi,
    getSettings: () => settings({ servers: names, ...overrides }),
    showWarning: (message: string) => warnings.push(message),
    inspectServerManagerServers: () => inspection ?? userScopeServers(names),
  });
  return { provider, calls, warnings };
}

describe("Story 44.6 AC-9: provided definitions carry the non-secret env and never a secret", () => {
  const inline = { ...specFor("dev1", "INLINE-PASSWORD-44.6"), username: "svc" };

  it("npx plan: the full env is pinned, with the credential name, set governance variables and empty overrides", async () => {
    const { provider, calls, warnings } = tracked(
      { dev1: inline },
      { governance: "off", toolsPreset: "core", auditLogMaxMb: "25" },
    );

    const planned = await provider.providePlannedDefinitions();

    expect(planned).toEqual([
      {
        label: "IRIS Dev Tools — dev1",
        command: "npx",
        args: ["-y", "@iris-mcp/dev@1"],
        env: {
          IRIS_HOST: "dev1.example.com",
          IRIS_PORT: "52773",
          IRIS_HTTPS: "false",
          IRIS_USERNAME: "svc",
          IRIS_NAMESPACE: "HSCUSTOM",
          IRIS_CREDENTIAL_NAME: "dev1",
          IRIS_GOVERNANCE: "off",
          IRIS_TOOLS_PRESET: "core",
          IRIS_AUDIT_LOG_MAX_MB: "25",
          IRIS_PASSWORD: "",
          IRIS_PROFILES: "",
          IRIS_GOVERNANCE_PRESET: "",
          IRIS_GOVERNANCE_FILE: "",
          IRIS_AUDIT_LOG: "",
          IRIS_AUDIT_LOG_PARAMS: "",
          IRIS_TOOLS_DISABLE: "",
          IRIS_TOOLS_ENABLE: "",
          IRIS_SERVER_MANAGER: "",
          IRIS_SM_SERVERS: "",
          IRIS_SM_SETTINGS_PATHS: "",
          IRIS_SM_WORKSPACE: "",
          IRIS_CREDENTIAL_HELPER: "",
          MCP_TRANSPORT: "",
        },
      },
    ]);
    expect(planned[0]!.env).not.toHaveProperty("ELECTRON_RUN_AS_NODE");
    expect(warnings).toEqual([]);
    expect(calls.getServerSpec).toEqual(["dev1"]);
  });

  it("an unset IRIS_AUDIT_LOG_MAX_MB stays null (an empty value parses as 0 in the server), every other unset owned variable is ''", async () => {
    const { provider } = tracked({ dev1: inline });
    const [planned] = await provider.providePlannedDefinitions();
    expect(planned!.env["IRIS_AUDIT_LOG_MAX_MB"]).toBeNull();
    expect(Object.values(planned!.env).filter((value) => value === null)).toHaveLength(1);
  });

  it("local-build plan: ELECTRON_RUN_AS_NODE=1 is added", async () => {
    const repoDir = mkdtempSync(path.join(tmpdir(), "iris-mcp-launcher-44-6-"));
    try {
      mkdirSync(path.join(repoDir, "packages", "iris-dev-mcp", "dist"), { recursive: true });
      writeFileSync(path.join(repoDir, "packages", "iris-dev-mcp", "dist", "index.js"), "// fake entry\n", "utf8");
      const { provider } = tracked({ dev1: inline }, { developmentRepoPath: repoDir });
      const [planned] = await provider.providePlannedDefinitions();
      expect(planned!.command).toBe(process.execPath);
      expect(planned!.env["ELECTRON_RUN_AS_NODE"]).toBe("1");
      expect(planned!.env["IRIS_CREDENTIAL_NAME"]).toBe("dev1");
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
    }
  });

  it("never reads the inline password, an account or a session: no secret is anywhere in the definitions, nothing prompts, nothing warns", async () => {
    const { provider, calls, warnings } = tracked({ dev1: inline });

    const planned = await provider.providePlannedDefinitions();

    const everything = JSON.stringify(planned);
    expect(everything).not.toContain("INLINE-PASSWORD-44.6");
    expect(everything).not.toContain("SESSION-TOKEN-44.6");
    expect(planned[0]!.env["IRIS_PASSWORD"]).toBe("");
    expect(calls.getSession).toEqual([]);
    expect(calls.getAccount).toBe(0);
    expect(warnings).toEqual([]);
  });

  it("looks each distinct server's spec up once per provide, however many packages cover it", async () => {
    const { provider, calls } = tracked(
      { a: specFor("a"), b: specFor("b") },
      { packages: ["dev", "admin", "ops"] },
    );
    const planned = await provider.providePlannedDefinitions();
    expect(planned).toHaveLength(6);
    expect([...calls.getServerSpec].sort()).toEqual(["a", "b"]);
    expect(planned.map((definition) => definition.env["IRIS_CREDENTIAL_NAME"]).sort()).toEqual(["a", "a", "a", "b", "b", "b"]);
  });

  it("hands the spec lookup the scope the name was enumerated in (multi-root), and each package's definition the namespace setting", async () => {
    const scopeToken = { uri: "file:///workspace/folder-b" };
    const seen: unknown[] = [];
    const api: ServerManagerApi = {
      getServerNames: () => [{ name: "a", description: "", detail: "", scope: scopeToken }],
      getServerSpec: async (_name, scope) => {
        seen.push(scope);
        return specFor("a");
      },
      getAccount: () => undefined,
    };
    const provider = new LauncherProvider({
      getServerManagerApi: async () => api,
      authApi: { getSession: async () => undefined },
      getSettings: () => settings({ servers: ["a"], namespace: "APPNS" }),
      showWarning: () => undefined,
      inspectServerManagerServers: () => userScopeServers(["a"]),
    });
    const [planned] = await provider.providePlannedDefinitions();
    expect(seen).toEqual([scopeToken]);
    expect(planned!.env["IRIS_NAMESPACE"]).toBe("APPNS");
  });

  it("several servers across packages: each definition carries the env of the server its label names (never another server's)", async () => {
    const { provider } = tracked(
      { a: { ...specFor("a"), username: "user-a" }, b: { ...specFor("b"), username: "user-b" } },
      { packages: ["dev", "admin"] },
    );
    const planned = await provider.providePlannedDefinitions();
    expect(planned).toHaveLength(4);
    for (const definition of planned) {
      const server = definition.label.endsWith("— a") ? "a" : definition.label.endsWith("— b") ? "b" : "?";
      expect(server, definition.label).not.toBe("?");
      expect(
        {
          name: definition.env["IRIS_CREDENTIAL_NAME"],
          host: definition.env["IRIS_HOST"],
          username: definition.env["IRIS_USERNAME"],
        },
        definition.label,
      ).toEqual({ name: server, host: `${server}.example.com`, username: `user-${server}` });
    }
  });
});

describe("DW-749: only a server defined in user settings alone names a stored credential in a provided definition", () => {
  const dev1 = { ...specFor("dev1"), username: "svc" };
  // `inspect("servers")` shapes per `vscode.d.ts` WorkspaceConfiguration.inspect: one optional value per layer.
  const userOnly: ServerManagerServersInspection = { globalValue: { dev1: { webServer: { host: "dev1.example.com" } } } };
  const cases: Array<[string, ServerManagerServersInspection]> = [
    ["the workspace overrides the user's dev1", { ...userOnly, workspaceValue: { dev1: { webServer: { host: "evil.example.com" } } } }],
    ["a workspace folder overrides the user's dev1", { ...userOnly, workspaceFolderValue: { dev1: { webServer: { host: "evil.example.com" } } } }],
    ["dev1 is defined only in the workspace", { workspaceValue: { dev1: { webServer: { host: "evil.example.com" } } } }],
    ["dev1 is defined only in a workspace folder", { workspaceFolderValue: { dev1: { webServer: { host: "evil.example.com" } } } }],
    ["a language-specific workspace layer defines dev1", { ...userOnly, workspaceLanguageValue: { dev1: {} } }],
    ["a language-specific folder layer defines dev1", { ...userOnly, workspaceFolderLanguageValue: { dev1: {} } }],
    ["the workspace layer is not an object", { ...userOnly, workspaceValue: "garbage" }],
    ["no layer defines dev1", { globalValue: { other: {} } }],
    ["the inspection carries no layer at all", {}],
  ];

  it.each(cases)("%s: env {}, no spec lookup, no warning, no prompt", async (_label, inspection) => {
    const { provider, calls, warnings } = tracked({ dev1 }, {}, inspection);
    const planned = await provider.providePlannedDefinitions();
    expect(planned).toHaveLength(1);
    expect(planned[0]!.env).toEqual({});
    expect(calls.getServerSpec).toEqual([]);
    expect(calls.getSession).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it("a workspace layer that defines OTHER servers only leaves the user's dev1 eligible", async () => {
    const { provider } = tracked({ dev1 }, {}, { ...userOnly, workspaceValue: { other: {} } });
    const [planned] = await provider.providePlannedDefinitions();
    expect(planned!.env["IRIS_CREDENTIAL_NAME"]).toBe("dev1");
  });

  it("a server defined by Server Manager's own default value (no user, no workspace layer) is eligible", async () => {
    const { provider } = tracked({ dev1 }, {}, { defaultValue: { dev1: {} } });
    const [planned] = await provider.providePlannedDefinitions();
    expect(planned!.env["IRIS_CREDENTIAL_NAME"]).toBe("dev1");
  });

  it("no inspectServerManagerServers dependency, one returning undefined, or one that throws: env {} (fail safe), provide still resolves", async () => {
    const api: ServerManagerApi = {
      getServerNames: () => [{ name: "dev1", description: "", detail: "" }],
      getServerSpec: async () => dev1,
      getAccount: () => undefined,
    };
    const base = {
      getServerManagerApi: async () => api,
      authApi: { getSession: async () => undefined },
      getSettings: () => settings({ servers: ["dev1"] }),
      showWarning: () => undefined,
    };
    for (const deps of [
      base,
      { ...base, inspectServerManagerServers: () => undefined },
      {
        ...base,
        inspectServerManagerServers: () => {
          throw new Error("configuration unavailable");
        },
      },
    ] as ProviderDeps[]) {
      const [planned] = await new LauncherProvider(deps).providePlannedDefinitions();
      expect(planned!.env).toEqual({});
    }
  });

  it("Story 44.8 (DW-752): the Local resolve path refuses a workspace-overridden server with one warning and no Server Manager call", async () => {
    const { provider, calls, warnings } = tracked(
      { dev1: { ...dev1, password: "SYS" } },
      {},
      { ...userOnly, workspaceValue: { dev1: {} } },
    );
    const [planned] = await provider.providePlannedDefinitions();
    expect(planned!.env).toEqual({});
    warnings.length = 0;
    expect(await provider.resolveEnvForLabel(planned!.label)).toBeUndefined();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("is defined or overridden in this workspace's settings");
    expect(calls.getServerSpec).toEqual([]);
    expect(calls.getSession).toEqual([]);
  });
});

describe("Story 44.6 AC-10: a connection that cannot be known without a session keeps today's empty env", () => {
  it("combineProfiles: every provided definition has env {}, still returned, no warning, no spec lookup", async () => {
    const { provider, calls, warnings } = tracked(
      { a: specFor("a"), b: specFor("b") },
      { combineProfiles: true },
    );
    const planned = await provider.providePlannedDefinitions();
    expect(planned).toHaveLength(1);
    expect(planned[0]!.env).toEqual({});
    expect(warnings).toEqual([]);
    expect(calls.getServerSpec).toEqual([]);
  });

  const throwingSpec = (): Promise<ServerSpec | undefined> => Promise.reject(new Error("settings unreadable"));
  const noWebServer = { name: "a", username: "svc" } as unknown as ServerSpec;
  const hostileSpec = (): Promise<ServerSpec | undefined> =>
    Promise.resolve(
      Object.defineProperty({ name: "a", username: "svc" }, "webServer", {
        get() {
          throw new Error("hostile getter");
        },
      }) as unknown as ServerSpec,
    );

  it.each([
    ["getServerSpec rejects", throwingSpec],
    ["getServerSpec returns undefined", undefined],
    ["the spec has no webServer", noWebServer],
    ["the spec cannot be read", hostileSpec],
    ["the username is empty", { ...specFor("a", "SYS"), username: "" }],
    ["the username is blank", { ...specFor("a", "SYS"), username: "   " }],
    ["the username is missing", { name: "a", webServer: { host: "a.example.com", port: 52773, scheme: "http" } }],
  ])("%s: env is {} and the definition is still provided, with no warning", async (_label, spec) => {
    const { provider, warnings } = tracked({ a: spec as ServerSpec | (() => Promise<ServerSpec | undefined>) | undefined });
    const planned = await provider.providePlannedDefinitions();
    expect(planned).toHaveLength(1);
    expect(planned[0]!.env).toEqual({});
    expect(warnings).toEqual([]);
  });

  it.each([
    ["a newline", "dev\n1"],
    ["a carriage return", "dev1\r"],
    ["a tab", "de\tv"],
    ["a NUL", "dev\u00001"],
    ["a DEL", "dev\u007f1"],
    ["a C1 control (NEL)", "dev\u00851"],
  ])("a server whose name holds %s is provided with env {} (the credential name would be refused by the server)", async (_label, name) => {
    const { provider } = tracked({ [name]: specFor("bad") });
    const [planned] = await provider.providePlannedDefinitions();
    expect(planned!.env).toEqual({});
  });
});

describe("Story 44.6 AC-11: the Local resolve path is exactly today's", () => {
  // Captured by running the pre-story code (baseline 374477bd, `serverDefinitionProvider.ts` + `env.ts` of that commit)
  // over this fixture: a single server `a` (a.example.com:52773, http, user _SYSTEM, inline password SYS), default settings.
  // Capture command: `git archive 374477bd extensions/iris-mcp-launcher | tar -x -C <scratch>`, node_modules symlinked,
  // then this test's provide-then-resolve over the baseline source.
  const LOCAL_ENV_CAPTURE = {
    IRIS_HOST: "a.example.com",
    IRIS_PORT: "52773",
    IRIS_HTTPS: "false",
    IRIS_USERNAME: "_SYSTEM",
    IRIS_PASSWORD: "SYS",
    IRIS_NAMESPACE: "HSCUSTOM",
    IRIS_PROFILES: null,
    IRIS_GOVERNANCE: null,
    IRIS_GOVERNANCE_PRESET: null,
    IRIS_GOVERNANCE_FILE: null,
    IRIS_AUDIT_LOG: null,
    IRIS_AUDIT_LOG_MAX_MB: null,
    IRIS_AUDIT_LOG_PARAMS: null,
    IRIS_TOOLS_PRESET: null,
    IRIS_TOOLS_DISABLE: null,
    IRIS_TOOLS_ENABLE: null,
    IRIS_SERVER_MANAGER: null,
    IRIS_SM_SERVERS: null,
    IRIS_SM_SETTINGS_PATHS: null,
    IRIS_SM_WORKSPACE: null,
    IRIS_CREDENTIAL_HELPER: null,
    MCP_TRANSPORT: null,
  };

  it("resolving a definition whose provided env is now non-empty returns the captured Local env: null clears, the real password, no credential name", async () => {
    const { provider, calls } = tracked({ a: specFor("a", "SYS") });
    const [planned] = await provider.providePlannedDefinitions();
    expect(Object.keys(planned!.env).length).toBeGreaterThan(0);

    const env = await provider.resolveEnvForLabel(planned!.label);

    expect(env).toEqual(LOCAL_ENV_CAPTURE);
    expect(calls.getSession).toEqual([]);
  });

  it("prompts and cancellation are unchanged: provide never prompts, resolve asks silently then with createIfNone, and a refusal yields one warning and no env", async () => {
    const passwordless: ServerSpec = specFor("a");
    const { provider, calls, warnings } = tracked({ a: passwordless });
    const [planned] = await provider.providePlannedDefinitions();
    expect(calls.getSession).toEqual([]);

    await provider.resolveEnvForLabel(planned!.label);
    expect(calls.getSession.map((options) => ({ silent: options.silent, createIfNone: options.createIfNone }))).toEqual([
      { silent: true, createIfNone: undefined },
    ]);

    // A rejecting prompt is the real cancel path: a first-class outcome, one warning, no env.
    const refusedAsks: GetSessionOptions[] = [];
    const refusing = new LauncherProvider({
      getServerManagerApi: async () => ({
        getServerNames: () => [{ name: "a", description: "", detail: "" }],
        getServerSpec: async () => passwordless,
        getAccount: () => undefined,
      }),
      authApi: {
        getSession: async (_providerId, _scopes, options) => {
          refusedAsks.push(options);
          if (options.createIfNone === true) throw new Error("declined");
          return undefined;
        },
      },
      getSettings: () => settings({ servers: ["a"] }),
      showWarning: (message: string) => warnings.push(message),
      inspectServerManagerServers: () => userScopeServers(["a"]),
    });
    const [refusedPlan] = await refusing.providePlannedDefinitions();
    warnings.length = 0;
    expect(await refusing.resolveEnvForLabel(refusedPlan!.label)).toBeUndefined();
    expect(refusedAsks.map((options) => ({ silent: options.silent, createIfNone: options.createIfNone }))).toEqual([
      { silent: true, createIfNone: undefined },
      { silent: undefined, createIfNone: true },
    ]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('credentials for IRIS server "a" were not provided');
  });
});
