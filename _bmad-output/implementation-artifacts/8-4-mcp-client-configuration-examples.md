# Story 8.4: MCP Client Configuration Examples

Status: done

## Story

As a user setting up their AI coding assistant,
I want copy-paste configuration snippets for my specific MCP client,
so that I can connect to IRIS MCP v2 without guessing the configuration format.

## Acceptance Criteria

1. **AC1**: A complete JSON configuration snippet is provided for adding each server to Claude Desktop's MCP config.
2. **AC2**: A complete configuration snippet is provided for Claude Code's MCP settings, covering both CLI and VS Code extension configuration.
3. **AC3**: A complete configuration snippet is provided for Cursor's MCP settings.
4. **AC4**: Each config example shows how to configure a single server and how to configure all five.
5. **AC5**: Each example documents the environment variables and how to set them.

## Tasks / Subtasks

- [x] Task 1: Create Claude Desktop config doc (AC: 1, 4, 5)
  - [x] Create `docs/client-config/claude-desktop.md`
  - [x] Single server config snippet (iris-dev-mcp as example)
  - [x] All-five-servers config snippet
  - [x] Env var documentation and how to set them
  - [x] Where to find the config file on each OS

- [x] Task 2: Create Claude Code config doc (AC: 2, 4, 5)
  - [x] Create `docs/client-config/claude-code.md`
  - [x] CLI configuration (`.mcp.json` in project root)
  - [x] VS Code extension configuration
  - [x] Single server and all-five-servers variants
  - [x] Env var documentation

- [x] Task 3: Create Cursor config doc (AC: 3, 4, 5)
  - [x] Create `docs/client-config/cursor.md`
  - [x] Cursor MCP settings location and format
  - [x] Single server and all-five-servers variants
  - [x] Env var documentation

## Dev Notes

### Actual Config Format (from .mcp.json)

The project's own `.mcp.json` shows the working config format for local development:
```json
{
  "iris-dev-mcp": {
    "command": "node",
    "args": ["packages/iris-dev-mcp/dist/index.js"],
    "env": {
      "IRIS_HOST": "localhost",
      "IRIS_PORT": "52773",
      "IRIS_USERNAME": "_SYSTEM",
      "IRIS_PASSWORD": "SYS",
      "IRIS_NAMESPACE": "HSCUSTOM",
      "IRIS_HTTPS": "false"
    }
  }
}
```

For published packages (npm install), the config uses `npx`:
```json
{
  "iris-dev-mcp": {
    "command": "npx",
    "args": ["-y", "@iris-mcp/dev"],
    "env": { ... }
  }
}
```

### Client Config Locations

- **Claude Desktop**: `claude_desktop_config.json`
  - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
  - Windows: `%APPDATA%\Claude\claude_desktop_config.json`
  - Format: `{ "mcpServers": { ... } }`

- **Claude Code**: `.mcp.json` in project root (for project-scoped) or `~/.claude/settings.json` (global)
  - Format: `{ "mcpServers": { ... } }` (same as Claude Desktop)

- **Cursor**: `.cursor/mcp.json` in project root or global settings
  - Format: `{ "mcpServers": { ... } }` (same structure)

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| IRIS_HOST | No | localhost | IRIS hostname or IP |
| IRIS_PORT | No | 52773 | IRIS web port (NOT SuperServer 1972) |
| IRIS_USERNAME | No | _SYSTEM | IRIS username |
| IRIS_PASSWORD | Yes | - | IRIS password |
| IRIS_NAMESPACE | No | USER | Default namespace |
| IRIS_HTTPS | No | false | Use HTTPS |

### Source Files to Create

| What | Path |
|------|------|
| Claude Desktop config | `docs/client-config/claude-desktop.md` |
| Claude Code config | `docs/client-config/claude-code.md` |
| Cursor config | `docs/client-config/cursor.md` |

### Critical Rules

- Use `npx -y @iris-mcp/<name>` for published package configs (not local `node` paths)
- Show both single-server (iris-dev-mcp) and all-five-servers examples
- Never include real passwords — use placeholder `your-password-here`
- Config JSON must be valid and copy-paste ready
- Reference the per-package READMEs from Story 8.2 for tool details
- The `docs/client-config/` directory needs to be created

### Previous Story Intelligence (Story 8.3)

- `docs/` directory was created in Story 8.3 for the migration guide
- Config format examples already exist in root README (Story 8.1) and per-package READMEs (Story 8.2) — maintain consistency

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 8.4]
- [Source: .mcp.json — actual working config]
- [Source: README.md — quick-start config examples]
- [Source: packages/*/README.md — per-package config snippets]

### Review Findings

- [x] [Review][Defer] DRY: Env var table and shell examples duplicated across all 3 client-config docs -- deferred, pre-existing design choice for self-contained docs

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

None required -- documentation-only story with no runtime code.

### Completion Notes List

- Created `docs/client-config/claude-desktop.md` with config file locations (macOS, Windows, Linux), single-server and all-five-servers JSON snippets, env var table, and shell-level env var examples for macOS/Linux/Windows.
- Created `docs/client-config/claude-code.md` covering CLI `.mcp.json` (project-scoped), VS Code extension integration, global `~/.claude/settings.json`, single-server and all-five-servers snippets, env var documentation.
- Created `docs/client-config/cursor.md` covering `.cursor/mcp.json` (project and global), Cursor Settings UI instructions, single-server and all-five-servers snippets, env var documentation.
- All JSON config snippets validated as parseable JSON.
- Used `npx -y @iris-mcp/<name>` format per critical rules; passwords use `your-password-here` placeholder.
- Each doc includes a server swap table, verification instructions, and See Also links to package READMEs and suite README.

### Change Log

- 2026-04-07: Created three client configuration guides (claude-desktop.md, claude-code.md, cursor.md) in docs/client-config/

### File List

- docs/client-config/claude-desktop.md (new)
- docs/client-config/claude-code.md (new)
- docs/client-config/cursor.md (new)
