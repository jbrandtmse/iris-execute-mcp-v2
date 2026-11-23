/**
 * Story 44.2, AC 44.2.3 - the shared project `.mcp.json` (Claude Code's project file and VS Code Copilot's).
 *
 * Covers the shared-file rows of the I/O matrix on NON-canonical `.mcp.json` fixtures (compact, 4-space, CRLF, BOM,
 * comment-bearing; Rule #58) through the CLI core, for `vscode` and for `claude-code`: the refuse-only ownership rule (an
 * entry belongs to the client that wrote it; the other client is refused, nothing is adopted), the claude-only
 * back-compat oracle, the owner's disable/remove text, status and doctor listing and checking the file once, and
 * foreign bytes preserved.
 *
 * Oracle (Rule #36): `fixtures/claude-code-shared-oracle-pre-44-2.json` was captured from the dist built from the PRE-EDIT tree
 * (baseline commit 9f7797c5) before any source edit, by running the scenario below with `claude-code` against each fixture
 * (apply, status, doctor, apply again, disable, enable, remove; `node capture-oracle.mjs <repo-root> <out-dir>`). The only
 * field the story adds to a claude-code row is the additive `sharedWith` marker, which the status comparison strips.
 * The `unrecorded` scenario (claude-code applying over, and removing, a hand-written canonical entry that no ledger records) was
 * captured the same way from a dist built from `git archive 9f7797c5` (`node capture-oracle-unrecorded.mjs <pre-story package dir>
 * <oracle json>`), because none of the five fixtures holds such an entry.
 */

import { Readable } from "node:stream";

import { describe, expect, it } from "vitest";

import { runCli, type CliDeps } from "../cli/clients.js";
import { CLIENT_ADAPTERS } from "../adapters.js";
import { apply, disable, enable, remove } from "../engine.js";
import {
  PRE_SHARING_WRITERS,
  dropPeerRecords,
  fileOwner,
  ownedByOtherReason,
  peerClients,
  sharedFileNote,
  sharedPeers,
} from "../shared-files.js";
import { readState, type ManagerState } from "../state.js";

import { MemFs, fixedNow, readFixture } from "./helpers.js";

const HOME = "/home/u";
const PROJECT = "/proj";
const FILE = `${PROJECT}/.mcp.json`;
const AT = { platform: "linux" as const, path: FILE };
const STATE_DIR = `${HOME}/.iris-mcp/client-manager`;

interface Scenario {
  exit: number;
  stdout: string;
  stderr: string;
  file?: string | null;
}

interface Oracle {
  fixtures: Record<string, string>;
  /** claude-code over an UNRECORDED canonical entry (captured from a dist built from the pre-story tree). */
  unrecorded: { fixture: string; apply: Scenario; remove: Scenario };
  scenarios: Record<
    string,
    {
      apply: Scenario;
      statusRow: { scopes: Array<Record<string, unknown>> } | null;
      doctorFindings: unknown[];
      applyAgain: Scenario;
      disable: Scenario;
      enable: Scenario;
      remove: Scenario;
    }
  >;
}

const ORACLE = JSON.parse(readFixture("claude-code-shared-oracle-pre-44-2.json")) as Oracle;
const FIXTURE_NAMES = Object.keys(ORACLE.fixtures);

function collector(): { out: { text: string }; write: (chunk: string) => void } {
  const out = { text: "" };
  return { out, write: (chunk: string) => void (out.text += chunk) };
}

async function step(fs: MemFs, argv: string[], extra: CliDeps = {}): Promise<Scenario> {
  const stdout = collector();
  const stderr = collector();
  const exit = await runCli(argv, {
    env: {},
    platform: "linux",
    homeDir: HOME,
    projectDir: PROJECT,
    fs,
    stdout,
    stderr,
    now: fixedNow(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12),
    ...extra,
  });
  return { exit, stdout: stdout.out.text, stderr: stderr.out.text };
}

const project = (client: string): string[] => ["--client", client, "--scope", "project"];
const applyArgs = (client: string, extra: string[] = []): string[] => [
  "apply",
  ...project(client),
  "--servers",
  "iris-dev-mcp",
  "--yes",
  "--json",
  ...extra,
];

function state(fs: MemFs): ManagerState {
  const read = readState(fs, STATE_DIR, "linux");
  if (!read.ok) throw new Error(read.error);
  return read.state;
}

function recorded(fs: MemFs, client: string): string[] {
  return state(fs)
    .entries.filter((entry) => entry.client === client)
    .map((entry) => entry.name);
}

