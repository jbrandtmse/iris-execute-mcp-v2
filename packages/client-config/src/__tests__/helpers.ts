/**
 * Story 33.0 — shared fixture helpers for the client-config tests.
 *
 * Fixtures are realistic captures of each client's DOCUMENTED config format
 * (Rule #54/#36 — shapes the real clients write, per the binding spec's
 * cited official docs), each carrying at least one foreign third-party
 * entry. The `sandbox-home/` tree is a fake HOME for status/detect tests —
 * never the real HOME.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { applyEdits as applyJsoncEdits, modify as modifyJsonc } from "jsonc-parser";
import { parseDocument as parseYamlDocument } from "yaml";

import type { ClientAdapter } from "../types.js";

export const FIXTURES_DIR = path.join(fileURLToPath(new URL(".", import.meta.url)), "fixtures");

export function fixturePath(...segments: string[]): string {
  return path.join(FIXTURES_DIR, ...segments);
}

export function readFixture(...segments: string[]): string {
  return readFileSync(fixturePath(...segments), "utf8");
}

/**
 * Per-adapter fixture inventory: client id → fixture file holding a
 * realistic config in that client's native format (each with >=1 foreign
 * third-party entry). This is the fixture roster the AC 33.0.2 sweep
 * iterates — adding an adapter means adding its fixture here.
 */
export const ADAPTER_FIXTURES: Readonly<Record<string, string>> = {
  "claude-code": "claude-code/user.json",
  "claude-desktop": "claude-desktop/claude_desktop_config.json",
  cursor: "cursor/mcp.json",
  vscode: "vscode/user.jsonc",
  cline: "cline/cline_mcp_settings.json",
  "roo-code": "roo-code/mcp_settings.json",
  windsurf: "windsurf/mcp_config.json",
  codex: "codex/config.toml",
  gemini: "gemini/settings.json",
  zed: "zed/settings.json",
  goose: "goose/config.yaml",
  kimi: "kimi/mcp.json",
  "kimi-code": "kimi-code/mcp.json",
};

/** Foreign third-party entry names planted across the fixtures. Tests
 * assert these are surfaced as names only and NEVER appear in any
 * pending-edit render (AC 33.0.4). */
export const FOREIGN_ENTRY_NAMES = [
  "github-mcp",
  "filesystem",
  "postgres",
  "microsoft-learn",
  "aws-docs",
  "time",
  "brave-search",
  "context7",
  "deepwiki",
  "linear",
  "developer",
  "fetch",
  "playwright",
] as const;

/** Secret-looking VALUES planted in foreign entries — must never leak onto
 * any status or diff surface (spec §3.5.5). */
export const FOREIGN_SECRET_MARKERS = ["ghp_foreignSecretValue123", "BSA_foreignKeyABC"] as const;

/** The foreign entry name `plantForeignSecrets` adds. */
export const PLANTED_FOREIGN_NAME = "zz-planted-foreign";

/**
 * Story 36.3 code review (ledger 33-5-L3, leg 2): only the claude-code and
 * vscode fixtures actually CARRY a FOREIGN_SECRET_MARKERS value, so every
 * leak sweep over the other adapters' fixtures was vacuous — a value absent
 * from the input can never leak. This plants one extra FOREIGN entry holding
 * EVERY marker into any adapter's config text, in that adapter's own format
 * and under its own root key, so a sweep can iterate markers × fixtures.
 */
export function plantForeignSecrets(adapter: ClientAdapter, content: string): string {
  const env = Object.fromEntries(FOREIGN_SECRET_MARKERS.map((marker, index) => [`PLANTED_${index}`, marker]));
  const entry = { command: "third-party-server", env };
  if (adapter.format === "json" || adapter.format === "jsonc") {
    const edits = modifyJsonc(content, [adapter.rootKey, PLANTED_FOREIGN_NAME], entry, {
      formattingOptions: { insertSpaces: true, tabSize: 2 },
    });
    return applyJsoncEdits(content, edits);
  }
  if (adapter.format === "yaml") {
    const doc = parseYamlDocument(content);
    doc.setIn([adapter.rootKey, PLANTED_FOREIGN_NAME], doc.createNode(entry));
    return doc.toString();
  }
  const envPairs = Object.entries(env)
    .map(([key, value]) => `${key} = "${value}"`)
    .join(", ");
  const body = content.endsWith("\n") || content === "" ? content : `${content}\n`;
  return `${body}\n[${adapter.rootKey}.${PLANTED_FOREIGN_NAME}]\ncommand = "${entry.command}"\nenv = { ${envPairs} }\n`;
}

/**
 * Story 33.1 — an in-memory `WriteFs` for write-engine tests. Returns only
 * shapes the real fs can return (strings, string arrays, booleans — Rule
 * #54): reads of missing files throw ENOENT-shaped Errors like readFileSync,
 * and `listDir` on an unknown directory throws like readdirSync.
 */
import type { WriteFs } from "../write.js";

export class MemFs implements WriteFs {
  readonly files = new Map<string, string>();
  private readonly dirs = new Set<string>(["/"]);

  exists(path: string): boolean {
    return this.files.has(path) || this.dirs.has(path);
  }

  readFile(path: string): string {
    const content = this.files.get(path);
    if (content === undefined) {
      throw new Error(`ENOENT: no such file or directory, open '${path}'`);
    }
    return content;
  }

  writeFile(path: string, content: string): void {
    const parent = path.split("/").slice(0, -1).join("/") || "/";
    if (!this.dirs.has(parent)) {
      throw new Error(`ENOENT: no such file or directory, open '${path}'`);
    }
    this.files.set(path, content);
  }

  mkdir(dir: string): void {
    // Recursive, idempotent — matches mkdirSync(dir, {recursive: true}).
    const segments = dir.split("/").filter((s) => s !== "");
    let current = "";
    for (const segment of segments) {
      current += "/" + segment;
      this.dirs.add(current);
    }
  }

  remove(path: string): void {
    if (!this.files.has(path)) {
      throw new Error(`ENOENT: no such file or directory, rm '${path}'`);
    }
    this.files.delete(path);
  }

  listDir(dir: string): string[] {
    if (!this.dirs.has(dir)) {
      throw new Error(`ENOENT: no such file or directory, scandir '${dir}'`);
    }
    const prefix = dir === "/" ? "/" : dir + "/";
    const names = new Set<string>();
    for (const key of [...this.files.keys(), ...this.dirs]) {
      if (key.startsWith(prefix)) {
        const rest = key.slice(prefix.length);
        const first = rest.split("/")[0];
        if (first !== undefined && first !== "") names.add(first);
      }
    }
    return [...names].sort();
  }

  /** Test convenience: seed a file (creating parent dirs). */
  seed(path: string, content: string): void {
    const parent = path.split("/").slice(0, -1).join("/") || "/";
    this.mkdir(parent);
    this.files.set(path, content);
  }

  /** Test convenience: every path (files and dirs) under a prefix, sorted. */
  pathsUnder(prefix: string): string[] {
    return [...this.files.keys(), ...this.dirs].filter((p) => p.startsWith(prefix)).sort();
  }
}

/** A fixed clock for deterministic backup timestamps. */
export function fixedNow(...tick: number[]): () => Date {
  let i = 0;
  return () => {
    const ms = tick[Math.min(i, tick.length - 1)] ?? 0;
    i++;
    return new Date(Date.UTC(2026, 6, 27, 12, 0, 0, ms));
  };
}
