/**
 * Story 33.1 Task 1 + Task 2 / AC 33.1.1 + AC 33.1.2 — the write executors
 * and the universal safety protocol.
 *
 * Proves: (a) `executeNativeEdit` per format family incl. `null` ⇒
 * byte-identical; (b) `applyWrite`'s protocol: pre-parse refusal (no write,
 * no backup), timestamped backups with exact original bytes, post-write
 * re-parse with AUTO-RESTORE on failure (never a broken file left); (c)
 * backup listing + latest/named restore with refusals. Everything through an
 * in-memory fs + fixed clock — never the real HOME.
 */

import { describe, it, expect } from "vitest";
import { parse as parseToml } from "smol-toml";

import {
  CLIENT_ADAPTERS,
  executeNativeEdit,
  applyWrite,
  backupDir,
  backupPathFor,
  listBackups,
  restoreBackup,
  diff,
  type CanonicalEntry,
  type CanonicalServerName,
  type ClientAdapter,
  type WriteFs,
} from "../index.js";
import { MemFs, fixedNow, readFixture } from "./helpers.js";

const PKG: Record<CanonicalServerName, string> = {
  "iris-dev-mcp": "@iris-mcp/dev",
  "iris-admin-mcp": "@iris-mcp/admin",
  "iris-ops-mcp": "@iris-mcp/ops",
  "iris-interop-mcp": "@iris-mcp/interop",
  "iris-data-mcp": "@iris-mcp/data",
};

function canonicalEntryForTest(name: CanonicalServerName): CanonicalEntry {
  return { name, command: "npx", args: ["-y", PKG[name]], env: { IRIS_NAMESPACE: "HSCUSTOM" } };
}

function adapterOf(id: string): ClientAdapter {
  const adapter = CLIENT_ADAPTERS[id];
  if (!adapter) throw new Error(`registry missing ${id}`);
  return adapter;
}

const STATE_DIR = "/state";

function writeOptions(adapter: ClientAdapter, fs: WriteFs, now?: () => Date) {
  return {
    adapter,
    client: adapter.id,
    scope: "user" as const,
    stateDir: STATE_DIR,
    platform: "linux" as const,
    fs,
    ...(now ? { now } : {}),
  };
}