/** Strip the additive marker the story adds to a status scope. */
function withoutSharedWith(row: { scopes: Array<Record<string, unknown>> } | null): unknown {
  if (row === null) return null;
  return { ...row, scopes: row.scopes.map(({ sharedWith: _ignored, ...scope }) => scope) };
}

describe("claude-only back-compat: claude-code on a .mcp.json no vscode record touches is toEqual the pre-story oracle (AC 44.2.3)", () => {
  for (const name of FIXTURE_NAMES) {
    it(`${name}: apply, status, doctor, apply again, disable, enable, remove`, async () => {
      const expected = ORACLE.scenarios[name];
      if (expected === undefined) throw new Error(`no oracle for ${name}`);
      const fs = new MemFs();
      fs.seed(FILE, ORACLE.fixtures[name] ?? "");
      const file = (): string | null => fs.files.get(FILE) ?? null;

      expect({ ...(await step(fs, applyArgs("claude-code"))), file: file() }).toEqual(expected.apply);
      const status = JSON.parse((await step(fs, ["status", "--json"])).stdout) as {
        data: { clients: Array<{ client: string; scopes: Array<Record<string, unknown>> }> };
      };
      expect(withoutSharedWith(status.data.clients.find((c) => c.client === "claude-code") ?? null)).toEqual(expected.statusRow);
      const doctor = JSON.parse((await step(fs, ["doctor", "--json"])).stdout) as { data: { findings: Array<{ client: string }> } };
      expect(doctor.data.findings.filter((f) => f.client === "claude-code")).toEqual(expected.doctorFindings);
      expect({ ...(await step(fs, applyArgs("claude-code"))), file: file() }).toEqual(expected.applyAgain);
      const base = project("claude-code");
      expect({ ...(await step(fs, ["disable", ...base, "--server", "iris-dev-mcp", "--json"])), file: file() }).toEqual(expected.disable);
      expect({ ...(await step(fs, ["enable", ...base, "--server", "iris-dev-mcp", "--json"])), file: file() }).toEqual(expected.enable);
      expect({ ...(await step(fs, ["remove", ...base, "--server", "iris-dev-mcp", "--json"])), file: file() }).toEqual(expected.remove);
    });
  }

  it("claude-code replaces an UNRECORDED canonical entry of a .mcp.json exactly as before, and removes it again (the AD-15 reading of the sole-owner rule)", async () => {
    const fs = new MemFs();
    fs.seed(FILE, ORACLE.unrecorded.fixture);
    expect({ ...(await step(fs, applyArgs("claude-code"))), file: fs.files.get(FILE) ?? null }).toEqual(ORACLE.unrecorded.apply);
    expect({ ...(await step(fs, ["remove", ...project("claude-code"), "--server", "iris-dev-mcp", "--json"])), file: fs.files.get(FILE) ?? null }).toEqual(
      ORACLE.unrecorded.remove,
    );
  });

  it("the oracle covers all five non-canonical shapes", () => {
    expect(FIXTURE_NAMES.sort()).toEqual(["bom", "comments", "compact", "crlf", "fourSpace"]);
  });
});

describe("a vscode write behaves exactly as a claude-code write on the same non-canonical fixture, foreign bytes intact", () => {
  for (const name of FIXTURE_NAMES) {
    it(`${name}: the project .mcp.json bytes are identical after either client's apply, and the foreign entry survives`, async () => {
      const original = ORACLE.fixtures[name] ?? "";
      const asClaude = new MemFs();
      asClaude.seed(FILE, original);
      const asVscode = new MemFs();
      asVscode.seed(FILE, original);
      expect((await step(asClaude, applyArgs("claude-code"))).exit).toBe(0);
      expect((await step(asVscode, applyArgs("vscode"))).exit).toBe(0);
      expect(asVscode.readFile(FILE)).toBe(asClaude.readFile(FILE));
      expect(asVscode.readFile(FILE)).toContain('"foo"');
      // Removing it again restores the fixture's bytes, whichever client wrote it.
      const removed = await step(asVscode, ["remove", ...project("vscode"), "--server", "iris-dev-mcp", "--json"]);
      expect(removed.exit).toBe(0);
      expect(asVscode.readFile(FILE)).toBe(original);
    });
  }
});

