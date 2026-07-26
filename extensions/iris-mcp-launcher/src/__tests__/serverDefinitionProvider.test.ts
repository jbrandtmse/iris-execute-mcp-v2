import { describe, expect, it, vi } from "vitest";
import { LauncherProvider, type ProviderDeps } from "../serverDefinitionProvider.js";
import type {
  AuthApi,
  GetSessionOptions,
  LauncherSettings,
  ServerManagerApi,
  ServerSpec,
} from "../types.js";

function settings(overrides: Partial<LauncherSettings> = {}): LauncherSettings {
  return {
    servers: [],
    packages: ["dev"],
    namespace: "HSCUSTOM",
    combineProfiles: false,
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
