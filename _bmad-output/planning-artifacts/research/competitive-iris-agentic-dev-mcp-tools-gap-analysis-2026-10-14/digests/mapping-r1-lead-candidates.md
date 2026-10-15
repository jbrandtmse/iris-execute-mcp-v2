# Lead mapping r1: candidate gaps (pre-verification)

Lead's first-pass mapping of every competitor capability row (digests teardown-r1-1..5) against our inventory (ours-r1-1). Each candidate below is an ABSENCE claim about our suite. It goes to a fresh-context skeptic verifier (round 2) before it can ship as a gap. Rows judged MATCH or OURS-STRONGER at mapping time are recorded in the matrix in research.md. They are not repeated here.

Verifier split: V1 = G1-G17 (documents and code intelligence); V2 = G18-G39 (execution/SQL/debug, interop); V3 = G40-G54 (admin/ops, platform, framework, agent-platform band).

| ID | Claimed capability our suite lacks (or only partly covers) | Competitor source (digest) |
|---|---|---|
| G1 | Line-range read of a document (lines start..end) | r1-1 iris_doc fragment |
| G2 | Surgical line edits on a server document: insert-before-line or delete a line range, with an optimistic expected-text check and a returned unified diff | r1-1 iris_doc insert / delete_lines |
| G3 | Batch get of several documents in one call | r1-1 iris_doc get `names` |
| G4 | Server-side source-control integration through %Studio.SourceControl.Interface: status, menu, checkout, execute a menu action, plus a pre-write checkout probe with a dialog round trip | r1-1 iris_source_control; iris_doc put |
| G5 | Storage-block protection: refuse a write that drops an existing Storage definition unless explicitly confirmed | r1-1 iris_doc put storage guard |
| G6 | Compile by wildcard/package pattern (e.g. `MyApp.*.cls`) | r1-1 iris_compile wildcard |
| G7 | Search of InterSystems product documentation (docs.intersystems.com) | r1-1 iris_doc_search |
| G8 | Local-workspace ObjectScript symbol index (parse local .cls/.mac/.inc without IRIS) | r1-1 iris_symbols_local |
| G9 | Macro tooling: list include files; list the macros an include defines; macro signature | r1-1 iris_macro list/signature |
| G10 | Cross-server single-document comparison that returns a unified text diff | r1-1 compare_document |
| G11 | Storage resolution: a class's storage definitions with Data/Id/Index global locations | r1-1 resolve_storage |
| G12 | Class inheritance diagram (Mermaid classDiagram) | r1-1 mermaid_class |
| G13 | BPL/DTL flow extraction from XData (steps, source/target, subtransforms) | r1-1 docs_introspect xdata_flow |
| G14 | "Which classes define method X" search over the compiled dictionary | r1-1 resolve_dynamic_dispatch |
| G15 | MessageMap routing extraction (message type → method); BPL call targets | r1-1 extract_message_map_routing |
| G16 | Descendant-tree search for overrides of a method below base class(es) | r1-1 find_subclass_implementations |
| G17 | Server-side LLM code generation (class / unit-test text) | r1-1 iris_generate_class/_test |
| G18 | Stateful execution: variables persist across separate execute calls | r1-2 iris_execute use_session; iris_ws_* |
| G19 | Persistent terminal session over the Atelier WebSocket /terminal endpoint | r1-2 iris_ws_open/exec/close |
| G20 | Execution without a web server: docker exec / SSH `iris session` fallback | r1-2 iris_execute fallback; r1-5 docker_only/nopws/ssh_host |
| G21 | SQL write guard: a read mode that blocks DML/DDL keywords, and a DML mode that pre-counts affected rows against a cap and returns rows affected | r1-2 iris_query read/write |
| G22 | Row count without transferring rows | r1-2 iris_query count |
| G23 | Line-by-line code coverage (%Monitor.System.LineByLine): start/stop/report/run with tests | r1-2 iris_coverage; iris_test coverage |
| G24 | Running %UnitTest.TestProduction-based tests | r1-2 iris_test testproduction |
| G25 | Map an INT offset or error string (label+offset^routine) back to a class source line | r1-2 debug_map_int_to_cls / iris_debug map_int |
| G26 | Application error log access (^ERRORS / SYS.ApplicationError). Neither-side check: the competitor's version is a stub | r1-2 debug_get_error_logs / iris_debug error_logs |
| G27 | Read a stream's content by OID/ID | r1-2 stream_inspect |
| G28 | Global subtree walk, and one-level $Order children listing of a node | r1-2 iris_global get(subtree)/list |
| G29 | Two-step preview→kill confirmation token for killing a global | r1-2 global_preview/global_kill |
| G30 | Table info: SQL table → projecting class, storage globals, row count | r1-2 iris_table_info |
| G31 | Production "needs update" check | r1-3 iris_production check |
| G32 | Message header search by source/target, body class, or since-id tail | r1-3 iris_interop_query messages |
| G33 | Message body content search: JOIN header with body table, WHERE over body fields | r1-3 iris_interop_query body_class/body_where |
| G34 | Search Table lookup (Ens_Config.SearchTableProp, e.g. HL7 MRN) | r1-3 iris_interop_query search_table |
| G35 | Read a message body's content with a PHI policy (block/redact/allow) and HL7 field redaction | r1-3 iris_message_body |
| G36 | Production drift within one namespace: live item list vs the production class definition | r1-3 iris_production_diff |
| G37 | Lookup tables: list all tables; list a table's keys | r1-3 iris_lookup_manage list_tables/list_keys |
| G38 | HL7 schema browsing: schemas, message structures, segment fields | r1-3 hl7_schema_list/inspect |
| G39 | Production topology diagram (Mermaid flowchart of items) | r1-3 mermaid_production |
| G40 | Journal record search by global reference and/or time range, returning record details/values | r1-4 iris_admin journal_search; journal_search |
| G41 | Mirror write ops: join as async member; failover to primary | r1-4 iris_admin mirror_add_async/mirror_failover |
| G42 | SystemPerformance (pButtons) orchestration: start, status, profiles add/delete/list, runs, report location | r1-4 iris_system_performance |
| G43 | Unlock a user locked out by invalid login attempts | r1-4 iris_admin unlock_user |
| G44 | CSP debug ID; Studio Assist XData schema (saschema) | r1-4 iris_info csp_debug/sa_schema |
| G45 | Runtime connection-registry management from tools: add/remove/import (VS Code Server Manager) servers, reload | r1-5 iris_add_server/remove/import/reload_pool |
| G46 | Connectivity probe of configured or ad-hoc servers (reachable/auth/latency/version) | r1-5 iris_servers probe; iris_test_server |
| G47 | Local container/sandbox orchestration (list IRIS containers, switch connection, start sandbox) | r1-5 iris_list_containers/select/start_sandbox |
| G48 | Working streamable-HTTP MCP transport | r1-5 framework transports |
| G49 | Environment-aware default write safety inferred from IRIS SystemMode / production-like namespace names | r1-5 framework governance |
| G50 | PHI data policy (block/redact/allow) on data-reading tools, per connection | r1-5 framework [policy] dataPolicy |
| G51 | Tool-call audit records emitted into IRIS %SYS.Audit | r1-5 framework irisAudit |
| G52 | Execution routed through a restricted service-account identity | r1-2 service-account routing |
| G53 | Declared MCP output schemas on tools | r1-2/r1-5 output_schema |
| G54 | Agent-platform band: skill list/describe/search/install tools; KB index/recall; tools to query own call telemetry/history | r1-5 skill_*, kb_*, telemetry_*, agent_* |
