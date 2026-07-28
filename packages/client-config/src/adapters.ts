/**
 * `@iris-mcp/client-config` — the ClientAdapter registry DATA (Epic 33, Story 33.0).
 *
 * Transcribed from the binding spec's verified 13-client capability table
 * (Feature 3 addendum §3.2; §3.2 is authoritative on conflict). Path minutiae
 * are Confidence Medium-High in the spec and are certified by a live probe
 * per client before release (spec §3.7 — Story 33.4 owns the certification
 * table). Fixing config-surface drift = patching THIS data, never engine
 * code.
 */

import type { ClientAdapter, ClientDisposition } from "./types.js";

/**
 * Registry data stamp — "<spec-date>.<serial>". Bump the serial whenever any
 * adapter record changes; surfaced in `status` output so a drift report
 * always names the data vintage it was computed from (spec §3.7).
 */
export const ADAPTER_DATA_VERSION = "2026-07-28.1";

/** Shared VS Code user-profile roots (per-OS), under which several
 * VS Code-extension clients (Cline, Roo Code) keep their globalStorage. */
const VSCODE_USER_ROOT = {
  win32: "%APPDATA%/Code/User",
  darwin: "~/Library/Application Support/Code/User",
  linux: "~/.config/Code/User",
} as const;

/**
 * The 13 v1 adapters, keyed by id. Order is the spec table's order; every
 * consumer (status matrix, docs, tests) iterates THIS object so counts are
 * mechanical (Rule #51).
 */
