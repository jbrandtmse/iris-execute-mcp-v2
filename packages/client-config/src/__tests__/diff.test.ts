/**
 * Story 33.0 Task 5 / AC 33.0.3 + AC 33.0.4 — the pure diff renderer.
 *
 * Proves: (a) per-format pending edits for apply/enable/disable, (b) purity
 * (identical inputs ⇒ identical output), (c) direct executability — every
 * rendered edit is applied to a COPY of the fixture with the exact mechanism
 * Story 33.1's write engine will use (jsonc-parser applyEdits, a TOML text
 * splice, a YAML CST op) and the post-edit file re-parses with the owned
 * change applied and every foreign entry intact, and (d) foreign entries
 * provably absent from every rendered edit (AC 33.0.4).
 */

import { describe, it, expect } from "vitest";
import { applyEdits } from "jsonc-parser";
import { parse as parseToml } from "smol-toml";
import { parseDocument } from "yaml";

import {
  CLIENT_ADAPTERS,
  CANONICAL_SERVERS,
  diff,
  entryPresence,
  readConfigEntries,
  findTomlEntryRegion,
  findTomlInsertLine,
  serializeTomlEntry,
  renderNativeEntry,
  type CanonicalEntry,
  type CanonicalServerName,
  type ClientAdapter,
  type DiffResult,
  type JsoncNativeEdit,
  type TomlNativeEdit,
  type YamlNativeEdit,
} from "../index.js";
import { ADAPTER_FIXTURES, readFixture, FOREIGN_ENTRY_NAMES, FOREIGN_SECRET_MARKERS } from "./helpers.js";

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

/**
 * Execute a TOML splice descriptor against content — the SAME mechanics
 * Story 33.1's write engine will perform (test-local: the write engine owns
 * the fs/backup protocol; this proves the descriptor is directly executable).
 */
