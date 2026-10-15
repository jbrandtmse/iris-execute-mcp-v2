# Competitor tool index (mechanical extract)

Source: intersystems-community/iris-agentic-dev @ b6205bb (commit 2026-10-10), crates/iris-agentic-dev-core/src/tools/mod.rs; tiers from the router-pruning block (mod.rs ~2689-2830). Accessed 2026-10-14. Descriptions are the competitor's own tool descriptions (self-reported; verify against handlers).

Total #[tool] methods: 93

<details><summary>License of the reproduced tool descriptions</summary>

The tool descriptions below are reproduced from intersystems-community/iris-agentic-dev under its MIT License:

```
MIT License

Copyright (c) 2025 InterSystems Corporation

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

</details>

## iris_compile
- line: mod.rs:3517
- tiers: Baseline,Nostub,Merged
- params: CompileParams
- description: Compile an ObjectScript class, routine, or wildcard package on IRIS via Atelier REST. Supports 'MyApp.*.cls' for package-level compilation. Also accepts a local file path as `target` — uploads it first, then compiles. Returns structured errors with line numbers, columns, and severity. On a successful single-document compile, `content` carries the post-compile source (the compiler can rewrite it beyond what was submitted, e.g. auto-mapping a new property into Storage) — use it to sync a local file without a separate `iris_doc(get)`; `content` is omitted for wildcard/package compiles. No Python required. Skill: objectscript-tdd for the compile-test-fix loop. `server` (optional): name of a registered IRIS instance. If omitted, uses the default connection. Use `iris_servers` to list available instances.

## iris_test
- line: mod.rs:3987
- tiers: Baseline,Nostub,Merged
- params: TestParams
- description: Run %UnitTest.Manager or %UnitTest.TestProduction tests on IRIS and return structured pass/fail results. Uses pure-HTTP execution via Atelier REST — works with or without IRIS_CONTAINER. Pass a class name pattern like 'MyApp.Tests' or 'ISC.sql.TestFoo' to run already-compiled test classes (uses /noload automatically). Pass a directory path like 'MyApp/Tests' to load from disk. Returns suite-level summary inline plus log_id for per-test-case detail via iris_get_log. `test_type` (optional): 'auto' (default) auto-detects %UnitTest.TestProduction subclasses and calls .Run(); 'testcase' forces RunTest(); 'testproduction' forces .Run(). Skill: objectscript-unit-test for test scaffolding; objectscript-tdd for the full loop. `server` (optional): name of a registered IRIS instance. If omitted, uses the default connection. Use `iris_servers` to list available instances.

## iris_execute
- line: mod.rs:4426
- tiers: Baseline,Nostub,Merged
- params: ExecuteParams
- description: Execute arbitrary ObjectScript code on IRIS and return stdout. Two execution paths: (1) HTTP primary — wraps code in a temporary class method body (CodeMode=objectgenerator), compiles it via Atelier REST, runs it, deletes the class. Block syntax (`{}`) works here because class method bodies support it. (2) docker exec fallback — used when IRIS_CONTAINER env var is set and HTTP fails, or when the connection sets `docker_only = true` in `.iris-agentic-dev.toml` (a config-file key, not a parameter of this tool — passing docker_only in the tool arguments does nothing). This path pipes code into `iris session` stdin, which is a line-by-line terminal interpreter. Block syntax (`{}`) is NOT supported in terminal mode — `If cond { ... }` causes a `<SYNTAX>` error. Use classic terminal-compatible form instead: `If cond Write x`. For complex multi-line scripts that require `{}` on a docker exec path, write a .mac routine with `iris_doc` (mode=put) and compile it with `iris_compile`, then call `iris_execute Do entry^RoutineName`. That needs Atelier REST for `iris_doc`; under `docker_only` the routine must already be on the server. The destructive gate covers tool calls, not the code this tool runs: only a literal `Kill ^global` is checked, so for a hard limit connect as an IRIS user without delete privileges. &sql(...) embedded SQL runs natively on the HTTP path. The docker exec path has no &sql, so there it is translated to %SQL.Statement calls (set translate_sql: false to disable), and the response includes sql_translated: true and translated_code. Example: code='write $ZVERSION,!' returns the IRIS version string. Classes in Security.*, Config.* and SYS.* (web applications, users, roles, namespaces, databases) exist only in %SYS: pass namespace: "%SYS" for them. Skill: objectscript-tdd for the compile-execute-fix loop. Session state: set use_session: true to enable the %ctx carrier (%DynamicObject). Store values in %ctx.key between calls — scalars, %DynamicObject, and %Persistent objects (stored as OID stubs and re-opened on restore). The response includes session_state (opaque Base64 token); pass it back as session_state on the next call to restore %ctx. Nothing is written to IRIS — the token is held by the client. Error codes: SESSION_INVALID (bad token), SESSION_RESTORE_FAILED (missing class or bad OID), SESSION_SERIALIZE_FAILED (serialization error), TERMINAL_SYNTAX_UNSUPPORTED (block syntax on docker exec path). `server` (optional): name of a registered IRIS instance. If omitted, uses the default connection. Use `iris_servers` to list available instances.

## iris_doc
- line: mod.rs:4786
- tiers: Baseline,Nostub,Merged
- params: IrisDocParams
- description: Read/write/delete IRIS documents. mode: get (fetch source), put (write, auto SCM checkout), delete, head (existence), fragment (read lines start..end), compiled (read INT), list (glob `pattern`), insert (splice `content` before 1-based `line`; omit `line` to append), delete_lines (remove start..end). `name` is required for all single-document modes; `line`/`start`/`end` are integers. For insert with an explicit `line` and for delete_lines, pass `expected` (current text at the target lines) or the edit is refused with STALE_CONTENT. Edits return the re-numbered post-write `content` to chain from, plus a `diff` field (git-style unified diff of the change) — render it to the user inside a ```diff fenced code block. Batch via `names`; SCM dialogs resume via elicitation_id/elicitation_answer. Skill: objectscript-navigation to locate documents before editing. Storage blocks on %Persistent/%SerialObject classes: never stripped or regenerated — written verbatim, exactly like Studio/VS Code. Treat the Storage definition as off-limits: when removing a property, leave its Storage entry alone (the compiler leaves it as a harmless orphan; do not delete or edit it). Exception — renaming a property: you may update the corresponding Storage entry's name to match, in the same edit. A full storage reset (submitting content with no Storage block for a class that has one) is refused with STORAGE_RESET_REQUIRES_CONFIRMATION unless allow_storage_regeneration:true is set — only set this after the user has explicitly confirmed the reset is intentional for this session; the response then reports the pre-reset property list so you can decide how to clean up any existing data (e.g. %KillExtent). `server` (optional): name of a registered IRIS instance. If omitted, uses the default connection. Use `iris_servers` to list available instances.

