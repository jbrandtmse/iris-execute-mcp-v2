/**
 * Story 44.6, AC-12 -- what a Copilot-harness session gets from a PROVIDED definition, emulated end to end and offline.
 *
 * The Copilot harness never runs `resolveMcpServerDefinition`: its Agent Host forwards the provided definition's
 * `command`, `args` and `env`, DROPS every `null` env entry (it does not unset the ambient variable) and stringifies
 * the rest (P-2, VS Code 1.147 `DZe`). This test does exactly that:
 *
 *   1. the REAL `LauncherProvider`, with `developmentRepoPath` = this repo, provides the definition (so `command` and
 *      `args` are the built `iris-dev-mcp` dist, not a literal);
 *   2. its provided `env` is applied over a base environment that carries HOSTILE ambient values
 *      (`IRIS_PASSWORD=wrong`, an `IRIS_PROFILES` that adds an unreachable host, an unparseable `IRIS_GOVERNANCE`), a scratch
 *      HOME and the fake-keyring preload, with a password stored for `dev1`;
 *   3. that command is spawned through the real SDK stdio transport against the fake IRIS listener
 *      (`scripts/lib/fake-iris-listener.mjs`, on 127.0.0.1 inside this process).
 *
 * The oracle is the server's own behaviour: the fake sees Basic auth with the STORED password (not `wrong`, not the
 * inline password in the Server Manager spec), the `iris_server_profiles` roster holds only `default`, and the server
 * started at all (an unparseable `IRIS_GOVERNANCE` stops it unless the provided `""` override reaches it).
 *
 * Needs no IRIS and never touches the real keychain: `@napi-rs/keyring` is routed to a file-backed fake by the preload.
 * It reads the built dists of `@iris-mcp/shared` and `@iris-mcp/dev` at test time; an unbuilt checkout skips with a
 * logged reason, and CI (`CI=true`, where every package is built first) fails instead.
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { skipUnbuilt } from "./builtDist.js";
import { LauncherProvider } from "../serverDefinitionProvider.js";
import { userScopeServers } from "./serverManagerInspection.js";
import type { LauncherSettings, ServerManagerApi, ServerSpec } from "../types.js";
import { resolveSdkEsmDir, REPO_ROOT } from "./sdkClientStore.js";

const SHARED_DIST = path.join(REPO_ROOT, "packages", "shared", "dist");
const DEV_ENTRY = path.join(REPO_ROOT, "packages", "iris-dev-mcp", "dist", "index.js");
const FAKE_LISTENER = path.join(REPO_ROOT, "scripts", "lib", "fake-iris-listener.mjs");
const FAKE_KEYRING_PRELOAD = path.join(REPO_ROOT, "scripts", "lib", "fake-keyring-preload.mjs");

const USERNAME = "svc44";
const STORED_PASSWORD = "stored-pw-44.6";
const INLINE_PASSWORD = "inline-spec-pw-44.6";

interface FakeIris {
  port: number;
  requests: Array<{ method: string; url: string; body: string }>;
  authorizations: Array<{ method: string; url: string; authorization: string | undefined }>;
  close: () => Promise<void>;
}

interface SdkClient {
  connect: (transport: unknown) => Promise<void>;
  close: () => Promise<void>;
  callTool: (params: { name: string; arguments: Record<string, unknown> }) => Promise<{
    isError?: boolean;
    content: Array<{ type: string; text?: string }>;
    structuredContent?: unknown;
  }>;
}

let unbuiltReason: string | undefined;
let sdkEsmDir = "";
let startFakeIris: (options: { bootstrapVersion: string }) => Promise<FakeIris>;
let bootstrapVersion = "";
let scratch = "";
const open: Array<() => Promise<void>> = [];

beforeAll(async () => {
  const missing = [
    [path.join(SHARED_DIST, "config.js"), "packages/shared is not built"],
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
  scratch = mkdtempSync(path.join(tmpdir(), "iris-mcp-launcher-44-6-"));
});

afterEach(async () => {
  for (const close of open.splice(0).reverse()) await close().catch(() => undefined);
});

afterAll(() => {
  if (scratch !== "") rmSync(scratch, { recursive: true, force: true });
});

function settings(overrides: Partial<LauncherSettings> = {}): LauncherSettings {
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
    ...overrides,
  };
}

/** The real provider over a Server Manager that knows `dev1` at the fake IRIS (its spec carries an inline password the provided env must not use). */
function providerFor(port: number, overrides: Partial<LauncherSettings> = {}): LauncherProvider {
  const spec: ServerSpec = {
    name: "dev1",
    webServer: { host: "127.0.0.1", port, scheme: "http" },
    username: USERNAME,
    password: INLINE_PASSWORD,
  };
  const api: ServerManagerApi = {
    getServerNames: () => [{ name: "dev1", description: "", detail: "" }],
    getServerSpec: async () => spec,
    getAccount: () => undefined,
  };
  return new LauncherProvider({
    getServerManagerApi: async () => api,
    authApi: { getSession: async () => { throw new Error("a provided definition never prompts"); } },
    getSettings: () => settings(overrides),
    showWarning: () => undefined,
    inspectServerManagerServers: () => userScopeServers(["dev1"]),
  });
}