function applyTomlSplice(content: string, edit: TomlNativeEdit): string {
  const lines = content.split("\n");
  if (edit.op === "insert") {
    const block = (edit.insertText ?? "").split("\n");
    const at = (edit.insertAfterLine ?? -1) + 1;
    lines.splice(at, 0, "", ...block);
    return lines.join("\n");
  }
  if (edit.op === "set-flag") {
    // Mirror the 33.1 write engine's set-flag mechanics.
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

/** Execute a YAML CST op against content (the 33.1 mechanism). */
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

/** Word-boundary scan for foreign names on a rendered surface. */
function expectNoForeignLeaks(surface: string, context: string): void {
  for (const name of FOREIGN_ENTRY_NAMES) {
    const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
    expect(re.test(surface), `${context} leaked foreign entry "${name}"`).toBe(false);
  }
  for (const marker of FOREIGN_SECRET_MARKERS) {
    expect(surface, `${context} leaked foreign value`).not.toContain(marker);
  }
}

function renderSurface(result: Extract<DiffResult, { ok: true }>): string {
  const parts: string[] = [result.text];
  const native = result.native;
  if (native === null) return parts.join("\n"); // already-in-state: no descriptor
  if (native.kind === "jsonc") {
    for (const edit of native.edits) parts.push(edit.content);
  } else if (native.kind === "toml-splice") {
    if (native.insertText !== null) parts.push(native.insertText);
  } else if (native.renderedEntry !== null) {
    parts.push(native.renderedEntry);
  }
  return parts.join("\n");
}

describe("purity (AC 33.0.3)", () => {
  it("identical inputs ⇒ identical output, no fs/clock/env sensitivity", () => {
    const adapter = adapterOf("claude-code");
    const content = readFixture("claude-code/user.json");
    const entry = canonicalEntry("iris-dev-mcp");
    const first = diff(content, entry, adapter, "user", "apply");
    const second = diff(content, entry, adapter, "user", "apply");
    expect(second).toEqual(first);
    const disable1 = diff(content, entry, adapter, "user", "disable");
    const disable2 = diff(content, entry, adapter, "user", "disable");
    expect(disable2).toEqual(disable1);
  });
});

describe("JSON/JSONC edits (jsonc-parser modify — the 33.1 apply set)", () => {
  it("apply on a missing file (null content) renders an executable add", () => {
    const adapter = adapterOf("claude-code");
    const entry = canonicalEntry("iris-dev-mcp");
    const result = expectOk(diff(null, entry, adapter, "user", "apply"));
    expect(result.mechanism).toBe("add");
    const native = result.native as JsoncNativeEdit;
    expect(native.kind).toBe("jsonc");
    expect(native.edits.length).toBeGreaterThan(0);
    const after = applyEdits("", native.edits);
    const parsed = readConfigEntries(adapter, after);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.entries["iris-dev-mcp"]).toBeDefined();
  });

  it("apply on an existing entry renders an update", () => {
    const adapter = adapterOf("claude-code");
    const result = expectOk(
      diff(readFixture("claude-code/user.json"), canonicalEntry("iris-dev-mcp"), adapter, "user", "apply"),
    );
    expect(result.mechanism).toBe("update");
    const native = result.native as JsoncNativeEdit;
    const after = applyEdits(readFixture("claude-code/user.json"), native.edits);
    const parsed = readConfigEntries(adapter, after);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.entries["iris-dev-mcp"]).toBeDefined();
      // The foreign entry is untouched.
      expect(parsed.entries["github-mcp"]).toBeDefined();
    }
  });

  it("disable on a stash client renders an executable removal; foreign entries survive", () => {
    const adapter = adapterOf("claude-code");
    const content = readFixture("claude-code/user.json");
    const result = expectOk(diff(content, canonicalEntry("iris-dev-mcp"), adapter, "user", "disable"));
    expect(result.mechanism).toBe("stash-remove");
    const native = result.native as JsoncNativeEdit;
    const after = applyEdits(content, native.edits);
    const parsed = readConfigEntries(adapter, after);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.entries["iris-dev-mcp"]).toBeUndefined();
      expect(parsed.entries["github-mcp"]).toBeDefined();
    }
  });

  it("enable on a stash client: present ⇒ already-in-state; absent ⇒ stash-add", () => {
    const adapter = adapterOf("claude-code");
    const content = readFixture("claude-code/user.json");
    const present = expectOk(diff(content, canonicalEntry("iris-dev-mcp"), adapter, "user", "enable"));
    expect(present.mechanism).toBe("already-in-state");
    // already-in-state renders NO descriptor — a null native cannot be
    // mis-executed by 33.1's apply path (a YAML `set` of null would DESTROY
    // the entry; a TOML null-field "insert" would splice stray blank lines).
    expect(present.native).toBeNull();
    const absent = expectOk(diff(null, canonicalEntry("iris-ops-mcp"), adapter, "user", "enable"));
    expect(absent.mechanism).toBe("stash-add");
    expect(absent.native).not.toBeNull();
  });

  it("already-in-state renders a null descriptor for every format family", () => {
    // JSON family covered above; pin TOML + YAML explicitly (the two shapes
    // whose no-op descriptors were previously executable-looking traps).
    const tomlResult = expectOk(
      diff(readFixture("codex/config.toml"), canonicalEntry("iris-dev-mcp"), adapterOf("codex"), "user", "enable"),
    );
    expect(tomlResult.mechanism).toBe("already-in-state");
    expect(tomlResult.native).toBeNull();
    const yamlResult = expectOk(
      diff(readFixture("goose/config.yaml"), canonicalEntry("iris-data-mcp"), adapterOf("goose"), "user", "enable"),
    );
    expect(yamlResult.mechanism).toBe("already-in-state");
    expect(yamlResult.native).toBeNull();
  });

  it("native-flag enable/disable round-trips through applyEdits (Cline)", () => {
    const adapter = adapterOf("cline");
    const content = readFixture("cline/cline_mcp_settings.json");
    const enable = expectOk(diff(content, canonicalEntry("iris-dev-mcp"), adapter, "user", "enable"));
    expect(enable.mechanism).toBe("native-flag");
    const afterEnable = applyEdits(content, (enable.native as JsoncNativeEdit).edits);
    const parsedEnable = readConfigEntries(adapter, afterEnable);
    if (parsedEnable.ok) {
      expect(parsedEnable.entries["iris-dev-mcp"]?.["disabled"]).toBe(false);
      // autoApprove and the foreign entry are preserved.
      expect(parsedEnable.entries["iris-dev-mcp"]?.["autoApprove"]).toBeDefined();
      expect(parsedEnable.entries["aws-docs"]).toBeDefined();
    }
    const disable = expectOk(diff(content, canonicalEntry("iris-admin-mcp"), adapter, "user", "disable"));
    expect(disable.mechanism).toBe("native-flag");
    const afterDisable = applyEdits(content, (disable.native as JsoncNativeEdit).edits);
    const parsedDisable = readConfigEntries(adapter, afterDisable);
    if (parsedDisable.ok) {
      expect(parsedDisable.entries["iris-admin-mcp"]?.["disabled"]).toBe(true);
    }
  });

  it("native-flag enable/disable on an absent entry refuses cleanly", () => {
    const adapter = adapterOf("cline");
    const content = readFixture("cline/cline_mcp_settings.json");
    const enable = diff(content, canonicalEntry("iris-ops-mcp"), adapter, "user", "enable");
    expect(enable.ok).toBe(false);
    const disable = diff(content, canonicalEntry("iris-ops-mcp"), adapter, "user", "disable");
    expect(disable.ok).toBe(false);
  });

  it("VS Code JSONC apply preserves comments around the edit", () => {
    const adapter = adapterOf("vscode");
    const content = readFixture("vscode/user.jsonc");
    const result = expectOk(diff(content, canonicalEntry("iris-ops-mcp"), adapter, "user", "apply"));
    const after = applyEdits(content, (result.native as JsoncNativeEdit).edits);
    expect(after).toContain("// VS Code user MCP configuration");
    expect(after).toContain("// A foreign third-party server");
    const parsed = readConfigEntries(adapter, after);
    if (parsed.ok) {
      expect(parsed.entries["iris-ops-mcp"]).toBeDefined();
      expect(parsed.entries["microsoft-learn"]).toBeDefined();
    }
  });

  it("Zed apply renders the context_servers command-object shape", () => {
    const adapter = adapterOf("zed");
    const shaped = renderNativeEntry(adapter, canonicalEntry("iris-admin-mcp"));
    expect(shaped).toEqual({
      command: { path: "npx", args: ["-y", "@iris-mcp/admin"], env: { IRIS_NAMESPACE: "HSCUSTOM" } },
    });
    const result = expectOk(
      diff(readFixture("zed/settings.json"), canonicalEntry("iris-admin-mcp"), adapter, "user", "apply"),
    );
    const after = applyEdits(readFixture("zed/settings.json"), (result.native as JsoncNativeEdit).edits);
    const parsed = readConfigEntries(adapter, after);
    if (parsed.ok) expect(parsed.entries["iris-admin-mcp"]).toEqual(shaped);
  });
});

