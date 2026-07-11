# Story 27.2: `promote:plan` Generator

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an operator who has run `iris_env_diff` between two profiles,
I want to turn that diff into an ordered, reviewable promotion PLAN (source → target),
so that I can see exactly what would be applied — in dependency order, with target-only items flagged as warnings and NOTHING ever deleted — before any write happens.

This is Story 3 of Epic 27. It introduces the **`iris_env_promote`** tool with its **`plan`** action (read) — a pure transform of a prior `iris_env_diff` result into an ordered step list + warnings + a content hash. The `execute` action (the gated write) is registered here but implemented in Story 27.3. **TS-only — no ObjectScript / bootstrap change.**

## Acceptance Criteria

1. **AC 27.2.1** — `plan` (read) transforms a diff into ordered steps (mappings → documents put+compile batched → defaultSettings → webapps → config), each `{index, domain, operation, subject, detail, direction}`.
2. **AC 27.2.2** — `onlyInTarget` items emitted as `warning` entries; NO delete steps exist anywhere in any plan.
3. **AC 27.2.3** — Plans embed a content hash of their source diff (stale-plan protection input for 27.3); unit tests over ordering, warnings, and hash embedding.

### Integration note (lead-side gate)

This story introduces `iris_env_promote` (a new tool). Its `plan` action's ACs are self-verifying (fixture-tested ordering / warnings / hash). **`plan`'s output has no consumer in THIS story; the first consumer is Story 27.3's `execute`** (which validates the plan hash + runs allowlisted steps). The `execute` action is registered here (governance-classified) but returns a clear "ships in Story 27.3" refusal until then.

## Tasks / Subtasks

