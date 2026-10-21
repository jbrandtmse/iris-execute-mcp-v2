# @iris-mcp/client-config

Multi-client MCP configuration manager for the iris-mcp suite (Epic 33 / FR141).

**Status: engine + CLI + certification (Stories 33.0–33.4) and the skills pack (Epic 41).** The package
ships the declarative `ClientAdapter` registry for the 13 v1 clients, the
detect/status/diff read engine, the write engine (apply/enable/disable/
remove/restore with timestamped backups and a state.json ownership/stash
ledger), the **`iris-mcp-clients` CLI** (below), the doctor config-drift
guard, and the **adapter certification record** (dispositions below — live
passes where the client is locally available, honest fixture-only
dispositions otherwise). The VS Code extension "MCP Clients" view shipped
in Story 33.3. The package also ships the **skills pack** (`skills-pack/`: the
knowledge skills, the workflow skills and the always-on rule) and the
`iris-mcp-clients skills install` installer that copies it into a project
(Epic 41).

## `iris-mcp-clients` CLI

Ships as a `bin` of this package: `npx -y -p @iris-mcp/client-config@1 iris-mcp-clients <command>`.
The `-p` form names the bin; otherwise `iris-mcp-clients` reaches the CLI as an unknown command.
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
iris-mcp-clients skills install|uninstall --client <id> [--project <dir>] [--dry-run] [--yes] [--include-modified] [--json]
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

## Installing the skills pack

`iris-mcp-clients skills install --client <id>` puts the IRIS MCP skills pack (the `skills-pack/` directory of this
package: the workflow and knowledge skills and the always-on ObjectScript pre-write rule) into one project, in the places
that client reads. `skills uninstall` takes it out again. It is a CLI of this package, not an MCP tool, so it has no
governance key and no visibility preset.

```text
iris-mcp-clients skills install --client claude-code --dry-run      # preview the plan for the current directory
iris-mcp-clients skills install --client claude-code                # install; asks first (--yes skips the question)
iris-mcp-clients skills install --client codex --project ../my-app  # an AGENTS.md client, in another project
iris-mcp-clients skills uninstall --client claude-code              # remove what the installer put there
```

Each `--client` id, with the folders it installs into and why, is listed in [Skills pack targets](#skills-pack-targets-generated).

- **Four routes, one per client family.** `claude-code` writes `.claude/skills/` and `.claude/rules/`. `cursor` writes
  `.agents/skills/` and `.cursor/rules/<name>.mdc`. `gemini` writes `.agents/skills/` and a marked block in `GEMINI.md`.
  `agents` writes `.agents/skills/` and a marked block in `AGENTS.md`; every other client takes it, VS Code included, and
  `--client agents` serves any agent that reads `.agents/skills/` and `AGENTS.md`. Claude Desktop has no project folder for
  skills, so `--client claude-desktop` is refused (exit 2).
- **Project scope only.** The target is the current directory, or `--project <dir>`. `--scope user` is refused, because a
  user-scope rule would load in every session of every project.
- **Preview, then confirm.** Like `apply`, it prints the plan first (one line per path: `create`, `update`, `remove`,
  `adopt`, `unchanged`, `keep` or `conflict`) and writes only after `--yes` or a TTY confirmation; a non-TTY run without
  `--yes` refuses (exit 2). `--dry-run` previews and writes nothing. Re-running an install that would change nothing writes
  nothing.
- **It writes only what it owns.** The installer records the files and blocks it installed in
  `.iris-mcp/skills-pack.json` in the project. A file at an owned path that it did not install is a conflict, and a conflict
  refuses the whole run. Your `AGENTS.md` or `GEMINI.md` is read and written as bytes: only the block between its two
  `IRIS-MCP-RULE` marker lines is ever changed, and uninstalling restores the other bytes exactly. It never writes
  `CLAUDE.md` or a client's settings file. A symbolic link at or above any path it owns (a linked `.claude/` or an
  `AGENTS.md` that links to `CLAUDE.md`, dangling or not), or a hard link at one, is a conflict that names the link, so it
  never writes or deletes through a link; replace the link or install by hand.
- **`--include-modified`.** A file you edited after the install is kept, with a note, on both install and uninstall; with
  `--include-modified` it is replaced or removed after a backup. Every file an update or an uninstall overwrites or deletes is
  backed up first under `~/.iris-mcp/client-manager/backups/skills-pack/`.
- **Keep the record with the files.** Commit `.iris-mcp/skills-pack.json` together with the installed files, so that a
  clone can update or uninstall them. Without the record, an installed file that differs from the pack is a file the
  installer did not install, which is a conflict: move or delete it, then re-run. If git converts line endings in your
  checkout (`core.autocrlf`), mark the installed paths `-text` in `.gitattributes`: a converted file reads as one you
  changed, and is kept.
