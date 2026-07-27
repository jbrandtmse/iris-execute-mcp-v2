/**
 * Story 33.0 — QA E2E/edge layer ON TOP of dev's unit suite.
 *
 * What this file adds that the unit suite does not cover:
 *  1. End-to-end chains over the public API against the on-disk sandbox
 *     fixture trees (fake HOME / fake projectDir — never the real HOME):
 *     detect → status matrix → read the file at the REPORTED path → diff →
 *     execute the rendered edit with exactly Story 33.1's future mechanism
 *     (jsonc-parser applyEdits / TOML line splice / YAML CST op) → re-read
 *     and prove the status row would flip while foreign entries survive.
 *  2. A mechanical status↔diff agreement invariant: for every ok scope in
 *     the sandbox, the matrix row state dictates the diff mechanism.
 *  3. Project-scope chains: kimi-code's most-specific-wins fallback
 *     (`.kimi-code/mcp.json` > `.mcp.json`) exercised THROUGH status, and a
 *     mixed-state client (vscode user unparseable + project ok).
 *  4. Adversarial fixtures: iris-LOOKING entry names that are NOT canonical
 *     (rootKey collisions), CRLF/BOM encoding variants, deeply-nested and
 *     unicode-named foreign entries, owned-entry-LAST surgical removal
 *     (the preceding-comma branch), and an EACCES-shaped read failure.
 *
 * Executors here are test-local copies of the exact apply mechanics Story
 * 33.1's write engine will perform (same discipline as diff.test.ts); the
 * package itself never writes.
 */

import { readFileSync } from "node:fs";

import { describe, it, expect } from "vitest";
import { applyEdits } from "jsonc-parser";
import { parseDocument } from "yaml";

import {
  CLIENT_ADAPTERS,
  CANONICAL_SERVERS,
  status,
  diff,
  entryPresence,
  readConfigEntries,
  REAL_STATUS_FS,
  type CanonicalEntry,
  type CanonicalServerName,
  type ClientAdapter,
  type ClientScope,
  type DiffResult,
  type HostContext,
  type JsoncNativeEdit,
  type ScopeStatus,
  type StatusFs,
  type StatusReport,
  type TomlNativeEdit,
  type YamlNativeEdit,
} from "../index.js";
import { fixturePath, readFixture } from "./helpers.js";

const PKG_BY_SERVER: Record<CanonicalServerName, string> = {
  "iris-dev-mcp": "@iris-mcp/dev",
  "iris-admin-mcp": "@iris-mcp/admin",
  "iris-ops-mcp": "@iris-mcp/ops",
  "iris-interop-mcp": "@iris-mcp/interop",
  "iris-data-mcp": "@iris-mcp/data",
  "iris-mcp-all": "@iris-mcp/all",
};

function canonicalEntry(name: CanonicalServerName): CanonicalEntry {
  return { name, command: "npx", args: ["-y", PKG_BY_SERVER[name]], env: { IRIS_NAMESPACE: "HSCUSTOM" } };
}

function adapterOf(id: string): ClientAdapter {
  const adapter = CLIENT_ADAPTERS[id];
  if (!adapter) throw new Error(`registry missing ${id}`);
  return adapter;
}

function expectOk(result: DiffResult): Extract<DiffResult, { ok: true }> {
  if (!result.ok) throw new Error(`expected ok diff, got refusal: ${result.reason}`);
  return result;
}

function scopeOf(report: StatusReport, clientId: string, scope: ClientScope): ScopeStatus {
  const client = report.clients.find((c) => c.client === clientId);
  if (!client) throw new Error(`${clientId} not detected`);
  const found = client.scopes.find((s) => s.scope === scope);
  if (!found) throw new Error(`${clientId} has no ${scope} scope status`);
  return found;
}

function readReportedPath(scope: ScopeStatus): string {
  if (scope.path === null) throw new Error("scope path unresolved");
  return readFileSync(scope.path, "utf8");
}

