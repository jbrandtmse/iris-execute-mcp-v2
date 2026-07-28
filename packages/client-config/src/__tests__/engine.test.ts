/**
 * Story 33.1 Task 3 + Task 5 / AC 33.1.3, AC 33.1.4, Integration AC 33.1-I1 —
 * the write engine operations over diff + safety + state.
 *
 * Proves: (a) apply/enable/disable/remove pipelines across all four format
 * families against an in-memory fs; (b) the AC 33.1-I1 seam — the executed
 * edit is EXACTLY the edit diff rendered (spy on both seams, toEqual); (c)
 * ownership refusals fire BEFORE any backup/write for names outside the
 * canonical namespace not recorded manager-created (exact match, never
 * prefix); (d) idempotency sweeps; (e) a sabotaged executor triggers the
 * safety auto-restore with NO state.json update; (f) missing-file semantics
 * (empty-document apply, absent-no-op toggles).
 */

import { describe, it, expect } from "vitest";

import {
  CANONICAL_SERVERS,
  CLIENT_ADAPTERS,
  apply,
  disable,
  enable,
  remove,
  restore,
  diff,
  executeNativeEdit,
  readConfigEntries,
  readState,
  stateFilePath,
  backupDir,
  type CanonicalEntry,
  type CanonicalServerName,
  type ClientAdapter,
  type ClientScope,
  type DiffResult,
  type EngineHostContext,
  type NativeEdit,
} from "../index.js";
import { MemFs, fixedNow, readFixture } from "./helpers.js";

