# Story 27.3: `promote:execute` + Gates

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an operator who has reviewed an `iris_env_promote:plan`,
I want to EXECUTE only an explicit allowlist of its steps against the target — behind confirm + fresh-plan + target-governance gates, halt-on-first-error, promoting source's live state — and NEVER delete anything,
so that I can safely apply reviewed cross-environment drift with the strictest write discipline in the suite.

This is Story 4 of Epic 27. It implements the **`execute`** action of `iris_env_promote` (the default-disabled WRITE). **TS-only — no ObjectScript / bootstrap change** (all write endpoints already exist). It touches `@iris-mcp/shared` (small ADDITIVE barrel-export additions for the target-governance gate) + `@iris-mcp/dev` (`env-promote.ts` execute body + exporting `env-diff.ts`'s fetch helpers).

## Acceptance Criteria

1. **AC 27.3.1** — `execute` runs ONLY the allowlisted `steps` indices in plan order, halt-on-first-error, per-step completed/failed/skipped statuses; implementation calls the SAME HTTP endpoints the existing tools use.
2. **AC 27.3.2** — Refusals, each mutating nothing: missing `confirm:true`; missing/empty `steps` allowlist; plan-hash mismatch vs. supplied diff (stale plan); target profile's governance disabling the underlying write families (refusal names the blocking key).
3. **AC 27.3.3** — Governance: `execute` default-disabled under empty `IRIS_GOVERNANCE` (real-gate unit test); `plan` and `iris_env_diff` read/enabled.

### Integration note (lead-side gate)

`execute` is the CONSUMER of Story 27.2's `plan` output (validates `plan.planHash` via `computePlanHash`, runs `plan.steps`). This is the wire-up story for the promote producer/consumer pair; its ACs (gate refusals + per-step execution) are the integration proof. **The live end-to-end execute smoke requires enabling `iris_env_promote:execute` in `IRIS_GOVERNANCE` + reloading the MCP server — a human-in-the-loop step the lead surfaces at the smoke gate (do NOT assume it can be smoked silently).**

## Tasks / Subtasks

- [x] **Task 1 — Framework barrel exports for the target-governance gate (`@iris-mcp/shared`; ADDITIVE, Rule #19)**
  - [x] Add to `packages/shared/src/index.ts`'s export list (they exist in `governance.ts`/`baseline-classifications.ts` but aren't re-exported): `parseGovernancePreset`, the `GovernancePreset` type, and `BASELINE_ACTION_CLASSIFICATIONS`. Purely additive — adding exports changes NO existing behavior (Rule #19; the back-compat snapshot / existing tests must stay green). `effective`/`getEffectivePolicy` are ALREADY exported and already accept `preset`/`classifications` params, so no engine change is needed. **Rationale:** without the preset, the target-governance gate cascade (`effective()`: `profile.explicit ?? global.explicit ?? presetSeed ?? defaultSeed`) skips `presetSeed` and falls to `defaultSeed` = enabled — so it would be BLIND to a target locked by `IRIS_GOVERNANCE_PRESET=read-only`. (Defense-in-depth: a read-only preset also disables the CALLING profile's `execute`, catching it at the call-time gate — but the target gate must be correct on its own.)
  - [x] Confirm the shared `package.json` `exports` map already surfaces the barrel (`"."`) — deep imports are blocked, so the barrel is the only path. Do NOT widen the `exports` map.

- [x] **Task 2 — Export `env-diff.ts` source-fetch helpers (`@iris-mcp/dev`; the plan is a SPEC, not the data)**
  - [x] **CRITICAL (Rule #47):** the `plan.steps` do NOT carry write data (mappings/webapps steps have no values; SDS/config values are free-text in `detail`, and credential SDS values are `[REDACTED]`; documents carry only a truncated hash). So `execute` MUST re-fetch the AUTHORITATIVE current value from the SOURCE profile at execute time (spec §4: "doc get from source → doc put to target"). Export from `packages/iris-dev-mcp/src/tools/env-diff.ts` (add `export`): `fetchMappings`, `fetchDefaultSettings`, `fetchWebapps`, `fetchConfig`, `fetchDocHashes` + the entry TYPES they return (`MappingEntry`/`SdsEntry`/`WebAppEntry`/config props/doc-hash shape) so `execute` reuses the EXACT source-read logic `iris_env_diff` uses (do NOT duplicate — export + import). For documents, also reuse the doc-content GET (`packages/iris-dev-mcp/src/tools/doc.ts` `docGet` Atelier `GET /doc/{name}` pattern) since `fetchDocHashes` returns hashes, not content.
  - [x] These exports are additive (no behavior change to `iris_env_diff`); its tests stay green.

- [x] **Task 3 — `execute` GATES (refuse-before-any-write; AC 27.3.2)** in `packages/iris-dev-mcp/src/tools/env-promote.ts` (replace the "ships in 27.3" stub):
  - [x] **Gate 1 — `confirm:true` required.** Missing/false → refuse, mutate nothing. (The governance-default-disable is the outer gate; `confirm` is the inner intent gate — Epic 20 double-gate pattern.)
  - [x] **Gate 2 — `steps` allowlist required + non-empty.** `steps` is a `number[]` of plan step indices to run. Missing/empty → refuse. Also reject indices not present in `plan.steps` (out-of-range) with a clear error.
  - [x] **Gate 3 — plan-hash freshness (stale-plan protection).** Re-hash the caller-supplied `diff` (REQUIRED for `execute` too) via the exported `computePlanHash(diff)` and compare to the supplied `plan.planHash`. Mismatch → refuse "stale plan — regenerate the plan from the current diff". (This binds the plan to the diff it was generated from.)
  - [x] **Gate 4 — TARGET-PROFILE governance gate.** For each write-family key USED by the allowlisted steps' domains, evaluate whether the TARGET profile's effective policy enables it; if any is disabled, REFUSE naming the blocking key (e.g. "target profile 'prod' governance disables iris_config_manage:set"). Mechanism:
    - Build a local write-family classification `Map`: the 5 baseline write keys (`iris_doc_put`, `iris_doc_compile`, `iris_mapping_manage:create`, `iris_webapp_manage:modify`, `iris_config_manage:set`) + the ONE post-foundation key `iris_default_settings_manage:set` → `"write"` (this key is NOT in `GOVERNANCE_BASELINE`, so `defaultSeed`'s baseline short-circuit doesn't classify it — the local map supplies it; mirror the real classification at `packages/iris-interop-mcp/src/tools/defaultSettings.ts` `mutates.set:"write"`). For an `updateMapping` step, check BOTH `iris_mapping_manage:delete` AND `:create` (it does delete+create).
    - Parse the governance config + preset from env (`parseGovernanceConfig()` + `parseGovernancePreset()` — pure `process.env` reads reproducing exactly what `McpServerBase.start()` parsed for this same process).
    - For each USED key, call `effective(key, targetProfileName, config, localMutatesLookup, GOVERNANCE_BASELINE, new Set() /* no defaultEnabledWrites */, preset, BASELINE_ACTION_CLASSIFICATIONS)` (mirrors `computeServerDiscovery`/`server-discovery.ts` per-profile evaluation, scoped to the write-family keys for the `target` profile). Disabled → refuse. This is the moat's "server:stage can't write to a governance-locked prod target" protection.
    - Only check keys for domains ACTUALLY in the allowlisted steps (don't refuse on a config-write disable if no config step is allowlisted).

- [x] **Task 4 — `execute` per-step write dispatch (AC 27.3.1)**
  - [x] Resolve BOTH clients: `sourceClient = ctx.resolveProfileClient(source)` (for source value re-fetch), `targetClient = ctx.resolveProfileClient(target)` (for writes). Resolve each profile's namespace (the Story-27.0 `client.namespace` pattern) for the per-profile write calls.
  - [x] Walk `plan.steps` FILTERED to the `steps` allowlist, IN PLAN ORDER (the plan is already ordered mappings→documents→defaultSettings→webapps→config). For each step, dispatch by `domain`+`operation`, re-fetching the source value and calling the SAME write endpoint the existing tool uses on the TARGET client (base `/api/executemcp/v2`; the routes live on the shared webapp — call the ROUTE directly, do NOT import another package's tool):
    - **mappings `createMapping`**: parse `subject` = `type::namespace::name`; re-fetch the source mapping (from `fetchMappings(sourceClient, srcNs)`) to get `database`/`collation`/`lockDatabase`; `POST /config/mapping/{type}` `{action:"create", namespace:<targetNs>, name, database, collation?, lockDatabase?, force?}`. `updateMapping`: `POST .../{type} {action:"delete", namespace, name}` THEN the create (mapping has no update — Config.cls; the admin tool documents delete+create).
    - **documents `putAndCompile`**: `subject` = doc name; `GET /doc/{name}` (Atelier UDL) from the SOURCE client → `PUT /doc/{name}?ignoreConflict=1` `{enc:false, content:string[]}` to the TARGET client; BATCH the compile — after putting all allowlisted docs, ONE `POST /action/compile?flags=cuk` with the array of doc names (mirror `load.ts:286,309`).
    - **defaultSettings `setDefaultSetting`**: parse `subject` = `prod||item||host||setting` (reject a slot containing `||` — Rule #29); re-fetch the source SDS value (`fetchDefaultSettings(sourceClient, srcNs)`); `POST /interop/defaultsettings {action:"set", namespace:<targetNs>, production, item, hostClass, setting, value, description?, deployable?}`. **A credential-classified setting's value is re-fetched LIVE from source and written to target — it is never rendered into any output (the plan's `[REDACTED]` never carried it; the write path fetches + forwards without logging the value).**
    - **webapps `modifyWebApp`**: `subject` = webapp name; re-fetch the source webapp curated subset (`fetchWebapps(sourceClient)`); `POST /security/webapp {action:"modify", name, dispatchClass?, enabled?, authEnabled?, isNameSpaceDefault?, cspZenEnabled?, recurse?, matchRoles?, namespace?}` (the curated subset from 27.1; do NOT push `cookiePath`/instance-specific paths).
    - **config `setConfig`**: `subject` = property key; re-fetch source config (`fetchConfig(sourceClient)`); `POST /system/config {action:"set", section:"config", properties:{<key>:<value>}}` (properties is a MAP).
  - [x] **Halt-on-first-error (AC 27.3.1):** run steps in order; on the FIRST step that fails (endpoint error), STOP — mark that step `failed`, mark every subsequent allowlisted step `skipped`, mark preceding ones `completed`. Return a per-step status list `[{index, domain, operation, subject, status:"completed"|"failed"|"skipped", error?}]`. Overall `isError:true` if any step failed (partial-apply is reported, not hidden).
  - [x] **No deletions**: the plan has no delete steps (type-enforced in 27.2); execute never issues a delete EXCEPT the intra-`updateMapping` delete+create pair (which is a REPLACE of an existing mapping the source has, not a removal of a target-only item). Confirm execute never deletes a target-only (`onlyInTarget`/warning) item.
  - [x] Output `structuredContent`: `{source, target, planHash, executed:[{index,domain,operation,subject,status,error?}], summary:{completed,failed,skipped}}`. `content[].text`: a readable per-step result + summary; never render a credential value.

- [x] **Task 5 — Tests (DEFAULT vitest suite; AC 27.3.1/27.3.2/27.3.3)**
  - [x] `packages/iris-dev-mcp/src/__tests__/env-promote-execute.test.ts` (mocked HTTP): **all four refusals, each asserting ZERO write calls** — (a) missing `confirm`; (b) missing/empty `steps`; (c) plan-hash mismatch (supply a `diff` whose hash ≠ `plan.planHash`); (d) target-profile governance disables a used write key (set `IRIS_GOVERNANCE` `profiles.<target>.<key>:false`, assert refusal names the key + no write). **Per-step execution:** allowlist a subset → only those steps' endpoints called, in plan order; a mid-list step failure → that step `failed`, later `skipped`, earlier `completed`, `isError:true`, and NO further writes after the failure (halt-on-first-error, assert call count). **Source re-fetch:** a mapping/SDS/config step re-fetches the SOURCE value and writes it to TARGET (assert the write body carries the source value, and the write goes to the target client/host). **Redaction:** a credential SDS step writes the live source value to target WITHOUT the plaintext appearing in the tool OUTPUT. Also added: `updateMapping` delete+create pair proof, and the batched `documents` put+compile path (success, put-failure, compile-failure) — 20 tests total.
  - [x] `env-promote-governance.test.ts` (extend): `execute` DENIED under empty `IRIS_GOVERNANCE` (call-time gate — the default-disable); enabled only with explicit `iris_env_promote:execute:true`. **Already fully covered** by the existing Story 27.2 suite (5 tests, unchanged) — the gate is evaluated purely by `McpServerBase.handleToolCall`'s OUTER governance check against a spied handler, which is agnostic to whether `execute`'s real body is a stub or fully implemented; no extension was needed. Verified all 5 tests still pass against the real (non-stub) handler.
  - [x] Back-compat: adding the shared barrel exports + the env-diff fetcher exports changes no existing behavior — full suite green, `iris_env_diff` tests unchanged (all 19+28+3+5 = 55 `env-diff*` tests still pass).
  - [x] Do NOT name any must-run test `*.integration.test.ts` (Rule #21). Confirmed — `env-promote-execute.test.ts` is a plain `*.test.ts`.
  - [x] **Pre-existing stub-behavior tests updated** (not originally scoped as a task line, but required for a green suite once the stub was replaced): `env-promote.test.ts`'s "(g) execute stub" section and `env-promote-qa.test.ts`'s "zero IRIS/HTTP calls" test both asserted the literal "Story 27.3" stub-refusal text; both were repurposed to assert a REAL gate refusal ('plan' required / stale-plan Gate 3) instead, preserving their original "zero HTTP calls" proof.

- [x] **Task 6 — Docs (light) + DoD**
  - [x] Update the `iris_env_promote` tool DESCRIPTION: `execute` semantics, the 4 gates, halt-on-first-error, no-deletions, default-disabled. Full rollup is 27.4. Also updated every field-level `.describe()` (`action`/`source`/`target`/`diff`/`plan`/`steps`/`confirm`/`namespace`) that previously said "Story 27.3, not yet implemented".
  - [x] `pnpm turbo run build` + `pnpm turbo run test` green (report shared+dev deltas). NO ObjectScript/bootstrap change: `BOOTSTRAP_VERSION` stays `1e2008753853`; `gen:governance-baseline:check` exit 0 (frozen baseline `1e62c5ad5bf7` git-clean; no NEW governance key — `iris_env_promote:plan`/`:execute` already exist from 27.2; the write-family keys checked are pre-existing); `iris_env_promote:execute` stays `write`/default-disabled.

## Dev Notes

### The plan is a spec; execute re-fetches source LIVE (Rule #47 — verified)

`plan.steps` carry NO write data (recon-confirmed: mappings/webapps steps = prose only; SDS/config values are free-text `detail`; credential SDS = `[REDACTED]`; documents = truncated hash). `execute` MUST re-fetch the authoritative current value from the SOURCE profile at execute time, exactly as spec §4 says ("doc get from source → doc put to target"). Reuse `env-diff.ts`'s fetchers (export them) + `doc.ts`'s doc-content GET. TOCTOU on source content is inherent + acceptable (you promote source's CURRENT state); the plan-hash gate protects the PLAN/allowlist binding, not source content.

### Write endpoints (verified against source — all exist, TS-only)

| Domain | Route (base `/api/executemcp/v2`) | Body (create/set/modify) |
|---|---|---|
| mappings | `POST /config/mapping/{type}` (`Config.cls:563`; NO update — delete+create) | `{action:"create", namespace, name, database(req), collation?, lockDatabase?, force?}` |
| documents | Atelier `GET /doc/{name}` (source) → `PUT /doc/{name}?ignoreConflict=1` (target) → `POST /action/compile?flags=cuk` (batched) | PUT `{enc:false, content:string[]}`; compile body = `string[]` of names |
| defaultSettings | `POST /interop/defaultsettings` (`Interop.cls:2317`) | `{action:"set", namespace, production, item, hostClass, setting, value(req), description?, deployable?}` |
| webapps | `POST /security/webapp` (`Security.cls:1229`) | `{action:"modify", name, dispatchClass?, enabled?, authEnabled?, isNameSpaceDefault?, cspZenEnabled?, recurse?, matchRoles?, namespace?}` |
| config | `POST /system/config` (`SystemConfig.cls:26`) | `{action:"set", section:"config", properties:{key:value}}` (MAP) |

Reference TS callers (request-shape only — call the ROUTES directly via the target client, do NOT cross-import): `iris_mapping_manage` (`packages/iris-admin-mcp/src/tools/mapping.ts:108`), `iris_default_settings_manage` set (`iris-interop-mcp/.../defaultSettings.ts:164`), `iris_webapp_manage` (`iris-admin-mcp/.../webapp.ts:124`), `iris_config_manage` set (`iris-ops-mcp/.../config.ts:62`), doc get/put/compile (`iris-dev-mcp/.../doc.ts:50,166` + `compile.ts:41`, batched per `load.ts:286,309`).

### Target-profile governance gate (verified — the load-bearing security gate)

`ToolContext` exposes NO governance (verified `tool-types.ts:196-253`). The tool evaluates the target's effective policy itself using the (newly-exported) barrel functions: `parseGovernanceConfig()` + `parseGovernancePreset()` (pure env reads) → `effective(key, target, config, localMutatesLookup, GOVERNANCE_BASELINE, new Set(), preset, BASELINE_ACTION_CLASSIFICATIONS)` per USED write-family key. This mirrors `computeServerDiscovery` (`server-discovery.ts:160-232`) scoped to the write keys + the `target` profile. `iris_default_settings_manage:set` is post-foundation → supply its `"write"` class in the local `mutatesLookup` (the dev server's own lookup lacks interop keys). Keys: `iris_doc_put`, `iris_doc_compile`, `iris_mapping_manage:create` (+`:delete` for update), `iris_default_settings_manage:set`, `iris_webapp_manage:modify`, `iris_config_manage:set` — all confirmed key strings.

### Gates (spec §4, AC 27.3.2) — refuse-before-write, mutate-nothing

confirm:true (inner intent gate) · steps allowlist required+non-empty+in-range · plan-hash matches `computePlanHash(diff)` (stale-plan) · target-profile governance enables every used write family. All four are live-smoke rejection assertions (Rule #26) — each changes NOTHING.

### Governance (Rules #28/#32)

No NEW governance key — `iris_env_promote:{plan,execute}` already exist (27.2). `execute` stays `write`/default-disabled (NO `defaultEnabled`). Frozen baseline `1e62c5ad5bf7` untouched (the write-family keys checked are pre-existing baseline/post-foundation keys, not new). `gen:governance-baseline:check` exit 0.

### Live smoke needs a human reload (context — surface at the smoke gate)

The live execute smoke (a REAL promotion to a disposable target) requires enabling `iris_env_promote:execute` in `IRIS_GOVERNANCE` + reloading the MCP server (the same enable+reload dance as Epic 26's resend). The LEAD surfaces this as a pause when reaching the smoke; the 4 rejection smokes (which change nothing) can run BEFORE the enable. The one-instance shape means "promote HSCUSTOM→SADEMO" writes to SADEMO (a demo namespace) — use a disposable/reversible target (e.g. a scratch mapping or config property) and clean up.

### References

- [Source: research/feature-specs/05-env-diff-promotion.md#4] execute + gates; #5 story 4; #6 AC 5/7.
- [Source: epics.md#Story-27.3] AC 27.3.1–27.3.3.
- [Source: packages/iris-dev-mcp/src/tools/env-promote.ts] execute stub `:584`, `computePlanHash` export `:401`, `PlanStep`/`PlanOperation` `:67-90`, `PLAN_DOMAIN_ORDER` `:57`, subject encodings `:170-196`.
- [Source: packages/shared/src/index.ts:66-90] current barrel exports (add 3); [governance.ts] `effective`/`getEffectivePolicy`/`parseGovernancePreset`; [server-discovery.ts:160-232] per-profile effective-policy pattern to mirror.
- [Source: packages/iris-dev-mcp/src/tools/env-diff.ts] fetchers to export; [doc.ts:50,166], [compile.ts:41], [load.ts:286,309] doc get/put/compile chain.
- [Source: src/ExecuteMCPv2/REST/{Config,Interop,Security,SystemConfig}.cls] write handlers.
- [Source: .claude/rules/project-rules.md] Rules #19/#26/#28/#29/#32/#47.

## Dev Agent Record

### Agent Model Used

claude-sonnet-5

### Debug Log References

None — no debug globals or scratch classes needed (TS-only story, no IRIS connection required for any test; all gate/dispatch logic verified via mocked-HTTP unit tests).

### Completion Notes List

- **Task 1/2 (barrel + fetcher exports):** Added `parseGovernancePreset`, `GovernancePreset` (type), `BASELINE_ACTION_CLASSIFICATIONS` to `packages/shared/src/index.ts`'s barrel. Confirmed the `package.json` `exports` map already surfaces `"."` — not widened. Added `export` to `fetchMappings`/`fetchDefaultSettings`/`fetchWebapps`/`fetchConfig`/`fetchDocHashes` and their entry-type interfaces (`MappingEntry`/`SdsEntry`/`WebAppEntry`/`ConfigProperties`/`DocHashEntry`) in `env-diff.ts`. Both changes are purely additive; `iris_env_diff`'s own 55 tests (`env-diff*.test.ts`) are unchanged and still green.
- **Task 3/4 (gates + dispatch):** Replaced the "ships in Story 27.3" stub with a full `executeAction()` implementation. All 4 gates run BEFORE any profile client is resolved (verified: `ctx.resolveProfileClient` is asserted `not.toHaveBeenCalled()` in every gate-refusal test) — a gate failure costs zero network round-trips. Gate 4 evaluates governance via a LOCAL write-family `MutatesLookup` map (`iris_doc_put`/`iris_doc_compile`/`iris_mapping_manage:create`/`iris_webapp_manage:modify`/`iris_config_manage:set` — all 5 already frozen-baseline members — plus the ONE post-foundation key `iris_default_settings_manage:set`), calling the shared `effective()` engine exactly as `server-base.ts`'s own gate does. Per-step dispatch walks the allowlisted, plan-ordered steps with halt-on-first-error; `documents` steps are special-cased into a batched put-then-compile-once run (`runDocumentsBatch`) since compile must be ONE call per Dev Notes, with atelier version negotiated lazily (only when a `putAndCompile` step is actually allowlisted) via the already-exported `negotiateVersion`.
- **Design decision (documented in code):** for a `documents` batch, a doc whose PUT succeeded but never reached compile (either because a SIBLING put failed first, or because it appears after the first COMPILE failure in the same batch) is reported `"skipped"`, not `"completed"` — its write is incomplete without compilation, so `"skipped"` is the honest status even though the raw source was technically written to target.
- **Namespace resolution:** mirrors `env-diff.ts`'s established pattern exactly — an optional `namespace` override (trimmed; blank/whitespace-only falls back) applies to BOTH `source` and `target` resolution identically; omitted, each side uses its own resolved profile's `client.namespace`. Mapping/SDS subjects' embedded diff-time namespace segment is deliberately DISCARDED at execute time in favor of the fresh `srcNs`/`targetNs` (regression-tested explicitly — see "uses the FRESH execute-time source namespace" test).
- **Task 5 (tests):** New `env-promote-execute.test.ts` (20 tests) covers all 4 gate refusals + a governance-scoping proof + an explicit-enable proof, per-step execution (subset allowlist + halt-on-first-error), source re-fetch (mapping + config), the namespace-discard regression, credential redaction, `updateMapping` delete+create, and the 3 `documents` batch scenarios (all-succeed, put-failure, compile-failure). `env-promote-governance.test.ts` needed NO changes — its 5 tests exercise the OUTER `McpServerBase` governance gate against a spied handler (agnostic to whether the real handler is a stub or fully implemented) and were already fully compliant with the story's Task 5 ask; re-verified green against the real handler. Two PRE-EXISTING tests that asserted the now-removed stub's literal "Story 27.3" refusal text were updated to assert a REAL gate refusal instead (`env-promote.test.ts` "(g)"; `env-promote-qa.test.ts`'s "zero IRIS/HTTP calls" test, now proving Gate 3 stale-plan refusal specifically), preserving their original zero-HTTP-calls proof.
- **Task 6 (docs + DoD):** Rewrote the tool's `description` field (execute semantics, 4 gates, halt-on-first-error, no-deletions, default-disabled) and every field-level `.describe()` that said "not yet implemented". Full verification: `pnpm turbo run build` 6/6 green; `pnpm turbo run test` 13/13 tasks green, 2,468 tests total (shared 705, dev 491 [+20 net vs the pre-story 471], admin 443, ops 340, interop 323, all 42, data 124) — zero regressions; `pnpm turbo run lint`/`type-check` clean across all 7 packages. `BOOTSTRAP_VERSION` confirmed UNCHANGED (`1e2008753853`) — no ObjectScript touched. `gen:governance-baseline:check` exit 0 (141 frozen / 200 live / 59 post-foundation — unchanged from post-27.2, since NO new governance key was added this story); `git status` confirms `governance-baseline.ts` and `baseline-classifications.ts` are untouched (git-clean).
- **Live execute smoke NOT run by this dev session** — per the story's own Integration Note, it requires enabling `iris_env_promote:execute` in `IRIS_GOVERNANCE` + reloading the MCP server, a human-in-the-loop step the lead surfaces at the smoke gate. The 4 rejection-gate proofs (which mutate nothing) are fully covered by the mocked-HTTP unit suite above and require no live IRIS.

### File List

- `packages/shared/src/index.ts` (modified — additive barrel exports: `parseGovernancePreset`, `GovernancePreset` type, `BASELINE_ACTION_CLASSIFICATIONS`)
- `packages/iris-dev-mcp/src/tools/env-diff.ts` (modified — added `export` to 5 fetch helpers + their entry-type interfaces; no behavior change)
- `packages/iris-dev-mcp/src/tools/env-promote.ts` (modified — replaced the `execute` stub with the full gates + per-step dispatch implementation; updated tool description + field descriptions)
- `packages/iris-dev-mcp/src/__tests__/env-promote-execute.test.ts` (new — 20 tests, the dedicated Story 27.3 `execute` suite)
- `packages/iris-dev-mcp/src/__tests__/env-promote.test.ts` (modified — updated the obsolete "(g) execute stub" test to assert the real Gate-1/plan-required refusal instead; added `vi` import; updated module doc comment)
- `packages/iris-dev-mcp/src/__tests__/env-promote-qa.test.ts` (modified — updated the obsolete "zero IRIS/HTTP calls...stub refusal" test to assert the real Gate-3 stale-plan refusal instead; updated module doc comment)

## Review Findings

Adversarial code review (Blind Hunter + Edge Case Hunter + Acceptance Auditor, Opus), 2026-07-10. Security-critical default-disabled write. All ACs (27.3.1/27.3.2/27.3.3), Rule #47, Rule #19, and scope (no ObjectScript/bootstrap/baseline change; `BOOTSTRAP_VERSION` `1e2008753853`; `gen:governance-baseline:check` exit 0 = 141/200/59) independently verified against real source. Full dev suite green (502 tests, +4 regression tests added by review). 0 HIGH. 5 patches applied, 4 deferred (all LOW), 3 dismissed.

### Patches applied (checked = fixed)

- [x] [Review][Patch] Gate 3 did not bind `plan.steps` to the diff — a hand-edited plan keeping a valid diff+hash but swapping a step's `subject` could promote a source item OUTSIDE the reviewed diff (raised by all 3 layers). Added **Gate 3b (plan/diff consistency)**: re-derive `buildPlan(diff).steps` and require the supplied `plan.steps` to match exactly (identity fields + order), refuse-before-any-write on mismatch. No-op for a genuine caller; also subsumes the duplicate-step-index tamper vector. [`env-promote.ts` `executeAction`]
- [x] [Review][Patch] Credential-value leak on the SDS write FAILURE path — the re-fetched (possibly credential) `value` is forwarded to the target write body; if the target POST throws an `IrisApiError` whose text echoes the submitted value, it would reach the rendered per-step `error`. The success-path redaction was tested; the error path was not. Added `scrubValueFromError` (Rule #9 min-length-gated literal scrub) around the SDS target POST. [`env-promote.ts` `dispatchSetDefaultSetting`]
- [x] [Review][Patch] Non-array source document content silently PUT as `[]` — an anomalous source `GET` returning 200 without a `content` array fell back to `[]`, PUTting empty content + recompiling (`flags=cuk`) → could blank a target document (contradicts the "never destroy target state" promise). Now fails the step CLOSED instead of writing empty content. [`env-promote.ts` `runDocumentsBatch`]
- [x] [Review][Patch] Misleading output — the execute summary printed "Nothing on the target was ever deleted." unconditionally, but an `updateMapping` step DOES issue a `delete` (delete+create replace). Reworded to the true invariant: "No item that exists only on the target was ever removed." [`env-promote.ts` `renderExecuteResult`]
- [x] [Review][Patch] A compile-failure test title claimed the later doc "is still reported 'completed'" while its assertion checks "skipped". Corrected the title to match the asserted (and documented) batch-reporting behavior. [`env-promote-execute.test.ts`]

### Deferred (checked = deferred; see deferred-work.md — all LOW, none block `done`)

- [x] [Review][Defer] `documents` batch reporting under-reports an applied doc as `skipped` — a doc whose PUT succeeded (and, in the compile-error branch, was actually compiled OK) but sits after an earlier failure in the same batch is reported `skipped`, not `completed`. Deliberate, documented, tested dev choice; errs conservative (never hides a failure). [`env-promote.ts` `runDocumentsBatch`]
- [x] [Review][Defer] `updateMapping` delete+create is non-atomic — if the delete succeeds and the create then fails, the target mapping is gone with no rollback (step reports `failed`, halts). Inherent to IRIS mappings (no update op; mirrors `iris_mapping_manage`'s documented delete+create). [`env-promote.ts` `dispatchUpdateMapping`]
- [x] [Review][Defer] `webapps` plan detail says "create web application (exists on source only)" but the dispatched op is `modify` — SPEC-FAITHFUL ("webapp modify" per feature-spec §ordering line 109), and a source-only webapp absent on target fails the `modify` cleanly (fails safe). Recommend the lead confirm whether new-webapp CREATE is in scope and, if not, reword 27.2's plan detail. [`env-promote.ts` `dispatchModifyWebApp` / 27.2 `buildWebappsSteps`]
- [x] [Review][Defer] An empty-string configured namespace (misconfigured profile, no override) surfaces confusing per-step "not found / may have changed" errors that misattribute the real cause. No crash; caught as clean per-step failures. [`env-promote.ts` namespace resolution]

### Dismissed (verified non-issues)

- Uncaught `negotiateVersion` throw losing per-step statuses (Blind) — `negotiateVersion` (atelier.ts) has an internal try/catch returning `DEFAULT_VERSION`; it CANNOT throw. Verified.
- `iris_mapping_manage:delete` omitted from the local `EXECUTE_WRITE_FAMILY` (Blind) — correctly handled: it is a frozen-baseline member classified `write` in `BASELINE_ACTION_CLASSIFICATIONS`, so `defaultSeed` short-circuits on baseline membership and `presetSeed`/read-only uses the classification. Verified against `governance.ts`.
- `?ignoreConflict=1` disabling target concurrency detection — inherent to promote (source wins); documented design.
