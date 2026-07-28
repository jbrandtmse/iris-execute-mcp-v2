/**
 * Story 33.2 (rework, smoke iteration 2) — byte-preservation regression pins
 * for the lead-smoke HIGH: `apply` (any JSON/JSONC insert — and therefore
 * stash `enable` re-inserts, `ensureInputs` merges, and absent-flag inserts)
 * reformatted FOREIGN entries because jsonc-parser's `modify()` re-renders
 * every sibling of an inserted property with the hardcoded
 * `{ tabSize: 2, eol: "\n" }` formatting options (diff.ts pre-fix).
 *
 * The fix is the surgical hand-rolled `insertionEdits`/`replacementEdits`
 * (the `removalEdits` discipline): an edit span provably touches nothing but
 * the owned key, rendered in the FILE's detected indent unit and EOL.
 *
 * These fixtures are deliberately NON-canonical — compact single-line
 * foreign entries, 4-space indentation, CRLF line endings — the shapes the
 * canonical pre-fix suite was blind to. The oracle is byte-level: exact
 * foreign lines survive every operation, and remove/stash-disable restores
 * the original bytes exactly (AC 33.1.1 + AC 33.2.2).
 */

import { describe, it, expect } from "vitest";

import {
  apply,
  disable,
  enable,
  remove,
  ensureInputs,
  diff,
  executeNativeEdit,
  readConfigEntries,
  synthesizeEntry,
  CLIENT_ADAPTERS,
  type ClientAdapter,
  type EngineHostContext,
  type JsoncNativeEdit,
} from "../index.js";
import { MemFs } from "./helpers.js";

const PROFILE = { host: "iris.example.com", port: 52773, username: "svc", namespace: "PROD", https: true };

function ctx(): EngineHostContext {
  return { platform: "linux", env: {}, homeDir: "/h", stateDir: "/state" };
}

function adapterOf(id: string): ClientAdapter {
  const adapter = CLIENT_ADAPTERS[id];
  if (!adapter) throw new Error(`registry missing ${id}`);
  return adapter;
}

const CLAUDE_CODE_PATH = "/h/.claude.json";
const CLINE_PATH = "/h/.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json";
const VSCODE_PATH = "/h/.config/Code/User/mcp.json";

/** The lead's repro fixture: a compact single-line foreign entry. */
const COMPACT_FOREIGN_LINE = `    "third-party-tool": { "command": "x", "env": { "API_KEY": "shh" } }`;
const COMPACT = `{\n  "mcpServers": {\n${COMPACT_FOREIGN_LINE}\n  }\n}\n`;

const FOUR_SPACE_FOREIGN_LINES = [
  `            "command": "x",`,
  `            "env": { "API_KEY": "shh" }`,
];
const FOUR_SPACE = `{\n    "mcpServers": {\n        "third-party-tool": {\n${FOUR_SPACE_FOREIGN_LINES.join("\n")}\n        }\n    }\n}\n`;

const CRLF_FOREIGN_LINE = `    "third-party-tool": { "command": "x", "env": { "API_KEY": "shh" } }`;
const CRLF = `{\r\n  "mcpServers": {\r\n${CRLF_FOREIGN_LINE}\r\n  }\r\n}\r\n`;

/** Every stage-0 line survives verbatim (the strongest foreign-span pin). */
function expectLinesVerbatim(bytes: string, lines: string[], stage: string): void {
  for (const line of lines) {
    expect(bytes, `${stage} lost/reformatted foreign line: ${JSON.stringify(line)}`).toContain(line);
  }
}

/** No bare LF was introduced (a CRLF file stays purely CRLF). */
function expectNoBareLf(bytes: string, stage: string): void {
  const bareLf = bytes.match(/(?<!\r)\n/g) ?? [];
  expect(bareLf.length, `${stage} introduced ${bareLf.length} bare LF(s) into a CRLF file`).toBe(0);
}

interface StashFixture {
  label: string;
  content: string;
  foreignLines: string[];
  crlf?: boolean;
  fourSpace?: boolean;
}

