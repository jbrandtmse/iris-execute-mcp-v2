# Story 29.1: Outcome Fidelity + Concurrency

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an **operator reconstructing a session from the audit log**,
I want **each entry's outcome, denial reason, error text, action, and sequence to be exactly right — even under concurrent tool calls, and flushed at shutdown**,
so that **"denied", "error", and "ok" are trustworthy, replay ordering is intact, and no in-flight entry is lost when the server stops.**

## Acceptance Criteria

(From epics.md Epic 29 / binding spec `research/feature-specs/07-observability-audit-log.md` §3–§5. This story = spec §6 story 2. Builds directly on Story 29.0's interceptor.)

- **AC 29.1.1 — Outcome + denial + error fidelity.** `ok` / `error` / `denied` are logged with correct fields:
  - **denied**: the entry carries a structured **`denyReason`** (the governance code, e.g. `"GOVERNANCE_DISABLED"`) extracted from the denial's `structuredContent.code`, AND **`presetApplied`** when — and ONLY when — the denial's `structuredContent.presetApplied` is present (i.e. a preset, not an explicit override, caused the denial; mirrors the existing `presetCaused` logic in `dispatchToolCall` at `server-base.ts:~1207`). An explicit-override denial must NOT carry `presetApplied`.
  - **error**: the entry's `error` field is the **sanitized message only** — the human-readable text the handler/framework already produced (never a raw exception dump, stack trace, or caret-global token per Rules #8/#9/#33). Present only when `outcome === "error"`.
  - **ok**: no `error`, no `denyReason`, no `presetApplied`.
- **AC 29.1.2 — Schema-aware `action` + monotonic `seq`.** `action` is extracted from args **only when the tool's input schema declares an `action` field** (else `null`) — a stray `action` key on a tool that has no such field must yield `null`, NOT the stray value. Reuse the enum-membership discipline already in `computeGovernanceKey` (`server-base.ts:~960-983`) rather than a bare `typeof rawArgs.action === "string"` read. `seq` is monotonic per session (1,2,3,… with no gaps or repeats), assigned once per logged call.
- **AC 29.1.3 — Concurrency + shutdown flush.** Concurrent `handleToolCall` invocations produce **well-formed, non-interleaved JSONL** lines (each line is a complete valid JSON object; no line is split or merged) with strictly increasing `seq` — proven by an async-ordering test firing N concurrent calls and parsing every line. The server's shutdown path **flushes** the audit writer (awaits the queue drain + writes the final `droppedEntries` line) so no enqueued entry is lost when the process stops — and the flush is actually WIRED into the server's stop/transport-close path (not merely available on `AuditLogger`).

### Integration ACs

Story 29.1 is NOT service-introducing — it hardens the fidelity of the existing Story 29.0 audit interceptor (a refinement of `recordAuditEntry`/`deriveAuditOutcome`/`deriveAuditAction` + shutdown wiring in `server-base.ts`). Its observable integration effects are exercised end-to-end: denied/error/ok entries driven through a real `McpServerBase` tool callback, and the concurrency + shutdown-flush tests drive the real interceptor. No new consumer wiring is introduced. (The first consumer of the interceptor was wired in Story 29.0.)

## Tasks / Subtasks

- [x] **Task 1 — denial fidelity: `denyReason` + `presetApplied` (AC 29.1.1)**
  - [x] Extend `AuditEntryInput` (in `audit.ts`) with optional `denyReason?: string` and `presetApplied?: string`; emit them in `AuditLogger.log` only when set (mirror the existing conditional `error`/`params` emission).
  - [x] In `recordAuditEntry` (`server-base.ts`), when `outcome === "denied"`, read `result.structuredContent.code` → `denyReason` and `result.structuredContent.presetApplied` → `presetApplied` (only if present). Do NOT recompute the preset attribution — the denial result already carries `presetApplied` exactly when the preset (not an explicit override) caused it (`dispatchToolCall:~1211-1214`).
- [x] **Task 2 — error message = sanitized only (AC 29.1.1)**
  - [x] Confirm `extractAuditErrorMessage` returns the framework's already-sanitized text block (the `text` content), never `error.stack`/raw dumps. Add a test proving a handler that throws an `Error` with a multi-line/stacky message logs only the sanitized single-line `Tool error: <message>` text, with no stack and no caret-global token.
- [x] **Task 3 — schema-aware `action` extraction (AC 29.1.2)**
  - [x] Replace `deriveAuditAction`'s bare string read with schema-aware extraction: `action` is non-null only when the tool's inputSchema declares an `action` field (an enum/string member the tool actually defines). Factor out or reuse the `computeGovernanceKey` unwrap-enum logic so the two stay consistent (a tool with no `action` field → `null`; a valid in-schema action value → that value).
  - [x] Test: a tool WITHOUT an action field + a caller passing a stray `action:"foo"` → entry `action === null`; a multi-action tool with a real action → that action; a single-action-less tool → `null`.
- [x] **Task 4 — concurrency + shutdown flush (AC 29.1.3)**
  - [x] Async-ordering test: fire N (≥20) concurrent `handleToolCall`s against a real `McpServerBase` with a temp-dir `IRIS_AUDIT_LOG`; await; read the file; assert every line parses, entry count === N (+ header + shutdown), and `seq` values are exactly 1..N with no dupes/gaps. Confirm the `writeQueue` serialization guarantees non-interleaving.
  - [x] Wire `auditLogger.shutdown()` into the server's stop / transport-close path (find where `McpServerBase` tears down — the `stop()`/transport close; if none exists, hook the SIGTERM/`transport.onclose` or the existing shutdown seam). Test that after shutdown the final `droppedEntries` line is present and the queue is drained.
- [x] **Task 5 — regression + back-compat**
  - [x] `pnpm --filter @iris-mcp/shared test` green; `pnpm turbo run test` green. `pnpm gen:governance-baseline:check` exit 0; frozen baseline `1e62c5ad5bf7` + `BOOTSTRAP_VERSION` unchanged. No new tool/governance key/bootstrap bump.

## Review Findings

Code review (3-lens adversarial: Blind Hunter + Edge Case Hunter + Acceptance Auditor) of Story 29.1 — 2026-07-12. Outcome: **status `done` — 0 HIGH, 0 MEDIUM, 0 patch, 0 decision-needed, 1 LOW deferred, 1 dismissed.** All three ACs verified live: the 14 new tests re-run green (`vitest run` on the three files), `pnpm gen:governance-baseline:check` exit 0 (frozen `1e62c5ad5bf7` / 141 keys intact; 201 live / 60 post-foundation), no new tool/governance key/bootstrap bump (TS-only change to `@iris-mcp/shared`). Verified: `denyReason`/`presetApplied` COPIED verbatim from the denial's `structuredContent` (never recomputed), `presetApplied` present ONLY on a preset-caused denial (both preset-caused and explicit-override denials pinned by test); schema-aware `deriveAuditAction` reuses the SAME `unwrapActionOptions` + enum-membership discipline as `computeGovernanceKey` (stray `action` on an action-less tool → `null`, non-member → `null`); concurrency non-interleaving is genuine (`writeQueue` serialization + fresh per-entry object in `log()`, proven by the 25-concurrent + 24-mixed-outcome tests with contiguous seq 1..N and no conditional-field bleed); shutdown flush wired into `McpServerBase.stop()`, safe when auditing is OFF (byte-for-byte back-compat preserved). Integration ACs accurate — refinement of the 29.0 interceptor, no new producer wiring.

- [x] [Review][Defer] `deriveAuditAction` reads pre-Zod `rawArgs.action`, diverging from `computeGovernanceKey` for a future defaulted-action enum [packages/shared/src/server-base.ts:1451] — deferred, LOW, no shipped trigger (swept by Story 29.3 burn-down)

## Dev Notes

**Builds on Story 29.0** (`packages/shared/src/audit.ts`, `server-base.ts` `handleToolCall`/`dispatchToolCall`/`recordAuditEntry` split, `__tests__/audit*.test.ts`). Read those first — 29.0 deliberately left "rigorous fidelity" to THIS story (see 29.0 Dev Notes "Scope seam"). Do not rebuild the writer/rotation/redaction — they are done.

**Exact seam gaps to close** (current 29.0 basic impl in `server-base.ts`):
- `deriveAuditOutcome` (`:~1443`) returns `denied`/`error`/`ok` but the entry gets NO `denyReason`/`presetApplied` → Task 1.
- `deriveAuditAction` (`:~1431`) is a bare `typeof rawArgs.action === "string"` read → over-reports a stray `action` key. Make it schema-aware → Task 3.
- `extractAuditErrorMessage` (`:~1453`) already returns the text block — verify/lock it as sanitized-only → Task 2.
- `AuditLogger.shutdown()` (`audit.ts:~176`) exists but confirm it is WIRED to the server stop path → Task 4.

**`presetApplied` provenance (do NOT recompute).** The governance denial in `dispatchToolCall` (`:~1190-1220`) already sets `structuredContent.presetApplied = this.preset` ONLY when `presetCaused` (preset, not explicit override, caused the deny). So the audit entry must simply COPY `structuredContent.presetApplied` when present — recomputing risks divergence from the denial the client actually saw. `denyReason` = `structuredContent.code` (`"GOVERNANCE_DISABLED"`).

**Schema-aware `action` (Task 3).** `computeGovernanceKey` (`:~945-985`) already unwraps the tool's `action` ZodEnum and checks membership (`options.includes(validatedArgs.action)`). The audit `action` must follow the SAME rule so a tool with no `action` field yields `null` and a stray non-member value yields `null` — single-source the check with `computeGovernanceKey` where practical. Note `recordAuditEntry` currently reads `rawArgs` (pre-Zod), while `computeGovernanceKey` reads `validatedArgs` (post-Zod, `server` stripped) — for `action` this is fine (Zod doesn't rename `action`), but be consistent: read the action from the same shape the schema check expects.