describe("refuse-only: the other client's entry is never adopted or overwritten (AC 44.2.3)", () => {
  it("refused: the entry claude-code wrote is refused for vscode even in the same mode: exit 1, no file edit, no vscode record, no backup", async () => {
    const fs = new MemFs();
    fs.seed(FILE, ORACLE.fixtures.compact ?? "");
    expect((await step(fs, applyArgs("claude-code"))).exit).toBe(0);
    const before = fs.readFile(FILE);
    const stateBefore = JSON.stringify(state(fs));
    const refused = await step(fs, applyArgs("vscode"));
    expect(refused.exit).toBe(1);
    expect(refused.stderr).toContain(FILE);
    expect(refused.stderr).toContain("claude-code");
    expect(fs.readFile(FILE)).toBe(before);
    expect(JSON.stringify(state(fs))).toBe(stateBefore);
    expect(recorded(fs, "vscode")).toEqual([]);
    expect([...fs.files.keys()].filter((path) => path.includes("/backups/vscode/"))).toEqual([]);
    expect((JSON.parse(refused.stdout) as { ok: boolean }).ok).toBe(false);
  });

  it("a refusal names the owner in `sharedWith` through the engine for every verb, and an entry that is not in the file is created by whoever asks", () => {
    const fs = new MemFs();
    const ctx = { platform: "linux" as const, env: {}, homeDir: HOME, projectDir: PROJECT, stateDir: STATE_DIR };
    const entry = { name: "iris-dev-mcp" as const, command: "npx", args: ["-y", "@iris-mcp/dev@1"] };
    expect(apply(ctx, "claude-code", "project", entry, { fs }).ok).toBe(true);
    const before = fs.readFile(FILE);
    for (const result of [
      apply(ctx, "vscode", "project", entry, { fs }),
      disable(ctx, "vscode", "project", "iris-dev-mcp", { fs }),
      enable(ctx, "vscode", "project", "iris-dev-mcp", { fs }),
      remove(ctx, "vscode", "project", "iris-dev-mcp", { fs }),
    ]) {
      expect(result.ok, result.action).toBe(false);
      expect(result.sharedWith, result.action).toEqual(["claude-code"]);
      expect(result.reason, result.action).toContain("nothing was written");
      expect(fs.readFile(FILE)).toBe(before);
    }
    expect(apply(ctx, "vscode", "project", { ...entry, name: "iris-interop-mcp" }, { fs }).ok).toBe(true);
  });

  it("refused the other way: claude-code is refused an entry vscode wrote, even in the same mode", async () => {
    const fs = new MemFs();
    expect((await step(fs, applyArgs("vscode"))).exit).toBe(0);
    const before = fs.readFile(FILE);
    const refused = await step(fs, applyArgs("claude-code"));
    expect(refused.exit).toBe(1);
    expect(refused.stderr).toContain("vscode");
    expect(fs.readFile(FILE)).toBe(before);
    expect(recorded(fs, "claude-code")).toEqual([]);
  });

  it("conflict the other way: claude-code is refused (exit 1) when vscode records an entry that differs from what claude-code would write; nothing changes", async () => {
    const fs = new MemFs();
    fs.seed(FILE, ORACLE.fixtures.compact ?? "");
    expect((await step(fs, applyArgs("vscode"))).exit).toBe(0);
    const fileBefore = fs.readFile(FILE);
    const stateBefore = JSON.stringify(state(fs));
    const explicit = ["--mode", "explicit", "--confirm-secret", "iris-dev-mcp", "--password-stdin"];
    const stdin = (): CliDeps => ({ stdin: Object.assign(Readable.from(["a-long-password-1\n"]), { isTTY: false }) });
    const refused = await step(fs, applyArgs("claude-code", explicit), stdin());
    expect(refused.exit).toBe(1);
    expect(refused.stderr).toContain(FILE);
    expect(refused.stderr).toContain("vscode");
    expect(refused.stderr).not.toContain("a-long-password-1");
    expect(fs.readFile(FILE)).toBe(fileBefore);
    expect(JSON.stringify(state(fs))).toBe(stateBefore);
  });

  it("conflict: a different mode is refused (exit 1), naming .mcp.json and claude-code; the file and the state are unchanged", async () => {
    const fs = new MemFs();
    fs.seed(FILE, ORACLE.fixtures.fourSpace ?? "");
    const explicit = ["--mode", "explicit", "--confirm-secret", "iris-dev-mcp", "--password-stdin"];
    const stdin = (): CliDeps => ({ stdin: Object.assign(Readable.from(["a-long-password-1\n"]), { isTTY: false }) });
    expect((await step(fs, applyArgs("claude-code", explicit), stdin())).exit).toBe(0);
    const fileBefore = fs.readFile(FILE);
    const stateBefore = JSON.stringify(state(fs));
    const refused = await step(fs, applyArgs("vscode"));
    expect(refused.exit).toBe(1);
    expect(refused.stderr).toContain(FILE);
    expect(refused.stderr).toContain("claude-code");
    expect(refused.stderr).not.toContain("a-long-password-1");
    expect(fs.readFile(FILE)).toBe(fileBefore);
    expect(JSON.stringify(state(fs))).toBe(stateBefore);
    const envelope = JSON.parse(refused.stdout) as { ok: boolean; error: string };
    expect(envelope.ok).toBe(false);
    expect(envelope.error).toContain("claude-code");
  });

  it("conflict through the engine names the other owner in `sharedWith` and writes nothing", () => {
    const fs = new MemFs();
    fs.seed(FILE, "{}\n");
    const ctx = { platform: "linux" as const, env: {}, homeDir: HOME, projectDir: PROJECT, stateDir: STATE_DIR };
    const entry = { name: "iris-dev-mcp" as const, command: "npx", args: ["-y", "@iris-mcp/dev@1"], env: { IRIS_NAMESPACE: "A" } };
    expect(apply(ctx, "claude-code", "project", entry, { fs }).ok).toBe(true);
    const before = fs.readFile(FILE);
    const refused = apply(ctx, "vscode", "project", { ...entry, env: { IRIS_NAMESPACE: "B" } }, { fs });
    expect(refused.ok).toBe(false);
    expect(refused.sharedWith).toEqual(["claude-code"]);
    expect(refused.reason).toContain(".mcp.json");
    expect(fs.readFile(FILE)).toBe(before);
  });

  it("an unrecorded different canonical entry is a conflict for vscode, while claude-code (the file's earlier writer) still replaces it", async () => {
    const hand = `{\n  "mcpServers": {\n    "iris-dev-mcp": { "command": "node", "args": ["hand-written.js"] }\n  }\n}\n`;
    const forVscode = new MemFs();
    forVscode.seed(FILE, hand);
    const refused = await step(forVscode, applyArgs("vscode"));
    expect(refused.exit).toBe(1);
    expect(forVscode.readFile(FILE)).toBe(hand);

    const forClaude = new MemFs();
    forClaude.seed(FILE, hand);
    const replaced = await step(forClaude, applyArgs("claude-code"));
    expect(replaced.exit).toBe(0);
    expect(forClaude.readFile(FILE)).toContain("@iris-mcp/dev@1");
    expect(forClaude.readFile(FILE)).not.toContain("hand-written.js");
  });

  it("an unrecorded entry equal to what vscode would write is still refused: vscode never owns through a missing record", async () => {
    const fs = new MemFs();
    expect((await step(fs, applyArgs("vscode"))).exit).toBe(0);
    const parsed = JSON.parse(fs.readFile(FILE)) as unknown;
    // Re-serialized compact (a hand reformat) and with no ledger at all.
    fs.files.set(FILE, JSON.stringify(parsed));
    fs.files.delete(`${STATE_DIR}/state.json`);
    const before = fs.readFile(FILE);
    const refused = await step(fs, applyArgs("vscode"));
    // Nobody records it, so claude-code (the pre-sharing writer) is the implied owner and vscode is refused.
    expect(refused.exit).toBe(1);
    expect(refused.stderr).toContain("claude-code");
    expect(fs.readFile(FILE)).toBe(before);
    expect(recorded(fs, "vscode")).toEqual([]);
  });
});

