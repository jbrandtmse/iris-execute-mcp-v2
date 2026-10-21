/**
 * Story 42.1 (AC 42.1.6) - the definitions the REAL `extension.ts` hands VS
 * Code carry the `@1` pin and an explicit home-directory `cwd`.
 *
 * Driven through `activate()` -> the registered provider's
 * `provideMcpServerDefinitions`, with `vscode` aliased to the pinned fake in
 * `vscodeMock.ts`. The expected specs are literals (never derived from
 * `pinnedSpec`), so a regression in the helper cannot green its own test.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ExtensionContext } from "vscode";
import { activate, deactivate } from "../extension.js";
import { IRIS_MCP_MAJOR, pinnedSpec } from "../definitions.js";
import type { ServerManagerApi, ServerSpec } from "../types.js";
import { mockState, resetMockState, McpStdioServerDefinition } from "./vscodeMock.js";

const CONFIG = "irisMcpLauncher";

function fakeContext(): ExtensionContext {
  return { subscriptions: [] } as unknown as ExtensionContext;
}

function specFor(name: string): ServerSpec {
  return {
    name,
    webServer: { host: `${name}.example.com`, port: 52773, scheme: "http" },
    username: "_SYSTEM",
    password: "SYS",
  };
}

function serverManagerWith(names: string[]): (typeof mockState)["serverManager"] {
  const api: ServerManagerApi = {
    getServerNames: () => names.map((name) => ({ name, description: "", detail: "" })),
    getServerSpec: async (name: string) => specFor(name),
    getAccount: () => ({ id: "acct-1", label: "Account One" }),
  };
  return { isActive: true, activate: async () => undefined, exports: api };
}

async function flushEditor(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/** `os.homedir()` as the real `Uri.file(...).fsPath` renders it (win32 drive letters are lower-cased). */
function expectedHomeFsPath(): string {
  const home = os.homedir();
  return process.platform === "win32" ? home.replace(/^[A-Za-z]:/, (drive) => drive.toLowerCase()) : home;
}

async function provideDefinitions(): Promise<McpStdioServerDefinition[]> {
  expect(mockState.mcpProviders).toHaveLength(1);
  const provided = await mockState.mcpProviders[0]!.provider.provideMcpServerDefinitions({
    isCancellationRequested: false,
  });
  return provided as unknown as McpStdioServerDefinition[];
}

const tempDirs: string[] = [];

beforeEach(() => {
  resetMockState();
  mockState.configStore.set(`${CONFIG}.servers`, []);
  mockState.configStore.set(`${CONFIG}.packages`, ["dev"]);
});

afterEach(() => {
  deactivate();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("Story 42.1 - provided definitions: @1 pin and home-directory cwd", () => {
  it("npx mode: every definition spawns the @1-pinned package and starts in the user's home directory", async () => {
    mockState.configStore.set(`${CONFIG}.packages`, ["dev", "admin"]);
    mockState.serverManager = serverManagerWith(["a", "b"]);

    activate(fakeContext());
    await flushEditor();
    const defs = await provideDefinitions();

    expect(defs).toHaveLength(4);
    for (const def of defs) {
      expect(def).toBeInstanceOf(McpStdioServerDefinition);
      expect(def.command).toBe("npx");
      expect(def.cwd?.fsPath).toBe(expectedHomeFsPath());
    }
    expect(defs.map((def) => def.args).sort()).toEqual([
      ["-y", "@iris-mcp/admin@1"],
      ["-y", "@iris-mcp/admin@1"],
      ["-y", "@iris-mcp/dev@1"],
      ["-y", "@iris-mcp/dev@1"],
    ]);
  });

  it("local developmentRepoPath mode: the spawn target is unchanged and the cwd is still the home directory", async () => {
    const repoDir = mkdtempSync(path.join(os.tmpdir(), "iris-mcp-launcher-42-1-"));
    tempDirs.push(repoDir);
    const distDir = path.join(repoDir, "packages", "iris-dev-mcp", "dist");
    mkdirSync(distDir, { recursive: true });
    writeFileSync(path.join(distDir, "index.js"), "// fake built entry point\n", "utf8");
    mockState.configStore.set(`${CONFIG}.developmentRepoPath`, repoDir);
    mockState.serverManager = serverManagerWith(["a"]);

    activate(fakeContext());
    await flushEditor();
    const defs = await provideDefinitions();

    expect(defs).toHaveLength(1);
    expect(defs[0]!.command).toBe(process.execPath);
    expect(defs[0]!.args).toEqual([path.join(distDir, "index.js")]);
    expect(defs[0]!.cwd?.fsPath).toBe(expectedHomeFsPath());
  });

  it("the extension's literal mirror of the major is '1' and pins a bare package name", () => {
    expect(IRIS_MCP_MAJOR).toBe("1");
    expect(pinnedSpec("@iris-mcp/dev")).toBe("@iris-mcp/dev@1");
  });
});