describe("TOML section splices (Codex — owned tables only)", () => {
  it("apply renders an insert descriptor that splices into a parseable file", () => {
    const adapter = adapterOf("codex");
    const content = readFixture("codex/config.toml");
    const entry = canonicalEntry("iris-ops-mcp");
    const result = expectOk(diff(content, entry, adapter, "user", "apply"));
    expect(result.mechanism).toBe("add");
    const native = result.native as TomlNativeEdit;
    expect(native.kind).toBe("toml-splice");
    expect(native.op).toBe("insert");
    expect(native.insertText).toContain("[mcp_servers.iris-ops-mcp]");
    const after = applyTomlSplice(content, native);
    const parsed = parseToml(after) as Record<string, Record<string, Record<string, unknown>>>;
    expect(parsed["mcp_servers"]?.["iris-ops-mcp"]).toBeDefined();
    expect(parsed["mcp_servers"]?.["iris-dev-mcp"]).toBeDefined();
    expect(parsed["mcp_servers"]?.["context7"]).toBeDefined();
    // Comments elsewhere survive a text splice.
    expect(after).toContain("# A foreign third-party server");
  });

  it("apply on an existing entry renders a bounded replace-region", () => {
    const adapter = adapterOf("codex");
    const content = readFixture("codex/config.toml");
    const result = expectOk(diff(content, canonicalEntry("iris-dev-mcp"), adapter, "user", "apply"));
    expect(result.mechanism).toBe("update");
    const native = result.native as TomlNativeEdit;
    expect(native.op).toBe("replace-region");
    expect(native.region).not.toBeNull();
    const after = applyTomlSplice(content, native);
    const parsed = parseToml(after) as Record<string, Record<string, Record<string, unknown>>>;
    expect(parsed["mcp_servers"]?.["iris-dev-mcp"]).toBeDefined();
    expect(parsed["mcp_servers"]?.["context7"]).toBeDefined();
  });

  it("remove renders a remove-region covering ONLY the owned tables (env sub-table included)", () => {
    const adapter = adapterOf("codex");
    const content = readFixture("codex/config.toml");
    const result = expectOk(diff(content, canonicalEntry("iris-dev-mcp"), adapter, "user", "remove"));
    expect(result.mechanism).toBe("remove");
    const native = result.native as TomlNativeEdit;
    expect(native.op).toBe("remove-region");
    if (!native.region) throw new Error("region missing");
    const lines = content.split("\n");
    const removedText = lines.slice(native.region.startLine, native.region.endLine + 1).join("\n");
    expect(removedText).toContain("[mcp_servers.iris-dev-mcp]");
    expect(removedText).toContain("[mcp_servers.iris-dev-mcp.env]");
    expect(removedText).not.toContain("context7");
    const after = applyTomlSplice(content, native);
    const parsed = parseToml(after) as Record<string, Record<string, Record<string, unknown>>>;
    expect(parsed["mcp_servers"]?.["iris-dev-mcp"]).toBeUndefined();
    expect(parsed["mcp_servers"]?.["context7"]).toBeDefined();
    expect(after).toContain("# A foreign third-party server");
  });

  it("disable renders a set-flag edit (Codex native `enabled` flag, 33.1 probe)", () => {
    const adapter = adapterOf("codex");
    const content = readFixture("codex/config.toml");
    const result = expectOk(diff(content, canonicalEntry("iris-dev-mcp"), adapter, "user", "disable"));
    expect(result.mechanism).toBe("native-flag");
    const native = result.native as TomlNativeEdit;
    expect(native.op).toBe("set-flag");
    expect(native.insertText).toBe("enabled = false");
    // The fixture entry has no flag line: insert directly after the owned
    // table header so the key lands in the MAIN table, never `.env`.
    expect(native.region).toBeNull();
    const lines = content.split("\n");
    expect(lines[native.insertAfterLine ?? -1]).toContain("[mcp_servers.iris-dev-mcp]");
    const after = applyTomlSplice(content, native);
    const parsed = parseToml(after) as Record<string, Record<string, Record<string, unknown>>>;
    expect(parsed["mcp_servers"]?.["iris-dev-mcp"]?.["enabled"]).toBe(false);
    // The env sub-table is untouched and still belongs to the entry.
    expect((parsed["mcp_servers"]?.["iris-dev-mcp"]?.["env"] as Record<string, unknown>)?.["IRIS_NAMESPACE"]).toBe("HSCUSTOM");
    expect(parsed["mcp_servers"]?.["context7"]).toBeDefined();
  });

  it("disable replaces an existing flag line; enable restores it (round-trip)", () => {
    const adapter = adapterOf("codex");
    const content = [
      "[mcp_servers.iris-dev-mcp]",
      'command = "npx"',
      'args = ["-y", "@iris-mcp/dev"]',
      "enabled = true",
      "",
      "[mcp_servers.context7]",
      'command = "npx"',
      "",
    ].join("\n");
    const disable = expectOk(diff(content, canonicalEntry("iris-dev-mcp"), adapter, "user", "disable"));
    const native = disable.native as TomlNativeEdit;
    expect(native.op).toBe("set-flag");
    // The existing `enabled = true` line (index 3) is the replace target.
    expect(native.region).toEqual({ startLine: 3, endLine: 3 });
    expect(native.insertText).toBe("enabled = false");
    const afterDisable = applyTomlSplice(content, native);
    expect(afterDisable).toContain("enabled = false");
    expect(afterDisable).not.toContain("enabled = true");
    const enable = expectOk(diff(afterDisable, canonicalEntry("iris-dev-mcp"), adapter, "user", "enable"));
    const enableNative = enable.native as TomlNativeEdit;
    expect(enableNative.insertText).toBe("enabled = true");
    const afterEnable = applyTomlSplice(afterDisable, enableNative);
    // Byte-exact round-trip through the flag toggle.
    expect(afterEnable).toBe(content);
  });

  it("a flag-looking key inside the `.env` sub-table is never the toggle target", () => {
    const adapter = adapterOf("codex");
    const content = [
      "[mcp_servers.iris-dev-mcp]",
      'command = "npx"',
      'args = ["-y", "@iris-mcp/dev"]',
      "",
      "[mcp_servers.iris-dev-mcp.env]",
      'enabled = "true"',
      'IRIS_NAMESPACE = "HSCUSTOM"',
      "",
    ].join("\n");
    const result = expectOk(diff(content, canonicalEntry("iris-dev-mcp"), adapter, "user", "disable"));
    const native = result.native as TomlNativeEdit;
    expect(native.op).toBe("set-flag");
    // The scan stops at the `.env` header: no main-table flag line exists, so
    // the flag is inserted after the OWNED header (index 0), and the env var
    // named `enabled` survives verbatim.
    expect(native.region).toBeNull();
    expect(native.insertAfterLine).toBe(0);
    const after = applyTomlSplice(content, native);
    const lines = after.split("\n");
    expect(lines[1]).toBe("enabled = false");
    expect(after).toContain('enabled = "true"');
    const parsed = parseToml(after) as Record<string, Record<string, Record<string, unknown>>>;
    expect(parsed["mcp_servers"]?.["iris-dev-mcp"]?.["enabled"]).toBe(false);
    expect((parsed["mcp_servers"]?.["iris-dev-mcp"]?.["env"] as Record<string, unknown>)?.["enabled"]).toBe("true");
  });

  it("region helpers bound the owned tables and the insert point", () => {
    const content = readFixture("codex/config.toml");
    const region = findTomlEntryRegion(content, "mcp_servers", "iris-dev-mcp");
    expect(region).not.toBeNull();
    const lines = content.split("\n");
    if (!region) throw new Error("unreachable");
    expect(lines[region.startLine]).toContain("[mcp_servers.iris-dev-mcp]");
    expect(lines[region.endLine]).toContain('IRIS_NAMESPACE = "HSCUSTOM"');
    // The insert point lands inside/after the mcp_servers block, before foreign sections.
    const insertLine = findTomlInsertLine(content, "mcp_servers");
    expect(insertLine).toBeGreaterThan(region.endLine);
    expect(lines[insertLine]).toContain("@upstash/context7-mcp");
  });

  it("serializeTomlEntry renders command/args/env as owned tables", () => {
    const block = serializeTomlEntry(adapterOf("codex"), canonicalEntry("iris-data-mcp"));
    expect(block).toContain("[mcp_servers.iris-data-mcp]");
    expect(block).toContain('command = "npx"');
    expect(block).toContain('args = ["-y", "@iris-mcp/data"]');
    expect(block).toContain("[mcp_servers.iris-data-mcp.env]");
    expect(block).toContain('IRIS_NAMESPACE = "HSCUSTOM"');
    // The block itself is valid TOML.
    const parsed = parseToml(block) as Record<string, unknown>;
    expect(parsed["mcp_servers"]).toBeDefined();
  });
});

