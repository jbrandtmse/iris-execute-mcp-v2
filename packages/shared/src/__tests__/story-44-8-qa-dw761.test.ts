/**
 * Story 44.8 QA for DW-761 (the shared Server Manager import never pairs a keychain or helper password with a
 * definition a workspace-scope settings file chose). Fills the gaps `dw761-workspace-scope-credentials.test.ts` leaves,
 * without repeating it:
 *
 * - `.code-workspace` vs `.vscode/settings.json` precedence and which file the refusal names (first file wins, the shadowed
 *   entry adds no second refusal; two `.code-workspace` files resolve in filename order);
 * - the EXACT `required` error text (one name, several names, mixed with an exhausted user-only server) and the exact
 *   `auto` warning text;
 * - the clean-path back-compat pins (Rule #19): a user-only server's whole entry, whole profile and exhaustion texts, whose
 *   literals were captured by running the PRE-CHANGE source (`git show ebf1e703:packages/shared/src/...`) on the same
 *   fixture (Rule #36), and "no warning at all" for a user-only roster;
 * - the operator's own `IRIS_SM_SETTINGS_PATHS` (a `.code-workspace` path included), the cwd-derived workspace, Linux
 *   user-settings paths, and the `IRIS_SM_SERVERS` allow-list;
 * - roster order and the marker never reaching a registered profile.
 *
 * Every test injects the keychain and helper, so nothing touches a real keychain, and HOME is a scratch directory.
 * Shapes (Rule #54): the entries handed to the credential chain come from the real `resolveServerManagerProfiles`.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveServerManagerCredentials } from "../credential-chain.js";
import { loadProfileRegistry } from "../profiles.js";
import { discoverSettingsFiles, resolveServerManagerProfiles } from "../server-manager-source.js";
import { logger } from "../logger.js";

const KEYCHAIN_PASSWORD = "qa-users-keychain-password-761";
const HELPER_PASSWORD = "qa-users-helper-password-761";
const INLINE_PASSWORD = "qa-workspace-inline-password-761";

const userDev1 = { webServer: { scheme: "https", host: "user-iris.corp.example", port: 443 }, username: "svc44" };
const workspaceDev1 = { webServer: { scheme: "http", host: "127.0.0.1", port: 52799 }, username: "svc44" };

const WORKSPACE_REFUSAL_TAIL =
  "so no stored password (OS keychain or IRIS_CREDENTIAL_HELPER) was used: a workspace must not choose where that " +
  "password is sent. Define each in your user settings under a name no workspace file uses, give it its own inline " +
  "password in that workspace file, or define it with its full connection fields via IRIS_PROFILES.";

const tmpDirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface Files {
  user?: Record<string, unknown>;
  workspaceSettings?: Record<string, unknown>;
  /** `.code-workspace` files by file name. */
  codeWorkspaces?: Record<string, Record<string, unknown>>;
}

interface Rig {
  env: Record<string, string>;
  home: string;
  repoDir: string;
  keychainAsked: string[];
  helperAsked: string[];
  deps: {
    getKeychainPassword: (name: string) => Promise<string | undefined>;
    runCredentialHelper: (command: string, name: string) => Promise<string | undefined>;
  };
  warnings: string[];
}

/**
 * A scratch repository directory and a scratch HOME. The keychain and helper hold a password for every name except those in
 * `keychainMissing`, so any lookup is visible in `keychainAsked`/`helperAsked`.
 */