const PKG: Record<CanonicalServerName, string> = {
  "iris-dev-mcp": "@iris-mcp/dev",
  "iris-admin-mcp": "@iris-mcp/admin",
  "iris-ops-mcp": "@iris-mcp/ops",
  "iris-interop-mcp": "@iris-mcp/interop",
  "iris-data-mcp": "@iris-mcp/data",
  "iris-mcp-all": "@iris-mcp/all",
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

function ctx(extra?: Partial<EngineHostContext>): EngineHostContext {
  return { platform: "linux", env: {}, homeDir: "/h", projectDir: "/proj", stateDir: STATE_DIR, ...extra };
}

/** Seed a client config into the in-memory fs at its resolved user path. */
function seedUser(fs: MemFs, adapterId: string, content: string): string {
  const adapter = adapterOf(adapterId);
  const scopeDef = adapter.scopes.find((s) => s.scope === "user");
  if (!scopeDef) throw new Error(`${adapterId} has no user scope`);
  const template = scopeDef.paths.linux;
  const path = template.replace(/^~/, "/h");
  fs.seed(path, content);
  return path;
}

function backupCount(fs: MemFs, client: string, scope: ClientScope): number {
  const dir = backupDir(STATE_DIR, client, scope, "linux");
  try {
    return fs.listDir(dir).length;
  } catch {
    return 0;
  }
}

function stateOf(fs: MemFs) {
  const result = readState(fs, STATE_DIR, "linux");
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

describe("apply (AC 33.1.1 + I1)", () => {
  it("adds an entry through the full pipeline: backup, write, state record, restartHint", () => {
    const fs = new MemFs();
    const path = seedUser(fs, "claude-code", readFixture("claude-code/user.json"));
    const result = apply(ctx(), "claude-code", "user", canonicalEntryForTest("iris-ops-mcp"), {
      fs,
      now: fixedNow(1),
    });
    expect(result.ok).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.mechanism).toBe("add");
    expect(result.backupPath).toContain(".claude.json.2026-07-27T12-00-00-001Z");
    expect(result.restartHint).toBe(adapterOf("claude-code").restartHint);
    const parsed = readConfigEntries(adapterOf("claude-code"), fs.readFile(path));
    if (!parsed.ok) throw new Error("written file must parse");
    expect(parsed.entries["iris-ops-mcp"]).toBeDefined();
    expect(parsed.entries["github-mcp"]).toBeDefined(); // foreign survives
    // The ownership ledger recorded the manager-created entry.
    const state = stateOf(fs);
    expect(state.entries).toHaveLength(1);
    expect(state.entries[0]).toMatchObject({
      client: "claude-code",
      scope: "user",
      name: "iris-ops-mcp",
      containsSecret: false,
    });
  });

  it("apply on a MISSING file treats it as an empty document (creates the file, no backup)", () => {
    const fs = new MemFs();
    const result = apply(ctx(), "windsurf", "user", canonicalEntryForTest("iris-dev-mcp"), { fs });
    expect(result.ok).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.backupPath).toBeUndefined();
    const parsed = readConfigEntries(adapterOf("windsurf"), fs.readFile("/h/.codeium/windsurf/mcp_config.json"));
    if (!parsed.ok) throw new Error("created file must parse");
    expect(parsed.entries["iris-dev-mcp"]).toBeDefined();
  });

  it("apply on an unparseable file refuses with NO write and NO backup", () => {
    const fs = new MemFs();
    const path = seedUser(fs, "claude-code", "{ broken !!!");
    const result = apply(ctx(), "claude-code", "user", canonicalEntryForTest("iris-ops-mcp"), { fs });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("unparseable");
    expect(fs.readFile(path)).toBe("{ broken !!!");
    expect(backupCount(fs, "claude-code", "user")).toBe(0);
    expect(fs.exists(stateFilePath(STATE_DIR, "linux"))).toBe(false);
  });

  it("apply marks explicit-mode entries contains-secret in the ledger", () => {
    const fs = new MemFs();
    seedUser(fs, "claude-code", readFixture("claude-code/user.json"));
    const result = apply(ctx(), "claude-code", "user", canonicalEntryForTest("iris-ops-mcp"), {
      fs,
      containsSecret: true,
    });
    expect(result.ok).toBe(true);
    expect(stateOf(fs).entries[0]?.containsSecret).toBe(true);
  });

  it("applying the SAME entry twice yields byte-identical content (update is content-stable)", () => {
    const fs = new MemFs();
    const path = seedUser(fs, "claude-code", readFixture("claude-code/user.json"));
    const entry = canonicalEntryForTest("iris-ops-mcp");
    expect(apply(ctx(), "claude-code", "user", entry, { fs }).ok).toBe(true);
    const afterFirst = fs.readFile(path);
    const second = apply(ctx(), "claude-code", "user", entry, { fs });
    expect(second.ok).toBe(true);
    expect(second.mechanism).toBe("update");
    expect(fs.readFile(path)).toBe(afterFirst);
    expect(stateOf(fs).entries).toHaveLength(1); // one record, refreshed
  });
});

