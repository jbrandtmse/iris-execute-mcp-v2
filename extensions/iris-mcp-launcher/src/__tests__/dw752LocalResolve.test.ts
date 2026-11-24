/**
 * Story 44.8 (DW-752): under VS Code's Local harness the resolver hands a stored password only to a server whose
 * definition comes from user (or default) settings alone.
 *
 * The defect: `resolveEnvForLabel` took host, port, scheme and username from Server Manager's `getServerSpec`, which is
 * VS Code's MERGED `intersystems.servers` view (a workspace, folder or language-specific `settings.json` can override it
 * field by field), and the password from that spec's inline value or from Server Manager's session, which is keyed by
 * server name and username only. So an opened repository overriding a user-defined server's `webServer.host` received the
 * user's stored password. The guard refuses such a server before any credential step: nothing is started, and
 * `getServerSpec`, `getAccount` and `getSession` are never called.
 *
 * Every row drives the real `LauncherProvider` over the fakes in `serverManagerInspection.ts` (Server Manager 3.16.0 keying
 * and VS Code 1.147.0 deep merge; sources in that file's header), asserting the env (or `undefined`), the EXACT warning
 * text, and the call counts. The last block is the wire leg: a fresh built `iris-dev-mcp` spawned the way the Local harness
 * spawns it, against a fake IRIS listener standing for the workspace author's host (needs no IRIS; never the real
 * keychain). Its control shows the listener DOES receive the stored password when the user configured that host, so the
 * guarded assertion can fail.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { skipUnbuilt } from "./builtDist.js";
import { basicAuthorization, createFreshProcessKit, REPO_ROOT, sentAuthorizations, type FreshProcessKit } from "./freshProcessKit.js";
import {
  layeredServers,
  newServerManagerCalls,
  serverManagerOverLayers,
  sessionStoreAuthApi,
  type ServerManagerCalls,
} from "./serverManagerInspection.js";
import { LauncherProvider, type ProviderDeps } from "../serverDefinitionProvider.js";
import type { LauncherSettings, ServerManagerServersInspection } from "../types.js";

const USERNAME = "svc44";
const STORED_PASSWORD = "users-stored-password";
const INLINE_PASSWORD = "users-inline-password";
const STORED = { [`dev1/${USERNAME}`]: STORED_PASSWORD } as const;

/** The user layer of the fixture. */
const userDev1 = {
  webServer: { scheme: "https", host: "user-iris.corp.example", port: 443 },
  username: USERNAME,
};
const workspaceHostOverride = { webServer: { scheme: "http", host: "127.0.0.1", port: 52799 } };

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

/** The `not-user` warning, pinned verbatim from the story's contract (not built from the source's own text). */
function notUserWarning(label: string, server: string): string {
  return (
    `IRIS MCP Launcher: "${label}" was not started — IRIS server "${server}" is defined or overridden in this ` +
    `workspace's settings (an intersystems.servers entry in a workspace, folder or language-specific settings layer), ` +
    `so its stored password was not used: a workspace must not choose where that password is sent. Define the server ` +
    `in your user settings under a name no workspace settings use, and select that name in irisMcpLauncher.servers.`
  );
}

/** The `uninspectable` warning, pinned verbatim. */
function uninspectableWarning(label: string, server: string): string {
  return (
    `IRIS MCP Launcher: "${label}" was not started — the intersystems.servers settings that define IRIS server ` +
    `"${server}" could not be inspected, so its stored password was not used. Try reloading the window.`
  );
}

interface Rig {
  provider: LauncherProvider;
  calls: ServerManagerCalls;
  warnings: string[];
  label: string;
}

/**
 * The real provider over a fake Server Manager and session store built from `layers`, already provided (so the plan for
 * `label` exists). `inspect` overrides what the inspection dependency does (`"absent"` omits it).
 */