function rig(files: Files, extraEnv: Record<string, string> = {}, keychainMissing: readonly string[] = [], helper = true): Rig {
  const home = mkdtempSync(join(tmpdir(), "qa44-8-home-"));
  const repoDir = mkdtempSync(join(tmpdir(), "qa44-8-repo-"));
  tmpDirs.push(home, repoDir);
  if (files.user !== undefined) {
    const userDir = join(home, "Library", "Application Support", "Code", "User");
    mkdirSync(userDir, { recursive: true });
    writeFileSync(join(userDir, "settings.json"), JSON.stringify({ "intersystems.servers": files.user }), "utf8");
  }
  if (files.workspaceSettings !== undefined) {
    mkdirSync(join(repoDir, ".vscode"), { recursive: true });
    writeFileSync(join(repoDir, ".vscode", "settings.json"), JSON.stringify({ "intersystems.servers": files.workspaceSettings }), "utf8");
  }
  for (const [fileName, servers] of Object.entries(files.codeWorkspaces ?? {})) {
    writeFileSync(join(repoDir, fileName), JSON.stringify({ folders: [], settings: { "intersystems.servers": servers } }), "utf8");
  }
  const keychainAsked: string[] = [];
  const helperAsked: string[] = [];
  const warnings: string[] = [];
  vi.spyOn(logger, "warn").mockImplementation((message: string) => {
    warnings.push(message);
  });
  return {
    env: {
      HOME: home,
      IRIS_SERVER_MANAGER: "auto",
      IRIS_SM_WORKSPACE: repoDir,
      IRIS_USERNAME: "_SYSTEM",
      IRIS_PASSWORD: "SYS",
      ...(helper ? { IRIS_CREDENTIAL_HELPER: "fake-helper" } : {}),
      ...extraEnv,
    },
    home,
    repoDir,
    keychainAsked,
    helperAsked,
    deps: {
      getKeychainPassword: async (name) => {
        keychainAsked.push(name);
        return keychainMissing.includes(name) ? undefined : KEYCHAIN_PASSWORD;
      },
      runCredentialHelper: async (_command, name) => {
        helperAsked.push(name);
        return keychainMissing.includes(name) ? undefined : HELPER_PASSWORD;
      },
    },
    warnings,
  };
}

const load = (r: Rig) => loadProfileRegistry(r.env, "darwin", r.deps);
const refusalsFor = (r: Rig, name: string): string[] =>
  r.warnings.filter((message) => message.includes(`server "${name}" is defined or overridden in a workspace settings file`));

async function failureOf(r: Rig): Promise<Error | undefined> {
  return load(r).then(
    () => undefined,
    (error: unknown) => error as Error,
  );
}

describe("Story 44.8 QA / DW-761: .code-workspace vs .vscode/settings.json", () => {
  it("both define dev1: the folder's .vscode/settings.json claims the slot, is the file named, and the shadowed .code-workspace entry adds no second refusal", async () => {
    const r = rig({
      user: { dev1: userDev1 },
      workspaceSettings: { dev1: workspaceDev1 },
      codeWorkspaces: { "team.code-workspace": { dev1: { ...workspaceDev1, webServer: { host: "10.9.9.9", port: 1 } } } },
    });

    const registry = await load(r);

    expect(registry.has("dev1")).toBe(false);
    const refusals = refusalsFor(r, "dev1");
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toContain(join(r.repoDir, ".vscode", "settings.json"));
    expect(refusals[0]).not.toContain("team.code-workspace");
    expect(r.keychainAsked).toEqual([]);
    expect(r.helperAsked).toEqual([]);
  });

  it(".vscode/settings.json defines a DIFFERENT server: dev1 comes from the .code-workspace file, which is the file named for it", async () => {
    const r = rig({
      user: { dev1: userDev1 },
      workspaceSettings: { other: workspaceDev1 },
      codeWorkspaces: { "team.code-workspace": { dev1: workspaceDev1 } },
    });

    const registry = await load(r);

    expect(registry.has("dev1")).toBe(false);
    expect(registry.has("other")).toBe(false);
    expect(refusalsFor(r, "dev1")[0]).toContain(join(r.repoDir, "team.code-workspace"));
    expect(refusalsFor(r, "other")[0]).toContain(join(r.repoDir, ".vscode", "settings.json"));
    expect(r.keychainAsked).toEqual([]);
  });

  it("two .code-workspace files define dev1: the first by filename claims the slot and is named", async () => {
    const r = rig({
      codeWorkspaces: { "b-team.code-workspace": { dev1: workspaceDev1 }, "a-team.code-workspace": { dev1: workspaceDev1 } },
    });

    await load(r);

    const refusals = refusalsFor(r, "dev1");
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toContain(join(r.repoDir, "a-team.code-workspace"));
  });

  it("an inline password in a .code-workspace entry is that definition's own secret: used, nothing asked, no refusal", async () => {
    const r = rig({ user: { dev1: userDev1 }, codeWorkspaces: { "team.code-workspace": { dev1: { ...workspaceDev1, password: INLINE_PASSWORD } } } });

    const registry = await load(r);

    expect(registry.get("dev1")).toMatchObject({ host: "127.0.0.1", port: 52799, password: INLINE_PASSWORD });
    expect(r.keychainAsked).toEqual([]);
    expect(r.helperAsked).toEqual([]);
    expect(refusalsFor(r, "dev1")).toEqual([]);
  });

  it("first file wins over a LATER inline password: a passwordless .vscode entry shadows a .code-workspace entry that carries one, and is refused (the inline password is not imported)", async () => {
    const r = rig({
      workspaceSettings: { dev1: workspaceDev1 },
      codeWorkspaces: { "team.code-workspace": { dev1: { ...workspaceDev1, password: INLINE_PASSWORD } } },
    });

    const registry = await load(r);

    expect(registry.has("dev1")).toBe(false);
    expect(refusalsFor(r, "dev1")).toHaveLength(1);
    expect(r.keychainAsked).toEqual([]);
    expect(r.warnings.join("\n")).not.toContain(INLINE_PASSWORD);
  });
});