describe("enable/disable mechanics (AC 33.1.3)", () => {
  it("stash client: disable removes + stashes the parsed entry; enable splices it back BYTE-EXACT", () => {
    const fs = new MemFs();
    const path = seedUser(fs, "claude-code", readFixture("claude-code/user.json"));
    const entry = canonicalEntryForTest("iris-ops-mcp");
    apply(ctx(), "claude-code", "user", entry, { fs });
    const afterApply = fs.readFile(path);

    const disabled = disable(ctx(), "claude-code", "user", "iris-ops-mcp", { fs, now: fixedNow(7) });
    expect(disabled.ok).toBe(true);
    expect(disabled.mechanism).toBe("stash-remove");
    const parsedDisabled = readConfigEntries(adapterOf("claude-code"), fs.readFile(path));
    if (!parsedDisabled.ok) throw new Error("must parse");
    expect(parsedDisabled.entries["iris-ops-mcp"]).toBeUndefined();
    // The stash holds the parsed native entry, spec §3.4 shape.
    const stash = stateOf(fs).stashes.find((s) => s.name === "iris-ops-mcp");
    expect(stash).toBeDefined();
    expect(stash?.disabledAt).toBe(new Date(Date.UTC(2026, 6, 27, 12, 0, 0, 7)).toISOString());
    expect(stash?.entry).toMatchObject({ command: "npx" });

    const enabled = enable(ctx(), "claude-code", "user", "iris-ops-mcp", { fs });
    expect(enabled.ok).toBe(true);
    expect(enabled.mechanism).toBe("stash-add");
    // Byte-exact restore (the stash round-trip).
    expect(fs.readFile(path)).toBe(afterApply);
    expect(stateOf(fs).stashes).toHaveLength(0);
  });

  it("stash preserve: native-only keys the canonical model cannot express survive disable → enable", () => {
    const fs = new MemFs();
    const content = `{
  "mcpServers": {
    "iris-dev-mcp": {
      "command": "npx",
      "args": ["-y", "@iris-mcp/dev"],
      "alwaysAllow": ["iris_doc_list"],
      "note": "user-added key"
    }
  }
}`;
    const path = seedUser(fs, "claude-code", content);
    expect(disable(ctx(), "claude-code", "user", "iris-dev-mcp", { fs }).ok).toBe(true);
    expect(enable(ctx(), "claude-code", "user", "iris-dev-mcp", { fs }).ok).toBe(true);
    const parsed = readConfigEntries(adapterOf("claude-code"), fs.readFile(path));
    if (!parsed.ok) throw new Error("must parse");
    expect(parsed.entries["iris-dev-mcp"]).toMatchObject({
      alwaysAllow: ["iris_doc_list"],
      note: "user-added key",
    });
  });

  it("native-flag client (cline): disable flips the flag IN PLACE; no stash; enable flips back", () => {
    const fs = new MemFs();
    const path = seedUser(fs, "cline", readFixture("cline/cline_mcp_settings.json"));
    // Fixture: iris-dev-mcp is disabled:true, iris-admin-mcp has no flag.
    const disabled = disable(ctx(), "cline", "user", "iris-admin-mcp", { fs });
    expect(disabled.ok).toBe(true);
    expect(disabled.mechanism).toBe("native-flag");
    const parsed = readConfigEntries(adapterOf("cline"), fs.readFile(path));
    if (!parsed.ok) throw new Error("must parse");
    expect(parsed.entries["iris-admin-mcp"]?.["disabled"]).toBe(true);
    expect(parsed.entries["iris-admin-mcp"]).toBeDefined(); // entry STAYS
    expect(stateOf(fs).stashes).toHaveLength(0); // never stashed

    const enabled = enable(ctx(), "cline", "user", "iris-dev-mcp", { fs });
    expect(enabled.ok).toBe(true);
    const parsed2 = readConfigEntries(adapterOf("cline"), fs.readFile(path));
    if (!parsed2.ok) throw new Error("must parse");
    expect(parsed2.entries["iris-dev-mcp"]?.["disabled"]).toBe(false);
    // autoApprove (native-only key) survived both toggles.
    expect(parsed2.entries["iris-dev-mcp"]?.["autoApprove"]).toBeDefined();
    expect(parsed2.entries["aws-docs"]).toBeDefined();
  });

  it("native-flag TOML (codex): disable sets `enabled = false` in place; enable restores byte-exact", () => {
    const fs = new MemFs();
    const path = seedUser(fs, "codex", readFixture("codex/config.toml"));
    const entry = canonicalEntryForTest("iris-ops-mcp");
    apply(ctx(), "codex", "user", entry, { fs });
    const afterApply = fs.readFile(path);
    expect(afterApply).toContain("enabled = true");

    const disabled = disable(ctx(), "codex", "user", "iris-ops-mcp", { fs });
    expect(disabled.ok).toBe(true);
    expect(disabled.mechanism).toBe("native-flag");
    expect(fs.readFile(path)).toContain("enabled = false");
    const enabled = enable(ctx(), "codex", "user", "iris-ops-mcp", { fs });
    expect(enabled.ok).toBe(true);
    expect(fs.readFile(path)).toBe(afterApply);
  });

  it("idempotency: enable-when-enabled and disable-when-disabled are byte-identical no-ops (no write, no backup)", () => {
    const fs = new MemFs();
    const path = seedUser(fs, "cline", readFixture("cline/cline_mcp_settings.json"));
    const before = fs.readFile(path);
    // iris-dev-mcp is disabled in the fixture: disable is already-in-state.
    const d = disable(ctx(), "cline", "user", "iris-dev-mcp", { fs });
    expect(d.ok).toBe(true);
    expect(d.changed).toBe(false);
    expect(d.mechanism).toBe("already-in-state");
    // iris-admin-mcp has no flag: enable is already-in-state.
    const e = enable(ctx(), "cline", "user", "iris-admin-mcp", { fs });
    expect(e.ok).toBe(true);
    expect(e.changed).toBe(false);
    expect(fs.readFile(path)).toBe(before);
    expect(backupCount(fs, "cline", "user")).toBe(0);

    // Double-disable on a stash client: second disable is a no-op too.
    const path2 = seedUser(fs, "claude-code", readFixture("claude-code/user.json"));
    expect(disable(ctx(), "claude-code", "user", "iris-dev-mcp", { fs }).changed).toBe(true);
    const afterFirst = fs.readFile(path2);
    const second = disable(ctx(), "claude-code", "user", "iris-dev-mcp", { fs });
    expect(second.changed).toBe(false);
    expect(fs.readFile(path2)).toBe(afterFirst);
    // Disable then double-enable: second enable is a no-op.
    expect(enable(ctx(), "claude-code", "user", "iris-dev-mcp", { fs }).changed).toBe(true);
    const e2 = enable(ctx(), "claude-code", "user", "iris-dev-mcp", { fs });
    expect(e2.changed).toBe(false);
  });

  it("toggles on a MISSING file are absent-no-ops", () => {
    const fs = new MemFs();
    const e = enable(ctx(), "windsurf", "user", "iris-dev-mcp", { fs });
    expect(e.ok).toBe(true);
    expect(e.changed).toBe(false);
    const d = disable(ctx(), "windsurf", "user", "iris-dev-mcp", { fs });
    expect(d.ok).toBe(true);
    expect(d.changed).toBe(false);
  });

  it("enable on a stash client with the entry absent and NOTHING stashed fails clearly", () => {
    const fs = new MemFs();
    seedUser(fs, "claude-code", readFixture("claude-code/user.json"));
    const result = enable(ctx(), "claude-code", "user", "iris-ops-mcp", { fs });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("nothing to enable");
  });

  it("enable/disable on a native-flag client with the entry ABSENT fails clearly", () => {
    const fs = new MemFs();
    seedUser(fs, "cline", readFixture("cline/cline_mcp_settings.json"));
    const e = enable(ctx(), "cline", "user", "iris-ops-mcp", { fs });
    expect(e.ok).toBe(false);
    expect(e.reason).toContain("not present");
    const d = disable(ctx(), "cline", "user", "iris-ops-mcp", { fs });
    expect(d.ok).toBe(false);
  });
});

