/**
 * Story 32.2 QA — governance-editor ACTIVATION-FLOW tests: the Story-32.2
 * surfaces driven through the REAL `extension.ts` wiring (`activate()` →
 * command registration → the real `createGovernancePanelOpener` composition →
 * the real engine-host adapter), with the `vscode` module aliased to the
 * pinned fake in `vscodeMock.ts` (the Story 32.3 `activationFlow.test.ts`
 * pattern; every fake shape is one the real API produces, Rule #54).
 *
 * The dev stage's 55 unit tests exercise the engine/view/panel layers through
 * their INJECTED seams; none of them prove the Story-32.2 behaviors survive
 * the one file that owns the real editor boundary. These do:
 *
 *   1. **Command registration + empty state (AC 32.2.1).**
 *      `irisMcpLauncher.openGovernanceEditor` is registered by the real
 *      `activate()`, is invocable through it, opens exactly ONE webview panel,
 *      and — with `irisMcpLauncher.governanceFile` unset — renders the empty
 *      state (J1: explicit path only) WITHOUT spawning any CLI subprocess
 *      (the empty state never reaches the engine's run path).
 *   2. **Singleton reveal.** A second invocation reveals the existing panel
 *      instead of stacking a duplicate.
 *   3. **chooseFile → settings write (AC 32.2.2's one permitted write).** The
 *      panel's Choose File… flow writes the chosen path to
 *      `irisMcpLauncher.governanceFile` at GLOBAL scope through the real
 *      `WorkspaceConfiguration.update` adapter — the extension's ONLY
 *      governance-related settings write (containment.test.ts's two-write
 *      pin). `developmentRepoPath` points at a directory WITHOUT a built CLI
 *      here so the post-write refresh exercises the engine's fail-closed
 *      resolution error WITHOUT spawning anything (no npx, no node child).
 *   4. **`IRIS_GOVERNANCE_FILE` passthrough (AC 32.2.1 + Rule #19 shape).**
 *      Through the real provide → resolve chain: a set `governanceFile`
 *      reaches the spawned server definition's env UNCHANGED as
 *      `IRIS_GOVERNANCE_FILE`; the empty-string default emits NO value (the
 *      var is explicit-null cleared like every launcher-owned passthrough —
 *      never "", never an ambient leak), so the pre-feature spawn contract is
 *      byte-stable for every value the feature does not set.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ExtensionContext } from "vscode";
import { activate, deactivate } from "../extension.js";
import type { ServerManagerApi, ServerSpec } from "../types.js";
import {
  mockState,
  resetMockState,
  ConfigurationTarget,
  McpStdioServerDefinition,
  Uri,
} from "./vscodeMock.js";

const CONFIG = "irisMcpLauncher";
const COMMAND_ID = "irisMcpLauncher.openGovernanceEditor";

/** Minimal extension context — activate() only ever pushes to `subscriptions`. */
function fakeContext(): ExtensionContext {
  return { subscriptions: [] } as unknown as ExtensionContext;
}

function specFor(name: string, password?: string): ServerSpec {
  return {
    name,
    webServer: { host: `${name}.example.com`, port: 52773, scheme: "http" },
    username: "_SYSTEM",
    ...(password !== undefined ? { password } : {}),
  };
}

/** A Server Manager extension fake with the real `{ isActive, activate(), exports }` shape. */
function serverManagerWith(
  specs: Record<string, ServerSpec | undefined>,
  roster?: string[],
): (typeof mockState)["serverManager"] {
  const names = roster ?? Object.keys(specs);
  const api: ServerManagerApi = {
    getServerNames: () => names.map((name) => ({ name, description: "", detail: "" })),
    getServerSpec: async (name: string) => specs[name],
    getAccount: () => ({ id: "acct-1", label: "Account One" }),
  };
  return { isActive: true, activate: async () => undefined, exports: api };
}

/**
 * Let the async command handler (panel open → refresh → render) and the
 * activation-time status-bar refresh settle. Yielding macrotask turns, not a
 * timed wait.
 */
