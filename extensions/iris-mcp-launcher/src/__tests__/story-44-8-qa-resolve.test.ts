/**
 * Story 44.8 (DW-752) QA: gaps left by `dw752LocalResolve.test.ts` and the changed Story 44.8 pins, filled WITHOUT
 * repeating them. Drives the real `LauncherProvider` over the Rule #54 fakes in `serverManagerInspection.ts` (Server
 * Manager 3.16.0 keying, VS Code 1.147.0 deep merge, `inspect` per `@types/vscode` 1.125.0; sources in that file's
 * header). Every `ConfigScope` below is a `vscode.WorkspaceFolder` shape (`uri`, `name`, `index`), the only scope object
 * `getConfiguration(section, scope)` receives from Server Manager's `getServerNames`.
 *
 * Covered here (each block names the AC it guards):
 * - a multi-server plan whose later server is refused: nothing prompts, the FIRST refused server in plan order is named
 *   whatever the kind of refusal, and each server is inspected in the scope it was enumerated in (multi-root);
 * - the layer table: every workspace-class layer x every kind of entry (host, empty object, null, username only with the
 *   attacker's username holding a stored password), a default-only server (user class) with and without a workspace
 *   override, and user-class language layers that must NOT refuse;
 * - no stale verdict: the guard re-reads settings on every call, and parallel resolves of one refused server each warn
 *   once and call nothing;
 * - a server no settings layer defines any more gets the no-such-server warning, not the workspace one (a non-object
 *   workspace layer still gets the workspace one), with nothing called;
 * - the clean-path back-compat pins (Rule #19) on BOTH paths, as full-object `toEqual`s whose literals were captured by
 *   running the PRE-CHANGE provider (`git show ebf1e703:.../serverDefinitionProvider.ts`) on the same fixture (Rule #36).
 */
import { describe, expect, it } from "vitest";
import {
  layeredServers,
  mergedSpec,
  newServerManagerCalls,
  sessionStoreAuthApi,
  type ServerManagerCalls,
} from "./serverManagerInspection.js";
import { LauncherProvider, type ProviderDeps } from "../serverDefinitionProvider.js";
import type { ConfigScope, LauncherSettings, ServerManagerApi, ServerManagerServersInspection, ServerSpec } from "../types.js";

const USERNAME = "svc44";
const ATTACKER_USERNAME = "attacker44";
const STORED_PASSWORD = "qa-users-stored-password";
const INLINE_PASSWORD = "qa-users-inline-password";

const userDev1 = {
  webServer: { scheme: "https", host: "user-iris.corp.example", port: 443 },
  username: USERNAME,
};
const workspaceHostOverride = { webServer: { scheme: "http", host: "127.0.0.1", port: 52799 } };

/** A `vscode.WorkspaceFolder` (`uri`, `name`, `index`), the only scope object Server Manager enumerates servers in. */
function folder(name: string, index: number): ConfigScope {
  return { uri: { scheme: "file", path: `/work/${name}`, fsPath: `/work/${name}` }, name, index };
}