/** Execute a TOML splice descriptor — the SAME mechanics 33.1 will use. */
function applyTomlSplice(content: string, edit: TomlNativeEdit): string {
  const lines = content.split("\n");
  if (edit.op === "insert") {
    const block = (edit.insertText ?? "").split("\n");
    const at = (edit.insertAfterLine ?? -1) + 1;
    lines.splice(at, 0, "", ...block);
    return lines.join("\n");
  }
  if (edit.op === "set-flag") {
    if (edit.region) {
      lines.splice(edit.region.startLine, edit.region.endLine - edit.region.startLine + 1, edit.insertText ?? "");
    } else {
      lines.splice((edit.insertAfterLine ?? -1) + 1, 0, edit.insertText ?? "");
    }
    return lines.join("\n");
  }
  if (!edit.region) throw new Error("region descriptor missing");
  const count = edit.region.endLine - edit.region.startLine + 1;
  if (edit.op === "remove-region") {
    lines.splice(edit.region.startLine, count);
    return lines.join("\n");
  }
  lines.splice(edit.region.startLine, count, ...(edit.insertText ?? "").split("\n"));
  return lines.join("\n");
}

/** Execute a YAML CST op — the SAME mechanics 33.1 will use. */
function applyYamlOp(content: string, edit: YamlNativeEdit): string {
  const doc = parseDocument(content);
  expect(doc.errors).toEqual([]);
  if (edit.op === "delete") {
    doc.deleteIn(edit.path);
  } else {
    doc.setIn(edit.path, doc.createNode(edit.value));
  }
  return doc.toString();
}

function sandboxHomeCtx(extra?: Partial<HostContext>): HostContext {
  return { platform: "linux", env: {}, homeDir: fixturePath("sandbox-home"), ...extra };
}

