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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ExtensionContext } from "vscode";
import { activate, deactivate } from "../extension.js";
import { CLIENT_ROSTER_STATE_KEY } from "../clientsPanel.js";
import {
  mockState,
  resetMockState,
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
      process.env.HOME = prior.HOME;
      process.env.USERPROFILE = prior.USERPROFILE;
      process.env.APPDATA = prior.APPDATA;
      rmSync(home, { recursive: true, force: true });
    }
  }, 120000);
});
