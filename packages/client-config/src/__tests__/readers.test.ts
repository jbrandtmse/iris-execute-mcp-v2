/**
 * Story 33.0 Task 4 / AC 33.0.2 + AC 33.0.4 — native-format readers.
 *
 * The per-adapter sweep (AC 33.0.2): every adapter's realistic fixture —
 * JSONC comments, TOML tables, YAML — parses in its native format. Malformed
 * fixtures per format family return ok:false across the typed boundary,
 * never an exception (AC 33.0.4).
 */

import { describe, it, expect } from "vitest";

import {
  CLIENT_ADAPTERS,
  CANONICAL_SERVERS,
  diagnoseConfigSurface,
  readConfigEntries,
  type ClientAdapter,
} from "../index.js";
import { ADAPTER_FIXTURES, readFixture, FOREIGN_ENTRY_NAMES } from "./helpers.js";

/** The iris-mcp-owned entry planted in each fixture (at least one per fixture). */
const EXPECTED_OWNED: Readonly<Record<string, string[]>> = {
  "claude-code": ["iris-dev-mcp"],
  "claude-desktop": ["iris-ops-mcp"],
  cursor: ["iris-data-mcp"],
  vscode: ["iris-dev-mcp"],
  cline: ["iris-dev-mcp", "iris-admin-mcp"],
  "roo-code": ["iris-ops-mcp"],
  windsurf: ["iris-interop-mcp"],
  codex: ["iris-dev-mcp"],
  gemini: ["iris-dev-mcp"],
  zed: ["iris-dev-mcp"],
  goose: ["iris-data-mcp", "iris-ops-mcp"],
  kimi: ["iris-mcp-all"],
  "kimi-code": ["iris-dev-mcp"],
};

const EXPECTED_FOREIGN: Readonly<Record<string, string[]>> = {
  "claude-code": ["github-mcp"],
  "claude-desktop": ["filesystem"],
  cursor: ["postgres"],
  vscode: ["microsoft-learn"],
  cline: ["aws-docs"],
  "roo-code": ["time"],
  windsurf: ["brave-search"],
  codex: ["context7"],
  gemini: ["deepwiki"],
  zed: ["linear"],
  goose: ["developer"],
  kimi: ["fetch"],
  "kimi-code": ["playwright"],
};

function adapterOf(id: string): ClientAdapter {
  const adapter = CLIENT_ADAPTERS[id];
  if (!adapter) throw new Error(`registry missing ${id}`);
  return adapter;
}

describe("readConfigEntries — per-adapter native parse sweep (AC 33.0.2)", () => {
  it("fixture inventory covers every registry adapter exactly", () => {
    expect(Object.keys(ADAPTER_FIXTURES).sort()).toEqual(Object.keys(CLIENT_ADAPTERS).sort());
  });

  for (const id of Object.keys(CLIENT_ADAPTERS)) {
    it(`parses the ${id} fixture natively, owned + foreign entries intact`, () => {
      const fixtureRel = ADAPTER_FIXTURES[id];
      if (!fixtureRel) throw new Error(`no fixture for ${id}`);
      const result = readConfigEntries(adapterOf(id), readFixture(fixtureRel));
      expect(result.ok, `${id} fixture must parse`).toBe(true);
      if (!result.ok) return;
      for (const name of EXPECTED_OWNED[id] ?? []) {
        expect(result.entries[name], `${id} owned entry ${name}`).toBeDefined();
        expect(CANONICAL_SERVERS).toContain(name);
      }
      for (const name of EXPECTED_FOREIGN[id] ?? []) {
        expect(result.entries[name], `${id} foreign entry ${name}`).toBeDefined();
        expect(FOREIGN_ENTRY_NAMES).toContain(name);
      }
      // Every surfaced entry is one of the two classified sets — nothing unaccounted.
      const classified = new Set([...(EXPECTED_OWNED[id] ?? []), ...(EXPECTED_FOREIGN[id] ?? [])]);
      for (const name of Object.keys(result.entries)) {
        expect(classified.has(name), `${id} surfaced unclassified entry ${name}`).toBe(true);
      }
    });
  }

  it("VS Code JSONC fixture carries real comments and a trailing comma", () => {
    // If the fixture loses its comments/trailing comma, the JSONC claim of
    // AC 33.0.2 is vacuous — pin them as raw text.
    const raw = readFixture("vscode/user.jsonc");
    expect(raw).toContain("//");
    expect(raw).toMatch(/,\s*\n\s*[}\]]/);
  });
});