describe("TOML trailing-comment headers + header-less forms (33.0 review findings)", () => {
  // A trailing comment ON a table header is legal, idiomatic TOML (exactly
  // how a manager annotates: `[mcp_servers.x] # managed by iris-mcp`). The
  // pre-patch region regexes missed such headers: an update rendered an
  // INSERT that redefined the table (invalid TOML once executed), and a
  // removal rendered a null-region no-op that silently kept the entry.
  const commented = [
    "[mcp_servers.iris-dev-mcp] # managed by iris-mcp",
    'command = "npx"',
    'args = ["-y", "@iris-mcp/dev"]',
    "",
    "# context7 keeps its own comment.",
    "[mcp_servers.context7] # foreign, never touched",
    'command = "npx"',
    'args = ["-y", "@upstash/context7-mcp"]',
    "",
  ].join("\n");

  it("update on a comment-headed owned table renders replace-region, executable and valid", () => {
    const adapter = adapterOf("codex");
    const result = expectOk(diff(commented, canonicalEntry("iris-dev-mcp"), adapter, "user", "apply"));
    expect(result.mechanism).toBe("update");
    const native = result.native as TomlNativeEdit;
    expect(native.op).toBe("replace-region");
    if (!native.region) throw new Error("region missing");
    // The region starts ON the commented header line (the comment belongs to
    // the owned table) and never reaches the foreign table.
    const lines = commented.split("\n");
    expect(lines[native.region.startLine]).toContain("[mcp_servers.iris-dev-mcp] # managed by iris-mcp");
    const removedText = lines.slice(native.region.startLine, native.region.endLine + 1).join("\n");
    expect(removedText).not.toContain("context7");
    const after = applyTomlSplice(commented, native);
    const parsed = parseToml(after) as Record<string, Record<string, Record<string, unknown>>>;
    expect(parsed["mcp_servers"]?.["iris-dev-mcp"]).toBeDefined();
    expect(parsed["mcp_servers"]?.["context7"]).toBeDefined();
    expect(after).toContain("# foreign, never touched");
    expect(after).toContain("# context7 keeps its own comment.");
  });

  it("remove on a comment-headed owned table renders a bounded remove-region (entry actually removed)", () => {
    const adapter = adapterOf("codex");
    const result = expectOk(diff(commented, canonicalEntry("iris-dev-mcp"), adapter, "user", "remove"));
    expect(result.mechanism).toBe("remove");
    const native = result.native as TomlNativeEdit;
    expect(native.op).toBe("remove-region");
    expect(native.region).not.toBeNull();
    const after = applyTomlSplice(commented, native);
    const parsed = parseToml(after) as Record<string, Record<string, Record<string, unknown>>>;
    expect(parsed["mcp_servers"]?.["iris-dev-mcp"]).toBeUndefined();
    expect(parsed["mcp_servers"]?.["context7"]).toBeDefined();
    expect(after).toContain("# foreign, never touched");
  });

  it("insert placement respects comment-headed sibling tables", () => {
    const insertLine = findTomlInsertLine(commented, "mcp_servers");
    // After the last mcp_servers table (the context7 one), not at EOF.
    expect(commented.split("\n")[insertLine]).toContain("@upstash/context7-mcp");
  });

  it("a dotted-key-defined entry (no table header) REFUSES update, disable and remove — never a redefining insert or silent no-op", () => {
    const adapter = adapterOf("codex");
    // Legal TOML: defines mcp_servers.iris-dev-mcp WITHOUT a table header.
    const dotted = [
      'mcp_servers.iris-dev-mcp.command = "npx"',
      'mcp_servers.iris-dev-mcp.args = ["-y", "@iris-mcp/dev"]',
      "",
      "[mcp_servers.context7]",
      'command = "npx"',
      'args = ["-y", "@upstash/context7-mcp"]',
      "",
    ].join("\n");
    const parsed = readConfigEntries(adapter, dotted);
    if (!parsed.ok) throw new Error("dotted-key fixture must parse");
    expect(parsed.entries["iris-dev-mcp"]).toBeDefined();

    const update = diff(dotted, canonicalEntry("iris-dev-mcp"), adapter, "user", "apply");
    expect(update.ok).toBe(false);
    if (!update.ok) expect(update.reason).toContain("no [mcp_servers.iris-dev-mcp] table header");
    const disable = diff(dotted, canonicalEntry("iris-dev-mcp"), adapter, "user", "disable");
    expect(disable.ok).toBe(false);
    if (!disable.ok) expect(disable.reason).toContain("no [mcp_servers.iris-dev-mcp] table header");
    const remove = diff(dotted, canonicalEntry("iris-dev-mcp"), adapter, "user", "remove");
    expect(remove.ok).toBe(false);
    if (!remove.ok) expect(remove.reason).toContain("no [mcp_servers.iris-dev-mcp] table header");
  });
});

