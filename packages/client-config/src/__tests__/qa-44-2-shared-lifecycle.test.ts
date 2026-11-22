/**
 * Story 44.2 QA - the full vscode lifecycle (apply, disable, enable, remove) with a byte oracle at every stage, on the files the
 * adapter now writes, over the NON-canonical shapes the shipped suites do not cover (Rule #58):
 *
 * - the shared project `.mcp.json`: BOM, comment-bearing, trailing commas, a sibling root key, an absent `mcpServers`, an empty
 *   file (`shared-mcp-json.test.ts` covers apply and remove on these, not the disable/enable stash round trip);
 * - the strict user `mcp-config.json`: a sibling root key, an absent `mcpServers`, an empty `{}` and an empty file (the shipped suite
 *   covers compact, 4-space and CRLF).
 *
 * Expected bytes are the fixtures themselves (disable and remove must return the original bytes exactly) and the bytes of the first
 * apply (enable must return them exactly): each is an independent oracle, not engine output compared with itself.
 */

import { describe, expect, it } from "vitest";

import { CLIENT_ADAPTERS } from "../adapters.js";
import { apply, disable, enable, remove } from "../engine.js";
import { resolveLegacyPath } from "../paths.js";
import { synthesizeEntry } from "../synthesize.js";
import type { ClientAdapter, EngineHostContext } from "../index.js";

import { MemFs } from "./helpers.js";

const HOME = "/home/u";
const PROJECT = "/proj";
const ctx: EngineHostContext = { platform: "linux", env: {}, homeDir: HOME, projectDir: PROJECT, stateDir: `${HOME}/.iris-mcp/client-manager` };
const vscode = CLIENT_ADAPTERS["vscode"] as ClientAdapter;

function entry() {
  const synthesis = synthesizeEntry("iris-dev-mcp", "env-reference", { adapter: vscode });
  if (!synthesis.ok) throw new Error(synthesis.reason);
  return synthesis.entry;
}

interface Shape {
  label: string;
  content: string;
  /** Substrings of the ORIGINAL that must survive every stage verbatim. */
  keep: string[];
  /**
   * The root key was absent, so apply created it; removing the entry leaves an empty `mcpServers` container (pre-story claude-code
   * behavior on the same file, pinned from a run on 2026-11-22: `{"other":{"a":1}}` -> `{"other":{"a":1}, "mcpServers": {}}`).
   * The bytes cannot return exactly; the foreign pieces must, and the file must stay valid.
   */
  leavesEmptyContainer?: boolean;
}

function lifecycle(scope: "user" | "project", file: string, shape: Shape): void {
  const fs = new MemFs();
  fs.seed(file, shape.content);
  const applied = apply(ctx, "vscode", scope, entry(), { fs });
  expect(applied.ok, applied.reason ?? "").toBe(true);
  const afterApply = fs.readFile(file);
  for (const piece of shape.keep) expect(afterApply, `apply lost ${JSON.stringify(piece)}`).toContain(piece);
  expect(afterApply).toContain('"iris-dev-mcp"');
  if (shape.content.includes("\r\n")) expect((afterApply.match(/(?<!\r)\n/g) ?? []).length, "a bare LF entered a CRLF file").toBe(0);
  if (shape.content.startsWith("﻿")) expect(afterApply.startsWith("﻿"), "the BOM was dropped").toBe(true);

  expect(disable(ctx, "vscode", scope, "iris-dev-mcp", { fs }).ok).toBe(true);
  if (shape.leavesEmptyContainer === true) {
    const off = fs.readFile(file);
    for (const piece of shape.keep) expect(off, `disable lost ${JSON.stringify(piece)}`).toContain(piece);
    expect((JSON.parse(off) as { mcpServers: object }).mcpServers).toEqual({});
    expect(enable(ctx, "vscode", scope, "iris-dev-mcp", { fs }).ok).toBe(true);
    const on = fs.readFile(file);
    for (const piece of shape.keep) expect(on, `enable lost ${JSON.stringify(piece)}`).toContain(piece);
    expect((JSON.parse(on) as { mcpServers: Record<string, unknown> }).mcpServers["iris-dev-mcp"]).toBeDefined();
    expect(remove(ctx, "vscode", scope, "iris-dev-mcp", { fs }).ok).toBe(true);
    const gone = fs.readFile(file);
    for (const piece of shape.keep) expect(gone, `remove lost ${JSON.stringify(piece)}`).toContain(piece);
    expect((JSON.parse(gone) as { mcpServers: object }).mcpServers).toEqual({});
    return;
  }
  expect(fs.readFile(file), "disable returns the original bytes").toBe(shape.content);
  expect(enable(ctx, "vscode", scope, "iris-dev-mcp", { fs }).ok).toBe(true);
  expect(fs.readFile(file), "enable returns the applied bytes").toBe(afterApply);
  expect(remove(ctx, "vscode", scope, "iris-dev-mcp", { fs }).ok).toBe(true);
  expect(fs.readFile(file), "remove returns the original bytes").toBe(shape.content);
}

