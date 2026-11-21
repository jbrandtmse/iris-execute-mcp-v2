/**
 * Story 33.3 — MCP Clients ACTIVATION-FLOW tests: the 33.3 surfaces driven
 * through the REAL `extension.ts` wiring (`activate()` → command registration
 * → the real `createClientsPanelOpener` composition → the real engine-host
 * adapter and the real `context.globalState` memento adapter), with the
 * `vscode` module aliased to the pinned fake in `vscodeMock.ts` (the
 * governanceActivationFlow.test.ts pattern; every fake shape is one the real
 * API produces, Rule #54).
 *
 * Coverage:
 *
 *   1. **Command registration + fail-closed render.** `irisMcpLauncher
 *      .manageClients` is registered by the real `activate()`, opens exactly
 *      ONE webview panel (`irisMcpClients`, CSP-noned), and — with
 *      `developmentRepoPath` pointing at a directory WITHOUT a built CLI —
 *      renders the engine's fail-closed resolution error inline WITHOUT
 *      spawning anything (deterministic, headless-safe).
 *   2. **Singleton reveal.** A second invocation reveals the existing panel.
 *   3. **Full-stack wiring (skip-guarded on a built client-config dist).**
 *      With `developmentRepoPath` at the REAL repo and HOME sandboxed to a
 *      temp dir, the panel renders the REAL detected roster through the real
 *      subprocess, `toggleClient` persists through the REAL globalState
 *      memento adapter, and a refresh keeps the filtered selection (AC
 *      33.3.1's persisted-roster wiring). Read-only engine commands only.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ExtensionContext } from "vscode";
import { activate, deactivate } from "../extension.js";
import { CLIENT_ROSTER_STATE_KEY } from "../clientsPanel.js";
import {
  mockState,
  resetMockState,
  Uri,
} from "./vscodeMock.js";

const CONFIG = "irisMcpLauncher";
const COMMAND_ID = "irisMcpLauncher.manageClients";
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const CLIENTS_CLI_BIN = path.join(REPO_ROOT, "packages", "client-config", "dist", "cli", "clients-cli.js");
const CLAUDE_FIXTURE = path.join(
  REPO_ROOT, "packages", "client-config", "src", "__tests__", "fixtures", "claude-code", "user.json",
);

/** A memento fake with the real `vscode.Memento` shape (get/update/keys) — the one member extension.ts uses. */
function fakeMemento(): {
  store: Map<string, unknown>;
  memento: { get(key: string): unknown; update(key: string, value: unknown): Promise<void>; keys(): readonly string[] };
} {
  const store = new Map<string, unknown>();
  return {
    store,
    memento: {
      get: (key: string) => store.get(key),
      update: (key: string, value: unknown) => {
        store.set(key, value);
        return Promise.resolve();
      },
      keys: () => [...store.keys()],
    },
  };
}

/** Minimal extension context — activate() pushes to `subscriptions` and the clients panel reads `globalState`. */
function fakeContext(memento: ReturnType<typeof fakeMemento>["memento"]): ExtensionContext {
  return { subscriptions: [], globalState: memento } as unknown as ExtensionContext;
}