describe("YAML CST ops (Goose)", () => {
  it("apply renders a set op with an owned-entry snippet; executable via the Document API", () => {
    const adapter = adapterOf("goose");
    const content = readFixture("goose/config.yaml");
    const entry = canonicalEntry("iris-interop-mcp");
    const result = expectOk(diff(content, entry, adapter, "user", "apply"));
    expect(result.mechanism).toBe("add");
    const native = result.native as YamlNativeEdit;
    expect(native.kind).toBe("yaml-cst");
    expect(native.op).toBe("set");
    expect(native.path).toEqual(["extensions", "iris-interop-mcp"]);
    expect(native.renderedEntry).toContain("type: stdio");
    const after = applyYamlOp(content, native);
    const parsed = readConfigEntries(adapter, after);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.entries["iris-interop-mcp"]).toBeDefined();
      expect(parsed.entries["developer"]).toBeDefined();
    }
    // Comments survive CST-level edits.
    expect(after).toContain("# Built-in Goose extension");
  });

  it("disable renders set-flag enabled=false on the native-flag client", () => {
    const adapter = adapterOf("goose");
    const content = readFixture("goose/config.yaml");
    const result = expectOk(diff(content, canonicalEntry("iris-data-mcp"), adapter, "user", "disable"));
    expect(result.mechanism).toBe("native-flag");
    const native = result.native as YamlNativeEdit;
    expect(native.op).toBe("set-flag");
    expect(native.path).toEqual(["extensions", "iris-data-mcp", "enabled"]);
    expect(native.value).toBe(false);
    const after = applyYamlOp(content, native);
    const parsed = readConfigEntries(adapter, after);
    if (parsed.ok) {
      expect(parsed.entries["iris-data-mcp"]?.["enabled"]).toBe(false);
    }
  });

  it("enable on an already-enabled entry is already-in-state", () => {
    const adapter = adapterOf("goose");
    const result = expectOk(
      diff(readFixture("goose/config.yaml"), canonicalEntry("iris-data-mcp"), adapter, "user", "enable"),
    );
    expect(result.mechanism).toBe("already-in-state");
  });
});