describe("executeNativeEdit (AC 33.1.1)", () => {
  it("native: null returns the content byte-identical (already-in-state no-op)", () => {
    const content = readFixture("claude-code/user.json");
    expect(executeNativeEdit(content, null)).toBe(content);
    expect(executeNativeEdit(readFixture("codex/config.toml"), null)).toBe(readFixture("codex/config.toml"));
    expect(executeNativeEdit(readFixture("goose/config.yaml"), null)).toBe(readFixture("goose/config.yaml"));
  });

  it("jsonc: executes the rendered edit set via applyEdits", () => {
    const adapter = adapterOf("claude-code");
    const content = readFixture("claude-code/user.json");
    const result = diff(content, canonicalEntryForTest("iris-ops-mcp"), adapter, "user", "apply");
    if (!result.ok) throw new Error("diff must succeed");
    const after = executeNativeEdit(content, result.native);
    expect(after).toContain("iris-ops-mcp");
    expect(after).toContain("github-mcp"); // foreign survives
  });

  it("toml insert into an EMPTY document starts the block at line 1 (no stray blank)", () => {
    const adapter = adapterOf("codex");
    const result = diff("", canonicalEntryForTest("iris-dev-mcp"), adapter, "user", "apply");
    if (!result.ok) throw new Error("diff must succeed");
    const after = executeNativeEdit("", result.native);
    expect(after.startsWith("[mcp_servers.iris-dev-mcp]")).toBe(true);
    expect(after.endsWith("\n")).toBe(true);
  });

  it("toml insert → remove-region is a BYTE-EXACT inverse (blank-collapse)", () => {
    const adapter = adapterOf("codex");
    const content = readFixture("codex/config.toml");
    const add = diff(content, canonicalEntryForTest("iris-ops-mcp"), adapter, "user", "apply");
    if (!add.ok) throw new Error("diff must succeed");
    const afterAdd = executeNativeEdit(content, add.native);
    const remove = diff(afterAdd, canonicalEntryForTest("iris-ops-mcp"), adapter, "user", "remove");
    if (!remove.ok) throw new Error("diff must succeed");
    const afterRemove = executeNativeEdit(afterAdd, remove.native);
    expect(afterRemove).toBe(content);
  });

  it("toml set-flag inserts directly after the owned header", () => {
    const adapter = adapterOf("codex");
    const content = readFixture("codex/config.toml");
    const disable = diff(content, canonicalEntryForTest("iris-dev-mcp"), adapter, "user", "disable");
    if (!disable.ok) throw new Error("diff must succeed");
    const after = executeNativeEdit(content, disable.native);
    const lines = after.split("\n");
    const headerIdx = lines.findIndex((l) => l.includes("[mcp_servers.iris-dev-mcp]"));
    expect(lines[headerIdx + 1]).toBe("enabled = false");
    expect(lines[headerIdx + 2]).toBe('command = "npx"');
    expect(after).toContain("[mcp_servers.context7]");
  });

  it("33-1-R2 / 33-5-R1: toml set-flag splices a CRLF-terminated line into a CRLF file — no bare LF introduced", () => {
    const adapter = adapterOf("codex");
    const content = ["[mcp_servers.iris-dev-mcp]", 'command = "npx"', 'args = ["-y", "@iris-mcp/dev"]', ""].join("\r\n");
    const disable = diff(content, canonicalEntryForTest("iris-dev-mcp"), adapter, "user", "disable");
    if (!disable.ok) throw new Error("diff must succeed");
    const after = executeNativeEdit(content, disable.native);
    expect(after).toContain("enabled = false\r\n");
    // No bare (non-CRLF-preceded) LF anywhere in the result.
    expect(/(?<!\r)\n/.test(after)).toBe(false);
  });

  it("33-1-R2 / 33-5-R1: toml INSERT (a new table) into a CRLF file carries CRLF on every new line, incl. the blank separator", () => {
    const adapter = adapterOf("codex");
    const content = ["[mcp_servers.context7]", 'command = "npx"', ""].join("\r\n");
    const add = diff(content, canonicalEntryForTest("iris-dev-mcp"), adapter, "user", "apply");
    if (!add.ok) throw new Error("diff must succeed");
    const after = executeNativeEdit(content, add.native);
    expect(after).toContain("[mcp_servers.iris-dev-mcp]\r\n");
    expect(/(?<!\r)\n/.test(after)).toBe(false);
    expect(parseToml(after)).toBeDefined(); // still valid TOML
  });

  it("33-5-R1: toml merge-update (command/args/env replacement spans) carries CRLF through every replaced AND inserted line, comment-bearing + 4-space-indented fixture", () => {
    const adapter = adapterOf("codex");
    const content = [
      "[mcp_servers.iris-dev-mcp] # managed",
      'command = "old" # keep me',
      "startup_timeout_sec = 30",
      "",
      "[mcp_servers.iris-dev-mcp.env]",
      'EXTRA = "keep-me"',
      "",
    ].join("\r\n");
    const result = diff(content, canonicalEntryForTest("iris-dev-mcp"), adapter, "user", "apply");
    if (!result.ok) throw new Error("diff must succeed");
    expect((result.native as { op?: string })?.op).toBe("merge-update");
    const after = executeNativeEdit(content, result.native);
    expect(/(?<!\r)\n/.test(after)).toBe(false); // no bare LF anywhere
    expect(after).toContain('command = "npx" # keep me\r\n'); // changed value, comment carried (33-5-R2 leg a)
    expect(after).toContain("startup_timeout_sec = 30\r\n"); // untouched line, byte-exact
    expect(after).toContain('EXTRA = "keep-me"\r\n'); // untouched env key, byte-exact
    expect(after).toContain('IRIS_NAMESPACE = "HSCUSTOM"\r\n'); // new env key, CRLF too
    expect(parseToml(after)).toBeDefined();
  });

  // ── Story 36.3 code review ────────────────────────────────────────────
  // Rule #58 fixture diversity the dev-stage CRLF tests lacked: every one of
  // them had an existing [mcp_servers.*] table AND a trailing CRLF, so the
  // splice's reference line was always a real CRLF line. The commonest real
  // write — a first `apply` into a config.toml with no MCP table yet — and
  // every no-trailing-newline file still came out mixed. Oracle (no
  // hand-authored bytes): the CRLF output must equal the LF output for the
  // LF-normalized input with every "\n" as "\r\n", and carry no bare LF.
  const TOML_EOL_CASES: Record<string, string> = {
    "no [mcp_servers.*] table, trailing newline (first-time apply)": 'model = "o3"\n',
    "no [mcp_servers.*] table, NO trailing newline": 'model = "o3"\napproval_policy = "never"',
    "existing root table, NO trailing newline": '[mcp_servers.other]\ncommand = "x"',
    "command-only owned entry, trailing newline (merge-update)": '[mcp_servers.iris-dev-mcp]\ncommand = "npx"\n',
    "command-only owned entry, 4-space + trailing comment, NO trailing newline (merge-update)":
      '[mcp_servers.iris-dev-mcp]\n    command = "npx" # pinned',
  };
  for (const [label, lfContent] of Object.entries(TOML_EOL_CASES)) {
    it(`CRLF parity — ${label}: CRLF output is the LF output with CRLF terminators, no bare LF`, () => {
      const adapter = adapterOf("codex");
      const entry = canonicalEntryForTest("iris-dev-mcp");
      const crlfContent = lfContent.replace(/\n/g, "\r\n");
      const lfDiff = diff(lfContent, entry, adapter, "user", "apply");
      const crlfDiff = diff(crlfContent, entry, adapter, "user", "apply");
      if (!lfDiff.ok || !crlfDiff.ok) throw new Error("both diffs must succeed");
      const lfAfter = executeNativeEdit(lfContent, lfDiff.native);
      const crlfAfter = executeNativeEdit(crlfContent, crlfDiff.native);
      expect(/(?<!\r)\n/.test(crlfAfter)).toBe(false);
      expect(crlfAfter.endsWith("\r")).toBe(false); // never a dangling CR at EOF
      expect(crlfAfter).toBe(lfAfter.replace(/\n/g, "\r\n"));
      expect(parseToml(crlfAfter)).toEqual(parseToml(lfAfter));
    });
  }

  it("merge-update tie order (Story 36.3 code review, HIGH): an `args` insert and a new env table landing on the SAME line keep push order — `args` never ends up inside the env table", () => {
    const adapter = adapterOf("codex");
    const entry = canonicalEntryForTest("iris-dev-mcp");
    for (const content of ['[mcp_servers.iris-dev-mcp]\ncommand = "npx"\n', '[mcp_servers.iris-dev-mcp]\r\ncommand = "npx"\r\n']) {
      const result = diff(content, entry, adapter, "user", "apply");
      if (!result.ok) throw new Error("diff must succeed");
      expect((result.native as { op?: string })?.op).toBe("merge-update");
      const parsed = parseToml(executeNativeEdit(content, result.native)) as { mcp_servers: Record<string, Record<string, unknown>> };
      const written = parsed.mcp_servers["iris-dev-mcp"] ?? {};
      expect(written.command).toBe("npx");
      expect(written.args).toEqual(["-y", "@iris-mcp/dev"]);
      expect(written.env).toEqual({ IRIS_NAMESPACE: "HSCUSTOM" }); // pre-fix: { IRIS_NAMESPACE, args: [...] }
    }
  });

  it("merge-update tie order: a `command` INSERT and an `args` REPLACEMENT on the same line (an entry whose first body line is `args`) — the replacement never overwrites the inserted command", () => {
    const adapter = adapterOf("codex");
    const content = '[mcp_servers.iris-dev-mcp]\nargs = ["old"]\n';
    const result = diff(content, canonicalEntryForTest("iris-dev-mcp"), adapter, "user", "apply");
    if (!result.ok) throw new Error("diff must succeed");
    const after = executeNativeEdit(content, result.native);
    const parsed = parseToml(after) as { mcp_servers: Record<string, Record<string, unknown>> };
    const written = parsed.mcp_servers["iris-dev-mcp"] ?? {};
    expect(written.command).toBe("npx");
    expect(written.args).toEqual(["-y", "@iris-mcp/dev"]);
    expect(after.indexOf("command = ")).toBeLessThan(after.indexOf("args = "));
  });

  it("yaml: set/delete via the Document API with comments preserved", () => {
    const adapter = adapterOf("goose");
    const content = readFixture("goose/config.yaml");
    const add = diff(content, canonicalEntryForTest("iris-interop-mcp"), adapter, "user", "apply");
    if (!add.ok) throw new Error("diff must succeed");
    const after = executeNativeEdit(content, add.native);
    expect(after).toContain("iris-interop-mcp");
    expect(after).toContain("# Built-in Goose extension");
    const remove = diff(after, canonicalEntryForTest("iris-interop-mcp"), adapter, "user", "remove");
    if (!remove.ok) throw new Error("diff must succeed");
    const removed = executeNativeEdit(after, remove.native);
    expect(removed).not.toContain("iris-interop-mcp");
    expect(removed).toContain("# Built-in Goose extension");
  });
});

