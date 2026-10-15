---
title: 'Competitive research: iris-agentic-dev MCP tools vs. the IRIS MCP Server Suite'
type: 'competitive'
topic: 'iris-agentic-dev MCP tools vs iris-execute-mcp-v2 suite: capability gap analysis'
decision: 'Which capabilities exposed by iris-agentic-dev MCP tools does the iris-execute-mcp-v2 suite lack or only partially cover, to feed backlog/epic planning'
source: 'native run: source-code teardown of both sides at pinned commits (competitor b6205bb, ours fb676dc)'
status: complete
preset: 'deep'
validation: 'high (absence claims, skeptic-verified); normal elsewhere'
created: '2026-10-14'
updated: '2026-10-14'
claims_verified: 85
claims_unverified: 2
claims_overturned: 25
---

# Competitive research: iris-agentic-dev MCP tools vs. the IRIS MCP Server Suite

**Decision this research serves:** Which capabilities exposed by iris-agentic-dev's MCP tools does our suite lack or only partly cover? The answer feeds backlog and epic planning.

## Executive summary

**The answer:** our suite is far broader than iris-agentic-dev. That breadth is in administration, operations, security, data, and governance. The real gaps cluster in four areas, plus one defect of our own [3][4][13][15]. Close them in about five focused epics, and don't chase their tool count. The 11 to close next (P1) are:

- **How an agent edits code:** line-range reads and surgical line edits with an expected-text check (G1, G2), and protection against dropping a class's Storage block (G5). Server-side source control (G4) follows at P2.
- **Interoperability message forensics:** message header search, message body search, and Search Table lookup (G32, G33, G34), plus reading a message body under a PHI policy (G35, G50).
- **Developer test depth:** line-by-line code coverage (G23).
- **SQL write safety:** a read-only mode plus a cap on rows a write may affect (G21).
- **Our own defect:** a working HTTP transport. The CLI accepts `--transport http`, but the server throws at startup (G48) [40].

The rest of the picture:

- **Ranked by priority:** 11 to close next (P1), 16 to plan (P2), 22 opportunistic (P3), and 5 to decline by design. All counts come from the [gap register](#gap-register).
- **The surfaces differ in shape, not just size.** The competitor defines 93 tools. Its default MCP entry point serves the 81-tool `Merged` tier [1][2]. We expose 106 distinct tools across 5 servers [45][46][47][48][49].
  - **Where we lead:** whole areas they don't touch. These include security and PKI management, operations, data, interop resend and settings, environment diff and promote, MCP prompts, and per-action governance [1][15][41][51]. See [Where we lead](#where-we-lead).
  - **Their tool count makes them look closer to parity than they are.** By mechanical count, 10 of their tools have at least one stub, defective, or likely non-working mode [22][10][1]. Several headline tools are thinner than their names suggest: business-rule `get` returns only condition and action counts, `capability_matrix` lists roles only, and the debug tools mostly come back empty [15][16][10].
- **Biggest caveat:** both sides were compared by reading code at pinned commits. Nothing was run against a live instance. The priority ranking is the lead researcher's judgment against the gap register's rubric, not user-demand evidence. Five factual questions need a live probe before building (see [Open questions](#open-questions)).
- **How solid the gap list is:** an independent skeptic pass checked all 54 candidate gaps against our source. Its only job was to find each capability somewhere in our code. None was disproved outright: 29 held as confirmed gaps, and 25 narrowed to partial.

## Scope and method

- **Compared:** every MCP tool, mode, and action of `intersystems-community/iris-agentic-dev` at main `b6205bb` (2026-10-10). The tool-name set is identical at the v1.5.0 tag (2026-10-05), so this report covers both. On our side, the 5 servers plus the framework at `fb676dc`.
- **Out of scope, as requested:** the content of their bundled skills. Their skill-management tools are compared in a [separate band](#agent-platform-band-separate-comparison).
- **Process:**
  - Five teardown researchers read the competitor's source, split by domain into slices that covered all 93 tools exactly once.
  - One researcher inventoried our suite action by action.
  - The lead researcher mapped each competitor capability onto ours.
  - Three fresh-context skeptics then tried to refute every "we don't have X" claim against our source.
  - The lead researcher did a second read of the competitor code behind every load-bearing capability.
- **Granularity:** comparison is per capability (tool plus mode or action), not per tool. They pack many modes into dispatcher tools. For example, `iris_doc` has 9 modes and `iris_admin` has 25 actions [3][1].
- **Correction made during the run:** at the plan gate, the competitor's default tier was assumed to be `Baseline` (84 tools). The MCP entry point actually defaults to `merged` [2], the `Merged` tier. `Merged` drops the 4 stub tools, replaces 8 single-purpose tools with dispatchers, and adds 9 dispatchers that `Baseline` lacks, including `iris_admin`, `iris_global`, and `iris_message_body` [1]. Those 9 are therefore in the default surface.

## Surface at a glance

| Dimension | iris-agentic-dev | IRIS MCP Server Suite |
|---|---|---|
| Servers / tools | 1 Rust binary. 93 tools; default `Merged` tier = 81 [1][2] | 5 Node servers. 106 distinct tools (29 dev / 26 admin / 22 interop / 21 ops / 7 data, plus `iris_server_profiles`) [45][46][47][48][49] |
| Capability rows (tool + mode) | 208 across the teardown digests | 204 governance keys [41] |
| Server-side footprint | Nothing installed. Each call writes, compiles, runs and deletes a scratch `IrisDevTmp` class [11] | Bootstrapped `ExecuteMCPv2` REST handlers, 95 routes [55] |
| IRIS access path | Atelier REST plus scratch-class execution; docker-exec/SSH fallback when there is no web server [11] | Atelier REST plus our own REST app; HTTP only [40] |
| Multi-instance | Named pool; `server` parameter on each call [20] | Named profiles; `server` parameter on each call [44] |
| Write governance | Write and destructive tiers inferred from IRIS SystemMode; per-server policy (live template, PHI) [19][20] | Enable/disable for each of 204 actions, presets, and an env/file cascade; no environment inference [41] |
| Tool visibility | Tiers, `--no-skills`, allow and deny lists [1] | Presets `full`/`core`/`developer`, plus enable and disable lists [50] |
| MCP surface | Tools only. Output schemas declared but stripped from `tools/list`; results in `structuredContent` [1] | Tools + 11 prompts + governance resources; `structuredContent`; no `outputSchema` declared [40][51] |
| Transports | stdio + streamable HTTP, with no auth on the endpoint [2] | stdio only; `--transport http` throws at startup [40] |
| Audit | Local JSONL, plus opt-in `%SYS.Audit` [20] | Local JSONL [42] |
| Distribution extras | Claude plugin with auto-compile hooks on `Write`/`Edit` [24] | (no comparable hook) |

## Feature-by-feature comparison

The first column of each table shows the competitor's tool, with its mode in parentheses where it has several.

Verdicts:
- **Match**: we have an equivalent.
- **Ours stronger**: we have it and more.
- **Partial (Gn)**: we cover part. The gap register calls this PARTIAL.
- **Gap (Gn)**: we lack it. The gap register calls this CONFIRMED-GAP.
- **Theirs thin**: their version is a stub, defective, or hollow, so it isn't a real competitive gap.
- **n/a**: no comparable capability is expected.

A trailing qualifier adds the register priority or a caveat. The qualifiers are decline, theirs thin, generic only (reachable only by writing raw SQL or ObjectScript), manual, and granularity.

Notes describe their implementation unless they say "ours" or "we". Gap IDs resolve in the [gap register](#gap-register).

### Documents and code intelligence

| Their capability | Our equivalent | Verdict | Note |
|---|---|---|---|
| `iris_doc` (get, head, list, compiled) | `iris_doc_get` (+ `metadataOnly`), `iris_doc_list`, `iris_routine_intermediate` [25][52] | Match | They read only the `.1` INT routine [3] |
| `iris_doc` (get with a `names` batch) | `iris_doc_xml_export`, `iris_doc_export` [25] | Partial (G3) | We don't return several documents' UDL source inline in one call |
| `iris_doc` (put, delete) | `iris_doc_put`, `iris_doc_delete` [25] | Match | Their put ignores conflicts (`ignoreConflict=1`), despite a comment claiming ETag retry [3] |
| `iris_doc` (fragment) | none | Gap (G1) | Reads lines start..end [3] |
| `iris_doc` (insert, delete_lines) | none | Gap (G2) | `expected` text guard (`STALE_CONTENT`); returns a unified diff and re-numbered content [3] |
| Storage-reset guard on put | none | Gap (G5) | Refuses to drop an existing Storage block without `allow_storage_regeneration` [3] |
| `iris_source_control` (status, menu, checkout, execute); SCM probe before writes | none (only generic ObjectScript) | Gap (G4) | Uses `%Studio.SourceControl.Interface`; handles checkout prompts with a dialog round trip [4][3] |
| `iris_compile` (single, list) | `iris_doc_compile` [53] | Match | Their compile errors always report column 0 [1] |
| `iris_compile` (wildcard) | List the names, then compile them | Partial (G6) | They expand the pattern client-side over `/docnames/CLS` [1] |
| `iris_compile` (local file) | `iris_doc_load` with a glob and compile [53] | Ours stronger | Their local-file path skips their own SCM and storage guards [1] |
| `iris_doc_search` (docs.intersystems.com) | none | Gap (G7) | Algolia search with an embedded key [5] |
| `iris_search` | `iris_doc_search` [31] | Match | Theirs requires a document scope [1] |
| `iris_symbols` | `iris_doc_list` filter, `iris_package_list` [25] | Match | Searches class names only [1] |
| `iris_symbols_local` | none | Gap (G8) | Parses local files with tree-sitter; no IRIS call [6] |
| `iris_macro` (location, definition, expand) | `iris_macro_info` [31] | Match | |
| `iris_macro` (list includes / macros of an include, signature) | `iris_doc_list` RTN/inc lists includes [25] | Partial (G9) | We lack the per-include macro list and a parsed signature [10] |
| `iris_generate` (prompt context) | `iris_doc_index` + prompts [31][51] | Match | Theirs makes no LLM call [10] |
| `iris_generate_class`, `iris_generate_test` | none | Gap (G17), decline | Server-side LLM call. Their `generate_class` never uploads the class it generates [1] |
| `compare_document` | `iris_env_diff` documents (hash only) [29] | Partial (G10) | We don't produce a text diff of one document across two servers [9] |
| `compare_namespace` | `iris_env_diff` (5 areas: documents, mappings, default settings, webapps, config) [29] | Ours stronger | Theirs covers classes only, capped at 200 [9] |
| `resolve_storage` | generic SQL only | Partial (G11) | Data, Id and Index global locations [16] |
| `mermaid_class` | none | Gap (G12) | Inheritance edges only [16] |
| `docs_introspect` (methods, properties) | `iris_doc_index` [31] | Match | They swallow SQL errors [1] |
| `docs_introspect` (BPL/DTL flow) | none | Gap (G13) | Parses XData for direct subclasses [8] |
| `resolve_dynamic_dispatch` | text search, or generic SQL | Partial (G14) | Queries the compiled method dictionary [7] |
| `extract_message_map_routing` | none | Gap (G15) | Reads MessageMap XData and BPL call steps [7] |
| `find_subclass_implementations` | generic SQL | Partial (G16) | Walks the full descendant tree in one call [7] |

### Execution, SQL, testing, and debugging

| Their capability | Our equivalent | Verdict | Note |
|---|---|---|---|
| `iris_execute` | `iris_execute_command` [28] | Match | Theirs compiles a scratch class per call [11] |
| `iris_execute` (`use_session`) | none | Gap (G18) | Session state held in a Base64 `%ctx` token the client keeps [1] |
| `iris_execute` (docker/SSH fallback) | none | Gap (G20) | For instances without a web server [11] |
| `iris_execute_method` | `iris_execute_classmethod` [28] | Ours stronger | Theirs takes string arguments only; ours supports ByRef/Output and up to 20 arguments |
| `iris_query` (read) | `iris_sql_execute` [26] | Match | Theirs has no row cap; ours caps rows (`IRIS_SQL_MAX_ROWS`) |
| `iris_query` (explain) | `iris_sql_analyze` explain/stats/indexUsage/running/advise [27] | Ours stronger | |
| `iris_query` (count) | generic `COUNT(*)` | Partial (G22) | |
| `iris_query` (write); keyword blocklist in read mode | none | Gap (G21) | `max_rows_affected` pre-check; returns `%ROWCOUNT` [1] |
| `iris_test` (pattern) | `iris_execute_tests` [28] | Ours stronger | Ours runs by package, class or method, asynchronously, and can cancel. Theirs hard-codes `errors=0` [1] |
| `iris_test` (testproduction) | none | Gap (G24) | [1] |
| `iris_coverage`; `iris_test` with `coverage=true` | none | Gap (G23) | Uses `%Monitor.System.LineByLine`; measures `.1` routines only; no Cobertura output [13] |
| `iris_debug` (map_int), `debug_map_int_to_cls` | `iris_routine_intermediate` (raw material only) [52] | Partial (G25) | Both of theirs drop parts of the routine name [10] |
| `iris_debug` (error_logs), `debug_get_error_logs`, `debug_capture_packet` | none | Gap (G26); theirs thin | Theirs is a stub or likely returns empty, so neither side has it [10][1] |
| `iris_debug` (capture, source_map), `debug_source_map` | none | Theirs thin | Hollow or likely not working [10][1] |
| `iris_get_log` | n/a (we paginate and cap output) | n/a | Retrieves the full result of an earlier truncated call; held in process memory [1] |
| `iris_ws_open`, `iris_ws_exec`, `iris_ws_close` | none (`debug.ts` placeholder) [43] | Gap (G19) | Atelier v7 `/terminal` WebSocket [12] |
| `stream_inspect` | `iris_message_resend` preview (message bodies only) [35] | Partial (G27) | Theirs keeps only the first line of multi-line text [16] |
| `iris_global` (get, set, kill) | `iris_global_get`/`set`/`kill` [32] | Match | |
| `iris_global` (get with subtree, list) | none | Gap (G28) | Subtree walk up to 1,000 nodes; children listed one level deep [14] |
| `global_preview` → `global_kill` | `iris_global_kill`, under governance [32] | Gap (G29) | Single-use token that expires after 5 minutes [16] |
| `iris_table_info` | generic SQL | Partial (G30) | [10] |

### Interoperability

| Their capability | Our equivalent | Verdict | Note |
|---|---|---|---|
| `iris_production` (status, start, stop, update, recover, get_autostart, set_autostart) | `iris_production_status`/`control`/`autostart`/`summary`/`manage` [37] | Ours stronger | Ours adds restart, clean, create/delete and all-namespace summary. Their `update` ignores timeout and force [1] |
| `iris_production` (check) | none | Gap (G31) | `ProductionNeedsUpdate` [15] |
| `iris_interop_query` (logs, queues) | `iris_production_logs`, `iris_production_queues` [33] | Match | Theirs ignores `namespace` here [15] |
| `iris_interop_query` (messages: header search) | `iris_message_resend` `resendFiltered` with `dryRun` [34] | Partial (G32) | Ours exists but is write-classified and disabled by default; `iris_production_messages` filters only by session or header ID [33] |
| `iris_interop_query` (messages: body_class + body_where) | generic SQL | Partial (G33) | JOINs the body table [15] |
| `iris_interop_query` (messages: search_table) | none | Gap (G34) | `Ens_Config.SearchTableProp` lookup, for example by HL7 MRN [15] |
| `iris_production_item` (enable, disable, get_settings, set_settings) | `iris_production_item` (+ add/remove, adapter settings) | Ours stronger | Theirs sets Host settings only [15] |
| `iris_message_body` (block/redact/allow) | `iris_message_resend` preview: 1 KB, streams only [35] | Partial (G35, G50) | They redact HL7 PID/MSH fields but read only 3 body types [15][21] |
| `iris_business_rule_info` (list, get) | `iris_rule_list`, `iris_rule_get` [38] | Ours stronger | Their `get` returns only condition and action counts, with no rule logic [15] |
| `iris_production_diff` | none (our `iris_env_diff` compares across servers) | Gap (G36) | Live items vs class XData on the same server, not against SCM [15] |
| `iris_credential_list`, `iris_credential_manage` | `iris_credential_list`, `iris_credential_manage` [48] | Match | Theirs embeds passwords in generated code [15] |
| `iris_lookup_manage` (get, set, delete); `iris_lookup_transfer` | `iris_lookup_manage`, `iris_lookup_transfer` [36] | Match | |
| `iris_lookup_manage` (list_tables, list_keys) | XML export only [36] | Partial (G37) | |
| `hl7_schema_list`, `hl7_schema_inspect` | none | Gap (G38) | Field names only, no data types, although their docs claim data types [23]. Their query names haven't been checked against a live instance [16] |
| `mermaid_production` | `iris_message_diagram` (per-session sequence) [54] | Gap (G39) | Theirs is a star of items with no routing edges [16] |

### Administration, security, and operations

| Their capability | Our equivalent | Verdict | Note |
|---|---|---|---|
| `iris_admin` (list_namespaces, list_databases, database_status, namespace_mappings) | `iris_namespace_list`, `iris_database_list`/`check`, `iris_mapping_list`/`manage` [45][46] | Ours stronger | `iris_admin` itself is `Merged`-only [1] |
| `iris_admin` (list_users, list_roles, list_user_roles, check_permission) | `iris_user_get`, `iris_role_list`/`manage`, `iris_permission_check` [45] | Ours stronger | Theirs checks permissions only for the connected process [17] |
| `iris_admin` (create, update and delete for users, namespaces and webapps) | `iris_user_manage`, `iris_namespace_manage`, `iris_webapp_manage` (+ modify) [45] | Ours stronger | Their webapp authentication is hard-coded to password [17] |
| `iris_admin` (view_locks, view_processes) | `iris_locks_list`, `iris_jobs_list`, `iris_process_manage` [46] | Ours stronger | Their `view_processes` is blocked by default [18] |
| `iris_admin` (clear_password_change_flag, fresh_container_setup) | `iris_user_password` [45] | Match | |
| `iris_admin` (unlock_user) | `iris_user_manage enabled` [45] | Partial (G43) | Not established whether re-enabling also resets the failed-login counter |
| `iris_admin` (journal_search); `journal_search` tool | `iris_journal_info` (file and state only) [39] | Partial (G40) | Their standalone tool probably hangs whenever a filter skips a record [16][18] |
| `iris_admin` (mirror_add_async, mirror_failover) | `iris_mirror_status` (read) [39] | Partial (G41), decline | Uses `SYS.Mirror` join and become-primary [16] |
| `iris_info` (documents, modified, namespace, metadata, jobs, csp_apps) | `iris_doc_list`, `iris_server_namespace`/`info`, `iris_jobs_list`, `iris_webapp_list` [25][46][45] | Match | |
| `iris_info` (csp_debug, sa_schema) | none | Gap (G44) | [10] |
| `iris_namespace_list`, `iris_database_list`, `iris_database_stats` | as above [45] | Match | |
| `iris_namespace_create` | `iris_namespace_manage` create [45] | Ours stronger | Theirs never creates the database [16] |
| `iris_system_performance` | none | Partial (G42), generic only | Drives `^SystemPerformance` runs and profiles; returns only the report's path [16] |
| `iris_mirror_status` | `iris_mirror_status` [39] | Ours stronger | Theirs returns 4 fields |
| `query_audit_log` | `iris_audit_events`, `iris_audit_manage` [39][45] | Ours stronger | Theirs returns 4 columns and can't configure auditing [16] |
| `my_access`, `capability_matrix` | `iris_user_get`, `iris_permission_check` [45] | Ours stronger | Their "matrix" is a list of roles [16] |

### Connections and environment

| Their capability | Our equivalent | Verdict | Note |
|---|---|---|---|
| `iris_servers` (list) and `check_config` | `iris_server_profiles` + governance resources [44][40] | Match | |
| `iris_servers` (probe), `iris_test_server` | `iris_server_info` per profile; CLI `credentials test` [44] | Partial (G46) | |
| `iris_add_server`, `iris_remove_server`, `iris_import_servers`, `iris_reload_pool` | env/Server Manager import at startup; credentials CLI [44] | Partial (G45), decline | Theirs can fall back to a plaintext password file [1] |
| `iris_list_containers`, `iris_select_container`, `iris_start_sandbox`, `iris_containers` | none | Gap (G47), decline | Shells out to the `idt` and docker CLIs [1] |

### Framework: governance, safety, and protocol

| Their capability | Our equivalent | Verdict | Note |
|---|---|---|---|
| Write and destructive tiers enforced centrally [19] | Per-action governance with 204 keys; new writes disabled by default [41] | Ours stronger (granularity) | |
| Default write state inferred from IRIS SystemMode or a production-like namespace name [19] | Manual, per profile [41] | Gap (G49) | |
| Per-server policy: a live or test `mcpTemplate` blocks exec, compile, and SCM [20] | Governance per profile can disable any action [41] | Match (manual) | |
| PHI `dataPolicy` block/redact/allow [20][21] | none | Gap (G50) | Pairs with G35 |
| `%SYS.Audit` emission per connection [20] | Local JSONL only [42] | Partial (G51) | |
| Execution through a service account [1] | Restricted profile chosen per call [44] | Partial (G52) | |
| Streamable HTTP transport [2] | Accepted by the CLI, then throws [40] | Gap (G48) | Our own defect |
| Output schemas | Plumbing only [40] | Partial (G53) | Theirs are stripped from `tools/list` [1], so neither side sends them |
| MCP prompts and resources | 11 prompts + governance resources [51][40] | Ours stronger | They have neither [1] |

### Agent-platform band (separate comparison)

Their `skill`, `skill_list`, `skill_describe`, `skill_search`, `skill_forget`, `skill_community`, `skill_community_list`, `kb`, `kb_index`, `kb_recall`, `agent_info`, `agent_history`, `agent_stats`, `telemetry_query` and `telemetry_export_trace` manage a skills registry, a knowledge base, and tool-call telemetry [22]. `skill_propose`, `skill_optimize`, `skill_share` and `skill_community_install` are stubs that return `NOT_IMPLEMENTED` [1]. `kb_index` stores the first 2,000 characters of each file, with no embeddings. `kb_recall` never searches what `kb_index` stores [22].

Our nearest equivalents are 11 MCP prompts [51] and a local audit log that only gets written to, never queried through a tool [42]. Verdict: Partial (G54), rated P3. Most of the band is thin, and the skills themselves are being evaluated separately.

## Gap register

Priority rubric:

- **P1:** they ship a working implementation (second read confirmed), it matters to everyday agent work (editing, interop troubleshooting, or safety), and we have no adequate path today.
- **P2:** a real gap, but with a narrower audience, a weaker competitor implementation, or a usable generic path.
- **P3:** low value, a trivial generic workaround, or a thin competitor version.
- **Decline:** conflicts with our architecture or safety posture, or is outside the scope of an MCP server for IRIS.

Verdicts come from the skeptic pass. The rows are in ID order for lookup. By priority:
- **P1:** G1, G2, G5, G21, G23, G32, G33, G34, G35, G48, G50.
- **Decline:** G8, G17, G41, G45, G47.

| ID | Capability | Verdict | Priority | Rationale |
|---|---|---|---|---|
| G1 | Line-range read | CONFIRMED-GAP | P1 | Agents re-read whole large classes. Pairs with G2 [25] |
| G2 | Surgical line edits with an expected-text check and returned diff | CONFIRMED-GAP | P1 | Fewer tokens and safer edits. A reusable line-span and diff engine already exists in `client-config` [3][25][57] |
| G3 | Inline batch fetch of UDL source | PARTIAL | P3 | XML and to-disk versions exist [25] |
| G4 | Server-side source-control integration | CONFIRMED-GAP | P2 | Valuable where SCM hooks are used. Probe first how Atelier PUT interacts with hooks [4] |
| G5 | Storage-block drop guard | CONFIRMED-GAP | P1 | Cheap safety on the same write path as G2 [3] |
| G6 | Compile by wildcard | PARTIAL | P3 | Probe whether Atelier accepts wildcards [53] |
| G7 | Product-documentation search | CONFIRMED-GAP | P2 | Gives agents grounding. Check the terms of the Algolia key first [5] |
| G8 | Local symbol index | CONFIRMED-GAP | Decline | Local editor tools already cover this; outside the scope of an MCP server for IRIS [6] |
| G9 | Macro list for an include; macro signature | PARTIAL | P3 | [31] |
| G10 | Text diff of one document across servers | PARTIAL | P3 | Could be an option on `iris_env_diff` [29] |
| G11 | Storage resolution | PARTIAL | P3 | Could be one action of a class-introspection tool [16] |
| G12 | Class inheritance diagram | CONFIRMED-GAP | P3 | [16] |
| G13 | BPL/DTL flow extraction | CONFIRMED-GAP | P2 | Helps agents understand interop code [8] |
| G14 | "Which classes define method X" | PARTIAL | P2 | Part of a code-intelligence pack [7] |
| G15 | MessageMap / BPL routing extraction | CONFIRMED-GAP | P2 | Part of a code-intelligence pack [7] |
| G16 | Search the descendant tree for overrides | PARTIAL | P2 | Part of a code-intelligence pack [7] |
| G17 | Server-side LLM code generation | CONFIRMED-GAP | Decline | Generation is the agent's job, and their version is defective [1] |
| G18 | Stateful execution across calls | CONFIRMED-GAP | P2 | Pairs with G19 [1] |
| G19 | Persistent WebSocket terminal | CONFIRMED-GAP | P2 | Our own deferred FR107 placeholder [43][12] |
| G20 | Execution without a web server | CONFIRMED-GAP | P3 | Our architecture is HTTP-only [11] |
| G21 | SQL read-only guard plus a cap on rows a write may affect | CONFIRMED-GAP | P1 | Today `iris_sql_execute` runs any DML with no limit [26][1] |
| G22 | Row count without transferring rows | PARTIAL | P3 | Fold into the G21 work [26] |
| G23 | Line-by-line code coverage | CONFIRMED-GAP | P1 | High developer value. We can do better than theirs: every routine, plus Cobertura output [13] |
| G24 | Run TestProduction tests | CONFIRMED-GAP | P2 | [1] |
| G25 | Map an INT offset to a source line | PARTIAL | P3 | Theirs is broken for class routines [10] |
| G26 | Application error log | CONFIRMED-GAP | P2 | Neither side has a working version, so it's a chance to lead [10] |
| G27 | Read a stream by ID | PARTIAL | P3 | [35] |
| G28 | Global subtree walk and children listing | CONFIRMED-GAP | P2 | For debugging data [14][32] |
| G29 | Preview, then kill with a single-use token | CONFIRMED-GAP | P3 | Governance already gates kills [32] |
| G30 | Table → class → storage info | PARTIAL | P3 | [10] |
| G31 | Production "needs update" check | CONFIRMED-GAP | P3 | Cheap; fold into `iris_production_status` [37] |
| G32 | Message header search | PARTIAL | P1 | Quick win: expose the existing server-side search as a read action [34] |
| G33 | Message body content search | PARTIAL | P1 | [15] |
| G34 | Search Table lookup | CONFIRMED-GAP | P1 | The standard HL7 support query [15] |
| G35 | Read a message body under a PHI policy | PARTIAL | P1 | Ship together with G50. We can cover all body classes, where theirs reads 3 [15][35] |
| G36 | Drift between a running production and its class (same server) | CONFIRMED-GAP | P3 | [15] |
| G37 | List lookup tables and keys | PARTIAL | P3 | [36] |
| G38 | HL7 schema browsing | CONFIRMED-GAP | P2 | Probe their class queries live first [16] |
| G39 | Production topology diagram | CONFIRMED-GAP | P3 | Theirs has no edges [16] |
| G40 | Journal record search | PARTIAL | P2 | For forensics [18][39] |
| G41 | Mirror write operations | PARTIAL | Decline | High risk. Keep the generic path behind governance [16] |
| G42 | SystemPerformance orchestration | PARTIAL | P2 | Common in support cases [16] |
| G43 | Unlock a locked-out user | PARTIAL | P3 | Probe the counter behavior first [45] |
| G44 | CSP debug ID; Studio Assist schema | CONFIRMED-GAP | P3 | [10] |
| G45 | Manage the connection registry at runtime | PARTIAL | Decline | Our config is file-driven. Letting an agent add servers opens a credential risk [44] |
| G46 | Connectivity probe tool | PARTIAL | P3 | [44] |
| G47 | Container/sandbox orchestration | CONFIRMED-GAP | Decline | Strategy call; theirs depends on external CLIs [1] |
| G48 | Working HTTP transport | CONFIRMED-GAP | P1 | Our own defect: implement it, or stop accepting the flag [40] |
| G49 | Write defaults inferred from the environment | CONFIRMED-GAP | P2 | [19][41] |
| G50 | PHI data policy | CONFIRMED-GAP | P1 | Ships with G35 [20][21] |
| G51 | `%SYS.Audit` emission | PARTIAL | P2 | Matters for compliance [42] |
| G52 | Execution through a service account | PARTIAL | P3 | Per-profile routing exists [44] |
| G53 | Output schemas on the wire | PARTIAL | P3 | Neither side sends them [1][40] |
| G54 | Agent-platform band tools | PARTIAL | P3 | Separate band [22][51] |

## Where we lead

Their own dispatchers and handlers have no counterpart to the following.

- **Security:** SSL/TLS, OAuth2, LDAP, X.509, services, resources, role CRUD, SQL privileges, and audit configuration [45].
- **Operations:**
  - database actions: mount, compact, defragment, truncate, expand;
  - backups and tasks;
  - license and ECP status, Prometheus metrics, alerts, a composite health check;
  - process terminate and suspend, and CPF config [46].
- **Data:** DocDB, DeepSee MDX and cubes, and REST app management including OpenAPI generation [47].
- **Interop:** message resend with preview and dry run, per-session sequence diagrams, default settings, transform test, and full rule source [48][38][54].
- **Dev and environments:**
  - environment diff and promote across 5 areas, gated by a plan hash [29][30];
  - SQL advisor, statistics, and running statements [27];
  - async, method-level tests with cancel [28];
  - bulk export with a manifest, and XML import/export [25].
- **Framework:** governance for each of 204 actions [41], visibility presets [50], and 11 prompts plus resources [51][40].

How we know: their tool dispatch code accepts only a fixed set of actions. `iris_admin` accepts exactly 25 [1]. Their interop dispatchers are fixed sets too: no resend, no queue purge, no production create, no item add/remove, and no default settings [15].

## Cross-dimension insights

- **Their gaps are breadth; ours are depth.** We lead wherever an administrator or operator needs coverage. They lead in two places: the developer's edit-compile-test loop (G1–G6, G23) and interop message forensics (G32–G35). The P1 list falls almost entirely inside those two areas.
- **The architectures change what each side finds cheap.** They install nothing but compile a scratch class for every call [11]. That needs compile rights in each target namespace, %SYS included. Our teardown of their code also found unescaped input pasted into generated ObjectScript in several tools classed as read-only [16][15]. Our bootstrapped REST handlers make most P1/P2 gaps cheap: anything reachable through SQL or ObjectScript becomes one parameterized route. G32 already exists on the server side [34].
- **The two governance models complement each other.** Theirs infers safety from the environment: SystemMode, a live template, and PHI policy [19][20]. Ours is explicit and fine-grained [41]. Adding G49 and G50 would fold their best idea into the stricter model.
- **For several gaps, we can build something better than their version, not just match it.** Their versions have known defects:
  - Coverage measures only `.1` routines and never writes Cobertura (G23) [13].
  - Message bodies are limited to 3 classes (G35) [15].
  - Debug error-log tools are stubs or likely return empty (G26) [10].
  - Doc writes ignore conflicts, so our line edits (G2) should keep a conflict check [3].

## Contrary evidence

- **Our side:** of the 54 "we don't have X" claims, 25 were narrowed to partial; none was disproved outright. The material corrections:
  - include-file listing already exists (G9) [25];
  - a header search by item, status, and time window already exists, hidden behind a write action that is disabled by default (G32) [34];
  - message-body preview returns 1 KB of stream bodies (G27, G35) [35];
  - the Server Manager import, the credentials CLI, and per-profile routing partly cover G45, G46, and G52 [44].
- **Their side:** the default-tier assumption was overturned [2]. The output-schema "advantage" turned out not to reach the wire [1].
- **The strongest counter-argument:** almost every gap is reachable generically, by writing ObjectScript through `iris_execute_command` or SQL through `iris_sql_execute` [28][26]. So the "gaps" could be called agent-skill problems. This holds for low-value items, which is why G11, G22, and G30 are P3. It doesn't hold for the P1 items:
  - Generic execution is a coarse write permission that the `read-only` governance preset blocks [41].
  - It gives no safety semantics: no expected-text check, no rows-affected cap, no PHI policy.
  - It assumes the agent already knows IRIS internals.

## Recommendations

Each recommendation names the gap register entries it covers, then ends with the artifact it feeds (PRD, epics, architecture, brief, healthcare battlecard, or the deferred-work ledger) and its confidence.

1. **Epic: Agent code editing, ergonomics, and safety** (G1, G2, G5; later G3, G10). Add line-range read, line insert/delete with an expected-text check and returned diff, and a Storage-drop guard on the write path. Both sides were verified, and a reusable line-span and diff engine exists [3][25][57]. **Feeds:** PRD (differentiation), epics. **Confidence:** high.
2. **Epic: Interop message forensics** (G32, G33, G34, G35 + G50; later G31, G37, G38). Start with G32: promote `resendFiltered`'s dry-run search into a read action, which costs very little. Then add body search, Search Table lookup, and a body reader that covers every body class under a block/redact/allow PHI policy [15][34]. **Feeds:** PRD, healthcare battlecard. **Confidence:** high.
3. **Story set: SQL write safety** (G21, G22). Add an optional read-only mode with a keyword guard, a rows-affected pre-check with a cap, and return `%ROWCOUNT` [1][26]. **Feeds:** architecture (governance). **Confidence:** high.
4. **Epic: Test depth** (G23, then G24). Add LineByLine coverage over every routine of a class, with Cobertura output and a check against a coverage target [13]. **Feeds:** PRD. **Confidence:** high.
5. **Fix now: HTTP transport** (G48). Implement streamable HTTP, or reject `--transport http` cleanly [40]. **Feeds:** the deferred-work ledger, or a story. **Confidence:** high.
6. **Plan for P2 (next planning cycle):**
   - a code-intelligence pack (G13–G16);
   - stateful execution and the WebSocket terminal (G18, G19);
   - server-side SCM (G4, probe first);
   - ops depth (G40, G42, G26);
   - docs search (G7);
   - environment-inferred write defaults and `%SYS.Audit` emission (G49, G51).

   These are real gaps, but how valuable each one is depends on demand evidence this run did not gather. **Feeds:** epics, next planning cycle. **Confidence:** medium.
7. **Decline, and record why:** G8, G17, G41, G45, G47. This keeps us from chasing tool count. **Feeds:** brief (alternatives considered). **Confidence:** high.
8. **Incidental findings about our own suite.** These are worth logging in the deferred-work ledger, along with G48 [40] and G32 [34] from recommendations 5 and 2:
   - `iris_execute_tests` is annotated `readOnlyHint:true` [28] but classified as a write in the frozen baseline [58];
   - REST route `POST /tests` has no tool calling it [55];
   - `iris_test_status` returns no `structuredContent` [56].

   **Feeds:** the deferred-work ledger. **Confidence:** high.

## Open questions

1. **Does Atelier `PUT /doc` trigger server-side source-control hooks or require a checkout?** This decides G4's priority. Probe on a namespace with a `%Studio.SourceControl` class configured.
2. **Does Atelier `action/compile` accept wildcard names?** This decides G6. Probe with a scoped pattern.
3. **Does setting `Enabled=1` reset `InvalidLoginAttempts`?** This decides G43. Probe with a disposable user.
4. **Do their HL7 class queries (`StoredSchemaNames`, `MessageStructures`, `SegmentStructureElements`) exist?** Their own end-to-end test passes on any error code [16]. Probe in an interop namespace before scoping G38.
5. **Does `iris_production_status detail=1` return the connections between items?** That would be raw material for G39. It wasn't checked within budget.
6. **How much do real users want each gap closed?** Not established. A user-voice research run on IRIS developer and interop communities would test the P1 ordering.

## Source appendix

| # | Claim / finding supported | Publisher | Pub date | Accessed | Confidence |
|---|---|---|---|---|---|
| [1] | Tool router: 93 tools, tier pruning, iris_query modes and write cap, iris_admin's 25 actions, output schemas stripped, tools-only capability | [iris-agentic-dev tools/mod.rs](https://github.com/intersystems-community/iris-agentic-dev/blob/b6205bbbad2f431ae14c34401fd55d85cb5d2305/crates/iris-agentic-dev-core/src/tools/mod.rs) | 2026-10-10 | 2026-10-14 | high (verified) |
| [2] | The MCP entry defaults to the `merged` toolset; stdio + streamable HTTP transports | [iris-agentic-dev cmd/mcp.rs](https://github.com/intersystems-community/iris-agentic-dev/blob/b6205bbbad2f431ae14c34401fd55d85cb5d2305/crates/iris-agentic-dev-bin/src/cmd/mcp.rs) | 2026-10-10 | 2026-10-14 | high (verified) |
| [3] | iris_doc's 9 modes, insert/delete_lines + STALE_CONTENT, storage guard, SCM probe, ignoreConflict=1 | [iris-agentic-dev tools/doc.rs](https://github.com/intersystems-community/iris-agentic-dev/blob/b6205bbbad2f431ae14c34401fd55d85cb5d2305/crates/iris-agentic-dev-core/src/tools/doc.rs) | 2026-10-10 | 2026-10-14 | high (verified) |
| [4] | iris_source_control status/menu/checkout/execute | [iris-agentic-dev tools/scm.rs](https://github.com/intersystems-community/iris-agentic-dev/blob/b6205bbbad2f431ae14c34401fd55d85cb5d2305/crates/iris-agentic-dev-core/src/tools/scm.rs) | 2026-10-10 | 2026-10-14 | high (verified) |
| [5] | docs.intersystems.com search via Algolia | [iris-agentic-dev tools/doc_search.rs](https://github.com/intersystems-community/iris-agentic-dev/blob/b6205bbbad2f431ae14c34401fd55d85cb5d2305/crates/iris-agentic-dev-core/src/tools/doc_search.rs) | 2026-10-10 | 2026-10-14 | high (verified) |
| [6] | Local tree-sitter symbol index | [iris-agentic-dev tools/symbols_local.rs](https://github.com/intersystems-community/iris-agentic-dev/blob/b6205bbbad2f431ae14c34401fd55d85cb5d2305/crates/iris-agentic-dev-core/src/tools/symbols_local.rs) | 2026-10-10 | 2026-10-14 | high (verified) |
| [7] | Dynamic dispatch, MessageMap routing, subclass implementations | [iris-agentic-dev tools/dict.rs](https://github.com/intersystems-community/iris-agentic-dev/blob/b6205bbbad2f431ae14c34401fd55d85cb5d2305/crates/iris-agentic-dev-core/src/tools/dict.rs) | 2026-10-10 | 2026-10-14 | high (verified) |
| [8] | BPL/DTL XData flow extraction | [iris-agentic-dev tools/xdata_flow.rs](https://github.com/intersystems-community/iris-agentic-dev/blob/b6205bbbad2f431ae14c34401fd55d85cb5d2305/crates/iris-agentic-dev-core/src/tools/xdata_flow.rs) | 2026-10-10 | 2026-10-14 | high (verified) |
| [9] | compare_document unified diff; compare_namespace classes-only with a 200 cap | [iris-agentic-dev tools/comparison_tools.rs](https://github.com/intersystems-community/iris-agentic-dev/blob/b6205bbbad2f431ae14c34401fd55d85cb5d2305/crates/iris-agentic-dev-core/src/tools/comparison_tools.rs) | 2026-10-10 | 2026-10-14 | high (verified) |
| [10] | iris_info 8 modes incl. csp_debug/sa_schema; iris_macro actions; iris_debug stub and hollow modes; table_info | [iris-agentic-dev tools/info.rs](https://github.com/intersystems-community/iris-agentic-dev/blob/b6205bbbad2f431ae14c34401fd55d85cb5d2305/crates/iris-agentic-dev-core/src/tools/info.rs) | 2026-10-10 | 2026-10-14 | high (verified) |
| [11] | Scratch-class execution per call; docker-exec/SSH fallback | [iris-agentic-dev iris/connection.rs](https://github.com/intersystems-community/iris-agentic-dev/blob/b6205bbbad2f431ae14c34401fd55d85cb5d2305/crates/iris-agentic-dev-core/src/iris/connection.rs) | 2026-10-10 | 2026-10-14 | high (verified) |
| [12] | Atelier v7 /terminal WebSocket session | [iris-agentic-dev iris/ws_session.rs](https://github.com/intersystems-community/iris-agentic-dev/blob/b6205bbbad2f431ae14c34401fd55d85cb5d2305/crates/iris-agentic-dev-core/src/iris/ws_session.rs) | 2026-10-10 | 2026-10-14 | high (verified) |
| [13] | LineByLine coverage, .1 routines only | [iris-agentic-dev tools/coverage.rs](https://github.com/intersystems-community/iris-agentic-dev/blob/b6205bbbad2f431ae14c34401fd55d85cb5d2305/crates/iris-agentic-dev-core/src/tools/coverage.rs) | 2026-10-10 | 2026-10-14 | high (verified) |
| [14] | iris_global get (subtree)/set/kill/list | [iris-agentic-dev tools/global.rs](https://github.com/intersystems-community/iris-agentic-dev/blob/b6205bbbad2f431ae14c34401fd55d85cb5d2305/crates/iris-agentic-dev-core/src/tools/global.rs) | 2026-10-10 | 2026-10-14 | high (verified) |
| [15] | Interop: message search modes, message_body, rules, production diff, credentials, lookups; closed action sets | [iris-agentic-dev tools/interop.rs](https://github.com/intersystems-community/iris-agentic-dev/blob/b6205bbbad2f431ae14c34401fd55d85cb5d2305/crates/iris-agentic-dev-core/src/tools/interop.rs) | 2026-10-10 | 2026-10-14 | high (verified) |
| [16] | SystemPerformance, mirror ops, journal_search, audit, HL7 schema, mermaid, global_preview/kill, stream_inspect, resolve_storage | [iris-agentic-dev tools/admin_tools.rs](https://github.com/intersystems-community/iris-agentic-dev/blob/b6205bbbad2f431ae14c34401fd55d85cb5d2305/crates/iris-agentic-dev-core/src/tools/admin_tools.rs) | 2026-10-10 | 2026-10-14 | high (verified) |
| [17] | iris_admin user/namespace/webapp handlers; check_permission covers the connected process only | [iris-agentic-dev tools/admin.rs](https://github.com/intersystems-community/iris-agentic-dev/blob/b6205bbbad2f431ae14c34401fd55d85cb5d2305/crates/iris-agentic-dev-core/src/tools/admin.rs) | 2026-10-10 | 2026-10-14 | medium (unverified, single read) |
| [18] | iris_admin journal_search, view_locks, view_processes, mappings | [iris-agentic-dev tools/observability.rs](https://github.com/intersystems-community/iris-agentic-dev/blob/b6205bbbad2f431ae14c34401fd55d85cb5d2305/crates/iris-agentic-dev-core/src/tools/observability.rs) | 2026-10-10 | 2026-10-14 | high (verified) |
| [19] | Central classification; write gate inferred from SystemMode | [iris-agentic-dev tools/write_gate.rs](https://github.com/intersystems-community/iris-agentic-dev/blob/b6205bbbad2f431ae14c34401fd55d85cb5d2305/crates/iris-agentic-dev-core/src/tools/write_gate.rs) | 2026-10-10 | 2026-10-14 | high (verified) |
| [20] | Per-server policy: mcpTemplate, dataPolicy, irisAudit; connection pool sources | [iris-agentic-dev iris/workspace_config.rs](https://github.com/intersystems-community/iris-agentic-dev/blob/b6205bbbad2f431ae14c34401fd55d85cb5d2305/crates/iris-agentic-dev-core/src/iris/workspace_config.rs) | 2026-10-10 | 2026-10-14 | high (verified) |
| [21] | BULK_PHI_TOOLS PHI gate | [iris-agentic-dev policy/data_policy_gate.rs](https://github.com/intersystems-community/iris-agentic-dev/blob/b6205bbbad2f431ae14c34401fd55d85cb5d2305/crates/iris-agentic-dev-core/src/policy/data_policy_gate.rs) | 2026-10-10 | 2026-10-14 | high (verified) |
| [22] | Skills/KB/telemetry tools; 4 stubs; kb_index has no embeddings | [iris-agentic-dev tools/skills_tools.rs](https://github.com/intersystems-community/iris-agentic-dev/blob/b6205bbbad2f431ae14c34401fd55d85cb5d2305/crates/iris-agentic-dev-core/src/tools/skills_tools.rs) | 2026-10-10 | 2026-10-14 | high (verified) |
| [23] | Their tool docs overclaim several behaviors compared with the code | [iris-agentic-dev docs/tools.md](https://github.com/intersystems-community/iris-agentic-dev/blob/b6205bbbad2f431ae14c34401fd55d85cb5d2305/docs/tools.md) | 2026-10-10 | 2026-10-14 | medium (unverified, single read) |
| [24] | Claude plugin compile hooks on Write/Edit | [iris-agentic-dev .claude-plugin/plugin.json](https://github.com/intersystems-community/iris-agentic-dev/blob/b6205bbbad2f431ae14c34401fd55d85cb5d2305/.claude-plugin/plugin.json) | 2026-10-10 | 2026-10-14 | high (verified) |
| [25] | Our doc tools: whole-document get/put; list, export, XML export | [our iris-dev-mcp doc.ts](https://github.com/jbrandtmse/iris-execute-mcp-v2/blob/fb676dc3759b8cc65e14a24e306689d7b3ade947/packages/iris-dev-mcp/src/tools/doc.ts) | 2026-10-14 | 2026-10-14 | high (verified) |
| [26] | Our iris_sql_execute: no DML guard; caps returned rows only | [our iris-dev-mcp sql.ts](https://github.com/jbrandtmse/iris-execute-mcp-v2/blob/fb676dc3759b8cc65e14a24e306689d7b3ade947/packages/iris-dev-mcp/src/tools/sql.ts) | 2026-10-14 | 2026-10-14 | high (verified) |
| [27] | Our SQL analyze: explain/stats/indexUsage/running/advise | [our iris-dev-mcp sqlAnalyze.ts](https://github.com/jbrandtmse/iris-execute-mcp-v2/blob/fb676dc3759b8cc65e14a24e306689d7b3ade947/packages/iris-dev-mcp/src/tools/sqlAnalyze.ts) | 2026-10-14 | 2026-10-14 | high (verified) |
| [28] | Our execute_command / classmethod / execute_tests; execute_tests readOnlyHint vs write class | [our iris-dev-mcp execute.ts](https://github.com/jbrandtmse/iris-execute-mcp-v2/blob/fb676dc3759b8cc65e14a24e306689d7b3ade947/packages/iris-dev-mcp/src/tools/execute.ts) | 2026-10-14 | 2026-10-14 | high (verified) |
| [29] | Our env_diff: 5 areas, document hashes | [our iris-dev-mcp env-diff.ts](https://github.com/jbrandtmse/iris-execute-mcp-v2/blob/fb676dc3759b8cc65e14a24e306689d7b3ade947/packages/iris-dev-mcp/src/tools/env-diff.ts) | 2026-10-14 | 2026-10-14 | high (verified) |
| [30] | Our env_promote plan/execute gates | [our iris-dev-mcp env-promote.ts](https://github.com/jbrandtmse/iris-execute-mcp-v2/blob/fb676dc3759b8cc65e14a24e306689d7b3ade947/packages/iris-dev-mcp/src/tools/env-promote.ts) | 2026-10-14 | 2026-10-14 | high (verified) |
| [31] | Our doc_index / doc_search / macro_info | [our iris-dev-mcp intelligence.ts](https://github.com/jbrandtmse/iris-execute-mcp-v2/blob/fb676dc3759b8cc65e14a24e306689d7b3ade947/packages/iris-dev-mcp/src/tools/intelligence.ts) | 2026-10-14 | 2026-10-14 | high (verified) |
| [32] | Our global get (single node) / set / kill / list of names | [our iris-dev-mcp global.ts](https://github.com/jbrandtmse/iris-execute-mcp-v2/blob/fb676dc3759b8cc65e14a24e306689d7b3ade947/packages/iris-dev-mcp/src/tools/global.ts) | 2026-10-14 | 2026-10-14 | high (verified) |
| [33] | Our production_messages filters by session or header ID only; logs, queues | [our iris-interop-mcp monitor.ts](https://github.com/jbrandtmse/iris-execute-mcp-v2/blob/fb676dc3759b8cc65e14a24e306689d7b3ade947/packages/iris-interop-mcp/src/tools/monitor.ts) | 2026-10-14 | 2026-10-14 | high (verified) |
| [34] | Our resendFiltered dry-run header search is write-classified and disabled by default | [our iris-interop-mcp message-resend.ts](https://github.com/jbrandtmse/iris-execute-mcp-v2/blob/fb676dc3759b8cc65e14a24e306689d7b3ade947/packages/iris-interop-mcp/src/tools/message-resend.ts) | 2026-10-14 | 2026-10-14 | high (verified) |
| [35] | Our preview bodySummary: 1 KB, streams only, no PHI policy | [our MessageResend.cls](https://github.com/jbrandtmse/iris-execute-mcp-v2/blob/fb676dc3759b8cc65e14a24e306689d7b3ade947/src/ExecuteMCPv2/REST/MessageResend.cls) | 2026-10-14 | 2026-10-14 | high (verified) |
| [36] | Our lookup get/set/delete and XML transfer; no table list | [our iris-interop-mcp lookup.ts](https://github.com/jbrandtmse/iris-execute-mcp-v2/blob/fb676dc3759b8cc65e14a24e306689d7b3ade947/packages/iris-interop-mcp/src/tools/lookup.ts) | 2026-10-14 | 2026-10-14 | high (verified) |
| [37] | Our production manage/control/status/summary; no needs-update check | [our iris-interop-mcp production.ts](https://github.com/jbrandtmse/iris-execute-mcp-v2/blob/fb676dc3759b8cc65e14a24e306689d7b3ade947/packages/iris-interop-mcp/src/tools/production.ts) | 2026-10-14 | 2026-10-14 | high (verified) |
| [38] | Our rule_list / rule_get return full rule UDL | [our iris-interop-mcp rule.ts](https://github.com/jbrandtmse/iris-execute-mcp-v2/blob/fb676dc3759b8cc65e14a24e306689d7b3ade947/packages/iris-interop-mcp/src/tools/rule.ts) | 2026-10-14 | 2026-10-14 | high (verified) |
| [39] | Our journal_info (state only), mirror_status (read-only), audit_events | [our iris-ops-mcp system.ts](https://github.com/jbrandtmse/iris-execute-mcp-v2/blob/fb676dc3759b8cc65e14a24e306689d7b3ade947/packages/iris-ops-mcp/src/tools/system.ts) | 2026-10-14 | 2026-10-14 | high (verified) |
| [40] | Our HTTP transport throws; outputSchema plumbing unused; prompts and resources registered | [our shared server-base.ts](https://github.com/jbrandtmse/iris-execute-mcp-v2/blob/fb676dc3759b8cc65e14a24e306689d7b3ade947/packages/shared/src/server-base.ts) | 2026-10-14 | 2026-10-14 | high (verified) |
| [41] | Our per-action governance cascade, presets, default seed; no SystemMode inference | [our shared governance.ts](https://github.com/jbrandtmse/iris-execute-mcp-v2/blob/fb676dc3759b8cc65e14a24e306689d7b3ade947/packages/shared/src/governance.ts) | 2026-10-14 | 2026-10-14 | high (verified) |
| [42] | Our local JSONL audit log; no %SYS.Audit emission | [our shared audit.ts](https://github.com/jbrandtmse/iris-execute-mcp-v2/blob/fb676dc3759b8cc65e14a24e306689d7b3ade947/packages/shared/src/audit.ts) | 2026-10-14 | 2026-10-14 | high (verified) |
| [43] | Our deferred WebSocket terminal placeholder (FR107) | [our iris-data-mcp debug.ts](https://github.com/jbrandtmse/iris-execute-mcp-v2/blob/fb676dc3759b8cc65e14a24e306689d7b3ade947/packages/iris-data-mcp/src/tools/debug.ts) | 2026-10-14 | 2026-10-14 | high (verified) |
| [44] | Our profiles: env + Server Manager import at startup; per-call server; no runtime reload | [our shared profiles.ts](https://github.com/jbrandtmse/iris-execute-mcp-v2/blob/fb676dc3759b8cc65e14a24e306689d7b3ade947/packages/shared/src/profiles.ts) | 2026-10-14 | 2026-10-14 | high (verified) |
| [45] | Our iris-admin-mcp: 26 tools (security, users, roles, webapps, SSL, OAuth, LDAP, X.509, services, audit) | [our iris-admin-mcp tools/index.ts](https://github.com/jbrandtmse/iris-execute-mcp-v2/blob/fb676dc3759b8cc65e14a24e306689d7b3ade947/packages/iris-admin-mcp/src/tools/index.ts) | 2026-10-14 | 2026-10-14 | high (verified) |
| [46] | Our iris-ops-mcp: 21 tools (metrics, jobs, locks, processes, journal, mirror, databases, backups, tasks, config, health) | [our iris-ops-mcp tools/index.ts](https://github.com/jbrandtmse/iris-execute-mcp-v2/blob/fb676dc3759b8cc65e14a24e306689d7b3ade947/packages/iris-ops-mcp/src/tools/index.ts) | 2026-10-14 | 2026-10-14 | high (verified) |
| [47] | Our iris-data-mcp: 7 tools (DocDB, analytics, REST management) | [our iris-data-mcp tools/index.ts](https://github.com/jbrandtmse/iris-execute-mcp-v2/blob/fb676dc3759b8cc65e14a24e306689d7b3ade947/packages/iris-data-mcp/src/tools/index.ts) | 2026-10-14 | 2026-10-14 | high (verified) |
| [48] | Our iris-interop-mcp: 22 tools | [our iris-interop-mcp tools/index.ts](https://github.com/jbrandtmse/iris-execute-mcp-v2/blob/fb676dc3759b8cc65e14a24e306689d7b3ade947/packages/iris-interop-mcp/src/tools/index.ts) | 2026-10-14 | 2026-10-14 | high (verified) |
| [49] | Our iris-dev-mcp: 29 tools | [our iris-dev-mcp tools/index.ts](https://github.com/jbrandtmse/iris-execute-mcp-v2/blob/fb676dc3759b8cc65e14a24e306689d7b3ade947/packages/iris-dev-mcp/src/tools/index.ts) | 2026-10-14 | 2026-10-14 | high (verified) |
| [50] | Our visibility presets full/core/developer | [our shared tool-visibility.ts](https://github.com/jbrandtmse/iris-execute-mcp-v2/blob/fb676dc3759b8cc65e14a24e306689d7b3ade947/packages/shared/src/tool-visibility.ts) | 2026-10-14 | 2026-10-14 | high (verified) |
| [51] | Our MCP prompts: 11 files under `packages/iris-*-mcp/src/prompts` (dev 4, admin 2, interop 3, ops 2; lead recount) | [our packages tree](https://github.com/jbrandtmse/iris-execute-mcp-v2/tree/fb676dc3759b8cc65e14a24e306689d7b3ade947/packages) | 2026-10-14 | 2026-10-14 | high (verified) |
| [52] | Our routine_intermediate returns the .1.int/.int body | [our iris-dev-mcp routine.ts](https://github.com/jbrandtmse/iris-execute-mcp-v2/blob/fb676dc3759b8cc65e14a24e306689d7b3ade947/packages/iris-dev-mcp/src/tools/routine.ts) | 2026-10-14 | 2026-10-14 | high (verified) |
| [53] | Our doc_load (glob + compile); doc_compile takes exact names | [our iris-dev-mcp load.ts](https://github.com/jbrandtmse/iris-execute-mcp-v2/blob/fb676dc3759b8cc65e14a24e306689d7b3ade947/packages/iris-dev-mcp/src/tools/load.ts) | 2026-10-14 | 2026-10-14 | high (verified) |
| [54] | Our message_diagram: per-session sequence diagram | [our iris-interop-mcp diagram.ts](https://github.com/jbrandtmse/iris-execute-mcp-v2/blob/fb676dc3759b8cc65e14a24e306689d7b3ade947/packages/iris-interop-mcp/src/tools/diagram.ts) | 2026-10-14 | 2026-10-14 | high (verified) |
| [55] | Our REST route map: 95 routes; `POST /tests` has no tool caller | [our Dispatch.cls](https://github.com/jbrandtmse/iris-execute-mcp-v2/blob/fb676dc3759b8cc65e14a24e306689d7b3ade947/src/ExecuteMCPv2/REST/Dispatch.cls) | 2026-10-14 | 2026-10-14 | high (verified) |
| [56] | Our iris_test_status returns no structuredContent | [our iris-dev-mcp test-status.ts](https://github.com/jbrandtmse/iris-execute-mcp-v2/blob/fb676dc3759b8cc65e14a24e306689d7b3ade947/packages/iris-dev-mcp/src/tools/test-status.ts) | 2026-10-14 | 2026-10-14 | high (verified) |
| [57] | Our existing line-span edit and diff engine (MCP-client config files only) | [our client-config diff.ts](https://github.com/jbrandtmse/iris-execute-mcp-v2/blob/fb676dc3759b8cc65e14a24e306689d7b3ade947/packages/client-config/src/diff.ts) | 2026-10-14 | 2026-10-14 | high (verified) |
| [58] | Our frozen baseline classifies `iris_execute_tests` as write | [our shared baseline-classifications.ts](https://github.com/jbrandtmse/iris-execute-mcp-v2/blob/fb676dc3759b8cc65e14a24e306689d7b3ade947/packages/shared/src/baseline-classifications.ts) | 2026-10-14 | 2026-10-14 | high (verified) |

Evidence trail: per-assistant digests in `digests/` (`teardown-r1-1..5`, `ours-r1-1`, `mapping-r1-lead-candidates`, `verify-r2-1..3`); mechanical competitor tool index in `imports/competitor-tool-index.md`; decisions and claims ledger in `.memlog.md`.

## Staleness map

The staleness computation covered 112 claims. By class: capability 99, framework 6, safety 5, mechanism 1, and docs-vs-code 1. Every claim falls under the pack's feature freshness bar of 3 months or less, so all of them share one re-check date, computed by `recon_kit.py staleness` with every class set to 3 months:

| Claim classes | Count | Published | Re-check by |
|---|---|---|---|
| capability, framework, safety, mechanism, docs-vs-code | 112 | 2026-10 | 2027-01-01 |

Re-check sooner than 2027-01-01 if either of these happens:
- the competitor tags a release after v1.5.0. They made 516 commits in the 3 months before this run, so their surface moves fast;
- one of our P1 epics ships, which changes our side of the matrix.

A **Refresh** re-runs the teardown at the new competitor commit. A **Deepen** can add the open-question probes or a user-voice pass.