- **Exit codes.** `0` for success, nothing to change or a clean dry run; `1` for a conflict (a dry run included), an invalid
  manifest or pack, a failed write (it is rolled back), a declined confirmation or a file that changed after the preview;
  `2` for a usage error.
- The notice for adapted content (`IRIS-MCP-THIRD-PARTY-NOTICES.md`) is installed beside every skill that carries it, and
  stays while a file you changed remains in that skill's directory.
- **Known limits.** Besides the refusals above (`--scope user`, `claude-desktop`, links):
  - The `claude-code` route always installs both the skills and the rule; it does not detect a Claude Code plugin.
  - `--project` is not compared with your home directory: `--project ~`, or a run from `~`, installs the rule where every
    project's session loads it.
  - Only the project directory is checked for a `CLAUDE.md`; a `CLAUDE.md` in a parent directory is not seen.
  - An edit inside the installer's own block is replaced on the next install.
  - Installing for one client never updates the files of another client that it does not share.
  - The notes about a client that reads a skill or the rule twice are fixed text; the installer does not deduplicate.
  - Skills-pack backups are never pruned, `doctor` does not list them and `restore` does not read them; copy a backup back
    by hand.

Run `iris-mcp-clients --help` for every option.

## Skills pack targets (generated)

<!-- PACK-TARGETS-TABLE:BEGIN -->
Generated from `PACK_TARGETS` (client documentation checked 2026-10-19) by `scripts/render-certification-table.mjs`; do not edit by hand.