describe("E2E chain: detect → status → diff → execute → re-read (sandbox-home, real fs)", () => {
  it("claude-code: present-enabled → stash-remove → entry gone → stash-add → entry restored", () => {
    const adapter = adapterOf("claude-code");
    const report = status(sandboxHomeCtx(), REAL_STATUS_FS);
    const userScope = scopeOf(report, "claude-code", "user");
    expect(userScope.file).toBe("ok");
    expect(userScope.servers.find((s) => s.server === "iris-dev-mcp")?.state).toBe("present-enabled");

    const content = readReportedPath(userScope);
    const entry = canonicalEntry("iris-dev-mcp");

    const disable = expectOk(diff(content, entry, adapter, "user", "disable"));
    expect(disable.mechanism).toBe("stash-remove");
    const afterDisable = applyEdits(content, (disable.native as JsoncNativeEdit).edits);
    const parsedDisable = readConfigEntries(adapter, afterDisable);
    expect(parsedDisable.ok).toBe(true);
    if (parsedDisable.ok) {
      expect(parsedDisable.entries["iris-dev-mcp"]).toBeUndefined();
      expect(parsedDisable.entries["github-mcp"]).toBeDefined();
    }

    // Round-trip back: enable on the edited content re-adds the entry.
    const enable = expectOk(diff(afterDisable, entry, adapter, "user", "enable"));
    expect(enable.mechanism).toBe("stash-add");
    const afterEnable = applyEdits(afterDisable, (enable.native as JsoncNativeEdit).edits);
    const parsedEnable = readConfigEntries(adapter, afterEnable);
    expect(parsedEnable.ok).toBe(true);
    if (parsedEnable.ok) {
      const restored = parsedEnable.entries["iris-dev-mcp"];
      expect(restored).toBeDefined();
      if (restored) expect(entryPresence(adapter, restored)).toBe("present-enabled");
      expect(parsedEnable.entries["github-mcp"]).toBeDefined();
    }
  });

  it("cline: present-disabled → native-flag enable → flag flips → native-flag disable round-trips", () => {
    const adapter = adapterOf("cline");
    const report = status(sandboxHomeCtx(), REAL_STATUS_FS);
    const userScope = scopeOf(report, "cline", "user");
    expect(userScope.servers.find((s) => s.server === "iris-dev-mcp")?.state).toBe("present-disabled");

    const content = readReportedPath(userScope);
    const entry = canonicalEntry("iris-dev-mcp");

    const enable = expectOk(diff(content, entry, adapter, "user", "enable"));
    expect(enable.mechanism).toBe("native-flag");
    const afterEnable = applyEdits(content, (enable.native as JsoncNativeEdit).edits);
    const parsedEnable = readConfigEntries(adapter, afterEnable);
    if (!parsedEnable.ok) throw new Error("post-enable file must parse");
    const enabledEntry = parsedEnable.entries["iris-dev-mcp"];
    if (!enabledEntry) throw new Error("entry vanished after a flag flip");
    // The status row WOULD flip: re-classified through the same function the matrix uses.
    expect(entryPresence(adapter, enabledEntry)).toBe("present-enabled");
    expect(parsedEnable.entries["aws-docs"]).toBeDefined();

    const disable = expectOk(diff(afterEnable, entry, adapter, "user", "disable"));
    expect(disable.mechanism).toBe("native-flag");
    const afterDisable = applyEdits(afterEnable, (disable.native as JsoncNativeEdit).edits);
    const parsedDisable = readConfigEntries(adapter, afterDisable);
    if (!parsedDisable.ok) throw new Error("post-disable file must parse");
    const disabledEntry = parsedDisable.entries["iris-dev-mcp"];
    if (!disabledEntry) throw new Error("entry vanished after a flag flip");
    expect(entryPresence(adapter, disabledEntry)).toBe("present-disabled");
  });

  it("goose: present-enabled → set-flag enabled=false → row flips, builtin + comments survive", () => {
    const adapter = adapterOf("goose");
    const report = status(sandboxHomeCtx(), REAL_STATUS_FS);
    const userScope = scopeOf(report, "goose", "user");
    expect(userScope.servers.find((s) => s.server === "iris-data-mcp")?.state).toBe("present-enabled");

    const content = readReportedPath(userScope);
    const disable = expectOk(diff(content, canonicalEntry("iris-data-mcp"), adapter, "user", "disable"));
    expect(disable.mechanism).toBe("native-flag");
    const after = applyYamlOp(content, disable.native as YamlNativeEdit);
    const parsed = readConfigEntries(adapter, after);
    if (!parsed.ok) throw new Error("post-disable file must parse");
    const flipped = parsed.entries["iris-data-mcp"];
    if (!flipped) throw new Error("entry vanished after a flag flip");
    expect(entryPresence(adapter, flipped)).toBe("present-disabled");
    // The enabled:false sibling and the builtin foreign extension survive.
    const opsEntry = parsed.entries["iris-ops-mcp"];
    if (!opsEntry) throw new Error("iris-ops-mcp vanished");
    expect(entryPresence(adapter, opsEntry)).toBe("present-disabled");
    expect(parsed.entries["developer"]).toBeDefined();
  });

  it("codex: apply inserts a new owned table (with an explicit `enabled = true`); a follow-up disable flips the flag in place", () => {
    const adapter = adapterOf("codex");
    const report = status(sandboxHomeCtx(), REAL_STATUS_FS);
    const userScope = scopeOf(report, "codex", "user");
    expect(userScope.file).toBe("ok");
    expect(userScope.servers.find((s) => s.server === "iris-admin-mcp")?.state).toBe("absent");

    const content = readReportedPath(userScope);
    const apply = expectOk(diff(content, canonicalEntry("iris-admin-mcp"), adapter, "user", "apply"));
    expect(apply.mechanism).toBe("add");
    const afterAdd = applyTomlSplice(content, apply.native as TomlNativeEdit);
    const parsedAdd = readConfigEntries(adapter, afterAdd);
    if (!parsedAdd.ok) throw new Error("post-insert file must parse");
    expect(parsedAdd.entries["iris-admin-mcp"]).toBeDefined();
    // Fresh applies carry the flag explicitly at its enabled value (33.1).
    expect(parsedAdd.entries["iris-admin-mcp"]?.["enabled"]).toBe(true);
    expect(parsedAdd.entries["iris-ops-mcp"]).toBeDefined();
    expect(parsedAdd.entries["context7"]).toBeDefined();

    // Codex is a NATIVE-flag client (33.1 probe): disable flips `enabled` in
    // place — the entry (and its tables) stays in the file.
    const disable = expectOk(diff(afterAdd, canonicalEntry("iris-admin-mcp"), adapter, "user", "disable"));
    expect(disable.mechanism).toBe("native-flag");
    const afterDisable = applyTomlSplice(afterAdd, disable.native as TomlNativeEdit);
    const parsedDisable = readConfigEntries(adapter, afterDisable);
    if (!parsedDisable.ok) throw new Error("post-disable file must parse");
    const disabledEntry = parsedDisable.entries["iris-admin-mcp"];
    if (!disabledEntry) throw new Error("entry vanished after a flag toggle");
    expect(entryPresence(adapter, disabledEntry)).toBe("present-disabled");
    expect(parsedDisable.entries["iris-ops-mcp"]).toBeDefined();
    expect(parsedDisable.entries["context7"]).toBeDefined();
  });

  it("vscode: status unparseable and diff refusal AGREE — a malformed file is never guessed at", () => {
    const adapter = adapterOf("vscode");
    const report = status(sandboxHomeCtx(), REAL_STATUS_FS);
    const userScope = scopeOf(report, "vscode", "user");
    expect(userScope.file).toBe("unparseable");
    const content = readReportedPath(userScope);
    const result = diff(content, canonicalEntry("iris-dev-mcp"), adapter, "user", "apply");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("unparseable");
  });

  it("invariant: every ok scope's matrix rows dictate the diff mechanism (mechanical sweep)", () => {
    const report = status(sandboxHomeCtx(), REAL_STATUS_FS);
    let scopesChecked = 0;
    for (const client of report.clients) {
      const adapter = adapterOf(client.client);
      for (const scope of client.scopes) {
        if (scope.file !== "ok") continue;
        scopesChecked++;
        const content = readReportedPath(scope);
        for (const row of scope.servers) {
          const entry = canonicalEntry(row.server);
          const disable = diff(content, entry, adapter, scope.scope, "disable");
          const enable = diff(content, entry, adapter, scope.scope, "enable");
          if (row.state === "present-enabled") {
            const d = expectOk(disable);
            expect(["stash-remove", "native-flag"], `${client.client}/${row.server} disable`).toContain(
              d.mechanism,
            );
            expect(expectOk(enable).mechanism, `${client.client}/${row.server} enable`).toBe("already-in-state");
          } else if (row.state === "present-disabled") {
            expect(expectOk(enable).mechanism, `${client.client}/${row.server} enable`).toBe("native-flag");
            expect(expectOk(disable).mechanism, `${client.client}/${row.server} disable`).toBe("already-in-state");
          } else {
            // absent
            if (adapter.nativeDisableFlag) {
              expect(disable.ok, `${client.client}/${row.server} disable absent`).toBe(false);
              expect(enable.ok, `${client.client}/${row.server} enable absent`).toBe(false);
            } else {
              expect(expectOk(disable).mechanism, `${client.client}/${row.server} disable absent`).toBe(
                "already-in-state",
              );
              expect(expectOk(enable).mechanism, `${client.client}/${row.server} enable absent`).toBe("stash-add");
            }
          }
        }
      }
    }
    // The sweep must actually have exercised scopes (guard against a vacuous pass).
    expect(scopesChecked).toBeGreaterThan(0);
  });
});