describe("readConfigEntries — malformed inputs are ok:false, never exceptions (AC 33.0.4)", () => {
  const cases: Array<[string, string, string]> = [
    ["vscode", "malformed/bad.jsonc", "jsonc"],
    ["codex", "malformed/bad.toml", "toml"],
    ["goose", "malformed/bad.yaml", "yaml"],
  ];
  for (const [adapterId, fixtureRel, family] of cases) {
    it(`${family} malformed fixture yields ok:false with a reason`, () => {
      let result: ReturnType<typeof readConfigEntries> | undefined;
      expect(() => {
        result = readConfigEntries(adapterOf(adapterId), readFixture(fixtureRel));
      }).not.toThrow();
      expect(result?.ok).toBe(false);
      if (result && !result.ok) {
        expect(result.error.length).toBeGreaterThan(0);
      }
    });
  }

  it("a UTF-8 BOM does not make a valid file look malformed", () => {
    const bom = "﻿" + readFixture("claude-code/user.json");
    const result = readConfigEntries(adapterOf("claude-code"), bom);
    expect(result.ok).toBe(true);
  });

  it("empty content is a valid file with zero entries", () => {
    for (const id of ["claude-code", "codex", "goose"]) {
      const result = readConfigEntries(adapterOf(id), "");
      expect(result.ok, id).toBe(true);
      if (result.ok) expect(Object.keys(result.entries)).toHaveLength(0);
    }
  });

  it("a missing root key is zero entries; a wrong-typed root key is ok:false", () => {
    const adapter = adapterOf("claude-code");
    const missing = readConfigEntries(adapter, '{"otherKey": {}}');
    expect(missing.ok).toBe(true);
    if (missing.ok) expect(Object.keys(missing.entries)).toHaveLength(0);
    const wrongType = readConfigEntries(adapter, '{"mcpServers": []}');
    expect(wrongType.ok).toBe(false);
  });

  it("non-object entries under the root key are skipped, not fatal", () => {
    const result = readConfigEntries(adapterOf("claude-code"), '{"mcpServers": {"a": {"command":"x"}, "b": "oops"}}');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.keys(result.entries)).toEqual(["a"]);
    }
  });
});

// ════════════════════════════════════════════════════════════════════
// Story 33.5 Task 1 / AC 33.5.1 (HIGH, lead-probed live 2026-07-28) — parse
// errors carry reason + line:col/code ONLY, never file content. smol-toml's
// codeblock echoes the offending line AND the line above it; yaml's message
// appends the offending line + caret. A secret marker planted on/near the
// offending line must appear NOWHERE in the error text.
// ════════════════════════════════════════════════════════════════════

