# @iris-mcp/client-config

Multi-client MCP configuration manager for the iris-mcp suite (Epic 33 / FR141).

**Status: engine + CLI + certification (Stories 33.0–33.4).** The package
ships the declarative `ClientAdapter` registry for the 13 v1 clients, the
detect/status/diff read engine, the write engine (apply/enable/disable/
remove/restore with timestamped backups and a state.json ownership/stash
ledger), the **`iris-mcp-clients` CLI** (below), the doctor config-drift
guard, and the **adapter certification record** (dispositions below — live
passes where the client is locally available, honest fixture-only
dispositions otherwise). The VS Code extension "MCP Clients" view shipped
in Story 33.3.

## `iris-mcp-clients` CLI

Ships as a `bin` of this package: `npx -y @iris-mcp/client-config iris-mcp-clients <command>`.
*(Not yet published to npm — until then run the built bin directly:
`node packages/client-config/dist/cli/clients-cli.js <command>`.)*
The CLI is a thin consumer of the engine — no configuration format logic of
its own — and is fully scriptable: exit codes are `0` success / `1`
operational failure (an engine refusal, a declined confirmation, a doctor
finding) / `2` usage error, and every command answers `--json` with one
stable `{ok, command, data, error?}` envelope on stdout. `detect --json`'s
`data` additionally carries `dispositions` (id, displayName, disposition,
reason — the same rows the text render lists under "Other clients:", Story
33.3 additive). `diff --json`'s per-server `text` is redacted through the
same gate as the text render — an explicit-mode render carries the literal
`IRIS_PASSWORD` and no output surface ever echoes it (Story 33.3 QA
hardening).

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
  hint. An apply that UPDATES an existing entry only rewrites the
  manager-owned keys (`command`/`args`/`env`, env merged key-wise):
  unmanaged keys on the entry (Cline `autoApprove`/`timeout`, Codex
  `startup_timeout_sec`, …) and its enablement state are preserved — an
  apply never re-enables a `disabled` entry (Story 33.5).
- Modes: `env-reference` (default; VS Code gets the native `inputs` password
  upgrade, merged on apply), `explicit` (literal values — the password comes
  from `--password-stdin` or a hidden prompt, NEVER argv, behind the
  `--confirm-secret <entry-name>` typed confirmation), `server-manager` and
  `governance-file` (host-probed: offered in `--help` only when Server
  Manager definitions or a governance file are actually discoverable, and
  refused with an explanatory exit 2 when forced while unavailable).
- `doctor` diagnoses env-reference resolvability, config parseability,
  **config-surface drift** (below), stale backups, orphaned stashes, and
  present `iris-`-namespaced entries that fail ownership (a state.json loss;
  re-record them manager-created with `doctor --repair --yes-i-mean-it`).
  Exit `0` when clean, `1` on any finding.

## Doctor: config-surface drift

The registry is **data, not code** — every client's config surface (format,
root key, paths, disable mechanism) lives in `CLIENT_ADAPTERS`, stamped with
`ADAPTER_DATA_VERSION`. When a client genuinely changes its config surface,
the manager must not silently misread it. The doctor's `config-drift` check
is the guard: for every detected config file that **parses** in its native
format, it verifies the adapter's `rootKey` expectation.

The exact drift rule:

- **Drift** = the root key is PRESENT with the wrong shape (e.g.
  `"mcpServers": [...]` — the adapter expects an object of server entries),
  OR the file parses but its top level isn't the format's object form at all
  (every expectation fails).
- **NOT drift** = the root key is absent entirely and the file has other
  content — a client config that simply has no MCP section yet is normal
  (`~/.claude.json` carries dozens of unrelated settings).
- **No finding** = the file is empty or missing.
- A file that does NOT parse stays a `parseability` finding (repair or
  restore the file) — drift and unparseable are distinct findings.

A drift finding names the client, the path, the expectation, what was found
(type only, never file content), and the `ADAPTER_DATA_VERSION` the
expectation comes from:

```json
{
  "check": "config-drift",
  "client": "claude-code",
  "scope": "user",
  "path": "/home/u/.claude.json",
  "expected": "root key \"mcpServers\" holding an object of server entries",
  "found": "an array (3 item(s))",
  "adapterDataVersion": "2026-07-28.1",
  "detail": "config file parses, but expected root key ..."
}
```

**Drift-fix procedure** (a data patch, never an engine change):