describe("E2E chain: project scopes (sandbox-project fixture tree)", () => {
  function projectCtx(): HostContext {
    return sandboxHomeCtx({ projectDir: fixturePath("sandbox-project") });
  }

  it("kimi-code is detected through its .mcp.json fallback and status reads the fallback file", () => {
    const report = status(projectCtx(), REAL_STATUS_FS);
    const kimi = report.clients.find((c) => c.client === "kimi-code");
    expect(kimi, "kimi-code detected via the project fallback").toBeDefined();
    const projectScope = scopeOf(report, "kimi-code", "project");
    expect(projectScope.file).toBe("ok");
    // Most specific wins: only .mcp.json exists, so the fallback resolves.
    expect(projectScope.path).toBe(fixturePath("sandbox-project") + "/.mcp.json");
    expect(projectScope.servers.find((s) => s.server === "iris-data-mcp")?.state).toBe("present-enabled");
    // The iris-LOOKING names are NOT canonical — surfaced as foreign, names only.
    expect(projectScope.foreign).toEqual(["IRIS-DEV-MCP", "iris-dev-mcp-backup"].sort());
    expect(projectScope.servers.find((s) => s.server === "iris-dev-mcp")?.state).toBe("absent");
    // Lookalike secret values never leak onto the status surface.
    const rendered = JSON.stringify(report);
    expect(rendered).not.toContain("qb_lookalikeSecret456");
    expect(rendered).not.toContain("imp_lookalikeSecret789");
  });

  it("claude-code project scope: surgical removal leaves iris-lookalike neighbors byte-intact", () => {
    const adapter = adapterOf("claude-code");
    const report = status(projectCtx(), REAL_STATUS_FS);
    const projectScope = scopeOf(report, "claude-code", "project");
    expect(projectScope.file).toBe("ok");
    const content = readReportedPath(projectScope);
    const disable = expectOk(diff(content, canonicalEntry("iris-data-mcp"), adapter, "project", "disable"));
    expect(disable.mechanism).toBe("stash-remove");
    const edit = (disable.native as JsoncNativeEdit).edits[0];
    if (!edit) throw new Error("removal edit missing");
    const removedSpan = content.slice(edit.offset, edit.offset + edit.length);
    expect(removedSpan).toContain("iris-data-mcp");
    expect(removedSpan).not.toContain("iris-dev-mcp-backup");
    expect(removedSpan).not.toContain("IRIS-DEV-MCP");
    const after = applyEdits(content, (disable.native as JsoncNativeEdit).edits);
    const parsed = readConfigEntries(adapter, after);
    if (!parsed.ok) throw new Error("post-removal file must parse");
    expect(parsed.entries["iris-data-mcp"]).toBeUndefined();
    expect(parsed.entries["iris-dev-mcp-backup"]).toBeDefined();
    expect(parsed.entries["IRIS-DEV-MCP"]).toBeDefined();
  });

  it("vscode: user scope unparseable (sandbox) + project scope ok — per-scope states are independent", () => {
    const report = status(projectCtx(), REAL_STATUS_FS);
    const userScope = scopeOf(report, "vscode", "user");
    const projectScope = scopeOf(report, "vscode", "project");
    expect(userScope.file).toBe("unparseable");
    expect(projectScope.file).toBe("ok");
    expect(projectScope.servers.find((s) => s.server === "iris-ops-mcp")?.state).toBe("present-enabled");
    expect(projectScope.foreign).toEqual(["microsoft-learn"]);
  });

  it("adding a projectDir never changes the USER-scope picture", () => {
    const withoutProject = status(sandboxHomeCtx(), REAL_STATUS_FS);
    const withProject = status(projectCtx(), REAL_STATUS_FS);
    for (const client of withProject.clients) {
      const baseline = withoutProject.clients.find((c) => c.client === client.client);
      if (!baseline) continue; // newly detected via project probes (kimi-code)
      const baseUser = baseline.scopes.find((s) => s.scope === "user");
      const projUser = client.scopes.find((s) => s.scope === "user");
      expect(projUser, `${client.client} user scope shifted when projectDir was added`).toEqual(baseUser);
    }
  });
});

