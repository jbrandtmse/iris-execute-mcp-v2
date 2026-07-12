# Story 29.0: Audit Interceptor + Writer

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an **operator running an MCP server against a regulated (healthcare) IRIS instance**,
I want **every tool call optionally recorded as a structured, secrets-free JSONL audit entry via a single interception point**,
so that **I can answer "what did the AI do to prod last Tuesday?" — including governance denials — without changing any tool, and with a mechanically-proven zero-cost when auditing is off.**

## Acceptance Criteria

(From epics.md Epic 29 / binding spec `research/feature-specs/07-observability-audit-log.md` §2–§6. This story = spec §6 story 1.)

- **AC 29.0.1 — Config + startup fail-fast + session header.** Parse `IRIS_AUDIT_LOG` (unset = OFF), `IRIS_AUDIT_LOG_MAX_MB` (default `50`), `IRIS_AUDIT_LOG_PARAMS` (default `false`). When `IRIS_AUDIT_LOG` is set, verify the target file's **directory is writable at startup**; if not, **fail fast** (`process.exit(1)` path, mirroring the health-check failure in `start()`) with a clear message naming `IRIS_AUDIT_LOG` — an operator who configured auditing must NOT run unaudited silently. On first log open, write a `sessionStart` header line (session UUID + server package name + version). Malformed `IRIS_AUDIT_LOG_MAX_MB` (non-positive / non-numeric) fails fast at startup naming the var (mirrors `IRIS_SQL_MAX_ROWS` parsing in `config.ts`).
- **AC 29.0.2 — Entry format + redaction (non-negotiable).** Each entry is one JSON object per line per spec §3 with fields: `ts` (ISO), `session` (uuid), `seq` (per-session monotonic), `serverPkg`, `tool`, `action` (see §Scope note — basic extraction here; full fidelity is 29.1), `profile`, `namespace`, `outcome`, `durationMs`, `paramKeys`; `params` present **only** when `IRIS_AUDIT_LOG_PARAMS=true` (redacted); `error` only when outcome=error (sanitized message). Redaction per spec §4: recursive walk replacing the VALUE of any key matching (case-insensitive) `password|passwd|secret|token|credential|apikey|api_key|authorization` with `"[REDACTED]"`, and truncating any remaining string value > 2 KB to first 256 chars + `"[TRUNCATED]"`. Redaction happens BEFORE anything reaches the write queue. **Fuzz tests: nested objects, arrays of objects, key-case variants. A test asserts a synthetic call carrying a password in THREE nesting positions produces a log line with ZERO occurrences of the value.**
- **AC 29.0.3 — Queue + rotation + degrade-never-throw.** In-process append queue → `fs.appendFile`; size check per write (cheap cached `stat`, re-stat every N writes) rotating at `IRIS_AUDIT_LOG_MAX_MB` by renaming `<path>` → `<path>.1` (single generation, overwriting a prior `.1`). A **post-startup** sink failure (e.g. the file becomes unwritable mid-session) must NEVER throw into or slow the tool path: swallow, emit exactly one `logger.warn`, increment a `droppedEntries` counter; a final flush line records `droppedEntries` at shutdown.
- **AC 29.0.4 — Unset ⇒ mechanical no-op (Rule #19).** With `IRIS_AUDIT_LOG` unset, `handleToolCall` behavior is byte-for-byte today's: a snapshot/`toEqual` of `handleToolCall`'s `CallToolResult` for a representative ok call is identical with and without the audit module present, AND a spy asserts **no `fs` write is attempted**. Positive counterpart: with a temp-dir `IRIS_AUDIT_LOG` set, the same call writes exactly one well-formed entry line (after the session header).

### Integration ACs

Story 29.0 is service-introducing (new `audit.ts` module) AND wires its only consumer in the same story: the interceptor is installed at the `handleToolCall` choke point in `server-base.ts`, so AC 29.0.4's positive path (audit ON → a real `handleToolCall` produces exactly one entry) is the observable producer→consumer integration effect. Later consumers: Story 29.1 (outcome/action/seq fidelity + concurrency) and Story 29.2 (docs + live smokes). No separate future-consumer declaration needed.

## Tasks / Subtasks

- [x] **Task 1 — `audit.ts` module + config (AC 29.0.1, 29.0.2)**
  - [x] Create `packages/shared/src/audit.ts` exporting an `AuditLogger` class (or factory) and a `parseAuditConfig(env = process.env)` fn returning `{ path?: string; maxBytes: number; includeParams: boolean }` (or `undefined`/disabled when `IRIS_AUDIT_LOG` unset). Follow `config.ts` parsing idiom (explicit `Number()` + validation that throws a message naming the env var).
  - [x] Redaction helper: recursive walk (objects + arrays), case-insensitive key match against the spec §4 family, value → `"[REDACTED]"`; then 2 KB string truncation → first 256 chars + `"[TRUNCATED]"`. Pure function, unit-testable in isolation. Do not mutate the caller's args object (clone).
  - [x] Session identity: `crypto.randomUUID()` created once per `AuditLogger` instance (server process). `sessionStart` header line written on first open with `{ session, serverPkg, version }`.
- [x] **Task 2 — writer: queue, append, rotation, degrade (AC 29.0.3)**
  - [x] Serialize entry → single-line JSON → append via `fs.appendFile` (or an appended write stream). Flush-per-entry is acceptable at MCP call rates. NEVER `await` in a way that blocks the tool result to the client — fire-and-forget with error swallow (see Dev Notes on ordering).
  - [x] Rotation: cached `stat` size, re-stat every N writes; at threshold rename `<path>` → `<path>.1` (overwrite existing `.1`), then continue writing to a fresh `<path>`.
  - [x] Post-startup sink error → swallow + one `logger.warn` + `droppedEntries++`. Expose a `shutdown()`/`flush()` that writes a final line with `droppedEntries`.
- [x] **Task 3 — wire the interceptor at the choke point (AC 29.0.4)**
  - [x] In `server-base.ts` `start()`: after governance parse, `parseAuditConfig()`; if enabled, verify directory writable (fail fast via the existing `process.exit(1)` pattern used for the health-check failure) and construct the `AuditLogger` with `serverPkg = this.options.name`, `version = this.options.version`.
  - [x] Wrap `handleToolCall`: capture `start` time before the body; after it resolves, if audit is enabled, derive the entry (tool name; `paramKeys` from `rawArgs` keys minus the framework `server` key; `profile.name` / resolved namespace where determinable; `durationMs`; a BASIC `outcome` — see §Scope) and enqueue. When audit is OFF the wrap is a pure pass-through (no allocation on the hot path beyond a disabled-check).
- [x] **Task 4 — tests (all ACs)**
  - [x] `packages/shared/src/__tests__/audit.test.ts`: config parse (defaults, fail-fast on bad `MAX_MB`), redaction fuzz (nested/array/key-case) + the **three-nesting-position password zero-occurrence** test, entry shape, rotation (tiny `maxBytes`), degrade-on-unwritable (no throw, counter increments, final flush line).
  - [x] No-op proof in `server-base.test.ts` (or a new `audit-interceptor.test.ts`): `IRIS_AUDIT_LOG` unset → `handleToolCall` result `toEqual` baseline + `fs.appendFile` spy never called; `IRIS_AUDIT_LOG` = temp file → exactly one entry line after the header.
  - [x] Startup fail-fast test: unwritable dir → the `process.exit(1)` path (mock `process.exit` per the existing `start()` health-check test pattern).

## Dev Notes

**Binding spec:** `research/feature-specs/07-observability-audit-log.md` (§2 config, §3 entry, §4 redaction, §5 impl, §6 story 1, §7 ACs). Read `00-conventions.md` §6 for the docs/rollout checklist (Story 29.2 completes it — not this story).

**Interception point — the ONE choke point.** `McpServerBase.handleToolCall` (`packages/shared/src/server-base.ts:977`) is the single call site the SDK routes every tool through (the CallTool callback at ~`:909` calls `this.handleToolCall(tool, args)`). The governance gate lives here too (`:1087`+). Wrapping this method covers all five servers and all future tools with zero per-tool changes. It has MANY return points — Zod-fail (`:1021`), missing-schema (`:997`), not-initialised (`:1042`), profile-resolution error (`:1077`), **governance denial** (`:1150`, `structuredContent.code === "GOVERNANCE_DISABLED"`, `isError:true`), discovery short-circuit (`:1187`), client-establish failure (`:1223`), handler success (`:1268`), handler throw (`:1283`). The cleanest wrap: rename the existing body to a private `dispatchToolCall(...)` and have a thin `handleToolCall` that times it, `await`s it, then records the entry from the returned `CallToolResult` — so every return point is captured uniformly by inspecting the single resolved result.

**Ordering / fire-and-forget (spec §5).** Audit writing must NEVER fail or slow a tool call. Record the entry AFTER `dispatchToolCall` resolves, but do NOT `await` the file write before returning the result to the client — enqueue and return. A rejected write is swallowed (`.catch`) + `logger.warn` + `droppedEntries++`. Never let an audit error propagate out of `handleToolCall`.

**Scope seam vs Story 29.1 (do not over-build).** This story establishes: the module, config+fail-fast, redaction, queue, rotation, wiring, and the no-op proof — with a BASIC `outcome` derivation sufficient for well-formed entries (e.g. `denied` when `structuredContent.code === "GOVERNANCE_DISABLED"`; `error` when `isError === true`; else `ok`) and `action` from a straightforward args read. **Story 29.1 owns the rigorous fidelity**: structured `denyReason` (+ `presetApplied` attribution — mirror the `presetCaused` logic already at `:1129`), sanitized-`error`-message-only, schema-aware `action` extraction (null when the tool schema has no `action` field), strict per-session monotonic `seq` under concurrency, and shutdown flush guarantees. Keep the entry SHAPE complete here; leave the hard fidelity/concurrency guarantees to 29.1. Do not add a query/replay tool (`iris_audit_sessions` is phase 2 — spec §8, out of scope).

**Config idiom.** Follow `config.ts` `loadConfig` (`packages/shared/src/config.ts:60`): read from an injectable `env = process.env`, `Number()` + range check, throw an `Error` whose message names the env var. Mirror the `IRIS_SQL_MAX_ROWS` positive-integer validation for `IRIS_AUDIT_LOG_MAX_MB`.

**Logger.** Use the shared `logger` (`packages/shared/src/logger.ts:82`; `logger.warn(...)` writes to stderr) for the single degrade warning. Do NOT `console.log` (stdout is the MCP transport on stdio).

**Startup fail-fast pattern.** `start()` (`server-base.ts:1395`) already uses `logger.error(...)` + `process.exit(1)` + `return` (the mock-guard) for the health-check failure (`:1439`). Reuse that exact shape for the unwritable-audit-dir case. Parse audit config alongside `parseGovernanceConfig()`/`parseGovernancePreset()` (`:1418`/`:1426`).

**Namespace in the entry.** The default profile's namespace is `profile.namespace`; a per-call override is `validatedArgs.namespace` when present (precedence mirrors `resolveNamespace` at `:244`). Basic derivation is fine here; do not add a connection just to learn a namespace on a denied call (denials must not establish a client — see the gate comment at `:1092`).

### Project Structure Notes

- New module: `packages/shared/src/audit.ts`. Tests: `packages/shared/src/__tests__/audit.test.ts` (+ interceptor no-op test co-located). Vitest, `*.test.ts` naming — discoverable by the default `pnpm turbo run test` (NOT `*.integration.test.ts`, which is excluded from the default run).
- Export `AuditLogger` / `parseAuditConfig` from `packages/shared/src/index.ts` only if a test or another package needs them; the interceptor itself is internal to `server-base.ts`.
- **No bootstrap bump, no new tool, no new governance key** (Epic 29 is TS-only in `@iris-mcp/shared`). Do NOT touch `bootstrap-classes.ts`, the governance baseline, or any tool array. Logging is server CONFIGURATION, not a governed tool — it is deliberately NOT bypassable via `IRIS_GOVERNANCE` (spec §governance).
- **Additive / Rule #19:** the frozen governance baseline `1e62c5ad5bf7` and `BOOTSTRAP_VERSION` must be UNCHANGED. Verify `pnpm gen:governance-baseline:check` exits 0 and existing suites stay green.

### References

- [Source: research/feature-specs/07-observability-audit-log.md#2-configuration] — env vars + startup fail-fast
- [Source: research/feature-specs/07-observability-audit-log.md#3-entry-format] — entry fields
- [Source: research/feature-specs/07-observability-audit-log.md#4-redaction-non-negotiable] — redaction families + 2KB truncation + zero-occurrence test
- [Source: research/feature-specs/07-observability-audit-log.md#5-implementation] — interception point, fire-and-forget writer, rotation, session UUID
- [Source: research/feature-specs/07-observability-audit-log.md#6-story-breakdown] — story 1 boundary
- [Source: packages/shared/src/server-base.ts#L977] — `handleToolCall` choke point + all return points
- [Source: packages/shared/src/server-base.ts#L1395] — `start()` config-parse + fail-fast + `process.exit(1)` pattern
- [Source: packages/shared/src/config.ts#L60] — `loadConfig` env-parse idiom
- [Source: packages/shared/src/logger.ts#L82] — shared `logger`
- [Source: .claude/rules/project-rules.md] — Rule #19 (additive back-compat mechanical proof), Rules #8/#9/#33 (SanitizeError/redaction discipline to reuse)

## Review Findings

Code review 2026-07-11 (adversarial: Blind Hunter / Edge Case Hunter / Acceptance Auditor). 0 decision-needed, 2 patch (both applied), 0 deferred, 0 dismissed. Mechanical gates re-verified: `pnpm gen:governance-baseline:check` exit 0 (141 frozen keys unchanged), type-check clean, 91 shared tests green (35 audit + 56 server-base, no regressions). No new tool / governance key / bootstrap bump.

- [x] [Review][Patch] Fire-and-forget invariant: synchronous audit recording could throw into the tool path [packages/shared/src/server-base.ts:1360] — `handleToolCall` did not await `recordAuditEntry`, but the recording is SYNCHRONOUS (derivation + `redactValue` walk + `JSON.stringify`) and was unguarded; only the async file write was `.catch`-swallowed inside `AuditLogger`. A pathological args object (e.g. deep nesting overflowing the recursive redact walk under `IRIS_AUDIT_LOG_PARAMS=true`, or a non-serializable value) would throw out of `handleToolCall`, breaking the tool result the client is owed — a spec §5 violation. FIX: wrapped the `recordAuditEntry` call in try/catch → `logger.warn` + swallow, so audit work can never propagate out of the tool path. (MEDIUM — resolved)
- [x] [Review][Patch] `AuditLogger.maybeRotate` re-`stat`ed on EVERY write, defeating the cached-stat optimization [packages/shared/src/audit.ts:293] — the guard `writesSinceStat >= STAT_REFRESH_INTERVAL || writesSinceStat === 1` combined with resetting `writesSinceStat = 0` inside the block made the counter perpetually cycle 0→1, so `=== 1` fired every write and `STAT_REFRESH_INTERVAL` was dead. Correctness was unaffected (rotation stayed accurate) but it issued one extra `fs.stat` syscall per audit write, contradicting the "re-stat every N writes" intent stated in the code comment and spec §5. FIX: seed `writesSinceStat = STAT_REFRESH_INTERVAL` (first write still stats to pick up a pre-existing file) and drop the `|| === 1` clause, so a real stat now runs once per `STAT_REFRESH_INTERVAL` writes as intended. (LOW — resolved)

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5), via `bmad-dev-story`.

### Debug Log References

None — no debugger/global-based debugging was needed; all behavior verified through vitest (`packages/shared/src/__tests__/audit.test.ts`, `audit-interceptor.test.ts`).

### Completion Notes List

- New `packages/shared/src/audit.ts`: `parseAuditConfig()` (mirrors `config.ts`'s `IRIS_SQL_MAX_ROWS` idiom — fails fast naming `IRIS_AUDIT_LOG_MAX_MB`), `redactValue()` (recursive, non-mutating, case-insensitive key-family match + 2KB/256-char truncation), and `AuditLogger` (session UUID + `sessionStart` header, monotonic `seq`, serialized write queue via `fs.appendFile`, size-based rotation with cached-stat drift correction every 20 writes, degrade-never-throw with a `droppedEntries` counter, and a `shutdown()` flush).
- `server-base.ts`: renamed the former `handleToolCall` body to `dispatchToolCall` (unchanged logic/return points) and added a THIN `handleToolCall` wrapper — a pure pass-through with zero extra allocation when `IRIS_AUDIT_LOG` is unset (`this.auditLogger` stays `undefined`), or a timed call + fire-and-forget `recordAuditEntry(...)` when auditing is on. `start()` parses the audit config right after the governance/preset parses and fails fast (`process.exit(1)`, mirroring the health-check pattern) if the target directory isn't writable.
- Audit-entry derivation (`recordAuditEntry` + helpers) is deliberately BASIC per the story's scope seam: `outcome` from `structuredContent.code === "GOVERNANCE_DISABLED"` / `isError` / else `ok`; `action`/`namespace`/`profile` read straight off `rawArgs` (namespace falls back to the in-memory profile registry's default — never establishes a connection). Rigorous fidelity (structured `denyReason`, `presetApplied`, sanitized-error-only, schema-aware `action`, strict concurrent `seq`) is left to Story 29.1 as directed.
- Verified: `pnpm --filter @iris-mcp/shared type-check` clean; `pnpm --filter @iris-mcp/shared exec vitest run` — 39 files / 739 tests green (includes the new `audit.test.ts` [29 tests] and `audit-interceptor.test.ts` [4 tests], plus the existing `governance.test.ts` baseline-drift test and `server-base.test.ts`'s 56 pre-existing tests, all unaffected); `pnpm turbo run test` — all 13 packages green (2470 tests total, no regressions in any other server package); `pnpm gen:governance-baseline:check` exits 0 (141 frozen / 201 live / 60 post-foundation — unchanged frozen set, `iris_audit_sessions` NOT added since it's phase-2/out-of-scope); no `bootstrap-classes.ts` / `BOOTSTRAP_VERSION` / ObjectScript change (TS-only, `@iris-mcp/shared` only).
- AC 29.0.2's non-negotiable fuzz test (`audit.test.ts` — "produces zero occurrences of a password value nested in three positions") plants the same secret value under a top-level `password` key, a two-levels-deep case-variant `Token` key, and inside an array-of-objects `apiKey` key, then asserts the written JSONL line contains zero occurrences of the raw value.
- AC 29.0.4's negative/positive proof lives in `audit-interceptor.test.ts`: with `IRIS_AUDIT_LOG` unset, the `CallToolResult` is asserted `toEqual` a literal expected shape and a wrapped `fs.appendFile` spy is asserted never called; with it set to a real temp file, exactly one entry line (plus the `sessionStart` header) lands on disk after invoking the tool, its fields (`tool`/`action`/`profile`/`namespace`/`outcome`/`paramKeys`/`seq`) verified.

### File List

- `packages/shared/src/audit.ts` (new)
- `packages/shared/src/server-base.ts` (modified — audit interceptor wiring)
- `packages/shared/src/__tests__/audit.test.ts` (new)
- `packages/shared/src/__tests__/audit-interceptor.test.ts` (new)

## Change Log

- 2026-07-12 — Story 29.0 implemented: `audit.ts` module (config parsing, redaction, `AuditLogger` writer/rotation/degrade), `server-base.ts` `handleToolCall`/`dispatchToolCall` split + audit interceptor wiring + startup fail-fast. All 4 tasks complete; `ready-for-dev` → `review`.
