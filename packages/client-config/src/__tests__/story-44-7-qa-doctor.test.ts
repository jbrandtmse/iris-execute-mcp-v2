/**
 * Story 44.7 QA (DW-747; AD-30; Rules #19, #54, #59) - the gaps the build's tests leave in doctor check 7
 * (`vscode-local-harness-entries`).
 *
 * `vscode-copilot-targets.test.ts` pins the owned and the unowned server, the all-owned file, the true-advice apply refusal and the
 * no-refusal text. This file pins what they leave open:
 *  - the whole shape of both findings (the key set, and the movable one before the refused ones);
 *  - the user-scope old file, which is never refused, even while the project one is;
 *  - a shared entry with no ledger record (a hand-written `.mcp.json` entry): the same refusal as `apply`, so doctor and `apply` agree;
 *  - doctor writes nothing and exits as it did, for a refused entry;
 *  - the plain-text report carries the by-hand advice, and never the refused `apply` line.
 *
 * Ownership comes from the engine's own ledger (`apply` as claude-code), never a hand-written state file (Rule #54): the fixture is
 * what Claude Code's `apply` really leaves. In-memory file system, no host files.
 */

import { Readable } from "node:stream";

import { describe, expect, it } from "vitest";

import { runCli, type CliDeps } from "../cli/clients.js";
import { CLIENT_ADAPTERS } from "../adapters.js";
import { apply } from "../engine.js";
import { CANONICAL_SERVERS, type EngineHostContext } from "../index.js";
import { synthesizeEntry } from "../synthesize.js";

import { MemFs, fixedNow } from "./helpers.js";

const HOME = "/home/u";
const PROJECT = "/proj";
const SHARED_FILE = `${PROJECT}/.mcp.json`;
const OLD_USER = `${HOME}/.config/Code/User/mcp.json`;
const OLD_PROJECT = `${PROJECT}/.vscode/mcp.json`;
const STATE_DIR = `${HOME}/.iris-mcp/client-manager`;

const ctx: EngineHostContext = { platform: "linux", env: {}, homeDir: HOME, projectDir: PROJECT, stateDir: STATE_DIR };

const OLD_TWO = `{\n  "servers": {\n    "iris-dev-mcp": { "command": "npx" },\n    "iris-admin-mcp": { "command": "npx" }\n  }\n}\n`;

function collector(): { out: { text: string }; write: (chunk: string) => void } {
  const out = { text: "" };
  return { out, write: (chunk: string) => void (out.text += chunk) };
}

async function cli(fs: MemFs, argv: string[], extra: CliDeps = {}): Promise<{ exit: number; stdout: string; stderr: string }> {
  const stdout = collector();
  const stderr = collector();
  const exit = await runCli(argv, { env: {}, platform: "linux", homeDir: HOME, projectDir: PROJECT, fs, stdout, stderr, stdin: Readable.from([]), now: fixedNow(1, 2, 3, 4, 5, 6, 7, 8), ...extra } as CliDeps);
  return { exit, stdout: stdout.out.text, stderr: stderr.out.text };
}

/** `server`'s entry in the workspace `.mcp.json`, written by claude-code's own `apply`, so the ledger records its ownership. */
function claudeOwns(fs: MemFs, server: (typeof CANONICAL_SERVERS)[number]): void {
  const claude = CLIENT_ADAPTERS["claude-code"];
  if (claude === undefined) throw new Error("registry");
  const entry = synthesizeEntry(server, "env-reference", { adapter: claude, profile: { governanceFile: "/g.json", serverManagerNames: "prod" } });
  if (!entry.ok) throw new Error(entry.reason);
  expect(apply(ctx, "claude-code", "project", entry.entry, { fs }).ok).toBe(true);
}

type Finding = { check: string; client: string; scope: string; path: string | null; entry?: string; detail: string };

async function findings(fs: MemFs): Promise<{ exit: number; list: Finding[] }> {
  const doctor = await cli(fs, ["doctor", "--json"]);
  const all = (JSON.parse(doctor.stdout) as { data: { findings: Finding[] } }).data.findings;
  return { exit: doctor.exit, list: all.filter((f) => f.check === "vscode-local-harness-entries") };
}

const FIX = (scope: string, servers: string): string =>
  `npx -y -p @iris-mcp/client-config@1 iris-mcp-clients apply --client vscode --scope ${scope} --servers ${servers}`;

