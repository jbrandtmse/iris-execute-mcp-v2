# Story 34.2: Handler — Capture, ByRef Markers, 20-Arg Ladder

Status: done

## Story

As a **developer**,
I want **the `/classmethod` endpoint to capture device output and support marked by-ref args up to 20 positions**,
so that **ordinary narrating methods and `Output`-parameter methods work without bespoke wrapper classes.**

## Acceptance Criteria

- **AC 34.2.1** — `ClassMethod()` wraps target invocation in the same null-device I/O-capture pattern as `Execute()` (Rule #7 discipline: full restore before render, single `RenderResponseBody` per request); captured text returned as additive `output` field; behavior on target runtime error unchanged (sanitized error, Rule #9). **Two binding constraints from the Story 34.1 probe (both fail SILENTLY):** (a) the `Redirects()` mnemonic entry points MUST remain in a class inside the `%All`-mapped `ExecuteMCPv2` package — it is the **driver's** package mapping that must survive a target's mid-execution `ZN`; (b) `Use tNull::("^"_$ZNAME)` binds the **running routine**, so `ClassMethod()` and `Redirects()` must compile into the SAME generated `.int`. **After the change, re-run `iris_doc_list(filter="ExecuteMCPv2.REST.Command", generated=true)` and confirm a single generated routine.**
- **AC 34.2.2** — Marker objects per epic scope: marked args passed by reference; post-call values returned in additive `byRefValues` (keyed by zero-based index, marked args only); non-marker object args rejected with a clear validation error.
- **AC 34.2.3** — Argument ladder extended to 20; count-21 rejected with "maximum is 20" error; counts 0/1/10/11/20 covered by `%UnitTest` tests (Rule #35 total check).
- **AC 34.2.4** — Back-compat proof (Rule #19): plain-scalar-args regression test pins `returnValue`/`argCount` unchanged for an existing-shape call.
- **AC 34.2.5** — `gen:bootstrap` regenerated, BOOTSTRAP_VERSION from→to recorded (Rule #24); `bootstrap.test.ts` green; frozen governance baseline untouched (#23/#25).

### AC 34.2.6 — carried HIGH/MEDIUM items from the Story 34.1 probe (NEW — added at the 34.2 story-creation gate)

The 34.1 review deferred 16 items; these are the ones that **bind this story's design** and must reach a TERMINAL disposition here (implement, or explicitly document the limitation in the tool's error/response surface — silent unhandled behavior is not an allowed outcome):

- **34-1-R1 (HIGH) — subscripted-array out-values.** `Output pSummary` returning `pOut("key")=val` (`$Data=10`/`11`) is the **idiomatic IRIS Output shape**, and it is literally the bug report's own motivating case (`RunStory11PrerequisiteAsstchTests(Output pSummary)`). The epic's `byRefValues` shape assumed scalars. **Decision for this story (Rule #42 — amend `epics.md` AC 34.2.2 in place):** `byRefValues[i]` carries the scalar top-level value when `$Data(tArgN)#10` is 1; when the local has subscripts (`$Data` ≥ 10), serialize the array into a nested JSON object preserving subscript structure, and when both exist represent both. Choose and document one explicit, round-trippable encoding; a scalar-only implementation that silently drops subscripts fails this AC.
- **34-1-R2 (HIGH) — large captures.** Validate capture at **>8KB** and at the `<MAXSTRING>` boundary on `%ExecuteMCPOutput` concatenation. The ~8KB figure is not arbitrary: `Execute()`'s own comment documents an ~8KB CSP response-buffer boundary that silently truncated the JSON envelope. Prove the new path does not reintroduce it, and define behavior at `<MAXSTRING>` (truncate with an explicit marker, or error — never a silent partial).
- **34-1-R3 (HIGH) — targets that themselves redirect I/O.** `%SYS.Capture`, a nested `ReDirectIO`, or an `Open`/`Use` of another device inside the target. This is NOT hypothetical: the bug report's own workaround wraps targets in `$$BeginCapture^%SYS.Capture`, so real callers have such classes deployed today and will call them through the fixed endpoint. Determine and pin the behavior; a nested redirect that corrupts the envelope would be the original bug returning by another door.
- **34-1-R6 (MEDIUM) — JSON `null` vs empty string.** `%Get` yields `""` for both, making `null` and `""` indistinguishable — which directly undercuts the `{byRef: true}` "omitted `value` = undefined (Output-style)" design. Use `%GetTypeOf(...)` (or equivalent) to distinguish, and pin the three cases: `value` omitted → undefined-in; `value: null` → ?; `value: ""` → empty string.
- **34-1-R12 (MEDIUM) — `args` that is not a JSON array.** Today a non-array `args` is silently mis-counted into phantom empty arguments. Reject with a clear validation error.
- **34-1-R7 (MEDIUM) — marker-recognition edge shapes (Rule #56).** Enumerate them explicitly and state the enumeration is exhaustive as of 2026-08-14: `{byRef: false}`, `{byRef: "true"}` (string), `{value: x}` with no `byRef` key, `{byRef: true, value: {...}}` (object value), extra unknown keys alongside `byRef`, an empty object `{}`, and a nested array. Review will ask "what is MISSING from this list?" as a distinct question.

Items **34-1-R4, R5, R8, R9** and the LOW batch (R10, R11, R13–R16) may be re-deferred with rationale; record the disposition either way. Re-deferral moves them to Rule #37 count 1.

### Integration AC 34.2.7

This story introduces the endpoint capability that **Story 34.3 consumes** (TS tool surfacing + live smokes). Per the Rule 1 escape clause: **no consumer exists in this story; the first consumer is Story 34.3.** The producer-side proof required here is that the new `output` and `byRefValues` fields are observable over **real HTTP against the deployed route** (not only via `%UnitTest`), so 34.3 wires against a surface proven to emit them.

## Tasks / Subtasks

- [x] **Task 1 — Capture wrapper** (AC: 34.2.1)
  - [x] Port `Execute()`'s null-device redirect around the `$ClassMethod` call site; single restore point after Try/Catch; exactly one `RenderResponseBody`.
  - [x] Verify C-1/C-2 after compile: confirm a single `ExecuteMCPv2.REST.Command.1.int` and that `Redirects()` labels live in it.
- [x] **Task 2 — Argument materialization + marker parsing** (AC: 34.2.2, 34.2.6/R6, R7, R12)
  - [x] Validate `args` is a JSON array; reject otherwise.
  - [x] Parse each entry: scalar → by-value; `{byRef, value?}` marker → materialize local; any other object → clear rejection error.
  - [x] Distinguish omitted `value` / `null` / `""` via type inspection.
- [x] **Task 3 — 20-arg ladder** (AC: 34.2.3)
  - [x] Materialize every position into a local and pass `.tA0 … .tA19` (see Dev Notes for why this is unconditional and safe).
  - [x] Extend the ladder to 21 branches (0–20); reject 21+ with "maximum is 20".
- [x] **Task 4 — byRefValues assembly** (AC: 34.2.2, 34.2.6/R1)
  - [x] Emit post-call values for marked positions only, using **direct-by-name access** — see the indirection trap in Dev Notes.
  - [x] Handle scalar, subscripted-array, and both-present shapes per the AC 34.2.6/R1 decision.
- [x] **Task 5 — Large-capture + nested-redirect behavior** (AC: 34.2.6/R2, R3)
- [x] **Task 6 — Tests** (AC: 34.2.3, 34.2.4)
  - [x] `%UnitTest` coverage for counts 0/1/10/11/20 and the 21-rejection.
  - [x] Back-compat regression pinning `returnValue`/`argCount` for an existing-shape plain-scalar call.
  - [x] Rule #35: compare returned `total` against the number of `Test*` methods expected; rerun per-class if short.
- [x] **Task 7 — Bootstrap + gates** (AC: 34.2.5)
  - [x] `pnpm run gen:bootstrap`; record BOOTSTRAP_VERSION from→to.
  - [x] `bootstrap.test.ts` green. **No new class is added**, so the Rule #39 rosters do NOT change — verify they didn't.
  - [x] `pnpm gen:governance-baseline:check` (`:check` ONLY, Rule #25) exit 0; frozen `1e62c5ad5bf7` / 141 / 201 / 60 unchanged.
- [x] **Task 8 — Real-HTTP producer proof** (Integration AC 34.2.7)

## Dev Notes

### Story 34.1's pinned findings are your spec — read them, do not re-derive

[34-1-classmethod-invocation-probe.md](_bmad-output/implementation-artifacts/34-1-classmethod-invocation-probe.md) contains live-verified findings, a `## ⚠ Constraints for Story 34.2` section (C-1, C-2), and a `### Residual Risk` section naming what was NOT probed. All three were re-verified independently by QA and again by code review. **Read that file before writing code.**

### The three traps that will silently break this story

**Trap 1 — indirection cannot read your by-ref locals.** The natural way to build `byRefValues` over 20 positions is a loop with string-built indirection (`Set tVar = "tA"_i` then `$Data(@tVar)`). **This returns empty, silently.** The 34.1 review proved the cause is the standard ObjectScript rule that *indirection cannot see procedure-block private variables* — reproduced with no `$ClassMethod` and no `ByRef` present, and flipped by changing only the `%`-prefix or only `ProcedureBlock=0`. Use **direct-by-name** access (`$Data(tA0)`, `$Get(tA0)`, …), or an explicit 20-branch `If`/`ElseIf`. This trap manufactured a false negative during the probe itself; it will manufacture an empty `byRefValues` here.

**Trap 2 — `$ZNAME` binds the running routine (C-2).** Adding a 21-branch × 20-argument ladder is a large addition to `Command.cls`. If IRIS splits the generated code across `Command.1.int` / `Command.2.int` and `ClassMethod()` lands apart from `Redirects()`, `$ZNAME` names a routine with no `wstr` label and **capture breaks in every namespace**. Verify with `iris_doc_list(filter="ExecuteMCPv2.REST.Command", generated=true)` after compiling — today only `ExecuteMCPv2.REST.Command.1.int` exists, and it must stay that way (or the mnemonic binding must be reworked deliberately).

**Trap 3 — the ~8KB CSP flush boundary.** `Execute()`'s comment ([Command.cls:50-55](src/ExecuteMCPv2/REST/Command.cls#L50-L55)) documents that binding the mnemonic on `$IO` silently drops the first ~8KB of the JSON envelope. That is why the redirect uses a throwaway **null device**, not `$IO`. Copying the pattern carelessly re-introduces the exact class of bug this epic exists to fix. Bind on `tNull`; note `Use tInitIO::("")` is a NO-OP that does not clear the mnemonic (Rule #7).

### Why materializing every argument is safe

34.1 Finding 1 Test E + QA's Test F established: by-ref binding through `$ClassMethod` is controlled by the **caller's** `.` syntax, independent of the callee's declared parameter mode; and dot-passing a local to a plain formal the target never writes to is **silently inert, never an error**. So a single uniform ladder passing `.tA0 … .tAN` for every position is safe. The `{byRef: true}` marker therefore decides **what is read back into `byRefValues`**, not what is bound — an unmarked position whose target happens to mutate it simply has its mutation discarded.

### Current state of the handler

[src/ExecuteMCPv2/REST/Command.cls](src/ExecuteMCPv2/REST/Command.cls) — `ClassMethod()` at L121-210:
- **No I/O redirect at all** (`ReDirectIO` appears only in `Execute()`).
- Ladder L159-188 passes `tArgs.%Get(N)` expressions (cannot propagate by-ref); ceiling message at L184 says "maximum is 10".
- Namespace restore at L191 (`Set $NAMESPACE = tOrigNS`) runs **before** `RenderResponseBody` — correct and must stay that way (REST-handler namespace rule).
- Response built at L200-203: `returnValue` (OREF-guarded) + `argCount`. New fields are **additive** alongside these.

`Execute()` at L50-97 is the capture reference implementation.

### ObjectScript constraints

- Argumented `Quit` is **ILLEGAL** inside Try/Catch (ERROR #1043) — initialize before the Try, argumentless `Quit` inside, return after.
- Triple `$$$` macros, never `$$`. If multiple `$`/`$$` errors appear, rewrite the whole file rather than patching.
- No underscores in method or class-parameter names. Never edit a `Storage` section. Indent every command at least one space. `///` doc comments only.
- `%DynamicObject` properties with underscores need quoting (`request."max_results"`).
- Compile via the `iris_doc_compile` MCP tool; load with a **glob-prefixed** path (Rule #17): `c:/git/iris-execute-mcp-v2/src/**/Command.cls`.

### Scope boundaries

- This story owns the **ObjectScript handler + its `%UnitTest` coverage + the bootstrap bump**. The TS tool schema, docs rollup, and the epic-gate live smokes are **Story 34.3** — do not do them here.
- **Strictly additive** (Rule #19): existing plain-scalar calls keep identical `returnValue`/`argCount`.
- **No new tool, no new governance key/action, no tool-count change** — Rules #28/#31/#53 are NOT triggered. Do not touch the frozen governance baseline (#23/#25); run only `gen:governance-baseline:check`.
- `Command.cls` **is** a bootstrapped class, so Rule #24 applies: regenerate `gen:bootstrap` in THIS story and record `BOOTSTRAP_VERSION` from→to. No NEW class is added, so the Rule #39 rosters stay unchanged.

### Testing

`%UnitTest` classes under `ExecuteMCPv2.Tests.*` (kept OUT of the bootstrap manifest, Rule #39). Run via `iris_execute_tests` and **verify the returned `total` against the expected number of `Test*` methods** (Rule #35); rerun per-class if short.

### References

- [Source: `_bmad-output/implementation-artifacts/34-1-classmethod-invocation-probe.md`] — pinned findings, Constraints C-1/C-2, Residual Risk
- [Source: `_bmad-output/planning-artifacts/epics.md#Epic 34`] — epic scope, marker design, AC 34.2.1 as amended 2026-08-14
- [Source: `docs/bugs-2026-08-14.md`] — the three reproductions (34.3's epic gate) and the `%SYS.Capture` workaround motivating 34-1-R3
- [Source: `_bmad-output/implementation-artifacts/deferred-work.md`] — items `34-1-R1..R16`
- [Source: `src/ExecuteMCPv2/REST/Command.cls#L50-L97`] — capture reference; `#L121-L210` — the handler to change
- [Source: `.claude/rules/project-rules.md`] — #7, #19, #24, #25, #35, #39, #42, #56

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References

Live MCP call sequence against `HSCUSTOM` (`iris_server_profiles` confirmed default profile, all needed actions enabled):

1. Two additional live probes BEYOND 34.1's findings, since AC 34.2.6/R2 and R3 were explicitly unprobed residual risk: a disposable `ExecuteMCPv2.Temp.Story342Probe` (dev stage) —
   - `FindMaxString`: doubled a string until `<MAXSTRING>` — ceiling lands between 2,097,152 and 4,194,304 chars.
   - `RunMaxStringCapture`: reproduced the production redirect pattern around a target that writes past that ceiling — the `<MAXSTRING>` throws from inside `wstr` itself, is catchable by an outer Try/Catch around the dispatch, the partial capture up to the limit is intact, and the redirect/`$IO` state is restored cleanly afterward (`ioAfter=1`). This directly informed the R2 truncated-flag design.
   - `RunSelfRedirectOffProbe` / `RunNestedSysCaptureProbe`: a target calling `ReDirectIO(0)` mid-execution or nesting `%SYS.Capture` does NOT corrupt the endpoint's own redirect state — writes during the diverted window are silently lost (discarded to the null device, or captured into `%SYS.Capture`'s own cookie-scoped buffer), but before/after writes are captured correctly and a follow-up capture cycle proves the device state stays clean. This is the R3 "documented limitation, not implementable" evidence.
2. A minimal isolation probe proved `.name(subscript)` (a subscripted array node) is **NOT valid ObjectScript call-argument syntax** — `ERROR #1010: Missing right parenthesis` — for both `$ClassMethod` dispatch and an ordinary `Do ..Method(.arr(0))` call. This falsified my initial design (a real `For` loop over a subscripted `tArg(i)` array for materialization/dispatch) and confirmed the story's own prescription (an explicit per-position ladder using individually-named locals `tA0`…`tA19`) is not just a style preference but a hard syntactic requirement.
3. A follow-up probe proved the workaround: `Merge tChild = pLocal(tKey)` (copying a subscript subtree into a fresh WHOLE local) plus recursion via `.tChild` (a whole-variable by-ref pass, which IS legal) correctly walks arbitrary-depth subscript trees without ever passing a subscripted node as a call argument and without `@`-indirection (Finding 5's trap). Verified live against a 3-level-deep fixture (`RunBuildNodeProbe`) before writing `BuildByRefNode`.
4. A marker-shape probe (`RunMarkerShapeProbe`) confirmed `$ClassName` distinguishes `%Library.DynamicArray` from `%Library.DynamicObject`, and pinned `%GetTypeOf`'s exact return strings (`"unassigned"`, `"boolean"`, `"null"`, `"object"`, `"string"`) used throughout `ParseArgEntry`'s branching.
5. `iris_doc_load` (glob `c:/git/iris-execute-mcp-v2/src/**/<Name>.cls`, Rule #17) + `iris_doc_compile` for `Utils.cls`, `Command.cls`, and the two new `Tests/*.cls` files — all compiled clean on first or second attempt.
6. `iris_doc_list(namespace="HSCUSTOM", filter="ExecuteMCPv2.REST.Command", generated=true)` after the `Command.cls` compile — confirmed exactly ONE generated routine, `ExecuteMCPv2.REST.Command.1.int` (C-2 satisfied; the 21-branch ladder was deliberately kept in `Utils.cls`, not `Command.cls`, specifically to avoid the split C-2 warns about).
7. `iris_execute_tests(ExecuteMCPv2.Tests.ClassMethodArgsTest, class)` — 2 failures on the first run (a test-fixture bug: `Target20` unconditionally referenced all 20 formals even when fewer were supplied, `<UNDEFINED>`; and a wrong iteration API, `%GetNext` doesn't exist on `%DynamicObject`) — both were bugs in the NEW test/fixture code, not production code; fixed, recompiled, reran clean: 27/27 at that point, `total` matching the 27 `Test*` methods then present (Rule #35). **Superseded:** QA added 11 tests (38/38) and code review added 10 more — the current file has **48** `Test*` methods and `iris_execute_tests` returns `total:48 passed:48`, mechanically cross-checked against `grep -c "^Method Test"` (Rule #51).
8. `iris_execute_tests(ExecuteMCPv2.Tests.CommandTest, class)` → 16/16 (no regression) and `iris_execute_tests(ExecuteMCPv2.Tests.UtilsTest, class)` → 19/19 (no regression).
9. Real HTTP (`_SYSTEM`/`SYS` Basic auth, per project credential convention) against the live deployed route `http://localhost:52773/api/executemcp/v2/classmethod` — Task 8 / Integration AC 34.2.7: (a) a `{byRef:true}` marker on a subscripted-Output target returned `byRefValues.0` with the EXACT nested `{value, subscripts:{k1, k2:{subscripts:{nested}}}}` shape designed in `BuildByRefNode`; (b) a 0-arg writing target returned `output:"line1\nline2"`; (c) a plain 1-arg `%SYSTEM.Encryption.Base64Encode` call returned the identical base64 string plus additive `output:""`/`byRefValues:{}`/`truncated:false` (back-compat, additive-only); (d) a 21-arg call returned a clean, un-corrupted JSON error envelope (`ERROR #5001: Too many arguments: maximum is 20, received 21`).
10. `pnpm run gen:bootstrap` (run twice — once before, once after adding the OREF-out-value defensive guard found during the epics.md Rule #42 amendment pass; only the SECOND run's version is the recorded final one) + `pnpm --filter @iris-mcp/shared exec vitest run src/__tests__/bootstrap.test.ts` (44/44) + `pnpm run gen:governance-baseline:check` (`:check` ONLY) → frozen 141/201/60 unchanged + full `@iris-mcp/shared` suite (65 files/1300 tests) all green.
11. Probe cleanup: `iris_doc_delete` for `ExecuteMCPv2.Temp.Story342Probe.cls`, then `iris_doc_list(filter="ExecuteMCPv2.Temp")` → `{"items":[]}` and `iris_package_list(prefix="ExecuteMCPv2", generated=true)` → no `Temp` package in the roster (6 packages, 113 total docs, none named `Temp`); disk-side `Story342Probe.cls` and the `Temp/` directory removed.

### Completion Notes List

- **AC 34.2.1** — `ClassMethod()` now wraps the target invocation in the same null-device redirect pattern as `Execute()`. To satisfy C-2 without risking `Command.cls` splitting across multiple generated `.int` routines, the entire argument-materialization/marker-parsing/dispatch-ladder/byRefValues-assembly pipeline was placed in a NEW `ExecuteMCPv2.Utils.InvokeWithArgs` method (plus two private helpers, `ParseArgEntry` and `BuildByRefNode`) — `Command.cls`'s `ClassMethod()` itself only grew by the redirect open/close block and response-field wiring, and stayed compact enough that `Redirects()` remained in the same `.1.int` (verified live post-compile).
- **AC 34.2.2 / 34.2.6-R1 decision (Rule #42 — `epics.md` AC 34.2.2 amended in place):** `byRefValues[i]` encoding is `$Data`-driven: `0` → key omitted entirely (never `null`, never an error); `1` (plain scalar) → the raw value, unwrapped; `10`/`11` (has subscripts) → a nested `%DynamicObject` `{value?, subscripts?}`, with `subscripts` mapping each direct child key to the SAME encoding recursively (arbitrary depth, not just one level). Discovered and had to work around a genuine ObjectScript constraint mid-implementation: a subscripted array node (`.arr(i)`) **cannot** be passed as a by-ref call argument — confirmed live (`ERROR #1010`) — so the recursive walker descends via `Merge tChild = pLocal(tKey)` into a fresh WHOLE local rather than recursing on a subscripted reference.
- **AC 34.2.6/R6** — `value` omitted (key absent) → `Kill`'d local, genuine undefined-in (Output-style); `value: null` → explicit validation error ("cannot be JSON null; omit 'value' entirely for an undefined argument") rather than silently aliasing it to `""`, since ObjectScript's value space cannot natively distinguish `null` from `""` and the design's undefined-in path already covers the "no value" intent; `value: ""` → materializes as the empty string, distinct from both.
- **AC 34.2.6/R7 marker-shape enumeration (exhaustive as of 2026-08-14)** — 8 shapes tested: `{byRef:false}` (no value → rejected), `{byRef:"true"}` (string, not boolean → rejected), `{value:"x"}` (no `byRef` key → rejected), `{byRef:true, value:{...}}` (object value → rejected, out of epic scope), `{byRef:true, value:"x", extra:"ignored"}` (unknown keys → silently ignored, forward-compat), `{}` (empty object → rejected, same code path as missing `byRef`), a bare JSON array entry (`[[1,2,3]]` → rejected, distinguished from object via `$ClassName`), `{byRef:true, value:null}` (→ rejected per R6).
- **AC 34.2.6/R12** — `args` validated as either absent/`""` (0 args, unchanged back-compat default) or a genuine `%Library.DynamicArray`; any other JSON shape (object, string, number) is rejected with "'args' must be a JSON array".
- **AC 34.2.6/R2 disposition: IMPLEMENTED, not merely documented.** Live-probed the `<MAXSTRING>` boundary (~2–4M chars) and proved the throw is catchable around the dispatch call with the partial capture intact and the redirect cleanly restored — so `InvokeWithArgs` catches it specifically (`errText [ "<MAXSTRING>"`), sets `truncated:1`, and returns `$$$OK` (partial success) rather than surfacing an opaque generic error that would hide the partial capture/by-ref mutations. Any OTHER target throw still returns as a real sanitized error, matching `Execute()`'s existing precedent of discarding captured output on a genuine error (not extended by this story).
- **AC 34.2.6/R3 disposition: DOCUMENTED LIMITATION (the AC's explicitly allowed alternative to full implementation) — there is no endpoint-side way to detect or prevent a target's own I/O redirection.** Live-probed both shapes named in the AC: a target calling `ReDirectIO(0)` itself (its writes during that window are silently discarded to the null device) and a target nesting `%SYS.Capture` (the bug report's own published workaround — its writes during the nested window land in `%SYS.Capture`'s own cookie-scoped buffer, not ours). In BOTH cases the endpoint's own capture/redirect state is proven NOT corrupted (a follow-up capture cycle in the same test works cleanly) — so this is a silent GAP in `output` completeness for that specific target class, never a corrupted envelope. Regression-pinned in `%UnitTest` (not left as prose-only documentation) and called out in `InvokeWithArgs`'s doc comment.
- **Residual gap found and closed during implementation, not deferred:** while writing the `epics.md` Rule #42 amendment I noticed the by-ref-out-value encoding had no guard against a target mutating a by-ref local to hold an arbitrary OBJECT REFERENCE (as opposed to a scalar or subscript tree) — unlike `returnValue`, which already has an `$IsObject` guard. Rather than record this as a new residual-risk item, added the same guard to `BuildByRefNode` (`<Object:ClassName>` placeholder) and a regression test (`TestByRefOrefOutValueGuarded`) before closing the story.
- **Items 34-1-R4/R5/R8/R9 and the LOW batch (R10/R11/R13-R16)** — re-deferred, unchanged from Story 34.1's disposition (Rule #37 count 1); none bind this story's design surface (arg-count mismatch error text, multi-`ZN` composition, `$Test` on `Open tNull:::1`, etc. — all orthogonal to the handler shape this story delivers).
- **AC 34.2.4 back-compat** — pinned at two levels: (1) `%UnitTest` (`TestTenArgsBackCompatShape`) asserts `InvokeWithArgs`'s `returnValue`/`argCount` for a 1-arg `%SYSTEM.Encryption.Base64Encode` call are byte-identical to calling `$ClassMethod` directly; (2) the real-HTTP producer proof (Task 8) re-ran the SAME call through the actual deployed endpoint and got the identical base64 string with `argCount:1`, plus the new fields present but additive (`output:""`, `byRefValues:{}`, `truncated:false`) — nothing about the pre-existing shape changed.
- **BOOTSTRAP_VERSION:** `6422caf6ec31` → `96f36486cc71` → **`b514009cf654`** (final — the last regen followed code review's `Utils.cls` fixes; intermediates `a5ca2184ec4b`/`96f36486cc71` are superseded and only the final hash is meaningful). `bootstrap.test.ts` green (44/44); Rule #39 rosters unchanged — no new class added, `gen:bootstrap` output confirms the same 28 classes in the same order (`ExecuteMCPv2.Utils.cls` first, `REST/Dispatch.cls` last) as before this story. Regen idempotence verified at review: re-running the generator against dev's tree reproduced `96f36486cc71` byte-for-byte before any review patch was applied.
- **Governance:** `gen:governance-baseline:check` (`:check` ONLY, never the bare generator) exit 0 both times it was run; frozen baseline 141 foundation keys / 201 live / 60 post-foundation unchanged. No new tool, action, or governance key — Rules #28/#31/#53 not triggered.
- **Scope discipline:** no TS/`packages/**` file touched (Story 34.3's scope); no new MCP tool or tool-count change.

### File List

- `src/ExecuteMCPv2/REST/Command.cls` — `ClassMethod()` rewritten: null-device capture wrapper (Rule #7 discipline), delegates argument handling to `Utils.InvokeWithArgs`, adds additive `output`/`byRefValues`/`truncated` response fields; `returnValue`/`argCount` unchanged.
- `src/ExecuteMCPv2/Utils.cls` — added `ParseArgEntry`, `BuildByRefNode`, `InvokeWithArgs` (the 20-arg ladder, marker parsing, MAXSTRING-aware dispatch, byRefValues assembly). All three are **public** class methods (an earlier note called them "private helpers"; they carry no `[ Private ]` keyword and are new permanent surface on a bootstrapped class — corrected at code review).
- `src/ExecuteMCPv2/Tests/ClassMethodArgsFixture.cls` — NEW. Target methods used by the test class below (Output/ByRef/mixed/10-arg/20-arg/subscript-output/OREF-out-value/OREF-with-subscripts/nested-OREF/write-capture/moderate-capture/metachar-unicode/ZN-mid-execution/MAXSTRING/target-throws/self-redirect-off/nested-%SYS.Capture targets). Not part of the bootstrap manifest (Rule #39).
- `src/ExecuteMCPv2/Tests/ClassMethodArgsTest.cls` — NEW. **48** `%UnitTest` methods (mechanically counted, Rule #51 — dev wrote 27, QA added 11, code review added 10) covering AC 34.2.1/34.2.2/34.2.3/34.2.4/34.2.6 (R1/R2/R3/R6/R7/R12) plus the Constraint C-2 mechanical pin.
- `packages/shared/src/bootstrap-classes.ts` — regenerated (`gen:bootstrap`); `BOOTSTRAP_VERSION` `6422caf6ec31` → `96f36486cc71` → **`b514009cf654`** (final; the third regen followed code review's `Utils.cls` fixes).
- `_bmad-output/planning-artifacts/epics.md` — Epic 34, AC 34.2.2 amended in place (Rule #42) to record this story's `byRefValues` encoding decision, superseding the epic's original scalars-only assumption.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — `34-2-handler-capture-byref-20args`: `ready-for-dev` → `in-progress` → `review`.
- `_bmad-output/implementation-artifacts/34-2-handler-capture-byref-20args.md` — this story file (Tasks/Subtasks, Dev Agent Record, File List, Status).
- `_bmad-output/implementation-artifacts/deferred-work.md` — added at code review: TERMINAL dispositions for the `34-1-R` batch (AC 34.2.6 + Rule #37 — the mirroring the story prose had claimed but never performed) and the 10 new `34-2-R` deferrals.

### Review Findings

All three adversarial layers (Blind Hunter, Edge Case Hunter, Acceptance Auditor) delivered explicit findings payloads within the 20-minute hard timeout. `failed_layers` is empty — this review is **NOT degraded** (Rule #57 bounded close, frozen-diff snapshot, delivery receipts all satisfied).

**Tally (27 findings after dedup, counted mechanically — Rule #51):** 12 patched · 10 deferred · 5 dismissed · 0 decision-needed.

#### Patched in review (12) — 4 HIGH · 8 MEDIUM

- [x] [Review][Patch] **HIGH — OREF out-value at `$Data=11` truncated the JSON envelope (the original bug by another door)** [src/ExecuteMCPv2/Utils.cls:BuildByRefNode] — the `$IsObject` guard lived inside the `$Data=1` arm, so `Set pOut = obj  Set pOut("k") = 1` (legal ObjectScript) sent a raw OREF to `%Set("value", …)`. **Reproduced live over real HTTP before the fix:** the response body was cut off mid-serialization (`{"status":…,"console":[],"result":` — unparseable, HTTP 200) because `%ToJSON` threw *inside* `RenderResponseBody`, after bytes were on the wire. Guard hoisted to apply to the node's own value at every `$Data` shape and every recursion depth. Fix verified live (`"value":"<Object:…>"` at top level and at child depth) and pinned by `TestByRefOrefWithSubscriptsGuarded` + `TestNestedOrefOutValueGuarded`.
- [x] [Review][Patch] **HIGH — a genuine target error was converted into a success envelope with `truncated:true`** [src/ExecuteMCPv2/Utils.cls:InvokeWithArgs] — `<MAXSTRING>` was detected by substring-matching `GetErrorText`, so a target whose OWN concatenation overflowed (writing nothing at all) returned HTTP 200 with `returnValue:""` and `truncated:true`, and so did any error whose text merely *mentioned* the token. Both **reproduced live over HTTP**. Replaced with a discriminator grounded in live-probed reality (Rule #36): `exTarget.Name = "<MAXSTRING>"` **and** the throw's label (`$Piece` of `exTarget.Location`) being one of `Redirects()`'s capture entry points (`wstr`/`wchr`/`wnl`/`wff`/`wtab`). Probe evidence: capture overflow → `Location="wstr^…"`; target overflow → `Location="ThrowOwnMaxString+3^…"`. Genuine capture truncation still returns partial success with `truncated:true` (re-verified live); genuine target errors now carry their real IRIS text (Rule #9).
- [x] [Review][Patch] **HIGH — AC 34.2.3's rung 10 was never dispatched** [src/ExecuteMCPv2/Tests/ClassMethodArgsTest.cls] — the AC requires counts 0/1/10/11/20, but `TestTenArgsBackCompatShape` is named for ten arguments and passes **one**; sweeping all methods, the arities actually exercised were 0/1/2/11/20/21. Rung 10 is the boundary between the old ceiling and the new one. Added `Target10` fixture + `TestTenArgs` (asserts all 10 positions dispatch and read back).
- [x] [Review][Patch] **HIGH — Constraint C-2 had no mechanical guard, and the tests were structurally blind to it** [src/ExecuteMCPv2/Tests/ClassMethodArgsTest.cls] — production binds `"^"_$ZNAME` from inside `ClassMethod()`, but every capture test hardcodes `"^ExecuteMCPv2.REST.Command.1"`. They prove `Redirects()` is in `.1.int`; they are indifferent to where `ClassMethod()` lands, which is the actual invariant. A future edit splitting `Command.cls` would leave the suite green while capture broke silently in every namespace — the only check was a one-time manual `iris_doc_list`. Added `TestCommandCompilesToSingleGeneratedRoutine` (asserts `.1.int` exists, `.2.int` does not, and the `wstr` label resides there). Both APIs verified live before use (Rule #16).
- [x] [Review][Patch] MEDIUM — a bare JSON `null` array element was silently coerced to `""` while `{"byRef":true,"value":null}` was loudly rejected [src/ExecuteMCPv2/Utils.cls:ParseArgEntry] — the exact `null`-vs-`""` conflation AC 34.2.6/R6 exists to eliminate, left unfixed at every non-marker position, and **missing from the R7 enumeration** that declared itself exhaustive (Rule #56 — "what is MISSING?"). `ParseArgEntry` now takes the array plus the index (the distinction is unavailable once `%Get` has collapsed it) and consults `%GetTypeOf`. Enumeration date advanced to **2026-08-15**.
- [x] [Review][Patch] MEDIUM — AC 34.2.1's "behavior on target runtime error unchanged" clause had no test and no throwing fixture at all [src/ExecuteMCPv2/Tests/ClassMethodArgsFixture.cls] — added `TargetThrows` + `TestTargetRuntimeErrorSurfaces`, asserting the real IRIS text propagates (Rule #9) and `truncated` stays 0.
- [x] [Review][Patch] MEDIUM — AC 34.2.6/R2's ">8KB" leg had no committed regression: `TargetWriteModerate` was an **orphan fixture**, referenced by no test [src/ExecuteMCPv2/Tests/ClassMethodArgsTest.cls] — added `TestModerateCaptureAboveCspBoundary` with an exact-length assertion; also driven end-to-end over real HTTP at review (19,952-byte envelope intact).
- [x] [Review][Patch] MEDIUM — the dispatch ladder lost the terminal `Else` the pre-story code had [src/ExecuteMCPv2/Utils.cls:InvokeWithArgs] — with 21 branches and no fallback, any future change to how the count is derived would fall through, never call the target, and still report success. Defensive error restored.
- [x] [Review][Patch] MEDIUM — a comment claimed a guarantee the code does not provide [src/ExecuteMCPv2/Utils.cls:InvokeWithArgs] — "wrapped separately so a target throw … doesn't skip the by-ref read-back" is false: `If $$$ISERR(tSC) Quit` skips it for every non-`<MAXSTRING>` throw. Comment corrected on a public method whose contract 34.3 will consume.
- [x] [Review][Patch] MEDIUM — capture tests had no teardown guard [src/ExecuteMCPv2/Tests/ClassMethodArgsTest.cls] — a failure between redirect-on and redirect-off would leave the process redirected and silently swallow every subsequent test's output. `OnAfterOneTest` now restores unconditionally.
- [x] [Review][Patch] MEDIUM — story tallies were hand-authored and wrong (Rule #51) [this file] — File List said "27 `%UnitTest` methods" against a file containing 38 (now 48); the Debug Log's Rule #35 evidence was recorded against the superseded count; the fixture roster predated QA's four added targets; `ParseArgEntry`/`BuildByRefNode` were described as "private helpers" but carry no `[ Private ]` keyword. All corrected from mechanical counts.
- [x] [Review][Patch] MEDIUM — `deferred-work.md` was never updated, so AC 34.2.6's "must reach a TERMINAL disposition" and Rule #37's "mirror the disposition table into the ledger" were satisfied only in story prose [_bmad-output/implementation-artifacts/deferred-work.md] — added the full `34-1-R` disposition table (6 resolved · 1 closed-by-decision · 8 re-deferred, Rule #37 count 1) and the 10 new `34-2-R` entries.

#### Deferred (10) — 6 MEDIUM · 4 LOW

All ten are recorded in `deferred-work.md` under *Deferred from: code review of 34-2-handler-capture-byref-20args (2026-08-14)*, each with originating story, severity, rationale, and suggested resolution.

- [x] [Review][Defer] MEDIUM — `34-2-R1` a capture `<MAXSTRING>` swallowed by the target's own `Try/Catch` yields a silent partial (`truncated:false`) — **the most consequential deferral; read this one at the commit gate.** Narrow (needs >2M chars AND an exception-swallowing target), but it is the one remaining shape of the "silent partial" AC 34.2.6/R2 forbids. Not fixed here because the correct fix edits `Command.cls`'s `Redirects()` labels (Constraint C-2 re-verification) and forces `TargetWriteHuge` rework. Concrete design recorded in the ledger.
- [x] [Review][Defer] MEDIUM — `34-2-R2` no size cap on `output`/`byRefValues`; the partial-success path returns a 2–4 MB body (Rule #38 shape). Product decision on the ceiling belongs to 34.3's tool contract.
- [x] [Review][Defer] MEDIUM — `34-2-R3` `RenderResponseBody`'s `%Status` is discarded; a mid-stream serialization failure ships a truncated HTTP 200 body. Root trigger fixed above; the pattern is shared by every `ExecuteMCPv2.REST.*` handler.
- [x] [Review][Defer] MEDIUM — `34-2-R4` `BuildByRefNode`'s per-level `Merge` is O(nodes × depth) with no depth bound.
- [x] [Review][Defer] MEDIUM — `34-2-R5` `Open tNull:::1` `$Test` unchecked and `tRedirected` set after the `Use`, leaking the null device — now at two call sites (carries 34-1-R15 + 34-1-R8 forward exactly as predicted). Pre-existing in `Execute()`.
- [x] [Review][Defer] MEDIUM — `34-2-R9` no endpoint-level regression for `ClassMethod()`'s own response shape; all 48 tests drive `Utils.InvokeWithArgs` directly. Belongs to 34.3's live smoke set.
- [x] [Review][Defer] LOW — `34-2-R6` success-path I/O teardown unguarded; a `Close tNull` throw turns a successful call into an error.
- [x] [Review][Defer] LOW — `34-2-R7` `args:""` / `args:null` accepted as zero arguments (R12 partial).
- [x] [Review][Defer] LOW — `34-2-R8` `byRef:false` binds by reference anyway; the flag gates read-back only. Naming/doc risk on the surface 34.3 exposes.
- [x] [Review][Defer] LOW — `34-2-R10` the by-ref read-back runs in the target's post-`ZN` namespace, depending on the `%All` mapping (Constraint C-1). Verified live in a second namespace.

#### Dismissed (5)

- Empty-string subscripts dropped by `BuildByRefNode`'s `$Order` loop — **state unreachable**: IRIS 2026.1 raises `<SUBSCRIPT>Subscript 1 is ""` on `Set arr("")="x"`. Verified live over HTTP; independently falsified by the Edge Case Hunter (Rule #54 — a branch the real system cannot reach is worse than a missing one).
- `subscripts` always emitted while the doc says `{value?, subscripts?}` — `$Data ≥ 10` means children exist, so the key is never spuriously empty in any reachable state.
- `epics.md` AC 34.2.2 amended in place while the story's own copy of the AC was not — `epics.md` is the AC source of record and Rule #42 mandates amend-in-place there; the story's Completion Notes carry the same decision. Doc-structure preference, not a defect.
- Unicode/control-character `output` unproven over real HTTP — **proven during this review**: `TargetWriteMetachars` through the deployed route returned `"quote\"backslash\\brace{}\n\r\n\ttab-afterunicode-héllo-世界-😀"`, correctly escaped, envelope intact.
- `<MAXSTRING>`-on-render theory (a huge `output` overflowing during envelope serialization) — self-falsified by the Edge Case Hunter: `%ToJSON()` **to a device** streams the payload cleanly; only building it as a string overflows.

#### Lead verification performed during this review (beyond the layers)

Live IRIS `2026.1`, `HSCUSTOM` + `USER`, via the deployed route `POST /api/executemcp/v2/classmethod`:

1. **Cross-namespace capture (C-1, closes 34-1-R4/R9):** `namespace:"USER"` with a `ZN`-ing, writing, ByRef-mutating target returned complete capture and correct read-back (Rule #34 second-environment coverage).
2. **AC 34.2.6/R3 re-verified at the HTTP layer**, not just in `%UnitTest`: nested `%SYS.Capture` and self-`ReDirectIO(0)` both left the envelope clean, and a follow-up call proved device state clean.
3. **~20KB output past the ~8KB CSP boundary:** 19,952-byte envelope, intact.
4. **Back-compat (Rule #19), mechanically:** `git diff HEAD` confirms the `returnValue`/`argCount` `%Set` lines are byte-identical to pre-story; the live call returns the identical base64 with `argCount:1` plus the additive fields.
5. **Gates:** `iris_execute_tests` → **48/48** (matches the mechanical `Method Test` count, Rule #35); `@iris-mcp/shared` full suite 65 files / 1300 tests green; `bootstrap.test.ts` 44/44; `gen:governance-baseline:check` (`:check` ONLY, Rule #25) exit 0 with frozen `141`/`201`/`60` unchanged and the baseline file untouched; Rule #39 rosters unmoved; Rule #15 grep clean in the new code.
6. **Probe hygiene:** the disposable `ExecuteMCPv2.Temp.Story342Review` probe class was deleted from the server (`iris_doc_list(filter="ExecuteMCPv2.Temp")` → `{"items":[]}`) and from disk (the `src/ExecuteMCPv2/Temp/` directory is removed).

#### Not fixed here, by design

`cycle-log-epic-34.md` records `files=6` where the File List enumerates more, and the QA stage's `closing_sections_present=true` is asserted although the story carries no QA Results section. The cycle log is the lead's artifact — flagged, not edited.