describe("parse-error sanitization — no source content on the error surface (AC 33.5.1)", () => {
  const SECRET = "SECRETVALUE123_MARKER";

  it("TOML: a secret on the offending line AND the line above it never leaks (lead probe P1)", () => {
    // The exact lead-probed leak shape: the secret sits on the line ABOVE the
    // offending one (smol-toml's codeblock prints both).
    const content = `[mcp_servers.my-server]\napi_key = "${SECRET}"\nbad = = =\n`;
    const read = readConfigEntries(adapterOf("codex"), content);
    expect(read.ok).toBe(false);
    if (!read.ok) {
      expect(read.error).not.toContain(SECRET);
      expect(read.error).not.toContain("api_key");
      expect(read.error).toContain("line"); // reason + line:col only
    }
    const diagnosis = diagnoseConfigSurface(adapterOf("codex"), content);
    expect(diagnosis.status).toBe("syntax-error");
    if (diagnosis.status === "syntax-error") {
      expect(diagnosis.error).not.toContain(SECRET);
      expect(diagnosis.error).not.toContain("api_key");
    }
  });

  it("TOML: a secret ON the offending line itself never leaks", () => {
    const content = `[mcp_servers]\nbad = "${SECRET}\n`;
    const read = readConfigEntries(adapterOf("codex"), content);
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.error).not.toContain(SECRET);
  });

  it("YAML: a secret on the offending line never leaks (message carries line + caret in the raw library error)", () => {
    const content = `extensions:\n  my-server:\n    api_key: "${SECRET}"\n  bad: [ unclosed\n`;
    const read = readConfigEntries(adapterOf("goose"), content);
    expect(read.ok).toBe(false);
    if (!read.ok) {
      expect(read.error).not.toContain(SECRET);
      expect(read.error).not.toContain("unclosed");
      expect(read.error).toContain("line");
    }
    const diagnosis = diagnoseConfigSurface(adapterOf("goose"), content);
    expect(diagnosis.status).toBe("syntax-error");
    if (diagnosis.status === "syntax-error") {
      expect(diagnosis.error).not.toContain(SECRET);
      expect(diagnosis.error).not.toContain("unclosed");
    }
  });

  it("YAML: an offending TOKEN quoted in the library reason is stripped (Unexpected ... token: \"...\")", () => {
    // yaml quotes one offending scalar token in the reason's first line —
    // that token is file content and must not survive sanitization.
    const content = `- a\n: ${SECRET}\n`;
    const read = readConfigEntries(adapterOf("goose"), content);
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.error).not.toContain(SECRET);
  });

  it("JSONC: the already-disciplined error stays content-free (marker on the offending line)", () => {
    const content = `{"mcpServers": {"a": "${SECRET}"} bad}\n`;
    const read = readConfigEntries(adapterOf("claude-code"), content);
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.error).not.toContain(SECRET);
  });

  it("YAML: an unresolved ALIAS name is file content too — the materialization throw strips the unquoted tail (33.5 review)", () => {
    // doc.toJS() throws `Unresolved alias (...): <name>` OUTSIDE the errors
    // array — sanitizeThrownError's quoted-token strip never matched the
    // unquoted alias name, leaking it (probe 2026-07-28, yaml 2.9.0).
    const content = `extensions:\n  my-server: *${SECRET}\n`;
    const read = readConfigEntries(adapterOf("goose"), content);
    expect(read.ok).toBe(false);
    if (!read.ok) {
      expect(read.error).not.toContain(SECRET);
      expect(read.error).toContain("Unresolved alias"); // the generic reason survives
    }
    const diagnosis = diagnoseConfigSurface(adapterOf("goose"), content);
    expect(diagnosis.status).toBe("syntax-error");
    if (diagnosis.status === "syntax-error") expect(diagnosis.error).not.toContain(SECRET);
  });
});

// ════════════════════════════════════════════════════════════════════
// Story 33.5 / AC 33.5.4 — comment-only JSONC is a VALID empty document;
// a TOML datetime literal is NOT a table (isPlainObject rejects class
// instances); a foreign entry named __proto__ is surfaced (33-5-11).
// ════════════════════════════════════════════════════════════════════

