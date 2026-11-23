/**
 * DW-761 (Story 44.8, wave-9 decision #154): the shared Server Manager import
 * (`IRIS_SERVER_MANAGER=auto|required`) takes a server's definition from the FIRST settings file that names it, with the
 * folder's `.vscode/settings.json` and `*.code-workspace` files before the user's settings, and then looks the password
 * up in the OS keychain (or `IRIS_CREDENTIAL_HELPER`) BY NAME. So a repository that defines a server of the user's name
 * with its own host (and a username) used to receive the user's stored password.
 *
 * The rule now: a keychain or helper password goes only to a server whose definition does not come from a workspace-scope
 * file. A workspace-defined entry gets no stored password and a clear warning (an error under `required`) naming the
 * override, unless its own definition carries the password inline in that same file. A server defined in user settings
 * alone is byte-identical to before.
 *
 * Probe (2026-11-23, scratch HOME, injected fake keychain, no real profile or keychain): a workspace entry with a host and
 * a username claimed the slot over the user's entry and the keychain password was paired with the workspace's host
 * (127.0.0.1); a host-only workspace entry (no username of its own) was skipped by the 31-0-2 rule and the user's entry
 * won, safely; an inline password in the workspace file bypassed the keychain. Each case below pins one of those.
 *
 * Every test injects the keychain and helper, so nothing touches a real keychain.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

import { loadProfileRegistry } from "../profiles.js";
import { discoverScopedSettingsFiles, resolveServerManagerProfiles } from "../server-manager-source.js";
import { logger } from "../logger.js";

const USER_KEYCHAIN_PASSWORD = "users-keychain-password-761";
const USER_HELPER_PASSWORD = "users-helper-password-761";
const WORKSPACE_INLINE_PASSWORD = "workspace-inline-password-761";

const userDev1 = { webServer: { scheme: "https", host: "user-iris.corp.example", port: 443 }, username: "svc44" };
const workspaceDev1 = { webServer: { scheme: "http", host: "127.0.0.1", port: 52799 }, username: "svc44" };

const tmpDirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface Rig {
  env: Record<string, string>;
  /** The keychain accounts asked for, and the helper names asked for. */
  keychainAsked: string[];
  helperAsked: string[];
  deps: {
    getKeychainPassword: (name: string) => Promise<string | undefined>;
    runCredentialHelper: (command: string, name: string) => Promise<string | undefined>;
  };
  warnings: string[];
  repoDir: string;
  userSettingsFile: string;
}

/**
 * A scratch repository directory (the workspace) and a scratch HOME holding the user settings, on darwin paths. The
 * keychain and the helper both hold a password for every name, so any lookup is visible in `keychainAsked`/`helperAsked`.
 */
function rig(
  files: {
    user?: Record<string, unknown>;
    workspaceSettings?: Record<string, unknown>;
    codeWorkspace?: Record<string, unknown>;
  },
  extraEnv: Record<string, string> = {},
): Rig {
  const home = mkdtempSync(join(tmpdir(), "dw761-home-"));
  const repoDir = mkdtempSync(join(tmpdir(), "dw761-repo-"));
  tmpDirs.push(home, repoDir);
  const userDir = join(home, "Library", "Application Support", "Code", "User");
  const userSettingsFile = join(userDir, "settings.json");
  if (files.user !== undefined) {
    mkdirSync(userDir, { recursive: true });
    writeFileSync(userSettingsFile, JSON.stringify({ "intersystems.servers": files.user }), "utf8");
  }
  if (files.workspaceSettings !== undefined) {
    mkdirSync(join(repoDir, ".vscode"), { recursive: true });
    writeFileSync(join(repoDir, ".vscode", "settings.json"), JSON.stringify({ "intersystems.servers": files.workspaceSettings }), "utf8");
  }
  if (files.codeWorkspace !== undefined) {
    writeFileSync(join(repoDir, "team.code-workspace"), JSON.stringify({ folders: [], settings: { "intersystems.servers": files.codeWorkspace } }), "utf8");
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
      IRIS_CREDENTIAL_HELPER: "fake-helper",
      ...extraEnv,
    },
    keychainAsked,
    helperAsked,
    deps: {
      getKeychainPassword: async (name) => {
        keychainAsked.push(name);
        return USER_KEYCHAIN_PASSWORD;
      },
      runCredentialHelper: async (_command, name) => {
        helperAsked.push(name);
        return USER_HELPER_PASSWORD;
      },
    },
    warnings,
    repoDir,
    userSettingsFile,
  };
}

const load = (r: Rig) => loadProfileRegistry(r.env, "darwin", r.deps);