describe("remove", () => {
  it("purges the entry plus its stash and ownership records", () => {
    const fs = new MemFs();
    const path = seedUser(fs, "claude-code", readFixture("claude-code/user.json"));
    apply(ctx(), "claude-code", "user", canonicalEntryForTest("iris-ops-mcp"), { fs });
    disable(ctx(), "claude-code", "user", "iris-ops-mcp", { fs });
    expect(stateOf(fs).stashes).toHaveLength(1);
    enable(ctx(), "claude-code", "user", "iris-ops-mcp", { fs });
    const result = remove(ctx(), "claude-code", "user", "iris-ops-mcp", { fs });
    expect(result.ok).toBe(true);
    expect(result.mechanism).toBe("remove");
    const parsed = readConfigEntries(adapterOf("claude-code"), fs.readFile(path));
    if (!parsed.ok) throw new Error("must parse");
    expect(parsed.entries["iris-ops-mcp"]).toBeUndefined();
    expect(stateOf(fs).entries).toHaveLength(0);
    expect(stateOf(fs).stashes).toHaveLength(0);
  });

  it("remove WHILE STASHED purges the stash + ownership records — a later enable must NOT resurrect (33.1 review HIGH)", () => {
    // Regression: pre-fix, remove on a stash client with the entry absent
    // rendered already-in-state and skipped the state purge — remove reported
    // ok while the stash survived, and a later enable brought the "removed"
    // server back (probe-verified against the pre-fix dist).
    const fs = new MemFs();
    const path = seedUser(fs, "claude-code", readFixture("claude-code/user.json"));
    apply(ctx(), "claude-code", "user", canonicalEntryForTest("iris-ops-mcp"), { fs });
    disable(ctx(), "claude-code", "user", "iris-ops-mcp", { fs });
    expect(stateOf(fs).stashes).toHaveLength(1);

    const result = remove(ctx(), "claude-code", "user", "iris-ops-mcp", { fs });
    expect(result.ok).toBe(true);
    expect(result.changed).toBe(false); // nothing to cut from the file
    expect(result.note).toContain("state records purged");
    expect(stateOf(fs).stashes).toHaveLength(0);
    expect(stateOf(fs).entries).toHaveLength(0);
    // The file itself is untouched (still the post-disable bytes).
    const parsed = readConfigEntries(adapterOf("claude-code"), fs.readFile(path));
    if (!parsed.ok) throw new Error("must parse");
    expect(parsed.entries["iris-ops-mcp"]).toBeUndefined();

    // The zombie guard: enable now has nothing stashed and nothing present.
    const zombie = enable(ctx(), "claude-code", "user", "iris-ops-mcp", { fs });
    expect(zombie.ok).toBe(false);
    expect(zombie.reason).toContain("nothing to enable");
    const after = readConfigEntries(adapterOf("claude-code"), fs.readFile(path));
    if (!after.ok) throw new Error("must parse");
    expect(after.entries["iris-ops-mcp"]).toBeUndefined();
  });

  it("remove on a native-flag client deletes the whole entry (not just the flag)", () => {
    const fs = new MemFs();
    const path = seedUser(fs, "codex", readFixture("codex/config.toml"));
    const result = remove(ctx(), "codex", "user", "iris-dev-mcp", { fs });
    expect(result.ok).toBe(true);
    const parsed = readConfigEntries(adapterOf("codex"), fs.readFile(path));
    if (!parsed.ok) throw new Error("must parse");
    expect(parsed.entries["iris-dev-mcp"]).toBeUndefined();
    expect(parsed.entries["context7"]).toBeDefined();
  });

  it("remove on a MISSING file purges state records without touching the disk", () => {
    const fs = new MemFs();
    seedUser(fs, "claude-code", readFixture("claude-code/user.json"));
    apply(ctx(), "claude-code", "user", canonicalEntryForTest("iris-ops-mcp"), { fs });
    // Simulate the user deleting the file while manager state exists.
    fs.remove("/h/.claude.json");
    const result = remove(ctx(), "claude-code", "user", "iris-ops-mcp", { fs });
    expect(result.ok).toBe(true);
    expect(result.changed).toBe(false);
    expect(stateOf(fs).entries).toHaveLength(0);
  });
});