describe("Story 44.8 QA / DW-761: exact warning and error texts", () => {
  it("auto: the exact refusal warning, naming the file", async () => {
    const r = rig({ user: { dev1: userDev1 }, workspaceSettings: { dev1: workspaceDev1 } });
    await load(r);

    expect(refusalsFor(r, "dev1")).toEqual([
      `IRIS_SERVER_MANAGER: server "dev1" is defined or overridden in a workspace settings file ` +
        `(${join(r.repoDir, ".vscode", "settings.json")}), so no stored password (OS keychain or IRIS_CREDENTIAL_HELPER) was ` +
        `used for it: a workspace must not choose where that password is sent. Define "dev1" in your user settings under a ` +
        `name no workspace file uses, or define it with its full connection fields via IRIS_PROFILES.`,
    ]);
  });

  it("required, one refused server: the exact error text", async () => {
    const r = rig({ user: { dev1: userDev1 }, workspaceSettings: { dev1: workspaceDev1 } }, { IRIS_SERVER_MANAGER: "required" });

    const failure = await failureOf(r);

    expect(failure?.message).toBe(`IRIS_SERVER_MANAGER=required but dev1 is defined or overridden in a workspace settings file, ${WORKSPACE_REFUSAL_TAIL}`);
  });

  it("required, several refused servers: one error naming every one, in roster order, with the plural verb", async () => {
    const r = rig(
      { user: { dev1: userDev1 }, workspaceSettings: { dev2: workspaceDev1, dev3: workspaceDev1 }, codeWorkspaces: { "team.code-workspace": { dev1: workspaceDev1 } } },
      { IRIS_SERVER_MANAGER: "required" },
    );

    const failure = await failureOf(r);

    expect(failure?.message).toBe(
      `IRIS_SERVER_MANAGER=required but dev2, dev3, dev1 are defined or overridden in a workspace settings file, ${WORKSPACE_REFUSAL_TAIL}`,
    );
    // Every entry had its chance (the throw is aggregated after the loop), so each refusal was also warned.
    expect(refusalsFor(r, "dev2")).toHaveLength(1);
    expect(refusalsFor(r, "dev3")).toHaveLength(1);
    expect(refusalsFor(r, "dev1")).toHaveLength(1);
  });

  it("required, a refused workspace server AND an exhausted user-only server: both parts, exhaustion first", async () => {
    const r = rig(
      { user: { solo: userDev1 }, workspaceSettings: { dev1: workspaceDev1 } },
      { IRIS_SERVER_MANAGER: "required" },
      ["solo"],
    );

    const failure = await failureOf(r);

    expect(failure?.message).toBe(
      `IRIS_SERVER_MANAGER=required but the credential chain could not resolve a password for: solo. Remediation per profile: ` +
        `run "iris-mcp-credentials set <name>" (OS keychain), set IRIS_CREDENTIAL_HELPER, or define the profile with its full ` +
        `connection fields via IRIS_PROFILES. ` +
        `IRIS_SERVER_MANAGER=required but dev1 is defined or overridden in a workspace settings file, ${WORKSPACE_REFUSAL_TAIL}`,
    );
  });

  it("required, only an exhausted user-only server: the pre-change error text, unchanged (Rule #19)", async () => {
    const r = rig({ user: { solo: userDev1 } }, { IRIS_SERVER_MANAGER: "required" }, ["solo"]);

    const failure = await failureOf(r);

    expect(failure?.message).toBe(
      `IRIS_SERVER_MANAGER=required but the credential chain could not resolve a password for: solo. Remediation per profile: ` +
        `run "iris-mcp-credentials set <name>" (OS keychain), set IRIS_CREDENTIAL_HELPER, or define the profile with its full ` +
        `connection fields via IRIS_PROFILES.`,
    );
  });

  it("required: a workspace server with its own inline password plus a user-only server resolve together without throwing", async () => {
    const r = rig(
      { user: { solo: userDev1 }, workspaceSettings: { dev1: { ...workspaceDev1, password: INLINE_PASSWORD } } },
      { IRIS_SERVER_MANAGER: "required" },
    );

    const registry = await load(r);

    expect(registry.get("dev1")).toMatchObject({ password: INLINE_PASSWORD, host: "127.0.0.1" });
    expect(registry.get("solo")).toMatchObject({ password: KEYCHAIN_PASSWORD, host: "user-iris.corp.example" });
    expect(r.keychainAsked).toEqual(["solo"]);
    expect(r.warnings.filter((message) => message.includes("workspace settings file"))).toEqual([]);
  });
});

