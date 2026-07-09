# Story 24.0: Baseline Read/Write Classifications

Status: done

## Story

As a **suite operator who wants a one-word read-only safety net**,
I want **every frozen-baseline governance key mapped to a truthful `read`/`write` classification, with completeness mechanically enforced**,
so that **the Epic-24 preset engine (Story 24.1) can block 100% of writes under `IRIS_GOVERNANCE_PRESET=read-only` without a hand-maintained list drifting out of sync with the governed surface**.

## Context

Epic 24 ships one-word governance safety presets. `read-only` needs a read/write verdict for **every** governance key. New (post-governance) tools carry `mutates` metadata, but the **141 frozen-baseline keys do NOT** — they were grandfathered at the Epic-14 foundation (frozen hash `1e62c5ad5bf7`, Rule #23) and are enabled purely by baseline *membership*, with no read/write class recorded.

This story fills exactly that gap: a **hand-curated classification map** for the 141 baseline keys, plus a **completeness test** that fails if the map ever diverges from the frozen baseline key set. It is the Rule #20 mechanical-proof pattern (a generated/enforced baseline over an existing capability). **This story writes NO engine logic** — it is the data artifact + its guard. The cascade that consumes it is Story 24.1.

**Binding spec:** [research/feature-specs/02-governance-presets.md](./research/feature-specs/02-governance-presets.md) §2.1 + §3 story 1 + AC 3. Conventions: [00-conventions.md](./research/feature-specs/00-conventions.md).

## Acceptance Criteria

1. **AC 24.0.1 — Complete, self-verifying map.** New file `packages/shared/src/baseline-classifications.ts` exports `BASELINE_ACTION_CLASSIFICATIONS: Record<string, "read" | "write">` (or `Record<string, MutationClass>`, reusing the `MutationClass` type from `governance.ts`) covering **exactly** the frozen baseline key set. A completeness test asserts the map's key set **equals** `GOVERNANCE_BASELINE` — **missing OR extra keys fail, naming the offending key(s)**. The test enumerates keys by importing `GOVERNANCE_BASELINE`; the source-of-truth key list is NEVER hand-copied into the test. The file carries a header comment: `// DO NOT hand-sync with governance-baseline.ts — the completeness test enforces exact key-set parity.`

2. **AC 24.0.2 — Truthful, reviewed classifications.** Every key classified `write` where IRIS state is created/modified/deleted or code is executed; every key classified `read` only where it is a pure query. Specifically:
   - **Execution keys are `write`:** `iris_execute_command`, `iris_execute_classmethod`, `iris_doc_put`, `iris_doc_load`, `iris_doc_compile`, `iris_global_set`, `iris_global_kill`, and every `*_manage`/`*_control`/`*_action` **create/modify/delete/set/run/build/sync/reset** action.
   - **Read verbs** (classify `read` without a justification comment): action or bare-tool verb is one of `list`, `get`, `view`, `status`, `check`, `history`, `listHistory`, `explain`, `stats`, `summary`, `info`, `find`, `search`, `test` (read-only dry-run), `adapters`, `queues`, `messages`, `logs`. **Any key classified `read` whose verb is NOT in this allowlist MUST carry an inline `// read: <why>` justification comment** (e.g. `iris_transform_test` — dry-run, no persistence).
   - **When in doubt → `write`** (fail safe). A false `write` only over-restricts read-only mode (annoying); a false `read` would let a mutation through read-only mode (a safety-guarantee breach).

3. **AC 24.0.3 — Frozen baseline untouched.** `pnpm gen:governance-baseline:check` exits 0; `git diff --exit-code packages/shared/src/governance-baseline.ts` is clean. This story NEVER edits `governance-baseline.ts` and NEVER runs the bare generator (Rule #25).

## Tasks / Subtasks

- [x] **Task 1 — Read the frozen baseline & classification inputs (AC 24.0.1, 24.0.2)**
  - [x] Read `packages/shared/src/governance-baseline.ts` — all 141 keys of `GOVERNANCE_BASELINE` (a `ReadonlySet<string>`). Keys are either a bare tool name (`iris_analytics_mdx`) or `tool:action` (`iris_database_manage:create`).
  - [x] Read `packages/shared/src/governance.ts` for the `MutationClass = "read" | "write"` type (line ~40) — reuse it, do not redeclare.
  - [x] For any ambiguous key, consult `tool_support.md` (authoritative per-tool catalog) and/or the tool's `mutates`/`annotations` in its `packages/<pkg>/src/tools/*.ts` definition to confirm read vs write semantics. This is the same "read the source before classifying" discipline as Rule #2/#16.
- [x] **Task 2 — Create `baseline-classifications.ts` (AC 24.0.1, 24.0.2)**
  - [x] Create `packages/shared/src/baseline-classifications.ts` with the DO-NOT-hand-sync header comment.
  - [x] Export `BASELINE_ACTION_CLASSIFICATIONS: Record<string, MutationClass>` with all 141 keys classified per AC 24.0.2. Keep keys sorted (mirror the baseline file's sort) for reviewable diffs.
  - [x] Add the `// read: <why>` justification comment on every non-allowlist-verb `read` key (AC 24.0.2).
- [x] **Task 3 — Completeness test (AC 24.0.1)**
  - [x] Add `packages/shared/src/__tests__/baseline-classifications.test.ts` (DEFAULT suite — NOT `*.integration.test.ts`, Rule #21).
  - [x] Import both `GOVERNANCE_BASELINE` and `BASELINE_ACTION_CLASSIFICATIONS`. Assert: (a) every baseline key is present in the map (report missing keys by name); (b) every map key is in the baseline (report extra keys by name); (c) every value is exactly `"read"` or `"write"`. Prefer set-difference assertions that print the offending keys (e.g. `expect(missing).toEqual([])`), not a bare `.size` equality — a count-only check hides *which* key drifted.
  - [x] (Recommended) Add a small guard asserting the map is non-empty and `size === GOVERNANCE_BASELINE.size` as a fast tripwire alongside the named-key checks.
- [x] **Task 4 — Verify (AC 24.0.3)**
  - [x] `pnpm --filter @iris-mcp/shared build` and `pnpm --filter @iris-mcp/shared test` green (or `pnpm turbo run build`/`test`).
  - [x] `pnpm gen:governance-baseline:check` → exit 0.
  - [x] `git diff --exit-code packages/shared/src/governance-baseline.ts` → clean (no output).

## Dev Notes

### What this story is and is NOT
- **IS:** one new data file (`baseline-classifications.ts`) + one new test. Pure additive; no existing file's behavior changes.
- **IS NOT:** the preset engine. Do NOT touch `governance.ts` cascade logic, `config.ts`, `server-base.ts`, or `iris_server_profiles` — those are Story 24.1. Do NOT add a `presetSeed`. Do NOT wire the map into anything yet (its first consumer is Story 24.1 — see Integration ACs below).

### Hard constraints (Rules)
- **Rule #23/#25 — frozen baseline is untouchable.** NEVER edit `governance-baseline.ts`. NEVER run `node scripts/gen-governance-baseline.mjs` bare — it would regrow the frozen file. Only `pnpm gen:governance-baseline:check` (no-write `--check` mode) is permitted. If you accidentally run it bare, immediately `git checkout -- packages/shared/src/governance-baseline.ts`.
- **Rule #20 — generated/enforced baseline over existing capability.** The completeness test IS the mechanical proof. It must name the drifting key, not just count.
- **Rule #19 — additive/no-op.** This story adds a file and a test; nothing existing changes behavior. No back-compat snapshot needed here (no existing path is modified), but do not perturb any existing test.
- **Rule #21 — default suite.** The completeness test must run in the default `pnpm test` run; do not use the `*.integration.test.ts` suffix.

### Classification reference (fail-safe)
- The 141 keys span all 5 servers. Multi-action tools contribute one `tool:action` key per enum value (e.g. `iris_database_manage:create`, `:modify`, `:delete` are three distinct keys — classify each on its own action verb).
- **Writes** (non-exhaustive, illustrative): all `:create`/`:modify`/`:delete`/`:set`/`:update`/`:build`/`:sync`/`:reset`/`:export`(if it mutates config) actions; `iris_execute_command`, `iris_execute_classmethod`, `iris_doc_put`, `iris_global_set`, `iris_global_kill`, credential/user/role/resource/ssl/oauth/ldap/namespace/database/webapp `*_manage` mutating actions, `iris_production_control` (start/stop/update/recover), `iris_production_item` (add/remove), `iris_task_manage`/`iris_task_run`, `iris_backup_manage`, `iris_database_action`, `iris_process_manage`, `iris_lookup_manage`/`iris_lookup_transfer` mutating actions, `iris_docdb_document`/`iris_docdb_manage` mutating actions.
- **Reads** (allowlist verbs, no comment needed): `*_list`, `*_get`, `iris_*_status`, `iris_database_check`, `iris_audit_events`, `iris_metrics_*`, `iris_journal_info`, `iris_license_info`, `iris_ecp_status`, `iris_mirror_status`, `iris_locks_list`, `iris_jobs_list`, `iris_analytics_mdx` (query), `iris_analytics_cubes:list`, `iris_production_summary`/`status`/`queues`/`messages`/`logs`/`adapters`, `iris_rule_get`/`list`, `iris_transform_list`, `iris_permission_check`, `iris_config_manage:get`, `iris_sql_execute` (query — but note SELECT-only is not guaranteed; **when in doubt classify `write`** if a key can run DML/DDL — flag this one explicitly with a justification comment stating the decision).
- **`iris_config_manage:export`** and any `*:export` — check whether "export" mutates server state (e.g. writes a config snapshot to disk). If it only reads, classify `read` with a `// read: exports a copy, no server-state change` comment; if uncertain, `write`.
- Cross-check the exact enum values against `governance-baseline.ts` — do not invent action names; classify only the keys that are actually in the frozen set.

### Integration ACs
- **No consumers in this story; the first consumer will be Story 24.1** (the preset cascade's `presetSeed` reads `BASELINE_ACTION_CLASSIFICATIONS` to resolve read/write for baseline keys). This story delivers the data artifact + its completeness guard only. (Rule 1 escape clause — producer with a named future consumer.)

### Project Structure Notes
- New file: `packages/shared/src/baseline-classifications.ts` (sibling to `governance-baseline.ts`, `governance.ts`).
- New test: `packages/shared/src/__tests__/baseline-classifications.test.ts` (sibling to `governance.test.ts`).
- No export barrel change required unless Story 24.1 needs it re-exported from `index.ts` — leave that to 24.1 (import directly by path for the test).

### References
- [Source: research/feature-specs/02-governance-presets.md#2.1 The classification problem] — the map, its header, the completeness test, fail-safe rule.
- [Source: research/feature-specs/02-governance-presets.md#4] — AC 3 (completeness), AC 8 (baseline untouched).
- [Source: packages/shared/src/governance-baseline.ts] — the frozen 141-key `GOVERNANCE_BASELINE` set + the DO-NOT-GROW header.
- [Source: packages/shared/src/governance.ts:40] — `MutationClass` type; `defaultSeed`/`buildMutatesLookup` (context only — do not modify).
- [Source: .claude/rules/project-rules.md] — Rule #20 (generated baseline), #23 (frozen foundation), #25 (generator `--check` only).
- [Source: packages/shared/src/__tests__/governance.test.ts:456] — existing `GOVERNANCE_BASELINE`-iterating back-compat test as a style template for the completeness test.

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5), via `bmad-dev-story` skill.

### Debug Log References

None — no live IRIS calls required; this story is pure TypeScript data + a unit test. Ambiguous classifications were resolved by reading tool source (`packages/*/src/tools/*.ts` `annotations.readOnlyHint`/`destructiveHint` and handler bodies) and, for the two OAuth-discover/password-validate cases, the underlying ObjectScript handler `src/ExecuteMCPv2/REST/Security.cls` (lines ~1645-1680 for `discover`, ~451-543 for `validate`).

### Completion Notes List

- Read `packages/shared/src/governance-baseline.ts` (141-key frozen `GOVERNANCE_BASELINE`) and `packages/shared/src/governance.ts` (`MutationClass` type, line 40) before curating.
- Classified all 141 baseline keys per AC 24.0.2's fail-safe rule. Cross-checked every non-obvious key against its tool's own MCP `annotations` (`readOnlyHint`/`destructiveHint`) and, where still ambiguous, the handler body or the ObjectScript REST source:
  - Confirmed genuine reads via `readOnlyHint: true` / handler inspection: `iris_analytics_mdx`, `iris_doc_convert`, `iris_doc_index`, `iris_routine_intermediate`, `iris_server_namespace`, `iris_transform_test`, `iris_config_manage:export` (isReadOnly branch in `config.ts`), `iris_doc_xml_export:export`/`:list`, `iris_lookup_transfer:export`, `iris_oauth_manage:discover` (verified `%SYS.OAuth2.Registration.Discover` only populates a ByRef output, no persistence), `iris_user_password:validate` (verified `$SYSTEM.Security.ValidatePassword()` never saves anything).
  - Two judgment calls resolved toward the fail-safe `write` despite a superficially read-ish name/annotation: `iris_doc_export` (bulk local-disk writes with path-traversal-sensitive handling; the tool's own `annotations.readOnlyHint` is `false`) and `iris_execute_tests` (executes real ObjectScript unit-test methods — setup/teardown can mutate state — despite its own `annotations.readOnlyHint: true`; distinguished from the genuinely dry-run `iris_transform_test`). `iris_sql_execute` classified `write` per the AC's explicit instruction (SELECT-only not guaranteed; `readOnlyHint: false` confirms).
  - 15 `read` keys whose verb is outside the AC 24.0.2 allowlist carry an inline `// read: <why>` comment; 3 borderline `write` keys carry an explanatory comment for reviewability (not required by the AC, but valuable given they diverge from the tool's own `annotations.readOnlyHint`).
- The completeness test's named-key assertions (missing/extra) are the mechanical proof this story requires (AC 24.0.1) — verified by inspection that they use set-difference against the live `GOVERNANCE_BASELINE` import (never a hand-copied list), so they fail naming the offending key if the map and baseline ever diverge. The full 141-entry map passed all 5 completeness assertions on the first run, confirming no key was mistyped, dropped, or duplicated against `GOVERNANCE_BASELINE`.
- Verification: `pnpm --filter @iris-mcp/shared build` clean; `pnpm --filter @iris-mcp/shared test` 571/571 green (30 files, no regressions); `pnpm gen:governance-baseline:check` exit 0 (141 frozen / 194 live / 53 post-foundation, unchanged by this story); `git diff --exit-code packages/shared/src/governance-baseline.ts` clean (frozen baseline untouched, generator never run bare).
- No consumer wired in this story (by design — Story 24.1's `presetSeed` is the first reader). No existing file's behavior changed.

### File List

- `packages/shared/src/baseline-classifications.ts` (new)
- `packages/shared/src/__tests__/baseline-classifications.test.ts` (new)
- `packages/shared/src/__tests__/baseline-classifications-safety.test.ts` (new — QA value-pinning + verb-sweep safety test)

### Review Findings

Code review 2026-07-08 (adversarial three-layer + live IRIS/tool source reads). Result: **2 HIGH + 2 lower findings, all fixed inline; 1 LOW deferred; 2 dismissed.** Frozen baseline `1e62c5ad5bf7` untouched; shared suite 607/607 green post-patch.

- [x] [Review][Patch] **HIGH — `iris_oauth_manage:discover` was mis-classified `read` (safety hole)** [packages/shared/src/baseline-classifications.ts] — `%SYS.OAuth2.Registration.Discover()` PERSISTS: it opens/creates an `OAuth2.ServerDefinition` and, inside a committed `Tstart/Tcommit`, `%DeleteId`'s the existing issuer metadata row and calls `RefreshJWKS` (irislib/%SYS/OAuth2/Registration.cls:11 class-doc "saves the server metadata"; body 33-51). The dev's justification comment verified only the REST wrapper, not the persisting system method. Under `IRIS_GOVERNANCE_PRESET=read-only` this would have executed. **Fixed:** reclassified `read → write` with corrected comment; safety-test pin updated `read → write`.
- [x] [Review][Patch] **HIGH — `iris_transform_test` was mis-classified `read` (code execution)** [packages/shared/src/baseline-classifications.ts:211] — executes the caller-named compiled DTL `Transform()` method (`$ClassMethod(class,"Transform",...)`); a DTL may embed `<code>`/`<sql>`/`<assign>` side effects, and the tool's own `annotations.readOnlyHint` is `false`. Parallels `iris_execute_tests`/`iris_execute_classmethod` (both `write`). **Fixed:** reclassified `read → write` (fail-safe) + added a safety-test pin. **NOTE:** this DIVERGES from AC 24.0.2's explicit "test (read-only dry-run)" example — see the SPEC-DIVERGENCE flag in deferred-work.md for lead ratification.
- [x] [Review][Patch] **MEDIUM — safety-test verb sweep advertised "systematic" but silently skipped 6+ write verbs** [packages/shared/src/__tests__/baseline-classifications-safety.test.ts] — `WRITE_VERBS` omitted `drop`/`insert`/`import`/`index` (docdb + transfer imports) and the `production_control` lifecycle verbs `recover`/`restart`/`start`/`stop`, leaving those correctly-classified `write` keys unpinned against a future read-flip. **Fixed:** added the 8 missing verbs to the sweep.
- [x] [Review][Patch] **LOW — story File List omitted the QA safety test** [24-0-baseline-classifications.md] — **Fixed:** added `baseline-classifications-safety.test.ts` to the File List.
- [x] [Review][Defer] **LOW — no mechanical guarantee a `read` classification is truthfully a pure query** [packages/shared/src/baseline-classifications.ts] — deferred to Story 24.1 (CR 24.0-1 in deferred-work.md). The hand-curated map's read-correctness rests on human review + the value-pin safety test, not a generator; this review's two HIGH catches prove the risk is real. Suggested: lint each `read` against its tool's `annotations.readOnlyHint`.
- Dismissed (2): duplicate-object-literal-key blind spot in the completeness test (TS compiler error TS1117 already rejects dup keys; build is green) — false positive; "15 vs 14 comment-count" prose nitpick (moot after the reclassifications changed the counts) — cosmetic.

## Change Log

| Date | Change |
|---|---|
| 2026-07-08 | Story 24.0 dev pass complete: new `packages/shared/src/baseline-classifications.ts` — `BASELINE_ACTION_CLASSIFICATIONS: Record<string, MutationClass>` covering all 141 frozen-baseline governance keys with a truthful read/write verdict per AC 24.0.2's fail-safe rule (write on any doubt), plus 15 inline `// read: <why>` justification comments for reads outside the obvious-verb allowlist and 3 explanatory comments on judgment-call writes (`iris_doc_export`, `iris_execute_tests`, `iris_sql_execute`). Classifications cross-checked against each tool's own `annotations.readOnlyHint`/`destructiveHint` and, for `iris_oauth_manage:discover` / `iris_user_password:validate`, the ObjectScript handler in `src/ExecuteMCPv2/REST/Security.cls`. New `packages/shared/src/__tests__/baseline-classifications.test.ts` (default suite, not `*.integration.test.ts`) asserts exact key-set parity against the live `GOVERNANCE_BASELINE` import via named set-difference (missing/extra keys reported by name, not just counted) plus a value-shape check — 5/5 tests pass. No consumer wired (Story 24.1's `presetSeed` is the first reader); no existing file's behavior changed. Verified: `pnpm --filter @iris-mcp/shared build` clean; `pnpm --filter @iris-mcp/shared test` 571/571 green (30 files, zero regressions); `pnpm gen:governance-baseline:check` exit 0 (141 frozen / 194 live / 53 post-foundation); `git diff --exit-code packages/shared/src/governance-baseline.ts` clean (frozen baseline untouched, bare generator never run). Status: ready-for-dev → review. |
| 2026-07-08 | Code review complete (adversarial three-layer + live IRIS/tool-source verification). **2 HIGH safety misclassifications caught & fixed inline:** `iris_oauth_manage:discover` (`read → write` — `%SYS.OAuth2.Registration.Discover()` persists/deletes issuer metadata in a committed transaction; dev comment had verified only the REST wrapper) and `iris_transform_test` (`read → write` — executes a caller-named compiled DTL `Transform()`; tool's own `readOnlyHint:false`; **diverges from AC 24.0.2's "dry-run" example — flagged for lead ratification**). **2 lower patches:** safety-test `WRITE_VERBS` sweep extended with `drop`/`insert`/`import`/`index`/`recover`/`restart`/`start`/`stop` (was silently skipping them); story File List updated. **1 LOW deferred** (CR 24.0-1 — no mechanical read-correctness oracle; routed to Story 24.1). 2 dismissed (dup-key blind spot handled by TS; comment-count nitpick moot). Re-verified: shared suite 607/607 green (safety test now 36 tests); `git diff --exit-code governance-baseline.ts` clean; frozen baseline `1e62c5ad5bf7` untouched. Read/write split now 63 read / 78 write. Status: review → done. |
