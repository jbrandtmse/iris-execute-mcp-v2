# Story 34.5: TS-Layer `truncated` Reachability + Test-Runner Zero-Result Guard

Status: ready-for-dev

<!-- Created 2026-08-15. Epic 34 re-opened a second time (Rule SC-5) on Project Lead escalation of 34-4-R4 and 34-4-R10. -->

## Story

As an **AI-agent caller of the IRIS MCP tools**,
I want **`truncated` to actually reach me on error responses, and the test runner to refuse to report a zero-result run as success**,
so that **an advertised capability is real at the surface I use, and a test run that executed nothing cannot be mistaken for a clean pass.**

## Acceptance Criteria

- **AC 34.5.1** (`34-4-R4`) — the envelope `result` is preserved on `IrisApiError` in `packages/shared/src/http-client.ts` (or equivalent), and `truncated` is surfaced in the affected tools' **error** responses. Today `http-client.ts` throws `IrisApiError` whenever `status.errors[]` is non-empty, and that type carries only `statusCode`/`errors`/`originalUrl` — the `result` part is dropped, so a REST-layer `truncated` is invisible to every tool caller.
- **AC 34.5.2** (`34-4-R4`) — the README/changeset wording walked back during the Story 34.4 review is **restored to the stronger claim** only once AC 34.5.1 makes it true. Verify the restored text against live behavior, not against intent (Rule #36). If any part remains untrue, the docs must state the accurate narrower reach.
- **AC 34.5.3** (`34-4-R10`) — `iris_execute_tests` gains a zero-result guard on the `class` and `method` branches, mirroring the guard `package` already has: when a run returns no method-level rows, surface an explicit error naming the target and level instead of `total: 0, passed: 0` with no error. A typo'd method name must be distinguishable from a genuine clean run.
- **AC 34.5.4** — all three levels (`package`, `class`, `method`) are pinned by tests: a matching run reports real counts; a non-matching run reports an explicit error. Include the `method`-level case observed live during the 34.4 review (`level: "method"` returning `total: 0` silently).
- **AC 34.5.5** — Rule #19 back-compat: a **successful** run's response shape is unchanged at every level (`total`/`passed`/`failed`/`skipped`/`details`), and `IrisApiError`'s existing consumers keep working — AC 34.5.1 is strictly additive to that type. Proven mechanically, not by prose.
- **AC 34.5.6** — Rule #48: each fix carries mutation evidence (revert → red → restore byte-identically).
- **AC 34.5.7** — Gates: `pnpm turbo run build test lint type-check` green; `pnpm gen:governance-baseline:check` (`:check` ONLY) exit 0 with frozen `1e62c5ad5bf7` / 141 / 201 / 60; tool counts unmoved (Rule #31 — no tool or action is added); changeset added.

## Tasks / Subtasks

- [ ] **Task 1 — Preserve the envelope result on `IrisApiError`** (AC: 34.5.1, 34.5.5)
- [ ] **Task 2 — Surface `truncated` on the tools' error responses** (AC: 34.5.1)
- [ ] **Task 3 — Zero-result guard for `class`/`method` levels** (AC: 34.5.3)
- [ ] **Task 4 — Tests across all three levels** (AC: 34.5.4, 34.5.6)
- [ ] **Task 5 — Restore docs wording once it is true** (AC: 34.5.2)
- [ ] **Task 6 — Gates + changeset** (AC: 34.5.7)

## Dev Notes

### Both defects are already root-caused — do not re-investigate, verify and fix

**`34-4-R4` — `truncated` never reaches the caller.** `packages/shared/src/http-client.ts` throws `IrisApiError` whenever the Atelier envelope's `status.errors[]` is non-empty. `IrisApiError` carries only `statusCode`, `errors`, and `originalUrl` — the envelope's `result` object is discarded at that throw. Story 34.4 correctly put `truncated` **on the REST error envelope** (verified live by `curl` on both `/command` and `/classmethod`), so the server side is done; the value simply never survives the client hop. The 34.4 review confirmed this end-to-end through the real tool and had to walk back README/changeset wording that claimed otherwise.

**`34-4-R10` — the test runner's silent zero-result.** In `packages/iris-dev-mcp/src/tools/execute.ts`:
- `level: "package"` **does** guard this — around L180 it returns an explicit `No test classes found in package '<target>'` when discovery yields nothing.
- `level: "class"` (L187-188) and `level: "method"` (L189-195) have **no equivalent guard**. Method level parses `target.split(":")` into `{class, methods:[method]}` and passes it straight through.
- `total` is derived at L300-324 **solely** from result rows carrying `r.method`; class-level summary rows are deliberately skipped. So zero method rows ⇒ `total: 0, passed: 0, failed: 0` with **no error field** — indistinguishable from a genuine clean run.

Observed live: the Story 34.4 reviewer called `iris_execute_tests` at `level: "method"`, got `total: 0`, and only noticed because Rule #35 mandates comparing the returned `total` against a mechanically-counted expectation. **Rule #35 caught a defect in the tool Rule #35 exists to police.** That is the story's centre of gravity: a runner that reports success for zero executed tests can mask a regression on any story in this repo.

### Why this is worth a story rather than a ledger entry

Both are in **our own verification and error-reporting surface**, and both fail *silently*:
- an advertised capability that is invisible at the only surface callers use;
- a test runner that cannot distinguish "nothing ran" from "everything passed".

Neither is a crash. Both are the "green badge over a dead check" shape that Epic 34's own review history hit three separate times in the epic gate.

### Constraints

- **Rule #19 is the main risk on AC 34.5.1.** `IrisApiError` is shared and thrown from a hot path used by every tool in every package. The change must be **strictly additive** to the type — existing consumers (catch blocks, error-shape assertions, `instanceof` checks) must be untouched. Prove it mechanically across packages, not by inspection of one call site.
- **This is a TS-layer story.** No ObjectScript change is expected. If one proves necessary, `Command.cls`/`Utils.cls` are bootstrapped → Rule #24 BOOTSTRAP_VERSION bump (current `34233b5c9f63`) and Constraint C-2 re-verification (exactly one `ExecuteMCPv2.REST.Command.1.int`) both apply.
- **Rule #31** — no new tool or action; tool counts and package tool-array length tests must not move.
- **Rules #23/#25** — frozen governance baseline untouched; run `gen:governance-baseline:check` only, never the bare generator.
- **Rule #36** — AC 34.5.2's restored docs claim must be verified against live behavior. This exact claim was already wrong once.
- **Rule #58** — for AC 34.5.4, fixture diversity matters: a class that exists with a method that does not, a class that does not exist, a valid method that genuinely passes, and the `ClassName:MethodName` parse edge (missing colon, empty method part).
- Tests must be discoverable by the DEFAULT suite (Rule 8) — vitest under `packages/**`, standard naming, not excluded.

### Testing

- Vitest under `packages/**`. Current baselines: `@iris-mcp/dev` 622 tests / 38 files, 0 skipped; turbo 29/29; `ExecuteMCPv2.Tests` 330/330.
- Live IRIS reachable (2026.1 Build 235U; `HSCUSTOM` primary, `USER` second) — AC 34.5.4's zero-result cases should be confirmed against the real runner, since the defect was invisible to the existing suite.
- **Rule #35 applies to your own verification**: compare any `iris_execute_tests` total against a mechanically-counted expectation. Do not trust a zero.

### References

- [Source: `_bmad-output/implementation-artifacts/deferred-work.md`] — items `34-4-R4` and `34-4-R10` with full reproduction detail
- [Source: `packages/shared/src/http-client.ts`] — the `IrisApiError` throw that drops the envelope `result`
- [Source: `packages/iris-dev-mcp/src/tools/execute.ts#L177-L195`] — the level branches; `#L300-L324` — where `total` is derived
- [Source: `_bmad-output/implementation-artifacts/34-4-response-integrity-gate-durability.md`] — AC 34.4.2's envelope scope and the walked-back docs wording
- [Source: `.claude/rules/project-rules.md`] — #19, #24, #25, #31, #35, #36, #48, #51, #55, #58

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