describe("Story 44.8 QA / AC-3 (Rule #19): a user-only roster is byte-identical to the pre-change import", () => {
  it("the whole entry resolveServerManagerProfiles returns", () => {
    const r = rig({ user: { dev1: userDev1 } });
    const sourceFile = join(r.home, "Library", "Application Support", "Code", "User", "settings.json");

    expect(resolveServerManagerProfiles(r.env, "darwin")).toEqual([
      {
        name: "dev1",
        host: "user-iris.corp.example",
        port: 443,
        https: true,
        username: "svc44",
        namespace: "USER",
        sourceFile,
        acceptLanguage: "en-US,en;q=0.9",
        baseUrl: "https://user-iris.corp.example:443",
        password: "",
        source: "server-manager",
        timeout: 60000,
        credentialStatus: "unresolved",
      },
    ]);
  });

  it("the whole registered profile, the keychain asked once for the server name, and no warning at all", async () => {
    const r = rig({ user: { dev1: userDev1 } });
    const sourceFile = join(r.home, "Library", "Application Support", "Code", "User", "settings.json");

    const registry = await load(r);

    expect(registry.get("dev1")).toEqual({
      name: "dev1",
      host: "user-iris.corp.example",
      port: 443,
      https: true,
      username: "svc44",
      namespace: "USER",
      sourceFile,
      acceptLanguage: "en-US,en;q=0.9",
      baseUrl: "https://user-iris.corp.example:443",
      source: "server-manager",
      timeout: 60000,
      password: KEYCHAIN_PASSWORD,
    });
    expect(r.keychainAsked).toEqual(["dev1"]);
    expect(r.warnings).toEqual([]);
  });

  it("a user-only server with no password anywhere: the exact pre-change exhaustion warning, auto mode drops it", async () => {
    const r = rig({ user: { solo: userDev1 } }, {}, ["solo"]);

    const registry = await load(r);

    expect(registry.has("solo")).toBe(false);
    expect(r.warnings).toEqual([
      `IRIS_SERVER_MANAGER: server "solo" has no password available — the credential chain (env, OS keychain, credential helper) ` +
        `was exhausted. Remediation: run "iris-mcp-credentials set solo" (OS keychain), set IRIS_CREDENTIAL_HELPER to a command ` +
        `that can supply it, or define "solo" with its full connection fields (host, port, username, password) via IRIS_PROFILES.`,
    ]);
  });

  it("an inline password in the USER file is imported as before: no keychain lookup, and only the existing deprecation warning (never a workspace refusal)", async () => {
    const r = rig({ user: { dev1: { ...userDev1, password: INLINE_PASSWORD } } });

    const registry = await load(r);

    expect(registry.get("dev1")).toMatchObject({ password: INLINE_PASSWORD, host: "user-iris.corp.example" });
    expect(r.keychainAsked).toEqual([]);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain('uses a deprecated inline "password" field in intersystems.servers');
    expect(r.warnings.filter((message) => message.includes("workspace settings file"))).toEqual([]);
  });
});

