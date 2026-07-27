# @iris-mcp/client-config

Multi-client MCP configuration manager for the iris-mcp suite (Epic 33 / FR141).

**Status: read-only foundation (Story 33.0).** This package currently ships the
declarative `ClientAdapter` registry for the 13 v1 clients plus the read-only
`detect` / `status` / `diff` engine. The write engine (apply/enable/disable
with backup/restore) lands in Story 33.1, the `iris-mcp-clients` CLI in 33.2,
and the VS Code extension "MCP Clients" view in 33.3. Adapter certification
(live probes per client) and the generated per-client docs table are Story
33.4.

## What lives here

Everything is driven by a declarative `ClientAdapter` record — code handles
formats, data handles clients. Adding a client never touches engine code.

- `CLIENT_ADAPTERS` — the 13-adapter registry (id, format, rootKey, per-OS
  scope path templates, entryShape, envExpansion, disableSupport, restartHint,
  detection probes, docsUrl), stamped with `ADAPTER_DATA_VERSION`.
- `CLIENT_DISPOSITIONS` — clients considered and dispositioned out of the v1
  roster: **Pi** (excluded — verified not MCP-capable by design), **JetBrains
  AI Assistant / Junie** and **Kilo Code** (roadmap, pending config-surface
  verification).
- `detect` — probes each adapter's config-file/app-dir paths (read-only) and
  reports installed clients.
- `status` — the client × iris-mcp-server matrix
  (`present-enabled` / `present-disabled` / `absent`), parsing each detected
  config in its native format (JSONC comments, TOML tables, YAML). Foreign
  third-party entries are surfaced as **names only** — never values (they may
  hold other products' secrets). Malformed files yield a per-client
  `unparseable` status, never a crash.
- `diff` — a **pure** renderer of the exact pending edit a hypothetical
  `apply`/`enable`/`disable` would make (jsonc-parser edit sets, TOML
  section-splice descriptors, YAML CST operations) — directly executable by
  the Story 33.1 write engine. Writes nothing.

## v1 client roster

Claude Code, Claude Desktop, Cursor, VS Code (Copilot), Cline, Roo Code,
Windsurf, Codex CLI, Gemini CLI, Zed, Goose, Kimi CLI, Kimi Code.

The authoritative per-client capability table (paths, root keys, disable
mechanisms) is generated from the registry; the certified version ships in
Story 33.4.

## Usage (from a built dist)

```ts
import {
  CLIENT_ADAPTERS,
  detect,
  status,
  diff,
} from "@iris-mcp/client-config";

const ctx = { platform: process.platform, env: process.env, homeDir: os.homedir() };
const found = detect(ctx);
const matrix = status(ctx);
```

The resolution/detection core never reads `process.env`, `process.platform`,
or `os.homedir()` directly — callers inject them (tests simulate
win32/darwin/linux without host dependence).