describe("an owner's disable and remove say that the other client reads the same file (AC 44.2.3)", () => {
  /** claude-code owns iris-dev-mcp and vscode owns iris-interop-mcp, in one file. */
  async function both(): Promise<MemFs> {
    const fs = new MemFs();
    fs.seed(FILE, ORACLE.fixtures.crlf ?? "");
    expect((await step(fs, applyArgs("claude-code"))).exit).toBe(0);
    const interop = ["apply", ...project("vscode"), "--servers", "iris-interop-mcp", "--yes", "--json"];
    expect((await step(fs, interop)).exit).toBe(0);
    return fs;
  }

  it("vscode disable of its own entry proceeds, removes the entry, and notes Claude Code", async () => {
    const fs = await both();
    const text = await step(fs, ["disable", ...project("vscode"), "--server", "iris-interop-mcp"]);
    expect(text.exit).toBe(0);
    expect(text.stdout).toContain("Claude Code (claude-code) reads the same file");
    expect(fs.readFile(FILE)).not.toContain("iris-interop-mcp");
    expect(fs.readFile(FILE)).toContain("iris-dev-mcp");
  });

  it("vscode remove of its own entry proceeds and says so in the JSON result too", async () => {
    const fs = await both();
    const json = await step(fs, ["remove", ...project("vscode"), "--server", "iris-interop-mcp", "--json"]);
    expect(json.exit).toBe(0);
    const result = (JSON.parse(json.stdout) as { data: { sharedWith?: string[]; sharedNote?: string; changed: boolean } }).data;
    expect(result.changed).toBe(true);
    expect(result.sharedWith).toEqual(["claude-code"]);
    expect(result.sharedNote).toContain("Claude Code (claude-code) reads the same file");
  });

  it("claude-code disable of its own entry notes that vscode reads the file once vscode records the file", async () => {
    const fs = await both();
    const text = await step(fs, ["disable", ...project("claude-code"), "--server", "iris-dev-mcp"]);
    expect(text.exit).toBe(0);
    expect(text.stdout).toContain("VS Code (Copilot) (vscode) reads the same file");
  });

  it("each client is refused the disable and the remove of the other's entry, and nothing changes", async () => {
    const fs = await both();
    const before = fs.readFile(FILE);
    const stateBefore = JSON.stringify(state(fs));
    for (const [client, server, owner] of [["vscode", "iris-dev-mcp", "claude-code"], ["claude-code", "iris-interop-mcp", "vscode"]] as const) {
      for (const verb of ["disable", "remove"]) {
        const refused = await step(fs, [verb, ...project(client), "--server", server, "--json"]);
        expect(refused.exit, `${client} ${verb}`).toBe(1);
        expect(refused.stdout + refused.stderr).toContain(owner);
        expect(fs.readFile(FILE)).toBe(before);
        expect(JSON.stringify(state(fs))).toBe(stateBefore);
      }
    }
  });

  it("the engine names the other reader even when only vscode records the entry; claude-code stays silent until vscode records it", () => {
    const fs = new MemFs();
    const ctx = { platform: "linux" as const, env: {}, homeDir: HOME, projectDir: PROJECT, stateDir: STATE_DIR };
    const entry = { name: "iris-dev-mcp" as const, command: "npx", args: ["-y", "@iris-mcp/dev@1"] };
    expect(apply(ctx, "vscode", "project", entry, { fs }).ok).toBe(true);
    const off = disable(ctx, "vscode", "project", "iris-dev-mcp", { fs });
    expect(off.ok).toBe(true);
    expect(off.sharedWith).toEqual(["claude-code"]);
    expect(off.sharedNote).toContain("Claude Code (claude-code) reads the same file");
    const gone = remove(ctx, "vscode", "project", "iris-dev-mcp", { fs });
    expect(gone.ok).toBe(true);
    expect(gone.sharedWith).toEqual(["claude-code"]);

    const fs2 = new MemFs();
    expect(apply(ctx, "claude-code", "project", entry, { fs: fs2 }).ok).toBe(true);
    const ccOff = disable(ctx, "claude-code", "project", "iris-dev-mcp", { fs: fs2 });
    expect(ccOff.ok).toBe(true);
    expect(ccOff.sharedNote).toBeUndefined();
    expect(ccOff.sharedWith).toBeUndefined();
  });

  it("a restore of the shared file names the other reader; claude-code's restore stays silent until a peer has records", async () => {
    const fs = await both();
    // vscode's disable of its own entry is the write whose backup the restore rolls back to.
    expect((await step(fs, ["disable", ...project("vscode"), "--server", "iris-interop-mcp"])).exit).toBe(0);
    const restored = await step(fs, ["restore", ...project("vscode"), "--json"]);
    expect(restored.exit, restored.stderr).toBe(0);
    const data = (JSON.parse(restored.stdout) as { data: { sharedWith?: string[]; sharedNote?: string } }).data;
    expect(data.sharedWith).toEqual(["claude-code"]);
    expect(data.sharedNote).toContain("Claude Code (claude-code) reads the same file");
    // claude-code's latest backup predates vscode's entry, so its restore would remove an entry vscode owns: refused.
    const shared = fs.readFile(FILE);
    const refused = await step(fs, ["restore", ...project("claude-code")]);
    expect(refused.exit).toBe(1);
    expect(refused.stderr).toContain(`the backup would change "iris-interop-mcp", which belongs to VS Code (Copilot) (vscode)`);
    expect(fs.readFile(FILE)).toBe(shared);
    // A later claude-code write backs up the file with vscode's entry in it; restoring that changes claude-code's own only.
    expect((await step(fs, applyArgs("claude-code"))).exit).toBe(0);
    const ccRestore = await step(fs, ["restore", ...project("claude-code")]);
    expect(ccRestore.exit, ccRestore.stderr).toBe(0);
    expect(ccRestore.stdout).toContain("VS Code (Copilot) (vscode) reads the same file");

    const solo = new MemFs();
    solo.seed(FILE, ORACLE.fixtures.crlf ?? "");
    expect((await step(solo, applyArgs("claude-code"))).exit).toBe(0);
    const quiet = await step(solo, ["restore", ...project("claude-code"), "--json"]);
    expect(quiet.exit, quiet.stderr).toBe(0);
    expect((JSON.parse(quiet.stdout) as { data: Record<string, unknown> }).data).not.toHaveProperty("sharedNote");
  });
});

