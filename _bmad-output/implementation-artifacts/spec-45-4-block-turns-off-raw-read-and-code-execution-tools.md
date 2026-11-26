---
title: 'Story 45.4: Block Turns Off Raw-Read and Code-Execution Tools'
type: 'feature'
created: '2026-11-25'
status: 'done'
baseline_revision: '8e7aad87e8798730a3fd3a659519c6111bbcde9f'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-45-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-iris-execute-mcp-v2-2026-10-14/ARCHITECTURE-SPINE.md'
warnings: ['oversized']
deferred:
  - summary: >-
      Under `block` alone (no read-only preset), write tools that can run code stay on: compiling or loading a class runs its generators (`iris_doc_put`/`iris_doc_load`/`iris_doc_compile`/`iris_doc_edit:apply`/`iris_doc_xml_export:import`), and starting a production, building a cube or running a task runs existing code. A generator can put data into the compile output.
    evidence: |-
      Plan, Rule #56 sweep (2026-11-25): these keys are writes the read-only preset already turns off (SCP J-5 lists the compile/load writes as residual). This story documents the combination `block` + `IRIS_GOVERNANCE_PRESET=read-only`; whether `block` should also seed these writes off is an owner product call for the epic-close decision sheet.

      CLOSED by Planner ruling (decision #170, 2026-11-25): these are writes, off by default or a deliberate operator act; the read-only preset covers them and the docs recommend `block` plus `IRIS_GOVERNANCE_PRESET=read-only`. The lead harvests it as `wontfix-accepted`; the owner may reopen it.
    location: >-
      packages/shared/src/data-policy.ts (DATA_POLICY_BLOCK_KEYS); README.md "PHI data policy"
    severity: med
  - summary: >-
      `iris_docdb_document:delete` stays on under `block` and returns the deleted document, so it reads one stored document (and destroys it) by a known ID. The plan's table said insert/update/delete return IDs or status only; that claim was wrong for delete.
    evidence: |-
      Review (edge-case layer), verified in irislib/%Api/DocDB/v1.cls: `httpDeleteDocument` renders the result of `database.%DeleteDocument(documentID)` (the deleted document) with 200. `iris_docdb_document:delete` is a write, enabled by default (`iris-mcp-governance universe`). `insert` and `update` echo the content the caller sent. The README sentence is corrected in this story; adding `iris_docdb_document:delete` to the covered set changes the lead's 11-key decision (#169), so it is left as a product call.

      RESOLVED at code review (2026-11-26) by decision #172: `iris_docdb_document:delete` joined `DATA_POLICY_BLOCK_KEYS` (12 keys), with the scope row, docs, spine AD-26 and a wire leg (denied under `block`, zero IRIS requests). The lead closes DW-782 as resolved-by this story.
    location: >-
      packages/shared/src/data-policy.ts (DATA_POLICY_BLOCK_KEYS); README.md "PHI data policy"
    severity: med
  - summary: >-
      `iris_analytics_mdx` stays on under `block`. It returns axis labels and cell values only, but a cube with a dimension on an identifying property shows those values as member labels.
    evidence: |-
      Code read: src/ExecuteMCPv2/REST/Analytics.cls:52-91 reads %GetOrdinalLabel and %GetValue only and never %GetListingResultSet, so a DRILLTHROUGH listing is not returned. Documented as residual in the scope table; reopen if a cube definition review shows identifying dimensions are common.
    location: >-
      packages/iris-mcp-all/src/__tests__/data-policy-scope.ts (iris_analytics_mdx row)
    severity: low
  - summary: >-
      UNVERIFIED (maybe-false; medium if true): `iris_sql_analyze` stays on under `block`, but its `stats` action returns the `Statement` text of `INFORMATION_SCHEMA.STATEMENTS` and `running` returns every column of `INFORMATION_SCHEMA.CURRENT_STATEMENTS`, which hold other sessions' statement text. If a literal (for example a record number in a WHERE clause) survives in that text, `block` leaves a raw read of other sessions' query values open.
    evidence: |-
      Code review (blind layer), 2026-11-26: `packages/iris-dev-mcp/src/tools/sqlAnalyze.ts` around L560-575. Decision #169 classed the tool residual as "plans only". Settle with a Rule #16 probe on a throwaway: run a query with a literal in its WHERE clause from another session, then read both views and check whether the literal appears or is parameterized. Covered-set changes are the owner's (decision #169 delegation), so this goes to the epic-close decision sheet if the probe shows literals.
    location: >-
      packages/shared/src/data-policy.ts (DATA_POLICY_BLOCK_KEYS); packages/iris-mcp-all/src/__tests__/data-policy-scope.ts (iris_sql_analyze row)
    severity: med
  - summary: >-
      Decision #172's rationale in orchestrator-decisions-wave-10.md says `insert` and `update` "return IDs or status only"; this story's docs (and irislib/%Api/DocDB/v1.cls) say they return the content the caller sent.
    evidence: |-
      Code review (acceptance and blind layers), 2026-11-26. The shipped docs carry the correct claim; only the lead's decision record repeats the wrong one. A one-line wording fix in the lead's record, which this review does not edit.
    location: >-
      _bmad-output/implementation-artifacts/orchestrator-decisions-wave-10.md (row 172)
    severity: low
---

<intent-contract>

## Intent

**Problem:** `IRIS_DATA_POLICY=block` withholds message bodies only in the governed message tools. The raw-read and code-execution tools (`iris_sql_query`, `iris_global_get`, `iris_execute_command` and others) return the same data in full, and nothing tells an operator which of them are on (GitHub issue #1 point 1, owner decision (4)).

**Approach:** Add a `dataPolicySeed` layer to the AD-6 cascade. For a profile whose effective policy is `block`, it seeds each key of one declared covered set (`DATA_POLICY_BLOCK_KEYS`, 11 keys) disabled, above the preset and below the explicit layers and the inherited disable. Denials stay `GOVERNANCE_DISABLED` with an additive `dataPolicyApplied: "block"`, and `configSource` reports `"dataPolicy"`. Each server writes at most one startup `[WARN]` line naming, for each `redact` or `block` profile, the covered keys that are visible and enabled. A cross-package test checks the set against the PHI scope table and the docs.

## Boundaries & Constraints

**Always:**
- The cascade is `env.profile ?? env.global ?? file.profile ?? file.global ?? inheritedDisable ?? dataPolicySeed ?? presetSeed ?? defaultSeed` (spine AD-6). The seed reads the profile's resolved `dataPolicy` (AD-26 resolution, unchanged).
- The covered set is declared once, in `@iris-mcp/shared` as `DATA_POLICY_BLOCK_KEYS`, in this order: `iris_sql_query`, `iris_sql_execute`, `iris_global_get`, `iris_global_list`, `iris_execute_command`, `iris_execute_classmethod`, `iris_execute_tests`, `iris_test_coverage`, `iris_transform_test`, `iris_docdb_document:get`, `iris_docdb_find` (exhaustive as of 2026-11-25; source: the scope table plus the Rule #56 sweep in Design Notes).
- The gate, `iris_server_profiles` (both branches), the `iris-governance://` resource and the `iris-mcp-governance` CLI (`effective`, `universe`) all pass the profile's policy to the same engine functions.
- The denial text gets the suffix ` (data policy 'block')`. Its `structuredContent` carries `dataPolicyApplied: "block"` and never `presetApplied` when the seed decided. The audit entry of a denial copies `dataPolicyApplied`.
- An explicit `true` re-enables a key at any of the four explicit layers. An explicit `false`, or an inherited parent disable, keeps its own attribution (`configSource` `env`/`file`/`parent`; no `dataPolicyApplied`).
- The warning is computed from configuration only, before any IRIS request. It names a key only when its tool is visible on this server and `effective()` is `true` for that profile. It never logs values. It is at most one line per process and is absent when no profile has a key to list.
- Under `redact`, `allow` and an unset policy, every tool result, every `iris_server_profiles` field, every governance verdict, every denial and every audit entry is byte-identical to `baseline_revision`. The warning line is the only new output (`S-45.4-block-raw-tools`).

**Never:**
- No new tool, action, governance key, preset row or `TOOL_PAIRS` entry. No visibility mechanism (AD-7). No change to `GOVERNANCE_BASELINE` (`pnpm gen:governance-baseline:check` only; never the bare generator). No tool-description or schema change, so the Frozen goldens and the tools-list snapshot stay untouched.
- Do not reuse `DATA_POLICY_BLOCKED` for these denials. Do not filter SQL or global output under `redact`. Do not touch the five servers' `index.ts` beyond what the engine needs, or any `.cls` (`BOOTSTRAP_VERSION` stays `1.2.0+10.109d0129528f`).
- Do not edit generated files, the IPM tree, golden JSONs, `sprint-status.yaml`, the ledger, the cycle log or `epics.md`. No commit, push, or test call against the shared IRIS at `localhost:52773`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Default install | No `IRIS_DATA_POLICY` (`redact`), no governance, `full` visibility | dev: one `[WARN]` naming 7 keys (not `iris_test_coverage`, which is a disabled write); interop: `iris_transform_test`; data: both docdb keys; admin/ops: no line. Every call and result is unchanged | — |
| `block` | `IRIS_DATA_POLICY=block`, any covered key called | `GOVERNANCE_DISABLED` `{action, server, dataPolicyApplied:"block"}`, text ends ` (data policy 'block')`, no IRIS request; discovery shows `false` / `"dataPolicy"`; no warning line | Audit `outcome:"denied"`, `denyReason`, `dataPolicyApplied` |
| Re-enable | `block` + `IRIS_GOVERNANCE={"global":{"iris_sql_query":true}}` | `iris_sql_query` runs (`configSource:"env"`); the other 10 are denied; the warning names only `iris_sql_query` for that profile, marked re-enabled | — |
| Parent enable is not inherited | `block` + `{"global":{"iris_sql_execute":true}}` | `iris_sql_execute` runs; `iris_sql_query` is still denied with `dataPolicyApplied` | — |
| Parent disable | `block` + `{"global":{"iris_sql_execute":false}}` | `iris_sql_query` denial carries `inheritedFrom`, `configSource:"parent"`, no `dataPolicyApplied`; `iris_sql_execute` is `env` | — |
| `block` + read-only | Both set | Covered keys: `dataPolicyApplied`, no `presetApplied`. A non-covered write (`iris_global_set`): `presetApplied:"read-only"` as before. An explicit `true` beats both | — |
| Per profile | `IRIS_PROFILES` `prod` `dataPolicy:"block"`, default `redact` | `prod`'s covered calls are denied, `default`'s run; the warning has a `default` group only (unless `prod` re-enables) | — |
| `allow` | `IRIS_DATA_POLICY=allow` everywhere | No line; everything byte-identical | — |
| Hidden tool | `IRIS_TOOLS_PRESET=core` or `IRIS_TOOLS_DISABLE` hides a covered tool | That key is never named; no line when nothing is left | — |
| Grouping | Profiles `a`, `b` (redact, same list), `c` (block, one re-enable) | One line: `profiles "a", "b" (redact): …; profile "c" (block, re-enabled by an explicit governance key): …` | — |
| CLI | `iris-mcp-governance effective` with `IRIS_DATA_POLICY=block` | Covered keys `false` / `"dataPolicy"`; header adds ` (data policy: block)`; under `redact`/`allow` the output is byte-identical | Malformed `IRIS_DATA_POLICY` or entry `dataPolicy`: exit 1 with the servers' text |

</intent-contract>

## Code Map

- `packages/shared/src/governance.ts` -- the engine. Header cascade doc L27-40. `presetSeed` L1149-1171 is the sibling to mirror for the new `dataPolicySeed(key, policy, blockKeys)`. `effective` L1259-1288 is the seed slot, after `inheritedParentDisable`. `hasExplicitOverride` L1312. `GovernanceConfigSource` L1336 gains `"dataPolicy"`. `configSource` L1354-1384 checks the seed after `parent` and before `preset`. `getEffectiveConfigSources` L1405 and `getEffectivePolicy` L1461 thread the policy. New trailing optional params `dataPolicy?: DataPolicy` and `blockKeys = DATA_POLICY_BLOCK_KEYS`; when absent the result is byte-identical.
- `packages/shared/src/data-policy.ts` -- type-only-deps module (header L19-21). Home of `DATA_POLICY_BLOCK_KEYS` (a frozen ordered array plus a set, with an as-of constant `2026-11-25`) and the pure warning builder. `resolveDataPolicy` L119-136 and `effectiveDataPolicy` are reused as-is.
- `packages/shared/src/server-base.ts` -- the gate L1841-1906 passes `profile.dataPolicy` and adds `dataPolicyApplied`/suffix; `presetCaused` must become false when the seed decided. Audit copy L2433-2442 adds `dataPolicyApplied`. Resource `buildGovernancePolicyResult` L1192-1260 resolves the profile's policy (default: `redact`). Startup: after `applyDataPolicies` L2866, `parseGovernancePreset` L2900 and `applyAutoInstall` L2906, before the audit parse, log the warning once. Visible keys come from `visibleGovernedKeys()` L1140.
- `packages/shared/src/server-discovery.ts` -- `computeServerDiscovery` L296-380: pass `effectiveDataPolicy(profile)` per profile in both branches. No signature change, because profiles carry the policy.
- `packages/shared/src/audit.ts` -- `AuditEntryInput`/`AuditEntry` (L196-203, L236) and the denied branch L321 get the optional `dataPolicyApplied` (additive, AD-19).
- `packages/shared/src/cli/governance.ts` -- `cmdEffective` L999-1100 and the universe render L1400-1470 resolve the profile's policy (an `IRIS_PROFILES` entry's `dataPolicy` read with `parseDataPolicyValue`, then `parseOperatorDataPolicy(deps.env)`, then the file section, through `resolveDataPolicy`) and pass it. Header doc L1-70 and `--help`: 8-step cascade.
- `packages/shared/src/index.ts` -- export `DATA_POLICY_BLOCK_KEYS`, the as-of constant, `dataPolicySeed` and the warning builder (45.5 consumes them from dist).
- `packages/shared/src/refusals.ts` L31 -- `DATA_POLICY_BLOCKED` stays the governed tools' own refusal (not reused).
- `packages/iris-mcp-all/src/__tests__/data-policy-scope.ts` / `.test.ts` -- the scope classification and the Rule #56 test. The date `2026-10-17` moves to `2026-11-25`. `iris_global_list` and `iris_locks_list` move from notApplicable to residual. Residual rows gain `block: "off" | "on"`, and `"off"` may name actions.
- `packages/iris-mcp-all/src/__tests__/process-gate-helpers.ts` -- `withWireSession`, `governanceReport`, `governanceDenial`, `start503Stub`/`withStub`, `distEntry`, `onStderr`. `story-39-2-data-policy-startup.test.ts` is the built-server + stub + stderr pattern to follow.
- `scripts/lib/tool-catalog.mjs` -- `loadAllTools`/key derivation for the existence cross-check (Rule #45).
- `src/ExecuteMCPv2/REST/Task.cls` L108-135 and `Analytics.cls` L52-91 -- read-only evidence for the `iris_task_run` and `iris_analytics_mdx` verdicts.
- Docs: `README.md` L143 (the `IRIS_DATA_POLICY` row), L235 (CLI `effective` cascade), L530 (`configSource` values), L900-925 ("PHI data policy"); `tool_support.md` L403-448 (scope section) plus a dated note after L212; `packages/shared/README.md` L137 ("7-step" cascade); `packages/iris-{dev,interop,data}-mcp/README.md` (interop L36/L58; dev and data Configuration); `CHANGELOG.md` top; `.changeset/`.

## Tasks & Acceptance

**Execution:**
- `packages/iris-mcp-all/src/__tests__/fixtures/story-45-4-back-compat-baseline.json` -- capture this FIRST, from a build of `baseline_revision` before any code change. Under `redact`, `allow` and unset, with presets none/`read-only` and the explicit configs of the matrix rows: `iris_server_profiles` (single profile and `allProfiles`), the `iris-governance://default` resource, the denials of three covered keys and one non-covered write under `read-only`, and their audit entries. The test header records the capture command and the commit (Rule #36). -- Back-compat oracle from reality.
- `packages/shared/src/data-policy.ts` -- add `DATA_POLICY_BLOCK_KEYS` (the 11 keys, in order), `DATA_POLICY_BLOCK_KEYS_AS_OF = "2026-11-25"`, and `buildDataPolicyWarning(profiles, isCallable)` returning the one line or `undefined` (wording in Design Notes). -- Single declaration; pure and unit-testable.
- `packages/shared/src/governance.ts` -- add `dataPolicySeed`, the `"dataPolicy"` source, and the trailing params on `effective`, `configSource`, `getEffectivePolicy` and `getEffectiveConfigSources`; update the header and JSDoc cascade text. -- AC 45.4.2.
- `packages/shared/src/server-base.ts`, `server-discovery.ts`, `audit.ts` -- thread the profile's policy into every engine call; add the gate attribution, the audit copy and the single startup warning. -- AC 45.4.2, 45.4.4.
- `packages/shared/src/cli/governance.ts`, `packages/shared/src/index.ts` -- CLI parity (decision D5) and the exports.
- `packages/shared/src/__tests__/governance-data-policy-seed.test.ts` (new) -- the engine over every matrix row: values, `configSource`, parent cases, read-only interplay, an explicit `false`, a custom `blockKeys`; and for each policy in redact/allow/undefined, `getEffectivePolicy`/`getEffectiveConfigSources` deep-equal the calls without the new arguments.
- `packages/shared/src/__tests__/data-policy-warning.test.ts` (new) -- grouping, the block "re-enabled" marking, the hidden-key exclusion, no line when empty, no line under `allow`, key order.
- `packages/shared/src/__tests__/governance-cli.test.ts` -- `effective` and `universe` under `block` via `IRIS_DATA_POLICY`, the file section and an `IRIS_PROFILES` entry; byte-identical output under `redact`.
- `packages/iris-mcp-all/src/__tests__/story-45-4-block-seed-wire.test.ts` (new, default suite) -- the built dev, interop and data servers over stdio with the real SDK client (`withWireSession`, 503 stub, `onStderr`), covering the matrix rows `block`, re-enable, parent, `block`+read-only, per profile, `allow`, hidden tool and default. Assert the denial `structuredContent` (deep-equal), that the stub saw zero requests for a denied call, that a run call reached the stub, the discovery `policy`/`configSource`, the audit line, and that stderr has exactly 0 or 1 matching `[WARN]` line with the exact text. -- AC 45.4.5 (integration AC).
- `packages/iris-mcp-all/src/__tests__/story-45-4-back-compat.test.ts` (new, default suite) -- replay the baseline fixture's cases on the current dists and deep-equal (the warning line excluded from stderr). -- AC 45.4.6.
- `packages/iris-mcp-all/src/__tests__/data-policy-scope.ts`, `data-policy-scope.test.ts` -- the date move, the two reclassified rows, and per-row `block` verdicts. New assertions: every residual row has a verdict; the `off` rows (with their actions) equal `DATA_POLICY_BLOCK_KEYS` from the shared dist; every covered key exists on exactly one built server; no covered key belongs to a governed or notApplicable tool; the `tool_support.md` "Under `block`" column equals the verdicts; the README "What `block` turns off" list equals the declaration. -- AC 45.4.1 (Rule #44).
- `packages/iris-mcp-all/src/__tests__/story-39-2-doc-claims.test.ts`, `story-40-1-doc-claims.test.ts` -- update the pinned heading and anchor to `2026-11-25` (the precedent is Story 40.1's date move).
- Existing tests that combine `block` with a covered key (the plan's grep found these candidates: `packages/iris-mcp-all/src/__tests__/story-39-1-message-search-live-gate.test.ts`, `story-39-6-qa-forensics-prompts-sdk-wire.test.ts`, `prompt-safety-invariants.test.ts`, `packages/shared/src/__tests__/governance-cli.test.ts`), plus any `GovernanceConfigSource` exhaustive list and any quiet-startup-stderr assertion on dev/interop/data (`rg -l "IRIS_DATA_POLICY|configSource|\[WARN\]" packages/*/src`) -- add an explicit re-enable or update the expectation under `S-45.4-block-raw-tools`, and name each file in the Spec Change Log.
- Docs (`README.md`, `tool_support.md`, `packages/shared/README.md`, the three server READMEs) -- minimal docs per AC 45.4.7, wording in Design Notes. -- Rules #30, #43.
- `CHANGELOG.md`, `.changeset/story-45-4-block-turns-off-raw-read-and-code-execution-tools.md` -- `minor` for all six `@iris-mcp/*` packages (decision #160), naming `S-45.4-block-raw-tools`.

**Acceptance Criteria:**
- Given the built servers, when the scope test runs, then `DATA_POLICY_BLOCK_KEYS` is exactly the 11 keys, each exists on exactly one server, every residual row of the 2026-11-25 scope has a `block` verdict, and `tool_support.md` and the README list match the declaration (AC 45.4.1).
- Given `IRIS_DATA_POLICY=block` on the built dev server, when the SDK client calls each covered dev key, then each returns `GOVERNANCE_DISABLED` with `dataPolicyApplied: "block"`, no request reaches IRIS, and `iris_server_profiles` reports `false`/`"dataPolicy"` for those keys. Given an explicit `true` for one, it runs and the warning names it (AC 45.4.2, 45.4.5).
- Given `redact` or `allow`, when the back-compat replay runs, then every pinned output deep-equals the baseline fixture (AC 45.4.3, 45.4.6).
- Given any configuration, when a server starts, then stderr holds at most one data-policy `[WARN]` line, naming only visible, enabled covered keys of `redact`/`block` profiles, and none under `allow` or when nothing qualifies (AC 45.4.4).
- Given the seed term is removed from `effective()`, when the wire test runs, then the `block` denial legs go red (AC 45.4.5, Rule #59; the path is the stdio `tools/call` through `handleToolCall`).
- Given the docs, when read, then the README `IRIS_DATA_POLICY` row and "PHI data policy" section, `tool_support.md` (with the column and the dated note), the three server READMEs, `CHANGELOG.md` and the changeset state each covered key's state under `block` (off, re-enabled by an explicit governance key), the warning, and `S-45.4-block-raw-tools` (AC 45.4.7).

### Review Findings

Code review 2026-11-26 (`bmad-code-review`, full mode; frozen diff `git diff c9324423..c9d9773a` minus the generated back-compat fixture and three bookkeeping files). All four layers delivered (Blind Hunter, Edge Case Hunter, Verification Gap, Acceptance Auditor); review outcome CLEAN. 30 raw findings: 15 entries after grouping (13 patch, 2 defer, 0 decision-needed) and 10 rejected. Lead directives #172 (DW-782) and the per-policy warning wording were applied as patches.

- [x] [Review][Patch] (high) Decision #172 / DW-782: `iris_docdb_document:delete` joins `DATA_POLICY_BLOCK_KEYS` (12 keys), with the scope row `off (get, delete)`, the README list and paragraph, the data README, `tool_support.md` (column and note), CHANGELOG, changeset, spine AD-26, the 11→12 wording in the tests, and a wire leg (denied under `block`, zero IRIS requests, audit `dataPolicyApplied`). `insert`/`update` stay residual; the back-compat fixture is unedited and green [packages/shared/src/data-policy.ts:196]
- [x] [Review][Patch] (medium) Warning wording per policy (Planner condition on #172): `buildDataPolicyWarning` gains `reEnabledBy`; a `block`-only line no longer says "`redact` covers message bodies only" or offers `block`, and names each re-enabled key's setting (`from IRIS_GOVERNANCE` / `from IRIS_GOVERNANCE_FILE`, from `configSource`); a mixed line gives each group its own reason; the three variants are pinned word for word in `data-policy-warning.test.ts` and on the wire [packages/shared/src/data-policy.ts:274]
- [x] [Review][Patch] (medium) The `!dataPolicyCaused` guard on `presetApplied` had no test for a covered write; the `block`+read-only wire leg now deep-equals `iris_sql_execute`'s denial and audit entry [packages/iris-mcp-all/src/__tests__/story-45-4-block-seed-wire.test.ts]
- [x] [Review][Patch] (medium) The warning's `effective()` filter had no test for the preset or the parent keys; new wire leg (`read-only` names only the covered reads; a parent `false` drops its child) [packages/iris-mcp-all/src/__tests__/story-45-4-block-seed-wire.test.ts]
- [x] [Review][Patch] (medium) The back-compat fixture had no documented refresh path once it runs on the publish gate; the test header now says how a later sanctioned change re-captures (on its own baseline build, never on its changed build) [packages/iris-mcp-all/src/__tests__/story-45-4-back-compat.test.ts:16]
- [x] [Review][Patch] (low) CHANGELOG and changeset said only a stock dev server logs the line; interop and data do too [CHANGELOG.md:16]
- [x] [Review][Patch] (low) The dev and data READMEs lacked `S-45.4-block-raw-tools` and the `block` warning behaviour; added and pinned [packages/iris-dev-mcp/README.md:35]
- [x] [Review][Patch] (low) The CLI header comment called `effective` "the full 8-step cascade" though it passes no parent keys; reworded [packages/shared/src/cli/governance.ts:20]
- [x] [Review][Patch] (low) The README audit-field paragraph did not name `dataPolicyApplied`; added and pinned [README.md]
- [x] [Review][Patch] (low) The `DataPolicyWarningProfile` doc comment described keys the interface does not hold [packages/shared/src/data-policy.ts:236]
- [x] [Review][Patch] (low) The launcher real-CLI test's `configSource` closed set and the badge comment lacked `dataPolicy` [extensions/iris-mcp-launcher/src/__tests__/governanceEngineRealCli.test.ts:193]
- [x] [Review][Patch] (low) Spec bookkeeping: the `deferred:` DocDB-delete entry is marked resolved by #172. (The Auto Run Result's "Rejected: 22" over-states nothing material but miscounts: the triage log holds 23 rejects; left as the implement pass's record.) [spec frontmatter]
- [x] [Review][Patch] (low) Rule 19: mutation lines for the new legs are recorded under `## Verification` (review pass 2) [spec]
- [x] [Review][Defer] `iris_sql_analyze` `stats`/`running` may return other sessions' statement literals under `block` [packages/iris-dev-mcp/src/tools/sqlAnalyze.ts] — deferred: maybe-false (medium if true); settle with a throwaway probe of literal parameterization in `INFORMATION_SCHEMA.STATEMENTS`/`CURRENT_STATEMENTS` (spec `deferred:`)
- [x] [Review][Defer] Decision #172's rationale repeats the "insert/update return IDs or status only" claim this story corrected [_bmad-output/implementation-artifacts/orchestrator-decisions-wave-10.md] — deferred: the lead's record (spec `deferred:`)

Rejected:
- `false` epics.md edited in the story range: the hunk is the lead's decision #171 bookkeeping commit `e64005ea`, not implementation work.
- `false` CLI exits 1 when another `IRIS_PROFILES` entry has a malformed `dataPolicy`: the servers refuse the same environment at startup, which is the spec's CLI matrix row (parity, not a regression of a working setup).
- `false` "Reached IRIS" in the positive legs means "passed the gate": that is the property those legs pin; the zero-request denial oracle stays sound.
- `false` `iris_test_status` is on while `iris_execute_tests` is off: decision #169 (it reads recorded results and runs no code); spec-bound.
- `low` The launcher governance view scrubs `IRIS_DATA_POLICY`, so an ambient `block` in the editor host shows covered keys as enabled: display-only and fail-safe (the server still denies), needs an ambient variable the launcher does not own; wontfix-accepted, reopen_if a user reports the view disagreeing with `iris_server_profiles` under `block`.
- `low` The `deploy-and-test-class` prompt does not mention `block`: under `block` the refusal carries `dataPolicyApplied` and its own text; a prompt-text change is a sanctioned golden change beyond this story; wontfix-accepted, reopen_if an agent is observed misreading that refusal.
- `low` "set IRIS_DATA_POLICY=block" does not help a profile whose `IRIS_PROFILES` entry sets `dataPolicy`: rare (the operator wrote that entry), and the fix lengthens a pinned line; wontfix-accepted, reopen_if a field report.
- `low` `residual()` defaults the verdict to `on`: removing the default touches about 30 rows; every new row is a reviewed Rule #56 addition; wontfix-accepted, reopen_if a residual row is added after 45.4 without a stated verdict.
- `low` The wire test reads startup stderr without a readiness wait: the line is written before the server reads its first request, and the positive legs read the same stream; wontfix-accepted, reopen_if a negative leg flakes.
- `low` (theoretical) A future tool whose parent is a covered key but which is not covered itself: no such tool exists (`iris_sql_query`'s parent `iris_sql_execute` is covered); wontfix-theoretical, real when a story adds a parent key to a covered key.

## Spec Change Log

- 2026-11-25 (lead, spec gate, decision #169): **D1–D8 accepted as recommended.**
  - **D1:** the 11-key covered set.
  - **D2:** `iris_global_list` and `iris_locks_list` move to residual, and the scope date moves to 2026-11-25.
  - **D3:** denials stay `GOVERNANCE_DISABLED`, adding `dataPolicyApplied: "block"` and the ` (data policy 'block')` suffix, copied into the audit entry. `DATA_POLICY_BLOCKED` is not reused.
  - **D4:** one grouped warning line.
  - **D5:** the CLI applies the seed.
  - **D6:** the docs say what `block` does not cover and recommend pairing it with the read-only preset.
  - **D7:** no tool description changes.
  - **D8:** the changeset is `minor`.

  **Amendments A1–A5 are applied to `epics.md` as written** (tagged; A4 also records the 11 keys and the write-tools note). **The spine text is written** (Rule 20): AD-6 carries the field names, the declaration and the CLI; AD-19 says a `block` denial is `denied` and copies `dataPolicyApplied`; AD-26 lists the five added keys.

- 2026-11-25 (lead, Planner conditions on #169, decision #170; BINDING for implement and review):
  1. **Explicit re-enable wins, and stays visible.** Pin the precedence: an explicit per-tool `true` in `IRIS_GOVERNANCE` or the governance file (per profile or global) beats the `block` seed. Then the startup warning names that tool as on under `block`, `iris_server_profiles` shows its `configSource`, and the governance CLI shows the same. `IRIS_TOOLS_ENABLE` is visibility (AD-7) and **never** re-enables a covered tool: pin that a covered tool made visible by `IRIS_TOOLS_ENABLE` is still denied under `block`. Pin the reverse too: a call's own arguments can never re-enable a covered tool. The README says this in one line, because an operator will try `IRIS_TOOLS_ENABLE` first: "`IRIS_TOOLS_ENABLE` only shows a tool; under `block` a covered tool stays off until `IRIS_GOVERNANCE` or the governance file sets it `true`." Pin that line in the doc claims. (Planner accepted both #170 readings.)
  2. **The warning is worth reading.** One grouped `[WARN]` line per server, never one per profile. It names the tools and says in plain words that `redact` covers message bodies only. It points to the README's "PHI data policy" section; 45.5 repoints it to "What the safety settings protect" when that section exists, so the docs never point at a missing section. It never offers `IRIS_DATA_POLICY=allow` as a way out, since that loosens message bodies. The ways out it names are disabling the named tools (their governance keys) or using `block`. Pin the "no `allow`" wording.
  3. **Rule #19 all-tools sweep.** Under `allow` and under the default `redact` (unset), every governance key's enabled/disabled state and `configSource` on all five servers is byte-identical to the pre-story build (baseline `8e7aad87`; no governance key or default changed since 1.2.0). Only `block` changes. Capture the fixture from the baseline build before any code change.
  4. **Least-privilege legs** under `block` and `redact` in the lead smoke. Under `block`, a denied call reaches IRIS zero times (request recorder or live request count).
  - The plan's deferred MED (code-running write tools stay on under `block` alone) is **closed by Planner ruling**, not routed. They are writes and off by default, and turning one on is a deliberate operator act. The owner's ruling named raw-read and code-execution tools, and the read-only preset covers these. The docs keep the recommendation `block` plus `IRIS_GOVERNANCE_PRESET=read-only` for a PHI instance. The lead harvests it as `wontfix-accepted`; the owner may reopen it.

- 2026-11-25 (implement): **existing files changed, named per the Task list.**
  - Existing test and test-support files: `packages/iris-mcp-all/src/__tests__/data-policy-scope.ts` (date, two reclassified rows, `block` verdicts), `data-policy-scope.test.ts`, `story-39-2-doc-claims.test.ts` and `story-40-1-doc-claims.test.ts` (pinned heading and anchor to `2026-11-25`, and the exact `iris_test_coverage` row with its new `off` cell), `story-45-2-auto-install-orchestration.test.ts` (its "exactly one warning" count now excludes the Story 45.4 `[WARN] Data policy:` line: a dev server under the default `redact` writes it, `S-45.4-block-raw-tools`), `packages/shared/src/__tests__/governance-cli.test.ts` and `governance-cli-universe.test.ts` (added Story 45.4 describes only; no existing assertion changed).
  - No existing test combined `block` with a covered key: the plan's candidates (`story-39-1-message-search-live-gate`, `story-39-6-qa-forensics-prompts-sdk-wire`, `prompt-safety-invariants`) and every file of `rg -l "IRIS_DATA_POLICY|configSource|\[WARN\]" packages/*/src` ran green unchanged. No exhaustive `GovernanceConfigSource` list exists.
  - Spec deviations: (1) the warning wording follows decision #170 item 2 (it says `redact` covers message bodies only and names the ways out), not the shorter D4 example; it starts `Data policy:` and the builder is `buildDataPolicyWarning(profiles, isCallable, blockKeys?)`. (2) `iris-mcp-governance effective` also renders the 11 covered keys under `block` (they are not all in the frozen baseline), and its `--json` output gains a `dataPolicy` member only under `block`. (3) The back-compat fixture is compact (a digest plus a summary per governance view, one record per line) rather than the full maps, to stay under 0.5 MB.

- 2026-11-26 (lead, decisions #172 and the Planner's warning condition; BINDING for code review):
  1. **DW-782.** Add `iris_docdb_document:delete` to `DATA_POLICY_BLOCK_KEYS` (12 keys). It returns the deleted document and is enabled by default (frozen baseline). Update the cross-check, the README and `tool_support.md` lists, the "Under `block`" column, the CHANGELOG and changeset, and the spine's AD-26 list. Add a wire leg: under `block` it is denied with zero IRIS requests. The `redact`/`allow` back-compat sweep stays unchanged. `insert` and `update` stay residual.
  2. **The warning wording per policy.** A `block` profile's group must NOT carry "`redact` covers message bodies only". It must say these covered tools are on because an explicit governance key re-enabled them, and name that key's source (`IRIS_GOVERNANCE` or the governance file, as `configSource` reports it). There are three variants, each pinned word for word:
     - only `redact` profiles;
     - only `block` profiles with re-enabled keys;
     - mixed: one line, each group with its own reason.
     The line still never offers `allow`.

  **Least-privilege leg (decision #166):** the lead smoke runs one under `block` and one under `redact`. `iris_production_logs` is already governed under `block` (Story 39.7) and is not in the set.

- 2026-11-25 (implement, review pass): review patches changed `packages/iris-mcp-all/scripts/prepublish-gate.mjs` (two files added to `gateTestFiles`), `README.md` (the docdb sentence), `extensions/iris-mcp-launcher/src/governanceView.ts` and `README.md` (the `dataPolicy` source value), `packages/shared/src/server-base.ts` (a comment), `packages/shared/src/__tests__/governance-data-policy-seed.test.ts` (a comment) and `packages/iris-mcp-all/src/__tests__/data-policy-scope.test.ts` (a test title). Existing tests changed by the implement pass: `data-policy-scope.test.ts`, `story-39-2-doc-claims.test.ts`, `story-40-1-doc-claims.test.ts`, `story-45-2-auto-install-orchestration.test.ts` (its one-warning count excludes the new `Data policy:` line), `governance-cli.test.ts` and `governance-cli-universe.test.ts` (describes appended).

## Review Triage Log

### 2026-11-25 — Review pass
- verdicts: 29 findings — high 1, medium 2, low 21, false 5, maybe-false 0 (counted mechanically from the rows below; the intent-alignment layer is descriptive, and its observations are the last five rows)
- findings:
  - `[high]` `[patch]` Verification-gap: the two new armed files (`story-45-4-block-seed-wire`, `story-45-4-back-compat`) are not in `gateTestFiles`, so `live-gate-roster.test.ts` is red and `IRIS_REQUIRE_LIVE` arms nothing on the publish path — confirmed by the reviewer's run; patched: both added to `packages/iris-mcp-all/scripts/prepublish-gate.mjs`.
  - `[medium]` `[patch]` Edge: README said insert/update/delete of `iris_docdb_document` "return IDs or status only"; `httpDeleteDocument` returns the deleted document (irislib/%Api/DocDB/v1.cls) — patched: README sentence corrected; the product question (cover `delete`?) is deferred (see `deferred:`).
  - `[medium]` `[patch]` Verification-gap: no mutation lines for the audit copy, `cmdUniverse` and the other sub-claims — patched: audit-copy and `cmdUniverse` mutations run and recorded; docs AC noted as text-pinned.
  - `[low]` `[patch]` Blind: launcher `governanceView.ts` types and README, and a `server-base.ts` comment, list the `configSource` values without `dataPolicy` — patched (type unions plus the two lists).
  - `[low]` `[patch]` Blind and Verification-gap: the `WORLD_COVERED` comment says "six" over four keys — patched.
  - `[low]` `[patch]` Blind: the scope test title promised "in the declaration's order" while comparing sorted arrays — patched: title says "the same 11 keys".
  - `[low]` `[reject]` Blind: omitted tools have no stated reason in the "Under `block`" column — the residual reasons are the scope table's Why column and the Design Notes covered-set table; adding per-row text is docs polish beyond the story's minimal-docs bar.
  - `[low]` `[reject]` Blind: `residual()` defaults the verdict to `on` — every residual row is asserted to have a verdict by the test, and the default is the documented behaviour (residual means stays on); not reachable by a user.
  - `[false]` `[reject]` Blind: `iris_test_coverage` is already off by default, so blocking it misattributes — by design (decision #169 D1): it keeps attribution and the warning consistent when an operator enables it; the covered set is the lead's.
  - `[low]` `[reject]` Blind: the warning's lead sentence is printed for a block-only re-enabled group and its tail offers `IRIS_DATA_POLICY=block` — the wording is the lead's #170 text; for a `block` profile the line still names an enabled raw tool and `redact` scope; extra guards for the group label are not worth the complexity.
  - `[low]` `[reject]` Blind: the stock default warns on every dev/interop/data start and cannot be silenced except by `allow` — by design (decision #170 item 2 forbids offering `allow`; D4 one line per server); disabling the named keys silences it.
  - `[low]` `[reject]` Blind: the gate and the warning read the policy by different expressions, and the gate re-derives attribution — both resolve to the same result for every reachable value; the duplication is a style risk only.
  - `[low]` `[reject]` Blind: the changeset's byte-identical claim is broader than the replay — the replay covers the discovery, resource, denial and audit surfaces the spec's AC 45.4.6 names; the claim text matches the spec's own boundary line.
  - `[low]` `[reject]` Blind and Edge: `STORY_45_4_CAPTURE` could re-capture the fixture on a build carrying 45.4 code, and a stale dist skips the replay green — the second half is the roster patch above; the first is a deliberate maintainer switch and the header says so.
  - `[low]` `[reject]` Blind and Edge: malformed `IRIS_DATA_POLICY` or an `IRIS_PROFILES` `dataPolicy` now makes `effective`/`universe` exit 1 — it is the spec's matrix row (CLI: exit 1 with the servers' text).
  - `[low]` `[reject]` Verification-gap: the engine "byte-identical" check for `undefined` compares two identical calls — the same seed is pinned directly by the `dataPolicySeed(key, undefined)` test and by the wire back-compat replay.
  - `[low]` `[reject]` Verification-gap: the wire test reads startup stderr without a readiness wait — the server logs the line before it answers `initialize`, positive legs read the same stream, and the 12-of-16 red mutation shows the line is present when read.
  - `[low]` `[reject]` Verification-gap: the baseline fixture will rot when later stories change the tool surface — the header says how to treat it; a documented update path is not this story's problem.
  - `[low]` `[reject]` Edge: the back-compat stderr filter drops any line containing `Data policy:` — only that warning contains the text.
  - `[low]` `[reject]` Edge: the CLI behaves differently on malformed policy (duplicate of the row above, confidence low).
  - `[false]` `[reject]` Verification-gap: engine test for `undefined` is tautological — see the row above (one root cause, kept separate to match the layers' count).
  - `[false]` `[reject]` Blind: the "11 keys" count is hard-coded in several tests — the test asserts the declaration against `toHaveLength`; the repeated literal is deliberate pinning.
  - `[false]` `[reject]` Blind: `iris_global_list` goes off though it returns names only — decision #169 D2 and the owner floor.
  - `[false]` `[reject]` Blind: `iris_analytics_mdx`, `iris_lookup_*`, `iris_env_diff`, `iris_test_status` stay on — the covered set and residual verdicts are decision #169; the analytics case is a recorded deferred item.
  - `[low]` `[reject]` Intent-alignment observation: `resolveCliDataPolicy` hand-parses `IRIS_PROFILES` — it reuses `parseDataPolicyValue` and `resolveDataPolicy`; descriptive only.
  - `[low]` `[reject]` Intent-alignment observation: `env-promote.ts` has its own `effective()` call without the policy — it evaluates write-family keys, none covered, so it is identical today.
  - `[low]` `[reject]` Intent-alignment observation: a re-enabled `block` group opens with the `redact` sentence — same as the warning-wording row above.
  - `[low]` `[reject]` Intent-alignment observation: hand-maintained `off` verdicts are cross-checked against the built shared dist — by design (Rule #45).
  - `[low]` `[reject]` Intent-alignment observation: other residual raw-read tools are not named in the warning — the covered set is fixed at 11 by decision #169.

## Design Notes

**Planning context.** `epic-45-context.md` predates the 45.2 and 45.3 gate amendments and the spine edits, so it was read with `epics.md` (Story 45.4 L6510-6536) taking precedence, as the lead directed. It was not recompiled. Governing ADs: AD-4, AD-5, AD-6, AD-7, AD-15, AD-19 (audit field), AD-26, AD-31. The ledger inbox (`LEDGER slice 45-4-…`) is empty.

**Probe results (Rules #14, #16, #47; code reading at `baseline_revision`, no IRIS).**
- Today's cascade is `explicit(env.profile, env.global, file.profile, file.global) → inheritedParentDisable → presetSeed → defaultSeed` (`governance.ts` L1271-1287). The new layer fits between the last two steps as AD-6 states. A seeded disable cannot be inherited: `inheritedParentDisable` reads only the parent's explicit layers (L1213-1229).
- `presetApplied` is set only in the gate (`server-base.ts` L1876-1904), when no explicit layer and no inherited parent decided and `presetSeed === false`. The audit copies it (L2438-2441). `configSource` is a separate walk of the same order (L1354-1384), reported by discovery (`server-discovery.ts` L313-375), the resource (L1237) and the CLI (L1068, L1454).
- `dataPolicy` is resolved once at startup per profile into the registry (`applyDataPolicies`, `server-base.ts` L2866): the `IRIS_PROFILES` entry, then `IRIS_DATA_POLICY`, then the file's `dataPolicy.profiles.<name>`, then `.global`, then `redact`, never inherited from `default`. So the gate reads `profile.dataPolicy` after `resolveProfile`.
- Keys and `mutates` (`iris-mcp-governance universe --json` on the current dists, empty env): `iris_sql_query` read/enabled (non-baseline, parent `iris_sql_execute`); `iris_sql_execute`, `iris_execute_command`, `iris_execute_classmethod`, `iris_execute_tests`, `iris_transform_test` and `iris_task_run` are baseline writes, enabled; `iris_global_get` and `iris_global_list` are baseline reads; `iris_test_coverage` is a write, disabled; `iris_docdb_document:get`, `iris_docdb_find`, `iris_lookup_manage:get` and `iris_lookup_transfer:export` are reads, enabled. Every candidate key exists.
- `iris_global_list` returns names only (`global.ts`), and the scope classifies it notApplicable (`data-policy-scope.ts` L126). The owner floor covers it anyway, so its row becomes residual, as SCP J-5 says.

**Covered-set table (the lead's decision at the spec gate; the spec implements the recommended column).**

| Key(s) | Server | Class / default | Verdict | Reason |
|---|---|---|---|---|
| `iris_sql_query`, `iris_sql_execute`, `iris_global_get`, `iris_global_list`, `iris_execute_command`, `iris_execute_classmethod` | dev | see probe | **covered (owner floor, fixed)** | Raw reads of any table or global, or caller code with unrestricted output |
| `iris_execute_tests` | dev | write, enabled | **covered** (recommended) | Runs test-class code and returns its result text |
| `iris_test_coverage` | dev | write, disabled | **covered** (recommended) | Same as above. Only an explicit enable matters, and covering it keeps the attribution and the warning consistent |
| `iris_transform_test` | interop | write, enabled | **covered** (recommended) | Runs a DTL (which may embed `<code>`) on a caller message and returns the output |
| `iris_docdb_document:get`, `iris_docdb_find` | data | read, enabled | **covered** (judgment; recommended) | Raw reads of stored documents. `insert`/`update`/`delete` return IDs or status only |
| `iris_task_run` | ops | write, enabled | residual | Runs an existing task's code and returns only a trigger confirmation; `iris_task_manage:create` takes a class name and no code or settings (`Task.cls` L108-135) |
| `iris_analytics_mdx` | data | read | residual | Axis labels and cells of operator-defined cubes; no DRILLTHROUGH listing (`Analytics.cls` L52-91). See deferred |
| `iris_lookup_manage:get`, `iris_lookup_transfer:export` | interop | read | residual | Integration configuration tables, not arbitrary storage; restrict with their keys |
| `iris_sql_analyze` (5 keys) | dev | read | residual | EXPLAIN of caller SQL (never executed) and statement-index text; no table rows |
| `iris_test_status` | dev | `poll` read | residual | Reads recorded results; runs no code |
| Document-source tools (`iris_doc_get`, `iris_doc_search`, `iris_doc_convert`, `iris_doc_xml_export`, `iris_doc_export`, `iris_doc_edit`, `iris_routine_intermediate`, `iris_macro_info`, `iris_rule_get`) | dev/interop | mixed | residual | Source code, not data stores; turning them off removes development |
| `iris_audit_events`, `iris_audit_manage` | ops/admin | read actions | residual | Administrative audit records |
| `iris_task_list`, `iris_task_history` | ops | read | residual | Status text written by tasks' own code; no caller code |
| `iris_production_messages` | interop | read | residual | Header columns (literal body ID) |
| `iris_env_diff`, `iris_env_promote` | dev | read / plan | residual | Configuration values; `execute` is a disabled write |
| `iris_locks_list` (**Rule #56: missing from the list**) | ops | read | residual (new row; was notApplicable) | Lock references (`FullReference`, `Monitor.cls` L338) carry subscript values, which can be identifiers; a monitoring read, so it stays on |

Rule #56 sweep (as of 2026-11-25; source: the `universe` render of all 110 package tools plus `iris_server_profiles`, read against each handler). Besides `iris_locks_list`, the only raw-read or code-running paths the epic list does not name are write paths: compile/load generators, production start, cube build/sync and task run. They stay on under `block` and are documented as covered only by the read-only preset (see deferred). Also checked and not applicable: `iris_jobs_list` and `iris_process_manage:get` (no global references), `iris_journal_info` (file metadata), and the `*_rest*`/config exports (definitions).

**Decisions for the lead (the spec implements each recommendation).**
- **D1** The covered set: the 11 keys above.
- **D2** Reclassify `iris_locks_list` and `iris_global_list` to residual, add their rows, and move the scope date to 2026-11-25. This updates the 39.2 and 40.1 doc-claims pins, as Story 40.1 did.
- **D3** Attribution: `GOVERNANCE_DISABLED` + `dataPolicyApplied: "block"` + the text suffix, copied into the audit entry. Not `DATA_POLICY_BLOCKED`, because:
  - the remedy is a governance key, which is what `GOVERNANCE_DISABLED` callers already act on;
  - `DATA_POLICY_BLOCKED` is a governed tool's own refusal, audited `error`, with "loosen the policy" as its remedy;
  - reusing it would split one mechanism across two codes and two audit outcomes;
  - discovery already shows these keys `false`.

  The one change under `block` + read-only: a covered key's denial now carries `dataPolicyApplied` instead of `presetApplied`.
- **D4** Warning: one line, `Data policy: these raw-read and code-execution tools are enabled and outside the data policy, so their results are not redacted or withheld: profile "default" (redact): iris_sql_query, iris_global_get; profiles "prod", "stage" (block, re-enabled by an explicit governance key): iris_sql_query. See "PHI data policy" in the README.`
  - Groups are formed by the same policy and the same key list, in registry order.
  - Keys are listed in declaration order.
  - Profile names are written with `JSON.stringify`.
- **D5** CLI parity for `effective` and `universe`, in scope. Without it the CLI renders a different policy than the servers enforce under `block` (AD-6 "Prevents").
- **D6** The docs state that `block` does not cover write paths that run code, and recommend `block` + `IRIS_GOVERNANCE_PRESET=read-only` for a look-don't-touch connection (deferred item 1 goes to the decision sheet).
- **D7** No tool-description change.
- **D8** The changeset is `minor` for all six packages.

**Proposed `epics.md` amendments (Rule #42; the lead applies them).**
- A1 (AC 45.4.4): "and points to the README section" → "and points to the README's "PHI data policy" section (45.5 may point it at "What the safety settings protect" instead)".
- A2 (AC 45.4.2): "`iris_server_profiles` and the governance resource read the same engine (AD-6)." → "`iris_server_profiles`, the governance resource and the `iris-mcp-governance` CLI's `effective` and `universe` renders read the same engine (AD-6)." (if D5 is accepted)
- A3 (AC 45.4.2): "an additive attribution field (for example `dataPolicyApplied: "block"`, as `presetApplied` is)" → "the additive attribution field `dataPolicyApplied: "block"` (as `presetApplied` is; the audit entry copies it)".
- A4 (AC 45.4.1, appended): "Two tools the 2026-10-17 scope classifies as not applicable move to residual: `iris_global_list` (owner floor) and `iris_locks_list` (lock references carry subscript values; it stays on under `block`). The scope's as-of date moves to 2026-11-25." (if D2 is accepted)
- A5 (AC 45.5.4, optional): "the PHI scope table gets a dated column or note for `block`" → "the PHI scope table's "Under `block`" column, added by 45.4, is enriched".

**Proposed spine text (Rule 20; the lead writes it at the gate).**
- AD-6: replace "Story 45.4 records the field names." with "The denial carries `dataPolicyApplied: "block"` and the text suffix ` (data policy 'block')`, and never `presetApplied` when the seed decided. The declaration is `DATA_POLICY_BLOCK_KEYS` in `@iris-mcp/shared`."
- AD-19: add that a denied entry copies `dataPolicyApplied` (additive).
- AD-26: replace "and the further tools Story 45.4's enumeration adds" with "`iris_execute_tests`, `iris_test_coverage`, `iris_transform_test`, `iris_docdb_document:get` and `iris_docdb_find`".

**Docs wording (minimal; 45.5 enriches).**
- README `IRIS_DATA_POLICY` row: append "`block` also turns off the raw-read and code-execution tools (see PHI data policy); an explicit governance key re-enables one. Under `redact` or `block`, a server with such a tool enabled logs one startup `[WARN]` naming it."
- README "PHI data policy": the `block` table row gains that sentence. A new paragraph "**What `block` turns off.**" lists the 11 keys as backticked tokens (the cross-check parses this paragraph), and gives the re-enable example `{"profiles":{"prod":{"iris_sql_query":true}}}`, the `configSource`/`dataPolicyApplied` reporting, the warning, the `redact` scope (message tools only; the raw tools and Event Log text are not covered) and the D6 combination advice.
- README L530: the list of `configSource` values gains `dataPolicy`. README L235 and `packages/shared/README.md` L137: the cascade text includes the seed.
- `tool_support.md`: the scope heading moves to `(as of 2026-11-25)`, with links updated. A column "Under `block`" (`off`, `off (get)`, `on`, `—` for governed rows). The two new rows. A note `> **Story 45.4 (2026-11-25) — governance defaults under block:** …` saying that no key, tool or default under `redact`/`allow` moves, and that each covered key is off under `block` and re-enabled by an explicit governance key.

**Extend, don't copy (Rule 2).**
- `dataPolicySeed` mirrors `presetSeed`: a pure pass-through returning `undefined`, with own-property discipline.
- The declaration follows the `BASELINE_ACTION_CLASSIFICATIONS` pattern: a shared key list, mechanically cross-checked.
- The warning builder follows `unknownProfileWarnings`: it returns text and the caller logs.
- The wire test reuses `process-gate-helpers.ts` and adds no new harness.

**Consumes / Consumed-by.**
- Consumes: the AD-26 resolution (`applyDataPolicies`, Story 39.2), the AD-6 parent keys (Story 38.4), the scope classification (Story 39.2) and the process-gate helpers.
- Consumed-by: Story 45.5. Its doc-rot guard derives the README list from `DATA_POLICY_BLOCK_KEYS` in the shared dist, and capstone point 1 replays the `block` denials, the re-enable and the warning.
- Integration AC: the consumer is the built `iris-dev-mcp` (plus interop and data). It reads the engine's seed through `handleToolCall` and produces the denial with no IRIS request (the wire test above).

**Least-privilege leg for the lead smoke (decision #166).** Run it on a throwaway (`node scripts/throwaway-iris.mjs`, port 52792, `down` afterwards) with an account holding `%Development:U` plus the namespace's database resource, no `%All` and no SQL grants.
- (a) `block`: every covered tool on dev, interop and data returns the same `GOVERNANCE_DISABLED` + `dataPolicyApplied` as under `_SYSTEM`, and IRIS sees no request for those calls. Governance denies before any IRIS privilege matters.
- (b) `redact`: the same tools run with the account's own privileges. `iris_sql_query` on an ungranted table answers `SQLCODE -99` (45.1), `iris_global_get` reads within the granted database, and the warning names the tools.
- (c) `block` + an explicit `iris_sql_query: true` behaves as (b) for that tool only.
- (d) The warning line is identical with IRIS unreachable (a closed port).

## Verification

**Commands:**
- `pnpm build` -- expected: all packages build.
- `pnpm --filter @iris-mcp/shared test` -- expected: green, including the new engine, warning and CLI tests.
- `pnpm --filter @iris-mcp/all test` -- expected: green, including the wire, back-compat and scope tests (run per file if a run nears the 10-minute cap).
- `pnpm type-check && pnpm lint` -- expected: clean.
- `pnpm gen:governance-baseline:check` -- expected: unchanged (`1e62c5ad5bf7`/141).
- `pnpm gen:tools-list-snapshot:check` -- expected: no diff (no description change).
- `git diff --stat -- packages/iris-mcp-all/src/__tests__/fixtures/sdk-*.json packages/iris-mcp-all/src/__tests__/fixtures/tools-list-snapshot.json` -- expected: empty.

**Planned mutations (Rule 19; the implement and QA stages record the actual red):**
- 45.4.1: drop `iris_docdb_find` from `DATA_POLICY_BLOCK_KEYS` → the scope test (column and README equality) goes red.
- 45.4.2: delete the `dataPolicySeed` term in `effective()` → the wire `block` legs go red (Rule #59 path: stdio `tools/call`). Drop the `dataPolicyApplied` spread → the denial deep-equal goes red. Move the seed above `inheritedParentDisable` → the parent-disable `configSource` assertion goes red.
- 45.4.3/45.4.6: make the seed fire under `redact` → the back-compat replay goes red.
- 45.4.4: build the warning from the covered keys without the `effective()`/visibility filter → the "`block` without re-enable has no line" and hidden-tool legs go red.
- 45.4.5 per profile: pass `default`'s policy for every profile in the gate → the per-profile leg goes red.
- D5: drop the policy argument in `cmdEffective` → the CLI `block` test goes red.

**Shared surfaces:** the `GovernanceConfigSource` union; the `configSource`/`policy` maps of `iris_server_profiles` and the governance resource; the CLI `effective`/`universe` output; the audit entry fields; the startup stderr of the dev, interop and data servers; `data-policy-scope.ts` rows and `DATA_POLICY_SCOPE_DATE`; the `tool_support.md` scope heading and anchor; the README `IRIS_DATA_POLICY` row and "PHI data policy" section. Every test added or changed passes on a fresh environment, in either order.

**Manual checks:** the least-privilege leg above (lead smoke); `docker ps -a --filter label=iris-mcp.owner=throwaway` is empty afterwards.

**Implementation results (2026-11-25, closed-port environment, no IRIS):**
- Back-compat fixture: captured BEFORE any code change, from dists rebuilt with `pnpm turbo run build --force` at HEAD (`git diff 8e7aad87..HEAD -- packages src scripts` empty), by the same case runner the replay uses (`story-45-4-back-compat-cases.ts`, capture mode of `story-45-4-back-compat.test.ts`). 54 cases: the all-keys sweep (5 servers x unset/redact/allow x no preset/read-only: `iris_server_profiles` single and `allProfiles`, the `iris-governance://` resource of `default` and `other`) and the dev explicit rows (none, re-enable `iris_sql_query`, enable `iris_sql_execute`, disable `iris_sql_execute` x the three policies x no preset/read-only: five calls with their denials and audit entries, and the `[WARN]` lines). The governance maps are stored as a SHA-256 of the exact view plus a summary (count, disabled keys, source counts, explicit sources). The replay was green on the baseline dists before the change and is green after it.
- Suites: `pnpm --filter @iris-mcp/shared test` 97 files / 2894 tests green; `@iris-mcp/dev` 1578 passed, `@iris-mcp/interop` 754, `@iris-mcp/data` 231, `@iris-mcp/ops` 350, `@iris-mcp/admin` 518. `@iris-mcp/all`: the 38 files that match `rg -l "IRIS_DATA_POLICY|configSource|\[WARN\]"`, and the 30 further files that spawn a built server, all green after the one change named in the Spec Change Log; the full `@iris-mcp/all` suite is left to the caller. `pnpm type-check`, `pnpm lint`, `pnpm gen:governance-baseline:check` (141 keys, all present), `pnpm gen:tools-list-snapshot:check` (115 entries unchanged) and `pnpm gen:ipm:check` are clean; the `sdk-*.json` and `tools-list-snapshot.json` fixtures are untouched.
- Mutations (each applied, shared rebuilt, the named test run, then restored and rebuilt; the path is the stdio `tools/call` on the built servers unless noted):
  - mutation: dropped `iris_docdb_find` from `DATA_POLICY_BLOCK_KEYS` -> `data-policy-scope.test.ts` "the off rows ... are exactly DATA_POLICY_BLOCK_KEYS" and "the README's 'What block turns off' paragraph lists exactly the declared keys" went red.
  - mutation: deleted the `dataPolicySeed` term in `effective()` -> `story-45-4-block-seed-wire.test.ts` 10 of 16 tests red (every `block` denial leg, the re-enable, parent-enable, `IRIS_TOOLS_ENABLE`, call-arguments, read-only and per-profile legs).
  - mutation: dropped the `dataPolicyApplied` spread from the denial -> wire tests red (8 of 16: the dev and interop/data denial deep-equals, re-enable, `IRIS_TOOLS_ENABLE`, call-arguments, parent-enable, read-only and per-profile legs).
  - mutation: moved the `dataPolicy` check above the `parent` check in `configSource()` -> wire "a parent disable is inherited and keeps its own attribution" and the unit "an explicit parent disable is inherited and keeps parent attribution, ahead of the seed" red.
  - mutation: made `dataPolicySeed` fire under `redact` too -> `story-45-4-back-compat.test.ts` "every case replays to the baseline" red (36 cases differ) and 7 of 36 unit tests in `governance-data-policy-seed.test.ts` red.
  - mutation: built the warning with `isCallable` always true (no `effective()` / visibility filter) -> wire tests red (12 of 16: the default dev/interop/data lines, "`block` without re-enable has no line", the hidden-tool and `IRIS_GOVERNANCE false` legs, the grouping row).
  - mutation: passed `default`'s policy for every profile at the gate -> wire "the policy is per profile: prod (block) is denied, default (redact) runs" red.
  - mutation: dropped the policy argument from `effective()` in `cmdEffective` -> `governance-cli.test.ts` (3 tests: the covered keys under `IRIS_DATA_POLICY=block`, the text render, the shared-engine single-sourcing proof) red (unit path: `runCli`, not the built bin).
  - mutation (review pass): passed `undefined` instead of `dataPolicy` to `getEffectivePolicy` and `getEffectiveConfigSources` in `cmdUniverse` -> `governance-cli-universe.test.ts` 5 of 29 tests red (restored).
  - mutation (review pass): disabled the audit copy of `dataPolicyApplied` in `handleToolCall` (`&& false`, shared rebuilt) -> `story-45-4-block-seed-wire.test.ts` 2 of 16 red (the dev audit leg and the `block`+read-only audit leg); restored and rebuilt.
  - mutation (code review, #172): dropped `iris_docdb_document:delete` from `DATA_POLICY_BLOCK_KEYS` (shared rebuilt) -> 9 red: the wire DW-782 leg ("under block the docdb delete action is denied before IRIS"), the data default line, the interop/data denial leg, the declaration-equals-wire-cases test, the non-default-profile and `IRIS_TOOLS_ENABLE` legs, the data re-enable scenario, and the scope test's off-rows and README-list checks; `story-45-4-back-compat.test.ts` stayed green (the `redact`/`allow` sweep is unchanged). Restored, `cmp` identical.
  - mutation (code review, warning wording): forced the `redact` lead sentence for every line (`!hasBlock || true`) -> `data-policy-warning.test.ts` 5 of 22 red and the wire test 13 of 38 red (every `block`-only and mixed line). Restored, `cmp` identical.
  - mutation (code review, warning source): the server passed no `configSource` to the builder (`undefined && configSource(...)` in `dataPolicyStartupWarning`, confirmed in the built dist) -> wire 13 of 38 red. Restored, `cmp` identical.
  - mutation (code review): removed `!dataPolicyCaused &&` from `presetCaused` -> wire "a covered key carries dataPolicyApplied, a non-covered write keeps presetApplied" red (the `iris_sql_execute` deep-equal gained `presetApplied`). Restored, `cmp` identical.
  - mutation (code review): passed `undefined` for the preset in the warning's `effective()` -> wire "the line follows the preset and the parent keys" red at the read-only leg; passed an empty parent-key map instead -> the same test red at the parent leg (line 531). Restored, `cmp` identical.
  - AC 45.4.7 (docs) is pinned by source-text tests (`story-45-4-doc-claims.test.ts`, the scope test's README and `tool_support.md` equality) and cannot be mutation-verified beyond a text change; the remaining sub-claims (resource and single-profile discovery threading, the `presetCaused` guard) are covered by wire assertions without a recorded mutation of their own.
- Left for the lead smoke: the least-privilege legs on a throwaway IRIS (the wire legs prove the denial sends zero requests to a local listener and that a passing call reaches it, but no IRIS privilege was exercised).

## Auto Run Result

Status: done
Blocking condition: none.

**Summary.** `IRIS_DATA_POLICY=block` now seeds the 11 raw-read and code-execution keys (`DATA_POLICY_BLOCK_KEYS`) disabled through a new `dataPolicySeed` layer of the AD-6 cascade (below `inheritedDisable`, above the preset). A denial is `GOVERNANCE_DISABLED` with `dataPolicyApplied: "block"` and the ` (data policy 'block')` suffix, copied into the audit entry; `configSource` is `"dataPolicy"`. An explicit `true` re-enables a key; `IRIS_TOOLS_ENABLE` and a call's own arguments never do. Each server writes at most one grouped startup `[WARN]` line. The CLI `effective` and `universe` apply the same seed. Under `redact`, `allow` and unset, everything is byte-identical to `8e7aad87` except that warning line.

**Warning text** (prefixed by `[WARN] `): `Data policy: "redact" covers message bodies only, so these raw-read and code-execution tools are enabled and their results are not redacted or withheld: profile "default" (redact): <keys>. To turn tools off, set their governance keys to false (IRIS_GOVERNANCE or IRIS_GOVERNANCE_FILE) or set IRIS_DATA_POLICY=block. See "PHI data policy" in the README.` A `block` profile with a re-enabled key is labelled `(block, re-enabled by an explicit governance key)`.

**Files changed.**
- Engine: `packages/shared/src/{data-policy,governance,server-base,server-discovery,audit,index}.ts`, `packages/shared/src/cli/governance.ts`.
- New tests: `packages/shared/src/__tests__/{governance-data-policy-seed,data-policy-warning}.test.ts`; `packages/iris-mcp-all/src/__tests__/story-45-4-{block-seed-wire,back-compat,doc-claims}.test.ts`, `story-45-4-back-compat-cases.ts` and `fixtures/story-45-4-back-compat-baseline.json` (captured from the baseline build before any code change).
- Changed tests: see the Spec Change Log entry of the review pass.
- Docs: `README.md`, `tool_support.md`, `packages/shared/README.md`, the dev, interop and data server READMEs, `extensions/iris-mcp-launcher` (type and README), `CHANGELOG.md`, `.changeset/story-45-4-block-turns-off-raw-read-and-code-execution-tools.md` (`minor`, six packages).
- Gate roster: `packages/iris-mcp-all/scripts/prepublish-gate.mjs`.

**Review findings.** 29 findings, triaged in the Review Triage Log. Patched: 1 high (the two new armed test files were missing from `gateTestFiles`, so `live-gate-roster.test.ts` was red), 2 medium (the false docdb "IDs or status only" claim; missing mutation lines), 3 low (launcher `dataPolicy` source, a stale comment, a test title). Deferred: 1 new item (`iris_docdb_document:delete` returns the deleted document and stays on under `block`; the lead's call on the covered set). Rejected: 22 (every reason is in the log). Planned deferred item 1 (code-running write tools) carries the note that the Planner closed it (#170).

**Verification.**
- `pnpm --filter @iris-mcp/shared test`: 97 files, 2894 tests green. `@iris-mcp/all` full run in the closed-port env: 251 files, 6641 passed, 755 skipped (live-gated), 0 failed. Package suites during implement: dev 1578, interop 754, data 231, ops 350, admin 518. Launcher: 610 passed, 3 skipped.
- `type-check`, `lint`, `pnpm check:live-guards` (78 armed files, 0 findings), `gen:governance-baseline:check` (unchanged), `gen:ipm:check`, `gen:tools-list-snapshot:check` (115 entries unchanged) and `node scripts/check-epics-sync.mjs` are clean. No golden JSON and no `.cls` file changed.
- Ten mutations went red and were restored (see `## Verification`).

**Residual risks.**
- `followup_review_recommended: true`: the one patched high changes the prepublish roster, and it was verified by the roster test only. The prepublish gate itself runs against a live IRIS and was not run here.
- The least-privilege legs (decision #166) are left for the lead's smoke; no IRIS privilege was exercised.
- The `iris_docdb_document:delete` item above, and the closed code-running-writes item.
