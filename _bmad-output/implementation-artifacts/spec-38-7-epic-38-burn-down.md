---
title: 'Story 38.7: Epic 38 Burn-Down'
type: 'bugfix'
created: '2026-10-16'
status: 'done'
baseline_revision: 'fe58430779a92377ce4b4970b049c2a8d70177fe'
baseline_commit: 'fe58430779a92377ce4b4970b049c2a8d70177fe'
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
  - summary: >-
      The repo-root `turbo run test` runs the `@iris-mcp/dev` and `@iris-mcp/all` vitest suites concurrently, so their live gates can still overlap on the one shared IRIS instance (fixtures, bootstrap redeploy) even though `@iris-mcp/all` now runs its own files serially.
    evidence: |-
      Review pass 2026-10-16 (edge-case layer; the intent-alignment layer noted the same scope): turbo.json `test` depends only on `build`, and the dev live gates run whenever IRIS is reachable. This is the existing `35-1-DEV-1` flake class, not caused by Story 38.7. To settle: run `pnpm turbo run test` with IRIS reachable and look for fixture collisions, or serialize the live-gate packages (turbo `--concurrency=1` for `test`, or a shared lock).
    location: turbo.json
    severity: medium (unverified)
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

### Review Findings

Code review (`/bmad-code-review`, 2026-10-16, review tier full-opus; layers Blind Hunter, Edge Case Hunter, Verification Gap, Acceptance Auditor, all delivered). 22 raw rows -> 20 entries: high 0, medium 3, low 16, false 1.

