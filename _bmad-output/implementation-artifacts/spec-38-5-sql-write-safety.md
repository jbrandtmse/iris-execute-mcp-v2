---
title: 'Story 38.5: SQL Write Safety'
type: 'feature'
created: '2026-10-15'
status: 'ready-for-dev'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/.claude/rules/project-rules.md'
  - '{project-root}/.claude/rules/iris-objectscript-basics.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-iris-execute-mcp-v2-2026-10-14/ARCHITECTURE-SPINE.md'
warnings:
  - oversized
deferred: []
---

<intent-contract>

## Intent

**Problem:** `iris_sql_execute` runs any statement with no way to confine it to queries or to bound the rows a DML statement changes, and a DML result reports `rowCount: 0` however many rows it changed. It is a frozen-baseline write, so the `read-only` governance preset blocks every query, SELECT included.

**Approach:** Add one IRIS-side SQL endpoint that prepares the statement once, classifies it by its `%SQL.Statement` statement type, and executes it in the same call:
- read paths run inside a transaction that is always rolled back;
- rows-affected caps are checked against `%ROWCOUNT` inside a transaction before commit.

`iris_sql_execute` moves onto this endpoint (orchestrator decision 1) and gains:
- `readOnly`, `maxRowsAffected` and `countOnly` parameters;
- the operator variables `IRIS_SQL_READ_ONLY` and `IRIS_SQL_MAX_ROWS_AFFECTED`;
- the additive output fields `rowsAffected` and `totalCount`.

A new read-classified dev tool, `iris_sql_query`, always runs read-only. It declares `parent: "iris_sql_execute"` (the 38.4 mechanism, unchanged) and joins the dev `core` and `developer` presets.

## Boundaries & Constraints

**Always:**
- **One prepared statement, one call.** The endpoint prepares the statement once, reads `%Metadata.statementType` from it, applies every check, and executes that same statement, all in one IRIS request.
  - It creates the statement as Atelier `action/query` does: `%SQL.Statement.%New()`, with the process-default select mode (probe: 0, logical), and `%Prepare(query, 0)`.
  - Statement type names come from IRIS (`$$GetTypen^%SYS.SQLSRV`, the routine behind `%SQL.StatementResult.%StatementTypeName`).
- **Read-only.** A query is statement type 1 (SELECT). Read-only mode refuses every other type before execution, CALL included, and runs a SELECT inside a transaction the endpoint opens and always rolls back.
  - `iris_sql_query` is always read-only.
  - `iris_sql_execute` is read-only when `readOnly: true` or `IRIS_SQL_READ_ONLY=true`. A parameter can never weaken the operator variable.
- **Rows-affected cap.**
  - **Effective cap.** The smaller of `maxRowsAffected` and `IRIS_SQL_MAX_ROWS_AFFECTED`, whichever are set (0 is a valid cap).
  - **Which statements run.** Under a cap, statement types 2, 3 and 4 (INSERT, UPDATE, DELETE, including INSERT OR UPDATE and TRUNCATE TABLE) run in a transaction the endpoint opens. A SELECT runs as it would without a cap. Every other type is refused before execution (orchestrator decision 2).
  - **The check.** After execution the endpoint reads `%ROWCOUNT`. A count above the cap, or a negative count (unknown), rolls the statement back and refuses. Otherwise the endpoint commits.
- **Transaction level.** Whenever the endpoint opened a transaction:
  - It rolls back to the level it found, on every exit path, errors included, before rendering.
  - After execution it requires `$TLEVEL` to equal the level it opened. Any other level is matrix row TE.
- **Paths without a transaction.** With no read-only mode and no cap in force, the statement runs exactly as `action/query` runs it today, with no transaction from the tool.
- **One serializer.** Row serialization reproduces `action/query` output value for value:
  - it maps each column by its `clientType`;
  - it covers every result set of a CALL;
  - it is pinned live against `action/query` on the fixture (probe 6).

  It is written from that observed behavior and the documented `clientType` codes. The `%Api.Atelier.v1` source is InterSystems-confidential and is never copied (AD-12 Reference code).