describe("refusals and the full-registry sweep (AC 33.0.4)", () => {
  it("malformed content refuses per format, never crashes", () => {
    const cases: Array<[string, string]> = [
      ["vscode", "malformed/bad.jsonc"],
      ["codex", "malformed/bad.toml"],
      ["goose", "malformed/bad.yaml"],
    ];
    for (const [adapterId, fixtureRel] of cases) {
      const result = diff(readFixture(fixtureRel), canonicalEntry("iris-dev-mcp"), adapterOf(adapterId), "user", "apply");
      expect(result.ok, adapterId).toBe(false);
      if (!result.ok) expect(result.reason.length).toBeGreaterThan(0);
    }
  });

  it("every adapter renders apply/enable/disable against its own native fixture", () => {
    for (const [id, fixtureRel] of Object.entries(ADAPTER_FIXTURES)) {
      const adapter = adapterOf(id);
      const content = readFixture(fixtureRel);
      const parsed = readConfigEntries(adapter, content);
      if (!parsed.ok) throw new Error(`fixture ${fixtureRel} must parse`);
      // Pick an owned server absent from the fixture when one exists, else the first present.
      const absent = CANONICAL_SERVERS.find((name) => parsed.ok && !(name in parsed.entries));
      const present = CANONICAL_SERVERS.find((name) => parsed.ok && name in parsed.entries);
      // For disable, target a PRESENT-ENABLED entry (disabling a disabled or
      // absent entry is already-in-state/refusal, not a rendered edit).
      const enabledPresent = CANONICAL_SERVERS.find((name) => {
        const entry = parsed.entries[name];
        return entry !== undefined && entryPresence(adapter, entry) === "present-enabled";
      });
      const target = absent ?? present;
      if (!target) throw new Error(`no canonical target derivable for ${id}`);
      const apply = expectOk(diff(content, canonicalEntry(target), adapter, "user", "apply"));
      expect(["add", "update"], `${id} apply mechanism`).toContain(apply.mechanism);
      if (enabledPresent) {
        const disable = expectOk(diff(content, canonicalEntry(enabledPresent), adapter, "user", "disable"));
        expect(["stash-remove", "native-flag"], `${id} disable mechanism`).toContain(disable.mechanism);
      }
      if (present) {
        const enable = expectOk(diff(content, canonicalEntry(present), adapter, "user", "enable"));
        expect(["already-in-state", "native-flag", "stash-add"], `${id} enable mechanism`).toContain(
          enable.mechanism,
        );
      }
    }
  });

  it("foreign entries are provably absent from every rendered edit surface", () => {
    for (const [id, fixtureRel] of Object.entries(ADAPTER_FIXTURES)) {
      const adapter = adapterOf(id);
      const content = readFixture(fixtureRel);
      const parsed = readConfigEntries(adapter, content);
      if (!parsed.ok) throw new Error(`fixture ${fixtureRel} must parse`);
      const present = CANONICAL_SERVERS.find((name) => name in parsed.entries);
      const absent = CANONICAL_SERVERS.find((name) => !(name in parsed.entries));
      const results: Array<Extract<DiffResult, { ok: true }>> = [];
      if (absent) results.push(expectOk(diff(content, canonicalEntry(absent), adapter, "user", "apply")));
      if (present) {
        results.push(expectOk(diff(content, canonicalEntry(present), adapter, "user", "apply")));
        results.push(expectOk(diff(content, canonicalEntry(present), adapter, "user", "disable")));
      }
      for (const result of results) {
        expectNoForeignLeaks(renderSurface(result), `${id}/${result.action}/${result.mechanism}`);
      }
    }
  });
});
