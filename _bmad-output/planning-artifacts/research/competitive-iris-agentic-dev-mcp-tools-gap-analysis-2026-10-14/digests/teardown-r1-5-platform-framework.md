# Digest teardown-r1-5 — connections, containers/sandbox, agent platform, cross-cutting framework

Scope: 30 tools (6 connection, 6 container/sandbox/config, 18 agent-platform) plus the cross-cutting server framework | Source: intersystems-community/iris-agentic-dev @ b6205bb (2026-10-10; tag v1.5.0 = 2026-10-05) | Accessed: 2026-10-14

Path abbreviations: `core/` = `crates/iris-agentic-dev-core/src/`, `bin/` = `crates/iris-agentic-dev-bin/src/`, `mod.rs` = `core/tools/mod.rs`, `wg` = `core/tools/write_gate.rs`, `st` = `core/tools/skills_tools.rs`. Tiers: B = Baseline, N = Nostub, M = Merged. "(−ns)" means the tool is removed by `--no-skills` (mod.rs:2751-2772).

## Capability table (Part A)

| Tool | Mode/action | What it does (verified) | Key params | Mechanism | R/W | Safety gate | Tiers | Status | Source (file:line) |
|---|---|---|---|---|---|---|---|---|---|
| iris_servers | (probe flag) | Lists every pool entry with name, host, port, base_url (prefix included), web_prefix, namespace, username and source (iad-native / vscode / fleet / env). With `probe:true` it probes all entries in parallel and adds reachable, auth, latency_ms, error, iris_version and atelier_version. Flags `has_plaintext_credential` on iad-native entries whose password sits in servers.json. | probe (default false) | Reads the in-memory pool and servers.json. Probing makes HTTP calls to each Atelier endpoint. | R | ro (wg:461); read_only_hint | B,N,M | implemented | mod.rs:8045-8182 |
| iris_add_server | — | Upserts an entry into the iad-native `servers.json` and validates `web_prefix`. Stores the credential in the OS keychain. If no keychain is available, it writes the password **in plaintext** into servers.json and returns `stored_plaintext:true`. The live pool is unchanged until `iris_reload_pool` runs. | name, host, port, namespace, username, password, description?, scheme?, web_prefix? | Local file + OS keychain (keyring) | W (local) | Write gate (wg:511); no annotation | B,N,M | implemented | mod.rs:8184-8278; core/tools/server_tools.rs:20-42 |
| iris_remove_server | — | Removes an iad-native entry. Refuses vscode/fleet/env sources with REMOVE_NOT_ALLOWED and clears the default if it pointed at the removed entry. Best-effort deletes the keychain item (service `intersystems-server-credentials`, account `credentialProvider:<name>/<user>`, the same store VS Code Server Manager uses). Needs a reload afterwards. | name | Local file + keychain | W (local) | **Destructive** tier (wg:529); destructive_hint | B,N,M | implemented | mod.rs:8280-8342 |
| iris_reload_pool | — | Pre-validates the workspace TOML (`.iris-agentic-dev.toml` or legacy `.iris-dev.toml`). On a parse error it returns TOML_PARSE_ERROR and keeps the existing pool. Otherwise it rebuilds the pool from TOML + servers.json + env and swaps it in atomically. | none | Local files; in-memory | R by classification, but it mutates the in-process routing table | ro (wg:460); read_only_hint | B,N,M | implemented | mod.rs:8344-8398 |
| iris_test_server | name (pooled) | Sends `GET /api/atelier/` with Basic auth and reports reachable, auth, atelier_version, iris_version, latency_ms and http_status. NoPWS detection (sentinel URL `http://127.0.0.1:1`, or a version containing "2026.2.0AI") skips the HTTP probe. If IRIS_CONTAINER is set, it then runs `docker exec <c> sh -c "grep WebServer iris.cpf"` to collect evidence. | name | HTTP; docker CLI (NoPWS case only) | R | ro (wg:482); read_only_hint | B,N,M | implemented | mod.rs:8400-8569 |
| iris_test_server | host (ad-hoc) | Probes a server that is not in the pool. Defaults: web_port 52773, username `_SYSTEM`, empty password, namespace USER. | host, web_port?, username?, password? | HTTP | R | ro | B,N,M | implemented | mod.rs:8409-8425; server_tools.rs:58-71 |
| iris_import_servers | — | Reads `intersystems.servers` from the VS Code settings.json and the Cursor settings.json (macOS/Linux paths). Inserts names not already present into servers.json, with namespace **forced to "USER"**, web_prefix carried over and password=None (resolved from the keychain at load). Never overwrites. Lists names that have no keychain entry. | none | Local settings files + keychain lookup | W (local) | Write gate (wg:512) | B,N,M | implemented | mod.rs:8571-8665 |
| iris_list_containers | — | Lists IRIS containers through `idt` (iris-devtester), falling back to `docker ps`. Scores each name against the workspace basename. Returns a suggestion, workspace_config, active_connection and `mismatch`/`mismatch_hint` against the container named in the TOML. | workspace_root? | Local process exec (idt, docker CLI) | R | ro (wg:453); read_only_hint | B,N | implemented | mod.rs:5030-5128, 2162-2250 |
| iris_select_container | — | Finds the named running container, builds `http://localhost:<port_web>` (default ports 1972/52773) and probes Atelier. On success it **replaces the session's active connection** and re-resolves the write/destructive gates against the new SystemMode/namespace, keeping the declared gates. Errors: CONTAINER_NOT_FOUND (lists available names), CONTAINER_UNREACHABLE. | name, namespace? (else IRIS_NAMESPACE, else USER), username/password (default `_SYSTEM`/`SYS`) | Container listing + HTTP probe; in-memory switch | W (session state) | Write gate (wg:514) | B,N | implemented | mod.rs:5130-5232; mod.rs:1209-1258 |
| iris_start_sandbox | — | If a container named `<name>` (default `<cwd-basename>-iris`) is already running, returns `idempotent:true`. Otherwise runs `idt container up --name <n> --edition <e>` and returns its ports. If idt is missing it returns INTERNAL_ERROR with a "pip install iris-devtester" hint. Does not call check_reload. | name?, edition (default "community") | Local process exec of the iris-devtester CLI (Python tool) | W (creates container) | Write gate (wg:515) | B,N | implemented | mod.rs:5476-5553; mod.rs:1221-1261 |
| iris_containers | list | Delegates to iris_list_containers with `workspace_root = OBJECTSCRIPT_WORKSPACE`. It is the default action; unknown actions return INVALID_ACTION. | action, name | as above | R | mixed: list ro (wg:558-562) | M only | implemented | mod.rs:7208-7252 |
| iris_containers | select | Delegates to iris_select_container with namespace None and credentials hard-wired to `_SYSTEM`/`SYS`; there are no credential params. The description says "validate container connection", but the code **switches** the active connection. | action, name | as above | W | default Write (wg:558-562) | M only | implemented (doc wording discrepancy) | mod.rs:7229-7237 |
| iris_containers | start | Delegates to iris_start_sandbox with edition fixed at "community". | action, name | as above | W | default Write | M only | implemented | mod.rs:7238-7244 |
| check_config | — | Snapshot with no network calls. Fields: server_version, connected, connection_source, host/port/namespace/container, config_file, config_watch_path, config_loaded_at, iris_version, write/destructive enabled + `*_source`, tls_verify, objectscript_workspace, capabilities, config_parse_error, iris_audit_failures, fallback_warning, plus a server_manager section (VS Code SM profiles, per-profile credential status RESOLVED / NOT_CONFIGURED / KEYCHAIN_UNAVAILABLE, fleet policy). The description documents a "write a TOML to config_watch_path to switch connection" workflow. | none | In-memory + local settings/keychain reads | R | ro (wg:431); read_only_hint | B,N,M | implemented | mod.rs:5234-5474 |
| agent_info | what=stats | Counts `^SKILLS` keys by running ObjectScript in OBJECTSCRIPT_SKILLMCP_NAMESPACE (default USER). Returns that count with session_calls and learning_enabled. | what | IRIS generator exec | R | ro (wg:428); read_only_hint | B,N (not removed by --no-skills) | implemented | mod.rs:6718-6732; st:411-433 |
| agent_info | what=history | Returns the last N in-memory calls as {tool, success, ago_secs}. Still requires a live IRIS connection (get_iris_reloaded) even though it never touches IRIS. | what, limit (default 20) | In-memory | R | ro | B,N | implemented | st:434-453 |
| skill_list | — | Merges the bundled skills (embedded at build via `include_str!`, internal tier hidden) with synthesized `^SKILLS` entries. Each entry is tagged `source` bundled/synthesized, and per-source counts are reported. | none | Embedded data + IRIS global read | R | ro (wg:497); read_only_hint | B,N,M (−ns) | implemented | mod.rs:6015-6035; core/skills/bundled.rs:9,111,259 |
| skill_describe | — | Checks bundled skills first (returns the body). Otherwise runs `Write $Get(^SKILLS(name))` and parses the result as JSON. A NOT_FOUND names the sources searched. | name | Embedded + IRIS exec | R | ro; read_only_hint | B,N,M (−ns) | implemented | mod.rs:6037-6087 |
| skill_search | — | Scores bundled skills on name/description/frontmatter tags, and synthesized skills on name and description. Sorts and truncates to top_k. | query, top_k | Embedded + IRIS | R | ro; read_only_hint | B,N,M (−ns) | implemented | mod.rs:6089-6168 |
| skill_forget | — | Runs `Kill ^SKILLS("<name>") Write "OK"` and reports success only when a bare "OK" line comes back; otherwise IRIS_EXECUTE_ERROR. With no connection it returns DOCKER_REQUIRED ("set IRIS_CONTAINER"), although the exec path is the generic iris.execute. | name | IRIS exec | W (IRIS global) | **Destructive** (wg:530); destructive_hint | B,N,M (−ns) | implemented | mod.rs:6170-6211; st:28-38 |
| skill_propose | — | Returns NOT_IMPLEMENTED ("pattern mining not yet implemented"). | none | — | — | classified Write (wg:523) | B only (−ns) | **STUB** | mod.rs:6213-6222 |
| skill_optimize | — | Returns NOT_IMPLEMENTED. The description claims DSPy optimization. | name | — | — | Write (wg:522) | B only (−ns) | **STUB** | mod.rs:6224-6236 |
| skill_share | — | Returns NOT_IMPLEMENTED. The description claims sharing via GitHub PR. | name | — | — | Write (wg:524) | B only (−ns) | **STUB** | mod.rs:6238-6250 |
| skill_community_list | — | Lists the skills and KB items that `--subscribe owner/repo` loaded into the in-memory registry at startup (fetched from `raw.githubusercontent.com/<owner>/<repo>/HEAD/.../SKILL.md`). Makes no network call at tool time. | none | In-memory (network fetch happens at startup) | R | ro (wg:495); read_only_hint | B,N,M (−ns) | implemented | mod.rs:6252-6291; core/skills/mod.rs:64-122; bin/cmd/mcp.rs:214-222 |
| skill_community_install | — | Returns NOT_IMPLEMENTED. The `skill_community action=install` dispatcher **is** implemented. | name | — | — | Write (wg:521) | B only (−ns) | **STUB** | mod.rs:6293-6305 |
| kb_index | — | Delegates to `kb` index. Reads only the **top-level** (non-recursive) `*.md`/`*.txt` files in workspace_path (default OBJECTSCRIPT_WORKSPACE or "."). Stores the **first 2000 chars** of each file as `^KBCHUNKS(<filename>)` and stops on the first IRIS error. It does no chunking or embedding, although the description says "semantic search". | workspace_path? | Local file read + IRIS global write via generator exec | W | Write gate (wg:520) | B,N,M (−ns) | implemented (docs-vs-code) | mod.rs:6307-6327; st:325-370 |
| kb_recall | — | Case-insensitive substring match over **in-memory subscribed KB items only** (title/content). Returns a snippet with score 0.9 for a title match and 0.7 for a content match. It never reads `^KBCHUNKS`, so content indexed by kb_index is **not** searched, although the description says "and any indexed content". | query, top_k | In-memory | R | ro (wg:488); read_only_hint | B,N,M (−ns) | partial (docs-vs-code) | mod.rs:6329-6389 |
| skill | list | Iterates `^SKILLS` with ObjectScript and returns JSON. Covers synthesized/installed skills only; bundled skills are **not** included, unlike skill_list. All `skill` actions require OBJECTSCRIPT_LEARNING≠false and a live IRIS connection. | action | IRIS generator exec (`^SKILLS`, namespace OBJECTSCRIPT_SKILLMCP_NAMESPACE, default USER) | R | ro override (wg:653-662) | B,N,M (−ns) | implemented | mod.rs:6674-6686; st:62-103 |
| skill | describe | Runs `$get(^SKILLS(name))` and splits on "\|" into description/body/usage_count/created_at. **No bundled-skill lookup.** | name | IRIS exec | R | ro | B,N,M (−ns) | implemented | st:104-126 |
| skill | search | Runs `$find` over the lowercased key and data of `^SKILLS`. | query | IRIS exec | R | ro | B,N,M (−ns) | implemented | st:127-141 |
| skill | forget | Runs `kill ^SKILLS(name)` and fails only on an IRIS-side error (no "OK"-line check). | name | IRIS exec | W | Destructive override | B,N,M (−ns) | implemented | st:142-154 |
| skill | propose | Needs at least 5 in-memory calls. Takes the most frequent tool among the last 20 calls and writes `^SKILLS("auto-<tool>-<n>")` with a description listing the calls and body "Recent workflow: a → b …". This is a naive frequency heuristic, not pattern mining, and it **works** even though the standalone skill_propose is a stub. | — | In-memory + IRIS global write | W | default Write | B,N,M (−ns) | implemented (heuristic) | st:155-210 |
| skill_community | list | Returns registry skills as {name, description}. | action | In-memory | R | ro (wg:663-667) | B,N,M (−ns) | implemented | mod.rs:6688-6702; st:245-253 |
| skill_community | install | Copies a skill **already loaded via --subscribe** into `^SKILLS(name)` as "desc\|content\|0\|ts"; otherwise NOT_FOUND. It does not browse or download beyond what was subscribed at startup. | package | In-memory + IRIS global write | W | default Write | B,N,M (−ns) | implemented | st:254-283 |
| kb | index | Same behaviour as kb_index above. | path | Local file read + IRIS write | W | default Write (wg:644-652) | B,N,M (**not** removed by --no-skills) | implemented | mod.rs:6704-6716; st:325-370 |
| kb | recall | Runs `$find` substring over the `^KBCHUNKS` values and stops at top_k (default 5). | query, top_k | IRIS exec | R | ro override | B,N,M | implemented | st:371-387 |
| agent_history | — | Returns the last `limit` entries of the in-process ring buffer (cap IRIS_TELEMETRY_BUFFER_SIZE, default 5000) as {tool, success, ago_secs, duration_ms, session_id}. | limit | In-memory | R | ro (wg:427) | B,N,M (−ns) | implemented | mod.rs:6391-6420, 3296-3310 |
| telemetry_query | — | Reads durable telemetry: IRIS global `^IRISDEV("telemetry",<session>,<seq>)` when connected, otherwise local `<session-uuid>.jsonl`. Filters on tool_name, session_id (UUID), since and until; limit capped at 5000. Returns params (may be redacted per DataPolicy) and a `truncated` flag. | tool_name?, session_id?, since?, until?, limit | IRIS exec or local JSONL | R | ro (wg:501) | B,N,M (not removed by --no-skills) | implemented | mod.rs:6422-6463; core/telemetry/mod.rs:263-384 |
| telemetry_export_trace | — | Reads the same sources and aggregates them into {from, to, via, count, ts} edge records. Self-described as having no consumer yet. | session_id?, since? | Same as telemetry_query | R | ro (wg:500) | B,N,M (not removed) | implemented | mod.rs:6465-6493 |
| agent_stats | — | Returns skill_count (subscribed registry skills **only**: not bundled, not `^SKILLS`), session_calls and learning_enabled. The "pattern count, KB size" in the description are **not returned**. | none | In-memory | R | ro (wg:429) | B,N,M (−ns) | partial (docs-vs-code) | mod.rs:6495-6512 |

