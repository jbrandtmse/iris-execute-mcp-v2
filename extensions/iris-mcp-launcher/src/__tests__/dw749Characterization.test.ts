/**
 * DW-749 pin: a workspace or folder `settings.json` can never choose the host that receives the user's stored password
 * through a provided definition (AD-9: "an untrusted repository injecting configuration").
 *
 * The keychain entry a provided definition selects is chosen by Server Manager SERVER NAME (`IRIS_CREDENTIAL_NAME=<name>`),
 * and Server Manager's `getServerSpec` reads VS Code's MERGED `intersystems.servers` view (user, workspace and folder layers,
 * merged key by key, so a workspace entry can override only `webServer.host` and still inherit the user's username). So the
 * provider names a stored credential only for a server that `inspect("servers")` shows in user (or default) settings alone;
 * any workspace or folder layer that defines the name gives the definition the empty env, and nothing is sent anywhere.
 *
 * Each test drives the real `LauncherProvider` over a fake Server Manager whose spec is the merge of the layers its
 * `inspectServerManagerServers` fake reports (shapes per `vscode.d.ts` `WorkspaceConfiguration.inspect`), then spawns the
 * provided definition the way the Copilot harness does (`null` dropped, the provided env over a base env) as a fresh built
 * `iris-dev-mcp` process, with the user's password stored for `dev1` in the fake keyring under a scratch HOME. The fake IRIS
 * listener stands for the workspace author's host. A control with the same fixture minus the workspace layer shows the
 * listener DOES receive the stored password when the user configured that host, so the guarded assertion can fail.
 *
 * Needs no IRIS; never the real keychain. Skips with a logged reason when unbuilt (fails on CI). The listener, the fake
 * keyring and the spawn are the shared `freshProcessKit.ts` (Story 44.8 reuses them for the Local harness).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { skipUnbuilt } from "./builtDist.js";
import { LauncherProvider, type PlannedDefinition } from "../serverDefinitionProvider.js";
import type { LauncherSettings, ServerManagerApi, ServerManagerServersInspection, ServerSpec } from "../types.js";
import { basicAuthorization, createFreshProcessKit, REPO_ROOT, sentAuthorizations, type FreshProcessKit } from "./freshProcessKit.js";

const USERNAME = "svc44";
const STORED_PASSWORD = "users-corporate-dev1-password";
const STORED_BASIC = basicAuthorization(USERNAME, STORED_PASSWORD);

let kit: FreshProcessKit;

beforeAll(async () => {
  kit = await createFreshProcessKit("iris-mcp-launcher-dw749");
});

afterEach(async () => {
  await kit.closeOpen();
});

afterAll(async () => {
  await kit.dispose();
});

/** Spawn `planned` as the Copilot harness does, with the user's stored `dev1` password in the fake keyring. A server that cannot start is expected. */
async function spawnAsCopilot(planned: PlannedDefinition): Promise<void> {
  await kit.spawn(planned, { keyring: { dev1: STORED_PASSWORD } });
}

function settings(): LauncherSettings {
  return {
    servers: ["dev1"],
    packages: ["dev"],
    namespace: "USER",
    combineProfiles: false,
    developmentRepoPath: REPO_ROOT,
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
  };
}

/** VS Code's merge of one object-valued setting across scopes: key by key, the later (more specific) layer wins per property. */
function mergeLayers(...layers: Array<Record<string, unknown> | undefined>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const layer of layers) {
    for (const [key, value] of Object.entries(layer ?? {})) {
      const existing = out[key];
      out[key] =
        typeof value === "object" && value !== null && !Array.isArray(value) && typeof existing === "object" && existing !== null
          ? mergeLayers(existing as Record<string, unknown>, value as Record<string, unknown>)
          : value;
    }
  }
  return out;
}

