# @iris-mcp/client-config

Multi-client MCP configuration manager for the iris-mcp suite (Epic 33 / FR141).

**Status: engine + CLI (Stories 33.0–33.2).** The package ships the
declarative `ClientAdapter` registry for the 13 v1 clients, the
detect/status/diff read engine, the write engine (apply/enable/disable/
remove/restore with timestamped backups and a state.json ownership/stash
ledger), and the **`iris-mcp-clients` CLI** (below). The VS Code extension
"MCP Clients" view is Story 33.3; adapter certification (live probes per
client) and the generated per-client docs table are Story 33.4.

## `iris-mcp-clients` CLI

Ships as a `bin` of this package: `npx -y @iris-mcp/client-config iris-mcp-clients <command>`.
The CLI is a thin consumer of the engine — no configuration format logic of
its own — and is fully scriptable: exit codes are `0` success / `1`
operational failure (an engine refusal, a declined confirmation, a doctor
finding) / `2` usage error, and every command answers `--json` with one
stable `{ok, command, data, error?}` envelope on stdout.

```text
iris-mcp-clients detect [--json]                     # installed clients + resolved config paths
iris-mcp-clients status [--json]                     # client × iris-mcp-server matrix (foreign entries: names only)
iris-mcp-clients diff --client <id> --servers <list> [--scope user|project] [--mode <mode>] [--json]
iris-mcp-clients apply --client <id> --servers <list> [--scope user|project] [--mode <mode>] [--yes] [--json]
iris-mcp-clients enable|disable|remove --client <id> --server <name> [--scope user|project] [--json]
iris-mcp-clients restore --client <id> [--scope user|project] [--backup <name>] [--json]
iris-mcp-clients doctor [--json] [--repair --yes-i-mean-it]
```

- `apply` prints the pending diff FIRST and requires confirmation: an
  interactive prompt on a TTY, `--yes` to skip, and a non-TTY invocation
  without `--yes` refuses (exit 2) — it never writes silently. Every
  successful write takes a timestamped backup (under
  `~/.iris-mcp/client-manager/backups/`) and prints the client's restart
  hint.
- Modes: `env-reference` (default; VS Code gets the native `inputs` password
  upgrade, merged on apply), `explicit` (literal values — the password comes
  from `--password-stdin` or a hidden prompt, NEVER argv, behind the
  `--confirm-secret <entry-name>` typed confirmation), `server-manager` and
  `governance-file` (host-probed: offered in `--help` only when Server
  Manager definitions or a governance file are actually discoverable, and
  refused with an explanatory exit 2 when forced while unavailable).
- `doctor` diagnoses env-reference resolvability, config parseability,
  stale backups, orphaned stashes, and present `iris-`-namespaced entries
  that fail ownership (a state.json loss; re-record them manager-created
  with `doctor --repair --yes-i-mean-it`). Exit `0` when clean, `1` on any
  finding.

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
  the write engine. Writes nothing.
- `apply` / `enable` / `disable` / `remove` / `restore` — the write engine:
  every mutation goes through the universal safety protocol (pre-parse
  refusal, timestamped backup, post-write re-parse with auto-restore) and an
  exact-match ownership check (entries outside the iris-mcp namespace are
  foreign and refused unless recorded manager-created).
- `synthesizeEntry` — canonical entries in four env modes (`server-manager`,
  `env-reference`, `governance-file`, `explicit`).
- `ensureInputs` / `presentInputIds` — the VS Code native `inputs` merge
  (the env-reference mode's `${input:iris-password}` upgrade), idempotent
  and safety-protocol-wrapped.

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