describe("ownership rule (AC 33.1.4)", () => {
  const foreignNames = ["github-mcp", "iris-dev-mcp2", "IRIS-DEV-MCP", "my-iris-dev-mcp"];

  it("enable/disable/remove refuse foreign names BEFORE any backup or write", () => {
    const fs = new MemFs();
    const content = `{
  "mcpServers": {
    "github-mcp": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"] },
    "iris-dev-mcp2": { "command": "npx", "args": ["-y", "@example/lookalike"] }
  }
}`;
    const path = seedUser(fs, "claude-code", content);
    for (const name of foreignNames.slice(0, 2)) {
      const d = disable(ctx(), "claude-code", "user", name, { fs });
      expect(d.ok, `disable ${name}`).toBe(false);
      expect(d.reason).toContain("outside the iris-mcp namespace");
      const e = enable(ctx(), "claude-code", "user", name, { fs });
      expect(e.ok, `enable ${name}`).toBe(false);
      const r = remove(ctx(), "claude-code", "user", name, { fs });
      expect(r.ok, `remove ${name}`).toBe(false);
    }
    // NOTHING was written: file byte-identical, zero backups, no state file.
    expect(fs.readFile(path)).toBe(content);
    expect(backupCount(fs, "claude-code", "user")).toBe(0);
    expect(fs.exists(stateFilePath(STATE_DIR, "linux"))).toBe(false);
  });

  it("apply REFUSES to update a present foreign entry but may CREATE a new managed one", () => {
    const fs = new MemFs();
    const content = `{
  "mcpServers": {
    "github-mcp": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"] }
  }
}`;
    const path = seedUser(fs, "claude-code", content);
    const foreign = { name: "github-mcp", command: "npx", args: ["-y", "evil"] } as unknown as CanonicalEntry;
    const refused = apply(ctx(), "claude-code", "user", foreign, { fs });
    expect(refused.ok).toBe(false);
    expect(refused.reason).toContain("outside the iris-mcp namespace");
    expect(fs.readFile(path)).toBe(content);
    expect(backupCount(fs, "claude-code", "user")).toBe(0);

    // Creation of a not-yet-present non-canonical entry is allowed and
    // records it manager-created (the act that makes it owned).
    const custom = { name: "my-custom-server", command: "npx", args: ["-y", "@acme/mcp"] } as unknown as CanonicalEntry;
    const created = apply(ctx(), "claude-code", "user", custom, { fs });
    expect(created.ok).toBe(true);
    expect(stateOf(fs).entries[0]?.name).toBe("my-custom-server");
    // ...and now the manager owns it: disable/enable/remove are permitted.
    expect(disable(ctx(), "claude-code", "user", "my-custom-server", { fs }).ok).toBe(true);
    expect(enable(ctx(), "claude-code", "user", "my-custom-server", { fs }).ok).toBe(true);
    expect(remove(ctx(), "claude-code", "user", "my-custom-server", { fs }).ok).toBe(true);
    expect(stateOf(fs).entries).toHaveLength(0);
  });

  it("every canonical server name IS owned by namespace (mechanical sweep)", () => {
    const fs = new MemFs();
    seedUser(fs, "claude-code", readFixture("claude-code/user.json"));
    for (const name of CANONICAL_SERVERS) {
      // disable on an absent canonical name is a no-op, never a refusal.
      const d = disable(ctx(), "claude-code", "user", name, { fs });
      expect(d.ok, name).toBe(true);
    }
  });
});