describe("adversarial: iris-looking rootKey collisions that are NOT canonical", () => {
  it("JSON: case/affix/whitespace lookalikes classify foreign; canonical names under other keys are invisible", () => {
    const lookalikes = ["iris-dev-mcp ", "IRIS-DEV-MCP", "iris-dev-mcp2", "my-iris-dev-mcp"];
    const entries = lookalikes
      .map((name) => `"${name}": { "command": "npx", "args": ["-y", "@example/x"], "env": { "K": "lk_lookalikeValue" } }`)
      .join(", ");
    const content = `{
      "mcpServers": { ${entries} },
      "otherServers": { "iris-dev-mcp": { "command": "npx", "args": ["-y", "@example/impostor"] } }
    }`;
    const fs: StatusFs = {
      exists: (p) => p === "/h/.claude.json",
      readFile: () => content,
    };
    const report = status({ platform: "linux", env: {}, homeDir: "/h" }, fs);
    const userScope = scopeOf(report, "claude-code", "user");
    expect(userScope.file).toBe("ok");
    // Every canonical row is absent — no lookalike promoted itself into the matrix.
    for (const row of userScope.servers) expect(row.state, row.server).toBe("absent");
    expect(userScope.servers).toHaveLength(CANONICAL_SERVERS.length);
    // The lookalikes surface as foreign NAMES (sorted); "otherServers" is not an entry at all.
    expect(userScope.foreign).toEqual([...lookalikes].sort());
    expect(userScope.foreign).not.toContain("otherServers");
    // Lookalike VALUES never leak.
    expect(JSON.stringify(report)).not.toContain("lk_lookalikeValue");
    expect(JSON.stringify(report)).not.toContain("@example/impostor");
  });

  it("TOML: [mcp_servers.iris-dev-mcp-extras] is neither owned nor inside the owned removal region", () => {
    const adapter = adapterOf("codex");
    const content = [
      "[mcp_servers.iris-dev-mcp]",
      'command = "npx"',
      'args = ["-y", "@iris-mcp/dev"]',
      "",
      "[mcp_servers.iris-dev-mcp-extras]",
      'command = "npx"',
      'args = ["-y", "@example/extras"]',
      "",
    ].join("\n");
    const parsed = readConfigEntries(adapter, content);
    if (!parsed.ok) throw new Error("fixture must parse");
    // The lookalike parses as its own entry and classifies foreign by name.
    expect(parsed.entries["iris-dev-mcp-extras"]).toBeDefined();
    expect(CANONICAL_SERVERS).not.toContain("iris-dev-mcp-extras");

    const disable = expectOk(diff(content, canonicalEntry("iris-dev-mcp"), adapter, "user", "remove"));
    expect(disable.mechanism).toBe("remove");
    const native = disable.native as TomlNativeEdit;
    if (!native.region) throw new Error("region missing");
    const removedText = content
      .split("\n")
      .slice(native.region.startLine, native.region.endLine + 1)
      .join("\n");
    expect(removedText).toContain("[mcp_servers.iris-dev-mcp]");
    expect(removedText).not.toContain("extras");
    const after = applyTomlSplice(content, native);
    const reparsed = readConfigEntries(adapter, after);
    if (!reparsed.ok) throw new Error("post-removal file must parse");
    expect(reparsed.entries["iris-dev-mcp"]).toBeUndefined();
    expect(reparsed.entries["iris-dev-mcp-extras"]).toBeDefined();
  });

  it("codex: the verified `enabled = false` key reads present-disabled (33.1 probe)", () => {
    const adapter = adapterOf("codex");
    const content = [
      "[mcp_servers.iris-dev-mcp]",
      'command = "npx"',
      'args = ["-y", "@iris-mcp/dev"]',
      "enabled = false",
      "",
    ].join("\n");
    const parsed = readConfigEntries(adapter, content);
    if (!parsed.ok) throw new Error("fixture must parse");
    const entry = parsed.entries["iris-dev-mcp"];
    if (!entry) throw new Error("owned entry missing");
    // The Codex `enabled` flag is VERIFIED (Story 33.1 Rule #16 probe,
    // 2026-07-27 — official config reference), so the flag classifies.
    expect(entryPresence(adapter, entry)).toBe("present-disabled");
  });
});