Rows: 40 | Tools covered: 30/30.

## Framework (Part B)

### Connection model
- **Discovery order:** `--host`/IRIS_HOST; `.iris-agentic-dev.toml` (walks up from cwd, OBJECTSCRIPT_WORKSPACE overrides); IRIS_CONTAINER docker lookup; localhost port scan (52773, 41773, 51773, 8080); auto-scan of running Docker containers. — bin/cmd/mcp.rs:36-41; core/iris/workspace_config.rs:295-300
- **VS Code / Cursor Server Manager** profiles are also a discovery and pool source (DiscoverySource::ServerManager; check_config reports credential status per profile). — mod.rs:5407-5471
- **Named connection pool** with four sources: iad-native (`servers.json`, written by iris_add_server/iris_import_servers), vscode (Server Manager), fleet (TOML `[instance.*]` in `mode = "operate"`) and env (IRIS_HOST). — core/iris/connection_pool.rs:23,39; core/iris/workspace_config.rs:275-292
- **Per-call routing:** most IRIS tools take an optional `server`, resolved with `pool.get(name)`; when `server` is omitted the pool default is used, and a missing default returns IRIS_UNREACHABLE. — connection_pool.rs:47-63; tool descriptions in the index
- **Authentication:** HTTP **Basic only** on Atelier calls; no bearer/OAuth path found. — core/iris/connection.rs:453,493,640,654,694
  - CLI defaults are `_SYSTEM`/`SYS` when `--host` is given without credentials. — mcp.rs:105-106
  - Credentials can come from flags/env (IRIS_USERNAME/IRIS_PASSWORD), the TOML `username`/`password`, the OS keychain (shared with Server Manager's store), or a plaintext fallback in servers.json. — workspace_config.rs:34-35; mod.rs:8238-8264, 8332-8335
  - The VS Code extension fills IRIS_PASSWORD from the Server Manager authentication provider session token. — vscode-iris-agentic-dev/src/extension.ts:208-244
- **TLS:** `scheme = "https"` (or IRIS_SCHEME). Certificate validation is on by default and uses the OS trust store; it is turned off with `tls_verify = false`, IRIS_TLS_VERIFY=false or IRIS_INSECURE, which apply `danger_accept_invalid_certs`. — workspace_config.rs:21-33; connection.rs:151-197
- **Gateway path prefix** via `web_prefix`/IRIS_WEB_PREFIX. — workspace_config.rs:17-20; mcp.rs:55-56
- **Non-HTTP paths:**
  - `docker_only`, a docker-exec-only mode for instances without a web server. — workspace_config.rs:36-40
  - `nopws`, for no-private-web-server builds. — workspace_config.rs:41-46
  - `ssh_host`, which runs docker exec on a remote host through `ssh -o StrictHostKeyChecking=no`. — workspace_config.rs:47-51
- **Namespace:** defaults to IRIS_NAMESPACE / `--namespace` (USER), with per-tool `namespace` params on many tools. — mcp.rs:64-65
- **Hot reload:** a ConfigWatcher on `.iris-agentic-dev.toml` runs an mtime check before every call; it falls back to $HOME when cwd is "/". — mcp.rs:248-259; mod.rs:9453-9459
- **Attribution:** every IRIS request carries a User-Agent naming the caller mode and MCP peer. — connection.rs:5,65; mod.rs:9446-9452

### Governance & safety
- **Two-gate model:** a write gate plus a destructive tier that is a strict subset of it (destructive implies write; enforced by clamp). — wg:97-124, 260-268
- **Gate resolution precedence:**
  1. Operator env vars IRIS_WRITE_TOOLS_ENABLED / IRIS_DESTRUCTIVE_TOOLS_ENABLED, snapshotted once at process start.
  2. Values declared in the TOML.
  3. IRIS_ALLOW_PROD, which forces writes on.
  4. **Inferred from IRIS SystemMode** (`^%SYS("SystemMode")`): Live means off, Development/Test means on.
  5. If SystemMode is unknown, the namespace name decides: PROD/PRODUCTION/LIVE/PRD means off.
  - The destructive tier is **never inferred**; it stays off until declared.
  - Sources: wg:228-276, 297-305; core/iris/connection.rs:209-211, 488-515
- **Startup refusal:** declaring destructive=true with write=false exits with code 2 (DESTRUCTIVE_REQUIRES_WRITES). — mcp.rs:172-189; wg:325-348
- **Single enforcement point:** `call_tool` runs `gate_check` before dispatch. It classifies the call through the const `CLASSIFICATION` table, which has per-`action`/`mode` overrides matched case-insensitively. An unclassified tool is treated as Write. — mod.rs:9459-9466; wg:415-760
  - Gated tools **stay visible** and answer WRITE_TOOLS_DISABLED / DESTRUCTIVE_TOOLS_DISABLED. — mod.rs:2839-2845
  - A test cross-checks the annotations (read_only_hint/destructive_hint) against CLASSIFICATION. — mod.rs:2615-2620
- **Scope of the gate:** gates are resolved for the **active connection** (`self.connection.gates`) and re-resolved on iris_select_container. A per-target-server write allowlist (spec 074) is **explicitly deferred**; the seam is documented. — mod.rs:9460; mod.rs:5200-5204; wg:710-720
- **Per-connection policy blocks** (`[policy.<server-name>]` in the TOML):
  - `allow` category allowlist.
  - `mcpTemplate` dev/test/live: **live blocks Execute, Compile and SourceControl; test blocks Execute and Compile**.
  - `dataPolicy` block/redact/allow for PHI (default block).
  - `global_blocklist`, `data_policy_kill_allowlist` and `irisAudit`.
  - With no section, the strict defaults apply.
  - Sources: workspace_config.rs:248-272; core/policy/env_gate.rs:8-15, 24-75
- **iris_execute guard:** only a literal `Kill ^` is detected, and the code itself calls this defense-in-depth. — wg:762-819
- **Tool-visibility controls:**
  - IRIS_TOOLSET / `--toolset` tiers.
  - `--no-skills` / IRIS_NO_SKILLS removes 15 skill/KB/agent tools; `kb`, `agent_info` and `telemetry_*` survive.
  - IRIS_ENABLED_TOOLS allowlist and IRIS_DISABLED_TOOLS denylist, or TOML `enabled_tools`/`disabled_tools`; disabled wins.
  - Sources: mod.rs:2688-2825; mcp.rs:76-82; workspace_config.rs:52-66, 745-750
- **Unknown-parameter rejection:** checked centrally before dispatch, after the gate (UNKNOWN_PARAMETER). — mod.rs:9468-9491
- **Audit trail:**
  - Local `~/.iris-agentic-dev/audit.jsonl` for policy-gated calls. — core/iris/audit_log.rs:90-97; mod.rs:3321-3400
  - Opt-in `%SYS.Audit` emission per connection (`irisAudit = true`); failures are counted and surfaced in check_config. — mod.rs:3336-3380, 5370-5374
  - Every recorded call also goes to the telemetry ring buffer and a durable sink: `^IRISDEV("telemetry")` on IRIS, or local JSONL. — mod.rs:3296-3319; telemetry/mod.rs:271-300
- **Elicitation:** this is **not MCP-native**. SCM dialogs are resumed through tool params `elicitation_id`/`elicitation_answer` against an in-process store with a 5-minute TTL, swept every 60 s. — core/elicitation.rs:1-3; mcp.rs:270-279

### MCP protocol surface
- **Capabilities:** **tools only** (`enable_tools()`); no prompts or resources capability. Server `instructions` text is provided. — mod.rs:9562-9582
- **Protocol version:** get_info pins 2025-11-25, but `supported_protocol_versions` returns all KNOWN_VERSIONS, including 2026-07-28. `tools/list` sets `ttlMs=0` and `cacheScope=Public` (SEP-2549). — mod.rs:9563-9566, 9584-9590, 9626-9629
- **tools/list pagination:** IRIS_LIST_TOOLS_PAGE_SIZE, default 200, so effectively unpaginated. Schemas are normalized from JSON-Schema nullable to OpenAPI-3 `anyOf` for Vertex/Azure compatibility. — mod.rs:9592-9631
- **Output schemas:** declared per tool via `output_schema`, but **stripped from tools/list** (payload size). Results are returned as `structuredContent`. — mod.rs:2556-2558; st:9-11
- **Annotations:** `read_only_hint`/`destructive_hint` appear on a subset of tools. Several write-classified tools (iris_add_server, iris_import_servers, iris_select_container, iris_start_sandbox, kb_index) carry no annotation. — mod.rs:5032,5236,6017,6172,8047,8282
- **Transports:**
  - stdio (default).
  - Streamable HTTP (`--transport http`), default bind 127.0.0.1:8080, path `/mcp`, with a Host-header allowlist that is disabled when bound to 0.0.0.0.
  - **No authentication layer on the HTTP endpoint** was found.
  - Sources: mcp.rs:44-50, 281-305, 339-405
- **Description suppression:** `--suppress-tool-description` / IRIS_SUPPRESS_TOOL_DESCRIPTION exists for evaluation runs. — mcp.rs:83-87, 117-130

### Packaging
- **Single Rust binary** `iris-agentic-dev`. Subcommands include `mcp`, `tool`, `compile`, `exec`, `query`, `doc`, `skill`, `telemetry`, `batch`, `benchmark`, `install`, `plugin`, `init`, `capability_matrix` and `check_sm_credential`. — bin/cmd/ (directory listing)
  - `tool` exposes the same catalogue from the CLI. — mod.rs:2540-2545; bin/cmd/tool.rs:170
  - `iris-agentic-dev-{cmd}` binaries on PATH are exec'd as plugins. — bin/cmd/install.rs:3,30
- **Default tier is ambiguous:**
  - `Toolset::from_str` falls back to **Baseline** ("Default when IRIS_TOOLSET is unset"). — mod.rs:119,138
  - The `mcp` subcommand's clap default is **"merged"**. — mcp.rs:76
  - The VS Code extension defaults its setting to "baseline" and **omits IRIS_TOOLSET when the setting is baseline**, so the binary's clap default (merged) likely applies. — extension.ts:106,181
  - The mcp.rs doc comment still says "baseline (all 34 tools)". — mcp.rs:74
- **Homebrew formula** v1.5.0 installs prebuilt binaries for macOS arm64/x86_64 and Linux aarch64/x86_64. — Formula/iris-agentic-dev.rb:4-34
- **Docker image:** distroless static, with the binary as ENTRYPOINT. — Dockerfile:4,7
- **Claude plugin** (`.claude-plugin/plugin.json`, name "iris-dev", v1.5.0):
  - Bundles 11 skills.
  - Registers MCP server `iris-dev` → `iris-agentic-dev mcp`.
  - Adds **hooks**: PostToolUse on `Write|Edit`, and FileChanged on `*.cls|*.mac|*.inc`, both running `scripts/compile-hook.sh` (script not read).
  - Source: .claude-plugin/plugin.json:1-60
- **VS Code extension** (`vscode-iris-agentic-dev`):
  - Contributes an `mcpServerDefinitionProviders` entry.
  - Settings: containerName, serverPath, tlsVerify, namespace, scheme, toolset.
  - Maps `objectscript.conn` / `intersystems.servers` to IRIS_* env vars and re-registers on config change.
  - Gets the password from the Server Manager auth provider.
  - Auto-downloads the binary from GitHub releases (managedInstall.ts).
  - Sources: package.json:20-110; extension.ts:44-52, 94-96, 121-244
- **Skills are embedded** in the binary via `include_str!`, with on-disk fallback candidates. — core/skills/bundled.rs:9,111,193-265
- **AI Hub integration:** `contrib/aihub/IAD.ToolSet.xml` defines an `%AI.ToolSet` class (IAD.ToolSet.IrisAgenticDev) that wraps the binary as a stdio MCP pass-through. It is optional, not auto-installed. — contrib/aihub/IAD.ToolSet.xml:1-15

### Server-side footprint
- **No persistent ObjectScript classes are installed.** The only .cls/.xml files in the repo are test fixtures and the optional AI Hub ToolSet export. — `git ls-files` (30 .cls, all under tests/fixtures); contrib/aihub/IAD.ToolSet.xml
- **Transient scratch classes:** generator-based execution compiles a temporary `IrisDevTmp.<prefix><id>.cls`, runs it and deletes it (ScratchGuard on drop). The SIGTERM comment notes a scratch class can be left in USER if the process is killed mid-write. — core/iris/connection.rs:615-630, 1219-1280; mcp.rs:310-316
- **Globals written by agent-platform tools:**
  - `^SKILLS` and `^KBCHUNKS`, in OBJECTSCRIPT_SKILLMCP_NAMESPACE (default USER). — st:24-26, 194-200, 268-274, 353-354
  - `^IRISDEV("telemetry",<session>,<seq>)` as the durable telemetry sink. — telemetry/mod.rs:281
- **Audit records:** optional `%SYS.Audit` records when `irisAudit = true`. — mod.rs:3336-3380
- **Versioning:** none needed, since there is no installed class. Scratch classes are recreated per call.

## Claims
- claim: The active tier is ambiguous. Toolset::from_str defaults to Baseline, but the `mcp` CLI flag defaults to "merged", and the VS Code extension omits IRIS_TOOLSET when its setting is "baseline". | source: crates/iris-agentic-dev-core/src/tools/mod.rs:119,138@b6205bb; crates/iris-agentic-dev-bin/src/cmd/mcp.rs:76@b6205bb; vscode-iris-agentic-dev/src/extension.ts:181@b6205bb | publisher: intersystems-community/iris-agentic-dev | pub_date: 2026-10-10 | accessed: 2026-10-14 | confidence: medium (extension launch args not read) | class: docs-vs-code
- claim: skill_propose, skill_optimize, skill_share and skill_community_install return NOT_IMPLEMENTED and exist only in Baseline. | source: core/tools/mod.rs:6213-6305, 2690-2702@b6205bb | publisher: same | pub_date: 2026-10-10 | accessed: 2026-10-14 | confidence: high | class: maturity
- claim: `skill action=propose` IS implemented, as a naive most-frequent-tool heuristic writing to ^SKILLS. | source: core/tools/skills_tools.rs:155-210@b6205bb | publisher: same | pub_date: 2026-10-10 | accessed: 2026-10-14 | confidence: high | class: capability
- claim: kb_index stores the first 2000 chars of top-level .md/.txt files in ^KBCHUNKS, with no embeddings, despite describing "semantic search". | source: core/tools/skills_tools.rs:325-370; mod.rs:6308@b6205bb | publisher: same | pub_date: 2026-10-10 | accessed: 2026-10-14 | confidence: high | class: docs-vs-code
- claim: kb_recall searches only subscribed in-memory KB items, not ^KBCHUNKS. | source: core/tools/mod.rs:6334-6389@b6205bb | publisher: same | pub_date: 2026-10-10 | accessed: 2026-10-14 | confidence: high | class: docs-vs-code
- claim: agent_stats returns no pattern count and no KB size, despite its description. | source: core/tools/mod.rs:6495-6512@b6205bb | publisher: same | pub_date: 2026-10-10 | accessed: 2026-10-14 | confidence: high | class: docs-vs-code
- claim: The server instructions tell agents to call skill(action="describe") for bundled skills (objectscript-guardrails/-review), but the `skill` dispatcher's describe reads only ^SKILLS. | source: core/tools/mod.rs:9571-9579; skills_tools.rs:104-126@b6205bb | publisher: same | pub_date: 2026-10-10 | accessed: 2026-10-14 | confidence: medium (seeding of bundled skills into ^SKILLS not ruled out) | class: docs-vs-code
- claim: Write and destructive gates are enforced once in call_tool from a const classification table; gated tools stay listed and return WRITE_TOOLS_DISABLED / DESTRUCTIVE_TOOLS_DISABLED. | source: core/tools/mod.rs:9459-9466, 2839-2845; write_gate.rs:415-760@b6205bb | publisher: same | pub_date: 2026-10-10 | accessed: 2026-10-14 | confidence: high | class: safety
- claim: With nothing declared, the write gate is inferred from IRIS ^%SYS("SystemMode") (Live means off), then from the namespace name (PROD/PRODUCTION/LIVE/PRD means off). The destructive tier is never inferred. | source: core/tools/write_gate.rs:228-305; core/iris/connection.rs:488-515@b6205bb | publisher: same | pub_date: 2026-10-10 | accessed: 2026-10-14 | confidence: high | class: safety
- claim: Gates are resolved for the active connection, not per `server` target; a per-server write allowlist is explicitly deferred. | source: core/tools/mod.rs:9460; write_gate.rs:710-720@b6205bb | publisher: same | pub_date: 2026-10-10 | accessed: 2026-10-14 | confidence: medium (pooled-handler code not read) | class: safety
- claim: Per-connection `[policy.<server>]` blocks set mcpTemplate (live blocks Execute/Compile/SourceControl; test blocks Execute/Compile), dataPolicy (PHI, default block), a global blocklist and an irisAudit opt-in. | source: core/iris/workspace_config.rs:248-272; core/policy/env_gate.rs:8-15@b6205bb | publisher: same | pub_date: 2026-10-10 | accessed: 2026-10-14 | confidence: high | class: safety
- claim: Tool visibility can be shaped by tier, --no-skills, an IRIS_ENABLED_TOOLS allowlist and an IRIS_DISABLED_TOOLS denylist (or TOML equivalents); disabled wins. | source: core/tools/mod.rs:2688-2825@b6205bb | publisher: same | pub_date: 2026-10-10 | accessed: 2026-10-14 | confidence: high | class: framework
- claim: The MCP surface is tools-only (no prompts/resources), with output schemas stripped from tools/list and results in structuredContent. | source: core/tools/mod.rs:9565, 2556-2558@b6205bb | publisher: same | pub_date: 2026-10-10 | accessed: 2026-10-14 | confidence: high | class: framework
- claim: The transports are stdio and streamable HTTP (default 127.0.0.1:8080/mcp), with no auth on the HTTP endpoint found. | source: crates/iris-agentic-dev-bin/src/cmd/mcp.rs:44-50, 339-405@b6205bb | publisher: same | pub_date: 2026-10-10 | accessed: 2026-10-14 | confidence: medium-high | class: framework
- claim: IRIS auth is HTTP Basic only; credentials come from env/flags, TOML, the OS keychain shared with VS Code Server Manager, or plaintext in servers.json. | source: core/iris/connection.rs:453,493; core/tools/mod.rs:8238-8264, 8332-8335@b6205bb | publisher: same | pub_date: 2026-10-10 | accessed: 2026-10-14 | confidence: high | class: mechanism
- claim: iris_add_server writes the password in plaintext to servers.json when no keychain is available. | source: core/tools/mod.rs:8244-8264@b6205bb | publisher: same | pub_date: 2026-10-10 | accessed: 2026-10-14 | confidence: high | class: safety
- claim: iris_import_servers imports VS Code and Cursor Server Manager profiles with namespace forced to USER. | source: core/tools/mod.rs:8583-8641@b6205bb | publisher: same | pub_date: 2026-10-10 | accessed: 2026-10-14 | confidence: high | class: capability
- claim: Container tools shell out to the iris-devtester `idt` CLI and the docker CLI; iris_start_sandbox runs `idt container up --edition community`. | source: core/tools/mod.rs:2174-2250, 5512-5522@b6205bb | publisher: same | pub_date: 2026-10-10 | accessed: 2026-10-14 | confidence: high | class: mechanism
- claim: iris_containers action=select switches the active connection with hard-wired _SYSTEM/SYS credentials, although its description says "validate". | source: core/tools/mod.rs:7209, 7229-7237@b6205bb | publisher: same | pub_date: 2026-10-10 | accessed: 2026-10-14 | confidence: high | class: docs-vs-code
- claim: No ObjectScript classes are installed server-side. Execution compiles and deletes transient IrisDevTmp.* classes; agent-platform tools write ^SKILLS, ^KBCHUNKS and ^IRISDEV("telemetry"). | source: core/iris/connection.rs:615-630, 1219-1280; skills_tools.rs:24-26; telemetry/mod.rs:281@b6205bb | publisher: same | pub_date: 2026-10-10 | accessed: 2026-10-14 | confidence: high | class: framework
- claim: The audit trail is a local ~/.iris-agentic-dev/audit.jsonl for policy-gated calls, plus opt-in %SYS.Audit emission per connection. | source: core/iris/audit_log.rs:90-97; core/tools/mod.rs:3321-3400@b6205bb | publisher: same | pub_date: 2026-10-10 | accessed: 2026-10-14 | confidence: high | class: safety
- claim: Elicitation is tool-level resume tokens (elicitation_id/elicitation_answer, 5-minute TTL), not MCP elicitation/create. | source: core/elicitation.rs:1-3; bin/cmd/mcp.rs:270-279@b6205bb | publisher: same | pub_date: 2026-10-10 | accessed: 2026-10-14 | confidence: medium-high | class: framework
- claim: Distribution channels are Homebrew (v1.5.0 prebuilt for 4 platforms), a distroless Docker image, a Claude plugin with compile hooks, a VS Code MCP-provider extension with binary auto-download, and an optional AI Hub %AI.ToolSet. | source: Formula/iris-agentic-dev.rb:4-34; Dockerfile:4,7; .claude-plugin/plugin.json:1-60; vscode-iris-agentic-dev/package.json:36-43; contrib/aihub/IAD.ToolSet.xml:1-15@b6205bb | publisher: same | pub_date: 2026-10-10 | accessed: 2026-10-14 | confidence: high | class: framework

## Leads worth chasing
1. **Which tier users actually get.** The CLI default (merged), the core default (baseline) and the VS Code setting (baseline, but not passed through) disagree. This decides whether iris_list_containers, iris_select_container, iris_start_sandbox, agent_info and the stubs are visible, versus the iris_containers dispatcher. Read `extension.ts` around the server-definition args and `bin/cmd/tool.rs:429`.
2. **Gate scope under per-call `server` routing.** call_tool enforces the active connection's gates. Check whether pooled-`server` handlers re-resolve the gate or the `[policy.<server>]` dispatch gate (core/policy/gate.rs) for the target server. Otherwise a write aimed at a pooled Live server may be judged by the default connection's SystemMode.
3. **Bundled-skill reachability through `skill`.** The server instructions direct `skill(action="describe")` at bundled skills, but the dispatcher reads only ^SKILLS. Check whether anything seeds ^SKILLS from bundled skills (grep `^SKILLS` writers, and the `init`/`skill` CLI subcommands).
- Also worth a look:
  - Telemetry's durable sink writes `^IRISDEV` on the target IRIS for recorded calls; find the namespace and whether it can be disabled.
  - `scripts/compile-hook.sh` (the plugin's auto-compile on Write/Edit).
  - Streamable HTTP has no auth; check whether docs warn about binding to 0.0.0.0.

## Looked for, could not find
- MCP prompts and resources capabilities: get_info enables tools only (mod.rs:9565).
- MCP progress notifications: no `ProgressNotification`/`notify_progress` hits in crates.
- OAuth or bearer-token auth to IRIS: only `basic_auth` call sites in connection.rs.
- Auth on the streamable HTTP MCP endpoint: only the Host allowlist (mcp.rs:366-377).
- Persistent server-side ObjectScript classes or an installer.
- MCP-native elicitation (elicitation/create).
- A legacy SSE transport separate from streamable HTTP: transport values are only stdio and http (mcp.rs:281-304).
- Semantic or vector retrieval in the KB tools.

## Not yet established
- The default value of `default_limit` in mod.rs (used by skill_search, kb_recall and agent_history).
- Whether `record_call` fires for every tool call or only for handlers that call it explicitly plus refusals.
- The namespace that `^IRISDEV("telemetry")` is written to, and the redaction rules in `core/telemetry/redact.rs`.
- Where `dispatch_gate` / the policy gates are invoked, and their interaction with the `server` param.
- The contents of `scripts/compile-hook.sh`.
- Whether the VS Code extension's managedInstall verifies checksums.
- `check_sm_credential` and `init` subcommand behaviour.
- README/docs claims beyond the tool descriptions: the documented-vs-implemented check was limited to the in-code descriptions.
- `contrib/aihub` beyond its first ~15 lines.