describe("shape-guard and empty-document edge cases (AC 33.5.4, AC 33.5.7)", () => {
  it("a comment-only JSONC file is a valid empty document (VS Code accepts it), not unparseable", () => {
    for (const content of ["// just a comment\n", "/* block only */", "// a\n// b\n"]) {
      const read = readConfigEntries(adapterOf("vscode"), content);
      expect(read.ok, JSON.stringify(content)).toBe(true);
      if (read.ok) expect(Object.keys(read.entries)).toHaveLength(0);
      expect(diagnoseConfigSurface(adapterOf("vscode"), content).status).toBe("empty");
    }
  });

  it("a real syntax error WITH tokens is still a syntax error (the comment-only carve-out is narrow)", () => {
    const read = readConfigEntries(adapterOf("vscode"), `// note\n{"mcpServers": ,}\n`);
    expect(read.ok).toBe(false);
  });

  it("a TOML datetime at the root key defeats neither the drift guard nor the reader (TomlDate is not a table)", () => {
    const content = "mcp_servers = 2026-07-28T10:00:00Z\n";
    const read = readConfigEntries(adapterOf("codex"), content);
    expect(read.ok).toBe(false); // wrong-shaped root key, not "zero entries"
    const diagnosis = diagnoseConfigSurface(adapterOf("codex"), content);
    expect(diagnosis.status).toBe("root-wrong-shape");
    if (diagnosis.status === "root-wrong-shape") {
      expect(diagnosis.found).toBe("a object"); // type name only — never the datetime's fields
    }
  });

  it("a TOML datetime VALUE inside the root table is skipped as an entry, not classified as one", () => {
    const content = '[mcp_servers]\nnot-a-server = 2026-07-28T10:00:00Z\n';
    const read = readConfigEntries(adapterOf("codex"), content);
    expect(read.ok).toBe(true);
    if (read.ok) expect(Object.keys(read.entries)).toHaveLength(0);
  });

  it("a foreign entry literally named __proto__ is surfaced as an own key (33-5-11)", () => {
    const content = '{"mcpServers": {"__proto__": {"command": "x"}, "iris-dev-mcp": {"command": "y"}}}';
    const read = readConfigEntries(adapterOf("claude-code"), content);
    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(Object.keys(read.entries).sort()).toEqual(["__proto__", "iris-dev-mcp"]);
      expect(Object.prototype.hasOwnProperty.call(read.entries, "__proto__")).toBe(true);
    }
  });

  it("a TOML array-of-tables entry is surfaced as unsupported (33-5-12), never invisible", () => {
    const content = '[[mcp_servers.iris-dev-mcp]]\ncommand = "x"\n';
    const read = readConfigEntries(adapterOf("codex"), content);
    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(Object.keys(read.entries)).toHaveLength(0);
      expect(read.unsupported["iris-dev-mcp"]).toBe("array-of-tables");
    }
  });
});

// ════════════════════════════════════════════════════════════════════
// Story 33.4 Task 1 / AC 33.4.2 — diagnoseConfigSurface (the drift
// guard's finer classification; shares ONE parse path with the reader).
// ════════════════════════════════════════════════════════════════════

