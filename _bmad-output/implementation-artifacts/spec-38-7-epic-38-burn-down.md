---
title: 'Story 38.7: Epic 38 Burn-Down'
type: 'bugfix'
created: '2026-10-16'
status: 'ready-for-dev'
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
      An unknown governance key inside a layer (a typo such as {"global":{"iris_doc_putt":false}}) is accepted silently and does nothing: the same fail-open class as DW-554, one level down.
    evidence: |-
      Plan-time read 2026-10-16: governance.ts validateLayer (263-293) checks only empty, reserved and non-boolean entries; the engine has no logger and never warns. All five servers share one env block, so a key unknown to one server can be valid for another; a check needs the suite-wide key universe the CLI `universe` command already computes.
    location: packages/shared/src/governance.ts:263
    severity: med
  - summary: >-
      The JSON-parse errors of IRIS_GOVERNANCE and IRIS_GOVERNANCE_FILE embed V8's message, which can quote a snippet of the input, although the doc comments at governance.ts:106 and :406 say contents are never echoed.
    evidence: |-
      Plan-time probe 2026-10-16 (Node v26.8.1): {"iris_doc_put": fals} gives `Unexpected token '}', ..."put": fals}" is not valid JSON`; governance-file.test.ts:184 passes only because its fixture yields the snippet-free "Expected property name" message.
    location: packages/shared/src/governance.ts:321
    severity: low
  - summary: >-
      The iris_doc_list `type` description offers 'cls' as an example for category CLS, but Atelier answers GET docnames/CLS/cls with HTTP 400 (CLS accepts only `*`).
    evidence: |-
      Plan-time read-only probe 2026-10-16, IRIS 2026.2 build 221U, Atelier v8, HSCUSTOM: GET /api/atelier/v8/HSCUSTOM/docnames/CLS/cls -> 400; %Api.Atelier.v1:GetDocNames accepts type `*` only for CLS.
    location: packages/iris-dev-mcp/src/tools/doc.ts
    severity: low
---

<intent-contract>

## Intent

**Problem:** Epic 38 left 11 real defects in the ledger. Among them: a governance config that fails open; a production delete that removes any class; a launcher that leaks `MCP_TRANSPORT` into the servers it starts; document I/O that reports errors as success, gets 409s it never resolves, or calls a dead `modifiedSince` route; promote writes whose status is never read; an overclaiming SQL cap text; and live gates that depend on test order or run in parallel against one shared instance.

**Approach:** Fix each entry at its root, with the smallest change that reuses the epic's existing helpers: `parseGovernanceRoot`, `atelierDocStatusError`, the 38.3 409 flow, the 38.0 delete predicates and the 38.6 gate helpers. Prove each fix live on the real surface or by mutation (Rule #48), naming the path that was exercised. Pin every existing valid configuration and call as byte-identical. Behavior moves only where orchestrator decisions #17 and #18 sanction it (AD-15), and each move is named in the CHANGELOG.

## Boundaries & Constraints