function settings(overrides: Partial<LauncherSettings> = {}): LauncherSettings {
  return {
    servers: ["dev1"],
    packages: ["dev"],
    namespace: "USER",
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

/**
 * The Local resolve env of `userDev1` with a stored session, and the Copilot-harness provided env of the same fixture.
 * Captured (Rule #36) by running the PRE-CHANGE `serverDefinitionProvider.ts` (`git show ebf1e703:...`) on exactly this
 * fixture; a user-only server must keep producing these byte for byte.
 */
const EXPECTED_STORED_SESSION_ENV: Record<string, string | null> = {
  IRIS_AUDIT_LOG: null,
  IRIS_AUDIT_LOG_MAX_MB: null,
  IRIS_AUDIT_LOG_PARAMS: null,
  IRIS_CREDENTIAL_HELPER: null,
  IRIS_GOVERNANCE: null,
  IRIS_GOVERNANCE_FILE: null,
  IRIS_GOVERNANCE_PRESET: null,
  IRIS_HOST: "user-iris.corp.example",
  IRIS_HTTPS: "true",
  IRIS_NAMESPACE: "USER",
  IRIS_PASSWORD: STORED_PASSWORD,
  IRIS_PORT: "443",
  IRIS_PROFILES: null,
  IRIS_SERVER_MANAGER: null,
  IRIS_SM_SERVERS: null,
  IRIS_SM_SETTINGS_PATHS: null,
  IRIS_SM_WORKSPACE: null,
  IRIS_TOOLS_DISABLE: null,
  IRIS_TOOLS_ENABLE: null,
  IRIS_TOOLS_PRESET: null,
  IRIS_USERNAME: USERNAME,
  MCP_TRANSPORT: null,
};
const EXPECTED_PROVIDED_ENV: Record<string, string | null> = {
  IRIS_AUDIT_LOG: "",
  IRIS_AUDIT_LOG_MAX_MB: null,
  IRIS_AUDIT_LOG_PARAMS: "",
  IRIS_CREDENTIAL_HELPER: "",
  IRIS_CREDENTIAL_NAME: "dev1",
  IRIS_GOVERNANCE: "",
  IRIS_GOVERNANCE_FILE: "",
  IRIS_GOVERNANCE_PRESET: "",
  IRIS_HOST: "user-iris.corp.example",
  IRIS_HTTPS: "true",
  IRIS_NAMESPACE: "USER",
  IRIS_PASSWORD: "",
  IRIS_PORT: "443",
  IRIS_PROFILES: "",
  IRIS_SERVER_MANAGER: "",
  IRIS_SM_SERVERS: "",
  IRIS_SM_SETTINGS_PATHS: "",
  IRIS_SM_WORKSPACE: "",
  IRIS_TOOLS_DISABLE: "",
  IRIS_TOOLS_ENABLE: "",
  IRIS_TOOLS_PRESET: "",
  IRIS_USERNAME: USERNAME,
  MCP_TRANSPORT: "",
};

/** The account hint Server Manager's `getAccount` returns for `dev1`, passed to every silent lookup. */
const DEV1_ACCOUNT = { id: `dev1/${USERNAME}`, label: `${USERNAME} on dev1` };

const notUserText = (label: string, server: string): string =>
  `IRIS MCP Launcher: "${label}" was not started — IRIS server "${server}" is defined or overridden in this ` +
  `workspace's settings (an intersystems.servers entry in a workspace, folder or language-specific settings layer), ` +
  `so its stored password was not used: a workspace must not choose where that password is sent. Define the server ` +
  `in your user settings under a name no workspace settings use, and select that name in irisMcpLauncher.servers.`;

const uninspectableText = (label: string, server: string): string =>
  `IRIS MCP Launcher: "${label}" was not started — the intersystems.servers settings that define IRIS server ` +
  `"${server}" could not be inspected, so its stored password was not used. Try reloading the window.`;

/** A mutable world: the layers each scope sees, the scope each server name is enumerated in, and what was called. */
interface World {
  /** What `getConfiguration("intersystems", scope).inspect("servers")` returns, per scope (`undefined` scope included). */
  layersFor: (scope: ConfigScope | undefined) => ServerManagerServersInspection;
  scopeOf: Record<string, ConfigScope | undefined>;
  stored: Record<string, string>;
  calls: ServerManagerCalls;
  warnings: string[];
  provider: LauncherProvider;
}

interface WorldOptions {
  layers?: ServerManagerServersInspection;
  layersFor?: (scope: ConfigScope | undefined) => ServerManagerServersInspection;
  scopeOf?: Record<string, ConfigScope | undefined>;
  stored?: Record<string, string>;
  settings?: Partial<LauncherSettings>;
  inspect?: (scope: ConfigScope | undefined) => unknown;
}

function newWorld(options: WorldOptions): World {
  const calls = newServerManagerCalls();
  const warnings: string[] = [];
  const world = { calls, warnings, scopeOf: options.scopeOf ?? {}, stored: options.stored ?? {} } as World;
  world.layersFor = options.layersFor ?? (() => options.layers ?? {});
  const api: ServerManagerApi = {
    getServerNames: () => {
      const names = new Set<string>();
      for (const scopeKey of [undefined, ...Object.values(world.scopeOf)]) {
        for (const value of Object.values(world.layersFor(scopeKey))) {
          if (typeof value === "object" && value !== null) for (const name of Object.keys(value)) names.add(name);
        }
      }
      return [...names].map((name) => {
        const scope = world.scopeOf[name];
        return { name, description: "", detail: "", ...(scope !== undefined ? { scope } : {}) };
      });
    },
    getServerSpec: async (name: string, scope?: ConfigScope): Promise<ServerSpec | undefined> => {
      calls.getServerSpec.push({ name, scope });
      return mergedSpec(world.layersFor(scope), name);
    },
    getAccount: (spec: ServerSpec) => {
      calls.getAccount++;
      return { id: `${spec.name}/${spec.username ?? ""}`, label: `${spec.username ?? ""} on ${spec.name}` };
    },
  };
  const deps: ProviderDeps = {
    getServerManagerApi: async () => api,
    authApi: sessionStoreAuthApi(world.stored, calls),
    getSettings: () => settings(options.settings),
    showWarning: (message: string) => warnings.push(message),
    inspectServerManagerServers: (scope) => {
      calls.inspect.push(scope);
      return (options.inspect !== undefined ? options.inspect(scope) : world.layersFor(scope)) as ServerManagerServersInspection | undefined;
    },
  };
  world.provider = new LauncherProvider(deps);
  return world;
}

/** Provide (so the plans exist), forget what that touched, and return the planned labels. */
async function provideAndReset(world: World): Promise<string[]> {
  const planned = await world.provider.providePlannedDefinitions();
  world.warnings.length = 0;
  world.calls.getServerSpec.length = 0;
  world.calls.getSession.length = 0;
  world.calls.getAccount = 0;
  world.calls.inspect.length = 0;
  return planned.map((definition) => definition.label);
}

function expectNothingCalled(calls: ServerManagerCalls): void {
  expect(calls.getServerSpec).toEqual([]);
  expect(calls.getAccount).toBe(0);
  expect(calls.getSession).toEqual([]);
}

describe("Story 44.8 QA / AC-2: a multi-server plan whose later server is refused", () => {
  const combined: Partial<LauncherSettings> = { servers: ["a", "b", "c"], combineProfiles: true };

  it("the first server would PROMPT (no stored password) and the second is refused: nothing prompts, b is named", async () => {
    const world = newWorld({
      layers: layeredServers({ globalValue: { a: userDev1, b: userDev1 }, workspaceValue: { b: workspaceHostOverride } }),
      settings: { servers: ["a", "b"], combineProfiles: true },
      stored: {},
    });
    const [label] = await provideAndReset(world);

    expect(await world.provider.resolveEnvForLabel(label!)).toBeUndefined();

    expect(world.warnings).toEqual([notUserText(label!, "b")]);
    // `a` has no stored password: resolving it first would have called getSession({createIfNone: true}), a modal prompt.
    expect(world.calls.getSession.filter((call) => call.options.createIfNone === true)).toEqual([]);
    expectNothingCalled(world.calls);
  });

  it("the second server's settings cannot be inspected (its scope throws): one uninspectable warning naming it, nothing called", async () => {
    const scopeA = folder("a", 0);
    const scopeB = folder("b", 1);
    const world = newWorld({
      layers: layeredServers({ globalValue: { a: userDev1, b: userDev1, c: userDev1 } }),
      scopeOf: { a: scopeA, b: scopeB, c: scopeA },
      settings: combined,
      stored: { [`a/${USERNAME}`]: "pw-a" },
      inspect: (scope) => {
        if (scope === scopeB) throw new Error("configuration unavailable");
        return layeredServers({ globalValue: { a: userDev1, b: userDev1, c: userDev1 } });
      },
    });
    const [label] = await provideAndReset(world);

    expect(await world.provider.resolveEnvForLabel(label!)).toBeUndefined();

    expect(world.warnings).toEqual([uninspectableText(label!, "b")]);
    expectNothingCalled(world.calls);
  });

  it("plan order, not severity, picks the server named: an uninspectable first server beats a not-user second one", async () => {
    const scopeA = folder("a", 0);
    const scopeB = folder("b", 1);
    const layers = layeredServers({ globalValue: { a: userDev1, b: userDev1 }, workspaceValue: { b: workspaceHostOverride } });
    const world = newWorld({
      layers,
      scopeOf: { a: scopeA, b: scopeB },
      settings: { servers: ["a", "b"], combineProfiles: true },
      inspect: (scope) => {
        if (scope === scopeA) return undefined;
        return layers;
      },
    });
    const [label] = await provideAndReset(world);

    expect(await world.provider.resolveEnvForLabel(label!)).toBeUndefined();

    expect(world.warnings).toEqual([uninspectableText(label!, "a")]);
    expectNothingCalled(world.calls);
  });

  it("multi-root: each server is inspected in the scope it was enumerated in, in plan order, and a folder-scope override on the second refuses the plan", async () => {
    const scopeA = folder("a", 0);
    const scopeB = folder("b", 1);
    const clean = layeredServers({ globalValue: { a: userDev1, b: userDev1 } });
    const folderBOverrides = layeredServers({
      globalValue: { a: userDev1, b: userDev1 },
      workspaceFolderValue: { b: workspaceHostOverride },
    });
    const world = newWorld({
      layersFor: (scope) => (scope === scopeB ? folderBOverrides : clean),
      scopeOf: { a: scopeA, b: scopeB },
      settings: { servers: ["a", "b"], combineProfiles: true },
      stored: { [`a/${USERNAME}`]: "pw-a", [`b/${USERNAME}`]: "pw-b" },
    });
    const [label] = await provideAndReset(world);

    expect(await world.provider.resolveEnvForLabel(label!)).toBeUndefined();

    expect(world.calls.inspect).toEqual([scopeA, scopeB]);
    expect(world.warnings).toEqual([notUserText(label!, "b")]);
    expectNothingCalled(world.calls);
  });

  it("control: the same multi-root plan with folder B clean resolves both servers, each spec read in its own scope", async () => {
    const scopeA = folder("a", 0);
    const scopeB = folder("b", 1);
    const clean = layeredServers({ globalValue: { a: userDev1, b: userDev1 } });
    const world = newWorld({
      layersFor: () => clean,
      scopeOf: { a: scopeA, b: scopeB },
      settings: { servers: ["a", "b"], combineProfiles: true },
      stored: { [`a/${USERNAME}`]: "pw-a", [`b/${USERNAME}`]: "pw-b" },
    });
    const [label] = await provideAndReset(world);

    const env = await world.provider.resolveEnvForLabel(label!);

    expect(JSON.parse(String(env?.["IRIS_PROFILES"]))).toMatchObject({ a: { password: "pw-a" }, b: { password: "pw-b" } });
    expect(world.calls.getServerSpec.map((call) => call.scope)).toEqual([scopeA, scopeB]);
    expect(world.warnings).toEqual([]);
  });
});

describe("Story 44.8 QA / AC-2: the layer table", () => {
  const user = { globalValue: { dev1: userDev1 } };
  const bothStored = { [`dev1/${USERNAME}`]: STORED_PASSWORD, [`dev1/${ATTACKER_USERNAME}`]: "attackers-own-stored-password" };
  const workspaceLayers = ["workspaceValue", "workspaceFolderValue", "workspaceLanguageValue", "workspaceFolderLanguageValue"] as const;
  const entries: Array<[string, unknown]> = [
    ["a host override", { webServer: { host: "127.0.0.1" } }],
    ["an empty object", {}],
    ["null", null],
    ["only a username (which has its own stored password)", { username: ATTACKER_USERNAME }],
    ["only a password", { password: "attacker-chosen" }],
  ];

  describe.each(workspaceLayers)("the %s layer", (layer) => {
    it.each(entries)("defining dev1 as %s refuses it: undefined, the not-user warning, nothing called", async (_name, entry) => {
      const world = newWorld({ layers: layeredServers({ ...user, [layer]: { dev1: entry } }), stored: bothStored });
      const [label] = await provideAndReset(world);

      expect(await world.provider.resolveEnvForLabel(label!)).toBeUndefined();

      expect(world.warnings).toEqual([notUserText(label!, "dev1")]);
      expectNothingCalled(world.calls);
    });

    it("defining only OTHER servers leaves dev1 resolving with the stored password", async () => {
      const world = newWorld({ layers: layeredServers({ ...user, [layer]: { other: workspaceHostOverride } }), stored: bothStored });
      const [label] = await provideAndReset(world);

      expect((await world.provider.resolveEnvForLabel(label!))?.["IRIS_PASSWORD"]).toBe(STORED_PASSWORD);
      expect(world.warnings).toEqual([]);
    });
  });

  it("a server defined only by Server Manager's default value, overridden by a workspace layer, is refused (the default is user class, the override is not)", async () => {
    const world = newWorld({
      layers: layeredServers({ defaultValue: { dev1: userDev1 }, workspaceValue: { dev1: workspaceHostOverride } }),
      stored: bothStored,
    });
    const [label] = await provideAndReset(world);

    expect(await world.provider.resolveEnvForLabel(label!)).toBeUndefined();

    expect(world.warnings).toEqual([notUserText(label!, "dev1")]);
    expectNothingCalled(world.calls);
  });

  it("a server defined by BOTH the default and the user layer counts as user: one silent getSession, no warning", async () => {
    const world = newWorld({
      layers: layeredServers({ defaultValue: { dev1: userDev1 }, globalValue: { dev1: { ...userDev1, description: "mine" } } }),
      stored: bothStored,
    });
    const [label] = await provideAndReset(world);

    expect((await world.provider.resolveEnvForLabel(label!))?.["IRIS_PASSWORD"]).toBe(STORED_PASSWORD);
    expect(world.calls.getSession.map((call) => call.options)).toEqual([{ silent: true, account: DEV1_ACCOUNT }]);
    expect(world.warnings).toEqual([]);
  });

  it.each([["globalLanguageValue"], ["defaultLanguageValue"]] as const)(
    "a %s override of a user server is the user's own choice, not a workspace's: it still resolves",
    async (layer) => {
      const world = newWorld({
        layers: layeredServers({ ...user, [layer]: { dev1: { description: "language-specific note" } } }),
        stored: bothStored,
      });
      const [label] = await provideAndReset(world);

      expect((await world.provider.resolveEnvForLabel(label!))?.["IRIS_PASSWORD"]).toBe(STORED_PASSWORD);
      expect(world.warnings).toEqual([]);
    },
  );
});

describe("Story 44.8 QA / AC-2: no stale verdict, one warning per refused call", () => {
  it("settings are re-read on every call: a workspace override added after a clean resolve refuses the next one", async () => {
    const clean = layeredServers({ globalValue: { dev1: userDev1 } });
    const overridden = layeredServers({ globalValue: { dev1: userDev1 }, workspaceValue: { dev1: workspaceHostOverride } });
    let current = clean;
    const world = newWorld({ layersFor: () => current, stored: { [`dev1/${USERNAME}`]: STORED_PASSWORD } });
    const [label] = await provideAndReset(world);

    expect((await world.provider.resolveEnvForLabel(label!))?.["IRIS_PASSWORD"]).toBe(STORED_PASSWORD);
    expect(world.calls.getSession).toHaveLength(1);

    current = overridden;
    expect(await world.provider.resolveEnvForLabel(label!)).toBeUndefined();
    expect(world.warnings).toEqual([notUserText(label!, "dev1")]);
    expect(world.calls.getSession, "the refused call added no getSession").toHaveLength(1);
  });

  it("and the reverse: removing the override lets the next resolve through", async () => {
    const clean = layeredServers({ globalValue: { dev1: userDev1 } });
    const overridden = layeredServers({ globalValue: { dev1: userDev1 }, workspaceValue: { dev1: workspaceHostOverride } });
    let current = overridden;
    const world = newWorld({ layersFor: () => current, stored: { [`dev1/${USERNAME}`]: STORED_PASSWORD } });
    const [label] = await provideAndReset(world);

    expect(await world.provider.resolveEnvForLabel(label!)).toBeUndefined();
    current = clean;
    expect((await world.provider.resolveEnvForLabel(label!))?.["IRIS_PASSWORD"]).toBe(STORED_PASSWORD);
    expect(world.warnings).toHaveLength(1);
  });

  it("VS Code resolves several packages' definitions of one refused server in parallel: each warns exactly once and nothing is called", async () => {
    const world = newWorld({
      layers: layeredServers({ globalValue: { dev1: userDev1 }, workspaceValue: { dev1: workspaceHostOverride } }),
      settings: { packages: ["dev", "data", "ops"] },
      stored: { [`dev1/${USERNAME}`]: STORED_PASSWORD },
    });
    const labels = await provideAndReset(world);
    expect(labels).toHaveLength(3);

    const results = await Promise.all(labels.map((label) => world.provider.resolveEnvForLabel(label)));

    expect(results).toEqual([undefined, undefined, undefined]);
    expect([...world.warnings].sort()).toEqual(labels.map((label) => notUserText(label, "dev1")).sort());
    expectNothingCalled(world.calls);
  });
});

describe("Story 44.8 QA / AC-5 (Rule #19): the clean path for a user-only server is byte-identical to the pre-change provider", () => {
  /** The silent lookup `resolveServerCredentials` makes, the only Server Manager credential call for a stored password. */
  const SILENT_LOOKUP = [{ scopes: ["dev1", USERNAME], options: { silent: true, account: DEV1_ACCOUNT } }];

  it("Local path, stored session: the whole env and the whole call sequence", async () => {
    const world = newWorld({ layers: layeredServers({ globalValue: { dev1: userDev1 } }), stored: { [`dev1/${USERNAME}`]: STORED_PASSWORD } });
    const [label] = await provideAndReset(world);

    const env = await world.provider.resolveEnvForLabel(label!);

    expect(env).toEqual(EXPECTED_STORED_SESSION_ENV);
    expect(world.calls.getSession).toEqual(SILENT_LOOKUP);
    expect(world.calls.getServerSpec).toEqual([{ name: "dev1", scope: undefined }]);
    expect(world.warnings).toEqual([]);
  });

  it("Local path, inline user password: the whole env, no session call", async () => {
    const world = newWorld({ layers: layeredServers({ globalValue: { dev1: { ...userDev1, password: INLINE_PASSWORD } } }) });
    const [label] = await provideAndReset(world);

    const env = await world.provider.resolveEnvForLabel(label!);

    expect(env).toEqual({ ...EXPECTED_STORED_SESSION_ENV, IRIS_PASSWORD: INLINE_PASSWORD });
    expect(world.calls.getSession).toEqual([]);
    expect(world.warnings).toEqual([]);
  });

  it("Local path, combined user-only plan: the whole IRIS_PROFILES document and the per-server silent lookups in plan order", async () => {
    const world = newWorld({
      layers: layeredServers({ globalValue: { a: userDev1, b: userDev1 } }),
      settings: { servers: ["a", "b"], combineProfiles: true },
      stored: { [`a/${USERNAME}`]: "pw-a", [`b/${USERNAME}`]: "pw-b" },
    });
    const [label] = await provideAndReset(world);

    const env = await world.provider.resolveEnvForLabel(label!);

    expect(JSON.parse(String(env?.["IRIS_PROFILES"]))).toEqual({
      a: { host: "user-iris.corp.example", port: 443, https: true, username: USERNAME, password: "pw-a", namespace: "USER" },
      b: { host: "user-iris.corp.example", port: 443, https: true, username: USERNAME, password: "pw-b", namespace: "USER" },
    });
    expect(world.calls.getSession.map((call) => call.scopes)).toEqual([["a", USERNAME], ["b", USERNAME]]);
    expect(world.warnings).toEqual([]);
  });

  it("Provide path (Copilot harness): a user-only server's whole provided env, with no credential call and no warning", async () => {
    const world = newWorld({ layers: layeredServers({ globalValue: { dev1: userDev1 } }), stored: { [`dev1/${USERNAME}`]: STORED_PASSWORD } });

    const planned = await world.provider.providePlannedDefinitions();

    expect(planned).toHaveLength(1);
    expect(planned[0]!.env).toEqual(EXPECTED_PROVIDED_ENV);
    expect(JSON.stringify(planned[0]!.env)).not.toContain(STORED_PASSWORD);
    expect(world.calls.getSession).toEqual([]);
    expect(world.calls.getAccount).toBe(0);
    expect(world.warnings).toEqual([]);
  });

  it("Provide path: a refused server is still provided with an empty env, silently, and Server Manager's spec is never read for it", async () => {
    const world = newWorld({
      layers: layeredServers({ globalValue: { dev1: userDev1 }, workspaceValue: { dev1: workspaceHostOverride } }),
      stored: { [`dev1/${USERNAME}`]: STORED_PASSWORD },
    });

    const planned = await world.provider.providePlannedDefinitions();

    expect(planned).toHaveLength(1);
    expect(planned[0]!.env).toEqual({});
    expect(world.warnings, "the provide path never warns (the warning is the Local resolve step's)").toEqual([]);
    expect(world.calls.getServerSpec).toEqual([]);
    expectNothingCalled(world.calls);
  });
});

describe("Story 44.8 code review / AC-2: a server no settings layer defines any more", () => {
  const noSuchServerText = (label: string, server: string): string =>
    `IRIS MCP Launcher: "${label}" was not started — Server Manager has no server named "${server}" (it may have ` +
    `been renamed or removed; try reloading the window).`;

  it("removed from user settings after the plan was made: the no-such-server warning (not the workspace one), nothing called", async () => {
    let current = layeredServers({ globalValue: { dev1: userDev1 } });
    const world = newWorld({ layersFor: () => current, stored: { [`dev1/${USERNAME}`]: STORED_PASSWORD } });
    const [label] = await provideAndReset(world);
    current = layeredServers({ globalValue: { other: userDev1 }, workspaceValue: {} });

    expect(await world.provider.resolveEnvForLabel(label!)).toBeUndefined();

    expect(world.warnings).toEqual([noSuchServerText(label!, "dev1")]);
    expectNothingCalled(world.calls);
  });

  it("a workspace layer that is not an object still refuses with the workspace warning (fail safe), even though no layer names the server", async () => {
    let current = layeredServers({ globalValue: { dev1: userDev1 } });
    const world = newWorld({ layersFor: () => current, stored: { [`dev1/${USERNAME}`]: STORED_PASSWORD } });
    const [label] = await provideAndReset(world);
    current = layeredServers({ globalValue: { other: userDev1 }, workspaceValue: "not an object" });

    expect(await world.provider.resolveEnvForLabel(label!)).toBeUndefined();

    expect(world.warnings).toEqual([notUserText(label!, "dev1")]);
    expectNothingCalled(world.calls);
  });

  it("in a combined plan the first refused server is named whatever the refusal: a removed first server beats a workspace-defined second", async () => {
    let current = layeredServers({ globalValue: { a: userDev1, b: userDev1 } });
    const world = newWorld({
      layersFor: () => current,
      settings: { servers: ["a", "b"], combineProfiles: true },
      stored: { [`a/${USERNAME}`]: "pw-a", [`b/${USERNAME}`]: "pw-b" },
    });
    const [label] = await provideAndReset(world);
    current = layeredServers({ globalValue: { b: userDev1 }, workspaceValue: { b: workspaceHostOverride } });

    expect(await world.provider.resolveEnvForLabel(label!)).toBeUndefined();

    expect(world.warnings).toEqual([noSuchServerText(label!, "a")]);
    expectNothingCalled(world.calls);
  });
});
