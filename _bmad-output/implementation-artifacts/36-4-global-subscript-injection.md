# Story 36.4: HIGH - `/global` Subscript Injection — Read Tool Executes Code, Read-Only Preset Bypass

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an **operator who runs the IRIS MCP servers under `IRIS_GOVERNANCE_PRESET=read-only`** (or any policy that disables writes but leaves reads enabled),
I want **`iris_global_get` / `iris_global_set` / `iris_global_kill` to treat every subscript I — or an agent — pass as literal DATA, never as code**,
so that **a read-classified tool can never execute ObjectScript or write to the instance, and the read-only safety preset means what it says**.

## Context — why this story exists

Found and live-verified at the Story 36.2 code review (ledger **`36-2-CR-1`**, HIGH, pre-existing since the `/global` route shipped). Project Lead decision (2026-09-11): a dedicated story, run after the 36.3 burn-down (done at `4ac3cb3`).

**The defect** (`src/ExecuteMCPv2/REST/Global.cls`): `BuildGlobalRef` (~L219) splits the caller's `subscripts` string on every comma, leaves canonical numbers unquoted (`tSub = (+tSub)`), strips ONE pair of surrounding quotes from anything else, and re-wraps it in `"…"` **without doubling an embedded `"`**. The three handlers then evaluate the result by indirection: `$Get(@tRef)` / `$Data(@tRef)` (~L39-41, `GetGlobal` → `iris_global_get`), `Set @tRef = tValue` + `$Get(@tRef)` (~L98-102, `SetGlobal` → `iris_global_set`), `Kill @tRef` (~L148-149, `KillGlobal` → `iris_global_kill`). A quote that closes the literal early lets the rest of the piece run as ObjectScript. Live proof at the 36.2 review: `iris_global_get` with global `CRProbe362Target` and subscripts `x"_$Increment(^CRProbe362Side)_"x` set `^CRProbe362Side` to `2` (once via `$Get`, once via `$Data`).

**Why it is HIGH:** `iris_global_get` is READ-classified and default-enabled, so it stays callable under `IRIS_GOVERNANCE_PRESET=read-only` and under any policy that disables writes — the injection turns it into code execution + writes. (Under DEFAULT governance `iris_execute_command` already permits code, so the concrete damage is the **governance bypass**.)

**What is already safe:** the global NAME. All three handlers call `ValidateGlobalName` (~L269; pattern `.1"%"1A.AN.(1"."1A.AN)` — letters/digits/dots with an optional leading `%`, so no `|`, quotes, parens or `^`) BEFORE `BuildGlobalRef`. Confirm it in the audit; the injection surface is the SUBSCRIPTS.

