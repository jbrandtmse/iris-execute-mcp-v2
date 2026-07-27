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