**Always:**
- **Shared IRIS instance.** Every IRIS call and live gate names all six `IRIS_*` variables: localhost:52773, HSCUSTOM, `_SYSTEM`/`SYS`, `IRIS_HTTPS=false`. MCP calls use `server:"default"` and `namespace:"HSCUSTOM"`.
- **Writes.** Write only to disposable `ExecuteMCPv2.Temp.*` fixtures. Remove them before and after each run, and assert they are gone.
- **Refusals.** A refusal is `isError` and writes nothing. Refusal codes come only from `refusals.ts`. Argument errors carry no code.
- **Error text.** It reads `<what happened>. <what to do about it>.`, never echoes a submitted value or file contents, and IRIS-side text goes through `SanitizeError`.
- **Order of work.** Land DW-562 (serialization) before the bootstrap regeneration. A changed bootstrapped class regenerates the embed in the same story (`pnpm gen:bootstrap`), and the record shows `BOOTSTRAP_VERSION` moving from `d352a6a32158` to the new value (Rule #24).
- **Counts stay put.** No tool, action, key or preset row changes: dev 31/32, suite 107/112, dev `core` 14/15, 12 prompts. `GOVERNANCE_BASELINE` stays at `1e62c5ad5bf7`/141 and is checked with `:check` only.
- **Sanctioned behavior moves**, each named in `CHANGELOG.md` under Story 38.7:
  - DW-554: fail-fast;
  - DW-533: the new refusal;
  - DW-542: `isError`;
  - DW-528: the `modifiedSince` refusal;
  - DW-539: the launcher clears `MCP_TRANSPORT`;
  - DW-549: the version-checked save, under Fixed (decision #7 precedent).

  Everything else is byte-identical and pinned with `toEqual`/`toStrictEqual`.

**Never:**
- **IRIS instance.** Never start a production on the shared instance, and never stop, restart or reconfigure IRIS. Never target `ocupilot-slot-*`.
- **Owned elsewhere; do not fix incidentally:**
  - Storage guards on load, promote and the xml import (DW-544/545/546, terminal). DW-549 and DW-530 change only version and status handling.
  - The macOS launcher-suite red (DW-532, Story 42.7).
  - `destructiveHint` (DW-560, Story 42.1).
  - The HTTP transport (DW-538).
  - Helper consolidation (DW-543/550/557/561).
- **Governance.**
  - Never run the bare governance-baseline generator.
  - Never fail startup on an unknown name under `profiles`; that case only warns (Design Notes, D2).
- **SQL cap.** No storage detection for the cap text (DW-558 is text only).
- **Atelier `/modified`.** Never call `POST /modified`. It writes source-journal bookkeeping (plan probe).
- **`modifiedSince`.** Never remove the `modifiedSince` parameter; removing it is breaking (AD-15).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| DW-554 flat shape | `IRIS_GOVERNANCE={"iris_doc_put":false}` | The built server exits 1 before any IRIS traffic. stderr: `IRIS_GOVERNANCE is invalid: "iris_doc_put" is not a recognized top-level key, so it would be ignored. Use the documented shape {"global":{"<tool\|tool:action>":true\|false},"profiles":{"<profile>":{...}}}: put the key under "global" to apply it to every profile, or under "profiles" for one profile.` | fail fast; the value is never echoed |
| DW-554 top-level profile or layer typo | `{"prod":{...}}` or `{"globals":{...},"global":{...}}`, in env or file | The same detail, naming `"prod"` / `"globals"`. The file form carries `IRIS_GOVERNANCE_FILE is invalid: ... (path: <p>)`. The CLI `set`/`unset`/`validate` exit 1 with that message, and the file is byte-identical afterwards. | fail fast |
| DW-554 other governance-shaped keys | `{"IRIS_DOC_PUT":false}` (boolean value); `{"iris_doc_put":"false"}` (an `iris_` prefix, case-insensitive, with any value) | Rejected with the same detail | fail fast |
| DW-554 scalar metadata (Story 32.4) | `{"comment":"team policy","version":1,"global":{...}}` | Accepted. The parsed config `toEqual`s `{global:{...}}`, and the CLI still preserves the keys on write. | none |
| DW-554 valid shapes | `{}`, `{"global":{...}}`, `{"profiles":{...}}`, both, and the file layer | Parsed config and effective policy `toEqual` today | none |
| DW-554 unknown profile name | `{"profiles":{"prdo":{...}}}`; configured profiles `default`, `prod` | Starts with an unchanged policy. One `[WARN]`: `IRIS_GOVERNANCE: profile "prdo" under "profiles" is not a configured profile, so its overrides apply to no connection. Check the name against the configured profiles: default, prod.` The file form starts `IRIS_GOVERNANCE_FILE (path: <p>): `. | warn only |
| DW-533 non-production class | delete `ExecuteMCPv2.Temp.Story387Plain` (compiled, extends `%RegisteredObject`) over real HTTP | The error envelope: `Class 'ExecuteMCPv2.Temp.Story387Plain' is not a production class (it does not extend Ens.Production), so nothing was deleted. Name a production class.` The class still exists. The TS result is `isError` and carries that text. | refusal; nothing written |
| DW-533 non-production class plus a same-named `Ens.Config.Production` row | class and row both exist | Refused as above; the class and the row both remain | refusal |
| DW-533 uncompiled production | saved, never compiled, direct `Super` contains `Ens.Production` (an exact comma piece) | Deleted: `{"action":"deleted","name":...}`, no `orphanRemoved` | none |
| DW-533 existing paths | a Stopped compiled production; an orphan row; a missing name | As today: deleted; `orphanRemoved: true`; `Production 'X' does not exist` | as today |
| DW-531 seam (injected) | `DeleteStateRefusal(target, 1, $$$OK, target, s)` | s=1 gives the exact Running message; s=0,3,4,5,6 give the state message; s=2 or -2 give `""`; another current name gives `""`; an injected error status gives `""` | none |
| DW-539 ambient transport | the extension host env has `MCP_TRANSPORT=http` | The definition env has `MCP_TRANSPORT: null`. The spawned stdio server completes `initialize`. | none |
| DW-542 no-range soft error | `iris_doc_get {name:"ExecuteMCPv2.Utils"}` (HTTP 200, `content:""`, `status:"ERROR #16006 ..."`) | `isError:true`, no `structuredContent`; text `Document 'ExecuteMCPv2.Utils' could not be read in namespace 'HSCUSTOM': <status>. Check the document name and namespace, then retry.` | reported |
| DW-542 no-range normal | the 38.2 fixtures with `status:""` | Byte-identical (`toStrictEqual` unchanged) | none |
| DW-549 existing doc | `ignoreConflict:false`, the document exists | An unversioned PUT gets a 409 (the 9-key body and `ts`); a second PUT goes with `If-None-Match: <ts>`; the file is `uploaded`. Exactly 2 PUTs. | none |
| DW-549 conflict | the version-checked PUT gets a 409 | `failures[]` gets `{file, docName, error:"The document changed on the server while this tool was saving it, so nothing was stored. Run iris_doc_load again to replace the current version.", code:"DOCUMENT_CONFLICT"}`. There is no third PUT, and the other files continue. | per file |
| DW-549 unchanged paths | a new doc under `false`; a 409 without the 9-key body; a soft error on the retry; default `true` | New doc: one PUT. Bad 409: a failure carrying its message, no retry. Soft error on the retry: `IRIS refused the upload: <status>`. Default `true`: one `?ignoreConflict=1` PUT, byte-identical. | as today |
| DW-528 refusal | a non-empty `modifiedSince` on `iris_doc_list`, `iris_doc_export` or `iris_package_list` | `isError:true`, no code, zero HTTP requests. Text: `modifiedSince is not supported, so nothing was <listed\|exported\|counted>: IRIS has no way to list documents changed since a timestamp (its change list works from a database hash). Omit modifiedSince; to find recent changes, list the documents with iris_doc_list and compare each one's ts.` | refusal |
| DW-528 unchanged | `modifiedSince` absent or `""` | Byte-identical docnames path | none |
| DW-530 soft status | promote `execute`; the 2nd target PUT answers 200 with a non-empty `status` | Same halt as a thrown PUT error. That step is `failed` with `error`: `IRIS reported an error after the write of '<doc>' to the target: <status>. The document may have been saved on the target; check it with iris_doc_get before running iris_env_promote again.` | halts (AD-17) |
| DW-558 cap text | a capped DML over its cap | The sentence becomes `Its row changes were undone, except in storage that is not journaled, such as a table stored in IRISTEMP.` The rest of the text and the `structuredContent` are unchanged. | refusal |
| DW-556 order | each touched gate armed, with `--sequence.shuffle --sequence.seed=<n>` | All pass; no `QaStory38x` leftovers | none |
| DW-562 serial | the default `@iris-mcp/all` `vitest run` | No two test files ever run at the same time | none |

</intent-contract>

## Code Map

- **DW-554, governance.**
  - `packages/shared/src/governance.ts`:
    - `parseGovernanceRoot` (:336-383) is private and reads only `root.global` and `root.profiles`. The rejection goes here, once.
    - Builders: env (:101) `IRIS_GOVERNANCE is invalid: ${detail}`; file (:110) `IRIS_GOVERNANCE_FILE is invalid: ${detail} (path: ${path})`.
    - Also `validateLayer` (:263-293), `parseGovernanceConfig` (:308), `loadGovernanceFile` (:416) and `parseGovernanceFileText` (:450).
  - `packages/shared/src/server-base.ts` `start()`:
    - the profile registry is built at :2006-2010;
    - `parseGovernanceConfig()` runs at :2018 and `loadGovernanceFile()` at :2030;
    - add the unknown-profile warning after :2030 with `logger.warn`.
  - The error reaches each package's `src/index.ts` `Fatal:` catch, which exits 1.
  - `packages/shared/src/cli/governance.ts`:
    - `set` validates the pre-image at :780 and `unset` at :900;
    - `warnOnLayerShapedUnknownKeys` (:467-485) stays, still reachable for scalar near-misses;
    - `serializeConfigPreservingUnknown` (:429-457) stays.
  - Gate 4 re-parse: `packages/iris-dev-mcp/src/tools/env-promote.ts:1113`; no change.
- **DW-554 test pins.**
  - **Pins that change** (each pins the fail-open):
    - `packages/shared/src/__tests__/governance-edge.test.ts:111-120` (`notAProfile:{x:true}`; `foo:1` stays accepted);
    - `packages/shared/src/__tests__/governance-cli.test.ts:448` (`globals` object);
    - `packages/iris-mcp-all/src/__tests__/governance-file-process-gate.test.ts:790-860` (case J, `globals:{"iris_doc_put":false}`).
  - **Valid-shape pins that must stay green:**
    - `governance.test.ts:76,87,98`;
    - `governance-file.test.ts:170-237`;
    - `governance-cli.test.ts:421-474` (the `comment`/`version` cases);
    - process gate case D (:468-500).
  - **No profile registry in the parser.** `governance.test.ts`, `governance-cli.test.ts` and `env-promote-execute.test.ts:255-400` use profile names without `IRIS_PROFILES`, which is why the profile check lives in `start()`.
- **DW-554 docs.**
  - Root `README.md`:
    - the governance section (:366-387);
    - the file section (:412, :422);
    - the fail-fast list (:598). It is pinned by `story-38-1-qa-doc-claims.test.ts:125-130` and `story-38-6-doc-claims.test.ts:234-244`, whose capture stops at the first `)`.
- **DW-533 / DW-531, production delete.**
  - `src/ExecuteMCPv2/REST/Interop.cls` `ProductionManage` (:44-175):
    - the state guard (:121-133): `GetProductionStatus` (:126), then `DeleteBlockedByState` (:127), then the message;
    - the class path (:135-146);
    - the orphan path (:147-157);
    - "does not exist" (:158-164).
  - Helpers: `DeleteBlockedByState` (:19), `StateName` (:25), `DeleteBlockedMessage` (:32).
  - **Precedent for the class check:** `ValidateHostClassName` (:967-994). It checks `CompiledClass` and `%Extends` and fails safe. The note at `Loc/Scanner.cls:62-83` explains why `$classmethod` is wrapped in an inner Try.
  - **IRIS tests.**
    - `src/ExecuteMCPv2/Tests/InteropHostGuardTest.cls`: 129 lines, 6 `Test*` methods, read-only.
    - `src/ExecuteMCPv2/Tests/InteropProductionDeleteTest.cls`: 256 lines, 4 `Test*` methods. It has `RemoveFixtures` (:54-80, prefix `ExecuteMCPv2.Temp.Story380`), `PostJson` (:110) and `ManageBody` (:141).
  - **Bootstrap:** `scripts/gen-bootstrap.mjs:33` and `packages/shared/src/bootstrap-classes.ts:25` (`d352a6a32158`).
  - **TS:**
    - `packages/iris-interop-mcp/src/tools/production.ts:22-88`; the description is :26-32.
    - IRIS text arrives as `Details:` through `IrisApiError`.
    - Tests: `packages/iris-interop-mcp/src/__tests__/production.test.ts:89-100` (description pin) and :118-131 (the error mapping).
  - **Docs:** `packages/iris-interop-mcp/README.md:137` (tool row) and :872-873 (Common Errors).
- **DW-539, launcher.**
  - `extensions/iris-mcp-launcher/src/env.ts`: `LAUNCHER_OWNED_VARS` (:122-146, 21 names) and its doc comment (:103-121).
  - Whole-env `toEqual` pins: `src/__tests__/selectServers.test.ts:862-890` and `serverDefinitionProvider.test.ts:1185-1227`.
  - `localSpawnIntegration.test.ts`: a real spawn via `resolveEnvForLabel` and `toSpawnEnv` (:151). The SDK `getDefaultEnvironment()` passes no `MCP_TRANSPORT`, so the new case must layer the definition env over an ambient env containing it, as VS Code does.
  - Docs: `README.md:351-356` and `CHANGELOG.md` "0.1.0 — Unreleased".
  - The launcher is not a pnpm workspace package. vitest is the root 2.1.9.
- **DW-542, `iris_doc_get` no-range path.**
  - `packages/iris-dev-mcp/src/tools/doc.ts`:
    - the no-range return (:296-301) never reads `status`;
    - reuse `atelierDocStatusError` (`packages/shared/src/atelier.ts:189`, which returns `string | undefined`), `rangeError` (:69) and `unreadableDocumentText` (:104).
  - Pins:
    - the no-range literals at `doc-get-range.test.ts:102-217`, all with `status:""`;
    - the `SOFT_ERROR_RESULT` fixture at :245-253;
    - the live ranged case at `doc-get-range-live-gate.test.ts:340-351`.
- **DW-549, `iris_doc_load` version flow.**
  - `packages/iris-dev-mcp/src/tools/load.ts`:
    - `ignoreConflict` schema (:347-349) and flag (:385);
    - the PUT (:449-457);
    - the soft-error failure (:468-476) and the thrown failure (:478-484);
    - the result (:540-569).
  - `doc.ts`:
    - `CurrentDocument` (:327-332) and the private `currentDocument(error)` (:341-348), which checks the 409, the 9-key body, `ts` and the status. Export it.
    - The put flow is :427-466.
  - `load.test.ts:314-326` is the resolving fake to replace. Real-shape 409 fakes `conflict()` and `currentClass()` are at `doc-put-storage-guard.test.ts:90-113`; `versionChecked` is at :271.
  - Live: the `doc-put-bom-live-gate.test.ts` load describe (:174-222, `QaStory380Load`).
  - Dev `README.md:150`.
- **DW-528 / DW-529, `modifiedSince`.**
  - The branches: `doc.ts:672-678` (`iris_doc_list`), `export.ts:399-413` with `filtersApplied` at :387-394, and `packages.ts:196-207`.
  - The descriptions:
    - `doc.ts:639-645` and :598;
    - `export.ts:285-292` and :227;
    - `packages.ts:149-156`, :95-96, and the module doc at :6 and :12.
  - `export.ts` and `packages.ts` already import from `./doc.js`.
  - Pins:
    - `doc.test.ts:525-584` and :632-655;
    - `packages.test.ts:213-268`;
    - `export.test.ts:487-540` (the mock at :74);
    - `tools.integration.test.ts:183-190` (excluded suffix; update it anyway).
  - Docs: dev `README.md:149`, :151 and :157; `tool_support.md:34`.
- **DW-530, promote.**
  - `env-promote.ts:868-869` sends `?ignoreConflict=1` and discards the body. The halt is `runDocumentsBatch` (:835-927), with `putFailedAt` at :871-886.
  - Tests: `env-promote-execute.test.ts:907-1097`; the 409 halt case is at :963-1007.
  - The real soft-error PUT shape (HTTP 200, `ERROR #16021: Illegal Header Line`) is live-captured in the `doc-put-bom-live-gate.test.ts` header.
- **DW-558, SQL cap text.**
  - `packages/iris-dev-mcp/src/tools/sql.ts:201-202` (the `overCap` branch, :189-205). It is TS only; `Sql.cls` emits only the outcome name.
  - Exact pins:
    - `sql-safety.test.ts:345-346`, :377-378, :388-390 and :501-502;
    - `sql-safety-live-gate.test.ts:609-612`;
    - `packages/iris-mcp-all/src/__tests__/story-38-5-qa-sql-wire-gate.test.ts:589-593`.
  - Docs: root `README.md:459` and dev `README.md:195`.
- **DW-556, cleanup tests.** The mechanical enumeration found 19 armed files and exactly two with a cleanup test case:
  - `packages/iris-dev-mcp/src/__tests__/doc-edit-live-gate.test.ts:619-628`. Its `afterAll` (:249-254) already removes and asserts.
  - `doc-put-storage-guard-live-gate.test.ts:972-981`. Its `beforeAll` (:272) and `afterAll` (:275-278) remove but do not assert.
  - Precedent: `story-38-5-qa-sql-wire-gate.test.ts:251-273`.
- **DW-562, serial suite.**
  - `packages/iris-mcp-all/vitest.config.ts` sets no `fileParallelism`. vitest 2.1.9 declares `fileParallelism` and `poolMatchGlobs`, but no `sequence.groupOrder`.
  - `epic38-gate-guards.test.ts`: the child-vitest spawn with `cwd: PACKAGE_DIR` and a closed local port is at :73-76, and `GATES_WITH_VERSION_CHECK` is at :33-37.
  - `scripts/prepublish-gate.mjs:135` keeps `--no-file-parallelism`, pinned by `story-38-6-doc-claims.test.ts:375-377`.
- **Write-path roster.**
  - `packages/iris-mcp-all/src/__tests__/document-write-paths.test.ts:88-93`: the `load.ts` count moves 1 → 2, and the verdict stays `excluded` (DW-544).
  - The `doc.ts` (4) and `env-promote.ts` (1) counts are unchanged.

## Tasks & Acceptance

**Execution:**
- **DW-562** -- `packages/iris-mcp-all/vitest.config.ts`: add `fileParallelism: false` and a one-line comment naming why (the three gates bootstrap one shared instance).
- **DW-562** -- `packages/iris-mcp-all/src/__tests__/epic38-gate-guards.test.ts`: add a guard that drives a child `vitest run` with the package's own config, with no `--no-file-parallelism`, a closed local port and arming unset.
  - It observes whether two test files of that run execute at the same time. Suggested shape: two inert probe files that act only when the guard's env var names a marker directory; each holds a marker for about 2 s and checks for the other's.
  - It skips with a reason when `os.availableParallelism() < 2`.
  - This is the gate's own path (Rule #59).
- **DW-554** -- `packages/shared/src/governance.ts` `parseGovernanceRoot`: iterate the root's keys.
  - Any key other than `global` and `profiles` throws through `fail` with the matrix detail (key named, value never echoed) when the key matches `/^iris_/i`, or its value is a boolean or a non-null, non-array object.
  - Other keys stay accepted and dropped, as today.
- **DW-554** -- `packages/shared/src/server-base.ts` `start()`: after :2030, for each name under `profiles` in either channel that is not in `this.profiles`, `logger.warn` the matrix text once (the file form names the path).
- **DW-554** -- tests.
  - `governance-edge.test.ts`, `governance.test.ts`, `governance-file.test.ts`: add the rejection rows (flat, top-level profile, `globals` object, `IRIS_DOC_PUT:false`, `iris_doc_put:"false"`) for env and file, with no value echoed. Add the scalar-metadata row and `toEqual` pins of every valid shape. Move :111-120 to the new contract.
  - `governance-cli.test.ts:448`: `set`/`unset`/`validate` exit 1 and leave the file byte-identical. The `comment`/`version` cases stay green.
  - A `start()` test (in the `governance-enforcement.test.ts` style) pins the unknown-profile warning and the unchanged policy.
  - `governance-file-process-gate.test.ts`:
    - add a dist-only case K: flat `IRIS_GOVERNANCE`, and a file with a `prod` top-level key, each exit non-zero naming the variable (and path) and `"global"`;
    - rewrite case J so the object-valued `globals` fails `set`/`validate`/`unset` (exit 1, file unchanged), while a scalar `comment` still round-trips with the warning on a scalar `globals`.
- **DW-542** -- `packages/iris-dev-mcp/src/tools/doc.ts` and `doc-get-range.test.ts`.
  - The no-range branch returns `rangeError(unreadableDocumentText(name, ns, status))` when `atelierDocStatusError(response.result)` returns text.
  - Add the no-range soft-error row. The 38.2 literals stay untouched.
  - In `doc-get-range-live-gate.test.ts`, add the live no-range case on `ExecuteMCPv2.Utils` (no extension; read-only).
- **DW-549** -- `doc.ts`: export `currentDocument` and `CurrentDocument` unchanged.
- **DW-549** -- `load.ts`, applied only when `ignoreConflictFlag` is false:
  - An unversioned PUT that gets a 409 parsed by `currentDocument` is retried once with `If-None-Match: <ts>`.
  - Run the existing soft-error check on the retry response.
  - A 409 on the retry adds the matrix failure entry with `code: REFUSAL_CODES.DOCUMENT_CONFLICT`.
  - A 409 that `currentDocument` cannot parse keeps today's failure.
  - Replace the `ignoreConflict` description with: "If true (default), each file overwrites its server copy unconditionally. If false, a file whose document already exists is saved under a version check: it is overwritten unless the document changes on the server while it is being saved, in which case that file fails with DOCUMENT_CONFLICT and the others continue."
- **DW-549** -- `load.test.ts`: replace :314-326 with the real-shape 409 fakes. Pin:
  - two PUTs, the second carrying `If-None-Match`;
  - the conflict entry and no third PUT;
  - a new document taking one PUT;
  - an unparseable 409 not retried;
  - the description;
  - the default path byte-identical.
- **DW-549** -- `doc-put-bom-live-gate.test.ts`: a live case. Load `QaStory380Load` once, change the file, then load with `ignoreConflict:false`: `uploaded` 1, and the stored text equals the new file.
- **DW-549** -- `document-write-paths.test.ts`: `load.ts` count 2, verdict `excluded`.
- **DW-528 / DW-529** -- `doc.ts` gains an exported `modifiedSinceUnsupported(verb)` builder, with the matrix text and no code. `doc.ts`, `export.ts` and `packages.ts`:
  - When `modifiedSince` is truthy, return it before any HTTP call. The `/modified` URL code is deleted. DW-529 disappears with the branch.
  - Rewrite the three parameter descriptions as: "Not supported: IRIS cannot filter documents by modification time, so a call that sets it is refused and changes nothing; compare the ts of the documents iris_doc_list returns instead."
  - Drop the `modifiedSince` claims from the three tool descriptions and module docs.
- **DW-528 / DW-529** -- tests. Update the pins in `doc.test.ts`, `packages.test.ts`, `export.test.ts` and `tools.integration.test.ts` to the refusal, with zero HTTP calls. Add `""`/absent rows that pin the docnames request and output unchanged.
- **DW-530** -- `env-promote.ts`: keep the PUT response. A non-empty `atelierDocStatusError(response.result)` takes the same path as a thrown PUT error (`putFailedAt`), with the matrix text.
- **DW-530** -- `env-promote-execute.test.ts`: add the soft-status halt case. Its fake is the live HTTP-200 `ERROR #16021` envelope (Rule #54). The all-completed case stays `toEqual`.
- **DW-558** -- `sql.ts:202`: the new sentence. Update every exact pin in the Code Map.
- **DW-558** -- root `README.md:459` and dev `README.md:195`: add "A capped INSERT, UPDATE or DELETE on a table stored in IRISTEMP (not journaled) keeps its row changes even when the cap rolls it back."
- **DW-539** -- `extensions/iris-mcp-launcher/src/env.ts`: add `MCP_TRANSPORT` to `LAUNCHER_OWNED_VARS` with a comment (the launcher spawns only stdio servers).
- **DW-539** -- launcher tests.
  - Both whole-env `toEqual` pins gain `MCP_TRANSPORT: null`.
  - `localSpawnIntegration.test.ts`: a case that layers the definition env over an ambient env with `MCP_TRANSPORT=http` (null deletes) and completes `initialize`, with the same skip rules.
- **DW-539** -- docs: the launcher `README.md:351-356` sentence and the launcher `CHANGELOG.md` entry.
- **DW-556** -- `doc-edit-live-gate.test.ts`: delete the `describe("cleanup ...")` block. `doc-put-storage-guard-live-gate.test.ts`: delete the block, and add the nothing-left assertions to its `beforeAll` and `afterAll` (the 38.5 pattern).
- **DW-531 / DW-533** -- `src/ExecuteMCPv2/REST/Interop.cls`.
  - `ClassMethod DeleteStateRefusal(pTarget, pInject = 0, pStatus = 1, pCurrentName = "", pState = 0) As %String`:
    - when not injected, it calls `GetProductionStatus`;
    - an error status returns `""` (today's behavior);
    - otherwise it applies `DeleteBlockedByState`, then `DeleteBlockedMessage`.
  - `ClassMethod IsProductionClass(pName) As %Boolean`:
    - a compiled class: `%Extends("Ens.Production")` inside an inner Try, false on a throw;
    - a class that is defined but not compiled: an exact comma-piece `Ens.Production` in `Super`.
  - The handler calls `..DeleteStateRefusal(tName)` before both paths, and calls `..IsProductionClass(tName)` before the class `%DeleteId`, refusing with the matrix text and the existing envelope.
  - `GetProductionStatus` no longer appears in `ProductionManage`. Restore the namespace on every exit (AD-13).
- **DW-531 / DW-533** -- `InteropHostGuardTest.cls`:
  - seam tests with injected values (the matrix row);
  - a live call with no injection on HSCUSTOM, which returns `""`;
  - `IsProductionClass` rows;
  - a wiring test that reads `%Dictionary.MethodDefinition` `ExecuteMCPv2.REST.Interop||ProductionManage` and asserts:
    - exactly one `..DeleteStateRefusal(tName)`;
    - no `GetProductionStatus(`;
    - the seam line comes before both `%DeleteId(` lines;
    - `..IsProductionClass(tName)` comes before the class `%DeleteId(`.
- **DW-531 / DW-533** -- `InteropProductionDeleteTest.cls`: route tests, with `ExecuteMCPv2.Temp.Story387*` fixtures added to the `RemoveFixtures` sweep:
  - a compiled non-production class is refused and still exists;
  - the same refusal applies when a same-named row exists, and the row remains;
  - an uncompiled class with `Super` `Ens.Production` is deleted;
  - the existing 4 tests stay.
- **DW-531 / DW-533** -- `production.ts`: the description gains "'delete' accepts only a production class (one that extends Ens.Production): any other class is refused and nothing is deleted." `production.test.ts` pins it and maps a delete refusal envelope to `isError`.
- **DW-531 / DW-533** -- interop `README.md`: the :137 row, plus a Common Errors row for the new text.
- **DW-531 / DW-533** -- bootstrap. Run `pnpm gen:bootstrap` (the 38.6 mtime note applies: remove `packages/shared/dist` and `tsconfig.tsbuildinfo`, then rebuild shared) and record `BOOTSTRAP_VERSION` from → to.
- **Docs and release** -- `CHANGELOG.md`: a top section `## [Pre-release — 2026-10-16] — Story 38.7: Epic 38 burn-down`, containing no `N/N/N/N/N` roster string:
  - `### Changed` names DW-554, DW-533, DW-542, DW-528 and DW-539 as sanctioned changes (decision #17);
  - `### Fixed` names DW-549 (decision #7 precedent), DW-530 and DW-558.
- **Docs and release** -- root `README.md`:
  - the governance section says that a key or layer outside `global`/`profiles` fails startup, that scalar metadata keys are ignored, and that an unknown profile name warns;
  - the :422 sentence and the :598 fail-fast list gain the clause "a governance key or layer outside `global` and `profiles`", with no `)`;
  - dev `README.md:149-157` and `tool_support.md:34` say `modifiedSince` is refused.
- **Docs and release** -- `.changeset/story-38-7-epic-38-burn-down.md`: `"@iris-mcp/shared": minor`, `"@iris-mcp/dev": minor`, `"@iris-mcp/interop": patch`.
- **Docs and release** -- `packages/iris-mcp-all/src/__tests__/story-38-7-doc-claims.test.ts` (new; default suite; no IRIS). It pins:
  - the CHANGELOG section headings and the eight DW ids;
  - the changeset bump map;
  - the README governance and fail-fast clauses;
  - the launcher README and CHANGELOG `MCP_TRANSPORT` lines;
  - the dev README `modifiedSince` and `ignoreConflict` rows;
  - the interop README rows;
  - the IRISTEMP line.
- **Docs and release** -- the root `README.md` payload table: re-measure with `pnpm measure:tools-payload` after the rebuilds, and write "Last re-measured at Story 38.7".
- **Records** -- this spec's `## Verification`: the implement stage records the baselines, every `mutation:` line, the IRIS `total`s, the bootstrap from → to (for the story and the epic), and the epic-close records.

**Acceptance Criteria:**
- **AC-1 (DW-554).** Given a flat, top-level-profile, `globals`-object or `iris_`-prefixed governance key in `IRIS_GOVERNANCE` or `IRIS_GOVERNANCE_FILE`, when the built dev server starts, then:
  - it exits 1 before any IRIS traffic, naming the variable (and path) and the documented shape, and never echoing a value;
  - the CLI `set`/`unset`/`validate` fail with the same message and leave the file byte-identical;
  - every valid shape and scalar-metadata file `toEqual`s today's config and policy;
  - an unknown `profiles` name only warns.
- **AC-2 (DW-533).** Given a compiled non-production `ExecuteMCPv2.Temp.Story387*` class, when `delete` is posted over real HTTP, then the route refuses with the matrix text and the class (and any same-named row) still exists. An uncompiled class whose `Super` names `Ens.Production`, a Stopped production and an orphan row behave as the matrix says.
- **AC-3 (DW-531).** Given the seam, when `InteropHostGuardTest` runs, then:
  - the injected (status, name, state) rows give the exact refusals and allowances;
  - the uninjected call answers `""` on HSCUSTOM;
  - the wiring test proves the handler calls the seam before both deletes and never reads the status itself.

  The residual is recorded: a live refusal through the route needs a running production, which decision #17 forbids.
- **AC-4 (DW-539).** Given an ambient `MCP_TRANSPORT=http`, when the launcher builds a definition, then its env carries `MCP_TRANSPORT: null`, and the real spawned server completes `initialize`.
- **AC-5 (DW-542).** Given a no-range `iris_doc_get` on a name Atelier answers with a soft error, when it runs live, then the result is `isError` with IRIS's reason, and every 38.2 no-range literal is unchanged.
- **AC-6 (DW-549).** Given an existing document and `ignoreConflict:false`, when `iris_doc_load` runs live, then the file is uploaded through the version-checked save. In unit tests, a 409 on that save is a per-file `DOCUMENT_CONFLICT` with no further PUT, and the default path is byte-identical.
- **AC-7 (DW-528, DW-529).** Given a non-empty `modifiedSince` on any of the three tools, when called, then the result is the matrix refusal and no HTTP request is sent. Absent or `""` is byte-identical, and the descriptions and docs no longer promise the filter.
- **AC-8 (DW-530).** Given a promote `execute` whose target PUT answers 200 with a non-empty status, when it runs, then that step fails with the hedged text, and execution halts as for a thrown PUT error.
- **AC-9 (DW-558).** Given an over-cap DML, when it is refused, then the text carries the hedged sentence in every variant, and the armed 38.5 wire gate and the dev SQL live gate pass with the new pins.
- **AC-10 (DW-556).** Given the two dev gates, when each runs armed in file order and under a recorded shuffle seed, then all pass with no cleanup test case, and nothing named `QaStory383`/`QaStory384` remains.
- **AC-11 (DW-562).** Given the default `@iris-mcp/all` config, when the guard's child run executes, then no two files overlap, and removing `fileParallelism: false` turns the guard red.
- **AC-12 (gates and epic close).** Given the finished tree, when the Verification commands run, then:
  - every per-package build, test, lint and type-check passes;
  - `:check` exits 0 at `1e62c5ad5bf7`/141;
  - the tool and prompt counts are unchanged;
  - `gen:bootstrap` is idempotent at the recorded new version (epic `2159ec9e6f69` → new);
  - `check-epics-sync.mjs` prints OK;
  - the payload table matches the re-measure;
  - `story-38-7-doc-claims` passes;
  - no `Story387`/`QaStory38` fixture remains on HSCUSTOM.

## Spec Change Log

## Review Triage Log

## Design Notes

**Orchestrator decision #19: DECIDED at the spec gate, 2026-10-16, as recommended (fail on an `iris_`-prefixed key or a boolean- or object-valued key; string and number metadata stay valid; spine AD-8 updated). The planning text follows.** (D1, DW-554 scope): Which unknown top-level governance keys should fail startup?
- **Recommended:** reject a key other than `global`/`profiles` when its name matches `/^iris_/i`, or its value is a boolean or an object. Keep scalar metadata (`comment`, `version`, `$schema`) accepted.
- **Evidence for the recommendation:**
  - The bullet says to fail when "a top-level key is neither `global` nor a known profile". It also says "existing valid configurations must behave identically".
  - Story 32.4 (32-1-R3) deliberately keeps unknown keys on CLI writes. Tests pin `{version:1, comment:"team policy", global}` as valid (`governance-cli.test.ts:421-474`).
  - Every governance-shaped key that is silently ignored today (flat, top-level profile, `globals` typo) fails under the recommendation. Only 3 pins change, and each pins the fail-open.
- **Alternative:** reject every unknown key, as the bullet literally says. That stops any operator file carrying a `comment` from starting, and moves 4 more pins.

**Plan-time interpretations (apply-and-report; the lead amends `epics.md` in place, Rule #42):**
- **I1 (DW-554 shape).** "Neither `global` nor a known profile" and the ledger's `{"<profile>":{...}}` do not match the implemented and documented shape, `{"global":{...},"profiles":{"<name>":{...}}}`. Read it as "neither `global` nor `profiles`" (per D1).
- **D2 (DW-554, the story's own decision per the epic context).** An unknown name under `profiles` only warns, following AD-7's unknown-name precedent. The reasons:
  - Server Manager `auto` drops a profile whose credentials cannot resolve (README:171);
  - one governance file may serve clients with different `IRIS_PROFILES` (README:412);
  - the parser has no registry, which is why the check lives in `start()`.
- **I2 (DW-556 count).** "Three live gates" is now two. The third, the 38.5 gates, was fixed in the 38.5 review; the 19-file enumeration finds exactly two.
- **I3 (DW-531 "at the handler's wiring").** The pin is the seam plus a definition-order wiring test. A refusal through the route needs a current non-Stopped production, which is never started here; that is the named residual.
- **I4 (DW-562).** Serialization means `fileParallelism: false` for the whole `@iris-mcp/all` default suite. vitest 2.1.9 has no group ordering, and `poolMatchGlobs` chooses pools but does not serialize. The implementer records the default-suite duration before and after.
- **I5 (DW-528).** The probe settles it as a refusal:
  - `%Api.Atelier.v1:GetModifiedDocNames` keys on an opaque per-database source-journal hash, has no time semantics, and writes journal bookkeeping;
  - `GET /modified/<ts>` gives 405 with `ALLOW: POST,OPTIONS` (IRIS 2026.2 build 221U, Atelier v8).

  Filtering the docnames `ts` client-side is possible, but `ts` is zone-less server-local time and some OTH entries have `ts:""`. That would be a new feature, not this fix.
- **I6 (DW-529).** It is folded and already terminal (`wontfix-accepted`, reopen_if DW-528). With the refusal, no `filtersApplied` is produced on that branch. The lead appends the disposition.

**Governing ADs.**
- **AD-6, AD-8.** One validator, `parseGovernanceRoot`, for env, file, CLI and Gate 4. Invalid configuration fails fast at startup, naming the variable.
- **AD-7.** The unknown-name-only-warns precedent.
- **AD-9.** Configuration variables.
- **AD-15.** The sanctioned moves are decisions #17 and #18; everything else is pinned.
- **AD-24.** The DW-549 version flow; load stays a recorded storage exclusion.
- **AD-25.** The DW-558 text.
- **AD-17.** The promote halt on the first error.
- **AD-12, AD-13, AD-33.** Thin handler, namespace restore, additive route: the existing envelope, and production deletes unchanged.
- **AD-14.** The bootstrap regeneration.
- **AD-2.** Cross-package tests live in `iris-mcp-all`.
- **AD-23.** Stdio only (DW-539).
- **AD-5.** `:check` only.
- **AD-29.** patch/minor changesets.
- **Conventions:** Refusals, Error text, Configuration variables, Tool descriptions, Live gates, Live testing on a shared instance, IRIS-side unit tests, ObjectScript pitfalls.

**Extend, don't copy (Rule 2).**
- **load (DW-549).** It reuses the exported `currentDocument`, the only part with logic. The two-line `If-None-Match` retry stays inline, because extracting doc.ts's retry would move its guarded `.put(` sites and the roster.
- **The `modifiedSince` refusal.** One builder in `doc.ts` serves all three tools.
- **The doc_get refusal.** It reuses `rangeError`/`unreadableDocumentText`.
- **promote.** It reuses `atelierDocStatusError` and the existing `putFailedAt` halt.
- **`IsProductionClass`.** It follows `ValidateHostClassName`. It is a separate method because it needs a different superclass and the uncompiled fallback.
- **The seam.** It composes `DeleteBlockedByState` and `DeleteBlockedMessage` unchanged.
- **The DW-562 guard.** It extends the child-vitest spawn in `epic38-gate-guards`.

**Integration (Rules 1/2).**
- **Integration ACs.**
  - load consumes `currentDocument` and produces a live `uploaded` result (AC-6).
  - The `ProductionManage` route consumes `IsProductionClass` and produces a real-HTTP refusal (AC-2).
  - The launcher's definition env produces a real spawned server that completes `initialize` (AC-4).
- **Consumed-by:**
  - `load.ts` (`currentDocument`);
  - `ProductionManage` (the seam and `IsProductionClass`);
  - `export.ts` and `packages.ts` (`modifiedSinceUnsupported`);
  - every `@iris-mcp/all` gate, and Story 42.3 CI (the serial config).
- **Consumes:**
  - 38.0 `atelierDocStatusError` and the delete predicates;
  - the 38.3 409 flow and the roster;
  - 38.5 `sql.ts`;
  - the 38.6 gate helpers and capstone.

**Ledger inbox (Rule 17).**
- DW-554: AC-1.
- DW-533: AC-2.
- DW-531: AC-3.
- DW-539: AC-4.
- DW-542: AC-5.
- DW-549: AC-6.
- DW-528 and DW-529: AC-7.
- DW-530: AC-8.
- DW-558: AC-9.
- DW-556: AC-10.
- DW-562: AC-11.

None is declined.

## Verification

Every command runs from `/Users/jbrandt/git/iris-execute-mcp-v2` in the foreground with `timeout: 600000`.
- **Connection.** `ENV` below means `IRIS_HOST=localhost IRIS_PORT=52773 IRIS_NAMESPACE=HSCUSTOM IRIS_USERNAME=_SYSTEM IRIS_PASSWORD=SYS IRIS_HTTPS=false IRIS_REQUIRE_LIVE=1`.
- **Build order.** Shared, then dev and interop, then `iris-mcp-all`. Rebuild a package before running gates on its dist.
- **Live writes.** Only these, each removed before and after by its own test or gate, and checked empty at the end:
  - the IRIS test fixtures `ExecuteMCPv2.Temp.Story380*` and `Story387*` (classes and `Ens_Config.Production` rows);
  - the existing gate stems `QaStory380*`, `QaStory382*`, `QaStory383*`, `QaStory384*`, `QaStory385*` and `QaStory386Cap*`;
  - the normal bootstrap redeploy of the ExecuteMCPv2 classes by the first armed built-server start after the regeneration.
- **OS `%UnitTest` runs.** One class per `iris_execute_tests` call, waiting for completion, never re-submitting on a client-side timeout, and polling `iris_test_status`. Compare `total` with the `Test*` count. Load the classes first with `iris_doc_load` and a glob path (`/Users/jbrandt/git/iris-execute-mcp-v2/src/**/Interop.cls`, and the same for the two test classes).

**Shared surfaces:**
- **Governance.** The parser's accepted shapes (`governance-edge`, `governance-cli`, process-gate case J).
- **Launcher.** The owned-vars env object (two whole-env pins).
- **Document tools.**
  - the write-path roster (`load.ts` count);
  - the `modifiedSince` URL pins and descriptions;
  - the payload table.
- **SQL.** The `overCap` text (5 exact pins, 3 files).
- **Interop.** The `iris_production_manage` description pin.
- **Gates.**
  - the `@iris-mcp/all` vitest config (every file of that suite now runs serially);
  - `BOOTSTRAP_VERSION` (the three gates' deployed==shipped check redeploys once).
- **Docs.** The CHANGELOG top section (doc-claims regexes; the first roster-string match).
- **IRIS tests.** The two IRIS test classes' `Test*` counts.

Standing criterion: every test added or changed passes on a fresh environment, in either order.

**Commands:**
- `(once)` before any change: `IRIS_TEST_HOST=localhost IRIS_TEST_PORT=52773 IRIS_TEST_NAMESPACE=HSCUSTOM IRIS_TEST_USERNAME=_SYSTEM IRIS_TEST_PASSWORD=SYS node_modules/.bin/vitest run --root extensions/iris-mcp-launcher src/__tests__/selectServers.test.ts src/__tests__/serverDefinitionProvider.test.ts src/__tests__/env.test.ts src/__tests__/localSpawnIntegration.test.ts` (call this `LAUNCHER`). Record the baseline-red set as pre-existing (DW-532); the plan run of the first two files was 119 passed. Also record the `pnpm --filter @iris-mcp/all test` duration with `ENV` (it is parallel today).
- `(once)` before the DW-556 fix: run `doc-edit-live-gate` and `doc-put-storage-guard-live-gate` armed with `--sequence.shuffle --sequence.seed=<n>` until a seed turns red, and record `<n>` per gate. If 10 seeds stay green, record that and pick seed 1; the AC-10 `afterAll` mutation is then the pinning evidence.
- `(loop)` `pnpm --filter @iris-mcp/shared build && pnpm --filter @iris-mcp/shared exec vitest run src/__tests__/governance.test.ts src/__tests__/governance-edge.test.ts src/__tests__/governance-file.test.ts src/__tests__/governance-cli.test.ts src/__tests__/governance-cli-e2e.test.ts src/__tests__/governance-enforcement.test.ts` -- expected: pass.
- `(loop)` `pnpm --filter @iris-mcp/dev build && pnpm --filter @iris-mcp/dev exec vitest run src/__tests__/doc.test.ts src/__tests__/doc-get-range.test.ts src/__tests__/load.test.ts src/__tests__/export.test.ts src/__tests__/packages.test.ts src/__tests__/env-promote-execute.test.ts src/__tests__/sql-safety.test.ts src/__tests__/doc-put-storage-guard.test.ts` -- expected: pass.
- `(loop)` `pnpm --filter @iris-mcp/interop build && pnpm --filter @iris-mcp/interop exec vitest run src/__tests__/production.test.ts` -- expected: pass.
- `(loop)` `LAUNCHER` -- expected: no new red against the baseline; the `MCP_TRANSPORT` case passes.
- `(loop)` `pnpm --filter @iris-mcp/all exec vitest run src/__tests__/document-write-paths.test.ts src/__tests__/epic38-gate-guards.test.ts src/__tests__/story-38-7-doc-claims.test.ts src/__tests__/story-38-6-doc-claims.test.ts src/__tests__/story-38-1-qa-doc-claims.test.ts src/__tests__/live-gate-roster.test.ts` -- expected: pass.
- `(loop)` `ENV pnpm --filter @iris-mcp/all exec vitest run src/__tests__/governance-file-process-gate.test.ts` -- expected: pass, none skipped.
- `(loop)` `iris_execute_tests` on `ExecuteMCPv2.Tests.InteropHostGuardTest`, then (a separate call) `ExecuteMCPv2.Tests.InteropProductionDeleteTest` -- expected: all pass, `total` = `Test*` count.
- `(loop)` each in its own call: `ENV pnpm --filter @iris-mcp/dev exec vitest run --no-file-parallelism src/__tests__/<gate>.test.ts`, for each of `doc-get-range-live-gate`, `doc-put-bom-live-gate`, `doc-edit-live-gate`, `doc-put-storage-guard-live-gate` and `sql-safety-live-gate` -- expected: all pass, none skipped.
- `(loop)` DW-556: the same commands for `doc-edit-live-gate` and `doc-put-storage-guard-live-gate`, adding `--sequence.shuffle --sequence.seed=<n>` with each gate's recorded red seed -- expected: all pass.
- `(loop)` each in its own call: `ENV pnpm --filter @iris-mcp/all exec vitest run src/__tests__/<gate>.test.ts`, for each of `story-38-5-qa-sql-wire-gate`, `story-38-4-qa-doc-edit-wire-gate` and `epic38-capstone-gate` -- expected: all pass, none skipped. The first start after the regeneration redeploys; afterwards, read the version back with `SELECT ExecuteMCPv2.Setup_GetBootstrapVersion()` through `iris_sql_query` (`server:"default"`, `namespace:"HSCUSTOM"`).
- `(once)` one command per package: shared, dev, admin, interop, ops, data and client-config, each running `build`, then `test`, `lint` and `type-check` where defined; then `ENV pnpm --filter @iris-mcp/all test` (now serial; record the duration) -- expected: green.
- `(once)` `pnpm gen:governance-baseline:check` -- expected: exit 0 at `1e62c5ad5bf7`/141.
- `(once)` `pnpm gen:bootstrap && git diff --stat -- packages/shared/src/bootstrap-classes.ts` -- expected: no diff after the in-story regeneration. Rebuild shared afterwards, per the 38.6 mtime note.
- `(once)` `node scripts/check-epics-sync.mjs` -- expected: exit 0, `OK: no genuine drift`.
- `(once)` `pnpm measure:tools-payload` -- expected: the README rows equal the output.
- `(once)` `git diff --stat 3a1566cb0e50d37f433e6eea7ee7f2405834a655 -- packages/shared/src/governance-baseline.ts packages/shared/src/baseline-classifications.ts ipm/module.xml` -- expected: empty. Under `src/`, only `Interop.cls`, `InteropHostGuardTest.cls` and `InteropProductionDeleteTest.cls` change.
- `(once)` `iris_doc_list` (`generated:true`) and `iris_global_list`, filtered on `Story387` and on `QaStory38`, plus `SELECT COUNT(*) FROM Ens_Config.Production WHERE Name %STARTSWITH 'ExecuteMCPv2.Temp.Story38'` through `iris_sql_query` -- expected: empty, 0.

**Planned mutations (Rule 19).** For each one, apply it, observe red, revert, rebuild any dist it touched, and confirm `git status --short` and `git diff --stat` are unchanged. Record each as `mutation: ... -> ...`, naming the path.

| AC | Mutation | Expected red |
|---|---|---|
| AC-1 | the key loop removed from `parseGovernanceRoot` (shared dist rebuilt) | shared rejection rows; process-gate case K (built server exits 0) |
| AC-1 | the unknown-profile warning removed | the `start()` warning test |
| AC-2 | the `IsProductionClass` check removed from the handler (class reloaded) | `InteropProductionDeleteTest` non-production rows (the class is deleted) over real HTTP |
| AC-3 | the seam passes `pState` and `pCurrentName` to `DeleteBlockedByState` in swapped positions; separately, the seam call moved after the class `%DeleteId` | the injected blocking rows; the wiring test |
| AC-4 | `MCP_TRANSPORT` removed from `LAUNCHER_OWNED_VARS` | the two `toEqual` pins; the spawn case (the server exits 1) |
| AC-5 | the no-range status check removed (dev dist rebuilt) | the unit row; the live no-range case |
| AC-6 | the retry removed (the `false` path is back to one PUT) | the load unit rows; the live load case (409 failure) |
| AC-7 | the `modifiedSince` early return removed | the three tools' refusal rows (an HTTP call is made) |
| AC-8 | the PUT status check removed | the promote soft-status case |
| AC-9 | the old sentence restored | the 5 exact pins, and the armed 38.5 wire gate |
| AC-10 | the `afterAll` removal disabled in `doc-put-storage-guard-live-gate` | its `afterAll` nothing-left assertion (the next run's `beforeAll` purges the leftovers) |
| AC-11 | `fileParallelism: false` removed | the DW-562 guard (overlap observed) |
| AC-12 | the CHANGELOG `### Changed` DW-554 line removed; the changeset bump changed | `story-38-7-doc-claims` |

## Auto Run Result

Status: ready-for-dev
Blocking condition: none

Planned only (halted after planning, as directed). The ledger inbox has 11 entries, all addressed, plus DW-529 folded into AC-7; none is declined. One orchestrator decision is needed (D1, the DW-554 scope), and the plan follows its recommendation. Plan-time interpretations I1 to I6 and the story decision D2 are under Design Notes. Three plan-found items are in the frontmatter `deferred:` list for harvest.
