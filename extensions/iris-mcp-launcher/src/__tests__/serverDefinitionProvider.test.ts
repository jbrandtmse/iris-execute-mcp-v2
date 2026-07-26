import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LauncherProvider, type ProviderDeps } from "../serverDefinitionProvider.js";
import type {
  AuthApi,
  GetSessionOptions,
  LauncherSettings,
  ServerManagerApi,
  ServerSpec,
} from "../types.js";

// `node:fs`'s built-in module namespace object cannot be spied on directly
// (`vi.spyOn(fs, "statSync")` throws "Cannot redefine property" — its
// properties are non-configurable). `vi.mock` with an `importOriginal`
// passthrough replaces the module's exports with a real, spyable `vi.fn()`
// wrapper instead, scoped to THIS test file only — `definitions.test.ts` and
// every other file's own `node:fs` usage (readdirSync, etc.) is unaffected.
// `statSync`/`existsSync` are the only exports wrapped (both are used by
// `isExistingDirectory`/`isExistingFile` in `serverDefinitionProvider.ts`);
// everything else (including the `mkdtempSync`/`mkdirSync`/`rmSync`/
// `writeFileSync` this file's own fixture helpers use below) passes through
// to the real implementation. Both wrappers default to calling the real
// function, so every test that doesn't explicitly override them (the vast
// majority) is unaffected.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, statSync: vi.fn(actual.statSync), existsSync: vi.fn(actual.existsSync) };
});
import * as fs from "node:fs";

/**
 * Restore BOTH `node:fs` wrappers to real behavior after every test.
 *
 * `mockClear()` is not enough: it clears call history but leaves an
 * UNCONSUMED `mockImplementationOnce` queued, which would then be consumed by
 * whichever later test makes the next `fs` call — an unrelated `EACCES`/`EIO`
 * failure with a baffling message. Today every queued once-impl happens to be
 * consumed by its own test, but that is an accident of the current control
 * flow (the Story 31.6 review added an `isAbsolute` short-circuit that could
 * easily have broken it).
 *
 * `mockReset()` alone is WORSE in vitest 2.1.9: it drains the queue but also
 * clears the base implementation, so `statSync` starts returning `undefined`
 * and every subsequent test silently sees "path does not exist". Verified
 * during the review — it turned six passing tests red. So: reset to drain,
 * then explicitly reinstate the real implementation.
 */
afterEach(async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  const statMock = vi.mocked(fs.statSync);
  const existsMock = vi.mocked(fs.existsSync);
  statMock.mockReset();
  statMock.mockImplementation(actual.statSync);
  existsMock.mockReset();
  existsMock.mockImplementation(actual.existsSync);
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
  };

  return { deps, warnings };
}