describe("applyWrite safety protocol (AC 33.1.2)", () => {
  it("refuses to touch an already-unparseable file — no write, no backup", () => {
    const adapter = adapterOf("claude-code");
    const fs = new MemFs();
    const bad = "{ not valid json !!!";
    fs.seed("/h/.claude.json", bad);
    const result = applyWrite("/h/.claude.json", bad, "{}", writeOptions(adapter, fs));
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("unparseable");
    expect(result.reason).not.toContain("not valid json"); // never content
    expect(fs.readFile("/h/.claude.json")).toBe(bad); // untouched
    expect(fs.pathsUnder(STATE_DIR)).toEqual([]); // no backup dir created
  });

  it("happy path: timestamped backup holds the EXACT prior bytes; file written; re-parse passes", () => {
    const adapter = adapterOf("claude-code");
    const fs = new MemFs();
    const original = readFixture("claude-code/user.json");
    fs.seed("/h/.claude.json", original);
    const now = fixedNow(123);
    const updated = original.replace('"numStartups": 4', '"numStartups": 5');
    const result = applyWrite("/h/.claude.json", original, updated, writeOptions(adapter, fs, now));
    expect(result.ok).toBe(true);
    const expectedBackup = backupPathFor(STATE_DIR, "claude-code", "user", "/h/.claude.json", "linux", new Date(Date.UTC(2026, 6, 27, 12, 0, 0, 123)));
    expect(result.backupPath).toBe(expectedBackup);
    expect(fs.readFile(expectedBackup)).toBe(original); // exact prior bytes
    expect(fs.readFile("/h/.claude.json")).toBe(updated);
  });

  it("33-1-R4: two writes landing in the SAME millisecond disambiguate their backups instead of the second overwriting the first", () => {
    const adapter = adapterOf("claude-code");
    const fs = new MemFs();
    const original = readFixture("claude-code/user.json");
    fs.seed("/h/.claude.json", original);
    const now = fixedNow(123, 123); // identical stamp on both calls
    const firstUpdate = original.replace('"numStartups": 4', '"numStartups": 5');
    const first = applyWrite("/h/.claude.json", original, firstUpdate, writeOptions(adapter, fs, now));
    expect(first.ok).toBe(true);
    const baseBackup = backupPathFor(STATE_DIR, "claude-code", "user", "/h/.claude.json", "linux", new Date(Date.UTC(2026, 6, 27, 12, 0, 0, 123)));
    expect(first.backupPath).toBe(baseBackup);
    expect(fs.readFile(baseBackup)).toBe(original); // the FIRST write's prior bytes

    const secondUpdate = firstUpdate.replace('"numStartups": 5', '"numStartups": 6');
    const second = applyWrite("/h/.claude.json", firstUpdate, secondUpdate, writeOptions(adapter, fs, now));
    expect(second.ok).toBe(true);
    expect(second.backupPath).not.toBe(baseBackup); // disambiguated, never overwriting the first
    expect(second.backupPath).toBe(`${baseBackup}-1`);
    expect(fs.readFile(baseBackup)).toBe(original); // the FIRST backup survives untouched
    expect(fs.readFile(second.backupPath as string)).toBe(firstUpdate); // the SECOND write's own prior bytes

    // Both backups are visible to listBackups, oldest first.
    const listed = listBackups("/h/.claude.json", writeOptions(adapter, fs));
    expect(listed).toEqual([baseBackup, second.backupPath]);
  });

  it("a brand-new file gets no backup and parses cleanly after the write", () => {
    const adapter = adapterOf("codex");
    const fs = new MemFs();
    const result = applyWrite(
      "/h/.codex/config.toml",
      null,
      "[mcp_servers.iris-dev-mcp]\ncommand = \"npx\"\n",
      writeOptions(adapter, fs),
    );
    expect(result.ok).toBe(true);
    expect(result.backupPath).toBeUndefined();
    expect(fs.exists("/h/.codex/config.toml")).toBe(true);
  });

  it("post-write parse failure AUTO-RESTORES the prior bytes and reports", () => {
    const adapter = adapterOf("claude-code");
    const fs = new MemFs();
    const original = readFixture("claude-code/user.json");
    fs.seed("/h/.claude.json", original);
    const result = applyWrite("/h/.claude.json", original, "{ this cannot parse", writeOptions(adapter, fs));
    expect(result.ok).toBe(false);
    expect(result.restored).toBe(true);
    expect(result.reason).toContain("post-write parse failure");
    expect(result.reason).toContain("/h/.claude.json");
    expect(fs.readFile("/h/.claude.json")).toBe(original); // restored
    expect(result.backupPath).toBeDefined(); // backup retained for audit
  });

  it("post-write parse failure on a NEW file removes it (nothing to restore)", () => {
    const adapter = adapterOf("goose");
    const fs = new MemFs();
    const result = applyWrite("/h/.config/goose/config.yaml", null, ":\n  - [not yaml", writeOptions(adapter, fs));
    expect(result.ok).toBe(false);
    expect(result.restored).toBe(true);
    expect(fs.exists("/h/.config/goose/config.yaml")).toBe(false);
  });

  it("a backup failure refuses the write BEFORE the file is touched", () => {
    const adapter = adapterOf("claude-code");
    const fs = new MemFs();
    const original = readFixture("claude-code/user.json");
    fs.seed("/h/.claude.json", original);
    const failing = new Proxy(fs, {
      get(target, prop) {
        if (prop === "mkdir") {
          return () => {
            throw new Error("EACCES: permission denied, mkdir '/state'");
          };
        }
        return Reflect.get(target, prop);
      },
    });
    const result = applyWrite("/h/.claude.json", original, "{}", writeOptions(adapter, failing));
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("backup");
    expect(fs.readFile("/h/.claude.json")).toBe(original);
  });
});

