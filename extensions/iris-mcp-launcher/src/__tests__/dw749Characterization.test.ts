/**
 * DW-749 CHARACTERIZATION (Story 44.6 QA; documents what the provider does TODAY, it does not bless it).
 *
 * The keychain entry a provided definition selects is chosen by Server Manager SERVER NAME only (`IRIS_CREDENTIAL_NAME=<name>`),
 * while the HOST comes from whatever `getServerSpec(name)` returns. Server Manager's `getServerNames`/`getServerSpec` read
 * `vscode.workspace.getConfiguration("intersystems.servers", scope).get(name)` -- VS Code's MERGED view of user, workspace and
 * folder settings -- and Server Manager declares `untrustedWorkspaces: supported` with no restricted setting, so a workspace's
 * `.vscode/settings.json` (or `.code-workspace`) that reuses a user-scope server's name takes effect even in Restricted Mode.
 * VS Code merges object settings key by key, so such an entry can override ONLY the host and still inherit the user's username.
 *
 * Probe: the user's scope defines `dev1` (corporate host, username `svc44`); the workspace redefines `dev1` with only a different
 * host (here the fake IRIS listener on 127.0.0.1, standing for the workspace author's server). The fake Server Manager below
 * merges the two layers the way VS Code merges an object setting. The provided definition is spawned as the Copilot harness would,
 * with the user's stored password for `dev1` in the (fake) keychain, and the workspace's host receives
 * `Authorization: Basic base64(svc44:<the user's stored dev1 password>)`.
 *
 * Fix direction (a product/trust decision, not made here): bind the stored entry to the host (key the keychain entry by
 * host+name, or have the launcher refuse a server whose resolved host differs between scopes), or require workspace trust.
 * When it is fixed these assertions flip; update them then.
 *
 * Needs no IRIS; the keychain is the fake-keyring preload under a scratch HOME. Skips with a logged reason when unbuilt (fails on CI).
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { skipUnbuilt } from "./builtDist.js";
import { LauncherProvider } from "../serverDefinitionProvider.js";
import type { LauncherSettings, ServerManagerApi, ServerSpec } from "../types.js";
import { resolveSdkEsmDir, REPO_ROOT } from "./sdkClientStore.js";

const SHARED_DIST = path.join(REPO_ROOT, "packages", "shared", "dist");
const DEV_ENTRY = path.join(REPO_ROOT, "packages", "iris-dev-mcp", "dist", "index.js");
const FAKE_LISTENER = path.join(REPO_ROOT, "scripts", "lib", "fake-iris-listener.mjs");
const FAKE_KEYRING_PRELOAD = path.join(REPO_ROOT, "scripts", "lib", "fake-keyring-preload.mjs");

const USERNAME = "svc44";
const STORED_PASSWORD = "users-corporate-dev1-password";

interface FakeIris {
  port: number;
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

describe("DW-749 characterization: a workspace-scope server reusing a user-scope name receives the user's stored password", () => {
  it("the merged spec points at the workspace's host, and a fresh server process sends the user's stored dev1 password there", async (ctx) => {
    if (skipUnbuilt(ctx, "DW-749 characterization", unbuiltReason)) return;
    const workspaceHost = await startFakeIris({ bootstrapVersion });
    open.push(() => workspaceHost.close());

    const userScope = { webServer: { host: "iris.corp.invalid", port: 52773, scheme: "http" }, username: USERNAME };
    const workspaceScope = { webServer: { host: "127.0.0.1", port: workspaceHost.port } };
    const merged = mergeLayers(userScope, workspaceScope) as unknown as ServerSpec;
    expect(merged.username, "the workspace entry inherits the user's username through the merge").toBe(USERNAME);

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
    });
    const [planned] = await provider.providePlannedDefinitions();
    expect(planned!.env["IRIS_HOST"]).toBe("127.0.0.1");
    expect(planned!.env["IRIS_PORT"]).toBe(String(workspaceHost.port));
    expect(planned!.env["IRIS_USERNAME"]).toBe(USERNAME);
    expect(planned!.env["IRIS_CREDENTIAL_NAME"]).toBe("dev1");

    // The user stored this password for THEIR dev1 (`iris-mcp-credentials set dev1`).
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
    for (const [key, value] of Object.entries(planned!.env)) if (value !== null) env[key] = value;

    const { Client } = (await import(pathToFileURL(path.join(sdkEsmDir, "index.mjs")).href)) as {
      Client: new (info: { name: string; version: string }) => SdkClient;
    };
    const { StdioClientTransport } = (await import(pathToFileURL(path.join(sdkEsmDir, "stdio.mjs")).href)) as {
      StdioClientTransport: new (params: { command: string; args: string[]; env: Record<string, string>; stderr: string }) => unknown;
    };
    const client = new Client({ name: "iris-mcp-launcher-dw749", version: "0.0.0" });
    await client.connect(new StdioClientTransport({ command: planned!.command, args: planned!.args, env, stderr: "ignore" }));
    open.push(() => client.close());
    await client.listTools();

    const sent = workspaceHost.authorizations.flatMap((entry) => (entry.authorization === undefined ? [] : [entry.authorization]));
    expect(sent, "the workspace author's host received the user's stored password").toContain(
      `Basic ${Buffer.from(`${USERNAME}:${STORED_PASSWORD}`).toString("base64")}`,
    );
  }, 60_000);

  it("two getServerNames entries with the same name in different scopes yield ONE definition, looked up in the LAST scope enumerated", async () => {
    const userScope = { which: "user" };
    const folderScope = { which: "folder" };
    const lookedUpIn: unknown[] = [];
    const api: ServerManagerApi = {
      getServerNames: () => [
        { name: "dev1", description: "", detail: "", scope: userScope },
        { name: "dev1", description: "", detail: "", scope: folderScope },
      ],
      getServerSpec: async (name, scope) => {
        lookedUpIn.push(scope);
        return {
          name,
          webServer: { host: scope === folderScope ? "folder.example.com" : "user.example.com", port: 52773, scheme: "http" },
          username: USERNAME,
        };
      },
      getAccount: () => undefined,
    };
    const provider = new LauncherProvider({
      getServerManagerApi: async () => api,
      authApi: { getSession: async () => undefined },
      getSettings: settings,
      showWarning: () => undefined,
    });
    const planned = await provider.providePlannedDefinitions();
    expect(planned).toHaveLength(1);
    expect(lookedUpIn).toEqual([folderScope]);
    expect(planned[0]!.env["IRIS_HOST"]).toBe("folder.example.com");
    expect(planned[0]!.env["IRIS_CREDENTIAL_NAME"]).toBe("dev1");
  });
});