describe("enable into a shared file (AC 44.2.3)", () => {
  const ctx = { platform: "linux" as const, env: {}, homeDir: HOME, projectDir: PROJECT, stateDir: STATE_DIR };
  const entry = { name: "iris-dev-mcp" as const, command: "npx", args: ["-y", "@iris-mcp/dev@1"], env: { IRIS_NAMESPACE: "A" } };

  /** vscode writes and disables its entry (a stash, the entry leaves the file). */
  function disabledByVscode(): MemFs {
    const fs = new MemFs();
    expect(apply(ctx, "vscode", "project", entry, { fs }).ok).toBe(true);
    expect(disable(ctx, "vscode", "project", "iris-dev-mcp", { fs }).ok).toBe(true);
    return fs;
  }

  it("refuses when the other client has since written an entry under the name, equal or different; the file is unchanged and the stash is kept", () => {
    for (const written of [entry, { ...entry, env: { IRIS_NAMESPACE: "B" } }]) {
      const fs = disabledByVscode();
      expect(apply(ctx, "claude-code", "project", written, { fs }).ok).toBe(true);
      const before = fs.readFile(FILE);
      const refused = enable(ctx, "vscode", "project", "iris-dev-mcp", { fs });
      expect(refused.ok).toBe(false);
      expect(refused.sharedWith).toEqual(["claude-code"]);
      expect(refused.reason).toContain(FILE);
      expect(fs.readFile(FILE)).toBe(before);
      expect(state(fs).stashes).toHaveLength(1);
    }
  });

  it("puts the stash back into an absent entry, records the enabler for the file, and then refuses the other client", () => {
    const fs = disabledByVscode();
    const enabled = enable(ctx, "vscode", "project", "iris-dev-mcp", { fs });
    expect(enabled.ok, enabled.reason ?? "").toBe(true);
    expect(fs.readFile(FILE)).toContain("iris-dev-mcp");
    expect(state(fs).stashes).toEqual([]);
    expect(state(fs).entries.map((record) => `${record.client}:${record.path}`)).toEqual([`vscode:${FILE}`]);
    const before = fs.readFile(FILE);
    const refused = apply(ctx, "claude-code", "project", { ...entry, env: { IRIS_NAMESPACE: "B" } }, { fs });
    expect(refused.ok).toBe(false);
    expect(refused.sharedWith).toEqual(["vscode"]);
    expect(fs.readFile(FILE)).toBe(before);
  });
});

