# Story 34.1: ClassMethod Invocation Probe

Status: done

## Story

As a **dev agent**,
I want **the by-ref and capture claims verified live before coding**,
so that **34.2 codes against pinned behavior, not assumptions (Rules #14/#16).**

## Acceptance Criteria

- **AC 34.1.1** — Disposable `ExecuteMCPv2.Temp.*` probe proves `$ClassMethod` passes locals by reference (`.tArg`) such that an `Output`/`ByRef` formal's post-call value is readable, including an undefined-in (Output-style) case; **exact working call shape recorded**.
- **AC 34.1.2** — Probe proves the null-device redirect pattern (from `Execute()`) captures a target method's `Write` output when invoked via `$ClassMethod`, including a target that switches namespace (`ZN`) mid-execution (bug-report reproduction 3's shape).
- **AC 34.1.3** — 20-argument `$ClassMethod` call verified (no undocumented platform arg ceiling below 20); **probe classes deleted before commit**.

## Deliverable — read this first

**This story produces PINNED FINDINGS, not production code.** Do NOT modify `src/ExecuteMCPv2/REST/Command.cls` or any `packages/**` file. The output is a **Probe Findings** section appended to this story file, written so Story 34.2 can code directly against it without re-probing.

Every finding must record:
1. The **exact working call shape** (verbatim ObjectScript, copy-pasteable into 34.2).
2. The **shapes that did NOT work**, and the error each produced — negative results are as load-bearing as positive ones, because they tell 34.2 what to avoid.
3. The **live evidence** (what was called, what came back).