- [x] **Task 1 — New tool `iris_env_promote` skeleton + governance (AC 27.2.1, Rules #28/#32)**
  - [x] New `packages/iris-dev-mcp/src/tools/env-promote.ts` (mirror `env-diff.ts` structure + the `iris_message_resend` multi-action + per-action-`mutates` pattern at `packages/iris-interop-mcp/src/tools/message-resend.ts:344-354`). `ToolDefinition`:
    - `name: "iris_env_promote"`, `title`, LLM-optimized `description` (document BOTH actions; state `execute` is a **write, DEFAULT-DISABLED** under `IRIS_GOVERNANCE` and NOT enabled by default — Rule #30; `plan` is read/enabled).
    - `scope: "NONE"` (`plan` is a pure transform — no IRIS call; `execute` uses the caller's resolved client in 27.3).
    - `annotations`: `readOnlyHint: false` (the tool has a write action), `destructiveHint: false` (no deletions — ever), `idempotentHint: false`, `openWorldHint: false`.
    - `mutates: { plan: "read", execute: "write" }` (per-action map — Rule #28; NEW post-foundation keys, BOTH classified). **Do NOT use `defaultEnabled`** — `execute` is a real write that must ship default-disabled (spec §4; Rule #32 — this is NOT a recovery-of-last-resort action).
    - `inputSchema` (zod): `action: z.enum(["plan","execute"])`; `source: string`, `target: string`; `diff?: object` (a prior `iris_env_diff` `structuredContent` — REQUIRED for `plan`); `plan?: object`, `steps?: number[]`, `confirm?: boolean`, `namespace?: string` (these are for `execute` — declare them now so the schema is stable; 27.3 uses them). Cross-field validation in the HANDLER (not `.refine()` — breaks MCP JSON-schema emission, per the message-resend precedent): `plan` requires `diff`.
  - [x] `execute` branch: return a clear `isError` refusal "`iris_env_promote:execute` ships in Story 27.3" (stub). It is governance-default-disabled anyway; the stub keeps the tool + governance key set stable from this story.
  - [x] Register in `packages/iris-dev-mcp/src/tools/index.ts`; update `packages/iris-dev-mcp/src/__tests__/index.test.ts` count `27 → 28` + add `expect(names).toContain("iris_env_promote")`.

- [x] **Task 2 — `plan` generator (AC 27.2.1, AC 27.2.2)**
  - [x] Input: `diff` = a prior `iris_env_diff` `structuredContent` (shape: `EnvDiffResult` — `{source:{profile,namespace}, target:{...}, domains:{documents?,mappings?,defaultSettings?,webapps?,config?}, errors?, summary:{driftCount,identicalCount}}`; each domain diff = `{onlyInSource, onlyInTarget, differs, identical}` — see `env-diff.ts:191-329` for the exact per-domain entry shapes). Validate `diff` is present + well-shaped; a malformed/empty diff → clear error (or an empty plan with a note).
  - [x] **Ordering (dependency order — AC 27.2.1):** emit steps grouped by domain in EXACTLY this order: **`mappings` → `documents` (put+compile, batched) → `defaultSettings` → `webapps` → `config`**. Within a domain, deterministic sub-order (e.g. sorted by subject).
  - [x] **Which drift becomes a step (direction `"sourceToTarget"`):** for each domain, `onlyInSource` items (exist on source, absent on target → CREATE on target) AND `differs` items (exist on both, differ → UPDATE target to match source) become STEPS. Step shape: `{index, domain, operation, subject, detail, direction: "sourceToTarget"}` where:
    - `index`: 1-based global step number in plan order.
    - `operation`: per-domain verb — `mappings`→`"createMapping"`/`"updateMapping"`, `documents`→`"putAndCompile"`, `defaultSettings`→`"setDefaultSetting"`, `webapps`→`"modifyWebApp"`, `config`→`"setConfig"` (align verbs with the underlying write the 27.3 execute will call — reuse the existing tools' write endpoints, do NOT invent operations that have no backing endpoint).
    - `subject`: the item identifier (doc name; mapping `(type,namespace,name)` key; SDS `prod||item||host||setting` key; webapp `name`; config property key).
    - `detail`: a concise human-readable description of the change (e.g. `"create global mapping"`, `"update value"`, `"hash a→b"`). **For a credential-redacted SDS `differs`, the detail MUST NOT contain the plaintext value** — carry the `[REDACTED:differs]` marker through (redaction from 27.1 must survive into the plan; a credential plaintext must NOT appear anywhere in the plan output).
  - [x] **`onlyInTarget` → WARNINGS, never steps (AC 27.2.2):** for every domain, each `onlyInTarget` item becomes a `warning` entry `{domain, subject, detail}` (e.g. `"exists on target only — not promoted, not deleted"`). **NO delete/remove operation exists ANYWHERE in any plan** (spec §7 out-of-scope; the load-bearing safety invariant). Assert this in tests (a plan generated from a diff with `onlyInTarget` items on every domain contains ZERO steps whose operation is a delete, and the `onlyInTarget` items appear ONLY in `warnings`).
  - [x] **`documents` batching:** documents `putAndCompile` steps may be represented as one batched step per doc (or a single batched compile note) — keep it faithful to how 27.3 will execute (put each doc, then compile). A per-doc step with `operation:"putAndCompile"` is fine; note the batching intent in `detail`.
  - [x] Skip domains ABSENT from the diff (not requested / errored — `diff.errors[domain]`): no steps for a domain that wasn't diffed; optionally surface a note that an errored domain was skipped.

- [x] **Task 3 — Plan content hash (AC 27.2.3)**
  - [x] Compute a stable content hash of the SOURCE diff and embed it in the plan output as `planHash` (a SHA-256 hex of a canonical, key-sorted JSON serialization of the input `diff` — deterministic regardless of key order). Use Node `crypto.createHash("sha256")` (the MCP server is Node) OR a small stable-stringify + hash helper. This is the stale-plan-protection input Story 27.3's `execute` verifies (it will re-hash the diff it is given and refuse if it mismatches `plan.planHash`).
  - [x] The hash MUST be deterministic + idempotent (same diff → same `planHash` across calls) and sensitive (any diff change → different hash). Unit-test both.

- [x] **Task 4 — Plan output shape + summary**
  - [x] `structuredContent`:
    ```
    { source:{profile,namespace}, target:{profile,namespace},
      planHash: "<sha256>",
      steps: [{index, domain, operation, subject, detail, direction:"sourceToTarget"}],
      warnings: [{domain, subject, detail}],
      summary: { stepCount, warningCount } }
    ```
  - [x] `content[].text`: a readable rendering — ordered steps (numbered), then warnings, then the summary; state prominently that `onlyInTarget` items are warnings (NOT deletions) and that NO deletions occur. Never render a credential plaintext.

- [x] **Task 5 — Tests (DEFAULT vitest suite; AC 27.2.1/27.2.2/27.2.3)**
  - [x] `packages/iris-dev-mcp/src/__tests__/env-promote.test.ts` (mocked — `plan` is a pure transform, no HTTP): (a) ORDERING — a diff with drift in all 5 domains produces steps in mappings→documents→defaultSettings→webapps→config order, `index` monotonic 1..N; (b) WARNINGS + NO-DELETE — `onlyInTarget` items across all domains appear ONLY in `warnings`, and NO step has a delete/remove operation (assert on the full step list); (c) HASH — `planHash` is deterministic (same diff twice → same hash), sensitive (mutated diff → different hash); (d) `differs` + `onlyInSource` → steps with the right operation/subject/detail/direction; (e) REDACTION survives — a credential-redacted SDS `differs` in the diff yields a step whose `detail` carries `[REDACTED:*]` and the plaintext appears NOWHERE in the serialized plan; (f) missing `diff` → clean refusal; (g) `execute` action → the "ships in 27.3" stub refusal; (h) governance shape — a real `handleToolCall` gate test: `plan` enabled by default, `execute` DENIED under empty `IRIS_GOVERNANCE` (mirror `message-resend-governance.test.ts`).
  - [x] Do NOT name any must-run test `*.integration.test.ts` (Rule #21).

- [x] **Task 6 — Docs (light) + DoD**
  - [x] Update the `iris_env_promote` tool DESCRIPTION (both actions, execute default-disabled, no deletions). Full README/tool_support/CHANGELOG rollup is Story 27.4.
  - [x] `pnpm turbo run build` + `pnpm turbo run test` green (report deltas). NO ObjectScript/bootstrap change: `BOOTSTRAP_VERSION` stays `1e2008753853`; `gen:governance-baseline:check` exit 0 (`iris_env_promote:plan` read + `iris_env_promote:execute` write are NEW post-foundation keys — expected in live, NOT in frozen baseline; `governance-baseline.ts` git-clean — Rules #23/#25/#28); `iris_env_promote:execute` default-disabled (assert via a governance test). dev tool count 27→28.

## Dev Notes

### Governance — the load-bearing classification (Rules #28/#32)

`mutates: { plan: "read", execute: "write" }` (per-action map, exactly the `iris_message_resend` shape — `message-resend.ts:350-354`). BOTH keys are NEW/post-foundation (absent from frozen baseline `1e62c5ad5bf7`). `execute` is truthfully `write` → **default-disabled** under `IRIS_GOVERNANCE`. **Do NOT use `defaultEnabled`** — promotion is a real environment-mutating write, NOT a recovery-of-last-resort (unlike Epic 20's `iris_production_control:clean`). `plan` is `read` → default-enabled. `gen:governance-baseline:check` MUST stay exit 0 (frozen baseline untouched; the 2 new keys are post-foundation — live key count grows, frozen count stays 141).

### The plan is a PURE TRANSFORM (no IRIS call)

`plan` takes a prior `iris_env_diff` `structuredContent` (the `diff` param) and transforms it — it does NOT connect to IRIS. `scope: "NONE"`. This makes it fast, deterministic, and fully unit-testable with fixtures (no mocked HTTP needed for `plan`). The `execute` action (27.3) is the one that connects + writes.

### Safety invariants (spec §4/§7 — load-bearing for the whole promote feature)

- **`onlyInTarget` → warnings, NEVER deletions.** No delete/remove operation exists anywhere in any plan. This is the #1 safety promise of the promote feature (v1 out-of-scope: deletions on target). Test it explicitly.
- **Direction is always `sourceToTarget`** (promote source's state onto target). No bidirectional/reverse steps.
- **Redaction survives (from 27.1):** a credential-redacted SDS value must never appear in the plan output — carry the `[REDACTED:*]` marker through; the plan is another output surface the secret must not leak into.

### Ordering rationale (AC 27.2.1)

mappings FIRST (target must have the right global/routine/package DB mappings before code lands), then documents (put+compile — code), then defaultSettings (SDS — config that code reads), then webapps, then config (instance-wide CPF last). 27.3's `execute` runs the allowlisted step indices IN THIS ORDER, halt-on-first-error.

### Consumed by Story 27.3

`plan.planHash` + `plan.steps` are consumed by 27.3's `execute`: execute re-hashes the diff it is given and refuses if it ≠ `planHash` (stale-plan protection); it runs ONLY the allowlisted `steps` indices, in plan order, calling the SAME write endpoints the existing tools use. Keep the step `operation`/`subject`/`detail` precise enough that 27.3 can dispatch each step to the right write endpoint without re-deriving it.

### References

- [Source: research/feature-specs/05-env-diff-promotion.md#4] `iris_env_promote` plan/execute; #5 story 3; #6 AC 4; #7 out-of-scope (no deletions).
- [Source: research/feature-specs/00-conventions.md#2] TS tool; #4 testing; governance rules.
- [Source: epics.md#Story-27.2] AC 27.2.1–27.2.3.
- [Source: packages/iris-dev-mcp/src/tools/env-diff.ts:191-329] `EnvDiffResult` + per-domain diff entry shapes (the `plan` input).
- [Source: packages/iris-interop-mcp/src/tools/message-resend.ts:237-354] multi-action tool + per-action `mutates` (no `defaultEnabled`) + governance-default-disabled-write precedent.
- [Source: .claude/rules/project-rules.md] Rules #19/#28/#30/#32.

## Dev Agent Record

### Agent Model Used

claude-sonnet-5

### Debug Log References

None required — no live IRIS involved (`plan` is a pure transform, `scope: "NONE"`); all iteration was via `pnpm --filter @iris-mcp/dev test`/`build`/`lint` and the monorepo `pnpm turbo run build|test|lint|type-check`. One TypeScript fix needed after the initial write: several test-file array/element accesses (`webappSteps[0].detail`, `result.content[0].text`, etc.) tripped `noUncheckedIndexedAccess` (tsconfig.base.json) and were changed to optional chaining (`?.`), matching the established convention already used in `env-diff-domains.test.ts`.

### Completion Notes List

- Implemented `packages/iris-dev-mcp/src/tools/env-promote.ts`: new `iris_env_promote` tool, mirroring `env-diff.ts`'s structure and `message-resend.ts`'s multi-action + per-action-`mutates` pattern.
  - `mutates: { plan: "read", execute: "write" }` — both keys are new/post-foundation; `execute` deliberately does NOT use `defaultEnabled` (Rule #32 — promotion is not a recovery-of-last-resort).
  - `scope: "NONE"`; `annotations` exactly as specified (`readOnlyHint:false`, `destructiveHint:false`, `idempotentHint:false`, `openWorldHint:false`).
  - `inputSchema`: `action` enum (`plan`/`execute`), required `source`/`target` strings, and `diff`/`plan`/`steps`/`confirm`/`namespace` all optional (`diff`/`plan` via `z.record(z.string(), z.unknown())`, matching the established generic-object convention used in `item.ts`/`transform.ts`/`docdb.ts`). Cross-field validation (`plan` requires `diff`) is done in the handler, not `.refine()`.
  - `execute` branch returns a fixed `isError` stub naming Story 27.3, never touching `plan`/`steps`/`confirm`.
- `plan` generator: per-domain builder functions (`buildMappingsSteps`/`buildDocumentsSteps`/`buildDefaultSettingsSteps`/`buildWebappsSteps`/`buildConfigSteps`) each turn a domain's `onlyInSource` (→ CREATE step) and `differs` (→ UPDATE step) entries into `{operation, subject, detail}`, and `onlyInTarget` entries into warnings (`{domain, subject, detail}` — uniform text "exists on target only -- not promoted, not deleted"). `buildPlan` runs the five builders in the FIXED order `mappings → documents → defaultSettings → webapps → config`, sorts each domain's steps/warnings by `subject` for a deterministic sub-order, and assigns the global 1-based `index` + `direction: "sourceToTarget"` while iterating. No delete/remove operation is ever emitted anywhere in the codebase — verified by an explicit test that scans every step's `operation` string for "delete"/"remove".
- Operation verbs match the story's per-domain verb list exactly: `mappings` → `createMapping`/`updateMapping` (the only domain with two verbs); `documents`/`defaultSettings`/`webapps`/`config` each use ONE verb (`putAndCompile`/`setDefaultSetting`/`modifyWebApp`/`setConfig`) for both create and update, matching the story's Task 2 spec literally (only mappings splits by verb; the others differentiate create vs. update in the `detail` text only).
- Redaction survives by construction: a credential-redacted `differs` SDS entry (Story 27.1's `redacted: "[REDACTED:differs]"` marker, `sourceValue`/`targetValue` omitted entirely) is detected via `typeof raw.redacted === "string"` and its `detail` carries the marker verbatim; the code never falls back to reading the (absent) `sourceValue`/`targetValue` in that branch. A dedicated test confirms the marker appears in the step `detail`, the plaintext is absent from the whole serialized plan, and the string `"undefined"` never leaks into the detail text.
- Plan hash (`computePlanHash`, EXPORTED for Story 27.3 to reuse verbatim rather than reimplement): SHA-256 hex of `JSON.stringify` over a recursively key-sorted clone of the input `diff` (arrays keep their order; only object keys are sorted at every level). Verified deterministic regardless of top-level AND nested key order, sensitive to any value change, and idempotent across repeated `plan` calls with the same diff.
- `diff` shape validation (`validateDiffShape`): requires `diff` to be a plain object with `domains`/`source`/`target` all present as plain objects; a missing `diff` or a diff failing this shape check returns a clean `isError` validation envelope (never a plan). A diff that IS well-shaped but has NO domains present (e.g., all requested domains errored upstream per Story 27.1's per-domain isolation) succeeds with an empty plan (0 steps, 0 warnings) — the errored domain names are surfaced in the human-readable `content[].text` (not `structuredContent`, per the story's optional "note" allowance).
- Registered in `packages/iris-dev-mcp/src/tools/index.ts` (after `envDiffTool`); `index.test.ts` counts updated `27→28` (package array) / `28→29` (server `toolCount`, +1 framework `iris_server_profiles`), plus `iris_env_promote` added to the `getToolNames()` expectation and the "should export..." name-contains list.
- Tests: `env-promote.test.ts` (19 tests covering (a)-(g) from Task 5 — ordering, warnings/no-delete, hash determinism/sensitivity/idempotence, per-domain step shape, redaction survival, missing/malformed-diff refusal, and the execute stub) + `env-promote-governance.test.ts` (5 tests, mirroring `message-resend-governance.test.ts`/`env-diff-governance.test.ts`: `plan` allowed under empty `IRIS_GOVERNANCE`, `execute` denied with the structured `GOVERNANCE_DISABLED` envelope and the handler never invoked, registration doesn't throw, and both an explicit enable of `execute` and an explicit disable of `plan` flip only their own key). Neither file is named `*.integration.test.ts` (Rule #21) — both run in the default suite.
- Verified: `pnpm --filter @iris-mcp/dev build` clean; `pnpm --filter @iris-mcp/dev test` 30 files / 462 tests green (was 27 files/~427 before this story — net +3 files/+24 tests); `pnpm --filter @iris-mcp/dev lint` clean; `pnpm turbo run build` 6/6 (via 7 packages incl. `@iris-mcp/all`); `pnpm turbo run test` 13/13 tasks green (no regressions in any other package); `pnpm turbo run lint type-check` 18/18 tasks green; `pnpm run gen:governance-baseline:check` exit 0 — **141 frozen / 200 live / 59 post-foundation** (was 141/198/57 after Story 27.0/27.1 — the +2 matches the two new `iris_env_promote:plan`/`iris_env_promote:execute` keys exactly); `governance-baseline.ts` git-clean (frozen baseline `1e62c5ad5bf7` untouched). NO ObjectScript touched; `BOOTSTRAP_VERSION` unchanged at `1e2008753853` (not referenced anywhere in this story's diff). `skills/`/`prompts/`/`gen-skills.mjs` untouched. Docs rollup (README/tool_support.md/CHANGELOG/per-server README) deliberately NOT touched here — only the tool's own `description` field was written (per Task 6's explicit scope-limit to Story 27.4 for the full rollup).
- `iris_env_promote:execute`'s `plan`/`steps`/`confirm`/`namespace` input fields are declared now (schema-stable across both actions) but are unused by `plan`'s logic and untouched by the `execute` stub — Story 27.3 wires them.

### File List

- `packages/iris-dev-mcp/src/tools/env-promote.ts` (new; code-review hardening — fail-closed redaction, `records()` malformed-element guard, locale-independent `bySubject` sub-order)
- `packages/iris-dev-mcp/src/tools/index.ts` (modified — register `envPromoteTool`)
- `packages/iris-dev-mcp/src/__tests__/index.test.ts` (modified — tool count 27→28, `toolCount` 28→29, `iris_env_promote` added to name assertions)
- `packages/iris-dev-mcp/src/__tests__/env-promote.test.ts` (new — 19 tests + 2 code-review hardening tests = 21)
- `packages/iris-dev-mcp/src/__tests__/env-promote-governance.test.ts` (new — 5 tests)
- `packages/iris-dev-mcp/src/__tests__/env-promote-qa.test.ts` (new — QA-stage, 7 tests)