describe("DW-761: a server defined in user settings alone is unchanged", () => {
  it("the keychain password is paired with the user's host, and the profile carries no workspace flag", async () => {
    const r = rig({ user: { dev1: userDev1 } });
    const registry = await load(r);
    const profile = registry.get("dev1");

    expect(profile).toMatchObject({ host: "user-iris.corp.example", port: 443, username: "svc44", password: USER_KEYCHAIN_PASSWORD, https: true });
    expect(profile).not.toHaveProperty("workspaceScope");
    expect(r.keychainAsked).toEqual(["dev1"]);
    expect(r.warnings.filter((message) => message.includes("workspace settings file"))).toEqual([]);
  });

  it("resolveServerManagerProfiles returns the same entry shape with no workspaceScope key", () => {
    const r = rig({ user: { dev1: userDev1 } });
    const [entry] = resolveServerManagerProfiles(r.env, "darwin");
    expect(entry).toMatchObject({ name: "dev1", credentialStatus: "unresolved" });
    expect(Object.keys(entry!)).not.toContain("workspaceScope");
  });
});

describe("DW-761: a workspace-scope definition never gets a stored password", () => {
  const sources: Array<[string, Partial<Parameters<typeof rig>[0]>]> = [
    ["the folder's .vscode/settings.json overrides the user's server", { user: { dev1: userDev1 }, workspaceSettings: { dev1: workspaceDev1 } }],
    ["a .code-workspace file overrides the user's server", { user: { dev1: userDev1 }, codeWorkspace: { dev1: workspaceDev1 } }],
    ["the server is defined only in the folder's .vscode/settings.json", { workspaceSettings: { dev1: workspaceDev1 } }],
    ["the server is defined only in a .code-workspace file", { codeWorkspace: { dev1: workspaceDev1 } }],
  ];

  it.each(sources)("%s: no keychain or helper lookup, the server is excluded, and one warning names the override", async (_name, files) => {
    const r = rig(files);
    const registry = await load(r);

    expect(r.keychainAsked).toEqual([]);
    expect(r.helperAsked).toEqual([]);
    expect(registry.has("dev1")).toBe(false);
    const refusals = r.warnings.filter((message) => message.includes('server "dev1" is defined or overridden in a workspace settings file'));
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toContain("a workspace must not choose where that password is sent");
    expect(refusals[0]).toContain(files.codeWorkspace !== undefined ? "team.code-workspace" : ".vscode/settings.json");
    expect(r.warnings.join("\n")).not.toContain(USER_KEYCHAIN_PASSWORD);
    expect(r.warnings.join("\n")).not.toContain(USER_HELPER_PASSWORD);
  });

  it("resolveServerManagerProfiles flags exactly the workspace-defined entries", () => {
    const r = rig({ user: { a: userDev1 }, workspaceSettings: { b: workspaceDev1 } });
    const entries = resolveServerManagerProfiles(r.env, "darwin");
    const byName = Object.fromEntries(entries.map((entry) => [entry.name, entry]));
    expect(byName["b"]).toMatchObject({ workspaceScope: true, credentialStatus: "unresolved" });
    expect(Object.keys(byName["a"]!)).not.toContain("workspaceScope");
  });

  it("a mixed roster: the user-only server resolves, the workspace-defined one is refused", async () => {
    const r = rig({ user: { a: userDev1 }, workspaceSettings: { b: workspaceDev1 } });
    const registry = await load(r);

    expect(registry.get("a")).toMatchObject({ host: "user-iris.corp.example", password: USER_KEYCHAIN_PASSWORD });
    expect(registry.has("b")).toBe(false);
    expect(r.keychainAsked).toEqual(["a"]);
    expect(r.helperAsked).toEqual([]);
  });

  it("a workspace entry that omits its own username is skipped (31-0-2), so the user's definition still wins with the user's host", async () => {
    const r = rig({ user: { dev1: userDev1 }, workspaceSettings: { dev1: { webServer: { host: "127.0.0.1", port: 52799 } } } });
    const registry = await load(r);

    expect(registry.get("dev1")).toMatchObject({ host: "user-iris.corp.example", port: 443, password: USER_KEYCHAIN_PASSWORD });
    expect(r.keychainAsked).toEqual(["dev1"]);
  });

  it("an inline password in the workspace definition is that definition's own secret: used, the keychain is not asked, no refusal", async () => {
    const r = rig({ user: { dev1: userDev1 }, workspaceSettings: { dev1: { ...workspaceDev1, password: WORKSPACE_INLINE_PASSWORD } } });
    const registry = await load(r);
    const profile = registry.get("dev1");

    expect(profile).toMatchObject({ host: "127.0.0.1", port: 52799, password: WORKSPACE_INLINE_PASSWORD });
    expect(profile).not.toHaveProperty("workspaceScope");
    expect(r.keychainAsked).toEqual([]);
    expect(r.helperAsked).toEqual([]);
    expect(r.warnings.filter((message) => message.includes("is defined or overridden in a workspace settings file"))).toEqual([]);
  });

  it("a workspace entry without a password that shadows a user entry carrying an inline one wins the slot (first-file-wins) and is refused: the user's inline password is not imported with the workspace host", async () => {
    const r = rig({
      user: { dev1: { ...userDev1, password: WORKSPACE_INLINE_PASSWORD } },
      workspaceSettings: { dev1: workspaceDev1 },
    });
    const registry = await load(r);

    expect(registry.has("dev1")).toBe(false);
    expect(r.keychainAsked).toEqual([]);
    expect(r.helperAsked).toEqual([]);
    expect(r.warnings.filter((message) => message.includes('server "dev1" is defined or overridden in a workspace settings file'))).toHaveLength(1);
  });

  it("IRIS_SM_SETTINGS_PATHS is the operator's own choice: a file named there is not workspace scope, even when it is a .vscode/settings.json", async () => {
    const r = rig({ workspaceSettings: { dev1: workspaceDev1 } });
    r.env["IRIS_SM_SETTINGS_PATHS"] = join(r.repoDir, ".vscode", "settings.json");
    const registry = await load(r);

    expect(registry.get("dev1")).toMatchObject({ host: "127.0.0.1", password: USER_KEYCHAIN_PASSWORD });
    expect(r.keychainAsked).toEqual(["dev1"]);
  });

  it("under IRIS_SERVER_MANAGER=required the refusal is a startup error naming the server, and it carries no password", async () => {
    const r = rig({ user: { dev1: userDev1 }, workspaceSettings: { dev1: workspaceDev1 } }, { IRIS_SERVER_MANAGER: "required" });
    const failure = await load(r).then(
      () => undefined,
      (error: unknown) => error as Error,
    );

    expect(failure).toBeInstanceOf(Error);
    expect(failure!.message).toContain("IRIS_SERVER_MANAGER=required but dev1 is defined or overridden in a workspace settings file");
    expect(failure!.message).not.toContain(USER_KEYCHAIN_PASSWORD);
    expect(failure!.message).not.toContain(USER_HELPER_PASSWORD);
    expect(r.keychainAsked).toEqual([]);
    expect(r.helperAsked).toEqual([]);
  });
});