describe("status, detect and doctor list the shared file under both clients and check it once (AC 44.2.3)", () => {
  it("status lists .mcp.json under both rows with sharedWith, and counts each entry of the file once", async () => {
    const fs = new MemFs();
    fs.seed(FILE, ORACLE.fixtures.comments ?? "");
    expect((await step(fs, applyArgs("claude-code"))).exit).toBe(0);
    // Each client owns one entry of the one file: two entries, not four.
    expect((await step(fs, ["apply", ...project("vscode"), "--servers", "iris-interop-mcp", "--yes", "--json"])).exit).toBe(0);
    const status = JSON.parse((await step(fs, ["status", "--json"])).stdout) as {
      data: {
        clients: Array<{ client: string; scopes: Array<{ scope: string; path: string | null; sharedWith?: string[] }> }>;
        counts: { managedEntries: number };
      };
    };
    const rows = ["claude-code", "vscode"].map((id) => status.data.clients.find((c) => c.client === id)?.scopes.find((s) => s.scope === "project"));
    expect(rows.map((row) => row?.path)).toEqual([FILE, FILE]);
    expect(rows[0]?.sharedWith).toEqual(["vscode"]);
    expect(rows[1]?.sharedWith).toEqual(["claude-code"]);
    expect(status.data.counts.managedEntries).toBe(2);
  });

  it("detect marks the shared config probe under both clients", async () => {
    const fs = new MemFs();
    fs.seed(FILE, "{}\n");
    const detect = JSON.parse((await step(fs, ["detect", "--json"])).stdout) as {
      data: { clients: Array<{ client: string; probes: Array<{ kind: string; scope?: string; sharedWith?: string[] }> }> };
    };
    const probe = (id: string) => detect.data.clients.find((c) => c.client === id)?.probes.find((p) => p.kind === "config" && p.scope === "project");
    expect(probe("claude-code")?.sharedWith).toEqual(["vscode"]);
    expect(probe("vscode")?.sharedWith).toEqual(["claude-code"]);
  });

  it("doctor parses and diagnoses an unreadable shared file once, not once per client", async () => {
    const fs = new MemFs();
    fs.seed(FILE, '{"mcpServers": ,}\n');
    const doctor = JSON.parse((await step(fs, ["doctor", "--json"])).stdout) as { data: { findings: Array<{ check: string; path: string | null; client: string }> } };
    const parse = doctor.data.findings.filter((finding) => finding.path === FILE);
    expect(parse.map((finding) => finding.check)).toEqual(["parseability"]);
  });

  it("doctor counts the shared file once among the parsed files", async () => {
    const shared = new MemFs();
    shared.seed(FILE, "{}\n");
    const count = async (fs: MemFs): Promise<number> =>
      (JSON.parse((await step(fs, ["doctor", "--json"])).stdout) as { data: { parsedFiles: number } }).data.parsedFiles;
    const withFile = await count(shared);
    const without = await count(new MemFs());
    expect(withFile - without).toBe(1);
  });

  it("an iris-* entry that only vscode records is never reported as unrecorded; an unrecorded one is reported once", async () => {
    const fs = new MemFs();
    fs.seed(FILE, `{"mcpServers":{"iris-extra":{"command":"x"},"iris-stray":{"command":"y"}}}\n`);
    const ledger: ManagerState = {
      version: 1,
      entries: [{ client: "vscode", scope: "project", name: "iris-extra", containsSecret: false, createdAt: "2026-11-22T00:00:00.000Z", updatedAt: "2026-11-22T00:00:00.000Z", path: FILE }],
      stashes: [],
    };
    fs.seed(`${STATE_DIR}/state.json`, JSON.stringify(ledger));
    const doctor = JSON.parse((await step(fs, ["doctor", "--json"])).stdout) as { data: { findings: Array<{ check: string; entry?: string }> } };
    const unrecorded = doctor.data.findings.filter((finding) => finding.check === "unrecorded-entries").map((finding) => finding.entry);
    expect(unrecorded).toEqual(["iris-stray"]);
  });
});

