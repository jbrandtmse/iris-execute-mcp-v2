# Story 26.2: `iris_message_resend` TS Tool

Status: done

<!-- Epic 26 Story 2. The TypeScript tool that consumes the Story 26.1 REST handlers. TS-only — no ObjectScript, no bootstrap change. Adds the governance key (writes default-disabled). -->

## Story

As an **AI agent operating the interop MCP server**,
I want **an `iris_message_resend` tool with a truthful governance classification and a Zod-guarded schema**,
so that **I can preview and (when explicitly enabled) resend messages, with the write actions default-disabled and every dangerous input rejected before it reaches IRIS**.

## Acceptance Criteria

From `_bmad-output/planning-artifacts/epics.md` Epic 26 → Story 26.2 and binding spec `research/feature-specs/04-message-resend.md` §§3, 5.

- **AC 26.2.1** — Tool `iris_message_resend` in `packages/iris-interop-mcp/src/tools/message-resend.ts` per spec §3: `scope:"NS"`; `annotations:{ readOnlyHint:false, destructiveHint:true, idempotentHint:false, openWorldHint:false }`; per-action `mutates:{ preview:"read", resend:"write", resendFiltered:"write" }` (truthful — resend duplicates data). Actions `preview` / `resend` / `resendFiltered` route to the Story-26.1 endpoints (`POST /interop/message/resend/preview`, `POST /interop/message/resend` with the `action` body field). Description MUST state: what each action does; that `resend`/`resendFiltered` are **default-disabled by governance** WITH the `IRIS_GOVERNANCE` enable snippet; the dry-run-first workflow; the caps (1–100 headerIds, resendFiltered ≤7-day window + hard cap 500); and the **duplication hazard** ("resending a processed message delivers its data again downstream").
- **AC 26.2.2** — interop package tool count **21→22** (`tools` array + `index.test.ts` length 21→22; advertised `toolCount`/`getToolNames` 22→23 = +1 package tool over the framework `iris_server_profiles`). Governance unit tests: `resend`/`resendFiltered` **default-disabled** under empty `IRIS_GOVERNANCE` (real `handleToolCall` gate returns the `GOVERNANCE_DISABLED` envelope); explicit policy-enable works; `preview` **enabled by default**. New governance keys are POST-foundation → frozen baseline `1e62c5ad5bf7` UNTOUCHED (`gen:governance-baseline:check` exit 0); classification present so `assertGovernanceClassification` passes (Rule #28).
- **AC 26.2.3** — Unit tests: Zod schema validation (numeric `headerIds` 1–100; `action` enum; `resendFiltered` requires `item`+`from`; `maxMessages` bounds; boolean `dryRun`/`confirm`); guard-refusal envelope passthrough (the ObjectScript refusals from 26.1 surface as tool errors, not crashes); per-header result mapping incl. **partial failure** (`{originalId,newHeaderId?,ok,error?}` array + summary counts); timestamp formatting (see Dev Notes — NO `horologToIso`; ODBC string passthrough or a small local ISO transform + `*Raw`).

## Dev Notes

### Governance classification (Rule #28) + frozen baseline (Rule #23/#25)

- `mutates` is a per-action MAP: `{ preview:"read", resend:"write", resendFiltered:"write" }`. `preview` (read) resolves default-ENABLED via `defaultSeed`; `resend`/`resendFiltered` (write) resolve default-DISABLED. This is spec-mandated — **do NOT use `defaultEnabled`** (resend duplicates clinical data flow; it is NOT a recovery-of-last-resort like `clean`, spec §preamble).
- The three new keys (`iris_message_resend:preview|resend|resendFiltered`) are POST-foundation — they are NOT added to the frozen `governance-baseline.ts` (Rule #23 frozen-foundation). Run `pnpm gen:governance-baseline:check` → exit 0; the frozen file stays git-clean. NEVER run the bare generator (Rule #25).
- Cross-server / governance test expectations that assert the advertised `toolCount`, `getToolNames()` length, or the governed-key universe on a constructed interop server DO move (+1 tool / +3 keys) — update those. Package `index.test.ts` `tools` length moves 21→22 (this IS a package tool, not a framework tool — Rule #31 distinction).

### Tool shape — model on `diagram.ts` (the interop structured-output analog)

- `packages/iris-interop-mcp/src/tools/diagram.ts` (`iris_message_diagram`) is the closest analog: `name`, `annotations`, `scope:"NS"`, `mutates`, a Zod `inputSchema`, a handler that POSTs to the endpoint and returns `{ content:[...], structuredContent: result }` via the `toStructured()` helper (structuredContent must be an OBJECT, not an array — memory `feedback_mcp_structured_content`; no `.refine()` on the Zod schema).
- Register the tool in `packages/iris-interop-mcp/src/tools/index.ts` (import + add to the `tools` array).
- Route to the deployed endpoints from Story 26.1: `preview` → `POST /interop/message/resend/preview` `{headerIds}`; `resend` → `POST /interop/message/resend` `{action:"resend", headerIds, dryRun?, confirm?}`; `resendFiltered` → `POST /interop/message/resend` `{action:"resendFiltered", item, status?, from, to?, maxMessages?, dryRun?, confirm?}`. Pass `namespace` through.

### Zod schema — tighten to pre-empt the deferred CR 26.1 LOW items at the TS layer

Story 26.1's code review deferred 6 LOW items "folded into Story 26.2 / a hardening pass." Several are addressable by a strict TS schema (the ObjectScript guards already fail-safe, but the TS layer is the first-class validator for MCP callers):
- CR 26.1-1: `dryRun`/`confirm` must be real booleans (`z.boolean()`, not coerced) — a non-boolean must not become execute-eligible at the TS layer.
- CR 26.1-3: `headerIds` — `z.array(z.string()/z.number()).min(1).max(100)` with numeric validation; reject a JSON object.
- CR 26.1-5: `maxMessages` — `z.number().int().min(1).max(500)`.
- Keep the ObjectScript guards as the authoritative server-side net (they are — verified live in the 26.1 smoke); the TS schema is defense-in-depth + good client errors. Note in the Dev Agent Record which CR 26.1 items the schema closes (the rest remain server-side / Story-26.3-smoke-covered).

### Timestamp formatting (CORRECTED — Story 26.0 AC 26.0.4; NO horologToIso)

- There is NO `horologToIso` helper in the interop package and none is needed: the resend/preview timestamps come from `SELECT ... TimeCreated` and arrive as an ODBC string (e.g. `"2026-07-02 10:00:01.298"`), never raw `$HOROLOG`. Do NOT import a nonexistent helper.
- If ISO-8601 `T`/`Z` output is wanted for consistency with other tools, write a SMALL local transform in `message-resend.ts` (`" " → "T"`, append `"Z"`) and preserve the raw ODBC string in a `*Raw` field (Rule #11 spirit). Otherwise pass the ODBC string through. Unit-test whichever you choose.

### Constraints

- TS-only: no ObjectScript, no bootstrap change (26.1 already deployed the handlers + bumped `BOOTSTRAP_VERSION`). `bootstrap-classes.ts` / `BOOTSTRAP_VERSION` must NOT change in this story.
- Strictly additive (Rule #19): no existing tool/output changes; only the new tool + its governed keys are added.
- structuredContent must be an object (memory); toStructured() helper; no `.refine()` on Zod schemas (breaks MCP JSON-schema emission — memory `feedback_mcp_structured_content`).
- Tests in the DEFAULT vitest suite (Rule #21) — not `*.integration.test.ts`.

### References

- [Source: _bmad-output/planning-artifacts/research/feature-specs/04-message-resend.md §§3, 5 (probe-amended)]
- [Source: packages/iris-interop-mcp/src/tools/diagram.ts (analog), tools/index.ts (registration), __tests__/index.test.ts (counts 21→22 / 22→23)]
- [Source: packages/shared/src/governance*.ts (mutates classification, defaultSeed, assertGovernanceClassification), governance-baseline.ts (frozen 1e62c5ad5bf7)]
- [Source: src/ExecuteMCPv2/REST/MessageResend.cls (Story 26.1 endpoints the tool calls), 26-1-resend-objectscript-handler.md (deferred CR 26.1 LOW items)]

## Tasks / Subtasks

- [x] Task 1 (AC 26.2.1): Create `message-resend.ts` — tool def (name/annotations/scope/mutates-map), Zod inputSchema (action enum + per-action fields), handler routing to the 3 endpoint calls, structured output via toStructured(). Description per spec §5 (actions, default-disabled writes + IRIS_GOVERNANCE snippet, dry-run-first, caps, duplication hazard).
- [x] Task 2 (AC 26.2.2): Register in `tools/index.ts`; update `index.test.ts` counts (21→22 package, 22→23 advertised) + any cross-server/governance key-universe expectations. Verify `gen:governance-baseline:check` exit 0 (frozen untouched); `assertGovernanceClassification` passes.
- [x] Task 3 (AC 26.2.2): Governance unit tests (`message-resend-governance.test.ts` or in a governance test) — resend/resendFiltered default-disabled under empty IRIS_GOVERNANCE via real `handleToolCall`; explicit enable works; preview enabled by default.
- [x] Task 4 (AC 26.2.3): Unit tests (`message-resend.test.ts`) — schema validation (numeric headerIds bounds, action enum, item+from required, maxMessages bounds, boolean dryRun/confirm), guard-refusal envelope passthrough (mock the endpoint returning a 26.1 refusal → tool surfaces it as an error, not a crash), per-header result mapping incl. partial failure, timestamp formatting. Note which deferred CR 26.1 LOW items the schema closes.
- [x] Task 5: `pnpm --filter @iris-mcp/interop test` + `pnpm --filter @iris-mcp/interop build` green; `pnpm gen:governance-baseline:check` exit 0; type-check + lint clean.

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5), via `bmad-dev-story` skill.

### Debug Log References

No `^ClineDebug` global needed — TS-only story, no ObjectScript/live-IRIS work. All verification via `pnpm --filter @iris-mcp/interop {build,test,lint,type-check}` and `pnpm gen:governance-baseline:check`.

### Completion Notes List

- Built `iris_message_resend` (`packages/iris-interop-mcp/src/tools/message-resend.ts`) modeled on `diagram.ts` (structured-output analog) and `defaultSettings.ts`/`item.ts` (per-action `mutates` map style). Three actions route to the Story 26.1 endpoints: `preview` → `POST /interop/message/resend/preview`; `resend`/`resendFiltered` → `POST /interop/message/resend` with `{action, ...}`. `namespace` resolved via `ctx.resolveNamespace` and passed on the wire for every action.
- **`mutates`**: `{ preview: "read", resend: "write", resendFiltered: "write" }`. No `defaultEnabled` (Rule #32 — resend duplicates data flow downstream, not a recovery-of-last-resort like `clean`), per spec §preamble and story Dev Notes.
- **Cross-field validation without `.refine()`** (story Constraints — `.refine()` breaks MCP JSON-schema emission): `resendFiltered`'s "item+from required" and `preview`/`resend`'s "headerIds required" are enforced in the HANDLER (returning a clean `isError` tool result before any HTTP call), not via `z.object(...).refine(...)`. This is a deliberate divergence from the one pre-existing `.refine()` usage found in `production.ts` (`start`/`restart` requiring `name`) — that precedent was not followed here because the story explicitly forbids `.refine()` for this tool; flagging for the Epic 26 retro as a possible future cleanup candidate for `production.ts` too, not in scope here.
- **CR 26.1 LOW items closed at the TS schema layer** (see Dev Notes "Zod schema — tighten..."):
  - CR 26.1-1 (`dryRun`/`confirm` non-boolean coercion) — CLOSED: `z.boolean()` (not coerced) rejects `"true"`/`1`/etc. outright; regression-tested.
  - CR 26.1-3 (`headerIds` JSON-object accepted) — CLOSED: `z.array(headerIdSchema).min(1).max(100)` rejects a non-array (JSON object) outright; each element validated numeric via `z.union([z.string().regex(/^\d+$/), z.number().int().positive()])`; regression-tested.
  - CR 26.1-5 (non-integer `maxMessages` into `TOP`) — CLOSED: `z.number().int().min(1).max(500)` rejects a non-integer; regression-tested.
  - CR 26.1-2 (bare-date `to` excludes final day), CR 26.1-4 (filtered-execute composition untested), CR 26.1-6 (execute-path fetch-failure swallowed) — remain server-side / Story-26.3-live-smoke-covered; not addressable at the TS schema layer (documented in the test file header for traceability).
- **Timestamp formatting** (Story 26.0 AC 26.0.4 correction — no `horologToIso`): wrote a small local `odbcToIso()` transform (`" " -> "T"`, append `"Z"`) applied to `preview`'s `timeCreated`/`timeProcessed` and `resendFiltered` dry-run sample rows' `timeCreated`; the original ODBC string is preserved in a sibling `*Raw` field (e.g. `timeCreatedRaw`). No import of any nonexistent helper. Unit-tested both the conversion and the `*Raw` preservation, plus the "absent field stays absent" edge (no spurious `*Raw` key when the source field is missing).
- **`toStructured()` helper**: no shared/exported version exists (`toStructured` is package-local to `iris-data-mcp/docdb.ts`, not published via `@iris-mcp/shared`) — added a local copy in `message-resend.ts` mirroring that implementation (array→`{items,count}` wrap; object passthrough), used as defense-in-depth since every response shape from `MessageResend.cls` is already an object.
- Per-header result mapping (partial failure): both `resend` and `resendFiltered`-executed responses map `{originalId, newHeaderId?, ok, error?}` through verbatim (via `toStructured`) and render a human-readable summary line (`"N/M succeeded, K failed"`) plus one line per header (`"#id -> new header #X"` or `"#id FAILED: <error>"`); unit-tested with a mixed success/failure batch.
- Counts: interop package `tools` array 21→22; `index.test.ts` updated: `tools` length 22, advertised `toolCount` 23, `getToolNames()`/`getTool()` length+lookups 23, all three new tool-name assertions added (`iris_message_resend`).
- Governance: `pnpm gen:governance-baseline:check` → exit 0 both before and after — frozen foundation 141 keys unchanged; live keys 194→197 (+3: `iris_message_resend:preview|resend|resendFiltered`); post-foundation-allowed 53→56. `git status` confirms `governance-baseline.ts`/`baseline-classifications.ts` untouched. `assertGovernanceClassification` passes implicitly (proven by `index.test.ts`'s `McpServerBase` construction tests all passing — a missing classification throws at registration).
- Full verification: `pnpm --filter @iris-mcp/interop build` clean; `pnpm --filter @iris-mcp/interop test` → 314/314 passed across 20 files (35 new in `message-resend.test.ts`, 5 new in `message-resend-governance.test.ts`, plus the `index.test.ts` count updates); `pnpm --filter @iris-mcp/interop lint` clean; `pnpm --filter @iris-mcp/interop type-check` clean. Re-ran the full `@iris-mcp/shared` suite (686/686, 35 files) and `@iris-mcp/all` suite (34/34, 5 files, including `readonly-hint-crosscheck.test.ts` and `validate-prompts.test.ts` which dynamically enumerate all live tools) after rebuilding `dist` — no regressions; the new post-foundation governance keys are correctly outside the frozen-baseline-scoped `readOnlyHint` cross-check (Rule #44), so that test's scope was unaffected.
- README/`tool_support.md`/per-server docs rollup intentionally NOT touched — out of this story's task scope (Story 26.3 owns the docs+smokes rollup per spec §6.4).

### File List

- `packages/iris-interop-mcp/src/tools/message-resend.ts` (new)
- `packages/iris-interop-mcp/src/tools/index.ts` (modified — import + register `messageResendTool`, updated header doc comment)
- `packages/iris-interop-mcp/src/__tests__/index.test.ts` (modified — counts 21→22/22→23/22→23, added `iris_message_resend` assertions)
- `packages/iris-interop-mcp/src/__tests__/message-resend.test.ts` (new)
- `packages/iris-interop-mcp/src/__tests__/message-resend-governance.test.ts` (new)

## Review Findings

Code review 2026-07-09 (Blind Hunter + Edge Case Hunter + Acceptance Auditor). Result: **0 HIGH, 0 MEDIUM unresolved.** Acceptance Auditor confirmed all three ACs (26.2.1/26.2.2/26.2.3) and every constraint genuinely satisfied — governance test uses the REAL `handleToolCall` gate with a strict `toEqual` on the `GOVERNANCE_DISABLED` envelope; frozen baseline `1e62c5ad5bf7` untouched (`gen:governance-baseline:check` exit 0, live 197 / frozen 141); `@iris-mcp/all` cross-check 34/34 (the new post-foundation keys are correctly outside the frozen-baseline-scoped Rule #44 `readOnlyHint` cross-check). Interop suite 319/319 green after the patch.

- [x] [Review][Patch] `headerIdSchema` string arm accepted `"0"`/`"007"` while the numeric arm rejected `0` — asymmetric validation; `"007"` would silently resolve to header 7 on the write path [packages/iris-interop-mcp/src/tools/message-resend.ts:65] — **FIXED**: tightened `/^\d+$/` → `/^[1-9]\d*$/` (symmetric with the numeric `.positive()` arm and the schema's "positive integer" contract) + regression test in `message-resend.test.ts` asserting `"0"`/`"00"`/`"007"` are rejected. (Blind Hunter MED / Edge Hunter LOW, merged.)
- [x] [Review][Defer] Handler dereferences `result.summary` / branches on `result.dryRun` without the `?? []`-style guard its siblings get; a malformed HTTP-200 (contract drift) would throw a `TypeError` re-thrown as an opaque crash instead of a clean `isError` envelope [packages/iris-interop-mcp/src/tools/message-resend.ts:418,455,471] — deferred as **CR 26.2-1 / LOW** (Epic-26-own, NOT reachable with the current Story 26.1 server which always emits `summary` + boolean `dryRun`; asymmetric defense-in-depth only). See `deferred-work.md` → "code review of story-26.2".

Dismissed as noise: dry-run `from`/`to` filter-echo fields not ISO-converted (they are the server's normalized filter echoes, not row timestamps; spec §3 only mandates row-timestamp ISO formatting — acceptable by design).