const STASH_FIXTURES: StashFixture[] = [
  { label: "compact single-line foreign entry", content: COMPACT, foreignLines: [COMPACT_FOREIGN_LINE] },
  { label: "4-space-indented file", content: FOUR_SPACE, foreignLines: FOUR_SPACE_FOREIGN_LINES, fourSpace: true },
  { label: "CRLF file", content: CRLF, foreignLines: [CRLF_FOREIGN_LINE], crlf: true },
];

describe("stash-client lifecycle leaves foreign bytes untouched (apply/disable/enable/remove)", () => {
  for (const fixture of STASH_FIXTURES) {
    it(`${fixture.label}: apply -> disable -> enable -> remove, byte oracles at every stage`, () => {
      const fs = new MemFs();
      fs.seed(CLAUDE_CODE_PATH, fixture.content);
      const synthesis = synthesizeEntry("iris-dev-mcp", "env-reference", {
        adapter: adapterOf("claude-code"),
        profile: PROFILE,
      });
      if (!synthesis.ok) throw new Error(`synthesis failed: ${synthesis.reason}`);

      const r1 = apply(ctx(), "claude-code", "user", synthesis.entry, { fs });
      expect(r1.ok, r1.reason ?? "").toBe(true);
      const applied = fs.readFile(CLAUDE_CODE_PATH);
      expectLinesVerbatim(applied, fixture.foreignLines, "apply");
      if (fixture.crlf) expectNoBareLf(applied, "apply");
      if (fixture.fourSpace) {
        // The inserted entry respects the file's 4-space unit: entry key at
        // depth 2 (8 spaces) AND its members at depth 3 (12 spaces) — the
        // pre-fix jsonc-parser modify() rendered members at its hardcoded
        // 2-space unit (10 spaces) even when the key landed correctly.
        expect(applied, "apply inserted with a foreign indent unit").toContain(`\n        "iris-dev-mcp": {`);
        expect(applied, "apply rendered members at the hardcoded 2-space unit").toContain(`\n            "command": "npx"`);
        expect(applied, "apply inserted 2-space formatting into a 4-space file").not.toContain(`\n          "command": "npx"`);
      }
      const parsed = readConfigEntries(adapterOf("claude-code"), applied);
      expect(parsed.ok && parsed.entries["iris-dev-mcp"] !== undefined, "apply did not land the owned entry").toBe(true);

      // Stash disable removes the entry — the file returns to the original bytes.
      const r2 = disable(ctx(), "claude-code", "user", "iris-dev-mcp", { fs });
      expect(r2.ok, r2.reason ?? "").toBe(true);
      expect(fs.readFile(CLAUDE_CODE_PATH), "stash disable must restore the original bytes").toBe(fixture.content);

      // Enable re-inserts from the stash (the lead-smoke path) — byte-equal to the apply.
      const r3 = enable(ctx(), "claude-code", "user", "iris-dev-mcp", { fs });
      expect(r3.ok, r3.reason ?? "").toBe(true);
      expect(fs.readFile(CLAUDE_CODE_PATH), "stash enable must restore the applied bytes").toBe(applied);

      const r4 = remove(ctx(), "claude-code", "user", "iris-dev-mcp", { fs });
      expect(r4.ok, r4.reason ?? "").toBe(true);
      expect(fs.readFile(CLAUDE_CODE_PATH), "remove must restore the original bytes").toBe(fixture.content);
    });

    it(`${fixture.label}: apply twice (the update path) leaves foreign bytes untouched`, () => {
      const fs = new MemFs();
      fs.seed(CLAUDE_CODE_PATH, fixture.content);
      const synthesis = synthesizeEntry("iris-dev-mcp", "env-reference", {
        adapter: adapterOf("claude-code"),
        profile: PROFILE,
      });
      if (!synthesis.ok) throw new Error(`synthesis failed: ${synthesis.reason}`);
      expect(apply(ctx(), "claude-code", "user", synthesis.entry, { fs }).ok).toBe(true);
      const updated = synthesizeEntry("iris-dev-mcp", "env-reference", {
        adapter: adapterOf("claude-code"),
        profile: { ...PROFILE, namespace: "OTHER" },
      });
      if (!updated.ok) throw new Error(`synthesis failed: ${updated.reason}`);
      const r = apply(ctx(), "claude-code", "user", updated.entry, { fs });
      expect(r.ok, r.reason ?? "").toBe(true);
      const bytes = fs.readFile(CLAUDE_CODE_PATH);
      expectLinesVerbatim(bytes, fixture.foreignLines, "update");
      if (fixture.crlf) expectNoBareLf(bytes, "update");
      expect(bytes).toContain("OTHER");
    });
  }
});

