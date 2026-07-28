/**
 * Story 33.5 — QA unit-level edge layer, on top of the dev pins:
 *
 * - Engine-level regression pins for the TWO QA-stage product fixes (found by
 *   the process-level sweeps, fixed in the package, mutation-verified):
 *   (1) a comment-only JSONC document refused apply as an "unsupported
 *       document shape" even though AC 33.5.4 made it a valid empty document
 *       (diff.ts insertionEdits now treats a token-free, tree-less document
 *       like an empty file, preserving the trivia);
 *   (2) an apply-UPDATE on JSONC/YAML replaced the whole entry value,
 *       dropping every comment INSIDE the owned entry and reformatting
 *       untouched keys (diff.ts now emits PER-KEY edits — only a key whose
 *       merged value changed is touched; yaml merge-update op).
 * - status probe-throw degradation across MULTIPLE scopes (AC 33.5.5 sweep):
 *   one scope's exists/read probe failing must degrade THAT scope only.
 * - certify-record merge/keep-passing matrices (AC 33.5.6a/b) and
 *   passCreatedPaths ordering edges (33-5-18), beyond the dev pins.
 */

import { describe, it, expect } from "vitest";
import { parse as parseJsonc } from "jsonc-parser";
import { parseDocument } from "yaml";

import {
  CLIENT_ADAPTERS,
  diff,
  executeNativeEdit,
  readConfigEntries,
  status,
  type CanonicalEntry,
  type ClientAdapter,
  type HostContext,
  type StatusReport,
  type YamlNativeEdit,
} from "../index.js";
import { fixturePath } from "./helpers.js";

import { mergeCertificationRecord, passCreatedPaths } from "../../scripts/certify-record.mjs";

function adapterOf(id: string): ClientAdapter {
  const adapter = CLIENT_ADAPTERS[id];
  if (!adapter) throw new Error(`registry missing ${id}`);
  return adapter;
}

const ENTRY: CanonicalEntry = {
  name: "iris-dev-mcp",
  command: "npx",
  args: ["-y", "@iris-mcp/dev"],
  env: { IRIS_NAMESPACE: "HSCUSTOM" },
};

function expectOk(result: ReturnType<typeof diff>): Extract<ReturnType<typeof diff>, { ok: true }> {
  expect(result.ok, result.ok ? "" : result.reason).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  return result;
}

// ════════════════════════════════════════════════════════════════════
// QA-stage fix 1: comment-only JSONC accepts an add (trivia preserved).
// ════════════════════════════════════════════════════════════════════

describe("comment-only JSONC insertion (QA-stage fix, engine level)", () => {
  it("a line-comment-only document renders an add whose result preserves the comment and parses", () => {
    const adapter = adapterOf("vscode");
    const result = expectOk(diff("// just a comment\n", ENTRY, adapter, "user", "apply"));
    expect(result.mechanism).toBe("add");
    const after = executeNativeEdit("// just a comment\n", result.native);
    expect(after.startsWith("// just a comment")).toBe(true);
    const read = readConfigEntries(adapter, after);
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.entries["iris-dev-mcp"]?.command).toBe("npx");
  });

  it("a block-comment-only document behaves the same (strict-JSON client family too)", () => {
    const adapter = adapterOf("cline");
    const result = expectOk(diff("/* notes only */", ENTRY, adapter, "user", "apply"));
    const after = executeNativeEdit("/* notes only */", result.native);
    expect(after.startsWith("/* notes only */")).toBe(true);
    const read = readConfigEntries(adapter, after);
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.entries["iris-dev-mcp"]).toBeDefined();
  });

  it("comments + CRLF: the separator before the new document follows the file's EOL", () => {
    const adapter = adapterOf("vscode");
    const content = "// note\r\n// more\r\n";
    const result = expectOk(diff(content, ENTRY, adapter, "user", "apply"));
    const after = executeNativeEdit(content, result.native);
    expect(after.startsWith("// note\r\n// more\r\n")).toBe(true);
    expect(after).toContain('\r\n{');
  });

  it("a comment followed by REAL broken tokens still renders NO edit (refusal, never a guess)", () => {
    const adapter = adapterOf("vscode");
    const result = diff('// note\n{"servers": ,}\n', ENTRY, adapter, "user", "apply");
    expect(result.ok).toBe(false);
  });

  it("the plain empty-file add is byte-identical to the pre-fix behavior (unchanged path)", () => {
    const adapter = adapterOf("claude-code");
    const result = expectOk(diff("", ENTRY, adapter, "user", "apply"));
    const after = executeNativeEdit("", result.native);
    expect(after.startsWith("{")).toBe(true); // no trivia prefix invented
    expect(parseJsonc(after)).toEqual({
      mcpServers: {
        "iris-dev-mcp": { command: "npx", args: ["-y", "@iris-mcp/dev"], env: { IRIS_NAMESPACE: "HSCUSTOM" } },
      },
    });
  });
});