async function rig(
  layers: ServerManagerServersInspection,
  options: {
    settings?: Partial<LauncherSettings>;
    stored?: Readonly<Record<string, string>>;
    scope?: unknown;
    inspect?: "absent" | ((scope?: unknown) => unknown);
  } = {},
): Promise<Rig> {
  const calls = newServerManagerCalls();
  const warnings: string[] = [];
  const deps: ProviderDeps = {
    getServerManagerApi: async () => serverManagerOverLayers(layers, calls, options.scope),
    authApi: sessionStoreAuthApi(options.stored ?? STORED, calls),
    getSettings: () => settings(options.settings),
    showWarning: (message: string) => warnings.push(message),
  };
  if (options.inspect !== "absent") {
    const inspect = options.inspect;
    deps.inspectServerManagerServers = (scope) => {
      calls.inspect.push(scope);
      return (inspect === undefined ? layers : inspect(scope)) as ServerManagerServersInspection | undefined;
    };
  }
  const provider = new LauncherProvider(deps);
  const planned = await provider.providePlannedDefinitions();
  expect(planned).toHaveLength(1);
  // Only the resolve call is under test: forget what the provide step touched.
  warnings.length = 0;
  calls.getServerSpec.length = 0;
  calls.getSession.length = 0;
  calls.getAccount = 0;
  calls.inspect.length = 0;
  return { provider, calls, warnings, label: planned[0]!.label };
}

/** "Nothing called": no `getServerSpec`, `getAccount` or `getSession` call. */
function expectNothingCalled(calls: ServerManagerCalls): void {
  expect(calls.getServerSpec).toEqual([]);
  expect(calls.getAccount).toBe(0);
  expect(calls.getSession).toEqual([]);
}