## iris_query
- line: mod.rs:4820
- tiers: Baseline,Nostub,Merged
- params: QueryParams
- description: Execute SQL against IRIS via Atelier REST. mode="read" (default): SELECT only, destructive SQL blocked unless force=true. mode="explain": returns the IRIS query plan for a SELECT (plan_text, query_hash), no rows. mode="count": returns a row count for `table` or `query` without transferring rows. mode="write": executes INSERT/UPDATE/DELETE/CALL/TRUNCATE (Execute-gated, blocked on mcpTemplate=live/test); UPDATE/DELETE are pre-checked against max_rows_affected (default 1000, max 10000) before executing. Skill: objectscript-sql-patterns for IRIS SQL quirks. `server` (optional): name of a registered IRIS instance. If omitted, uses the default connection. Use `iris_servers` to list available instances.

## iris_list_containers
- line: mod.rs:5030
- tiers: Baseline,Nostub
- params: ListContainersParams
- description: List running IRIS Docker containers with name-match scoring. Tries iris-devtester first, falls back to docker ps. Containers sorted by score (name similarity to workspace) descending.

## iris_select_container
- line: mod.rs:5130
- tiers: Baseline,Nostub
- params: SelectContainerParams
- description: Switch the active IRIS connection to the specified running Docker container for this session. After a successful switch, all subsequent tool calls target the new container — no session restart required. Fixes issue #11.

## check_config
- line: mod.rs:5234
- tiers: Baseline,Nostub,Merged
- params: crate::tools::NoParams
- description: Return the active IRIS connection state without making any IRIS network calls. Always succeeds — never returns IRIS_UNREACHABLE. Use to: (1) diagnose connection issues, (2) verify hot-reload completed, (3) confirm which container/host is active, (4) confirm which build of this MCP server is actually running (server_version) when multiple installs/forks may be registered. To switch connection mid-session without restart: call check_config first to get config_watch_path, then write a .iris-agentic-dev.toml to that exact path, then call any tool — the reload fires automatically. Fields: server_version, connected, connection_source (http|docker|disconnected), host, port, namespace, container, config_file, config_watch_path, config_loaded_at, iris_version, write_tools_enabled, write_tools_source, destructive_tools_enabled, destructive_tools_source, tls_verify, capabilities. The two *_source fields say what decided each gate (operator_env|config_file|legacy_allow_prod|inferred_system_mode|inferred_namespace|inferred_default|fail_closed), so a gate you did not ask for is one field lookup rather than a guess. Skill: iris-agentic-dev.

## iris_start_sandbox
- line: mod.rs:5476
- tiers: Baseline,Nostub
- params: StartSandboxParams
- description: Start a dedicated IRIS container for the current project via iris-devtester CLI. Idempotent — returns existing container if already running.

## iris_symbols
- line: mod.rs:5555
- tiers: Baseline,Nostub,Merged
- params: SymbolsParams
- description: Search for ObjectScript classes matching a query in the IRIS namespace. Query supports: plain substring ('Patient'), package prefix ('HT.*' or 'HT.'), mid-glob ('HT.*.Service'), or bare '*' for all. Skill: objectscript-navigation. `server` (optional): name of a registered IRIS instance. If omitted, uses the default connection. Use `iris_servers` to list available instances.

## iris_symbols_local
- line: mod.rs:5579
- tiers: Baseline,Nostub,Merged
- params: SymbolsLocalParams
- description: Search for ObjectScript symbols in local .cls/.mac/.inc files on disk — no IRIS connection required. query: glob pattern (MyApp.*, *Service, MyApp.Foo.Do*). workspace_path: optional path (defaults to OBJECTSCRIPT_WORKSPACE or cwd). limit: max symbols to return (default 50). kinds: optional filter on symbol kind (class, method, property, parameter, index, xdata, query, trigger, relationship, foreignkey, projection, storage, routine, label). Each symbol includes a line field (1-based source line). Skill: objectscript-navigation.

## docs_introspect
- line: mod.rs:5637
- tiers: Baseline,Nostub,Merged
- params: IntrospectParams
- description: Introspect an ObjectScript class — returns methods, properties, and type information. Methods include FormalSpec as a structured array of {name, type, byref, output, default} objects and a ReturnType field. For BPL and DTL classes, an xdata_flow field describes the process steps (BPL: kind=bpl, steps array with Call/Code/If/Other entries, has_dynamic_dispatch flag; DTL: kind=dtl, source_class, target_class, subtransforms, assign_count). Skill: objectscript-navigation. `server` (optional): name of a registered IRIS instance. If omitted, uses the default connection. Use `iris_servers` to list available instances.

## debug_map_int_to_cls
- line: mod.rs:5695
- tiers: Baseline,Nostub
- params: DebugMapParams
- description: Map a .INT routine offset to the original .CLS source line. Pass routine+offset OR a raw IRIS error string like '<UNDEFINED>x+3^MyApp.Foo.1'.

## debug_capture_packet
- line: mod.rs:5729
- tiers: Baseline,Nostub
- params: CapturePacketParams
- description: Capture IRIS error state and recent error log entries for debugging.

## debug_get_error_logs
- line: mod.rs:5755
- tiers: Baseline,Nostub
- params: ErrorLogsParams
- description: Retrieve recent IRIS error log entries.

## debug_source_map
- line: mod.rs:5802
- tiers: Baseline,Nostub
- params: SourceMapParams
- description: Build a .INT source map for a compiled ObjectScript class via Atelier xecute. Maps .INT routine line offsets back to .CLS source lines for stack trace resolution. No Python required.