/** Let the async command handler (panel open → refresh → render) settle. Macrotask turns, not a timed wait. */
async function flushEditor(): Promise<void> {
  for (let i = 0; i < 60; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/**
 * Wait for a condition that depends on a REAL subprocess render.
 *
 * `flushEditor()` yields macrotask turns only — effectively instantaneous — so
 * it can never be a correct wait for the 33-3-3 flow, whose every render awaits
 * an actual `iris-mcp-clients` spawn (~1-3s). That test passed only when the
 * spawn happened to beat the flush, and went red under full-suite parallel load
 * (reproduced 2 of 3 uncached runs, 2026-07-28). Poll the observable condition
 * against a deadline instead: deterministic regardless of host load, and it
 * fails with the state it actually saw rather than an empty-string mismatch.
 */
async function waitFor(predicate: () => boolean, label: string, timeoutMs = 60000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  expect.fail(`timed out after ${timeoutMs}ms waiting for: ${label}`);
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

let memento: ReturnType<typeof fakeMemento>;

beforeEach(() => {
  resetMockState();
  memento = fakeMemento();
  mockState.configStore.set(`${CONFIG}.servers`, []);
  mockState.configStore.set(`${CONFIG}.packages`, ["dev"]);
});

afterEach(() => {
  deactivate();
});

describe("Story 33.3 — MCP Clients activation flow (real extension.ts, faked editor)", () => {
  it("33-3-1: the manageClients command is registered by the real activate() and renders the fail-closed resolution error (unbuilt repo), with a CSP-noned webview, spawning NOTHING", async () => {
    const unbuiltRepo = path.join(tmpdir(), `iris-mcp-launcher-33-3-unbuilt-${process.pid}`);
    mockState.configStore.set(`${CONFIG}.developmentRepoPath`, unbuiltRepo);

    activate(fakeContext(memento.memento));
    await flushEditor();
    await theCommand()();
    await flushEditor();

    const panel = thePanel();
    expect(panel.viewType).toBe("irisMcpClients");
    expect(panel.title).toBe("MCP Clients");
    expect(panel.options).toEqual({ enableScripts: true });
    expect(panel.html).toMatch(/script-src 'nonce-[^']+'/);
    expect(panel.html).toContain("clients CLI is not built");
  });

  it("33-3-2: a second invocation REVEALS the singleton panel instead of stacking a duplicate", async () => {
    const unbuiltRepo = path.join(tmpdir(), `iris-mcp-launcher-33-3-unbuilt-${process.pid}`);
    mockState.configStore.set(`${CONFIG}.developmentRepoPath`, unbuiltRepo);

    activate(fakeContext(memento.memento));
    await flushEditor();
    await theCommand()();
    await flushEditor();
    await theCommand()();
    await flushEditor();

    expect(mockState.webviewPanels).toHaveLength(1);
    expect(thePanel().revealCount).toBe(1);
  });

  it("33-3-3: full-stack wiring — real subprocess render of the sandbox-detected roster, toggleClient persists through the REAL globalState adapter, and a refresh keeps the filtered selection (AC 33.3.1)", async () => {
    if (!existsSync(CLIENTS_CLI_BIN)) {
      // eslint-disable-next-line no-console
      console.log(`[SKIP] 33-3-3 full-stack wiring: ${CLIENTS_CLI_BIN} is not built (run "pnpm turbo run build" first)`);
      return;
    }
    mockState.configStore.set(`${CONFIG}.developmentRepoPath`, REPO_ROOT);

    // Sandbox HOME so the REAL spawned CLI detects only what we plant (the
    // child env is the extension host's own, IRIS_*-scrubbed by the engine).
    const home = mkdtempSync(path.join(tmpdir(), "clients-activation-home-"));
    mkdirSync(home, { recursive: true });
    writeFileSync(path.join(home, ".claude.json"), readFileSync(CLAUDE_FIXTURE, "utf8"));
    const prior = {
      HOME: process.env.HOME,
      USERPROFILE: process.env.USERPROFILE,
      APPDATA: process.env.APPDATA,
    };
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.env.APPDATA = path.join(home, "AppData", "Roaming");
    try {
      activate(fakeContext(memento.memento));
      await flushEditor();
      await theCommand()();
      // Every render below awaits a REAL subprocess — wait on the observable
      // outcome, never on macrotask turns (see waitFor's doc comment).
      await waitFor(
        () => thePanel().html.includes("Detected clients ("),
        "the initial roster render to land",
      );
      await flushEditor(); // drain the promise tail so the busy guard has cleared

      // The REAL roster render: claude-code detected via the real subprocess.
      let html = thePanel().html;
      expect(html).toContain("Detected clients (1 of 13)");
      expect(html).toContain("Claude Code");
      // …and the dispositions section is NOT rendered (removed 2026-07-28,
      // Project Lead decision — README documents supported clients).
      expect(html).not.toContain("not MCP-capable");

      // Toggle the one detected client OFF through the webview message — the
      // REAL memento adapter persists the new roster.
      for (const listener of thePanel().messageListeners) {
        listener({ type: "toggleClient", client: "claude-code" });
      }
      await waitFor(
        () => Array.isArray(memento.store.get(CLIENT_ROSTER_STATE_KEY)),
        "the toggled roster to persist through the REAL globalState adapter",
      );
      expect(memento.store.get(CLIENT_ROSTER_STATE_KEY)).toEqual([]);

      // A refresh re-derives from the persisted roster: claude-code stays unchecked.
      // Clear the recorded html first, so that what the wait below sees was rendered
      // AFTER the refresh message: the previous render already shows claude-code
      // unchecked, and would satisfy the wait while the refresh's three spawns
      // (detect, modes, status) still run with the busy guard held.
      thePanel().html = "";
      for (const listener of thePanel().messageListeners) {
        listener({ type: "refresh" });
      }
      // Compound condition: the positive half proves the re-render COMPLETED, so
      // the negative half can never pass vacuously against an empty/stale html.
      await waitFor(
        () =>
          thePanel().html.includes("Detected clients (") &&
          !thePanel().html.includes(`&quot;toggleClient&quot;,&quot;client&quot;:&quot;claude-code&quot;}' checked`),
        "the refreshed render to show claude-code unchecked",
      );
      // The panel holds `busy = true` across the WHOLE refresh, and the render
      // happens INSIDE that window — a gesture sent the instant the html lands
      // is silently dropped by the busy guard (clientsPanel.ts `if (busy)
      // return`). Once the html is there the subprocess is done, so only the
      // promise tail separates it from `busy = false`: macrotask turns are the
      // right wait for THAT gap (unlike the subprocess itself).
      await flushEditor();
      html = thePanel().html;
      expect(html).not.toContain(`&quot;toggleClient&quot;,&quot;client&quot;:&quot;claude-code&quot;}' checked`);

      // Toggle it back ON — persisted again.
      for (const listener of thePanel().messageListeners) {
        listener({ type: "toggleClient", client: "claude-code" });
      }
      await waitFor(
        () => (memento.store.get(CLIENT_ROSTER_STATE_KEY) as string[] | undefined)?.length === 1,
        "the re-toggled roster to persist",
      );
      expect(memento.store.get(CLIENT_ROSTER_STATE_KEY)).toEqual(["claude-code"]);
    } finally {
      // An absent variable is deleted again, never left as the string "undefined" for the tests after this one.
      for (const key of ["HOME", "USERPROFILE", "APPDATA"] as const) {
        if (prior[key] === undefined) delete process.env[key];
        else process.env[key] = prior[key];
      }
      rmSync(home, { recursive: true, force: true });
    }
  }, 120000);
});

describe("DW-663: the working directory of the clients CLI spawn (real extension.ts, stub CLI in a temp repo)", () => {
  /** A temp "repo" whose built clients CLI records its own working directory next to itself and answers `{}`. */
  function stubRepo(): { repo: string; log: string } {
    const repo = mkdtempSync(path.join(tmpdir(), "clients-cwd-repo-"));
    const cliDir = path.join(repo, "packages", "client-config", "dist", "cli");
    mkdirSync(cliDir, { recursive: true });
    writeFileSync(
      path.join(cliDir, "clients-cli.js"),
      [
        'const fs = require("node:fs");',
        'const path = require("node:path");',
        'fs.appendFileSync(path.join(__dirname, "cwd.log"), process.cwd() + "\\n");',
        'process.stdout.write("{}\\n");',
        "",
      ].join("\n"),
    );
    return { repo, log: path.join(cliDir, "cwd.log") };
  }

  /** The working directories the stub CLI recorded while the real command opened the panel, normalized for comparison. */
  async function recordedCwds(log: string, afterActivation: () => void = () => undefined): Promise<string[]> {
    activate(fakeContext(memento.memento));
    await flushEditor();
    afterActivation();
    await theCommand()();
    const lines = (): string[] => (existsSync(log) ? readFileSync(log, "utf8").split("\n").filter((line) => line !== "") : []);
    await waitFor(() => lines().length >= 1, "the stub clients CLI to record its working directory");
    // The panel's remaining spawns follow the first: wait until the count has held still, so none outlives the temp directories.
    let last = -1;
    for (let still = 0; still < 4; ) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const count = lines().length;
      still = count === last ? still + 1 : 0;
      last = count;
    }
    return lines().map((line) => realpathSync.native(line));
  }

  /** Put an environment variable back to what it was: an absent one is deleted, never set to the string "undefined". */
  function restoreEnv(prior: Record<string, string | undefined>): void {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }

  it("with a workspace folder open the spawn runs in the FIRST folder", async () => {
    const { repo, log } = stubRepo();
    const first = mkdtempSync(path.join(tmpdir(), "clients-cwd-first-"));
    const second = mkdtempSync(path.join(tmpdir(), "clients-cwd-second-"));
    try {
      mockState.configStore.set(`${CONFIG}.developmentRepoPath`, repo);
      mockState.workspaceFolders = [
        { uri: Uri.file(first), name: "first", index: 0 },
        { uri: Uri.file(second), name: "second", index: 1 },
      ];
      const cwds = await recordedCwds(log);
      expect(cwds.length).toBeGreaterThan(0);
      expect(cwds).toEqual(cwds.map(() => realpathSync.native(first)));
    } finally {
      for (const dir of [repo, first, second]) rmSync(dir, { recursive: true, force: true });
    }
  }, 60000);

  it("an EMPTY folder list (the other shape the API may answer, not only undefined) is no folder: the spawn runs in the user's home directory (QA)", async () => {
    const { repo, log } = stubRepo();
    const home = mkdtempSync(path.join(tmpdir(), "clients-cwd-empty-home-"));
    const prior = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    try {
      mockState.configStore.set(`${CONFIG}.developmentRepoPath`, repo);
      mockState.workspaceFolders = [];
      const cwds = await recordedCwds(log);
      expect(cwds.length).toBeGreaterThan(0);
      expect(cwds).toEqual(cwds.map(() => realpathSync.native(home)));
    } finally {
      restoreEnv(prior);
      for (const dir of [repo, home]) rmSync(dir, { recursive: true, force: true });
    }
  }, 60000);

  it("the folder is read when a command runs, not when the extension activates: a folder opened after activation is the cwd of the next spawn (QA)", async () => {
    const { repo, log } = stubRepo();
    const home = mkdtempSync(path.join(tmpdir(), "clients-cwd-late-home-"));
    const folder = mkdtempSync(path.join(tmpdir(), "clients-cwd-late-folder-"));
    const prior = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    try {
      mockState.configStore.set(`${CONFIG}.developmentRepoPath`, repo);
      expect(mockState.workspaceFolders, "no folder at activation").toBeUndefined();
      const cwds = await recordedCwds(log, () => {
        mockState.workspaceFolders = [{ uri: Uri.file(folder), name: "late", index: 0 }];
      });
      expect(cwds.length).toBeGreaterThan(0);
      expect(cwds).toEqual(cwds.map(() => realpathSync.native(folder)));
    } finally {
      restoreEnv(prior);
      for (const dir of [repo, home, folder]) rmSync(dir, { recursive: true, force: true });
    }
  }, 60000);

  it("with no folder open the spawn runs in the user's home directory", async () => {
    const { repo, log } = stubRepo();
    const home = mkdtempSync(path.join(tmpdir(), "clients-cwd-home-"));
    const prior = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    try {
      mockState.configStore.set(`${CONFIG}.developmentRepoPath`, repo);
      expect(mockState.workspaceFolders).toBeUndefined();
      const cwds = await recordedCwds(log);
      expect(cwds.length).toBeGreaterThan(0);
      expect(cwds).toEqual(cwds.map(() => realpathSync.native(home)));
    } finally {
      restoreEnv(prior);
      for (const dir of [repo, home]) rmSync(dir, { recursive: true, force: true });
    }
  }, 60000);
});