describe("backup listing + restore (AC 33.1.2)", () => {
  function seededBackups(fs: MemFs): void {
    const dir = backupDir(STATE_DIR, "claude-code", "user", "linux");
    fs.seed(`${dir}/.claude.json.2026-07-27T12-00-00-001Z`, "first");
    fs.seed(`${dir}/.claude.json.2026-07-27T12-00-00-002Z`, "second");
    fs.seed(`${dir}/.claude.json.2026-07-27T12-00-00-003Z`, "third");
    // A DIFFERENT file's backup in the same dir is not listed.
    fs.seed(`${dir}/other.json.2026-07-27T12-00-00-004Z`, "other");
  }

  it("lists backups oldest-first for exactly this file", () => {
    const adapter = adapterOf("claude-code");
    const fs = new MemFs();
    seededBackups(fs);
    const backups = listBackups("/h/.claude.json", writeOptions(adapter, fs));
    expect(backups).toHaveLength(3);
    expect(backups[0]).toContain("001Z");
    expect(backups[2]).toContain("003Z");
  });

  it("restore picks the LATEST backup by default and writes it through the safety protocol", () => {
    const adapter = adapterOf("claude-code");
    const fs = new MemFs();
    fs.seed("/h/.claude.json", '{\n  "mcpServers": {}\n}\n');
    const dir = backupDir(STATE_DIR, "claude-code", "user", "linux");
    fs.seed(`${dir}/.claude.json.2026-07-27T12-00-00-001Z`, '{\n  "mcpServers": {\n    "iris-dev-mcp": { "command": "npx", "args": [] }\n  }\n}\n');
    const result = restoreBackup("/h/.claude.json", writeOptions(adapter, fs));
    expect(result.ok).toBe(true);
    expect(result.restoredFrom).toContain("001Z");
    expect(fs.readFile("/h/.claude.json")).toContain("iris-dev-mcp");
    // The restore itself backed up the pre-restore file.
    expect(result.backupPath).toBeDefined();
  });

  it("restore by NAME selects the named backup; an unknown name refuses", () => {
    const adapter = adapterOf("claude-code");
    const fs = new MemFs();
    fs.seed("/h/.claude.json", '{\n  "mcpServers": {}\n}\n');
    const dir = backupDir(STATE_DIR, "claude-code", "user", "linux");
    fs.seed(`${dir}/.claude.json.2026-07-27T12-00-00-001Z`, '{\n  "mcpServers": {\n    "a": { "command": "x", "args": [] }\n  }\n}\n');
    fs.seed(`${dir}/.claude.json.2026-07-27T12-00-00-002Z`, '{\n  "mcpServers": {\n    "b": { "command": "y", "args": [] }\n  }\n}\n');
    const named = restoreBackup("/h/.claude.json", {
      ...writeOptions(adapter, fs),
      backup: ".claude.json.2026-07-27T12-00-00-001Z",
    });
    expect(named.ok).toBe(true);
    expect(fs.readFile("/h/.claude.json")).toContain('"a"');
    const unknown = restoreBackup("/h/.claude.json", { ...writeOptions(adapter, fs), backup: "nope.json.999" });
    expect(unknown.ok).toBe(false);
    expect(unknown.reason).toContain("nope.json.999");
  });

  it("restore refuses when no backup exists", () => {
    const adapter = adapterOf("claude-code");
    const fs = new MemFs();
    fs.seed("/h/.claude.json", "{}");
    const result = restoreBackup("/h/.claude.json", writeOptions(adapter, fs));
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("no backups");
  });

  it("restore with an UNREADABLE current config returns a typed refusal — never throws (33.1 review)", () => {
    // Regression: pre-fix, the current-file read in restoreBackup was
    // unguarded, so EACCES/EBUSY on the recovery path escaped as an
    // exception (probe-verified against the pre-fix dist). EACCES is a
    // reachable real-fs shape (Rule #54).
    const adapter = adapterOf("claude-code");
    const fs = new MemFs();
    fs.seed("/h/.claude.json", '{\n  "mcpServers": {}\n}\n');
    const dir = backupDir(STATE_DIR, "claude-code", "user", "linux");
    fs.seed(`${dir}/.claude.json.2026-07-27T12-00-00-001Z`, '{\n  "mcpServers": {}\n}\n');
    // Delegate explicitly (never {...fs}: MemFs methods live on the
    // prototype, so a spread silently drops them — the engine.ts binding
    // discipline for class-instance fs injections).
    const throwingFs: WriteFs = {
      exists: (p) => fs.exists(p),
      readFile: (p) => {
        if (p === "/h/.claude.json") throw new Error(`EACCES: permission denied, open '${p}'`);
        return fs.readFile(p);
      },
      writeFile: (p, c) => fs.writeFile(p, c),
      mkdir: (d) => fs.mkdir(d),
      remove: (p) => fs.remove(p),
      listDir: (d) => fs.listDir(d),
    };
    const result = restoreBackup("/h/.claude.json", writeOptions(adapter, throwingFs));
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("could not read the current");
    expect(result.reason).toContain("EACCES");
    // Nothing was overwritten.
    expect(fs.readFile("/h/.claude.json")).toBe('{\n  "mcpServers": {}\n}\n');
  });
});
