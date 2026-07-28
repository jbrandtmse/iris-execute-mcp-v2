/**
 * Story 33.1 Task 7 / AC 33.1.1 + AC 33.1.3 — golden-file byte comparisons.
 *
 * For each of the four format/mechanism families (vscode = JSONC stash with
 * comments, cline = JSON native flag, codex = TOML native flag with comments,
 * goose = YAML native flag with comments), the full manager sequence
 *   apply (env-reference synthesis) -> disable -> enable -> remove
 * is re-run against an in-memory fs and EVERY stage's bytes are compared
 * against the committed golden files under fixtures/golden/<family>/.
 *
 * Rule #36 oracle discipline: the goldens were CAPTURED from the real engine
 * (built dist, real fs, tmp HOME) — capture command:
 *   node packages/client-config/tmp-33-1-capture-golden.mjs  (2026-07-27,
 *   script deleted after capture per the disposable-script pattern)
 * — and are NOT trusted on capture alone: this test also asserts the
 * AC 33.1.3 cross-stage byte oracles (stash: disable == initial; all:
 * enable == added, remove == initial), that every stage re-parses with the
 * foreign entry intact, and that the foreign entry's source span is
 * byte-identical across all five stages.
 */

import { describe, it, expect } from "vitest";

import {
  apply,
  disable,
  enable,
  remove,
  synthesizeEntry,
  entryPresence,
  readConfigEntries,
  CLIENT_ADAPTERS,
  type CanonicalServerName,
  type ClientAdapter,
  type EngineHostContext,
} from "../index.js";
import { MemFs, readFixture } from "./helpers.js";

const PROFILE = { host: "iris.example.com", port: 52773, username: "svc", namespace: "PROD", https: true };
const STATE_DIR = "/state";

interface Family {
  client: string;
  server: CanonicalServerName;
  ext: string;
  /** The foreign entry NAME whose entry must survive byte-identical. */
  foreign: string;
  /** A marker string inside the foreign entry. */
  foreignMarker: string;
  /** Verbatim stage-0 lines belonging to the foreign entry (incl. its comment). */
  foreignLines: string[];
  mechanism: "stash" | "native";
}

const FAMILIES: Family[] = [
  {
    client: "vscode",
    server: "iris-ops-mcp",
    ext: "jsonc",
    foreign: "microsoft-learn",
    foreignMarker: "BSA_foreignKeyABC",
    foreignLines: [
      "    // A foreign third-party server (must never be touched).",
      '    "microsoft-learn": {',
      '        "API_KEY": "BSA_foreignKeyABC"',
    ],
    mechanism: "stash",
  },
  {
    client: "cline",
    server: "iris-ops-mcp",
    ext: "json",
    foreign: "aws-docs",
    foreignMarker: "AWS_DOCUMENTATION_PARTITION",
    foreignLines: ['    "aws-docs": {', '        "AWS_DOCUMENTATION_PARTITION": "aws"'],
    mechanism: "native",
  },
  {
    client: "codex",
    server: "iris-ops-mcp",
    ext: "toml",
    foreign: "context7",
    foreignMarker: "@upstash/context7-mcp",
    foreignLines: [
      "# A foreign third-party server (must never be touched).",
      "[mcp_servers.context7]",
      'args = ["-y", "@upstash/context7-mcp"]',
    ],
    mechanism: "native",
  },
  {
    client: "goose",
    server: "iris-interop-mcp",
    ext: "yaml",
    foreign: "developer",
    foreignMarker: "type: builtin",
    foreignLines: ["  # Built-in Goose extension (foreign, must never be touched).", "  developer:", "    type: builtin"],
    mechanism: "native",
  },
];

const USER_PATHS: Record<string, string> = {
  vscode: "/h/.config/Code/User/mcp.json",
  cline: "/h/.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json",
  codex: "/h/.codex/config.toml",
  goose: "/h/.config/goose/config.yaml",
};

function adapterOf(id: string): ClientAdapter {
  const adapter = CLIENT_ADAPTERS[id];
  if (!adapter) throw new Error(`registry missing ${id}`);
  return adapter;
}

function ctx(): EngineHostContext {
  return { platform: "linux", env: {}, homeDir: "/h", stateDir: STATE_DIR };
}