describe("DW-761: discovery reports which candidates are workspace scope", () => {
  it("workspaceFiles is the leading workspace-scope subset of files, and the user settings file is in files but not in it", () => {
    const r = rig({ codeWorkspace: { dev1: workspaceDev1 } });
    const scoped = discoverScopedSettingsFiles(r.env, "darwin");

    expect(scoped.workspaceFiles).toEqual([join(r.repoDir, ".vscode", "settings.json"), join(r.repoDir, "team.code-workspace")]);
    expect(scoped.files.slice(0, scoped.workspaceFiles.length)).toEqual(scoped.workspaceFiles);
    expect(scoped.files).toContain(r.userSettingsFile);
    expect(scoped.workspaceFiles).not.toContain(r.userSettingsFile);
  });

  it("an explicit IRIS_SM_SETTINGS_PATHS of absolute paths has no workspace-scope files", () => {
    const scoped = discoverScopedSettingsFiles({ IRIS_SM_SETTINGS_PATHS: "/a/settings.json:/b/settings.json", IRIS_SM_WORKSPACE: "/repo" }, "linux");
    expect(scoped.files).toEqual(["/a/settings.json", "/b/settings.json"]);
    expect(scoped.workspaceFiles).toEqual([]);
  });

  it("a RELATIVE IRIS_SM_SETTINGS_PATHS entry resolves against the working directory, so it is workspace scope; an absolute one beside it is not", () => {
    const scoped = discoverScopedSettingsFiles({ IRIS_SM_SETTINGS_PATHS: ".vscode/settings.json:/a/settings.json" }, "linux");
    const resolvedRelative = resolve(".vscode/settings.json");
    expect(scoped.files).toEqual([resolvedRelative, "/a/settings.json"]);
    expect(scoped.workspaceFiles).toEqual([resolvedRelative]);
  });

  it("end to end: a relative IRIS_SM_SETTINGS_PATHS that reaches the repository's settings file gets no keychain or helper password", async () => {
    const r = rig({ workspaceSettings: { dev1: workspaceDev1 } });
    const relativeToRepoFile = relative(process.cwd(), join(r.repoDir, ".vscode", "settings.json"));
    const registry = await loadProfileRegistry({ ...r.env, IRIS_SM_SETTINGS_PATHS: relativeToRepoFile }, "darwin", r.deps);

    expect(registry.has("dev1")).toBe(false);
    expect(r.keychainAsked).toEqual([]);
    expect(r.helperAsked).toEqual([]);
    expect(r.warnings.some((message) => message.includes(`server "dev1" is defined or overridden in a workspace settings file`))).toBe(true);
  });

  it("control: the same file named by its ABSOLUTE path is the operator's own and gets the keychain password", async () => {
    const r = rig({ workspaceSettings: { dev1: workspaceDev1 } });
    const registry = await loadProfileRegistry({ ...r.env, IRIS_SM_SETTINGS_PATHS: join(r.repoDir, ".vscode", "settings.json") }, "darwin", r.deps);

    expect(registry.get("dev1")?.password).toBe(USER_KEYCHAIN_PASSWORD);
    expect(r.keychainAsked).toEqual(["dev1"]);
  });
});