describe("Integration AC 33.1-I1 — the executed edit IS the rendered edit", () => {
  it("spy: executeNativeEdit receives exactly the NativeEdit diff rendered (every op × every format family)", () => {
    const families: Array<{ id: string; fixture: string }> = [
      { id: "claude-code", fixture: "claude-code/user.json" },
      { id: "cline", fixture: "cline/cline_mcp_settings.json" },
      { id: "codex", fixture: "codex/config.toml" },
      { id: "goose", fixture: "goose/config.yaml" },
    ];
    const renderedCalls: DiffResult[] = [];
    const executedNatives: (NativeEdit | null)[] = [];
    const diffFn: typeof diff = (...args) => {
      const result = diff(...args);
      renderedCalls.push(result);
      return result;
    };
    const executeFn: typeof executeNativeEdit = (content, native) => {
      executedNatives.push(native);
      return executeNativeEdit(content, native);
    };

    for (const { id, fixture } of families) {
      const fs = new MemFs();
      seedUser(fs, id, readFixture(fixture));
      const adapter = adapterOf(id);
      // A present-enabled canonical server per fixture (iris-dev-mcp is
      // present in all four).
      const entry = canonicalEntryForTest("iris-dev-mcp");
      const opts = { fs, diffFn, executeFn };
      const ops = [
        apply(ctx(), id, "user", entry, opts),
        disable(ctx(), id, "user", "iris-dev-mcp", opts),
        enable(ctx(), id, "user", "iris-dev-mcp", opts),
        remove(ctx(), id, "user", "iris-dev-mcp", opts),
      ];
      for (const [i, result] of ops.entries()) {
        expect(result.ok, `${id} op ${i}: ${result.reason ?? ""}`).toBe(true);
      }
      void adapter;
    }

    // Every executed edit toEquals the edit the SAME diff call rendered —
    // no edit is re-derived on the write path.
    const renderedNatives = renderedCalls.map((r) => (r.ok ? r.native : "REFUSAL"));
    expect(executedNatives.length).toBeGreaterThan(0);
    for (const executed of executedNatives) {
      expect(renderedNatives).toContainEqual(executed);
    }
    // And pairwise, in order: each execute call consumed the most recent
    // render (the engine never renders twice).
    const rendersThatExecuted = renderedCalls.filter((r) => r.ok && r.native !== null).map((r) => (r.ok ? r.native : null));
    expect(executedNatives).toEqual(rendersThatExecuted);
  });
});