describe("native-flag client (cline) flag toggles leave foreign bytes untouched", () => {
  const CLINE_COMPACT = `{\n  "mcpServers": {\n    "third-party-tool": { "command": "x" },\n    "iris-dev-mcp": { "command": "node", "args": ["x"], "disabled": false }\n  }\n}\n`;
  const CLINE_FOREIGN_LINE = `    "third-party-tool": { "command": "x" },`;

  it("disable/enable replace only the flag scalar; foreign line verbatim; enable restores the original bytes", () => {
    const fs = new MemFs();
    fs.seed(CLINE_PATH, CLINE_COMPACT);
    const r1 = disable(ctx(), "cline", "user", "iris-dev-mcp", { fs });
    expect(r1.ok, r1.reason ?? "").toBe(true);
    const disabled = fs.readFile(CLINE_PATH);
    expectLinesVerbatim(disabled, [CLINE_FOREIGN_LINE], "disable");
    expect(disabled).toContain(`"disabled": true`);
    const r2 = enable(ctx(), "cline", "user", "iris-dev-mcp", { fs });
    expect(r2.ok, r2.reason ?? "").toBe(true);
    expect(fs.readFile(CLINE_PATH), "enable must restore the pre-disable bytes").toBe(CLINE_COMPACT);
  });

  it("disable with the flag ABSENT inserts it into the compact owned entry without reformatting it", () => {
    const flagless = `{\n  "mcpServers": {\n    "third-party-tool": { "command": "x" },\n    "iris-dev-mcp": { "command": "node", "args": ["x"] }\n  }\n}\n`;
    const fs = new MemFs();
    fs.seed(CLINE_PATH, flagless);
    const r = disable(ctx(), "cline", "user", "iris-dev-mcp", { fs });
    expect(r.ok, r.reason ?? "").toBe(true);
    const bytes = fs.readFile(CLINE_PATH);
    expectLinesVerbatim(bytes, [CLINE_FOREIGN_LINE], "flag insert");
    // The compact owned entry keeps its single-line shape with the flag appended inline.
    expect(bytes).toContain(`    "iris-dev-mcp": { "command": "node", "args": ["x"], "disabled": true }`);
    // And the enable toggle back is the scalar replace (no structural churn).
    const r2 = enable(ctx(), "cline", "user", "iris-dev-mcp", { fs });
    expect(r2.ok, r2.reason ?? "").toBe(true);
    expect(fs.readFile(CLINE_PATH)).toContain(`    "iris-dev-mcp": { "command": "node", "args": ["x"], "disabled": false }`);
  });

  it("CRLF flag toggle: no bare LF introduced, foreign line verbatim", () => {
    const content = `{\r\n  "mcpServers": {\r\n    "third-party-tool": { "command": "x" },\r\n    "iris-dev-mcp": { "command": "node", "args": ["x"], "disabled": false }\r\n  }\r\n}\r\n`;
    const fs = new MemFs();
    fs.seed(CLINE_PATH, content);
    const r1 = disable(ctx(), "cline", "user", "iris-dev-mcp", { fs });
    expect(r1.ok, r1.reason ?? "").toBe(true);
    const disabled = fs.readFile(CLINE_PATH);
    expectNoBareLf(disabled, "CRLF disable");
    expectLinesVerbatim(disabled, [`    "third-party-tool": { "command": "x" },\r`], "CRLF disable");
    const r2 = enable(ctx(), "cline", "user", "iris-dev-mcp", { fs });
    expect(r2.ok, r2.reason ?? "").toBe(true);
    expect(fs.readFile(CLINE_PATH), "CRLF enable must restore the original bytes").toBe(content);
  });
});

