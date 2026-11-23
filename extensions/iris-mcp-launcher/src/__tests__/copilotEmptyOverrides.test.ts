/**
 * Story 44.6 QA -- the empty-string overrides of a PROVIDED definition, on every launcher-owned variable, in a fresh server process.
 *
 * The Copilot harness DROPS `null` env entries, so a provided definition can only blank an ambient variable with `""`
 * (`EMPTY_MEANS_UNSET_VARS`). That is sound only if the server treats `""` as unset for EACH such variable. The 44.6 source audit
 * (spec P-12) says it does; `copilotProvidedEnv.test.ts` exercises three of them (`IRIS_PASSWORD`, `IRIS_PROFILES`,
 * `IRIS_GOVERNANCE`). This file closes the rest, mechanically:
 *
 * 1. EVERY owned variable that the provided env blanks gets a hostile ambient value (`JUNK`; the keys are checked against
 *    `EMPTY_MEANS_UNSET_VARS`, so a variable added to the allowlist without a junk value fails here), the provided env is applied
 *    the way the Agent Host does, and the built `iris-dev-mcp` process still starts, authenticates with the stored password and
 *    lists only `default`;
 * 2. the CONTROL (Rule #59): the same hostile base with the blanks DROPPED (what `null` would have done under the Copilot harness)
 *    does NOT start, so the junk is potent and the override is what saves it;
 * 3. a server started with every blanked variable `""` lists the same tools as one with every such variable absent;
 * 4. `IRIS_AUDIT_LOG_MAX_MB` stays `null` (the Agent Host leaves an ambient value alone): with `IRIS_AUDIT_LOG` blanked an ambient
 *    garbage value is inert, and the residual the README documents is real only when the user ALSO sets `irisMcpLauncher.auditLog`.
 *
 * Needs no IRIS; the keychain is the fake-keyring preload under a scratch HOME, never the real one. Skips with a logged reason on an
 * unbuilt checkout and fails on CI (`skipUnbuilt`).
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { skipUnbuilt } from "./builtDist.js";
import { EMPTY_MEANS_UNSET_VARS } from "../env.js";
import { LauncherProvider } from "../serverDefinitionProvider.js";
import type { LauncherSettings, ServerManagerApi, ServerSpec } from "../types.js";
import { resolveSdkEsmDir, REPO_ROOT } from "./sdkClientStore.js";

const SHARED_DIST = path.join(REPO_ROOT, "packages", "shared", "dist");
const DEV_ENTRY = path.join(REPO_ROOT, "packages", "iris-dev-mcp", "dist", "index.js");
const FAKE_LISTENER = path.join(REPO_ROOT, "scripts", "lib", "fake-iris-listener.mjs");
const FAKE_KEYRING_PRELOAD = path.join(REPO_ROOT, "scripts", "lib", "fake-keyring-preload.mjs");

const USERNAME = "svc44";
const STORED_PASSWORD = "stored-pw-44.6-qa";

/** The five variables every provided definition sets to a real value (so they never reach the blank fill). */
const ALWAYS_SET = ["IRIS_HOST", "IRIS_PORT", "IRIS_HTTPS", "IRIS_USERNAME", "IRIS_NAMESPACE"];

/** A hostile ambient value for every blanked variable. Each one is chosen to break or redirect a server that read it. */
const JUNK: Record<string, string> = {
  IRIS_PASSWORD: "wrong",
  IRIS_PROFILES: JSON.stringify({ evil: { host: "evil.invalid" } }),
  IRIS_GOVERNANCE: "{this is not json",
  IRIS_GOVERNANCE_PRESET: "bogus-preset",
  IRIS_GOVERNANCE_FILE: "/nonexistent-qa/governance.json",
  IRIS_AUDIT_LOG: "/nonexistent-qa/dir/audit.log",
  IRIS_AUDIT_LOG_PARAMS: "true",
  IRIS_TOOLS_PRESET: "bogus-preset",
  IRIS_TOOLS_DISABLE: "*",
  IRIS_TOOLS_ENABLE: "*",
  IRIS_SERVER_MANAGER: "required",
  IRIS_SM_SERVERS: "nope",
  IRIS_SM_SETTINGS_PATHS: "/nonexistent-qa/settings.json",
  IRIS_SM_WORKSPACE: "/nonexistent-qa/workspace",
  IRIS_CREDENTIAL_HELPER: "/nonexistent-qa/helper",
  MCP_TRANSPORT: "http",
};

/**
 * The variables whose JUNK value alone (all the others blanked) stops the built server at startup, captured by running the
 * per-variable test (Rule #36). The other seven (`IRIS_PASSWORD`, `IRIS_PROFILES` -- both change behaviour, pinned in
 * `copilotProvidedEnv.test.ts` --, `IRIS_AUDIT_LOG_PARAMS`, `IRIS_SM_SERVERS`, `IRIS_SM_SETTINGS_PATHS`, `IRIS_SM_WORKSPACE`,
 * `IRIS_CREDENTIAL_HELPER`) need a companion variable to matter and are covered together by the all-junk test.
 */