- [x] [Review][Patch] F1 (medium, Rule 19 hermeticity; blind+edge+verification) The `story-38-7-qa-wire-gate` `modifiedSince` refusal rows assert the shared `scratch` directory is empty, while the `ignoreConflict: false` load row writes `scratch/ExecuteMCPv2/...` and never removes it, so a shuffled or reordered run fails the refusals with `["ExecuteMCPv2"]` [packages/iris-mcp-all/src/__tests__/story-38-7-qa-wire-gate.test.ts:260] - fix-risk low (test-only, per-test directories)
- [x] [Review][Patch] F2 (low; edge) The wire gate's `afterAll` calls `interop.close()`/`admin.close()` unguarded, so a `beforeAll` that throws after `admin` opened ends in a `TypeError` that hides the real error and leaves the admin server open [packages/iris-mcp-all/src/__tests__/story-38-7-qa-wire-gate.test.ts:151] - fix-risk low
- [x] [Review][Patch] F3 (medium, Rule 19 falsifiability; verification) The matrix row "an `iris_` prefix, case-insensitive, with any value" has no upper-case non-boolean row: dropping the `i` flag from `/^iris_/i` leaves every test green while `{"IRIS_DOC_PUT":"false"}` is accepted again [packages/shared/src/__tests__/governance-edge.test.ts:151] - fix-risk low (one row in each of the env and file tables)
- [x] [Review][Patch] F4 (low; verification) No test drives a non-409 failure on the version-checked retry of `iris_doc_load`: classifying every retry error as `DOCUMENT_CONFLICT` stays green, and would tell a caller "nothing was stored" after a timeout [packages/iris-dev-mcp/src/tools/load.ts:484] - fix-risk low
- [x] [Review][Patch] F5 (medium, Rule 19 hermeticity; verification) The Story 38.7 `start()` tests in `governance-enforcement` rely on the shell environment: the file's `makeEnvHarness` copy clears only `IRIS_GOVERNANCE`/`IRIS_PROFILES`, so an exported `IRIS_GOVERNANCE_FILE`, `IRIS_GOVERNANCE_PRESET` or `IRIS_SERVER_MANAGER` changes their warnings or policy [packages/shared/src/__tests__/governance-enforcement.test.ts:183] - fix-risk low. DW-543 occurrence appended (its reopen_if, "a second test result depends on an env var its makeEnvHarness copy leaves set", is met).
- [x] [Review][Patch] F7 (low; blind) The root README Backward Compatibility bullet still says "The one IRIS-side change is Story 38.5's `ExecuteMCPv2.REST.Sql` handler", although this story changes `ExecuteMCPv2.REST.Interop` and moves `BOOTSTRAP_VERSION` [README.md:599] - fix-risk low
- [x] [Review][Patch] F8 (low; blind+auditor) The README, CHANGELOG and changeset say metadata keys with "a string, number or null value" stay valid, but `looksLikeGovernance` (by the spec: "a non-null, non-array object") also accepts an array value [README.md:379] - fix-risk low. The spine's AD-8 bullet says "string or number values"; the spine is the lead's to amend (Rule 20).
- [x] [Review][Patch] F12 (low; blind) The changeset puts the `BOOTSTRAP_VERSION` sentence in the Governance (`@iris-mcp/shared`) paragraph, but the redeploy comes from the `Interop.cls` production-delete change [.changeset/story-38-7-epic-38-burn-down.md:9] - fix-risk low
- [x] [Review][Patch] F18 (low; auditor) The `iris_doc_list` row "an empty or absent modifiedSince is the unchanged docnames request" pins the request but not the result [packages/iris-dev-mcp/src/__tests__/doc.test.ts:548] - fix-risk low
- [x] [Review][Patch] F19 (low; auditor) The `## Verification` "Live writes" list omits the QA stems `QaStory387Mod`, `QaStory387LoadA`/`B`/`C`, `QaStory387PromA`/`B` and `QaStory387Wire*` [this spec, `## Verification`] - fix-risk low (tracking text)
- [x] [Review][Defer] F14 (low; blind, and the lead's QA observation) `IsProductionClass("Ens.Production")` answers 1, so a delete naming a library production class (`Ens.Production`, `Ens.Enterprise.Production`) passes the class check [src/ExecuteMCPv2/REST/Interop.cls:62] - deferred: `wontfix-theoretical` (DW-568). The class is a production, the check matches the spec's rule, the same delete was possible before the story, and ENSLIB is mounted read-only on HSCUSTOM's instance (`iris_database_check` ENSLIB: `readOnly: true`), so the `%DeleteId` fails at the database. It becomes real when ENSLIB is mounted read-write and a delete names a library production class.
- [x] [Review][Defer] F15 (low; blind) Ledger entry DW-567 (the `'cls'` type example) is a LOW with `status=routed owner=burndown`, which Rule 15 forbids ("burndown never owns a LOW") [_bmad-output/implementation-artifacts/deferred-work.md] - deferred: a harvest disposition the lead writes (Rule 15(c)). The lead re-dispositions it: patch it in a named story as a two-way door (it also moves the `iris_doc_list` payload row), or `wontfix-accepted` with a `reopen_if`.
- [x] [Review][Defer] F20 (low, Rule 2; this reviewer) The QA gates copy fixture helpers instead of promoting them into `process-gate-helpers.ts`. `story-38-7-qa-wire-gate` is the fourth live gate with its own `fixtureDocuments`/`removeFixtures` (after the capstone and the 38.4 and 38.5 wire gates). `governanceReport` now has three copies (38.4, 38.5, `story-38-7-qa-governance-process`), and `startStub` two (`story-38-0-qa-process`, `story-38-7-qa-governance-process`) [packages/iris-mcp-all/src/__tests__/story-38-7-qa-wire-gate.test.ts:94] - deferred: the spec forbids helper consolidation here ("Owned elsewhere: Helper consolidation (DW-543/550/557/561)"), so the copy has a stated reason (a LOW). An occurrence is appended to DW-561, whose reopen_if ("a fourth live gate copies the fixture helpers") has now fired; the lead re-dispositions it.

**Rejected:**
- F6 (`false`; verification) The `serial-probe-a`/`-b` files "assert nothing in the default suite". They are probe hosts, not pinning tests. The DW-562 guard reads their markers and the child exit, and its AC-11 mutation was observed red.
- F9 (`low`; blind) The shared `modifiedSince` parameter text says "changes nothing" for read-only tools, and "a call that sets it" though `""` is accepted. It is the spec's verbatim parameter text (Tasks, DW-528/529), so the fix would edit the spec.
- F10 (`low`; blind+auditor) `DefineClass` (4 lines) is copied in `InteropHostGuardTest` and `InteropProductionDeleteTest`. The two classes share no base, and a shared fixture class would be a new `src/` class, which the spec's Verification limits ("under `src/`, only the three named classes change"). The idiomatic 4-line body carries no named divergence risk.
- F11 (`low`; blind) `InteropProductionDeleteTest`'s `FIXTUREPREFIX387` sweep also matches `InteropHostGuardTest`'s `Story387Guard*` fixtures. This is harmful only when the two classes run at once in one namespace, which the project's one-class-per-call rule forbids; run in sequence, it removes the other class's leftovers.
- F13 (`low`; blind) The unknown-profile warning reaches only stderr, not `iris_server_profiles`. The spec decided warn-only via `logger.warn` (D2), and surfacing it on a tool would be new behavior beyond the spec.
- F16 (`low`; edge) A class whose saved `Super` differs from its last compile is judged by the compiled `%Extends`. The spec fixes the rule ("a compiled class: `%Extends`"), and the failure modes are a delete of a class compiled as a production, or a refusal that deletes nothing.
- F17 (`false`/`low`; auditor) The DW-549 live load row checks the `If-None-Match` format and uses `toContain`. IRIS enforces the header: any other value gets a second 409. The row asserts `uploaded: 1` after exactly two PUTs, so the header was the current `ts`, and Beta-present/Alpha-absent discriminates the AC (its mutation is recorded red).

## Spec Change Log

## Review Triage Log

### 2026-10-16 — Review pass
- verdicts: 27 findings — high 0, medium 2, low 18, false 6, maybe-false 1
- findings:
  - Blind Hunter (10)
    - `[low]` `reject` An uncompiled production class that extends a custom base production is refused with "does not extend Ens.Production" — the matrix fixes the uncompiled rule as an exact comma piece of the direct `Super` and fixes the refusal text; the refusal is a safe failure that deletes nothing, an uncompiled indirect production is not a case the tool is used for, and resolving ancestry would be a new rule. reopen_if: a user reports a saved-but-uncompiled indirect production that `iris_production_manage delete` will not remove.
    - `[low]` `reject` `ignoreConflict:false` now overwrites any existing document, and the docs read as protective — the parameter text, the README row and the CHANGELOG Fixed placement are the spec's own prescribed wording (AC-6, decision #7 precedent), and the text states the actual guarantee ("unless the document changes on the server while it is being saved"); the fix would edit the spec.
    - `[low]` `reject` The serial-suite guard skips on a one-CPU host — the spec requires exactly this skip ("skips with a reason when `os.availableParallelism() < 2`"); the fix would edit the spec.
    - `[low]` `patch` The dev README `iris_doc_list` row says a refused `modifiedSince` "changes and returns nothing" — reworded to "is refused and lists nothing" in `packages/iris-dev-mcp/README.md:149`; no test pinned the old words.
    - `[low]` `patch` The `iris_doc_get` soft-error comment says "and no content" while the check is `atelierDocStatusError` alone — the check is the spec's (the helper's own contract is a non-empty string `result.status`), so the comment was corrected in `doc.ts`; the missing README/`tool_support.md` mention of the new error is not asked for by the spec (the CHANGELOG records it).
    - `[low]` `patch` `export.ts` keeps a `/modified` comment, `filtersApplied.modifiedSince` and an overclaiming test title — the stale comment is corrected; `filtersApplied.modifiedSince` stays for `""` only so that input is byte-identical (the spec's own byte-identical row); the test title describes the request path, which the test does pin.
    - `[low]` `reject` The governance error advice ("put the key under global or profiles") does not fit a layer-name typo — the sentence is the matrix's verbatim text, pinned in the spec; for a top-level profile the advice is right (move it under `profiles`), and for `globals` the next error names the real problem; the fix would edit the spec.
    - `[low]` `reject` `looksLikeGovernance` lets `preset`, `disable` or array-valued keys through without a warning — decision #19 (D1) chose "`iris_` prefix, or boolean or object value; scalar metadata stays valid" and declined "reject every unknown key"; an extra server warning for ignored scalar keys is new behavior beyond the spec. reopen_if: an operator loses policy to an ignored non-governance-shaped key.
    - `[medium]` `patch` `TestProductionManageWiring` pins source text, so a handler that computes the refusal and ignores it still passes, and the live seam's argument order is unpinned — real: two mutations (`If 0`, swapped `GetProductionStatus` arguments) were green. Added source assertions to both tests (gate line exactly once and ordered before both deletes; the live read's argument order and the state rule's arguments), then mutation-verified both (red), reverted byte-identical, reloaded. A refusal for a Running production through the route stays the named residual (decision #17). Grouped with the verification-gap row on the same root.
    - `[false]` `reject` The deferred-work ledger is not part of the change set — the spec forbids the implementer to write the ledger; the lead harvests the `deferred:` list (Rule 15).
  - Edge Case Hunter (7)
    - `[low]` `reject` An array of `iris_` names or a case-variant scalar layer key (`Global`) is accepted and ignored — same root as the `looksLikeGovernance` row above (decision #19).
    - `[low]` `reject` An uncompiled indirect production is refused — same root as the first Blind row.
    - `[low]` `reject` A compiled production whose `%Extends` call throws is refused as a non-production — the spec says "false on a throw" (the Loc.Scanner note); the refusal deletes nothing and `iris_doc_delete` remains.
    - `[low]` `reject` A deployed class with no definition and a same-named config row reaches the orphan branch and the row is removed — that branch and its effect pre-date this story and are unchanged; a deployed non-production class with a same-named production row is not a state the tool meets. Closed `wontfix-theoretical`.
    - `[maybe-false]` `defer` `turbo run test` runs the dev and all suites concurrently, so live gates can still overlap on the shared instance — not caused by this story (the existing `35-1-DEV-1` flake class, `turbo.json` `test` depends only on `build`); would be medium if true; settled by running `pnpm turbo run test` with IRIS reachable and watching for fixture collisions. Recorded in the frontmatter `deferred:` list.
    - `[low]` `reject` The probe overlap window is a fixed 2 s, so a worker that starts more than 2 s late hides an overlap — real only under heavy load, and the mutation was observed red; the robust fix is a different probe design. reopen_if: the guard stays green with `fileParallelism: false` removed on a loaded host.
    - `[low]` `reject` An all-conflict `iris_doc_load` is `isError` with no top-level code — the matrix fixes the per-file `failures[].code` shape and no top-level code for any other `iris_doc_load` failure; the fix would edit the spec.
  - Verification Gap (7)
    - `[medium]` `patch` The live branch of the seam and the handler's use of its result are unverified — same root as the Blind `[medium]` row; patched there.
    - `[low]` `patch` `story-38-7-doc-claims` reads the changeset without a presence guard and takes the launcher CHANGELOG's top section — `changeset version` deletes the file, so the test would go red at release; fixed with the `existsSync` and `it.skipIf` pattern of the 38.0 to 38.2 doc-claims files and by selecting the launcher section by its `## [0.1.0]` heading.
    - `[low]` `reject` The DW-562 guard detects overlap only inside a fixed 2 s window — same root as the Edge probe row.
    - `[low]` `patch` `export.ts:143` still names `/modified` — corrected (same root as the Blind `export.ts` row).
    - `[low]` `reject` The live no-range case asserts the full English status text — the text is a live capture (Rule #36) from this instance; the sibling case's `toContain` is looser by choice. reopen_if: the gate is run on an instance with another locale.
    - `[false]` `reject` The two probe test files cannot fail when unarmed — by design: they are inert in the default suite and the guard's child run arms them, with the guard going red if a file is missing.
    - `[false]` `reject` AC-1's mutation covers only under-rejection — the AC carries a mutation line (the rule asks one per AC), and the valid-shape pins are existing tests that go red if the predicate rejected a valid shape.
  - Intent Alignment (3)
    - `[false]` `reject` Several matrix rows are proven at unit, in-process `start()` or fake level rather than through a built process (DW-554 warning, DW-533 TS side, DW-539 merge, DW-542, DW-549 conflict, DW-528, DW-530) — each is the spec's own test plan, and the built-process, real-HTTP and live cases the spec requires (process-gate J and K, the IRIS route tests, the spawn case, the live no-range and live load cases) exist and ran.
    - `[false]` `reject` DW-531 is pinned by a seam plus definition-order wiring and DW-562 covers only the `@iris-mcp/all` config — both are the spec's named scope (I3, I4, AC-3 residual); the turbo-level overlap is the deferred row above.
    - `[false]` `reject` Surfaces named only indirectly (prose pin tests, changeset bump levels, the decision numbers and DW-529 in the CHANGELOG) — all are spec-listed tasks.

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
  - the QA-stage stems `QaStory387Mod`, `QaStory387LoadA`/`B`/`C`, `QaStory387PromA`/`B` (`story-38-7-qa-live-gate`) and `QaStory387Wire*` (`story-38-7-qa-wire-gate`), each removed before and after by its gate;
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

### Implementation record (implement stage, 2026-10-16)

All commands ran from `/Users/jbrandt/git/iris-execute-mcp-v2` in the foreground; every IRIS call and armed gate named `localhost:52773`, `HSCUSTOM`, `_SYSTEM`/`SYS`, `IRIS_HTTPS=false` (MCP calls `server:"default"`). DW-562 (serialization) landed before the first bootstrap regeneration. No production was started.

**Baselines, before any change.**
- `LAUNCHER` (4 files): 132 passed, 0 red (`selectServers` 58, `serverDefinitionProvider` 61, `env` 12, `localSpawnIntegration` 1). No DW-532 red in these four files on this run.
- `ENV pnpm --filter @iris-mcp/all test` (parallel): 40 files, 433 tests, 13.45 s (14 s wall).
- DW-556 order: `--sequence.shuffle --sequence.seed=1..10` on `doc-edit-live-gate` (10 of 10 green, 10 tests each) and `doc-put-storage-guard-live-gate` (10 of 10 green, 115 tests each). No seed turned red, so the AC-10 evidence is the `afterAll` mutation and the shuffle seed used is 1.

**After the change.**
- `@iris-mcp/all` with `ENV`, now serial: 43 files, 453 tests, 48.01 s (was 40 files, 433 tests, 13.45 s parallel). The delta is `serial-probe-a`, `serial-probe-b` and `story-38-7-doc-claims` (+3 files) and +20 tests (probes 2, doc-claims 16, the guard 1, process-gate case K 1).
- Per package, `build`, `lint`, `type-check` and `test`: shared 73 files / 1629 tests; dev 57 / 1402; interop 22 / 345; admin 35 / 498; ops 20 / 350; data 9 / 165; client-config 21 / 514. Lint has 0 errors; the one warning (an unused `eslint-disable` in `packages/shared/src/cli/governance.ts`) is in code this story did not touch.
- Launcher: the four `LAUNCHER` files 133 passed (the new spawn case included). The full launcher suite has 5 failed tests and 2 files that cannot load (`constants.test.ts`, `credentials.test.ts`: `@intersystems-community/intersystems-servermanager` is not installed here), in `clientsEngine`, `governanceEngine` and `clientsActivationFlow`, none in a file this story touched (the DW-532 class). `tsc --noEmit` there prints 11 lines about the missing `vscode` module and typings, none in a touched file.
- IRIS `%UnitTest`: `InteropHostGuardTest` total 11 = 11 `Test*` (6 existing + 5 new), all passed; `InteropProductionDeleteTest` total 7 = 7 (4 + 3), all passed.
- Armed live gates (`IRIS_REQUIRE_LIVE=1`, none skipped): `doc-get-range-live-gate` 21; `doc-put-bom-live-gate` 7; `doc-edit-live-gate` 9 (file order and seed 1); `doc-put-storage-guard-live-gate` 114 (file order and seed 1); `sql-safety-live-gate` 90; `story-38-5-qa-sql-wire-gate` 28; `story-38-4-qa-doc-edit-wire-gate` 10; `epic38-capstone-gate` 6; `governance-file-process-gate` 10.
- `BOOTSTRAP_VERSION` `d352a6a32158` to `089f8f0a62b2` for the story, and for the epic `2159ec9e6f69` to `089f8f0a62b2` (intermediate values `39d44573433f` and `58b24ae312e8` during the work). `pnpm gen:bootstrap` re-run is idempotent (identical file hash). Read back after the first armed start: `SELECT ExecuteMCPv2.Setup_GetBootstrapVersion()` gave `089f8f0a62b2`.
- `pnpm gen:governance-baseline:check` exit 0 (141 frozen keys, 206 live, 65 post-foundation); `governance-baseline.ts`, `baseline-classifications.ts` and `ipm/module.xml` are unchanged since `3a1566c`; under `src/` only `Interop.cls`, `InteropHostGuardTest.cls` and `InteropProductionDeleteTest.cls` changed; `check-epics-sync.mjs` prints `OK: no genuine drift`; every payload row of the README equals the `pnpm measure:tools-payload` output (dev 84,427 / 43,611 / 84,427 bytes, interop 40,496 / 21,554 / 40,496, the others unchanged).
- Leftover scan after the last run: `iris_doc_list` (`generated:true`) and `iris_global_list` filtered on `Story38` are empty, and `SELECT COUNT(*) FROM Ens_Config.Production WHERE Name %STARTSWITH 'ExecuteMCPv2.Temp.Story38'` is 0.

**Mutation lines (Rule 19; each applied, observed red, reverted to a byte-identical file, dist rebuilt where it was touched).**
- mutation: AC-1, `if (looksLikeGovernance(key, value))` forced false in `parseGovernanceRoot`, shared dist rebuilt -> red: 23 shared tests (`governance-edge`, `governance-file`, `governance-cli`, `governance-enforcement`) and process-gate cases J and K (the built server exited 0). Path: the parser through the env, file and CLI channels and the built dev server process.
- mutation: AC-1, the unknown-profile `logger.warn(warning)` replaced by `void warning` -> red: the two `start()` warning tests in `governance-enforcement`. Path: a real `McpServerBase.start()`.
- mutation: AC-2, `If '..IsProductionClass(tName)` replaced by `If 0` and the class reloaded on HSCUSTOM -> red: `TestDeleteCompiledNonProductionClassRefused` and `TestDeleteNonProductionClassWithSameNamedRowRefused` (real HTTP answered `{"action":"deleted"...}` and the class was gone).
- mutation: AC-3, `DeleteBlockedByState` called with `tState` and `tCurrentName` swapped in the seam -> red: `TestDeleteStateRefusalSeamInjected` (6 assertions). Separately the seam call moved after the class `%DeleteId` -> red: `TestProductionManageWiring` (2 assertions). Both on the final `Interop.cls` loaded to HSCUSTOM.
- mutation: AC-4, `MCP_TRANSPORT` removed from `LAUNCHER_OWNED_VARS` -> red: the two whole-env `toEqual` pins, and the spawn case (`MCP error -32000: Connection closed`, the real server exited 1 on the ambient `MCP_TRANSPORT=http`). Path: the real `resolveEnvForLabel` and a real spawned server over stdio.
- mutation: AC-5, the no-range status check disabled -> red: 2 unit rows in `doc-get-range`, and the live no-range case on `ExecuteMCPv2.Utils` in `doc-get-range-live-gate`.
- mutation: AC-6, the retry removed (`current` forced undefined) -> red: 3 `load.test.ts` rows, and the live load case (`uploaded` 0, the 409 reported as a failure). Path: the real `IrisHttpClient` against the live Atelier PUT.
- mutation: AC-7, the `modifiedSince` early return disabled in the three tools -> red: 5 refusal rows (`doc` 1, `packages` 1, `export` 3), each seeing an HTTP call.
- mutation: AC-8, the PUT status check disabled -> red: the promote soft-status case.
- mutation: AC-9, the old sentence restored -> red: 4 `sql-safety.test.ts` pins; the armed `story-38-5-qa-sql-wire-gate` (1 of 28, dev dist rebuilt for the run, then rebuilt again after the revert); and the armed `sql-safety-live-gate` (1 of 90).
- mutation: AC-10, the `afterAll` removal disabled in `doc-put-storage-guard-live-gate` -> red: the file failed in `afterAll` with `no QaStory383 document after the run: expected [ ...(6) ] to deeply equal []` (114 tests passed); the next run's `beforeAll` purged the leftovers and the final scan is empty.
- mutation: AC-11, `fileParallelism: false` removed from `packages/iris-mcp-all/vitest.config.ts` -> red: `two test files executed at the same time: expected [ 'a.overlap', 'b.overlap' ] to deeply equal []`, from the guard's child run of the two probe files under the package's own config. The first attempt was red for the wrong reason (`options.minThreads and options.maxThreads must not conflict` when only `--maxWorkers` was passed); the child run passes `--minWorkers=1 --maxWorkers=2`, which only the parallel config honors, so the guard does not depend on the CPU count.
- mutation: AC-12, the CHANGELOG `(DW-554; ...)` line renamed and the changeset `@iris-mcp/interop` bump changed to `minor` -> red: 2 `story-38-7-doc-claims` tests.

**Review pass (2026-10-16) patch evidence.**
- `TestProductionManageWiring` gained an assertion that the seam's answer gates the refusal (`If tStateRefusal '= ""`, exactly once, after the seam call and before both deletes), and `TestDeleteStateRefusalSeamLive` gained assertions that pin the order of the live read (`GetProductionStatus(.tCurrentName, .tState)`) and of the state rule's arguments. `MethodSource` is the shared reader of a method definition. `Test*` counts are unchanged (11 and 7).
- mutation: AC-3 (review), `If tStateRefusal '= ""` replaced by `If 0` in `Interop.cls`, class loaded to HSCUSTOM -> red: `TestProductionManageWiring` (2 assertions). Separately the seam's `GetProductionStatus(.tCurrentName, .tState)` swapped to `(.tState, .tCurrentName)` -> red: `TestDeleteStateRefusalSeamLive` (1 assertion). Path: the stored method definitions on the live instance. `Interop.cls` is byte-identical after each revert (sha `d22d4611ab7b2bb143767409e805f1da89b11576`) and was reloaded; `gen:bootstrap` re-run is still idempotent at `089f8f0a62b2`.
- The residual stands as the spec names it: a refusal for a Running production through the route needs a running production, which decision #17 forbids.
- After the last patch, the `(once)` lines ran again: per-package build/test/lint/type-check clean (shared 1629, dev 1402, admin 498, interop 345, ops 350, data 165, client-config 514 tests); `@iris-mcp/all` armed and serial 43 files / 453 tests in 48.18 s; `:check` OK (141 frozen / 206 live / 65 post-foundation); `gen:bootstrap` idempotent at `089f8f0a62b2` (shared dist rebuilt clean afterwards); `check-epics-sync` OK; the payload table equals `pnpm measure:tools-payload`; the frozen files are unchanged since `3a1566c`; under `src/` only the three named classes changed; the leftover scans (`Story38`, `QaStory38`, globals, `Ens_Config.Production`) are empty / 0; `Setup_GetBootstrapVersion()` reads `089f8f0a62b2`.

**Spec corrections for the lead (Rule #42).**
- The `overCap` text has **6** exact pins, not 5 (`sql-safety.test.ts` x4, `sql-safety-live-gate.test.ts` x1, `story-38-5-qa-sql-wire-gate.test.ts` x1), counted mechanically (Rule #51). All six are updated.
- `IsProductionClass` reads the uncompiled class's `Super` with `$$$defClassKeyGet`, not `%OpenId`: an `%OpenId` of a `%Dictionary.*Definition` matches the write-path scan's `dictionaryOpen` pattern and would have needed a new roster entry for a read, and the SQL variant that was tried first made the uncompiled-Super test take 29 s on its first run (1.3 s with the macro). The `document-write-paths` roster therefore moves only `load.ts` 1 to 2.
- `filtersApplied.modifiedSince` stays in the `iris_doc_export` manifest only for `modifiedSince: ""` (byte-identical for that input); a non-empty value is refused before the manifest.

### QA record (qa stage, 2026-10-16)

Gap analysis of `fe58430..4520fd7` against the matrix and the ACs. The implement stage's unit tests, IRIS tests and live gates left these rows without a real-surface proof: DW-554 on the built process (rejection before any IRIS traffic, both channels, every key shape; valid shapes and scalar metadata starting identically; the unknown-profile WARN), DW-533 through a client and the built interop dist, DW-528 with zero requests seen on the wire, the DW-549 conflict against IRIS's own 409, and DW-530 against a status IRIS itself produced. Every test below passed on the final tree, armed (`IRIS_REQUIRE_LIVE=1`, six `IRIS_*` variables explicit, `localhost:52773` / HSCUSTOM).

- (QA) `packages/iris-mcp-all/src/__tests__/story-38-7-qa-governance-process.test.ts` - 30 tests, no IRIS (a local listener that records requests stands in): 7 shapes x 2 channels exit 1 with the matrix text, no value echoed, zero requests; 5 valid documents x 2 channels start and reach the listener; scalar metadata leaves the reported policy and attribution unchanged; the unknown-profile WARN (env, file, two configured profiles, two typos). Children run with `LOG_LEVEL=DEBUG`, so an ambient `LOG_LEVEL=ERROR` cannot hide the WARN.
- (QA) `packages/iris-mcp-all/src/__tests__/story-38-7-qa-wire-gate.test.ts` - 10 tests, live: DW-533 through the built interop dist (refusal with the class still stored; uncompiled `Ens.Production` draft deleted; missing name), DW-528 as a client sees it (parameter descriptions, three refusals, empty `modifiedSince`), DW-542 and DW-549 through the MCP argument parsing. Enrolled in `epic38-gate-guards.test.ts` `GATES_WITH_VERSION_CHECK` and in the `@iris-mcp/all` roster.
- (QA) `packages/iris-dev-mcp/src/__tests__/story-38-7-qa-live-gate.test.ts` - 8 tests, live: DW-528 (global `fetch` spied, zero requests, an export destination left empty, empty `modifiedSince` lists through `/docnames/` only); DW-549 (a change between the two PUTs gives IRIS's real 409 and a per-file `DOCUMENT_CONFLICT`, 5 PUTs in all across a conflicting, an existing and a new file; the default path stays one `?ignoreConflict=1` PUT); DW-530 (a control that completes, then a target PUT body IRIS itself refuses with `ERROR #16021` in a 200 envelope: failed, rest skipped, no compile, nothing stored). Added to the dev roster.
- Modified: `packages/iris-mcp-all/src/__tests__/process-gate-helpers.ts` (optional `onStderr`), `epic38-gate-guards.test.ts` (one array entry), both `scripts/prepublish-gate.mjs` rosters.

Runs: `@iris-mcp/all` armed, serial, 45 files / 495 tests in 54 s; the six dev live gates armed and serial, 249 tests; `InteropHostGuardTest` 11 of 11 and `InteropProductionDeleteTest` 7 of 7 (totals equal the `Test*` counts); the launcher four files 133; dev lint and type-check clean; the new `@iris-mcp/all` files type-check under `tsc --strict`. The dev live gate also passes under `--sequence.shuffle --sequence.seed=7`. The leftover scans (`Story38`, `ExecuteMCPv2.Temp`, `Ens_Config.Production`, OS temp directories) are empty / 0. `Interop.cls` reloaded to HSCUSTOM from the unchanged file (sha `d22d4611ab7b2bb143767409e805f1da89b11576`), `gen:bootstrap` idempotent at `089f8f0a62b2`.

- mutation: AC-1, `looksLikeGovernance` forced false in `parseGovernanceRoot`, shared dist rebuilt -> red: the 14 rejection rows of `story-38-7-qa-governance-process` (the built server exited 0). Path: the built dev server process, both channels.
- mutation: AC-1, `parseGovernanceConfig()` moved to after the health check in `start()`, shared dist rebuilt -> red: the 7 `IRIS_GOVERNANCE` rejection rows (`expected [ 'HEAD /api/atelier/' ] to deeply equal []`) and the unknown-profile rows. Path: the built server against the request-recording listener (the oracle the unit tests and case K lack).
- mutation: AC-1, the unknown-profile `logger.warn(warning)` replaced by `void warning`, shared dist rebuilt -> red: the 3 WARN rows of `story-38-7-qa-governance-process`.
- mutation: AC-2, `If '..IsProductionClass(tName)` replaced by `If 0`, `Interop.cls` loaded to HSCUSTOM -> red: `story-38-7-qa-wire-gate` non-production refusal (the call answered deleted). Path: SDK client, built interop dist, real HTTP, deployed route.
- mutation: AC-5, AC-6 and AC-7 on the dist (the `iris_doc_get` status check, the `iris_doc_load` retry, the `iris_doc_list` `modifiedSince` early return, dev dist rebuilt) -> red: the 3 matching rows of `story-38-7-qa-wire-gate` (doc_list refusal, no-range soft error, `ignoreConflict: false` load).
- mutation: AC-7, the `modifiedSince` early return disabled in `doc.ts`, `export.ts` and `packages.ts` -> red: the 3 refusal rows of `story-38-7-qa-live-gate` (the result was data and `fetch` was called).
- mutation: AC-6, the 409 branch of the version-checked save disabled in `load.ts` -> red: the live `DOCUMENT_CONFLICT` case of `story-38-7-qa-live-gate`.
- mutation: AC-8, the PUT status check disabled in `env-promote.ts` -> red: the live soft-status promote case of `story-38-7-qa-live-gate` (`isError` undefined).
- mutation: Rule 8, the `story-38-7-qa-wire-gate.test.ts` roster entry removed from `@iris-mcp/all` `gateTestFiles` -> red: `live-gate-roster.test.ts` for `iris-mcp-all`.

Every mutation was reverted by an exact reverse edit and checked against the pre-mutation SHA-1 of each touched file and an unchanged `git status --short` / `git diff --stat`; the shared and dev dists were then rebuilt clean (dist and `tsconfig.tsbuildinfo` removed first).

Observations (not re-filed): `IsProductionClass("Ens.Production")` answers 1, so a delete naming the base class itself passes the class check (it was deletable before the story too, and the library database is read-only); the DW-549 conflict and DW-530 soft-status cases are live at handler level (real `IrisHttpClient`, real routes) but not through an MCP session, which would need `iris_env_promote:execute` enabled and two profiles; the existing process gates `epic37-default-outage-gate`, `server-manager-precedence-gate` and `story-38-0-qa-process` fail under an ambient `LOG_LEVEL=ERROR` (they read log lines), unlike the new governance gate.

### Code review record (cr stage, 2026-10-16)

The review patches F1 to F8, F12, F18 and F19 (see `### Review Findings`) were applied. Every mutation below was applied, observed red and reverted to a byte-identical file (`git diff --stat` checked). The shared dist was rebuilt for the `governance.ts` comment, and the dev dist was rebuilt clean because `load.ts` was mutated and reverted.

- mutation: AC-1 (cr), the `i` flag dropped from `/^iris_/i` in `looksLikeGovernance` -> red: the 3 new case-variant rows (2 in `governance-edge`, 1 in `governance-file`), while every older row stayed green. Path: the shared parser through the env and file channels.
- mutation: AC-6 (cr), the version-checked save's `IrisApiError` 409 test widened to every error -> red: the new `load.test.ts` row for a non-409 failure on the retry.
- hermeticity (F5), with an ambient `IRIS_GOVERNANCE_FILE` naming another profile and enabling `iris_new_write`: the harness's new clear of `IRIS_GOVERNANCE_FILE` removed -> red: 5 `governance-enforcement` tests (2 of them the Story 38.7 `start()` tests). Restored -> 18/18 green with an ambient `IRIS_GOVERNANCE_FILE`, `IRIS_GOVERNANCE_PRESET=readonly` and `IRIS_SERVER_MANAGER=bogus-mode`.
- hermeticity (F1), the QA shape restored (the refusal rows reading the shared `scratch`, the load row writing into it), armed, `--sequence.shuffle --sequence.seed=3` (the load row runs first) -> red: the 3 refusal rows (`expected [ 'ExecuteMCPv2' ] to deeply equal []`). Patched -> 10/10 at seed 3 and 10/10 in file order, armed. Path: SDK client, built dev and interop dists, live HSCUSTOM.
- After the patches: shared 73 files / 1632 tests; the dev `load`/`doc` files 126; the shared and dev lint and type-check are clean (the one pre-existing `cli/governance.ts` warning); `@iris-mcp/all` armed and serial 45 files / 495 tests in 53 s. Leftover scans show no `ExecuteMCPv2.Temp.*` class (defined or compiled), no `Ens_Config.Production` row, no `Story38` global or document, and no temp directory.

## Auto Run Result

Status: done
Blocking condition: none

**Summary.** All 11 ledger entries are fixed at their root (DW-529 folded into DW-528). `BOOTSTRAP_VERSION` moved `d352a6a32158` to `089f8f0a62b2` (epic: `2159ec9e6f69` to `089f8f0a62b2`); `gen:bootstrap` is idempotent there and the version read back from HSCUSTOM is `089f8f0a62b2`. No tool, action, key or preset row changed; `GOVERNANCE_BASELINE` is untouched at `1e62c5ad5bf7`/141. No production was started.

**Files changed.**
- Governance: `packages/shared/src/governance.ts` (`parseGovernanceRoot` rejects a governance-shaped top-level key; `unknownProfileWarnings`), `server-base.ts` (the unknown-profile warning), `cli/governance.ts` (comments only).
- Production delete: `src/ExecuteMCPv2/REST/Interop.cls` (`DeleteStateRefusal`, `IsProductionClass`, the handler wiring), `packages/shared/src/bootstrap-classes.ts` (regenerated), `packages/iris-interop-mcp/src/tools/production.ts` (description) and its README; the two IRIS test classes `InteropHostGuardTest.cls` and `InteropProductionDeleteTest.cls`.
- Dev tools: `doc.ts` (`iris_doc_get` soft error, exported `currentDocument`, `modifiedSinceUnsupported`), `load.ts` (version-checked retry and `DOCUMENT_CONFLICT`), `export.ts` and `packages.ts` (`modifiedSince` refusal), `env-promote.ts` (PUT status), `sql.ts` (cap text), README and `tool_support.md`.
- Launcher: `extensions/iris-mcp-launcher/src/env.ts` (`MCP_TRANSPORT` owned), README, CHANGELOG, the two whole-env pins and the new spawn case.
- Gates and docs: `packages/iris-mcp-all/vitest.config.ts` (`fileParallelism: false`), `epic38-gate-guards.test.ts` and the `serial-probe*` files, process-gate cases J and K, `document-write-paths.test.ts`, `story-38-7-doc-claims.test.ts` (new), the two dev live gates (cleanup case removed, nothing-left assertions), `CHANGELOG.md`, root README, `.changeset/story-38-7-epic-38-burn-down.md`.

**Review.** 27 findings from four layers: high 0, medium 2 (one root, patched), low 18, false 6, maybe-false 1. Patches applied (5 entries, none high): the wiring and seam tests gained source assertions, mutation-verified red (two mutations) and reverted byte-identical; the doc-claims changeset and launcher-section guards; and three wording and comment corrections (dev README row, `doc.ts`, `export.ts`). Deferred: 1 (the repo-root `turbo run test` runs the dev and all suites concurrently; medium, unverified), added to the three plan-time items already in `deferred:`. Rejected with recorded reasons: 19 findings (spec-bound text or scope, decision #19, safe failures that delete nothing, theoretical states, and descriptive audit divergences that match the spec's own test plan); each has its row and reopen condition under `## Review Triage Log`.

**Follow-up review recommended: false.** Patched this pass: high 0, medium 1 (one entry), low 4.

**Verification (after the last patch).** Every `(loop)` line was re-run and passed: shared governance (307), dev (367), interop production (51), launcher four files (133), `@iris-mcp/all` doc and guard files (78), process gate (10, none skipped), `InteropHostGuardTest` 11/11 and `InteropProductionDeleteTest` 7/7 (totals equal the `Test*` counts), the five dev live gates armed (21, 7, 9, 114, 90) with the DW-556 shuffle seed 1 for the two touched, and the three `@iris-mcp/all` wire gates (28, 10, 6). The `(once)` lines ran once: per-package build, test, lint and type-check for shared, dev, admin, interop, ops, data and client-config (0 lint errors; one pre-existing warning in `cli/governance.ts`); `@iris-mcp/all` serial and armed 43 files / 453 tests in 48.18 s (the baseline parallel run was 40 files / 433 tests in 13.45 s); `:check` OK; `check-epics-sync` OK; payload table equals the measure; frozen files unchanged; leftover scans empty. The mutation lines for AC-1 to AC-12 and the review patch are under `## Verification`.

**Residual risks.**
- A refusal for a Running production through the delete route is never exercised live, because decision #17 forbids starting a production; the seam, the gate line and the live read's argument order are pinned from the stored method definitions instead.
- The DW-562 guard observes overlap inside a 2 s window, so a heavily loaded host could miss it.
- The full launcher suite has 5 red tests and 2 files that cannot load in this environment (DW-532, Story 42.7), none in a file this story touched.
- Spec corrections for the lead (Rule #42): the `overCap` text has 6 exact pins, not 5; `IsProductionClass` reads the uncompiled `Super` with `$$$defClassKeyGet` rather than `%OpenId`. Both are recorded in the implementation record under `## Verification`.
