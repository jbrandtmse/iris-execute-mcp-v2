/**
 * Story 32.3 QA — activation-flow tests: the NEW Story-32.3 launcher
 * behaviors driven through the REAL `extension.ts` wiring (`activate()` →
 * command + status-bar + MCP provider registration → provide/resolve), with
 * the `vscode` module aliased to the pinned fake in `vscodeMock.ts` (shapes
 * the real API can genuinely produce, per Rule #54 — see that file's header).
 *
 * Every other test in this suite exercises the pure planning/credential/UI
 * modules through their injected seams; none of them prove the Story-32.3
 * behaviors survive the one file that owns the real editor boundary. These
 * do:
 *
 *   1. **31-6-1 (warning dedupe) + 31-5-2 (effective count)** — the stale-"all"
 *      warning fires exactly ONCE across repeated provides, and the status bar
 *      reports the effective registered-server count, through the real
 *      activation-time refresh.
 *   2. **31-5-2 (divergence) + 31-6-4 (dev-mode wording)** — duplicates and
 *      mistyped names show the effective-vs-raw divergence note; an invalid
 *      `developmentRepoPath` words the dev-mode line from the ZERO registered
 *      count, with its aggregated warning also deduped.
 *   3. **31-5-3 (confirm-before-empty)** — unchecking every server asks before
 *      writing `[]` (= expose ALL); cancelling writes nothing, "Expose All"
 *      writes `[]` to the owning scope, through the real registered command.
 *   4. **31-4-3 (empty-username refusal)** — an empty resolved username
 *      refuses the start with ONE clear message and NO authentication prompt,
 *      through the real registered `resolveMcpServerDefinition`.
 */
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
} from "./vscodeMock.js";

const CONFIG = "irisMcpLauncher";

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
 * Let the async activation-time status-bar refresh (one
 * `providePlannedDefinitions()` behind several awaited promises) settle.
 * Yielding macrotask turns, not a timed wait.
 */