const POTENT_ALONE: string[] = [
  "IRIS_AUDIT_LOG",
  "IRIS_GOVERNANCE",
  "IRIS_GOVERNANCE_FILE",
  "IRIS_GOVERNANCE_PRESET",
  "IRIS_SERVER_MANAGER",
  "IRIS_TOOLS_DISABLE",
  "IRIS_TOOLS_ENABLE",
  "IRIS_TOOLS_PRESET",
  "MCP_TRANSPORT",
];

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
  scratch = mkdtempSync(path.join(tmpdir(), "iris-mcp-launcher-44-6-qa-"));
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

function providerFor(port: number, overrides: Partial<LauncherSettings> = {}): LauncherProvider {
  const spec: ServerSpec = {
    name: "dev1",
    webServer: { host: "127.0.0.1", port, scheme: "http" },
    username: USERNAME,
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
  });
}

/** The Agent Host's treatment of a provided env over the runtime's base env: `null` entries are DROPPED, numbers stringified. */
function applyAsAgentHost(base: Record<string, string>, provided: Record<string, string | number | null>): Record<string, string> {
  const merged: Record<string, string> = { ...base };
  for (const [key, value] of Object.entries(provided)) {
    if (value === null) continue;
    merged[key] = String(value);
  }
  return merged;
}

/** A scratch HOME with the fake keychain holding the stored password for `dev1`, plus the preload that routes `@napi-rs/keyring` to it. */
function keychainBase(caseDir: string): Record<string, string> {
  const keyringFile = path.join(caseDir, "fake-keyring.json");
  writeFileSync(keyringFile, JSON.stringify({ "iris-mcp": { dev1: STORED_PASSWORD } }), "utf8");
  const existing = process.env.NODE_OPTIONS;
  const preload = `--import=${pathToFileURL(FAKE_KEYRING_PRELOAD).href}`;
  return {
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
  const client = new Client({ name: "iris-mcp-launcher-44-6-qa", version: "0.0.0" });
  await client.connect(transport);
  open.push(() => client.close());
  return client;
}

/** The provided definition of `dev1` against a fake IRIS, with its env. */
async function provided(
  overrides: Partial<LauncherSettings> = {},
): Promise<{ fake: FakeIris; command: string; args: string[]; env: Record<string, string | null> }> {
  const fake = await startFakeIris({ bootstrapVersion });
  open.push(() => fake.close());
  const planned = await providerFor(fake.port, overrides).providePlannedDefinitions();
  expect(planned).toHaveLength(1);
  return { fake, command: planned[0]!.command, args: planned[0]!.args, env: planned[0]!.env };
}

describe("Story 44.6 QA: every empty-string override is honoured by a fresh server process", () => {
  it("the JUNK roster covers exactly the owned variables the provided env blanks (a new allowlist entry needs a junk value)", async (ctx) => {
    if (skipUnbuilt(ctx, "Story 44.6 QA empty overrides", unbuiltReason)) return;
    const { env } = await provided();
    const blanked = Object.entries(env).filter(([, value]) => value === "").map(([key]) => key).sort();
    expect(blanked).toEqual(Object.keys(JUNK).sort());
    expect(blanked).toEqual(EMPTY_MEANS_UNSET_VARS.filter((name) => !ALWAYS_SET.includes(name)).sort());
  });

  it("hostile ambient values of ALL of them: the server still starts, authenticates with the stored password and lists only default", async (ctx) => {
    if (skipUnbuilt(ctx, "Story 44.6 QA empty overrides", unbuiltReason)) return;
    const caseDir = mkdtempSync(path.join(scratch, "case-"));
    const { fake, command, args, env } = await provided();
    const hostile = { ...keychainBase(caseDir), ...JUNK };
    const spawnEnv = applyAsAgentHost(hostile, env);
    for (const name of Object.keys(JUNK)) expect(spawnEnv[name], `${name} is blanked`).toBe("");

    const client = await connect(command, args, spawnEnv);
    const roster = JSON.stringify((await client.callTool({ name: "iris_server_profiles", arguments: {} })).structuredContent);
    expect(roster).toContain('"default"');
    expect(roster).not.toContain("evil");
    const expected = `Basic ${Buffer.from(`${USERNAME}:${STORED_PASSWORD}`).toString("base64")}`;
    const sent = fake.authorizations.flatMap((entry) => (entry.authorization === undefined ? [] : [entry.authorization]));
    expect(new Set(sent)).toEqual(new Set([expected]));
  }, 60_000);

  it("control: the same hostile base WITHOUT the blanks (what dropped nulls would leave) does not start", async (ctx) => {
    if (skipUnbuilt(ctx, "Story 44.6 QA empty overrides", unbuiltReason)) return;
    const caseDir = mkdtempSync(path.join(scratch, "case-"));
    const { command, args, env } = await provided();
    const withoutBlanks = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ""));
    const spawnEnv = applyAsAgentHost({ ...keychainBase(caseDir), ...JUNK }, withoutBlanks);
    await expect(connect(command, args, spawnEnv)).rejects.toBeTruthy();
  }, 60_000);

  it("per variable: a junk value alone stops (or alters) the server only when it is NOT blanked; blanked, the server starts", async (ctx) => {
    if (skipUnbuilt(ctx, "Story 44.6 QA empty overrides", unbuiltReason)) return;
    const { command, args, env } = await provided();
    const blankedEnv = Object.fromEntries(Object.entries(env).filter(([, value]) => value === ""));
    const potent: string[] = [];
    for (const [name, junk] of Object.entries(JUNK)) {
      const caseDir = mkdtempSync(path.join(scratch, "var-"));
      // Every other blank applies; this one variable keeps its junk, as a dropped null would leave it.
      const withJunk = applyAsAgentHost({ ...keychainBase(caseDir), [name]: junk }, { ...env, ...Object.fromEntries(Object.keys(blankedEnv).filter((key) => key !== name).map((key) => [key, ""])), [name]: null });
      let started = true;
      try {
        const client = await connect(command, args, withJunk);
        const tools = (await client.listTools()).tools.map((tool) => tool.name);
        // IRIS_TOOLS_DISABLE / _ENABLE "*" are rejected at startup; a preset/filter that merely hides tools would show here.
        started = tools.length > 5;
        await client.close();
      } catch {
        started = false;
      }
      if (!started) potent.push(name);

      const blanked = applyAsAgentHost({ ...keychainBase(caseDir), [name]: junk }, env);
      const client = await connect(command, args, blanked);
      expect((await client.listTools()).tools.length, `${name} blanked: the server starts with its normal tool list`).toBeGreaterThan(5);
    }
    // Captured by running this loop (Rule #36): the variables whose junk value alone stops the server. The rest are inert in
    // isolation (they only matter with a companion variable set), which the all-junk test above covers together.
    expect(potent.sort()).toEqual(POTENT_ALONE);
  }, 120_000);

  it("a server with every blanked variable \"\" lists the same tools as one with every such variable absent", async (ctx) => {
    if (skipUnbuilt(ctx, "Story 44.6 QA empty overrides", unbuiltReason)) return;
    const blankedDir = mkdtempSync(path.join(scratch, "case-"));
    const absentDir = mkdtempSync(path.join(scratch, "case-"));
    const { command, args, env } = await provided();

    const blankedClient = await connect(command, args, applyAsAgentHost(keychainBase(blankedDir), env));
    const absentClient = await connect(
      command,
      args,
      applyAsAgentHost(keychainBase(absentDir), Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ""))),
    );
    const names = async (client: SdkClient): Promise<string[]> => (await client.listTools()).tools.map((tool) => tool.name).sort();
    const blankedTools = await names(blankedClient);
    expect(blankedTools.length).toBeGreaterThan(5);
    expect(blankedTools).toEqual(await names(absentClient));
  }, 60_000);
});