describe("adversarial: encoding variants (CRLF / BOM) through the full diff chain", () => {
  it("CRLF JSONC: comment-laden vscode config round-trips a stash removal", () => {
    const adapter = adapterOf("vscode");
    const content = readFixture("vscode/user.jsonc").replaceAll("\n", "\r\n");
    const disable = expectOk(diff(content, canonicalEntry("iris-dev-mcp"), adapter, "user", "disable"));
    expect(disable.mechanism).toBe("stash-remove");
    const after = applyEdits(content, (disable.native as JsoncNativeEdit).edits);
    const parsed = readConfigEntries(adapter, after);
    if (!parsed.ok) throw new Error("post-removal CRLF file must parse");
    expect(parsed.entries["iris-dev-mcp"]).toBeUndefined();
    expect(parsed.entries["microsoft-learn"]).toBeDefined();
    expect(after).toContain("// VS Code user MCP configuration");
  });

  it("CRLF TOML: region math stays correct with \\r\\n line endings", () => {
    const adapter = adapterOf("codex");
    const content = readFixture("codex/config.toml").replaceAll("\n", "\r\n");
    const disable = expectOk(diff(content, canonicalEntry("iris-dev-mcp"), adapter, "user", "remove"));
    expect(disable.mechanism).toBe("remove");
    const after = applyTomlSplice(content, disable.native as TomlNativeEdit);
    const parsed = readConfigEntries(adapter, after);
    if (!parsed.ok) throw new Error("post-removal CRLF file must parse");
    expect(parsed.entries["iris-dev-mcp"]).toBeUndefined();
    expect(parsed.entries["context7"]).toBeDefined();
    expect(after).toContain("# A foreign third-party server");
  });

  it("BOM JSONC: a BOM'd file renders an executable removal (offsets stay consistent)", () => {
    const adapter = adapterOf("claude-code");
    const content = String.fromCharCode(0xfeff) + readFixture("claude-code/user.json");
    const disable = expectOk(diff(content, canonicalEntry("iris-dev-mcp"), adapter, "user", "disable"));
    expect(disable.mechanism).toBe("stash-remove");
    expect((disable.native as JsoncNativeEdit).edits.length).toBeGreaterThan(0);
    const after = applyEdits(content, (disable.native as JsoncNativeEdit).edits);
    const parsed = readConfigEntries(adapter, after);
    if (!parsed.ok) throw new Error("post-removal BOM file must parse");
    expect(parsed.entries["iris-dev-mcp"]).toBeUndefined();
    expect(parsed.entries["github-mcp"]).toBeDefined();
  });

  it("BOM TOML: header matching and the splice tolerate a leading BOM", () => {
    const adapter = adapterOf("codex");
    const content = String.fromCharCode(0xfeff) + readFixture("codex/config.toml");
    const disable = expectOk(diff(content, canonicalEntry("iris-dev-mcp"), adapter, "user", "remove"));
    expect(disable.mechanism).toBe("remove");
    const native = disable.native as TomlNativeEdit;
    expect(native.region, "owned region must be found under a BOM").not.toBeNull();
    const after = applyTomlSplice(content, native);
    const parsed = readConfigEntries(adapter, after);
    if (!parsed.ok) throw new Error("post-removal BOM file must parse");
    expect(parsed.entries["iris-dev-mcp"]).toBeUndefined();
    expect(parsed.entries["context7"]).toBeDefined();
  });
});