describe("golden round-trips (AC 33.1.1 + AC 33.1.3)", () => {
  for (const family of FAMILIES) {
    it(`${family.client}: apply -> disable -> enable -> remove byte-equals each golden stage`, () => {
      const adapter = adapterOf(family.client);
      const fs = new MemFs();
      const path = USER_PATHS[family.client];
      if (!path) throw new Error("path missing");
      const stage0 = readFixture(`golden/${family.client}/stage-0-initial.${family.ext}`);
      fs.seed(path, stage0);

      const synthesis = synthesizeEntry(family.server, "env-reference", { adapter, profile: PROFILE });
      if (!synthesis.ok) throw new Error(`synthesis failed: ${synthesis.reason}`);
      expect(synthesis.containsSecret).toBe(false);

      const stages: string[] = [stage0];
      const r1 = apply(ctx(), family.client, "user", synthesis.entry, { fs });
      expect(r1.ok, r1.reason ?? "").toBe(true);
      stages.push(fs.readFile(path));
      const r2 = disable(ctx(), family.client, "user", family.server, { fs });
      expect(r2.ok, r2.reason ?? "").toBe(true);
      stages.push(fs.readFile(path));
      const r3 = enable(ctx(), family.client, "user", family.server, { fs });
      expect(r3.ok, r3.reason ?? "").toBe(true);
      stages.push(fs.readFile(path));
      const r4 = remove(ctx(), family.client, "user", family.server, { fs });
      expect(r4.ok, r4.reason ?? "").toBe(true);
      stages.push(fs.readFile(path));

      // (1) The committed goldens: byte-for-byte per stage.
      const names = ["initial", "added", "disabled", "enabled", "removed"];
      stages.forEach((bytes, i) => {
        const golden = readFixture(`golden/${family.client}/stage-${i}-${names[i]}.${family.ext}`);
        expect(bytes, `stage ${i}-${names[i]} differs from the committed golden`).toBe(golden);
      });

      // (2) The AC 33.1.3 cross-stage byte oracles (mechanism-dependent).
      if (family.mechanism === "stash") {
        expect(stages[2], "stash disable must restore the initial bytes").toBe(stage0);
      } else {
        // Native flag: the entry STAYS, present-disabled; nothing else moves.
        expect(stages[2]).not.toBe(stages[1]);
        const parsed = readConfigEntries(adapter, stages[2] ?? "");
        if (!parsed.ok) throw new Error("disabled stage must parse");
        const entry = parsed.entries[family.server];
        if (!entry) throw new Error("entry vanished after a native-flag disable");
        expect(entryPresence(adapter, entry)).toBe("present-disabled");
      }
      expect(stages[3], "enable must restore the applied bytes exactly").toBe(stages[1]);
      expect(stages[4], "remove must restore the initial bytes exactly").toBe(stage0);

      // (3) Every stage re-parses with the foreign entry intact.
      for (const [i, bytes] of stages.entries()) {
        const parsed = readConfigEntries(adapter, bytes ?? "");
        if (!parsed.ok) throw new Error(`stage ${i} must parse`);
        expect(parsed.entries[family.foreign], `stage ${i} lost the foreign entry`).toBeDefined();
        expect(bytes, `stage ${i} lost the foreign marker`).toContain(family.foreignMarker);
      }

      // (4) The foreign entry survives byte-identical: its verbatim stage-0
      // lines appear in every stage, and its PARSED value is deep-equal
      // across all five stages.
      const parsedForeign: unknown[] = [];
      for (const [i, bytes] of stages.entries()) {
        for (const line of family.foreignLines) {
          expect(bytes ?? "", `stage ${i} lost foreign line: ${line}`).toContain(line);
        }
        const parsed = readConfigEntries(adapter, bytes ?? "");
        if (!parsed.ok) throw new Error(`stage ${i} must parse`);
        parsedForeign.push(parsed.entries[family.foreign]);
      }
      for (const [i, foreign] of parsedForeign.entries()) {
        expect(foreign, `stage ${i} changed the foreign entry's value`).toEqual(parsedForeign[0]);
      }
    });
  }

  it("golden fixture inventory covers all four families (mechanical, Rule #51)", () => {
    expect(FAMILIES).toHaveLength(4);
    expect(new Set(FAMILIES.map((f) => f.mechanism))).toEqual(new Set(["stash", "native"]));
    expect(new Set(FAMILIES.map((f) => f.ext))).toEqual(new Set(["jsonc", "json", "toml", "yaml"]));
  });
});

