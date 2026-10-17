---
title: 'Story 40.0: Epic 39 Deferred Cleanup'
type: 'bugfix'
created: '2026-10-17'
status: 'done'
baseline_revision: '9380bbdfac6c036b4928d1aef8bed9aec695e4be'
baseline_commit: '9380bbdfac6c036b4928d1aef8bed9aec695e4be'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/.claude/rules/project-rules.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-iris-execute-mcp-v2-2026-10-14/ARCHITECTURE-SPINE.md'
  - '{project-root}/.claude/rules/iris-objectscript-basics.md'
  - '{project-root}/.claude/rules/object-script-testing.md'
warnings:
  - multiple-goals
  - oversized
deferred:
  - summary: >-
      The reset path of `AlertsManage` in `Monitor.cls` builds `clearedAt` from the local `$Horolog` and appends a literal `Z`, so on an instance with a non-zero time zone it labels local time as UTC (the defect class DW-584 fixes for the cutoff).
    evidence: |-
      `ExecuteMCPv2.REST.Monitor` sets `tTimestamp = $Translate($ZDateTime($Horolog, 3, 1), " ", "T")_"Z"` and returns it as `clearedAt`. This instance runs at `$ZTimeZone` 0, so the value is only wrong elsewhere; no test covers it under a non-zero time zone. Pre-existing: the line is not in this story's diff.
    location: >-
      src/ExecuteMCPv2/REST/Monitor.cls:960
    severity: low
  - summary: >-
      The `recover-stuck-production` prompt step 3 calls `iris_production_logs` with no rule to report the reason for Event Log text withheld under `block` and never to read it another way, the rule DW-587 adds to `trace-message-flow`.
    evidence: |-
      `recoverStuckProduction.ts:54` tells the agent to call `iris_production_logs` filtered by `itemName` and/or `type: "Error"` and says nothing about `textPolicy`. Under `block` the tool withholds each entry's `text` (DW-576), so an agent following that prompt has no instruction to stop at the reason. Pre-existing and outside decision #36, which scoped DW-587 to `trace-message-flow`; a prompt text change is a sanctioned AD-15 change that needs the lead's decision.
    location: >-
      packages/iris-interop-mcp/src/prompts/recoverStuckProduction.ts:54
    severity: low
---

<intent-contract>

## Intent