describe("Story 44.8 QA / DW-761: which files count as workspace scope", () => {
  const flagOf = (entries: ReturnType<typeof resolveServerManagerProfiles>, name: string) =>
    entries.find((entry) => entry.name === name)?.workspaceScope;

  it("IRIS_SM_SETTINGS_PATHS naming a .code-workspace file (and the repository's .vscode/settings.json) is the operator's own: nothing is flagged and the keychain password is used", async () => {
    const r = rig({ workspaceSettings: { dev1: workspaceDev1 }, codeWorkspaces: { "team.code-workspace": { dev2: workspaceDev1 } } });
    r.env["IRIS_SM_SETTINGS_PATHS"] = [join(r.repoDir, ".vscode", "settings.json"), join(r.repoDir, "team.code-workspace")].join(":");

    const entries = resolveServerManagerProfiles(r.env, "darwin");
    const registry = await load(r);

    expect(entries.map((entry) => entry.name).sort()).toEqual(["dev1", "dev2"]);
    expect(entries.some((entry) => "workspaceScope" in entry)).toBe(false);
    expect(registry.get("dev1")).toMatchObject({ host: "127.0.0.1", password: KEYCHAIN_PASSWORD });
    expect(registry.get("dev2")).toMatchObject({ host: "127.0.0.1", password: KEYCHAIN_PASSWORD });
    expect(r.warnings.filter((message) => message.includes("workspace settings file"))).toEqual([]);
  });

  it("IRIS_SM_SETTINGS_PATHS replaces discovery: the repository's own .vscode/settings.json is never read, so it cannot shadow the user's server", async () => {
    const r = rig({ user: { dev1: userDev1 }, workspaceSettings: { dev1: workspaceDev1 } });
    r.env["IRIS_SM_SETTINGS_PATHS"] = join(r.home, "Library", "Application Support", "Code", "User", "settings.json");

    const registry = await load(r);

    expect(registry.get("dev1")).toMatchObject({ host: "user-iris.corp.example", password: KEYCHAIN_PASSWORD });
    expect(r.warnings).toEqual([]);
  });

  it("without IRIS_SM_WORKSPACE the working directory is the workspace: its .vscode/settings.json is flagged, the user's entry is not", () => {
    const r = rig({ user: { solo: userDev1 }, workspaceSettings: { dev1: workspaceDev1 } });
    delete r.env["IRIS_SM_WORKSPACE"];

    const entries = resolveServerManagerProfiles(r.env, "darwin", r.repoDir);

    expect(flagOf(entries, "dev1")).toBe(true);
    expect(flagOf(entries, "solo")).toBeUndefined();
    expect(discoverSettingsFiles(r.env, "darwin", r.repoDir)[0]).toBe(join(r.repoDir, ".vscode", "settings.json"));
  });

  it("Linux: the user's XDG and ~/.config settings files are user scope, the workspace file is flagged", async () => {
    const r = rig({ workspaceSettings: { dev1: workspaceDev1 } });
    const xdg = mkdtempSync(join(tmpdir(), "qa44-8-xdg-"));
    tmpDirs.push(xdg);
    mkdirSync(join(xdg, "Code", "User"), { recursive: true });
    writeFileSync(join(xdg, "Code", "User", "settings.json"), JSON.stringify({ "intersystems.servers": { solo: userDev1 } }), "utf8");
    mkdirSync(join(r.home, ".config", "Code", "User"), { recursive: true });
    writeFileSync(join(r.home, ".config", "Code", "User", "settings.json"), JSON.stringify({ "intersystems.servers": { homecfg: userDev1 } }), "utf8");
    r.env["XDG_CONFIG_HOME"] = xdg;

    const entries = resolveServerManagerProfiles(r.env, "linux");
    const registry = await loadProfileRegistry(r.env, "linux", r.deps);

    expect(flagOf(entries, "dev1")).toBe(true);
    expect(flagOf(entries, "solo")).toBeUndefined();
    expect(flagOf(entries, "homecfg")).toBeUndefined();
    expect(registry.has("dev1")).toBe(false);
    expect(registry.get("solo")).toMatchObject({ password: KEYCHAIN_PASSWORD });
    expect(registry.get("homecfg")).toMatchObject({ password: KEYCHAIN_PASSWORD });
    expect(r.keychainAsked.sort()).toEqual(["homecfg", "solo"]);
  });

  it("the IRIS_SM_SERVERS allow-list: a workspace-defined server it leaves out is never considered (no refusal, no lookup); one it names is refused", async () => {
    const left = rig({ user: { solo: userDev1 }, workspaceSettings: { dev1: workspaceDev1 } }, { IRIS_SM_SERVERS: "solo" });
    const leftRegistry = await load(left);
    expect(leftRegistry.has("solo")).toBe(true);
    expect(refusalsFor(left, "dev1")).toEqual([]);
    expect(left.keychainAsked).toEqual(["solo"]);
    vi.restoreAllMocks();

    const named = rig({ user: { solo: userDev1 }, workspaceSettings: { dev1: workspaceDev1 } }, { IRIS_SM_SERVERS: "dev1" });
    const namedRegistry = await load(named);
    expect(namedRegistry.has("dev1")).toBe(false);
    expect(refusalsFor(named, "dev1")).toHaveLength(1);
    expect(named.keychainAsked).toEqual([]);
  });
});