describe("Story 44.6 QA: IRIS_AUDIT_LOG_MAX_MB stays null (the one owned variable \"\" cannot unset)", () => {
  it("is null in the provided env and is the only owned variable that is", async (ctx) => {
    if (skipUnbuilt(ctx, "Story 44.6 QA empty overrides", unbuiltReason)) return;
    const { env } = await provided();
    expect(env["IRIS_AUDIT_LOG_MAX_MB"]).toBeNull();
    expect(Object.entries(env).filter(([, value]) => value === null).map(([key]) => key)).toEqual(["IRIS_AUDIT_LOG_MAX_MB"]);
  });

  it("with IRIS_AUDIT_LOG blanked, an ambient garbage IRIS_AUDIT_LOG_MAX_MB is inert and the server starts", async (ctx) => {
    if (skipUnbuilt(ctx, "Story 44.6 QA empty overrides", unbuiltReason)) return;
    const caseDir = mkdtempSync(path.join(scratch, "case-"));
    const { command, args, env } = await provided();
    const client = await connect(command, args, applyAsAgentHost({ ...keychainBase(caseDir), IRIS_AUDIT_LOG_MAX_MB: "not-a-number", IRIS_AUDIT_LOG: "/nonexistent-qa/a.log" }, env));
    expect((await client.listTools()).tools.length).toBeGreaterThan(5);
  }, 60_000);

  it("the documented residual is real: with irisMcpLauncher.auditLog SET, an ambient garbage IRIS_AUDIT_LOG_MAX_MB still stops the server", async (ctx) => {
    if (skipUnbuilt(ctx, "Story 44.6 QA empty overrides", unbuiltReason)) return;
    const caseDir = mkdtempSync(path.join(scratch, "case-"));
    const { command, args, env } = await provided({ auditLog: path.join(caseDir, "audit.log") });
    expect(env["IRIS_AUDIT_LOG"]).toBe(path.join(caseDir, "audit.log"));
    await expect(
      connect(command, args, applyAsAgentHost({ ...keychainBase(caseDir), IRIS_AUDIT_LOG_MAX_MB: "not-a-number" }, env)),
    ).rejects.toBeTruthy();
  }, 60_000);
});
