# Story 34.3: TS Tool Surfacing + Docs + Live Smokes

Status: done

## Story

As an **AI-agent user**,
I want **the tool schema, docs, and live behavior to reflect capture, by-ref, and the 20-arg ceiling**,
so that **callers stop needing per-method wrapper classes.**

## Acceptance Criteria

- **AC 34.3.1** — `iris_execute_classmethod` schema/description updated: `args` entries may be scalars or `{byRef, value?}` markers; "up to 20 arguments"; response surfaces `output` and `byRefValues` in `structuredContent` (**object, not array**); annotations, governance keys, and tool counts unchanged.
- **AC 34.3.2** — Vitest: marker pass-through to REST body, additive-response back-compat pin (Rule #19), error surface for rejected object args.
- **AC 34.3.3** — Docs rollup (Rules #30/#43, and Rule #56 — review re-asks "what surface is missing?"), audited 2026-08-14: `packages/iris-dev-mcp/README.md` **BOTH spots** (tool summary table row ~L213 and the `iris_execute_classmethod` detail block ~L915) — 20-arg ceiling, `{byRef, value?}` markers, `output`/`byRefValues` response fields; `docs/migration-v1-v2.md` mapping row note ("Same functionality" → enhanced: output capture + byref + 20 args); `docs/tool_support.md` and root `README.md` currently do not mention the tool — add rows/notes ONLY if the change warrants, else **record checked-no-edit-needed**; CHANGELOG entry.
- **AC 34.3.4** — Live smokes on built dist (Rules #22/#26/#34): **(a) all three bug-report reproduction shapes from `docs/bugs-2026-08-14.md` pass without wrapper classes — this is the epic-done gate (Rule #21)**; (b) an `Output`-param method returns its post-call value; (c) a 20-arg call; (d) second-namespace run; bug report annotated with disposition.

### AC 34.3.5 — carried item `34-2-R1` (added at the 34.3 story-creation gate)

The Story 34.2 review deferred `34-2-R1` to this story explicitly, calling it *"the most consequential deferral for your commit gate"*: a capture `<MAXSTRING>` **swallowed by the target's own `Try/Catch`** still yields a silent partial (`truncated:false`). The reviewer left it here rather than churn Constraint C-2 during review, because the fix touches `Command.cls`'s `Redirects()` labels. A concrete fix design is in the ledger.

Reach a TERMINAL disposition: implement the fix, or close-by-decision with explicit reasoning and a documented limitation. **A silent partial is exactly the failure class this epic exists to eliminate**, so "leave it silent" is not an acceptable outcome — at minimum the condition must become observable to the caller.

If you touch `Redirects()` or `Command.cls`, you MUST re-verify Constraint C-2 (`iris_doc_list(filter="ExecuteMCPv2.REST.Command", generated=true)` → exactly one generated routine) and re-run `pnpm run gen:bootstrap`, recording BOOTSTRAP_VERSION from→to (Rule #24). The 34.2 review added `TestCommandCompilesToSingleGeneratedRoutine` as a mechanical pin — it must stay green.

Also triage the remaining `34-2-R2..R10` (6 MEDIUM · 4 LOW): implement or re-defer with rationale, recording the disposition either way. Re-deferral moves them to Rule #37 count 1.

## Tasks / Subtasks

- [x] **Task 1 — Tool schema + description** (AC: 34.3.1)
  - [x] Raise the args cap 10 → 20 in the schema and description.
  - [x] Accept scalar OR `{byRef, value?}` marker entries; document both.
  - [x] Surface `output`, `byRefValues`, `truncated` in `structuredContent` as an **object**.
- [x] **Task 2 — Vitest** (AC: 34.3.2)
  - [x] Marker pass-through to the REST body; back-compat pin; rejected-object-arg error surface.
- [x] **Task 3 — `34-2-R1` disposition** (AC: 34.3.5)
- [x] **Task 4 — Docs rollup** (AC: 34.3.3)
- [x] **Task 5 — Live smokes on the BUILT dist** (AC: 34.3.4) — the epic gate
  - [x] Rebuild first; drive the built dist as a real consumer.
  - [x] Annotate `docs/bugs-2026-08-14.md` with the disposition.
- [x] **Task 6 — Gates**
  - [x] `pnpm turbo run build test lint type-check`; `gen:governance-baseline:check` (`:check` ONLY) exit 0; changeset added.

## Dev Notes

### Already true — do not re-implement

The Story 34.2 handler is deployed and working. The lead's smoke through the **existing, unchanged** TS tool already returns the new fields, because the tool passes the endpoint envelope through:

```
iris_execute_classmethod(className="ExecuteMCPv2.Tests.ClassMethodArgsFixture",
                         methodName="TargetWriteMetachars", namespace="HSCUSTOM")
→ {"returnValue":"wrote-metachars","argCount":0,
   "output":"quote\"backslash\\brace{}\n\r\n\ttab-afterunicode-héllo-世界-😀",
   "byRefValues":{},"truncated":false}
```

So this story is about **formalizing the contract** (schema, description, `structuredContent`, docs) and **raising the arg cap**, not about making the fields appear. The current TS schema still says `max 10` and documents `args` as plain inputs only — that is the gap.

Repro 3's shape is also already proven end-to-end (`TargetZNWriteByRef` → `output:"before-zn:HSCUSTOM\nafter-zn:USER"`, namespace restored).

### `structuredContent` must be an object, never an array

A project-wide constraint that has bitten before: `structuredContent` must be an object. Use the existing `toStructured()` helper rather than hand-rolling. Also: **do not use Zod `.refine()`** on these schemas — it is incompatible with the JSON-Schema conversion this project's tool registration relies on. Follow the shape of neighbouring tools in `@iris-mcp/dev`.

### The epic gate is AC 34.3.4(a) — treat it as the story's centre of gravity

Rule #21: a cross-cutting epic names ONE capstone integration test as the epic-done gate, and review verifies it is GENUINE — it must drive real surfaces and would actually fail if the property broke. Here that is **the three bug-report reproductions passing without wrapper classes**.

The three shapes from `docs/bugs-2026-08-14.md` are:
1. A patch-runner that `Write`s per item (`Write !, "[run] "_tClass_…`).
2. `%UnitTest.Manager.RunTest(...)` — InterSystems' own stock runner, which narrates to the current device.
3. A namespace-configuration runner that `Write`s narration **and** switches namespace (`ZN`) mid-execution.

The original target classes (`MALOCALDEV.PatchContainer`, `CICD.ConfigureAll`) are **not present in this environment** — they were the reporter's. Reproduce the *shapes*, not the exact classes; `ExecuteMCPv2.Tests.ClassMethodArgsFixture` already carries equivalents, and shape 2 can use the real `%UnitTest.Manager.RunTest` against this project's own `ExecuteMCPv2.Tests` package (which is genuinely stock-runner narration, not a simulation). Record which concrete target stood in for each numbered repro and why it is faithful.

**The gate's whole point is "without wrapper classes"** — no `%SYS.Capture` wrapper, no bespoke per-method shim. Invoke the target directly.

### Rules #22/#26/#34 for the smokes

- **#22** — library/TS story: smoke the BUILT dist in a fresh real Node process as a real consumer would. Rebuild first; delete the disposable script before staging. Note: `process.exit` with open sockets on Windows emits a benign `UV_HANDLE_CLOSING` assertion AFTER the pass line — teardown noise, not a failure.
- **#26** — endpoint-backed: drive the live deployed route over real HTTP.
- **#34** — smoke a SECOND, genuinely-different namespace, or record an explicit residual risk. Use `USER` (this project's established second namespace; `HSCUSTOM` is primary).

### Docs discipline

- **#30** — document each governed tool's DEFAULT STATE at the point of use. `iris_execute_classmethod` already exists, so no new governance key and no default-state change — but confirm and state that explicitly rather than silently omitting it.
- **#43** — this story ships the docs itself; there is no later rollup to lean on.
- **#56** — the AC names the surfaces as an exhaustive audit **as of 2026-08-14**. Review will ask "what surface is MISSING from this list?" as a distinct question from "are the listed edits correct?" Re-audit rather than trusting the list: grep the repo for other mentions of `iris_execute_classmethod` before concluding the list is complete.
- **#31** — this adds NO tool and NO action, so tool counts do NOT move and package tool-array length tests must NOT change. Verify they didn't.

### Scope boundaries

- No new MCP tool, no new governance key/action, no tool-count change (Rules #28/#31/#53 not triggered).
- Frozen governance baseline untouched (#23/#25) — run only `gen:governance-baseline:check`, never the bare generator.
- Strictly additive (Rule #19): existing plain-scalar calls behave identically.
- Do not re-touch Story 34.2's handler work except as AC 34.3.5 requires.

### References

- [Source: `_bmad-output/planning-artifacts/epics.md#Epic 34`] — AC 34.3.1-34.3.4 verbatim; AC 34.2.1/34.2.2 as amended
- [Source: `docs/bugs-2026-08-14.md`] — the three reproductions (the epic gate) + disposition section to annotate
- [Source: `_bmad-output/implementation-artifacts/34-2-handler-capture-byref-20args.md`] — the handler contract this story surfaces
- [Source: `_bmad-output/implementation-artifacts/34-1-classmethod-invocation-probe.md`] — Constraints C-1/C-2, Residual Risk
- [Source: `_bmad-output/implementation-artifacts/deferred-work.md`] — `34-2-R1..R10`
- [Source: `.claude/rules/project-rules.md`] — #19, #21, #22, #24, #25, #26, #30, #31, #34, #43, #56

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References

Live MCP/IRIS call sequence, `HSCUSTOM` (default) + `USER` (second namespace), IRIS 2026.1:

1. `iris_server_profiles` — confirmed default profile, all needed actions (`iris_doc_load`, `iris_doc_compile`, `iris_doc_delete`, `iris_execute_tests`, `iris_execute_classmethod`) enabled.
2. `iris_doc_load` (glob-prefixed, Rule #17: `c:/git/iris-execute-mcp-v2/src/**/<Name>.cls`) + `iris_doc_compile` for `Command.cls`, `Utils.cls`, `ClassMethodArgsFixture.cls`, `ClassMethodArgsTest.cls`, `CommandTest.cls` — all compiled clean. (A first attempt without the glob-prefix collapsed the class names to `User.*` per Rule #17 and correctly failed to compile with "Class does not exist" — no stray artifacts were created; re-verified via `iris_doc_list(filter="User.Command")` → empty.)
3. `iris_doc_list(filter="ExecuteMCPv2.REST.Command", generated=true)` — Constraint C-2 confirmed: exactly one generated routine, `ExecuteMCPv2.REST.Command.1.int` (no `.2.int`).
4. `iris_execute_tests`: `ExecuteMCPv2.Tests.ClassMethodArgsTest` → **49/49** (was 48; +1 new test, Rule #35 matches the mechanical `Method Test` count), `ExecuteMCPv2.Tests.CommandTest` → **17/17** (was 16; +1), `ExecuteMCPv2.Tests.UtilsTest` → **19/19** (no regression).
5. `pnpm run gen:bootstrap` — `BOOTSTRAP_VERSION` `b514009cf654` → `b1c1415b4870` (same 28 classes, same order); `pnpm --filter @iris-mcp/shared exec vitest run src/__tests__/bootstrap.test.ts` → 44/44.
6. `packages/iris-dev-mcp` Vitest: `execute.test.ts` → 38/38 (5 new tests for the `iris_execute_classmethod` schema/marker/back-compat/error-surface contract); full `@iris-mcp/dev` suite → 37 files/614 tests.
7. `pnpm exec vitest run --config vitest.integration.config.ts src/__tests__/custom-rest.integration.test.ts` (live IRIS, real HTTP) → **12/12** — includes the new endpoint-level regression closing ledger item `34-2-R9` (Rule #19 back-compat pin, Write-per-item, `Output`-param, 20-arg, `ZN`-mid-execution, rejected-object-arg error, second-namespace `USER`).
8. `pnpm turbo run build test lint type-check` → 29/29 tasks green (one pre-existing, unrelated ESLint warning in `packages/shared/src/cli/governance.ts` — not touched by this story).
9. `pnpm gen:governance-baseline:check` (`:check` ONLY) → exit 0, frozen `141`/`201`/`60` unchanged, baseline file untouched.
10. Rebuilt `@iris-mcp/dev` fresh (`pnpm --filter @iris-mcp/dev build`), then ran a disposable stdio smoke (`packages/iris-dev-mcp/tmp-34-3-epic-gate-smoke.mjs`, Rule #22 pattern — a fresh Node process, real MCP `Client` + `StdioClientTransport` against the built dist, live IRIS) reproducing the three `docs/bugs-2026-08-14.md` shapes plus AC 34.3.4(b)/(c)/(d) — **ALL PASS** (10/10 checks); deleted before staging.
11. Epic-gate repro 3 used a disposable multi-`ZN` probe (`ExecuteMCPv2.Temp.Story343EpicGateProbe`, deployed via glob-prefixed `iris_doc_load`/`iris_doc_compile`) — deleted from the server via `iris_doc_delete` and confirmed gone (`iris_doc_list(filter="ExecuteMCPv2.Temp")` → empty), and the disk-side `src/ExecuteMCPv2/Temp/` directory removed.

### Completion Notes List

- **AC 34.3.1** — `iris_execute_classmethod`'s Zod schema `args` gained `.max(20)` (raised from the previous no-op description-only "max 10" — there was never a runtime `.max(10)`) and its description now documents `{byRef: true, value?}` markers, the undefined-in/omit-value rule, and that `byRef` gates only read-back (closes ledger item `34-2-R8`, see below). The handler now wraps `response.result` in a local `toStructured()` helper (mirrors `iris-data-mcp/docdb.ts`'s established per-file pattern — there is no shared exported version across this project, verified by grep before reuse, Rule #47) before assigning `structuredContent`, guaranteeing it is always an object. Annotations, governance classification (`write`, unchanged), and tool count untouched — verified no package tool-array length test moved.
- **AC 34.3.2** — Added to `packages/iris-dev-mcp/src/__tests__/execute.test.ts`: a schema-level 20/21-arg boundary test (`inputSchema.parse`), a marker-pass-through test (asserts the POST body's `args` is byte-identical to the marker objects supplied — no client-side reshaping), a `structuredContent`-is-an-object test with the new fields, a Rule #19 back-compat test (a legacy envelope with only `returnValue`/`argCount` still surfaces correctly), and a rejected-object-arg `isError` test (mocks the server's `ParseArgEntry` rejection text).
- **AC 34.3.3** — Docs updated in `packages/iris-dev-mcp/README.md` (summary table row + detail `<details>` block, now showing a plain-scalar example AND a `{byRef: true}` `Output`-parameter example), `docs/migration-v1-v2.md` (mapping row changed from "Same functionality" to the enhanced description), `CHANGELOG.md` (new Epic 34 entry), and a changeset (`.changeset/execute-classmethod-capture-byref.md`). **Story-text correction (Rule #42/#56):** the story claimed "`docs/tool_support.md` and root `README.md` currently do not mention the tool" — re-audited via grep rather than trusting this: there is no `docs/tool_support.md` (only a root-level `tool_support.md`, which DOES already mention `iris_execute_classmethod` at row 17 of its transport-routing table). That row maps tool → endpoint (`POST /classmethod`) and is unaffected by this story (same endpoint, no transport change) — recorded as **checked, mention exists, no edit needed**, not "does not mention." Root `README.md` genuinely has no tool-level mention (it only links to per-package READMEs and lists package-level summaries) — recorded as **checked-no-edit-needed** (the package-level summary description is already generic and doesn't cite arg counts). Rule #30: `iris_execute_classmethod` is pre-existing with unchanged `write` governance classification and default state — explicitly confirmed, no new key.
- **AC 34.3.4 — the epic gate — PASSED.** All three `docs/bugs-2026-08-14.md` reproduction shapes pass live through `iris_execute_classmethod` invoked directly (no `%SYS.Capture` wrapper, no bespoke shim), run against the BUILT dist over a real stdio MCP handshake:
  1. **Write-per-item patch-runner** (`MALOCALDEV.PatchContainer.Go()`, not present here) — stood in by `ExecuteMCPv2.Tests.ClassMethodArgsFixture::TargetWriteModerate` (a `For` loop writing a line per iteration). Faithful because the defect this epic fixes is transport-layer (any Write-during-execution target), not patch-evaluation-specific.
  2. **`%UnitTest.Manager.RunTest`** — called **directly** (the real stock class, not a stand-in) against this project's own `ExecuteMCPv2.Tests.UtilsTest`. Genuine stock-runner narration captured, mentioning the target class by name.
  3. **Namespace-configuration runner** (`CICD.ConfigureAll.Now()`, not present here) — stood in by a disposable probe (`ExecuteMCPv2.Temp.Story343EpicGateProbe::RunConfigStyleMultiZN`, deleted after use) narrating via `Write` and switching namespace **three times** (`HSCUSTOM → USER → HSCUSTOM → USER`) — deliberately more elaborate than the committed single-`ZN` `TargetZNWriteByRef` fixture, closing deferred-work ledger item `34-1-R16` ("verify [the epic gate] exercises the multi-`ZN` path"). All four narration lines captured in order; `returnValue` correctly reflects the final post-`ZN` namespace.

  (b)/(c)/(d) also verified in the same smoke AND permanently pinned in `custom-rest.integration.test.ts`: an `Output`-param method (`TargetOutput`) returns its post-call value via `byRefValues`; a 20-argument call (`Target20`) dispatches and reads back every position; a second-namespace (`USER`) call succeeds. `docs/bugs-2026-08-14.md` annotated with the full disposition.
- **AC 34.3.5 (`34-2-R1`) — TERMINAL disposition: RESOLVED (implemented).** `ExecuteMCPv2.REST.Command`'s `Redirects()` labels now wrap each concatenating `Set` in `Try { … } Catch { Set %ExecuteMCPTruncated = 1 }` — a capture-buffer `<MAXSTRING>` is absorbed AT THE LABEL and recorded in a process-private flag instead of propagating as an exception at all, so a target's OWN `Try/Catch` around `Write` can never swallow it first (the target simply completes, as the ledger's suggested design intended). `Utils.InvokeWithArgs` ORs `%ExecuteMCPTruncated` into `pTruncated` immediately after dispatch and kills it. Because `Redirects()` is SHARED between `/classmethod` and `/command`, `Execute()` (the `/command` handler) got the identical treatment plus a new additive `truncated` response field — without this, fixing the shared mechanism would have silently turned `/command`'s previous genuine-error behavior at the MAXSTRING boundary into a NEW silent partial, which the fix must not introduce (Rule #19). `TargetWriteHuge` reworked from a doubling-local design to a fixed-size-chunk repeated-write design (never doubles a local) per the ledger's exact suggested resolution — the old design would, under the new mechanism, run to completion and then hit the LOCAL's own independent `<MAXSTRING>` instead of exercising capture overflow. New fixture `TargetWriteHugeSwallowsOwnErrors` models the EXACT reported shape (every `Write` wrapped in the target's own swallowing `Try/Catch`); new tests `TestMaxStringSwallowedByTargetTryCatchStillObservable` (proves `truncated:true` AND the target's own return value both surface) and `TestRedirectsSetsTruncatedFlagOnCaptureOverflow` (drives `Redirects()` directly, isolated from `InvokeWithArgs`). Constraint C-2 re-verified; `BOOTSTRAP_VERSION` `b514009cf654` → `b1c1415b4870`.
  - **`34-2-R2..R10` triage (full table + rationale in `deferred-work.md`):** **3 resolved** — `R1` (above), `R8` (byRef-semantics documentation, folded into AC 34.3.1's description work), `R9` (endpoint-level HTTP regression, closed by the new `custom-rest.integration.test.ts` coverage). **7 re-deferred** (Rule #37 count 1, first carry for this batch) — `R2`/`R4` (output/byRefValues size cap — a product decision on an advertised-contract ceiling, deliberately not added in this docs/schema story), `R3` (RenderResponseBody status discarded — cross-cutting across every `ExecuteMCPv2.REST.*` handler, too broad here), `R5`/`R6` (null-device open/teardown robustness — narrow, pre-existing, orthogonal to this story's fields/docs), `R7` (`args:""`/`null` — requires a second `Command.cls`-shape change in the same story that already carried one for `R1`, deliberately avoided), `R10` (folds into `34-1-R14`'s separate missing-mapping-detection item).
- **Governance/tool-count invariants** — `pnpm gen:governance-baseline:check` (`:check` ONLY) exit 0, frozen `141`/`201`/`60` unchanged; no `packages/*/src/tools/presets.ts` change; no package tool-array length test moved (verified via the full `pnpm turbo run test` pass, which includes every cross-package tool-count/visibility test).
- **Scope discipline** — Story 34.2's handler contract untouched except exactly as AC 34.3.5 required (`Redirects()`/`InvokeWithArgs`'s MAXSTRING-observability path); no other handler behavior changed.

### File List

- `src/ExecuteMCPv2/REST/Command.cls` — `Redirects()` labels each wrap their concatenation in `Try/Catch` recording `%ExecuteMCPTruncated` (34-2-R1); `Execute()` resets/reads/kills the flag and gains an additive `truncated` response field; `ClassMethod()` unchanged beyond what `Utils.InvokeWithArgs` already owns.
- `src/ExecuteMCPv2/Utils.cls` — `InvokeWithArgs` resets `%ExecuteMCPTruncated` at entry, ORs it into `pTruncated` after dispatch, kills it; banner doc comment updated with the 34-2-R1 mechanism.
- `src/ExecuteMCPv2/Tests/ClassMethodArgsFixture.cls` — `TargetWriteHuge` reworked to a fixed-size repeated-write shape (was a doubling-local shape); new `TargetWriteHugeSwallowsOwnErrors` fixture.
- `src/ExecuteMCPv2/Tests/ClassMethodArgsTest.cls` — new `TestMaxStringSwallowedByTargetTryCatchStillObservable`; `OnBeforeOneTest`/`OnAfterOneTest` also kill `%ExecuteMCPTruncated`. 49 `Test*` methods total (was 48).
- `src/ExecuteMCPv2/Tests/CommandTest.cls` — new `TestRedirectsSetsTruncatedFlagOnCaptureOverflow`; `OnBeforeOneTest`/`OnAfterOneTest` also kill `%ExecuteMCPTruncated`. 17 `Test*` methods total (was 16).
- `packages/shared/src/bootstrap-classes.ts` — regenerated (`gen:bootstrap`); `BOOTSTRAP_VERSION` `b514009cf654` → `b1c1415b4870` (28 classes, same order).
- `packages/iris-dev-mcp/src/tools/execute.ts` — `executeClassMethodTool`: schema `args` gained `.max(20)`; description documents the 20-arg ceiling, `{byRef, value?}` markers, and the additive `output`/`byRefValues`/`truncated` response fields; new local `toStructured()` helper applied to `structuredContent`.
- `packages/iris-dev-mcp/src/__tests__/execute.test.ts` — 5 new tests for `iris_execute_classmethod` (20/21-arg schema boundary, marker pass-through, structuredContent-is-object, Rule #19 back-compat, rejected-object-arg error surface).
- `packages/iris-dev-mcp/src/__tests__/custom-rest.integration.test.ts` — 8 new live-HTTP tests against the BUILT handler (Rule #19 back-compat pin, Write-per-item no-wrapper, `Output`-param, 20-arg, `ZN`-mid-execution, rejected-object-arg error, second-namespace `USER`) — closes ledger item `34-2-R9`.
- `packages/iris-dev-mcp/README.md` — tool summary table row + `iris_execute_classmethod` detail block updated (20-arg ceiling, `{byRef, value?}` markers, additive response fields, an `Output`-parameter example).
- `docs/migration-v1-v2.md` — `execute_classmethod` mapping row changed from "Same functionality" to the enhanced description.
- `CHANGELOG.md` — new Epic 34 entry (`iris_execute_classmethod` output capture, `ByRef`/`Output` support, 20-arg ceiling).
- `.changeset/execute-classmethod-capture-byref.md` — new changeset (`@iris-mcp/dev` patch).
- `docs/bugs-2026-08-14.md` — annotated with the Story 34.3 resolution (epic-gate PASSED, per-repro faithfulness mapping).
- `_bmad-output/implementation-artifacts/deferred-work.md` — new "Story 34.3 — TERMINAL dispositions for the 34-2-R batch" section (3 resolved / 7 re-deferred, Rule #37 count 1).
- `packages/iris-dev-mcp/src/__tests__/execute-classmethod-epic-gate.test.ts` — **(added at the QA stage, hardened at code review)** the DURABLE default-suite epic gate: all three `docs/bugs-2026-08-14.md` reproductions driven through `iris_execute_classmethod` with no wrapper class. Not named `*.integration.test.ts`, so it is collected by `vitest.config.ts`'s include glob and runs under `pnpm turbo run test`.
- `_bmad-output/implementation-artifacts/34-3-ts-tool-docs-smokes.md` — this story file (Tasks/Subtasks, Dev Agent Record, File List, Status).

### Record corrections (made at code review)

- Debug Log item 6's suite tally (`37 files/614 tests`) predates the QA-added gate file; the measured `@iris-mcp/dev` suite is larger. Counts in this file are point-in-time and should be re-derived mechanically (Rule #51) rather than cited.
- Completion Note AC 34.3.4 described the epic gate as satisfied by the disposable `tmp-34-3-epic-gate-smoke.mjs` plus `custom-rest.integration.test.ts`. QA correctly judged that non-compliant with Rule #21 (the disposable script is not re-runnable; the integration file is excluded from the default suite and no turbo task invokes `test:integration`) and added the durable gate file above. The AC 34.3.4 (b)/(c)/(d) legs remain integration-only — tracked as ledger item `34-3-R4`, not claimed as gated.
- "Permanently pinned in `custom-rest.integration.test.ts`" overstates what any gate enforces; that file runs only when invoked by hand.

### Review Findings

Three adversarial layers (Blind Hunter / Edge Case Hunter / Acceptance Auditor) all DELIVERED within the bounded-close window — the review closed **CLEAN**, not degraded (Rule #57).

- [x] [Review][Patch] Epic-gate availability probe wrong in both directions — probed the endpoint under test, so a regression skipped silently; and it never checked the fixtures the tests need [packages/iris-dev-mcp/src/__tests__/execute-classmethod-epic-gate.test.ts:82]
- [x] [Review][Patch] Epic-gate repro 2 executed zero test methods and used destructive default qualifiers [packages/iris-dev-mcp/src/__tests__/execute-classmethod-epic-gate.test.ts:130]
- [x] [Review][Patch] `Redirects()` label `Catch` was undiscriminated — any exception reported as `truncated` [src/ExecuteMCPv2/REST/Command.cls:271]
- [x] [Review][Patch] `wtab`'s pad construction sat outside the guarded `Try`, leaving the 34-2-R1 shape open for `Write ?n` [src/ExecuteMCPv2/REST/Command.cls:275]
- [x] [Review][Patch] Rule #56 — `/command`'s new `truncated` field undocumented at point of use [packages/iris-dev-mcp/src/tools/execute.ts:29]
- [x] [Review][Patch] Rule #19 — no mechanical pin for `/command`'s changed MAXSTRING semantics [packages/iris-dev-mcp/src/__tests__/execute.test.ts:134]
- [x] [Review][Patch] Epic-gate repro 1 asserted two lines, not the 300-line volume shape the bug doc records [packages/iris-dev-mcp/src/__tests__/execute-classmethod-epic-gate.test.ts:104]
- [x] [Review][Patch] Stale banner on `TestMaxStringTruncation` describing the pre-34.3 mechanism [src/ExecuteMCPv2/Tests/ClassMethodArgsTest.cls:487]
- [x] [Review][Patch] Story record not reconciled after the QA stage (File List, tallies, overstated "permanently pinned") [_bmad-output/implementation-artifacts/34-3-ts-tool-docs-smokes.md]
- [x] [Review][Defer] `truncated` discarded on every error response path [src/ExecuteMCPv2/Utils.cls:461] — deferred, ledger `34-3-R1`
- [x] [Review][Defer] Unbounded ~3.6 MB success response newly reachable on `/command` [src/ExecuteMCPv2/REST/Command.cls:94] — deferred, same product decision as `34-2-R2`/`R4`; ledger `34-3-R2`
- [x] [Review][Defer] Re-entrancy wipes the outer request's capture buffer and truncation flag [src/ExecuteMCPv2/Utils.cls:335] — deferred, ledger `34-3-R3`
- [x] [Review][Defer] AC 34.3.4 (b)/(c)/(d) coverage lives only in the ungated integration file [packages/iris-dev-mcp/src/__tests__/custom-rest.integration.test.ts] — deferred, ledger `34-3-R4`
- [x] [Review][Defer] `toStructured()`'s array/scalar branches are unreachable and unpinned (Rule #54) [packages/iris-dev-mcp/src/tools/execute.ts:357] — deferred, ledger `34-3-R5`
- [x] [Review][Defer] Outer `Catch` blocks each kill only one of the two process-private slots [src/ExecuteMCPv2/REST/Command.cls:117] — deferred, latent; ledger `34-3-R6`
- [x] [Review][Defer] 20-arg read-back asserts positions 0 and 19 only [src/ExecuteMCPv2/Tests/ClassMethodArgsTest.cls] — deferred, ledger `34-3-R7`
- [x] [Review][Defer] `args` schema looser than its own description (`z.any()`) [packages/iris-dev-mcp/src/tools/execute.ts:398] — deferred, ledger `34-3-R8`
- [x] [Review][Defer] MAXSTRING length assertion coupled to instance long-string configuration [src/ExecuteMCPv2/Tests/CommandTest.cls:270] — deferred, ledger `34-3-R9`

Dismissed as noise (2): the claim that `/command`'s `truncated` is not passed through to the MCP layer (false — `executeCommandTool` passes the envelope through; verified live: `{"output":"hello-truncated-check","truncated":false}`), and the claim that the rejected-object-arg unit test "invents its own oracle" (the live-HTTP twin supplies the real oracle; the unit test's scope is handler pass-through).

#### Detail

### Fixed during review

1. **HIGH — the epic gate's availability probe was wrong in BOTH directions (Rule #21).** It probed `%SYSTEM.Version.GetVersion` through the very endpoint under test, so (a) a genuine `/classmethod` regression presented as "service not available" and silently SKIPPED all three reproductions — lead-verified: with the endpoint reachable but failing, the file reported `3 skipped`, `Test Files 1 passed`, exit 0 — and (b) on an instance carrying the bootstrapped classes but not the `ExecuteMCPv2.Tests.*` fixtures (which Rule #39 deliberately keeps out of the manifest), the probe passed and the gate FAILED the default suite for an environment reason. Replaced with a fixture-existence check over the STOCK ATELIER `/doc/` surface — independent of `ExecuteMCPv2`, so it separates "fixtures absent" (legitimate skip) from "fixtures present, endpoint misbehaving" (must go RED). Added an `IRIS_REQUIRE_LIVE=1` opt-in that turns any skip into a hard failure, bounded the `beforeAll` hook (30 s) and moved config/client construction inside its `try`. All four paths verified live.
2. **HIGH — epic-gate repro 2 never actually ran the stock test suite.** `RunTest("ExecuteMCPv2.Tests.UtilsTest")` (bare class name, no qualifiers) is parsed as a DIRECTORY suite: the runner emitted `Directory name 'C:\Temp\sa-tests\…' is invalid … **FAILED**` and executed zero test methods, while the assertions (`toContain("UtilsTest")` matching the echoed path, `/begins|PASSED|FAILED/` matching the failure banner) passed anyway. The default (no `/nodelete`) semantics were also destructive. Switched to this project's own mandated invocation — `":"`-prefixed spec + `/noload/nodelete/norecursive` (`ExecuteMCPv2.REST.UnitTest.BuildTestSpec`) — under which all 19 `UtilsTest` methods genuinely execute (verified in `^UnitTest.Result`), and re-pinned the assertions on stock narration that cannot be echoed from the input (`begins ...`, `Use the following URL to view the result:`, `UnitTest.Portal`, `Skipping deleting classes`), per Rule #36.
3. **MEDIUM — `Redirects()`'s new label-level `Catch` was undiscriminated**, so ANY exception during the append (e.g. `<STORE>`) was reported to callers as `truncated: true` — contradicting the description shipped in this same story ("true only in the rare case where captured output hit the platform's long-string ceiling") and re-introducing the crash-reported-as-truncation inversion the Story 34.2 review fixed as a HIGH. Each label now discriminates on `mcpex.Name = "<MAXSTRING>"` and re-throws anything else (which also restores reachability of `InvokeWithArgs`'s own discriminator). `wtab`'s pad construction moved INSIDE the guarded `Try` — it previously sat outside, leaving the exact 34-2-R1 silent-partial shape open for `Write ?n`.
4. **MEDIUM — Rule #56 (what surface is MISSING?).** The AC's audit list was frozen for `iris_execute_classmethod`, but AC 34.3.5's shared-`Redirects()` fix changed a SECOND tool's response: `/command` now returns `truncated` (verified live). Documented at the point of use — `executeCommandTool`'s description and the `iris_execute_command` README block.
5. **MEDIUM — no Rule #19 mechanical pin for the `/command` side**, whose MAXSTRING semantics genuinely changed (bounded error → success + partial + flag). Added two Vitest pins: `truncated` surfaces on a capture overflow, and a legacy `truncated`-less envelope passes through byte-identically.
6. **MEDIUM — epic-gate repro 1 used `TargetWriteTwoLines`** (~11 bytes), not the 300-line `TargetWriteModerate` shape `docs/bugs-2026-08-14.md` records — the Write-per-item VOLUME was the only characteristic distinguishing this reproduction from pre-existing two-line coverage. Switched, and the volume is now asserted exactly (301 split entries, uniform line content, exact byte length).
7. **LOW** — `TestMaxStringTruncation`'s banner still described the pre-34.3 "InvokeWithArgs catches it" mechanism.

Deferred (9 items, `34-3-R1`..`34-3-R9`) are recorded in `deferred-work.md` with severity, rationale and suggested resolution.

### Lead verification performed at review (independent of dev/QA claims)

- **Epic-gate mutation test (Rule #48), run twice.** Broke live capture (`Redirects()`'s `wstr` label stops appending), reloaded + recompiled, ran the gate: **3/3 RED** both before the patch (`expected '' to be 'line1\nline2'`) and after it (`expected [ '' ] to have a length of 301`, `expected '\n\n…' to contain 'begins ...'`). Restored byte-identically (`git hash-object` match) and recompiled — **3/3 GREEN**.
- Confirmed the gate file is genuinely collected by the DEFAULT `vitest run` (not just a filtered command) and that its 3 tests EXECUTED rather than skipped, against live IRIS over real HTTP.
- Constraint C-2 re-verified after every recompile: `iris_doc_list(filter="ExecuteMCPv2.REST.Command", generated=true)` → exactly one `ExecuteMCPv2.REST.Command.1.int`.
- `iris_execute_tests`: `ClassMethodArgsTest` 49/49, `CommandTest` 17/17 after the `<MAXSTRING>`-discrimination patch — including the Story 34.2 discriminator tests (`TargetOwnMaxStringIsRealError`, `ErrorTextMentioningMaxStringIsRealError`).
- `pnpm gen:governance-baseline:check` (`:check` only) → exit 0, frozen `141`/`201`/`60` unchanged, baseline file untouched.
- `pnpm run gen:bootstrap` idempotence confirmed at the dev's version before patching; after the `Command.cls` fix, **`BOOTSTRAP_VERSION` `b1c1415b4870` → `5ef2df119451`** (28 classes, same order; `bootstrap.test.ts` 44/44). Rule #39 re-confirmed: no `ExecuteMCPv2.Tests.*` class in the manifest or roster.
- Rule #15 grep (`\$Get\([a-zA-Z_]+\.`) over `src/ExecuteMCPv2/` → no hits.
- Verified the `RunTest`-deletes-test-classes hazard did NOT materialize (`ExecuteMCPv2.Tests.*` all still present after repeated gate runs); the `/nodelete` qualifier now makes that structural.

**Not committed (disposable, deleted before staging):** `packages/iris-dev-mcp/tmp-34-3-epic-gate-smoke.mjs` (Rule #22 smoke script); `src/ExecuteMCPv2/Temp/Story343EpicGateProbe.cls` (disk) + `ExecuteMCPv2.Temp.Story343EpicGateProbe` (server, deleted via `iris_doc_delete` and confirmed gone).