| Client | `--client` | Skills go to | The always-on rule goes to | Why | Sources |
| --- | --- | --- | --- | --- | --- |
| Claude Code | `claude-code` | `.claude/skills/` | `.claude/rules/iris-mcp-objectscript-pre-write.md` | Claude Code never reads .agents/. A rule in .claude/rules/ without a paths: scope is loaded at launch. AGENTS.md is read only when there is no CLAUDE.md, so .claude/rules/ is the route that always works. | [1](https://code.claude.com/docs/en/skills), [2](https://code.claude.com/docs/en/memory) |
| Claude Desktop | `claude-desktop` | none | none | Skills are only uploaded as a ZIP (Customize > Skills) and instructions are only settings fields; the Code tab is Claude Code. Refused: Claude Desktop has no project folder for skills or rules: upload skills as a ZIP under Customize > Skills. Its Code tab runs Claude Code, so use --client claude-code for that. | [1](https://support.claude.com/en/articles/12512180-use-skills-in-claude), [2](https://code.claude.com/docs/en/desktop) |
| Cursor | `cursor` | `.agents/skills/` | `.cursor/rules/iris-mcp-objectscript-pre-write.mdc` | Project rules in .cursor/rules/ must be .mdc files with alwaysApply: true to be always included. Cursor also reads .cursor/skills/, .claude/skills/, .codex/skills/, AGENTS.md and CLAUDE.md. Installer note: Cursor also reads .claude/skills/ and AGENTS.md, so a project that also installs for Claude Code or for an AGENTS.md client shows Cursor each skill, or the rule, twice. | [1](https://cursor.com/docs/skills), [2](https://cursor.com/docs/rules) |
| VS Code (Copilot) | `vscode` | `.agents/skills/` | a marked block in `AGENTS.md` | An .instructions.md file with applyTo: attaches only to files the agent creates or modifies, so the rule goes in AGENTS.md at the repository root, which is always applied. VS Code also reads .github/skills/, .claude/skills/, .github/copilot-instructions.md and CLAUDE.md. Installer note: VS Code reads the rule from AGENTS.md at the repository root while its chat.useAgentsMdFile setting is on, the default. It also reads .claude/skills/, so a project that also installs for Claude Code shows each skill twice. | [1](https://code.visualstudio.com/docs/agent-customization/agent-skills), [2](https://code.visualstudio.com/docs/agent-customization/custom-instructions) |
| Cline | `cline` | `.agents/skills/` | a marked block in `AGENTS.md` | Cline scans .agents/skills/ for skills and reads the workspace-root AGENTS.md as a rule, so no Cline-only file is needed. Its native .clinerules/ directory is not used. Installer note: Cline lists AGENTS.md in its Rules panel, where the rule can be switched off. It also reads .claude/skills/, so a project that also installs for Claude Code shows each skill twice. | [1](https://docs.cline.bot/customization/skills), [2](https://docs.cline.bot/customization/cline-rules), [3](https://github.com/cline/cline/blob/main/apps/vscode/src/core/storage/skill-directories.ts) |
| Roo Code | `roo-code` | `.agents/skills/` | a marked block in `AGENTS.md` | Roo Code reads .agents/skills/ and the root AGENTS.md while roo-cline.useAgentRules is on, the default. It was discontinued on 2026-05-15; its native .roo/skills/ and .roo/rules/ are not used. Installer note: Roo Code was discontinued on 2026-05-15. Its last release reads .agents/skills/, and reads AGENTS.md while its roo-cline.useAgentRules setting is on, the default. | [1](https://roocodeinc.github.io/Roo-Code/features/skills), [2](https://roocodeinc.github.io/Roo-Code/features/custom-instructions) |
| Windsurf | `windsurf` | `.agents/skills/` | a marked block in `AGENTS.md` | Windsurf is now Devin Desktop. A root AGENTS.md is treated as an always-on rule; its native .devin/rules/ and .windsurf/rules/ are not used. Installer note: Windsurf is now Devin Desktop, which treats AGENTS.md at the repository root as an always-on rule. | [1](https://docs.devin.ai/desktop/cascade/skills), [2](https://docs.devin.ai/desktop/cascade/agents-md) |
| Codex CLI | `codex` | `.agents/skills/` | a marked block in `AGENTS.md` | Codex reads .agents/skills/ and AGENTS.md natively. Its 32 KiB combined cap is far above the 2.2 KB block. | [1](https://learn.chatgpt.com/docs/build-skills), [2](https://learn.chatgpt.com/docs/agent-configuration/agents-md) |
| Gemini CLI | `gemini` | `.agents/skills/` | a marked block in `GEMINI.md` | Gemini CLI reads GEMINI.md by default and AGENTS.md only after a context.fileName setting, which the installer never edits. .agents/skills/ is an alias for its skills directory. Installer note: For unpaid-tier and Google One users, Gemini CLI was replaced by Antigravity CLI on 2026-06-18. | [1](https://geminicli.com/docs/cli/skills/), [2](https://geminicli.com/docs/cli/gemini-md/) |
| Zed | `zed` | `.agents/skills/` | a marked block in `AGENTS.md` | Zed reads .agents/skills/ only (trusted worktrees only) and the first of .rules, .cursorrules, .windsurfrules, .clinerules, .github/copilot-instructions.md, AGENT.md, AGENTS.md, CLAUDE.md and GEMINI.md. Installer note: Zed loads project skills only in a trusted worktree, and reads only the first instructions file it finds, in the order .rules, .cursorrules, .windsurfrules, .clinerules, .github/copilot-instructions.md, AGENT.md, AGENTS.md, CLAUDE.md, GEMINI.md. | [1](https://zed.dev/docs/ai/skills), [2](https://zed.dev/docs/ai/instructions) |
| Goose | `goose` | `.agents/skills/` | a marked block in `AGENTS.md` | Goose reads .agents/skills/ and AGENTS.md natively. It also reads .goose/skills/, .claude/skills/ and .goosehints, and its context files need the Developer extension. Installer note: Goose reads AGENTS.md through its Developer extension, which must be enabled. | [1](https://goose-docs.ai/docs/guides/context-engineering/using-skills/), [2](https://goose-docs.ai/docs/guides/context-engineering/using-goosehints/) |
| Kimi CLI | `kimi` | `.agents/skills/` | a marked block in `AGENTS.md` | Kimi CLI reads .agents/skills/ and AGENTS.md natively. It is archived. It also reads .kimi/skills/, .claude/skills/ and .codex/skills/. Installer note: Kimi CLI is archived and no longer maintained; Kimi Code replaces it. | [1](https://moonshotai.github.io/kimi-cli/en/customization/skills.html), [2](https://moonshotai.github.io/kimi-cli/en/customization/agents.html) |
| Kimi Code | `kimi-code` | `.agents/skills/` | a marked block in `AGENTS.md` | Kimi Code reads .agents/skills/ and AGENTS.md natively. It also reads .kimi-code/skills/ and .kimi-code/AGENTS.md. | [1](https://moonshotai.github.io/kimi-code/en/customization/skills), [2](https://moonshotai.github.io/kimi-code/en/customization/agents) |
| Pi (pi CLI / pi-coding-agent) | `pi` | `.agents/skills/` | a marked block in `AGENTS.md` | Pi reads .agents/skills/ (trusted project only) and AGENTS.md natively, per folder with AGENTS.md before CLAUDE.md. It also reads .pi/skills/. iris-mcp-clients configures no MCP for it. Installer note: Pi loads project skills only in a trusted project. iris-mcp-clients does not configure MCP for Pi, so add the IRIS MCP servers to Pi yourself before using the workflow skills. | [1](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/skills.md), [2](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/configuration.md) |
| JetBrains AI Assistant / Junie | `jetbrains-junie` | `.agents/skills/` | a marked block in `AGENTS.md` | Junie reads .agents/skills/ (trusted project only) and AGENTS.md natively; it ignores AGENTS.md when .junie/AGENTS.md exists or a custom guidelines file is set. It also reads .junie/skills/ and .junie/rules/. iris-mcp-clients configures no MCP for it. Installer note: Junie loads project skills only in a trusted project, and ignores AGENTS.md when .junie/AGENTS.md exists or a custom guidelines file is set. iris-mcp-clients does not configure MCP for Junie, so add the IRIS MCP servers to Junie yourself before using the workflow skills. | [1](https://junie.jetbrains.com/docs/agent-skills.html), [2](https://junie.jetbrains.com/docs/guidelines-and-memory.html) |
| Kilo Code | `kilo-code` | `.agents/skills/` | a marked block in `AGENTS.md` | Kilo Code reads .agents/skills/ and AGENTS.md natively, with AGENTS.md before CLAUDE.md (first match). It also reads .kilo/skills/, .claude/skills/ and .kilo/rules/. iris-mcp-clients configures no MCP for it. Installer note: iris-mcp-clients does not configure MCP for Kilo Code, so add the IRIS MCP servers to Kilo Code yourself before using the workflow skills. | [1](https://kilo.ai/docs/customize/skills), [2](https://kilo.ai/docs/customize/agents-md) |
| Other agents | `agents` | `.agents/skills/` | a marked block in `AGENTS.md` | The cross-client convention for any agent that reads both .agents/skills/ and AGENTS.md. | [1](https://agentskills.io/client-implementation/adding-skills-support), [2](https://agents.md) |
<!-- PACK-TARGETS-TABLE:END -->

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
deliberately **unmanaged** (Project Lead decision 2026-07-28): `@iris-mcp/all`
is a meta-package with no `bin`, so no server by that name can start. Entries
named `iris-mcp-all` are surfaced read-only (foreign), never modified.

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
  **Known limitation (stash clients, 36.3/33-1-R3):** the disable→enable
  stash round-trip is byte-exact for the OWNED entry the manager itself
  rendered, but a comment a user hand-added INSIDE that entry (never
  elsewhere in the file) is lost — the stash holds the parsed entry, not its
  original source span. Manager-owned entries are manager-rendered in every
  v1 flow, so this only bites a hand-edited comment placed inside one.
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

_Note (2026-07-28): certification probes now default to `iris-dev-mcp`. The 2026-07-28 evidence blocks below used `iris-mcp-all` as the probe entry (then a managed row); `@iris-mcp/all` has no `bin` and can never start a server, and the aggregate is now unmanaged by design (see "Managed servers" above) — re-runs use a real server._
```

Re-run it after the first npm publish (the pre-publish residual risk named
in several dispositions: the manager's `npx -y @iris-mcp/<server>@1` launch targets
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

Residual risk: The npx launch target of the certified entry (@iris-mcp/dev) was unpublished as of 2026-07-28, so the client health check reported 'Failed to connect' for the manager-written entry; sibling node-dist entries at the same path/rootKey showed '√ Connected' in the same 'claude mcp list' run. Re-run scripts/certify.mjs after the first npm publish for the full tool-listing leg. The sharing probe below wrote an iris-mcp-all entry; @iris-mcp/all is a meta-package with no bin, so that entry never starts, published or not.

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

Residual risk: File-level lifecycle certified live; the agent-side tool listing (Copilot MCP view) is a manual GUI step that stays OPEN as AC 33.3.4 for the Project Lead — never claimed here. The certified entry was iris-mcp-all, whose npx launch target (@iris-mcp/all) is a meta-package with no bin: it never starts, published or not, and is no longer a managed server — re-run scripts/certify.mjs against a leaf server (iris-dev-mcp) after the first npm publish.

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

Residual risk: File-level lifecycle certified live incl. the native 'disabled' flag round-trip; the agent-side tool listing (Cline MCP UI) is a manual GUI step — never claimed here. The certified entry was iris-mcp-all, whose npx launch target (@iris-mcp/all) is a meta-package with no bin: it never starts, published or not, and is no longer a managed server — re-run scripts/certify.mjs against a leaf server (iris-dev-mcp) after the first npm publish.

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

Residual risk: CLI/TUI half: certified live (file-level lifecycle + agent surface probe; the added entry's npx target @iris-mcp/all is a meta-package with no bin, so its in-session launch fails and always will, published or not — sibling node-dist entries in the same file ARE callable live, verified 2026-07-28). VS Code extension half: fixture-only-with-residual-risk — the Kimi Code VS Code extension is NOT installed locally (code --list-extensions, 2026-07-28); per the extension's marketplace docs it reads the same ~/.kimi-code/mcp.json, unproven live. Re-run both legs against a leaf server after publish/extension install — and note kimi-code does NO env expansion (envExpansion: none): the harness applies env-reference, so the entry only authenticates in-session when the OS environment provides IRIS_PASSWORD — export it before the agent leg (or hand-apply in explicit mode with --confirm-secret), otherwise the post-publish launch fails on auth, not on the npx target.

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