describe("LauncherProvider.providePlannedDefinitions", () => {
  it("builds one npx -y @iris-mcp/<pkg> definition per (package, server)", async () => {
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
      "@iris-mcp/admin",
      "@iris-mcp/admin",
      "@iris-mcp/dev",
      "@iris-mcp/dev",
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
    const provider = new LauncherProvider({
      getServerManagerApi: async () => api,
      authApi: { getSession: async () => undefined },
      getSettings: () => settings({ packages: ["dev"], servers: ["a"] }),
      showWarning: () => undefined,
    });

    const [planned] = await provider.providePlannedDefinitions();
    await provider.resolveEnvForLabel(planned!.label);

    expect(seen).toEqual([scopeToken]);
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

  it("developmentRepoPath unset (default) -> npx args, byte-identical to Story 31.5's spawn shape", async () => {
    const { deps } = makeDeps({ serverNames: ["a"] });
    const provider = new LauncherProvider(deps);

    const planned = await provider.providePlannedDefinitions();

    expect(planned).toEqual([
      { label: "IRIS Dev Tools — a", command: "npx", args: ["-y", "@iris-mcp/dev"] },
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
        command: "node",
        args: [path.join(repoDir, "packages", "iris-dev-mcp", "dist", "index.js")],
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
        command: "node",
        args: [path.join(repoDir, "packages", "iris-dev-mcp", "dist", "index.js")],
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

  it("guards a throwing fs call: statSync throwing (e.g. a permission error on a path existsSync already confirmed) degrades to one warning, never an unhandled exception, and never forwards the raw error text (Task 2's fs-guard requirement)", async () => {
    const repoDir = makeRepoDir();
    buildPackage(repoDir, "iris-dev-mcp");

    const statMock = vi.mocked(fs.statSync);
    statMock.mockImplementationOnce(() => {
      throw new Error("EACCES: permission denied, stat 'secret-detail'");
    });

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

  /**
   * DEFENSE-IN-DEPTH ONLY — deliberately NOT a second independent "guard every
   * fs call" proof. Node's `fs.existsSync` is contractually total: it wraps
   * path validation and the `stat` in its own try/catch and returns `false` on
   * ANY error. Probed on this machine (Node v24.16.0) with a NUL-byte path, a
   * 70 000-char path, `C:\<>|?*`, `""`, and non-string arguments — every case
   * returned `false`, none threw. So the state this test forces is one the
   * real filesystem cannot produce, and `isExistingDirectory`/`isExistingFile`'s
   * try/catch is reachable in production ONLY via `statSync` (EACCES/EPERM/
   * ELOOP/EIO on a path `existsSync` just confirmed) — which the preceding two
   * tests cover for real. Kept because the guard is free and the behavior it
   * pins (fail closed, no raw error text) is identical to the reachable path;
   * recorded as unreachable here so a future reader does not bank it as
   * evidence that a real `existsSync` failure is handled.
   */
  it("if existsSync could throw (it cannot — Node returns false on any error; see the note above), the guard would still degrade to one warning, never an unhandled exception, and never forward the raw error text", async () => {
    const existsMock = vi.mocked(fs.existsSync);
    existsMock.mockImplementationOnce(() => {
      throw new Error("EIO: i/o error, stat 'network-share-detail'");
    });

    {
      const { deps, warnings } = makeDeps({
        serverNames: ["a"],
        getSettings: () =>
          settings({ packages: ["dev"], developmentRepoPath: "\\\\some\\unc\\path" }),
      });
      const provider = new LauncherProvider(deps);

      await expect(provider.providePlannedDefinitions()).resolves.toEqual([]);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).not.toContain("EIO");
      expect(warnings[0]).not.toContain("network-share-detail");
    }
  });

  it("guards a throwing statSync specifically on a PER-PACKAGE dist/index.js check (a distinct code path from the repo-path check above): degrades to one warning naming only the affected package, never a raw error, and the OTHER selected (built, unaffected) package still registers", async () => {
    const repoDir = makeRepoDir();
    buildPackage(repoDir, "iris-dev-mcp");
    buildPackage(repoDir, "iris-admin-mcp");

    const { statSync: realStatSync } = await vi.importActual<typeof import("node:fs")>("node:fs");
    const statMock = vi.mocked(fs.statSync);
    statMock.mockImplementation(((candidate: unknown, options?: unknown) => {
      if (
        typeof candidate === "string" &&
        candidate.includes("iris-dev-mcp") &&
        candidate.endsWith("index.js")
      ) {
        throw new Error("EACCES: permission denied, stat 'dev-dist-detail'");
      }
      return (realStatSync as (...args: unknown[]) => unknown)(candidate, options);
    }) as typeof fs.statSync);

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
          command: "node",
          args: [path.join(repoDir, "packages", "iris-admin-mcp", "dist", "index.js")],
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
        command: "node",
        args: [path.join(repoDir, "packages", "iris-dev-mcp", "dist", "index.js")],
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
        fs.existsSync(path.join(relativeButReal, "packages", "iris-dev-mcp", "dist", "index.js")),
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
        command: "node",
        args: [path.join(repoDir, "packages", "iris-admin-mcp", "dist", "index.js")],
      },
      {
        label: "IRIS Dev Tools (a, b)",
        command: "node",
        args: [path.join(repoDir, "packages", "iris-dev-mcp", "dist", "index.js")],
      },
    ]);

    // The definitions are still resolvable to a real multi-profile env.
    const env = await provider.resolveEnvForLabel("IRIS Dev Tools (a, b)");
    expect(Object.keys(JSON.parse(env!.IRIS_PROFILES as string)).sort()).toEqual(["a", "b"]);
  });

  it("a UNC-style developmentRepoPath (\\\\server\\share\\repo) that does not resolve is treated exactly like any other missing path — fails closed with one warning, no special-casing, and (via a mocked existsSync) no real network filesystem call is made", async () => {
    const uncPath = "\\\\nonexistent-host-31-6\\share\\repo";
    const existsMock = vi.mocked(fs.existsSync);
    existsMock.mockImplementationOnce(() => false);

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
      { label: "IRIS Dev Tools — a", command: "npx", args: ["-y", "@iris-mcp/dev"] },
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
describe("Rule #19 whole-object back-compat — developmentRepoPath unset is byte-identical to Story 31.5 (AC 31.6.6)", () => {
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
    });

    const planned = await provider.providePlannedDefinitions();

    // Whole-array, whole-object: every field of every planned definition,
    // not a subset.
    expect(planned).toEqual([
      {
        label: "IRIS Dev Tools (prod, staging)",
        command: "npx",
        args: ["-y", "@iris-mcp/dev"],
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
    });

    const [planned] = await provider.providePlannedDefinitions();
    const env = await provider.resolveEnvForLabel(planned!.label);

    expect(Object.keys(env ?? {}).sort()).toEqual(allOwnedKeys);
  });
});