## iris_generate_class
- line: mod.rs:5832
- tiers: Baseline,Nostub,Merged
- params: GenerateClassParams
- description: Generate an ObjectScript class from a natural language description. Requires IRIS_GENERATE_CLASS_MODEL + OPENAI_API_KEY env vars. `server` (optional): name of a registered IRIS instance. If omitted, uses the default connection. Use `iris_servers` to list available instances.

## iris_generate_test
- line: mod.rs:5919
- tiers: Baseline,Nostub,Merged
- params: GenerateTestParams
- description: Generate a %UnitTest.TestCase for an existing ObjectScript class. Introspects the class first. Requires IRIS_GENERATE_CLASS_MODEL + OPENAI_API_KEY. `server` (optional): name of a registered IRIS instance. If omitted, uses the default connection. Use `iris_servers` to list available instances.

## skill_list
- line: mod.rs:6015
- tiers: Baseline,Nostub,Merged
- params: NoParams
- flags: removed by --no-skills
- description: List every available skill — both the skills bundled with this server (on disk, no IRIS needed) and any synthesized skills in the IRIS ^SKILLS global. Each result carries a `source` field: `bundled` or `synthesized`.

## skill_describe
- line: mod.rs:6037
- tiers: Baseline,Nostub,Merged
- params: SkillNameParams
- flags: removed by --no-skills
- description: Describe a skill by name. Looks in the bundled skills shipped with this server (no IRIS needed) and in the IRIS ^SKILLS global.

## skill_search
- line: mod.rs:6089
- tiers: Baseline,Nostub,Merged
- params: SkillSearchParams
- flags: removed by --no-skills
- description: Search all skills by name, description AND frontmatter tags. Covers both the skills bundled with this server (on disk, works with no IRIS connection) and synthesized skills in the IRIS ^SKILLS global. Each result carries a `source` field (`bundled`/`synthesized`); the response always reports how many skills were available in each source, so a zero result never means 'only one place was checked'.

## skill_forget
- line: mod.rs:6170
- tiers: Baseline,Nostub,Merged
- params: SkillNameParams
- flags: removed by --no-skills
- description: Remove a skill from the registry by name. Destructive tier: requires IRIS_DESTRUCTIVE_TOOLS_ENABLED=1.

## skill_propose
- line: mod.rs:6213
- tiers: Baseline
- params: NoParams
- flags: STUB (per router comment); removed by --no-skills
- description: Trigger pattern miner to synthesize new skills from recorded tool calls.

## skill_optimize
- line: mod.rs:6224
- tiers: Baseline
- params: SkillNameParams
- flags: STUB (per router comment); removed by --no-skills
- description: Optimize a skill using DSPy. Requires OBJECTSCRIPT_DSPY=true.

## skill_share
- line: mod.rs:6238
- tiers: Baseline
- params: SkillNameParams
- flags: STUB (per router comment); removed by --no-skills
- description: Share a skill to the community via GitHub PR.

## skill_community_list
- line: mod.rs:6252
- tiers: Baseline,Nostub,Merged
- params: NoParams
- flags: removed by --no-skills
- description: List all skills loaded from --subscribe packages. Use --subscribe owner/repo when starting iris-agentic-dev mcp to load community skills.

## skill_community_install
- line: mod.rs:6293
- tiers: Baseline
- params: CommunityPkgParams
- flags: STUB (per router comment); removed by --no-skills
- description: Install a community skill from the GitHub community repo.

## kb_index
- line: mod.rs:6307
- tiers: Baseline,Nostub,Merged
- params: KbIndexParams
- flags: removed by --no-skills
- description: Index markdown files into the IRIS knowledge base for semantic search.

## kb_recall
- line: mod.rs:6329
- tiers: Baseline,Nostub,Merged
- params: KbRecallParams
- flags: removed by --no-skills
- description: Search the knowledge base for relevant guidance. Searches subscribed KB packages and any indexed content.

## agent_history
- line: mod.rs:6391
- tiers: Baseline,Nostub,Merged
- params: AgentHistoryParams
- flags: removed by --no-skills
- description: Return recent tool call history for this session.

