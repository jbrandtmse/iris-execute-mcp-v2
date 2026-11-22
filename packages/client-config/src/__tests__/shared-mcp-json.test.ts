/**
 * Story 44.2, AC 44.2.3 - the shared project `.mcp.json` (Claude Code's project file and VS Code Copilot's).
 *
 * Covers the shared-file rows of the I/O matrix on NON-canonical `.mcp.json` fixtures (compact, 4-space, CRLF, BOM,
 * comment-bearing; Rule #58) through the CLI core, for `vscode` and for `claude-code`: adopt, conflict, the claude-only
 * back-compat oracle, the shared disable/remove text, status and doctor listing and checking the file once, and foreign
 * bytes preserved.
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
  adoptOrConflict,
  jsonEqual,
  otherOwners,
  ownerClients,
  peerClients,
  sharedFileNote,
  sharedPeers,
  soleOwner,
} from "../shared-files.js";
import { readState, type ManagerState } from "../state.js";

import { MemFs, fixedNow, readFixture } from "./helpers.js";

const HOME = "/home/u";
const PROJECT = "/proj";
const FILE = `${PROJECT}/.mcp.json`;
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

describe("adopt and conflict (AC 44.2.3)", () => {
  it("adopt: the entry claude-code wrote is adopted by vscode with the same mode: no file edit, a vscode record, and the result says so", async () => {
    const fs = new MemFs();
    fs.seed(FILE, ORACLE.fixtures.compact ?? "");
    expect((await step(fs, applyArgs("claude-code"))).exit).toBe(0);
    const before = fs.readFile(FILE);
    const adopted = await step(fs, applyArgs("vscode"));
    expect(adopted.exit).toBe(0);
    expect(fs.readFile(FILE)).toBe(before);
    expect(recorded(fs, "vscode")).toEqual(["iris-dev-mcp"]);
    expect(recorded(fs, "claude-code")).toEqual(["iris-dev-mcp"]);
    const data = (JSON.parse(adopted.stdout) as { data: { changed: number; results: Array<{ adopted?: boolean; sharedWith?: string[]; note?: string; changed: boolean }> } }).data;
    expect(data.changed).toBe(0);
    expect(data.results[0]).toMatchObject({ adopted: true, sharedWith: ["claude-code"], changed: false });
    expect(data.results[0]?.note).toContain("adopted");
    expect(data.results[0]?.note).toContain("shared with claude-code");
    // No backup is taken: nothing is written.
    expect([...fs.files.keys()].filter((path) => path.includes("/backups/vscode/"))).toEqual([]);
  });

  it("adopt in the other direction: claude-code adopts an entry vscode wrote first", async () => {
    const fs = new MemFs();
    expect((await step(fs, applyArgs("vscode"))).exit).toBe(0);
    const before = fs.readFile(FILE);
    const adopted = await step(fs, applyArgs("claude-code"));
    expect(adopted.exit).toBe(0);
    expect(fs.readFile(FILE)).toBe(before);
    expect(recorded(fs, "claude-code")).toEqual(["iris-dev-mcp"]);
    const data = (JSON.parse(adopted.stdout) as { data: { results: Array<{ adopted?: boolean; sharedWith?: string[] }> } }).data;
    expect(data.results[0]).toMatchObject({ adopted: true, sharedWith: ["vscode"] });
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

  it("an unrecorded entry equal to what vscode would write is adopted, even when it was reformatted by hand", async () => {
    const fs = new MemFs();
    expect((await step(fs, applyArgs("vscode"))).exit).toBe(0);
    const parsed = JSON.parse(fs.readFile(FILE)) as unknown;
    // Re-serialized compact (a hand reformat) and with no ledger at all.
    fs.files.set(FILE, JSON.stringify(parsed));
    fs.files.delete(`${STATE_DIR}/state.json`);
    const before = fs.readFile(FILE);
    const adopted = await step(fs, applyArgs("vscode"));
    // The sole-owner rule: nobody records it, so claude-code (the pre-sharing writer) is the implied owner; the equal entry is adopted.
    expect(adopted.exit).toBe(0);
    expect(fs.readFile(FILE)).toBe(before);
    expect(recorded(fs, "vscode")).toEqual(["iris-dev-mcp"]);
  });
});

describe("shared disable and remove say that the other client reads the same file (AC 44.2.3)", () => {
  async function both(): Promise<MemFs> {
    const fs = new MemFs();
    fs.seed(FILE, ORACLE.fixtures.crlf ?? "");
    expect((await step(fs, applyArgs("claude-code"))).exit).toBe(0);
    expect((await step(fs, applyArgs("vscode"))).exit).toBe(0);
    return fs;
  }

  it("vscode disable proceeds, removes the entry, and notes Claude Code", async () => {
    const fs = await both();
    const text = await step(fs, ["disable", ...project("vscode"), "--server", "iris-dev-mcp"]);
    expect(text.exit).toBe(0);
    expect(text.stdout).toContain("Claude Code (claude-code) reads the same file");
    expect(fs.readFile(FILE)).not.toContain("iris-dev-mcp");
  });

  it("vscode remove proceeds and says so in the JSON result too", async () => {
    const fs = await both();
    const json = await step(fs, ["remove", ...project("vscode"), "--server", "iris-dev-mcp", "--json"]);
    expect(json.exit).toBe(0);
    const result = (JSON.parse(json.stdout) as { data: { sharedWith?: string[]; sharedNote?: string; changed: boolean } }).data;
    expect(result.changed).toBe(true);
    expect(result.sharedWith).toEqual(["claude-code"]);
    expect(result.sharedNote).toContain("Claude Code (claude-code) reads the same file");
  });

  it("claude-code disable notes that vscode reads the file when vscode records the entry", async () => {
    const fs = await both();
    const text = await step(fs, ["disable", ...project("claude-code"), "--server", "iris-dev-mcp"]);
    expect(text.exit).toBe(0);
    expect(text.stdout).toContain("VS Code (Copilot) (vscode) reads the same file");
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
    // vscode adopted the entry (no write, so no backup yet); its disable is the write whose backup the restore rolls back to.
    expect((await step(fs, ["disable", ...project("vscode"), "--server", "iris-dev-mcp"])).exit).toBe(0);
    const restored = await step(fs, ["restore", ...project("vscode"), "--json"]);
    expect(restored.exit, restored.stderr).toBe(0);
    const data = (JSON.parse(restored.stdout) as { data: { sharedWith?: string[]; sharedNote?: string } }).data;
    expect(data.sharedWith).toEqual(["claude-code"]);
    expect(data.sharedNote).toContain("Claude Code (claude-code) reads the same file");
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

  /** vscode writes and disables its entry (a stash), then claude-code is recorded too. */
  function disabledByVscode(): MemFs {
    const fs = new MemFs();
    expect(apply(ctx, "vscode", "project", entry, { fs }).ok).toBe(true);
    expect(apply(ctx, "claude-code", "project", entry, { fs }).ok).toBe(true);
    expect(disable(ctx, "vscode", "project", "iris-dev-mcp", { fs }).ok).toBe(true);
    return fs;
  }

  it("refuses when the other client has since written a different entry under the name; the file is unchanged and the stash is kept", () => {
    const fs = disabledByVscode();
    expect(apply(ctx, "claude-code", "project", { ...entry, env: { IRIS_NAMESPACE: "B" } }, { fs }).ok).toBe(true);
    const before = fs.readFile(FILE);
    const refused = enable(ctx, "vscode", "project", "iris-dev-mcp", { fs });
    expect(refused.ok).toBe(false);
    expect(refused.sharedWith).toEqual(["claude-code"]);
    expect(refused.reason).toContain(FILE);
    expect(fs.readFile(FILE)).toBe(before);
    expect(state(fs).stashes).toHaveLength(1);
  });

  it("proceeds when the entry the other client wrote equals the stash: nothing is rewritten and the stash is dropped", () => {
    const fs = disabledByVscode();
    expect(apply(ctx, "claude-code", "project", entry, { fs }).ok).toBe(true);
    const before = fs.readFile(FILE);
    const enabled = enable(ctx, "vscode", "project", "iris-dev-mcp", { fs });
    expect(enabled.ok, enabled.reason ?? "").toBe(true);
    expect(fs.readFile(FILE)).toBe(before);
    expect(state(fs).stashes).toEqual([]);
  });
});