export const CLIENT_ADAPTERS: Readonly<Record<string, ClientAdapter>> = {
  "claude-code": {
    id: "claude-code",
    displayName: "Claude Code",
    format: "json",
    rootKey: "mcpServers",
    scopes: [
      {
        scope: "user",
        paths: {
          win32: "~/.claude.json",
          darwin: "~/.claude.json",
          linux: "~/.claude.json",
        },
        shareable: false,
      },
      {
        scope: "project",
        paths: {
          win32: ".mcp.json",
          darwin: ".mcp.json",
          linux: ".mcp.json",
        },
        shareable: true,
      },
    ],
    entryShape: "standard",
    envExpansion: "claude",
    disableSupport: "stash",
    // Writer CLI (spec §3.5 point 6): `claude mcp add-json` is the PREFERRED
    // non-interactive writer for this client; the v1 engine uses direct file
    // edit only (a child-process spawn is out of Story 33.1's scope). The
    // 33.2+ consumers should prefer this CLI where present, file edit as the
    // fallback.
    restartHint:
      "Restart Claude Code (or start a new session) for MCP changes to take effect.",
    detection: [
      { kind: "config", scope: "user" },
      { kind: "config", scope: "project" },
      {
        kind: "appDir",
        paths: { win32: "~/.claude", darwin: "~/.claude", linux: "~/.claude" },
      },
    ],
    docsUrl: "https://code.claude.com/docs/en/mcp",
  },

  "claude-desktop": {
    id: "claude-desktop",
    displayName: "Claude Desktop",
    format: "json",
    rootKey: "mcpServers",
    scopes: [
      {
        scope: "user",
        paths: {
          win32: "%APPDATA%/Claude/claude_desktop_config.json",
          darwin: "~/Library/Application Support/Claude/claude_desktop_config.json",
          linux: "~/.config/Claude/claude_desktop_config.json",
        },
        shareable: false,
      },
    ],
    entryShape: "standard",
    envExpansion: "claude",
    disableSupport: "stash",
    restartHint: "Quit and relaunch Claude Desktop for MCP changes to take effect.",
    detection: [
      { kind: "config", scope: "user" },
      {
        kind: "appDir",
        paths: {
          win32: "%APPDATA%/Claude",
          darwin: "~/Library/Application Support/Claude",
          linux: "~/.config/Claude",
        },
      },
    ],
    docsUrl: "https://modelcontextprotocol.io/quickstart/user",
  },

  cursor: {
    id: "cursor",
    displayName: "Cursor",
    format: "json",
    rootKey: "mcpServers",
    scopes: [
      {
        scope: "user",
        paths: {
          win32: "~/.cursor/mcp.json",
          darwin: "~/.cursor/mcp.json",
          linux: "~/.cursor/mcp.json",
        },
        shareable: false,
      },
      {
        scope: "project",
        paths: {
          win32: ".cursor/mcp.json",
          darwin: ".cursor/mcp.json",
          linux: ".cursor/mcp.json",
        },
        shareable: true,
      },
    ],
    entryShape: "standard",
    envExpansion: "none",
    disableSupport: "stash",
    restartHint:
      "Restart Cursor (or refresh the server from the MCP settings page) for changes to take effect.",
    detection: [
      { kind: "config", scope: "user" },
      { kind: "config", scope: "project" },
      {
        kind: "appDir",
        paths: { win32: "~/.cursor", darwin: "~/.cursor", linux: "~/.cursor" },
      },
    ],
    docsUrl: "https://cursor.com/docs/mcp",
  },

  vscode: {
    id: "vscode",
    displayName: "VS Code (Copilot)",
    format: "jsonc",
    rootKey: "servers",
    scopes: [
      {
        scope: "user",
        paths: {
          win32: `${VSCODE_USER_ROOT.win32}/mcp.json`,
          darwin: `${VSCODE_USER_ROOT.darwin}/mcp.json`,
          linux: `${VSCODE_USER_ROOT.linux}/mcp.json`,
        },
        shareable: false,
      },
      {
        scope: "project",
        paths: {
          win32: ".vscode/mcp.json",
          darwin: ".vscode/mcp.json",
          linux: ".vscode/mcp.json",
        },
        shareable: true,
      },
    ],
    entryShape: "standard",
    envExpansion: "vscode",
    // VS Code's native disable is a UI gesture, not a file flag — the file
    // mechanism is stash (spec table: "native (UI) + stash").
    disableSupport: "stash",
    restartHint:
      "Reload the VS Code window (Developer: Reload Window) or restart the server from the MCP view for changes to take effect.",
    detection: [
      { kind: "config", scope: "user" },
      { kind: "config", scope: "project" },
      {
        kind: "appDir",
        paths: {
          win32: "%APPDATA%/Code",
          darwin: "~/Library/Application Support/Code",
          linux: "~/.config/Code",
        },
      },
    ],
    docsUrl: "https://code.visualstudio.com/docs/agents/reference/mcp-configuration",
  },

  cline: {
    id: "cline",
    displayName: "Cline",
    format: "json",
    rootKey: "mcpServers",
    scopes: [
      {
        scope: "user",
        paths: {
          win32: `${VSCODE_USER_ROOT.win32}/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`,
          darwin: `${VSCODE_USER_ROOT.darwin}/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`,
          linux: `${VSCODE_USER_ROOT.linux}/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`,
        },
        shareable: false,
      },
    ],
    entryShape: "standard",
    envExpansion: "none",
    disableSupport: "native",
    nativeDisableFlag: { key: "disabled", enabledValue: false, disabledValue: true },
    restartHint:
      "Reload the VS Code window (Developer: Reload Window) for Cline to pick up MCP changes.",
    detection: [
      { kind: "config", scope: "user" },
      {
        kind: "appDir",
        paths: {
          win32: `${VSCODE_USER_ROOT.win32}/globalStorage/saoudrizwan.claude-dev`,
          darwin: `${VSCODE_USER_ROOT.darwin}/globalStorage/saoudrizwan.claude-dev`,
          linux: `${VSCODE_USER_ROOT.linux}/globalStorage/saoudrizwan.claude-dev`,
        },
      },
    ],
    docsUrl: "https://docs.cline.bot/mcp/configuring-mcp-servers",
  },

  "roo-code": {
    id: "roo-code",
    displayName: "Roo Code",
    format: "json",
    rootKey: "mcpServers",
    scopes: [
      {
        scope: "user",
        paths: {
          win32: `${VSCODE_USER_ROOT.win32}/globalStorage/rooveterinaryinc.roo-cline/settings/mcp_settings.json`,
          darwin: `${VSCODE_USER_ROOT.darwin}/globalStorage/rooveterinaryinc.roo-cline/settings/mcp_settings.json`,
          linux: `${VSCODE_USER_ROOT.linux}/globalStorage/rooveterinaryinc.roo-cline/settings/mcp_settings.json`,
        },
        shareable: false,
      },
      {
        scope: "project",
        paths: {
          win32: ".roo/mcp.json",
          darwin: ".roo/mcp.json",
          linux: ".roo/mcp.json",
        },
        shareable: true,
      },
    ],
    entryShape: "standard",
    envExpansion: "claude", // claude-style ${VAR} in headers/args (spec §3.2 table)
    disableSupport: "native",
    nativeDisableFlag: { key: "disabled", enabledValue: false, disabledValue: true },
    restartHint:
      "Reload the VS Code window (Developer: Reload Window) for Roo Code to pick up MCP changes.",
    detection: [
      { kind: "config", scope: "user" },
      { kind: "config", scope: "project" },
      {
        kind: "appDir",
        paths: {
          win32: `${VSCODE_USER_ROOT.win32}/globalStorage/rooveterinaryinc.roo-cline`,
          darwin: `${VSCODE_USER_ROOT.darwin}/globalStorage/rooveterinaryinc.roo-cline`,
          linux: `${VSCODE_USER_ROOT.linux}/globalStorage/rooveterinaryinc.roo-cline`,
        },
      },
    ],
    docsUrl: "https://docs.roocode.com/features/mcp/overview",
  },

  windsurf: {
    id: "windsurf",
    displayName: "Windsurf",
    format: "json",
    rootKey: "mcpServers",
    scopes: [
      {
        scope: "user",
        paths: {
          win32: "~/.codeium/windsurf/mcp_config.json",
          darwin: "~/.codeium/windsurf/mcp_config.json",
          linux: "~/.codeium/windsurf/mcp_config.json",
        },
        shareable: false,
      },
    ],
    entryShape: "standard",
    envExpansion: "none",
    disableSupport: "stash",
    restartHint: "Restart Windsurf for MCP changes to take effect.",
    detection: [
      { kind: "config", scope: "user" },
      {
        kind: "appDir",
        paths: { win32: "~/.codeium", darwin: "~/.codeium", linux: "~/.codeium" },
      },
    ],
    docsUrl: "https://docs.windsurf.com/windsurf/cascade/mcp",
  },

  codex: {
    id: "codex",
    displayName: "Codex CLI",
    format: "toml",
    rootKey: "mcp_servers",
    scopes: [
      {
        scope: "user",
        paths: {
          win32: "~/.codex/config.toml",
          darwin: "~/.codex/config.toml",
          linux: "~/.codex/config.toml",
        },
        shareable: false,
      },
      {
        scope: "project",
        paths: {
          win32: ".codex/config.toml",
          darwin: ".codex/config.toml",
          linux: ".codex/config.toml",
        },
        shareable: true,
      },
    ],
    entryShape: "codex-toml",
    envExpansion: "claude", // ${VAR} in args/headers (spec §3.2 table)
    // Native `enabled` flag VERIFIED (Story 33.1 Rule #16 probe, 2026-07-27):
    // no local Codex CLI on the probe machine, so the official docs were the
    // oracle — learn.chatgpt.com/docs/config-file/config-reference (redirected
    // from developers.openai.com/codex/config-reference, itself linked from
    // the repo's docs/config.md) documents `mcp_servers.<id>.enabled`
    // (boolean): "Disable an MCP server without removing its configuration.";
    // learn.chatgpt.com/codex/extend/mcp: "enabled (optional): Set `false` to
    // disable a server without deleting it." Absent key ⇒ enabled (default).
    disableSupport: "native",
    nativeDisableFlag: { key: "enabled", enabledValue: true, disabledValue: false },
    restartHint: "Start a new Codex CLI session for MCP changes to take effect.",
    detection: [
      { kind: "config", scope: "user" },
      { kind: "config", scope: "project" },
      {
        kind: "appDir",
        paths: { win32: "~/.codex", darwin: "~/.codex", linux: "~/.codex" },
      },
    ],
    docsUrl: "https://github.com/openai/codex/blob/main/docs/config.md",
  },

  gemini: {
    id: "gemini",
    displayName: "Gemini CLI",
    format: "json",
    rootKey: "mcpServers",
    scopes: [
      {
        scope: "user",
        paths: {
          win32: "~/.gemini/settings.json",
          darwin: "~/.gemini/settings.json",
          linux: "~/.gemini/settings.json",
        },
        shareable: false,
      },
      {
        scope: "project",
        paths: {
          win32: ".gemini/settings.json",
          darwin: ".gemini/settings.json",
          linux: ".gemini/settings.json",
        },
        shareable: true,
      },
    ],
    entryShape: "standard",
    envExpansion: "shell", // $VAR / ${VAR} shell convention (spec §3.2 table; union extended — see types.ts)
    disableSupport: "stash",
    restartHint: "Start a new Gemini CLI session for MCP changes to take effect.",
    detection: [
      { kind: "config", scope: "user" },
      { kind: "config", scope: "project" },
      {
        kind: "appDir",
        paths: { win32: "~/.gemini", darwin: "~/.gemini", linux: "~/.gemini" },
      },
    ],
    docsUrl: "https://google-gemini.github.io/gemini-cli/docs/tools/mcp-server.html",
  },

  zed: {
    id: "zed",
    displayName: "Zed",
    format: "json",
    rootKey: "context_servers",
    scopes: [
      {
        scope: "user",
        paths: {
          win32: "%APPDATA%/zed/settings.json",
          darwin: "~/.config/zed/settings.json",
          linux: "~/.config/zed/settings.json",
        },
        shareable: false,
      },
      {
        scope: "project",
        paths: {
          win32: ".zed/settings.json",
          darwin: ".zed/settings.json",
          linux: ".zed/settings.json",
        },
        shareable: true,
      },
    ],
    entryShape: "zed",
    envExpansion: "claude",
    disableSupport: "stash",
    restartHint: "Restart Zed (or reopen the agent panel) for MCP changes to take effect.",
    detection: [
      { kind: "config", scope: "user" },
      { kind: "config", scope: "project" },
      {
        kind: "appDir",
        paths: {
          win32: "%APPDATA%/zed",
          darwin: "~/.config/zed",
          linux: "~/.config/zed",
        },
      },
    ],
    docsUrl: "https://zed.dev/docs/ai/mcp",
  },

  goose: {
    id: "goose",
    displayName: "Goose",
    format: "yaml",
    rootKey: "extensions",
    scopes: [
      {
        scope: "user",
        paths: {
          win32: "%APPDATA%/goose/config.yaml",
          darwin: "~/.config/goose/config.yaml",
          linux: "~/.config/goose/config.yaml",
        },
        shareable: false,
      },
    ],
    entryShape: "goose",
    envExpansion: "claude",
    disableSupport: "native",
    nativeDisableFlag: { key: "enabled", enabledValue: true, disabledValue: false },
    restartHint: "Start a new Goose session for MCP changes to take effect.",
    detection: [
      { kind: "config", scope: "user" },
      {
        kind: "appDir",
        paths: {
          win32: "%APPDATA%/goose",
          darwin: "~/.config/goose",
          linux: "~/.config/goose",
        },
      },
    ],
    docsUrl: "https://block.github.io/goose/docs/getting-started/using-extensions",
  },

  kimi: {
    id: "kimi",
    displayName: "Kimi CLI",
    format: "json",
    rootKey: "mcpServers",
    scopes: [
      {
        scope: "user",
        paths: {
          win32: "~/.kimi/mcp.json",
          darwin: "~/.kimi/mcp.json",
          linux: "~/.kimi/mcp.json",
        },
        shareable: false,
      },
      // No project scope in v1: Kimi CLI honors a `--mcp-config-file`
      // override instead of a repo-root convention (spec §3.2 table —
      // documented, not modeled, since it is a per-invocation CLI flag).
    ],
    entryShape: "standard",
    envExpansion: "none",
    disableSupport: "stash",
    // Writer CLI (spec §3.5 point 6): `kimi mcp add` is the PREFERRED
    // non-interactive writer for this client; the v1 engine uses direct file
    // edit only (a child-process spawn is out of Story 33.1's scope). The
    // 33.2+ consumers should prefer this CLI where present, file edit as the
    // fallback.
    restartHint: "Start a new Kimi CLI session for MCP changes to take effect.",
    detection: [
      { kind: "config", scope: "user" },
      {
        kind: "appDir",
        paths: { win32: "~/.kimi", darwin: "~/.kimi", linux: "~/.kimi" },
      },
    ],
    docsUrl: "https://moonshotai.github.io/kimi-cli/",
  },

  "kimi-code": {
    id: "kimi-code",
    displayName: "Kimi Code",
    format: "json",
    rootKey: "mcpServers",
    scopes: [
      {
        scope: "user",
        paths: {
          win32: "~/.kimi-code/mcp.json",
          darwin: "~/.kimi-code/mcp.json",
          linux: "~/.kimi-code/mcp.json",
        },
        shareable: false,
        envOverride: { var: "KIMI_CODE_HOME", pathSuffix: "mcp.json" },
      },
      {
        scope: "project",
        // Official docs (moonshotai.github.io/kimi-code, MCP customization)
        // document exactly ONE project path: `.kimi-code/mcp.json`. The
        // binding spec's Claude-Code-compatible repo-root `.mcp.json`
        // fallback was FALSIFIED by the Story 33.4 live certification probe
        // (2026-07-28, kimi-code 0.29.0): a distinctive WORKING probe server
        // placed in `.mcp.json` (and separately in `.kimi-code/mcp.json`)
        // was NOT loaded in print mode (`mcp__iris-sharing-probe__*` →
        // TOOL-NOT-LOADED, even in a TUI-registered workspace). The fallback
        // was REMOVED (data patch, no engine change): writing a config the
        // client may never read is worse than no fallback. Project-scope
        // loading itself may be TUI-only — residual risk recorded in the
        // certification table.
        paths: {
          win32: ".kimi-code/mcp.json",
          darwin: ".kimi-code/mcp.json",
          linux: ".kimi-code/mcp.json",
        },
        shareable: true,
      },
    ],
    entryShape: "standard",
    envExpansion: "none",
    disableSupport: "stash",
    restartHint: "Restart Kimi Code (or start a new session) for MCP changes to take effect.",
    detection: [
      { kind: "config", scope: "user" },
      { kind: "config", scope: "project" },
      {
        kind: "appDir",
        paths: { win32: "~/.kimi-code", darwin: "~/.kimi-code", linux: "~/.kimi-code" },
      },
    ],
    docsUrl: "https://moonshotai.github.io/kimi-code/",
  },
};

/**
 * Clients considered for v1 and dispositioned OUT of the adapter roster
 * (spec §3.1). Data, not code: 33.3's UI lists these with their rationale.
 */
export const CLIENT_DISPOSITIONS: readonly ClientDisposition[] = [
  {
    id: "pi",
    displayName: "Pi (pi CLI / pi-coding-agent)",
    disposition: "excluded-not-mcp-capable",
    reason:
      "Verified to have no built-in MCP support by design (minimal four-tool core; external tools via bash or TypeScript extensions). Revisit if Pi ships MCP support.",
  },
  {
    id: "jetbrains-junie",
    displayName: "JetBrains AI Assistant / Junie",
    disposition: "roadmap",
    reason:
      "High adoption but config surface not yet verified against official docs; the registry is data-driven, so this is an adapter-data addition + fixture test once verified.",
  },
  {
    id: "kilo-code",
    displayName: "Kilo Code",
    disposition: "roadmap",
    reason:
      "Roo/Cline-lineage fork; likely follows the mcp_settings.json pattern — verify against official docs before adding (never assume).",
  },
];