describe("DW-752: user-only servers resolve exactly as before", () => {
  it("a stored session: the user's host, the stored password, one silent getSession, no warning", async () => {
    const { provider, calls, warnings, label } = await rig(layeredServers({ globalValue: { dev1: userDev1 } }));

    const env = await provider.resolveEnvForLabel(label);

    expect(env).toMatchObject({
      IRIS_HOST: "user-iris.corp.example",
      IRIS_PORT: "443",
      IRIS_HTTPS: "true",
      IRIS_USERNAME: USERNAME,
      IRIS_PASSWORD: STORED_PASSWORD,
      IRIS_NAMESPACE: "USER",
      IRIS_PROFILES: null,
    });
    expect(calls.getSession.map(({ scopes, options }) => ({ scopes, silent: options.silent, createIfNone: options.createIfNone }))).toEqual([
      { scopes: ["dev1", USERNAME], silent: true, createIfNone: undefined },
    ]);
    expect(warnings).toEqual([]);
  });

  it("a server defined by Server Manager's own default value is a user-scope server too", async () => {
    const { provider, label } = await rig(layeredServers({ defaultValue: { dev1: userDev1 } }));
    expect((await provider.resolveEnvForLabel(label))?.["IRIS_PASSWORD"]).toBe(STORED_PASSWORD);
  });

  it("an inline user password: used as is, with no session call", async () => {
    const { provider, calls, warnings, label } = await rig(
      layeredServers({ globalValue: { dev1: { ...userDev1, password: INLINE_PASSWORD } } }),
    );
    expect((await provider.resolveEnvForLabel(label))?.["IRIS_PASSWORD"]).toBe(INLINE_PASSWORD);
    expect(calls.getSession).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it("no stored password and a declined prompt: today's cancellation warning, undefined", async () => {
    const { provider, calls, warnings, label } = await rig(layeredServers({ globalValue: { dev1: userDev1 } }), { stored: {} });
    expect(await provider.resolveEnvForLabel(label)).toBeUndefined();
    expect(warnings).toEqual([`IRIS MCP Launcher: "${label}" was not started — credentials for IRIS server "dev1" were not provided.`]);
    expect(calls.getSession.map(({ options }) => ({ silent: options.silent, createIfNone: options.createIfNone }))).toEqual([
      { silent: true, createIfNone: undefined },
      { silent: undefined, createIfNone: true },
    ]);
  });

  it("a workspace layer that defines only OTHER servers leaves dev1 resolving", async () => {
    const { provider, label } = await rig(layeredServers({ globalValue: { dev1: userDev1 }, workspaceValue: { other: {} } }));
    expect((await provider.resolveEnvForLabel(label))?.["IRIS_PASSWORD"]).toBe(STORED_PASSWORD);
  });
});

describe("DW-752: a server any workspace-scope layer defines is refused before any credential step", () => {
  const user = { globalValue: { dev1: userDev1 } };

  it("the workspace overrides the host: undefined, the not-user warning, nothing called (the user's stored password stays put)", async () => {
    const { provider, calls, warnings, label } = await rig(
      layeredServers({ ...user, workspaceValue: { dev1: workspaceHostOverride } }),
    );

    expect(await provider.resolveEnvForLabel(label)).toBeUndefined();

    expect(warnings).toEqual([notUserWarning(label, "dev1")]);
    expectNothingCalled(calls);
    expect(warnings.join("\n")).not.toContain(STORED_PASSWORD);
  });

  it("the user layer carries an inline password and the workspace overrides only the host: refused, nothing called", async () => {
    const { provider, calls, warnings, label } = await rig(
      layeredServers({
        globalValue: { dev1: { ...userDev1, password: INLINE_PASSWORD } },
        workspaceValue: { dev1: { webServer: { host: "127.0.0.1" } } },
      }),
    );

    expect(await provider.resolveEnvForLabel(label)).toBeUndefined();

    expect(warnings).toEqual([notUserWarning(label, "dev1")]);
    expectNothingCalled(calls);
    expect(warnings.join("\n")).not.toContain(INLINE_PASSWORD);
  });

  it.each([
    ["workspaceFolderValue", { webServer: { port: 52799 } }],
    ["workspaceLanguageValue", { webServer: { scheme: "http" } }],
    ["workspaceFolderLanguageValue", { username: "someone-else" }],
    ["workspaceValue", { webServer: { port: 52799 } }],
    ["workspaceValue", { webServer: { scheme: "http" } }],
    ["workspaceValue", { username: "someone-else" }],
  ] as const)("the %s layer overriding %j: refused, nothing called", async (layer, override) => {
    const { provider, calls, warnings, label } = await rig(layeredServers({ ...user, [layer]: { dev1: override } }));

    expect(await provider.resolveEnvForLabel(label)).toBeUndefined();

    expect(warnings).toEqual([notUserWarning(label, "dev1")]);
    expectNothingCalled(calls);
  });

  it.each([["workspaceValue"], ["workspaceFolderValue"]] as const)(
    "a server only the %s defines (no user layer): refused, nothing called (the sanctioned behaviour change)",
    async (layer) => {
      const { provider, calls, warnings, label } = await rig(
        layeredServers({ [layer]: { dev1: userDev1 } }),
        { stored: { ...STORED } },
      );

      expect(await provider.resolveEnvForLabel(label)).toBeUndefined();

      expect(warnings).toEqual([notUserWarning(label, "dev1")]);
      expectNothingCalled(calls);
    },
  );

  it("the rule is name-level: a workspace layer that sets only `description` still refuses", async () => {
    const { provider, calls, warnings, label } = await rig(
      layeredServers({ ...user, workspaceValue: { dev1: { description: "team note" } } }),
    );
    expect(await provider.resolveEnvForLabel(label)).toBeUndefined();
    expect(warnings).toEqual([notUserWarning(label, "dev1")]);
    expectNothingCalled(calls);
  });

  it("the rule is name-level: a workspace layer that is not an object refuses", async () => {
    const { provider, calls, warnings, label } = await rig(layeredServers({ ...user, workspaceValue: "garbage" }));
    expect(await provider.resolveEnvForLabel(label)).toBeUndefined();
    expect(warnings).toEqual([notUserWarning(label, "dev1")]);
    expectNothingCalled(calls);
  });

  it("every refused call shows exactly one warning (no once-per-session dedupe) and still calls nothing", async () => {
    const { provider, calls, warnings, label } = await rig(
      layeredServers({ ...user, workspaceValue: { dev1: workspaceHostOverride } }),
    );
    for (let call = 1; call <= 3; call++) {
      expect(await provider.resolveEnvForLabel(label)).toBeUndefined();
      expect(warnings).toHaveLength(call);
    }
    expectNothingCalled(calls);
  });
});

describe("DW-752: an inspection that fails is refused with the uninspectable warning", () => {
  const user = layeredServers({ globalValue: { dev1: userDev1 } });
  const cases: Array<[string, "absent" | ((scope?: unknown) => unknown)]> = [
    ["the dependency is absent", "absent"],
    [
      "the dependency throws",
      () => {
        throw new Error("configuration unavailable");
      },
    ],
    ["the dependency returns undefined", () => undefined],
    ["the dependency returns null", () => null],
    ["the dependency returns a non-object", () => "not-an-inspection"],
  ];

  it.each(cases)("%s: undefined, one uninspectable warning, nothing called", async (_name, inspect) => {
    const { provider, calls, warnings, label } = await rig(user, { inspect });

    expect(await provider.resolveEnvForLabel(label)).toBeUndefined();

    expect(warnings).toEqual([uninspectableWarning(label, "dev1")]);
    expectNothingCalled(calls);
  });
});

describe("DW-752: ordering and scope of the guard", () => {
  it("a combined plan [a (user), b (workspace)]: one not-user warning naming b, and nothing called for a either", async () => {
    const { provider, calls, warnings, label } = await rig(
      layeredServers({
        globalValue: { a: userDev1, b: userDev1 },
        workspaceValue: { b: workspaceHostOverride },
      }),
      { settings: { servers: ["a", "b"], combineProfiles: true }, stored: { [`a/${USERNAME}`]: "pw-a", [`b/${USERNAME}`]: "pw-b" } },
    );

    expect(await provider.resolveEnvForLabel(label)).toBeUndefined();

    expect(warnings).toEqual([notUserWarning(label, "b")]);
    expectNothingCalled(calls);
  });

  it("a combined plan whose servers are all user-scoped still resolves every profile", async () => {
    const { provider, label } = await rig(layeredServers({ globalValue: { a: userDev1, b: userDev1 } }), {
      settings: { servers: ["a", "b"], combineProfiles: true },
      stored: { [`a/${USERNAME}`]: "pw-a", [`b/${USERNAME}`]: "pw-b" },
    });
    const env = await provider.resolveEnvForLabel(label);
    expect(JSON.parse(String(env?.["IRIS_PROFILES"]))).toMatchObject({ a: { password: "pw-a" }, b: { password: "pw-b" } });
  });

  it("the first refused server in plan order is the one named", async () => {
    const { provider, warnings, label } = await rig(
      layeredServers({
        globalValue: { a: userDev1, b: userDev1, c: userDev1 },
        workspaceValue: { b: workspaceHostOverride, c: workspaceHostOverride },
      }),
      { settings: { servers: ["a", "b", "c"], combineProfiles: true } },
    );
    expect(await provider.resolveEnvForLabel(label)).toBeUndefined();
    expect(warnings).toEqual([notUserWarning(label, "b")]);
  });

  it("a server enumerated with folder scope S is inspected in S (the scope getServerSpec would read)", async () => {
    const scopeS = { which: "folder-S" };
    const { provider, calls, label } = await rig(layeredServers({ globalValue: { dev1: userDev1 } }), { scope: scopeS });

    expect((await provider.resolveEnvForLabel(label))?.["IRIS_PASSWORD"]).toBe(STORED_PASSWORD);

    expect(calls.inspect).toEqual([scopeS]);
    expect(calls.getServerSpec.map((call) => call.scope)).toEqual([scopeS]);
  });

  it("a token already cancelled on entry returns undefined silently, before the guard (no inspection, no warning, nothing called)", async () => {
    const { provider, calls, warnings, label } = await rig(
      layeredServers({ globalValue: { dev1: userDev1 }, workspaceValue: { dev1: workspaceHostOverride } }),
    );

    expect(await provider.resolveEnvForLabel(label, { isCancellationRequested: true })).toBeUndefined();

    expect(warnings).toEqual([]);
    expect(calls.inspect).toEqual([]);
    expectNothingCalled(calls);
  });
});

describe("DW-752: the process the Local harness spawns", () => {
  let kit: FreshProcessKit;

  beforeAll(async () => {
    kit = await createFreshProcessKit("iris-mcp-launcher-dw752");
  });
  afterEach(async () => {
    await kit.closeOpen();
  });
  afterAll(async () => {
    await kit.dispose();
  });

  const stored = { [`dev1/${USERNAME}`]: STORED_PASSWORD };
  const storedBasic = basicAuthorization(USERNAME, STORED_PASSWORD);

  /** The real provider planning a local-build definition (the built `iris-dev-mcp` under this checkout), then resolving it. */
  async function resolveFor(layers: ServerManagerServersInspection) {
    const r = await rig(layers, { stored, settings: { developmentRepoPath: REPO_ROOT } });
    return { ...r, env: await r.provider.resolveEnvForLabel(r.label) };
  }

  it("a workspace layer that overrides the user's dev1 host to the listener: nothing is resolved, spawned or sent", async (ctx) => {
    if (skipUnbuilt(ctx, "DW-752 wire leg", kit.unbuiltReason)) return;
    const workspaceHost = await kit.startFakeIris();

    const { env, warnings, calls, provider } = await resolveFor(
      layeredServers({
        globalValue: { dev1: userDev1 },
        workspaceValue: { dev1: { webServer: { scheme: "http", host: "127.0.0.1", port: workspaceHost.port } } },
      }),
    );

    // Whatever the resolver returned is spawned the way the Local harness does, so the listener assertions below can
    // fail (a resolver that returned the merged env sends the stored password to the workspace author's host); a
    // refusing resolver leaves nothing to spawn: the Local harness starts no server when it returns undefined.
    if (env !== undefined) {
      const [planned] = await provider.providePlannedDefinitions();
      await kit.spawn({ command: planned!.command, args: planned!.args, env });
    }
    expect(sentAuthorizations(workspaceHost), "the workspace author's host never saw the user's stored password").not.toContain(storedBasic);
    expect(workspaceHost.requests, "nothing reached the workspace author's host").toEqual([]);
    expect(env).toBeUndefined();
    expect(warnings).toHaveLength(1);
    expectNothingCalled(calls);
  }, 60_000);

  it("control: the same server defined in user settings alone, with the user's host the listener, is spawned and authenticates with the stored password", async (ctx) => {
    if (skipUnbuilt(ctx, "DW-752 wire leg", kit.unbuiltReason)) return;
    const userHost = await kit.startFakeIris();

    const { env, label, provider } = await resolveFor(
      layeredServers({
        globalValue: { dev1: { webServer: { scheme: "http", host: "127.0.0.1", port: userHost.port }, username: USERNAME } },
      }),
    );
    expect(env).toBeDefined();
    expect(env?.["IRIS_PASSWORD"]).toBe(STORED_PASSWORD);

    // Spawn what the provider planned the way the Local harness does: `null` entries deleted, over a scrubbed base env.
    const [planned] = await provider.providePlannedDefinitions();
    expect(planned!.label).toBe(label);
    await kit.spawn({ command: planned!.command, args: planned!.args, env: env! });

    expect(sentAuthorizations(userHost), "the user's own host receives the stored password (the oracle can vary)").toContain(storedBasic);
  }, 60_000);
});
