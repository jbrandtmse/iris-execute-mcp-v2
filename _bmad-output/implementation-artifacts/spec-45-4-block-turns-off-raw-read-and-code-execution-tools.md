---
title: 'Story 45.4: Block Turns Off Raw-Read and Code-Execution Tools'
type: 'feature'
created: '2026-11-25'
status: 'ready-for-dev'
baseline_revision: '8e7aad87e8798730a3fd3a659519c6111bbcde9f'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-45-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-iris-execute-mcp-v2-2026-10-14/ARCHITECTURE-SPINE.md'
warnings: ['oversized']
deferred:
  - summary: >-
      Under `block` alone (no read-only preset), write tools that can run code stay on: compiling or loading a class runs its generators (`iris_doc_put`/`iris_doc_load`/`iris_doc_compile`/`iris_doc_edit:apply`/`iris_doc_xml_export:import`), and starting a production, building a cube or running a task runs existing code. A generator can put data into the compile output.
    evidence: |-
      Plan, Rule #56 sweep (2026-11-25): these keys are writes the read-only preset already turns off (SCP J-5 lists the compile/load writes as residual). This story documents the combination `block` + `IRIS_GOVERNANCE_PRESET=read-only`; whether `block` should also seed these writes off is an owner product call for the epic-close decision sheet.
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

  **Least-privilege leg (decision #166):** the lead smoke runs one under `block` and one under `redact`. `iris_production_logs` is already governed under `block` (Story 39.7) and is not in the set.

## Review Triage Log

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

## Auto Run Result

Status: ready-for-dev
Blocking condition: none. Halted after planning, as instructed. Lead decisions D1-D8, amendments A1-A5 and the spine text are listed under Design Notes for the spec gate; the spec implements each recommendation, so it is complete as written.