describe("adversarial: surgical JSON removal when the owned entry is LAST", () => {
  it("owned last without trailing comma: the PRECEDING comma is swallowed, no dangling comma left", () => {
    const adapter = adapterOf("claude-code");
    const content = `{
  "mcpServers": {
    "github-mcp": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"] },
    "iris-dev-mcp": { "command": "npx", "args": ["-y", "@iris-mcp/dev"] }
  }
}`;
    const disable = expectOk(diff(content, canonicalEntry("iris-dev-mcp"), adapter, "user", "disable"));
    expect(disable.mechanism).toBe("stash-remove");
    const edits = (disable.native as JsoncNativeEdit).edits;
    expect(edits).toHaveLength(1);
    const edit = edits[0];
    if (!edit) throw new Error("unreachable");
    const removedSpan = content.slice(edit.offset, edit.offset + edit.length);
    expect(removedSpan).toContain("iris-dev-mcp");
    expect(removedSpan).not.toContain("github-mcp");
    const after = applyEdits(content, edits);
    // No dangling comma before the closing brace (strict-JSON-clean result).
    expect(after).not.toMatch(/,\s*}/);
    const parsed = readConfigEntries(adapter, after);
    if (!parsed.ok) throw new Error("post-removal file must parse");
    expect(parsed.entries["iris-dev-mcp"]).toBeUndefined();
    expect(parsed.entries["github-mcp"]).toBeDefined();
  });

  it("owned last WITH a JSONC trailing comma: removal stays inside the owned span", () => {
    const adapter = adapterOf("vscode");
    const content = `{
  // comment
  "servers": {
    "microsoft-learn": { "command": "npx", "args": ["-y", "@microsoft/learn-mcp"] },
    "iris-dev-mcp": { "command": "npx", "args": ["-y", "@iris-mcp/dev"] },
  }
}`;
    const disable = expectOk(diff(content, canonicalEntry("iris-dev-mcp"), adapter, "user", "disable"));
    expect(disable.mechanism).toBe("stash-remove");
    const edits = (disable.native as JsoncNativeEdit).edits;
    const edit = edits[0];
    if (!edit) throw new Error("removal edit missing");
    const removedSpan = content.slice(edit.offset, edit.offset + edit.length);
    expect(removedSpan).toContain("iris-dev-mcp");
    expect(removedSpan).not.toContain("microsoft-learn");
    const after = applyEdits(content, edits);
    const parsed = readConfigEntries(adapter, after);
    if (!parsed.ok) throw new Error("post-removal file must parse");
    expect(parsed.entries["iris-dev-mcp"]).toBeUndefined();
    expect(parsed.entries["microsoft-learn"]).toBeDefined();
  });
});

