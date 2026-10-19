---
title: 'Story 39.6: Message Forensics Docs, Prompt and Capstone'
type: 'feature'
created: '2026-10-17'
status: 'done'
baseline_revision: '32fb063dae90b3ef2d31b0d2b28e0917aeea3302'
baseline_commit: '32fb063dae90b3ef2d31b0d2b28e0917aeea3302'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/.claude/rules/project-rules.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-iris-execute-mcp-v2-2026-10-14/ARCHITECTURE-SPINE.md'
warnings:
  - oversized
deferred: []
---

<intent-contract>

## Intent

**Problem:** Epic 39 shipped message search (`headers`, `body`, `searchTable`), the PHI data policy and the body reader, each with only minimal docs (Rule #43). Several gaps remain:
- No prompt teaches the forensic loop of search, read and diagram: `trace-message-flow` predates both new tools.
- No prompt finds a patient's messages by a Search Table value.
- No single gate proves the whole loop end to end under the policy.
- The live gates carry their own copies of the same helpers, and the capstone would be the next copy (DW-561).
- No test pins that existing tools' `tools/list` entries stay unchanged (DW-573).

**Approach:**
- Enrich every doc surface with the epic's tools, modes, policy configuration and default states (Docs table in Design Notes).
- Update `trace-message-flow` to search, read and diagram, keeping its name, title and arguments unchanged. Add the interop prompt `find-patient-messages`. Regenerate the skills.
- Close the epic with one default-suite capstone, `epic39-capstone-gate.test.ts`. It drives the built servers over the real MCP SDK client against the disposable namespace `EXECMCPTMP396A`. It first asserts that the deployed `BOOTSTRAP_VERSION` equals the shipped one, and is proven red by disabling redaction.
- Promote the duplicated gate helpers into `process-gate-helpers.ts` and move every gate onto them (DW-561).
- Pin every current `tools/list` entry in a generated snapshot with a `--check` mode (DW-573).

## Boundaries & Constraints

**Always:**
- **Docs (AC 39.6.1).** Each Docs-table item states its default state on every surface listed for it (Rules #30/#43), names the operator controls that affect it, and keeps every pinned sentence of 39.0–39.5 intact.
  - **`CHANGELOG.md`.** A new top section `## [Pre-release — 2026-10-17] — Story 39.6: Message forensics docs, prompt and capstone`, with `### Added`, `### Changed`, `### Documentation` and `### Tests`. It holds no `(full|core|developer) N/N/N/N/N` string and quotes no other story's section title.
  - **Changeset.** `.changeset/story-39-6-message-forensics-docs-prompt-and-capstone.md` with exactly `"@iris-mcp/interop": minor`.
- **`trace-message-flow` (AC 39.6.2).**
  - **Unchanged.** `name`, `title` and `arguments` stay byte-identical: `sessionOrHeaderId` (required) and `namespace` (optional), with the same descriptions.
  - **Changed** (sanctioned by AC 39.6.2; recorded under CHANGELOG "Changed"):
    - `description` names `iris_message_search`, `iris_message_body`, `iris_message_diagram` and `iris_production_logs`;
    - `build()` becomes the flow in Design Notes, Prompts, in order.
- **`find-patient-messages` (AC 39.6.2)** is a new interop `PromptDefinition`, registered last in `prompts/index.ts`, with the title "Find Patient Messages".
  - **Arguments.** `patientId` is required; `from`, `to`, `searchTableClass` and `namespace` are optional.
  - **Body.** The flow in Design Notes, Prompts.
- **Both prompts.**
  - Every `iris_*` token is a tool in interop `core` or `iris_server_profiles`.
  - They name no internal rule number and no repository path (AD-28).
  - They never tell the agent to loosen the policy, or to read a withheld body or a refused lookup any other way.
  - They never sweep: every search has a window of at most 7 days, and the agent asks the user for a longer period.
- **Skills.** `skills/` changes only through `pnpm gen:skills`; `gen:skills:check` and `validate:prompts` are clean.
- **Capstone (AC 39.6.3, Rules #21/#59).** One file, `packages/iris-mcp-all/src/__tests__/epic39-capstone-gate.test.ts`, in the default suite.
  - **Arming.**
    - It has its own `process.env.IRIS_REQUIRE_LIVE ===` comparison.
    - It checks dist freshness with the literal 39.x lines: `skipReason = staleDistReason(REPO_ROOT, "shared");` and the `for (const pkg of ["iris-dev-mcp", "iris-admin-mcp", "iris-interop-mcp"]) skipReason ??= …` line.
    - Unarmed, it skips with `[SKIP] epic39-capstone-gate: <reason>`. Armed, it throws `IRIS_REQUIRE_LIVE is set, so the Epic 39 capstone live gate may not be skipped: <reason>`.
  - **Version check.** `dev = await openWireSession(...)` is followed, at most one line later, by `await assertDeployedBootstrapVersion(REPO_ROOT, TARGET);`, before any `describe` runs.
  - **Rosters.** It is listed in `prepublish-gate.mjs` `gateTestFiles` and in `story-39-1-gate-guards.test.ts` `GATES` (`story: "Epic 39 capstone"`).
  - **What it drives.** The built dev, admin and interop dists, through the SDK `Client` over stdio. Every call names `server:"default"` and an explicit namespace. The independent oracle is raw Atelier SQL: `header-row-oracle.ts` `oracleColumns`/`expectedRow`/`searchTableOracle`.
- **Fixture μ** is synthetic and lives only in the mapping-only interop namespace `EXECMCPTMP396A`.
  - It uses the classes `Story396.Seed` and the reused `Story394.SearchTable`, compiled there, and the HSCUSTOM fixture class `ExecuteMCPv2.Temp.Story391Fixture`.
  - No production is started.
  - Identifying values contain `SYNTHPHI396` and appear only in PID-3 and OBX-5. Surviving values contain `KEEPME396`, in OBX-3. Times fall on 2001-02-03 UTC.
  - **Lifecycle.** `beforeAll` removes leftovers and asserts none, then creates and seeds the namespace and runs a positive leftovers control. `afterAll` guards each teardown step separately: the namespace, `leftovers`, the fixture class, the temp dir, and an `iris_doc_list` (HSCUSTOM, generated included) showing no `Story391Fixture` or `Story396` document.
- **DW-561.**
  - **What moves.** Every family in the Design Notes Promotion table becomes one export of `process-gate-helpers.ts`, and every listed copy is replaced by a call to it.
  - **What stays local.** A copy is replaced only where it is behaviorally identical: the same pass/fail condition, the same `[SKIP]`/"may not be skipped" text, and the same timing constants (passed as arguments). A variant with a different contract stays local and is listed in the table with its reason.
  - **Guarded literals.** Every gate keeps literally, in its own file:
    - its `REQUIRE_LIVE` comparison;
    - its dist-freshness lines;
    - its `admin =`/`dev = await open…Session(` line with the version assert right after it;
    - its skip tag and its armed text (the `epic38-gate-guards`, `story-39-1-gate-guards` and `live-gate-roster` pins).
  - **Results.** Every moved gate's assertions are unchanged and it passes armed. A new default-suite guard, `gate-helper-copies.test.ts`, fails when a gate re-declares a replaced name.
- **DW-573.**
  - **Where.** One core module, `scripts/lib/tools-list-snapshot-core.mjs`, is shared by the CLI `scripts/gen-tools-list-snapshot.mjs` and the default-suite test `packages/iris-mcp-all/src/__tests__/tools-list-snapshot.test.ts` (Rule #45, AD-2).
  - **The capture.** The real `tools/list` of all five built servers (`McpServerBase` construction plus `fetchAllTools`, with `IRIS_TOOLS_*` scrubbed, i.e. preset `full`) is written to `packages/iris-mcp-all/src/__tests__/fixtures/tools-list-snapshot.json`.
  - **The CLI.** It refuses without a flag. `--check` writes nothing and exits 0 or 1. `--force` writes. A stale dist exits 2 with "rebuild".
  - **The check is one-directional.** Every snapshot entry must still be listed, and its `title`, `description`, `inputSchema` and `annotations` (and `outputSchema` when present) must deep-equal after a sorted-key canonicalization. A live tool absent from the snapshot is reported and allowed.
- **Counts.** Tools stay 109 package / 114 advertised. Interop `core` stays 12 runtime. Prompts go 12 → 13 (interop 3 → 4). The baseline stays `1e62c5ad5bf7`/141. `BOOTSTRAP_VERSION` stays `2fd17b50a024` (the epic: `089f8f0a62b2` → `2fd17b50a024`).
- **Source text.** Source is ASCII, with escapes for anything else (Rule 14). Comments state the contract. Every live run names its target with the six `IRIS_*` variables and `IRIS_REQUIRE_LIVE=1`.

**Never:**
- **Tools.** No tool, action, key, preset row, `TOOL_PAIRS` entry, annotation, schema or description change. No new environment variable.
- **IRIS side.** No ObjectScript change. No change to the scope table rows or their date.
- **Generated and protected files.** No hand edit under `skills/`, of `bootstrap-classes.ts` or of `governance-baseline.ts`. Never run the bare governance-baseline generator. Never edit the snapshot by hand.
- **Shared instance.** Never start a production anywhere. Never call `EnableNamespace`. Never read HSCUSTOM's or another project's messages. Fixtures are synthetic only.
- **Docs.** No claim of regulatory compliance. No new `####` heading inside the interop `#### iris_message_search` or `#### iris_message_body` subsection. No `` `interop` `` followed by a number in `tool_support.md` before its prompt-pack line. The "What it governs today." paragraph is not split.
- **Owned elsewhere.** Do not fix DW-569, DW-571, DW-572, DW-576, DW-578 or DW-583.
- **Release.** No `changeset version` and no publish. No `pregen` turbo hook.

## I/O & Edge-Case Matrix

**Fixture μ** (`EXECMCPTMP396A`, `Story396.Seed.Seed()`). Every header is a Request, Completed, with no error. Each HL7 v2 message is MSH (no `SYNTHPHI`), then `PID|1||<mrn>`, then `OBX|1|TX|KEEPME396-CODE^KEEPME396-TEXT^L||SYNTHPHI396-NOTE`, with CR terminators. Each message is indexed with `$ClassMethod("Story394.SearchTable","IndexDoc",msg)`.

| H | Session | Source → target | Body | PID-3 | `TimeCreated` |
|---|---|---|---|---|---|
| 1 | 396001 | `Story396.Service` → `Story396.Router` | M1 `ADT^A01` | `SYNTHPHI396-MRN-P` | 2001-02-03 12:00:01 |
| 2 | 396001 | `Story396.Router` → `Story396.Operation` | M1 | (same body) | 12:00:02 |
| 3 | 396002 | `Story396.Service` → `Story396.Router` | M2 `ADT^A08` | `SYNTHPHI396-MRN-P` | 12:00:03 |
| 4 | 396003 | `Story396.Service` → `Story396.Router` | M3 `ADT^A01` | `SYNTHPHI396-MRN-Q` | 12:00:04 |

`Seed` returns `{"headers":"1,2,3,4","hl7":"1,2,3"}`. W is 2001-02-03T11:59:00Z to 12:01:00Z.

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Leg 1, traffic generated | after `beforeAll` | The oracle sees headers 1–4 with the table's bodies. `EnsLib_HL7.SearchTable` holds `synthphi396` (positive control). A second `Seed()` in A is refused, because A already holds headers | refusal text |
| Leg 2, header search | default session; `headers`, W; then `sessionId: 396001` | Rows equal `expectedRow` of the oracle, in order: 1–4, then 1 and 2. `JSON.stringify(result)` holds no `SYNTHPHI` | none |
| Leg 3, Search Table lookup | default session; `searchTable`, W, `searchTableClass:"EnsLib.HL7.SearchTable"`, `[{property:"PatientID", op:"eq", value:"SYNTHPHI396-MRN-P"}]` | Rows 1, 2 and 3 equal `searchTableOracle` (`s.PropValue = 'synthphi396-mrn-p'`), and 4 never appears. `dataPolicy {redact,0,0}`. The result holds no `SYNTHPHI` (no echo) | none |
| Leg 4, read under `redact` | the audited default session (`IRIS_AUDIT_LOG`, `IRIS_AUDIT_LOG_PARAMS=true`, `LOG_LEVEL=DEBUG`): the leg-3 lookup, then `iris_message_body` with its row IDs | 3 items in order, each `bodyKind:"hl7v2"`, `bodyPolicy.outcome:"redacted"`, `format:"er7"`, and a `text` containing `KEEPME396-CODE`; `dataPolicy {redact,3,0}`. Neither result's JSON, nor the audit file, nor stderr holds `SYNTHPHI`. The lookup's audit entry logs `filters` as `"[REDACTED]"` | none |
| Leg 5, read under `allow` | a session with `IRIS_DATA_POLICY=allow`; the same chain | Each `text` contains `SYNTHPHI396-MRN-P`, `SYNTHPHI396-NOTE` and `KEEPME396-CODE`; `bodyPolicy.outcome:"none"`; `dataPolicy {allow,0,0}` (positive control for leg 4) | none |
| Red proof (Rule #59) | `applyBodyReaderPolicy`'s `redact` branch returns `raw.bodyText` unredacted; interop rebuilt | Leg 4 fails on `SYNTHPHI`, and leg 5 stays green. The guarded path: SDK `Client` → built interop dist over stdio → `iris_message_body` → `applyBodyReaderPolicy` → `redactHl7` | test failure |
| Capstone, unarmed / armed | a closed port (`story-39-1-gate-guards` nested run) | Every test skips with the tag; armed, it fails with "Epic 39 capstone live gate may not be skipped" | skip / failure |
| `trace-message-flow` get | `{sessionOrHeaderId:"7"}` (namespace omitted, Rule #46); then with `namespace` | One user message, its steps in order: `iris_production_messages`, `iris_message_search` `headers`, `iris_message_body`, `iris_message_diagram`, `iris_production_logs`. The `prompts/list` entry's `name`, `title` and `arguments` equal today's literal | none |
| `find-patient-messages` get | `{patientId:"X"}` only; then all five arguments | Each step in order. With no `from`, it tells the agent to ask the user for the period. With `searchTableClass` omitted, it uses `EnsLib.HL7.SearchTable` | none |
| Skills | `pnpm gen:skills` | `skills/find-patient-messages/SKILL.md`, a regenerated `trace-message-flow`, and README rows; `--check` and `validate:prompts` clean | `--check` exits 1 on drift |
| Snapshot, match | built dists, `pnpm gen:tools-list-snapshot:check` and the test | OK. 114 entries over 5 servers. `iris_server_profiles` is identical on all five | none |
| Snapshot, drift | one character appended to one tool's description, package rebuilt | The test and `--check` fail, naming `<pkg> <tool>.description` and the first differing path | exit 1 / failure |
| Snapshot, new or vanished tool | core compare on synthetic inputs | A new tool is reported and passes; a vanished one fails, naming it. An empty snapshot, or one missing a package, fails | failure |
| Snapshot, stale dist or no flag | a `src` file newer than its dist; the CLI with no flag | Exit 2 with "rebuild"; refuses and writes nothing | exit 2 / refusal |
| Helper copies guard | a gate re-declares a replaced name (`function entryOf(`) | `gate-helper-copies.test.ts` fails, naming the file and the name; kept variants pass | failure |

</intent-contract>

## Code Map

**Prompts**
- `packages/iris-interop-mcp/src/prompts/traceMessageFlow.ts`: `name`/`title` :14-15, description :16-19, arguments :20-32, `build()` :33-52 (steps :47-51). Helpers `argOrPlaceholder as arg` and `isArgProvided` come from `@iris-mcp/shared` (`prompt-helpers.ts:20,29`).
- `packages/iris-interop-mcp/src/prompts/index.ts:12-21`: append `findPatientMessagesPrompt` last. The new file is `findPatientMessages.ts` (camelCase, the directory's convention). The sibling to follow is `recoverStuckProduction.ts` / `resendFailedMessages.ts`.
- `packages/shared/src/tool-types.ts:176-228`: `PromptArgumentDefinition` and `PromptDefinition`. There is no skill or preset field (Epic 41).
- Interop core (`packages/iris-interop-mcp/src/tools/presets.ts:32-44`) includes `iris_production_messages`, `_logs`, `iris_message_search`, `iris_message_body` and `iris_message_diagram`.
- Facts the prompt text relies on:
  - **`searchTable`** (`message-search.ts:372-420`): `from` is required, at most 7 days; `searchTableClass` is required; the `EnsLib.HL7.SearchTable` property `PatientID` covers PID-2, every PID-3 repetition and PID-4. Values ignore case. No match does not prove absence. An unknown property's error lists the class's properties (`MessageSearch.cls:600`). `notApplicable` appears when no Search Table is configured (`message-search.ts:674`). `DATA_POLICY_BLOCKED` comes under `block` (:578-585).
  - **`iris_message_body`** (`message-body.ts:301-357`): 1–20 `headerIds`; `dataPolicy` is tighten-only.
  - **`iris_message_diagram`** (`diagram.ts:68-72`): `sessionIds` 1–20.
  - **Logging.** Prompt rendering is neither logged nor audited (`server-base.ts:1029-1150` `registerPrompt` has no logger or audit call), so a `patientId` argument reaches only the model.
- Pins that move:
  - **Interop.** `packages/iris-interop-mcp/src/__tests__/prompts.test.ts`: `OWN_PROMPT_NAMES` :34 (3 → 4) and title :91. Harness: `callRequest` :54-71, `makeRealServer` :73-81. Model for a `build()` test: :127-150.
  - **Other packages.** `FOREIGN_PROMPT_NAMES` in dev `prompts.test.ts:42-49`, admin :34-43 and ops :30-39: add `find-patient-messages`.
  - **`iris-mcp-all`:**
    - `docs-prompt-sync.test.ts` `EXPECTED_COUNTS` :48-53 (interop 4) and comment :22;
    - `validate-prompts.test.ts` :67 and :81 (13);
    - `skills-generated-frontmatter.test.ts` :10, :41-54 (13 names) and :117;
    - `story-38-6-doc-claims.test.ts` :289 (the heading becomes "13 prompts") and :303 (the pack sentence becomes 13 prompts, with interop 4 and the other counts unchanged).
  - **AD-28 checks.** `prompt-safety-invariants.test.ts` :41-48 has `findPrompt`. The core-only check is at :430-448, and it reads the dev `dist/tools/presets.js`. The no-rule/no-path check is at :450-455, and it covers only the two dev prompts (:344-354). Add an interop `describe` on the same pattern.
- `scripts/gen-skills.mjs` (:55-70, writes `skills/<name>/SKILL.md` and the `skills/README.md` row; a `|` in a description breaks the table) and `scripts/validate-prompts.mjs` (`iris_*` tokens only) both load `packages/<pkg>/dist/prompts/index.js`, so rebuild interop first. Root `package.json:18-20`.

**Capstone and fixture**
- `packages/iris-mcp-all/src/__tests__/interop-namespace-fixture.ts` (1419 lines):
  - **Reused unchanged:** `createInteropNamespace` :414, `removeInteropNamespace` :455, `putFixtureClass` :390, `removeFixtureClass` :401, `leftovers` :1414, `STORY394_SEARCH_TABLE_SOURCE` :848, and the private `putCompileSeed` :1011. `Story391Fixture.Add` :79 (`pSession, pType, pStatus, pIsError, pSource, pTarget, pBodyClass, pBodyId, pTime`) and `SaveHl7` :245 are unguarded.
  - **The precedent:** `Story394.Seed.Save` :965-978 (build the text, `SaveHl7`, then `IndexDoc`) and `STORY394_DOCUMENTS` :984.
  - **Add after `seedBodyReader` :1366:** `STORY396_SEED_SOURCE`, `STORY396_DOCUMENTS` (`Story394.SearchTable.cls`, then `Story396.Seed.cls`), `STORY396_IDS` and `seedCapstone(dev, name)`.
- Templates:
  - `story-39-5-body-reader-live-gate.test.ts`: `beforeAll` :367-412, `afterAll` :414-448, `proxiedSession` :198, the redact sweep :644, the allow control :554.
  - `story-39-4-search-table-live-gate.test.ts`: `tableSearch` :387, the MRN row :450-484 (`searchTableOracle`, `EXTENT_TABLE`, `CLASS_EXTENT`, `WINDOW_SQL`).
  - `epic38-capstone-gate.test.ts:1-41` is the header model.
- **The mutation point:** `packages/iris-interop-mcp/src/tools/message-body.ts:250` `const result = redactHl7(raw.bodyText);` in `applyBodyReaderPolicy` :201 (redact branch :248-257), which builds to `dist/tools/message-body.js:156`.
- `packages/iris-mcp-all/scripts/prepublish-gate.mjs` `gateTestFiles` :105-204 (22 entries; add one with its two-line comment) and `vitestArgs` :211 (`--no-file-parallelism`, unchanged). `story-39-1-gate-guards.test.ts:33-41` `GATES`: add the capstone. Its header comment :2-5 lists only 6 of the 7 gates; correct it to 8. `live-gate-roster.test.ts:28-35` greps `process\.env\.IRIS_REQUIRE_LIVE\s*===`.

**DW-561** (inventory taken 2026-10-17; the table is in Design Notes)
- `packages/iris-mcp-all/src/__tests__/process-gate-helpers.ts` (470 lines) has the existing exports :20-455, including `docFixtures` :389, which throws `Error` and has no vitest import (:6-11).
- Its unit tests:
  - `bootstrap-version-check.test.ts:73-128` covers it directly.
  - `interop-namespace-fixture.test.ts:92-110` covers `docFixtures` through a `call`-only stub session, so every promoted helper reached that way keeps using `session.call` and `{doc}`.
- Guard pins that must keep holding:
  - `epic38-gate-guards.test.ts`: :140-141 (`[SKIP] epic38-capstone-gate:`, `/6 skipped/`), :149, :176-178, :191 (`admin = await open\w*Session\(…\);\n\s*await assertDeployedBootstrapVersion`) and :193;
  - `story-39-1-gate-guards.test.ts`: :108, :117, :126-128 and :135-137;
  - `story-38-6-doc-claims.test.ts:372`.

**DW-573**
- Reuse:
  - `scripts/lib/measure-tools-payload-core.mjs`: `callRequest` :17-27, `fetchAllTools` :30-40, and the env save/restore pattern of `measureOne` :53-84;
  - `scripts/lib/tool-catalog.mjs` `SERVER_PACKAGES` :27-33;
  - `scripts/lib/dist-freshness.mjs` `checkDistFresh` :164 (the `epic35-defect-gate.test.ts:169` usage);
  - the pattern: `scripts/gen-governance-baseline.mjs` (`--check` :182-255, the refusal with no flag :260-278, `--force` :283-350).
- Entry shape:
  - `server-base.ts:1156-1197` `registerTool`, with `server` injected (:131-171). The SDK (1.29.0, `mcp.js:67-99`) adds `execution` (SDK-owned; excluded) and `_meta` (undefined).
  - No tool declares `outputSchema`. No description is dynamic.
  - Zod 4.3.6 is used through `toJSONSchema`.
- `measure-tools-payload.test.ts:40-66` shows that constructing a server needs no IRIS.
- `startup-env.setup.ts` already clears `IRIS_TOOLS_*` in vitest; the CLI scrubs them itself.
- Precedent fixtures with provenance fields: `packages/iris-mcp-all/src/__tests__/fixtures/story-39-*-baseline.json`.

**Docs** (current text verified at plan time)
- **Root `README.md`:**
  - the "Which Server" Integration engineer row :34;
  - `### Agent code editing (Epic 38)` :469-487 (insert the new subsection before `### Worked example` :488);
  - `### Backward Compatibility` :598-611;
  - `## PHI data policy` :701-727 (`markdownSection` reads to the next `---`; the "What it governs today." paragraph :721 is pinned at its start);
  - the audit paragraph `**The data policy in the log.**` (about :743; it reads "(today the `preview` action of `iris_message_resend`)", which is stale);
  - the prompts heading :761 and table :763-776 (`trace-message-flow` :772).
- **`packages/iris-interop-mcp/README.md` (972 lines):**
  - the intro :3, the config env table :27-35, and the core paragraph's prompt list :45;
  - Audit Logging :49-51;
  - `#### iris_message_search` :200-245 and `#### iris_message_body` :247-271, each sliced to the next `####`;
  - Prompts :369-377, Tool Examples :383 (the `<details>`/`<summary>` format), and Common Errors :942-957 (no `DATA_POLICY_BLOCKED` yet).
- **`tool_support.md`:** the story notes :201-209 (add the 39.6 note after :209), the scope heading :384 (unchanged), and the prompt-pack line :434. `docs-prompt-sync` reads the first `` `interop` N `` and `pack of N **MCP prompts**`.
- **Client config:** the `IRIS_DATA_POLICY` rows of `docs/client-config/claude-code.md:282`, `claude-desktop.md:249` and `cursor.md:280` describe the resend preview only.
- `docs/epic-summary.md:3` ("Epic 39 has added two so far").
- **`CHANGELOG.md`:** the top is :5 (Story 39.5). `story-39-5-doc-claims.test.ts:57` asserts that 39.5 is the first section: relax it to "present" (the 38.x/39.x precedent).
- **Scans:** `doc-claims-patterns.ts` `CLAIMS` and `REDACTED_TEXT_SHOWN` reject "compliant", "de-identified data" and verb + "redacted HL7/body/text". Write "an HL7 v2 body redacted by …".

## Tasks & Acceptance

**Execution** (in dependency order; build each touched package before running tests that read its dist):

1. `packages/iris-mcp-all/src/__tests__/process-gate-helpers.ts`: add the Promotion-table exports. Each export carries a contract-only doc comment. An `expect`-based helper may import `expect` from vitest. Then `process-gate-helpers.test.ts` (new; data-free; default suite) unit-tests the pure ones: `distEntry`, `skipTest`'s log line, `teardownRecorder`, `firstText`/`allText`, `headerIds`, `lineNumber`, `storageRange`, `stubEnvelope`, `pollAuditEntries` on a temp file, and `startRouteStub` round-trip. -- AC-4.
2. Every gate in the Promotion table: replace each listed copy with the promoted call, keep every assertion and every guarded literal, and delete the dead local code. Then `gate-helper-copies.test.ts` (new; default suite; no IRIS) scans every `*.test.ts` that imports `./process-gate-helpers.js`. It fails on a top-level `function <name>(` / `const <name> =` declaration of any name in the table's "Replaces" column, except the table's kept variants (an allow-list keyed by file and name, each entry carrying its reason). -- AC-4.
3. `interop-namespace-fixture.ts`: add `STORY396_SEED_SOURCE` (`Story396.Seed`), `STORY396_DOCUMENTS`, `STORY396_IDS = {headers:"1,2,3,4", hl7:"1,2,3"}` and `seedCapstone(dev, name)` through `putCompileSeed`.
   - `Seed()` is guarded to `$NAMESPACE ? 1"EXECMCPTMP396"1U` and refuses a namespace that already holds headers.
   - It builds μ with a `Save(pMrn, pType, pControl)` on the `Story394.Seed.Save` pattern, then `Story391Fixture.Add(396000 + session, 1, 9, 0, source, target, "EnsLib.HL7.Message", id, "2001-02-03 12:00:0n")`.
   - It returns the ID map. -- AC-3.
4. `packages/iris-mcp-all/src/__tests__/epic39-capstone-gate.test.ts` (new):
   - **Header** (on the `epic38-capstone-gate.test.ts:1-41` model): the five legs, the path each drives, the fixture and the namespace, and the arming.
   - **`beforeAll`**, in this order:
     1. the arming;
     2. `dev = await openWireSession(...)`, then `assertDeployedBootstrapVersion`;
     3. `admin`;
     4. `putFixtureClass`;
     5. remove `EXECMCPTMP396A`, then assert no leftovers;
     6. `createInteropNamespace(..., {interop:true})` and `seedCapstone`;
     7. the positive leftovers control;
     8. the sessions: the default `redact` session with audit (`openAuditedSession`), and `allow`.
   - **Legs** 1–5 as in the matrix. Each leg runs the loop from the seeded fixture up to its own step, so no leg depends on another leg's state.
   - **Budgets:** the first start under 60 s; each search and each body read under 2 s (`[PERF]` log).
   - **`afterAll`:** `teardownRecorder`.
   - **Rosters:** add the file to `prepublish-gate.mjs` `gateTestFiles` (comment: drives built dev/admin/interop; writes `EXECMCPTMP396A`, `Story396.*` and `Story394.SearchTable` inside it, and `ExecuteMCPv2.Temp.Story391Fixture`). Add it to `story-39-1-gate-guards.test.ts` `GATES`. -- AC-3, AC-7.
5. `scripts/lib/tools-list-snapshot-core.mjs` (new; pure). It exports:
   - `captureToolsList(root)`: per `SERVER_PACKAGES`, construct `McpServerBase` from the dists under `full`, then `fetchAllTools`, and map to `{title, description, inputSchema, annotations[, outputSchema]}`;
   - `canonicalize`;
   - `compareSnapshot(snapshot, live)`, which returns `{problems: string[], added: string[]}`, one line per vanished tool or per differing field with its first differing JSON path;
   - `assertSnapshotShape`, which rejects an empty snapshot or one missing a package.

   `scripts/gen-tools-list-snapshot.mjs` (new; the CLI header states the contract and when `--force` is legitimate):
   - no flag: refuses, exit 2;
   - `--check`: exit 0 or 1, and lists `added`;
   - `--force`: writes `{comment, capturedAt, sdkVersion, zodVersion, entryCount, servers}`, sorted, 2-space JSON plus a newline;
   - a stale dist: exit 2 with "rebuild".

   Root `package.json` gets `"gen:tools-list-snapshot"` and `"gen:tools-list-snapshot:check"`. -- AC-5.
6. After the final rebuild of every package, run `pnpm gen:tools-list-snapshot --force` once to write `packages/iris-mcp-all/src/__tests__/fixtures/tools-list-snapshot.json` (114 entries). Never edit it by hand. -- AC-5.
7. `packages/iris-mcp-all/src/__tests__/tools-list-snapshot.test.ts` (new; default suite; no IRIS). It imports the core and asserts:
   - stale dists fail with the rebuild reason;
   - `compareSnapshot(committed, captureToolsList())` has no problems;
   - `iris_server_profiles` is identical on all five servers;
   - unit rows for drift, new, vanished and empty/missing-package snapshots, on synthetic inputs. -- AC-5.
8. `packages/iris-interop-mcp/src/prompts/traceMessageFlow.ts` and `findPatientMessages.ts` (new), and `prompts/index.ts`: write the Design Notes flows. Descriptions hold no `|`. -- AC-2.
9. Prompt tests:
   - **Interop `prompts.test.ts`:** 4 owned names and the title. Add `prompts/get` rows for both prompts, with optional arguments omitted and given (Rule #46). Pin the `trace-message-flow` `prompts/list` entry's `name`, `title` and `arguments` against today's literal (AD-15).
   - **`FOREIGN_PROMPT_NAMES`** in dev, admin and ops: add the new name.
   - **`prompt-safety-invariants.test.ts`:** a new interop `describe`. It pins the step order of both prompts. It checks that every `iris_*` token is in interop `core` (interop `dist/tools/presets.js`) or is `iris_server_profiles`, and that neither prompt matches `/Rule #\d/` or the repository-path pattern. For `find-patient-messages` it pins `searchTable`, `DATA_POLICY_BLOCKED`, "7 days", the instruction not to read a withheld body another way, and that `dataPolicy` only tightens; it also checks that no `dataPolicy: "allow"` instruction appears.
   - **Counts:** `docs-prompt-sync`, `validate-prompts` and `skills-generated-frontmatter`. -- AC-2.
10. `skills/**`: run `pnpm gen:skills` after building interop, then `gen:skills:check` and `validate:prompts`. -- AC-2.
11. Docs: every row of the Docs table (Design Notes). Repin `story-38-6-doc-claims.test.ts:289,303` to the new prompt counts, and relax `story-39-5-doc-claims.test.ts:57`. -- AC-1.
12. `CHANGELOG.md` top section, `.changeset/story-39-6-message-forensics-docs-prompt-and-capstone.md` and `docs/epic-summary.md:3` (drop "so far"). -- AC-1.
13. `packages/iris-mcp-all/src/__tests__/story-39-6-doc-claims.test.ts` (new; no IRIS) pins:
    - each Docs-table row, by its anchor, with its default-state phrase;
    - the CHANGELOG section by exact title and its four headings;
    - the changeset bump map;
    - that the new text claims no compliance (`CLAIMS`, `REDACTED_TEXT_SHOWN`). -- AC-1.
14. This spec's `## Verification`: record the commands' results, every `mutation:` line, the kept-variant list, the snapshot's `entryCount` and versions, and the epic-close records. -- AC-8.

**Acceptance Criteria:**
- **AC-1 (39.6.1; Rules #30/#43; AD-26 compliance).** Given the finished docs, when `story-39-6-doc-claims.test.ts` and every existing doc-claims test run, then:
  - each Docs-table item states its default state on every surface listed for it;
  - the CHANGELOG has the 39.6 top section with its four headings;
  - the changeset bumps exactly `@iris-mcp/interop` minor;
  - no scanned text claims compliance.
- **AC-2 (39.6.2; AD-28, AD-7).** Given the built interop server, when a real request handler lists and gets both prompts, with optional arguments omitted and given, then:
  - each renders its Design Notes flow in order;
  - every `iris_*` token is an interop `core` tool or `iris_server_profiles`;
  - neither carries an internal rule number or repository path;
  - `pnpm gen:skills` regenerates 13 skills, and `gen:skills:check` and `validate:prompts` pass clean.
- **AC-3 (39.6.3; Rules #21/#59; AD-26, AD-19).** Given the armed capstone on fixture μ, when it runs on the built servers, then:
  - legs 1–5 give the matrix outcomes;
  - under `redact`, no `SYNTHPHI` value appears in any result, in the audit file or on stderr, while `KEEPME396` survives;
  - under `allow`, the values appear;
  - afterwards nothing named `EXECMCPTMP396A`, `Story396` or `Story391Fixture` remains;
  - disabling redaction in `applyBodyReaderPolicy` and rebuilding interop turns leg 4 red on the named path.
- **AC-4 (DW-561).** Given the Promotion table, when the default suite and every moved gate run armed, then:
  - every gate passes with its assertions unchanged;
  - `epic38-gate-guards`, `story-39-1-gate-guards` and `live-gate-roster` pass;
  - the capstone declares no local copy of a promoted helper;
  - re-declaring a replaced name in any gate turns `gate-helper-copies.test.ts` red.
- **AC-5 (DW-573; AD-15, AD-2).** Given the committed snapshot of 114 entries, when `tools-list-snapshot.test.ts` and `pnpm gen:tools-list-snapshot:check` run on the built dists, then:
  - both pass;
  - a changed description, schema or annotation of any listed tool fails both, naming the package, tool and field;
  - a vanished tool fails;
  - a new tool passes and is reported.
- **AC-6 (back-compat; AD-15, AD-5, AD-14).** Given the finished tree, when the Verification commands and the existing count, roster and contract pins run, then:
  - the tool counts (109/114), every preset roster, `TOOL_PAIRS`, the governance baseline (`1e62c5ad5bf7`/141), `BOOTSTRAP_VERSION` `2fd17b50a024` (`gen:bootstrap` idempotent) and the README payload rows (equal to `pnpm measure:tools-payload`) are unchanged;
  - `trace-message-flow`'s `name`, `title` and `arguments` equal today's.
- **AC-7 (Integration; Rules 1/2).**
  - Given the promoted helpers, when the capstone and every moved gate consume them against the real instance, then each passes armed.
  - Given the new prompt, when `gen:skills` consumes the built prompt catalog, then it writes `skills/find-patient-messages/SKILL.md`.
  - Given the snapshot core, when both the CLI and the vitest test consume it, then they agree on the same tree.
- **AC-8 (gates and records).** Given the finished tree, when the Verification commands run, then:
  - every per-package build, test, lint and type-check passes;
  - `:check` exits 0;
  - `check-epics-sync.mjs` prints OK;
  - nothing is left on the instance;
  - the epic-close records are written.

### Review Findings

Code review 2026-10-17 (bmad-code-review, review tier `full-opus`; layers blind-hunter, edge-case-hunter, verification-gap and acceptance-auditor all delivered; outcome CLEAN). 27 raw rows, 14 entries after grouping (high 0, medium 3, low 11), 10 rejected. Every entry was patched in this pass (patch-menu option 1); none deferred. Fields: severity / fix-risk / footprint / spec-status.

- [x] [Review][Patch] The DW-561 guard misses `denial`, the name the 38-4 and 38-5 wire gates' governance-denial copy used (AC-4 last bullet) [packages/iris-mcp-all/src/__tests__/gate-helper-copies.test.ts:31] -- medium / fix-risk low (one list entry) / in-story / clear. Sources: blind-hunter+acceptance-auditor. `"denial"` added to `REPLACED_NAMES` (top level only, since it is a plausible local name); mutation-verified.
- [x] [Review][Patch] `GATES` in the 39.x gate guards is hand-kept and the migrated 39.2 live gate was missing from it, so its skip and armed contract, which DW-561 rewired through `skipTest`, was unguarded (Rule #59) [packages/iris-mcp-all/src/__tests__/story-39-1-gate-guards.test.ts:36] -- medium / fix-risk low (one row, a widened describe regex, one completeness test) / in-story / clear. Source: verification-gap. Added the 39.2 row, accepted a `describe.skipIf(...)(` first suite, and added a completeness test: every gate carrying the 39.x dist-freshness line is in `GATES`. 37 of 37 pass; mutation-verified.
- [x] [Review][Patch] The docs say every tool `trace-message-flow` calls is a read, but step 6 may run `iris_production_control` action `recover` (a write, enabled by default) once the user confirms (Rule #30) [README.md:793, packages/iris-interop-mcp/README.md:394, .changeset/story-39-6-message-forensics-docs-prompt-and-capstone.md:7, tool_support.md:211] -- medium / fix-risk low (doc text plus two pins) / in-story / clear. Sources: blind-hunter+edge-case-hunter. Each claim now names the recovery exception; the `story-39-6-doc-claims` pins were updated.
- [x] [Review][Patch] `trace-message-flow` step 2 never says that the step 1 hop times are already UTC with no zone, so an agent may convert them as local time and miss the window [packages/iris-interop-mcp/src/prompts/traceMessageFlow.ts:49] -- low / fix-risk low / in-story / clear. Sources: blind-hunter+edge-case-hunter. Verified: `Ens.MessageHeaderBase.TimeCreated` is `Ens.DataType.UTC`, `Interop.cls:1412` returns it raw, and `iris_message_search` refuses a naive time. One clause added and pinned.
- [x] [Review][Patch] The `trace-message-flow` summary can restate identifying values from Event Log lines or the diagram, both outside the data policy (DW-576 residual; occurrence appended) [packages/iris-interop-mcp/src/prompts/traceMessageFlow.ts:53] -- low / fix-risk low / in-story / clear. Source: blind-hunter. Step 6 now repeats no identifying value from a body, a log entry or the diagram; pinned.
- [x] [Review][Patch] The interop README's PHI section names only `headers` as outside the policy and drops the keep-list caveat the root README carries [packages/iris-interop-mcp/README.md:58] -- low / fix-risk low / in-story / clear. Source: blind-hunter. One sentence each: `iris_message_diagram` and `iris_production_logs` (both reads, enabled by default, restrictable by key) are residual, and a kept field still holds what the sender put in it. The "identifying values were replaced" clause of the Tool Example describes that captured example, so it was not changed.
- [x] [Review][Patch] `--force` re-pins changed and vanished entries by name but pins newly added tools silently [scripts/gen-tools-list-snapshot.mjs:136] -- low / fix-risk low / in-story / clear (that a new tool stays unpinned until a sanctioned regenerate is decision #29's one-directional design). Source: blind-hunter. The `Pinning N new tool(s)` lines were added, pinned in the QA CLI drift row, and mutation-verified.
- [x] [Review][Patch] Capstone leg 5 never shows that under `allow` body content stays out of the audit file and the console log (the docs' "under any policy"; the 39.5 QA gates pin it, and the epic gate did not) [packages/iris-mcp-all/src/__tests__/epic39-capstone-gate.test.ts:579] -- low / fix-risk low / in-story / clear. Source: blind-hunter. Leg 5 now asserts that the body-only value `SYNTHPHI396-NOTE` (OBX-5, never a filter) is absent from the allow audit file and the allow stderr, after a settle round trip. Armed green; mutation-verified on the stderr path.
- [x] [Review][Patch] After a refused header search, `trace-message-flow` step 3 still takes its IDs "from step 2" [packages/iris-interop-mcp/src/prompts/traceMessageFlow.ts:50] -- low / fix-risk low / in-story / clear. Source: edge-case-hunter. It now falls back to the step 1 hops, whose `id` values `Interop.cls:1408` returns; pinned.
- [x] [Review][Patch] `trace-message-flow` step 3 has no branch for a refused body read, unlike `find-patient-messages` step 5 [packages/iris-interop-mcp/src/prompts/traceMessageFlow.ts:50] -- low / fix-risk low / in-story / clear. Source: edge-case-hunter. A refusal sentence was added and pinned; mutation-verified.
- [x] [Review][Patch] `trace-message-flow` step 3 says "up to 20" without "per call" [packages/iris-interop-mcp/src/prompts/traceMessageFlow.ts:50] -- low / fix-risk low / in-story / clear. Source: edge-case-hunter. "per call" added, as in `find-patient-messages`.
- [x] [Review][Patch] `find-patient-messages` writes `searchTableClass` raw into the example call, while `patientId` is JSON-encoded [packages/iris-interop-mcp/src/prompts/findPatientMessages.ts:80] -- low / fix-risk low / in-story / clear. Source: edge-case-hunter. `JSON.stringify(searchTableClass)` gives the same text for a real class name; a hostile-value assertion was added; mutation-verified.
- [x] [Review][Patch] The CHANGELOG and the `tool_support.md` note say the helpers now live in "one" module; they live in `process-gate-helpers.ts`, plus `header-row-oracle.ts` for the SQL strings, and the kept variants stay in their gates [CHANGELOG.md:73, tool_support.md:211] -- low / fix-risk low / in-story / clear. Source: edge-case-hunter. Reworded.
- [x] [Review][Patch] Literal U+2014 bytes in changed code: the `trace-message-flow` `build()` template and the two new `describe` titles (Rule 14) [packages/iris-interop-mcp/src/prompts/traceMessageFlow.ts:39-51, packages/iris-interop-mcp/src/__tests__/prompts.test.ts:199,266] -- low / fix-risk low / in-story / clear. Source: acceptance-auditor. Written as `—` with a byte-level substitution, because the Edit tool normalized typed escapes. The rendered text is identical: `gen:skills` changed only the new step clauses.

Rejected:
- `false` EC1 (a late stderr line after the `listTools` settle is missed): the body read's log lines are written before its response, and a full further round trip follows before the read; the recorded stderr mutation turned leg 4 red.
- `false` EC9 (`--force` ENOENT when the fixtures directory is missing): the committed `fixtures/` directory holds other fixtures, and the QA "no snapshot" tree keeps the directory.
- `false` VG3 (AC clauses without a `mutation:` line): Rule 19 asks for one demonstrated mutation per AC, and AC-1, AC-2, AC-3 and AC-5 each have recorded mutations.
- `false` VG other (`STORY396_IDS` compared with a literal at capstone :385): the row can fail (the recorded `STORY396_IDS.hl7` mutation), and `seedCapstone` checks the live return.
- `low` BH5 (the Design Notes `trace-message-flow` flow still says "split a longer session"): the fix edits the spec under review. The deviation is the implement pass's E10 patch toward the frozen "asks the user for a longer period" boundary, so the lead may record it in the Spec Change Log.
- `low` BH7 (the snapshot's `sdkVersion`/`zodVersion` are never compared): this matters once per SDK upgrade (Epic 43), the regenerate diff shows the header change, and a comparison branch is new complexity.
- `low` BH10 (no test cross-checks the parameter names the prompts cite against `inputSchema`): a parameter rename is an AD-15 breaking change that needs a Lead decision, and the fix is a new checker.
- `low` EC7 (the QA wire test reads the dists without a freshness check): this is the package's convention for dist-reading tests, which run after the build.
- `low` EC8 (`storageRange` returns `last: 0` with no closing brace): the copy moved verbatim, and every fixture's Storage block closes.
- `low` VG2 (the changeset row is `skipIf` when the file is missing): the 8-file pattern exists so that a consumed changeset does not fail the suite; a deleted changeset shows in review, and the fix is a cross-file helper.

## Spec Change Log

### 2026-10-17: lead note after code review round 1
- `trace-message-flow` and a session longer than the 7-day window: the Design Notes say "split a longer session". The implementation asks the user before searching beyond 7 days, which the frozen intent rule ("asks the user for a longer period") requires. The intent rule governs. AC-2's "renders its Design Notes flow" is read with that step as implemented, and it is pinned in `prompts.test.ts`.

## Review Triage Log

### 2026-10-17 — Review pass
- verdicts: 48 findings — high 0, medium 6, low 36, false 6, maybe-false 0
- findings:
  - Blind Hunter:
    - `[low]` `[patch]` B1 literal non-ASCII in code (a U+FFFF in the serializer regex, an em dash, arrow and emoji in a test string) — verified at `tools-list-snapshot-core.mjs` and `tools-list-snapshot.test.ts`; both now use `￿` and `— → 😀` escapes. Box-drawing characters in comments follow the sibling scripts and stay.
    - `[low]` `[patch]` B2 docs do not say the diagram and the logs sit outside the data policy — verified: the forensics subsection was silent and the scope table lists both as residual; one sentence added to the README pointing at the scope table. The prompts are unchanged (the flows are the Design Notes', and both tools were already in the prompt).
    - `[low]` `[patch]` B3 refusal handling narrower than the docs claim — verified: only the `block` read of step 1 was covered; refusal sentences added to `find-patient-messages` steps 3 and 5 and `trace-message-flow` step 2, pinned in the interop `prompts.test.ts`.
    - `[low]` `[patch]` B4 `patientId` written raw into the JSON example — verified; the value is now `JSON.stringify(patientId)` (identical text for a plain value) and a hostile-value row parses the rendered example.
    - `[low]` `[reject]` B5 `REDACTED_TEXT_SHOWN` scope — the scan is directed by the spec's Scans bullet and passes; the hazard is a future wording, a cosmetic title, and the fix would edit the shared pattern file.
    - `[low]` `[patch]` B6 README intro overstates the prompts — verified; rewritten to say what each prompt walks and that `resend-failed-messages` covers the preview.
    - `[low]` `[patch]` B7 documented capstone claim wider than the legs — the CHANGELOG and `tool_support.md` now say "a Search Table lookup, a body read, the audit file or stderr"; the stderr control is V4.
    - `[low]` `[reject]` B8 `--force` re-pins unrelated drift, `ENTRY_FLOOR`, `capturedAt` — by design: decision #29 makes any change to a listed entry a `--force` regenerate with a CHANGELOG line, `--force` prints every re-pinned or vanished entry, `capturedAt` is in Task 5's header, and the floor is deliberate friction.
    - `[low]` `[patch]` B9 history narrated in a helper header comment — reworded to the contract.
  - Edge Case Hunter:
    - `[low]` `[patch]` E1 header-ID start gives a one-instant window — verified (`headerId` returns one message); step 1 now re-reads by `sessionId`.
    - `[low]` `[patch]` E2 default `count` 100 can cut the flow's latest time — step 1 now says to raise `count` when the list may be cut off.
    - `[low]` `[patch]` E3 `to` in whole seconds drops a fractional last message — verified (`TimeCreated <= ?`); step 2 rounds `to` up to the next whole second.
    - `[low]` `[reject]` E4 both lookups empty — the old flow had the same gap, it needs a new branch, and the reachable case (a wrong ID) already shows as an empty result to the agent.
    - `[low]` `[patch]` E5 duplicate session IDs for the diagram — "distinct" added to step 6.
    - `[low]` `[patch]` E6 namespace note covers `iris_server_profiles`, which takes none — the note now excepts it, pinned.
    - `[low]` `[patch]` E7 quote, backslash, newline in `patientId` — grouped with B4 (backticks in code spans stay: low, and the argument is the user's own input).
    - `[low]` `[reject]` E8 `to` without `from` dropped — the prompt asks the user for the period anyway; the fix adds a branch.
    - `[low]` `[patch]` E9 refusal at any step — grouped with B3.
    - `[medium]` `[patch]` E10 `trace-message-flow` splits a longer flow into windows without asking — verified against the frozen boundary "the agent asks the user for a longer period" (the Design Notes flow said "split"); step 2 now asks first.
    - `[low]` `[patch]` E11 literal non-ASCII bytes — grouped with B1.
    - `[low]` `[patch]` E12 stderr read once with no settle — `listTools()` round trip added before the read.
    - `[low]` `[reject]` E13 half-written audit line aborts the poll — the helper moved the originals' `JSON.parse` verbatim; no flake observed in 19 armed runs.
    - `[low]` `[reject]` E14 stub crashes on a non-JSON body — only the gates' own JSON reaches it, as in the originals.
    - `[low]` `[reject]` E15 opaque error for a reply without `status` — test infrastructure that fails loudly; the originals had the same shape.
    - `[low]` `[reject]` E16 `isWellFormed` needs Node 20 — Node 18 and 19 are end of life; the gates already used it.
    - `[low]` `[patch]` E17 importer regex misses single quotes or a missing `.js` — broadened and pinned.
    - `[low]` `[reject]` E18 SDK or zod hoisted away from `packages/shared/node_modules` — pnpm's layout is the repo's package manager; the capture fails loudly.
  - Verification Gap Reviewer:
    - `[medium]` `[patch]` V1 live "added" row cannot fail on the committed tree — verified (`added` is empty, so the loop never ran); the row now compares `added` with an independently computed set, mutation-verified.
    - `[medium]` `[patch]` V2 guard cannot see a nested `entries` function — verified; `FUNCTION_NEVER_LOCAL` added (local `const entries =` stays legal), mutation-verified on the 39-2 gate.
    - `[medium]` `[patch]` V3 `postEnvelope` and `atelierScalar` have no logic test — stub-backed rows added (the vacuous `atelierScalar` row replaced), mutation-verified; `openAuditedSession` stays covered by the armed capstone and 39-5 audit-file assertions, which fail without `IRIS_AUDIT_LOG`.
    - `[medium]` `[patch]` V4 stderr surface has no positive control — the leak detector was shown to fire on stderr by a mutation that writes the body to stderr (leg 4 red naming the stderr), and a settle point was added.
    - `[low]` `[patch]` V5 pinning tests without a mutation line — the mutation lines were written and run (list under Results).
    - `[low]` `[patch]` V6 root scripts unpinned — a `package.json` row added, mutation-verified.
    - `[low]` `[patch]` O1 literal non-ASCII — grouped with B1.
    - `[false]` `[reject]` O2 two armed gate files race on `Story391Fixture` — the package runs its files one at a time (`fileParallelism: false`, pinned by `epic38-gate-guards`) and the prepublish gate passes `--no-file-parallelism`.
    - `[low]` `[patch]` O3 raw `patientId` — grouped with B4.
  - Intent Alignment Auditor:
    - `[false]` `[reject]` IA1 prompt tests exercise the rendered string, not an agent — AC-2 is stated at the real `prompts/list` and `prompts/get` handler, which the tests drive.
    - `[medium]` `[patch]` IA2 window rule differs between the two prompts — grouped with E10.
    - `[false]` `[reject]` IA3 leg 5 changes configuration on another server; the red proof is outside the diff — the allow leg is the specified positive control, and the red proof is recorded under Results.
    - `[low]` `[reject]` IA4 the 39-1 guard regex wants exactly one line before the version assert — pre-existing, not in this diff; the capstone satisfies it.
    - `[false]` `[reject]` IA5 the snapshot is built in process from the working tree — the Design Notes specify `McpServerBase` construction plus `fetchAllTools`.
    - `[low]` `[reject]` IA6 the helper-copy guard only sees named copies in importing files — the spec's Task 2 defines the guard that way.
    - `[false]` `[reject]` IA7 `squash` and `HEADER_COLUMNS` live in `header-row-oracle.ts` — the Promotion table says so.
    - `[low]` `[reject]` IA8 small behavior differences in moved gates (delete-first put, `Error` for `expect`) — no pass or fail condition changed; recorded under Results.
    - `[false]` `[reject]` IA9 `[SKIP]` text assembled in `skipTest` — the gate guards pin the printed line and pass.
    - `[low]` `[reject]` IA10 README examples not re-captured — captured from the built server at implement time; the capstone pins the same text.
    - `[low]` `[reject]` IA11 other READMEs untouched — the Docs table R1 to R16 is the enumeration of record, and no stale prompt count remains (searched).
    - `[low]` `[patch]` IA12 literal non-ASCII — grouped with B1.

## Design Notes

**Orchestrator decisions: DECIDED at the spec gate, 2026-10-17, both as recommended (#28: the capstone seeds synthetic fixtures directly and starts no production; #29: any change to a listed tools/list entry, additive included, needs a `--force` regenerate and a CHANGELOG line).** The planning text follows:
- **"Generated" traffic.** Orchestrator decision needed: does AC 39.6.3 step 1 ("synthetic HL7 traffic is generated in the disposable namespace") require running a production? — recommended: no; the capstone generates μ with its own seed class (direct `Ens.MessageHeader` saves, `SaveHl7`, `IndexDoc`), because:
  - every Epic 39 gate generates its messages this way (`interop-namespace-fixture.ts:1063` "no production runs");
  - the epic's fixture constraints (2001-02-03 UTC times, synthetic values, disposable namespace) hold only for seeded headers;
  - `IndexDoc` is the same method an HL7 service's `SearchTableClass` setting calls;
  - a production-driven run (the 39.2 precedent, `story-39-2-data-policy-live-gate.test.ts:708-752`) would add a production start on the shared instance, real-time timestamps and a business service with no adapter, for header fields that 39.1 already pins against the SQL oracle.

  The alternative: a `Story396.Production` started in `EXECMCPTMP396A`, fed through `Ens.Director.CreateBusinessService`, with real-time windows.
- **Snapshot strictness.** Orchestrator decision needed: does the DW-573 pin allow an additive change (a new optional property) to a listed entry without a regenerate? — recommended: no; every change to a listed entry, an additive one included, needs a `--force` regenerate in the story that makes it, with a CHANGELOG line. Reasons:
  - AD-15 permits "pinning the full new shape in the story that adds them", and the regenerate diff is then the reviewable record;
  - a superset rule would let a renamed-and-re-added property or a loosened annotation slip through.

  Known consequence: an SDK or zod upgrade (Epic 43, AD-32) moves every entry and needs one recorded regenerate. The header's `sdkVersion`/`zodVersion` make that cause visible.

**Plan-time interpretations** (apply and report):
- **I1.** Updating `trace-message-flow` changes its description and body (sanctioned by AC 39.6.2) but not its argument contract, so no AD-15 question arises; a pin proves it.
- **I2.** The capstone joins `story-39-1-gate-guards` (the 39.x gate shape), so its armed text reads "Epic 39 capstone live gate may not be skipped".
- **I3.** The capstone has no `block` leg: AC 39.6.3 lists five legs, and `block` is pinned by the 39.3, 39.4 and 39.5 gates.
- **I4.** No ObjectScript changes, so no OS `%UnitTest` class runs, and `Story394.SearchTable` is reused for its compile-time `SearchTableProp` population (spec-39-4) rather than copied.
- **I5.** The prompt-pack count moves 12 → 13 on every surface. The tool counts, rosters and payload rows do not move.

**Prompts.** Write them in plain imperative steps, with no rule numbers and no paths.
- **`trace-message-flow`:**
  1. `iris_production_messages` with `sessionId: <id>`, retrying with `headerId` (as today), to get the hops, the session ID and the earliest and latest times.
  2. `iris_message_search` `action:"headers"` with that `sessionId`, and `from`/`to` bracketing those times in UTC ISO 8601 (at most 7 days; split a longer session), for the header rows (`id`, status, `isError`, source and target, body class and ID). Page with `nextCursor` and the same `from`/`to`.
  3. `iris_message_body` with up to 20 header IDs that matter (the first request, each erroring message and its response), for bodies rendered by kind, each with its `bodyPolicy`. Under the default `redact`, an HL7 v2 body is shown with fields outside a reviewed keep-list replaced, and every other body is withheld with a reason. Under `block`, every body is withheld. Report a withheld body's reason, and never read it another way (for example through SQL, global or document tools).
  4. `iris_message_diagram` with `sessionIds: [<session>]` (as today's step 3).
  5. `iris_production_logs` for erroring items (as today's step 4).
  6. The summary, with no recovery without the user's confirmation (as today's step 5).

  The namespace note is kept.
- **`find-patient-messages`** (title "Find Patient Messages"). The description reads "Find a patient's Interoperability messages by a Search Table value, such as a medical record number, with iris_message_search, then read their bodies with iris_message_body under the PHI data policy."

  The arguments:
  - `patientId` (required): the identifier to look up;
  - `from`: the start of the window, ISO 8601 UTC;
  - `to`: the end of the window (default: now);
  - `searchTableClass`: the default is `EnsLib.HL7.SearchTable`;
  - `namespace`.

  The steps:
  1. `iris_server_profiles`: read the profile's `dataPolicy`. Under `block`, the lookup is refused with `DATA_POLICY_BLOCKED` and every body is withheld, so stop and tell the user, and do not look the patient up another way.
  2. The window: with no `from`, ask the user for the period. Each search spans at most 7 days, and the agent asks before searching a longer period window by window.
  3. `iris_message_search` `action:"searchTable"` with `searchTableClass`, `filters: [{property: "PatientID", op: "eq", value: <patientId>}]`, `from` and `to`, paged with `nextCursor`. `PatientID` covers PID-2, every PID-3 repetition and PID-4. An unknown-property error lists the class's properties: pick the identifier and retry. `notApplicable` means no Search Table is configured, so tell the user. No match does not prove that there is no message, because only indexed messages match.
  4. List the rows (`id`, time, source to target, status, `sessionId`); rows hold no body values.
  5. Only when the user wants content: `iris_message_body` with up to 20 IDs per call, under the policy as in `trace-message-flow` step 3. `dataPolicy` can only tighten (for example `block`); a looser value is ignored and reported as `dataPolicyClamped`.
  6. Optionally, `iris_message_diagram` with the rows' `sessionId`s (at most 20).
  7. The report: the messages, the result's data-policy line, and each withheld body's reason. Repeat no identifying value from a body beyond what the user gave, and never read a withheld body another way.

**Promotion table (DW-561).** The new exports of `process-gate-helpers.ts`, and the copies each replaces. Line numbers are from the 2026-10-17 inventory; verify each copy's body before replacing it.

Short names, all in `packages/iris-mcp-all/src/__tests__/`:
- `epic38 capstone` is `epic38-capstone-gate.test.ts`. `38-4` is `story-38-4-qa-doc-edit-wire-gate.test.ts`, `38-5` is `story-38-5-qa-sql-wire-gate.test.ts` and `38-7 wire` is `story-38-7-qa-wire-gate.test.ts`. `38-7 governance process` is `story-38-7-qa-governance-process.test.ts`.
- `39-N` is the story's main gate: `story-39-1-message-search-live-gate`, `story-39-2-data-policy-live-gate`, `story-39-3-body-search-live-gate`, `story-39-4-search-table-live-gate` and `story-39-5-body-reader-live-gate` (each `.test.ts`).
- `39-N QA` is `story-39-N-qa-live-gate.test.ts`, and `39-N QA process` is `story-39-N-qa-process.test.ts`.
- `39-2 startup` is `story-39-2-data-policy-startup.test.ts`.

| Export | Replaces |
|---|---|
| `distEntry(repoRoot, pkg)` | `entryOf`: 39-1 :66, 39-2 :70, 39-3 :70, 39-3 QA :61, 39-4 :79, 39-4 QA :63, 39-5 :66, 39-5 QA :75 |
| `skipTest(tag, reason, ctx)`: logs `[SKIP] <tag>: <reason>`, then skips | `skip`: epic38 capstone :139, 39-1 :103, 39-2 :106, 39-3 :112, 39-3 QA :163, 39-4 :121, 39-4 QA :102, 39-5 :101, 39-5 QA :110 |
| `skipIfReason(reason, ctx)` | `skipIfNeeded`: 39-2/3/4/5 QA process, 39-2 startup :155 |
| `teardownRecorder()` gives `{problems, attempt}`; `fixtureDocumentNames(session, filters)` | `attempt` and the document-listing loops in the 8 Epic 39 gates' `afterAll` (each keeps its own `expect` label) |
| `stemFixtures(session, stem)` gives `{documents, globals, killGlobals}` | `fixtureDocuments`/`fixtureGlobals`/the kill loop: epic38 capstone :211/:217/:232, 38-4 :207/:213/:219, 38-5 :197/:203/:210, 38-7 wire :94 (each keeps its own `removeFixtures` order) |
| `lineNumber`, `storageRange`, `atelierScalar(target, query)` | epic38 capstone :192/:199/:227, 38-4 :164/:171, 38-5 `scalar` :135 |
| `governanceReport(session)`, `governanceDenial(action, extra)` | 38-4 :195/:190, 38-5 :310/:300 |
| `docFixtures` (existing) | `removeDoc`/`putDoc`/`compileDoc`: epic38 capstone :148-164, 38-4 :132-147, 38-5 :193 and the inline put at :260-264, 38-7 wire `putFixture` :115 |
| `postEnvelope(target, path, body)` | `route`: 39-3 :380, 39-4 :410, 39-5 :359 (the QA `route` wrappers at 39-3 QA :302, 39-4 QA :216 and 39-5 QA :510 keep their extra expect and call it) |
| `firstText`, `allText`, `headerIds` | `textOf` (first block: epic38, 39-1, 39-3, 39-3 QA, 39-4, 39-4 QA; joined: 39-2, 39-5, 39-5 QA and the QA process gates); `ids` (×5) |
| `irisClassMethod(session, ns, className, methodName, args)` | 39-2 `irisMethod` :497, 39-5 :345, 39-5 QA `seedMethod` :374 |
| `openAuditedSession(options, extraEnv)` gives `{session, stderr(), auditFile}` | 39-5 `proxiedSession` :198, 39-5 QA `probedSession` :447, 39-5 QA process `probed` :284 |
| `pollAuditEntries(file, {tool?, count?, isWanted?, intervalMs, timeoutMs, excerpt})` | `searchEntries`: 39-3 :1113, 39-4 :1144, 39-3 QA process :491, 39-4 QA process :632; `auditEntries`: 39-5 :1065, 39-5 QA process :382; 39-2 `entries` :555 (each call passes its current constants) |
| `startRouteStub(route)`, `start503Stub()`, `stubTarget(port, username)`, `stubEnvelope`, `routeRequests`, `writeJson`, `withStub` | `startStub`/`envelope`/`stubTarget`/`routeRequests`/`writeJson`/`withStub` in the 39-2/3/4/5 QA process gates, 38-7 governance process :92-145 and 39-2 startup :59-88 |
| `batchUnits`, `wellFormed`; `sqlLiteral`/`squash`/`HEADER_COLUMNS` move to `header-row-oracle.ts` | 39-5 :753 and 39-5 QA :664; 39-5 QA :489 and 39-5 QA process :106; 39-1 :330, 39-3 QA :447/:450, 39-4 :1210 |

**Kept local, with reasons** (the guard's allow-list):
- each gate's `wireOptions`/`openSession`/`interopSession`/`plainSession` one-liners, which bind file-local `sdkEsmDir` and `TARGET`;
- the six `succeeded` variants, whose forbidden values and labels differ;
- 38-7 governance process `governanceReport` :145, which opens its own session and captures stderr (a different contract);
- 38-7 wire `stored` :105, which has one user;
- the expected-text constants of the 39-5 gates, which are data, not helpers.

**Extend, don't copy (Rule 2).**
- **Extended:** `process-gate-helpers.ts`, `docFixtures`, `header-row-oracle.ts`, `interop-namespace-fixture.ts` (`putCompileSeed`, `Story391Fixture`, `STORY394_SEARCH_TABLE_SOURCE`), `measure-tools-payload-core.mjs` `fetchAllTools`, `tool-catalog.mjs` `SERVER_PACKAGES`, `dist-freshness.mjs`, the governance-baseline CLI shape, `GATES` and `gateTestFiles`.
- **New, with reasons:**
  - `Story396.Seed`: μ is a session-shaped four-header set. `Story394.Seed` is guarded to its own namespaces and seeds 39.4's eleven-header matrix.
  - `findPatientMessages.ts`: a new prompt.
  - `tools-list-snapshot-core.mjs`: no module captures entry content today.

**Integration (Rules 1/2).**
- **Integration ACs:** AC-7, and the capstone legs against the real instance.
- **Consumes:**
  - 39.1–39.5: `iris_message_search` (all three actions), `iris_message_body`, `applyBodyReaderPolicy`/`redactHl7`, the audit `dataPolicy` and `phiInputs` plumbing, `interop-namespace-fixture.ts`, `header-row-oracle.ts`, the gate helpers and `assertDeployedBootstrapVersion`;
  - Epic 30: `measure-tools-payload-core.mjs`.
- **Consumed-by:**
  - this story's capstone and moved gates (the promoted helpers);
  - every later gate, starting with the Epic 40 capstone;
  - every later story's default suite (the snapshot);
  - Epic 41's skills pack (the two prompts);
  - Epic 43, AD-32 (the SDK migration regenerates the snapshot).

**Ledger inbox (Rule 17):**
- **DW-561:** addressed by Tasks 1–2 and 4, AC-4, AC-7 and the helper-copies matrix row.
- **DW-573:** addressed by Tasks 5–7, AC-5 and the four snapshot matrix rows.

**Governing ADs.**
- **AD-26:** the capstone proves that under `redact` no body PHI and no echoed filter value leaves through search or read; the docs make no compliance claim; least exposure is described truthfully.
- **AD-28:** prompts are authored once, skills are generated, there are no internal references, and every tool name is real.
- **AD-15:** the `tools/list` snapshot, the unchanged `trace-message-flow` contract, and no tool change.
- **AD-19:** no PHI in the audit file or on stderr, and `filters` logged `[REDACTED]`.
- **AD-7:** the prompts' main path is in `core`, and no preset changes.
- **AD-9:** tighten-only, documented.
- **AD-20:** every prompt search is windowed; the output cap is not presented as timeout protection.
- **AD-2:** the cross-package checks live in `iris-mcp-all`/`scripts`, with one core for the CLI and the test.
- **AD-14:** no bootstrap change, `gen:bootstrap` idempotent. **AD-5:** `:check` only. **AD-29:** a minor changeset, no publish.
- **Conventions:** Live gates, Live testing on a shared instance, Configuration variables (documented with defaults), Error text (no echo), Logging.

**Docs table** (Rule #30; every row states the default state at its point of use):

| # | Surface | Item |
|---|---|---|
| R1 | README :34 | Integration engineer: "search and read messages under the PHI data policy" |
| R2 | README, new `### Message forensics (Epic 39)` after :487 | The loop (search, read, diagram, resend preview). Each `iris_message_search` action, with what it takes, its key `iris_message_search:<action>` and "a read, enabled by default". `iris_message_body` (a read, enabled by default). The required window of at most 7 days, `limit` as an output cap only, and paging. `notApplicable`. Policy per action, with a link. Restricting a key (`{"global":{"iris_message_search:body":false}}`). The two prompts |
| R3 | README audit paragraph | Names the governed set (`iris_message_body`, the `body`/`searchTable` actions, the `preview` action) and the declared PHI input (`filters`). Keeps the pinned JSON and "The declaration decides…" |
| R4 | README prompts | `13 prompts`, the new `trace-message-flow` text, and a `find-patient-messages` row (main path in interop `core`; reads only; withheld bodies stay withheld) |
| R5 | README Backward Compatibility | A bullet: the `tools/list` snapshot pins every listed entry, and a sanctioned change regenerates it |
| R6 | Interop README :3, :45 | Intro mentions message search and body reading; the core paragraph lists the new prompt |
| R7 | Interop README env table :27-35 | An `IRIS_DATA_POLICY` row: default `redact`, the values, the effect on this server's tools |
| R8 | Interop README, new `### PHI data policy (IRIS_DATA_POLICY)` after Audit Logging | The five channels in order, `iris_server_profiles` reporting, tighten-only, and the compliance sentence |
| R9 | Interop README Audit Logging :51 | The `dataPolicy` field and the redaction of PHI inputs |
| R10 | Interop README `#### iris_message_search` | One sentence: `headers` is outside the policy, and a header with no body class carries its literal body as the body ID (restrict `iris_message_search:headers`) |
| R11 | Interop README Tool Examples | `<details>` for a `searchTable` lookup and for a `redact` body read. The outputs are captured from the built server on fixture μ, values verbatim, trimmed with `…` |
| R12 | Interop README Common Errors | A `DATA_POLICY_BLOCKED` row |
| R13 | Interop README Prompts | The new row and the updated `trace-message-flow` row |
| R14 | `tool_support.md` | A Story 39.6 note after :209 (prompts, capstone, snapshot, helpers; no tool, key or count change); the :434 line reads 13 prompts with `interop` 4, and "`interop` gained `find-patient-messages` in Story 39.6" |
| R15 | Client config ×3 | The `IRIS_DATA_POLICY` row also covers `iris_message_body` and the `block` refusal of `body`/`searchTable` |
| R16 | `docs/epic-summary.md:3` | "so far" removed |

## Verification

Every command runs from `/Users/jbrandt/git/iris-execute-mcp-v2`, in the foreground, with `timeout: 600000`, one package per call.
- `ENV` is `IRIS_HOST=localhost IRIS_PORT=52773 IRIS_NAMESPACE=HSCUSTOM IRIS_USERNAME=_SYSTEM IRIS_PASSWORD=SYS IRIS_HTTPS=false IRIS_REQUIRE_LIVE=1`.
- Every MCP call names `server:"default"` and the namespace `HSCUSTOM` or `EXECMCPTMP396A`.

**Shared surfaces:** these change, and other tests assert on them.
- The prompt names and counts: interop/dev/admin/ops `prompts.test.ts`, `docs-prompt-sync`, `validate-prompts`, `skills-generated-frontmatter`, the `story-38-6-doc-claims` pins and `prompt-safety-invariants`.
- `skills/`.
- The CHANGELOG's first section (`story-39-5-doc-claims`).
- The README prompt heading and the `tool_support.md` prompt line.
- `gateTestFiles` and `GATES` (`live-gate-roster`, the gate guards).
- The `process-gate-helpers.ts` exports (`bootstrap-version-check`, the `interop-namespace-fixture.test.ts` stub harness) and every gate file in the Promotion table.
- The `interop-namespace-fixture.ts` exports.
- The root `package.json` scripts.
- The new snapshot, which every later story's suite reads.

Standing criterion: every test added or changed passes on a fresh environment, in either order.
- The capstone creates and removes all its own state: `EXECMCPTMP396A`, `Story396.Seed` and `Story394.SearchTable` inside it, `ExecuteMCPv2.Temp.Story391Fixture` in HSCUSTOM, and its temp dir. Each moved gate keeps its own disposable fixtures, unchanged.
- No OS `%UnitTest` class changes, so none runs.

**Commands:**
- `(loop)` `pnpm --filter @iris-mcp/interop build && pnpm --filter @iris-mcp/interop exec vitest run src/__tests__/prompts.test.ts` -- expected: pass.
- `(loop)` `pnpm --filter @iris-mcp/dev exec vitest run src/__tests__/prompts.test.ts`, then the same for `@iris-mcp/admin` and `@iris-mcp/ops`, one call each -- expected: pass.
- `(loop)` `pnpm gen:skills && pnpm gen:skills:check && pnpm validate:prompts` -- expected: clean, 13 skills.
- `(loop)` `pnpm gen:tools-list-snapshot:check` -- expected: OK, exit 0.
- `(loop)` `pnpm --filter @iris-mcp/all exec vitest run src/__tests__/tools-list-snapshot.test.ts src/__tests__/process-gate-helpers.test.ts src/__tests__/gate-helper-copies.test.ts src/__tests__/story-39-6-doc-claims.test.ts src/__tests__/story-39-5-doc-claims.test.ts src/__tests__/story-39-4-doc-claims.test.ts src/__tests__/story-39-3-doc-claims.test.ts src/__tests__/story-39-2-doc-claims.test.ts src/__tests__/story-39-1-doc-claims.test.ts src/__tests__/story-39-0-doc-claims.test.ts src/__tests__/story-38-6-doc-claims.test.ts src/__tests__/docs-prompt-sync.test.ts src/__tests__/validate-prompts.test.ts src/__tests__/skills-generated-frontmatter.test.ts src/__tests__/prompt-safety-invariants.test.ts src/__tests__/live-gate-roster.test.ts src/__tests__/bootstrap-version-check.test.ts src/__tests__/interop-namespace-fixture.test.ts src/__tests__/docs-visibility-roster-sync.test.ts` -- expected: pass.
- `(loop)` `pnpm --filter @iris-mcp/all exec vitest run src/__tests__/story-39-1-gate-guards.test.ts`, then `src/__tests__/epic38-gate-guards.test.ts`, one call each -- expected: pass.
- `(loop)` `ENV pnpm --filter @iris-mcp/all exec vitest run src/__tests__/epic39-capstone-gate.test.ts` -- expected: every test passes, none skipped, nothing left.
- `(once)` Each moved gate armed, one per call: `ENV pnpm --filter @iris-mcp/all exec vitest run src/__tests__/<gate>`, for every file in the Promotion table (the capstone and QA live gates, the Epic 38 wire gates, and the process gates) -- expected: pass, none skipped.
- `(once)` For each of shared, dev, admin, interop, ops, data and client-config, one command each: `build`, `test`, `lint` and `type-check`. Then `ENV pnpm --filter @iris-mcp/all test` -- expected: green.
- `(once)` `pnpm gen:bootstrap` (expected: no diff), `pnpm gen:governance-baseline:check` (expected: exit 0, `1e62c5ad5bf7`/141), `node scripts/check-epics-sync.mjs` (expected: OK) and `pnpm measure:tools-payload` (expected: equal to the README rows) -- one call each.
- `(once)` After every armed run: `leftovers` for `EXECMCPTMP396A` is `[]`; `iris_namespace_list` and `iris_database_list` show no `EXECMCPTMP396A`; and `iris_doc_list` (HSCUSTOM, `Story396` and `ExecuteMCPv2.Temp.`, generated included) is empty.

**Planned mutations (Rule 19).** For each one: apply it, observe red, revert, rebuild any dist it touched, and confirm that `git status --short` and `git diff --stat` are unchanged. Record each as `mutation: <change> -> <test that went red>`.
- AC-1: remove the default-state phrase from R2 → `story-39-6-doc-claims`.
- AC-2: swap `trace-message-flow` steps 3 and 4 → `prompt-safety-invariants`; add "Rule #38" to `find-patient-messages` → the AD-28 check.
- AC-3: `applyBodyReaderPolicy` returns `raw.bodyText` under `redact`, interop rebuilt → capstone leg 4 (record the path).
- AC-4: re-declare `function entryOf(` in one gate → `gate-helper-copies`.
- AC-5: append one character to the `iris_doc_get` description, dev rebuilt → `tools-list-snapshot` and `:check` exit 1.
- AC-6: flip `sessionOrHeaderId` `required` → the interop `prompts.test.ts` contract pin.

**Epic-close records** (written by the implement stage): `BOOTSTRAP_VERSION` for the epic, `089f8f0a62b2` → `2fd17b50a024`. Tools 107/112 at the epic start → 109/114 (`iris_message_search` in 39.1 and `iris_message_body` in 39.5; verify against git). Prompts 12 → 13. Baseline `1e62c5ad5bf7`/141. Snapshot: 114 entries, with its SDK and zod versions.

**Results (implement stage, 2026-10-17).**
- **Epic-close records, verified.** `git show da9b9d5^:README.md` reads "107 tools" and `BOOTSTRAP_VERSION` `089f8f0a62b2`; the tree reads 109 package tools (114 advertised), `2fd17b50a024` (`pnpm gen:bootstrap` leaves a zero-line diff), baseline `1e62c5ad5bf7`/141 (`pnpm gen:governance-baseline:check` OK, 210 live keys, 69 post-foundation, file untouched), prompts 12 → 13 (interop 3 → 4), 13 skills.
- **Snapshot.** `packages/iris-mcp-all/src/__tests__/fixtures/tools-list-snapshot.json`: `entryCount` 114 (dev 32, admin 27, interop 25, ops 22, data 8), `sdkVersion` 1.29.0, `zodVersion` 4.3.6. `pnpm gen:tools-list-snapshot:check` exits 0; with no flag the CLI exits 2 and writes nothing.
- **Armed gates, one per call, none skipped** (the `it.runIf(CAPTURE)` capture rows of 39.1 to 39.4 stay off by design): epic38 capstone 6, 38-4 wire 10, 38-5 wire 28, 38-7 wire 10, 38-7 governance process 44, 39-1 103, 39-2 live 17, 39-2 startup 13, 39-2 QA process 17, 39-3 live 93, 39-3 QA live 31, 39-3 QA process 12, 39-4 live 84, 39-4 QA live 9, 39-4 QA process 15, 39-5 live 30, 39-5 QA live 23, 39-5 QA process 15, epic39 capstone 5 (`[PERF]`: first start 190 to 227 ms, header search 46 to 58 ms, lookup 13 to 131 ms, body read 12 to 77 ms). The whole `@iris-mcp/all` suite, armed, in four calls: 255, 257, 512 and 349 tests, 74 files, all passed.
- **Packages.** build, test, lint and type-check: shared (2051 tests), dev (1419), admin (498), interop (642), ops (350), data (165), client-config (514). Lint has 0 errors. The dev package's full parallel run fails `doc-type-description-live-gate` ("iris_package_list ... `*/cls`: expected 12656 to be 12654", a document count read twice on the shared instance while other dev live tests write documents); the file passes alone and the whole package passes with `--no-file-parallelism` (1419 of 1419). Dev source changed only in `prompts.test.ts`.
- **Other commands.** `check-epics-sync.mjs` prints OK; `pnpm measure:tools-payload` equals the README rows (`docs-visibility-roster-sync` passes); `gen:skills`, `gen:skills:check` and `validate:prompts` are clean (13 skills, 26 sources, 110 tool names). `iris_namespace_list`, `iris_database_list` and `iris_doc_list` (HSCUSTOM, `Story396` and `ExecuteMCPv2.Temp.`, generated included) show nothing left.
- **Kept variants** (the guard's `KEPT_VARIANTS`, each with its reason in `gate-helper-copies.test.ts`): `story-38-7-qa-governance-process` `governanceReport` (opens its own session and captures stderr); the `route` wrappers of the 39-3, 39-4 and 39-5 QA live gates (their own request and assertions, calling `postEnvelope`); `story-38-0-qa-process` `startStub` (a caller-chosen status). Also local by design: `wireOptions`/`session` one-liners; the `succeeded` variants; `sendSearch` in the 39-3 and 39-4 gates (raw status and text for the byte-identity rows); the thin session wrappers `openThroughProxy` (39-5), `openTracked` (39-5 QA) and `openOnStub` (39-5 QA process), which bind file-local state around `openAuditedSession`; the inline `[SKIP]` log of the QA process gates' `beforeAll`; the bare `testCtx.skip()` calls of the 38-4 wire gate; 39-1's nested `call`.
- **Mutations** (each applied, observed red, reverted byte-identical, and interop or dev rebuilt where the dist was touched):
  - mutation: R2 row `iris_message_search:searchTable` "a read, enabled by default" -> "a read" -> `story-39-6-doc-claims` (the searchTable row test)
  - mutation: R11 searchTable example loses "enabled by default" -> `story-39-6-doc-claims` (the searchTable example test)
  - mutation: `trace-message-flow` steps 3 and 4 swapped (interop rebuilt) -> `prompt-safety-invariants` ("trace-message-flow runs messages, header search, body read, diagram, logs and the summary, in that order")
  - mutation: "(Rule #38)" added to `find-patient-messages` step 7 (interop rebuilt) -> `prompt-safety-invariants` ("carries no internal rule number and no repository path")
  - mutation: `applyBodyReaderPolicy` redact branch returns `raw.bodyText` unredacted (`message-body.ts:250`), interop rebuilt -> `epic39-capstone-gate` leg 4 red ("SYNTHPHI leaked ... expected ['the body result'] to deeply equal []"), legs 1, 2, 3 and 5 green. Guarded path: SDK `Client` -> built interop dist over stdio -> `iris_message_body` -> `applyBodyReaderPolicy` -> `redactHl7`. A second mutation, `redactPhiInputs` disabled in the spawned server only, turned leg 4 red naming `the audit file`.
  - mutation: `function entryOf(` appended to `story-39-5-qa-process.test.ts` -> `gate-helper-copies` ("story-39-5-qa-process.test.ts: entryOf")
  - mutation: one character appended to the `iris_doc_get` description (`packages/iris-dev-mcp/src/tools/doc.ts:169`), dev rebuilt -> `tools-list-snapshot` (3 tests) and `pnpm gen:tools-list-snapshot:check` exit 1, naming `iris-dev-mcp iris_doc_get.description differs at $.description (character 811)`
  - mutation: `sessionOrHeaderId` `required: true` -> `false` -> interop `prompts.test.ts` ("keeps its name, title and arguments exactly as first published")
- **Review-pass mutations** (each applied, observed red, reverted byte-identical with `git status --short` and `git diff --stat` unchanged, and interop rebuilt where its dist was touched):
  - mutation: a nested `async function entries(file)` pasted into the describe of `story-39-2-data-policy-live-gate.test.ts` -> `gate-helper-copies` ("story-39-2-data-policy-live-gate.test.ts: entries")
  - mutation: `compareSnapshot` lists a tool as added when the snapshot HAS it (condition inverted) -> `tools-list-snapshot` (4 tests, the live row "reports exactly the live tools the snapshot does not list as added" among them, although the live `added` is empty)
  - mutation: `skipTest` drops the tag from its `[SKIP]` line -> `process-gate-helpers` (the skipTest row)
  - mutation: `postEnvelope` returns `errors: []` -> `process-gate-helpers` (the postEnvelope row)
  - mutation: `atelierScalar` reads the second column instead of the first -> `process-gate-helpers` (the atelierScalar row)
  - mutation: `annotations` removed from `ENTRY_FIELDS` of the snapshot core (the module the CLI and the test share) -> `tools-list-snapshot` (the annotation drift row and the pinned-fields row)
  - mutation: the root script `gen:tools-list-snapshot:check` loses `--check` -> `tools-list-snapshot` (the package.json scripts row)
  - mutation: `find-patient-messages` writes the filters value as `"${patientId}"` without `JSON.stringify` -> interop `prompts.test.ts` (the hostile-identifier row)
  - mutation: `STORY396_IDS.hl7` `"1,2,3"` -> `"1,2"` -> `interop-namespace-fixture.test.ts` (the capstone seed row); the capstone's leg 1 pins the same map
  - mutation: `skills/find-patient-messages/SKILL.md` deleted -> `skills-generated-frontmatter` and `pnpm gen:skills:check` (drift reported)
  - mutation: `process.stderr.write(raw.bodyText)` before the redaction in `applyBodyReaderPolicy`, interop rebuilt -> `epic39-capstone-gate` leg 4 red naming `the server's stderr` and nothing else (legs 1, 2, 3 and 5 green). Guarded path: SDK `Client` -> built interop dist over stdio -> `iris_message_body` -> server stderr -> the sweep of leg 4.
- **Re-run after the review patches** (the `(loop)` lines and then the `(once)` lines, in the foreground, one gate per call): the interop build and `prompts.test.ts` (21 tests); dev (9), admin (4) and ops (3) `prompts.test.ts`; `gen:skills`, `gen:skills:check` and `validate:prompts` clean; `gen:tools-list-snapshot:check` OK (114 entries); the 19-file default-suite batch (468 tests); `story-39-1-gate-guards` (32) and `epic38-gate-guards` (11); the armed capstone (5, none skipped). Then every moved gate armed, one per call, none skipped apart from the `it.runIf(CAPTURE)` capture rows: epic38 capstone 6, 38-4 wire 10, 38-5 wire 28, 38-7 wire 10, 38-7 governance process 44, 39-1 103 (1 capture row skipped), 39-2 live 17 (1), 39-2 startup 13, 39-2 QA process 17, 39-3 live 93 (1), 39-3 QA live 31, 39-3 QA process 12, 39-4 live 84 (1), 39-4 QA live 9, 39-4 QA process 15, 39-5 live 30, 39-5 QA live 23, 39-5 QA process 15. The other 55 files of `@iris-mcp/all`, armed, in two calls: 27 files with 243 tests and 28 files with 569 tests. Packages (build, test, lint, type-check): shared 2051, dev 1419, admin 498, interop 646, ops 350, data 165, client-config 514 tests; lint has 0 errors (shared reports 1 warning). `pnpm gen:bootstrap` leaves a zero-line diff (`2fd17b50a024`), `pnpm gen:governance-baseline:check` is OK (141 frozen keys, the file untouched), `check-epics-sync.mjs` prints OK, and `pnpm measure:tools-payload` equals the README rows. After the armed runs, `iris_namespace_list` and `iris_database_list` show no `EXECMCPTMP396A`, and `iris_doc_list` (HSCUSTOM, `Story396` and `ExecuteMCPv2.Temp.`, generated included) is empty.
- **Decisions applied from the plan** (I1 to I5 held as written). Where a gate's local copy differed from the export in pass/fail terms, the copy stayed (above); the exported stub's `close()` also calls `closeAllConnections()`, and `pollAuditEntries` reads once more at its deadline; neither changes a verdict.

**QA (2026-10-17).** Gap analysis against the matrix and ACs; two files added, no source change.
- `packages/iris-mcp-all/src/__tests__/story-39-6-qa-forensics-prompts-sdk-wire.test.ts` (QA, 13 tests; AC-2, AC-6; Rule #46): the interop server built from the dists, a real SDK `Client` over `InMemoryTransport.createLinkedPair()`. Pins the capability, the four-prompt `prompts/list` (`find-patient-messages` last, five arguments), the `trace-message-flow` name, title and arguments against the first-published literal after the SDK's result validation, both flows in order with optional arguments omitted and given, `getPrompt({name})` with `arguments` omitted (required-argument prompts: InvalidParams naming the prompt, connection usable; the all-optional `recover-stuck-production`: a clean refusal or a render, and a render with `arguments: {}`), five hostile patient identifiers written as JSON in the filters example, the served text equal to the dist's `build()`, every `iris_*` token on `tools/list` and visible under `IRIS_TOOLS_PRESET=core`, no rule number or repository path in any interop prompt or in either generated skill body, the skill description equal to the wire's, and no loosening of the policy or write tool in the lookup walk.
- `packages/iris-mcp-all/src/__tests__/story-39-6-qa-snapshot-cli.test.ts` (QA, 12 tests; AC-5, AC-7): the snapshot CLI spawned in all three modes on throwaway trees (CLI and libraries copied, built packages linked, a snapshot of the tree's own). No flag, an unknown flag and both flags refuse with exit 2 and create or change nothing; `--check` is read-only (bytes and mtime) on a match, a new tool (exit 0, listed), a changed description, a flipped annotation and a vanished tool (exit 1, naming `<package> <tool>.<field>` and the path); the capture ignores `IRIS_TOOLS_*`; `--force` re-pins a drifted copy (names the 2 entries), writes the generator's own file, writes into a tree with no snapshot, rewrites a current copy changing only `capturedAt`, and the written file passes `--check`. The committed fixture is hashed before and after and never rewritten.
- mutation: the CLI's `no flag given` refusal removed (a bare run falls through to `--force`) -> `story-39-6-qa-snapshot-cli` (both no-flag rows), real fixture untouched
- mutation: `--force` builds the document but does not write it -> `story-39-6-qa-snapshot-cli` (the three `--force` rows; the already-current row was strengthened to assert a rewritten `capturedAt` after it stayed green)
- mutation: `--check` rewrites the snapshot on success -> `story-39-6-qa-snapshot-cli` (the match row and the new-tool row, on mtime)
- mutation: `findPatientMessages.ts` writes `"${patientId}"` without `JSON.stringify`, interop rebuilt -> `story-39-6-qa-forensics-prompts-sdk-wire` (the hostile-identifier row)
- mutation: `traceMessageFlow.ts` `sessionOrHeaderId` `required: true` -> `false`, interop rebuilt -> `story-39-6-qa-forensics-prompts-sdk-wire` (the first-published-contract row and the missing-argument row)
- Each mutation reverted; `shasum` of the touched sources, the interop prompt dists and the committed fixture equals the pre-mutation value, `git diff --stat` empty, and interop rebuilt after the last revert.
- Capstone red proof verified, not re-run: the mutation point (`applyBodyReaderPolicy`, redact branch, `message-body.ts` / `dist/tools/message-body.js:156`) holds the unmutated `redactHl7(raw.bodyText)` and the dist holds no stderr write; leg 4 sweeps the lookup result, the body result, the audit file and stderr with one detector whose positive control fires in leg 5 on the result and on the audit file (the stderr control is the recorded mutation above); the interop dist is in the staleness check. The armed capstone, run once unmutated after the QA rebuilds: 5 passed, none skipped; `iris_namespace_list` and `iris_doc_list` (HSCUSTOM, `Story396` and `ExecuteMCPv2.Temp.`, generated included) show nothing left.
- Also run clean: `pnpm gen:skills:check` (14 files), `pnpm validate:prompts` (13 prompts, 13 skills), `pnpm gen:tools-list-snapshot:check` (114), the 19-file default-suite batch plus the two QA files (493 tests), `story-39-1-gate-guards` (32), `epic38-gate-guards` (11).

**Code review (2026-10-17).** The patches are listed under Review Findings. Each mutation was applied, observed red, and restored from a saved copy, with `shasum` equal to the pre-mutation value. Interop was rebuilt after every interop `src` mutation, and its `dist/` and `tsconfig.tsbuildinfo` were cleared before the last rebuild, because an unchanged-content compile emits nothing and leaves the dist mtime stale.
- mutation: `process.stderr.write(raw.bodyText)` in the allow path of `applyBodyReaderPolicy` (`message-body.ts`, before the `none` outcome), interop rebuilt -> `epic39-capstone-gate` leg 5 red ("the allow server's stderr holds no body-only value"), legs 1 to 4 green. Guarded path: SDK `Client` -> built interop dist over stdio -> `iris_message_body` under `IRIS_DATA_POLICY=allow` -> server stderr. Source and dist checksums restored.
- mutation: `function denial(action: string)` appended to `story-38-4-qa-doc-edit-wire-gate.test.ts` -> `gate-helper-copies` ("story-38-4-qa-doc-edit-wire-gate.test.ts: denial")
- mutation: the `story-39-2-data-policy-live-gate.test.ts` row deleted from `GATES` -> `story-39-1-gate-guards` (the completeness row names the file)
- mutation: the step 3 refusal sentence removed from `trace-message-flow` -> interop `prompts.test.ts` (the step 3 row)
- mutation: `searchTableClass` written as `"${searchTableClass}"` without `JSON.stringify` -> interop `prompts.test.ts` (the hostile-value row)
- mutation: the `Pinning N new tool(s)` block of `runForce` disabled -> `story-39-6-qa-snapshot-cli` (the `--force` drift row)
- Re-run after the patches: the interop build and its full suite (647 tests); `gen:skills` (only `skills/trace-message-flow/SKILL.md` moved), `gen:skills:check` and `validate:prompts` clean; `gen:tools-list-snapshot:check` OK (114 entries); the 20-file `@iris-mcp/all` default-suite batch (485 tests); `story-39-1-gate-guards` (37); the armed capstone (5 passed, none skipped; `[PERF]` first start 196 ms, searches 15 to 122 ms, body reads 12 to 74 ms); and a final 16-file batch including both gate guards (385 tests). ESLint on every edited TS file reports nothing; interop `lint` and `type-check` are clean. After both armed runs, `iris_namespace_list` shows no `EXECMCPTMP396A`, and `iris_doc_list` (HSCUSTOM, generated included) shows no `Story396` or `Story391Fixture` document.

## Auto Run Result

Status: done
Blocking condition: none

**Implement and review (2026-10-17).**
- **Summary.** `trace-message-flow` now searches, reads and diagrams (name, title and arguments unchanged and pinned), and the interop prompt `find-patient-messages` is added (13 prompts, 13 generated skills). The default-suite capstone `epic39-capstone-gate.test.ts` drives the built dev, admin and interop servers over the SDK client on `EXECMCPTMP396A` (seeded fixture mu, no production), checks the deployed `BOOTSTRAP_VERSION` first, and is proven red by disabling redaction and by writing the body to stderr. DW-561: the duplicated gate helpers are exports of `process-gate-helpers.ts` and 18 gates use them, with `gate-helper-copies.test.ts` as the guard. DW-573: a 114-entry `tools/list` snapshot (SDK 1.29.0, zod 4.3.6) with a shared core, a CLI (`--check`, `--force`) and a default-suite test. Docs R1 to R16, the CHANGELOG section, the changeset (`@iris-mcp/interop` minor) and `docs/epic-summary.md` are done.
- **Files changed.**
  - Prompts: `packages/iris-interop-mcp/src/prompts/traceMessageFlow.ts` (flow and description), `findPatientMessages.ts` (new), `prompts/index.ts`; `skills/` regenerated through `pnpm gen:skills`.
  - Capstone and fixture: `epic39-capstone-gate.test.ts` (new), `interop-namespace-fixture.ts` (`Story396.Seed`, `seedCapstone`), `prepublish-gate.mjs`, `story-39-1-gate-guards.test.ts`.
  - DW-561: `process-gate-helpers.ts` (+ `process-gate-helpers.test.ts`), `header-row-oracle.ts`, `gate-helper-copies.test.ts` (new) and 18 gate files.
  - DW-573: `scripts/lib/tools-list-snapshot-core.mjs`, `scripts/gen-tools-list-snapshot.mjs`, `fixtures/tools-list-snapshot.json`, `tools-list-snapshot.test.ts`, two root `package.json` scripts.
  - Docs and counts: README, interop README, `tool_support.md`, three client guides, `CHANGELOG.md`, `docs/epic-summary.md`, the changeset, `story-39-6-doc-claims.test.ts`, and the repinned prompt-count tests of interop, dev, admin, ops and `iris-mcp-all`.
- **Review.** Four layers, 48 findings: high 0, medium 6, low 36, false 6. 28 findings were patched (6 medium and 22 low; the 5 medium entries were the window rule of `trace-message-flow`, the vacuous live "added" row, the nested-`entries` blind spot of the helper-copy guard, the untested `postEnvelope` and `atelierScalar`, and the stderr leak control). 20 were rejected (14 low, 6 false) with their reason in the triage log. Nothing was deferred (`deferred: []`).
- **Follow-up review recommendation: true.** Patched entries by verdict: high 0, medium 5. The specific unverified risk: the prompt-text clauses added after the layers ran (the `trace-message-flow` step 1 and 2 clauses, the `find-patient-messages` refusal and namespace sentences) are pinned by string tests only and were not re-read by an independent layer.
- **Verification.** See Verification, Results: the `(loop)` and `(once)` commands all pass after the last patch, every moved gate and the capstone armed with none skipped apart from the by-design capture rows, the instance holds nothing of ours afterwards, and `BOOTSTRAP_VERSION` is `2fd17b50a024` (the epic: `089f8f0a62b2` to `2fd17b50a024`).
- **Residual risks.** The dev package's full parallel run can fail `doc-type-description-live-gate` on a document count read twice on the shared instance (passes alone and with `--no-file-parallelism`; not part of this change). Moved gates differ from their copies in failure wording (`Error` where `expect` failed), in the stub's `close()` and in the audit poll's final read, which Results lists; none changes a verdict.