describe("diagnoseConfigSurface — the config-drift classification (AC 33.4.2)", () => {
  it("wrong-shaped root keys are root-wrong-shape across ALL FOUR format families", () => {
    const cases: Array<[string, string, string, string]> = [
      // [adapterId, fixture, expected-fragment, found]
      ["claude-code", "drift/wrong-shape.json", 'root key "mcpServers" holding an object of server entries', "an array (3 item(s))"],
      ["vscode", "drift/wrong-shape.jsonc", 'root key "servers" holding an object of server entries', "an array (3 item(s))"],
      ["codex", "drift/wrong-shape.toml", 'root key "mcp_servers" holding a table of server entries', "a string"],
      ["goose", "drift/wrong-shape.yaml", 'root key "extensions" holding a mapping of server entries', "an array (2 item(s))"],
    ];
    for (const [adapterId, fixtureRel, expected, found] of cases) {
      const diagnosis = diagnoseConfigSurface(adapterOf(adapterId), readFixture(fixtureRel));
      expect(diagnosis.status, `${adapterId} must diagnose root-wrong-shape`).toBe("root-wrong-shape");
      if (diagnosis.status === "root-wrong-shape") {
        expect(diagnosis.expected, adapterId).toBe(expected);
        expect(diagnosis.found, adapterId).toBe(found);
      }
    }
  });

  it("a parseable file whose top level is not an object is top-not-object (every expectation fails)", () => {
    const diagnosis = diagnoseConfigSurface(adapterOf("claude-code"), readFixture("drift/top-array.json"));
    expect(diagnosis.status).toBe("top-not-object");
    if (diagnosis.status === "top-not-object") {
      expect(diagnosis.expected).toBe('a top-level object holding root key "mcpServers"');
      expect(diagnosis.found).toBe("an array (3 item(s))");
    }
  });

  it("an absent root key with other content is root-absent — NOT drift (a normal no-MCP-section config)", () => {
    const diagnosis = diagnoseConfigSurface(adapterOf("claude-code"), readFixture("drift/no-mcp-section.json"));
    expect(diagnosis.status).toBe("root-absent");
  });

  it("a correct-shape root key is root-ok; every adapter's realistic fixture diagnoses root-ok", () => {
    for (const id of Object.keys(CLIENT_ADAPTERS)) {
      const fixtureRel = ADAPTER_FIXTURES[id];
      if (!fixtureRel) throw new Error(`no fixture for ${id}`);
      const diagnosis = diagnoseConfigSurface(adapterOf(id), readFixture(fixtureRel));
      expect(diagnosis.status, `${id} fixture must diagnose root-ok`).toBe("root-ok");
    }
  });

  it("empty/whitespace content is empty — never a finding", () => {
    for (const id of ["claude-code", "codex", "goose"]) {
      expect(diagnoseConfigSurface(adapterOf(id), "").status, id).toBe("empty");
      expect(diagnoseConfigSurface(adapterOf(id), "  \n ").status, id).toBe("empty");
    }
  });

  it("syntax errors stay syntax-error (the parseability finding's territory, never drift)", () => {
    const cases: Array<[string, string]> = [
      ["vscode", "malformed/bad.jsonc"],
      ["codex", "malformed/bad.toml"],
      ["goose", "malformed/bad.yaml"],
    ];
    for (const [adapterId, fixtureRel] of cases) {
      const diagnosis = diagnoseConfigSurface(adapterOf(adapterId), readFixture(fixtureRel));
      expect(diagnosis.status, adapterId).toBe("syntax-error");
      if (diagnosis.status === "syntax-error") {
        expect(diagnosis.error.length).toBeGreaterThan(0);
      }
    }
  });

  it("the reader and the diagnoser agree: readConfigEntries ok ⇔ diagnosis not (syntax-error|top-not-object|root-wrong-shape)", () => {
    // The single-parse-path invariant, probed across one fixture per class.
    const probes: Array<[string, string]> = [
      ["claude-code", "claude-code/user.json"],
      ["claude-code", "drift/wrong-shape.json"],
      ["claude-code", "drift/top-array.json"],
      ["claude-code", "drift/no-mcp-section.json"],
      ["vscode", "malformed/bad.jsonc"],
      ["codex", "drift/wrong-shape.toml"],
      ["goose", "drift/wrong-shape.yaml"],
    ];
    for (const [adapterId, fixtureRel] of probes) {
      const adapter = adapterOf(adapterId);
      const content = readFixture(fixtureRel);
      const read = readConfigEntries(adapter, content);
      const diagnosis = diagnoseConfigSurface(adapter, content);
      const diagnosisBad =
        diagnosis.status === "syntax-error" ||
        diagnosis.status === "top-not-object" ||
        diagnosis.status === "root-wrong-shape";
      expect(read.ok === !diagnosisBad, `${adapterId}/${fixtureRel}`).toBe(true);
    }
  });
});