describe("shared-files.ts units", () => {
  const ctx = { platform: "linux" as const, env: {}, homeDir: HOME, projectDir: PROJECT };
  const vscode = CLIENT_ADAPTERS["vscode"];
  const claude = CLIENT_ADAPTERS["claude-code"];
  if (vscode === undefined || claude === undefined) throw new Error("registry");
  const empty: ManagerState = { version: 1, entries: [], stashes: [] };
  const record = (client: string, name = "iris-dev-mcp"): ManagerState["entries"][number] => ({
    client,
    scope: "project",
    name,
    containsSecret: false,
    createdAt: "2026-11-22T00:00:00.000Z",
    updatedAt: "2026-11-22T00:00:00.000Z",
    path: FILE,
  });

  it("sharedPeers finds the other adapter scope that resolves to the same path, and none for a user scope", () => {
    expect(sharedPeers(vscode, "project", ctx)).toEqual([{ client: "claude-code", scope: "project" }]);
    expect(sharedPeers(claude, "project", ctx)).toEqual([{ client: "vscode", scope: "project" }]);
    expect(sharedPeers(vscode, "user", ctx)).toEqual([]);
    expect(sharedPeers(claude, "user", ctx)).toEqual([]);
    expect(sharedPeers(vscode, "project", { platform: "linux", env: {}, homeDir: HOME })).toEqual([]);
    expect(peerClients(sharedPeers(vscode, "project", ctx))).toEqual(["claude-code"]);
  });

  it("fileOwner: the client with a manager record for this file; else the one holding a stash; else claude-code for a canonical name; else nobody", () => {
    const peersOfVscode = sharedPeers(vscode, "project", ctx);
    const peersOfClaude = sharedPeers(claude, "project", ctx);
    expect(PRE_SHARING_WRITERS).toEqual(["claude-code"]);
    const ownerOf = (state: ManagerState, name = "iris-dev-mcp"): string | null => fileOwner(state, "vscode", "project", name, peersOfVscode, AT);
    // No record at all: claude-code owns a canonical entry (AD-15), whichever client asks, and nobody owns any other name.
    expect(ownerOf(empty)).toBe("claude-code");
    expect(fileOwner(empty, "claude-code", "project", "iris-dev-mcp", peersOfClaude, AT)).toBe("claude-code");
    expect(ownerOf(empty, "my-own-server")).toBeNull();
    // A manager record for this file decides, either way round.
    expect(ownerOf({ ...empty, entries: [record("vscode")] })).toBe("vscode");
    expect(fileOwner({ ...empty, entries: [record("vscode")] }, "claude-code", "project", "iris-dev-mcp", peersOfClaude, AT)).toBe("vscode");
    expect(ownerOf({ ...empty, entries: [record("claude-code")] })).toBe("claude-code");
    // A stash counts when no manager record does, and a manager record outranks a stash (the owner of an entry that is in the file).
    const stash = (client: string): ManagerState["stashes"][number] => ({ client, scope: "project", name: "iris-dev-mcp", entry: { command: "x" }, disabledAt: "2026-11-22T00:00:00.000Z", path: FILE });
    expect(ownerOf({ ...empty, stashes: [stash("vscode")] })).toBe("vscode");
    expect(ownerOf({ ...empty, entries: [record("claude-code")], stashes: [stash("vscode")] })).toBe("claude-code");
    expect(ownerOf({ ...empty, entries: [record("vscode")], stashes: [stash("claude-code")] })).toBe("vscode");
    // A record without a path, or for another file, never makes vscode an owner.
    const pathless: ManagerState["entries"][number] = { ...record("vscode") };
    delete pathless.path;
    expect(ownerOf({ ...empty, entries: [pathless] })).toBe("claude-code");
    expect(ownerOf({ ...empty, entries: [{ ...record("vscode"), path: "/other/.mcp.json" }] })).toBe("claude-code");
    // Several holders of one kind (a state no longer written): the pre-sharing writer, so there is always one owner.
    expect(ownerOf({ ...empty, entries: [record("vscode"), record("claude-code")] })).toBe("claude-code");
  });

  it("ownedByOtherReason names the file, the owner and the way out, and never an entry's content", () => {
    const reason = ownedByOtherReason({ verb: "write", path: FILE, name: "iris-dev-mcp", client: "vscode", owner: "claude-code" });
    expect(reason).toContain(FILE);
    expect(reason).toContain("Claude Code (claude-code)");
    expect(reason).toContain("nothing was written");
    expect(reason).toContain("iris-mcp-clients remove --client claude-code --scope project --server iris-dev-mcp");
    expect(reason).toContain("then apply it with vscode");
  });

  it("dropPeerRecords drops the peers' manager records of one name for one file, and nothing else", () => {
    const peersOfClaude = sharedPeers(claude, "project", ctx);
    const state: ManagerState = {
      version: 1,
      entries: [record("vscode"), { ...record("vscode"), path: "/other/.mcp.json" }, record("vscode", "iris-interop-mcp"), record("claude-code")],
      stashes: [{ client: "vscode", scope: "project", name: "iris-dev-mcp", entry: { command: "x" }, disabledAt: "2026-11-22T00:00:00.000Z", path: FILE }],
    };
    const next = dropPeerRecords(state, peersOfClaude, "iris-dev-mcp", AT);
    expect(next.entries.map((entry) => `${entry.client}:${entry.name}:${entry.path}`)).toEqual([
      "vscode:iris-dev-mcp:/other/.mcp.json",
      `vscode:iris-interop-mcp:${FILE}`,
      `claude-code:iris-dev-mcp:${FILE}`,
    ]);
    expect(next.stashes).toHaveLength(1);
  });

  it("sharedFileNote names the other clients", () => {
    expect(sharedFileNote(FILE, ["claude-code"])).toBe(`${FILE} is shared: Claude Code (claude-code) reads the same file, so this change also affects it.`);
    expect(sharedFileNote(FILE, ["claude-code", "vscode"])).toContain("read the same file");
  });
});