If a probe **falsifies** an assumption in the epic scope or in the Dev Notes below, that is a success, not a failure: record the falsification prominently and flag it for the Story 34.2 spec (Rule #42 — amend the planning artifact in place if the epic's stated design is wrong).

## Tasks / Subtasks

- [x] **Task 1 — By-ref probe** (AC: 34.1.1)
  - [x] Create a disposable `ExecuteMCPv2.Temp.ByRefProbe` with target methods exercising: `Output` formal (undefined-in), `ByRef` formal (defined-in), and a mixed scalar+byref signature.
  - [x] Prove which call shape actually propagates the post-call value. Test at minimum: `$ClassMethod(c, m, .tA0)` with `tA0` materialized into a local FIRST, versus the current production shape `$ClassMethod(c, m, tArgs.%Get(0))`.
  - [x] Record whether an **undefined** local can be passed as `.tA0` (the Output-style case) and what the formal sees.
  - [x] Record how a by-ref arg interacts with a target that does NOT declare the formal as `Output`/`ByRef` (a scalar formal receiving `.tA0`).
- [x] **Task 2 — Capture probe** (AC: 34.1.2)
  - [x] Prove the `Execute()` null-device redirect captures `Write` output from a target invoked through `$ClassMethod`.
  - [x] Prove it for a target that does `ZN` mid-execution and writes from BOTH namespaces (repro 3's shape).
  - [x] Record what happens to the captured text and to `$NAMESPACE` when the target leaves the namespace switched (does the endpoint's `Set $NAMESPACE = tOrigNS` recover it?).
  - [x] Record the interaction between capture and a target that **throws** mid-write (partial capture? redirect left on?).
- [x] **Task 3 — 20-arg ceiling** (AC: 34.1.3)
  - [x] Verify a 20-argument `$ClassMethod` call compiles and executes. *(Partial — the "record the highest arity that actually works" half was deliberately NOT done; arities above 20 were never probed. AC 34.1.3's actual requirement, "no undocumented platform arg ceiling **below** 20", is fully satisfied. Flagged at code review so the checkbox does not overclaim; see Finding 5's Scope note.)*
  - [x] Verify the by-ref shape still works at arity 20 (all 20 materialized as locals).
- [x] **Task 4 — Cleanup** (AC: 34.1.3)
  - [x] Delete every `ExecuteMCPv2.Temp.*` class created; verify deletion live.
  - [x] Clean up any debug globals used (`^ClineDebug` or similar).
  - [x] Confirm `git status --short` shows no probe artifacts and no `src/**` changes.

## Dev Notes

### The three seams — verified live on the current tree (2026-08-14)

All line numbers are [src/ExecuteMCPv2/REST/Command.cls](src/ExecuteMCPv2/REST/Command.cls). **You do not need to go hunting — this is the complete picture.**

#### Seam 1: the by-ref blocker (the single most important thing to pin)

`ClassMethod()`'s argument ladder ([Command.cls:159-188](src/ExecuteMCPv2/REST/Command.cls#L159-L188)) passes **method-call expressions**, not variables:

```objectscript
Set tReturn = $ClassMethod(tClassName, tMethodName, tArgs.%Get(0), tArgs.%Get(1))
```

ObjectScript by-reference passing requires `.localvariable` syntax. `tArgs.%Get(0)` is an expression — there is **no variable to reference**. So the current ladder is structurally incapable of by-ref, and 34.2 will have to materialize each argument into a local first:

```objectscript
Set tA0 = tArgs.%Get(0)
Set tReturn = $ClassMethod(tClassName, tMethodName, .tA0)
```

**This is the hypothesis, not a proven fact — that is exactly what AC 34.1.1 exists to pin.** Prove it works, and record the verbatim shape. Also pin the undefined-in case: an `Output` formal is normally passed a local that does not yet exist, so probe whether `.tA0` must be `Kill`ed / left undefined and whether that is legal through `$ClassMethod`.

#### Seam 2: the capture pattern and its hard-won constraint

`Execute()` ([Command.cls:50-83](src/ExecuteMCPv2/REST/Command.cls#L50-L83)) carries the capture pattern 34.2 must reuse. **Read its comment block before probing** — it documents a bug that will silently recur if the pattern is copied carelessly:

```objectscript
Set %ExecuteMCPOutput = ""
Set tInitIO = $IO
Set tNull = ##class(%Library.Device).GetNullDevice()
Open tNull:::1
Use tNull::("^"_$ZNAME)          ; mnemonic bound on tNull, NOT $IO
Set tRedirected = 1
Do ##class(%Library.Device).ReDirectIO(1)
; ... target invocation ...
Do ##class(%Library.Device).ReDirectIO(0)
Use tInitIO
Close tNull
```

> **CRITICAL — from the source comment:** binding the mnemonic on `$IO` (the HTTP response stream) "leaves device parameters altered even after `ReDirectIO(0)` + bare `Use tInitIO`, which causes CSP's response-body flush to silently drop the first ~8KB of the JSON envelope when it exceeds the buffer boundary. By doing the redirect on a throw-away null device, the HTTP response stream stays pristine."

This is the same class of failure as the bug being fixed (a corrupted response envelope), so a careless copy re-introduces it in a subtler form. `ClassMethod()` today has **no redirect at all** — `ReDirectIO` appears only in `Execute()`.

Related project rule already on the books — **Rule #7**: fully restore before rendering (`ReDirectIO(0)` then bare `Use tInitIO`; note `Use tInitIO::("")` is a NO-OP that does not clear the mnemonic), and exactly ONE `RenderResponseBody` per request.

#### Seam 3: cross-namespace capture

Capture works across namespaces because of a bootstrap-time mapping, documented at [Command.cls:42-44](src/ExecuteMCPv2/REST/Command.cls#L42-L44):

> "The ExecuteMCPv2 package is mapped to %All namespace at bootstrap time, so the compiled routine (with I/O redirect mnemonic labels) is available in every namespace, enabling cross-namespace command execution."

The mnemonic routine is referenced as `"^"_$ZNAME`, and the redirect entry points live at [Command.cls:212+](src/ExecuteMCPv2/REST/Command.cls#L212).

**The gap AC 34.1.2 must close:** that mapping is known to work when *the endpoint* switches namespace up front. Bug-report reproduction 3 is different — the **target method** switches namespace (`ZN`) *mid-execution*, while the redirect is already active. Whether the mnemonic routine stays resolvable across that switch is **unproven**, and it is the single most likely place 34.2's implementation breaks. Probe it directly; do not reason about it.

Note `ClassMethod()` already restores namespace before rendering ([Command.cls:191](src/ExecuteMCPv2/REST/Command.cls#L191)) via `Set $NAMESPACE = tOrigNS`, with `tOrigNS` initialized at [Command.cls:124](src/ExecuteMCPv2/REST/Command.cls#L124) before the Try — so the restore is safe even when no `namespace` was supplied. Confirm this still holds when the target leaves the namespace changed.

#### Seam 4: the arg ceiling

[Command.cls:184](src/ExecuteMCPv2/REST/Command.cls#L184): `"Too many arguments: maximum is 10, received "`. The ladder runs 0..10. AC 34.1.3 asks whether the platform tolerates 20 — verify empirically rather than trusting the docs.

### How to probe — project conventions (non-negotiable)

- **Rule #16 / #14 — probe over search.** Prefer a live `ExecuteMCPv2.Temp.*` probe class + `iris_execute_classmethod` over web search for IRIS-idiosyncratic behavior. Use Perplexity only for concepts, never for exact API shapes.
- **ObjectScript on disk first** — create probe `.cls` files on disk under `src/ExecuteMCPv2/Temp/`, then load with `iris_doc_load` using a **glob-prefixed path** (Rule #17): `c:/git/iris-execute-mcp-v2/src/**/ByRefProbe.cls`. A bare file path collapses the class name to `User.<stem>`.
- Compile via the `iris_doc_compile` MCP tool.
- **`iris_execute_classmethod` only works on `ClassMethod`s**, not instance methods.
- **Always specify the `namespace` parameter** on IRIS MCP tool calls. Default working namespace for this project is `HSCUSTOM`; the second namespace for the cross-namespace leg can be any other mounted namespace (e.g. `USER`) — record which you used.
- **Do NOT use `iris_execute_command` for complex debugging** — build a probe classmethod and call it. `execute_command` handles only very simple commands.
- Debug-global pattern if needed: `Set ^ClineDebug = ""` then append `Set ^ClineDebug = ^ClineDebug_"step; "`, inspect via `iris_global_get`, and **clean up afterward**.

### ObjectScript constraints that will bite in probe code

- **`Quit` with arguments is ILLEGAL inside a Try/Catch block** (ERROR #1043). Initialize a result variable before the Try, set it inside, use argumentless `Quit`, and return after the Try/Catch.
- Macros use **triple** `$$$`, never `$$`. If you hit multiple `$`/`$$` syntax errors, rewrite the whole file rather than patching (project rule).
- Method names must not contain underscores; class parameters must not contain underscores.
- Never edit or add a `Storage` section — the compiler owns it.
- Indent every command inside a method by at least one space.
- Use `///` doc comments, not `//`.

### Scope boundaries

- **Do NOT modify** `src/ExecuteMCPv2/REST/Command.cls`, `packages/**`, `bootstrap-classes.ts`, or `BOOTSTRAP_VERSION`. Those are Story 34.2's deliverable.
- **Do NOT** add the new probe classes to the bootstrap manifest (Rule #39: `ExecuteMCPv2.Tests.*` and temp/probe classes stay OUT).
- No governance key, no tool count change, no new MCP tool — none of Rules #28/#31/#53 are triggered by this story.
- The frozen governance baseline must be untouched (#23/#25) — do not run any baseline generator.

### Testing

This story adds no automated tests. Its verification IS the live probe evidence recorded in the Probe Findings section. Story 34.2 owns the `%UnitTest` coverage (AC 34.2.3).

### References

- [Source: `docs/bugs-2026-08-14.md`] — the three live reproductions; note repro 3 (`CICD.ConfigureAll.Now()`) is the `ZN`-mid-execution shape, and the `%SYS.Capture` wrapper the reporter used as a workaround
- [Source: `_bmad-output/planning-artifacts/epics.md#Epic 34`] — epic scope, the `{byRef, value?}` marker design (stakeholder-selected), and Stories 34.2/34.3 this probe feeds
- [Source: `src/ExecuteMCPv2/REST/Command.cls#L50-L83`] — the null-device capture pattern to reuse
- [Source: `src/ExecuteMCPv2/REST/Command.cls#L159-L188`] — the arg ladder and its by-ref blocker
- [Source: `.claude/rules/project-rules.md#7`] — I/O redirect + single-response dispatch discipline
- [Source: `.claude/rules/iris-objectscript-basics.md`] — Try/Catch `Quit` restriction, macro syntax, naming

---

## Probe Findings

**Environment:** IRIS for Windows (x86-64) 2026.1 (Build 235U), Atelier API v8 — *version string independently re-verified live at code review via `iris_server_info` → `"IRIS for Windows (x86-64) 2026.1 (Build 235U)"`, `"api":8`; exact match.* Primary namespace `HSCUSTOM`; cross-namespace leg used `USER`.

**Probe classes created across ALL stages of this story (roster corrected at code review — the original listed only the two dev-stage classes):**

| Stage | Class | Deleted |
|---|---|---|
| dev | `ExecuteMCPv2.Temp.ByRefProbe` | yes |
| dev | `ExecuteMCPv2.Temp.CaptureProbe` | yes |
| qa | `ExecuteMCPv2.Temp.QaProbeByRef` | yes |
| qa | `ExecuteMCPv2.Temp.QaProbeCapture` | yes |
| qa | `ZZQaGenProbe.Capture` (deliberately outside `ExecuteMCPv2`) | yes |
| code review | `ExecuteMCPv2.Temp.CrProbe` | yes |

All six verified absent from the server and from disk — see Task 4 evidence below. No `packages/**`, `src/ExecuteMCPv2/REST/Command.cls`, or bootstrap files were touched at any stage.

> **QA independent re-verification (2026-08-14, `qa` stage) — all FIVE findings re-run with independent probes (four reproduced as stated, one mechanism corrected).** *(Tally corrected at code review per Rule #51: the original said "all three load-bearing findings", contradicting its own next sentence and the cycle-log entry `findings_reverified=5 findings_corrected=1`.)* Per Rule #36 (independent oracle), a second dev wrote entirely fresh probe classes with different names (`ExecuteMCPv2.Temp.QaProbeByRef`, `ExecuteMCPv2.Temp.QaProbeCapture`, plus a third generalization probe `ZZQaGenProbe.Capture` deliberately placed OUTSIDE the ExecuteMCPv2 package to test a mapping-dependence question the original probe could not distinguish) and re-ran every claim live. Findings 1, 2, 4, and 5 reproduced exactly as stated — see the "QA re-verification" callouts inline below. **Finding 3's practical conclusion also reproduced, but its stated MECHANISM was wrong** — corrected in place below with stronger evidence; see the "QA correction" callout in Finding 3. All QA probe classes were deleted from IRIS and disk before this update was saved (Task 4 discipline applied to the QA stage's own artifacts too).

### Finding 1 (AC 34.1.1) — `.localvariable` materialized-first IS the correct by-ref shape through `$ClassMethod`, and it works for `Output` (undefined-in), `ByRef` (defined-in), and mixed scalar+byref signatures

**Claim (Dev Notes hypothesis):** the current ladder (`$ClassMethod(tClassName, tMethodName, tArgs.%Get(0), ...)`) is structurally incapable of by-ref because `tArgs.%Get(0)` is an expression, not an lvalue; 34.2 will need `Set tA0 = tArgs.%Get(0)` then `$ClassMethod(tClassName, tMethodName, .tA0)`.

**Probe:** `ExecuteMCPv2.Temp.ByRefProbe.RunAll()` drove five tests across **four** distinct target methods through `$ClassMethod` with a hardcoded string class/method name (matching production's fully-dynamic dispatch) — one per by-ref shape, with Tests B and C sharing the `TargetByRef` target so the two call shapes could be compared against an identical callee. *(Corrected at code review per Rule #51: the original text said "five target methods"; the table below has five tests over four targets.)*

**⚠ Evidence-quality note (added at code review, Rule #36):** Finding 1 is the only finding whose dev-stage result is a **hand-authored summary table** rather than a quoted raw result string — Findings 2/3/4/5 each quote a verbatim capture. Finding 1 is also the most load-bearing finding in this story, so treat **QA's quoted live string** in the callout below as the pinned oracle for Tests A/B/D/E. **Test C is the exception and is the weakest-evidenced row in the story:** the dev's Test C used the true production shape (`tArr.%Get(0)`, an expression), but QA's re-run reports `tC0after=cvalue`, a *named local passed without a dot* — a different negative shape. So the specific claim "the `%Get()` expression shape is legal but cannot propagate" rests on one un-quoted dev run. Its conclusion is not in doubt (an expression has no lvalue to write back to — this is definitional in ObjectScript, and 34.2 abandons that shape anyway), but the QA callout's blanket "Tests A/B/C/D/E all match the dev's claims exactly" overstates Test C specifically.

**Result — CONFIRMED, plus one important extra finding:**

| Test | Target formal | Call shape | Result |
|---|---|---|---|
| A | `Output pOut As %String` | `Kill tA0` then `$ClassMethod(class,"TargetOutput",.tA0)` | `tA0` = `"setByOutput"` after call — undefined-in Output case works |
| B | `ByRef pVal As %String` | `Set tB0="before"` then `$ClassMethod(class,"TargetByRef",.tB0)` | `tB0` = `"before-mutated"` after call — defined-in ByRef case works |
| C | `ByRef pVal As %String` | `$ClassMethod(class,"TargetByRef", tArr.%Get(0))` (production's CURRENT shape — expression, no dot) | **No compile/runtime error** (`error=""`, `return=1`/`$$$OK`). The call is legal but the mutation is invisible — there is no caller-side lvalue to receive it. This CONFIRMS the Dev Notes hypothesis: the current ladder doesn't crash, it just can't propagate output. |
| D | `pScalar As %String` (value) + `ByRef pByRef As %String` | `$ClassMethod(class,"TargetMixed","scalarval",.tD1)` | Scalar arg passed by value (`"scalarval"` seen by callee, caller's literal untouched — N/A, it's a literal); `tD1` mutated `"byrefstart"` → `"byrefstart-mixedmutated"`. Mixed signatures work with per-argument by-ref/by-value control. |
| E | `pScalar As %String` (**plain value formal, NOT declared ByRef/Output**) | `Set tE0="scalarstart"` then `$ClassMethod(class,"TargetScalar",.tE0)` | **`tE0` = `"scalarstart-innermutated"` after call — the caller's variable WAS mutated even though the callee's formal has no ByRef/Output keyword.** |

**Falsification / extra finding (Rule #42):** Test E shows that through `$ClassMethod` dynamic dispatch, whether an argument is passed by reference is controlled by the **caller's** `.` syntax, not by the callee's declared parameter-passing mode. This isn't stated anywhere in the epic scope or Dev Notes (which only discussed `Output`/`ByRef` formals) — it's a genuine new finding, not a contradiction of anything asserted, but 34.2 should be aware of it: **materializing an arg as `.tArgN` before calling `$ClassMethod` creates a real by-ref binding regardless of the target method's own signature.** This is safe for 34.2's design (a value-only target simply won't have its formal declared ByRef, so no one will rely on the mutation-back — it's inert), but it means 34.2 cannot use "the target declares ByRef" as a safety gate; the caller-side marker (`{byRef: true}`) is the only thing that decides by-ref behavior, and materializing-then-`.`-passing is safe to do unconditionally.

**Verbatim working call shape (positive):**
```objectscript
    Set tA0 = tArgs.%Get(0)   ; or Kill tA0 for an intentional Output-style undefined-in
    Set tReturn = $ClassMethod(tClassName, tMethodName, .tA0)
    ; tA0 now reflects whatever the target formal did to it, whether declared ByRef/Output or not
```

> **Scope of this snippet (clarified at code review):** it pins the **binding** mechanics only. It is NOT the complete 34.2 argument pipeline — under the epic's marker design a marked entry is a JSON **object**, so a literal `tArgs.%Get(0)` on that entry yields a `%DynamicObject` OREF (the marker wrapper), not the value. 34.2 must unwrap `{byRef, value?}` first (`%Get("value")`, or leave `tA0` undefined when `value` is absent — see the entry-state evidence below) and only then dot-pass. Marker detection/rejection rules live in `epics.md` Epic 34 scope, not in this probe. Note also that the snippet's leading indentation matters: these lines go inside a method body, where ObjectScript requires at least one leading space.

**Verbatim shape that does NOT propagate output (negative, but doesn't error):**
```objectscript
    Set tReturn = $ClassMethod(tClassName, tMethodName, tArgs.%Get(0))   ; no error, but no way to read mutations back
```

**Implication for 34.2 (wording reconciled at code review — the original was self-contradictory):** the materialize-to-local-then-`.`-pass pattern is proven and safe to use **unconditionally for EVERY argument position, marked or not** — no need to special-case Output vs. ByRef vs. plain-value targets, and no need to know the target's declared signature. The `{byRef, value?}` marker does **not** decide *binding* (everything is dot-passed); it decides only **which positions are READ BACK into `byRefValues`**. The earlier phrasing "unconditionally for every argument position the marker flags" was narrower than the falsification paragraph above it and than the QA callout below it; all three now agree on the broad reading.

**Evidence boundary (added at code review — do not over-read "unconditionally"):** every probed value in Tests A–F is a short `%String`. "Safe unconditionally" is established for **string scalars**, which is the value class that actually reaches the ladder under the epic's design (non-marker object entries are rejected, and `ByRef` OREF *arguments* are explicitly out of epic scope). Numbers, booleans, JSON `null`, very long strings, and OREF **out-values** were NOT probed — see Residual Risk.

**Additional live evidence gathered at code review — closes Task 1 sub-bullet 3 ("what the formal sees") and pins an `epics.md` design claim:** the epic states *"omitted `value` = undefined, `Output`-style"*, but neither the dev nor QA recorded the formal's ENTRY state, only the caller's post-call value. Probed directly (`ExecuteMCPv2.Temp.CrProbe`, `HSCUSTOM`, deleted after use), passing a `Kill`ed local as `.tA0`:

| Target formal | Live result (as seen INSIDE the target) |
|---|---|
| `pA As %String` (plain, **no default**) | `data=0, val=<undef>` — formal genuinely undefined, **no error raised** |
| `pA As %String = "DEFAULTVAL"` (plain, **declared default**) | `data=1, val=DEFAULTVAL` — **the declared default IS applied** |
| `ByRef pA As %String = "BRDEFAULT"` (**declared default**) | `data=1, val=BRDEFAULT` — default applied for `ByRef` formals too |
| control: argument **omitted entirely** | `data=1, val=DEFAULTVAL` — identical to the undefined-by-ref case |

**Two conclusions 34.2 can rely on:** (1) the epic's "omitted `value` = undefined, Output-style" claim is **CONFIRMED** — a dot-passed undefined local leaves the formal undefined (`$Data=0`) with no error, so `If $Data(pOut)` guards inside target methods behave as the design assumes; (2) passing an undefined local by reference is **indistinguishable from omitting the argument** where the formal declares a default — the default is applied in both cases. A plausible worry that dot-passing would *suppress* a declared default is therefore falsified.

> **QA re-verification (2026-08-14):** independently reproduced with `ExecuteMCPv2.Temp.QaProbeByRef.RunAll()` (fresh class, fresh target-method names `TgtOutput`/`TgtByRef`/`TgtPlainWrite`/`TgtMixed`). Live result: `A:tA0=qa-output-set|B:tB0=before-qa-byref-mutated|C:tC0after=cvalue|retC=1|D:tD1=dstart-qa-mixed-mutated|retD=dscalar-seen|E:tE0=escalarstart-qa-plainwrite-mutated|retE=escalarstart-qa-plainwrite-mutated|F:tF0after=fscalarstart|retF=fscalarstart-readonly-seen|errF=`. Tests A/B/C/D/E all match the dev's claims exactly, including Test E's caller-controls-binding result (`tE0` mutated even though `TgtPlainWrite`'s formal has no `ByRef`/`Output` keyword). **Additional Test F closes the corollary the story asked QA to check:** a plain (non-`ByRef`/`Output`) formal that the target does NOT write to, called with `.tF0` — result `tF0after=fscalarstart` (unchanged, exactly the literal passed in) and `errF=` (empty — no exception of any kind). **Confirmed: materializing an arg as `.tArgN` and passing it to a formal the target never assigns is silently inert — it never errors.** 34.2 can pass `.tArgN` unconditionally for every position without needing to know in advance whether the target's formal is declared `ByRef`.

---

### Finding 2 (AC 34.1.2, part 1) — `$ClassMethod` dispatch is captured by the null-device redirect exactly like `XECUTE`

**Claim:** the `Execute()` capture pattern (Command.cls:56-83) needs to work when the invocation is `$ClassMethod(...)` rather than `XECUTE`.

**Probe:** `ExecuteMCPv2.Temp.CaptureProbe.RunCapture("Target1")` — reproduced the exact redirect pattern (null device, mnemonic bound via `Use tNull::("^"_$ZNAME)`, `ReDirectIO(1)`/`(0)`, restore `tInitIO`) around a `$ClassMethod` call to a two-`Write` target, with the mnemonic entry points (`wstr`/`wchr`/`wnl`/`wff`/`wtab`/`rstr`/`rchr`) defined in the SAME class as the driver (so `$ZNAME` resolves to the same compiled routine).

**Result — CONFIRMED.** Live call: `iris_execute_classmethod(className="ExecuteMCPv2.Temp.CaptureProbe", methodName="RunCapture", args=["Target1"])` →
```
target=Target1|threw=0|errText=|nsAfterCallBeforeRestore=HSCUSTOM|nsAfterRestore=HSCUSTOM|origNS=HSCUSTOM|captured=[target1-line1\ntarget1-line2]
```
Both `Write` lines were captured verbatim.

**Implication for 34.2:** the capture pattern from `Execute()` can be reused as-is around a `$ClassMethod` call site — no adaptation needed for the redirect mechanics themselves.

> **QA re-verification (2026-08-14):** independently reproduced with `ExecuteMCPv2.Temp.QaProbeCapture.RunCapture("Tgt1")` (fresh class/driver, fresh mnemonic-buffer variable `%QaCaptureOutput`, fresh target method name). Live result: `target=Tgt1|threw=0|errText=|nsAfterCallBeforeRestore=HSCUSTOM|nsAfterRestore=HSCUSTOM|origNS=HSCUSTOM|captured=[qa-t1-line1\nqa-t1-line2\n]`. Both `Write` lines captured verbatim — confirms.

---

### Finding 3 (AC 34.1.2, part 2 — the highest-value unknown) — the mnemonic routine STAYS resolvable when the target does `ZN` mid-execution **because the DRIVER's routine is `%All`-mapped (NOT the target's)**; the endpoint's `Set $NAMESPACE = tOrigNS` recovers correctly in the single-`ZN` case probed

> **⚠ READ THE QA CORRECTION AT THE END OF THIS FINDING BEFORE CODING 34.2.** The practical conclusion holds, but it holds for a *different reason* than the dev's original probe suggested, and that reason imposes a hard implementation constraint on Story 34.2 (see **Constraints for Story 34.2** below). Do not stop reading at the Implication bullet.

**Claim:** unproven — whether the I/O-redirect mnemonic routine stays resolvable when the TARGET method switches namespace mid-execution (bug-report repro 3's shape: `CICD.ConfigureAll.Now()`, which narrates via `Write` and does `ZN` during execution).

**Probe:** `ExecuteMCPv2.Temp.CaptureProbe.Target2()` writes `"before-zn:"_$NAMESPACE`, executes `ZN "USER"`, then writes `"after-zn:"_$NAMESPACE`. Driven through the same `RunCapture` redirect harness, starting in `HSCUSTOM`.

**Result — CONFIRMED, this is the falsification the story flagged as the most likely break point, and it did NOT break.** Live call: `iris_execute_classmethod(className="ExecuteMCPv2.Temp.CaptureProbe", methodName="RunCapture", args=["Target2"])`, namespace=`HSCUSTOM` →
```
target=Target2|threw=0|errText=|nsAfterCallBeforeRestore=USER|nsAfterRestore=HSCUSTOM|origNS=HSCUSTOM|captured=[before-zn:HSCUSTOM\nafter-zn:USER\n]
```
- Both `Write`s captured across the namespace switch — no `<UNDEFINED>` or mnemonic-resolution error of any kind.
- `$NAMESPACE` was correctly left at `USER` immediately after the call returned (`nsAfterCallBeforeRestore=USER`) — the `ZN` inside the target genuinely persists past return, exactly as expected.
- The endpoint-style restore (`Set $NAMESPACE = tOrigNS`, run unconditionally after the call) correctly recovered to `HSCUSTOM` (`nsAfterRestore=HSCUSTOM`) — confirming `ClassMethod()`'s existing restore-before-render pattern (Command.cls:191) will remain correct even when the target leaves the namespace switched.

**Supporting context (⚠ SUPERSEDED — the causal half of this paragraph is WRONG; corrected by QA below, amended in place per Rule #42):** confirmed via `iris_doc_list(namespace="USER", filter="CaptureProbe")` that `ExecuteMCPv2.Temp.CaptureProbe.cls` is visible from `USER` (backed by the `HSCUSTOM` database) — the package-level `%All` mapping (Command.cls:42-44) does cover the `Temp` subpackage too. ~~which is consistent with why the mnemonic stayed resolvable across the switch~~ — **struck: the TARGET's mapping is irrelevant.** QA proved with a controlled cross-package probe that resolvability depends on the **DRIVER's** mapping. The `Temp`-subpackage observation is a true but causally inert fact about the dev's probe layout; it is NOT the mechanism.

**Implication for 34.2:** no special-case handling is needed *in the call/restore logic* for targets that `ZN` mid-execution — the existing `Execute()`-style redirect + the existing `ClassMethod()` restore-**before**-render pattern (`Set $NAMESPACE = tOrigNS` after the call and before `RenderResponseBody`, unconditionally) are sufficient as-is. **BUT this guarantee is conditional on where the mnemonic labels live** — see **Constraints for Story 34.2** immediately below. Scope note: probed with a SINGLE `ZN` to one namespace; multi-`ZN` targets, `New $NAMESPACE` targets, and `ZN`-to-inaccessible-namespace are unprobed (see Residual Risk).

> **QA correction (2026-08-14) — practical conclusion CONFIRMED, but the dev's stated MECHANISM was wrong; corrected here with stronger evidence.** The dev's probe had the driver (`RunCapture`) and the `ZN`-ing target (`Target2`/`Tgt2`) as methods of the **same** class, so it could not distinguish "the target's own class happens to inherit the `%All` mapping" from "the driver's own class is `%All`-mapped." QA built a probe specifically to separate these two variables, per the task's instruction to check whether the finding "depends on the mapping... or is an artifact of where the probe class lived":
> 1. **Self-contained non-mapped case** — created `ZZQaGenProbe.Capture` in a brand-new package **deliberately outside** `ExecuteMCPv2` (confirmed via `iris_mapping_list(namespace="%ALL", type="package")` that only `ExecuteMCPv2` and `MALIB` are `%ALL`-package-mapped from `HSCUSTOM`; confirmed via `iris_doc_list(namespace="USER", filter="ZZQaGenProbe")` → zero items that this package is genuinely invisible from `USER`). Driver and `ZN`-ing target both live in this unmapped class. Result: **`threw=1`**, `errText=<NOROUTINE> 17 TgtZN+3^ZZQaGenProbe.Capture.1 ZZQaGenProbe.Capture.1`, `captured=[zzgen-before-zn:HSCUSTOM\n]` (only the pre-`ZN` write got through). **This finding does NOT generalize to an arbitrary non-mapped target when the target IS ALSO the mnemonic-holding driver.**
> 2. **Cross-package case (the actual production shape)** — added `ExecuteMCPv2.Temp.QaProbeCapture.RunCaptureCrossPackage()`: an `%All`-mapped **driver** (architecturally identical in package placement to the real `ExecuteMCPv2.REST.Command`) invoking the **same unmapped target**, `ZZQaGenProbe.Capture.TgtZN`, via `$ClassMethod`, through the same redirect. Result: **`threw=0`**, `captured=[zzgen-before-zn:HSCUSTOM\nzzgen-after-zn:USER\n]` — clean, both writes captured, target's own class mapping is **irrelevant**.
>
> **Corrected mechanism:** the `Use tNull::("^"_$ZNAME)` mnemonic binding captures the **driver's own routine name** at bind time (in production, always `ExecuteMCPv2.REST.Command`'s compiled routine). Every `Write` that passes through the redirected device must re-resolve that mnemonic routine by name via namespace-based lookup — so it is the **driver's** package mapping, not the **target's**, that must survive the target's `ZN`. Ordinary M execution continuing past a `ZN` within an **already-loaded** routine (the target's own subsequent lines) does not itself require re-resolution — that is why the cross-package case worked even though `ZZQaGenProbe.Capture` is mapped nowhere but `HSCUSTOM`. The self-contained case only failed because driver and target happened to be the same (unmapped) routine, conflating the two variables.
>
> **Why this doesn't change 34.2's implementation, but does change what to document:** `ExecuteMCPv2.REST.Command` is fixed, first-party code — it will always be part of the `%All`-mapped `ExecuteMCPv2` package, so this finding's PRACTICAL conclusion ("no special-case handling needed") is now confirmed on **stronger, more general grounds** than the dev's original reasoning: it holds for **any** caller-supplied target class, mapped or not — not because the target inherits a mapping (most real targets won't), but because the driver does. **Record for 34.2 as an implementation constraint, not a design change:** the `Redirects()` mnemonic entry points (`wstr`/`wchr`/etc.) MUST stay defined in a class that is part of the `%All`-mapped `ExecuteMCPv2` package (as they are today, in `Command.cls` itself). If a future refactor ever moves the mnemonic labels into a helper class outside that package, this entire cross-namespace guarantee would silently break for any target that does `ZN` mid-execution — with the exact `<NOROUTINE>` failure mode reproduced above, not a corrupted response but a clean error that would nonetheless represent a regression from today's finding.
>
> **Scope note on the controlled comparison (added at code review):** the isolating experiment covered two of four quadrants — unmapped-driver/unmapped-target (fail) and mapped-driver/unmapped-target (pass). The target is unmapped in BOTH, which is what isolates the driver's mapping as the deciding variable, so the conclusion is sound. The unprobed quadrant (unmapped driver + mapped target, as separate classes) would only strengthen it. The accompanying explanation of *why* ("ordinary M execution continuing past a `ZN` within an already-loaded routine does not require re-resolution") is reasoned, not probed — the CONSTRAINT derived from it is conservative, so 34.2 is safe either way.

---

## ⚠ Constraints for Story 34.2 — binding, derived from live failure modes

**These are the hard requirements this probe produced. A 34.2 implementation that violates either one compiles, passes unit tests, and breaks silently in production.**

### C-1 — The mnemonic entry points MUST remain in the `%All`-mapped `ExecuteMCPv2` package

The `Redirects()` labels (`wstr`/`wchr`/`wnl`/`wff`/`wtab`/`rstr`/`rchr`) must stay defined in a class inside the `%All`-mapped `ExecuteMCPv2` package — as they are today, in `Command.cls` itself. Every `Write` that passes through the redirected device re-resolves the mnemonic routine **by name, via namespace-based lookup**, so it is the **driver's** package mapping that must survive the target's `ZN`.

- **Derived from (live):** `errText=<NOROUTINE> 17 TgtZN+3^ZZQaGenProbe.Capture.1` when driver+target were both outside the mapped package — only the pre-`ZN` write was captured.
- **Violating refactor to avoid:** extracting the now-duplicated capture setup (`Execute()` and `ClassMethod()` will share ~15 lines after 34.2) into a helper class outside `ExecuteMCPv2`. This is the *natural* DRY move and it silently breaks cross-namespace capture.

### C-2 — `$ZNAME` binds the RUNNING ROUTINE, not the package: keep `ClassMethod()` and `Redirects()` in the same generated `.int`

`Use tNull::("^"_$ZNAME)` binds the **currently executing routine**, and the `wstr`/`wchr`/… labels must exist *in that routine*. This is **strictly stricter than C-1** — satisfying C-1 does not satisfy C-2.

- **Verified live at code review (2026-08-14):** `iris_doc_list(namespace="HSCUSTOM", filter="ExecuteMCPv2.REST.Command", generated=true)` → exactly one generated routine, `ExecuteMCPv2.REST.Command.1.int`. Today `ClassMethod()` and `Redirects()` are both in it, which is *why* `$ZNAME` works.
- **The 34.2-specific risk:** AC 34.2.3 adds a 21-branch ladder of up to 20 arguments each — a very large code addition to this exact class. IRIS splits an oversized class across `Class.1.int`, `Class.2.int`, … If `ClassMethod()` lands in a different `.int` than `Redirects()`, `$ZNAME` names a routine with no `wstr` label and **capture breaks in EVERY namespace, not just cross-namespace**.
- **34.2 must therefore:** (a) re-run the `generated=true` doc list after the change and confirm `ExecuteMCPv2.REST.Command.1.int` is still the only generated routine (or that both methods are in the same one), and (b) prefer a compact ladder (or a `Redirects()`-adjacent placement) over generated bulk. Two `.int` routines is a silent-failure signal, not a cosmetic detail.

---

### Finding 4 (AC 34.1.2, part 3) — a target that throws mid-write leaves a clean partial capture and a correctly-restored redirect

**Claim (Dev Notes):** record the interaction between capture and a target that throws mid-write (partial capture? redirect left on?).

**Probe:** `ExecuteMCPv2.Temp.CaptureProbe.Target3()` writes `"before-throw"` then `Throw`s a `%Exception.General`. `RunCapture` wraps only the `$ClassMethod` call itself in Try/Catch (setting a flag, no argumented `Quit` inside the Catch — Rule/constraint honored), then restores I/O in exactly ONE place after the Try/Catch, matching Rule #7.

**Result — CONFIRMED clean.** Live call: `iris_execute_classmethod(className="ExecuteMCPv2.Temp.CaptureProbe", methodName="RunCapture", args=["Target3"])` →
```
target=Target3|threw=1|errText=ExecuteMCPv2.Temp.CaptureProbe 999  probe-mid-write-exception|nsAfterCallBeforeRestore=HSCUSTOM|nsAfterRestore=HSCUSTOM|origNS=HSCUSTOM|captured=[before-throw]
```
- The pre-throw partial output (`"before-throw"`) WAS captured — nothing was lost or corrupted.
- The redirect was correctly restored (verified indirectly: the driver's own return value — built with plain `Quit`, no `Write` — round-tripped through the MCP tool as clean JSON, which would fail if the redirect/mnemonic were left in a broken state).
- `$NAMESPACE` was untouched (`Target3` never switches namespace) and remained `HSCUSTOM` throughout.

**Implication for 34.2:** the single-restore-point-after-Try/Catch pattern (already Rule #7 discipline) is sufficient to guarantee clean redirect teardown even when the target throws mid-`Write`. No extra catch-and-cleanup logic is needed beyond what `Execute()` already does.

> **QA re-verification (2026-08-14):** independently reproduced with `ExecuteMCPv2.Temp.QaProbeCapture.RunCapture("Tgt3")` (fresh target `Tgt3`, throws a fresh `%Exception.General`). Live result: `target=Tgt3|threw=1|errText=qa-probe-mid-write-exception 999  |nsAfterCallBeforeRestore=HSCUSTOM|nsAfterRestore=HSCUSTOM|origNS=HSCUSTOM|captured=[qa-before-throw]`. Partial pre-throw output captured cleanly, redirect torn down correctly (confirmed by the MCP tool receiving valid parseable JSON back). Confirms.

---

### Finding 5 (AC 34.1.3) — a 20-argument `$ClassMethod` call, all formals `ByRef`, compiles, executes, and propagates all 20 mutations back to the caller

**Claim:** verify whether the platform tolerates 20 arguments through `$ClassMethod` (current production ladder caps at 10 — Command.cls:184).

**Probe:** `ExecuteMCPv2.Temp.ByRefProbe.Target20(ByRef p0, ByRef p1, ..., ByRef p19)` (20 formals, all `ByRef`) called as `$ClassMethod("ExecuteMCPv2.Temp.ByRefProbe", "Target20", .p0, .p1, ..., .p19)` with all 20 locals materialized beforehand.

**Result — CONFIRMED, clean pass. One self-inflicted false negative along the way, recorded because the failure mode is instructive:**

First attempt used `$Data(@tVar)` (string-built indirection, `tVar = "p"_i`) both inside `Target20` and in the caller-side post-call check, to count how many args were defined. This returned `definedCount=0` and reported all 20 args as `<UNDEFINED-POST-CALL>` — which looked like a genuine platform ceiling failure. But the SAME probe run's direct-name checks (`$Get(p0)`, `$Get(p19)`) showed `p0after=v0-m`, `p19after=v19-m` — i.e., the mutation HAD propagated correctly; only the indirection-based check was wrong. ~~**Negative result recorded:** `$Data(@tVar)` / `@tVar`-style string-built indirection does NOT reliably resolve locals that were bound as `ByRef` formals through a `$ClassMethod` dynamic dispatch call.~~ **⚠ THAT ATTRIBUTION IS WRONG — corrected in place at code review; see the callout immediately below.**

> **⚠ MECHANISM CORRECTED AT CODE REVIEW (2026-08-14) — the dev's stated cause was wrong. This is the same defect class QA caught in Finding 3: a correct observation paired with a false mechanism.**
>
> **The dev attributed the failure to `$ClassMethod` dispatch and/or `ByRef` binding. Both attributions are false.**
>
> **The real mechanism is the standard ObjectScript rule that indirection and `XECUTE` cannot see PROCEDURE-BLOCK PRIVATE variables.** It has nothing to do with `$ClassMethod`, nothing to do with `ByRef`, and it applies to *every ordinary local in every `ProcedureBlock` method* — which is the default for all class methods.
>
> **Live evidence** (disposable `ExecuteMCPv2.Temp.CrProbe`, namespace `HSCUSTOM`, created and deleted during this code review):
>
> | Case | Method shape | Live result |
> |---|---|---|
> | Plain local — **no `$ClassMethod`, no `ByRef` anywhere** | default `ProcedureBlock` | `indirectData=0`, `indirectGet=`, `directData=1`, `directValue=plainvalue` — **the failure reproduces with ZERO `$ClassMethod`/`ByRef` involvement** |
> | `%`-prefixed local (NOT procedure-block private) | default `ProcedureBlock` | `indirectData=1`, `indirectGet=percentvalue`, `directData=1`, `directValue=percentvalue` — **indirection works** |
> | Plain local, identical code | `[ ProcedureBlock = 0 ]` | `indirectData=1`, `indirectGet=npbvalue`, `directData=1`, `directValue=npbvalue` — **indirection works** |
> | The exact Finding 5 shape: `ByRef` local bound through `$ClassMethod` | default `ProcedureBlock` | `ret=tgtok`, `indirectData=0`, `indirectGet=`, `directData=1`, `directValue=start-mutated` — reproduces the dev's symptom, but the procedure block is the cause, not the dispatch |
>
> The two middle rows are decisive: change ONLY the variable's privacy (`%`-prefix) or ONLY the `ProcedureBlock` keyword, hold `$ClassMethod`/`ByRef` constant at *absent*, and the behavior flips.
>
> **Corrected negative result:** inside any `ProcedureBlock` method (the default for class methods), string-built name indirection (`@tVar`, `$Data(@tVar)`, `$Get(@tVar)`) CANNOT resolve ordinary private locals — it silently reports them as undefined rather than erroring. Direct-by-name access is required.
>
> **Why this is not a trivia correction — it is a live trap for 34.2:** the obvious way to build the `byRefValues` response across up to 20 positions is an indirection loop, e.g. `For i=0:1:19 { Set tVar="tArg"_i  If $Data(@tVar) Do tOut.%Set(i, @tVar) }`. **That loop silently returns an EMPTY `byRefValues` on every call**, with no error — exactly the way it produced `definedCount=0` here. 34.2 MUST use an explicit direct-name ladder (or `%`-prefixed locals, or a `ProcedureBlock = 0` helper). The dev's original wording actively increased this risk: an implementer would conclude the hazard was confined to `$ClassMethod`-bound *by-ref* locals and reach for indirection on the unmarked positions — same silent failure.

After rewriting the checks to use direct names (no indirection), the clean result:
```
return=definedCount=20|error=|mutatedCountOf20=20|p0after=v0-m|p9after=v9-m|p10after=v10-m|p19after=v19-m
```
- `definedCount=20` — inside `Target20`, all 20 `ByRef` formals were seen as defined-in.
- `mutatedCountOf20=20` — all 20 mutations (`_"-m"` suffix) propagated back to the caller's locals.
- No compile error, no runtime error, no truncation at 10 or any number below 20.

**Scope note:** per the AC, this story verified exactly 20 args (matching the epic's target ceiling). It did not probe arities beyond 20 to find the platform's true upper bound — there is no evidence of a ceiling AT OR BELOW 20, which is what AC 34.1.3 requires ("no undocumented platform arg ceiling below 20"); whether a ceiling exists somewhere above 20 is out of scope for 34.2 (which only needs to raise the limit to 20) and was not probed.

**Implication for 34.2:** the 10-argument ladder in `Command.cls:159-188` can be safely extended through 20 using the same `$ClassMethod(...)` call-generation pattern, with by-ref materialization added per Finding 1. No platform-level blocker exists at arity 20.

> **QA re-verification (2026-08-14):** independently reproduced with `ExecuteMCPv2.Temp.QaProbeByRef.Run20ArgProbe()` (fresh class, fresh `Tgt20` target, all 20 `ByRef` formals, all 20 caller locals materialized). Checks used **direct-by-name** access only (`p0`..`p19` compared literally) per the story's own documented lesson about `$Data(@tVar)` indirection being unreliable for `$ClassMethod`-bound `ByRef` locals — no indirection was used in this re-verification at all, so the false-negative trap was avoided from the start. Live result: `ret=20-set|mutatedCountOf20=20|p0after=v0-m|p9after=v9-m|p10after=v10-m|p19after=v19-m`. All 20 mutations propagated; no compile or runtime error at arity 20. Confirms.

---

### Residual Risk — what this story did NOT probe (added at code review)

**Silence in the findings above is not coverage.** Every item below is an input/state case a 34.2 implementation will meet in production and for which this story pins **no** behavior. They are recorded here so 34.2/34.3 treat them as open decisions rather than settled ones. Deferred to `deferred-work.md` under Story 34.1.

**By-ref out-value shapes (highest impact on AC 34.2.2 — `byRefValues`):**
- **Undefined out-value.** A `{byRef:true}` marker with no `value`, passed to a target that never assigns the formal, leaves `$Data(tA0)=0`. A naive `Do tOut.%Set(i, tA0)` raises `<UNDEFINED>` and fails the whole request even though the target ran fine. 34.2 needs a `$Data` guard **and** a contract (omit the key? `null`? `""`?).
- **Subscripted-array out-value — the idiomatic IRIS `Output` shape.** Stock methods return `pOut("key")=val` (e.g. `Security.Users.Get(.props)`), and the bug report's own motivating example is `Output pSummary`. After such a call `$Data(tA0)=10` (descendants, no top-level value). Nothing here pins whether 34.2 should serialize, flatten, or reject. **Probed only for scalar out-values.**
- **OREF out-value.** `Command.cls:195-199` already guards `$IsObject(tReturn)` for the *return value*; there is no pinned equivalent for out-values. The epic puts ByRef OREF *arguments* out of scope but is silent on OREF *results*.

**Argument-value space:** numbers, booleans, JSON `null` (`%Get` yields `""`, making `null` and empty-string indistinguishable — which the "omitted `value` = undefined" design depends on), very long strings / `<MAXSTRING>`, and control characters. Marker-recognition edge shapes are unenumerated (Rule #56): `{"byRef":false}`, `{"byRef":"true"}`, `{"byref":true}`, `{"value":"x"}` with no `byRef`, `{}`, and a bare JSON **array** entry.

**Capture-path branches never exercised:**
- **A target that itself redirects I/O** — `%SYS.Capture` wrappers are the bug report's own published workaround and are deployed in the field today; they will be the first thing re-run against the fixed endpoint. A target calling `ReDirectIO(0)` defensively turns the endpoint's capture off mid-call, sending later `Write`s straight to `$IO` — **the original bug returns, silently and only for some targets.** No re-entrancy guard is pinned.
- **Output volume.** Every capture probed was two short lines. The null-device pattern exists *specifically* because a >8KB JSON envelope was silently truncated at the CSP buffer boundary (`Command.cls:50-55`), and 34.2's entire purpose is to start returning captured console text — routinely >8KB for exactly the bug report's targets (`%UnitTest.Manager.RunTest`, `PatchContainer.Go`). **The failure mode the pattern was built to prevent was never re-validated at the payload size the fix now generates.**
- **A target that writes nothing**, and `<MAXSTRING>` on `%ExecuteMCPOutput` concatenation.
- **A target doing argumentless `KILL`** removes the public local `%ExecuteMCPOutput`; `wstr` uses `$Get(...,"")` and so recovers *silently*, presenting truncated output as complete.
- **Combined paths:** `ZN`-then-throw; `ZN` to a nonexistent/inaccessible namespace (throws `<NAMESPACE>` while the redirect is active, after partial output). Target2 (ZN, clean) and Target3 (throw, no ZN) were only ever probed **separately**.
- **The endpoint's OWN namespace switch was never active during any capture probe.** All probes ran with `tOrigNS = $NAMESPACE = HSCUSTOM`. But the TS layer always sends a namespace (`packages/iris-dev-mcp/src/tools/execute.ts` — `ctx.resolveNamespace(namespace)` at L385 is unconditional, passed at L390), so `SwitchNamespace` **always** runs in production and `tOrigNS` is the CSP web-app's namespace. The real shape is three namespaces deep (web-app default → endpoint switch → target `ZN`), with `Open tNull` in one and `Close tNull` in another. Finding 3's "recovers regardless of where the target leaves `$NAMESPACE`" is stated far more generally than its n=1 evidence supports.
- **`Open tNull:::1`** carries a 1-second timeout whose `$Test` is never checked, in the very block this story pins as "the pattern to reuse".

**Composition:** each finding was probed in isolation. Never exercised together: 20 materialized by-ref args **inside** an active redirect against a target that **writes**; a target that `ZN`s mid-execution **and** mutates a `ByRef` arg (repro 3's shape plus the new feature — the most likely real-world case). Findings 2/3/4 used 0-arg targets; Finding 5 ran outside the redirect harness.

**Arity:** all probes matched the target's declared arity exactly. Never probed: more supplied args than the target declares (`<PARAMETER>` — no pinned error text for 34.2's error-path test), a mixed marked/unmarked call at high arity, or any rung between 2 and 20. Note AC 34.2.3's "count-21 rejected" is a **policy** choice — this story found no ceiling at or below 20 and did not look above it.

**Fidelity of the `ZN` probe to repro 3:** `docs/bugs-2026-08-14.md` describes `CICD.ConfigureAll.Now()` as narrating *throughout* and switching namespace during execution — i.e. multiple `ZN`s with interleaved output. The probe was one `ZN` and two writes, never returning to the origin namespace. AC 34.3.4 re-runs the real reproduction as the epic gate, so this is residual risk rather than a blocker.

**Unpinned output contract:** dev and QA captured different bytes for "the same" test — `captured=[target1-line1\ntarget1-line2]` vs `captured=[qa-t1-line1\nqa-t1-line2\n]` (trailing newline present in one, absent in the other), and their thrown-target `errText` strings differ in field order and content. Both were recorded as "confirms". Whether the capture buffer preserves a trailing newline, and how a thrown target's error text is shaped, are real contracts 34.2 must render into the response envelope and **neither is pinned**.

**Redirect teardown was proven only by inference.** Finding 4's "the redirect was correctly restored" rests on the driver's return value round-tripping as clean JSON — sound reasoning, but a direct assertion (comparing `$IO` to `tInitIO` post-restore) was available and not taken. The one run that produced a *hard* error inside the mnemonic path (QA's `<NOROUTINE>`) had its device state never examined at all.

**`%All` mapping preconditions** (namespace created after bootstrap; partial deployment where bootstrap never ran) are unprobed. QA's `<NOROUTINE>` result shows the user-visible symptom would be *the target method appearing to throw* — misattributing an infrastructure gap to the caller's code.

---

### Task 4 — Cleanup evidence

**Dev stage:**
- `ExecuteMCPv2.Temp.ByRefProbe.cls` and `ExecuteMCPv2.Temp.CaptureProbe.cls` deleted server-side via `iris_doc_delete` (namespace `HSCUSTOM`) after all findings above were captured.
- Deletion verified live: `iris_doc_list(namespace="HSCUSTOM", filter="ExecuteMCPv2.Temp")` returned zero items post-delete.
- `src/ExecuteMCPv2/Temp/ByRefProbe.cls` and `src/ExecuteMCPv2/Temp/CaptureProbe.cls` deleted from disk; the now-empty `src/ExecuteMCPv2/Temp/` directory removed.
- No debug globals (`^ClineDebug` or otherwise) were used by this story's probes — all results were returned as classmethod return values, so there was nothing to kill.

**⚠ Gap in the original evidence, closed at code review.** The dev-stage check above used filter `ExecuteMCPv2.Temp`, which **by construction cannot match `ZZQaGenProbe.Capture`** (deliberately created outside that package), and it ran before the three QA-stage probe classes existed. The QA header's claim that "all QA probe classes were deleted" carried no quoted verification. This was an **evidence** defect, not a leftover artifact — the assertion is in fact true, now proven:

**Code-review stage — complete live verification (2026-08-14), all six probe classes:**
```
iris_doc_list(namespace="HSCUSTOM", filter="ExecuteMCPv2.Temp")            -> {"items":[]}
iris_doc_list(namespace="HSCUSTOM", filter="ZZQaGenProbe")                 -> {"items":[]}
iris_doc_list(namespace="HSCUSTOM", filter="Probe")                        -> only SessionAgent.Test.OnAfterSaveRecursionProbe.cls
                                                                              (pre-existing, dated 2026-05-07, unrelated to this story)
iris_doc_list(namespace="USER",     filter="Probe")                        -> {"items":[]}
iris_package_list(namespace="HSCUSTOM", prefix="ExecuteMCPv2", depth=2, generated=true)
    -> Tests, REST, Diagram, Loc, Setup, Utils  (NO Temp package — generated routines gone too)
```
- Disk: `Test-Path src/ExecuteMCPv2/Temp` → `False`; recursive search for `*Probe*` under `src/` → zero matches.
- The code review created one further probe (`ExecuteMCPv2.Temp.CrProbe`, used for the Finding 5 mechanism correction and the Finding 1 formal-entry-state evidence); it was deleted server-side and from disk, and is covered by the same zero-item listings above.
- `git status --short` at review close shows exactly three entries — `cycle-log-epic-34.md` (M), `sprint-status.yaml` (M), and this story file (??). No `src/**`, no `packages/**`, no `bootstrap-classes.ts`, no `BOOTSTRAP_VERSION`. *(Corrected at code review: the original bullet said "only this story file is modified", which the diff itself contradicts — the two upstream tracking files are also modified, as the Completion Notes correctly state.)*

---

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References

No `^ClineDebug`-style debug global was needed — every probe driver method returned its findings directly as a classmethod return string, read back through `iris_execute_classmethod`. Live MCP call sequence (all against namespace `HSCUSTOM` except the cross-namespace leg, which used `USER` as the target of an in-flight `ZN`):
1. `iris_server_profiles` — confirmed default profile targets `HSCUSTOM` on `localhost:52773`.
2. `iris_doc_load` (glob `c:/git/iris-execute-mcp-v2/src/**/Temp/*.cls`) + `iris_doc_compile` — deployed `ExecuteMCPv2.Temp.ByRefProbe` and `ExecuteMCPv2.Temp.CaptureProbe`. First `iris_doc_load` attempt used a glob prefixed too late (`.../Temp/**/*.cls`), which collapsed the class names to `User.*` (Rule #17) — corrected to `src/**/Temp/*.cls` so the prefix stops before `src/`, preserving the full `ExecuteMCPv2.Temp.*` package.
3. `iris_execute_classmethod(ByRefProbe.RunAll)` — Task 1, all five by-ref shapes in one call.
4. `iris_execute_classmethod(ByRefProbe.Run20ArgProbe)` — Task 3; first attempt threw `<UNDEFINED>Run20ArgProbe *p0` from a buggy indirection-based diagnostic check in the probe's OWN code (not a platform failure — see Probe Findings, Finding 5). Rewrote to direct-name checks, recompiled, reran clean.
5. `iris_execute_classmethod(CaptureProbe.RunCapture, args=["Target1"])`, `args=["Target2"]` (the `ZN`-mid-execution leg), `args=["Target3"]` (throw-mid-write leg) — Task 2.
6. `iris_doc_list(namespace="USER", filter="CaptureProbe")` — confirmed the `%All` package mapping covers the `Temp` subpackage. **⚠ Framing corrected at code review:** this was originally logged as "supporting context for Finding 3", i.e. as evidence for the *target's* mapping being the mechanism. QA falsified that. The observation is true but causally inert — it is the **driver's** mapping that matters. See Finding 3's correction and Constraints C-1/C-2.
7. `iris_doc_delete` + `iris_doc_list(filter="ExecuteMCPv2.Temp")` — Task 4 cleanup + live verification (zero items). **Note:** this filter could never have covered the QA stage's `ZZQaGenProbe.Capture`; complete six-class verification was performed at code review and is recorded in the Task 4 evidence section.

### Completion Notes List

- All three ACs (34.1.1, 34.1.2, 34.1.3) are satisfied with pinned, live-verified findings recorded in the `## Probe Findings` section above — see that section for the full Claim → Probe → Result → Verbatim call shape → Implication write-up per finding.
- **Highest-value result:** Finding 3 (AC 34.1.2) confirms the redirect's mnemonic routine stays resolvable when the target does `ZN` mid-execution while the redirect is active (bug-report repro 3's shape), and the endpoint's existing `Set $NAMESPACE = tOrigNS` restore-**before**-render pattern correctly recovers in the single-`ZN` case probed. *(Corrected at code review: this bullet previously said "restore-**after**-render", which is both wrong — `Command.cls:191` restores before `RenderResponseBody` at L203 — and hazardous, since the project's REST-handler namespace rule exists precisely because rendering with a foreign `$NAMESPACE` makes the original namespace's classes invisible on error paths.)*
- **⚠ The mechanism behind Finding 3 was WRONG in the dev's original write-up and was corrected by QA — this summary previously omitted that entirely.** Resolvability depends on the **DRIVER's** `%All` package mapping, not the target's; QA produced a live `<NOROUTINE>` counter-case (`errText=<NOROUTINE> 17 TgtZN+3^ZZQaGenProbe.Capture.1`). The practical conclusion survives on *stronger, more general* grounds — it holds for ANY caller-supplied target class, mapped or not — **but it is now conditional on two binding constraints for Story 34.2 (C-1 mnemonic-package location, C-2 `$ZNAME` same-`.int` requirement). See the "Constraints for Story 34.2" section; do not read this bullet as "nothing to do".**
- **Falsifications recorded (Rule #42), three of them:** (1) Finding 1 — through `$ClassMethod` dispatch, by-ref propagation is controlled purely by the CALLER's `.` syntax, independent of the callee's declared `ByRef`/`Output`; (2) Finding 3 — the dev's stated cross-namespace mechanism (target's mapping) was falsified by QA in favour of the driver's mapping, and the derived constraint has been added to `epics.md` AC 34.2.1; (3) Finding 5 — see next bullet.
- **Finding 5's negative result was itself mis-attributed and was corrected at code review.** The dev recorded that `@tVar` indirection "does not reliably resolve `$ClassMethod`-bound `ByRef` locals". Live re-probing shows the real cause is the standard ObjectScript rule that **indirection cannot see procedure-block private variables** — reproduced with no `$ClassMethod` and no `ByRef` present at all, and flipped by changing only the `%`-prefix or only the `ProcedureBlock` keyword. This matters directly: the natural way to build `byRefValues` over 20 positions is an indirection loop, and **it would silently return empty**. 34.2 must use direct-name access.
- **Residual risk is now recorded explicitly** in its own section — by-ref out-value shapes (undefined / subscripted-array / OREF), capture at >8KB, targets that redirect I/O themselves, combined `ZN`+throw paths, and the fact that the endpoint's own namespace switch was never active during any capture probe. Deferred to `deferred-work.md` under Story 34.1.
- No production code, `packages/**`, `bootstrap-classes.ts`, or `BOOTSTRAP_VERSION` was touched. No governance baseline generator was run.
- Cleanup verified live per Task 4: all six probe classes (2 dev + 3 QA + 1 code review) deleted from `HSCUSTOM` and confirmed absent via `iris_doc_list`/`iris_package_list` including generated routines; all `.cls` files and the `Temp/` directory removed from disk; `git status --short` shows no probe artifacts and no `src/**` changes (only this story file, plus upstream `sprint-status.yaml`/`cycle-log-epic-34.md` changes from the prior `create-story` stage, are modified). *(Corrected at code review: previously claimed only two probe classes and cited a filter that could not cover `ZZQaGenProbe`.)*

### File List

- `_bmad-output/implementation-artifacts/34-1-classmethod-invocation-probe.md` (this story file — Probe Findings, Dev Agent Record, Tasks/Subtasks, Status)

Additionally modified at code review (Rule #42 — amend the planning artifact in place, not merely note it):
- `_bmad-output/planning-artifacts/epics.md` — Epic 34 scope + AC 34.2.1 amended to carry the mnemonic-location constraints (C-1/C-2) this probe derived, so a 34.2 story created from `epics.md` alone still carries them.
- `_bmad-output/implementation-artifacts/deferred-work.md` — residual-risk items recorded under Story 34.1.

No source files were added, modified, or left behind. Six disposable probe classes were created across the dev, QA, and code-review stages (full roster in the Environment table above), compiled and exercised live, then deleted from both the IRIS server (`HSCUSTOM`) and local disk before story close (AC 34.1.3) — they never persisted as tracked changes. *(Corrected at code review: this paragraph previously named only the two dev-stage probes.)*

---

### Review Findings

**Code review (2026-08-14) — close kind CLEAN.** All three adversarial layers (Blind Hunter, Edge Case Hunter, Acceptance Auditor) DELIVERED an explicit findings payload within the 20-minute per-layer hard window; `failed_layers` empty, `review_degraded = false` (Rule #57 bounded close, frozen-diff snapshot, delivery receipts all satisfied).

**Calibration:** probe-only story — no production code, no automated tests (Story 34.2 owns `%UnitTest` coverage per AC 34.2.3), so Rule 3 is not triggered and Rule 1 (Integration ACs) is not triggered. Rules 5 and 6 not triggered (no NFR workaround; no ADR registry in this project). Findings were judged on **epistemic** grounds: does a claim assert more than its probe established, is a binding constraint recorded where an implementer will see it, and does every claim trace to quoted live evidence (Rule #36)?

**Tally (44 findings after dedup — 24 patched · 16 deferred · 4 dismissed · 0 decision-needed; counted mechanically per Rule #51).**

**AC verification.** AC 34.1.1 ✅ (by-ref incl. undefined-in Output case; exact call shape recorded — plus the formal's *entry* state, which was missing, now pinned live at review). AC 34.1.2 ✅ (capture incl. `ZN`-mid-execution; mechanism corrected). AC 34.1.3 ✅ (arity 20 verified; **cleanup independently re-verified live at review** — `ExecuteMCPv2.Temp`, `ZZQaGenProbe`, and `Probe` filters all return zero items in `HSCUSTOM` and `USER`, `iris_package_list` shows no `Temp` package even with `generated=true`, and disk carries no `src/**` residue). The AC-required cleanup claim was **true**; only its *evidence* was incomplete, which is patched.

#### Patched in review (24) — 7 HIGH · 9 MEDIUM · 8 LOW

- [x] [Review][Patch] **HIGH** — Finding 3's "Supporting context" still asserted the mechanism QA falsified; struck in place per Rule #42 rather than left standing above the correction
- [x] [Review][Patch] **HIGH** — Finding 3's "Implication for 34.2" omitted the constraint entirely; a dev reading Claim→Result→Implication took away "nothing to do"
- [x] [Review][Patch] **HIGH** — the one binding prohibition was buried in the last paragraph of a nested blockquote; promoted to a dedicated `## ⚠ Constraints for Story 34.2` section (C-1)
- [x] [Review][Patch] **HIGH** — Completion Notes repeated the corrected Finding 3 claim verbatim and dropped the constraint; rewritten
- [x] [Review][Patch] **HIGH** — constraint absent from `epics.md`; amended into AC 34.2.1 in place (Rule #42) so a 34.2 story created from the epic alone still carries it
- [x] [Review][Patch] **HIGH** — **new constraint C-2, found by the Edge layer and verified live by me:** `$ZNAME` binds the *running routine*, not the package, so C-1 is insufficient. 34.2's 21-branch × 20-arg ladder is a large addition to `Command.cls`; if IRIS splits it across `Command.1.int`/`Command.2.int` and `ClassMethod()` lands apart from `Redirects()`, capture breaks **in every namespace**. Verified today only `ExecuteMCPv2.REST.Command.1.int` exists. Recorded in the story and in `epics.md`
- [x] [Review][Patch] **HIGH** — **Finding 5's mechanism was mis-attributed** (same defect class QA caught in Finding 3). Re-probed live: the indirection failure has nothing to do with `$ClassMethod` or `ByRef` — it is the standard rule that indirection cannot see **procedure-block private** variables. Corrected with a 4-row live evidence table. Concretely: the natural `byRefValues` collection loop would silently return **empty**
- [x] [Review][Patch] **MEDIUM** — Finding 3's heading was unqualified; now names the driver-mapping mechanism and the single-`ZN` evidence scope
- [x] [Review][Patch] **MEDIUM** — Completion Notes' Rule #42 bullet named only Finding 1, omitting the story's actual falsification event; now lists all three
- [x] [Review][Patch] **MEDIUM** — Debug Log item 6 restated the corrected target-mapping framing without a correction marker
- [x] [Review][Patch] **MEDIUM** — Finding 1's Implication contradicted its own falsification paragraph and the QA callout (marked-positions-only vs. all-positions); reconciled — the marker decides what is **read back**, not what is **bound**
- [x] [Review][Patch] **MEDIUM** — "safe unconditionally" recorded without its evidence boundary; now states it is established for **string scalars** and names what was not probed
- [x] [Review][Patch] **MEDIUM** — Task 1 sub-bullet 3 ("what the formal sees") was checked but unanswered; **closed with live evidence at review** — a dot-passed undefined local leaves the formal `$Data=0` with no error, and a declared default is applied exactly as if the arg were omitted. This **confirms** the epic's "omitted `value` = undefined, Output-style" design claim and falsifies a plausible worry that dot-passing suppresses defaults
- [x] [Review][Patch] **MEDIUM** — Finding 1 was the only finding with no quoted raw dev output; flagged, with QA's string named as the pinned oracle and Test C called out as the weakest-evidenced row (QA re-ran a different shape than the dev)
- [x] [Review][Patch] **MEDIUM** — Task 4 cleanup evidence covered 2 of 6 probe classes and used a filter that could never match `ZZQaGenProbe`; replaced with complete quoted live verification
- [x] [Review][Patch] **MEDIUM** — Completion Notes said "restore-**after**-render"; `Command.cls:191` restores **before** `RenderResponseBody` at L203. Wrong *and* hazardous given the project's REST-handler namespace rule
- [x] [Review][Patch] **LOW** ×8 — QA header tally "all three load-bearing findings" (actually five, per its own next sentence and the cycle log); "five target methods" (five tests over four targets); stale probe roster in Environment/File List; Task 3 checkbox overclaiming a sub-task the text disclaims; Task 4's "only this story file is modified" contradicted by the diff; unindented "copy-pasteable" code blocks plus a marker-unwrapping scope note; Finding 4's teardown proof labelled as the inference it is; Finding 3's 4th-quadrant scope note

#### Deferred (16) — 3 HIGH · 7 MEDIUM · 6 LOW

All recorded in `_bmad-output/implementation-artifacts/deferred-work.md` under "code review of 34-1-classmethod-invocation-probe (2026-08-14)" with story ID, severity, owner, rationale, and suggested resolution, and narrated in this story's `### Residual Risk` section. These are **coverage gaps in the probe, not defects in it** — cases 34.1 never exercised and therefore pins no behavior for. Owners are Stories 34.2/34.3, so this is routing, not postponement.

- [x] [Review][Defer] **HIGH** — by-ref out-value shapes unpinned: undefined, subscripted-array (`pOut("key")`, the idiomatic `Output` shape and the bug report's own motivator), OREF — deferred to 34.2, amended into `epics.md` AC 34.2.2 as an explicit decision
- [x] [Review][Defer] **HIGH** — capture never validated at >8KB or `<MAXSTRING>`; the >8KB truncation is the *exact* failure the null-device pattern exists to prevent, and 34.2 is what starts producing >8KB envelopes — deferred to 34.2/34.3
- [x] [Review][Defer] **HIGH** — a target that itself redirects I/O (`%SYS.Capture`) is the bug report's own published workaround, deployed in the field today; a target calling `ReDirectIO(0)` silently reinstates the original bug — deferred to 34.2/34.3
- [x] [Review][Defer] **MEDIUM** ×7 — endpoint's own namespace switch never active during capture probes (the TS layer always sends a namespace, so production is three namespaces deep); combined `ZN`+throw and `ZN`-to-inaccessible paths; argument-value space beyond string scalars; marker-recognition edge shapes (Rule #56); arity mismatch vs. declared formals; composition never exercised; non-array `args` mis-counted via `%Size()` (pre-existing)
- [x] [Review][Defer] **LOW** ×6 — unpinned output contract (trailing newline, `errText` shape); redirect teardown proven only by inference; argumentless `KILL` silently truncating capture; `%All` mapping preconditions; unchecked `$Test` on `Open tNull:::1`; `ZN` probe simplified vs. repro 3's multi-switch shape

#### Dismissed (4)

- **Edge layer's claim that a dot-passed undefined local defeats a formal's declared default** — **falsified by live re-probe**: `plainDefaultWithDotUndef[data=1,val=DEFAULTVAL]`, `byrefDefaultWithDotUndef[data=1,val=BRDEFAULT]`, identical to omitting the argument. The layer reasoned rather than probed; Rule #36 cuts both ways. Converted into positive evidence in Finding 1
- **Blind layer's claim that the verbatim call shape is a defect because it would bind the marker wrapper** — the snippet pins *binding mechanics*; marker unwrapping is 34.2's job per `epics.md`. The useful half was folded in as a scope note rather than treated as a defect
- **Blind layer's claim that the environment/version line is unevidenced** — independently verified live (`iris_server_info` → `IRIS for Windows (x86-64) 2026.1 (Build 235U)`, `api:8`); exact match. Verification note added
- **Blind layer's objection to the "independent oracle" framing** — fair as a wording quibble, but the QA stage did catch a real mechanism error; no action warranted

#### Review-created artifacts

One disposable probe class (`ExecuteMCPv2.Temp.CrProbe`) was created to verify the Finding 5 mechanism and the Finding 1 formal-entry-state question. It was deleted from `HSCUSTOM` and from disk, and its absence is covered by the zero-item listings in the Task 4 evidence section. The frozen diff snapshot was disposed of at review close.
