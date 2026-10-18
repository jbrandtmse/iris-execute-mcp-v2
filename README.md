# IRIS MCP Server Suite

> **Pre-Release** — This project is under active development and has not yet been published to npm or IPM. Install by cloning the repository (see [Quick Start](#quick-start) below). Package registry publishing is planned for a future release. See [CHANGELOG.md](CHANGELOG.md) for the full pre-release history — most recently the governance policy file (`IRIS_GOVERNANCE_FILE`), the multi-client configuration manager (`iris-mcp-clients`), and the `iris_execute_classmethod` fidelity work (output capture, `ByRef`/`Output` args, response-payload budget, request-body UTF-8 decoding) — and [`docs/epic-summary.md`](docs/epic-summary.md) for what each epic built.

**Give AI assistants structured, safe access to InterSystems IRIS.**

The IRIS MCP Server Suite is a collection of five specialized [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) servers that let AI coding assistants — Claude, Copilot, Cursor, and others — work directly with InterSystems IRIS. Each server covers a distinct operational domain so you can install only what you need.

---

## Servers

| Package | Domain | Tools | Description |
|---------|--------|------:|-------------|
| [@iris-mcp/dev](packages/iris-dev-mcp/README.md) | Development | 32 | ObjectScript document CRUD, guarded surgical line edits of existing documents (`iris_doc_edit`), compilation, SQL (with read-only mode, a rows-affected cap and a query-only tool, `iris_sql_query`), globals, code execution, unit tests, package browsing, bulk export, macro-expanded routine lookup, SQL query analysis and performance advisories, lines-of-code metrics, cross-profile environment diff & promotion (`iris_env_diff`, `iris_env_promote`), long-running test-run re-attach/read/cancel (`iris_test_status`), line coverage of a test run (`iris_test_coverage`, disabled by default) |
| [@iris-mcp/admin](packages/iris-admin-mcp/README.md) | Administration | 26 | Namespace, database, user, role, resource (incl. SQL privileges), web-app, SSL/TLS, OAuth2, service, LDAP, X.509, and audit management |
| [@iris-mcp/interop](packages/iris-interop-mcp/README.md) | Interoperability | 24 | Ensemble/Health Connect production lifecycle, production item management, system default settings, credentials, lookups, rules, transforms, message-trace Mermaid diagrams, message header and message body content search (`iris_message_search` — read-only, a required window of at most 7 days; the `body` action filters on body properties with validated, parameterised conditions and is under the PHI data policy: enabled by default, refused under `block`; the `searchTable` action finds messages by an indexed Search Table value, such as an HL7 medical record number, under the same policy), message body reading (`iris_message_body` — a read of 1 to 20 message bodies by header ID, rendered by kind and under the PHI data policy: enabled by default; an HL7 v2 body is redacted by default and every other body is withheld unless the policy is `allow`), message resend/replay (duplication hazard — preview before executing) |
| [@iris-mcp/ops](packages/iris-ops-mcp/README.md) | Operations & Monitoring | 21 | Composite health check (`iris_health_check` — one call, verdict + findings), system metrics, jobs, locks, journals, mirrors, audit, database integrity, licensing, ECP, tasks, alert management, process control, database maintenance operations, backups |
| [@iris-mcp/data](packages/iris-data-mcp/README.md) | Data & Analytics | 7 | DocDB document database, DeepSee analytics (MDX/cubes), REST API management |

> **110 tools** across 5 servers — install one or all. Each server additionally provides one framework tool, `iris_server_profiles` (see [Discovering profiles and policy](#discovering-profiles-and-policy-call-this-first)), so the advertised count per server is one greater than the package totals above.

### Meta-package

Once published, all servers will be installable at once with `npm install -g @iris-mcp/all`. See the [meta-package README](packages/iris-mcp-all/README.md) for details.

---

## Which Server Do I Need?

| Your Role | Recommended Server(s) |
|-----------|----------------------|
| **ObjectScript developer** | `@iris-mcp/dev` — compile, edit, execute code, run SQL, manage globals |
| **System administrator** | `@iris-mcp/admin` — manage namespaces, databases, users, roles, web apps, SSL, OAuth |
| **Integration engineer** | `@iris-mcp/interop` — control productions, configure credentials, manage business rules and transforms, search and read messages under the PHI data policy (`iris_message_search` and `iris_message_body` are reads, enabled by default) |
| **Operations / SRE** | `@iris-mcp/ops` — check overall instance health in one call (`iris_health_check`), monitor metrics, inspect jobs and locks, review journals, audit events, manage tasks |
| **Data / BI analyst** | `@iris-mcp/data` — query DocDB collections, run MDX against DeepSee cubes, manage REST APIs |
| **Full-stack / getting started** | `@iris-mcp/dev` + `@iris-mcp/admin`, or all five servers |

---

## Prerequisites

- **Node.js** 18 or later
- **InterSystems IRIS** 2023.1 or later (including IRIS for Health, HealthShare)
- **IRIS web port** accessible (default `52773`)

---

## Quick Start

Until packages are published to npm, install by cloning the repository and building from source.

### 1. Clone and Build

```bash
git clone https://github.com/jbrandtmse/iris-execute-mcp-v2.git
cd iris-execute-mcp-v2
pnpm install
pnpm turbo run build
```

> **Requires:** [Node.js](https://nodejs.org/) 18+ and [pnpm](https://pnpm.io/) 9+. Install pnpm with `npm install -g pnpm` if needed.

### 2. Set Environment Variables

All servers use the same environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `IRIS_HOST` | `localhost` | IRIS hostname or IP |
| `IRIS_PORT` | `52773` | IRIS web server port |
| `IRIS_USERNAME` | `_SYSTEM` | IRIS username |
| `IRIS_PASSWORD` | *(required)* | IRIS password |
| `IRIS_NAMESPACE` | `USER` | Default IRIS namespace |
| `IRIS_HTTPS` | `false` | Use HTTPS instead of HTTP |
| `IRIS_ACCEPT_LANGUAGE` | `en-US,en;q=0.9` | **Optional.** `Accept-Language` header value sent on every HTTP request, pinning IRIS's request-locale negotiation so `%Status` error text renders in a predictable language instead of whatever locale an unspecified header resolves to. This addresses ONE of two independent localization mechanisms — IRIS also selects a message table per worker process (unaffected by this header), so both English (`ERROR #`) and localized (e.g. `خطأ #`) prefixes can still appear; existing prefix-stripping is unaffected. |
| `MCP_TRANSPORT` | `stdio` | **Optional.** Only `stdio` is supported (`--transport` is equivalent); any other value fails startup naming it. |
| `IRIS_PROFILES` | *(unset)* | **Optional.** JSON map of named IRIS instances for multi-server use. Omit for single-server — the `IRIS_*` vars above define the reserved `default` profile. See [Multiple Servers & Governance](#multiple-servers--governance). |
| `IRIS_GOVERNANCE` | *(unset)* | **Optional.** JSON policy that enables/disables individual tool actions per profile. Omit to leave every tool enabled (today's behavior). See [Multiple Servers & Governance](#multiple-servers--governance). |
| `IRIS_GOVERNANCE_PRESET` | *(unset)* | **Optional.** `"read-only"` or `"full"` — a one-word safety preset that blocks every write action suite-wide. Omit (or `"full"`) for today's behavior. See [Read-only mode](#read-only-mode-point-it-at-production-with-one-environment-variable). |
| `IRIS_GOVERNANCE_FILE` | *(unset — inert)* | **Optional.** Path to a JSON file of the same shape as `IRIS_GOVERNANCE`, so one policy is portable across every MCP client. The file's layers sit strictly *below* the `IRIS_GOVERNANCE` env layers (an env setting always wins). **Unset ⇒ inert**: no file is ever read and behavior is byte-for-byte today's. Read once at startup (restart to apply edits); a missing/unreadable/malformed file fails startup naming the var and the path. See [Governance file](#governance-file-iris_governance_file). |
| `IRIS_AUDIT_LOG` | *(unset — OFF)* | **Optional.** Absolute path to a JSONL audit file recording every MCP tool call (who-ish/session, what, outcome, denials). Omit for today's behavior — a mechanical no-op, zero filesystem writes. See [Compliance & Auditability](#compliance--auditability). |
| `IRIS_AUDIT_LOG_MAX_MB` | `50` | **Optional.** Rotates the audit file at this size — the current file is renamed to `<path>.1` (single generation, overwriting a prior one) and a fresh file is started. Only relevant when `IRIS_AUDIT_LOG` is set. |
| `IRIS_AUDIT_LOG_PARAMS` | `false` | **Optional.** When `true`, audit entries also include each call's (redacted) parameter *values*; the default logs parameter *key names* only. Only relevant when `IRIS_AUDIT_LOG` is set. |
| `IRIS_SQL_MAX_ROWS` | *(unset — no cap)* | **Optional.** Positive integer ceiling on the number of rows `iris_sql_execute` and `iris_sql_query` **return** — a post-fetch cap on the response (it bounds the returned row count, not the server-side result set or transfer). Omit for today's behavior (only the per-call `maxRows`/1000-row default apply). |
| `IRIS_SQL_TIMEOUT` | *(unset — no override)* | **Optional.** Positive number of **seconds** — a per-request timeout override for the HTTP call of `iris_sql_execute` and `iris_sql_query`. Omit to use the connection's default `IRIS_TIMEOUT`. |
| `IRIS_SQL_READ_ONLY` | *(unset — SQL tools are not forced read-only)* | **Optional.** `true` or `false` (case-insensitive). `true` makes every `iris_sql_execute` call read-only: only queries (SELECT) run, any other statement is refused with `SQL_READ_ONLY`, and a call's `readOnly: false` cannot weaken it. Global: every profile inherits it; no per-profile key. A malformed value fails startup. |
| `IRIS_SQL_MAX_ROWS_AFFECTED` | *(unset — no ceiling)* | **Optional.** Non-negative integer ceiling (`0` is valid) on the rows one INSERT, UPDATE or DELETE may change through `iris_sql_execute`. A statement that changes more is rolled back and refused with `SQL_ROWS_AFFECTED_CAP`; a call's `maxRowsAffected` can only tighten it. Under a ceiling only SELECT, INSERT, UPDATE and DELETE run, and an INSERT, UPDATE or DELETE whose text contains the `%NOJOURN` token is refused before it runs. Global: every profile inherits it; no per-profile key. A malformed value fails startup. |
| `IRIS_TEST_TIMEOUT` | *(unset — 120s default)* | **Optional.** Positive number of **seconds** — the DEFAULT wait budget `iris_execute_tests` and `iris_test_coverage` wait before returning a "running" result (with the run's `jobId`/`runIndex` handles, or `coverageRunId`) instead of blocking further. A per-call `timeout` argument takes precedence over this. Hard-capped at 3600s regardless of source. Omit for today's 120-second default. |
| `IRIS_DATA_POLICY` | *(unset — `redact`)* | **Optional.** `block`, `redact` or `allow` (case-insensitive): the PHI data policy for every profile that no `IRIS_PROFILES` entry sets. Default **`redact`**: the `iris_message_resend` preview shows an HL7 v2 body only as its class name and withholds every other body with a reason, and `iris_message_body` shows an HL7 v2 body redacted by a reviewed keep-list and withholds every other body. `allow` restores today's preview exactly and lets `iris_message_body` show bodies as stored; `block` withholds every body and refuses the `body` and `searchTable` actions of `iris_message_search`, and withholds the Event Log text of `iris_production_logs` and the error text of `iris_message_diagram` (every one of these is a read, enabled by default). Per profile: the `dataPolicy` field of an `IRIS_PROFILES` entry, or the `dataPolicy` section of the governance file (`IRIS_GOVERNANCE` does not carry it). A malformed value fails startup naming the channel. See [PHI data policy](#phi-data-policy). |
| `IRIS_TOOLS_PRESET` | `full` | **Optional.** `"full"` (today's behavior) \| `"core"` (8- to 15-tool small-model subset, depending on the server) \| `"developer"` (persona filter, security/enterprise admin hidden). Unknown value fails fast at startup naming the valid values. Omit for today's `tools/list`, byte-for-byte. See [Tool Visibility Presets](#tool-visibility-presets). |
| `IRIS_TOOLS_DISABLE` | *(unset)* | **Optional.** Comma-separated tool names to hide from `tools/list`. Trailing-`*` wildcard supported (`iris_doc_*`); a bare `*` alone is rejected. Omit to hide nothing beyond the active preset. See [Tool Visibility Presets](#tool-visibility-presets). |
| `IRIS_TOOLS_ENABLE` | *(unset)* | **Optional.** Comma-separated tool names to force-show, overriding both the preset and `IRIS_TOOLS_DISABLE` (punches a hole in a hidden family). Omit for no overrides. See [Tool Visibility Presets](#tool-visibility-presets). |
| `IRIS_SERVER_MANAGER` | `off` | **Optional.** `off` (default — today's behavior, no settings file is ever read) \| `auto` (import connection definitions from the InterSystems Server Manager VS Code extension) \| `required` (as `auto`, but fail startup if no definition is found). Unknown value fails fast at startup naming the valid values. See [Server Manager connections](#server-manager-connections-optional). |
| `IRIS_SM_SERVERS` | *(unset — import all)* | **Optional.** Comma-separated allow-list of `intersystems.servers` names to import, so you get the two servers you want instead of your whole roster. A listed name that matches nothing warns (it fails only under `IRIS_SERVER_MANAGER=required`, where nothing would be imported at all). Only relevant when `IRIS_SERVER_MANAGER` is `auto`/`required`. |
| `IRIS_SM_SETTINGS_PATHS` | *(unset — normal discovery)* | **Optional.** Escape hatch: a `;`-separated (Windows) / `:`-separated (macOS, Linux) list of `settings.json` paths that **replaces** discovery entirely. Only relevant when `IRIS_SERVER_MANAGER` is `auto`/`required`. |
| `IRIS_SM_WORKSPACE` | *(unset — the process CWD)* | **Optional.** Directory whose `.vscode/settings.json` is used as the highest-precedence source. Set it explicitly when the MCP client's working directory is not the workspace you mean. Only relevant when `IRIS_SERVER_MANAGER` is `auto`/`required`. |
| `IRIS_CREDENTIAL_HELPER` | *(unset)* | **Optional.** A command run with the Server-Manager profile name appended as its **final argument**; the command's trimmed stdout is the password. Because the name is always appended, point this at a small wrapper script that uses it (e.g. a script running `op read "op://vault/$1/password"` or `pass show "iris/$1"`) rather than at a bare `op read …`/`pass show …`, which would reject the extra argument. Run without a shell, so on Windows point it at a real `.exe` (a `.cmd`/`.bat` shim needs `cmd /c <your-helper.cmd>`). Runs synchronously per password-less profile with a 10s timeout, so keep `IRIS_SM_SERVERS` tight if the helper can hang. Link 3 of the credential chain — see [Server Manager connections](#server-manager-connections-optional). Only relevant when `IRIS_SERVER_MANAGER` is `auto`/`required` and a profile still lacks a password after the OS-keychain link. |

> **Single-server installs need no changes.** `IRIS_PROFILES`, `IRIS_GOVERNANCE`, `IRIS_GOVERNANCE_PRESET`, `IRIS_GOVERNANCE_FILE`, `IRIS_AUDIT_LOG`, `IRIS_AUDIT_LOG_MAX_MB`, `IRIS_AUDIT_LOG_PARAMS`, `IRIS_SQL_MAX_ROWS`, `IRIS_SQL_TIMEOUT`, `IRIS_SQL_READ_ONLY` (unset: nothing forced read-only), `IRIS_SQL_MAX_ROWS_AFFECTED` (unset: no ceiling), `IRIS_TEST_TIMEOUT`, `IRIS_DATA_POLICY` (unset: `redact`), `IRIS_TOOLS_PRESET`, `IRIS_TOOLS_DISABLE`, `IRIS_TOOLS_ENABLE`, `IRIS_SERVER_MANAGER`, `IRIS_SM_SERVERS`, `IRIS_SM_SETTINGS_PATHS`, `IRIS_SM_WORKSPACE`, and `IRIS_CREDENTIAL_HELPER` are all optional and additive. With none set, the suite behaves exactly as it always has — the six `IRIS_*` variables above are all you need — with one deliberate exception: the default data policy `redact` changes what the `iris_message_resend` preview shows of a message body (see [PHI data policy](#phi-data-policy); `IRIS_DATA_POLICY=allow` restores today's output). (The one behavior that *did* change for single-server installs is startup against an unreachable instance: it no longer exits. See [Backward Compatibility](#backward-compatibility).)

#### Server Manager connections (optional)

If you already curate IRIS connections in the [InterSystems Server Manager](https://marketplace.visualstudio.com/items?itemName=intersystems-community.servermanager) VS Code extension, set `IRIS_SERVER_MANAGER=auto` and the suite reads those `intersystems.servers` definitions straight out of your VS Code settings files — no re-typing host/port/username into every MCP client config. Each imported definition becomes a named profile you address with the `server` parameter, exactly like an `IRIS_PROFILES` entry.

> **⚠️ Read this first — Server Manager import is ADDITIVE, and the keychain does NOT cover your base credentials.**
>
> **The six base variables are still required.** `IRIS_HOST`, `IRIS_PORT`, `IRIS_USERNAME`, `IRIS_PASSWORD`, `IRIS_NAMESPACE` and `IRIS_HTTPS` configure the reserved `default` profile, and `default` is built **before** any Server Manager import. Setting `IRIS_SERVER_MANAGER=auto` **does not let you omit them** — the server fails at startup with `IRIS_USERNAME environment variable is required` (then `IRIS_PASSWORD…`) if you try. Server Manager adds *extra* addressable profiles; it does not replace your primary connection.
>
> **The OS keychain serves Server-Manager-discovered profiles ONLY.** `iris-mcp-credentials set <name>` stores a password that the credential chain uses for an **imported** definition that has none. It is **not** consulted for `IRIS_PASSWORD`: storing an entry named `default` has no effect, because `loadConfig` reads the base credentials from the environment and never calls the chain. So today the keychain reduces plaintext for your *additional* servers — it cannot remove `IRIS_PASSWORD` from your client config.
>
> Worked example: with `IRIS_HOST`/`IRIS_USERNAME`/`IRIS_PASSWORD` set for `default`, `IRIS_PROFILES` adding `sademo`, `IRIS_SERVER_MANAGER=auto` importing `local` (inline password) and `localhost2` (keychain, via `iris-mcp-credentials set localhost2`), all four resolve and route — but removing `IRIS_PASSWORD` breaks startup for all of them.

- **Default is `off`.** Nothing is read, nothing is imported, and no settings file is touched unless you opt in.
- **Discovery order** (highest precedence first), mirroring VS Code's own folder > workspace > user scope ranking: (1) the workspace `.vscode/settings.json` (from `IRIS_SM_WORKSPACE`, else the process working directory); (2) every `*.code-workspace` file directly inside that same directory, sorted by filename — multi-root workspaces commonly keep `intersystems.servers` only there; (3) each product's user settings — `Code`, `Code - Insiders`, `VSCodium`, `Cursor` (`%APPDATA%\<Product>\User\settings.json` on Windows, `~/Library/Application Support/<Product>/User/settings.json` on macOS, `$XDG_CONFIG_HOME/<Product>/User/settings.json` then `~/.config/<Product>/User/settings.json` on Linux); (4) on Linux only, Flatpak sandboxes — `~/.var/app/{com.visualstudio.code,com.visualstudio.code.insiders,com.vscodium.codium}/config/<Product>/User/settings.json`. The first file to define a name wins. A name already defined by `IRIS_*` or `IRIS_PROFILES` always wins over a Server Manager definition.
- **Linux specifics.** VS Code is Electron, whose Linux config root is `$XDG_CONFIG_HOME` *or* `~/.config` — so both are searched, XDG first. A Flatpak install cannot write `~/.config` at all (Flatpak redirects the app's `XDG_CONFIG_HOME` into its sandbox), so the three published Flathub apps are searched too, after the native paths. Cursor is not published on Flathub and therefore has no Flatpak entry; use `IRIS_SM_SETTINGS_PATHS` for any install layout not listed here, including VS Code portable mode.
- **Both settings-file shapes are understood.** A `settings.json` holds `intersystems.servers` at the top level; a `.code-workspace` file nests every setting under a `settings` key. Either works, including when named explicitly in `IRIS_SM_SETTINGS_PATHS`.
- **Passwords are not readable directly, but a credential chain completes them.** Server-Manager-saved passwords live in VS Code SecretStorage and are cryptographically unreachable from outside VS Code — by design, with no supported extraction path. For any imported definition that lacks a password, the suite tries, in order: (1) the OS keychain (Windows Credential Manager / macOS Keychain / libsecret), service `iris-mcp`, account `<name>` — set with the [`iris-mcp-credentials` CLI](#iris-mcp-credentials-cli) below; (2) `IRIS_CREDENTIAL_HELPER`. A definition carrying a legacy inline `password` still works too (with a deprecation warning), provided it also declares its own `username` — see the next bullet. If every link is exhausted, the profile is excluded at startup with a log line naming the remediations; under `IRIS_SERVER_MANAGER=required` this fails startup instead.
- **`IRIS_PROFILES` replaces a Server Manager definition — it does not complete one.** If a name exists in both, the environment wins and the Server Manager definition is discarded *entirely*, host and username included (a warning names the collision). So an `IRIS_PROFILES` entry that supplies **only** a password will quietly give you a profile pointed at your **local** `IRIS_HOST`/`IRIS_USERNAME`, not at the Server Manager host. To supply a password for a Server Manager definition, use the OS keychain or `IRIS_CREDENTIAL_HELPER`; use `IRIS_PROFILES` only when you are defining the whole connection there.
- **A Server-Manager entry needs its own `username`.** An entry that omits `username` (relying on the local default's username) is **not imported at all** — a warning names the file and the fix. Pairing an inherited username with a password destined for a different remote host risks repeated authentication failures that can lock out the account there. Add `"username"` to the `intersystems.servers` entry to opt in. *(Changed in this release: such an entry previously imported successfully when it carried an inline `password`.)*
- **The same name in two settings files.** The first (highest-precedence) file wins. The one exception: if that definition has no password of its own and a lower-precedence file's definition carries an inline `password`, the lower-precedence definition is imported instead — **including its host, port and username** — and a warning names both hosts. Store a password for the name (`iris-mcp-credentials set <name>`) to make the higher-precedence definition win.
- **`auto` reads the working directory.** Because the workspace candidate defaults to the process CWD, a repository you have merely cloned can contribute connection definitions. Set `IRIS_SM_WORKSPACE` explicitly, or pin `IRIS_SM_SERVERS`, when working in repositories you do not control.
- **Changes require a restart**, exactly like the `IRIS_*` environment variables.
- **See where every profile came from.** `iris_server_profiles` (the [discovery tool](#discovering-profiles-and-policy-call-this-first)) reports a `source` field on every roster entry — `"env"` (from `IRIS_*`/`IRIS_PROFILES`) or `"server-manager"` (imported from a settings file) — plus `sourceFile`, the exact settings file a Server-Manager-sourced profile came from. Both are attribution only: they never affect which actions governance allows, only where you look to change a connection's host/port/username. The optional `IRIS_AUDIT_LOG` audit trail (see [Compliance & Auditability](#compliance--auditability)) likewise records `profileSource` per call, for the same reason.
- **`sourceFile` is a local path, and your AI client sees it.** It never contains a password — but it *is* a real filesystem path, so when a profile comes from a **user-scope** settings file it includes your OS account name (e.g. `C:\Users\jsmith\AppData\Roaming\Code\User\settings.json`), and when it comes from a workspace it includes that directory. Because the roster is returned to the connected MCP client, that path is visible to the model. This is deliberate: a bare filename would be useless — every candidate file is called `settings.json`, so the folder is the whole point. If you would rather not disclose local paths, define the connections you expose at workspace scope (`IRIS_SM_WORKSPACE`), or leave `IRIS_SERVER_MANAGER` off and use `IRIS_PROFILES`.

#### VS Code extension: IRIS MCP Launcher (optional, Copilot-family only)

If you're inside VS Code with GitHub Copilot (or another client that consumes VS Code's built-in MCP server
registry), there's a **fourth** way to connect that sidesteps the credential chain above entirely:
[`extensions/iris-mcp-launcher/`](extensions/iris-mcp-launcher/README.md), a standalone, optional VS Code
extension (outside this repo's npm workspace) that registers the `@iris-mcp/*` servers directly with VS Code and
resolves credentials from Server Manager's `vscode.authentication` session **inside the extension host** — the
one place a Server-Manager-saved SecretStorage password actually is reachable. No OS keychain setup, no
`IRIS_CREDENTIAL_HELPER`, no `IRIS_PROFILES` password entry required.

**This only helps Copilot-family agents** *for launching servers*. Claude Code manages its own MCP configuration
(`claude mcp add` / `.mcp.json`) and does not consume VS Code's MCP registry — Claude Code users should use the
`IRIS_SERVER_MANAGER`/credential-chain path documented above instead. See the extension's own README for the
verified client-coverage boundary and citations.

**The extension carries three surfaces**, and two of them help *every* client, not just Copilot:

| Command (category "IRIS MCP Launcher") | What it does |
| --- | --- |
| **Select Servers…** | Choose which Server Manager servers become MCP servers; a status bar item shows how many are registered |
| **Manage MCP Clients…** | Wire the suite into any of the 13 supported MCP clients — detect, per-server enable/disable, diff preview, backup/restore, doctor. The GUI front-end for [`iris-mcp-clients`](#the-manager-iris-mcp-clients-recommended); **useful to Claude Code / Cursor / Cline users too** |
| **Open Governance Editor** | Visually edit the shared [governance policy file](#governance-file-iris_governance_file) that every client's servers read |

**Installing it (not yet on any Marketplace).** Build a VSIX from this checkout and install it, then point it at
your checkout — full steps, including the reload/reinstall gotchas, are in
[the extension's install section](extensions/iris-mcp-launcher/README.md#installing-in-development-mode):

```bash
cd extensions/iris-mcp-launcher && npm install && npm run build
npx vsce package --allow-missing-repository        # -> iris-mcp-launcher-0.1.0.vsix
code --install-extension "$PWD/iris-mcp-launcher-0.1.0.vsix"
# then: Developer: Reload Window, and set irisMcpLauncher.developmentRepoPath to this repo's absolute path
```

#### Where do Server Manager passwords come from? (the canonical answer)

**Short version: a Server Manager password is never readable outside VS Code, by design — but the suite can still get one from you through three other doors.**

VS Code's Server Manager extension stores passwords in its own encrypted SecretStorage (backed by the OS's `safeStorage`/keychain, app-bound to VS Code itself). There is no supported API, file, or database an external process — including this suite — can read to recover that value. If you set `IRIS_SERVER_MANAGER=auto`/`required` and a Server-Manager-sourced profile still shows no password at startup, this is why, and it is expected. Complete it one of these three ways instead:

1. **OS keychain (recommended).** Run `iris-mcp-credentials set <name>` once per machine (see the [CLI](#iris-mcp-credentials-cli) below) — it stores the password in the same class of OS-native secure storage (Windows Credential Manager / macOS Keychain / libsecret) that VS Code itself uses, just under this suite's own service name (`iris-mcp`). This is the credential chain's link 2 and needs no config file.
2. **`IRIS_CREDENTIAL_HELPER`.** Point this environment variable at a command (e.g. a wrapper around `op`, `pass`, or your organization's secret manager) that prints the password to stdout when given the server name. Useful when you already have a secrets tool and don't want a second, suite-specific store.
3. **`IRIS_PROFILES` — but only as a *full replacement*, never a patch.** An `IRIS_PROFILES` entry for the same name does not "add a password" to the Server Manager definition; it **replaces it entirely**, including host/port/username. Use this only when you want to define the connection outside Server Manager altogether.

If none of the three is set up, the profile is excluded at startup (a log line names all three remediations) rather than started with a missing or wrong credential; under `IRIS_SERVER_MANAGER=required` this fails startup instead of degrading silently.

#### `iris-mcp-credentials` CLI

A small command-line tool — ships as a `bin` in `@iris-mcp/shared`, built to `packages/shared/dist/cli/credentials-cli.js` — for the one-time per-machine setup referenced above: storing, listing, testing, and removing IRIS passwords in the OS keychain, so the OS-keychain link of the credential chain never needs a hand-edited config file containing a password. Not yet published to npm (see [Quick Start](#quick-start)), so invoke it directly with `node`:

```bash
node packages/shared/dist/cli/credentials-cli.js set myserver
```

| Command | Effect |
|---------|--------|
| `set <name>` | Store a password for `<name>` in the OS keychain. Interactive by default — prompts with echo suppressed; `--stdin` reads the password from a pipe or file instead (a leading UTF-8 BOM and a single trailing newline are stripped) for scripted/CI use. `--stdin` is **refused when stdin is a terminal**, because reading a TTY does not suppress echo and the password would appear in cleartext. A password is **never** accepted as a command-line argument — it would land in shell history and any same-user process listing. |
| `delete <name>` | Remove the stored password for `<name>`. A missing entry is exit code 1, not an error. |
| `list [--json]` | List stored server **names only** — no password value is ever printed, logged, or serialized. (The native `findCredentials(service)` API returns `{account, password}` pairs and offers no account-only entry point, so passwords do transit process memory during enumeration; the CLI discards them at the first opportunity and never touches them again.) Enumeration is verified against the Windows Credential Manager; macOS Keychain and libsecret back-ends may enumerate differently. `set`, `delete` and `test` are unaffected. |
| `test <name> [--connect] [--json]` | Run the real credential chain for `<name>` (env → OS keychain → credential helper) and report which link resolved it. `--connect` additionally performs a live Atelier `HEAD /api/atelier/` check against the mapped profile, reusing the same health-check path the servers use at startup. `--connect` needs `<name>` to map to a connection profile **in the shell running the CLI** — i.e. `IRIS_SERVER_MANAGER=auto` (or an `IRIS_PROFILES` entry), plus `IRIS_USERNAME`/`IRIS_PASSWORD` for the reserved `default` profile. Without them the credential check still reports correctly and only the connectivity half fails, naming this remedy. |

A `<name>` that is empty, whitespace-only, or contains a newline or control character is rejected (exit 2) before the keychain is touched. Use `--` to address a name that begins with `-`, e.g. `iris-mcp-credentials delete -- --json`.

Every password is stored under OS-keychain service `iris-mcp`, account `<name>` — the exact key the credential chain's OS-keychain link (link 2, above) reads, so a name you `set` here is immediately usable once `IRIS_SERVER_MANAGER=auto`/`required` is set (default `off` — see the variable table above).

Exit codes are consistent across all four commands: `0` success · `1` not found / credential unresolved / OS keychain unavailable (or a failed `--connect` check) · `2` usage or input error (unknown command, missing or extra argument, unknown option, invalid server name, empty password, aborted prompt).

`--json` output is available on `list` and `test`. Its contract: an **operational** outcome (exit 0 or 1) always writes exactly one JSON object to stdout — on failure that is `{"error": "..."}` for `list`, and an `error` field alongside the usual fields for `test`. **Usage errors (exit 2) are always plain text on stderr**, because the flags themselves were not understood. Human-readable failures always go to stderr, so `... --json 2>/dev/null | jq` works while a human still sees the error.

Every output path — human text, `--json`, `--help`, and error/failure messages, including a failed `--connect` — is secret-free: known secrets are substring-redacted, and a secret too short to redact safely causes the whole message body to be withheld. Unlike the credential chain's own OS-keychain link (which silently skips to the next link when the native keychain module is unavailable), this CLI's `set`/`delete`/`list` fail loudly with a non-zero exit and an actionable message, since operating on the OS keychain is the whole point of the command. Run `node packages/shared/dist/cli/credentials-cli.js --help` for full usage.

#### `iris-mcp-governance` CLI

A small command-line tool — ships as a second `bin` in `@iris-mcp/shared`, built to `packages/shared/dist/cli/governance-cli.js` — for validating, inspecting, and editing a [governance file](#governance-file-iris_governance_file) with the SAME engine the servers enforce with: every parse goes through the server's own loader (so `validate` prints the exact error text a server would fail startup with), and `effective`/`diff` compose the shared cascade functions directly rather than reimplementing them. Opt-in and agent-agnostic — with no file configured, the servers are unaffected. Not yet published to npm (see [Quick Start](#quick-start)), so invoke it directly with `node`:

```bash
node packages/shared/dist/cli/governance-cli.js validate --file C:\governance\iris-policy.json
```

| Command | Effect |
|---------|--------|
| `validate [--file <path>] [--json]` | Parse and validate the file with the same loader the servers use at startup. Exit 1 (the server's exact error text, naming `IRIS_GOVERNANCE_FILE` + the path) when invalid. |
| `get <key> [--profile <name>] [--json]` | Print the key's explicit value **in the file** (`true`/`false`/unset) — the file's own layer, not the cascade. |
| `set <key> true\|false [--profile <name>]` | Write the key into the file (creating the file when missing). Atomic write (temp + rename in the same directory), existing key order preserved, the written file automatically re-validated with rollback on failure. Reserved keys (`__proto__` etc.) are rejected; a key outside the frozen baseline warns on stderr but is still written (post-foundation keys like `iris_env_promote:execute` are legitimate). |
| `unset <key> [--profile <name>]` | Remove the key from the file. Exit 1 when the key is not set (the `iris-mcp-credentials delete` not-found convention). |
| `preset read-only\|full` | Print the env-level wiring for `IRIS_GOVERNANCE_PRESET` — **writes nothing**: the servers source the preset from their process environment only, never from a governance file. |
| `effective [--profile <name>] [--json]` | Render the SAME cascade the servers compute (`env.profile ?? env.global ?? file.profile ?? file.global ?? presetSeed ?? defaultSeed`) for the CLI's own environment plus the resolved file, with the per-key `configSource` (`env`\|`file`\|`preset`\|`default`). It renders the frozen baseline's keys only, and no baseline key has a [parent](#parent-keys-a-new-tool-that-re-exposes-an-existing-one), so an inherited disable (source `parent`) shows only in `universe`. |
| `diff [--json]` | Compare every key the file sets against its default-seed value. |
| `universe [--profile <name>] [--root <path>] [--json]` | Render the **full** governed-key universe — the frozen baseline ∪ the five server packages' registered tool keys (derived from their built dist, the same derivation the suite's cross-package tests use) ∪ the framework `iris_server_profiles` tool — with the real `mutates`/default-enabled classifications, per-key effective value, and `configSource`. This is the render a running server's `iris_server_profiles` computes over its own registered subset; post-foundation write keys seed default-DISABLED here (unlike `effective`/`diff`). Needs the packages' built dist locatable: `--root` names a monorepo root (or package container dir); otherwise auto-detected from the CLI's own install location. |
| `check [--file <path>] [--root <path>] [--json]` | Check every key in `IRIS_GOVERNANCE` and in the resolved file against the **full** governance-key universe (the keys `universe` lists). A key that is none of them has no effect on any server: a typo such as `iris_doc_putt`, a bare name for a per-action tool, an action on a single-operation tool, or an action a tool does not have. One message per such key on stderr, then a summary; exit 1 when any key matches nothing. A server only warns about these keys at startup, and only for the tools it registers, so `check` is the suite-wide check. Needs the same built dist as `universe` (`--root` works the same way). |

**Default file resolution** — `--file <path>` wins; otherwise `IRIS_GOVERNANCE_FILE` from the environment. Explicit path only: the CLI never discovers or searches for a file (architecture decision J1). Exit codes: `0` success · `1` operational failure (file unreadable/invalid per the server loader, a key not set for `unset`, a key that matches nothing for `check`) · `2` usage error. `--json` on the read commands (`validate`, `get`, `effective`, `diff`, `universe`, `check`) always emits exactly one parseable JSON object to stdout on an operational outcome — including failures; usage errors (exit 2) are always plain text on stderr.

One caveat: the full governance-key universe is the frozen baseline plus each server's registered tool keys, which `validate`/`get`/`set`/`unset`/`effective`/`diff` cannot enumerate (importing a server package would be a circular dependency). `effective`/`diff` therefore render over the baseline plus keys mentioned in any config layer — a post-foundation key mentioned nowhere renders with the read-default seed (enabled) even when a real server would seed it disabled. The `universe` command closes that gap by deriving the registered half from built dist, and `iris_server_profiles` on a running server remains the authoritative render. Run `node packages/shared/dist/cli/governance-cli.js --help` for full usage.

### 3. Configure Your MCP Client

Point your MCP client at the built server using `node` and the local `dist/index.js` path. Replace `/path/to/iris-execute-mcp-v2` with the actual path where you cloned the repo.

> **📖 [MCP client configuration index](docs/client-config/README.md)** — copy-pasteable config for **13 clients** (Claude Code, VS Code/Copilot, Cline, Kimi Code, Kimi CLI, Codex CLI, Cursor, Claude Desktop, Windsurf, Roo Code, Gemini CLI, Zed, Goose), a format/root-key matrix (three formats and four different root keys between them), and the two credential caveats above restated where you need them.

#### The manager: `iris-mcp-clients` (recommended)

The [`@iris-mcp/client-config`](packages/client-config/README.md) package ships the **`iris-mcp-clients`** CLI — one tool that wires any of the 13 supported clients for you instead of hand-editing config files: it detects which clients are installed, previews the exact edit, writes through a backup-on-write engine, toggles entries, rolls back, and diagnoses the result. Not yet published to npm (see [Quick Start](#quick-start)), so invoke the built bin directly with `node`:

```bash
node packages/client-config/dist/cli/clients-cli.js detect                    # which clients are installed
node packages/client-config/dist/cli/clients-cli.js diff --client claude-code --servers iris-dev-mcp
node packages/client-config/dist/cli/clients-cli.js apply --client claude-code --servers iris-dev-mcp
node packages/client-config/dist/cli/clients-cli.js doctor                    # env refs, parseability, drift, backups, stashes
```

`apply` prints the pending diff first and requires confirmation (`--yes` to skip); every successful write takes a timestamped backup and prints the client's restart hint.

**The zero-secrets end state** — three composable pieces, each covering a different secret class:

1. **Server Manager + OS keychain** (Epic 31): `--mode server-manager` writes entries carrying `IRIS_SERVER_MANAGER=auto` — connections come from your InterSystems Server Manager profiles, passwords from the OS keychain via `iris-mcp-credentials set <name>`; nothing secret in the config file.
2. **Governance file** (Epic 32): `--mode governance-file` writes entries carrying `IRIS_GOVERNANCE_FILE=<path>` — one shared policy file governs every server's tool surface; the file holds no credentials.
3. **VS Code native inputs** (default `env-reference` mode on VS Code): the password is never stored — the manager merges a native `inputs` prompt (`${input:iris-password}`) so VS Code asks once and keeps it out of the file.

Which clients/config surfaces are proven: the [adapter certification table](packages/client-config/README.md#certification-dispositions-generated) (Claude Code, VS Code, Cline and Kimi Code are certified-live as of 2026-07-28; the rest carry explicit fixture-only-with-residual-risk dispositions — re-provable anywhere with `node packages/client-config/scripts/certify.mjs run <client> --real-config`).

The manual per-client snippets below remain as the fallback (and as the reference for what the manager writes).

#### Claude Code (`.mcp.json`)

Create a `.mcp.json` file in your project root:

```json
{
  "mcpServers": {
    "iris-dev-mcp": {
      "command": "node",
      "args": ["/path/to/iris-execute-mcp-v2/packages/iris-dev-mcp/dist/index.js"],
      "env": {
        "IRIS_HOST": "localhost",
        "IRIS_PORT": "52773",
        "IRIS_USERNAME": "_SYSTEM",
        "IRIS_PASSWORD": "SYS",
        "IRIS_NAMESPACE": "USER"
      }
    }
  }
}
```

> **Note:** Replace `"SYS"` with your actual IRIS password. Avoid committing real credentials to version control.

#### Claude Desktop (`claude_desktop_config.json`)

Add to your Claude Desktop configuration:

```json
{
  "mcpServers": {
    "iris-dev-mcp": {
      "command": "node",
      "args": ["/path/to/iris-execute-mcp-v2/packages/iris-dev-mcp/dist/index.js"],
      "env": {
        "IRIS_HOST": "localhost",
        "IRIS_PORT": "52773",
        "IRIS_USERNAME": "_SYSTEM",
        "IRIS_PASSWORD": "SYS",
        "IRIS_NAMESPACE": "USER"
      }
    }
  }
}
```

To add more servers, include additional entries under `mcpServers` using the same pattern. For example, to add admin tools:

```json
{
  "mcpServers": {
    "iris-dev-mcp": {
      "command": "node",
      "args": ["/path/to/iris-execute-mcp-v2/packages/iris-dev-mcp/dist/index.js"],
      "env": { "IRIS_PASSWORD": "SYS" }
    },
    "iris-admin-mcp": {
      "command": "node",
      "args": ["/path/to/iris-execute-mcp-v2/packages/iris-admin-mcp/dist/index.js"],
      "env": { "IRIS_PASSWORD": "SYS" }
    }
  }
}
```

**All server entry points:**

| Server | Path (relative to repo root) |
|--------|------------------------------|
| dev | `packages/iris-dev-mcp/dist/index.js` |
| admin | `packages/iris-admin-mcp/dist/index.js` |
| interop | `packages/iris-interop-mcp/dist/index.js` |
| ops | `packages/iris-ops-mcp/dist/index.js` |
| data | `packages/iris-data-mcp/dist/index.js` |

### 4. Verify

Ask your AI assistant:

> "List the IRIS namespaces" (with `@iris-mcp/admin`)

or

> "Show me the globals in the USER namespace" (with `@iris-mcp/dev`)

If the assistant returns results from your IRIS instance, you are connected.

---

## Multiple Servers & Governance

Two optional environment variables — `IRIS_PROFILES` and `IRIS_GOVERNANCE` — let one MCP server process target **several IRIS instances** and **restrict which tool actions are allowed** per instance. Both are JSON values set in your MCP client's `env` block (or, for governance, in a JSON *file* referenced by `IRIS_GOVERNANCE_FILE` — see [Governance file](#governance-file-iris_governance_file)). **Neither is required**: with both unset, the suite behaves exactly as a single-server, fully-enabled install (see [Backward Compatibility](#backward-compatibility) below).

> **Where to put the escaped JSON:** because `IRIS_PROFILES`/`IRIS_GOVERNANCE` are JSON *strings* that live inside your client's JSON config, the inner quotes must be escaped. See the per-client guides for copy-pasteable, correctly-escaped blocks: [Claude Code](docs/client-config/claude-code.md), [Claude Desktop](docs/client-config/claude-desktop.md), [Cursor](docs/client-config/cursor.md).
>
> **Programmatic config updates:** if you write the config file with a JSON serializer (Python `json.dump`, Node `JSON.stringify`, etc.), pass `IRIS_PROFILES`/`IRIS_GOVERNANCE` as a plain string — the serializer escapes the inner quotes automatically. Do **not** pre-escape the string yourself; that produces double-escaped output (`\\"`) and the server will fail to parse the value at startup.

### Profiles (`IRIS_PROFILES`)

A **profile** is a named IRIS instance — a host, port, and credentials. `IRIS_PROFILES` is a JSON object keyed by profile name:

```json
{
  "prod":  { "host": "iris-prod.example.com",  "port": 443,   "username": "svc_mcp", "password": "...", "namespace": "HSCUSTOM", "https": true },
  "stage": { "host": "iris-stage.example.com", "port": 52773, "username": "svc_mcp", "password": "...", "namespace": "USER" }
}
```

Each profile may carry `host`, `port`, `username`, `password`, `namespace`, and `https`. **Omitted fields are inherited** from the reserved `default` profile (which is synthesized from your `IRIS_HOST` / `IRIS_PORT` / `IRIS_USERNAME` / `IRIS_PASSWORD` / `IRIS_NAMESPACE` / `IRIS_HTTPS` variables). So a profile that only overrides the host inherits the rest of the default's connection settings.

**Selecting a profile per call.** Every tool gains an optional `server` parameter that carries **only the profile name** — credentials never travel over the wire, they stay in the server process. Omit `server` and the call runs against the `default` profile (today's behavior).

`server` and the existing per-call `namespace` parameter compose cleanly: **`server` picks the instance, `namespace` picks the namespace within it.** For example, `iris_global_list({ server: "prod", namespace: "%SYS" })` lists globals in `%SYS` on the `prod` instance, regardless of `prod`'s default namespace.

**Profiles are independent at startup.** Every profile — `default` included — establishes its connection (health check, then Atelier-version negotiation, then a one-time bootstrap where applicable) on its own; one profile being unreachable never blocks or fails another. Non-`default` profiles have always connected lazily, on their first call. `default` is additionally attempted *eagerly* at startup as a warm-up (so its bootstrap report appears in the startup log), but that attempt is non-fatal: if it fails, the server still starts and serves every reachable profile, and `default` itself falls back to the same lazy on-first-call path — recovering automatically once it becomes reachable, no restart required. The eager `default` warm-up is bounded by the 5-second health-check timeout, so an unreachable `default` delays startup by at most that — it never blocks it. See [Backward Compatibility](#backward-compatibility) below.

### Governance (`IRIS_GOVERNANCE`)

`IRIS_GOVERNANCE` is a JSON policy that enables or disables individual tool **actions**, optionally per profile. It has a `global` baseline and per-`profiles` overrides:

```json
{
  "global":   { "<tool>": true, "<tool>:<action>": false },
  "profiles": { "prod": { "<tool>:<action>": false } }
}
```

A governance **key** is the tool name for single-operation tools (e.g. `iris_metrics_system`) or `tool:action` for multi-action tools (e.g. `iris_database_manage:delete`). The value is a boolean: `true` = allowed, `false` = blocked.

**Only `global` and `profiles` carry policy.** A top-level key that looks like governance but would be silently ignored fails startup, naming the variable, the key and the documented shape, and never echoing the value: a name that starts with `iris_` (in any letter case), or a key with a boolean or object value. Examples are a flat `{"iris_doc_put": false}`, a top-level profile such as `{"prod": {...}}`, and a misspelled layer such as `"globals": {...}`; put the key under `global` to apply it to every profile, or under `profiles` for one profile. Plain metadata keys with a string, number, null or array value, such as `comment` and `version`, are ignored. A profile name under `profiles` that is not a configured profile does not fail startup: it logs one `[WARN]` naming the profile and the configured profiles, and its overrides apply to no connection.

**A key that names nothing only warns.** A key inside `global` or a profile that is none of a tool's keys is accepted and does nothing: a bare name for a per-action tool (`{"global": {"iris_doc_edit": false}}` leaves the default-enabled `iris_doc_edit:apply` enabled), an action on a single-operation tool (`iris_doc_put:apply`), an action the tool does not have, or a misspelled tool name such as `iris_doc_putt`. A server logs one `[WARN]` per such key for the tools it registers (a tool hidden by a visibility preset counts as registered), naming the key, the layer and the keys to use instead, and never the value. It still starts, and the effective policy is the one it would report without the key. A key whose tool the server does not register stays silent, because one document serves all five servers and a newer server may add keys; that includes a misspelled tool name, which only `iris-mcp-governance check` reports. To check every key against the whole suite, run [`iris-mcp-governance check`](#iris-mcp-governance-cli), which exits 1 when a key matches nothing. A valid document starts and reports exactly as before.

**Effective policy** for a given action on a given profile resolves in this order:

```
effective = env.profile(key) ?? env.global(key) ?? file.profile(key) ?? file.global(key) ?? inheritedDisable(key) ?? presetSeed(key) ?? defaultSeed(key)
```

That is: a per-profile `IRIS_GOVERNANCE` setting wins; otherwise the global `IRIS_GOVERNANCE` setting; otherwise the governance *file's* per-profile setting; otherwise the file's global setting (see [Governance file](#governance-file-iris_governance_file) — with no file configured, both file layers are simply absent); otherwise a disable **inherited from the key's parent key** (only a key that declares a parent has one — see [Parent keys](#parent-keys-a-new-tool-that-re-exposes-an-existing-one)); otherwise the [preset](#read-only-mode-point-it-at-production-with-one-environment-variable); otherwise the **default seed**. **All env layers sit above all file layers** — a pre-existing `IRIS_GOVERNANCE` setting can never be overridden by a governance file introduced later.

**The default seed** (what happens when neither `global` nor `profiles` mentions a key):

- Every **existing** tool action (everything shipped before governance) → **enabled**.
- Every **new read** action → **enabled**.
- Every **new write / change** action → **disabled** (opt-in). Newly-added mutating capability stays off until you explicitly enable it.

The "existing action" baseline is generated mechanically from the shipped tool catalog, so no pre-existing action is ever disabled by default.

**Enforcement is call-time.** The policy is checked in the shared framework *after* the `server` profile is resolved and *before* the tool handler runs — it has to be call-time, because the governing profile is chosen per call via `server`. All tools stay advertised in `tools/list`; a blocked action does not run the handler and instead returns a structured error:

```json
{
  "isError": true,
  "structuredContent": {
    "code": "GOVERNANCE_DISABLED",
    "action": "iris_backup_manage:run",
    "server": "prod"
  }
}
```

(the human-readable text reads `action 'iris_backup_manage:run' is disabled by governance policy for server 'prod'`).

### Governance file (`IRIS_GOVERNANCE_FILE`)

`IRIS_GOVERNANCE_FILE` points at a **JSON file of exactly the same shape as `IRIS_GOVERNANCE`** (`{"global": {...}, "profiles": {...}}`, booleans only). One file can be referenced from every MCP client's `env` block, so a single policy stays portable across Claude Code, Cursor, Copilot, and any other client that can pass a plain environment string — while the servers remain the sole enforcement authority.

```json
{ "env": { "IRIS_GOVERNANCE_FILE": "C:\\governance\\iris-policy.json" } }
```

- **Default state: unset ⇒ inert.** With the variable unset, no file is ever read (zero filesystem access) and behavior is byte-for-byte identical to an install without the feature. This channel is **opt-in**.
- **Env always wins.** The file contributes two cascade layers strictly *below* both `IRIS_GOVERNANCE` env layers (`env.profile ?? env.global ?? file.profile ?? file.global ?? preset ?? default seed`): a file introduced later can never silently override a policy you already set inline.
- **Explicit path only — never discovered.** The value is used literally; nothing is searched for in the working directory. A *relative* path resolves against the server process's current working directory, which the MCP *client* chooses — prefer an **absolute path**.
- **Restart semantics (no hot-reload in v1).** The file is read once at startup; edits take effect on the next server restart.
- **Fail-fast, never silently permissive.** A missing, unreadable, malformed, or invalid-shape file, or one with a governance key or layer outside `global` and `profiles`, aborts startup with an error naming `IRIS_GOVERNANCE_FILE`, the path, and the underlying reason — an operator who pointed at a policy file never runs ungoverned by mistake.
- **Attribution.** `iris_server_profiles` and the `iris-governance://<profile>` resource report a `configSource` per key (`env` | `file` | `parent` | `preset` | `default`), so you can see which channel resolved each setting (`parent`: the key inherited a disable from its [parent key](#parent-keys-a-new-tool-that-re-exposes-an-existing-one)).

Manage the file without hand-editing JSON: the [`iris-mcp-governance` CLI](#iris-mcp-governance-cli) (`validate` / `get` / `set` / `unset` / `effective` / `diff` / `check`) uses the same loader and cascade the servers enforce with, so what you write is what the servers will compute.

### Read-only mode — point it at production with one environment variable

**Point it at production in read-only mode with one environment variable.** Set `IRIS_GOVERNANCE_PRESET=read-only` and every write-classified tool action — across all five servers — is blocked, while every read action keeps working, with zero `IRIS_GOVERNANCE` JSON to write:

```json
{ "env": { "IRIS_GOVERNANCE_PRESET": "read-only" } }
```

What it does:

- **Blocks every write.** Any action a tool's `mutates` classification marks `"write"` (deletes, creates, sets, starts/stops, purges, `defaultEnabled` writes like `iris_production_control:clean` included — read-only means read-only, there is no "but this one's safe" exception) is denied.
- **Allows every read.** Queries, lists, gets, status/health checks, diagnostics — anything classified `"read"` — run exactly as they do today.
- **Sits UNDER your explicit `IRIS_GOVERNANCE` overrides, never over them.** The cascade is `profile.explicit ?? global.explicit ?? inheritedDisable ?? preset ?? defaultSeed`: an explicit `true` in `IRIS_GOVERNANCE` still wins over `read-only` if you deliberately want one specific write enabled even in a read-only deployment (and an explicit `false` still wins too — it just doesn't need to, since the preset already denies it).
- **Explains itself.** A call blocked *because of* the preset (not an explicit `false`, and not a disable inherited from a [parent key](#parent-keys-a-new-tool-that-re-exposes-an-existing-one)) returns `structuredContent.presetApplied: "read-only"` alongside the standard `GOVERNANCE_DISABLED` denial, so an operator or AI client can tell "blocked by the preset" apart from "blocked by an explicit override" at a glance.
- **Is opt-in and additive.** `IRIS_GOVERNANCE_PRESET` unset (or set to `"full"`, an explicit alias for today's behavior) is byte-for-byte the pre-preset suite — nothing changes until you set it.

**Queries under the read-only preset.** `iris_sql_execute` can run any statement, so it is a write and the preset blocks it. Queries go through **`iris_sql_query`**, a read tool whose parent key is `iris_sql_execute` (see [Parent keys](#parent-keys-a-new-tool-that-re-exposes-an-existing-one)): it runs only SELECT, is enabled by default, and stays enabled under the preset. Besides an explicit setting of its own key, it is disabled when an operator explicitly disables `iris_sql_execute` (unless `iris_sql_query` is set explicitly). A weakened `iris_sql_execute` key is never the route to a query. It is statement-level read-only, not side-effect-free: the query runs inside a transaction that is always rolled back, which undoes SQL changes and journaled global sets but not every effect of a function the query calls (for example a `$INCREMENT` counter; the full list is under *SQL write safety* below).

Pair it with the **SQL resource caps** for an extra safety margin on `iris_sql_execute` and `iris_sql_query` against a large production table: `IRIS_SQL_MAX_ROWS` (a ceiling on the number of rows a call **returns** — the response carries `rowsCapped: true` when it clamps a caller's request; note this bounds the returned row count post-fetch, not the server-side result set or transfer) and `IRIS_SQL_TIMEOUT` (a per-request timeout in seconds). Both are independent of the preset — they apply regardless of `IRIS_GOVERNANCE_PRESET` — and both are opt-in (unset = no cap, today's behavior):

```json
{ "env": { "IRIS_GOVERNANCE_PRESET": "read-only", "IRIS_SQL_MAX_ROWS": "1000", "IRIS_SQL_TIMEOUT": "30" } }
```

**SQL write safety (Story 38.5).** Two more operator variables bound what `iris_sql_execute` may change, and the same controls are call parameters (`readOnly`, `maxRowsAffected`, `countOnly`). A parameter can only tighten an operator setting, never loosen it, and a clamp is noted in the result (`readOnlyForced`, `maxRowsAffectedCapped`):

| Control | Parameter | Operator variable (default) | What it does |
|---|---|---|---|
| Read-only | `readOnly` (default `false`) | `IRIS_SQL_READ_ONLY` (unset) | Only queries (SELECT) run; any other statement, `CALL` included, is refused before it runs with `SQL_READ_ONLY`. The statement runs inside a transaction that is always rolled back. |
| Rows-affected cap | `maxRowsAffected` (default: no cap; `0` is a dry count) | `IRIS_SQL_MAX_ROWS_AFFECTED` (unset) | An INSERT, UPDATE or DELETE that changes more rows than the cap is rolled back and refused with `SQL_ROWS_AFFECTED_CAP`, which reports `rowsAffected`. The smaller of the parameter and the variable applies. Under a cap only SELECT, INSERT, UPDATE and DELETE run, because those are the statements whose affected rows IRIS counts (`TRUNCATE TABLE` reports `-1` and is rolled back). An INSERT, UPDATE or DELETE whose text contains the `%NOJOURN` token is refused with `SQL_ROWS_AFFECTED_CAP` before it runs, because it turns journaling off and the rollback could not undo it (a `%NOJOURN` in a comment or a string also refuses; a value passed in `parameters` is not checked). The count is the statement's own row count: rows that triggers, cascades or functions change are not counted, and a SELECT is not bounded by the cap. |
| Count only | `countOnly` (default `false`) | — | Returns `totalCount`, the number of rows a SELECT returns, and transfers no rows. |

An INSERT, UPDATE or DELETE result carries `rowsAffected`. The read-only mode is **statement-level read-only, not side-effect-free**: a rollback does not undo `$INCREMENT`/`$SEQUENCE` counters (row ID counters included), process-private or IRISTEMP globals, changes made with `%NOJOURN` by a function, procedure or trigger the statement runs, work that parallel query worker processes do (`%PARALLEL`), `JOB` or device output, other external effects, or a function, procedure or trigger that starts, commits or rolls back a transaction (reported as an error when the transaction level the tool opened has changed, which a commit followed by a new `TSTART` does not show; some changes may be saved). A capped statement that is rolled back leaves the same effects. A capped INSERT, UPDATE or DELETE on a table stored in IRISTEMP (not journaled) keeps its row changes even when the cap rolls it back. Both variables are global operator variables: every profile inherits them, and no per-profile key can loosen them.

See the [client configuration index](docs/client-config/README.md) — covering 13 clients — or the detailed guides for [Claude Code](docs/client-config/claude-code.md), [Claude Desktop](docs/client-config/claude-desktop.md) and [Cursor](docs/client-config/cursor.md), for copy-pasteable `env` blocks.

### Agent code editing (Epic 38)

An agent changes a class in IRIS in four steps: read the lines, edit them, compile, run the tests (the dev server's `edit-and-test-class` prompt walks the loop; see [Workflow Prompts & Agent Skills](#workflow-prompts--agent-skills)). Every write step is guarded, and a refusal changes nothing.

- **Ranged reads.** `iris_doc_get` takes optional `startLine` and `endLine` (1-based, inclusive). Omit both for the whole document, as before. A ranged read returns the numbered lines, `totalLines` and the version `ts`; an `endLine` past the end is clamped. Ranges apply to UDL text documents.
- **`iris_doc_put` on an existing document.** The save is version-checked: it is refused with `DOCUMENT_CONFLICT` if the document changed after the tool read it, and `ignoreConflict` (default **`false`**) is the only way past that check. A put to an existing class that drops one of its Storage definitions is refused with `STORAGE_DROPPED` unless `allowStorageRegeneration` is `true` (default **`false`**).
- **`iris_doc_edit`.** Insert, delete or replace the lines a ranged read numbered, each edit guarded by its `expected` text, all edits applied or none, in one version-checked save. `action: "apply"` is a write that is **enabled by default** (Project Lead decision S-3); disable it with `{"global":{"iris_doc_edit:apply":false}}`. It also inherits an explicit disable of `iris_doc_put`, and the `read-only` preset blocks it. `action: "regenerateStorage"` runs the same edits without the Storage guard and is **disabled by default**, because it changes how a class's data is laid out.
- **`current`.** A `STALE_CONTENT` refusal lists each mismatched edit's current text as `mismatches[].current`, with one trailing line break. Pass it back as that edit's `expected`, unchanged, once the change still applies to it. An `expected` built from a ranged read ends every line, the last included, with a line break.

| Refusal code | What happened | What to do |
|---|---|---|
| `STALE_CONTENT` | An edit's `expected` text no longer matches the lines it addresses. Nothing was stored. | Pass `mismatches[].current` back as `expected` if the change still applies to it; otherwise read the lines again with a ranged `iris_doc_get`. |
| `DOCUMENT_CONFLICT` | The document changed after the tool read it, so the version-checked save was refused. Nothing was stored, and the tool never retries. | Read the document again and redo the change. |
| `STORAGE_DROPPED` | The save would drop a Storage definition of a class. Nothing was stored. | Keep the Storage lines in the content or the edit. Only for a deliberate change of the data layout: `allowStorageRegeneration: true` on `iris_doc_put`, or `iris_doc_edit` action `regenerateStorage` (disabled by default). |
| `SQL_READ_ONLY` | A statement other than a query reached a read-only path: `iris_sql_query`, `iris_sql_execute` with `readOnly: true`, or any `iris_sql_execute` call while the operator's `IRIS_SQL_READ_ONLY` is `true`. Nothing was changed. | From `iris_sql_query`, run the statement with `iris_sql_execute` (the `read-only` preset blocks it). With `readOnly: true`, run it without `readOnly`. Under `IRIS_SQL_READ_ONLY`, run a SELECT, or ask the operator to lift it. |
| `SQL_ROWS_AFFECTED_CAP` | Under a cap (`maxRowsAffected` or the operator's `IRIS_SQL_MAX_ROWS_AFFECTED`), either an INSERT, UPDATE or DELETE changed more rows than the cap and was rolled back, or the statement was not run at all: only SELECT, INSERT, UPDATE and DELETE run under a cap, and an INSERT, UPDATE or DELETE whose text contains `%NOJOURN` is refused before it runs. | Over the cap: narrow the statement to fewer rows, or raise `maxRowsAffected` when the cap is the call's own. Not run: remove `%NOJOURN` from the text, or run the statement without `maxRowsAffected`. A call cannot raise or bypass the operator's ceiling. |
| `NOT_IMPLEMENTED` | The requested action is declared but not available in this version. No tool returns it as of Story 39.4, when `searchTable` of `iris_message_search` was built; the code stays in the catalog for a future declared action. No IRIS call was made. | Use an action listed in `availableActions`. |
| `DATA_POLICY_BLOCKED` | A data policy withheld the requested body data. Nothing was changed. Returned from Story 39.3 on, by the `body` action of `iris_message_search` under the `block` policy (default state of that action: a read, enabled by default), and from Story 39.4 on by the `searchTable` action of the same tool (also a read, enabled by default); the result names the `action` and the `policy`. No IRIS call was made. | Ask the operator for a looser `IRIS_DATA_POLICY` for the profile, or do not request body data. A call cannot loosen the operator's policy. |
| `MONITOR_BUSY` | The instance-wide Line-by-Line monitor is in use, so `iris_test_coverage` did not start. Returned while any Line-by-Line or PERFMON session is active: `owner` `suite` (a coverage run of this suite is running; the result names its `coverageRunId`, `pid`, `startedAt` and `namespace`) or `owner` `foreign` (a session this suite did not start). Nothing was started, and a foreign session is never touched. | For `owner` `suite`, wait for the run with `iris_test_status` (`action` `poll`, `coverageRunId`) and try again. For `owner` `foreign`, try again once that session has ended. |
| `PRODUCTION_BUSY` | A run that includes `%UnitTest.TestProduction` tests was not started, because `%UnitTest.TestProduction` stops any production that is not stopped before it starts its own. Returned by `iris_execute_tests` and `iris_test_coverage` (Story 40.3) while a production other than the tests' own runs in the namespace, or when the production state cannot be read (`state` `Unknown`, with `error`): the result names the `namespace`, the `state`, the `testProductions` (`class` and `production`) and, when the state was read, the running `production`. Nothing was run, and that production is left untouched. A run with no TestProduction test is never refused, and a server without the guard route runs unguarded. | Run the tests once the other production has stopped. If an interrupted test run left it running, stop it with `iris_production_control` and run the tests again. For `state` `Unknown`, try again in a moment. |

### Message forensics (Epic 39)

An agent finds out what a message carried in four steps: search the message headers of a window, read the bodies that matter, draw how the messages moved, and, for a failed one, preview a resend. The interop server's `trace-message-flow` prompt walks the search, the read and the diagram (and the logs of erroring items) from a session or header ID, its `find-patient-messages` prompt walks the search and the read from a patient identifier, and `resend-failed-messages` covers the resend preview (see [Workflow Prompts & Agent Skills](#workflow-prompts--agent-skills)). Every search and read step below is a read and is **enabled by default**, including under the `read-only` preset.

| Key | What it does | Default state | Under the PHI data policy |
|---|---|---|---|
| `iris_message_search:headers` | Header rows (`id`, `sessionId`, status, `isError`, source and target item, body class and ID, UTC times) of a required window of at most 7 days, narrowed by item, source, target, status, `sessionId`, `bodyClass` or `errorOnly`. Never a body value, except that a header with no body class carries its literal body as its body ID. | a read, enabled by default | Outside the policy: restrict the key where header rows are not acceptable. |
| `iris_message_search:body` | The same header rows for the headers whose message body satisfies 1 to 10 structured `filters` over a required `bodyClass` (a persistent body class with an SQL table). | a read, enabled by default | Refused with `DATA_POLICY_BLOCKED` under `block`; under `redact` and `allow` it runs and returns header rows only. |
| `iris_message_search:searchTable` | The same header rows for the messages that have an indexed Search Table value, such as an HL7 medical record number (`PatientID eq <MRN>` on `EnsLib.HL7.SearchTable`): a required `searchTableClass` and 1 to 10 `filters`. | a read, enabled by default | As `body`. |
| `iris_message_body` | The bodies of 1 to 20 messages by header ID (the `id` values a search returns), rendered by kind (HL7 v2 as ER7, XML, JSON, text), each cut at `maxChars` (default 10000). | a read, enabled by default | `redact` shows an HL7 v2 body redacted by a reviewed keep-list and withholds every other body; `block` withholds every body; `allow` shows each body as stored. A call's `dataPolicy` can only tighten the profile's policy. |

`iris_message_diagram` (a read, enabled by default) draws a session as a Mermaid sequence diagram, and the `preview` action of `iris_message_resend` (a read, enabled by default) shows what a resend would send. `resend` and `resendFiltered` stay writes and are disabled by default. `iris_message_diagram` and `iris_production_logs` (both reads, enabled by default) are under the data policy only under `block`, which withholds the error text in a diagram and each Event Log entry's text, with a reason; under `redact` and `allow` they sit outside the policy and show that text unchanged, because an error text in a diagram or an Event Log line can carry segment text that cannot be redacted reliably (see the scope table in [tool_support.md](tool_support.md)).

- **The window.** Every `iris_message_search` action requires `from`, and the window up to `to` (default: now) spans at most 7 days; there is no whole-namespace mode. `limit` (default 100, at most 500) is an **output cap only**: the window is scanned in full, so a wide window on a busy namespace can approach the ~60 s Web Gateway timeout. Narrow the window: a filter narrows the rows returned, not the window scanned. Page with `nextCursor` and pass the same `from` and `to` on every page.
- **`notApplicable`.** A namespace without Interoperability (for `searchTable`, a namespace with no Search Table property) answers `notApplicable: true` with a `reason`, not an error.
- **No match is not proof of absence.** A Search Table holds only the messages that were indexed when they were processed.
- **The policy.** The default is `redact`, set per profile (see [PHI data policy](#phi-data-policy)). The audit log records the policy and counts of each governed call and writes the declared PHI input (`filters`) as `"[REDACTED]"` under `redact` and `block` (see [Compliance & Auditability](#compliance--auditability)).
- **Restricting a key.** Each action is its own governance key, `iris_message_search:<action>`, and `iris_message_body` is one key. `{"global":{"iris_message_search:body":false,"iris_message_search:searchTable":false}}` restricts the two actions that reveal what bodies hold; `{"global":{"iris_message_body":false}}` restricts the reader.
- **The prompts.** `trace-message-flow` searches the headers of a session, reads the bodies that matter, draws the diagram and reads the logs of erroring items. `find-patient-messages` checks the profile's data policy, asks for a window of at most 7 days, looks a patient up by a Search Table value and reads bodies only when the user wants content. Both call reads only (`trace-message-flow` recommends a recovery and never runs one without the user's confirmation), keep their main path in the interop `core` preset, and report a withheld body's reason instead of reading it another way. A prompt adds no tool, key or default.

### Worked example — enable a write action globally, block it on `prod`

Suppose you want the `run` action of `iris_backup_manage` (a write action shipping in a later release — the canonical example) available everywhere **except** the `prod` profile, where backups are managed out-of-band. Set:

```json
{
  "global":   { "iris_backup_manage:run": true },
  "profiles": { "prod": { "iris_backup_manage:run": false } }
}
```

Result, by the cascade above:

- `iris_backup_manage({ action: "run" })` → uses `default` → `global` says `true` → **allowed**.
- `iris_backup_manage({ action: "run", server: "stage" })` → `stage` has no override → `global` says `true` → **allowed**.
- `iris_backup_manage({ action: "run", server: "prod" })` → `prod` override says `false` → **blocked** (`GOVERNANCE_DISABLED`).

The same shape governs any action you can name today. To try it against a write action that exists in the current release, substitute `iris_database_manage:delete` for `iris_backup_manage:run` — e.g. `"profiles": { "prod": { "iris_database_manage:delete": false } }` blocks database deletion on `prod` while leaving it enabled elsewhere. The JSON shape is identical; only the key changes.

### Discovering profiles and policy (call this first)

Every server provides a framework tool, **`iris_server_profiles`**, that an AI client should **call first** to learn its operating environment without reading the client's config files:

- **Profile roster** — for each configured profile: `name`, `isDefault`, `host`, `port`, `username`, `namespace`, `https`, `baseUrl`, `timeout`, `source` (`"env"` or `"server-manager"` — where the connection fields came from), `sourceFile` (the settings file, for a `"server-manager"`-sourced profile only), `dataPolicy` (`"block"`, `"redact"` or `"allow"` — what the profile shows of message bodies) and `dataPolicySource` (the channel that set it: see [PHI data policy](#phi-data-policy)). The **`password` is never included** (an allow-list of non-secret fields). Use this to pick the right `server` profile for subsequent calls.
- **Effective governance policy** — the enabled/disabled action map for a selected profile (optional `profile` arg; defaults to `default`), or for every profile with `allProfiles: true`. Computed from the same engine the governance resource uses, so the two never disagree.

It does not connect to IRIS (it reports in-memory config), so it works even when the target instance is unreachable. It is a **read tool, enabled by default** — an operator can still disable it explicitly via `IRIS_GOVERNANCE`. The same call-first guidance is also surfaced via the MCP server `instructions` field at connect time.

> Note: the tool's optional `profile` arg selects which profile's *policy* to report; the framework `server` arg (which selects the connection target on every other tool) is irrelevant here, since discovery does not connect.

### Inspecting effective policy — the governance resource

The suite exposes an MCP **resource** (alongside its tools) so a client can read the effective policy for a profile *before* attempting a call:

- `iris-governance://default` — the default/global effective policy (also listed in `resources/list`).
- `iris-governance://{profile}` — the effective policy for any named profile (a resource *template*). Its `list` callback enumerates one concrete `iris-governance://<profile>` entry per configured profile, so resource-reading clients can also discover the profile roster by name via `resources/list`.

Reading the resource returns the effective policy map as JSON. It is **advisory** — a convenience so a client can avoid issuing calls it knows are blocked. The call-time gate remains the authoritative boundary; the resource never grants or denies anything on its own.

### Default-disabled write actions in the current release

Per the default-seed rule above, the **new write actions** added after governance shipped are **disabled by default** (opt-in via `IRIS_GOVERNANCE`); their sibling reads are enabled by default. The set shipped to date:

| Server | Tool | Default-**disabled** (write) actions | Default-enabled (read/pre-existing) |
|---|---|---|---|
| admin | `iris_service_manage` | `enable`, `disable`, `set` | `list`, `get` |
| admin | `iris_ldap_manage` | `create`, `modify`, `delete` | `list`, `get`, `test` |
| admin | `iris_x509_manage` | `import`, `delete` | `list`, `get` |
| admin | `iris_audit_manage` | `enable`, `disable`, `configureEvent`, `purge`, `export` | `status`, `view` |
| admin | `iris_resource_manage` (SQL privileges) | `grant`, `revoke` | `listPrivileges` (resource `create`/`modify`/`delete` are pre-governance, enabled) |
| ops | `iris_process_manage` | `terminate`, `suspend`, `resume` | `get` |
| ops | `iris_database_action` | `mount`, `dismount`, `compact`, `defragment`, `truncate`, `expandVolume` (all six) | — |
| ops | `iris_backup_manage` | `run`, `freeze`, `thaw` | `listHistory` |
| interop | `iris_default_settings_manage` | `set`, `delete` | `list`, `get` |
| interop | `iris_production_item` | `add`, `remove` (new) | `enable`, `disable`, `get`, `set` (pre-governance baseline) |
| interop | `iris_message_diagram` | — (flat read tool, no actions) | whole tool (message-trace Mermaid diagrams, Epic 21) |
| interop | `iris_message_resend` | `resend`, `resendFiltered` (message resend/replay, Epic 26) | `preview` |
| interop | `iris_message_search` | — (all three actions are reads; Story 39.1) | `headers`, `body`, `searchTable` (all enabled by default, and still enabled under the read-only preset; `body` searches by body content and is refused under the `block` data policy, Story 39.3; `searchTable` finds messages by an indexed Search Table value and is refused under the `block` data policy too, Story 39.4) |
| interop | `iris_message_body` | — (flat read tool, no actions; Story 39.5) | whole tool (reads the bodies of 1 to 20 messages; a read, enabled by default, and still enabled under the read-only preset; under the PHI data policy: `redact` shows an HL7 v2 body redacted and withholds every other body, `block` withholds every body) |
| dev | `iris_sql_analyze` | — (all five actions are reads) | `explain`, `stats`, `indexUsage`, `running`, `advise` (Epic 28) |
| dev | `iris_loc_count` | — (flat read tool, no actions) | whole tool (namespace lines-of-code metrics, Epic 22) |
| dev | `iris_env_diff` | — (flat read tool, no actions) | whole tool (cross-profile environment drift detection, Epic 27) |
| dev | `iris_env_promote` | `execute` | `plan` |
| dev | `iris_doc_edit` | `regenerateStorage` (the Storage-guard override; Story 38.4) | `apply` is a write that ships **enabled** (see the next subsection) |
| dev | `iris_sql_query` | — (flat read tool, no actions; Story 38.5) | whole tool (queries only; enabled by default, and still enabled under the read-only preset) |
| dev | `iris_test_coverage` | the whole tool (a flat write tool, no actions; Story 40.1: it starts an instance-wide Line-by-Line session and runs test code; enable it with `IRIS_GOVERNANCE={"global":{"iris_test_coverage":true}}`) | — |
| dev | `iris_test_status` | `cancel` (Story 40.1: stops a running test or coverage run; enable it with `{"global":{"iris_test_status:cancel":true}}`), `export` (Story 40.2: writes a completed coverage run's Cobertura XML to a local file; enable it with `{"global":{"iris_test_status:export":true}}`) | `poll` (a read: re-attaches to a test or coverage run; Story 36.2) |

Every **pre-governance** tool action (everything shipped before the governance layer) stays enabled by default. The authoritative per-tool catalog with endpoints and governance notes is [`tool_support.md`](tool_support.md).

#### "Write, default-enabled" actions (the `defaultEnabled` mechanism)

A small number of **new write actions ship enabled by default** even though they are truthfully classified `write`. This is the `defaultEnabled` mechanism (Epic 20, architecture decision F2): a tool can mark specific write actions as default-enabled so a recovery/operational action an operator expects available does not require an opt-in, **without** mislabelling it as a read and **without** modifying the frozen governance baseline. Such an action still carries `mutates: "write"` (and its truthful `destructiveHint`), and an operator can still **disable** it with an explicit `IRIS_GOVERNANCE` override — the cascade honors an explicit `false`.

| Server | Tool | Write action, but **enabled by default** | Why |
|---|---|---|---|
| interop | `iris_production_control` | `clean` | Recovery operation (unwedge a stopped production); parity with the grandfathered lifecycle actions. Its destructive `killAppData` persistent-wipe is separately double-gated behind `confirm:true`. |
| dev | `iris_doc_edit` | `apply` | A narrow, guarded write that replaces whole-document `iris_doc_put` rewrites (Story 38.4, S-3): every edit carries the `expected` text of the lines it changes, the save is version-checked (a concurrent change is a `DOCUMENT_CONFLICT`, never overwritten), and a class edit that would drop a Storage definition is refused. Its guard override, `iris_doc_edit:regenerateStorage`, is a separate action and stays **disabled by default**. Disable it with `{"global": {"iris_doc_edit:apply": false}}`, or by disabling `iris_doc_put` (see [Parent keys](#parent-keys-a-new-tool-that-re-exposes-an-existing-one)); the read-only preset also blocks it. |

This list is closed: adding a holder takes a recorded Project Lead decision (a cross-package test pins the two holders above). Absent any tool opting in, this mechanism is inert (the governance seed is byte-for-byte its pre-F2 behavior — every other new write still default-disabled).

#### Parent keys: a new tool that re-exposes an existing one

A new key that re-exposes the capability of an existing key declares that key as its **parent**. When the parent is **explicitly disabled**, every key of the new tool **seeds disabled** too, so turning off an existing capability never leaves it open through its newer, narrower sibling. Today `iris_doc_edit` declares the parent `iris_doc_put` (both of its keys, `iris_doc_edit:apply` and `iris_doc_edit:regenerateStorage`), and `iris_sql_query` declares the parent `iris_sql_execute` (Story 38.5), so disabling `iris_sql_execute` also disables the query tool unless `iris_sql_query` is set explicitly.

- **Which setting counts.** "Explicitly disabled" means the **first explicit setting of the parent**, in cascade order (env profile, env global, file profile, file global), is `false`. A lower layer's `false` does not count once a higher layer enables the parent. Only a disable is inherited, never an enable: under the read-only preset, an explicit `iris_doc_put: true` lets `iris_doc_put` run, but `iris_doc_edit:apply` stays blocked by the preset until you set it explicitly too.
- **Your setting on the child still wins.** `{"global": {"iris_doc_put": false, "iris_doc_edit:apply": true}}` blocks `iris_doc_put` and keeps `iris_doc_edit:apply` running. An explicit setting at any layer beats the inherited disable, and the inherited disable beats the preset seed.
- **It is reported.** `iris_server_profiles` and the governance resource show such a key as `false` with `configSource: "parent"`. A blocked call returns the usual `GOVERNANCE_DISABLED` refusal with one extra field, `inheritedFrom`, and the text gains the suffix `(inherited from 'iris_doc_put')`; `presetApplied` is not set when the parent caused the denial:

```json
{
  "isError": true,
  "structuredContent": {
    "code": "GOVERNANCE_DISABLED",
    "action": "iris_doc_edit:apply",
    "server": "prod",
    "inheritedFrom": "iris_doc_put"
  }
}
```

- **Profile-scoped, and additive.** A disable at a profile layer reaches only that profile. With no parent explicitly disabled, every existing key's effective value, `configSource` and denial are byte-for-byte what they were before parent keys existed.

#### `iris_env_promote:execute` safety model (Epic 27)

`iris_env_promote`'s `execute` action is a genuine environment-mutating write, so it carries a richer safety story than a single default-disabled flag — worth its own callout:

- **Default-disabled, not `defaultEnabled`.** Unlike `iris_production_control:clean` (a recovery-of-last-resort action, Epic 20), `execute` is a real promotion write and deliberately does **not** use the `defaultEnabled` mechanism above — enable it explicitly via `IRIS_GOVERNANCE`, e.g. `{"global": {"iris_env_promote:execute": true}}`.
- **No-deletions guarantee.** `onlyInTarget` diff entries (something exists on the target only) are always emitted as informational **warnings**, never as steps. No delete/remove operation exists anywhere in any plan, in this or any future version — the one exception is `updateMapping`'s intra-step delete+create *replace* of a mapping the source also has (`Config.cls` has no in-place update); it never targets a target-only item.
- **Secrets exclusion.** A System Default Settings value whose setting name looks credential-ish (`password`/`secret`/`key`/`token`/`pwd`/`passphrase`/`credential`/`cert`/`private`/`salt`, case-insensitive) is redacted in both `iris_env_diff` and `iris_env_promote` output — the plaintext never appears in any tool result, on either the plan or the execute path (including error messages). Credentials/users/roles promotion is out of scope entirely.
- **Four refuse-before-any-write gates**, each mutating nothing on failure: (1) `confirm: true` required; (2) a non-empty `steps` allowlist whose every index exists in `plan.steps`; (3) plan-hash freshness — the SAME `diff` that produced `plan` is re-hashed and compared, refusing a stale plan; (4) the **target** profile's own governance policy must enable every write family the allowlisted steps use (`iris_doc_put`/`iris_doc_compile`, `iris_mapping_manage:create`/`:delete`, `iris_default_settings_manage:set`, `iris_webapp_manage:modify`, `iris_config_manage:set`) — this is what stops a caller on an unrestricted profile from writing into a governance-locked target, independent of the outer `iris_env_promote:execute` gate.

### Backward Compatibility

**Existing single-server `IRIS_*` setups require no changes.** This is a release-gate promise:

- With **neither** `IRIS_PROFILES` nor `IRIS_GOVERNANCE` set, behavior is byte-for-byte identical to before — one instance from your `IRIS_*` vars, every tool enabled. (One deliberate exception, added by Story 37.1: what happens when that instance is *unreachable at startup* — see the last bullet in this list.)
- With `IRIS_GOVERNANCE_PRESET` **unset** (the default), the governance cascade's preset layer is a pure pass-through — behavior is unchanged whether or not `IRIS_GOVERNANCE`/`IRIS_PROFILES` are set.
- With `IRIS_SQL_MAX_ROWS`/`IRIS_SQL_TIMEOUT`/`IRIS_SQL_READ_ONLY`/`IRIS_SQL_MAX_ROWS_AFFECTED` **unset** (the default) and none of the `readOnly`/`maxRowsAffected`/`countOnly` parameters used, every field `iris_sql_execute` returned before is unchanged — no `rowsCapped`, `readOnlyForced` or `maxRowsAffectedCapped` field, no per-request timeout override; an INSERT, UPDATE or DELETE result only gains `rowsAffected`. (The request now goes to the ExecuteMCPv2 `/dev/sql/execute` route instead of the Atelier `action/query` route, so a SQL error names that route.)
- With `IRIS_AUDIT_LOG` **unset** (the default), the tool-call audit log is a mechanical no-op — no audit file is created, no `fs` write is attempted, and every tool call's result is byte-for-byte identical to before the audit interceptor existed.
- **The data policy's default changes one output.** With `IRIS_DATA_POLICY` unset and no `dataPolicy` configured (the default, `redact`), the `iris_message_resend` preview no longer shows the first ~1 KB of a stream body: an HL7 v2 body keeps today's class-name note, and every other body (a stream included) is withheld with a reason (Project Lead decision L-2, Story 39.2). `IRIS_DATA_POLICY=allow` restores the previous preview exactly, field for field. No other tool's output changes, except that each `iris_server_profiles` roster entry gains the additive `dataPolicy` and `dataPolicySource` fields; the preview route's new `bodyDetail` and `bodyTextMaxChars` request fields are optional and additive. See [PHI data policy](#phi-data-policy).
- **The `tools/list` snapshot (Story 39.6).** A committed snapshot pins the title, description, input schema and annotations of every listed tool on all five servers, so an existing tool's entry cannot change unnoticed. `pnpm gen:tools-list-snapshot:check` compares the built servers against it and writes nothing. A sanctioned change to a listed entry, an additive one included, is regenerated with `pnpm gen:tools-list-snapshot --force` in the story that makes it, with a CHANGELOG line; a new tool is reported by the check and needs no regenerate. The snapshot adds no tool, key or default.
- The `server` parameter is an *optional* addition to each tool's input schema. Calls that omit it are unchanged; existing prompts and automations keep working.
- No `BOOTSTRAP_VERSION` change is involved in the governance and profile capabilities above — they are TypeScript-layer. The IRIS-side changes deploy through the bootstrap like any other ExecuteMCPv2 class; they include Story 38.5's `ExecuteMCPv2.REST.Sql` handler (the `/dev/sql/execute` route behind `iris_sql_execute` and `iris_sql_query`) and Story 38.7's production-delete check in `ExecuteMCPv2.REST.Interop` (`iris_production_manage` `delete` deletes only a class that extends `Ens.Production`). Like `iris_execute_command`, a SQL call to a namespace other than the ExecuteMCPv2 web application's relies on the bootstrap's `%All` package mapping; the Atelier `action/query` route `iris_sql_execute` used before did not.
- **Startup no longer exits when the `default` instance is unreachable.** Before Story 37.1, an unreachable `default` profile made the server call `process.exit(1)` before ever connecting its transport — one down instance took the whole server (and every other, reachable profile) with it. Now an unreachable `default` is treated the same as any other profile's outage: startup continues, calls that target `default` return the existing connection-error `isError` envelope (this is the behavior for an instance that is **unreachable at startup**; an outage that begins **mid-session**, after `default` has been established, surfaces instead as `Tool error: …` carrying the connection message), and it recovers automatically the moment it becomes reachable again — no restart needed. **Invalid configuration still fails startup fast** (a missing `IRIS_USERNAME`/`IRIS_PASSWORD`, a malformed `IRIS_GOVERNANCE`/`IRIS_PROFILES`, a governance key or layer outside `global` and `profiles`, an unwritable `IRIS_AUDIT_LOG` directory, a malformed `IRIS_SQL_READ_ONLY` or `IRIS_SQL_MAX_ROWS_AFFECTED`, a malformed `IRIS_DATA_POLICY`, `dataPolicy` field of an `IRIS_PROFILES` entry or `dataPolicy` section of the governance file, a `dataPolicy` key in `IRIS_GOVERNANCE`, an unsupported `MCP_TRANSPORT`/`--transport` value). What became non-fatal is the startup *health check* against `default` — an outage, a timeout, and also a refusal (HTTP 401/403 from a wrong-but-present password, or 404 from a disabled `/api/atelier` web application). The last two do **not** clear on their own, so the startup log says so explicitly and names the host:port; fix the setting and restart.

---

## Tool Visibility Presets

Trim any server to an **8- to 15-tool core** for small models with one environment variable:

```bash
IRIS_TOOLS_PRESET=core                    # 8- to 15-tool everyday subset per server (small-model sweet spot)
IRIS_TOOLS_PRESET=developer               # persona filter: dev-relevant tools, security/enterprise admin hidden
IRIS_TOOLS_PRESET=full                    # explicit alias for today's behavior (default when unset)
IRIS_TOOLS_DISABLE=iris_doc_export,iris_env_*   # hide individual tools / families
IRIS_TOOLS_ENABLE=iris_env_diff           # punch a hole: re-show a tool the preset/disable hid
```

A **hidden** tool is never registered with the MCP SDK: it is absent from `tools/list`, and calling it by name returns the SDK's standard unknown-tool error — indistinguishable from a tool that never existed, zero context cost. **`IRIS_TOOLS_PRESET` unset (the default, `full`) is byte-for-byte today's `tools/list` for every server** — a release-gate promise, mechanically proven by a back-compat snapshot test plus a live smoke against the built `dist/` output (Epic 30 closing story).

### Visibility vs. governance — two orthogonal layers

Tool visibility (this section) is a different concern from [governance](#multiple-servers--governance), and the two compose in a specific order:

| | Visibility (this section) | Governance (existing, unchanged) |
|---|---|---|
| Question | "Does the agent know this exists?" | "Is this call allowed?" |
| Granularity | per **tool** | per **action** (`tool` / `tool:action`) |
| Enforcement point | registration (never enters the SDK registry / `tools/list`) | `dispatchToolCall` runtime gate |
| Failure surface | standard MCP unknown-tool error | structured `GOVERNANCE_DISABLED` error |
| Purpose | context ergonomics, tool-selection accuracy | safety / authorization |

Rules of interaction:
- **Visibility is evaluated first**, at server construction: a hidden tool can never reach the governance gate — it was never registered.
- An `IRIS_GOVERNANCE` key naming a hidden tool is **legal and inert** (the same `IRIS_GOVERNANCE` JSON is shared across all 5 servers, and governance already tolerates keys for tools a given server doesn't host — this is unchanged, just now also true for a tool your preset hid).
- Visibility is per-**tool** only. Hiding a single *action* of a multi-action tool (e.g. only `iris_env_promote:execute`, not `:plan`) remains governance's job — no schema surgery on any `action` enum.
- **Governance is the safety layer; visibility is ergonomics.** `read-only` safety still means `IRIS_GOVERNANCE_PRESET=read-only` — there is no "safe" visibility preset, and hiding a tool is never a substitute for disabling its write actions.
- **Per-profile visibility is impossible by protocol.** An MCP server process serves exactly one `tools/list` regardless of which `IRIS_PROFILES` connection a call later targets. Visibility env vars are process-global — unlike `IRIS_GOVERNANCE`, there is no `profiles` sub-structure here.

### Env vars & resolution

- **`IRIS_TOOLS_PRESET`** — `full` (default) \| `core` \| `developer`. An unrecognized value **fails fast** at startup, naming the valid values.
- **`IRIS_TOOLS_DISABLE`** — comma-separated tool names to hide. A trailing-`*` wildcard matches a whole family (`iris_doc_*`); a bare `*` alone is rejected (use `IRIS_TOOLS_PRESET` for that). Whitespace is trimmed.
- **`IRIS_TOOLS_ENABLE`** — comma-separated tool names to force-show, overriding both the preset and `IRIS_TOOLS_DISABLE`. Same syntax. This is what makes the "family except one" pattern work: `IRIS_TOOLS_DISABLE=iris_doc_*` + `IRIS_TOOLS_ENABLE=iris_doc_get` hides every `iris_doc_*` tool except `iris_doc_get`.

Resolution precedence per tool: **`ENABLE` > `DISABLE` > preset > default-visible**.

Edge-case semantics (all deterministic):
- The same literal tool name in both `IRIS_TOOLS_DISABLE` and `IRIS_TOOLS_ENABLE` → a startup **warning** (`ENABLE` wins per precedence) — not an error, since a wildcard/literal overlap is the intended hole-punch usage.
- An unknown tool name in either list → a startup **warning, not an error** (the same env block is shared across all 5 servers, so a name valid on another server is "unknown" here). A wildcard matching zero registered tools also warns.
- **`iris_server_profiles` is reserved and always visible** — it is the discovery surface every server's MCP instructions say to call first, and the diagnostic for this very feature. A wildcard that would match it silently skips it; naming it **literally** in `IRIS_TOOLS_DISABLE` **fails startup** (a deliberate misconfiguration, not cross-server sharing).
- Hiding every package tool is legal (the server then serves only `iris_server_profiles`) but logs a startup warning.
- Matching is case-sensitive exact/prefix; tool names are already all-lowercase `iris_*`.

`iris_server_profiles` reports the active configuration back to the agent: a `toolVisibility` block — `{ "preset": "core" | "developer" | "full", "visibleTools": <n>, "hiddenTools": <n> }` — deliberately **never** the hidden tool names (invisible means invisible; diagnose "why is tool X missing?" via this count plus the env vars and the roster tables below). The effective-governance report (in `iris_server_profiles` and the `iris-governance://{profile}` resource) also **omits keys belonging to hidden tools**, so the agent's view of both layers stays self-consistent. A startup stderr log line records the active preset plus visible/hidden counts and any of the warnings above.

### The rosters

Design intents differ per preset:
- **`core`** attacks the **tool-count cliff** (research: LLM tool-selection accuracy degrades sharply past ~20 tools per server) — the everyday ~80% loop, **about 13 runtime tools per server** (a guideline, not a hard limit: Project Lead decision L-4, 2026-10-14), tuned for small/cheap models. Destructive-and-rare and bulk/specialist tools are hidden.
- **`developer`** attacks **persona relevance** — everything a developer touches (full dev server, production lifecycle + monitoring, namespace/database/webapp self-service config, runtime/task tools, all data tools) while hiding **security & enterprise administration** (users/roles/resources/SSL/OAuth/LDAP/X509/audit, backup/mirror/ECP). Counts stay above the cliff on `dev`/`interop` under `developer` — that's accepted; `core` is the count answer.

`iris_server_profiles` is additionally visible on every server under every preset (the `+1` in every "runtime" count below). Four pairs of tools designed as a unit — `iris_env_diff` / `iris_env_promote`, `iris_doc_get` / `iris_doc_edit` (Story 38.4: read the exact lines with their version, then change them), `iris_message_search` / `iris_message_body` (Story 39.5: find messages, then read what they carry), and `iris_test_coverage` / `iris_test_status` (Story 40.1: start a coverage run, then re-attach to it or cancel it) — are always co-visible in every preset (never one without the other, so an agent is never stranded mid-workflow). `iris_test_status` (Story 36.2) is NOT paired with `iris_execute_tests`: it is `developer`-include / `core`-exclude on its own (the manual re-attach route named in `iris_execute_tests`' `hint` still works in `core`), and `iris_test_coverage` joins it outside `core`, so the pair moves no `core` row.

| Preset | dev | admin | interop | ops | data | Package total | Runtime total |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **full** (default) | 32 | 26 | 24 | 21 | 7 | 110 | 115 |
| **developer** | 32 | 10 | 24 | 9 | 7 | 82 | 87 |
| **core** | 14 | 12 | 11 | 9 | 7 | 53 | 58 |

Every `core` server lands at 8 to 15 runtime tools — inside the researched 5-15-tool window (`dev` is at 15 because `iris_doc_edit` and `iris_sql_query` joined the everyday loop; the target of about 13 is a guideline). The exact per-tool `include`/`exclude` disposition for each server is declared explicitly in that package's `src/tools/presets.ts` (first transcribed from [`research/feature-specs/11-tool-visibility-presets.md#2.5`](_bmad-output/planning-artifacts/research/feature-specs/11-tool-visibility-presets.md), whose table is not kept current; `presets.ts` is the authoritative per-tool table — a tool with no disposition fails a construction-time assert and the roster sizes are pinned by a per-package unit test, so it cannot drift silently). In short:

- **`@iris-mcp/dev`** `core` = the authoring loop (get/edit/put/list/compile/load) + execution & debug loop (command/classmethod/tests, global get/set/kill) + SQL execute and SQL query. `developer` = the full 32-tool server (every dev tool is dev-relevant).
- **`@iris-mcp/admin`** `core` = the everyday admin loop (namespaces, databases, users, webapps, permission checks). `developer` = only what developers self-serve (namespace/db/mapping/webapp config) — no user/security administration.
- **`@iris-mcp/interop`** `core` = the troubleshoot-a-production loop (status/summary/control, item config, logs/queues/messages, message search, message body, trace diagram, resend) — `iris_production_control` stays visible so the `recover`-first MCP guidance holds under every preset. `developer` = the full 24-tool server.
- **`@iris-mcp/ops`** `core` = monitoring-persona basics (health, system metrics, alert metrics, jobs/locks/processes, tasks, license). `developer` = the runtime debugging slice (interop metrics + task history) — no backup/mirror/ECP/config surface.
- **`@iris-mcp/data`** — already inside the 5-15 sweet spot: both `core` and `developer` include all 7 tools.

### Measured `tools/list` payload (per server × preset)

Produced by `pnpm measure:tools-payload` ([`scripts/measure-tools-payload.mjs`](scripts/measure-tools-payload.mjs)), which constructs a real server per preset and drives the real `tools/list` request handler — the bytes below are exactly what a connected client receives (the SDK's own Zod→JSON-schema tool conversion), not a hand-rolled estimate. `~tokens` is a `bytes / 4` heuristic (no tokenizer dependency).

| Server | full (count / bytes / ~tokens) | core (count / bytes / ~tokens) | developer (count / bytes / ~tokens) |
| --- | --- | --- | --- |
| @iris-mcp/dev | 33 / 94,930 / ~23,733 | 15 / 44,353 / ~11,088 | 33 / 94,930 / ~23,733 |
| @iris-mcp/admin | 27 / 48,369 / ~12,092 | 13 / 16,862 / ~4,216 | 11 / 16,222 / ~4,056 |
| @iris-mcp/interop | 25 / 57,046 / ~14,262 | 12 / 38,104 / ~9,526 | 25 / 57,046 / ~14,262 |
| @iris-mcp/ops | 22 / 30,812 / ~7,703 | 10 / 13,814 / ~3,454 | 10 / 14,265 / ~3,566 |
| @iris-mcp/data | 8 / 12,643 / ~3,161 | 8 / 12,643 / ~3,161 | 8 / 12,643 / ~3,161 |

`@iris-mcp/dev`/`interop` show no `full`→`developer` reduction (their `developer` roster includes every tool); `@iris-mcp/data` is unaffected by any preset (its 7 tools are all `core`+`developer`-visible). `core` is the biggest win across every server that defines one — up to ~65% fewer bytes (`@iris-mcp/admin`: 48,369 → 16,862; `@iris-mcp/dev`: 94,930 → 44,353, ~53%). Last re-measured at Story 40.3 (`pnpm measure:tools-payload` on freshly built dists — mechanical, Rule #51). Byte counts are not test-pinned (only the tool counts are), so they drift whenever a tool description or schema changes, until the next re-measure. `@iris-mcp/dev`'s `full`/`developer` rows include `iris_test_status` and `iris_test_coverage`, which `core` excludes.

---

## PHI data policy

An Interoperability message body can hold protected health information. A per-profile **data policy** controls what the suite shows of one. It takes one of three values, from the strictest to the loosest:

| Value | Effect |
|---|---|
| `block` | Every message body is withheld, with a reason. IRIS sends no body content. The `body` and `searchTable` actions of `iris_message_search` are refused. |
| `redact` (**default**) | In the resend preview, a body is shown only in a form that cannot carry identifying data. An HL7 v2 body shows only its class name, as the preview always did for a non-stream body; every other body is withheld with a reason, because the suite cannot redact it reliably. The one tool built to show body text, `iris_message_body` (Story 39.5), shows an HL7 v2 body redacted by a reviewed keep-list, complete or not at all, withholds every other body, and never has IRIS return the text of one; a field the keep-list keeps still holds what the sender put in it, so a redacted text reduces exposure and is not proof that it holds no identifying value. The `body` and `searchTable` actions of `iris_message_search` run and return header rows only, but which headers match still shows what the bodies hold: where that is not acceptable, use `block` or restrict `iris_message_search:body` and `iris_message_search:searchTable` with their governance keys. |
| `allow` | Today's output, unchanged; `iris_message_body` shows each body as stored. |

**Where to set it.** The first value found wins, for each profile:

1. the `dataPolicy` field of the profile's `IRIS_PROFILES` entry;
2. the `IRIS_DATA_POLICY` environment variable;
3. the governance file's `dataPolicy.profiles.<name>` (`IRIS_GOVERNANCE_FILE`);
4. the governance file's `dataPolicy.global`;
5. `redact`.

A value on the `default` entry applies to `default` only and is never inherited by another profile. The governance file takes the section as `{"dataPolicy": {"global": "redact", "profiles": {"prod": "block"}}}`; `IRIS_GOVERNANCE` rejects the key and says where to put it. Values are case-insensitive and stored in lowercase. A malformed value fails startup, naming the channel; a profile name under `dataPolicy.profiles` that no profile carries only warns. `iris_server_profiles` reports each profile's `dataPolicy` and `dataPolicySource` (`IRIS_PROFILES`, `IRIS_DATA_POLICY`, `IRIS_GOVERNANCE_FILE:profiles`, `IRIS_GOVERNANCE_FILE:global` or `default`). A call can only tighten an operator's policy, never loosen it: `iris_message_body` takes an optional `dataPolicy` parameter, and a value looser than the profile's is ignored and reported as `dataPolicyClamped: true`.

**What it governs today.** The `iris_message_body` tool (Story 39.5), which reads message bodies by header ID and is the one tool built to return body text: under `redact` it shows an HL7 v2 body redacted by the reviewed keep-list, complete or not at all, and withholds every other body (IRIS returns the text of HL7 v2 bodies only, so no other body's content leaves IRIS); under `block` it withholds every body and IRIS returns the text of none; under `allow` it shows each body as stored. It is a read, enabled by default, and each result carries `dataPolicy` (`{policy, redacted, blocked}`) and a `bodyPolicy` per body. The `body` action of `iris_message_search` (Story 39.3), which searches message headers by what their bodies hold: under `block` it is refused with `DATA_POLICY_BLOCKED` and no IRIS call; under `redact` and `allow` it runs and returns header rows only, never a body value, with `dataPolicy` (`{policy, redacted: 0, blocked: 0}`); it is a read, enabled by default. The `searchTable` action of the same tool (Story 39.4), which finds messages by an indexed Search Table value such as an HL7 medical record number, is governed the same way: refused with `DATA_POLICY_BLOCKED` and no IRIS call under `block`, header rows only under `redact` and `allow`, a read, enabled by default. And the `preview` action of `iris_message_resend`, the one output whose default changes (each `iris_server_profiles` roster entry also reports the policy): under `redact` it shows an HL7 v2 body only as its class name and withholds a stream, string, container or other body with a reason; a header with no readable body is reported as having none. The response carries `dataPolicy` (`{policy, redacted, blocked}`) and a `bodyPolicy` per item. Under `allow` the response is today's, field for field. The suite also contains an HL7 v2 redaction engine, which keeps only a reviewed list of non-identifying fields and redacts every other field, including every field of a segment nobody reviewed, and refuses a text holding a line that is not a known HL7 v2 segment or a Z-segment; `iris_message_body` is the one tool built to return HL7 body text, and under `redact` it shows only what the engine returns. Since Story 39.7 the policy also governs `iris_production_logs` and `iris_message_diagram`, under `block` only: they withhold each Event Log entry's text and the text of a diagram's error warnings with a fixed reason, and under `redact` and `allow` they show that text unchanged (both are reads, enabled by default). Under `allow`, `iris_message_body` also shows the text of a character-stream property of a persistent body, such as the `ContentStream` of `HS.Message.XMLMessage`, within `maxChars`; a binary stream stays its class and size, and `redact` and `block` read none. The scope of the policy over every tool of the suite, as of 2026-10-17, is the [PHI data policy scope](tool_support.md#phi-data-policy-scope-as-of-2026-10-17) table: tools such as `iris_sql_execute` and `iris_global_get` can still return body-derived text, and an operator restricts them through their governance keys.

**In the audit log.** The audit entry of a governed call records the policy and counts, and a tool's declared PHI inputs are redacted under `redact` and `block`: see [Compliance & Auditability](#compliance--auditability). Message-body content never reaches the console log or the audit file.

The data policy reduces exposure of message-body data; it is not a compliance certification.

---

## Compliance & Auditability

For regulated environments — healthcare, finance, or any shop that has to answer "what did the AI actually do to this system?" — the suite ships an opt-in, secrets-free **tool-call audit log**: a structured JSONL record of every MCP tool call, across all five servers, switched on with a single environment variable.

**What gets recorded.** Every tool call — whether it succeeded, errored, or was blocked by governance — becomes one JSON line:

```json
{"ts":"2026-07-11T14:03:22.117Z","session":"1f2e3a9c-...","seq":42,"serverPkg":"@iris-mcp/ops","tool":"iris_database_action","action":"truncate","profile":"prod","namespace":"HSCUSTOM","outcome":"denied","denyReason":"GOVERNANCE_DISABLED","presetApplied":"read-only","durationMs":3,"paramKeys":["action","database"]}
```

`session` is a UUID generated once per server process, so every line from one running server shares it; `seq` is a per-session monotonic counter (1, 2, 3, …), so a log file can be replayed in exact call order even under concurrent calls. `outcome` is one of `ok`, `error` (the entry's `error` field carries the same sanitized message the caller received — never a raw stack trace or an internal `^global` reference), or `denied` (the governance gate blocked it — see [Multiple Servers & Governance](#multiple-servers--governance) — with a structured `denyReason` and, when a safety preset rather than an explicit override caused the block, `presetApplied`). Each entry also carries `profileSource` — `"server-manager"` when the resolved `profile` came from [Server Manager connections](#server-manager-connections-optional), `"env"` for an `IRIS_*`/`IRIS_PROFILES` profile — so an auditor can filter by where a connection was defined, not just by its name. It mirrors the roster's `source` field exactly and is attribution only: it is never an input to any governance decision. The field is **omitted entirely in one case only** — when the call's `server` parameter named a profile that does not exist in the registry (an unknown-profile call, which is rejected). So treat a missing `profileSource` as "no profile resolved", **not** as `"env"`.

**Secrets-free by construction, not by convention.** Before an entry is ever written — before it even reaches the write queue — the logger recursively walks the call's arguments (through nested objects and arrays of objects) and replaces the *value* of any key that looks like a credential (`password`, `passwd`, `secret`, `token`, `credential`, `apikey`/`api_key`, `authorization` — case-insensitive) with `"[REDACTED]"`, and truncates any other string over 2 KB to its first 256 characters. `IRIS_AUDIT_LOG_PARAMS` defaults to `false`: the safest posture, logging parameter *key names* only and never writing a single parameter value, redacted or not. Setting it to `true` includes the (still-redacted) values for deeper forensics.

**The data policy in the log.** An entry for a call to a tool under the [PHI data policy](#phi-data-policy) (today `iris_message_body`, the `body` and `searchTable` actions of `iris_message_search`, the `preview` action of `iris_message_resend`, and `iris_production_logs` and `iris_message_diagram`, which are governed under `block`) also carries `dataPolicy`: `{"policy":"redact","redacted":4,"blocked":3}`, the policy in force and how many bodies the call showed redacted or withheld (for `iris_production_logs` and `iris_message_diagram`, how many Event Log entries or error warnings it withheld). It holds counts only, never body content, and `outcome` keeps its values (`ok`, `error`, `denied`). A tool that returns a policy refusal is logged `error` with the refusal text. The field is omitted when the call named an unknown profile. A tool declares which of its inputs carry PHI (a search value, a body filter value; today the `filters` of `iris_message_search`); under `IRIS_AUDIT_LOG_PARAMS=true` the audit log writes `"[REDACTED]"` for those values when the profile's policy is `redact` or `block`, or when the profile did not resolve, and logs them only under `allow`. The declaration decides, never the parameter's name. Message-body content never reaches the audit file or the server's console log, under any policy.

**A crashing or full disk never breaks a tool call.** Writing to the audit file is fire-and-forget: if the sink becomes unwritable mid-session, the write is swallowed, counted, and logged once as a warning — the tool call itself always completes and returns to the client normally. A *startup-time* misconfiguration is treated differently and deliberately less forgiving: if `IRIS_AUDIT_LOG` is set but its directory isn't writable, the server fails fast at launch naming the variable — an operator who asked for auditing must never end up silently running unaudited. On shutdown, the writer flushes its queue and appends a final line recording how many entries (if any) were dropped due to a degraded sink.

**Governance cannot turn this off.** This is deliberate, and it is the whole point for a regulated deployment: `IRIS_AUDIT_LOG` is server-side **configuration**, set by whoever deploys the MCP server — it is not a tool and not a governed action, so there is no `IRIS_GOVERNANCE` key for it and none will be added. An AI client operating through the MCP protocol has no path to disable or tamper with its own audit trail; only an operator with access to the server's environment can turn it off, by unsetting `IRIS_AUDIT_LOG` and restarting.

**Disambiguation — this is not `iris_audit_manage` / `iris_audit_events`.** The suite already ships two *IRIS server-side* security-audit tools: `iris_audit_manage` (`@iris-mcp/admin`) manages IRIS's own `%SYS.Audit*` security-audit subsystem (login events, privilege changes, and similar — a feature of the IRIS instance itself), and `iris_audit_events` (`@iris-mcp/ops`) reads events from that same IRIS-native audit database. `IRIS_AUDIT_LOG` is a completely different thing: it is the **MCP server process's own record of the tool calls an AI client made through it**. It has nothing to do with IRIS's built-in auditing feature, doesn't read from or write to `%SYS.Audit*`, and works whether or not IRIS-native auditing is enabled at all. Don't conflate the two when scoping a compliance review — they answer different questions ("what did IRIS's security subsystem observe" vs. "what did the AI, through this MCP server, actually do").

See the [client configuration index](docs/client-config/README.md) — covering 13 clients — or the detailed guides for [Claude Code](docs/client-config/claude-code.md), [Claude Desktop](docs/client-config/claude-desktop.md) and [Cursor](docs/client-config/cursor.md), for copy-pasteable `env` blocks.

---

## Workflow Prompts & Agent Skills

Beyond individual tools, the suite ships a pack of **MCP prompts** (Epic 25) — parameterized, workflow-shaped instructions that teach an MCP client the *sequence* of tool calls an expert would use for a task, not just the tools themselves. This is a separate MCP protocol capability from tools: prompts are discoverable via `prompts/list` and rendered via `prompts/get`, on any client that supports the [MCP `prompts` capability](https://modelcontextprotocol.io/). A server only advertises `prompts` when it has at least one registered — servers with none behave exactly as before (Rule #19 back-compat).

**Prompts do not change the 110-tool count anywhere.** They are a framework/protocol surface, not tools — no `mutates` classification, no governance key, no package tool-array change (Rule #31). See [Backward Compatibility](#backward-compatibility) above.

### The v1 pack — 13 prompts, grouped by owning server

| Server | Prompt | What it does |
|---|---|---|
| `@iris-mcp/ops` | `check-system-health` | Runs `iris_health_check`, interprets every non-`ok` finding, and names the fixing tool for each one. |
| `@iris-mcp/ops` | `run-external-backup` | Freezes the instance for an external (OS/SAN-level) snapshot and thaws it safely afterward — thaw always runs, even if the snapshot step failed. |
| `@iris-mcp/dev` | `diagnose-slow-query` | Runs `iris_sql_analyze` (`explain` → `indexUsage` → `stats`) and recommends a fix — never auto-applies one. |
| `@iris-mcp/dev` | `objectscript-review` | A concise pre-write checklist distilling this project's ObjectScript conventions ($$$ macros, `Quit` in try/catch, `%OnNew`/`initvalue`, no-underscore names, storage sections untouchable). |
| `@iris-mcp/dev` | `deploy-and-test-class` | Deploys an ObjectScript class or package (`iris_doc_load`, glob-path form), resolves compile errors, then runs its unit tests (`iris_execute_tests`) with a total-count check. |
| `@iris-mcp/dev` | `promote-environment-change` | Reviews and promotes configuration/code drift from a source IRIS environment to a target using the review-before-write `iris_env_diff` → `iris_env_promote` workflow — scoped diff, review with the user, plan, an explicit user-selected step allowlist, confirmed execute, then re-diff to verify. Never acts on `onlyInTarget` warnings; states the no-deletions guarantee and that `execute` is default-disabled. |
| `@iris-mcp/dev` | `edit-and-test-class` | Changes a few lines of an ObjectScript class in place: a ranged `iris_doc_get`, a guarded `iris_doc_edit` (`apply`, with `expected` built from the read; a `STALE_CONTENT` retry with `mismatches[].current`), `iris_doc_compile`, then `iris_execute_tests` with a check of `total` against the number of `Test*` methods. Every tool on the main path is in the dev `core` preset. `iris_doc_edit:apply` is enabled by default. |
| `@iris-mcp/interop` | `trace-message-flow` | Traces a message's flow through a production: `iris_production_messages` for the hops, `iris_message_search` (`headers`, in a window of at most 7 days) for the header rows, `iris_message_body` for the bodies that matter under the PHI data policy (a withheld body's reason is reported, never read another way), `iris_message_diagram` for the sequence diagram, and `iris_production_logs` for any erroring items (under `block`, the reason for withheld diagram error text and Event Log text is reported the same way, never read another way). Its name, title and arguments are unchanged. Every tool it calls is in the interop `core` preset, and each is a read that is enabled by default, except the recovery it may recommend (`iris_production_control` action `recover`, a write that is enabled by default), which it never runs without the user's confirmation. |
| `@iris-mcp/interop` | `recover-stuck-production` | Diagnoses and recovers a troubled/wedged production, following the recover-first, clean-last-resort escalation ladder — never suggests `killAppData` without the user's explicit acceptance of persistent business-state loss. |
| `@iris-mcp/interop` | `resend-failed-messages` | Resends failed messages for a config item using the dry-run-first `iris_message_resend` workflow — preview the match count, review with the user, execute only on explicit approval, then verify the new headers. States the duplication hazard and that the write actions are default-disabled. |
| `@iris-mcp/interop` | `find-patient-messages` | Finds a patient's messages by a Search Table value such as a medical record number (arguments: `patientId` required; `from`, `to`, `searchTableClass` and `namespace` optional). It reads the profile's data policy with `iris_server_profiles`, asks for a window of at most 7 days, looks the patient up with `iris_message_search` (`searchTable`, `PatientID`), lists the header rows, and reads bodies with `iris_message_body` only when the user wants content, under the PHI data policy. Its main path is in the interop `core` preset. It reads only: `iris_message_search:searchTable` and `iris_message_body` are reads, enabled by default. A withheld body stays withheld: the prompt never loosens the policy and never reads a body another way. |
| `@iris-mcp/admin` | `provision-project-environment` | Provisions a new project environment (two databases, a namespace, a user, a web application), verifying each step before the next, with rollback notes. |
| `@iris-mcp/admin` | `audit-security-posture` | Audits users, roles, service authentication settings, SSL/TLS configs, and instance auditing status; reports default passwords, `%All` holders, and insecure services. |

`@iris-mcp/data` ships **no prompts in v1**.

### Using the prompts

- **Via the MCP protocol directly** (recommended when your client supports it): call `prompts/list` on the relevant server to see its prompts, then `prompts/get` with the prompt's `name` and any arguments to render the workflow text.
- **As installable Agent Skills**: the same content is generated into a repo-root [`skills/`](skills/README.md) directory — one `SKILL.md` per prompt, with YAML frontmatter (`name`, `description`) and the workflow body. Copy the skills you want into your project's `.claude/skills/` directory (see [`skills/README.md`](skills/README.md) for details). Every tool name referenced in a prompt or skill is validated against the live tool catalog in CI, so a renamed or removed tool breaks the build rather than shipping a broken workflow.

---

## Architecture

All five servers share a common connection layer (`@iris-mcp/shared`) that handles:

- **HTTP(S) connection** to the IRIS web port using Basic Auth
- **Session cookie reuse** and CSRF token handling for efficient request batching
- **Atelier REST API** (built into IRIS) for document and code operations
- **Custom REST dispatch** (`ExecuteMCPv2.REST.Dispatch`) for execution, globals, security, interoperability, and analytics — auto-bootstrapped, and self-healing, on connection (see [Known Limitations](#migrated-or-sys-reset-instances-self-healing))
- **Built-in IRIS REST APIs** for DocDB (`/api/docdb/v1/`) and REST management (`/api/mgmnt/v2/`)

Servers communicate over the **MCP protocol** (spec v2025-11-25) using the **stdio** transport, the only supported transport: any other `MCP_TRANSPORT` or `--transport` value, `http` included, is a startup configuration error. Streamable HTTP is not offered, because it needs an authentication, bind-address and session design first. Every tool returns both `structuredContent` (machine-readable) and `text` content (human-readable), and includes tool annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) so clients can make informed decisions about tool usage.

```
┌────────────────────────────────────────────────────────┐
│                    MCP Client                          │
│          (Claude, Copilot, Cursor, etc.)               │
└──────────┬──────────┬──────────┬──────────┬───────────┘
           │          │          │          │
     ┌─────▼──┐ ┌─────▼──┐ ┌────▼───┐ ┌───▼────┐ ┌─────▼──┐
     │  dev   │ │ admin  │ │interop │ │  ops   │ │  data  │
     │(32)    │ │(26)    │ │(23)    │ │(21)    │ │(7)     │
     └───┬────┘ └───┬────┘ └───┬────┘ └───┬────┘ └───┬────┘
         │          │          │          │          │
         └──────────┴──────┬───┴──────────┴──────────┘
                           │
                  ┌────────▼────────┐
                  │  @iris-mcp/shared │
                  │  (HTTP client,   │
                  │   auth, config)  │
                  └────────┬────────┘
                           │  HTTP(S)
                  ┌────────▼────────┐
                  │  InterSystems   │
                  │     IRIS        │
                  └─────────────────┘
```

---

## Per-Package Documentation

Each server has its own README with a complete tool reference:

- [`@iris-mcp/dev` — Development Tools](packages/iris-dev-mcp/README.md)
- [`@iris-mcp/admin` — Administration Tools](packages/iris-admin-mcp/README.md)
- [`@iris-mcp/interop` — Interoperability Tools](packages/iris-interop-mcp/README.md)
- [`@iris-mcp/ops` — Operations & Monitoring Tools](packages/iris-ops-mcp/README.md)
- [`@iris-mcp/data` — Data & Analytics Tools](packages/iris-data-mcp/README.md)

Two supporting packages ship no MCP tools of their own but carry user-facing surfaces:

- [`@iris-mcp/shared`](packages/shared/README.md) — the connection/governance/audit engine every server sits on, plus the `iris-mcp-credentials` and `iris-mcp-governance` CLIs.
- [`@iris-mcp/client-config`](packages/client-config/README.md) — the 13-client adapter registry, the `iris-mcp-clients` manager CLI, and the per-adapter certification dispositions.

And two documentation sets sit alongside them:

- [`tool_support.md`](tool_support.md) — the authoritative per-tool catalog mapping every tool to the IRIS API it calls.
- [`docs/epic-summary.md`](docs/epic-summary.md) — what each of the 34 development epics built.

---

## Known Limitations

### Execution Response Payload Ceiling (`iris_execute_command` / `iris_execute_classmethod`)

The two execution tools cap what they return. On `iris_execute_command` the captured `output` is capped at **32768 raw characters**; on `iris_execute_classmethod` the same 32768-character budget is **shared** across `returnValue`, `byRefValues`, and `output`, spent in that order — so a small `returnValue` leaves nearly the whole budget for narration, while a `returnValue` longer than the budget consumes all of it and the other two fields get nothing. `byRefValues` is additionally bounded by a **1000-node** structural ceiling, independent of the character budget. There is **no environment variable and no per-call parameter to raise any of these** — they are fixed handler-side constants.

- **The cap bounds the RESPONSE, not the work.** The target has already fully executed by the time truncation is applied. This is not protection against the command's own runtime, its resource usage, or a Web Gateway timeout — live measurement found the CSP Gateway/HTTP transport carries multi-megabyte responses cleanly (tested clean to 3,000,000 characters). The ceiling exists to keep results a bounded, genuinely consumable size for MCP clients, calibrated from a real client (Claude Code CLI) observed diverting a tool result away from inline consumption once it reached 50,031 characters.
- **Truncation is flagged, and usually — but not always — marked.** Cut content is normally replaced with a machine-detectable `[IRIS-MCP-TRUNCATED ceiling=<N>chars]` marker, never a bare `...`. When the remaining budget is smaller than the marker itself (~40 characters), the field is emitted as a plain unmarked prefix instead, because a marker there would be larger than the value it replaced. **Absence of a marker is therefore not proof a field is complete** — trust the booleans: `truncated` (for `output`), `returnValueTruncated`, and `byRefTruncated`. A cut-short `byRefValues` container is marked `subscriptsTruncated: true`.
- **32768 bounds RAW characters, measured before JSON escaping.** Quotes, backslashes, and control characters expand on the wire (a control character with no short escape becomes a 6-character `\uXXXX`), so the serialized HTTP body can be several times larger. Live-measured, for a single field holding exactly 32768 raw characters: **32,860** characters serialized (plain letters, 1.0x), **98,311** (mixed metacharacters, 3.0x), **196,495** (all C0 control characters, 6.0x). **Residual risk:** that worst case is ~3.9x past the 50,031-character threshold the ceiling was calibrated against, so a metacharacter-heavy response can still be diverted by a client despite honoring the raw ceiling. Tracked as `34-7-QA-1` in `_bmad-output/implementation-artifacts/deferred-work.md`.

If you need output that exceeds the ceiling, have the target write it somewhere durable (a global, a file, a table) and retrieve it in pages rather than through a single execution response. Full per-tool detail, including the response shapes and the escaping-inflation table: [`@iris-mcp/dev`'s README](packages/iris-dev-mcp/README.md).

### Web Application Gateway Registration

When the MCP server auto-bootstraps its custom REST endpoint, it creates the web application via `Security.Applications.Create()`. However, this ObjectScript API call does **not** notify the CSP Gateway of the new application. As a result, requests to the new web app may return 404 until one of the following steps is taken:

1. **Save via System Management Portal (SMP):** Navigate to *System Administration > Security > Applications > Web Applications*, open the newly created web application, and click **Save**. This triggers the gateway registration automatically.
2. **Restart the CSP Gateway:** If SMP access is not available, restart the CSP Gateway service (or restart the IRIS instance) to force the gateway to reload its application table.

### Migrated or `%SYS`-Reset Instances (Self-Healing)

The auto-bootstrap detects deployment state by checking **both** the deployed class version **and** whether the `/api/executemcp/v2` web application is actually registered — not the class version alone. This matters when an instance's `%SYS` state diverges from the code database that holds the `ExecuteMCPv2` classes:

- **Container migration / `%SYS` restore / remounting the code DB into a fresh instance.** The `ExecuteMCPv2.*` classes (and their embedded version stamp) live in the namespace's code database and survive intact, but the web-application registration lives in `%SYS` and is lost. The result is "class version present, web app absent" — which the class-version check alone cannot detect.
- **A first install whose privileged `Configure` step failed** (e.g., the connecting user lacked `%Admin_Manage`) leaves the same state.

On the next server start, the bootstrap recognizes this `unconfigured` state and **self-heals**: it re-registers the web application (and package mapping), then **recompiles** the classes. The recompile is deliberate — a class-version hash matching the build proves the *source* is current, but it does **not** prove the *compiled objects* are valid. A code database migrated across IRIS versions keeps the source while carrying stale or version-incompatible compiled objects, which otherwise dispatch as `<NULL VALUE>` HTTP 500 errors until recompiled. No manual steps are required, provided the connecting user has `%Admin_Manage`.

If the connecting user lacks `%Admin_Manage`, the web application cannot be created; the bootstrap reports `configured: false` with manual instructions, and a later launch by a privileged user self-heals automatically.

### Non-ASCII Request-Body Content Was Mis-Decoded (Fixed in Story 34.8)

Every custom `ExecuteMCPv2.REST.*` handler reads its JSON request body through the shared `ExecuteMCPv2.Utils.ReadRequestBody` helper (14 handler classes, 46 call sites, spanning all five servers). Before Story 34.8, that helper read the body as if it were Latin-1, so **non-ASCII characters submitted in a JSON request body were silently corrupted on the way in** — verified live: `é` (U+00E9) arrived as two garbled characters matching its raw UTF-8 bytes, `世界` as six, an emoji as four. There was no error and no truncation flag; the call returned `HTTP 200` with the corrupted value already accepted.

This affected any tool whose input is written back to IRIS or otherwise round-tripped — most directly `@iris-mcp/dev`'s `iris_global_set` (`value`), whose corrupted text was written to the target global, a genuine **data corruption at rest**, plus `iris_execute_command` (`command`) and `iris_execute_classmethod` (`args`). Content that *originates* on the server (e.g. a compiled class's literal source) always round-tripped out correctly — the defect was strictly on the inbound request-body path.

**Fixed:** `ReadRequestBody` now decodes the request body's raw UTF-8 bytes explicitly (`ExecuteMCPv2.Utils.DecodeUtf8Stream`), chunk-boundary-safe and streamed in chunks so the decode itself imposes no practical body-size ceiling (measured to tens of megabytes; any remaining limit comes from the JSON parse and transport, not the decode). Accented characters, CJK, and astral-plane emoji submitted through `iris_execute_command`, `iris_execute_classmethod`, and `iris_global_set` now round-trip correctly, and plain-ASCII content is unaffected (byte-identical before and after).

**How malformed input is handled.** The decoder is deliberately **lenient**, not validating — it repairs or substitutes rather than rejecting the request:

- **Invalid byte sequences are replaced with `?`**, not rejected. This covers an orphan continuation byte, an out-of-range lead byte, a truncated sequence at end of body, and a lone (unpaired) UTF-16 surrogate encoded as WTF-8/CESU-8. The substitute is indistinguishable from a `?` the caller genuinely sent, and the response is still `HTTP 200` with no error flag. Well-formed input is never affected — a genuine emoji (a correctly paired surrogate) is always preserved intact.
- **Non-canonical ("overlong") encodings are decoded, not rejected.** For example the two bytes `C0 AF` decode to `/` even though conformant UTF-8 (RFC 3629) forbids that encoding. **Security note:** overlong forms are a classic filter-bypass technique. If you place a proxy, WAF, or gateway rule in front of these endpoints that inspects **raw bytes** for characters such as `/`, `.`, or a quote, be aware that an overlong encoding will pass that byte-level inspection and still decode to the canonical character inside IRIS. Any such rule must therefore normalize/validate UTF-8 itself rather than rely on byte matching — this matters because these endpoints execute arbitrary ObjectScript (`iris_execute_command`) and write globals (`iris_global_set`).

**The fix is forward-only.** It corrects decoding for requests received after the fix is deployed; it does **not** repair data that was already written corrupted while the defect was live. If a global (or any other target) was populated with mojibake via `iris_global_set` (or an equivalent non-ASCII write) before upgrading, that stored value remains corrupted until it is explicitly rewritten — there is no automated repair tool for previously-corrupted data. Tracked as ledger item `34-6-CR-7` in this repository's deferred-work ledger (`_bmad-output/implementation-artifacts/deferred-work.md`), resolved by Story 34.8.

---

## License

[MIT](LICENSE)

## Contributing

Contributions are welcome. Please open an issue to discuss proposed changes before submitting a pull request.