1. Confirm the client's real new config surface against its official docs
   (the adapter's `docsUrl`) — never assume from one sample file.
2. Patch the adapter record in `src/adapters.ts` (root key, format, paths,
   entry shape, disable flag — whatever genuinely moved).
3. Bump `ADAPTER_DATA_VERSION` (`<spec-date>.<serial>` — increment the
   serial).
4. Update the fixtures: the realistic per-client fixture in
   `src/__tests__/fixtures/<client>/` (recaptured from the real new shape),
   plus the `fixtures/drift/` wrong-shape fixtures if the shape vocabulary
   changed.
5. Run the suite — the registry/roster sweeps and golden tests will point at
   anything the data patch missed.

No engine code (`readers.ts`, `write.ts`, `engine.ts`, `diff.ts`) changes in
a drift fix: the engine handles FORMATS, the adapter data handles CLIENTS.


## What lives here

Everything is driven by a declarative `ClientAdapter` record — code handles
formats, data handles clients. Adding a client never touches engine code.

**Managed servers:** the 5 leaf servers (`iris-dev-mcp`, `iris-admin-mcp`,
`iris-ops-mcp`, `iris-interop-mcp`, `iris-data-mcp`). `iris-mcp-all` is
deliberately **unmanaged** (Project Lead decision 2026-07-28): it is a real
aggregate stdio server, but as a peer row it invites applying all 5 servers
AND the aggregate, double-registering every tool. Entries named
`iris-mcp-all` are surfaced read-only (foreign), never modified — hand-write
the aggregate if you want it.

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

## Adapter table (generated)

<!-- ADAPTER-TABLE:BEGIN -->
Paths, formats, and mechanisms below are GENERATED from `CLIENT_ADAPTERS`
(adapter data 2026-07-28.1) by `scripts/render-certification-table.mjs` —
never hand-edit this section.

| Client | Format | Root key | User config | Project config | Disable | Restart hint | Certification |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Claude Code (`claude-code`) | json | `mcpServers` | `~/.claude.json` | `.mcp.json` | manager stash | Restart Claude Code (or start a new session) for MCP changes to take effect. | **certified-live** 2026-07-28 (incl. agent CLI probe) |
| Claude Desktop (`claude-desktop`) | json | `mcpServers` | win `%APPDATA%/Claude/claude_desktop_config.json`<br>mac `~/Library/Application Support/Claude/claude_desktop_config.json`<br>linux `~/.config/Claude/claude_desktop_config.json` | — | manager stash | Quit and relaunch Claude Desktop for MCP changes to take effect. | fixture-only (residual risk) |
| Cursor (`cursor`) | json | `mcpServers` | `~/.cursor/mcp.json` | `.cursor/mcp.json` | manager stash | Restart Cursor (or refresh the server from the MCP settings page) for changes to take effect. | fixture-only (residual risk) |
| VS Code (Copilot) (`vscode`) | jsonc | `servers` | win `%APPDATA%/Code/User/mcp.json`<br>mac `~/Library/Application Support/Code/User/mcp.json`<br>linux `~/.config/Code/User/mcp.json` | `.vscode/mcp.json` | manager stash | Reload the VS Code window (Developer: Reload Window) or restart the server from the MCP view for changes to take effect. | **certified-live** 2026-07-28 (file-level; agent-side GUI stays manual) |
| Cline (`cline`) | json | `mcpServers` | win `%APPDATA%/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`<br>mac `~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`<br>linux `~/.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json` | — | native `disabled` flag | Reload the VS Code window (Developer: Reload Window) for Cline to pick up MCP changes. | **certified-live** 2026-07-28 (file-level; agent-side GUI stays manual) |
| Roo Code (`roo-code`) | json | `mcpServers` | win `%APPDATA%/Code/User/globalStorage/rooveterinaryinc.roo-cline/settings/mcp_settings.json`<br>mac `~/Library/Application Support/Code/User/globalStorage/rooveterinaryinc.roo-cline/settings/mcp_settings.json`<br>linux `~/.config/Code/User/globalStorage/rooveterinaryinc.roo-cline/settings/mcp_settings.json` | `.roo/mcp.json` | native `disabled` flag | Reload the VS Code window (Developer: Reload Window) for Roo Code to pick up MCP changes. | fixture-only (residual risk) |
| Windsurf (`windsurf`) | json | `mcpServers` | `~/.codeium/windsurf/mcp_config.json` | — | manager stash | Restart Windsurf for MCP changes to take effect. | fixture-only (residual risk) |
| Codex CLI (`codex`) | toml | `mcp_servers` | `~/.codex/config.toml` | `.codex/config.toml` | native `enabled` flag | Start a new Codex CLI session for MCP changes to take effect. | fixture-only (residual risk) |
| Gemini CLI (`gemini`) | json | `mcpServers` | `~/.gemini/settings.json` | `.gemini/settings.json` | manager stash | Start a new Gemini CLI session for MCP changes to take effect. | fixture-only (residual risk) |
| Zed (`zed`) | json | `context_servers` | win `%APPDATA%/zed/settings.json`<br>mac `~/.config/zed/settings.json`<br>linux `~/.config/zed/settings.json` | `.zed/settings.json` | manager stash | Restart Zed (or reopen the agent panel) for MCP changes to take effect. | fixture-only (residual risk) |
| Goose (`goose`) | yaml | `extensions` | win `%APPDATA%/goose/config.yaml`<br>mac `~/.config/goose/config.yaml`<br>linux `~/.config/goose/config.yaml` | — | native `enabled` flag | Start a new Goose session for MCP changes to take effect. | fixture-only (residual risk) |
| Kimi CLI (`kimi`) | json | `mcpServers` | `~/.kimi/mcp.json` | — | manager stash | Start a new Kimi CLI session for MCP changes to take effect. | fixture-only (residual risk) |
| Kimi Code (`kimi-code`) | json | `mcpServers` | `~/.kimi-code/mcp.json` (or $KIMI_CODE_HOME/mcp.json) | `.kimi-code/mcp.json` | manager stash | Restart Kimi Code (or start a new session) for MCP changes to take effect. | **certified-live** 2026-07-28 (incl. agent CLI probe) |
<!-- ADAPTER-TABLE:END -->

## Certification dispositions (generated)

The certification harness is `scripts/certify.mjs` — it runs ONE scripted
pass for ONE locally installed client against its REAL config (every write
through the built CLI = the engine, backup-on-write; pre-pass snapshots of
config + state; byte-exact verified restore with an engine-restore ladder
and a loudly-reported raw-snapshot last resort; manager state/backups and
Kimi session artifacts cleaned up). A bare invocation prints the plan and
does nothing; a real pass needs both `run` and `--real-config`:

```text
node scripts/certify.mjs run <clientId> --real-config [--server iris-dev-mcp] [--skip-agent]

_Note (2026-07-28): certification probes now default to `iris-dev-mcp`. The 2026-07-28 evidence blocks below used `iris-mcp-all` as the probe entry (a valid managed server at the time); the aggregate is now unmanaged by design (see "Managed servers" above) — re-runs use a real server._
```

Re-run it after the first npm publish (the pre-publish residual risk named
in several dispositions: the manager's `npx -y @iris-mcp/*` launch targets
are not on the registry yet) and on any machine with a fixture-only client
installed. Two mode notes for re-runs: the VS Code pass applies in
**explicit mode with a dummy placeholder password** (a single write —
env-reference would also merge a top-level `inputs[]` descriptor that
`remove` does not roll back), and the Kimi Code agent leg needs a real
credential in the OS environment (`IRIS_PASSWORD`) because kimi-code does
no env expansion — see its residual-risk note.

<!-- CERTIFICATION-TABLE:BEGIN -->
Dispositions are GENERATED from `scripts/certification-results.json` (real recorded
runs — commands + outputs, never edited to match) ⨝ the `CLIENT_ADAPTERS` roster by
`scripts/render-certification-table.mjs` — never hand-edit this section. Every client
has an explicit disposition (Rule #34 — no silent certification). A **certified-live**
pass proves the scripted lifecycle against the real config; the "client surfaces the
entry" step is the client's own agent CLI listing where the evidence shows one
(`claude mcp list`, `kimi -p`) and a FILE-LEVEL status read otherwise — an agent-side
GUI tool listing is never claimed by the harness (33-5-15).

#### Claude Code (`claude-code`)

**certified-live** (2026-07-28, win32/x64) — scripted pass via `scripts/certify.mjs` (server used: `iris-dev-mcp`): add (engine apply) → client surfaces the entry → disable → entry inactive → remove → byte-exact restore + side-effect cleanup.

Recorded evidence:
- PASS snapshot — config 139 bytes; state.json absent; 0 pre-existing backup(s)
- PASS add (engine apply) — iris-dev-mcp written to C:\Users\Josh\AppData\Local\Temp\qa334-cert-home-M2ea0w\.claude.json
- PASS client surfaces the entry — `claude mcp list` listed the manager-written entry "iris-dev-mcp"
- $ claude mcp list → iris-dev-mcp: npx -y @iris-mcp/dev - × Failed to connect — -32000: MCP error -32000: Connection closed
- PASS disable (engine)
- PASS entry inactive after disable — state = absent
- PASS remove (engine)
- PASS byte-exact restore + side-effect cleanup — config bytes identical to pre-pass

Residual risk: The npx launch target (@iris-mcp/all) is unpublished as of 2026-07-28, so the client health check reports 'Failed to connect' for the manager-written entry; sibling node-dist entries at the same path/rootKey show '√ Connected' in the same 'claude mcp list' run. Re-run scripts/certify.mjs after the first npm publish for the full tool-listing leg.

Repo `.mcp.json` sharing (Claude half, AC 33.4.4): **verified-live** (2026-07-28) — manager wrote iris-mcp-all at project scope into a scratch dir .mcp.json; claude mcp list (2.1.220) in that dir showed: iris-mcp-all: npx -y @iris-mcp/all - Pending approval, with the MCP config diagnostics naming the exact scratch .mcp.json path.

#### Claude Desktop (`claude-desktop`)

**fixture-only-with-residual-risk** (2026-07-28) — Fixtures prove: the adapter data (JSON format, mcpServers rootKey, per-OS claude_desktop_config.json paths) parses and round-trips add/disable/enable/remove byte-equal in the golden suite, and the entry shape matches the spec capability table. Unproven: the real Claude Desktop config surface (no local install as of 2026-07-28) — certify with: node packages/client-config/scripts/certify.mjs run claude-desktop --real-config on a machine with Claude Desktop installed.

#### Cursor (`cursor`)

**fixture-only-with-residual-risk** (2026-07-28) — Fixtures prove: the adapter data (JSON format, mcpServers rootKey, ~/.cursor/mcp.json + .cursor/mcp.json paths, stash disable) parses and round-trips byte-equal in the golden suite. Unproven: the real Cursor config surface (no local install as of 2026-07-28; installing clients is a Project Lead choice) — certify with: node packages/client-config/scripts/certify.mjs run cursor --real-config.

#### VS Code (Copilot) (`vscode`)

**certified-live** (2026-07-28, win32/x64) — scripted pass via `scripts/certify.mjs` (server used: `iris-mcp-all`): add (engine apply) → client surfaces the entry → disable → entry inactive → remove → byte-exact restore + side-effect cleanup.

Recorded evidence:
- PASS snapshot — config 0 bytes; state.json present; 2 pre-existing backup(s)
- PASS add (engine apply) — iris-mcp-all written to C:\Users\Josh\AppData\Roaming\Code\User\mcp.json
- PASS client surfaces the entry — file-level: "iris-mcp-all" present-enabled (agent-side tool listing stays a manual GUI step — not claimed)
- $ iris-mcp-clients status --json → vscode iris-mcp-all = present-enabled
- PASS disable (engine)
- PASS entry inactive after disable — state = absent
- PASS remove (engine)
- PASS byte-exact restore + side-effect cleanup — config bytes identical to pre-pass

Residual risk: File-level lifecycle certified live; the agent-side tool listing (Copilot MCP view) is a manual GUI step that stays OPEN as AC 33.3.4 for the Project Lead — never claimed here. The npx launch target (@iris-mcp/all) is unpublished as of 2026-07-28 — re-run scripts/certify.mjs after the first npm publish.

#### Cline (`cline`)

**certified-live** (2026-07-28, win32/x64) — scripted pass via `scripts/certify.mjs` (server used: `iris-mcp-all`): add (engine apply) → client surfaces the entry → disable → entry inactive → remove → byte-exact restore + side-effect cleanup.

Recorded evidence:
- PASS snapshot — config 2683 bytes; state.json present; 2 pre-existing backup(s)
- PASS add (engine apply) — iris-mcp-all written to C:\Users\Josh\AppData\Roaming\Code\User\globalStorage\saoudrizwan.claude-dev\settings\cline_mcp_settings.json
- PASS client surfaces the entry — file-level: "iris-mcp-all" present-enabled (agent-side tool listing stays a manual GUI step — not claimed)
- $ iris-mcp-clients status --json → cline iris-mcp-all = present-enabled
- PASS disable (engine)
- PASS entry inactive after disable — state = present-disabled
- PASS remove (engine)
- PASS byte-exact restore + side-effect cleanup — config bytes identical to pre-pass

Residual risk: File-level lifecycle certified live incl. the native 'disabled' flag round-trip; the agent-side tool listing (Cline MCP UI) is a manual GUI step — never claimed here. The npx launch target (@iris-mcp/all) is unpublished as of 2026-07-28 — re-run scripts/certify.mjs after the first npm publish.

#### Roo Code (`roo-code`)

**fixture-only-with-residual-risk** (2026-07-28) — Fixtures prove: the adapter data (JSON format, mcpServers rootKey, globalStorage mcp_settings.json + .roo/mcp.json paths, native disabled flag) parses and round-trips byte-equal in the golden suite. Unproven: the real Roo Code config surface (no local install as of 2026-07-28) — certify with: node packages/client-config/scripts/certify.mjs run roo-code --real-config.

#### Windsurf (`windsurf`)

**fixture-only-with-residual-risk** (2026-07-28) — Fixtures prove: the adapter data (JSON format, mcpServers rootKey, ~/.codeium/windsurf/mcp_config.json path, stash disable) parses and round-trips byte-equal in the golden suite. Unproven: the real Windsurf config surface (no local install as of 2026-07-28) — certify with: node packages/client-config/scripts/certify.mjs run windsurf --real-config.

#### Codex CLI (`codex`)

**fixture-only-with-residual-risk** (2026-07-28) — Fixtures prove: the adapter data (TOML format, mcp_servers rootKey, ~/.codex/config.toml + .codex/config.toml paths) parses and round-trips add/disable/enable/remove byte-equal in the golden suite; the native `enabled` flag is docs-verified (Story 33.1 probe: learn.chatgpt.com config reference documents mcp_servers.<id>.enabled). Unproven: the real Codex CLI config surface (no local install as of 2026-07-28; installing clients is a Project Lead choice) — certify with: node packages/client-config/scripts/certify.mjs run codex --real-config.

#### Gemini CLI (`gemini`)

**fixture-only-with-residual-risk** (2026-07-28) — Fixtures prove: the adapter data (JSON format, mcpServers rootKey, ~/.gemini/settings.json paths, shell $VAR/${VAR} env expansion, stash disable) parses and round-trips byte-equal in the golden suite. Unproven: the real Gemini CLI config surface (no local install as of 2026-07-28) — certify with: node packages/client-config/scripts/certify.mjs run gemini --real-config.

#### Zed (`zed`)

**fixture-only-with-residual-risk** (2026-07-28) — Fixtures prove: the adapter data (JSON format, context_servers rootKey, per-OS settings.json paths, zed command-object entry shape, stash disable) parses and round-trips byte-equal in the golden suite. Unproven: the real Zed config surface (no local install as of 2026-07-28) — certify with: node packages/client-config/scripts/certify.mjs run zed --real-config.

#### Goose (`goose`)

**fixture-only-with-residual-risk** (2026-07-28) — Fixtures prove: the adapter data (YAML format, extensions rootKey, per-OS config.yaml paths, goose stdio extension shape, native enabled flag) parses and round-trips byte-equal in the golden suite. Unproven: the real Goose config surface (no local install as of 2026-07-28) — certify with: node packages/client-config/scripts/certify.mjs run goose --real-config.

#### Kimi CLI (`kimi`)

**fixture-only-with-residual-risk** (2026-07-28) — Fixtures prove: the adapter data (JSON format, mcpServers rootKey, ~/.kimi/mcp.json path, stash disable, --mcp-config-file per-invocation override documented not modeled) parses and round-trips byte-equal in the golden suite. Unproven: the real Kimi CLI config surface (no local install as of 2026-07-28 — the installed Kimi CODE is a different product with its own adapter) — certify with: node packages/client-config/scripts/certify.mjs run kimi --real-config.

#### Kimi Code (`kimi-code`)

**certified-live** (2026-07-28, win32/x64) — scripted pass via `scripts/certify.mjs` (server used: `iris-mcp-all`): add (engine apply) → client surfaces the entry → disable → entry inactive → remove → byte-exact restore + side-effect cleanup.

Recorded evidence:
- PASS snapshot — config 2632 bytes; state.json present; 2 pre-existing backup(s)
- PASS add (engine apply) — iris-mcp-all written to C:\Users\Josh\.kimi-code\mcp.json
- PASS client surfaces the entry — file-level: "iris-mcp-all" present-enabled in ~/.kimi-code/mcp.json (agent surface: {"role":"assistant","content":"chrome-devtools, iris-admin-mcp, iris-data-mcp, iris-dev-mcp, iris-interop-mcp, iris-ops-mcp, perplexity"} {"role":"meta","type":"session.resume_hint","session_id":"session_07c0aa5c-cced-4880-9e5f-ac7d7b51b9fc","command":"kimi -r session_07c0aa5c-cced-4880-9e5f-ac7d7b51b9fc","content":"To resume this session: kimi -r session_07c0aa5c-cced-4880-9e5f-ac7d7b51b9fc"})
- $ iris-mcp-clients status --json → kimi-code iris-mcp-all = present-enabled
- $ kimi -p "list MCP servers" → {"role":"assistant","content":"chrome-devtools, iris-admin-mcp, iris-data-mcp, iris-dev-mcp, iris-interop-mcp, iris-ops-mcp, perplexity"} {"role":"meta","type":"session.resume_hint","session_id":"session_07c0aa5c-cced-4880-9e5f-ac7d7b51b9fc","command":"kimi -r session_07c0aa5c-cced-4880-9e5f-ac7d7b5…
- PASS disable (engine)
- PASS entry inactive after disable — state = absent
- PASS remove (engine)
- PASS byte-exact restore + side-effect cleanup — config bytes identical to pre-pass

Residual risk: CLI/TUI half: certified live (file-level lifecycle + agent surface probe; the added entry's npx target @iris-mcp/all is unpublished as of 2026-07-28, so its in-session launch fails — sibling node-dist entries in the same file ARE callable live, verified 2026-07-28). VS Code extension half: fixture-only-with-residual-risk — the Kimi Code VS Code extension is NOT installed locally (code --list-extensions, 2026-07-28); per the extension's marketplace docs it reads the same ~/.kimi-code/mcp.json, unproven live. Re-run both legs after publish/extension install — and note kimi-code does NO env expansion (envExpansion: none): the harness applies env-reference, so the entry only authenticates in-session when the OS environment provides IRIS_PASSWORD — export it before the agent leg (or hand-apply in explicit mode with --confirm-secret), otherwise the post-publish launch fails on auth, not on the npx target.

AC 33.4.4 dual-surface:
- CLI/TUI half: **verified-live** (2026-07-28) — user-scope pass certified live (see steps/evidence above); the agent surface (kimi -p, 0.29.0) called iris_server_info LIVE through the existing entries of the same ~/.kimi-code/mcp.json the manager writes (returned IRIS for Windows (x86-64) 2026.1 (Build 235U)); kimi -p listing answered exactly the user-scope servers (chrome-devtools, iris-admin-mcp, iris-data-mcp, iris-dev-mcp, iris-interop-mcp, iris-ops-mcp, perplexity).
- VS Code extension half: **fixture-only-with-residual-risk** (2026-07-28) — the Kimi Code VS Code extension is NOT installed locally (code --list-extensions shows no kimi/moonshot extension, 2026-07-28) — per the stage brief this half is never claimed; per the extension docs it reads the same ~/.kimi-code/mcp.json, unproven live.
- Repo `.mcp.json` sharing: Claude side verified-live (see claude-code record); Kimi side — FALSIFIED for kimi-code 0.29.0 as probed — official docs (moonshotai.github.io/kimi-code MCP customization) document ONLY .kimi-code/mcp.json as the project path (no .mcp.json fallback anywhere); live print-mode probes loaded NO project-scope server: a distinctive WORKING probe server (iris-sharing-probe, node dist entry) placed first in .mcp.json then in .kimi-code/mcp.json answered TOOL-NOT-LOADED to mcp__iris-sharing-probe__iris_server_info, even in a TUI-registered workspace. Consequence: the adapter data fallback was REMOVED (ADAPTER_DATA_VERSION 2026-07-25.2 → 2026-07-28.1, drift-fix data patch); project-scope loading itself may be TUI-only (print mode loads user scope only) — residual risk recorded.
<!-- CERTIFICATION-TABLE:END -->

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