**Callers that must keep working unchanged (Rule #19):** the three MCP tools (TS contract in `packages/iris-dev-mcp/src/tools/global.ts`: "Subscripts as a comma-separated string. Use quotes for string keys: '\"key1\",\"key2\"'. Use plain numbers for numeric keys: '1,2,3'."), and — new in Epic 36 — `iris_execute_tests` / `iris_test_status` via `readGlobalNode` (`execute.ts`), which read `IRIS.TempAtelierAsyncQueue` with subscripts `<digits>,"unittest","id"` and `UnitTest.Result` with no subscripts. Their live gates (`execute-tests-running-contract-epic-gate.test.ts`, `test-status-epic-gate.test.ts`) must stay green.

## Acceptance Criteria

Sourced verbatim from `_bmad-output/planning-artifacts/epics.md`, "### Story 36.4" (AC 36.4.5 as corrected at the Story 36.3 code review).

1. **AC 36.4.1** - Reproduce FIRST, on the real tool path: from the BUILT dist in a fresh Node process (or a real stdio MCP server), drive `iris_global_get` / `iris_global_set` / `iris_global_kill` with the `36-2-CR-1` payload against a disposable global and record the observed side effect (RED evidence), including one run under `IRIS_GOVERNANCE_PRESET=read-only` through the real governance gate. Audit (#56) every other place `src/ExecuteMCPv2/**` evaluates caller-influenced text by indirection or `Xecute` (grep `@`, `Xecute`, `$Xecute`, `$Name(@`) and report the result even if clean.
2. **AC 36.4.2** - Fix: caller text is NEVER evaluated. Build the node reference from a parsed subscript list — `$Name` over a local subscript array, or an equivalent that binds each subscript as a VALUE — so a string subscript containing quotes, `_`, `$`, `@`, `(`, `)` or control characters is stored and addressed as literal data. The global name is validated against the ObjectScript global-name grammar (the forms the tool documents today; anything else — extended references, `^|…|`, embedded code — is rejected with a clear error). `get`, `set` and `kill` share the one builder.
3. **AC 36.4.3** - Rule #19 back-compat: every documented subscript form (numeric, quoted string, multi-level, the per-tool README examples) resolves to the byte-identical node as before — the existing `ExecuteMCPv2.Tests.GlobalTest` cases pass UNCHANGED (they pin `BuildGlobalRefPublic`), plus new cases for the payload shapes. The TypeScript `subscripts` parameter contract is unchanged.
4. **AC 36.4.4** - Security pins proven RED→GREEN on the path they guard (Rules #48/#59): live injection payloads (quote breakout, `_` concatenation, `$Increment`, nested `@`, `^|"%SYS"|` namespace escape, control characters) through all three tools over real HTTP — each observed to have a side effect on the unfixed build and NONE after (the payload is addressed as a literal subscript or rejected); the read-only-preset leg included. A permanent default-suite live test, armed like the epic gates, pins at least the `iris_global_get` read-only-bypass case.
5. **AC 36.4.5** - Bootstrap and gates: `pnpm run gen:bootstrap` in this story with `BOOTSTRAP_VERSION` from→to recorded (Rule #24); bootstrap rosters unchanged (#39); OS suite `total` vs mechanically-counted `Test*` (#35); per-package standalone suites; `gen:governance-baseline:check` (`:check` ONLY) exit 0 at frozen `1e62c5ad5bf7`/141, live/post-foundation 203/62 (E-2); tool counts unmoved (#31); no new action key (E-1). *(Figures corrected at the Story 36.3 code review, 2026-09-11, Rule #42: this AC was drafted with the pre-Story-36.2 "141/201/60".)*
6. **AC 36.4.6** - Docs + ledger: CHANGELOG `### Security` entry (what was exposed, since when, and that the read-only preset was bypassable); per-server README note wherever the subscript contract is described; ledger `36-2-CR-1` → **RESOLVED** with live evidence and a Rule #51 recount; changeset (patch on the package that ships the bootstrap, plus `@iris-mcp/dev` if its docs change).

## Integration ACs

Not a service-introducing story (security defect fix). The consumers that must keep working are named in Context and pinned by AC 36.4.3 and the Epic 36 live gates.

## Tasks / Subtasks

- [x] **Task 1 — RED first (AC 36.4.1)**: forced clean rebuild; from the built dist (real `IrisHttpClient` + `buildToolContext`, or a real stdio MCP server via the SDK `Client`), run the `36-2-CR-1` payload through `iris_global_get`, `iris_global_set`, `iris_global_kill` against disposable `^ZZ364*` globals on the default instance and record each side effect verbatim; then the SAME `iris_global_get` payload through a real server started with `IRIS_GOVERNANCE_PRESET=read-only` (proves the bypass through the real governance gate). Kill the disposable globals after.
- [x] **Task 2 — Audit (AC 36.4.1, #56)**: grep every `@`, `Xecute`, `$Xecute`, `$Name(@`, `$Order(@`, `$Query(@`, `$Increment(@` in `src/ExecuteMCPv2/**`; for each, state whether caller-influenced text can reach it and how it is neutralized. Report even if clean. New findings outside `/global` → new ledger rows (do not expand scope silently).
- [x] **Task 3 — Design decision, probe-first (#16)** — choose and record ONE:
  - (a) **Escape-in-place**: keep `BuildGlobalRef`'s output format and parsing EXACTLY, but double every embedded `"` in string subscripts (`$Replace(tSub,"""","""""")`) and reject control characters (`$C(0)`–`$C(31)`, `$C(127)`) with a clear error. Byte-identical references for every legitimate input ⇒ `GlobalTest` passes unchanged trivially.
  - (b) **`$Name`-built reference**: build incrementally (`Set tRef = $Name(@tRef@(tValue))` over the parsed pieces), so IRIS quotes each subscript. Caveat to PROBE: `$Name` canonicalizes numeric-looking strings (`^G("1")` → `^G(1)` — the SAME node), so the reference STRING can differ from today's for such inputs and a `GlobalTest` case pinning the string could change — which AC 36.4.3 forbids. Only choose (b) if the probe shows every existing `GlobalTest` string pin is preserved.
  - Whichever you pick, prove both properties: a crafted piece can no longer terminate the literal (test with `"`, `""`, `"_`, `)`, `@`, `$`), and the three handlers share the one builder.
- [x] **Task 4 — Implement + OS tests (AC 36.4.2, 36.4.3)**: fix `BuildGlobalRef` (and nothing else in `Global.cls` unless the audit requires it); add `GlobalTest` cases for every payload shape (the resulting reference string, AND a real set/get/kill round trip proving the payload became a literal subscript with no side effect — assert the side-effect global is undefined). Existing `GlobalTest` methods UNCHANGED. `pnpm run gen:bootstrap`; `BOOTSTRAP_VERSION` from→to (currently `8465393b3f74`); deploy + recompile on the default instance; OS suite count check (#35).
- [x] **Task 5 — Live security gate (AC 36.4.4)**: a permanent default-suite test in `packages/iris-dev-mcp/src/__tests__/` (e.g. `global-injection-epic-gate.test.ts`), armed like `execute-tests-running-contract-epic-gate.test.ts` (`ping` + skip-when-unavailable, `IRIS_REQUIRE_LIVE` hard-fail), driving `iris_global_get`/`set`/`kill` handlers over real HTTP with the payload set, asserting NO side effect and correct literal addressing; include the read-only-preset case through the real `McpServerBase` governance path (as `test-status-governance.test.ts` does, but against live IRIS). Prove it RED by reverting the builder fix on the deployed class (then restore + recompile) — name the path (the real HTTP route). Add the new gate to `packages/iris-dev-mcp/scripts/prepublish-gate.mjs` alongside the Epic 36 gates.
- [x] **Task 6 — Back-compat proof (AC 36.4.3)**: before/after `BuildGlobalRefPublic` output over a fixture list of every documented form (numeric, negative, decimal, quoted, unquoted string, multi-level, empty pieces, the README examples, and `<digits>,"unittest","id"`) — byte-identical (Rule #19 mechanical proof); the Epic 36 live gates (`execute-tests-running-contract-epic-gate`, `test-status-epic-gate`) and `execute-classmethod-epic-gate` stay green armed.
- [x] **Task 7 — Docs + ledger + gates (AC 36.4.5, 36.4.6)**: CHANGELOG `### Security`; dev README (the `iris_global_*` sections: subscripts are literal data; quotes inside a string key are allowed; what is rejected); `tool_support.md` if it describes the contract; changesets; ledger `36-2-CR-1` → **RESOLVED** (append-only at EOF, first cell the bare ID WITH the bold token), Rule #51 recount with `Check:`; per-package standalone suites; `gen:governance-baseline:check` exit 0; tool counts unmoved (dev 29 / suite 110).

## Dev Notes

### Payload set (use all; add any the audit suggests)

| Shape | Example `subscripts` value | Unfixed expectation | Fixed expectation |
|---|---|---|---|
| Quote breakout + side effect | `x"_$Increment(^ZZ364Side)_"x` | `^ZZ364Side` incremented | literal subscript `x"_$Increment(^ZZ364Side)_"x`, `^ZZ364Side` undefined |
| Quote breakout closing the ref | `a")_$Increment(^ZZ364Side)_("b` | code runs or syntax error | literal or clear rejection; no side effect |
| Nested indirection | `x"_@("^ZZ364Side")_"x` | indirection evaluated | literal; no side effect |
| Namespace escape | `x"_^|"%SYS"|ZZ364Side_"x` | cross-namespace read | literal; no side effect |
| Doubled quotes (legit) | `"a""b"` | today: ambiguous | the string `a"b` as ONE subscript (decide and document) |
| Control character | a piece containing `$C(10)` | ~~undefined behavior~~ addressed as literal data (live-verified at the code review — a control character inside a string literal is inert under indirection) | ~~clear rejection~~ **literal data, byte-identical to pre-fix** — *amended at the Story 36.4 code review (Rule #42): AC 36.4.2 lists control characters among the characters "stored and addressed as literal data"; the "undefined behavior" premise behind the rejection was disproven live, and rejecting them broke nodes the pre-fix builder addressed (Rule #19)* |
| Legit forms | `1,2,3` · `"key1","key2"` · `key1` · `-1.5` · `31797604,"unittest","id"` | work | **byte-identical** reference to today |

### Traps

- **Do NOT change the comma-split or empty-piece semantics** (Rule #19): a string key containing a comma is not supported today and stays unsupported (document it); changing the splitter changes which node legit inputs address.
- **`$Name` canonicalizes numeric strings** — see Task 3 (b). Same node, different reference string.
- **Global name is already validated** (`ValidateGlobalName`); don't loosen it; confirm it runs BEFORE `BuildGlobalRef` on all three paths.
- **Rule #7** in these handlers (they render JSON; no device redirect here) and **Rule #15** (never `$Get()` a method call) — keep them intact.
- **Bootstrapped class** ⇒ `gen:bootstrap` in this story (Rule #24); `ExecuteMCPv2.Tests.*` stays out of the manifest (Rule #39). After redeploying `Global.cls` on the default instance, re-run the armed Epic 36 gates — `iris_execute_tests`/`iris_test_status` read the queue node through this route.
- **Disposable globals only** (`^ZZ364*`), killed after; `ocupilot-iris` is out of scope for dev work (the lead smoke may use it read-only).
- **Rule #55** — file-writing tools only, never heredocs. **Epic 35 §3.3** — forced clean rebuild before dist-level claims. **Epic 35 §3.1** — region-scoped edits.
- **CHANGELOG wording:** factual and scoped — what could be bypassed, since which release, what the fix does. No exploit string in user-facing docs beyond what is needed to describe the class.

### Testing standards

- OS: `ExecuteMCPv2.Tests.GlobalTest` (existing methods unchanged + new payload methods; ≤500 lines per class, split if needed). OS suite `total` vs mechanically-counted `Test*` (#35; baseline 423 at 36.3 close, 2 known `36-0-QA-3` failures).
- TS: the new armed live gate; per-package standalone suites (baselines at 36.3 close: dev ~783+, shared 1334, all 130, client-config 513/514 with the known `36-1-QA-3`).
- Rule #59: every pin proven RED on the path it guards (the real HTTP route), with the path named.

### Project Structure Notes

- ObjectScript: `src/ExecuteMCPv2/REST/Global.cls`, `src/ExecuteMCPv2/Tests/GlobalTest.cls` (+ a split class if needed). Generated: `packages/shared/src/bootstrap-classes.ts` (via `pnpm run gen:bootstrap` — never hand-edit, Rule #18).
- TS: new live gate in `packages/iris-dev-mcp/src/__tests__/`; `packages/iris-dev-mcp/scripts/prepublish-gate.mjs`; docs.

### Previous story intelligence

- **36.3:** a literal suggested fix (`$Test` after `Open`) caused a 100% outage when deployed — re-run the armed live gates IMMEDIATELY after every redeploy of a bootstrapped handler, and keep the pre-fix class content to restore from.
- **36.2 review:** found this defect by reading the handler it touched; the fix pattern and payloads above come from its ledger row.
- **Rule #57:** reviews run `layers_mode=sequential_sync`, each layer with its own armed 20-minute timer.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 36.4]
- [Source: _bmad-output/implementation-artifacts/deferred-work.md] — `36-2-CR-1` row (live proof, suggested resolution)
- [Source: src/ExecuteMCPv2/REST/Global.cls] — `GetGlobal` ~L29-41, `SetGlobal` ~L88-102, `KillGlobal` ~L138-149, `BuildGlobalRef` ~L219, `ValidateGlobalName` ~L269
- [Source: src/ExecuteMCPv2/Tests/GlobalTest.cls] — `TestBuildGlobalRef*` pins
- [Source: packages/iris-dev-mcp/src/tools/global.ts] — the `subscripts` contract; [Source: packages/iris-dev-mcp/src/tools/execute.ts] — `readGlobalNode`
- [Source: packages/iris-dev-mcp/src/__tests__/test-status-governance.test.ts] — real governance-gate harness; `execute-tests-running-contract-epic-gate.test.ts` — live-gate arming
- [Source: .claude/rules/project-rules.md] — #7, #15, #16, #18, #19, #24, #35, #39, #48, #51, #55, #56, #59

## Dev Agent Record

### Agent Model Used

claude-sonnet-5

### Debug Log References

- RED reproduction (pre-fix, forced clean rebuild of `@iris-mcp/shared`+`@iris-mcp/dev`): `iris_global_get`/`set`/`kill` each incremented the disposable side global via the `36-2-CR-1` payload; `iris_global_get` under a real `McpServerBase` with `IRIS_GOVERNANCE_PRESET=read-only` also produced the side effect while `iris_global_set` was correctly denied — confirms the governance-bypass claim on the exact HTTP route this story fixes.
- Probe-first design decision (Rule #16): a disposable `ExecuteMCPv2.Temp.Story364Probe` classmethod implementing the exact proposed fix logic was compiled and run live against the full Dev Notes payload table (11 cases) plus 4 live round-trip checks (including the control-character rejection) — every legitimate case reproduced the pre-fix reference string byte-for-byte, every malicious payload produced zero side effect. Deleted after use (confirmed absent via `iris_doc_delete`).
- Post-fix live gate (`global-injection-epic-gate.test.ts`), armed (`IRIS_REQUIRE_LIVE=1`): 14/14 green against the fixed deployed class.
- Rule #59 RED→GREEN proof: reverted the deployed `ExecuteMCPv2.REST.Global.cls` to its pre-fix content (byte-identical to the pre-story HEAD) and recompiled — 13/14 of the new gate's tests went RED (including the read-only-preset leg, `expected true to be false`). Restored the fix, recompiled, and re-ran all 4 armed Epic 36 gates together — 34/34 green. Confirmed the deployed class is byte-identical to the fixed repo source via `iris_doc_get`.
- Mechanical OS suite count: `grep -c "^Method Test" src/ExecuteMCPv2/Tests/*.cls` = 431 (up from the 423 baseline at Story 36.3 close, +8 new `GlobalTest` methods); `iris_execute_tests` on the `ExecuteMCPv2.Tests` package reported `total:431, passed:429, failed:2` — the 2 failures are the pre-existing, documented `36-0-QA-3` `MessageResendTest` environmental failures (missing `SessionAgent.Sample.*` demo package), unrelated to this story.
- `pnpm run gen:bootstrap`: `BOOTSTRAP_VERSION` `8465393b3f74` → `e966a676d9b0`; roster unchanged (29 classes, same order) — only `ExecuteMCPv2.REST.Global.cls`'s embedded content and the version constant changed in `bootstrap-classes.ts` (confirmed via `git diff --stat`, 58 insertions / 9 deletions, one line for the version).
- Forced clean rebuild (`rm tsconfig.tsbuildinfo` for both `packages/shared` and `packages/iris-dev-mcp`, then `build`) before every dist-level claim in this story (Epic 35 §3.3 discipline).
- Full per-package standalone suites, all green except pre-existing/documented failures: `@iris-mcp/shared` 65 files / 1334 tests; `@iris-mcp/dev` 44 files / 801 tests; `@iris-mcp/all` 20 files / 130 tests; `@iris-mcp/client-config` 20/21 files, 513/514 tests (the 1 failure is the documented pre-existing `36-1-QA-3`).
- `pnpm gen:governance-baseline:check` (`:check` only): exit 0, frozen 141 / live 203 / post-foundation 62 — matches AC 36.4.5's corrected figures exactly; no new governance key introduced (this story fixes existing already-governed behavior, adds no new tool/action).
- Tool counts unmoved: `iris_server_profiles` reports `visibleTools:29` for the `full` preset on the default `iris-dev` server (dev 29), matching the pre-story baseline — no new tool, no new action key.

### Completion Notes List

- Implemented the "escape-in-place" design (Task 3(a)), refined beyond the story's literal one-line suggestion: a caller-quoted piece is first UN-escaped (a doubled internal quote decodes to one literal quote — recovering the caller's intended value, including the pre-existing ambiguous `"a""b"` case, which now explicitly and provably addresses the single subscript `a"b`, matching this method's own accidental pre-fix behavior for that exact input) and THEN re-escaped (every quote in the recovered value doubled) before being wrapped once. A naive "just `$Replace` after the existing strip, no unescape" reading of the story's suggested one-liner was probed and found to DOUBLE-ESCAPE the already-escaped `"a""b"` case (producing the wrong value `a""b` instead of `a"b`) — a subtle Rule #19 regression the probe caught before it reached the deployed class. Design (b) (`$Name`-built) was probed and rejected per the story's own stated caveat: `$Name` canonicalizes a numeric-looking quoted string (`^G("1")` → `^G(1)`, same node, different reference STRING), which is exactly the failure mode AC 36.4.3 forbids.
- Task 2's audit found the injection surface is EXACTLY as scoped: `Global.cls`'s three handlers are the only place in `src/ExecuteMCPv2/**` where caller-influenced text reaches indirection (`@`); no `Xecute`/`$Xecute` command usage anywhere in the tree; no other `$Name(@`/`$Order(@`/`$Query(@`/`$Increment(@` occurrences. No new ledger rows opened by the audit.
- Control characters are rejected via a THROWN `%Exception.StatusException` from `BuildGlobalRef` (matching the existing `Utils.cls:994` precedent for this exact pattern), caught by each handler's existing outer `Try/Catch` and rendered through the existing `SanitizeError` path — no new render call, no signature change to `BuildGlobalRef`/`BuildGlobalRefPublic` (both stay `%String`-returning), so no existing call site needed to change.
- `GlobalTest.cls` edit is PURELY ADDITIVE: all 12 pre-existing test methods are byte-for-byte untouched; 8 new methods added (doubled-quotes-legit, control-character-rejected, 4 injection-payload methods each with a ref-string pin AND a live round-trip no-side-effect assertion, a negative/decimal + empty-piece fixture sweep, and the Epic 36 `readGlobalNode` queue-fixture-shape pin). One authoring mistake was caught and fixed during this pass: the empty-piece test's hand-derived expectation (`"1,,2"` → `"1,2"`) was WRONG — live execution showed the pre-existing (unchanged) `$Piece`-based assembly preserves the empty piece as a positional gap (`"1,,2"` stays `"1,,2"`), corrected before commit.
- Every reference-string pin for the 4 injection-payload OS tests and the TS gate's payload set was taken from a LIVE capture of the exact fix algorithm (the disposable probe class), not hand-derived a second time — Rule #36 oracle discipline; one hand-derivation attempt for the "quote breakout closing the ref" payload was independently cross-checked against the probe's actual output and caught a missed second quote character before it was used anywhere.
- The new TS live gate (`global-injection-epic-gate.test.ts`) needed one fix after first-write: `McpServerBase.start()` calls the shared `loadConfig()` with no arguments (reads straight from `process.env`), unlike this file's own `getConfig()` helper — the read-only-preset test failed with `IRIS_USERNAME environment variable is required` until the connection env vars were explicitly set (and saved/restored) around that one test.
- Changeset scope: bumped `@iris-mcp/shared` (ships the bootstrap; `BOOTSTRAP_VERSION` moved) and `@iris-mcp/dev` (its tools' behavior and README changed) per the story's own explicit Task 7 guidance. A background research pass on prior changeset precedent in this repo (`execute-classmethod-capture-byref.md`, `xml-import-compile-and-legacy-rest-get.md`) found the repo's actual convention bumps only the package(s) whose OWN tools have user-observable behavior change, which would have suggested `@iris-mcp/dev` alone — the story's explicit instruction is followed as the authoritative, Lead-decided scope for this story.
- `ocupilot-iris` (localhost:52774) was not touched — out of scope per the story's Dev Notes.

### File List

- `src/ExecuteMCPv2/REST/Global.cls` (modified — `BuildGlobalRef` fixed)
- `src/ExecuteMCPv2/Tests/GlobalTest.cls` (modified — 8 new test methods added, purely additive)
- `packages/shared/src/bootstrap-classes.ts` (generated — `pnpm run gen:bootstrap`; `BOOTSTRAP_VERSION` `8465393b3f74` → `e966a676d9b0`)
- `packages/iris-dev-mcp/src/__tests__/global-injection-epic-gate.test.ts` (new — live security gate, 14 tests)
- `packages/iris-dev-mcp/scripts/prepublish-gate.mjs` (modified — new gate added to `gateTestFiles`)
- `packages/iris-dev-mcp/README.md` (modified — security note added to the `iris_global_*` section)
- `CHANGELOG.md` (modified — new `### Security` entry)
- `.changeset/global-subscript-injection-fix.md` (new — `@iris-mcp/shared` + `@iris-mcp/dev` patch)
- `_bmad-output/implementation-artifacts/deferred-work.md` (modified — `36-2-CR-1` → RESOLVED, append-only at EOF, Rule #51 recount)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified — `36-4-global-subscript-injection` → `review`, `last_updated` summary)

## Change Log

| Date | Change | Author |
|---|---|---|
| 2026-09-11 | Story created by the lead (`/bmad-create-story` inline, key adopted `36-4-global-subscript-injection`). Confirmed before writing: the global NAME is already validated (`ValidateGlobalName` on all three paths), so the injection surface is the subscripts; current parse semantics recorded for the Rule #19 proof; the `$Name` canonical-number caveat surfaced as a probe-first design choice; the Epic 36 consumers of this route (`readGlobalNode`) named. | Lead (claude-opus-5) |
| 2026-09-11 | Story implemented (dev pass, all 7 tasks). Fixed `BuildGlobalRef` (escape-in-place, probe-verified against `$Name` canonicalization risk); added 8 new `GlobalTest.cls` methods (purely additive); added the live security gate `global-injection-epic-gate.test.ts` (14 tests, armed in `prepublish-gate.mjs`), proven RED→GREEN on the real HTTP route by reverting/restoring the deployed class; regenerated the bootstrap (`BOOTSTRAP_VERSION` → `e966a676d9b0`); updated CHANGELOG, dev README, and the deferred-work ledger (`36-2-CR-1` → RESOLVED); added a changeset (`@iris-mcp/shared` + `@iris-mcp/dev`, patch). All per-package suites green (shared 1334, dev 801, all 130, client-config 513/514 known-failure); `gen:governance-baseline:check` exit 0 (141/203/62); tool counts unmoved (dev 29 / suite 110). Status moved `ready-for-dev` → `review`. | Dev (claude-sonnet-5) |
| 2026-09-11 | QA pass complete (adversarial, all live). No HIGH/security regression found — the fix holds against an independent payload set and an independently-derived Rule #19 back-compat proof. One new non-security MEDIUM finding opened (`36-4-QA-1`: a leading/trailing tab in a subscript is silently dropped rather than rejected, inconsistent with this story's own "all control characters are rejected" claim). All 4 armed Epic 36 gates green (34/34); standard gates (OS suite, per-package suites, `gen:bootstrap` idempotency, `gen:governance-baseline:check`, deployed-vs-repo class equality) all confirmed independently. See `## QA Results` below. | QA (claude-sonnet-5) |
| 2026-09-11 | Code review (`bmad-code-review`, sequential synchronous layers, CLEAN close). The injection escape held against every layer and a 20,000-input live fuzz. Patched in-story: control characters are literal data again (AC 36.4.2; the rejection had broken pre-fix-addressable nodes); the doubled-quote decode now applies to every string piece (0 back-compat mismatches vs the pre-fix builder); an unwrapped piece with an unmatched edge quote (a comma-split quoted key) is rejected instead of silently mis-addressed. All Story 36.4 OS tests moved to the new `ExecuteMCPv2.Tests.GlobalSubscriptSafetyTest` (12 methods, independent oracles), so `GlobalTest.cls` is byte-identical to HEAD. The live gate was revised to write-shaped payloads, seeded kills, control-character, edge-quote and global-name cases, and a hardened read-only leg (20 tests), and re-proven RED on the pre-fix class (gate 17/20, OS 7/12). Docs, CHANGELOG and changeset corrected. `36-4-QA-1` RESOLVED. 4 pre-existing items deferred (`36-4-CR-1` HIGH bootstrap downgrade, `36-4-CR-2`, `36-4-CR-3`, `36-4-CR-4` parallel-gate flake). `BOOTSTRAP_VERSION` `e966a676d9b0` → `2159ec9e6f69`. Status `review` → `done`. | Code review (claude-opus-5) |

## QA Results

**Scope:** independent, adversarial re-verification of the Story 36.4 deliverable only (the files listed in Dev Agent Record / File List). Did not re-review story process/ACs (that is `bmad-code-review` scope); this pass drives the built dist and the live IRIS instance and reports what was actually observed. All server calls against the `default` profile (`localhost:52773`, `HSCUSTOM`) after `iris_server_profiles` confirmed governance (all `iris_global_*` actions enabled) and tool visibility (`toolVisibility.visibleTools: 29`, `preset: "full"` — matches the story's "dev 29" claim, confirmed directly rather than taken on the dev's word).

**Forced clean rebuild (Epic 35 §3.3):** `rm packages/shared/tsconfig.tsbuildinfo packages/iris-dev-mcp/tsconfig.tsbuildinfo` then `pnpm --filter @iris-mcp/shared run build` and `pnpm --filter @iris-mcp/dev run build` — both clean, zero TS errors, before any dist-level claim below.

### 1. Independent adversarial payloads (beyond the story's own table)

Drove `globalGetTool`/`globalSetTool`/`globalKillTool` from the freshly-rebuilt dist (`packages/shared/dist/index.js` + `packages/iris-dev-mcp/dist/tools/global.js`, the same import pattern as `global-injection-epic-gate.test.ts`) over real HTTP against disposable `^ZZ364QATarget`/`^ZZ364QASide` on the default instance — 21 independent cases, none in the Dev Notes payload table:

| Payload shape | Result |
|---|---|
| Single `"` only | Literal subscript `"`, addressed correctly, no side effect. |
| `"""` (three quotes) | Live-probed: unescapes/re-escapes to the SAME 4-char reference as a lone `"` (both decode to the 1-char value `"`) — consistent, no breakout. |
| Starts with `"`, doesn't end with one (`"abc`) / ends with `"`, doesn't start with one (`abc"`) | Taken as its own literal (not "wrapped"), no side effect. |
| `""` (two quotes = empty-string subscript) | `BuildGlobalRefPublic` correctly returns `^G("")` (verified via a disposable probe classmethod). Evaluating it throws IRIS's own native `<SUBSCRIPT>` error — confirmed via a control experiment (`Set ^ZZ364QATarget("")="direct"`, no `BuildGlobalRef` involved) that IRIS's global engine does **not** support an empty string as a subscript at all, independent of this fix. Not a defect: the fix produces the mathematically correct reference; IRIS's storage engine is the one that refuses it, identically for a hand-written reference. |
| `"a"b"` (single stray quote inside a quoted piece, NOT doubled) | Live-probed: unescape/re-escape converges to the same value/reference as the dev's `"a""b"` doubled-quote-legit test (`a"b`) — both decode to one embedded literal quote. Consistent, documented, no breakout. |
| Trailing `"` after an escaped pair (`"a""b""`) | Escaped as one literal subscript, round-trips, no side effect. |
| `"(a)"`, unquoted `a)(b` | Parens adjacent to quotes / unquoted parens: literal data both ways, no special meaning, no side effect. |
| `$C(9)` (tab), `$C(10)` (LF), `$C(0)` (NUL) interior to a piece | LF and NUL correctly rejected ("control characters are not allowed"). Tab interior to a piece is ALSO correctly rejected. See `$C(9)` at piece EDGES below — the one gap found (`36-4-QA-1`). |
| `$C(127)` (DEL) interior | Correctly rejected. |
| Leading/trailing `$C(9)` (tab) | **Silently stripped, not rejected** — `BuildGlobalRefPublic("G","\tabc")` and `("G","abc\t")` both return the identical `^G("abc")` with no error, unlike LF/CR/NUL/DEL at the same leading position (all four independently probed and confirmed correctly rejected). New finding, logged as `36-4-QA-1` (MEDIUM, non-security) — see below. |
| 9000-char piece | GET (query string): HTTP 414 (URI too long — a client/HTTP-layer limit, not this fix). PUT (JSON body, no query-string limit): IRIS's own `<SUBSCRIPT>` (the ~511-byte IRIS subscript length ceiling) — no side effect. |
| Unicode: `café_中文_🎉`, quoted and unquoted | Round-trips correctly as literal data, no corruption, no side effect. |
| `1` vs `"1"` (canonical number vs quoted form) | Both succeed; the quoted form is legitimately treated as a distinct string-subscript reference string (`^G("1")`), which IRIS itself canonicalizes to the SAME physical node as `^G(1)` — expected IRIS behavior, matches the story's own `$Name`-canonicalization caveat, not a defect. |
| Long piece (500+ chars) with embedded `$Increment(^Side)` | IRIS's own `<SUBSCRIPT>` length-limit error (as above) before any evaluation — side global never defined. |

**Verdict:** across all 21 independent cases, `^ZZ364QASide` (the side-effect global embedded by name in every code-shaped payload) never became defined, and every reference string was independently confirmed (via a disposable `$Query`-walking probe classmethod, never through the same code path being tested) to address exactly the literal node the algorithm should produce. No payload executed code or addressed an unintended node. One non-security behavioral gap found (`36-4-QA-1`, below).

### 2. Byte-identical back-compat (Rule #19) — independently reproduced

Loaded the PRE-FIX `BuildGlobalRef`/`BuildGlobalRefPublic` (`git show HEAD:src/ExecuteMCPv2/REST/Global.cls`, commit `4ac3cb3`) verbatim into a disposable `ExecuteMCPv2.Temp.QA364OldGlobal`, and compared its output against the fixed `ExecuteMCPv2.REST.Global.BuildGlobalRefPublic` for 16 independently-chosen fixtures (a superset of the dev's own list, adding `0`, `-1`, `3.14`, and whitespace-padded numeric/quoted forms): `""`, `1`, `1,2,3`, `-1.5`, `0`, `-1`, `3.14`, `"key1"`, `"key1","key2"`, `key1`, `1,,2`, `31797604,"unittest","id"`, `"a""b"`, `  1  `, `  "key1"  `, `1,"key",2.5`. **Result: 0 mismatches across 16/16 fixtures** (`mismatchCount: 0` in the probe's own JSON output). Disposable class deleted after use (confirmed via `iris_doc_delete`).

### 3. Consumers — all 4 armed Epic 36 live gates, green

`IRIS_REQUIRE_LIVE=1 pnpm exec vitest run` on `execute-tests-running-contract-epic-gate.test.ts`, `test-status-epic-gate.test.ts`, `execute-classmethod-epic-gate.test.ts`, `global-injection-epic-gate.test.ts` together: **4 files, 34/34 tests passed**, ~31s. Confirmed `global-injection-epic-gate.test.ts` is listed in `packages/iris-dev-mcp/scripts/prepublish-gate.mjs`'s `gateTestFiles` (it is — 5th entry) and would actually run under `pnpm run prepublish-gate` via that script (not merely present in the repo).

### 4. Read-only preset — real governance path, both halves confirmed

The armed gate's own read-only-preset test (real `McpServerBase`, `IRIS_GOVERNANCE_PRESET=read-only`, real stdio dispatch) confirms `iris_global_get` stays ALLOWED with the quote-breakout payload producing no side effect, and `iris_global_set` is DENIED (`GOVERNANCE_DISABLED`). That test does **not** exercise `iris_global_kill`, so this QA pass independently drove `iris_global_kill` through the same real `McpServerBase`/read-only-preset path: **DENIED** — `{"code":"GOVERNANCE_DISABLED","action":"iris_global_kill","server":"default","presetApplied":"read-only"}`, `isError:true`. Both write-classified tools are confirmed denied under read-only; the read-classified tool stays allowed with no side effect.

### 5. Error path (Rule #7)

Every control-character rejection in the item-1 sweep returned a clean, single JSON error envelope (`isError:true`, one coherent `content[0].text`, e.g. `"ERROR #5001: Invalid subscript: control characters are not allowed"` for interior LF/NUL, or the native `<SUBSCRIPT>` text for the empty-string/length-limit cases) — never a non-JSON or dual-rendered body. The 21-case sweep ran sequentially on ONE reused `IrisHttpClient`/`ToolContext` (the same pattern as reusing one MCP worker), and every case AFTER a rejection (e.g. "tab at start of piece" immediately following the rejected "tab in middle of piece") succeeded normally — confirms the I/O-redirect/single-render discipline in `Global.cls`'s Catch blocks leaves the worker healthy for the next call.

### 6. Standard gates

- **OS suite:** mechanical count `grep -c "^Method Test" src/ExecuteMCPv2/Tests/*.cls` = **431**, matching `iris_execute_tests` on package `ExecuteMCPv2.Tests`: `total:431, passed:429, failed:2`. The 2 failures are exactly `ExecuteMCPv2.Tests.MessageResendTest:TestRealResendAgainstScratchProduction` and `:TestResendBatchContinuesPastBadHeader` — the documented pre-existing `36-0-QA-3` environmental failures, unrelated to this story.
- **Per-package standalone suites:** `@iris-mcp/shared` 65 files/1334 tests green; `@iris-mcp/dev` 44 files/801 tests green; `@iris-mcp/all` 20 files/130 tests green; `@iris-mcp/client-config` 20/21 files, 513/514 tests — the 1 failure is `certification-process.test.ts`'s drift-check assertion, matching the documented pre-existing `36-1-QA-3`.
- **`gen:bootstrap` idempotent:** ran twice in this QA pass; second run's output byte-for-byte identical to the first (`diff -q` clean), `BOOTSTRAP_VERSION` unchanged at `e966a676d9b0`, same 29-class roster/order.
- **Deployed `Global.cls` == repo:** `iris_doc_get` on the default instance, reconstructed to a file, `diff -u` against `src/ExecuteMCPv2/REST/Global.cls` — **zero differences**.
- **`gen:governance-baseline:check`** (`:check` only, never the bare generator): exit 0 — `frozen foundation keys: 141`, `live keys: 203`, `post-foundation new keys: 62`, matching AC 36.4.5's corrected figures exactly.
- **Tool counts unmoved:** `iris_server_profiles` confirms `visibleTools: 29` for the `full` preset on `iris-dev` directly (not taken on the dev's word). No count-assertion test failed in any of the 4 per-package suites run above (these are exactly the suites that would fail on a tool-count drift); no literal "110" assertion was found to re-verify by grep, so this is corroborating rather than a direct re-derivation of that specific number.
- **Ledger `36-2-CR-1`:** confirmed **RESOLVED**, first cell is the bare ID with the bold token, at the correct append-only EOF position. Rule #51 recount for the Story 36.4 resolution section re-verified arithmetically: prior 1 HIGH/24 MEDIUM/59 LOW=84 open/218 distinct/134 terminal → HIGH 1−1=0, terminal 134+1=135, check 0+24+59=83, 83+135=218 ✓. Matches the story's own figures exactly.

### New finding from this QA pass

`36-4-QA-1` (MEDIUM, non-security) logged in `_bmad-output/implementation-artifacts/deferred-work.md` (append-only, EOF): a leading/trailing tab (`$C(9)`) in a subscript piece is silently stripped by the pre-existing `$ZStrip($Piece(...),"<>W")` trim before the NEW control-character check runs, unlike every other control character in the documented `$C(0)`-`$C(31)`/`$C(127)` range (LF/CR/NUL/DEL all independently confirmed correctly rejected at the same leading position). Not exploitable (no code execution, no governance bypass — the value is dropped, not evaluated) and not introduced by this story (the trim line is unchanged from pre-fix), but it does make this story's own new doc/README claim ("control characters... are rejected") not quite true for edge-positioned tabs. Ledger recount: 0 HIGH/25 MEDIUM/59 LOW = 84 open/219 distinct/135 terminal (check: 0+25+59=84; 84+135=219).

### Cleanup

All disposable artifacts removed before closing: ObjectScript classes `ExecuteMCPv2.Temp.QA364Probe`, `ExecuteMCPv2.Temp.QA364Probe2`, `ExecuteMCPv2.Temp.QA364OldGlobal`, `ExecuteMCPv2.Temp.QA364BackCompat` (all deleted via `iris_doc_delete`, confirmed); disposable globals `^ZZ364QATarget`, `^ZZ364QASide`, `^ZZ364GateSide`, `^ZZ364GateTarget`, `^ZZ364QAKillDenyCheck` all killed. `git status` at the end of this pass shows the identical file set/diff-stat as at the start (no unintended repo changes from the rebuild/regen steps run for verification). `ocupilot-iris` was not touched (out of scope).

### QA overall verdict

**No HIGH or security regression.** The Story 36.4 fix holds under an independently-designed adversarial payload set and an independently-derived Rule #19 back-compat proof; all 4 armed consumer gates are green; the read-only-preset governance bypass this story exists to close is confirmed closed for all three tools (get/set/kill). One new MEDIUM, non-security finding (`36-4-QA-1`) opened for a future story/burn-down.

### Review Findings

Code review 2026-09-11 (`bmad-code-review`).

**Layers.** `layers_mode=sequential_sync`: three layers run synchronously in sequence, each against its own armed 20-minute timer.

| Layer | Delivered at | Findings |
|---|---|---|
| Blind Hunter | 634 s | 18 |
| Edge Case Hunter | 544 s | 14 |
| Acceptance Auditor | 686 s | 12 |

All three delivered before their timers fired, so `failed_layers` is empty, `review_degraded = false`, and `review_close_kind = CLEAN`. Frozen snapshot: `review-diff-snapshot-36-4-global-subscript-injection-20260911-115403.diff` (1104 lines, 11 files; deleted at close).

**Triage.** 44 raw findings deduplicated to 24 distinct:
- 13 patched in-story (`36-4-CR-A` … `36-4-CR-M`);
- 3 pre-existing items deferred to the ledger (`36-4-CR-1` HIGH, `36-4-CR-2` LOW, `36-4-CR-3` LOW);
- 8 dismissed.

Two more items were found by the reviewer:
- `36-4-CR-N`, a README output example — patched;
- `36-4-CR-4`, a pre-existing parallel-run flake in two Epic 36 gates, surfaced by this review's own gate runs — deferred.

**Security verdict (focus (a)).** No layer, no probe and no fuzz input produced a breakout.

*Grammar argument.* After the trim, each non-empty piece takes one of two forms.
- The piece equals its own canonical number: only digits, `-` and `.` — inert unquoted.
- Otherwise it is emitted as `"` + (value with every `"` doubled) + `"`. A comma cannot occur inside a piece, and ObjectScript literals have no other escape, so the literal can only end at its own closing quote.

The global name is validated (`.1"%"1A.AN.(1"."1A.AN)`) before `BuildGlobalRef` on all three handlers (`Global.cls` lines 29, 88, 138).

*Live fuzz.* 20,000 random inputs, drawn from `"`, `""`, `_`, `$`, `@`, `(`, `)`, `^`, `|`, `,`, whitespace, `$C(1)`, `$C(9)`, `$C(10)`, `$C(150)` and an embedded `$Increment(^Side)` token, were built by the deployed builder. Every reference was checked with three oracles that share nothing with the builder:
- IRIS's own `$QLength`/`$QSubscript` parser (live-verified NOT to evaluate expressions: it raises `<FUNCTION>` on one);
- a native `$Name(@base@(value))` addressing read;
- a real `Set`/`Kill` through the reference.

Result: 17,258 references checked, 0 parse / decode / addressing violations, and the side global never defined.

**Patched in-story:**
- [x] [Review][Patch] `36-4-CR-A` (MEDIUM) — Control-character rejection removed; control characters are literal data again [src/ExecuteMCPv2/REST/Global.cls:270]
  - Why it was wrong:
    - AC 36.4.2 lists control characters among the characters "stored and addressed as literal data".
    - The rejection also covered `$C(128)`–`$C(159)`: `$ZStrip` class `C` = 0–31, 127, 128–159, live-probed. So the code comment's "C0 0-31 plus DEL 127, verified live" was false.
    - It broke nodes the pre-fix builder addressed: 7,198 of 16,070 pre-fix-literal fuzz inputs were newly rejected.
    - It bought no safety: `$C(0)`, 9, 10, 13, 127, 133, 150 and 8232 inside a literal all round-trip inertly under `Set`/`$Get`/`Kill @`, live.
  - The Dev Notes table row is amended in place (Rule #42).
  - Pinned by `GlobalSubscriptSafetyTest.TestControlCharactersAreLiteralData` (passes against BOTH the pre-fix and the fixed builder) and a gate HTTP case (LF and SOH, read back through the other builder branch).
- [x] [Review][Patch] `36-4-CR-B` (MEDIUM) — Rule #19 overclaim fixed: the doubled-quote decode now applies to unwrapped pieces too [src/ExecuteMCPv2/REST/Global.cls:302]
  - The dev's fix silently re-addressed unwrapped pieces containing a quote pair, e.g. `a""b`: pre-fix `a"b`, dev `a""b`. That was 1,400 of 16,070 pre-fix-literal fuzz inputs.
  - Now: 0 mismatches against a byte copy of the pre-fix builder on every pre-fix-literal input. The only rejections are the 176 lone-`"` pieces, which pre-fix addressed the empty-string subscript, and that raises `<SUBSCRIPT>` on get, data, set and kill (live).
  - Pinned by `TestDoubledQuotesDecodeLikePreFix` (green against both builders).
- [x] [Review][Patch] `36-4-CR-C` (MEDIUM) — A quoted key containing a comma is now rejected instead of silently hitting the wrong node [src/ExecuteMCPv2/REST/Global.cls:291]
  - The problem: pre-fix, `"a,b"` was a `<SYNTAX>` error. The dev's fix silently addressed the two-level node `("""a","b""")`, and set reported `verified:true`.
  - The fix: an unwrapped piece with an odd-length quote run at either edge is now rejected with a clear error. Every such input was a SYNTAX error, a SUBSCRIPT error or code before the fix.
  - The comma limitation (story Trap: "document it") is now in the README, the class doc and the CHANGELOG.
  - Pinned by `TestUnmatchedEdgeQuoteRejected` and a gate HTTP case.
- [x] [Review][Patch] `36-4-CR-D` (MEDIUM, closes `36-4-QA-1`) — The docs no longer contradict the code on control characters [packages/iris-dev-mcp/README.md:990]
  - The "control characters are rejected" claim is gone, along with the rejection itself (CR-A).
  - Leading and trailing whitespace (space, tab, NBSP — `$ZStrip` class `W` = 9, 32, 160, live) is documented as trimmed, the unchanged pre-fix behavior (Rule #19).
  - Pinned by the edge-tab assertion in `TestControlCharactersAreLiteralData`.
- [x] [Review][Patch] `36-4-CR-E` (MEDIUM) — Rule #59: gate and OS oracles that could not vary are replaced [packages/iris-dev-mcp/src/__tests__/global-injection-epic-gate.test.ts:156]
  - What was wrong:
    - The nested-`@` and `^|"%SYS"|` payloads only READ, so their "no side effect" checks were constant.
    - The namespace case checked the wrong namespace.
    - The kill tests asserted `deleted:true` on a node that was never set.
    - The OS payload tests round-tripped through the same `@tRef`.
  - What changed:
    - The payloads are write-shaped (`$Increment`), and the `%SYS` side global is read in `%SYS`.
    - A quote-wrapped concatenation payload is added.
    - Kills are seeded first.
    - The OS tests moved to `ExecuteMCPv2.Tests.GlobalSubscriptSafetyTest` (12 methods, 233 lines) with independent oracles: `$QLength`/`$QSubscript` plus a native read, and a hostile-corpus sweep. `GlobalTest.cls` is restored byte-identical to HEAD.
  - **RED re-proven on the real HTTP route.** The pre-fix `Global.cls` (HEAD content) was deployed and the armed gate went 17/20 RED:
    - get payloads failed on the side-effect assertion (line 207);
    - set payloads on the verify value (line 223);
    - seeded kills on survival (line 251);
    - closing-ref payloads on `isError` (`<SYNTAX>`);
    - the edge-quote case on its error text;
    - the read-only leg on its side-effect assertion (line 453) — the bypass itself;
    - the 3 green tests are back-compat pins.
  - On the same deployment the OS class went 7/12 RED; the 5 green are exactly the back-compat pins.
  - Restored and GREEN again: gate 20/20, OS 12/12.
- [x] [Review][Patch] `36-4-CR-F` (LOW) — The global-NAME half of AC 36.4.2 is now tested [src/ExecuteMCPv2/Tests/GlobalSubscriptSafetyTest.cls:223]
  - `TestGlobalNameRejectsReferenceSyntax` covers `|"%SYS"|X`, `["%SYS"]X`, `X(1)`, embedded code, `^X`, `X,Y` and more.
  - A gate HTTP case checks three bad names, with no side effect in either namespace.
- [x] [Review][Patch] `36-4-CR-G` (LOW) — Read-only leg hardened [packages/iris-dev-mcp/src/__tests__/global-injection-epic-gate.test.ts:398]
  - The leg now neutralizes ambient `IRIS_GOVERNANCE`, `IRIS_GOVERNANCE_FILE`, `IRIS_PROFILES` and `IRIS_TOOLS_PRESET`/`_ENABLE`/`_DISABLE`. Otherwise an explicit override beats the preset (a false RED), and a tools preset can hide the tools under test.
  - It asserts `iris_global_kill` is DENIED too.
  - It stops the stdio server in `finally`.
- [x] [Review][Patch] `36-4-CR-H` (LOW) — Working exploit strings removed from user-facing docs [packages/iris-dev-mcp/README.md:990]
  - Removed from the README, the changeset (which becomes the published package CHANGELOG) and the deployed class doc.
  - The flaw is now described in prose.
- [x] [Review][Patch] `36-4-CR-I` (LOW) — CHANGELOG `### Security` now answers "since when" (AC 36.4.6) [CHANGELOG.md:14]
  - The `/global` handler: Story 3.2, 2026-04-06, so `v0.1.0` and every pre-release since.
  - The write-governance bypass: from Pre-release 2026-06-15.
  - The read-only preset bypass: from Pre-release 2026-07-08.
  - The "no observable behavior change" claim is replaced by the precise, mechanically verified statement.
- [x] [Review][Patch] `36-4-CR-J` (LOW) — Changeset method count corrected [.changeset/global-subscript-injection-fix.md:1]
  - It said 7 new methods; the dev's actual count was 8. Now: `GlobalTest` unchanged, plus a new class of 12.
- [x] [Review][Patch] `36-4-CR-K` (MEDIUM) — The audit record is corrected; the conclusion stands [_bmad-output/implementation-artifacts/deferred-work.md:EOF]
  - Wrong claim: the dev recorded "no `Xecute`/`$Xecute` command usage anywhere in the tree".
  - Actual `XECUTE`: `REST/Command.cls:122` runs `XECUTE tCommand`. That is `iris_execute_command`, write-classified by design, so it is denied under read-only. `Tests/CommandTest.cls` also uses it.
  - `$ClassMethod`/`$Property` dispatch is either whitelisted (`Config.cls` maps) or in write-classified tools (`iris_execute_classmethod`, `iris_transform_test`, `iris_execute_tests`).
  - `$Name(@`, `$Order(@`, `$Query(@`, `$Increment(@`, `$Xecute`, `Do @` and `Job`: none.
  - The corrected audit covered case-insensitive `XECUTE`/`X`, `@`, dynamic dispatch and `Language = python`. Conclusion: `Global.cls` remains the only caller-text indirection reachable by a READ-classified tool.
- [x] [Review][Patch] `36-4-CR-L` (LOW) — The `sprint-status.yaml` `last_updated` summary predated the QA ledger row; refreshed at this close [_bmad-output/implementation-artifacts/sprint-status.yaml:2]
- [x] [Review][Patch] `36-4-CR-M` (LOW) — The empty-piece pin no longer calls `^G(1,,2)` a working documented form [src/ExecuteMCPv2/Tests/GlobalSubscriptSafetyTest.cls:211]
  - Its comment now says the reference is pinned for byte-identity only; IRIS raises `<SYNTAX>` on it at evaluation, exactly as before (live).
- [x] [Review][Patch] `36-4-CR-N` (LOW, reviewer-found, pre-existing) — The README `iris_global_kill` output example used a field name the handler does not return [packages/iris-dev-mcp/README.md:961]
  - It said `killed`; the handler returns `deleted` (`Global.cls:156`).

**Deferred (pre-existing, ledgered in `deferred-work.md`):**
- [x] [Review][Defer] `36-4-CR-1` (HIGH) — The bootstrap redeploys the embedded classes on ANY version mismatch, including a DOWNGRADE, so an older MCP build silently reinstalls the vulnerable `Global.cls` [packages/shared/src/bootstrap.ts:161] — deferred, pre-existing.
- [x] [Review][Defer] `36-4-CR-2` (LOW) — `+tSub` throws `<MAXNUMBER>` for a string key like `1E999`, so that key cannot be addressed [src/ExecuteMCPv2/REST/Global.cls:273] — deferred, pre-existing.
- [x] [Review][Defer] `36-4-CR-3` (LOW) — Empty or whitespace-only pieces (`1,,2`, `,1`, `" "`, `","`) fail with an opaque `<SYNTAX>`, not a clear error [src/ExecuteMCPv2/REST/Global.cls:270] — deferred, pre-existing (the story's Trap forbids changing empty-piece semantics here).
- [x] [Review][Defer] `36-4-CR-4` (LOW, found in the reviewer's own gate runs) — The two `%UnitTest`-driving Epic 36 gates flake when run in parallel [packages/iris-dev-mcp/scripts/prepublish-gate.mjs:73] — deferred, pre-existing.
  - Symptom: one gate's `LongRunningTest` submission occasionally "completes" about 250–300 ms after submission with zero results, so the zero-result guard returns `isError` at leg 1.
  - Seen in 2 of 8 parallel runs, once on each gate. It did not reproduce in 10 direct concurrent handler runs.
  - It fails closed. It is not attributable to this story: the `/global` queue-node read in the failing leg returned normally, and that subscript shape is pinned byte-identical.

**Dismissed (8):**
1. "A blank or comma-only `subscripts` widens `Kill` to the whole global": disproven live. `^G()` raises `<SYNTAX>` on get, data, set and kill, and no data changed.
2. "Escape-in-place contradicts AC 36.4.2's bind-as-value wording": Task 3(a) sanctions it as the equivalent. The fuzz evidence above covers it.
3. "Lenient un-escape aliases `"a"b"` with `"a""b"`": by design and documented. Safe. Both inputs failed to parse before the fix.
4. "The gate reaches into the SDK's private `_registeredTools`": identical to the established `test-status-governance.test.ts` harness.
5. "The gate fails opaquely when the custom REST service is missing or stale": consistent with the sibling epic gates. A stale, vulnerable deployed class SHOULD fail it.
6. "A unit test kills a global in `%SYS`": a disposable, test-named global, needed to observe the namespace-escape effect. Same privilege model as the dev's test.
7. "Task 1 side effects were recorded only as summaries": superseded by this review's per-test verbatim RED record (CR-E).
8. "Task 6 pre-fix expectations were hand-derived": superseded by the fuzz against the pre-fix builder and by back-compat pins that pass against it (CR-B, CR-E).

**Gates at close:**
- **Bootstrap.** `gen:bootstrap`: `BOOTSTRAP_VERSION` `e966a676d9b0` → `2159ec9e6f69` (HEAD `8465393b3f74` → `2159ec9e6f69`). The roster is unchanged at 29 classes, and a second run produced a byte-identical file.
- **Instance redeployed through the real distribution path.** The real `bootstrap()` from the force-clean-rebuilt dist probed `stale` (`e966a676d9b0`) → deployed + compiled → `current`.
- **Deployed matches source.** All 29 deployed classes equal the embed. `Global.cls`, `GlobalTest.cls` and `GlobalSubscriptSafetyTest.cls` deployed copies equal the repo.
- **Armed gates.** The armed prepublish gate set is 52/52 green, before and after the RED round trip. That includes all four Epic 36 gates: classmethod 17, running-contract 1, test-status 2, global-injection 20; request-body UTF-8 is 12.
- **`node scripts/prepublish-gate.mjs`**, the `prepublishOnly` path, after a forced clean rebuild:
  - One run exited 1 on the `36-4-CR-4` parallel flake (test-status leg 1; global-injection passed 20/20 in it).
  - The next two consecutive runs exited 0 at 52/52.
  - An earlier run failed closed on its stale-dist guard, correctly, because a test file had been edited after the build.
- **OS suite.** `ExecuteMCPv2.Tests` `total` 435 equals the mechanical `Test*` count of 435 (#35); 433 passed, and the 2 failures are the known `36-0-QA-3` ones.
- **Per-package suites:**

  | Package | Result |
  |---|---|
  | shared | 1334/1334 |
  | dev | 807/807 (801 + 6 gate tests) |
  | all | 130/130 |
  | admin | 486/486 |
  | data | 161/161 |
  | interop | 337/337 |
  | ops | 348/348 |
  | client-config | 513/514 (the known `36-1-QA-3`) |

- **Lint and types.** dev lint and type-check are clean.
- **Governance.** `gen:governance-baseline:check` (`:check` only) exits 0 at 141 / 203 / 62.
- **Tool counts unmoved.** dev 29, suite 110; no tool or action key added.
- **Cleanup.** Disposable probe classes `ExecuteMCPv2.Temp.CR364Probe`, `CR364Probe2` and `CR364Fuzz` were deleted and verified absent. No `ZZ364*` / `ExecuteMCPv2SubTest*` globals remain in HSCUSTOM or `%SYS`.
- **`ocupilot-iris`:** not touched.

**File List delta from this review:**
- `src/ExecuteMCPv2/Tests/GlobalTest.cls` is now UNCHANGED from HEAD, so it drops off the story's File List.
- NEW: `src/ExecuteMCPv2/Tests/GlobalSubscriptSafetyTest.cls`. It is not in the bootstrap manifest, per Rule #39.
- Modified further: `Global.cls`, `bootstrap-classes.ts`, the gate test, the dev README, the CHANGELOG, the changeset, `deferred-work.md`, `sprint-status.yaml` and this story file.
