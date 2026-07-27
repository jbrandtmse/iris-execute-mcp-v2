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
