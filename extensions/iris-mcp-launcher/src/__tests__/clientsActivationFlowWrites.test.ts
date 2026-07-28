/**
 * Story 33.3 QA — MCP Clients WRITE journeys through the REAL
 * `extension.ts` wiring (the E2E layer on top of dev's 33-3-1..3 activation
 * tests, which cover registration/singleton/read-only wiring only):
 * `activate()` → the real `irisMcpLauncher.manageClients` command → the real
 * `createClientsPanelOpener` composition → the real `runClientsCommand`
 * engine adapter (resolution + IRIS_* scrub + production spawn) → the REAL
 * built `iris-mcp-clients` bin against a sandbox HOME, driven entirely by
 * webview messages, asserting observable file effects (Rule #36/#54 — no
 * subprocess or engine mock anywhere).
 *
 * Coverage:
 *
 *   1. **env-reference write journey.** apply iris-dev-mcp → the sandbox
 *      config contains the entry; disable → stashed/absent; the restart hint
 *      renders after every write — all through the real extension.ts
 *      command/webview adapters.
 *   2. **explicit-mode journey.** The real `askInput` adapter
 *      (`window.showInputBox`, scripted through the Rule-#54-pinned mock)
 *      collects the typed confirmation + hidden password; the secret NEVER
 *      appears in any rendered webview HTML while the write lands it
 *      literally in the client config — the AC 31.4.3 containment bar at the
 *      highest headless tier.
 *
 * **Skip-guarded** on a built client-config dist (never fails on a pristine
 * checkout).
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ExtensionContext } from "vscode";
import { activate, deactivate } from "../extension.js";
import { mockState, resetMockState } from "./vscodeMock.js";

const CONFIG = "irisMcpLauncher";
const COMMAND_ID = "irisMcpLauncher.manageClients";
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const CLIENTS_CLI_BIN = path.join(REPO_ROOT, "packages", "client-config", "dist", "cli", "clients-cli.js");
const CLAUDE_FIXTURE = path.join(
  REPO_ROOT, "packages", "client-config", "src", "__tests__", "fixtures", "claude-code", "user.json",
);

/** A memento fake with the real `vscode.Memento` shape (get/update/keys). */
function fakeMemento(): { get(key: string): unknown; update(key: string, value: unknown): Promise<void>; keys(): readonly string[] } {
  const store = new Map<string, unknown>();
  return {
    get: (key: string) => store.get(key),
    update: (key: string, value: unknown) => {
      store.set(key, value);
      return Promise.resolve();
    },
    keys: () => [...store.keys()],
  };
}