**Problem:** Epic 39 left four ledger entries for this gate (DW-584 to DW-587). The plan-stage probes (Design Notes) confirmed three as real defects and showed the fourth to be false:
- **DW-584.** `iris_metrics_interop` `errorCount24h` counts Warning rows (`Type = 3`; Error is 2). Its cutoff `$ZDateTime($Horolog - 1, 3)` is the date-only string `YYYY-MM-DD` of the previous local day, so the window runs from that midnight: 24 to 48 hours, in local time, compared with UTC `TimeLogged`. On the probe fixture the tool answered 2 where the true count is 3. `messageCount24h` uses the same cutoff against UTC `TimeCreated` (OD-1).
- **DW-585.** The `iris_production_logs` `type` filter matches nothing. `EventLog` binds the display name (`Error`) to `Type = ?` in logical mode, so `type: "Error"` returned 0 entries over 4 Error rows.
- **DW-586.** False: the generation-failure text cannot carry message-derived content.
- **DW-587** (decision #36). Under `block`, the `trace-message-flow` prompt gives no report-the-reason rule for withheld Event Log and diagram error text.

**Approach:** Fix DW-584, DW-585 and DW-587, and close DW-586 with the probe evidence. Each fix is proven live on the built servers in a new default-suite gate against disposable namespaces, and by an OS mutation pin. Each behavior change is a sanctioned AD-15 change named in `CHANGELOG.md`. Every other path stays byte-identical.

## Boundaries & Constraints

**Always:**
- **DW-584 (`REST/Monitor.cls`).**
  - New `ClassMethod UtcCutoff(pSeconds As %Integer, pNow As %String = "") As %String`. It returns the UTC instant `pSeconds` before `pNow`, where `pNow` is a `$ZTimeStamp` value and `""` means the current `$ZTimeStamp`. The result is in the `Ens.DataType.UTC` logical form, `$ZDateTime(<horolog>, 3, 1, 3)`, for example `2026-10-16 22:02:08.804`. It never reads `$Horolog`.
  - `CollectInteropMetrics` computes the cutoff once, as `..UtcCutoff(86400)`.
    - `errorCount24h` becomes `SELECT COUNT(*) AS cnt FROM Ens_Util.Log WHERE Type = 2 AND TimeLogged > ?`.
    - Per OD-1, `messageCount24h` binds the same cutoff to its unchanged statement.
  - `queueDepth`, the production fields, the keys and their order, and the `Catch` fallbacks to 0 are unchanged.
- **DW-585 (`REST/Interop.cls`).**
  - New `ClassMethod LogTypeValue(pType As %String) As %String`, which is `$Case(pType, "Assert":1, "Error":2, "Warning":3, "Info":4, "Trace":5, "Alert":6, :pType)`.
    - It uses literal values, like the Loader's `$$$eMessageType` literals, so `Interop.cls` takes no runtime dependency on `Ens.DataType.LogType`. A non-interop namespace answers exactly as today.
    - Any other value passes through unchanged. Today's `type=2` still matches (AD-33), and an unknown or lower-case value still matches nothing.
  - `EventLog` binds `..LogTypeValue(tType)`. Its SQL text, `count` handling, entry mapping (`type` stays the stored number) and errors are unchanged.
  - The TypeScript tool and its wire request (`type=Error`) are unchanged.
- **DW-587 (decision #36; AD-15, AD-28).** `traceMessageFlow.ts` changes only the step texts below, verbatim. The name, title, arguments, description and the 6-step structure stay. Regenerate `skills/trace-message-flow/SKILL.md` with `pnpm gen:skills`.
  - The quoted texts are the rendered prompt text. Inside the template literal, each backtick is escaped as the file already does.
  - **Step 4** gains one space and then this sentence after its current text:
    > Under the `block` data policy the text of each `Error on message` warning, in `warnings` and on its `%%` line of the diagram, is replaced by a reason: report that reason to the user, and never read the error text another way (for example through SQL, global or document tools).
  - **Step 5** gains one space and then this sentence after its current text:
    > Under `block` each entry's `text` is withheld and its `textPolicy` gives the reason: report that reason to the user, and never read the log text another way (for example through SQL, global or document tools).
  - **Step 6.** Replace `what the error log says, and where` with:
    > what the error log says (where the log or diagram text was withheld, say so and give its reason instead of the text), and where
- **Bootstrap (AD-14, Rule #24).** `Monitor.cls` and `Interop.cls` change, so run `pnpm gen:bootstrap` once after both and record `BOOTSTRAP_VERSION` `7d12cd8b3a1e` → new. The gate asserts the deployed version.
- **Gate shape.** The new gate follows the 39.x shape:
  - its own `REQUIRE_LIVE` comparison;
  - `skipReason = staleDistReason(REPO_ROOT, "shared");`, then the literal dev/admin/interop freshness line, then `skipReason ??= staleDistReason(REPO_ROOT, "iris-ops-mcp");`;
  - `dev = await openWireSession(...)`, directly followed by `await assertDeployedBootstrapVersion(REPO_ROOT, TARGET);`;
  - tag `story-40-0-burn-down-live-gate`;
  - the armed text `IRIS_REQUIRE_LIVE is set, so the Story 40.0 live gate may not be skipped: <reason>`;
  - listed in `prepublish-gate.mjs` `gateTestFiles` and in `GATES` (`story: "Story 40.0"`, `extraDriven: ["iris-ops-mcp"]`);
  - helpers from `process-gate-helpers.ts` and `header-row-oracle.ts` only.
- **Fixture ξ.** It is synthetic and lives only in `EXECMCPTMP400A`, a mapping-only interop namespace. `EXECMCPTMP400B` has no mappings.
  - **No production.** None is started, and no `EnableNamespace` call is made.
  - **Lifecycle.** As in 39.7: remove leftovers and assert there are none, create, seed, run a positive leftovers control, then tear down each step separately and assert nothing is left.
- **Counts that do not move.** This story adds no MCP tool and moves no tool count or preset row:
  - 109 package / 114 advertised tools and 13 prompts;
  - interop `core` 12 runtime, ops `core` 10 runtime;
  - baseline `1e62c5ad5bf7`/141 (`:check` only).

  No action, key, `TOOL_PAIRS` entry, annotation, input schema, tool description or environment variable changes, so the tools-list snapshot does not move.
- **Text.** Source is ASCII, with escapes (Rule 14), and comments state the contract. Every live run names its target with the `IRIS_*` variables and `IRIS_REQUIRE_LIVE=1`, and every MCP call names `server:"default"`.

**Never:**
- **No Diagram or diagram TypeScript change.** No change to `Diagram/*.cls` or `diagram.ts`, and DW-586 is not withheld (AD-26: no content sniffing, and nothing message-derived to withhold).
- **No other product TypeScript change.** Outside `traceMessageFlow.ts`, no shipped TypeScript source changes: not `monitor.ts`, not `metrics.ts`, and no tool description. Tests and test fixtures change as the Tasks say.
- **No class dependency.** No `##class(Ens.DataType.LogType)` call in `Interop.cls` and no `$Horolog` in the cutoff.
- **Shared instance.**
  - No production start and no `EnableNamespace`.
  - No read of HSCUSTOM's or another project's Event Log or messages.
  - No cross-namespace `iris_metrics_interop` call: always pass `namespace`.
  - Never stop or reconfigure IRIS.
- **Generated files.** No hand edit of `bootstrap-classes.ts`, `skills/` or the tools-list snapshot, and never the bare governance-baseline generator.
- **Release.** No `changeset version` and no publish.

## I/O & Edge-Case Matrix

**Fixture ξ** (`Story400.Seed.Seed()` in `EXECMCPTMP400A`). T0 is the seed's `$ZTimeStamp`. Every row's time is T0 plus the offset, written by the seed's own shift arithmetic, never by `UtcCutoff`.

| Row | Kind | Type / Status | Item | Offset from T0 |
|---|---|---|---|---|
| L1–L6 | Event Log | Type 1, 2, 3, 4, 5, 6, in order | `Story400.Item` | −1 h |
| L7 | Event Log | 2 | `Story400.Item` | −23 h |
| L8 | Event Log | 2 | `Story400.Item` | −24 h 5 min |
| L9 | Event Log | 3 | `Story400.Item` | −24 h 5 min |
| L10 | Event Log | 2 | `Story400.Other` | −1 h |
| H1, H2, H3 | header, session 400001, Request, `Story400.Service` → `Story400.Operation`, no body | Status 9 (Completed) | — | −1 h, −23 h, −24 h 5 min |

- **The texts.** Each log text is `SYNTHPHI400-L<n>`.
- **What the seed returns.** `Seed()` returns `{"logs":"1,2,3,4,5,6,7,8,9,10","headers":"1,2,3"}`.
- **The live oracle.** The type values are read live from `Ens.DataType.LogType` (`%Dictionary.CompiledParameter` `DISPLAYLIST`/`VALUELIST` through the raw Atelier query route). The entries are read with the hand-written `eventLogOracle`. The window membership comes from the construction above.

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| DW-584 counts | built ops, `iris_metrics_interop {namespace: A}` | `namespaces[0]` has `errorCount24h` 3 (L2, L7, L10), `messageCount24h` 2 (H1, H2) and `queueDepth` 0. The text has `Errors (24h): 3` and `Messages (24h): 2`. Old code: 2 and 3 | none |
| DW-584 time zone (OS) | `UtcCutoff(86400, "67860,79328.804084877")`; then `UtcCutoff(86400)` with the per-process `$ZTimeZone` set to 420, then to -600 | `2026-10-16 22:02:08.804` (live capture); each default result is within 5 s of `$ZTimeStamp` − 86,400 s. `$ZTimeZone` is restored on every path | none |
| DW-585 every type | built interop, `iris_production_logs {namespace: A, type: <name>, count: 100}` for each of the six DISPLAYLIST names | Entries deep-equal `eventLogOracle` with `Type = <live VALUELIST value>`, by ID DESC. By construction: Error [10, 8, 7, 2], Warning [9, 3], Assert [1], Info [4], Trace [5], Alert [6] | none |
| DW-585 combined | `type: "Error", itemName: "Story400.Item"` | IDs [8, 7, 2] | none |
| DW-585 route (AD-33) | raw `GET /api/executemcp/v2/interop/production/logs?namespace=A&type=2`, then `&type=Bogus` | `type=2` gives the result of `type=Error` (an older request still works); `Bogus` gives `{entries: [], count: 0}` | none |
| DW-585 mapping (OS) | `LogTypeValue` over every DISPLAYLIST piece; `"2"`, `""`, `"Bogus"`, `"error"` | Each name equals `Ens.DataType.LogType.DisplayToLogical(name)` and the VALUELIST piece at the same position (6 pieces). The others come back unchanged | none |
| Not configured (Rules #34, #41) | `iris_metrics_interop {namespace: B}`; `iris_production_logs {namespace: B}` with and without `type: "Error"` | Metrics: no error, `errorCount24h` 0, `messageCount24h` 0. Logs: both `isError`, with the identical text (the SQL table error), so the mapping adds no dependency | isError (logs) |
| DW-587 renderings | the prompt with all arguments, namespace omitted, `build({})`, and SDK `getPrompt` with `arguments` omitted | Steps 4, 5 and 6 hold the exact texts above; 6 steps in order; the contract is unchanged | none |
| Gate unarmed / armed | the nested run of `story-39-1-gate-guards` on a closed port | Every test skips with `[SKIP] story-40-0-burn-down-live-gate:`; armed, it fails with "Story 40.0 live gate may not be skipped" | skip / failure |

</intent-contract>

## Code Map

**DW-584**
- `src/ExecuteMCPv2/REST/Monitor.cls`:
  - `CollectInteropMetrics` :535-604; the error count :575-587 and the message count :589-601. Both use `$ZDateTime($Horolog - 1, 3)`.
  - `InteropMetrics` :195-258 calls the collector per namespace (single-namespace mode :204-215, cross-namespace :216-245). It stays as it is.
- TypeScript, read only: `packages/iris-ops-mcp/src/tools/metrics.ts:200-279` passes `structuredContent: result` unchanged, with text lines :255-256. The mocked tests in `metrics.test.ts:329,366` stay green.
- `irislib/Ens/DataType/LogType.cls:11-13`: `DISPLAYLIST` `,Assert,Error,Warning,Info,Trace,Alert`, `VALUELIST` `,1,...,6`.
- `irislib/Ens/Util/LogBase.cls:21,24`: `Type As Ens.DataType.LogType`, `TimeLogged As Ens.DataType.UTC`. `irislib/Ens/DataType/UTC.cls` holds the logical form and `timeUTC()`.

**DW-585**
- `src/ExecuteMCPv2/REST/Interop.cls:1191-1289`, `EventLog`: the doc comment :1191-1201, the `type` read :1207, the bind :1225-1229, the entry mapping :1262-1276 (`type` is the number).
- `packages/iris-interop-mcp/src/tools/monitor.ts:56-139`: the zod enum of display names :66-69, and `params.set("type", type)` :106. Unchanged.

**DW-586 (read only)**
- `Diagram/Generate.cls`: `ApplyFailure` :237-265. It is called from `GenerateOne` :192-194 and :208-210 with the stage status.
- `Diagram/Loader.cls:77-82` and `:122-124` are the only constructed statuses: `"SQL error: "_%Message` and `"SQL fetch error: "_%Message`. Every other status is `ex.AsStatus()` of a system exception (`Correlator.cls:204`, `Compressor.cls:110,168,347`, `Writer.cls:78`).

**DW-587**
- `packages/iris-interop-mcp/src/prompts/traceMessageFlow.ts`: steps 4 to 6 of the template literal.
- `scripts/gen-skills.mjs` writes `skills/trace-message-flow/SKILL.md` from the built interop dist (build first). `pnpm gen:skills:check` checks it, and `pnpm validate:prompts` checks the `iris_*` tokens.
- Pins that stay green (substring and order pins only):
  - `packages/iris-interop-mcp/src/__tests__/prompts.test.ts:199-262`;
  - `packages/iris-mcp-all/src/__tests__/prompt-safety-invariants.test.ts:481-588`;
  - `story-39-6-qa-forensics-prompts-sdk-wire.test.ts:271-298` (`expectSteps` markers) and :456-476 (SKILL.md body equals the render);
  - `story-39-6-doc-claims.test.ts:264-271,357-370` (README rows) and :483 (the no-compliance-claim scan over SKILL.md).

**Gate, fixture, oracle**
- Template: `packages/iris-mcp-all/src/__tests__/story-39-7-burn-down-live-gate.test.ts`:
  - header :1-35, `beforeAll` :167-217, `afterAll` :219-242;
  - `logOracle` :547-572, which moves to `header-row-oracle.ts` as `eventLogOracle(target, where = "")`;
  - `productionLogs` :574.
- `interop-namespace-fixture.ts`:
  - `createInteropNamespace` :432-471 (`interop: false` gives B), `removeInteropNamespace` :482-497 and `leftovers` :1710;
  - `putCompileSeed` :1038-1067;
  - the 39.7 seed pattern `STORY397_SEED_SOURCE` :1542-1641 (`SaveLog` :1625);
  - `Story391Fixture.Add` :94 (headers);
  - `FIXTURE_NAME` :81.
- `interop-namespace-fixture.test.ts:146-170`: the `STORY397_IDS` rows to mirror.
- `process-gate-helpers.ts`: `staleDistReason` :46, `openWireSession` :242, `atelierQuery` :339, `rawIrisRequest` :396, `skipTest` :530, plus `teardownRecorder`, `assertDeployedBootstrapVersion` and `fixtureDocumentNames`.
- `gate-helper-copies.test.ts`: `REPLACED_NAMES` gains `logOracle`.
- Rosters:
  - `packages/iris-mcp-all/scripts/prepublish-gate.mjs:105-215` (`gateTestFiles`; ops is already in `DRIVEN_PACKAGES` :66-72);
  - `story-39-1-gate-guards.test.ts`: `DRIVEN_PACKAGES` :32, `GATES` :35-46, `expectedSkipReason` :71-81, the source-order test :129-139, the completeness test :151-162;
  - `live-gate-roster.test.ts`.
- `story-39-7-doc-claims.test.ts:56-57,84-85,159,271` reads the current `BOOTSTRAP_VERSION`. Once this story moves it, those lines must pin `7d12cd8b3a1e` as history, the way 39.1 to 39.5 do.

**OS tests:** follow the shape of `src/ExecuteMCPv2/Tests/DiagramGenerateTest.cls` (base class, `^UnitTestRoot` guard). There is no existing Monitor or Event Log test class.

**Docs anchors**
- `packages/iris-ops-mcp/README.md:343-370` (the `iris_metrics_interop` example).
- `packages/iris-interop-mcp/README.md`: :626-645 (the `iris_production_logs` example shows `"type": "Error"` and `"message"`, but the real entry is `{id, timestamp, type: 2, itemName, text}`) and :396 (prompt row).
- Root `README.md:793` (prompt row).
- `tool_support.md:213` (the 39.7 note; the 40.0 note goes after it).
- `CHANGELOG.md:5` (top section).

## Tasks & Acceptance

**Execution** (in dependency order; rebuild a package before running anything that reads its dist):
1. **`src/ExecuteMCPv2/REST/Monitor.cls`** (DW-584, OD-1): add `UtcCutoff` with a contract doc comment, and change `CollectInteropMetrics` as Always says. Doc comment: `errorCount24h` counts Error entries and `messageCount24h` counts headers, over the 86,400 s before the call, in UTC.
2. **`src/ExecuteMCPv2/REST/Interop.cls`** (DW-585): add `LogTypeValue`; bind it in `EventLog`; update the `type` line of the doc comment (a display name, mapped to its type number, or the number itself).
3. **`src/ExecuteMCPv2/Tests/EventLogMetricsTest.cls`** (new, data-free, at most about 200 lines, 4 `Test*` methods):
   - `TestUtcCutoffFixedInstant`: the live capture plus one row across midnight, captured live first (Rule #36);
   - `TestUtcCutoffIgnoresProcessTimeZone`: 420 and -600, restoring `$ZTimeZone` in every path, also in `OnAfterOneTest`;
   - `TestLogTypeValueMatchesLogType`: iterate the live `$Parameter("Ens.DataType.LogType", "DISPLAYLIST")`/`VALUELIST` pieces through `$ClassMethod`, and assert there are 6, so a seventh IRIS type fails it (Rule #56);
   - `TestLogTypeValuePassesOtherValuesThrough`.

   Load each class with a glob path (`/Users/jbrandt/git/iris-execute-mcp-v2/src/**/Monitor.cls` and likewise; Rule #17) and compile.
4. **`pnpm gen:bootstrap`** after Tasks 1 and 2. Record `7d12cd8b3a1e` → new in `## Verification`. A second run is a no-op.
5. **`packages/iris-interop-mcp/src/prompts/traceMessageFlow.ts`** (DW-587): the three step texts, verbatim.
6. **Prompt tests.**
   - `packages/iris-interop-mcp/src/__tests__/prompts.test.ts`: a new `it` asserting each exact step text, with and without `namespace`.
   - `prompt-safety-invariants.test.ts`: a new `it` over every trace rendering requiring `never read the error text another way`, `never read the log text another way` and `give its reason instead of the text`.
   - `story-39-6-qa-forensics-prompts-sdk-wire.test.ts`: extend the step 4 to 6 markers with `` `block` `` and `never read the error text another way` (4), `` `textPolicy` `` and `never read the log text another way` (5), and `give its reason instead of the text` (6).
7. **Build interop, then `pnpm gen:skills`.** Only `skills/trace-message-flow/SKILL.md` changes. Then run `pnpm gen:skills:check` and `pnpm validate:prompts`.
8. **`header-row-oracle.ts`**: export `eventLogOracle(target, where = "")`. It holds the 39.7 select list, mapping and `SessionIsNull` handling, with ` WHERE <where>` added only when `where` is non-empty, and keeps `ORDER BY ID DESC`.
   - `story-39-7-burn-down-live-gate.test.ts`: replace the local `logOracle` with `eventLogOracle(oracleTarget())`, with no other change.
   - `gate-helper-copies.test.ts`: add `logOracle` to `REPLACED_NAMES`.
9. **`interop-namespace-fixture.ts`**: add `STORY400_SEED_SOURCE` (`Story400.Seed`).
   - **The guard.** It is guarded to `EXECMCPTMP400<A-Z>` and refuses a namespace that holds Event Log rows or headers.
   - **What it writes.** It writes fixture ξ with its own `Shift` helper: `Ens.Util.Log` `%Save` for the logs, `Story391Fixture.Add` for the headers.
   - **The exports.** Add `STORY400_DOCUMENTS`, `STORY400_IDS` and `seedEventLogCounts(dev, name)` through `putCompileSeed`.
   - **The test.** Mirror the `STORY397_IDS` rows in `interop-namespace-fixture.test.ts`.
10. **`packages/iris-mcp-all/src/__tests__/story-40-0-burn-down-live-gate.test.ts`** (new). It has the 39.x header, with the paths stated per row (Rule #59).
    - **`beforeAll`:**
      1. arm;
      2. `dev`, then the version assert;
      3. `admin`, interop, ops;
      4. `putFixtureClass`;
      5. remove A and B and assert no leftovers;
      6. create A (`interop: true`) and B (`interop: false`);
      7. `seedEventLogCounts(dev, A)`;
      8. a positive leftovers control.
    - **Rows:** one per matrix row, except the two OS rows, the render row and the guard row, which Tasks 3, 6 and 11 own.
    - **`afterAll`:** `teardownRecorder` (A, B, `leftovers`, the fixture class, and the document listing with no `Story400` and no `Story391Fixture`).
    - **Rosters:** add it to `prepublish-gate.mjs` `gateTestFiles` with a two-line comment (it drives the built dev, admin, interop and ops servers; it writes A, B, `Story400.*` and `ExecuteMCPv2.Temp.Story391Fixture`).
11. **`story-39-1-gate-guards.test.ts`**:
    - `GATES` entries gain an optional `extraDriven`;
    - `expectedSkipReason(gate)` appends each extra package's `staleDistReason` after the three;
    - the source-order test requires each extra's literal line after the driven line and before the first session;
    - add the 40.0 entry and update the header comment.
12. **`story-39-7-doc-claims.test.ts`**: replace the dynamic `BOOTSTRAP_VERSION` with the literal `7d12cd8b3a1e` (pinned as history).
13. **Docs** (Rule #30; each states its default state):
    - **Ops README.** After the `iris_metrics_interop` example, add: "`errorCount24h` counts Event Log entries of type Error and `messageCount24h` counts message headers, each over the 24 hours before the call, measured in UTC (a read, enabled by default)."
    - **Interop README.** Correct the `iris_production_logs` example to the real entry shape. Add one line: `type` takes a display name, so `Error` returns the entries whose `type` is 2 (a read, enabled by default).
    - **Prompt rows.** In the interop README :396 and root README :793, keep every current phrase and add, after "for any erroring items": " (under `block`, the reason for withheld diagram error text and Event Log text is reported the same way, never read another way)".
    - **`tool_support.md`.** Add a `> **Story 40.0 (2026-10-17) — Epic 39 deferred cleanup:**` note after the 39.7 note: no tool, action or key, and the counts; the bootstrap move; DW-584 (with OD-1), DW-585, DW-586 closed with evidence, and DW-587.
    - **`CHANGELOG.md`.** Add the top section `## [Pre-release — 2026-10-17] — Story 40.0: Epic 39 deferred cleanup`.
      - Headings: `### Changed` (DW-587, sanctioned AD-15 / decision #36), `### Fixed` (DW-584 with OD-1, DW-585), `### Documentation` and `### Tests`.
      - It states that no count moves and gives the bootstrap move.
    - **Changeset.** Add `.changeset/story-40-0-epic-39-deferred-cleanup.md`: `"@iris-mcp/shared": patch`, `"@iris-mcp/interop": patch`.
14. **`packages/iris-mcp-all/src/__tests__/story-40-0-doc-claims.test.ts`** (new; no IRIS) pins:
    - each Task 13 item by its anchor, with its default-state phrase;
    - the CHANGELOG title and its four headings, above the 39.7 section;
    - the bootstrap move as literals;
    - the changeset map;
    - no `CLAIMS` hit.
15. **This spec's `## Verification`**: record the commands and results, the bootstrap move, and every `mutation:` line.

**Acceptance Criteria:**
- **AC-1 (DW-584; OD-1; AD-12, AD-14).** Given fixture ξ deployed with the regenerated embed, when the gate calls `iris_metrics_interop {namespace: A}` on the built ops server, then `errorCount24h` is 3, `messageCount24h` is 2 and `queueDepth` is 0. When `EventLogMetricsTest` runs, the cutoff equals the UTC instant 86,400 s earlier under process time zones 420 and -600.
- **AC-2 (DW-585; AD-33).** Given fixture ξ, when the gate filters `iris_production_logs` by each of the six live display names and by Error plus item, then each result deep-equals the hand-written oracle. The raw route still answers `type=2` as `type=Error`, and an unknown value with no entries.
- **AC-3 (not configured; Rules #34, #41).** Given the bare namespace B, when the metrics and logs rows run, then the metrics are zeros with no error, and both logs calls are errors with identical text.
- **AC-4 (DW-586; AD-26).** Given the probe evidence in Design Notes, when the story closes, then `Diagram/*.cls` and `diagram.ts` are byte-identical (`git diff --stat` empty for them), the 39.7 pin that a non-error warning is untouched (`logs-diagram-policy.test.ts`) stays green, and `## Verification` records the evidence for the lead's adjudication.
- **AC-5 (DW-587; decision #36; AD-15, AD-28).** Given the rebuilt interop dist, when the prompt tests, the SDK-wire test, `gen:skills:check` and `validate:prompts` run, then:
  - every rendering carries the three exact texts in 6 ordered steps;
  - the name, title, arguments and description are unchanged;
  - `SKILL.md` equals the render;
  - no rule number, repository path, `IRIS_DATA_POLICY` or unknown `iris_*` token appears.
- **AC-6 (docs; Rules #30, #43).** Given the finished docs, when `story-40-0-doc-claims.test.ts` and the existing doc-claims tests run, then every Task 13 item states its default state, and the 39.6 and 39.7 pins pass, the latter with its history literal.
- **AC-7 (back-compat and records; AD-5, AD-7, AD-14, AD-15).** Given the finished tree, when the Verification commands run, then:
  - the counts above are unchanged, and `gen:tools-list-snapshot:check` passes with no re-pin;
  - `gen:bootstrap` is idempotent at the new version;
  - the governance `:check` and `check-epics-sync.mjs` pass;
  - every per-package build, test, lint and type-check passes;
  - the armed 39.7 gate passes with `eventLogOracle`;
  - nothing is left on the instance.
- **AC-8 (Integration; Rules 1/2).** Given the regenerated embed deployed by the built servers, when the 40.0 gate, the armed 39.7 gate and the 39.1 guard run, then:
  - the built ops server (a consumer of the redeployed `Monitor.cls`) reports the corrected counts;
  - the built interop server (a consumer of `Interop.cls` and of the prompt) returns the filtered entries and the new prompt text;
  - the 39.7 gate (a consumer of `eventLogOracle`) stays green;
  - the guard (a consumer of `extraDriven`) expects the 40.0 gate's ops freshness check, and its source-order row goes red when that line is removed.

## Spec Change Log

## Review Triage Log

### 2026-10-17 — Review pass
- verdicts: 26 findings — high 0, medium 0, low 20, false 6, maybe-false 0
- findings:
  - `[low]` `[reject]` Blind: a lower-case or mistyped `type` still matches nothing, and the gate pins that — the matrix and Boundaries state it as the contract ("an unknown or lower-case value still matches nothing"), so the fix would alter specified behavior (spec-bound, by design).
  - `[low]` `[reject]` Blind: the interop README `type` sentence lists only Error to 2 — the sentence is specified verbatim by Task 13, the tool's zod enum lists the six names, and the route doc comment and CHANGELOG state the mapping; a longer sentence is not worth the doc-claims churn.
  - `[low]` `[reject]` Blind: root README line 506 says both prompts report a withheld body's reason — the sentence is still true (incomplete, not wrong), Task 13 lists the prompt rows as the doc changes, and the line is pinned by the 39.6 doc-claims test.
  - `[low]` `[patch]` Blind: `BOOTSTRAP_TO` of the 40.0 doc-claims test is a literal nothing ties to the embed — patched: the test reads the embed's `BOOTSTRAP_VERSION` and asserts it equals `BOOTSTRAP_TO`; red when the embed is mutated (see the mutation lines).
  - `[low]` `[reject]` Blind: `REPLACED_NAMES` names the removed `logOracle`, not the shared `eventLogOracle` — the list holds the replaced local names (Task 8 names `logOracle`), and no gate declares `eventLogOracle`.
  - `[low]` `[patch]` Edge: `liveLogTypes()` may return an empty list, so the six-name row loops zero times — patched: `liveLogTypes` asserts six `DISPLAYLIST` pieces; the row is red alone when the dictionary query returns nothing.
  - `[false]` `[reject]` Edge: the `Story400` listing runs in HSCUSTOM while the seed compiles in A — it is a leak guard (red if the seed were ever compiled into HSCUSTOM), and A's database holding `Story400.Seed` is removed and asserted by `leftovers`; the Verification section prescribes this listing.
  - `[low]` `[patch]` Edge: the bootstrap literals are not checked against the embed — same root cause as the Blind finding on `BOOTSTRAP_TO`; patched with it.
  - `[low]` `[reject]` Edge: AC-3's "identical text" is compared after `Details: ` only — the tool message names the request URL (`&type=Error`), so whole-message equality cannot hold without a TypeScript change the intent forbids; the gate also pins that the text names the missing table and not `LogType`, which is what the row proves. Fix would edit the spec.
  - `[low]` `[reject]` Verification gap: `CollectInteropMetrics`' use of `UtcCutoff` is not pinned under a non-zero time zone — this instance runs at `$ZTimeZone` 0 (R1), the OS class is data-free by the spec, and a data-bearing test would read an Event Log; the helper is pinned in IRIS and the wiring by the gate's date-only and type mutations. A wiring regression needs a deliberate rewrite to a full-precision local cutoff. Residual risk recorded.
  - `[low]` `[patch]` Verification gap: the 40.0 doc-claims literal bootstrap move is not tied to the embed — same root cause as the Blind and Edge findings; patched with them.
  - `[low]` `[patch]` Verification gap: `story-39-7-doc-claims.test.ts` asserts that a constant matches `/^[0-9a-f]{12}$/`, which cannot fail — patched: the assertion is deleted; the next line still pins the literal in the document text.
  - `[low]` `[patch]` Verification gap: the six-name row's loop can run zero times — same root cause as the Edge finding on `liveLogTypes`; patched with it.
  - `[false]` `[reject]` Verification gap: tests and documentation rows without their own `mutation:` line — Rule 19 asks one demonstrated mutation per AC, and each AC (1 to 8) has at least one recorded line; the cited tests share the pinning test of an AC that has one.
  - `[low]` `[reject]` Verification gap: the `^Ens.Util.LogD` seed guard is reached only by a substring test — the guard is test-fixture safety for a disposable namespace, the substring test went red under the recorded mutation, and a second live scenario (a namespace with only Event Log rows) adds a fixture path for no product behavior.
  - `[low]` `[defer]` Verification gap: `AlertsManage` builds `clearedAt` from local `$Horolog` plus a literal `Z` — pre-existing (not in the diff), only wrong at a non-zero time zone; deferred.
  - `[low]` `[defer]` Verification gap: the `recover-stuck-production` prompt calls `iris_production_logs` with no report-the-reason rule under `block` — pre-existing and outside decision #36, which scoped DW-587 to `trace-message-flow`; a prompt text change needs the lead's decision; deferred.
  - `[low]` `[reject]` Intent: the process-time-zone half of DW-584 is pinned only by `EventLogMetricsTest`, which runs through `iris_execute_tests` and not in the vitest suite — same root cause as the wiring finding; the matrix itself labels that row "(OS)", and the `ExecuteMCPv2.Tests.*` classes are run on the instance by design.
  - `[false]` `[reject]` Intent: the TypeScript unit tests of the `type` filter are mocked, so only the gate and the OS class exercise the mapping — descriptive; no bad outcome, since the armed gate runs in the default suite and the mapping is pinned there on all six names.
  - `[low]` `[patch]` Intent: `build({})` is pinned verbatim for step 6 only, where the matrix row lists steps 4, 5 and 6 for every rendering — patched: `prompts.test.ts` also asserts steps 4 and 5 on `build({})`. (The SDK `getPrompt` with `arguments` omitted cannot render this prompt, because `sessionOrHeaderId` is required; the namespace-omitted SDK rendering is the practical form and its markers are extended.)
  - `[low]` `[reject]` Intent: the not-configured "identical text" is compared as IRIS's detail only — same root cause as the Edge finding; rejected for the same reason.
  - `[low]` `[reject]` Intent: `..UtcCutoff(86400)` runs outside both `Try` blocks, so a throw would no longer fall back to 0 — `UtcCutoff` is called here with no `pNow`, so it reads `$ZTimeStamp` and formats a valid horolog; no real input reaches a throw (Rule #54).
  - `[false]` `[reject]` Intent: the README, `tool_support.md` and changeset edits are not listed in the intent, and the ops package is not bumped — Task 13 lists each document and the changeset map (`shared`, `interop`) verbatim; the ops README edit carries no code change.
  - `[low]` `[reject]` Intent: the 39.1 guard's adjacency pattern was loosened from exactly one intervening line to at most one — the intent requires the 40.0 gate's `assertDeployedBootstrapVersion` directly after `openWireSession`, the 39.x gates keep their one line, and the pattern still requires the call within one line of the session (pinned by the guard's own row).
  - `[false]` `[reject]` Intent: an em dash is added to ObjectScript source — the character is on the doc-comment line from before this story (`git show HEAD:src/ExecuteMCPv2/REST/Interop.cls`), and it is prose in a doc comment, which Rule 14 exempts.
  - `[false]` `[reject]` Intent: no record of a revert-and-fail check appears in the diff — the diff file leaves out the spec; `## Verification` holds the mutation lines, 15 from the implement pass and 2 more from this review.

## Design Notes

**Orchestrator decision (decided 2026-10-17, orchestrator decision #38):**
- **OD-1.** `messageCount24h` moves to the same UTC 24-hour cutoff, through the one `UtcCutoff(86400)` value. DW-584 names only `errorCount24h`. DECIDED as recommended; H1-H3, the `messageCount24h` assertions and the OD-1 lines stay. The evidence:
  - `Monitor.cls:592` uses the identical `$ZDateTime($Horolog - 1, 3)` against `TimeCreated`, which is also `Ens.DataType.UTC`;
  - both values sit in one result under the same `24h` suffix, so an error rate taken from them divides two different windows;
  - the fix costs one bound argument.

**AC interpretations** (apply and report):
- **R1 (DW-584, "local `$Horolog` cutoff").** This instance runs at `$ZTIMEZONE` 0, so the local-versus-UTC half is invisible live. The observable live defect is the date-only cutoff. The fix covers both. The time-zone half is pinned by the OS test, which sets a per-process `$ZTimeZone`; the probe showed that this moves `$Horolog` by 7 h and leaves `$ZTimeStamp` alone.
- **R2 (DW-585, "pin every type").** It is pinned twice: OS against the live `Ens.DataType.LogType` lists, and on the wire for all six names against the SQL oracle.
- **R3 (DW-585, where the mapping lives).** It lives IRIS-side, in the handler that binds the statement (AD-12 input normalization). The route documents display names as its own contract, and direct callers get the fix too. The literal map keeps the error text of a non-interop namespace byte-identical (AC-3), whereas a `DisplayToLogical` call would change it. TypeScript is unchanged, so the wire request is too.
- **R4 (DW-586).** Closed with evidence, with no code change. Recommended ledger terminal: `wontfix-theoretical`, `reopen_if` a Diagram stage returns a `%Status` built from header field values.

**Probe evidence** (IRIS 2026.2 build 221U, Atelier v8, `default` localhost:52773, 2026-10-17T22:02Z; disposable `EXECMCPTMP400P`, mapping-only interop, created and removed; probe classes `ExecuteMCPv2.Temp.Probe400*` deleted; leftovers `[]`; `iris_doc_list` for `Probe400` empty).
- **Clock.** `$ZTimeZone` is 0. `$Horolog - 1` is `67859`, and `$ZDateTime($Horolog - 1, 3)` is `2026-10-16`, a date only. `$ZTimeStamp` `67860,79328.804084877`, shifted by −86,400 s, is `2026-10-16 22:02:08.804`. SQL `DATEADD('hh', -24, GETUTCDATE())` is `2026-10-16 22:02:08`.
- **DW-584.** Ten rows, the same shape as fixture ξ but with L8 and L9 at −25 h. `iris_metrics_interop` returned `errorCount24h` 2, where the truth is 3: L2, L7 and L10. A count `WHERE Type = 2 AND TimeLogged > <UTC cutoff>` gives 3, and so does the independent SQL `DATEADD(... GETUTCDATE())` form. `Type = 2` against the old cutoff gives 4, because the window runs from the start of the previous day.
- **DW-585.**
  - **On the wire.** `iris_production_logs {type: "Error"}` returns `{entries: [], count: 0}`.
  - **The binding.** In logical mode, binding `"Error"` gives 0, while `2` and `"2"` give 4. Display mode and `%EXTERNAL` give 4.
  - **The datatype.** `Ens.DataType.LogType.DisplayToLogical` maps `Error` to 2 and passes `"2"`, `"Foo"` and `"error"` through unchanged.
  - **The output.** Entries carry `"type": 2`, a number.
- **DW-586.**
  - **Without Ens.** In a namespace with no Ens, the failure text is `Generation failed for session 400001: SQL error:  Table 'ENS.MESSAGEHEADER' not found`: the table name, no data.
  - **No data path.** With Ens, sessions whose `ErrorStatus` holds 230 CJK characters plus `SYNTHPHI400-ERR`, in a 2-iteration pair loop that exercises the `tSeen(tText)` dedup, rendered normally, with no failure. So did config names holding CR, LF, `%%`, U+0001, `;`, `"` and `<>`.
  - **The subscript limit.** A local subscript accepts up to 32,767 characters. `ErrorText` is capped at 200, so the dedup cannot raise `<SUBSCRIPT>`. Even at 40,000 characters the error text is `<SUBSCRIPT>SubscriptProbe *tSeen() Subscript 1 > 32767 chars`, with no value echoed.
  - **By source.** The only constructed statuses are the two SQL `%Message` templates; every other status is a system exception's name and location, which `SanitizeError` sanitizes.

**Design rationale.**
- **Why ops is driven.** The gate drives the built ops server because the intent names the tool (surface-anchored), even though `metrics.ts` is unchanged.
- **Why an oracle by construction.** The window oracle is the construction, not SQL time arithmetic. Atelier's query select mode would put a time-zone conversion into any time literal, and the construction keeps 1 h margins everywhere except L8, L9 and H3. Those sit 5 min outside the new window and inside the old one whenever the UTC day is at least 5 min old, which the mutation runs must respect.
- **Why B exists.** B proves the not-configured branch (Rule #41) and is the second namespace (Rule #34).

**Extend, don't copy (Rule 2).**
- `eventLogOracle` is the 39.7 gate's `logOracle`, moved and parameterized, and the copy guard learns its old name.
- `Story400.Seed` follows `Story397.Seed` (`SaveLog` shape) and reuses `Story391Fixture.Add`. A new seed is needed because no earlier fixture places rows relative to the current time.
- `extraDriven` extends the 39.x guard rather than adding a guard file.
- `UtcCutoff` and `LogTypeValue` are new because nothing in `src/` computes either (searched).

**Integration (Rules 1/2).**
- **Integration ACs:** AC-8.
- **Consumes:**
  - 39.1's `interop-namespace-fixture.ts` and `Story391Fixture`;
  - 39.6's `process-gate-helpers.ts`;
  - 39.7's gate, `logOracle` and the `trace-message-flow` block reasons (`BLOCK_REASONS.eventLogText` and `diagramErrorText`, unchanged).
- **Consumed-by:**
  - Stories 40.1 to 40.4, which inherit the bootstrap version and the `extraDriven` guard field;
  - every later Event Log gate (`eventLogOracle`).

**Ledger inbox (Rule 17):**
- **DW-584:** Tasks 1, 3, 4 and 10, AC-1, and 2 matrix rows (OD-1 extends it to `messageCount24h`).
- **DW-585:** Tasks 2, 3, 4 and 10, AC-2 and AC-3, and 4 rows.
- **DW-586:** AC-4 and R4: closed with evidence, no code.
- **DW-587:** Tasks 5 to 7, 13 and 14, AC-5 and AC-6, and the render row.

**Spine follow-up (lead, Rule 20).**
- AD-15's sanctioned list gains Story 40.0: the `trace-message-flow` block rule (decision #36), and the `errorCount24h`/`messageCount24h` and `type` filter corrections (OD-1).
- AD-26 may note that the generator's own failure text is not withheld under `block`, because it carries only schema or system error text (DW-586).

**Governing ADs.**
- **AD-12:** handler-side input normalization and parameter construction only; no judgment moves.
- **AD-13:** namespace save and restore are unchanged.
- **AD-14:** bootstrap regeneration.
- **AD-15:** the sanctioned changes are in the CHANGELOG; pins cover everything else.
- **AD-33:** the route accepts `type=2` and returns a superset for `type=Error`.
- **AD-26:** no sniffing; the policy scope is unchanged.
- **AD-28:** agent content, generated skills and the mechanical checks.
- **AD-2:** cross-package gate in `iris-mcp-all`.
- **AD-5:** `:check` only.
- **AD-7:** no preset change.
- **AD-29:** changeset only.
- **Conventions:** Live gates, Live testing on a shared instance, Probes and references (earliest version verified: IRIS 2026.2 build 221U for `$ZTimeZone`, `Ens.DataType.LogType` and the logical binding), Tool results.

## Verification

Every command runs from `/Users/jbrandt/git/iris-execute-mcp-v2`, in the foreground, with `timeout: 600000`, one package per call.
- `ENV` is `IRIS_HOST=localhost IRIS_PORT=52773 IRIS_NAMESPACE=HSCUSTOM IRIS_USERNAME=_SYSTEM IRIS_PASSWORD=SYS IRIS_HTTPS=false IRIS_REQUIRE_LIVE=1`.
- Every MCP call names `server:"default"` and the namespace `HSCUSTOM`, `EXECMCPTMP400A` or `EXECMCPTMP400B`.

**Shared surfaces:** these change, and other tests assert on them.
- `BOOTSTRAP_VERSION` and `bootstrap-classes.ts`, including the dynamic read in `story-39-7-doc-claims.test.ts` (Task 12).
- The `trace-message-flow` body: interop `prompts.test.ts`, `prompt-safety-invariants.test.ts`, the 39.6 SDK-wire test and `skills/trace-message-flow/SKILL.md`.
- `GATES` (and its new `extraDriven` field), `gateTestFiles` and `live-gate-roster`.
- `header-row-oracle.ts` exports and `REPLACED_NAMES`.
- The `interop-namespace-fixture.ts` exports.
- The CHANGELOG's first section and the `tool_support.md` note order.
- The README prompt rows (39.6 doc-claims) and the interop README logs example.
- The values of `errorCount24h`/`messageCount24h` and of the `type` filter. No other test asserts them live.

Standing criterion: every test added or changed passes on a fresh environment, in either order.
- **Disposable fixtures.**
  - `EXECMCPTMP400A` (with `Story400.Seed` inside it) and `EXECMCPTMP400B`;
  - `ExecuteMCPv2.Temp.Story391Fixture` in HSCUSTOM.
- **The OS test class** is data-free. It sets and restores its own process's `$ZTimeZone`, and it runs one class per `iris_execute_tests` call, comparing `total` with 4 (Rule #35). Never re-submit on a client timeout; poll `iris_test_status`.

**Commands:**
- `(loop)` `iris_doc_load` with glob paths for `Monitor.cls`, `Interop.cls` and `EventLogMetricsTest.cls`, then compile -- expected: clean.
- `(loop)` `iris_execute_tests` `ExecuteMCPv2.Tests.EventLogMetricsTest` -- expected: total 4, 0 failures.
- `(loop)` `pnpm gen:bootstrap`, then `git diff --stat packages/shared/src/bootstrap-classes.ts` -- expected: one moved version, idempotent on a second run.
- `(loop)` `pnpm --filter @iris-mcp/shared build`, then `build` for dev, admin, interop and ops, one call each -- expected: success.
- `(loop)` `pnpm --filter @iris-mcp/interop exec vitest run src/__tests__/prompts.test.ts src/__tests__/monitor.test.ts src/__tests__/logs-diagram-policy.test.ts` -- expected: pass.
- `(loop)` `pnpm gen:skills`, then `pnpm gen:skills:check`, then `pnpm validate:prompts` -- expected: only the one SKILL.md changes; the checks exit 0 with 13 prompts.
- `(loop)` `pnpm --filter @iris-mcp/all exec vitest run src/__tests__/prompt-safety-invariants.test.ts src/__tests__/story-39-6-qa-forensics-prompts-sdk-wire.test.ts src/__tests__/skills-generated-frontmatter.test.ts src/__tests__/validate-prompts.test.ts src/__tests__/docs-prompt-sync.test.ts src/__tests__/story-39-6-doc-claims.test.ts src/__tests__/story-39-7-doc-claims.test.ts src/__tests__/story-40-0-doc-claims.test.ts src/__tests__/gate-helper-copies.test.ts src/__tests__/live-gate-roster.test.ts src/__tests__/interop-namespace-fixture.test.ts src/__tests__/bootstrap-version-check.test.ts` -- expected: pass.
- `(loop)` `pnpm --filter @iris-mcp/all exec vitest run src/__tests__/story-39-1-gate-guards.test.ts` -- expected: pass.
- `(loop)` `ENV pnpm --filter @iris-mcp/all exec vitest run src/__tests__/story-40-0-burn-down-live-gate.test.ts` -- expected: every test passes, none skipped, nothing left.
- `(loop)` `ENV pnpm --filter @iris-mcp/all exec vitest run src/__tests__/story-39-7-burn-down-live-gate.test.ts` -- expected: pass (with `eventLogOracle`).
- `(once)` For each of shared, dev, admin, interop, ops, data and client-config, one command each: `build`, `test`, `lint` and `type-check`. Then `ENV pnpm --filter @iris-mcp/all test`, split into calls that each finish inside the cap as in 39.7 -- expected: green.
- `(once)` One call each: `pnpm gen:governance-baseline:check` (exit 0, `1e62c5ad5bf7`/141), `pnpm gen:tools-list-snapshot:check` (OK, no re-pin), `pnpm measure:tools-payload` (equal to the README rows, unchanged) and `node scripts/check-epics-sync.mjs` (OK).
- `(once)` After every armed run:
  - `leftovers` for A and B is `[]`;
  - `iris_namespace_list` and `iris_database_list` show neither;
  - `iris_doc_list` (HSCUSTOM; `Story400`, `Story391Fixture` and `ExecuteMCPv2.Temp.`; generated included) is empty.

**Planned mutations (Rule 19).** For each one: apply it, observe red, revert, then reload, redeploy or rebuild whatever it touched. Confirm that `git status --short` and `git diff --stat` are unchanged, and record it as `mutation: <change> -> <test that went red>`.
- **AC-1:**
  - restore `Type = 3` → the gate's metrics row (it reads 1);
  - have `UtcCutoff` default to `$Horolog` → `TestUtcCutoffIgnoresProcessTimeZone`;
  - restore the old cutoff → the gate's metrics row (4 and 3). Run this one only when the UTC day is at least 5 min old.
- **AC-2:**
  - bind `tType` directly → the gate's per-type rows;
  - map `"Error":3` → `TestLogTypeValueMatchesLogType`.
- **AC-3:** make `LogTypeValue` call `##class(Ens.DataType.LogType).DisplayToLogical` → the B logs row (the texts differ).
- **AC-4:** make `diagram.ts` also rewrite `Generation failed for session` warnings under `block` → the non-error-warning row of `logs-diagram-policy.test.ts`. Revert it; no Diagram change ships.
- **AC-5:**
  - drop the step-5 text → `prompts.test.ts` and `prompt-safety-invariants.test.ts`;
  - skip `gen:skills` → `gen:skills:check`.
- **AC-6:** drop "enabled by default" from the ops README line → `story-40-0-doc-claims`.
- **AC-7:** restore the dynamic version read in `story-39-7-doc-claims` → red after the bootstrap move.
- **AC-8:** remove the gate's ops freshness line → the 39.1 guard's source-order row.

### Results (implement stage, 2026-10-17)

Every command ran from `/Users/jbrandt/git/iris-execute-mcp-v2`, in the foreground. Every IRIS call named `server:"default"` and the namespace HSCUSTOM, `EXECMCPTMP400A` or `EXECMCPTMP400B`. Armed runs used `IRIS_HOST=localhost IRIS_PORT=52773 IRIS_NAMESPACE=HSCUSTOM IRIS_USERNAME=_SYSTEM IRIS_PASSWORD=SYS IRIS_HTTPS=false IRIS_REQUIRE_LIVE=1`.

**BOOTSTRAP_VERSION:** `7d12cd8b3a1e` -> `08b8adeaadc6` (`pnpm gen:bootstrap`, 32 classes; a second run gave the identical file hash). A repeated generator run rewrites an identical `bootstrap-classes.ts` with a newer mtime, and `tsc` then emits nothing, so the shared dist looked stale to the armed gates (`checkDistFresh`); deleting `packages/shared/dist` and `tsconfig.tsbuildinfo` and rebuilding cleared it.

**Commands and results**
- Live capture (Rule #36), `ExecuteMCPv2.REST.Monitor:UtcCutoff` via `iris_execute_classmethod`: `(86400, "67860,79328.804084877")` -> `2026-10-16 22:02:08.804`; `(86400, "67860,3600.5")` -> `2026-10-16 01:00:00.500`; `(3600, "67860,1800.25")` -> `2026-10-16 23:30:00.250`; `(0, "67860,0")` -> `2026-10-17 00:00:00.000`. These are the `TestUtcCutoffFixedInstant` values.
- `iris_doc_load` with glob paths for `Monitor.cls`, `Interop.cls`, `EventLogMetricsTest.cls`, each compiled: clean.
- `iris_execute_tests` `ExecuteMCPv2.Tests.EventLogMetricsTest`: total 4, 0 failures (4 `Test*` methods; last run after all mutations reverted, runIndex 975).
- Builds of shared, dev, admin, interop, ops: success. `pnpm gen:skills`: only `skills/trace-message-flow/SKILL.md` changed; `pnpm gen:skills:check`: OK, 14 files, no drift; `pnpm validate:prompts`: OK, 26 sources (13 prompts + 13 skills), 110 known tool names.
- `@iris-mcp/interop` `prompts.test.ts`, `monitor.test.ts`, `logs-diagram-policy.test.ts`: 76 passed.
- `@iris-mcp/all` loop batch (12 files: prompt-safety-invariants, 39.6 SDK-wire, skills-generated-frontmatter, validate-prompts, docs-prompt-sync, 39.6/39.7/40.0 doc-claims, gate-helper-copies, live-gate-roster, interop-namespace-fixture, bootstrap-version-check): 281 passed. `story-39-1-gate-guards.test.ts`: 45 passed (the 40.0 gate included, `extraDriven: ["iris-ops-mcp"]`).
- Armed `story-40-0-burn-down-live-gate.test.ts`: 9 passed, none skipped (the first run had 1 failure: the not-configured logs row compared the whole tool text, which names the request URL, `&type=Error` included; it now compares the text after `Details: `, which is IRIS's own and is identical). Armed `story-39-7-burn-down-live-gate.test.ts` (with `eventLogOracle`): 18 passed.
- Per package `build`, `test`, `lint`, `type-check` (all exit 0): shared 2065 tests (lint: 1 pre-existing warning in `cli/governance.ts`), dev 1434, admin 498, interop 670, ops 350, data 165, client-config 514. `@iris-mcp/all`: `build` and `lint` exit 0 (it has no `type-check` script); armed `test` in three groups by file name, each finishing inside the cap: `[a-r]*` 25 files / 254 tests, `se* sk* st[a-n]* story-38-* story-39-0/1/2*` 29 files / 530 passed + 2 skipped, `story-39-[3-7]* story-40-* t* v*` 27 files / 790 passed + 2 skipped. That is all 81 test files. The 4 skips are the existing capture-mode skips of the 39.1 to 39.4 live gates, which this story did not touch.
- `pnpm gen:governance-baseline:check`: OK, 141 frozen keys all present (`governance-baseline.ts` unmodified); `pnpm gen:tools-list-snapshot:check`: OK, 114 entries unchanged, no re-pin; `pnpm measure:tools-payload`: rows equal the README (dev 32/15, admin 27/13, interop 25/12, ops 22/10, data 8/8); `node scripts/check-epics-sync.mjs`: OK.
- After the armed runs: the gate's `afterAll` asserted `leftovers` for A and B empty; checked again independently: `iris_namespace_list` and `iris_database_list` show neither namespace nor database; `iris_doc_list` (HSCUSTOM, generated included) for `Story400` and `ExecuteMCPv2.Temp.` is empty. `EventLogMetricsTest` stays loaded in HSCUSTOM, as the other `ExecuteMCPv2.Tests.*` classes do.
- AC-4: `git diff --stat -- src/ExecuteMCPv2/Diagram packages/iris-interop-mcp/src/tools/diagram.ts` is empty, and `logs-diagram-policy.test.ts` passes (22 tests).

**DW-586 evidence for the lead's adjudication (AC-4, R4).** No code change. The plan-stage probes (Design Notes) show the generator's failure text cannot carry message-derived content: the only constructed statuses are the two `Loader.cls` SQL `%Message` templates (the first probe text is `Generation failed for session 400001: SQL error:  Table 'ENS.MESSAGEHEADER' not found`), every other status is a system exception's name and location, 230 CJK characters plus a marker in `ErrorStatus` rendered normally, and a 40,000-character subscript raises `<SUBSCRIPT>` without echoing the value. The AC-4 pin (`logs-diagram-policy.test.ts`, "a warning that is not an error warning is untouched") stays green and was mutation-verified below. Recommended ledger terminal: `wontfix-theoretical`, `reopen_if` a Diagram stage returns a `%Status` built from header field values.

**Interpretation to confirm.** The matrix row "Not configured" says both logs calls carry "the identical text (the SQL table error)". The tool's message names the request, so the full texts differ by the `&type=Error` in the URL. The gate compares IRIS's own error text (after `Details: `), which is identical, and also asserts it names the missing table and not `LogType`.

**Mutations (Rule 19).** Each was applied, observed red, reverted and reloaded or rebuilt; after the OS-class group, the prompt group and the doc and guard group, a hash of `git diff` plus the untracked files equalled the pre-mutation hash. The last one (the seed guards) was checked by the green re-run of the gate and by both guard lines being present in the diff. The old-cutoff mutation ran at 22:27 UTC (the UTC day was 22 h old).
- mutation: `CollectInteropMetrics` `Type = 2` -> `Type = 3` -> gate row "metrics for A: errorCount24h 3 ..." red.
- mutation: `UtcCutoff` default `pNow` `$ZTimeStamp` -> `$Horolog` -> `EventLogMetricsTest.TestUtcCutoffIgnoresProcessTimeZone` red (both zones, 420 and -600).
- mutation: `CollectInteropMetrics` cutoff -> the old `$ZDateTime($Horolog - 1, 3)` -> gate row "metrics for A" red, reading `errorCount24h` 4 and `messageCount24h` 3.
- mutation: `EventLog` binds `tType` directly instead of `..LogTypeValue(tType)` -> gate rows "each of the six display names", "Error plus itemName" and "the raw route still answers type=2" red.
- mutation: `LogTypeValue` `"Error":2` -> `"Error":3` -> `EventLogMetricsTest.TestLogTypeValueMatchesLogType` red.
- mutation: `LogTypeValue` calls `##class(Ens.DataType.LogType).DisplayToLogical` -> gate row "iris_production_logs for B is an error with and without type Error" red (`<CLASS DOES NOT EXIST>LogTypeValue *Ens.DataType.LogType` against the table error).
- mutation: `diagram.ts` `ERROR_WARNING` also matches `Generation failed for session` -> `logs-diagram-policy.test.ts` "a warning that is not an error warning is untouched" red; reverted, `git diff` of `diagram.ts` empty.
- mutation: drop the step-5 sentence of `traceMessageFlow.ts` -> `prompts.test.ts` "under `block`, reports the reason ..." red; after an interop rebuild, `prompt-safety-invariants.test.ts` "every trace-message-flow rendering reports the reason ..." red and `pnpm gen:skills:check` DRIFT (the stale-`SKILL.md` case of "skip `gen:skills`").
- mutation: drop the step-6 clause of `traceMessageFlow.ts` -> `prompt-safety-invariants.test.ts` new `it` and `story-39-6-qa-forensics-prompts-sdk-wire.test.ts` "trace-message-flow with namespace omitted renders ..." red.
- mutation: ops README "(a read, enabled by default)" -> "(a read)" -> `story-40-0-doc-claims.test.ts` "states what errorCount24h and messageCount24h count ..." red.
- mutation: `story-39-7-doc-claims.test.ts` literal `7d12cd8b3a1e` -> the dynamic read of the embed -> its CHANGELOG-move row, its changeset row and its `tool_support.md` note row red.
- mutation: remove the `skipReason ??= staleDistReason(REPO_ROOT, "iris-ops-mcp");` line of the 40.0 gate -> `story-39-1-gate-guards.test.ts` "'Story 40.0': ... derives its skip reason from the shared dist and every driven dist ..." red (the nested unarmed and armed rows stay green by design: a fresh ops dist gives the same reason text).
- mutation: re-declare a local `logOracle` in the 39.7 gate -> `gate-helper-copies.test.ts` "no gate declares a replaced name" red.
- mutation: remove the `^Ens.Util.LogD` guard line from `STORY400_SEED_SOURCE` -> `interop-namespace-fixture.test.ts` "the Story 40.0 seed refuses ..." red.
- mutation: remove both guard lines (headers and Event Log) from `STORY400_SEED_SOURCE` -> gate row "the seed refuses a namespace that already holds rows" red (a re-seed returned `{"logs":"11,...","headers":"4,5,6"}`), plus the metrics and type rows.

**Review pass (2026-10-17).** Seven patch rows, all test-only (no `.cls`, no embed change): the 40.0 doc-claims test reads the embed's `BOOTSTRAP_VERSION` and asserts it equals the documented `08b8adeaadc6`; the unfalsifiable constant assertion in `story-39-7-doc-claims.test.ts` is deleted; `liveLogTypes` asserts six `DISPLAYLIST` pieces; `prompts.test.ts` asserts steps 4 and 5 on `build({})`. Mutations (tree hash of `git diff` plus the untracked files equal before and after, `bootstrap-classes.ts` md5 `fd970cef3677bd2e5e6bf66faccf4c9e` before and after, the shared dist rebuilt after the embed edit):
- mutation: embed `BOOTSTRAP_VERSION` `08b8adeaadc6` -> `000000000000` -> `story-40-0-doc-claims.test.ts` "states that no tool, key, preset row or count moves, and the bootstrap move as literals" red (`expected '000000000000' to be '08b8adeaadc6'`).
- mutation: `liveLogTypes` query `parent = 'Ens.DataType.LogType'` -> `'Ens.DataType.LogTypeX'` -> gate row "each of the six display names ..." red on its own (`DISPLAYLIST holds the six types the tool offers: expected +0 to be 6`); before the patch the row passed with zero iterations.
- The `build({})` step 4 and 5 assertions extend the `it` pinned by the "drop the step-5 text" and "drop the step-6 clause" mutations above; they fail on the same edits.

**Re-verification after the patches.** The `(loop)` lines all re-ran green (`gen:bootstrap` idempotent at `08b8adeaadc6`, with the shared dist cleaned and rebuilt after it; loads and compiles clean; `EventLogMetricsTest` total 4; interop 76; the `@iris-mcp/all` batch 281; the guard 45; armed 40.0 gate 9; armed 39.7 gate 18). The `(once)` lines ran once after the last patch: shared 2065, dev 1434, admin 498, interop 670, ops 350, data 165, client-config 514 tests, with build, lint and type-check at exit 0 for each; `@iris-mcp/all` build and lint exit 0 and its armed tests in three groups (25 files / 254 tests; 29 files / 530 passed + 2 skipped; 27 files / 790 passed + 2 skipped, 81 files in all; the 4 skips are the 39.1 to 39.4 capture-mode skips); governance `:check` OK (141 frozen keys, baseline file unmodified); `gen:tools-list-snapshot:check` OK (114 entries, no re-pin); `measure:tools-payload` rows equal the README; `check-epics-sync.mjs` OK. After the armed runs `iris_namespace_list` and `iris_database_list` show no `EXECMCPTMP400` entry, and `iris_doc_list` (HSCUSTOM, generated included) for `Story400`, `Story391Fixture` and `ExecuteMCPv2.Temp.` is empty.

## Auto Run Result

Status: done
Blocking condition: none

- **Summary.** DW-584, DW-585 and DW-587 are fixed, and DW-586 is closed with evidence and no code change.
  - DW-584: `Monitor.cls` gains `UtcCutoff`; `CollectInteropMetrics` computes one UTC cutoff, counts `Type = 2` for `errorCount24h`, and binds the same cutoff to `messageCount24h` (OD-1, decided as recommended by orchestrator decision #38).
  - DW-585: `Interop.cls` gains `LogTypeValue`, bound in `EventLog`; a number or an unknown value passes through unchanged.
  - DW-587: the three `trace-message-flow` step texts, verbatim, with `SKILL.md` regenerated.
  - `BOOTSTRAP_VERSION` moves `7d12cd8b3a1e` -> `08b8adeaadc6`. No tool, action, key, preset row or count moves.
- **Files changed.**
  - Source: `src/ExecuteMCPv2/REST/Monitor.cls`, `src/ExecuteMCPv2/REST/Interop.cls`, `packages/iris-interop-mcp/src/prompts/traceMessageFlow.ts`, the generated `packages/shared/src/bootstrap-classes.ts` and `skills/trace-message-flow/SKILL.md`.
  - New tests: `src/ExecuteMCPv2/Tests/EventLogMetricsTest.cls` (4 methods), `story-40-0-burn-down-live-gate.test.ts` (9 rows), `story-40-0-doc-claims.test.ts`.
  - Changed tests and fixtures: `header-row-oracle.ts` (`eventLogOracle`), `interop-namespace-fixture.ts` and its test (fixture xi), `story-39-1-gate-guards.test.ts` (`extraDriven`), `story-39-7-burn-down-live-gate.test.ts`, `story-39-7-doc-claims.test.ts`, `gate-helper-copies.test.ts`, `prompts.test.ts`, `prompt-safety-invariants.test.ts`, `story-39-6-qa-forensics-prompts-sdk-wire.test.ts`, `prepublish-gate.mjs`.
  - Docs: the ops and interop READMEs, the root README prompt row, `tool_support.md`, `CHANGELOG.md`, `.changeset/story-40-0-epic-39-deferred-cleanup.md`.
- **Review findings.** 26 findings from the four layers: low 20, false 6, high 0, medium 0 (counted from the triage log).
  - Patched (7 rows, 4 root causes, test-only): the 40.0 doc-claims test now ties the documented bootstrap move to the embed (3 rows); an unfalsifiable constant assertion in the 39.7 doc-claims test is deleted; `liveLogTypes` asserts six pieces so the six-name row cannot loop zero times (2 rows); `build({})` asserts steps 4 and 5 verbatim.
  - Deferred (2): `AlertsManage` `clearedAt` labels local time as UTC; the `recover-stuck-production` prompt has no report-the-reason rule under `block`.
  - Rejected (17), each with its reason in the triage log: spec-bound (lower-case `type` matches nothing; "identical text" compared as IRIS's detail; the Task 13 document set), unreachable (a throw from `UtcCutoff`), already covered (mutation lines exist for every AC), and the TZ-wiring residual below.
- **Follow-up review recommended:** false (no patched entry was high or medium).
- **Verification.** Everything in `## Verification` ran green on the final tree, the `(loop)` lines again after the patches and the `(once)` lines once after the last patch; the numbers are in `## Verification`. 15 mutations from the implement pass and 2 from this review (17 `mutation:` lines) were applied, observed red and reverted, with the tree hash unchanged.
- **For the lead.**
  - Interpretation to confirm: the not-configured logs row compares IRIS's error text after `Details: `, because the tool's message names the request URL. (Records: `## Verification`, "Interpretation to confirm".)
  - `gen:bootstrap` rewrites an identical `bootstrap-classes.ts` with a newer mtime, and `tsc` then emits nothing, so the shared dist looks stale to the armed gates (`checkDistFresh`). After every `gen:bootstrap` run, `rm -rf packages/shared/dist packages/shared/tsconfig.tsbuildinfo` and rebuild shared before any armed gate. Both paths are gitignored.
  - DW-586 evidence is in `## Verification`; recommended ledger terminal `wontfix-theoretical`, `reopen_if` a Diagram stage returns a `%Status` built from header field values.
  - Spine follow-up (Rule 20) is the lead's: AD-15's sanctioned list gains Story 40.0 and AD-26 may note the DW-586 finding.
- **Residual risks.**
  - The process-time-zone half of DW-584 is pinned on `UtcCutoff` in IRIS and not on `CollectInteropMetrics` itself: this instance runs at `$ZTimeZone` 0 and the OS class is data-free by design. A rewrite of the call to a full-precision local cutoff would pass the live gate.
  - `EventLogMetricsTest` runs through `iris_execute_tests` on the instance, like the other `ExecuteMCPv2.Tests.*` classes, and is not part of the vitest default suite.
  - The next story that moves `BOOTSTRAP_VERSION` must turn `BOOTSTRAP_FROM`/`BOOTSTRAP_TO` of `story-40-0-doc-claims.test.ts` into history literals, as this story did for 39.7.
