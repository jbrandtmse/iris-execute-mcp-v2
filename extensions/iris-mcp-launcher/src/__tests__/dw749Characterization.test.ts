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
 * Needs no IRIS; never the real keychain. Skips with a logged reason when unbuilt (fails on CI).
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { skipUnbuilt } from "./builtDist.js";
import { LauncherProvider, type PlannedDefinition } from "../serverDefinitionProvider.js";
import type { LauncherSettings, ServerManagerApi, ServerManagerServersInspection, ServerSpec } from "../types.js";
import { resolveSdkEsmDir, REPO_ROOT } from "./sdkClientStore.js";

const SHARED_DIST = path.join(REPO_ROOT, "packages", "shared", "dist");
const DEV_ENTRY = path.join(REPO_ROOT, "packages", "iris-dev-mcp", "dist", "index.js");
const FAKE_LISTENER = path.join(REPO_ROOT, "scripts", "lib", "fake-iris-listener.mjs");
const FAKE_KEYRING_PRELOAD = path.join(REPO_ROOT, "scripts", "lib", "fake-keyring-preload.mjs");

const USERNAME = "svc44";
const STORED_PASSWORD = "users-corporate-dev1-password";
const STORED_BASIC = `Basic ${Buffer.from(`${USERNAME}:${STORED_PASSWORD}`).toString("base64")}`;

interface FakeIris {
  port: number;
  requests: unknown[];
  authorizations: Array<{ method: string; url: string; authorization: string | undefined }>;
  close: () => Promise<void>;
}

interface SdkClient {
  connect: (transport: unknown) => Promise<void>;
  close: () => Promise<void>;
  listTools: () => Promise<{ tools: Array<{ name: string }> }>;
}

let unbuiltReason: string | undefined;
let sdkEsmDir = "";
let startFakeIris: (options: { bootstrapVersion: string }) => Promise<FakeIris>;
let bootstrapVersion = "";
let scratch = "";
const open: Array<() => Promise<void>> = [];

beforeAll(async () => {
  const missing = [
    [path.join(SHARED_DIST, "bootstrap-classes.js"), "packages/shared is not built"],
    [DEV_ENTRY, "packages/iris-dev-mcp is not built"],
    [FAKE_LISTENER, "scripts/lib/fake-iris-listener.mjs is missing"],
    [FAKE_KEYRING_PRELOAD, "scripts/lib/fake-keyring-preload.mjs is missing"],
  ].find(([file]) => !existsSync(file as string));
  const sdk = resolveSdkEsmDir();
  if (missing !== undefined) unbuiltReason = `${missing[1]} (${missing[0]}); run "pnpm turbo run build" from the repo root.`;
  else if (sdk === undefined) unbuiltReason = "the @modelcontextprotocol/client ESM build is not under node_modules/.pnpm; run pnpm install.";
  else if (typeof (await import("node:module")).registerHooks !== "function") unbuiltReason = "this Node has no module.registerHooks (>= 22.15), so the fake keyring cannot be preloaded.";
  if (unbuiltReason !== undefined) return;
  sdkEsmDir = sdk as string;
  startFakeIris = ((await import(pathToFileURL(FAKE_LISTENER).href)) as { startFakeIris: typeof startFakeIris }).startFakeIris;
  const embed = (await import(pathToFileURL(path.join(SHARED_DIST, "bootstrap-classes.js")).href)) as { BOOTSTRAP_VERSION: string };
  bootstrapVersion = embed.BOOTSTRAP_VERSION;
  scratch = mkdtempSync(path.join(tmpdir(), "iris-mcp-launcher-dw749-"));
});

afterEach(async () => {
  for (const close of open.splice(0).reverse()) await close().catch(() => undefined);
});

afterAll(() => {
  if (scratch !== "") rmSync(scratch, { recursive: true, force: true });
});

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

/** Spawn `planned` as the Copilot harness does, with the user's stored `dev1` password in the fake keyring. A server that cannot start is expected. */
async function spawnAsCopilot(planned: PlannedDefinition): Promise<void> {
  const caseDir = mkdtempSync(path.join(scratch, "case-"));
  const keyringFile = path.join(caseDir, "fake-keyring.json");
  writeFileSync(keyringFile, JSON.stringify({ "iris-mcp": { dev1: STORED_PASSWORD } }), "utf8");
  const existing = process.env.NODE_OPTIONS;
  const preload = `--import=${pathToFileURL(FAKE_KEYRING_PRELOAD).href}`;
  const env: Record<string, string> = {
    HOME: caseDir,
    USERPROFILE: caseDir,
    FAKE_KEYRING_FILE: keyringFile,
    NODE_OPTIONS: existing === undefined || existing.trim() === "" ? preload : `${existing} ${preload}`,
  };
  if (process.env.PATH !== undefined) env["PATH"] = process.env.PATH;
  for (const [key, value] of Object.entries(planned.env)) if (value !== null) env[key] = value;

  const { Client } = (await import(pathToFileURL(path.join(sdkEsmDir, "index.mjs")).href)) as {
    Client: new (info: { name: string; version: string }) => SdkClient;
  };
  const { StdioClientTransport } = (await import(pathToFileURL(path.join(sdkEsmDir, "stdio.mjs")).href)) as {
    StdioClientTransport: new (params: { command: string; args: string[]; env: Record<string, string>; stderr: string }) => unknown;
  };
  const client = new Client({ name: "iris-mcp-launcher-dw749", version: "0.0.0" });
  open.push(() => client.close());
  try {
    await client.connect(new StdioClientTransport({ command: planned.command, args: planned.args, env, stderr: "ignore" }));
    await client.listTools();
  } catch {
    // A definition without connection settings exits at startup; what matters is what reached the listener.
  }
}

function sentAuthorizations(fake: FakeIris): string[] {
  return fake.authorizations.flatMap((entry) => (entry.authorization === undefined ? [] : [entry.authorization]));
}

describe("DW-749: a workspace-scope server reusing a user-scope name never receives the user's stored password", () => {
  it("a workspace layer that overrides only the user's dev1 host: provided env {}, and the workspace host receives no request and no stored password", async (ctx) => {
    if (skipUnbuilt(ctx, "DW-749 pin", unbuiltReason)) return;
    const workspaceHost = await startFakeIris({ bootstrapVersion });
    open.push(() => workspaceHost.close());

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
    if (skipUnbuilt(ctx, "DW-749 pin", unbuiltReason)) return;
    const userHost = await startFakeIris({ bootstrapVersion });
    open.push(() => userHost.close());

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