describe("DW-747 QA: doctor check 7, the whole findings", () => {
  it("a refused server and a movable one: the movable finding first with no entry member, then the refused one with its entry member", async () => {
    const fs = new MemFs();
    claudeOwns(fs, "iris-dev-mcp");
    fs.seed(OLD_PROJECT, OLD_TWO);

    const { list } = await findings(fs);

    expect(list).toEqual([
      {
        check: "vscode-local-harness-entries",
        client: "vscode",
        scope: "project",
        path: OLD_PROJECT,
        detail:
          `iris-admin-mcp still in ${OLD_PROJECT}, a file of the deprecated Local harness (VS Code removes it in February 2027) that Copilot sessions do not read. ` +
          `Move them: ${FIX("project", "iris-admin-mcp")}`,
      },
      {
        check: "vscode-local-harness-entries",
        client: "vscode",
        scope: "project",
        path: OLD_PROJECT,
        entry: "iris-dev-mcp",
        detail:
          `iris-dev-mcp is still in ${OLD_PROJECT}, a file of the deprecated Local harness (VS Code removes it in February 2027) that Copilot sessions do not read. ` +
          `The iris-dev-mcp entry in the shared ${SHARED_FILE} belongs to Claude Code (claude-code), which Copilot sessions also read, so the copy in ${OLD_PROJECT} is unused. ` +
          `Delete the "iris-dev-mcp" entry from ${OLD_PROJECT} by hand: the CLI never changes an entry another client owns in the shared file.`,
      },
    ]);
  });

  it("the user-scope old file is never refused while the project one is: its finding keeps the apply advice for its own scope", async () => {
    const fs = new MemFs();
    claudeOwns(fs, "iris-dev-mcp");
    fs.seed(OLD_PROJECT, OLD_TWO);
    fs.seed(OLD_USER, `{\n  "servers": {\n    "iris-dev-mcp": { "command": "npx" }\n  }\n}\n`);

    const { list } = await findings(fs);

    const user = list.filter((f) => f.scope === "user");
    expect(user).toEqual([
      {
        check: "vscode-local-harness-entries",
        client: "vscode",
        scope: "user",
        path: OLD_USER,
        detail:
          `iris-dev-mcp still in ${OLD_USER}, a file of the deprecated Local harness (VS Code removes it in February 2027) that Copilot sessions do not read. ` +
          `Move them: ${FIX("user", "iris-dev-mcp")}`,
      },
    ]);
    expect(list.filter((f) => f.scope === "project").map((f) => f.entry)).toEqual([undefined, "iris-dev-mcp"]);
  });

  it("a hand-written shared entry with no ledger record belongs to Claude Code too: apply refuses it, so doctor says by hand", async () => {
    // Probed 2026-11-23: a canonical name in `.mcp.json` that the ledger does not record is still Claude Code's, so the owner
    // is always named for a name `iris-dev-mcp` lists (the "another client" wording is for a foreign name, which this old file
    // never lists).
    const fs = new MemFs();
    fs.seed(SHARED_FILE, `{\n  "mcpServers": {\n    "iris-dev-mcp": { "command": "node", "args": ["x.js"] }\n  }\n}\n`);
    fs.seed(OLD_PROJECT, OLD_TWO);
    const sharedBefore = fs.readFile(SHARED_FILE);

    const run = await cli(fs, ["apply", "--client", "vscode", "--scope", "project", "--servers", "iris-dev-mcp", "--yes"]);
    const { list } = await findings(fs);

    expect(run.exit).toBe(1);
    expect(run.stderr).toContain("belongs to Claude Code (claude-code)");
    expect(fs.readFile(SHARED_FILE)).toBe(sharedBefore);
    const dev = list.find((f) => f.entry === "iris-dev-mcp");
    expect(dev?.detail).toContain(`The iris-dev-mcp entry in the shared ${SHARED_FILE} belongs to Claude Code (claude-code)`);
    expect(dev?.detail).toContain(`Delete the "iris-dev-mcp" entry from ${OLD_PROJECT} by hand`);
    expect(list.find((f) => f.entry === undefined)?.detail).toContain(`--servers iris-admin-mcp`);
  });
});

describe("DW-747 QA: doctor does not change what it did", () => {
  it("a refused entry changes neither the files nor the exit code of doctor, and doctor stays read-only", async () => {
    const plain = new MemFs();
    plain.seed(OLD_PROJECT, OLD_TWO);
    const owned = new MemFs();
    claudeOwns(owned, "iris-dev-mcp");
    owned.seed(OLD_PROJECT, OLD_TWO);
    const before = new Map([...owned.files]);

    const withoutRefusal = await findings(plain);
    const withRefusal = await findings(owned);

    expect(withRefusal.exit).toBe(withoutRefusal.exit);
    expect(new Map([...owned.files])).toEqual(before);
  });

  it("the plain-text report carries the by-hand advice for the refused server and the apply line only for the movable one", async () => {
    const fs = new MemFs();
    claudeOwns(fs, "iris-dev-mcp");
    fs.seed(OLD_PROJECT, OLD_TWO);

    const doctor = await cli(fs, ["doctor"]);
    const text = `${doctor.stdout}\n${doctor.stderr}`;

    expect(text).toContain(`Delete the "iris-dev-mcp" entry from ${OLD_PROJECT} by hand`);
    expect(text).toContain(FIX("project", "iris-admin-mcp"));
    expect(text).not.toContain("--servers iris-dev-mcp");
    expect(text).not.toContain("iris-dev-mcp,iris-admin-mcp");
  });
});