function fakeContext(memento: ReturnType<typeof fakeMemento>): ExtensionContext {
  return { subscriptions: [], globalState: memento } as unknown as ExtensionContext;
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

/** Poll the panel's HTML until it satisfies `predicate` (real-subprocess latency). */
async function waitForPanel(predicate: (html: string) => boolean, timeoutMs = 60000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const html = thePanel().html;
    if (predicate(html)) return html;
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for the panel — last HTML (first 800 chars): ${html.slice(0, 800)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function fire(message: unknown): void {
  for (const listener of thePanel().messageListeners) {
    listener(message);
  }
}

/** Fire a message and wait for a NEW render satisfying `predicate`. */
async function fireAndWait(message: unknown, predicate: (html: string) => boolean, timeoutMs = 60000): Promise<string> {
  const before = thePanel().html;
  fire(message);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const html = thePanel().html;
    if (html !== before && predicate(html)) return html;
    if (Date.now() > deadline) {
      throw new Error(
        `timed out after ${JSON.stringify(message)} — last HTML (first 800 chars): ${html.slice(0, 800)}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

let home: string;
let priorEnv: { HOME?: string; USERPROFILE?: string; APPDATA?: string };

beforeEach(() => {
  resetMockState();
  mockState.configStore.set(`${CONFIG}.servers`, []);
  mockState.configStore.set(`${CONFIG}.packages`, ["dev"]);
  home = mkdtempSync(path.join(tmpdir(), "clients-activation-writes-"));
  writeFileSync(path.join(home, ".claude.json"), readFileSync(CLAUDE_FIXTURE, "utf8"));
  priorEnv = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, APPDATA: process.env.APPDATA };
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.APPDATA = path.join(home, "AppData", "Roaming");
});

afterEach(() => {
  deactivate();
  process.env.HOME = priorEnv.HOME;
  process.env.USERPROFILE = priorEnv.USERPROFILE;
  process.env.APPDATA = priorEnv.APPDATA;
  rmSync(home, { recursive: true, force: true });
});

const configPath = (): string => path.join(home, ".claude.json");

describe("Story 33.3 QA — MCP Clients write journeys through the REAL extension.ts (E2E layer)", () => {
  it("33-3-4: env-reference journey — apply iris-dev-mcp lands in the real config, disable stashes it, restart hint renders after every write (skip-guarded on a built dist)", async () => {
    if (!existsSync(CLIENTS_CLI_BIN)) {
      // eslint-disable-next-line no-console
      console.log(`[SKIP] 33-3-4 write journey: ${CLIENTS_CLI_BIN} is not built (run "pnpm turbo run build" first)`);
      return;
    }
    mockState.configStore.set(`${CONFIG}.developmentRepoPath`, REPO_ROOT);

    activate(fakeContext(fakeMemento()));
    await theCommand()();
    let html = await waitForPanel((h) => h.includes("Detected clients (1 of 13)"));
    expect(html).toContain("Claude Code");

    // Expand, stage, preview — the real diff render appears; nothing written.
    await fireAndWait({ type: "activateClient", client: "claude-code" }, (h) => h.includes("iris-dev-mcp"));
    await fireAndWait({ type: "toggleApplyServer", client: "claude-code", server: "iris-dev-mcp" }, (h) =>
      h.includes("iris-dev-mcp"),
    );
    const beforePreview = readFileSync(configPath(), "utf8");
    html = await fireAndWait({ type: "previewApply", client: "claude-code" }, (h) => h.includes("Pending apply"));
    expect(readFileSync(configPath(), "utf8")).toBe(beforePreview);

    // Confirm — the REAL write lands; the restart hint renders.
    html = await fireAndWait({ type: "confirmPending" }, (h) => h.includes("Restart Claude Code") && !h.includes("Pending apply"));
    expect(readFileSync(configPath(), "utf8")).toContain('"iris-dev-mcp"');

    // Disable — the entry is stashed; the hint renders again.
    await fireAndWait(
      { type: "stageToggle", client: "claude-code", action: "disable", server: "iris-dev-mcp" },
      (h) => h.includes("Pending disable"),
    );
    html = await fireAndWait({ type: "confirmPending" }, (h) => !h.includes("Pending disable"));
    expect(html).toContain("Restart Claude Code");
    expect(readFileSync(configPath(), "utf8")).not.toContain('"iris-dev-mcp"');
    // The third-party fixture entry survived both writes.
    expect(readFileSync(configPath(), "utf8")).toContain('"github-mcp"');
  }, 180000);

  it("33-3-5: explicit-mode journey — the REAL askInput adapter collects the typed confirmation + hidden password; the secret NEVER renders in the webview while the write lands it literally (skip-guarded)", async () => {
    if (!existsSync(CLIENTS_CLI_BIN)) {
      // eslint-disable-next-line no-console
      console.log(`[SKIP] 33-3-5 explicit journey: ${CLIENTS_CLI_BIN} is not built (run "pnpm turbo run build" first)`);
      return;
    }
    mockState.configStore.set(`${CONFIG}.developmentRepoPath`, REPO_ROOT);
    const SECRET = "qa3-ActivationSecret-7d2e-never-rendered";
    const answers: (string | undefined)[] = ["iris-dev-mcp", SECRET];
    mockState.inputBoxResponder = () => answers.shift();

    activate(fakeContext(fakeMemento()));
    await theCommand()();
    await waitForPanel((h) => h.includes("Detected clients (1 of 13)"));

    await fireAndWait({ type: "activateClient", client: "claude-code" }, (h) => h.includes("iris-dev-mcp"));
    await fireAndWait({ type: "setMode", client: "claude-code", mode: "explicit" }, (h) =>
      h.includes('<option value="explicit" selected>'),
    );
    await fireAndWait({ type: "toggleApplyServer", client: "claude-code", server: "iris-dev-mcp" }, (h) =>
      h.includes("iris-dev-mcp"),
    );
    const html = await fireAndWait({ type: "previewApply", client: "claude-code" }, (h) =>
      h.includes("Pending apply"),
    );

    // The REAL adapter asked twice: the typed confirmation (plain), then the
    // password (HIDDEN — the password:true gesture at the real wiring tier).
    expect(mockState.inputBoxCalls).toHaveLength(2);
    expect(mockState.inputBoxCalls[0]?.password).not.toBe(true);
    expect(mockState.inputBoxCalls[1]?.password).toBe(true);
    // The CLI's real redacted preview renders — never the literal.
    expect(html).toContain("********");
    expect(html).not.toContain(SECRET);

    await fireAndWait({ type: "confirmPending" }, (h) => !h.includes("Pending apply"));
    // The write landed the literal in the client config…
    expect(readFileSync(configPath(), "utf8")).toContain(SECRET);
    // …while NO rendered webview HTML ever carried it.
    expect(thePanel().html).not.toContain(SECRET);
  }, 180000);
});