describe("Story 44.8 QA / DW-761: the credential chain over a real roster", () => {
  it("a refused workspace entry in the middle drops out and the others keep roster order; no registered profile carries the marker or the status", async () => {
    const r = rig({
      user: { a: userDev1, c: userDev1 },
      workspaceSettings: { b: workspaceDev1, d: { ...workspaceDev1, password: INLINE_PASSWORD } },
    });
    const entries = resolveServerManagerProfiles(r.env, "darwin");
    expect(entries.map((entry) => [entry.name, entry.credentialStatus, entry.workspaceScope])).toEqual([
      ["b", "unresolved", true],
      ["d", "resolved", true],
      ["a", "unresolved", undefined],
      ["c", "unresolved", undefined],
    ]);

    const profiles = await resolveServerManagerCredentials(entries, { env: r.env, mode: "auto", ...r.deps });

    expect(profiles.map((profile) => profile.name)).toEqual(["d", "a", "c"]);
    for (const profile of profiles) {
      expect(Object.keys(profile)).not.toContain("workspaceScope");
      expect(Object.keys(profile)).not.toContain("credentialStatus");
    }
    expect(profiles.find((profile) => profile.name === "d")?.password).toBe(INLINE_PASSWORD);
    expect(r.keychainAsked).toEqual(["a", "c"]);
    expect(r.helperAsked).toEqual([]);
  });

  it("the refusal does not consult the helper even when the keychain is empty for that name (no fallthrough to link 3)", async () => {
    const r = rig({ workspaceSettings: { dev1: workspaceDev1 } }, {}, ["dev1"]);

    await load(r);

    expect(r.keychainAsked).toEqual([]);
    expect(r.helperAsked).toEqual([]);
    expect(refusalsFor(r, "dev1")).toHaveLength(1);
    expect(r.warnings.filter((message) => message.includes("has no password available"))).toEqual([]);
  });
});