/** The real provider over a Server Manager whose `dev1` spec is the merge of the inspection's user and workspace layers. */
async function provide(inspection: ServerManagerServersInspection): Promise<PlannedDefinition> {
  const layer = (value: unknown): Record<string, unknown> | undefined =>
    (value as Record<string, Record<string, unknown>> | undefined)?.["dev1"];
  const merged = mergeLayers(layer(inspection.globalValue), layer(inspection.workspaceValue)) as unknown as ServerSpec;
  const api: ServerManagerApi = {
    getServerNames: () => [{ name: "dev1", description: "", detail: "" }],
    getServerSpec: async () => ({ ...merged, name: "dev1" }),
    getAccount: () => undefined,
  };
  const provider = new LauncherProvider({
    getServerManagerApi: async () => api,
    authApi: { getSession: async () => { throw new Error("a provided definition never prompts"); } },
    getSettings: settings,
    showWarning: () => undefined,
    inspectServerManagerServers: () => inspection,
  });
  const [planned] = await provider.providePlannedDefinitions();
  return planned!;
}

describe("DW-749: a workspace-scope server reusing a user-scope name never receives the user's stored password", () => {
  it("a workspace layer that overrides only the user's dev1 host: provided env {}, and the workspace host receives no request and no stored password", async (ctx) => {
    if (skipUnbuilt(ctx, "DW-749 pin", kit.unbuiltReason)) return;
    const workspaceHost = await kit.startFakeIris();

    const userScope = { webServer: { host: "iris.corp.invalid", port: 52773, scheme: "http" }, username: USERNAME };
    const workspaceScope = { webServer: { host: "127.0.0.1", port: workspaceHost.port } };
    const planned = await provide({ globalValue: { dev1: userScope }, workspaceValue: { dev1: workspaceScope } });

    // The wire first, so a regression shows as the leak itself rather than as an env-shape difference.
    await spawnAsCopilot(planned);
    expect(sentAuthorizations(workspaceHost), "the workspace author's host never saw the user's stored password").not.toContain(STORED_BASIC);
    expect(workspaceHost.requests, "nothing reached the workspace author's host").toEqual([]);
    expect(planned.env).toEqual({});
  }, 60_000);

  it("control: the same user-scope dev1 pointed at the listener with NO workspace layer authenticates there with the stored password", async (ctx) => {
    if (skipUnbuilt(ctx, "DW-749 pin", kit.unbuiltReason)) return;
    const userHost = await kit.startFakeIris();

    const userScope = { webServer: { host: "127.0.0.1", port: userHost.port, scheme: "http" }, username: USERNAME };
    const planned = await provide({ globalValue: { dev1: userScope } });
    expect(planned.env["IRIS_CREDENTIAL_NAME"]).toBe("dev1");

    await spawnAsCopilot(planned);
    expect(sentAuthorizations(userHost), "the user's own host receives the stored password (the oracle can vary)").toContain(STORED_BASIC);
  }, 60_000);

  it("two getServerNames entries with the same name in user and folder scope: ONE definition, inspected in the folder scope it is looked up in, and its env is {}", async () => {
    const userScope = { which: "user" };
    const folderScope = { which: "folder" };
    const inspectedIn: unknown[] = [];
    const api: ServerManagerApi = {
      getServerNames: () => [
        { name: "dev1", description: "", detail: "", scope: userScope },
        { name: "dev1", description: "", detail: "", scope: folderScope },
      ],
      getServerSpec: async (name) => ({
        name,
        webServer: { host: "folder.example.com", port: 52773, scheme: "http" },
        username: USERNAME,
      }),
      getAccount: () => undefined,
    };
    const provider = new LauncherProvider({
      getServerManagerApi: async () => api,
      authApi: { getSession: async () => undefined },
      getSettings: settings,
      showWarning: () => undefined,
      inspectServerManagerServers: (scope) => {
        inspectedIn.push(scope);
        return {
          globalValue: { dev1: { webServer: { host: "user.example.com" } } },
          workspaceFolderValue: { dev1: { webServer: { host: "folder.example.com" } } },
        };
      },
    });
    const planned = await provider.providePlannedDefinitions();
    expect(planned).toHaveLength(1);
    expect(inspectedIn).toEqual([folderScope]);
    expect(planned[0]!.env).toEqual({});
  });
});