/** The Agent Host's treatment of a provided env over the runtime's base env: `null` entries are DROPPED (not unset), numbers become strings. */
function applyAsAgentHost(
  base: Record<string, string>,
  provided: Record<string, string | number | null>,
): Record<string, string> {
  const merged: Record<string, string> = { ...base };
  for (const [key, value] of Object.entries(provided)) {
    if (value === null) continue;
    merged[key] = String(value);
  }
  return merged;
}

/** The runtime's own environment: hostile ambient IRIS_* values, a scratch HOME, and the fake keychain holding the stored password. */
function hostileBase(caseDir: string): Record<string, string> {
  const keyringFile = path.join(caseDir, "fake-keyring.json");
  writeFileSync(keyringFile, JSON.stringify({ "iris-mcp": { dev1: STORED_PASSWORD } }), "utf8");
  const existing = process.env.NODE_OPTIONS;
  const preload = `--import=${pathToFileURL(FAKE_KEYRING_PRELOAD).href}`;
  return {
    IRIS_PASSWORD: "wrong",
    IRIS_PROFILES: JSON.stringify({ evil: { host: "evil.invalid" } }),
    IRIS_GOVERNANCE: "{this is not json",
    HOME: caseDir,
    USERPROFILE: caseDir,
    FAKE_KEYRING_FILE: keyringFile,
    NODE_OPTIONS: existing === undefined || existing.trim() === "" ? preload : `${existing} ${preload}`,
  };
}

async function connect(command: string, args: string[], env: Record<string, string>): Promise<SdkClient> {
  const { Client } = (await import(pathToFileURL(path.join(sdkEsmDir, "index.mjs")).href)) as {
    Client: new (info: { name: string; version: string }) => SdkClient;
  };
  const { StdioClientTransport } = (await import(pathToFileURL(path.join(sdkEsmDir, "stdio.mjs")).href)) as {
    StdioClientTransport: new (params: { command: string; args: string[]; env: Record<string, string>; stderr: string }) => unknown;
  };
  const transport = new StdioClientTransport({ command, args, env, stderr: "ignore" });
  const client = new Client({ name: "iris-mcp-launcher-44-6", version: "0.0.0" });
  await client.connect(transport);
  open.push(() => client.close());
  return client;
}

describe("Story 44.6 AC-12: a provided definition starts a working server under the Copilot harness", () => {
  it("the stored password reaches the server, hostile ambient values are overridden, and the roster holds only default", async (ctx) => {
    if (skipUnbuilt(ctx, "Story 44.6 AC-12", unbuiltReason)) return;
    const caseDir = mkdtempSync(path.join(scratch, "case-"));
    const fake = await startFakeIris({ bootstrapVersion });
    open.push(() => fake.close());

    const provider = providerFor(fake.port);
    const planned = await provider.providePlannedDefinitions();
    expect(planned).toHaveLength(1);
    // The REAL planned command: the built dev server of this repo (the extension host's own interpreter in a local build).
    expect(planned[0]!.command).toBe(process.execPath);
    expect(planned[0]!.args).toEqual([DEV_ENTRY]);

    const spawnEnv = applyAsAgentHost(hostileBase(caseDir), planned[0]!.env);
    // The hostile ambient values are what the child would inherit WITHOUT the provided overrides.
    expect(spawnEnv["IRIS_PASSWORD"]).toBe("");
    expect(spawnEnv["IRIS_PROFILES"]).toBe("");
    expect(spawnEnv["IRIS_GOVERNANCE"]).toBe("");
    expect(spawnEnv["IRIS_CREDENTIAL_NAME"]).toBe("dev1");

    const client = await connect(planned[0]!.command, planned[0]!.args, spawnEnv);

    const profiles = await client.callTool({ name: "iris_server_profiles", arguments: {} });
    expect(profiles.isError).not.toBe(true);
    const roster = profiles.structuredContent as { profiles?: Array<{ name: string }> } | undefined;
    expect(roster?.profiles?.map((profile) => profile.name), "the roster holds only default").toEqual(["default"]);
    expect(JSON.stringify(profiles.structuredContent ?? profiles.content)).not.toContain("evil");

    const expected = `Basic ${Buffer.from(`${USERNAME}:${STORED_PASSWORD}`).toString("base64")}`;
    const sent = fake.authorizations.flatMap((entry) => (entry.authorization === undefined ? [] : [entry.authorization]));
    expect(sent.length, "the server authenticated to the fake IRIS").toBeGreaterThan(0);
    expect(new Set(sent)).toEqual(new Set([expected]));
    expect(fake.authorizations[0]).toMatchObject({ method: "HEAD", url: "/api/atelier/" });
  }, 60_000);

  // A self-check of this file's Agent Host emulation (P-2), not product evidence: the product-side proof that a dropped
  // null lets an ambient value through is the "control" test in copilotEmptyOverrides.test.ts, which spawns the server.
  it("emulation self-check: applyAsAgentHost drops a null entry, so the ambient value it would have cleared stays in place", () => {
    const merged = applyAsAgentHost({ IRIS_PASSWORD: "wrong" }, { IRIS_PASSWORD: null, IRIS_PORT: 52773 });
    expect(merged).toEqual({ IRIS_PASSWORD: "wrong", IRIS_PORT: "52773" });
  });
});