// ════════════════════════════════════════════════════════════════════
// QA-stage fix 2: per-key update surgery (comments INSIDE owned entries
// and untouched keys' formatting survive an apply-update).
// ════════════════════════════════════════════════════════════════════

describe("per-key apply-update surgery (QA-stage fix, engine level)", () => {
  it("JSONC: an interior comment and an untouched key's odd formatting stay byte-exact", () => {
    const adapter = adapterOf("cline");
    const content = [
      "{",
      '  "mcpServers": {',
      '    "iris-dev-mcp": {',
      '      "command": "old",',
      "      // keep this interior comment",
      '      "args": ["--old"],',
      '      "disabled": true,',
      '      "timeout":    45',
      "    }",
      "  }",
      "}",
      "",
    ].join("\n");
    const result = expectOk(diff(content, ENTRY, adapter, "user", "apply"));
    expect(result.mechanism).toBe("update");
    const after = executeNativeEdit(content, result.native);
    expect(after).toContain("// keep this interior comment");
    expect(after).toContain('"timeout":    45'); // untouched key: byte-exact, odd spacing and all
    expect(after).toContain('"disabled": true');
    const parsed = parseJsonc(after) as { mcpServers: Record<string, Record<string, unknown>> };
    const entry = parsed.mcpServers["iris-dev-mcp"] as Record<string, unknown>;
    expect(entry.command).toBe("npx");
    expect(entry.args).toEqual(["-y", "@iris-mcp/dev"]);
    expect((entry.env as Record<string, unknown>).IRIS_NAMESPACE).toBe("HSCUSTOM");
  });

  it("JSONC: a NEW managed key (env absent before) is INSERTED without disturbing sibling lines", () => {
    const adapter = adapterOf("cline");
    const content = [
      "{",
      '  "mcpServers": {',
      '    "iris-dev-mcp": {',
      '      "command": "old",',
      "      // interior note",
      '      "args": ["--old"],',
      '      "timeout": 45',
      "    }",
      "  }",
      "}",
      "",
    ].join("\n");
    const result = expectOk(diff(content, ENTRY, adapter, "user", "apply"));
    const after = executeNativeEdit(content, result.native);
    expect(after).toContain("// interior note");
    const parsed = parseJsonc(after) as { mcpServers: Record<string, Record<string, unknown>> };
    const entry = parsed.mcpServers["iris-dev-mcp"] as Record<string, unknown>;
    expect((entry.env as Record<string, unknown>).IRIS_NAMESPACE).toBe("HSCUSTOM");
    expect(entry.timeout).toBe(45);
  });

  it("YAML (goose): the update renders the per-key merge-update op; interior comments survive execution", () => {
    const adapter = adapterOf("goose");
    const content = [
      "extensions:",
      "  iris-dev-mcp:",
      "    type: stdio",
      "    cmd: old-cmd",
      "    # keep this interior comment",
      "    args:",
      "      - --old",
      "    enabled: false",
      "    timeout: 90",
      "",
    ].join("\n");
    const result = expectOk(diff(content, ENTRY, adapter, "user", "apply"));
    expect(result.mechanism).toBe("update");
    const native = result.native as YamlNativeEdit;
    expect(native.op).toBe("merge-update");
    // Only changed keys are targeted — never the flag, never timeout.
    const targeted = (native.ops ?? []).map((op) => op.path[op.path.length - 1]);
    expect(targeted).toContain("cmd");
    expect(targeted).toContain("args");
    expect(targeted).not.toContain("enabled");
    expect(targeted).not.toContain("timeout");
    const after = executeNativeEdit(content, result.native);
    expect(after).toContain("# keep this interior comment");
    const doc = parseDocument(after);
    expect(doc.errors).toHaveLength(0);
    const parsed = doc.toJS() as { extensions: Record<string, Record<string, unknown>> };
    expect(parsed.extensions["iris-dev-mcp"]?.cmd).toBe("npx");
    expect(parsed.extensions["iris-dev-mcp"]?.enabled).toBe(false);
    expect(parsed.extensions["iris-dev-mcp"]?.timeout).toBe(90);
  });

  it("a genuine no-op update still renders (the whole-value fallback), never an empty-edit refusal", () => {
    const adapter = adapterOf("cline");
    // The existing entry already deep-equals the merged render.
    const content = JSON.stringify(
      {
        mcpServers: {
          "iris-dev-mcp": {
            command: "npx",
            args: ["-y", "@iris-mcp/dev"],
            disabled: true,
            env: { IRIS_NAMESPACE: "HSCUSTOM" },
          },
        },
      },
      null,
      2,
    );
    const result = expectOk(diff(content, ENTRY, adapter, "user", "apply"));
    expect(result.mechanism).toBe("update");
    const after = executeNativeEdit(content, result.native);
    const parsed = parseJsonc(after) as { mcpServers: Record<string, Record<string, unknown>> };
    expect(parsed.mcpServers["iris-dev-mcp"]?.disabled).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════
// AC 33.5.5 sweep: probe-throw degradation across MULTIPLE scopes — one
// scope's failing probe degrades THAT scope only (the dev pin covered a
// single client/scope; this sweeps the multi-scope matrix).
// ════════════════════════════════════════════════════════════════════

describe("status probe-throw degradation across multiple scopes (AC 33.5.5, QA sweep)", () => {
  const home = fixturePath("sandbox-home");
  const userConfig = home + "/.claude.json";
  const projectConfig = home + "/proj/.mcp.json";
  const ctx: HostContext = { platform: "linux", env: {}, homeDir: home, projectDir: home + "/proj" };

  it("a project-scope exists probe throwing mid-run degrades ONLY the project scope (user stays ok)", () => {
    // Real transient shape (Rule #54): detection probes each path once
    // (succeeds → client detected), then the status matrix's own resolution
    // probes again and the fs now throws (EACCES on a removable drive).
    const callsPerPath = new Map<string, number>();
    const fs = {
      exists: (p: string): boolean => {
        const calls = (callsPerPath.get(p) ?? 0) + 1;
        callsPerPath.set(p, calls);
        if (p === projectConfig && calls > 1) throw new Error("EACCES: permission denied (transient)");
        return p === userConfig || p === projectConfig;
      },
      readFile: (p: string): string => {
        if (p === userConfig) return '{"mcpServers": {"iris-dev-mcp": {"command": "npx"}}}';
        throw new Error("unreachable — the degraded project probe reports missing");
      },
    };
    let report: StatusReport | undefined;
    expect(() => {
      report = status(ctx, fs);
    }).not.toThrow();
    const claude = report?.clients.find((c) => c.client === "claude-code");
    expect(claude?.scopes.find((s) => s.scope === "user")?.file).toBe("ok");
    expect(claude?.scopes.find((s) => s.scope === "project")?.file).toBe("missing");
    expect(claude?.scopes.find((s) => s.scope === "user")?.servers.find((s) => s.server === "iris-dev-mcp")?.state).toBe(
      "present-enabled",
    );
  });

  it("a read failure on ONE scope renders that scope unparseable with the reason; sibling scopes stay ok", () => {
    const fs = {
      exists: (p: string): boolean => p === userConfig || p === projectConfig,
      readFile: (p: string): string => {
        if (p === projectConfig) throw new Error("EACCES: permission denied, open (transient)");
        return '{"mcpServers": {"iris-dev-mcp": {"command": "npx"}}}';
      },
    };
    let report: StatusReport | undefined;
    expect(() => {
      report = status(ctx, fs);
    }).not.toThrow();
    const claude = report?.clients.find((c) => c.client === "claude-code");
    const project = claude?.scopes.find((s) => s.scope === "project");
    expect(project?.file).toBe("unparseable");
    expect(project?.error).toContain("could not read the file");
    expect(claude?.scopes.find((s) => s.scope === "user")?.file).toBe("ok");
  });

  it("a UNIVERSALLY throwing exists probe degrades at detection — status still completes with zero crashes", () => {
    // The detect.ts:77-80 pattern the AC references: when even detection's
    // probes throw, every client is undetected and the matrix is empty —
    // never an exception across the command.
    const fs = {
      exists: (): boolean => {
        throw new Error("EIO: i/o error (total fs failure)");
      },
      readFile: (): string => {
        throw new Error("unreachable");
      },
    };
    let report: StatusReport | undefined;
    expect(() => {
      report = status({ platform: "linux", env: {}, homeDir: home }, fs);
    }).not.toThrow();
    expect(report?.clients).toHaveLength(0);
    expect(report?.undetected.length).toBe(Object.keys(CLIENT_ADAPTERS).length);
  });
});

// ════════════════════════════════════════════════════════════════════
// certify-record matrices (AC 33.5.6a/b + 33-5-18), beyond the dev pins.
// ════════════════════════════════════════════════════════════════════

describe("mergeCertificationRecord — QA matrices (AC 33.5.6a/b)", () => {
  const live = { disposition: "certified-live", date: "2026-07-28", evidence: ["PASS add"] };

  it("the keep-passing guard holds even when the failed record carries EXTRA keys (residualRisk)", () => {
    const failed = { disposition: "certification-failed-see-story", date: "2026-07-29", residualRisk: "new risk" };
    expect(mergeCertificationRecord(live, failed, false).action).toBe("keep");
  });

  it("the guard keys on the EXISTING disposition: a failed pass over a failed record DOES write (the new failure is recorded)", () => {
    const existingFailed = { disposition: "certification-failed-see-story", date: "2026-07-28", note: "hand-note" };
    const failed = { disposition: "certification-failed-see-story", date: "2026-07-29" };
    const decision = mergeCertificationRecord(existingFailed, failed, false);
    expect(decision.action).toBe("write");
    if (decision.action !== "write") return;
    expect(decision.merged.date).toBe("2026-07-29");
    expect(decision.merged.note).toBe("hand-note"); // merge still preserves hand-authored keys
  });

  it("a FIRST run (no existing record) writes on failure AND on success", () => {
    expect(mergeCertificationRecord(undefined, { disposition: "certification-failed-see-story" }, false).action).toBe("write");
    expect(mergeCertificationRecord(undefined, live, true).action).toBe("write");
  });

  it("on a passing re-run the new record wins EVERY shared key; only unshared hand-authored keys survive", () => {
    const existing = {
      ...live,
      steps: ["PASS old"],
      host: "win32/x64",
      sharing: { claim: "hand-authored" },
      residualRisk: "hand risk",
    };
    const fresh = { ...live, date: "2026-07-29", steps: ["PASS new"], host: "linux/x64", residualRisk: "fresh risk" };
    const decision = mergeCertificationRecord(existing, fresh, true);
    expect(decision.action).toBe("write");
    if (decision.action !== "write") return;
    expect(decision.merged.date).toBe("2026-07-29");
    expect(decision.merged.steps).toEqual(["PASS new"]);
    expect(decision.merged.host).toBe("linux/x64");
    expect(decision.merged.residualRisk).toBe("fresh risk"); // shared key: new wins
    expect(decision.merged.sharing).toEqual({ claim: "hand-authored" }); // unshared: preserved
  });

  it("the merge never MUTATES its inputs (a reused existing record is spread, not assigned into)", () => {
    const existing = { ...live, sharing: { claim: "hand" } };
    const fresh = { ...live, date: "2026-07-29" };
    const before = JSON.stringify(existing);
    mergeCertificationRecord(existing, fresh, true);
    expect(JSON.stringify(existing)).toBe(before);
  });
});

describe("passCreatedPaths — QA matrices (33-5-18)", () => {
  it("same-length ties order by locale (deterministic cleanup order)", () => {
    const out = passCreatedPaths([], ["cline/user", "cursors/usr", "cline/admin"]);
    // All length 10: locale order; deepest-first only breaks ties by length.
    expect(out).toEqual(["cline/admin", "cline/user", "cursors/usr"].sort((a, b) => b.length - a.length || a.localeCompare(b)));
  });

  it("entries REMOVED between pre and post are ignored (only post-only creations are returned)", () => {
    const pre = ["a/old-file", "a"];
    const post = ["a", "a/new-file"];
    expect(passCreatedPaths(pre, post)).toEqual(["a/new-file"]);
  });

  it("an empty pre lists every post entry deepest-first; near-prefix names stay distinct", () => {
    const out = passCreatedPaths([], ["cline", "cline2", "cline/user", "cline/user/f.bak"]);
    expect(out).toEqual(["cline/user/f.bak", "cline/user", "cline2", "cline"]);
  });

  it("post ⊆ pre yields no cleanup (nothing was created)", () => {
    expect(passCreatedPaths(["a", "a/b"], ["a"])).toEqual([]);
    expect(passCreatedPaths([], [])).toEqual([]);
  });
});