## telemetry_query
- line: mod.rs:6422
- tiers: Baseline,Nostub,Merged
- params: TelemetryQueryParams
- description: Query the durable telemetry record (beyond the current process's in-memory agent_history) by tool name, session id, and/or time range. Reads from the IRIS-global durable sink when connected, or the local JSONL file sink when not.

## telemetry_export_trace
- line: mod.rs:6465
- tiers: Baseline,Nostub,Merged
- params: TelemetryExportTraceParams
- description: Export recorded tool-call data as {from, to, via, count, ts} dispatch-trace records, aggregating repeated identical edges into a single record with an incremented count. The record shape is a graph-ingestion format; no tool in this server consumes it yet.

## agent_stats
- line: mod.rs:6495
- tiers: Baseline,Nostub,Merged
- params: NoParams
- flags: removed by --no-skills
- description: Return learning agent status: skill count, pattern count, KB size.

## iris_search
- line: mod.rs:6514
- tiers: Baseline,Nostub,Merged
- params: search::SearchParams
- description: Full-text search across IRIS documents via Atelier REST v2. Auto-upgrades to async polling for large namespaces. Supports regex, case sensitivity, category filter (CLS/MAC/INT/INC/ALL), and wildcard document scopes. Skill: objectscript-navigation. `server` (optional): name of a registered IRIS instance. If omitted, uses the default connection. Use `iris_servers` to list available instances.

## iris_info
- line: mod.rs:6531
- tiers: Baseline,Nostub,Merged
- params: info::InfoParams
- description: Discover IRIS namespace contents. what=documents lists all docs, what=modified lists recently changed, what=namespace returns config, what=metadata returns IRIS version, what=jobs lists active jobs, what=csp_apps lists CSP apps, what=csp_debug returns debug ID, what=sa_schema returns the Studio Assist grammar for an XData namespace URL (name=http://www.intersystems.com/deepsee); it does not list or describe cubes, which %DeepSee.Utils %GetCubeList and %GetDimensionList do through iris_execute. `server` (optional): name of a registered IRIS instance. If omitted, uses the default connection. Use `iris_servers` to list available instances.

## iris_table_info
- line: mod.rs:6553
- tiers: Baseline,Nostub,Merged
- params: info::TableInfoParams
- description: Inspect a SQL table: returns whether it is a class-projected table or DDL-created, the backing data/index globals, and (optionally) an approximate row count. Works for both class-projected tables (with real storage globals from %Dictionary.CompiledStorage) and DDL tables (globals inferred by IRIS naming convention). Use include_row_count=true to add a COUNT(*) estimate. `server` (optional): name of a registered IRIS instance. If omitted, uses the default connection. Use `iris_servers` to list available instances.

## resolve_dynamic_dispatch
- line: mod.rs:6568
- tiers: Baseline,Nostub,Merged
- params: dict::ResolveDynamicDispatchParams
- description: Resolve ObjectScript dynamic dispatch: find all compiled classes that implement a given method. Use when you see $classmethod(var, method) or ##class({variable}).Method() and need to know the possible targets. Returns candidates with confidence scores (fewer matches = higher confidence). Confidence: 1 match=0.90, 2-5=0.75, 6-20=0.55, >20=0.30. Results cached 60s per session. Skill: objectscript-navigation. `server` (optional): name of a registered IRIS instance. If omitted, uses the default connection. Use `iris_servers` to list available instances.

## extract_message_map_routing
- line: mod.rs:6589
- tiers: Baseline,Nostub,Merged
- params: dict::ExtractMessageMapParams
- description: Extract routing from a compiled Ensemble class. For MessageMap routers: returns message_type → method dispatch table (confidence 0.9). For BPL classes (Ens.BusinessProcessBPL): returns kind=bpl with routes derived from Call steps (confidence 0.8); includes note when dynamic dispatch ($classmethod) is detected. For DTL classes (Ens.DataTransformDTL): returns kind=dtl with source_class, target_class, and empty routes. Returns NOT_FOUND for plain classes with no routing. Results cached 60s per session. Skill: ensemble-production. `server` (optional): name of a registered IRIS instance. If omitted, uses the default connection. Use `iris_servers` to list available instances.

## find_subclass_implementations
- line: mod.rs:6610
- tiers: Baseline,Nostub,Merged
- params: dict::FindSubclassImplementationsParams
- description: Find all concrete subclass implementations of a method in the full inheritance hierarchy. Given base class names and a method name, expands to all descendants at any depth and returns classes where the method is defined (Origin = parent, not inherited). Use to resolve polymorphic dispatch: adapter.Execute() → find all EnsLib.*.Adapter subclasses that implement Execute. Results cached 60s per session. Skill: objectscript-navigation. `server` (optional): name of a registered IRIS instance. If omitted, uses the default connection. Use `iris_servers` to list available instances.

## iris_macro
- line: mod.rs:6631
- tiers: Baseline,Nostub,Merged
- params: info::MacroParams
- description: Inspect IRIS macros. action=list returns the include files, or with `includes` the macros they define; action=signature returns parameters, action=location finds definition file/line, action=definition returns text, action=expand expands with arguments. `includes` (optional) names the include files to look in, e.g. ["EnsConstants"]; if omitted, the include that defines the macro is found for you. `server` (optional): name of a registered IRIS instance. If omitted, uses the default connection. Use `iris_servers` to list available instances.

## iris_debug
- line: mod.rs:6646
- tiers: Merged
- params: info::DebugParams
- description: IRIS debug tools. action=map_int maps a runtime error offset to source line, action=error_logs fetches recent error log entries, action=capture captures current error state, action=source_map builds .INT to .CLS mapping. Skill: objectscript-debugging. `server` (optional): name of a registered IRIS instance. If omitted, uses the default connection. Use `iris_servers` to list available instances.

## iris_generate
- line: mod.rs:6660
- tiers: Baseline,Nostub,Merged
- params: info::GenerateParams
- description: Prepare context for generating an ObjectScript class or %UnitTest. Returns a ready-to-use prompt plus IRIS namespace context (existing class names, method signatures). No API key needed — the calling AI agent does the generation using the returned prompt, then saves with iris_doc(mode=put) and compiles with iris_compile. gen_type=class for new classes, gen_type=test for %UnitTest scaffolding. `server` (optional): name of a registered IRIS instance. If omitted, uses the default connection. Use `iris_servers` to list available instances.

## skill
- line: mod.rs:6674
- tiers: Baseline,Nostub,Merged
- params: skills_tools::SkillParams
- flags: removed by --no-skills
- description: Manage the learning agent skill registry. action=list returns all skills, action=describe returns one skill, action=search finds skills by keyword, action=forget removes a skill, action=propose mines recent tool calls and synthesizes a new skill (requires ≥5 calls). forget is a destructive action (requires IRIS_DESTRUCTIVE_TOOLS_ENABLED=1).

## skill_community
- line: mod.rs:6688
- tiers: Baseline,Nostub,Merged
- params: skills_tools::SkillCommunityParams
- flags: removed by --no-skills
- description: Community skill registry. action=list browses published skills from subscribed GitHub repos, action=install writes a community skill to the local ^SKILLS global.

## kb
- line: mod.rs:6704
- tiers: Baseline,Nostub,Merged
- params: skills_tools::KbParams
- description: Knowledge base tools. action=index reads markdown/text files and stores them in ^KBCHUNKS, action=recall searches the KB for relevant content by keyword.

## agent_info
- line: mod.rs:6718
- tiers: Baseline,Nostub
- params: skills_tools::AgentInfoParams
- description: Session and learning agent information. what=stats returns skill count and session call count, what=history returns recent tool call history.

## iris_source_control
- line: mod.rs:6734
- tiers: Baseline,Nostub,Merged
- params: ScmParams
- description: IRIS source control operations. action=status checks lock state and owner, action=menu lists available SCM actions, action=checkout checks out the document, action=execute runs a specific SCM action by ID. Handles elicitation for interactive SCM dialogs. Pass elicitation_id+answer to resume a pending SCM interaction. `server` (optional): name of a registered IRIS instance. If omitted, uses the default connection. Use `iris_servers` to list available instances.

## iris_global
- line: mod.rs:6838
- tiers: Merged
- params: global::IrisGlobalParams
- description: Read, write, kill, or list IRIS global nodes. action: get=read a node or subtree, set=write a node, kill=delete a node/subtree, list=enumerate subscripts. kill is a destructive action (requires IRIS_DESTRUCTIVE_TOOLS_ENABLED=1). PHI and system-blocklist gates enforced before any IRIS call. Pass acknowledgePhi=true to bypass per-global PHI gate. Skill: iris-agentic-dev. `server` (optional): name of a registered IRIS instance. If omitted, uses the default connection. Use `iris_servers` to list available instances.

## iris_coverage
- line: mod.rs:6910
- tiers: Baseline,Nostub,Merged
- params: coverage::IrisCoverageParams
- description: Measure ObjectScript line coverage using %Monitor.System.LineByLine. mode=run: start monitoring + run compiled test suite + stop + return per-class and total coverage in one call (use this for most tasks). mode=check: verify the monitor is available by doing a dry Start() — if BBSIZ_NOT_CONFIGURED is returned, increase gmheap to 256+ in Management Portal > System Administration > Configuration > Additional Settings > Advanced Memory, then restart IRIS. mode=start/stop/report: manual multi-step control. Provide either classes=['MyApp.MyClass',...] or package='MyApp' (auto-discovers concrete classes). test_path must be a compiled class pattern (e.g. 'MyApp.Tests') — /noload always used. Returns {total_pct, hits, total, classes:[{class,routine,hit,total,pct}], meets_target, target_pct}. Error codes: BBSIZ_NOT_CONFIGURED (gmheap too small), MONITOR_IN_USE, MISSING_PARAM. Skill: objectscript-coverage (merged toolset only). `server` (optional): name of a registered IRIS instance. If omitted, uses the default connection. Use `iris_servers` to list available instances.

## iris_doc_search
- line: mod.rs:6924
- tiers: Baseline,Nostub,Merged
- params: doc_search::IrisDocSearchParams
- description: Search the InterSystems documentation site (docs.intersystems.com) via its Algolia index. Returns ranked hits with title, URL, content excerpt, and breadcrumbs. Use for discovery questions ('what are all the ways to run SQL in IRIS?'), API lookups ('what does SQLCODE -30 mean?'), and any question where the answer lives in official docs. Optionally filter by version (e.g. '2025.1') and product (e.g. 'InterSystems IRIS'). Returns {query, total_hits, hits:[{title, url, excerpt, breadcrumbs, version, product}]}. Note: docs.intersystems.com is a JS SPA — do NOT use WebFetch or curl on DocBook URLs; they return only nav shell. This tool uses the real Algolia search index and returns actual documentation content. Skill: iris-docs for live IRIS class reference; iris-agentic-dev for connection setup.

## iris_execute_method
- line: mod.rs:6944
- tiers: Merged
- params: IrisExecuteMethodParams
- description: Invoke a ClassMethod directly by class+method+args without writing ObjectScript boilerplate. Returns the string return value. Execute-gated: blocked on mcpTemplate=live and mcpTemplate=test. v1 limitation: only string-returning methods. Skill: objectscript-navigation (merged toolset only). `server` (optional): name of a registered IRIS instance. If omitted, uses the default connection. Use `iris_servers` to list available instances.

## iris_production
- line: mod.rs:6997
- tiers: Baseline,Nostub,Merged
- params: IrisProductionParams
- description: Interoperability production lifecycle (merged). action: status=get current state, start=start named production, stop=stop production, update=hot-apply config, check=check if update needed, recover=recover troubled production. `namespace` (optional): IRIS namespace for production operations. Defaults to the connection namespace. Use when the interop production lives in a different namespace than the default connection. Skill: ensemble-production. `server` (optional): name of a registered IRIS instance. If omitted, uses the default connection. Use `iris_servers` to list available instances.

## iris_interop_query
- line: mod.rs:7107
- tiers: Baseline,Nostub,Merged
- params: params::batch5::IrisInteropQueryParams
- description: Interoperability query dispatcher (merged). what (REQUIRED): logs=Event Log entries, queues=message queue depths, messages=message archive (Ens.MessageHeader). Anything else returns INVALID_ACTION. To trace one session, use what=messages with session_id=<n>. Filters: component=<config item> narrows logs and messages; session_id=<n> and since_id=<n> (tails after a watermark) narrow messages. what=messages can also search message CONTENT: (a) body_class=<msg class> + body_where=<SQL fragment on body table> + body_select=[cols] joins the body table server-side (SQL name resolved for you); (b) search_table={prop, value|value_like, class?, extent?} searches an indexed Search Table field (extent default EnsLib.HL7.SearchTable; errors list searchable props). Pass namespace=<ns> for a non-default interop namespace. Skill: ensemble-production. `server` (optional): name of a registered IRIS instance.

## iris_containers
- line: mod.rs:7208
- tiers: Merged
- params: params::batch2::IrisContainersParams
- description: Container lifecycle dispatcher (merged). action: list=list running IRIS containers, select=validate container connection, start=start sandbox container via iris-devtester.

## iris_production_item
- line: mod.rs:7256
- tiers: Baseline,Nostub,Merged
- params: params::batch5::IrisProductionItemParams
- description: Enable, disable, or inspect/modify settings of an individual Interoperability production config item. action: enable|disable|get_settings|set_settings. item: exact config item name. namespace: optional. settings: key-value map (for set_settings). Works via HTTP, no Docker required. Skill: ensemble-production. `server` (optional): name of a registered IRIS instance. If omitted, uses the default connection. Use `iris_servers` to list available instances.

## iris_message_body
- line: mod.rs:7313
- tiers: Merged
- params: params::batch5::IrisMessageBodyParams
- description: Read an Ensemble/Interoperability message body by message ID. Handles plain-text and stream-backed bodies (Ens.StreamContainer, %Stream.Object). PHI-gated: dataPolicy=block returns PHI_POLICY_BLOCKED; dataPolicy=allow requires acknowledgePhi=true; dataPolicy=redact scrubs HL7 v2 PID/MSH fields. max_bytes default 65536, clamped to 1048576. Skill: ensemble-production (merged toolset only). `server` (optional): name of a registered IRIS instance. If omitted, uses the default connection. Use `iris_servers` to list available instances.

## iris_business_rule_info
- line: mod.rs:7383
- tiers: Merged
- params: params::batch5::IrisBusinessRuleInfoParams
- description: List or inspect Ensemble business rules (Ens.Rule.RuleSet). action=list returns all rule sets with name/description/modified. action=get with rule_name returns conditions/actions counts for that rule set. Returns INTEROP_NOT_AVAILABLE if Ensemble is not installed. Skill: ensemble-production (merged toolset only). `server` (optional): name of a registered IRIS instance. If omitted, uses the default connection. Use `iris_servers` to list available instances.

## iris_production_diff
- line: mod.rs:7436
- tiers: Merged
- params: params::batch5::IrisProductionDiffParams
- description: Diff the running Interoperability production config against the last source-controlled version. Returns in_sync:true with changes:[] when no drift, or a changes array of {item_name, item_type, status} where status is added/removed/modified. Returns NO_SCM if no source control is configured. Skill: ensemble-production (merged toolset only). `server` (optional): name of a registered IRIS instance. If omitted, uses the default connection. Use `iris_servers` to list available instances.

## iris_credential_list
- line: mod.rs:7485
- tiers: Baseline,Nostub,Merged
- params: params::batch6::IrisCredentialListParams
- description: List all Ensemble credentials (IDs and usernames only — passwords never returned). namespace: optional.

## iris_credential_manage
- line: mod.rs:7511
- tiers: Baseline,Nostub,Merged
- params: params::batch6::IrisCredentialManageParams
- description: Create, update, or delete an Ensemble credential. action: create|update|delete. id: credential ID (required). username/password: required for create, optional for update. namespace: optional. Destructive tier: create/update/delete require IRIS_DESTRUCTIVE_TOOLS_ENABLED=1, and are suppressed on Live instances unless IRIS_ALLOW_PROD=1.

## iris_lookup_manage
- line: mod.rs:7558
- tiers: Baseline,Nostub,Merged
- params: params::batch6::IrisLookupManageParams
- description: Read, write, delete, or list Ensemble lookup table entries. action: get|set|delete|list_keys|list_tables. table: table name (required except list_tables). key: required for get/set/delete. value: required for set. namespace: optional. get/list_keys/list_tables always available; set/delete are destructive actions (require IRIS_DESTRUCTIVE_TOOLS_ENABLED=1). Skill: ensemble-production.

## iris_lookup_transfer
- line: mod.rs:7599
- tiers: Baseline,Nostub,Merged
- params: params::batch6::IrisLookupTransferParams
- description: Export or import an Ensemble lookup table as XML. action: export|import. table: table name. xml: XML string (required for import). namespace: optional. export always available; import write-gated. Skill: ensemble-production.

## iris_admin
- line: mod.rs:7638
- tiers: Merged
- params: params::batch3::IrisAdminParams
- description: IRIS administration dispatcher. \         Read actions (always available): list_namespaces, list_databases, list_users, list_roles, \         list_user_roles, check_permission, list_webapps, get_webapp, \         view_locks, view_processes, journal_search, namespace_mappings, database_status. \         Write actions (require IRIS_WRITE_TOOLS_ENABLED=1): \         clear_password_change_flag, unlock_user, fresh_container_setup, mirror_add_async. \         mirror_add_async joins this IRIS instance to an existing mirror set as an async DR member. \         Params: mirror_name (required), primary_host (required), primary_port (default 2188), \         instance_name (default IRIS), async_member_type (0=DR, 1=ReadOnly, 2=ReadWrite; default 0). \         Destructive actions (require IRIS_DESTRUCTIVE_TOOLS_ENABLED=1): create_user, update_user, \         delete_user, create_namespace, delete_namespace, create_webapp, delete_webapp, \         mirror_failover. \         create_user, update_user, delete_user, create_namespace, delete_namespace, create_webapp, \         delete_webapp, clear_password_change_flag, unlock_user and fresh_container_setup also \         require IRIS_ADMIN_TOOLS=1, a second switch the handler checks after the tier gate. \         mirror_failover promotes this backup member to primary (irreversible without manual recovery). \         Params: confirm (required, must be true). \         fresh_container_setup runs the full first-boot sequence on a fresh IRIS container: \         clears the forced-password-change flag and unlocks the default account. \         clear_password_change_flag params: username (default _SYSTEM), password (default SYS), \         new_password (optional). unlock_user params: username (required). \         fresh_container_setup params: username (default _SYSTEM), password (default SYS), \         new_password (optional). \         All operations run in %SYS namespace. check_permission checks the currently connected \         user (IRIS_USERNAME). view_processes requires dataPolicy param (block/redact/allow). \         journal_search requires dataPolicy=allow and at least one of global_pattern or time_range. \         `server` (optional): name of a registered IRIS instance. If omitted, uses the default connection. Use `iris_servers` to list available instances.

## iris_get_log
- line: mod.rs:7957
- tiers: Merged
- params: GetLogParams
- description: Retrieve a stored result by log_id from the progressive disclosure store. With id: returns the full result (optionally paginated with limit/offset). Without id: lists all stored log entries with their IDs, tools, timestamps, and total counts. Use after any tool returns truncated:true.

## iris_servers
- line: mod.rs:8045
- tiers: Baseline,Nostub,Merged
- params: server_tools::IrisServersParams
- description: List all IRIS server instances registered in the connection pool. Returns an array of {name, host, port, base_url, namespace, username, source, reachable} objects, plus `web_prefix` for any instance served under a URL path prefix rather than at the web server's root. `base_url` is the URL iad actually calls, prefix included: two instances behind one gateway share a host and port, so it is the field that tells them apart. `source` values: iad-native (added via iris_add_server), vscode (from VS Code/Cursor Server Manager), fleet (from workspace TOML), env (from IRIS_HOST env var). Default: `reachable` is null (fast path). Pass `probe: true` to probe all servers in parallel (5 s timeout each) and include reachable, auth, latency_ms, error fields.

## iris_add_server
- line: mod.rs:8184
- tiers: Baseline,Nostub,Merged
- params: server_tools::AddServerParams
- description: Add a new IRIS server to the iad-native configuration. Pass `web_prefix` (e.g. "/hs20261") for an instance behind a shared web gateway — without it the entry resolves to the gateway root and every call goes to the wrong place; registering the same name again updates the entry. The credential is stored in the OS keychain when available. On headless hosts (MCP in Claude Desktop, Remote SSH, CI) where no keychain exists, the credential is stored in plaintext in servers.json as a fallback — the response includes stored_plaintext: true and a warning in that case. Call `iris_reload_pool` afterwards to make it available via the `server` param in the running server; no restart needed. Returns {added: true, name, note}.

## iris_remove_server
- line: mod.rs:8280
- tiers: Baseline,Nostub,Merged
- params: server_tools::RemoveServerParams
- description: Remove a server from the iad-native configuration. Destructive tier: requires IRIS_DESTRUCTIVE_TOOLS_ENABLED=1. Only servers with source=iad-native can be removed (vscode, fleet, and env sources are read-only). Also removes the OS keychain entry. Call `iris_reload_pool` afterwards to drop it from the running pool. Returns {removed: true, name, note}. Error codes: REMOVE_NOT_ALLOWED (source is not iad-native), SERVER_NOT_FOUND (not in pool).

## iris_reload_pool
- line: mod.rs:8344
- tiers: Baseline,Nostub,Merged
- params: NoParams
- description: Hot-reload the IRIS connection pool from disk without restarting iad. Re-reads the workspace TOML config and the iad-native servers list, then atomically replaces the in-memory pool. Servers added or removed in the config file are available immediately. Returns {success, servers_loaded, servers, note} on success, or {success: false, error_code, error, note} if the config file cannot be parsed (the existing pool is preserved on parse errors). Error codes: TOML_PARSE_ERROR.

## iris_test_server
- line: mod.rs:8400
- tiers: Baseline,Nostub,Merged
- params: server_tools::TestServerParams
- description: Probe an IRIS server for reachability. Performs GET /api/atelier/ with timing. Does not modify the active connection. Returns {name, reachable, atelier_version, iris_version, latency_ms} on success, or {name, reachable: false, error} on failure. Ad-hoc probe: pass `host` (+ optional `web_port`, `username`, `password`) instead of `name` to probe a server not in the pool. Error codes: SERVER_NOT_FOUND (name not in pool), MISSING_PARAMS (neither name nor host provided).

## iris_import_servers
- line: mod.rs:8571
- tiers: Baseline,Nostub,Merged
- params: NoParams
- description: Import IRIS server definitions from VS Code / Cursor Server Manager into the iad-native config. Reads intersystems.servers from VS Code and Cursor settings.json. Servers already present in the iad-native config are skipped (no overwrite). Passwords are resolved from the OS keychain; servers where no keychain entry exists are imported without a password (listed in no_keychain). Returns {imported, skipped, no_keychain: [...]}. Call `iris_reload_pool` after importing to make them routable.

## iris_ws_open
- line: mod.rs:8669
- tiers: Baseline,Nostub,Merged
- params: ws_tools::WsOpenParams
- description: Open a persistent WebSocket terminal session on an IRIS instance. Returns a session token. Use server to target a specific registered instance; defaults to the active connection. Requires IRIS 2023.2+ (Atelier API v7).

## iris_ws_exec
- line: mod.rs:8707
- tiers: Baseline,Nostub,Merged
- params: ws_tools::WsExecParams
- description: Execute ObjectScript code in a persistent WebSocket terminal session. Variables and state persist across calls within the same session. Returns the terminal output.

## iris_ws_close
- line: mod.rs:8747
- tiers: Baseline,Nostub,Merged
- params: ws_tools::WsCloseParams
- description: Close a WebSocket terminal session and release server resources.

## compare_document
- line: mod.rs:8766
- tiers: Baseline,Nostub,Merged
- params: params::batch1::CompareDocumentParams
- description: Compare the source of a document (class, routine, etc.) across two registered IRIS servers. Returns {same: bool, diff: string, server_a, server_b, document, namespace}. Use iris_servers to see registered instances. Skill: iris-agentic-dev.

## compare_namespace
- line: mod.rs:8814
- tiers: Baseline,Nostub,Merged
- params: params::batch1::CompareNamespaceParams
- description: Compare all classes in a namespace across two registered IRIS servers. Returns {only_in_a, only_in_b, different, same_count}. Use iris_servers to see registered instances. Skill: iris-agentic-dev.

## global_preview
- line: mod.rs:8858
- tiers: Baseline,Nostub,Merged
- params: params::batch1::GlobalPreviewParams
- description: Preview the contents of an IRIS global before deleting it. Returns the first N subscripts plus a confirm_token (valid 5 minutes) required by global_kill. global: name of the global (with or without ^). count: max entries to preview (default 20, max 100). server: optional registered instance name. Skill: iris-agentic-dev.

## global_kill
- line: mod.rs:8896
- tiers: Baseline,Nostub,Merged
- params: params::batch1::GlobalKillParams
- description: Kill (delete) an entire IRIS global. Destructive tier: requires IRIS_DESTRUCTIVE_TOOLS_ENABLED=1. Requires a confirm_token from global_preview (valid 5 minutes). global: global name. confirm_token: token from global_preview. server: optional registered instance name. Error codes: CONFIRM_REQUIRED (call global_preview first), CONFIRM_EXPIRED (token expired), CONFIRM_MISMATCH (token for different global/server). Skill: iris-agentic-dev.

## iris_namespace_list
- line: mod.rs:8940
- tiers: Baseline,Nostub,Merged
- params: params::batch2::IrisNamespaceListParams
- description: List all namespaces on an IRIS instance. server: optional registered instance name. Returns {namespaces: [...], count: N}. Skill: iris-agentic-dev.

## iris_database_list
- line: mod.rs:8960
- tiers: Baseline,Nostub,Merged
- params: params::batch2::IrisDatabaseListParams
- description: List all databases (directories) on an IRIS instance. server: optional registered instance name. Returns {databases: [{directory, mounted, size_mb, free_space_mb, free_pct, max_size_mb}], count: N}. Skill: iris-agentic-dev.

## iris_system_performance
- line: mod.rs:8980
- tiers: Baseline,Nostub,Merged
- params: params::batch4::IrisSystemPerformanceParams
- description: Manage and read IRIS SystemPerformance (pbuttons) profiles and runs. mode: start | status | last_runid | list_profiles | add_profile | delete_profile | list_runs | report. profile: for mode=start, one of test (5 min, the default), 30mins, 4hours, 8hours, 12hours, 24hours, or any instance-defined profile; for add_profile/delete_profile, the profile to create or remove. run_id: required for mode=status; optional for mode=report (omit for the newest completed run). description, interval_seconds, sample_count: required for mode=add_profile. Returns {success, mode, profile, run_id} for start; {success, mode, run_id, in_progress} for last_runid (in_progress=true means the run is still collecting and has no report yet); {success, mode, run_id, wait_time} for status; {success, mode, profiles, count} for list_profiles, each with name, interval_seconds, sample_count, duration_minutes, description; {success, mode, runs, count} for list_runs, newest first, each with run_id, completed_at, output_dir, profile; {success, mode, run_id, completed_at, output_dir, report_path, size_bytes, exists} for report. Works on community and Enterprise builds. server: optional registered instance name. Skill: iris-agentic-dev.

## iris_mirror_status
- line: mod.rs:9030
- tiers: Baseline,Nostub,Merged
- params: params::batch4::IrisMirrorStatusParams
- description: Report mirror membership and role for the connected IRIS instance. Returns {is_member, mirror_name, member_type, is_primary}. Non-mirror instances return {is_member: false}. Useful as a pre-flight check before operations that require a primary. server: optional registered instance name. Skill: iris-agentic-dev.

## iris_namespace_create
- line: mod.rs:9050
- tiers: Baseline,Nostub,Merged
- params: params::batch2::IrisNamespaceCreateParams
- description: Create a new namespace on an IRIS instance. Destructive tier: requires IRIS_DESTRUCTIVE_TOOLS_ENABLED=1. name: namespace name. db_path: optional database directory (defaults to name). server: optional registered instance name. Skill: iris-agentic-dev.

## iris_database_stats
- line: mod.rs:9081
- tiers: Baseline,Nostub,Merged
- params: params::batch2::IrisDatabaseStatsParams
- description: Get disk usage statistics for IRIS databases. db: optional directory path to limit to one database; if omitted returns all. server: optional registered instance name. Returns {stats: [{directory, free_space_mb, free_blocks}]}. Skill: iris-agentic-dev.

## journal_search
- line: mod.rs:9105
- tiers: Baseline,Nostub,Merged
- params: params::batch4::JournalSearchParams
- description: Search the IRIS journal for SetKill records. start/end: optional ISO timestamp filters. global_pattern: optional substring filter on GlobalReference. max_entries: default 100, max 500. server: optional registered instance name. Returns {entries: [{timestamp, type, job_id, global}]}. Skill: iris-agentic-dev.

## query_audit_log
- line: mod.rs:9143
- tiers: Baseline,Nostub,Merged
- params: params::batch4::QueryAuditLogParams
- description: Query the IRIS audit log (%SYS.Audit). user: filter by username. event_type: filter by event type. start/end: ISO timestamp filters. limit: max rows (default 100, max 500). server: optional registered instance name. Returns {entries: [{event, event_type, username, timestamp}]}. Skill: iris-agentic-dev.

## stream_inspect
- line: mod.rs:9186
- tiers: Baseline,Nostub,Merged
- params: params::batch7::StreamInspectParams
- description: Inspect the content of an IRIS stream object by OID. oid: the stream OID (integer string). namespace: optional namespace (defaults to the connection namespace, IRIS_NAMESPACE). server: optional registered instance name. Returns {content, type: 'text'|'binary', size, oid}. Skill: iris-agentic-dev.

## my_access
- line: mod.rs:9217
- tiers: Baseline,Nostub,Merged
- params: params::batch4::MyAccessParams
- description: Show the current user's username, full name, and assigned roles on an IRIS instance. server: optional registered instance name. Returns {username, full_name, roles: [...]}. Skill: iris-agentic-dev.

## capability_matrix
- line: mod.rs:9237
- tiers: Baseline,Nostub,Merged
- params: params::batch4::CapabilityMatrixParams
- description: Show the roles assigned to a user on an IRIS instance. user: optional username (default: current user). server: optional registered instance name. Returns {user, full_name, roles: [...]}. Skill: iris-agentic-dev.

## hl7_schema_list
- line: mod.rs:9264
- tiers: Baseline,Nostub,Merged
- params: params::batch7::Hl7SchemaListParams
- description: List available HL7 schemas on an IRIS/HealthShare instance. Returns HL7_NOT_AVAILABLE if EnsLib.HL7.Schema is absent. namespace: optional (defaults to the connection namespace, IRIS_NAMESPACE). server: optional registered instance name. Returns {schemas: [...], count: N}. Skill: iris-agentic-dev.

## hl7_schema_inspect
- line: mod.rs:9289
- tiers: Baseline,Nostub,Merged
- params: params::batch7::Hl7SchemaInspectParams
- description: Inspect an HL7 schema's message structures or a specific segment's fields. Returns HL7_NOT_AVAILABLE if EnsLib.HL7.Schema is absent. schema: schema name (e.g. '2.5'). segment: optional segment name to inspect fields. namespace: optional. server: optional registered instance name. Skill: iris-agentic-dev.

## mermaid_class
- line: mod.rs:9332
- tiers: Baseline,Nostub,Merged
- params: params::batch7::MermaidClassParams
- description: Generate a Mermaid classDiagram for an ObjectScript class, walking the superclass chain up to `depth` levels (default 3, max 5). Returns a string starting with 'classDiagram'. class: fully qualified class name. depth: optional traversal depth. namespace: optional. server: optional registered instance name. Skill: objectscript-navigation.

## mermaid_production
- line: mod.rs:9364
- tiers: Baseline,Nostub,Merged
- params: params::batch7::MermaidProductionParams
- description: Generate a Mermaid flowchart for an Ensemble/Interoperability production, showing all configured items. production: full production class name. namespace: optional. server: optional registered instance name. Returns a Mermaid flowchart TD string. Skill: ensemble-production.

## resolve_storage
- line: mod.rs:9396
- tiers: Baseline,Nostub,Merged
- params: params::batch7::ResolveStorageParams
- description: Resolve storage definitions for an ObjectScript class — returns global maps (data, id, index locations) from %Dictionary.CompiledStorage. class: fully qualified class name. namespace: optional. server: optional registered instance name. Returns {class, storages: [{name, type, data_location, id_location, index_location}]}. Skill: objectscript-navigation.