describe("diff-level surgical insert mechanics", () => {
  const adapter = adapterOf("claude-code");
  const entry = { name: "iris-dev-mcp" as const, command: "node", args: ["x"] };

  function applyDiff(content: string) {
    const result = diff(content, entry, adapter, "user", "apply");
    if (!result.ok) throw new Error(`diff refused: ${result.reason}`);
    return executeNativeEdit(content, result.native);
  }

  it("rootKey absent: the foreign top-level sibling stays compact and byte-untouched", () => {
    const content = `{\n  "otherKey": { "a": 1 }\n}\n`;
    const after = applyDiff(content);
    expect(after).toContain(`  "otherKey": { "a": 1 }`);
    expect(after).toContain(`  "mcpServers": {`);
    const parsed = readConfigEntries(adapter, after);
    expect(parsed.ok && parsed.entries["iris-dev-mcp"] !== undefined).toBe(true);
  });

  it("empty inline rootKey object expands at the file's indent", () => {
    const content = `{\n  "mcpServers": {},\n  "otherKey": { "a": 1 }\n}\n`;
    const after = applyDiff(content);
    expect(after).toContain(`  "otherKey": { "a": 1 }`);
    expect(after).toContain(`    "iris-dev-mcp": {`);
    const parsed = readConfigEntries(adapter, after);
    expect(parsed.ok && parsed.entries["iris-dev-mcp"] !== undefined).toBe(true);
  });

  it("single-line container stays single-line (compact inline insert)", () => {
    const content = `{ "mcpServers": { "third-party-tool": { "command": "x" } } }\n`;
    const after = applyDiff(content);
    expect(after.startsWith(`{ "mcpServers": { "third-party-tool": { "command": "x" }, "iris-dev-mcp": `)).toBe(true);
    expect(after.endsWith(` } }\n`)).toBe(true);
    const parsed = readConfigEntries(adapter, after);
    expect(parsed.ok && parsed.entries["iris-dev-mcp"] !== undefined).toBe(true);
  });

  it("trailing-comma-styled JSONC: the insert carries the style's trailing comma; add -> remove is a byte-exact inverse", () => {
    const content = `{\n  "mcpServers": {\n    "third-party-tool": { "command": "x" },\n  },\n}\n`;
    const after = applyDiff(content);
    expect(after).toContain(`    "third-party-tool": { "command": "x" },`);
    const removed = executeNativeEdit(after, (() => {
      const r = diff(after, entry, adapter, "user", "remove");
      if (!r.ok) throw new Error(`remove refused: ${r.reason}`);
      return r.native;
    })());
    expect(removed, "add -> remove must be byte-exact in trailing-comma style").toBe(content);
  });

  it("a same-line comment after the last child is preserved; the comma never lands inside the comment", () => {
    const content = `{\n  "mcpServers": {\n    "third-party-tool": { "command": "x" } // keep this note\n  }\n}\n`;
    const after = applyDiff(content);
    // The separating comma attaches directly to the last VALUE (before the
    // comment) — never inside the comment text, which would uncomment the
    // separator and corrupt the document.
    expect(after).toContain(`    "third-party-tool": { "command": "x" }, // keep this note`);
    const parsed = readConfigEntries(adapter, after);
    expect(parsed.ok, "the result must parse (the comma did not land inside the comment)").toBe(true);
    if (parsed.ok) {
      expect(parsed.entries["iris-dev-mcp"]).toBeDefined();
      expect(parsed.entries["third-party-tool"]).toBeDefined();
    }
  });

  it("the edit SPAN itself contains no foreign text (AC 33.0.4 on the edit surface)", () => {
    const result = diff(COMPACT, entry, adapter, "user", "apply");
    if (!result.ok) throw new Error(`diff refused: ${result.reason}`);
    const native = result.native as JsoncNativeEdit;
    for (const edit of native.edits) {
      expect(edit.content).not.toContain("third-party-tool");
      expect(edit.content).not.toContain("shh");
      // Pure insertions: nothing existing is spanned.
      expect(edit.length, "an insert must not span existing bytes").toBe(0);
    }
  });

  it("missing file (empty content) creates the canonical 2-space document", () => {
    const after = applyDiff("");
    expect(after).toBe(
      JSON.stringify({ mcpServers: { "iris-dev-mcp": { command: "node", args: ["x"] } } }, null, 2),
    );
  });
});