- **Defaults on the wire.** The tool sends every control explicitly: `readOnly`, `countOnly`, and `maxRowsAffected` (`null` = no cap). `parameters` is still sent only when it is non-empty, and the `timeout` option only when `IRIS_SQL_TIMEOUT` is set, as today (Rule #10).
- **Back-compat (AD-15).** With no new parameter or variable in use, every pre-existing field of every `iris_sql_execute` result is byte-identical to today's mapping of the same rows (`toEqual` pins), and a DML result only gains `rowsAffected`.
- **Refusals.**
  - A refusal is `isError: true`, changes nothing, and uses a new catalog code in `refusals.ts`: `SQL_READ_ONLY` or `SQL_ROWS_AFFECTED_CAP`.
  - The `countOnly`-on-a-non-query error carries no code.
  - Error text has the form `<what happened>. <what to do about it>.`
- **The IRIS handler.**
  - It extends `ExecuteMCPv2.REST.Base`.
  - It saves and restores `$NAMESPACE` (never `New $NAMESPACE`) and validates input before switching.
  - It captures and discards any device output a statement writes, restoring I/O before the one render (Rule #7).
  - It sends errors through `SanitizeError` and renders exactly once.
- **Operator controls.**
  - They are read only from `ctx.config` (AD-3).
  - They reach every profile through the one inheritance spread in `mergeProfile`: env `IRIS_PROFILES` entries and Server Manager entries. These are the two `mergeProfile` call sites as of 2026-10-15: `profiles.ts:465` and `server-manager-source.ts:900`.
  - A malformed value fails startup naming the variable.
- **Live checks** name their target (the six `IRIS_*` variables) and write only the `ExecuteMCPv2.Temp.QaStory385Gate*` fixtures named under Verification, removed before and after.
- **Source text** is ASCII (Rule 14), and comments state the contract.

**Never:**
- **Frozen-baseline tool.** No `action` enum and no annotation change on `iris_sql_execute`. Do not edit `governance-baseline.ts` or `baseline-classifications.ts`, and never run the bare baseline generator.
- **Out of scope.**
  - No change to `iris_sql_analyze` (out of scope: probe 5).
  - No per-profile SQL key in `IRIS_PROFILES` or Server Manager.
  - No server-side row limit on the returned rows: `IRIS_SQL_MAX_ROWS` stays a post-fetch cap.
  - No keyword matching anywhere in the safety path.
  - No Atelier fallback route.
- **Other surfaces.**
  - No change to the governance engine or the parent mechanism. No other tool's preset rows change, and no tool leaves `core`.
  - Do not touch `ipm/module.xml` (Story 42.4).
  - Do not fix DW-554, and do not use the flat `IRIS_GOVERNANCE` shape in tests.
- **Release.** No `changeset version`, no publish and no CI wiring (AD-29).

## I/O & Edge-Case Matrix

**Notation.**
- **E** is `POST /api/executemcp/v2/dev/sql/execute` with body `{query, parameters?, namespace:<ns>, readOnly:<bool>, countOnly:<bool>, maxRowsAffected:<n>|null}`. Its `readOnly` and `maxRowsAffected` are the effective values, after the operator variables are applied.
- **RO**, **CAP** and **TE** are the texts below.
- `<T>` is the IRIS statement type name (for example `DELETE`).
- `<cap>` is the effective cap and `<n>` is `%ROWCOUNT`.
- **`readOnlySource`** is:
  - `tool` for `iris_sql_query`;
  - `operator` when `IRIS_SQL_READ_ONLY=true`;
  - otherwise `parameter`.
- **`capSource`** is `operator` when the ceiling is set and the caller omitted `maxRowsAffected` or passed a larger value; otherwise it is `parameter`. `<src>` is `IRIS_SQL_MAX_ROWS_AFFECTED` or `maxRowsAffected` to match.

**Texts.**
- **RO** (`SQL_READ_ONLY`): `Statement was not run in namespace '<ns>': it is a <T> statement, and read-only mode runs only queries (SELECT). Nothing was changed. ` followed by the remedy for its source:
  - parameter: `Run it without readOnly to execute it.`
  - operator: `The operator's IRIS_SQL_READ_ONLY setting makes every call read-only; run a SELECT instead.`
  - tool: `iris_sql_query runs only queries; run other statements with iris_sql_execute.`

  `structuredContent` is `{code, namespace, statementType:<T>, readOnlySource}`.
- **CAP, not run**: `Statement was not run in namespace '<ns>': it is a <T> statement, and under a rows-affected cap (<cap>, from <src>) only SELECT, INSERT, UPDATE and DELETE run, because those are the statements whose affected rows IRIS counts. Nothing was changed. ` followed by the remedy for its source:
  - parameter: `Run it without maxRowsAffected.`
  - operator: `The operator's IRIS_SQL_MAX_ROWS_AFFECTED ceiling applies to every call, so this statement cannot run through iris_sql_execute here.`

  `structuredContent` is `{code:"SQL_ROWS_AFFECTED_CAP", namespace, statementType, maxRowsAffected:<cap>, capSource}`.
- **CAP, rolled back**: `Statement was rolled back in namespace '<ns>': the <T> affected <n> rows, more than the cap of <cap> (from <src>). Its row changes were undone. ` followed by the remedy for its source:
  - parameter: `Narrow the statement to at most <cap> rows, or raise maxRowsAffected.`
  - operator: `Narrow the statement to at most <cap> rows; a call cannot raise the operator's IRIS_SQL_MAX_ROWS_AFFECTED ceiling.`

  When `<n>` < 0, `affected <n> rows` reads `affected an unknown number of rows (IRIS reports -1, as it does for TRUNCATE TABLE)`. `structuredContent` is the not-run shape plus `rowsAffected:<n>`, placed after `statementType`.
- **CO** (no code, no `structuredContent`): `countOnly counts the rows a query returns, and this is a <T> statement, so nothing was run. Remove countOnly, or pass a SELECT.`
- **TE** (`isError`, no code, no `structuredContent`): `Statement changed the transaction this tool opened in namespace '<ns>': a function, procedure or trigger it ran started, committed or rolled back a transaction, so the tool could not check or undo its effects reliably and some changes may be saved. Check the data the statement touches before running it again.`
- **OK**: today's object, `{columns, rows, rowCount, truncated?, totalAvailable?, rowsCapped?}`, then, when they apply, the new fields in this order:
  - `rowsAffected` (statement types 2, 3 and 4 only);
  - `totalCount`;
  - `readOnlyForced: true` (`iris_sql_execute` only, when `IRIS_SQL_READ_ONLY` forced a call that did not pass `readOnly: true`);
  - `maxRowsAffectedCapped: true` (on an INSERT, UPDATE or DELETE whose effective cap came from the operator).

  The text block stays `JSON.stringify(result, null, 2)`.

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Default SELECT | no new parameter or variable | E with `readOnly:false, countOnly:false, maxRowsAffected:null`; result fields equal today's mapping of the same rows (`rowsCapped`, `truncated`, `totalAvailable` included) | No error expected |
| Default DML | `DELETE` hitting 3 rows | executed with no tool transaction; `{columns:[], rows:[], rowCount:0, rowsAffected:3}` | No error expected |
| Other statements | DDL; `CALL` with result sets | executed as today; a CALL returns the rows of every result set in order; no `rowsAffected` | No error expected |
| Serializer | fixture SELECT and CALL: date, time, timestamp, NULLs, `%List`, stream, numeric, boolean, a JSON-looking string, `CAST(NULL AS INTEGER)` | every row equals `action/query`'s rows for the same statement mapped through today's mapping (live) | No error expected |
| Read-only SELECT | `readOnly:true` or `iris_sql_query`, SELECT | rows returned; the endpoint's transaction is rolled back | No error expected |
| Read-only refusal | read-only, statement type not 1 (UPDATE, DELETE, INSERT, CALL, DDL, COMMIT...) | not executed; RO; rows intact (live) | `isError` |
| Operator read-only | `IRIS_SQL_READ_ONLY=true`, `readOnly` omitted or `false` | as read-only; a SELECT result adds `readOnlyForced:true`; a refusal is RO (operator) | `isError` on refusal |
| SELECT side effects | read-only SELECT calling a function that inserts a row, sets a journaled global and `$INCREMENT`s | rows returned; the insert and the global set are undone; the `$INCREMENT` counter is not (live) | No error expected |
| Transaction changed | read-only or capped statement whose function, procedure or trigger ends or opens a transaction | rolls back to the entry level whatever is open; TE | `isError` |
| Cap within | `maxRowsAffected:5`, DELETE hitting 3 | committed; OK with `rowsAffected:3` | No error expected |
| Cap exceeded | `maxRowsAffected:2`, DELETE hitting 3; or `maxRowsAffected:0`, UPDATE hitting 3 | rolled back; rows intact; CAP rolled back with `rowsAffected:3` | `isError` |
| Cap unknown | any cap, `TRUNCATE TABLE` (type 4, `%ROWCOUNT` -1) | rolled back; rows intact; CAP rolled back, `rowsAffected:-1` | `isError` |
| Cap not countable | any cap, statement type not in {1,2,3,4} (CALL, CREATE/DROP TABLE, COMMIT...) | not executed; CAP not run | `isError` |
| Cap and SELECT | any cap, SELECT | runs as with no cap; no cap flag | No error expected |
| Operator ceiling | `IRIS_SQL_MAX_ROWS_AFFECTED=2`, `maxRowsAffected` omitted or `10` | effective cap 2, `capSource:"operator"`; a DML OK adds `maxRowsAffectedCapped:true`; over the cap gives CAP (operator) | `isError` over cap |
| Caller tighter | ceiling 10, `maxRowsAffected:2` | effective cap 2, `capSource:"parameter"`; no flag | as above |
| Read-only and cap | both in force | read-only governs; the cap is not consulted | as read-only |
| countOnly | `countOnly:true`, SELECT (read-only or not) | `{columns:[], rows:[], rowCount:0, totalCount:N}`, with N equal to `COUNT(*)` (live); no rows are transferred; `maxRows`/`IRIS_SQL_MAX_ROWS` do not apply and no `rowsCapped`/`truncated` is set | No error expected |
| countOnly, non-query | `countOnly:true`, statement type not 1 | not executed; CO (read-only mode's RO wins when both apply) | `isError` |
| `iris_sql_query` | `query`, `parameters?`, `maxRows?`, `countOnly?`, `namespace?` | always read-only (`readOnlySource:"tool"`); `IRIS_SQL_MAX_ROWS` (`rowsCapped`) and `IRIS_SQL_TIMEOUT` apply exactly as to `iris_sql_execute`; `IRIS_SQL_MAX_ROWS_AFFECTED` has nothing to bound; never `readOnlyForced` | as above |
| Multi-statement | `SELECT 1; DELETE FROM ...` | IRIS refuses the prepare (SQLCODE -25); nothing runs | `SQL error: ...` |
| SQL error | prepare or execution error, with or without the tool's transaction | any transaction is rolled back first; `SQL error: <IrisApiError message>` as today | `isError` |
| Transport | 404 (endpoint not deployed), 500, network | as today: `IrisApiError` gives `SQL error: ...`; anything else propagates | as today |
| Config | `IRIS_SQL_READ_ONLY` not `true`/`false` (case-insensitive); `IRIS_SQL_MAX_ROWS_AFFECTED` not a non-negative integer; empty = unset | startup fails: `IRIS_SQL_READ_ONLY must be "true" or "false". Received: "<v>".` / `IRIS_SQL_MAX_ROWS_AFFECTED must be a non-negative integer. Received: "<v>".` | throws |

**Governance** (through the real `McpServerBase.handleToolCall` with the real dev tools; `D` is a `GOVERNANCE_DISABLED` denial):

| Scenario | Configuration | Expected |
|---|---|---|
| Defaults | none | `iris_sql_query` runs; `iris_server_profiles` reports `true`/`default` |
| Read-only preset | `IRIS_GOVERNANCE_PRESET=read-only` | `iris_sql_query` runs; `iris_sql_execute` gives D with `presetApplied` |
| Inherited | `{global:{iris_sql_execute:false}}`, and the same key at the env profile, file profile and file global layers | `iris_sql_query` gives D with `inheritedFrom:"iris_sql_execute"` and the ` (inherited from 'iris_sql_execute')` suffix; source `parent`; profile-scoped |
| Child wins | inherited plus `{global:{iris_sql_query:true}}` | runs |
| Parent enabled higher | env `{global:{iris_sql_execute:true}}`, file `{global:{iris_sql_execute:false}}` | runs |
| Inherited and read-only | both | D with `inheritedFrom`, no `presetApplied` |

</intent-contract>

## Code Map

- **Dev tool** -- `packages/iris-dev-mcp/src/tools/sql.ts` (141 lines).
  - `sqlExecuteTool` posts `{query, parameters?}` to `atelierPath(v, ns, "action/query")` (:71-87).
  - It maps `result.content` row objects into `columns`/`rows`/`rowCount`, plus `truncated`/`totalAvailable`/`rowsCapped` (:91-118).
  - It wraps `IrisApiError` as `SQL error: ${message}` (:126-138).
  - `DEFAULT_MAX_ROWS = 1000` (:21). The annotations are frozen (:55-60).
- **Today's request and error.** Live, `SELEC 1` gives HTTP 200 with `status.errors[0].error` `ERROR #5540: SQLCODE: -51 Message:  An SQL statement expected, IDENTIFIER found`. The tool text names the route: `SQL error: IRIS reported errors for POST /api/atelier/v8/HSCUSTOM/action/query. Review the error details and correct the request. Details: ...` (`http-client.ts:409-419`).
- **Config** -- `packages/shared/src/config.ts`.
  - Fields :41-52; the JSDoc table :85-86; parsing :153-182 (the sibling for both new variables); the conditional spread :252-253.
  - `config.test.ts:139-160` checks the unset case, with an exact `toEqual` at :149, so new fields stay absent when unset.
- **Profiles** -- `packages/shared/src/profiles.ts`.
  - `mergeProfile` inherits `sqlMaxRows`/`sqlTimeoutMs`/`testTimeoutMs` from `base` (:362-374). `base` is always the env-derived `loadConfig` output (:465), and Server Manager's `smBase` is `{...loadConfig(env), password:""}` (`server-manager-source.ts:754-755, 900`).
  - `ProfileOverride` (:156-163) ignores unknown keys (pre-existing).
  - Tests: `profiles.test.ts:703-752`.
- **Refusals** -- `packages/shared/src/refusals.ts:15-24` (4 codes); `refusalResult(code, text, fields)` (:51).
  - `refusals.test.ts:45-51` pins the sorted key list.
  - `iris-mcp-all/.../story-38-3-qa-doc-claims.test.ts:339-381` requires every built-dist code literal to appear only in `refusals.ts`, so call sites use `REFUSAL_CODES.X`.
- **Governance (unchanged; reuse)** -- `governance.ts`:
  - `buildParentKeys` (:654-703): its throws are at :664/:670/:677/:684/:697. `iris_sql_query` owns no baseline key, and `iris_sql_execute` is a baseline key (`governance-baseline.ts:158`, `write` at `baseline-classifications.ts:204`).
  - `inheritedParentDisable` (:937-952).
- **Dev registration.**
  - `index.ts`: imports :10-45 (`sqlExecuteTool` :31), and the array :48-79 with `docEditTool` last (:78).
  - `presets.ts`: header :1-30 (13 package / 14 runtime, "30-tool"); `core.include` :38-50 (13); `core.exclude` :53-69 (17); `developer.include` :74-103 (30).
- **IRIS side** -- `src/ExecuteMCPv2/REST/`.
  - `SqlAdvisor.cls:52-110` (`AdviseData`) is the sibling request shape: `ReadRequestBody`, then `ValidateRequired`, then `SwitchNamespace` (`Utils.cls:50,77,1124`), then a `%request`-free core method (`BuildAdviceData`, :120), then one render with `SanitizeError`.
  - The output-capture idiom is `Analytics.cls:250-282`, with `Command.cls:45` `TeardownRedirect(tInitIO, tNull)`.
  - `Dispatch.cls:179` (`/dev/sql/advise-data`) is the route precedent.
  - `Base.cls` is the envelope.
- **Bootstrap rosters.**
  - `scripts/gen-bootstrap.mjs:14-44` (`SqlAdvisor` :42, `Dispatch` :43, which stays last).
  - `packages/shared/src/__tests__/bootstrap.test.ts`:
    - size `toBe(29)` :1025-1027;
    - expected names :1031-1061;
    - `classes.length` 29 :1089;
    - Base-extenders :1129-1144;
    - `classPaths` :1251-1281.
  - `BOOTSTRAP_VERSION = "3af8ca401e7c"` (`bootstrap-classes.ts:25`, generated).
  - `src/ExecuteMCPv2/Tests/BaseTest.cls:282-300` `TestAllFifteenHandlersExtendBase` asserts exactly 15 handlers. The class has 7 `Test*` methods.
- **Live helpers.**
  - `packages/iris-dev-mcp/src/__tests__/live-doc-helpers.ts`: `putDocLines` :70, `compileDocs` :112, `removeStored` :50, and `runQuery(client, version, ns, sql)` :127 (Atelier `action/query`, the oracle).
  - The cleanup sibling is `doc-put-storage-guard-live-gate.test.ts:137-180`: `%KillExtent`, then kill the `ExecuteMCPv*` globals containing the stem, then `removeStored`, then emptiness checks.
  - The roster is `packages/iris-dev-mcp/scripts/prepublish-gate.mjs:73-92`.
- **Tests that pin today's SQL shapes.**
  - `sql.test.ts`: the `action/query` path at :31-32, :62-63, :120, :145-146, :210-211 and :283-284; 2-argument `post` at :214; annotations at :152; bodies at :180 and :192.
  - `sql-caps.test.ts`: :52-53, :198-199, :218-219, :257-258 (path); :65 and :154.
  - `tools.integration.test.ts:377,399`.
  - `iris-mcp-all/.../governance-file-process-gate.test.ts:458-462` (live `SELECT 1`).
- **Count and roster pins** (dev 30 -> 31, toolCount 31 -> 32, suite 106/111 -> 107/112, `core` 13/14 -> 14/15, developer 30 -> 31).
  - Dev tests: `index.test.ts:22-60,73-82`; `presets.test.ts:53-61`.
  - Shared tests: `pre-feature-tool-snapshot.ts:18,25-56`; `tool-visibility-backcompat.test.ts:124`.
  - `iris-mcp-all` tests:
    - `tool-visibility-snapshot-drift.test.ts:63-71`;
    - `docs-prompt-sync.test.ts:118,126,135,137` ("106 tools");
    - `docs-visibility-roster-sync.test.ts`, whose doc locations are derived from the dists;
    - `default-enabled-holders.test.ts:64` (the parent map literal).
  - Docs:
    - root `README.md` :15, :21, :86-98 (env table), :376-446 (read-only and parent prose), :630-652 (roster and payload), :686, :733;
    - dev `README.md` :49, :183-194, :988-996, :1708;
    - `packages/iris-mcp-all/README.md:31,39,43`;
    - `tool_support.md` :24, :28-60 (row 14 is `iris_sql_execute` Atelier; "21 Atelier · 9 ExecuteMCPv2"), :351, :381, :386, :398, :412;
    - `docs/migration-v1-v2.md:11,29`;
    - `docs/epic-summary.md:3`;
    - `CHANGELOG.md:878-880` and the top section.
- **Governance precedent tests** -- `doc-edit-governance.test.ts` (519 lines; describes at :162, :223, :252, :272, :388, :469, :499).

## Tasks & Acceptance

**Execution:**
- `src/ExecuteMCPv2/REST/Sql.cls` (new) -- `ExecuteMCPv2.REST.Sql Extends ExecuteMCPv2.REST.Base`. -- AC-1..AC-4, AC-7.
  - **Entry point.** `Execute()` is the HTTP entry, shaped like `SqlAdvisor.AdviseData`. It hands off to a `%request`-free `ClassMethod Run(pBody As %DynamicObject, Output pResult As %DynamicObject) As %Status` that does the work:
    1. Validate `query` (required, before any namespace switch), and read `parameters`, `namespace`, `readOnly`, `countOnly` and `maxRowsAffected` (`""`/null = no cap).
    2. Prepare the statement, then read its type and type name.
    3. Decline in this order: read-only and a type other than 1 gives `outcome:"readOnly"`; `countOnly` and a type other than 1 gives `"countOnly"`; a cap and a type not in {1,2,3,4} gives `"capNotCountable"`.
    4. Otherwise execute, as the Always rules say. Read-only takes the read path even when a cap is set. An INSERT, UPDATE or DELETE under a cap takes the cap path. Both run inside the endpoint's transaction; every other statement runs without one. A count over the cap gives `"overCap"` with `rowsAffected`; a changed transaction level gives `"transactionEnded"`.
    5. On success the result is `{content, statementType, statementTypeName, rowsAffected?, totalCount?}`. Every declined outcome carries `statementType` and `statementTypeName`.
  - **Serializing and counting.** A serializer method, written fresh, iterates a result (and every `%NextResult` of a CALL) into the `action/query` row shape. `countOnly` iterates `%Next` and counts without serializing.
  - **Errors and output.** A `%SQLCODE` < 0 becomes `%Exception.SQL` `CreateFromSQLCODE(...).AsStatus()`, sent through `SanitizeError`. Device output is captured as in `Analytics.cls:250-282` and discarded.
  - **Style.** There is no argumented `Quit` in Try/Catch, no `$Get()` around a method call, and the banners use HTML markup.
- `src/ExecuteMCPv2/REST/Dispatch.cls` -- add `<Route Url="/dev/sql/execute" Method="POST" Call="ExecuteMCPv2.REST.Sql:Execute" />` after :179. The change is additive (AD-33).
- `src/ExecuteMCPv2/Tests/BaseTest.cls` -- rename `TestAllFifteenHandlersExtendBase` to `TestAllSixteenHandlersExtendBase` and move its count to 16, message included. The method count stays at 7.
- `scripts/gen-bootstrap.mjs`, `packages/shared/src/__tests__/bootstrap.test.ts` -- add `ExecuteMCPv2.REST.Sql.cls` before `Dispatch` in `classes[]`. In the test, the counts move 29 -> 30, and `Sql` joins the expected names, the Base-extenders list and `classPaths` (Rule #39). Then run `pnpm gen:bootstrap` and record `BOOTSTRAP_VERSION` `3af8ca401e7c` -> new (Rule #24). -- AC-8.
- `packages/shared/src/config.ts` -- add `sqlReadOnly?: boolean` and `sqlMaxRowsAffected?: number`, parsed like `IRIS_SQL_MAX_ROWS`: an empty value is unset, and an invalid one throws with the Config-row texts. Add both to the JSDoc table, and spread each only when set. -- AC-2, AC-3, AC-5.
- `packages/shared/src/profiles.ts` -- inherit both fields in `mergeProfile` beside `sqlMaxRows` (:367). -- AC-2, AC-3.
- `packages/shared/src/refusals.ts` -- add:
  - `SQL_READ_ONLY` ("Read-only mode refused a statement that is not a query");
  - `SQL_ROWS_AFFECTED_CAP` ("A rows-affected cap refused a statement, before it ran or by rolling it back").

  Update `refusals.test.ts`. -- AC-2, AC-3.
- `packages/iris-dev-mcp/src/tools/sql.ts` -- one shared `runSql(args, ctx, {tool})` helper. Both tools use it, so nothing is copied (Rule 2). -- AC-2..AC-6.
  - **What `runSql` does.**
    - It resolves the effective read-only mode and cap.
    - It posts E (with the `timeout` option as today), maps the result through today's mapping, and adds the new fields.
    - It maps each declined outcome to RO, CAP, CO or TE.
    - It keeps the `SQL error:` catch.
  - **`sqlExecuteTool`.**
    - It adds `readOnly: z.boolean().optional()`, `maxRowsAffected: z.coerce.number().int().min(0).optional()` and `countOnly: z.boolean().optional()`. Each is described with its default.
    - The description appends:
      - the three controls and both operator variables, each with its default;
      - that under a rows-affected cap only SELECT, INSERT, UPDATE and DELETE run;
      - "statement-level read-only, not side-effect-free", and the residual list in Design Notes;
      - that `iris_sql_query` is the query route under the read-only preset.
    - The annotations do not change.
  - **`sqlQueryTool`** (new): `name: "iris_sql_query"`, `title`, `scope: "NS"`, `mutates: "read"`, `parent: "iris_sql_execute"`.
    - Annotations: `{readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:false}`.
    - Schema: `query`, `parameters?`, `maxRows?`, `countOnly?`, `namespace?`, every field described.
    - The description leads with what the tool does and when to use it (queries, including under the read-only preset), and what it returns. Then it states:
      - that it is enabled by default and disabled when an operator explicitly disables `iris_sql_execute`, unless `iris_sql_query` is set;
      - "statement-level read-only, not side-effect-free": SELECT only, CALL refused, `SQL_READ_ONLY`, and the residual effects;
      - `IRIS_SQL_MAX_ROWS` and `IRIS_SQL_TIMEOUT`.

      It names no REST path.
- `packages/iris-dev-mcp/src/tools/index.ts`, `presets.ts` -- append `sqlQueryTool` last; `core` and `developer` include it. Rewrite the header comment to the current contract: `core` 14 package / 15 runtime (L-4 guideline), developer 31, with the reason given in Design Notes. -- AC-6.
- `packages/iris-dev-mcp/src/__tests__/sql.test.ts`, `sql-caps.test.ts` -- move every request pin to E with the explicit defaults. Every existing result assertion stays as it is, and add a `toEqual` on the full `structuredContent` and text of each existing scenario against today's literal (AD-15). -- AC-5.
- `packages/iris-dev-mcp/src/__tests__/sql-safety.test.ts` (new) -- every matrix row for both tools against mock HTTP.
  - Pin the exact texts, `structuredContent` with `toEqual`, and the request body.
  - The fakes return only shapes the endpoint can return (Rule #54).
  - Include the description and parameter cases ("statement-level read-only, not side-effect-free", both variables and the defaults).
  - Prove that `readOnly:false` cannot weaken the operator variable, and that a larger `maxRowsAffected` cannot raise the ceiling. -- AC-2..AC-6.
- `packages/shared/src/__tests__/config.test.ts`, `profiles.test.ts` -- cover:
  - parsing, rejection and unset (fields absent);
  - inheritance into an `IRIS_PROFILES` entry and a Server Manager entry;
  - an `IRIS_PROFILES` `default` entry that cannot set them. -- AC-2, AC-3, AC-5.
- `packages/iris-dev-mcp/src/__tests__/sql-query-governance.test.ts` (new) -- mirror `doc-edit-governance.test.ts`, using the real `sqlExecuteTool`/`sqlQueryTool` with handler spies. It covers:
  - the governance matrix;
  - construction with the real tools and presets;
  - `buildParentKeys` mapping `iris_sql_query` to `iris_sql_execute`;
  - `iris_server_profiles` (`allProfiles` included);
  - the read-only preset proof. -- AC-6.
- `packages/iris-dev-mcp/src/__tests__/index.test.ts`, `presets.test.ts`; `packages/shared/src/__tests__/pre-feature-tool-snapshot.ts`, `tool-visibility-backcompat.test.ts` -- update the counts, the order (`iris_sql_query` last) and `core` 14/17/31/0, with 15 runtime citing L-4. -- AC-6.
- `packages/iris-dev-mcp/src/__tests__/sql-safety-live-gate.test.ts` (new) -- the live gate. Follow the 38.3 gate's setup and cleanup; its own `process.env.IRIS_REQUIRE_LIVE ===` comparison; emptiness checks scoped to the stem `QaStory385Gate` only. -- AC-4, AC-5, AC-7.
  - **Cap, over.** A `DELETE` over the cap, both through `maxRowsAffected` and through `ctx.config.sqlMaxRowsAffected`, gives CAP. The rows and the audit rows are intact, and the trigger's `$INCREMENT` moved (the residual, recorded).
  - **Cap, within.** A DELETE within the cap commits with the right `rowsAffected`.
  - **Cap, TRUNCATE.** TRUNCATE under a cap gives CAP with `rowsAffected` -1, and the rows are intact.
  - **Read-only.** `readOnly` and `sqlReadOnly` refuse an `UPDATE`, and the values are unchanged.
  - **Side effects.** A side-effect SELECT through `iris_sql_query` is undone except for the counter.
  - **Changed transaction.** The transaction-ending function gives TE.
  - **countOnly.** `countOnly` equals the `runQuery` `COUNT(*)` oracle.
  - **Default DML.** A default-path DML result's `rowsAffected` equals the change seen by `runQuery`.
  - **Serializer.** The serializer pin covers both tools against `runQuery` on the fixture SELECT and CALL.

  Add the file to `prepublish-gate.mjs` `gateTestFiles` with a two-line comment naming the fixtures.
- `packages/iris-mcp-all/src/__tests__/default-enabled-holders.test.ts` -- the parent map becomes `{iris_doc_edit:"iris_doc_put", iris_sql_query:"iris_sql_execute"}`. The holder list is unchanged. -- AC-6.
- Docs (Rules #30, #31, #43, #51) -- AC-5, AC-6.
  - **Dev `README.md`.**
    - The SQL table gets an `iris_sql_query` row ("read, enabled by default; available under read-only") and the new `iris_sql_execute` parameters.
    - The caps paragraph gains `IRIS_SQL_READ_ONLY` and `IRIS_SQL_MAX_ROWS_AFFECTED` with their defaults (unset = off), `rowsAffected`, `totalCount` and the residual effects.
    - The counts change at :49 and :1708.
  - **Root `README.md`.**
    - The env table and the "Single-server installs" list gain both variables with their defaults.
    - The read-only section names `iris_sql_query` as the query route.
    - The "Parent keys" prose adds `iris_sql_query` -> `iris_sql_execute`.
    - The counts change.
  - **`tool_support.md`.** A new dev row 31 (ExecuteMCPv2 `POST /dev/sql/execute`), row 14 moved to that route, and the rollups recounted mechanically.
  - **Counts elsewhere.** `packages/iris-mcp-all/README.md`, `docs/migration-v1-v2.md`, `docs/epic-summary.md`, and the `docs-prompt-sync.test.ts` literals move to 107.
  - **`CHANGELOG.md`.** The roster line at :878-880, plus a new top section `## [Pre-release — 2026-10-15] — Story 38.5: SQL write safety`:
    - `### Added`: the tool, its key and default state, the parameters, both variables, `rowsAffected`/`totalCount`, the two codes and the route;
    - `### Changed`: `iris_sql_execute` runs through the ExecuteMCPv2 SQL route, its SQL-error text names that route, and dev `core` moves 14 -> 15 runtime.
  - **`.changeset/story-38-5-sql-write-safety.md`.** `"@iris-mcp/shared": minor`, `"@iris-mcp/dev": minor`.
  - **Payload.** Re-measure the payload table with `pnpm measure:tools-payload`.

**Acceptance Criteria:**
- **AC-1 (38.5.1).** Given the probe record in Design Notes, when the plan is reviewed, then it records:
  - the current execution path;
  - the statement-type classification against the keyword blocklist on the adversarial fixtures;
  - rollback behavior, including triggers and residuals;
  - that a custom endpoint is needed;
  - the earliest IRIS version verified (2026.2 build 221U).
- **AC-2 (38.5.2).** Given read-only mode by parameter, operator or tool, when a non-query runs, then it is refused before execution with `SQL_READ_ONLY` naming its type. A parameter cannot weaken `IRIS_SQL_READ_ONLY`, and a forced SELECT carries `readOnlyForced`.
- **AC-3 (38.5.3).** Given an effective cap, when a DML statement affects more rows than the cap, or an unknown number, then it is rolled back and `SQL_ROWS_AFFECTED_CAP` reports `rowsAffected` and `maxRowsAffected`.
  - A statement type the cap cannot count is refused before execution.
  - The ceiling cannot be raised by a call.
- **AC-4 (38.5.4).** Given an INSERT, UPDATE or DELETE, when `iris_sql_execute` runs it, then the result carries `rowsAffected`. Given `countOnly: true` and a SELECT, when either tool runs it, then the result carries `totalCount` and transfers no rows. In both cases:
  - `rowCount` keeps its meaning (rows returned);
  - the Design Notes grep shows both names absent from every SQL tool's output today.
- **AC-5 (38.5.5).** Given no new parameter or variable, when the pre-existing `sql.test.ts`/`sql-caps.test.ts` scenarios run, then every result equals today's literal (`toEqual`) and the request sends the explicit defaults. Live, the default path's rows equal `action/query`'s. The docs state both variables with their defaults.
- **AC-6 (38.5.6).** Given the real dev server, when it is constructed and called under the governance matrix configurations, then:
  - `iris_sql_query` is `read`, enabled by default and enabled under the read-only preset;
  - it is absent from the baseline;
  - it inherits an explicit `iris_sql_execute` disable (the governance matrix);
  - `core` holds 14 package / 15 runtime tools and `developer` 31;
  - dev has 31 tools (32 advertised; suite 107/112).
- **AC-7 (38.5.7).** Given the armed live gate on the `QaStory385Gate` fixtures, when it runs, then:
  - a DELETE over the cap is refused with the rows intact;
  - read-only refuses `UPDATE`;
  - `countOnly` equals `COUNT(*)`;
  - the serializer pin holds;
  - afterwards nothing named `QaStory385Gate` remains.
- **AC-8 (gates).** Given the finished tree, when the Verification commands run, then:
  - the per-package build, test, lint and type-check pass;
  - `:check` exits 0 at `1e62c5ad5bf7`/141;
  - `gen:bootstrap` is idempotent and `BOOTSTRAP_VERSION` from -> to is recorded;
  - `BaseTest` reports 7/7;
  - `governance-baseline.ts`, `baseline-classifications.ts` and `ipm/module.xml` have no diff.

## Spec Change Log

## Review Triage Log

## Design Notes

**Governing ADs.**
- **AD-25.** Classification by statement type on the same prepared statement in one call; always-rolled-back read paths; transactional caps; one serializer pinned against `action/query`; the read-only preset is served by `iris_sql_query`.
- **AD-9.** The operator controls: tighten, never loosen; a clamp is noted (`readOnlyForced`, `maxRowsAffectedCapped`, after the `rowsCapped` precedent).
- **AD-4.** The tool is classified `read` with truthful annotations; the frozen tool gains no enum or hint change; parameters add no new kind of side effect.
- **AD-6.** The parent mechanism is reused unchanged.
- **AD-7.** `core` joins at L-4 size.
- **AD-12.** Recorded exception: checks before commit, and atomic classification.
- **AD-11, AD-13, AD-14, AD-33.** The handler envelope, the namespace switch, bootstrap and the additive route.
- **AD-15.** Back-compat.
- **AD-3, AD-5, AD-10, AD-2, AD-29.** `ToolContext` only, the frozen baseline, the counts, cross-package checks in `iris-mcp-all`, and minor changesets.
- **Conventions.** Tool descriptions, Tool annotations, Tool results, Refusals, Error text, Configuration variables, REST routes, Live gates, Live testing on a shared instance, Probes and references, and the ObjectScript rows.

**Probe record (AC 38.5.1).** The probes ran at plan time on 2026-10-15 against `default`: localhost:52773, instance `77DD5053-...`, IRIS 2026.2 build 221U, Atelier v8, namespace HSCUSTOM, journaled (`GlobalJournalState=3`). They used disposable `ExecuteMCPv2.Temp.QaStory385{Row,Audit,Probe,Probe2}`, and all of it was removed afterwards: the documents with `generated`, and the globals, including the stream global `%KillExtent` leaves behind.
1. **Today's path.** `iris_sql_execute` posts to Atelier `action/query` (`%Api.Atelier.v1.Query`; v2-v8 inherit it):
   - it prepares with `%Prepare(q, 0)` and executes with no transaction;
   - it serializes SELECT and CALL result sets only;
   - DML returns `content: []`, with no row count;
   - errors come back as HTTP 200 with `status.errors`.

   So no Atelier call can classify, roll back or count. A custom endpoint is needed, and the bootstrap moves.
2. **Classification.** Statement type after prepare, against a keyword blocklist (any of INSERT/UPDATE/DELETE/DROP/CREATE/ALTER/TRUNCATE/GRANT/REVOKE/CALL as a word) and a first-keyword check (starts with SELECT or WITH):

   | Fixture | Statement type | Blocklist | First keyword |
   |---|---|---|---|
   | `/* DELETE FROM T */ SELECT 1` | 1 SELECT | refuses (false positive) | refuses (false positive) |
   | `-- DELETE ...` newline `SELECT 1` | 1 SELECT | false positive | false positive |
   | `SELECT 'DELETE FROM T' AS s` | 1 SELECT | false positive | allows |
   | `SELECT 1 AS "DELETE"` | 1 SELECT | false positive | allows |
   | `WITH c AS (SELECT 1 AS a) SELECT a FROM c` | 1 SELECT | allows | allows |
   | `WITH c AS (...) DELETE FROM T WHERE ...` | 4 DELETE | refuses | **allows (a write passes)** |
   | `CALL fn()` | 45 CALL | refuses | refuses |
   | `SELECT 1; DELETE FROM T` | prepare error, SQLCODE -25 | refuses | allows |
   | `SELECT fn()` (fn writes) | 1 SELECT | allows | allows |

   Other types: `TRUNCATE TABLE` is 4 DELETE; `INSERT OR UPDATE` is 2; `EXPLAIN SELECT 1` and `EXPLAIN DELETE FROM T` are 1. COMMIT is 5, ROLLBACK 6, START TRANSACTION 21, SET TRANSACTION 20, SAVEPOINT 46, LOCK TABLE 47, GRANT 7, CREATE TABLE 9 and DROP TABLE 11. `(SELECT 1)`, `   select 1` and a trailing `;` are all 1.

   The statement type has no false positive on comments, literals or identifiers, and it catches the CTE-wrapped DELETE that the first-keyword check lets through. Neither approach sees a function's side effects; the rolled-back transaction handles those.
3. **Rollback.** Each case ran inside `TSTART` / execute / `TROLLBACK`, on a 5-row table with a DELETE trigger that inserts an audit row and `$INCREMENT`s a counter.
   - `DELETE`: `%ROWCOUNT` 5, 5 audit rows written by the trigger; after the rollback, 5 rows and 0 audit rows, and the trigger counter stays at 5.
   - `UPDATE`: `%ROWCOUNT` 5, restored.
   - `INSERT`: `%ROWCOUNT` 1, restored. The row-ID counter stays advanced (6).
   - `TRUNCATE TABLE`: `%ROWCOUNT` **-1**, restored.
   - `SELECT fn()`, where fn inserts a row, sets a global and `$INCREMENT`s: the insert and the global set are undone, and the counter is not.
   - `CALL fn()`: `%ROWCOUNT` **0**, although the procedure wrote a row. A CALL's writes are not counted.
   - A SQL `COMMIT` statement inside `TSTART` ends the transaction (`$TLEVEL` 0).
   - A SELECT whose function issues `TCOMMIT` ends the caller's transaction, and its insert persists (the TE row is reachable).

   Default path: `DELETE ... WHERE ID = 999` gives `%ROWCOUNT` 0 and SQLCODE 100. Documented, not probed (docs.intersystems.com GAPPS_tp, RCOS_ctrollback, GCDI_journal): process-private globals and globals mapped to IRISTEMP are not rolled back; transactional sets in a database with journaling off are still journaled and rolled back; JOB and device output are external.
4. **Select mode.** `%SQL.Statement.%New()` gives `%SelectMode` 0 in the ExecuteMCPv2 REST process, and `action/query` output is logical (`Born:"66001"`). So the new endpoint uses the same default.
5. **`iris_sql_analyze` is out of scope.** `explain` and `indexUsage` post `EXPLAIN <query>` to `action/query` (`sqlAnalyze.ts:555-578`), which is type 1 and executes nothing (`EXPLAIN DELETE FROM T` returned one plan row; the table was unchanged). `advise` is also EXPLAIN-only. `stats` and `running` build their own SQL (AD-20/AD-26). The operator SQL controls bind `iris_sql_execute` and `iris_sql_query` only.
6. **`action/query` serializer oracle** (the behavior the port must reproduce; the live gate compares routes directly):
   - `ID` is a JSON number in a SELECT, but `"1"` (a string) in a CALL result set;
   - `%String` is a string;
   - `%Date` `"66001"`, `%Time` `"3600"` and `%TimeStamp` `"2026-10-15 12:01:00"` are strings;
   - `%List` is its raw `$List` bytes as a string;
   - a stream is its stream OID string;
   - `%Numeric` is a number (`1.5`), and a NULL number is `0` (`CAST(NULL AS INTEGER)` is `0`);
   - `%Boolean` is `true`/`false`, and a NULL boolean is `false`;
   - a NULL string, date, time, list or stream is `""`;
   - a string value that parses as JSON (`{"a":1}`) is embedded as JSON;
   - a CALL with no result set gives `content: []`.

**Orchestrator decisions: DECIDED at the spec gate, 2026-10-15, both as recommended (`orchestrator-decisions-wave-6.md` #12, #13; spine AD-25 "Caps" updated, Rule 20).**
- **#12 = (B).** Every `iris_sql_execute` call moves to the new endpoint, on one added condition: the SQL error text must still carry the SQLCODE and the IRIS message text. A test pins that the SQLCODE appears in the error text.
- **#13.** Under a cap, only SELECT, INSERT, UPDATE and DELETE run, and every other statement type is refused before execution.

The planning text follows.
1. **Should `iris_sql_execute` with no new control in force move from Atelier `action/query` to the new endpoint?** Recommended: **(B) yes, every call**.
   - **The case for (B).** AC 38.5.4 requires `rowsAffected` on every DML result, and `action/query` never reports a count (probe 1). AD-25 binds one serializer for all SQL tools, and its "Prevents" names two serializers. AD-15 allows additive output fields.
   - **Cost 1: request pins.** The HTTP request changes, so the request pins in `sql.test.ts`/`sql-caps.test.ts` move. The result pins stay byte-identical (`toEqual`).
   - **Cost 2: SQL-error text.** The text names the new route instead of `action/query`, and `SanitizeError` rewraps `ERROR #5540` as `ERROR #5001`. For example: `SQL error: IRIS reported errors for POST /api/executemcp/v2/dev/sql/execute. ... Details: ERROR #5001: SQLCODE: -51 Message:  An SQL statement expected, IDENTIFIER found`.
   - **Cost 3: deployment.** `iris_sql_execute` now needs the bootstrapped ExecuteMCPv2 service, like `iris_execute_command`, `iris_execute_classmethod`, the global tools and `iris_execute_tests` already do.
   - **(B') B with a fallback.** Add an Atelier fallback on a 404 when no control is in force. It keeps availability on an instance where bootstrap failed, but brings back the second serializer and gives no `rowsAffected` on that path.
   - **(A) No move.** Keep the default path on Atelier. It contradicts AC 38.5.4 and AD-25.
   - **Records.** The plan records the change in the CHANGELOG under "Changed".
2. **What may run under a rows-affected cap?** Recommended: **an allowlist**: SELECT runs uncapped; INSERT, UPDATE and DELETE run under the cap; every other statement type is refused before execution with `SQL_ROWS_AFFECTED_CAP`.
   - **Why.** A CALL reports `%ROWCOUNT` 0 whatever its procedure writes, and `DROP TABLE` drops every row with `%ROWCOUNT` 0 (probe 3). Letting them through would let an operator's `IRIS_SQL_MAX_ROWS_AFFECTED` be bypassed silently, which is the fail-open AD-25 prevents; the allowlist is the stricter side (Rule #44).
   - **The cost.** With the operator ceiling set, DDL and CALL cannot run through `iris_sql_execute`.
   - **The alternative.** The cap bounds DML only and everything else runs uncapped (documented). It is more permissive, and every CALL bypasses the ceiling.

**Plan-time interpretations (apply-and-report, Rule 5).**
1. **Residual effects.** "Globals set by a SQL function" (AC 38.5.6, AD-25 wording) is narrowed by probe 3. Journaled global sets and SQL writes from functions and triggers are rolled back. The description and docs list the residuals that remain:
   - `$INCREMENT`/`$SEQUENCE` counters, row-ID counters included;
   - process-private globals, and globals mapped to IRISTEMP;
   - `JOB`, device output and other external effects;
   - a function, procedure or trigger that ends or opens a transaction (TE).
2. **`totalCount` is not absent today.** `iris_production_adapters` returns it (`Interop.cls:1549`) as "the number of items the call matched", which is the same meaning as `countOnly` (the rows the query matches). `rowsAffected`, `readOnlyForced`, `maxRowsAffectedCapped`, `readOnlySource`, `capSource`, `SQL_READ_ONLY`, `SQL_ROWS_AFFECTED_CAP`, `sqlReadOnly` and `sqlMaxRowsAffected` all grep absent from `packages/*/src`, `src` and `extensions/*/src` (2026-10-15). So AC 38.5.4's absence proof holds for every SQL tool's output, and the one prior `totalCount` shares the meaning. The lead may align the epics.md wording.
3. **Non-query.** Read-only mode treats only statement type 1 as a query. CALL is refused, even of a query procedure, because a procedure can write.
4. **`rowsAffected` scope.** It is present only for statement types 2, 3 and 4, and it is `%ROWCOUNT` as IRIS reports it (-1 for TRUNCATE TABLE).
5. **No per-profile SQL key** is added; no AC asks for one. The two variables are global operator variables inherited by every profile, so AD-9's order (per-profile, then global, then safe default) holds with no per-profile layer. A `default` `IRIS_PROFILES` entry cannot set them.
6. **`maxRowsAffected: 0` is a valid cap.** Any affected row is rolled back and the count is reported: a dry count.
7. **The countOnly output.** `countOnly` keeps today's top-level keys (`columns:[]`, `rows:[]`, `rowCount:0`) so that `rowCount` stays "rows returned".

**`core` size and why (AD-7, L-4).** Dev `core` becomes 14 package tools + `iris_server_profiles` = 15 runtime. Querying is part of the everyday debug loop. Under the read-only preset `iris_sql_execute` is blocked, so a `core` setup would otherwise have no way to query at all. There is no `TOOL_PAIRS` change.

**Seam (Rule #52).** 38.5 owns:
- the endpoint, the controls and both tools;
- the minimal docs (READMEs, `tool_support.md`, CHANGELOG, changeset).

38.6 owns:
- the client-config and launcher env-var docs;
- the capstone, which uses `SQL_READ_ONLY` and `SQL_ROWS_AFFECTED_CAP`;
- the epic-close records.

**Integration (Rules 1/2).**
- **Integration ACs.**
  - `iris_sql_execute` and `iris_sql_query` call the real `/dev/sql/execute` route on live IRIS and produce the refusals with the rows intact, the count equality and the serializer equality (AC-7).
  - `iris_server_profiles` reads the parent map through a real `McpServerBase` built from the real dev tools, and reports `iris_sql_query` as `false`/`parent` (AC-6).
- **Consumed-by:**
  - this story's two tools;
  - the 38.6 capstone and docs enrichment.
- **Consumes:**
  - the 38.4 parent mechanism (`buildParentKeys`, `inheritedParentDisable`, the gate's `inheritedFrom`);
  - the 38.3 `refusalResult` and `REFUSAL_CODES`;
  - `ExecuteMCPv2.Utils` (`ReadRequestBody`, `ValidateRequired`, `SwitchNamespace`, `SanitizeError`), `REST.Base` and `Command.TeardownRedirect`;
  - `live-doc-helpers.ts`.
- **Extend, don't copy.**
  - `sqlQueryTool` and `sqlExecuteTool` share `runSql`.
  - The new variables follow the `IRIS_SQL_MAX_ROWS` parse and spread.
  - The handler follows `SqlAdvisor.AdviseData` (request, namespace, one render, the `Run` seam) and the `Analytics.cls` capture idiom.
  - It is a new class rather than a `SqlAdvisor` method, because `SqlAdvisor` is documented as EXPLAIN-only and never executes caller SQL.
  - The serializer has no sibling in this repo; Atelier's copy is confidential.
  - The governance test mirrors `doc-edit-governance.test.ts`, and the live gate follows `doc-put-storage-guard-live-gate.test.ts`.

**Ledger inbox.** None.
- DW-554 is context only: tests use `{"global":{...}}`.

**Residual risks.**
- **Client timeout.** When `IRIS_SQL_TIMEOUT` expires on the client, IRIS keeps running. A capped DML within the cap still commits, as a DML through `action/query` does today.
- **Privileges at prepare.** `%Prepare(q, 0)` skips the prepare-time privilege check, exactly as `action/query` does today (execution-time checks remain; AD-15 parity).
- **Unknown profile keys.** `IRIS_PROFILES` silently ignores unknown keys (pre-existing), so a per-profile `sqlReadOnly` set there would do nothing. The docs state that both variables are global.

## Verification

Every command runs in the foreground with `timeout: 600000` from `/Users/jbrandt/git/iris-execute-mcp-v2`. IRIS is reached only through `default` (localhost:52773, HSCUSTOM).
- **Deploying the classes.** Load `Sql.cls`, `Dispatch.cls` and `BaseTest.cls` with `iris_doc_load` using a glob path (`/Users/jbrandt/git/iris-execute-mcp-v2/src/**/Sql.cls` and so on, Rule #17), then compile.
- **Live writes.** They go only to:
  - `ExecuteMCPv2.Temp.QaStory385Gate.cls`: persistent and compiled, with the probe-6 column kinds, a DELETE trigger, side-effect and transaction-ending `SqlProc` functions, and a `SqlProc` class query.
  - `ExecuteMCPv2.Temp.QaStory385GateAudit.cls`;
  - their storage globals and `^ExecuteMCPv2.Temp.QaStory385GateC`.

  All are removed before and after: `%KillExtent`, then a kill of every `ExecuteMCPv*` global containing `QaStory385Gate` (the stream global survives `%KillExtent`), then `removeStored`.
- **OS %UnitTest.** `ExecuteMCPv2.Tests.BaseTest` runs alone, in one `iris_execute_tests` call, and `total` must be 7 (Rule #35). Poll `iris_test_status` on a client timeout; never re-submit.
- **Build order.** Shared, then dev, then `iris-mcp-all` (dist imports, `checkDistFresh`).

**Shared surfaces:**
- the dev tool array, order and counts, and the suite totals (the files in the Code Map count pins);
- the dev `core`/`developer` rosters;
- the `REFUSAL_CODES` key set;
- the `default-enabled-holders` parent map;
- the bootstrap manifest and rosters, `BOOTSTRAP_VERSION`, and the `BaseTest` handler count;
- the `IrisConnectionConfig` shape (`config.test.ts` exact `toEqual`);
- the `iris_sql_execute` request pins;
- the dev `gateTestFiles`;
- the documented counts and payload table;
- the `CHANGELOG.md` top section (the 38.x doc-claims tests locate sections by regex);
- the live `governance-file-process-gate` `SELECT 1`.

Standing criterion: every test added or changed passes on a fresh environment, in either order.

**Commands:**
- `(loop)` `pnpm --filter @iris-mcp/shared build && pnpm --filter @iris-mcp/shared exec vitest run src/__tests__/config.test.ts src/__tests__/profiles.test.ts src/__tests__/refusals.test.ts src/__tests__/bootstrap.test.ts src/__tests__/tool-visibility-backcompat.test.ts src/__tests__/tool-visibility.test.ts src/__tests__/governance-cli-universe.test.ts` -- expected: pass.
- `(loop)` `pnpm --filter @iris-mcp/dev build && pnpm --filter @iris-mcp/dev exec vitest run src/__tests__/sql.test.ts src/__tests__/sql-caps.test.ts src/__tests__/sql-safety.test.ts src/__tests__/sql-query-governance.test.ts src/__tests__/index.test.ts src/__tests__/presets.test.ts src/__tests__/presets.e2e.test.ts` -- expected: pass.
- `(loop)` `IRIS_HOST=localhost IRIS_PORT=52773 IRIS_NAMESPACE=HSCUSTOM IRIS_USERNAME=_SYSTEM IRIS_PASSWORD=SYS IRIS_HTTPS=false IRIS_REQUIRE_LIVE=1 pnpm --filter @iris-mcp/dev exec vitest run --no-file-parallelism src/__tests__/sql-safety-live-gate.test.ts` -- expected: all pass, none skipped.
- `(loop)` `iris_execute_tests` `ExecuteMCPv2.Tests.BaseTest` (`server:"default"`, `namespace:"HSCUSTOM"`) -- expected: 7/7, `total` 7.
- `(loop)` `pnpm --filter @iris-mcp/all exec vitest run src/__tests__/default-enabled-holders.test.ts src/__tests__/live-gate-roster.test.ts src/__tests__/story-38-3-qa-doc-claims.test.ts src/__tests__/tool-visibility-snapshot-drift.test.ts src/__tests__/docs-visibility-roster-sync.test.ts src/__tests__/docs-prompt-sync.test.ts src/__tests__/readonly-hint-crosscheck.test.ts src/__tests__/measure-tools-payload.test.ts` -- expected: pass.
- `(once)` One command per package, each running `build`, then `test`, `lint` and `type-check` where defined. The packages are shared, dev, admin, interop, ops, data and client-config, followed by `pnpm --filter @iris-mcp/all test` (35-1-DEV-1). Expected: green.
- `(once)` The armed `governance-file-process-gate` (same `IRIS_*` variables plus `IRIS_REQUIRE_LIVE=1`): `pnpm --filter @iris-mcp/all exec vitest run src/__tests__/governance-file-process-gate.test.ts` -- expected: pass.
- `(once)` `pnpm gen:governance-baseline:check` -- expected: exit 0 at `1e62c5ad5bf7`/141.
- `(once)` `pnpm gen:bootstrap` a second time, then `git diff --stat -- packages/shared/src/bootstrap-classes.ts` -- expected: unchanged by the second run. Record `BOOTSTRAP_VERSION` from -> to.
- `(once)` `pnpm measure:tools-payload` after the dists are rebuilt -- expected: the README table matches.
- `(once)` `git diff --stat 61cdb551279fcfe8f9d5e6356b907687731eb384 -- packages/shared/src/governance-baseline.ts packages/shared/src/baseline-classifications.ts ipm/module.xml` -- expected: empty.
- `(once)` `iris_doc_list` (`generated:true`) and `iris_global_list` with the filter `QaStory385` (`server:"default"`, `namespace:"HSCUSTOM"`) -- expected: empty.

**Planned mutations (Rule 19).** For each one, apply it, observe red, revert, rebuild any dist it touched, and check that `git status --short` and `git diff --stat` are unchanged. Record each result as `mutation: ... -> ...`.

| AC | Mutation | Expected red |
|---|---|---|
| AC-2 | the IRIS read-only check skipped | live read-only `UPDATE` row (values changed) |
| AC-2 | `runSql` lets `readOnly:false` override `sqlReadOnly` | `sql-safety` operator rows; live operator row |
| AC-2 | read path commits instead of rolling back | live side-effect row |
| AC-3 | the `%ROWCOUNT` check skipped | live over-cap DELETE (rows gone) |
| AC-3 | a negative count treated as within the cap | live TRUNCATE row |
| AC-3 | the cap allowlist removed (CALL runs) | `sql-safety` not-countable rows; live CALL-under-cap row |
| AC-3 | the cap is `max` instead of `min` | `sql-safety` ceiling rows |
| AC-4 | `rowsAffected` dropped | `sql-safety` DML rows; live default-DML row |
| AC-4 | `countOnly` returns the serialized rows | live count row (rows transferred) and unit pin |
| AC-5 | the serializer maps a NULL number to `""` | live serializer pin |
| AC-5 | explicit defaults omitted from E | `sql.test.ts` request pins |
| AC-6 | `parent` removed from `sqlQueryTool` | `sql-query-governance` inherited rows, `default-enabled-holders` |
| AC-6 | `mutates: "write"` on `sqlQueryTool` | read-only preset row, defaults row |
| AC-6 | `iris_sql_query` dropped from `core` | `presets.test.ts` |
| AC-7 | TE detection removed | live transaction-ending row |
| AC-8 | `Sql.cls` left out of `classes[]` | `bootstrap.test.ts` roster and drift rows |

## Auto Run Result

Status: ready-for-dev
Blocking condition: none

**Planning pass (2026-10-15).** The plan was halted after planning, as the invocation directed. The spec meets the READY FOR DEVELOPMENT standard.
- **Probes.** The AC 38.5.1 probes ran at plan time on `default`/HSCUSTOM (IRIS 2026.2 build 221U), using disposable `ExecuteMCPv2.Temp.QaStory385*` classes and globals. All were removed, and the listings for `QaStory385` (documents with `generated`, and globals) are empty.
- **For the lead.** Two orchestrator decisions are recorded under Design Notes: the default-path route move, and the cap allowlist. There are also seven plan-time interpretations, including `totalCount` already existing on `iris_production_adapters` with the same meaning.
- **Ledger inbox.** None.