describe("vscode lifecycle on the shared project .mcp.json, non-canonical shapes (AC 44.2.3, Rule #58)", () => {
  const SHAPES: Shape[] = [
    {
      label: "BOM + CRLF",
      content: '﻿{\r\n  "mcpServers": {\r\n    "foo": {\r\n      "command": "x"\r\n    }\r\n  }\r\n}\r\n',
      keep: ['    "foo": {\r\n      "command": "x"\r\n    }'],
    },
    {
      label: "comments before, inside and after entries",
      content: '// top comment\n{\n  /* block */ "mcpServers": {\n    "foo": { "command": "x" }, // trailing\n    "bar": { "command": "y" /* inner */ }\n  }\n}\n',
      keep: ["// top comment", "/* block */", '"foo": { "command": "x" }, // trailing', '"bar": { "command": "y" /* inner */ }'],
    },
    {
      label: "trailing commas on the entry and the container",
      content: '{\n  "mcpServers": {\n    "foo": { "command": "x", },\n  },\n}\n',
      keep: ['"foo": { "command": "x", }'],
    },
    {
      label: "a sibling root key before and after mcpServers",
      content: '{\n  "$schema": "https://example.invalid/s.json",\n  "mcpServers": {\n    "foo": { "command": "x" }\n  },\n  "other": [1, 2, 3]\n}\n',
      keep: ['"$schema": "https://example.invalid/s.json"', '"foo": { "command": "x" }', '"other": [1, 2, 3]'],
    },
    {
      label: "mcpServers absent, a compact sibling present",
      content: '{"other":{"a":1}}',
      keep: ['"other":{"a":1}'],
      leavesEmptyContainer: true,
    },
    {
      label: "tab-indented",
      content: '{\n\t"mcpServers": {\n\t\t"foo": { "command": "x" }\n\t}\n}\n',
      keep: ['\t\t"foo": { "command": "x" }'],
    },
  ];
  for (const shape of SHAPES) {
    it(`${shape.label}: apply -> disable -> enable -> remove, foreign pieces verbatim and the bytes return exactly`, () => {
      lifecycle("project", `${PROJECT}/.mcp.json`, shape);
    });
  }

  it("an empty or whitespace-only .mcp.json is treated as a new document; remove returns a parseable file with no entry", () => {
    for (const content of ["", "\n"]) {
      const fs = new MemFs();
      fs.seed(`${PROJECT}/.mcp.json`, content);
      expect(apply(ctx, "vscode", "project", entry(), { fs }).ok, JSON.stringify(content)).toBe(true);
      expect(JSON.parse(fs.readFile(`${PROJECT}/.mcp.json`)).mcpServers["iris-dev-mcp"].command).toBe("npx");
      expect(remove(ctx, "vscode", "project", "iris-dev-mcp", { fs }).ok).toBe(true);
      expect(JSON.parse(fs.readFile(`${PROJECT}/.mcp.json`)).mcpServers ?? {}).toEqual({});
    }
  });
});

