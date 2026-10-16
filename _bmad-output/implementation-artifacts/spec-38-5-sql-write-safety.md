---
title: 'Story 38.5: SQL Write Safety'
type: 'feature'
created: '2026-10-15'
status: 'in-progress'
baseline_revision: '4eb8ad43e65d95a8670357920af533a473a7d89b'
baseline_commit: '4eb8ad43e65d95a8670357920af533a473a7d89b'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/.claude/rules/project-rules.md'
  - '{project-root}/.claude/rules/iris-objectscript-basics.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-iris-execute-mcp-v2-2026-10-14/ARCHITECTURE-SPINE.md'
warnings:
  - oversized
deferred:
  - summary: >-
      Other tools still send a model to iris_sql_execute for read-only queries, which the read-only preset blocks; iris_sql_query is the working route.
    evidence: |-
      The iris_execute_tests description and hint (packages/iris-dev-mcp/src/tools/execute.ts, near lines 396 and 1226), the deploy-and-test-class prompt (src/prompts/deployAndTestClass.ts) and skills/deploy-and-test-class/SKILL.md give a %UnitTest_Result join through iris_sql_execute. Under IRIS_GOVERNANCE_PRESET=read-only that tool is denied. The files predate this story and the intent leaves other tools unchanged.
    location: >-
      packages/iris-dev-mcp/src/tools/execute.ts; packages/iris-dev-mcp/src/prompts/deployAndTestClass.ts; skills/deploy-and-test-class/SKILL.md
    severity: low
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
  - No keyword matching in the safety path, with ONE refuse-only exception. Under a rows-affected cap (the caller's `maxRowsAffected` or the operator's `IRIS_SQL_MAX_ROWS_AFFECTED`), a statement of type 2, 3 or 4 whose text contains the `%NOJOURN` token, matched case-insensitively at word boundaries, is refused with `SQL_ROWS_AFFECTED_CAP` before it runs, and it writes nothing. A false positive, such as `%NOJOURN` in a comment or a string, can only refuse; it can never let a write through. *(Amended 2026-10-16 by the lead, Rule 5, orchestrator decision #14: `%NOJOURN` turns journaling off, so the cap's rollback cannot undo the write, and IRIS gives no parse-level signal for it.)*
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

### Review Findings

Code review 2026-10-16 (bmad-code-review, review tier `full-opus`). All four layers delivered: blind-hunter, edge-case-hunter, verification-gap and acceptance-auditor. Diff: `4eb8ad4..HEAD` plus the working tree and QA's two untracked files; `_bmad-output/` and the Lead-directed `project-rules.md` line were excluded. 36 raw findings became 13 entries: 2 high, 6 medium and 5 low, plus 18 rejected. Live probes ran on `default`/HSCUSTOM against disposable `ExecuteMCPv2.Temp.Cr385*`, which were removed afterwards. The story returns to `in-progress` because of the two HIGH entries.

- [ ] [Review] **DECIDED (orchestrator decision #14, 2026-10-16). Implement the refuse-only `%NOJOURN` check under a cap exactly as the amended Never bullet states, in `Sql.cls`, before execution. Refusal text: the statement asks IRIS not to journal its writes, so a rows-affected cap cannot undo them. Pin it with a live test (a capped `DELETE %NOJOURN` on a disposable `ExecuteMCPv2.Temp.QaStory385*` table is refused, and the row count is unchanged; the same statement with no cap runs) and a `mutation:` line. Regenerate the bootstrap (Rule #24). The finding follows.** HIGH: `%NOJOURN` DML under a cap is not undone, so the cap and the operator ceiling fail open and the refusal says otherwise.** [src/ExecuteMCPv2/REST/Sql.cls:196-236]
  - Source: edge-case-hunter. Fix-risk: med (an IRIS-side refusal path plus a spec amendment). Footprint: in-story.
  - Live evidence: `DELETE %NOJOURN FROM ExecuteMCPv2_Temp.Cr385` with `maxRowsAffected: 0` returned `outcome: "overCap"`, `rowsAffected: 3`, and the tool text says "Its row changes were undone". The table then held 0 rows. `%NOJOURN` turns off journaling and transactions for the statement, so the endpoint's `TROLLBACK` has nothing to undo.
  - `%GetImplementationDetails` returns the raw text and the cached-query source is not kept, so there is no parse-level signal to use.
  - **Lead decision needed before the rework.** The spec's Never says "No keyword matching anywhere in the safety path", so any fix needs a Rule 5 amendment.
  - Recommendation: under a cap, refuse a type 2-4 statement whose text contains the `%NOJOURN` token before it runs, with `SQL_ROWS_AFFECTED_CAP`. This is a refuse-only check, so a false positive can only refuse, never let a write through. Pin it with a live over-cap `%NOJOURN` DELETE that leaves the rows intact.
  - Read-only mode is not affected: DML is refused there by statement type. A function's own `%NOJOURN` writes are now listed among the residual effects (patch 2 below).
- [x] [Review] **RESOLVED by the lead, 2026-10-16 (orchestrator decision #15): the spine's AD-25 "Caps" and the decision #13 record were amended. TRUNCATE (type 4) runs inside the capped transaction and is rolled back on its -1 count. There is no code change. The finding follows.** HIGH (Rule 6, AD mismatch): AD-25 "Caps" and orchestrator decision #13 say TRUNCATE is "refused before execution"; the spec and the code run it as statement type 4 and roll it back.** [_bmad-output/planning-artifacts/architecture/architecture-iris-execute-mcp-v2-2026-10-14/ARCHITECTURE-SPINE.md AD-25; src/ExecuteMCPv2/REST/Sql.cls:254]
  - Source: acceptance-auditor. Fix-risk: low (wording). Footprint: the spine, which is the lead's to amend.
  - The code follows AC-3 ("or an unknown number, then it is rolled back") and the Cap-unknown matrix row. Live, a capped `TRUNCATE TABLE` on a table with no triggers came back `overCap` with `rowsAffected: -1` and all 3 rows intact, so the behavior fails safe.
  - Refusing TRUNCATE before execution would need keyword matching, because TRUNCATE and DELETE are both type 4.
  - Recommendation (Rule 20 light path): amend AD-25 and the decision #13 record to say TRUNCATE (type 4) runs inside the capped transaction and is rolled back on its -1 count. If the lead instead wants a refusal before it runs, that needs the same keyword exception as the `%NOJOURN` entry above.
  - No code change is needed if the AD is amended.
- [x] [Review][Patch] **MED: a transaction change was not reported when the statement then failed.** [src/ExecuteMCPv2/REST/Sql.cls:224-247]
  - Source: acceptance-auditor. Fix-risk: med (IRIS-side). Footprint: in-story.
  - Live evidence: through the read-only route, `SELECT EndTx(ID), 1/(Code-2) ...` committed the function's writes `G(1)` and `G(2)`, and the caller got a plain `SQL error: ... SQLCODE: -400` with no "some changes may be saved".
  - Fixed: `Perform` now checks the level after the Try/Catch, so `transactionEnded` wins over an execution error. A probe confirmed that a failing capped DML leaves `$TLEVEL` at the opened level, so ordinary SQL errors do not trip the check.
  - Two new live tests cover the capped and read-only paths. Redeployed; `BOOTSTRAP_VERSION` `f757473a71d8` -> `e615a96a1e70` (Rule #24; idempotent), recorded in the CHANGELOG and the changeset.
- [x] [Review][Patch] **MED: the residual-effects disclosure was incomplete and over-claimed.** [packages/iris-dev-mcp/src/tools/sql.ts:41]
  - Source: acceptance-auditor and edge-case-hunter. Fix-risk: low. Footprint: in-story.
  - Live evidence: `SELECT Mark(ID) FROM %PARALLEL T` through the read-only route ran the function in worker job 978640 at `$TLEVEL` 0, and its journaled sets persisted.
  - What was wrong:
    - the list left out parallel-query workers, `%NOJOURN` writes and "other external effects";
    - it said a transaction change "is reported as an error", but a commit followed by a new `TSTART` is not seen;
    - it was stated only for read-only mode, though a capped statement that is rolled back leaves the same effects.
  - Fixed in `RESIDUAL_EFFECTS` and the `iris_sql_execute` description. The same text is mirrored in the root README, the dev README (2 places) and the CHANGELOG, and the `sql-safety.test.ts` pins were extended. The payload was re-measured (dev 83,611 / 42,785).
- [x] [Review][Patch] **MED (Rule 19 hermeticity): each live gate's cleanup `it()` deleted the shared fixtures, so it had to run last.** [packages/iris-dev-mcp/src/__tests__/sql-safety-live-gate.test.ts:357; packages/iris-mcp-all/src/__tests__/story-38-5-qa-sql-wire-gate.test.ts]
  - Source: verification-gap. Fix-risk: low. Footprint: in-story.
  - Fixed: in the dev gate the assertions moved into `afterAll` and the `it()` was removed. In the wire gate the redundant `it()` was removed; its `afterAll` already asserts.
  - AC-7's "nothing remains" stays pinned (mutation under Verification). The same pattern in the 38.3 and 38.4 gates is DW-556.
- [x] [Review][Patch] **MED (Rule 19 hermeticity): the governance wire-body test depended on the shell leaving `IRIS_SQL_MAX_ROWS` unset.** [packages/iris-dev-mcp/src/__tests__/sql-query-governance.test.ts:64]
  - Source: verification-gap. Fix-risk: low. Footprint: in-story.
  - The layer showed the test red with `IRIS_SQL_MAX_ROWS=500`. `IRIS_SQL_MAX_ROWS` and `IRIS_SQL_TIMEOUT` were added to `CLEARED_ENV`, and the suite now passes with both set.
- [x] [Review][Patch] **MED (Rule 19 falsifiability): the serializer pin did not compare the values of a CALL's second result set.** [packages/iris-dev-mcp/src/__tests__/sql-safety-live-gate.test.ts:447]
  - Source: blind-hunter. Fix-risk: low. Footprint: in-story.
  - `todayMapping` keys every row by the first set's columns, so the `N` row became `[undefined, undefined]` on both sides.
  - Added a raw endpoint-against-Atelier comparison for `CALL TwoSets()`; its mutation is recorded under Verification.
- [x] [Review][Patch] **LOW (Rule #54): some fakes returned shapes the endpoint cannot produce.**
  - Source: blind-hunter and verification-gap. Fix-risk: low. Footprint: in-story.
  - The QA `overCap` fakes carried `content: []`; the live `overCap` result has none. [story-38-5-qa-doc-claims.test.ts:262,378]
  - The `sql-safety.test.ts` CALL fake used numeric values, but CALL columns come back as strings. [sql-safety.test.ts:100]
- [x] [Review][Patch] **LOW: the README said `iris_sql_query` "is disabled only when" `iris_sql_execute` is disabled; an explicit `iris_sql_query:false` disables it too.** [README.md:443]
  - Source: blind-hunter. Fix-risk: low. Footprint: in-story.
- [x] [Review][Patch] **LOW: the user docs did not say that a SQL call to another namespace now depends on the bootstrap's `%All` package mapping.** [README.md:580]
  - Source: blind-hunter and acceptance-auditor. Fix-risk: low. Footprint: in-story.
  - Before this story, Atelier `action/query` did not need the mapping. One sentence was added to Backward Compatibility.
- [x] [Review][Patch] **LOW: live test titles claimed a restored level or namespace "for the next call", which a separate HTTP request cannot observe (the spec's "Not claimed").** [sql-safety-live-gate.test.ts; story-38-5-qa-sql-wire-gate.test.ts]
  - Source: verification-gap. Fix-risk: low. Footprint: in-story.
  - Six titles and one comment were retitled; the assertions are unchanged.
- [x] [Review][Defer] **MED: the 38.3 and 38.4 live gates keep the same order-dependent cleanup `it()`.** [doc-edit-live-gate.test.ts; doc-put-storage-guard-live-gate.test.ts]
  - Deferred as DW-556: `routed owner=burndown`, fix-risk low, footprint in-epic (those stories are past review).
- [x] [Review][Defer] **LOW (Rule 2, weak reason): the kill-by-stem cleanup loop is copied from the 38.3 and 38.4 gates.** [sql-safety-live-gate.test.ts:243-257]
  - DW-557, `wontfix-accepted`, `reopen_if` a fourth gate copies the loop or the loop's behavior must change in more than one file. The spec named the sibling to follow, and the iris-mcp-all wire gate cannot import dev test helpers.

**Rejected (18).**
- `by-design` BH-1: the TRUNCATE `overCap` text and remedy are fixed by the intent contract's CAP texts. This was adjudicated as BH1 in the build review.
- `by-design` BH-2: under a cap a `SELECT fn()` that writes is not bounded. Decision #13 lets SELECT run, and the description says "a SELECT is not bounded by it".
- `by-design` BH-3: `SanitizeError` strips `+N^routine` locations. The spec requires `SanitizeError` (Rule #9), and decision #12's condition (SQLCODE and message kept) holds.
- `low` BH-4: refusals are audited as `error`, carrying their text. `denied` is reserved for governance by the audit design (`server-base.ts`, untouched), and the fix would add branches.
- `wontfix-theoretical` BH-6: `$$GetTypen^%SYS.SQLSRV` has no Try. It would be real on an IRIS version without that label; AC 38.5.1 records 2026.2 as the earliest version verified.
- `low` BH-8: "Use maxRows to limit result set size" is the pre-existing wording, and the shared sentence already says the row cap is post-fetch.
- `low` BH-11: there is no live INSERT-over-cap test, but it shares the DELETE and UPDATE path that is pinned.
- `by-design` EC-1/EC-9: `TCOMMIT` followed by `TSTART` leaves `$TLEVEL` equal. The spec fixes the equality check and AD-25 lists the residual; the description's over-claim was corrected (patch 2).
- `false` EC-4: an empty `%ROWCOUNT` was disproved live (EC2 in the build review); it is numeric for every capped type.
- `false` EC-5: a request entering at `$TLEVEL` > 0 was disproved by a probe (EC3 in the build review); IRIS ends an open transaction with the request.
- `by-design` EC-6/VG-O3: `z.coerce` turns `null` or `""` into a cap of 0. The schema is spec-fixed and the result fails safe.
- `false` EC-7: an unknown outcome cannot occur, because the route's outcome set is closed (Rule #54).
- `false` EC-8: a throwing `TROLLBACK` is caught by `Run`'s Try/Catch.
- `false` VG-4: Rule 19 asks for one mutation per AC, not per clause, and every AC has one.
- `by-design` VG-O2: the `sqlAnalyze.ts` comments; the intent excludes `iris_sql_analyze`.
- `false` AA-4: a row-level fetch error was probed live (`1/(Code-2)`) and comes back as `SQLCODE -400` with no partial rows, on read-only, default and `countOnly`.
- `low` AA-5: the `{a: null}` legacy fake is a pre-existing AD-15 back-compat case; changing it would weaken that pin.
- `low` AA-6: the QA wire gate's `QaStory385Wire` fixtures are disposable `Temp` classes it removes, and the `QaStory385` emptiness listing covers them.

## Spec Change Log

### 2026-10-16: rework iteration 1, opened by the lead after code review round 1 (2 HIGH)
- `%NOJOURN` cap bypass, decision #14. The Never bullet "No keyword matching" gains one refuse-only exception: under a cap, a type 2–4 statement carrying the `%NOJOURN` token is refused before it runs (Rule 5 amendment, inside the intent contract). The open `[Review]` item names the work.
- TRUNCATE wording, decision #15. The spine's AD-25 was amended to match this spec's AC-3 and the Cap-unknown row. There is no spec or code change.
- Scope of the rework (Rework re-dispatch): only the open `[Review]` item.

## Review Triage Log

### 2026-10-15 — Review pass
- verdicts: 38 findings — high 0, medium 8, low 23, false 7, maybe-false 0
- findings:
  - `[low]` `[reject]` BH1: the `overCap` remedy for `rowsAffected -1` (TRUNCATE) offers "raise maxRowsAffected", which cannot help — real, but the remedy text is fixed in the intent contract's CAP texts (the fix edits the spec); the same message already says "an unknown number of rows (IRIS reports -1, as it does for TRUNCATE TABLE)".
  - `[low]` `[reject]` BH2: `TCOMMIT` then `TSTART` inside one function returns to the same `$TLEVEL`, so the equality check cannot see it — real but rare; the check and the TE text are spec-fixed (Always: "requires `$TLEVEL` to equal the level it opened"), and the Design Notes residual list already names functions that start or commit a transaction.
  - `[medium]` `[patch]` BH3: the cap counts only the statement's own `%ROWCOUNT` (trigger and cascade rows are not counted, a SELECT is not bounded), and no description says so — patched: one sentence in the `iris_sql_execute` description, root README cap row, dev README paragraph and CHANGELOG; the README payload rows were re-measured (dev 83,131 / 42,305).
  - `[low]` `[patch]` BH4: `iris_sql_query` carries `readOnlyHint` while its README read-only-preset paragraph omitted the residual effects (the live gate shows a `$INCREMENT` moving) — patched: the paragraph now says "statement-level read-only, not side-effect-free" and points at the list; the annotations are fixed by the spec and stay.
  - `[medium]` `[patch]` BH5 (same root cause as VG2, IA5): no test passed a namespace other than the web app's, so dropping the `SwitchNamespace` could not turn anything red — patched: live tests run both tools in `%SYS` (oracle: `Security.Users` exists only there, asserted to differ), an error in `%SYS` followed by a call back in the home namespace, and refusals naming `%SYS`; `bootstrap.ts` comments now name SQL among the calls that depend on the `%All` package mapping.
  - `[low]` `[reject]` BH6: `z.coerce.number()` turns `null`/`""`/`false` into a cap of 0 — the schema is spec-fixed, and the result fails safe (a refusal naming "cap of 0 (from maxRowsAffected)", nothing changed); a non-safe integer such as 1e30 reaches the IRIS-side check and is refused.
  - `[medium]` `[patch]` BH7 (same root cause as IA7): `loadConfig`, `mergeProfile` and `runSql` were each tested, but nothing followed an environment variable to the request body — patched: `sql-query-governance.test.ts` drives `IRIS_SQL_READ_ONLY=true` and `IRIS_SQL_MAX_ROWS_AFFECTED=2` through the real `McpServerBase`, the real tools and a mocked `fetch`, and asserts the POST body (and the explicit defaults with neither set).
  - `[low]` `[patch]` BH8 (with EC6): stale text left by the route move — patched the root README `IRIS_SQL_MAX_ROWS` and `IRIS_SQL_TIMEOUT` rows (both tools) and the `test-status.ts` comment; the `sqlAnalyze.ts` comments stay (the intent excludes `iris_sql_analyze`), and the three client-config guides are Story 38.6's per the Seam.
  - `[low]` `[defer]` BH9: `iris_execute_tests` hints, the `deploy-and-test-class` prompt and its skill send a model to `iris_sql_execute` for a `%UnitTest_Result` query, which the read-only preset blocks — pre-existing, outside this change's files (recorded under `deferred:`).
  - `[low]` `[reject]` BH10: `RESIDUAL_EFFECTS` and the row-cap sentence are in both descriptions and `core` grows ~14% — the spec requires both descriptions to carry them, and the payload table was re-measured.
  - `[false]` `[reject]` EC1: an outcome outside the endpoint's six values reaches `default: break` — the route is ours and its outcome set is closed (Rule #54); a stale or missing route is a 404, which the `SQL error:` catch reports.
  - `[false]` `[reject]` EC2: an empty `%ROWCOUNT` would pass every cap — live, `%ROWCOUNT` is numeric for every capped type (INSERT, INSERT ... SELECT, UPDATE, DELETE and TRUNCATE -1 are all in the gate), so the state is not shown to be reachable.
  - `[false]` `[reject]` EC3: a transaction already open on entry would make `TCOMMIT` commit only the inner level — probed live: a function that leaves `TSTART` open (job 1114) is back at `$TLEVEL` 0 on the next request, and every request ran in the same job, so IRIS ends an open transaction with the request and no call enters at a level above 0.
  - `[low]` `[reject]` EC4: a client timeout can leave a capped DML to commit server-side — recorded in the spec's Residual risks ("Client timeout") as the same behavior `action/query` has today.
  - `[low]` `[patch]` EC5: the `tools.integration.test.ts` invalid-SQL case passed on any `SQL error`, a missing route included — patched: it also requires `SQLCODE: -30`.
  - `[low]` `[patch]` EC6 (with BH8): stale `iris_sql_execute` route comments — see BH8.
  - `[low]` `[reject]` EC7: the client-config guides omit the two variables — Story 38.6 owns client-config docs (Seam); the READMEs state both with defaults (AC-5).
  - `[medium]` `[patch]` VG1 (same root cause as IA4): no live case for a statement that prepares and then fails to run, on any path — patched: a type-mismatch UPDATE (SQLCODE -105) on the default and capped paths and `SELECT 1/0` (-400) through `iris_sql_query` each give an error with the SQLCODE and message from the new route, and the rows are unchanged.
  - `[medium]` `[patch]` VG2: see BH5.
  - `[low]` `[patch]` VG3 (same root cause as IA2): the TE tests only covered a function that commits — patched: a new `OpenTx` fixture function (`TSTART`, leaves it open) is reported on the capped and the read-only path. The unwinding loop in `RollBackTo` is not observable across requests (probe in EC3: IRIS ends the open transaction itself), so no mutation of it is claimed.
  - `[low]` `[patch]` VG4: a refusal with `readOnly:true` and `IRIS_SQL_READ_ONLY` both in force was not asserted — patched: a mock test pins `readOnlySource: "operator"` and the operator remedy.
  - `[low]` `[patch]` VG5: the `sql-safety.test.ts` row titled for DML under a caller cap only exercised a SELECT — patched: it now also asserts a DELETE under a caller cap carries no `maxRowsAffectedCapped`.
  - `[false]` `[reject]` VG6: the serializer pins have no non-empty guard of their own — the "oracle is not vacuous" live test asserts the fixture rows carry values of every kind, and the endpoint-vs-Atelier test asserts `SEEDED_ROWS` rows.
  - `[low]` `[reject]` VG7: `ExecuteMCPv2.REST.Sql` has no `ExecuteMCPv2.Tests.*` host — the spec's test strategy is the armed live gate in the prepublish roster plus the `BaseTest` count; `SqlAdvisor`'s `AdvisorDataTest` is a precedent, not a requirement.
  - `[false]` `[reject]` VG8: sub-claims (config/profile inheritance, cap-within commits, device output, AC-6 counts, AC-8 count) lack their own `mutation:` line — Rule 19 asks one demonstrated mutation per AC, and AC-2 to AC-8 each carry one; a `config.ts` mutation was added anyway for the new env-to-wire test.
  - `[low]` `[reject]` VG9: the live gate does not check that the deployed `Sql.cls` is the embedded one — a missing route fails every case loudly (404 `SQL error`), and a stale-but-compatible class would pass; the sibling gates have no version probe either.
  - `[low]` `[reject]` VG10: the `cleanup` test runs last and calls `removeFixtures()` itself — it follows the 38.3 gate the spec names; `afterAll` and the opening `removeFixtures()` run regardless.
  - `[false]` `[reject]` VG11: the serializer `describe`'s `beforeAll` reseed is correct only while every test in it is read-only — the reviewer states it is correct as written.
  - `[low]` `[reject]` VG12: every call now needs `$$GetTypen^%SYS.SQLSRV` and `%Metadata.statementType`, verified only on 2026.2 build 221U — AC 38.5.1 records that as the earliest version verified.
  - `[low]` `[patch]` IA1: the endpoint's own input checks (empty query, non-integer or negative `maxRowsAffected`, non-boolean flags, non-array `parameters`) were driven by no test — patched: live raw POSTs assert each rejection, plus a nonexistent namespace followed by a clean call.
  - `[low]` `[patch]` IA2: see VG3.
  - `[low]` `[reject]` IA3: INSERT and COMMIT under read-only are covered only with mocked responses — the live gate refuses UPDATE, DELETE, CALL, DDL and a CTE-wrapped DELETE, and the new namespace test refuses COMMIT live; the mock rows pin the mapping.
  - `[medium]` `[patch]` IA4: see VG1.
  - `[medium]` `[patch]` IA5: see BH5.
  - `[low]` `[reject]` IA6: the live gate is not tied to the source file — see VG9.
  - `[medium]` `[patch]` IA7: see BH7.
  - `[false]` `[reject]` IA8: the governance suite never reaches the endpoint and bootstrap tests pin roster and content only — no divergence: governance is proven through the real gate with handler spies by design, and the endpoint is proven by the live gate.
  - `[low]` `[patch]` IA9: `tools.integration.test.ts` keeps two live `iris_sql_execute` cases outside the default suite, and `execute.ts` prose still names the tool — the integration case is tightened (EC5); the prose is BH9.

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
  - `ExecuteMCPv2.Temp.QaStory385Gate.cls`: persistent and compiled, with the probe-6 column kinds, a DELETE trigger, side-effect, transaction-ending, device-output, `$TLEVEL` and writing `SqlProc` functions, a `SqlProc` class query and a two-result-set procedure.
  - `ExecuteMCPv2.Temp.QaStory385GateAudit.cls`, with `Parameter DEFAULTGLOBAL = "^ExecuteMCPv2.QaStory385GateAud"`;
  - their storage globals and the counter and marker globals `^ExecuteMCPv2.QaStory385GateC` and `^ExecuteMCPv2.QaStory385GateG`.

  [Amended during implementation, Rule #16: a global name is unique only to its first 31 characters, so the planned `^ExecuteMCPv2.Temp.QaStory385GateC` (33 characters) is stored as `^ExecuteMCPv2.Temp.QaStory385Gat`, collides with any sibling, and no longer contains the stem. The audit class's default storage global is hashed to `^ExecuteMCPvE4F.QaStory385GF692D`, which does not contain `QaStory385Gate` either. The names above all start `ExecuteMCPv` and contain the stem.]

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

**Mutations demonstrated (Rule 19).** Each was applied, observed red, and reverted; the tree was byte-identical afterwards (`git status --short` and a hash of the diff and the untracked files unchanged, `Sql.cls` re-checked against a pristine copy and reloaded). IRIS-side mutations were loaded into `default`/HSCUSTOM and driven through `sql-safety-live-gate.test.ts`.
- AC-2: mutation: `Decline`'s read-only line removed from `Sql.cls` -> live `readOnly refuses an UPDATE and the values are unchanged` red (the UPDATE ran in the rolled-back transaction, so values held, but the refusal was missing).
- AC-2: mutation: `runSql` lets `readOnly:false` override `sqlReadOnly` (`args.readOnly ?? operatorReadOnly`) -> `sql-safety.test.ts` `IRIS_SQL_READ_ONLY forces read-only when readOnly is omitted or false...` and `a refusal under IRIS_SQL_READ_ONLY has readOnlySource operator...` red; live `ctx.config.sqlReadOnly refuses an UPDATE and a DELETE even when readOnly:false is passed` red.
- AC-2: mutation: `Perform` commits (`TCOMMIT`) instead of rolling back at exit -> live `a SELECT that calls a function has its SQL write and its journaled global set undone, and its counter not` red (the audit row stayed: 1, expected 0).
- AC-2: mutation: `iris_sql_query` not forced read-only (`args.readOnly === true || operatorReadOnly`) -> `sql-safety.test.ts` `iris_sql_query ... is always read-only` red.
- AC-3: mutation: the `%ROWCOUNT` check skipped (`If 0 {`) -> live `a DELETE over the cap, by parameter...`, `a DELETE over the operator ceiling...`, `maxRowsAffected 0 is a dry count...` and `TRUNCATE TABLE under a cap...` red (the rows were committed).
- AC-3: mutation: a negative count treated as within the cap (`If tRowsAffected > pCap {`) -> live `TRUNCATE TABLE under a cap reports -1 and is rolled back...` red.
- AC-3: mutation: the cap allowlist removed (`capNotCountable` line deleted from `Decline`) -> live `a CALL under a cap is refused before it runs...` and `DDL under a cap is refused before it runs` red. The `sql-safety.test.ts` not-countable rows pin the TypeScript mapping of the endpoint's outcome and cannot see an IRIS-side change.
- AC-3: mutation: the cap is `Math.max` instead of `Math.min` -> `sql-safety.test.ts` ceiling rows (5 tests, among them `a larger maxRowsAffected cannot raise it...`) red.
- AC-4: mutation: the `rowsAffected` spread removed from `runSql` -> `sql-safety.test.ts` DML rows (6 tests) red; live `a default-path UPDATE reports the rowsAffected...`, `...INSERT ... SELECT...` and `...DELETE commits...` red.
- AC-4: mutation: `countOnly` returns the serialized rows (`Serialize` in the `pCountOnly` branch) -> live `iris_sql_execute: totalCount equals the COUNT(*)...` and the `iris_sql_query` twin red (rows transferred).
- AC-5: mutation: the serializer maps a NULL number to `""` (a `pValue = ""` string branch in `SetValue`) -> live serializer pins (`the fixture SELECT of every column kind`, `SELECT *`, `a qualified star after a column`, ...) red.
- AC-5: mutation: an explicit default omitted from E (`body.countOnly` removed) -> `sql.test.ts` request pins (7) and `sql-caps.test.ts` (4) red.
- AC-5: mutation: a spurious `totalCount` on every result -> every `sql.test.ts` pre-feature literal row (AD-15) red.
- AC-6: mutation: `parent` removed from `sqlQueryTool` -> `sql-query-governance.test.ts` (10 tests) and `default-enabled-holders.test.ts` `the parent declarations are exactly...` red.
- AC-6: mutation: `mutates: "write"` on `sqlQueryTool` -> `sql-query-governance.test.ts` (6 tests: defaults, read-only preset, profile-scoped, first-explicit-verdict) red.
- AC-6: mutation: `iris_sql_query` moved from `core.include` to `core.exclude` -> `presets.test.ts` (3 tests) red.
- AC-7: mutation: the transaction-level (TE) check removed from `Perform` -> live `a function that ends the transaction of a capped UPDATE is reported...` and `a SELECT whose function ends the transaction is reported...` red.
- AC-8: mutation: `Sql.cls` left out of `scripts/gen-bootstrap.mjs` `classes[]` (then `pnpm gen:bootstrap`) -> `bootstrap.test.ts` (7 tests: count, names, order, Sql entry, drift rows) red.

**Mutations demonstrated in the review pass (Rule 19).** Same discipline: `Sql.cls` and `sql.ts` / `config.ts` restored from pristine copies (`shasum` equal), `Sql.cls` reloaded.
- AC-2/AC-3: mutation: the `If tRS.%SQLCODE < 0 {...}` block removed from `Perform` -> live `a statement that prepares and then fails to run...` red in all 3 tests (default path and capped path report a clean result; the read-only `SELECT 1/0` loses its SQLCODE).
- AC-2/AC-3: mutation: the `SwitchNamespace` block removed from `Run` -> live `both tools answer for the namespace they name...` red (`%SYS` query answered for the home namespace).
- AC-7: mutation: the transaction-level check changed to `$TLevel < tOpenLevel` (a commit is seen, an opened transaction is not) -> live `a function that opens a transaction inside a capped UPDATE...` and `a SELECT whose function opens a transaction...` red.
- AC-2/AC-3: mutation: the `maxRowsAffected` integer check removed from `ReadControls` -> live `the endpoint rejects a malformed body...` red for a non-integer and a negative cap.
- AC-2: mutation: `readOnlySource` derived from `readOnlyForced` -> `sql-safety.test.ts` `a refusal with readOnly:true and IRIS_SQL_READ_ONLY both in force names the operator as the source` red.
- AC-3: mutation: `maxRowsAffectedCapped` set whenever a cap applies (`capSource === "operator"` dropped) -> `sql-safety.test.ts` (3 tests, among them the retitled `an INSERT, UPDATE or DELETE under a caller cap has no maxRowsAffectedCapped...`) red.
- AC-2/AC-3: mutation: the `sqlReadOnly` spread removed from `loadConfig` (shared dist rebuilt) -> `sql-query-governance.test.ts` `IRIS_SQL_READ_ONLY=true and IRIS_SQL_MAX_ROWS_AFFECTED=2 decide readOnly and maxRowsAffected on the wire...` red.
- Not claimed: the one-level-at-a-time loop in `RollBackTo`. IRIS ends an open transaction with the request (probe: a function that left `TSTART` open was back at `$TLEVEL` 0 on the next request, same job), so no test can observe it.

**QA pass (2026-10-16): the operator variables on the real wire, and the docs held against the built tools.**
- **Gaps found.** (1) Every live check built its own `ToolContext` or mocked `fetch`: nothing followed `IRIS_SQL_READ_ONLY` / `IRIS_SQL_MAX_ROWS_AFFECTED` from an environment variable through the BUILT server, the SDK's argument parsing, the real governance gate and a profile to IRIS. (2) The contract's field order (`rowsAffected`, `totalCount`, `readOnlyForced`, `maxRowsAffectedCapped`; `rowsAffected` after `statementType` in a rolled-back refusal) was compared with `toEqual`, which ignores key order: reordering the result left all 119 dev SQL unit tests green. (3) AC-5's "the docs state both variables with their defaults", the Rule #30 default state, the README tables and examples and the changeset bumps had no pinning test. The implementation had no defect: every new test passed on its first run.
- **Files (QA).**
  - `packages/iris-mcp-all/src/__tests__/story-38-5-qa-sql-wire-gate.test.ts` (QA): 29 tests, armed by `IRIS_REQUIRE_LIVE`, listed in `packages/iris-mcp-all/scripts/prepublish-gate.mjs` `gateTestFiles` (the `live-gate-roster` guard). It spawns the built iris-dev-mcp dist, connects the real SDK `Client` over stdio, and writes only `ExecuteMCPv2.Temp.QaStory385Wire.cls` and its globals (`^ExecuteMCPv2.QaStory385WireD`, `...M`); the DDL probe's `QaStory385WireDdl` is never created because the refusal holds.
  - `packages/iris-mcp-all/src/__tests__/story-38-5-qa-doc-claims.test.ts` (QA): 17 tests in the default suite, no IRIS; fails (never skips) on a stale dist.
- **Gate proven on its own path.** Armed with a closed port (`IRIS_PORT=9`, `IRIS_REQUIRE_LIVE=1`) the wire gate fails with "may not be skipped"; unarmed it skips its live tests and still runs the four startup tests.
- **Mutations demonstrated (QA, Rule 19).** Each was applied, observed red, reverted, and the source compared byte for byte with a pristine copy (`cmp`; `git status --short` and a fingerprint of `git diff` plus the new files unchanged); the shared or dev dist was rebuilt after each revert.
  - AC-2: mutation: the `sqlReadOnly` spread removed from `loadConfig` (shared rebuilt) -> wire gate 4 red (`TRUE` refuses UPDATE..., the `readOnlyForced` SELECT, read-only and a cap together, the profile read-only case).
  - AC-2: mutation: `readOnly` becomes `args.readOnly ?? operatorReadOnly` in `runSql` -> wire gate `TRUE (any letter case) refuses UPDATE, DELETE, a CALL and DDL ... even with readOnly:false` red.
  - AC-2: mutation: the `sqlReadOnly` inheritance removed from `mergeProfile` -> wire gate `IRIS_SQL_READ_ONLY applies to the profile` red (the `qa385` UPDATE ran).
  - AC-2/AC-5: mutation: the `IRIS_SQL_READ_ONLY` validation removed from `loadConfig` -> wire gate `IRIS_SQL_READ_ONLY="yes" exits 1 with the variable's message` red.
  - AC-3: mutation: `sqlMaxRowsAffected` spread on truthiness (`0` treated as unset) -> wire gate `a ceiling of 0 is a real cap, not 'unset'` red.
  - AC-3: mutation: `Math.max` instead of `Math.min` for the cap -> wire gate `a DELETE over the ceiling is rolled back whatever maxRowsAffected the call passes` and `a caller's smaller cap wins, a cap of 0 included` red.
  - AC-3: mutation: the `sqlMaxRowsAffected` inheritance removed from `mergeProfile` -> wire gate `IRIS_SQL_MAX_ROWS_AFFECTED applies to the profile` red (the `qa385` DELETE emptied the table).
  - AC-4: mutation: `body.countOnly = false` -> wire gate 4 red (`countOnly equals the Atelier COUNT(*) ...`, `countOnly on a non-query runs nothing` (the DELETE ran), the forced-read-only count, the preset count).
  - AC-4: mutation: the four additive result fields reordered in `runSql` -> dev `sql.test.ts`, `sql-caps.test.ts`, `sql-safety.test.ts` and `sql-query-governance.test.ts` stay green (119 tests: the gap); wire gate `a DELETE within the ceiling commits ...` and the `readOnlyForced` count red; doc-claims `the additive result fields come in the documented order` red.
  - AC-5 (decision #12): mutation: the `SQL error:` text drops the IRIS message -> wire gate `a prepare error and an execution error carry the SQLCODE and the IRIS message` red.
  - AC-5 (docs): mutation: the README default cell of `IRIS_SQL_MAX_ROWS_AFFECTED` changed from `*(unset ...)*` to `*(default 100)*` -> doc-claims `each variable has an env-table row whose default is 'unset'` red.
  - AC-5 (docs): mutation: `countOnly?` dropped from the dev README `iris_sql_query` row -> doc-claims `each row's Key Parameters cell is the schema's parameter names` red.
  - AC-5 (docs): mutation: the README `iris_sql_execute` example output edited -> doc-claims `iris_sql_execute: the input block yields the output block` red.
  - AC-6: mutation: `parent` removed from `sqlQueryTool` -> wire gate 4 red (env inheritance, preset plus disable, the `IRIS_GOVERNANCE_FILE` layers, the CLI/server agreement).
  - AC-6: mutation: `mutates: "write"` on `sqlQueryTool` -> wire gate 9 red (tool listing and default verdict, reads, the read-only preset, `IRIS_TOOLS_DISABLE`).
  - AC-6 (docs): mutation: "`read` and **enabled by default**" removed from the `tool_support.md` row 31 -> doc-claims `iris_sql_query is a read ... every doc surface says it is enabled by default` red.
  - AD-29: mutation: the `@iris-mcp/dev` bump in the changeset changed to `patch` -> doc-claims `the changeset bumps exactly @iris-mcp/shared and @iris-mcp/dev, both minor` red.
  - AC-8 (Rule 8): mutation: the wire gate removed from `gateTestFiles` -> `live-gate-roster.test.ts` (`iris-mcp-all: every armed test file is in scripts/prepublish-gate.mjs gateTestFiles`) red.
  - Not repeated: the IRIS-side mutations (the shared instance runs the deployed `Sql.cls`; the build and review passes above already drove them through the live gate).

**Mutations demonstrated in the code review (2026-10-16, Rule 19).** IRIS-side mutations were loaded into `default`/HSCUSTOM and driven through the live gate. Each source was restored from a pristine copy (`cmp` identical), and the deployed `Sql.cls` was checked equal to the local file afterwards.
- AC-7: mutation: the post-Catch transaction-level check removed from `Perform` (the pre-review code) -> live `a function that ends the transaction of a capped UPDATE that then fails...` and `a SELECT whose function ends the transaction and that then fails...` red (both got `SQL error: ... SQLCODE: -400`).
- AC-5: mutation: `Serialize` names the columns of every result set after the first `c1`, `c2`, ... -> live `a CALL with two result sets: the endpoint's rows equal the Atelier rows key for key...` red. The mapped `iris_sql_execute: a CALL with two result sets (rows of both, in order)` stayed green, which is the gap.
- AC-7: mutation: `removeFixtures` skips `killFixtureGlobals()` -> the dev gate's `afterAll` `no QaStory385Gate global after the run` red (run exit 1).
- Hermeticity (no AC): the verification-gap layer ran `IRIS_SQL_MAX_ROWS=500` against the unpatched `sql-query-governance.test.ts` and saw it red. With the patch the suite passes with `IRIS_SQL_MAX_ROWS=500` and `IRIS_SQL_TIMEOUT=30` set.

## Auto Run Result

Status: done
Blocking condition: none

**Implement and review pass (2026-10-15).**
- **Change.** New IRIS handler `ExecuteMCPv2.REST.Sql` (route `POST /dev/sql/execute`): it prepares once, classifies by statement type, runs read paths in an always-rolled-back transaction, runs capped INSERT/UPDATE/DELETE in a transaction that commits only within the cap, and reports a changed transaction level. `iris_sql_execute` moves onto it through one shared `runSql` and gains `readOnly`, `maxRowsAffected`, `countOnly`, `rowsAffected`, `totalCount`; new read tool `iris_sql_query` (parent `iris_sql_execute`, `core` and `developer`, dev 30 -> 31, `core` 14 -> 15 runtime, suite 106 -> 107); operator variables `IRIS_SQL_READ_ONLY` and `IRIS_SQL_MAX_ROWS_AFFECTED` (global, inherited by every profile); refusal codes `SQL_READ_ONLY` and `SQL_ROWS_AFFECTED_CAP`.
- **BOOTSTRAP_VERSION** `3af8ca401e7c` -> `f757473a71d8` (`gen:bootstrap` run twice, byte-identical); classes 29 -> 30; `BaseTest` 7/7 with the handler count at 16.
- **Files.** `src/ExecuteMCPv2/REST/Sql.cls` (new), `Dispatch.cls`, `Tests/BaseTest.cls`; `packages/shared/src/{config,profiles,refusals,bootstrap}.ts` and `bootstrap-classes.ts` (generated); `packages/iris-dev-mcp/src/tools/{sql,index,presets,test-status}.ts`; new tests `sql-safety`, `sql-query-governance`, `sql-safety-live-gate` (78 live tests, added to the prepublish roster) plus helpers `sql-test-support.ts` and `sql-legacy-cases.ts`; updated count, roster and request pins in dev, shared and `iris-mcp-all` tests; READMEs, `tool_support.md`, `docs/`, `CHANGELOG.md`, the changeset and the re-measured payload table (dev 83,131 / 42,305).
- **Review.** Four layers, 38 findings: high 0, medium 8, low 23, false 7, maybe-false 0 (counted mechanically from the triage log). Routes: 18 patched, 19 rejected with a recorded reason, 1 deferred. Patches: the cap's own-row-count semantics documented; the read-only preset paragraph names the residual effects; live tests for a second namespace (`%SYS`), for statements that fail at execution (SQLCODE -105 and -400), for a function that opens a transaction, and for the endpoint's own input checks; a mock test for `readOnlySource` with both controls set; one wire test that carries `IRIS_SQL_READ_ONLY` and `IRIS_SQL_MAX_ROWS_AFFECTED` from the environment through the real `McpServerBase` to the POST body; stale README, comment and integration-test text. The 18 Rule 19 mutations of the build pass and the 7 of the review pass are recorded under Verification.
- **Deferred (1).** Other tools' hints and the `deploy-and-test-class` prompt and skill still point at `iris_sql_execute` for read-only queries (low, pre-existing).
- **Follow-up review recommended: true.** Eight medium findings in four entries were patched. The unverified risk: the new `%SYS` live test is the first run of the endpoint's device-output redirect (`Use tNull::("^"_$ZNAME)`) in a namespace other than the web app's, and it ran only where the bootstrap's `%All` package mapping exists. On an instance where that mapping step failed, cross-namespace calls of both SQL tools would fail where `action/query` worked before; nothing here exercises that.
- **Verification performed.** Per-package build, test, lint and type-check: shared 1601, dev 1357, admin 498, interop 343, ops 350, data 165, client-config 514, `iris-mcp-all` 310, all green (one existing lint warning in `shared/src/cli/governance.ts`). The `(loop)` commands pass; the armed live gate passes 78/78 and the armed `governance-file-process-gate` passes 9/9 against `default`/HSCUSTOM; `BaseTest` 7/7; `gen:governance-baseline:check` exits 0 at 141 frozen keys; `governance-baseline.ts`, `baseline-classifications.ts` and `ipm/module.xml` have no diff against `61cdb551`; `iris_doc_list` (generated) and `iris_global_list` for `QaStory385` are empty.
- **Residual risks.** The cap counts the statement's own `%ROWCOUNT`; a client timeout leaves a capped DML to commit server-side; `$$GetTypen^%SYS.SQLSRV` and `%Metadata.statementType` are verified only on 2026.2 build 221U. All three are documented.
- **For the retro (spec corrections).** (1) The Verification names `^ExecuteMCPv2.Temp.QaStory385GateC`: that 33-character name collides with its sibling and loses the stem, so the gate uses `^ExecuteMCPv2.QaStory385GateC`/`G` and `DEFAULTGLOBAL` on the audit class. (2) The planned `sql-safety` "not-countable" mutation row is not IRIS-side observable; the live rows are the pinning tests. (3) The spec did not list `governance-cli-universe.test.ts` and `doc-edit-governance.test.ts`, whose parent-map pins moved. (4) The `overCap` remedy for an unknown count (TRUNCATE) says "raise maxRowsAffected", which cannot help; the text is fixed in the intent contract (BH1 in the triage log).

**Planning pass (2026-10-15).** The plan was halted after planning, as the invocation directed. The spec meets the READY FOR DEVELOPMENT standard.
- **Probes.** The AC 38.5.1 probes ran at plan time on `default`/HSCUSTOM (IRIS 2026.2 build 221U), using disposable `ExecuteMCPv2.Temp.QaStory385*` classes and globals. All were removed, and the listings for `QaStory385` (documents with `generated`, and globals) are empty.
- **For the lead.** Two orchestrator decisions are recorded under Design Notes: the default-path route move, and the cap allowlist. There are also seven plan-time interpretations, including `totalCount` already existing on `iris_production_adapters` with the same meaning.
- **Ledger inbox.** None.