/**
 * 33.2 rework (smoke iteration 2) — the lead smoke caught the canonical
 * goldens' blind spot: every fixture above is already pretty-printed, so
 * jsonc-parser's sibling re-render was invisible. These COMPACT-foreign
 * variants (one per JSON mechanism: vscode stash + cline native-flag) run
 * the same lifecycle with the byte-equal-originals oracle as the assertion —
 * convergence (stage 4 == stage 0, stage 3 == stage 1, foreign lines verbatim
 * in every stage) is self-validating (Rule #49), so no per-stage captured
 * goldens are committed for them.
 */
describe("compact-foreign golden lifecycle (33.2 byte-preservation regression)", () => {
  const COMPACT_FAMILIES = [
    {
      client: "vscode-compact",
      engineClient: "vscode",
      server: "iris-ops-mcp" as const,
      ext: "jsonc",
      path: USER_PATHS.vscode ?? "",
      mechanism: "stash" as const,
      foreignLines: [
        "    // A foreign third-party server (must never be touched).",
        '    "microsoft-learn": { "command": "npx", "args": ["-y", "@microsoft/learn-mcp"], "env": { "API_KEY": "BSA_foreignKeyABC" } }',
      ],
      foreignMarker: "BSA_foreignKeyABC",
    },
    {
      client: "cline-compact",
      engineClient: "cline",
      server: "iris-ops-mcp" as const,
      ext: "json",
      path: USER_PATHS.cline ?? "",
      mechanism: "native" as const,
      foreignLines: [
        '    "aws-docs": { "command": "uvx", "args": ["awslabs.aws-documentation-mcp-server@latest"], "env": { "AWS_DOCUMENTATION_PARTITION": "aws" }, "disabled": false }',
      ],
      foreignMarker: "AWS_DOCUMENTATION_PARTITION",
    },
  ];

  for (const family of COMPACT_FAMILIES) {
    it(`${family.client}: apply -> disable -> enable -> remove keeps compact foreign bytes untouched`, () => {
      const adapter = adapterOf(family.engineClient);
      const fs = new MemFs();
      const stage0 = readFixture(`golden/${family.client}/stage-0-initial.${family.ext}`);
      fs.seed(family.path, stage0);

      const synthesis = synthesizeEntry(family.server, "env-reference", { adapter, profile: PROFILE });
      if (!synthesis.ok) throw new Error(`synthesis failed: ${synthesis.reason}`);

      const stages: string[] = [stage0];
      const r1 = apply(ctx(), family.engineClient, "user", synthesis.entry, { fs });
      expect(r1.ok, r1.reason ?? "").toBe(true);
      stages.push(fs.readFile(family.path));
      const r2 = disable(ctx(), family.engineClient, "user", family.server, { fs });
      expect(r2.ok, r2.reason ?? "").toBe(true);
      stages.push(fs.readFile(family.path));
      const r3 = enable(ctx(), family.engineClient, "user", family.server, { fs });
      expect(r3.ok, r3.reason ?? "").toBe(true);
      stages.push(fs.readFile(family.path));
      const r4 = remove(ctx(), family.engineClient, "user", family.server, { fs });
      expect(r4.ok, r4.reason ?? "").toBe(true);
      stages.push(fs.readFile(family.path));

      // The byte-equal-originals oracles (AC 33.1.1 / AC 33.2.2).
      if (family.mechanism === "stash") {
        expect(stages[2], "stash disable must restore the initial bytes").toBe(stage0);
      }
      expect(stages[3], "enable must restore the applied bytes exactly").toBe(stages[1]);
      expect(stages[4], "remove must restore the initial bytes exactly").toBe(stage0);

      // The compact foreign entry's verbatim lines survive EVERY stage.
      for (const [i, bytes] of stages.entries()) {
        for (const line of family.foreignLines) {
          expect(bytes ?? "", `stage ${i} lost/reformatted the compact foreign line`).toContain(line);
        }
        expect(bytes ?? "", `stage ${i} lost the foreign marker`).toContain(family.foreignMarker);
      }
    });
  }
});