describe("ensureInputs leaves foreign JSON bytes untouched (the 33.2 vscode-inputs seam)", () => {
  const DESCRIPTOR = { id: "iris-password", type: "promptString" as const, description: "IRIS password", password: true };

  it("compact foreign server + compact existing input descriptor survive the merge verbatim", () => {
    const content = `{\n  "servers": {\n    "third-party-tool": { "command": "x", "env": { "API_KEY": "shh" } }\n  },\n  "inputs": [{ "id": "existing", "type": "promptString", "description": "keep me compact", "password": false }]\n}\n`;
    const fs = new MemFs();
    fs.seed(VSCODE_PATH, content);
    const result = ensureInputs(ctx(), "vscode", "user", [DESCRIPTOR], { fs });
    expect(result.ok, !result.ok ? result.reason : "").toBe(true);
    const bytes = fs.readFile(VSCODE_PATH);
    expect(bytes).toContain(`    "third-party-tool": { "command": "x", "env": { "API_KEY": "shh" } }`);
    expect(bytes).toContain(`{ "id": "existing", "type": "promptString", "description": "keep me compact", "password": false }`);
    const parsed = JSON.parse(bytes) as { inputs: Array<{ id: string }> };
    expect(parsed.inputs.map((input) => input.id)).toEqual(["existing", "iris-password"]);
  });

  it("CRLF file: the appended descriptor uses CRLF; no bare LF introduced", () => {
    const content = `{\r\n  "servers": {\r\n    "third-party-tool": { "command": "x" }\r\n  },\r\n  "inputs": [\r\n    { "id": "existing", "type": "promptString", "description": "d", "password": false }\r\n  ]\r\n}\r\n`;
    const fs = new MemFs();
    fs.seed(VSCODE_PATH, content);
    const result = ensureInputs(ctx(), "vscode", "user", [DESCRIPTOR], { fs });
    expect(result.ok).toBe(true);
    const bytes = fs.readFile(VSCODE_PATH);
    expectNoBareLf(bytes, "ensureInputs");
    expect(bytes).toContain(`    { "id": "existing", "type": "promptString", "description": "d", "password": false }`);
    expect(bytes).toContain(`"id": "iris-password"`);
  });

  it("4-space file: the appended descriptor lands at the file's indent unit", () => {
    const content = `{\n    "servers": {\n        "third-party-tool": {\n            "command": "x"\n        }\n    },\n    "inputs": [\n        {\n            "id": "existing",\n            "type": "promptString",\n            "description": "d",\n            "password": false\n        }\n    ]\n}\n`;
    const fs = new MemFs();
    fs.seed(VSCODE_PATH, content);
    const result = ensureInputs(ctx(), "vscode", "user", [DESCRIPTOR], { fs });
    expect(result.ok).toBe(true);
    const bytes = fs.readFile(VSCODE_PATH);
    // The new descriptor opens at 8 spaces with 12-space members — never 2/4.
    expect(bytes).toContain(`\n        {\n            "id": "iris-password",`);
    expect(bytes).not.toContain(`\n    {\n      "id": "iris-password"`);
  });

  it("inputs key absent: created at top level with foreign siblings untouched", () => {
    const content = `{\n  "servers": {\n    "third-party-tool": { "command": "x" }\n  }\n}\n`;
    const fs = new MemFs();
    fs.seed(VSCODE_PATH, content);
    const result = ensureInputs(ctx(), "vscode", "user", [DESCRIPTOR], { fs });
    expect(result.ok).toBe(true);
    const bytes = fs.readFile(VSCODE_PATH);
    expect(bytes).toContain(`    "third-party-tool": { "command": "x" }`);
    const parsed = JSON.parse(bytes) as { inputs: Array<{ id: string }> };
    expect(parsed.inputs.map((input) => input.id)).toEqual(["iris-password"]);
  });
});