async function flushEditor(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function theStatusBarItem(): (typeof mockState)["statusBarItems"][number] {
  expect(mockState.statusBarItems).toHaveLength(1);
  return mockState.statusBarItems[0]!;
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

describe("Story 32.3 QA — activation flow (real extension.ts, faked editor)", () => {
  it('31-6-1 + 31-5-2: the stale-"all" warning fires exactly once across repeated provides, and the status bar shows the EFFECTIVE registered count', async () => {
    mockState.configStore.set(`${CONFIG}.servers`, ["prod"]);
    mockState.configStore.set(`${CONFIG}.packages`, ["all", "dev"]); // "all" is a removed key
    mockState.serverManager = serverManagerWith({ prod: specFor("prod", "SYS") });

    activate(fakeContext());
    await flushEditor();

    const staleAllWarnings = () =>
      mockState.warnings.filter((message) => message.includes('removed "all" package key'));
    // The activation-time refresh (one providePlannedDefinitions) fired it once.
    expect(staleAllWarnings()).toHaveLength(1);
    expect(theStatusBarItem().text).toBe("$(server) IRIS MCP: 1");
    expect(theStatusBarItem().shown).toBe(true);

    // A second provide (VS Code re-enumerates on MCP refresh) must NOT re-fire.
    const defs = await theMcpProvider().provideMcpServerDefinitions({
      isCancellationRequested: false,
    });
    expect(defs).toHaveLength(1);
    expect(staleAllWarnings()).toHaveLength(1);
  });

  it("31-5-2: duplicates and mistyped names surface the effective-vs-raw divergence note", async () => {
    mockState.configStore.set(`${CONFIG}.servers`, ["prod", "prod", "typo"]);
    mockState.serverManager = serverManagerWith({ prod: specFor("prod", "SYS") });

    activate(fakeContext());
    await flushEditor();

    expect(theStatusBarItem().text).toBe("$(server) IRIS MCP: 1");
    expect(theStatusBarItem().tooltip).toContain(
      "(1 of 3 selected servers currently registered",
    );
  });

  it("31-6-4 + 31-6-1: an invalid developmentRepoPath words the dev-mode line from ZERO registrations, and its aggregated warning is deduped", async () => {
    const missingRepoPath = path.join(tmpdir(), `iris-mcp-launcher-missing-${process.pid}`);
    mockState.configStore.set(`${CONFIG}.servers`, ["prod"]);
    mockState.configStore.set(`${CONFIG}.developmentRepoPath`, missingRepoPath);
    mockState.serverManager = serverManagerWith({ prod: specFor("prod", "SYS") });

    activate(fakeContext());
    await flushEditor();

    const devPathWarnings = () =>
      mockState.warnings.filter((message) => message.includes("developmentRepoPath"));
    expect(devPathWarnings()).toHaveLength(1);
    expect(devPathWarnings()[0]).toContain("does not exist or is not a directory");
    expect(theStatusBarItem().text).toBe("$(server) IRIS MCP: 0");
    expect(theStatusBarItem().tooltip).toContain("NO servers were registered from it");

    // A second provide does not re-fire the aggregated warning.
    const defs = await theMcpProvider().provideMcpServerDefinitions({
      isCancellationRequested: false,
    });
    expect(defs).toHaveLength(0);
    expect(devPathWarnings()).toHaveLength(1);
  });

  it("31-5-3: unchecking every server asks before writing [] — cancel writes nothing, Expose All writes [] to the owning scope", async () => {
    mockState.configStore.set(`${CONFIG}.servers`, ["prod"]);
    mockState.serverManager = serverManagerWith({ prod: specFor("prod", "SYS") });
    // The user confirmed the picker with NOTHING checked — a real
    // `canPickMany` resolution shape, per the @types/vscode oracle.
    mockState.quickPickResponder = () => [];

    activate(fakeContext());
    await flushEditor();

    const command = mockState.commands.get("irisMcpLauncher.selectServers");
    expect(command).toBeDefined();

    // Dismissed confirmation (resolves undefined — the real modal shape):
    // byte-unchanged, no write, no confirmation info.
    mockState.modalConfirmResponse = undefined;
    await command!();
    expect(mockState.configUpdates).toHaveLength(0);
    expect(mockState.infos).toHaveLength(0);

    // "Expose All" chosen: the empty selection is written to the scope the
    // value already lives in (global here), and the post-write info names it.
    mockState.modalConfirmResponse = "Expose All";
    await command!();
    expect(mockState.configUpdates).toEqual([
      { key: "servers", value: [], target: ConfigurationTarget.Global },
    ]);
    expect(mockState.infos).toHaveLength(1);
    expect(mockState.infos[0]).toContain("0 servers");
    expect(mockState.infos[0]).toContain("every server InterSystems Server");
  });

  it("31-4-3: an empty resolved username refuses the start with ONE clear message and NO authentication prompt", async () => {
    mockState.configStore.set(`${CONFIG}.servers`, ["prod"]);
    mockState.serverManager = serverManagerWith({
      prod: {
        name: "prod",
        webServer: { host: "prod.example.com", port: 52773, scheme: "http" },
        username: "",
        password: "SYS",
      },
    });

    activate(fakeContext());
    await flushEditor();

    const defs = (await theMcpProvider().provideMcpServerDefinitions({
      isCancellationRequested: false,
    })) as McpStdioServerDefinition[];
    expect(defs).toHaveLength(1);
    expect(defs[0]).toBeInstanceOf(McpStdioServerDefinition);

    const resolved = await theMcpProvider().resolveMcpServerDefinition(defs[0], {
      isCancellationRequested: false,
    });
    expect(resolved).toBeUndefined();

    const refusalWarnings = mockState.warnings.filter((message) =>
      message.includes("no username could be resolved"),
    );
    expect(refusalWarnings).toHaveLength(1);
    expect(refusalWarnings[0]).toContain("prod");
    // The refusal happens before any credential prompt: getSession never ran.
    expect(mockState.getSessionCalls).toHaveLength(0);
  });
});