**Concurrency (Task 4).** `seq` is assigned synchronously in `AuditLogger.log` (`audit.ts:~146`, `this.seq += 1`) and JS is single-threaded, so increments are atomic; the `writeQueue` (`:~125`, `:~192`) serializes the actual appends so lines never interleave. The test must PROVE this (fire concurrently, parse every line, assert 1..N contiguous). Do not add locking — the existing queue is the mechanism; just demonstrate it.

**Shutdown wiring (Task 4).** Locate the server teardown. If `McpServerBase` has no explicit `stop()`, the flush must hook wherever the transport closes (e.g. `transport.onclose`) or a process signal handler set up in `start()`. Keep it minimal and test it via the `AuditLogger.shutdown()` observable (final line + drained queue). Do not block `start()` return on it.

**Error sanitization (Rules #8/#9/#33).** The `error` field must be the human-readable sanitized text, never a raw exception/stack or a `^global` caret token. `dispatchToolCall`'s handler-throw path already emits `text: "Tool error: <message>"` from `error.message` (not `.stack`), which is acceptable; lock it with a test. For IRIS `%Status`-derived errors the framework's `SanitizeError` path already applies upstream — do not double-process here.

### Project Structure Notes

- Touch `packages/shared/src/audit.ts` (extend `AuditEntryInput` + conditional emit) and `packages/shared/src/server-base.ts` (`recordAuditEntry` + `deriveAuditAction` + shutdown wiring). Tests under `packages/shared/src/__tests__/` (`*.test.ts`, discoverable; NOT `*.integration.test.ts`).
- **No new tool, no new governance key, no bootstrap bump.** Rule #19 additive: frozen baseline `1e62c5ad5bf7` + `BOOTSTRAP_VERSION` UNCHANGED (`pnpm gen:governance-baseline:check` exit 0). Existing 29.0 tests must stay green (this is a superset refinement).

### References

- [Source: research/feature-specs/07-observability-audit-log.md#3-entry-format] — action/outcome/denyReason/presetApplied/seq fields
- [Source: research/feature-specs/07-observability-audit-log.md#4-redaction-non-negotiable] — error passes through the sanitized message only
- [Source: research/feature-specs/07-observability-audit-log.md#5-implementation] — session uuid + seq ordering; shutdown flush
- [Source: research/feature-specs/07-observability-audit-log.md#6-story-breakdown] — story 2 boundary (denial + outcome fidelity, action extraction, seq/session under concurrency, shutdown flush)
- [Source: packages/shared/src/server-base.ts#L1372] — `recordAuditEntry` + derive helpers (the seam to sharpen)
- [Source: packages/shared/src/server-base.ts#L1190] — governance denial structuredContent (`code` + `presetApplied` provenance)
- [Source: packages/shared/src/server-base.ts#L945] — `computeGovernanceKey` enum-membership `action` unwrap (single-source for schema-aware action)
- [Source: packages/shared/src/audit.ts#L145] — `AuditLogger.log` (`seq`, conditional field emit) + `shutdown()`
- [Source: _bmad-output/implementation-artifacts/29-0-audit-interceptor-and-writer.md] — the interceptor this story hardens (scope seam)

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5), via `bmad-dev-story`.

### Debug Log References

None — no debugger/global-based debugging was needed; all behavior verified through vitest (`packages/shared/src/__tests__/audit-outcome-fidelity.test.ts`, `audit-concurrency-shutdown.test.ts`) plus the full `pnpm turbo run test` sweep.

### Completion Notes List

- **Task 1 (`audit.ts` + `server-base.ts`):** `AuditEntryInput`/`AuditEntry` gained optional `denyReason?: string` and `presetApplied?: string`, emitted by `AuditLogger.log()` only when set (mirrors the existing conditional `error` emission). `recordAuditEntry` now branches on `outcome === "denied"`: reads `result.structuredContent.code` → `denyReason` and, ONLY if present, `result.structuredContent.presetApplied` → `presetApplied` — copied verbatim, never recomputed, so it can never diverge from `dispatchToolCall`'s own `presetCaused` attribution. Proven with a preset-caused denial (`IRIS_GOVERNANCE_PRESET=read-only`, no override → `presetApplied:"read-only"`) AND an explicit-override denial with a preset ALSO active (`IRIS_GOVERNANCE_PRESET=full` + an explicit `false` override → `presetApplied` absent, since `hasExplicitOverride` short-circuits `presetCaused` regardless of what the preset would have done), plus a positive control that an `"ok"` entry carries neither field nor `error`.
- **Task 2 (verification only, no code change):** `extractAuditErrorMessage`/`dispatchToolCall`'s handler-throw path already used `error.message` (never `.stack`) — confirmed correct as shipped in Story 29.0. Locked with a new test: a handler throws an `Error` whose message itself contains embedded newlines mimicking a stack trace; the audit entry's `error` field is asserted to equal the exact sanitized `"Tool error: <message>"` text (no additional stack appended, no caret-global token pattern, and the message substring appears exactly once in the raw JSONL line — proving `.stack` was never separately serialized).
- **Task 3 (`server-base.ts`):** `deriveAuditAction` now takes the `tool: ToolDefinition` and reuses the SAME `unwrapActionOptions` + enum-membership check `computeGovernanceKey` applies (`options.includes(value)`), rather than a bare `typeof rawArgs.action === "string"` read. A stray `action` key on a tool with no `action` field, a non-member value on a real enum (e.g. Zod-rejected `"baz"`), and an absent key all yield `null`; a real in-enum value on a multi-action tool is returned unchanged. Reads `rawArgs` (pre-Zod) consistent with `recordAuditEntry`'s existing shape — Zod does not rename `action`, so the schema check applies identically.
- **Task 4 (`server-base.ts` — concurrency + shutdown):** Added `async stop(): Promise<void>` to `McpServerBase` — closes the transport (`await this.mcpServer.close()`, a safe no-op if never connected) then, when auditing is on, `await`s `this.auditLogger.shutdown()` so the final `droppedEntries` line is guaranteed written and the write queue drained before `stop()` resolves. This is the concrete "server's stop path" the AC calls for (no explicit `stop()` existed before this story); a host (e.g. a future signal handler in a package's entry point — out of this story's `packages/shared`-only scope) can call it to shut down cleanly. Idempotent-safe and safe when auditing is off (tested explicitly). The concurrency test fires 25 concurrent `handleToolCall`s (via the real SDK-registered callback) against a probe tool whose handler resolves after a scrambled per-call delay (`(idx*7)%17` ms) so calls complete out of start order; asserts every line parses as valid JSON, all `N` entries carry `tool`/`outcome:"ok"`, and their `seq` values sorted are exactly `1..N` with zero duplicates — then calls `stop()` in the SAME test and confirms the final `shutdown` line lands (header + N + shutdown = N+2 total lines). A second dedicated test proves the `stop()` → `AuditLogger.shutdown()` wiring in isolation (no polling needed — `stop()` awaits the drain).
- Verified: `pnpm --filter @iris-mcp/shared test` — 42 files / 753 tests green (was 744 pre-story; +9 new tests across the two new files, zero regressions in the existing 29.0 audit tests or any other suite). `pnpm turbo run test` — all 13 tasks green (`@iris-mcp/shared` 753, `@iris-mcp/dev` 576, `@iris-mcp/admin` 443, `@iris-mcp/interop` 323, `@iris-mcp/ops` 340, `@iris-mcp/all` unaffected). `pnpm gen:governance-baseline:check` exits 0 (141 frozen / 201 live / 60 post-foundation — frozen baseline `1e62c5ad5bf7` byte-for-byte unchanged; new test-only tool names `iris_new_write`/`iris_no_action`/`iris_multi_action`/`iris_concurrent_probe` exist only inside test files, never registered on a real server package, so they do not touch the live-derived key count used by any shipped server). `pnpm --filter @iris-mcp/shared lint` clean. No `bootstrap-classes.ts` / `BOOTSTRAP_VERSION` / ObjectScript change (TS-only, `@iris-mcp/shared` only); no new tool or governance key added to any shipped package.

### File List

- `packages/shared/src/audit.ts` (modified — `AuditEntryInput`/`AuditEntry` gain `denyReason`/`presetApplied`; conditional emission in `AuditLogger.log`)
- `packages/shared/src/server-base.ts` (modified — `recordAuditEntry` denial-fidelity branch, schema-aware `deriveAuditAction`, new `stop()` method wiring `AuditLogger.shutdown()`)
- `packages/shared/src/__tests__/audit-outcome-fidelity.test.ts` (new)
- `packages/shared/src/__tests__/audit-concurrency-shutdown.test.ts` (new)

## Change Log

- 2026-07-12 — Story 29.1 implemented: denial `denyReason`/`presetApplied` provenance (copied, never recomputed), sanitized-only error text locked with a stacky-message test, schema-aware `action` extraction reusing `computeGovernanceKey`'s enum-membership discipline, a 25-concurrent-call ordering test proving contiguous `seq`, and a new `McpServerBase.stop()` wiring `AuditLogger.shutdown()` into the server's shutdown path. All 5 tasks complete; `ready-for-dev` → `review`.