describe("status, detect and doctor list the shared file under both clients and check it once (AC 44.2.3)", () => {
  it("status lists .mcp.json under both rows with sharedWith, and counts one entry once", async () => {
    const fs = new MemFs();
    fs.seed(FILE, ORACLE.fixtures.comments ?? "");
    await step(fs, applyArgs("claude-code"));
    await step(fs, applyArgs("vscode"));
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
    expect(status.data.counts.managedEntries).toBe(1);
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
      entries: [{ client: "vscode", scope: "project", name: "iris-extra", containsSecret: false, createdAt: "2026-11-22T00:00:00.000Z", updatedAt: "2026-11-22T00:00:00.000Z" }],
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
  });

  it("sharedPeers finds the other adapter scope that resolves to the same path, and none for a user scope", () => {
    expect(sharedPeers(vscode, "project", ctx)).toEqual([{ client: "claude-code", scope: "project" }]);
    expect(sharedPeers(claude, "project", ctx)).toEqual([{ client: "vscode", scope: "project" }]);
    expect(sharedPeers(vscode, "user", ctx)).toEqual([]);
    expect(sharedPeers(claude, "user", ctx)).toEqual([]);
    expect(sharedPeers(vscode, "project", { platform: "linux", env: {}, homeDir: HOME })).toEqual([]);
    expect(peerClients(sharedPeers(vscode, "project", ctx))).toEqual(["claude-code"]);
  });

  it("ownership: a client owns alone when only its ledger records the entry; claude-code also owns an entry nobody records", () => {
    const peersOfVscode = sharedPeers(vscode, "project", ctx);
    const peersOfClaude = sharedPeers(claude, "project", ctx);
    expect(PRE_SHARING_WRITERS).toEqual(["claude-code"]);
    expect(soleOwner(empty, "claude-code", "project", "iris-dev-mcp", peersOfClaude)).toBe(true);
    expect(soleOwner(empty, "vscode", "project", "iris-dev-mcp", peersOfVscode)).toBe(false);
    const vscodeOnly: ManagerState = { ...empty, entries: [record("vscode")] };
    expect(soleOwner(vscodeOnly, "vscode", "project", "iris-dev-mcp", peersOfVscode)).toBe(true);
    expect(soleOwner(vscodeOnly, "claude-code", "project", "iris-dev-mcp", peersOfClaude)).toBe(false);
    const both: ManagerState = { ...empty, entries: [record("claude-code"), record("vscode")] };
    expect(soleOwner(both, "claude-code", "project", "iris-dev-mcp", peersOfClaude)).toBe(false);
    expect(soleOwner(both, "vscode", "project", "iris-dev-mcp", peersOfVscode)).toBe(false);
    expect(ownerClients(both, "vscode", "project", "iris-dev-mcp", peersOfVscode).sort()).toEqual(["claude-code", "vscode"]);
    expect(otherOwners(both, "vscode", "project", "iris-dev-mcp", peersOfVscode)).toEqual(["claude-code"]);
    expect(otherOwners(empty, "claude-code", "project", "iris-dev-mcp", peersOfClaude)).toEqual([]);
  });

  it("a stash counts as ownership too", () => {
    const stashed: ManagerState = {
      ...empty,
      stashes: [{ client: "vscode", scope: "project", name: "iris-dev-mcp", entry: { command: "x" }, disabledAt: "2026-11-22T00:00:00.000Z" }],
    };
    expect(ownerClients(stashed, "claude-code", "project", "iris-dev-mcp", sharedPeers(claude, "project", ctx))).toEqual(["vscode"]);
  });

  it("adoptOrConflict adopts a JSON-equal entry whatever its key order, and refuses any other, naming the file and the other client", () => {
    const existing = { command: "npx", args: ["-y", "p@1"], env: { A: "1", B: "2" } };
    expect(adoptOrConflict({ existing, wouldWrite: { env: { B: "2", A: "1" }, args: ["-y", "p@1"], command: "npx" }, path: FILE, name: "iris-dev-mcp", client: "vscode", owners: ["claude-code"] })).toEqual({ kind: "adopt" });
    const refused = adoptOrConflict({ existing, wouldWrite: { ...existing, args: ["-y", "p@2"] }, path: FILE, name: "iris-dev-mcp", client: "vscode", owners: ["claude-code", "vscode"] });
    expect(refused.kind).toBe("conflict");
    if (refused.kind === "conflict") {
      expect(refused.reason).toContain(FILE);
      expect(refused.reason).toContain("claude-code");
    }
  });

  it("jsonEqual is order-insensitive for objects, order-sensitive for arrays, and strict on types", () => {
    expect(jsonEqual({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 })).toBe(true);
    expect(jsonEqual({ a: [1, 2] }, { a: [2, 1] })).toBe(false);
    expect(jsonEqual({ a: 1 }, { a: "1" })).toBe(false);
    expect(jsonEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(jsonEqual(null, {})).toBe(false);
  });

  it("sharedFileNote names the other clients", () => {
    expect(sharedFileNote(FILE, ["claude-code"])).toBe(`${FILE} is shared: Claude Code (claude-code) reads the same file, so this change also affects it.`);
    expect(sharedFileNote(FILE, ["claude-code", "vscode"])).toContain("read the same file");
  });
});