async function flushEditor(): Promise<void> {
  for (let i = 0; i < 40; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function theCommand(): (...args: unknown[]) => unknown {
  const command = mockState.commands.get(COMMAND_ID);
  expect(command, `${COMMAND_ID} must be registered by the real activate()`).toBeDefined();
  return command!;
}

function thePanel(): (typeof mockState)["webviewPanels"][number] {
  expect(mockState.webviewPanels).toHaveLength(1);
  return mockState.webviewPanels[0]!;
}

function theMcpProvider(): (typeof mockState)["mcpProviders"][number]["provider"] {
  expect(mockState.mcpProviders).toHaveLength(1);
  expect(mockState.mcpProviders[0]!.id).toBe("iris-mcp-launcher");
  return mockState.mcpProviders[0]!.provider;
}

beforeEach(() => {
  resetMockState();
  // Sane defaults every test overrides selectively: one package, no server
  // filter surprises, the documented default namespace.
  mockState.configStore.set(`${CONFIG}.servers`, []);
  mockState.configStore.set(`${CONFIG}.packages`, ["dev"]);
});

afterEach(() => {
  // Clears extension.ts's module-level cachedApi/apiShapeWarningSink so the
  // next test's activate() re-reads its own scripted Server Manager fake.
  deactivate();
});

describe("Story 32.2 QA — governance editor activation flow (real extension.ts, faked editor)", () => {
  it("32-2-1: the openGovernanceEditor command is registered by the real activate() and renders the empty state (governanceFile unset) with a CSP-noned webview", async () => {
    activate(fakeContext());
    await flushEditor();

    await theCommand()();
    await flushEditor();

    const panel = thePanel();
    expect(panel.viewType).toBe("irisMcpGovernance");
    expect(panel.title).toBe("IRIS Governance");
    // J1: no file configured → the empty state with its choose-file affordance,
    // NOT a discovered/defaulted path.
    expect(panel.html).toContain("No governance file is configured");
    expect(panel.html).toContain("irisMcpLauncher.governanceFile");
    // The webview is script-enabled with a nonce-gated CSP (the safety bar).
    expect(panel.options).toEqual({ enableScripts: true });
    expect(panel.html).toMatch(/script-src 'nonce-[^']+'/);
    // The empty state never reaches the engine's run path — no CLI subprocess
    // was needed to render it, and no error banner leaked into it.
    expect(panel.html).not.toContain("banner error");
  });

  it("32-2-2: a second invocation REVEALS the singleton panel instead of stacking a duplicate", async () => {
    activate(fakeContext());
    await flushEditor();

    await theCommand()();
    await flushEditor();
    await theCommand()();
    await flushEditor();

    expect(mockState.webviewPanels).toHaveLength(1);
    expect(thePanel().revealCount).toBe(1);
  });

  it("32-2-3: Choose File… writes the picked path to irisMcpLauncher.governanceFile at GLOBAL scope through the real config adapter, then refreshes against it", async () => {
    // A developmentRepoPath WITHOUT a built CLI: the post-write refresh hits
    // the engine's fail-closed resolution error and NEVER spawns a subprocess
    // (no npx, no node child) — deterministic and headless-safe.
    const unbuiltRepo = path.join(tmpdir(), `iris-mcp-launcher-qa-32-2-unbuilt-${process.pid}`);
    mockState.configStore.set(`${CONFIG}.developmentRepoPath`, unbuiltRepo);
    const chosen = path.join(tmpdir(), `iris-mcp-launcher-qa-32-2-${process.pid}`, "chosen.json");

    activate(fakeContext());
    await flushEditor();
    await theCommand()();
    await flushEditor();

    // The user picks a file in the real open dialog (scripted resolution).
    mockState.openDialogResponse = [{ fsPath: chosen }];
    for (const listener of thePanel().messageListeners) {
      listener({ type: "chooseFile" });
    }
    await flushEditor();

    // The ONE governance-related settings write this extension makes: the
    // file PATH at Global scope (never a credential, never client config).
    expect(mockState.configUpdates).toEqual([
      { key: "governanceFile", value: chosen, target: ConfigurationTarget.Global },
    ]);
    // …and the post-write refresh ran against the chosen (missing) file
    // through the REAL engine host: the missing-file banner plus the
    // fail-closed resolution error prove the whole panel → engine-host →
    // resolveGovernanceCli chain fired on real wiring.
    expect(thePanel().html).toContain("does not exist yet");
    expect(thePanel().html).toContain("governance CLI is not built");
  });

  it("32-2-6: a WORKSPACE-scoped governanceFile makes Choose File… write to the WORKSPACE scope — a Global write would be silently shadowed by the workspace value on the next read (32.2 review)", async () => {
    const unbuiltRepo = path.join(tmpdir(), `iris-mcp-launcher-qa-32-2-unbuilt-${process.pid}`);
    mockState.configStore.set(`${CONFIG}.developmentRepoPath`, unbuiltRepo);
    // The setting already lives at WORKSPACE scope (the mock's
    // configWorkspaceStore = the real .vscode/settings.json layer).
    mockState.configWorkspaceStore.set(`${CONFIG}.governanceFile`, "C:\\old\\workspace-policy.json");
    const chosen = path.join(tmpdir(), `iris-mcp-launcher-qa-32-2-${process.pid}`, "chosen.json");

    activate(fakeContext());
    await flushEditor();
    await theCommand()();
    await flushEditor();

    mockState.openDialogResponse = [{ fsPath: chosen }];
    for (const listener of thePanel().messageListeners) {
      listener({ type: "chooseFile" });
    }
    await flushEditor();

    // The write lands in the OWNING scope — the very next read sees it.
    expect(mockState.configUpdates).toEqual([
      { key: "governanceFile", value: chosen, target: ConfigurationTarget.Workspace },
    ]);
    expect(mockState.configWorkspaceStore.get(`${CONFIG}.governanceFile`)).toBe(chosen);
  });

  it("32-2-4: a set governanceFile passes through UNCHANGED as IRIS_GOVERNANCE_FILE in the resolved spawn env (real provide → resolve chain)", async () => {
    const governanceFile = path.join(tmpdir(), `qa-32-2-policy-${process.pid}.json`);
    mockState.configStore.set(`${CONFIG}.servers`, ["prod"]);
    mockState.configStore.set(`${CONFIG}.governanceFile`, governanceFile);
    mockState.serverManager = serverManagerWith({ prod: specFor("prod", "SYS") });

    activate(fakeContext());
    await flushEditor();

    const defs = (await theMcpProvider().provideMcpServerDefinitions({
      isCancellationRequested: false,
    })) as McpStdioServerDefinition[];
    expect(defs).toHaveLength(1);

    const resolved = (await theMcpProvider().resolveMcpServerDefinition(defs[0], {
      isCancellationRequested: false,
    })) as McpStdioServerDefinition;
    expect(resolved).toBeInstanceOf(McpStdioServerDefinition);

    // The launcher is a passthrough, never a policy authority: the exact
    // setting string reaches the spawned server, and the connection half of
    // the env is untouched by the feature.
    expect(resolved.env["IRIS_GOVERNANCE_FILE"]).toBe(governanceFile);
    expect(resolved.env["IRIS_HOST"]).toBe("prod.example.com");
    expect(resolved.env["IRIS_PASSWORD"]).toBe("SYS");
  });

  it("32-2-5: the empty-string default emits NO IRIS_GOVERNANCE_FILE value — explicit-null cleared like every launcher-owned var, never an empty string, never an ambient leak (Rule #19 shape)", async () => {
    mockState.configStore.set(`${CONFIG}.servers`, ["prod"]);
    // governanceFile deliberately UNSET (the documented default "").
    mockState.serverManager = serverManagerWith({ prod: specFor("prod", "SYS") });

    activate(fakeContext());
    await flushEditor();

    const defs = (await theMcpProvider().provideMcpServerDefinitions({
      isCancellationRequested: false,
    })) as McpStdioServerDefinition[];
    expect(defs).toHaveLength(1);

    const resolved = (await theMcpProvider().resolveMcpServerDefinition(defs[0], {
      isCancellationRequested: false,
    })) as McpStdioServerDefinition;

    // Unset means CLEARED: the child gets an explicit null (removing any
    // ambient IRIS_GOVERNANCE_FILE the extension host's shell exported) — the
    // identical treatment IRIS_GOVERNANCE / IRIS_GOVERNANCE_PRESET already
    // had pre-feature. No code path emits "" as a value.
    expect(resolved.env["IRIS_GOVERNANCE_FILE"]).toBeNull();
    expect(resolved.env["IRIS_GOVERNANCE"]).toBeNull();
    expect(resolved.env["IRIS_GOVERNANCE_PRESET"]).toBeNull();
    for (const [name, value] of Object.entries(resolved.env)) {
      expect(value, `${name} must never be an empty string`).not.toBe("");
    }
  });
});

describe("DW-663: the working directory of the governance CLI spawn (real extension.ts, stub CLI in a temp repo)", () => {
  /**
   * Open the editor through the real command with a stub governance CLI that records its own working directory, with HOME sandboxed to
   * a temp directory, and return the directories it ran in and the sandboxed home. `folder` is what `workspace.workspaceFolders` holds.
   */
  async function governanceCwds(folder?: string): Promise<{ cwds: string[]; home: string }> {
    const repo = mkdtempSync(path.join(tmpdir(), "governance-cwd-repo-"));
    const home = mkdtempSync(path.join(tmpdir(), "governance-cwd-home-"));
    const cliDir = path.join(repo, "packages", "shared", "dist", "cli");
    mkdirSync(cliDir, { recursive: true });
    writeFileSync(
      path.join(cliDir, "governance-cli.js"),
      [
        'const fs = require("node:fs");',
        'const path = require("node:path");',
        'fs.appendFileSync(path.join(__dirname, "cwd.log"), process.cwd() + "\\n");',
        'process.stdout.write("{}\\n");',
        "",
      ].join("\n"),
    );
    const log = path.join(cliDir, "cwd.log");
    const policy = path.join(repo, "policy.json");
    writeFileSync(policy, "{}\n");
    const prior = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    try {
      mockState.configStore.set(`${CONFIG}.developmentRepoPath`, repo);
      mockState.configStore.set(`${CONFIG}.governanceFile`, policy);
      if (folder !== undefined) mockState.workspaceFolders = [{ uri: Uri.file(folder), name: "workspace", index: 0 }];
      activate(fakeContext());
      await flushEditor();
      await theCommand()();
      const started = Date.now();
      while (!existsSync(log) && Date.now() - started < 60000) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(existsSync(log), "the stub governance CLI must record its working directory").toBe(true);
      // Let the panel's remaining spawns finish before the directories go away.
      await flushEditor();
      const cwds = readFileSync(log, "utf8")
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => realpathSync.native(line));
      return { cwds, home: realpathSync.native(home) };
    } finally {
      for (const key of ["HOME", "USERPROFILE"] as const) {
        if (prior[key] === undefined) delete process.env[key];
        else process.env[key] = prior[key];
      }
      for (const dir of [repo, home]) rmSync(dir, { recursive: true, force: true });
    }
  }

  it("the editor's CLI runs in the user's home directory, the directory the server definitions start in", async () => {
    const { cwds, home } = await governanceCwds();
    expect(cwds.length).toBeGreaterThan(0);
    expect(cwds).toEqual(cwds.map(() => home));
  }, 120000);

  it("a workspace folder being open changes nothing: the governance CLI still runs in the home directory, never the folder (QA; the clients CLI is the one that follows the folder)", async () => {
    const folder = mkdtempSync(path.join(tmpdir(), "governance-cwd-folder-"));
    try {
      const { cwds, home } = await governanceCwds(folder);
      expect(cwds.length).toBeGreaterThan(0);
      expect(cwds).toEqual(cwds.map(() => home));
      expect(cwds).not.toContain(realpathSync.native(folder));
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  }, 120000);
});