describe("adversarial: deeply-nested and unicode-named foreign entries", () => {
  it("foreign nesting/unicode surfaces names only and survives an owned apply", () => {
    const adapter = adapterOf("claude-code");
    const secret = "sk-unicodeForeignSecret";
    const content = `{
  "mcpServers": {
    "iris-dev-mcp": { "command": "npx", "args": ["-y", "@iris-mcp/dev"] },
    "検索サーバー": {
      "command": "npx",
      "args": ["-y", "@foreign/search"],
      "env": { "API_KEY": "${secret}" },
      "headers": { "Authorization": "Bearer ${secret}" },
      "nested": { "deep": { "deeper": [1, 2, { "leaf": true }] } }
    }
  }
}`;
    const fs: StatusFs = {
      exists: (p) => p === "/h/.claude.json",
      readFile: () => content,
    };
    const report = status({ platform: "linux", env: {}, homeDir: "/h" }, fs);
    const userScope = scopeOf(report, "claude-code", "user");
    expect(userScope.file).toBe("ok");
    expect(userScope.foreign).toEqual(["検索サーバー"]);
    expect(JSON.stringify(report)).not.toContain(secret);

    // An owned apply renders without the unicode name or the secret, and the
    // foreign entry survives execution with its deep structure intact.
    const apply = expectOk(diff(content, canonicalEntry("iris-ops-mcp"), adapter, "user", "apply"));
    expect(apply.text).not.toContain("検索サーバー");
    expect(apply.text).not.toContain(secret);
    for (const edit of (apply.native as JsoncNativeEdit).edits) {
      expect(edit.content).not.toContain("検索サーバー");
      expect(edit.content).not.toContain(secret);
    }
    const after = applyEdits(content, (apply.native as JsoncNativeEdit).edits);
    const parsed = readConfigEntries(adapter, after);
    if (!parsed.ok) throw new Error("post-apply file must parse");
    expect(parsed.entries["iris-ops-mcp"]).toBeDefined();
    const foreign = parsed.entries["検索サーバー"];
    expect(foreign).toBeDefined();
    const nested = foreign?.["nested"] as Record<string, Record<string, unknown[]>>;
    expect(nested["deep"]?.["deeper"]).toHaveLength(3);
  });
});

describe("adversarial: filesystem failures degrade, never crash", () => {
  it("EACCES on readFile ⇒ per-scope unparseable with a read reason; other clients unaffected", () => {
    const fs: StatusFs = {
      exists: (p) => p === "/h/.claude.json",
      readFile: () => {
        throw new Error("EACCES: permission denied, open '/h/.claude.json'");
      },
    };
    let report: StatusReport | undefined;
    expect(() => {
      report = status({ platform: "linux", env: {}, homeDir: "/h" }, fs);
    }).not.toThrow();
    if (!report) throw new Error("unreachable");
    const userScope = scopeOf(report, "claude-code", "user");
    expect(userScope.file).toBe("unparseable");
    expect(userScope.error).toContain("could not read");
    expect(userScope.servers).toEqual([]);
    // Every other client is simply undetected (mechanical count, Rule #51).
    expect(report.undetected).toHaveLength(Object.keys(CLIENT_ADAPTERS).length - 1);
  });

});