describe("vscode lifecycle on the strict user mcp-config.json, further shapes (AC 44.2.2, Rule #58)", () => {
  const SHAPES: Shape[] = [
    {
      label: "a sibling root key and a multi-line foreign entry",
      content: '{\n  "mcpServers": {\n    "foo": {\n      "type": "http",\n      "url": "https://example.invalid/mcp"\n    }\n  },\n  "trusted_folders": ["/a", "/b"]\n}\n',
      keep: ['"url": "https://example.invalid/mcp"', '"trusted_folders": ["/a", "/b"]'],
    },
    {
      label: "mcpServers absent",
      content: '{\n  "trusted_folders": ["/a"]\n}\n',
      keep: ['"trusted_folders": ["/a"]'],
      leavesEmptyContainer: true,
    },
    {
      label: "an empty object on one line",
      content: "{}\n",
      keep: [],
      leavesEmptyContainer: true,
    },
  ];
  for (const shape of SHAPES) {
    it(`${shape.label}: apply -> disable -> enable -> remove, foreign pieces survive and the file stays valid strict JSON`, () => {
      lifecycle("user", `${HOME}/.copilot/mcp-config.json`, shape);
    });
  }

  it("the strict file written by the manager is itself strict JSON (JSON.parse accepts it) at every stage, so VS Code can read it", () => {
    const fs = new MemFs();
    const file = `${HOME}/.copilot/mcp-config.json`;
    fs.seed(file, '{\n  "mcpServers": {\n    "foo": { "command": "x" }\n  }\n}\n');
    apply(ctx, "vscode", "user", entry(), { fs });
    expect(() => JSON.parse(fs.readFile(file))).not.toThrow();
    disable(ctx, "vscode", "user", "iris-dev-mcp", { fs });
    expect(() => JSON.parse(fs.readFile(file))).not.toThrow();
    enable(ctx, "vscode", "user", "iris-dev-mcp", { fs });
    expect(() => JSON.parse(fs.readFile(file))).not.toThrow();
  });
});

describe("the old Local-harness files resolve per platform and never follow COPILOT_HOME (AC 44.2.4)", () => {
  const legacy = (scope: "user" | "project") => {
    const def = vscode.legacyScopes?.find((l) => l.scope === scope);
    if (def === undefined) throw new Error(`no legacy ${scope} scope`);
    return def;
  };

  it("user: %APPDATA%\\Code\\User on win32, ~/Library/Application Support/Code/User on darwin, ~/.config/Code/User on linux; COPILOT_HOME, XDG_CONFIG_HOME and CLAUDE_CONFIG_DIR change nothing", () => {
    const decoys = { COPILOT_HOME: "/elsewhere", XDG_CONFIG_HOME: "/xdg", CLAUDE_CONFIG_DIR: "/claude" };
    expect(resolveLegacyPath(vscode, legacy("user"), { platform: "win32", env: { APPDATA: "C:\\Users\\u\\AppData\\Roaming", ...decoys }, homeDir: "C:\\Users\\u" })).toBe(
      "C:\\Users\\u\\AppData\\Roaming\\Code\\User\\mcp.json",
    );
    expect(resolveLegacyPath(vscode, legacy("user"), { platform: "darwin", env: decoys, homeDir: "/Users/u" })).toBe("/Users/u/Library/Application Support/Code/User/mcp.json");
    expect(resolveLegacyPath(vscode, legacy("user"), { platform: "linux", env: decoys, homeDir: "/home/u" })).toBe("/home/u/.config/Code/User/mcp.json");
  });

  it("project: .vscode/mcp.json under the project directory on every platform, and null with no project directory", () => {
    for (const platform of ["win32", "darwin", "linux"] as const) {
      const sep = platform === "win32" ? "\\" : "/";
      const root = platform === "win32" ? "C:\\work\\p" : "/work/p";
      expect(resolveLegacyPath(vscode, legacy("project"), { platform, env: {}, homeDir: "/h", projectDir: root })).toBe(`${root}${sep}.vscode${sep}mcp.json`);
      expect(resolveLegacyPath(vscode, legacy("project"), { platform, env: {}, homeDir: "/h" })).toBeNull();
    }
  });
});