describe("safety auto-restore via a sabotaged executor (AC 33.1.2)", () => {
  it("a post-write parse failure restores the backup and skips the state update", () => {
    const fs = new MemFs();
    const original = readFixture("claude-code/user.json");
    const path = seedUser(fs, "claude-code", original);
    // A sabotaged executor producing invalid JSON is a REACHABLE state (a
    // corrupting writer bug — Rule #54).
    const sabotage: typeof executeNativeEdit = () => "{ this is not valid json";
    const result = apply(ctx(), "claude-code", "user", canonicalEntryForTest("iris-ops-mcp"), {
      fs,
      executeFn: sabotage,
      now: fixedNow(42),
    });
    expect(result.ok).toBe(false);
    expect(result.restored).toBe(true);
    expect(result.reason).toContain("post-write parse failure");
    // The file was restored byte-exact; the backup was retained.
    expect(fs.readFile(path)).toBe(original);
    expect(result.backupPath).toBeDefined();
    if (result.backupPath) expect(fs.readFile(result.backupPath)).toBe(original);
    // CRITICAL: the failed write recorded NOTHING in state.json.
    expect(fs.exists(stateFilePath(STATE_DIR, "linux"))).toBe(false);
  });
});

describe("restore (engine surface)", () => {
  it("restores the latest backup for a client scope; refuses when none", () => {
    const fs = new MemFs();
    const path = seedUser(fs, "claude-code", readFixture("claude-code/user.json"));
    const before = fs.readFile(path);
    apply(ctx(), "claude-code", "user", canonicalEntryForTest("iris-ops-mcp"), { fs, now: fixedNow(5) });
    expect(fs.readFile(path)).not.toBe(before);
    const restored = restore(ctx(), "claude-code", "user", { fs });
    expect(restored.ok).toBe(true);
    expect(restored.changed).toBe(true);
    expect(restored.restartHint).toBe(adapterOf("claude-code").restartHint);
    expect(fs.readFile(path)).toBe(before);

    const none = restore(ctx(), "windsurf", "user", { fs });
    expect(none.ok).toBe(false);
    expect(none.reason).toContain("no backups");
  });
});

describe("engine guards", () => {
  it("unknown client ids fail with the known-client list (mechanical)", () => {
    const fs = new MemFs();
    const result = apply(ctx(), "not-a-client", "user", canonicalEntryForTest("iris-dev-mcp"), { fs });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("unknown client");
    for (const id of Object.keys(CLIENT_ADAPTERS)) expect(result.reason).toContain(id);
  });

  it("a project scope without projectDir fails resolution cleanly", () => {
    const fs = new MemFs();
    const noProject: EngineHostContext = { platform: "linux", env: {}, homeDir: "/h", stateDir: STATE_DIR };
    const result = apply(noProject, "claude-code", "project", canonicalEntryForTest("iris-dev-mcp"), { fs });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("projectDir");
  });

  it("a corrupt state.json fails the operation with a typed error", () => {
    const fs = new MemFs();
    seedUser(fs, "claude-code", readFixture("claude-code/user.json"));
    fs.seed(stateFilePath(STATE_DIR, "linux"), "{ nope");
    const result = disable(ctx(), "claude-code", "user", "iris-dev-mcp", { fs });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("unparseable");
  });
});
