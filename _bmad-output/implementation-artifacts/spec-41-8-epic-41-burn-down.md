---
title: 'Story 41.8: Epic 41 Burn-down'
type: 'bugfix'
created: '2026-10-19'
status: 'done'
baseline_revision: '30f596fef37f5c17589893233a10195530ba9891'
baseline_commit: '30f596fef37f5c17589893233a10195530ba9891'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/.claude/rules/project-rules.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-iris-execute-mcp-v2-2026-10-14/ARCHITECTURE-SPINE.md'
  - '{project-root}/.claude/rules/iris-objectscript-basics.md'
  - '{project-root}/.claude/rules/object-script-testing.md'
warnings:
  - oversized
deferred:
  - summary: 'The `IRIS_ACCEPT_LANGUAGE` docs say a second, per-worker message-table mechanism is "unaffected by this header", but `%CSP.REST` re-matches the message language from the header on every request.'
    evidence: '`README.md:77` and `packages/shared/src/http-client.ts:189-193` describe a per-worker-process table selection that the header does not affect. `irislib/%CSP/REST.cls:149-151` sets `%response.Domain = ..#DOMAIN` and calls `%response.MatchLanguage()` on each request, with `UseSession = 0` (`:114`) and `%Atelier.REST` `DOMAIN = "%Utility"` (`irislib/%Atelier/REST.cls:13`). `irislib/%CSP/Response.cls:314-331` matches `HTTP_ACCEPT_LANGUAGE` whenever `%session.Language` is empty. Live 2026-10-20: `MatchLanguage("*","%Utility","+s")` = `ar`, `("fr")` = `fr`, `("en-US,en;q=0.9")` = `en-us`. Whether any other mechanism exists was not probed. This story changes no docs.'
    location: 'README.md:77; packages/shared/src/http-client.ts:183-193'
    severity: low
  - summary: '`BaseTest:TestAllSixteenHandlersExtendBase` pins 16 `ExecuteMCPv2.REST.*` handlers, but the repo and the live instance hold 19, so that one test is red at HEAD and the spec Verification line "BaseTest (7) ... 0 tests fail" cannot be met.'
    evidence: '`src/ExecuteMCPv2/Tests/BaseTest.cls:299` asserts `tCount = 16` over the `%Dictionary.ClassDefinition` names that start `ExecuteMCPv2.REST.`, excluding Base and Dispatch. `ls src/ExecuteMCPv2/REST/` and `iris_doc_list` (HSCUSTOM, filter `ExecuteMCPv2.REST.`) both show 21 classes, so 19 handlers. The pin was last moved to 16 in Story 38.5 (`06b1b20`); MessageSearch, MessageBody and Coverage came later. Live 2026-10-19: BaseTest total 7, passed 6, failed 1 (this test). This story touches no `REST/*` class, so it did not cause the failure and did not change the count.'
    location: 'src/ExecuteMCPv2/Tests/BaseTest.cls:282-299'
    severity: low
  - summary: >-
      `tool_support.md:21` (the Story 35.3 paragraph) says the `ExecuteMCPv2.Utils` and `ExecuteMCPv2.Diagram.Loader`
      prefix-stripping "remains required and unmodified" and that English and Arabic prefixes can still appear, which
      Story 41.8 makes stale for `Utils.cls`.
    evidence: |-
      `sed -n 21p tool_support.md` ends "...the existing `ExecuteMCPv2.Utils`/`ExecuteMCPv2.Diagram.Loader` prefix-stripping remains required and unmodified."
      Story 41.8 replaces the two-word loop in `Utils.cls:SanitizeError` with the generic `StripErrorPrefix`.
      It is the same root cause as the first item (the `IRIS_ACCEPT_LANGUAGE` docs describe the wrong localization model), so a docs story should fix both together.
      This story changes no `tool_support.md` or README text; its CHANGELOG Known limits names the stale text.
    location: >-
      tool_support.md:21
    severity: low
  - summary: >-
      No re-runnable automated check observes the production path of the one-argument `SanitizeError` and `SafeText`
      under a non-English request language (`Accept-Language` fr, de, ja): AC 41.8.8 and AC 41.8.3's "reads
      `GetErrorText(pStatus)` exactly as today" rest on a recorded manual `curl` and on M8 in the test job's own
      `en-us` session.
    evidence: |-
      Every production caller passes one argument (614 `SanitizeError` calls, 8 `SafeText` calls), while `SanitizeErrorLocaleTest` reaches the code only through the explicit `pLanguage` branch.
      M8 compares the one-argument call with `GetSessionLanguage()`, which is `en-us` in the test job, where the probe showed `GetErrorText(s)` equals `GetErrorText(s,"")`. Collapsing the empty branch to `GetErrorText(pStatus, pLanguage)` therefore keeps every OS row green.
      Searching `packages/**` for `Accept-Language` finds only shared unit tests and `epic35-defect-gate.test.ts`; none drives `GET /global` with a non-English header.
      Fix shape: an env-armed live gate that sends fr, de and ja to the refusal route and expects one prefix each (the QA stage's real-runtime test, skill Rule 3, could carry it).
    location: >-
      src/ExecuteMCPv2/Tests/SanitizeErrorLocaleTest.cls:153-164
    severity: medium
---

<intent-contract>

## Intent

**Problem:** `ExecuteMCPv2.Utils:SanitizeError` strips a leading prefix only when it reads `ERROR #` or the Arabic word, but this instance has 15 `%ObjectErrors` message tables. A status read in 11 of those languages (de, es-cl, fr, it, ja, ko, nl, pt-br, ru, uk and zh-cn) keeps its prefix, and it doubles when re-wrapped (DW-622). It is reachable whenever a REST request's `Accept-Language` names one of these languages, which is what the documented `IRIS_ACCEPT_LANGUAGE` setting does. The same root cause appears in a consumer: `Coverage.Job:SafeText` re-reads the sanitized status in the session language and strips only an English `ERROR #5001: ` marker. Separately, the method's LF-to-space step is dead code, so a combined status reads `disk fullERROR #5001: second`.

**Approach:** One generic shape rule in a new helper, `StripErrorPrefix`. `SanitizeError` calls it once, and gains an optional language argument so the per-locale rows can drive it without changing any session language. `SafeText` reads the inner text, which has no prefix in any language. The CR/LF handling runs before the control-character strip. Per-locale ObjectScript pins come from the live probe log. The bootstrap embed moves in this story.

## Boundaries & Constraints

**Always:**
- Strip at most ONE leading prefix, and only when it has the rule's exact shape (Design Notes, D2). Never strip a `<TOKEN>`-style item, a bracket domain code (`<Ens>ErrGeneral`), or a look-alike from the negative-control list.
- A call that omits the language runs the same `$System.Status.GetErrorText(pStatus)` one-argument call as today, for all 614 call sites. All of them pass one argument, counted with `grep -rho 'ExecuteMCPv2.Utils).SanitizeError(\|\.\.SanitizeError(' src/ExecuteMCPv2 --exclude-dir=Tests | wc -l`. The live probe showed it equals the `""` form only under an `en-us` session; a non-English session was not probed.
- Pinned test values come from the probe log below (Rule #36). Non-ASCII words are `$Char(...)` code points in source (Rule 14), and the Arabic UTF-8 literal at `Utils.cls:181` goes away. The test class also asserts that the live language list and every live rendering still equal the pins, so a changed instance fails loudly.
- Follow the ObjectScript rules: `$$$` macros; no `$$$AssertFalse` (use `$$$AssertTrue('…)`); no argumented `Quit` inside Try/Catch; no `$Get()` around a method call; the test class stays at ~500 lines or fewer.
- Follow the shared-instance rules: every IRIS call names `server:"default"` and `namespace:"HSCUSTOM"`. Run OS test classes one per `iris_execute_tests` call and compare `total` with the class's `Test*` count (Rule #35). Never stop or restart IRIS. Write no HSCUSTOM global, `^ClineDebug` included. Probes, if any, are disposable `ExecuteMCPv2.Temp.Probe418*` classes, deleted, with leftovers `[]`.
- Bootstrap (Rule #24, AD-14): run `pnpm gen:bootstrap` in this story and record `BOOTSTRAP_VERSION` `5296a1c836f4` → the new value it prints. Add a `patch` changeset and a top CHANGELOG section (AD-29).

**Never:**
- Never call `%MessageDictionary.SetSessionLanguage`, and never change any instance, process or NLS locale setting, in a test or a probe. Pass the language as an argument instead.
- No behavior change to `Diagram.Loader:CleanStatusText` (comment only, D6), to `SafeText`'s leading-code capture (`Job.cls:922-930`), to the skills pack or `skills-pack-src/` (except the one error-handling skill correction of decision #51, regenerated through `gen:pack`), prompts, tools, presets, governance, routes, any README, or `.claude/rules/*`.
- No new bootstrapped class. Never hand-edit `bootstrap-classes.ts`, `irislib/` or `irissys/`. Never run the bare governance-baseline generator.
- No `git commit`, `push`, `reset` or `rebase` by any stage agent or subagent.

## I/O & Edge-Case Matrix

Oracle (probe log, live 2026-10-20, IRIS 2026.2 Build 221U, HSCUSTOM): `GetLanguages("%ObjectErrors","s")` and `GetLanguages("%Utility","s")` both return these 15 languages. `GetErrorText($$$ERROR(5001,"disk full"), L)` is exactly `<word> #5001: disk full` for each:

| L | word | L | word | L | word |
|---|---|---|---|---|---|
| ar | `$Char(1582,1591,1571)` | fr | `ERREUR` | pt-br | `ERRO` |
| de | `FEHLER` | it | `ERRORE` | ru | `$Char(1054,1064,1048,1041,1050,1040)` |
| en | `ERROR` | ja | `$Char(12456,12521,12540)` | uk | `$Char(1055,1054,1052,1048,1051,1050,1040)` |
| en-us | `ERROR` | ko | `$Char(50724,47448)` | zh-cn | `$Char(38169,35823)` |
| es | `ERROR` | nl | `FOUT` | | |
| es-cl | `Error` | | | | |

"inner" below means `$System.Status.GetOneStatusText(<result>, 1)`, the message without domain or code.

| # | Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|---|
| M1 | One prefix, every language (DW-622) | `SanitizeError($$$ERROR(5001,"disk full"), L)`, each of the 15 L | inner = `disk full` | No error expected |
| M2 | Exactly one | `$$$ERROR(5001, "ERREUR #5001: x")`, each L | inner = `ERREUR #5001: x` | — |
| M3 | Look-alike inside the message | `$$$ERROR(5001, "Order #12: shipped")`, each L | inner = `Order #12: shipped` | — |
| M4 | `<TOKEN>` kept | an `<UNDEFINED>` status (`ex.AsStatus()`, code 5002), each L | inner contains `<UNDEFINED>` and no `#5002: ` | — |
| M5 | Bracket domain code kept | `$$$ERROR("<Ens>ErrGeneral","queue full")`, each L | inner = `GetErrorText(<input>, L)` unchanged, e.g. `ERREUR <Ens>ErrGeneral: queue full` | — |
| M6 | Combined status (D4) | `$$$ADDSC($$$ERROR(5001,"disk full"), $$$ERROR(5001,"second"))`, each L | inner = `disk full <word> #5001: second`, with one space | — |
| M7 | Embedded status (D4) | `EmbedStatus($$$ERROR(5001,"Import failed"), $$$ERROR(5001,"disk full"))`, each L | inner = `Import failed   > <word> #5001: disk full`: three spaces (the LF plus the two-space indent) | — |
| M8 | Default language | `SanitizeError(s)` one-argument, s = M1 input and M4 input | M1 inner = `disk full`; M4 inner = inner of `SanitizeError(s, GetSessionLanguage())` | — |
| M9 | No such table | `SanitizeError($$$ERROR(5001,"disk full"), "zz")` | inner = `disk full` (IRIS falls back to English: `ERROR #5001: disk full`) | — |
| M10 | Empty message | `$$$ERROR(5001, "")`, each L | inner = `""` | — |
| M11 | Not-well-formed statuses (same as today) | `SanitizeError("", "en-us")`, `SanitizeError(0, "en-us")`, `SanitizeError("0 garbage", "en-us")` | inner = `(no error description)`, `(no error description)`, `Invalid status code structure ("0 garbage")` | — |
| M12 | OK passes through | `SanitizeError($$$OK, "fr")` | returns `$$$OK` | — |
| M13 | Helper positives | `StripErrorPrefix`: `ERROR #00: (no error description)`, `ERROR #5001: `, `ERROR #5001: ERROR #5001: x`, `Fehlermeldungtex #5001: x` (16 chars) | `(no error description)`, `""`, `ERROR #5001: x`, `x` | — |
| M14 | Helper negatives (all returned unchanged) | `ERROR #: disk full`, `ERROR #abc: disk full`, `ERROR #5001a: disk full`, `ERROR #5001 disk full`, `ERROR #5001:disk full`, `ERROR #5001`, `see ERROR #5001: here`, ` ERROR #5001: x`, `The run stopped at step #5: see the log`, `<UNDEFINED> #5001: x`, `ERROR <Ens>ErrGeneral: queue full`, `Supercalifragilisticexpialidocious #5001: x`, `Fehlermeldungtext #5001: x` (17 chars), `ERR-OR #5001: x`, `ERROR1 #5001: x`, `ERROR  #5001: x`, `""` | input unchanged | — |
| M15 | `SafeText`, every language (D3) | `SafeText(<word> #5001: disk full, L)`, each L | the input, unchanged: the code kept and no wrapper prefix | — |
| M16 | `SafeText` back-compat | the three `CoverageJobTest:472-478` rows (no language) | unchanged values | — |
| M17 | Live envelope (D5; Integration) | `GET /api/executemcp/v2/global` with no `global` parameter, header `Accept-Language` = `fr`, `de`, `ja`, `en-US,en;q=0.9` | `status.errors` text = `<word> #5001: Required parameter 'global' is missing or empty`, with exactly one prefix, in that language | Read-only validation refusal; nothing changes |

</intent-contract>

## Code Map

- `src/ExecuteMCPv2/Utils.cls:121-195` -- `SanitizeError`.
  - `:128` reads `GetErrorText(pStatus)` with no language.
  - `:130` runs `$ZStrip(…,"*C")` before `:132-133` replace CR and LF, so the LF→space step is dead. Live: a combined status reads `disk fullERROR #5001: second`. The comments at `:129` and `:131` describe the wrong lines.
  - `:135-174` is the caret strip, and `:176-178` the empty fallback. Both stay, and so does their order before the prefix strip.
  - `:179-193` is the two-word loop, with a UTF-8 Arabic literal at `:181`. It is replaced.
- `src/ExecuteMCPv2/Utils.cls:76-82` -- `ValidateRequired`'s text `Required parameter '<name>' is missing or empty` (M17's message).
- `src/ExecuteMCPv2/Coverage/Job.cls:917-935` -- `SafeText`.
  - `:922-930` capture an English `ERROR #N: ` prefix. This is behavior-neutral once `SanitizeError` is generic, and it stays.
  - `:931-933` read the sanitized status with `GetErrorText` in the session language, then strip only `ERROR #5001: `. That is the defect.
  - Callers: `:528`, `:1089`, `:1106`, and `REST/Coverage.cls:304,382`. The REST callers run in a REST worker, where the language comes from the request header.
- `src/ExecuteMCPv2/Diagram/Loader.cls:161-222` -- `CleanStatusText`, a sibling that is NOT extended (D6).
  - `:186-192` strip up to three prefixes of the shape `.E1"#"1.AN` within 44 characters.
  - `:212-217` comment "Mirrors the two-variant list the Rule #8 prefix handling uses". It becomes false and is rewritten.
  - `:218` normalizes the Arabic word only. It stays.
- `src/ExecuteMCPv2/REST/Global.cls:14-27` -- `GetGlobal`. A missing `global` goes through `ValidateRequired`, then `SanitizeError`, then `RenderResponseBody`. That is M17's read-only route.
- `src/ExecuteMCPv2/Tests/UtilsTest.cls` (482 lines, 30 `Test*`) -- the count-stability tests at `:163-202` stay. The class is too full for new rows.
- `src/ExecuteMCPv2/Tests/CoverageJobTest.cls` (500 lines, 31) -- the `SafeText` rows at `:472-478` (M16) stay. This class is full too.
- Pins that must stay green:
  - `src/ExecuteMCPv2/Tests/CommandTest.cls:140-156` (18 tests);
  - `ClassMethodEdgeTest.cls:162-185` (11; English `ERROR #` count, never `ERROR #5001: ERROR #`);
  - `BaseTest.cls:268` (7);
  - `DiagramLoaderTest.cls` (11).
- `irislib/%SYSTEM/Status.cls`:
  - `:62-71` `GetErrorCodes`;
  - `:77-80` `GetErrorText(statuscode, language)` passes `.language` by reference;
  - `:92-95` `GetOneStatusText`, the "inner text … without the error domain, id or source".
- `irislib/%Library/MessageDictionary.cls` -- `:155` `GetLanguages(domain, flag)`; `:199` `MatchLanguage`; `:249` `GetSessionLanguage` (read-only use only); `:261` `SetSessionLanguage` (never called).
- `irislib/%CSP/REST.cls:114,149-151`, `irislib/%Atelier/REST.cls:13` and `irislib/%CSP/Response.cls:314-335` -- the per-request language match: `UseSession = 0`, `DOMAIN = "%Utility"`, `HTTP_ACCEPT_LANGUAGE`.
- `packages/shared/src/config.ts:98`, `http-client.ts:183-216` and `README.md:77` -- `IRIS_ACCEPT_LANGUAGE`, default `en-US,en;q=0.9`: the user's route to non-English status text. Read-only (frontmatter `deferred:` item 1).
- `scripts/gen-bootstrap.mjs:15,19,27` -- the roster rows for Utils (first), Diagram.Loader and Coverage.Job. It prints `BOOTSTRAP_VERSION: <hash>`, and a second run prints `Unchanged … (not rewritten)`.
- `packages/shared/src/bootstrap-classes.ts:25,1227` -- `5296a1c836f4` (generated; changes only through the generator).
- `packages/shared/src/__tests__/bootstrap.test.ts:1026-1100,1269` -- 35 classes and the embed-vs-disk drift tests. No hash literal.
- `packages/iris-mcp-all/src/__tests__/changelog-bootstrap-move.test.ts` -- the newest CHANGELOG move must end at the embed's version.
- History literals that stay true: `story-40-5-doc-claims.test.ts:58-59`, `story-41-2-doc-claims.test.ts:76`, the older CHANGELOG lines (`:10,94,192,286,340,396,457,512`), and `.changeset/story-40-5-epic-40-burn-down.md`.
- `packages/iris-dev-mcp/src/__tests__/test-production-guard.test.ts:440-450` -- requires only that `Utils.SanitizeError` exists. `SafeText` must call no new cross-class method; `GetOneStatusText` is a system API.
- `CHANGELOG.md:1-16` (the top section's shape) and `:505-516` (40.5's move sentence); `.changeset/story-40-5-epic-40-burn-down.md` (the changeset format); `packages/iris-mcp-all/src/__tests__/story-40-5-doc-claims.test.ts` (the doc-claims precedent).

## Tasks & Acceptance

**Execution:**
- [x] `src/ExecuteMCPv2/Utils.cls` -- DW-622:
  - Add `ClassMethod StripErrorPrefix(pText As %String) As %String` implementing D2 exactly, with a doc comment that states the contract.
  - `SanitizeError` gains `pLanguage As %String = ""`. An empty value runs the one-argument `GetErrorText(pStatus)`; otherwise it runs `GetErrorText(pStatus, pLanguage)`.
  - Move the CR-removal and LF→space `$Replace` lines above `$ZStrip(…,"*C")` (D4), and correct the misplaced comments.
  - Replace the `:179-193` loop with `Set tSafe = ..StripErrorPrefix(tSafe)`.
  - Update the method doc to cover the language argument and the one-prefix-in-any-language contract.
  - Why: the generic fix, and the per-locale reach without changing any session language (D1).
- [x] `src/ExecuteMCPv2/Coverage/Job.cls` -- `SafeText` gains `pLanguage As %String = ""`, passed to `SanitizeError`. Replace `:931-933` with `Quit tPrefix_$System.Status.GetOneStatusText(<sanitized>, 1)`, and update its doc comment. Why: the same root cause, in a consumer (D3).
- [x] `src/ExecuteMCPv2/Diagram/Loader.cls` -- comment only: replace the "Mirrors the two-variant list…" sentence at `:212-217` with the true contract (only the Arabic word is normalized; other words stay as rendered). Why: the claim becomes false (D6).
- [x] `skills-pack-src/knowledge/iris-mcp-objectscript-error-handling/SKILL.md` -- lead decision #51 (decision #15 content accuracy; folded in at the spec gate from this plan's second deferred item).
  - **The false claim.** The `ErrorMessage` paragraph (`:37-38`) says the cut at the status's own ` #<code>: ` tag holds "for a status whose code is a number, such as 5001". Live (`Probe418C`), an empty or `0` status renders `ERROR #00: (no error description)` while `GetErrorCodes` returns `6219`, so the prefix stays.
  - **The correction.** State that edge in one short sentence, with what to do about it (test `$$$ISOK`, or skip the cut, before reading the text). Re-probe the exact rendering in a disposable `ExecuteMCPv2.Temp.Probe418*` class, then delete it.
  - **What the text must keep.** No `iris_*` token, no internal reference, the ≤500-line / ≤1,200-word budget, and frontmatter that is byte-unchanged.
  - **Regenerate and re-pin.** Run `pnpm gen:pack`, then move every golden sha256 / byte / word-count pin of this skill, with the new values from tool output (Rule #51). `validate:prompts` and `check:provenance` must stay green.
  - Why: a probed-false claim in shipped agent content is fixed before the epic merges (decision #15). No later story owns knowledge-skill text.
- [x] `src/ExecuteMCPv2/Tests/SanitizeErrorLocaleTest.cls` -- new `%UnitTest.TestCase`.
  - A pinned table: `PinnedLanguages()` returns the 15 languages comma-joined, and `PinnedWord(pLang)` returns each word via `$Case` and `$Char`.
  - About nine `Test*` methods covering M1–M15 and the drift guards: the live `GetLanguages("%ObjectErrors","s")` list equals the pin, and each live M1 rendering equals `PinnedWord(L)_" #5001: disk full"`.
  - It writes no global and builds every status in memory.
  - Why: per-locale pins plus negative controls (DW-622, Rule #36, Rule #56).
- [x] HSCUSTOM deployment of the four `src/ExecuteMCPv2/` files above -- live, in order:
  1. Before deploying, record M17's "before" response for each of the four headers (D5).
  2. `iris_doc_load` with compile for the four files.
  3. Run each OS class in Verification, one per call.
  4. Record M17's "after" response.

  Why: OS pins on the real runtime, and the outermost surface (Rule #26, #48).
- [x] `packages/shared/src/bootstrap-classes.ts` (generated) --
  1. Run `pnpm gen:bootstrap` twice: the second run prints `Unchanged`. Record from → to.
  2. Rebuild shared.
  3. Why: Rule #24. The pins that move are `bootstrap-classes.ts:25,1227` and the newest CHANGELOG move. All history literals stay.
- [x] `CHANGELOG.md` -- a new top section `## [Pre-release — YYYY-MM-DD] — Story 41.8: Epic 41 burn-down`, with the local date the section is written.
  - The counts paragraph (D7) and its sentence `` `BOOTSTRAP_VERSION` moves from `5296a1c836f4` to `<the printed hash>` ``.
  - `### Changed`, `### Added`, `### Tests`, `### Known limits`.
  - Why: AD-29, Rule #43.
- [x] `.changeset/story-41-8-epic-41-burn-down.md` -- front matter exactly `"@iris-mcp/shared": patch` and `"@iris-mcp/client-config": patch` (amended at review, see the Spec Change Log), plus a one-paragraph `fix:` summary (D7).
- [x] `packages/iris-mcp-all/src/__tests__/story-41-8-doc-claims.test.ts` -- following the `story-40-5-doc-claims` precedent, pin:
  - the section title, written with a `—` escape;
  - the section sitting above Story 41.7's;
  - the move as the history literals `BOOTSTRAP_FROM`/`BOOTSTRAP_TO`;
  - the counts (110/115, `1e62c5ad5bf7`, 141, 35 classes);
  - the changeset bump map.

**Acceptance Criteria:**
- **AC 41.8.1 (DW-622):** Given a `%Status` read in any of the instance's 15 message-table languages, when `SanitizeError` re-wraps it, then its text carries exactly one prefix, its own (M1, M2, M9, M10).
- **AC 41.8.2:** Given text that only looks like a prefix, a `<TOKEN>` item, or a bracket domain code, when it reaches `StripErrorPrefix` or `SanitizeError`, then it is returned unchanged (M3–M5, M14). The rule strips the shapes in M13.
- **AC 41.8.3 (back-compat, Rule #19):** Given any existing one-argument call, when it runs, then it reads `GetErrorText(pStatus)` exactly as today (M8), the not-well-formed statuses keep today's values (M11), and the English pins in UtilsTest, CommandTest, ClassMethodEdgeTest, BaseTest, CoverageJobTest (M16) and DiagramLoaderTest stay green.
- **AC 41.8.4 (D3):** Given recorded error text in any of the 15 languages, when `SafeText` sanitizes it, then the text keeps its own code and gains no wrapper prefix (M15).
- **AC 41.8.5 (D4):** Given a combined or embedded status, when it is sanitized, then its lines are separated by a space instead of run together (M6, M7).
- **AC 41.8.6 (Rule #56):** Given the live instance, when the test class runs, then the language list equals the 15 pins and every live rendering equals its pin. An added, removed or changed table turns the class red.
- **AC 41.8.7 (Rule #24):** Given the changed bootstrapped classes, when `pnpm gen:bootstrap` runs twice, then the embed moves once from `5296a1c836f4`, the second run is unchanged, the shared drift tests and `changelog-bootstrap-move` pass, and the CHANGELOG, changeset and doc-claims test name the move.
- **AC 41.8.8 (Integration, D5, Rule #26/#48):** Given the deployed service, when the read-only `GET /global` refusal is requested with `Accept-Language` `fr`, `de`, `ja` and `en-US,en;q=0.9`, then each envelope's error text carries exactly one prefix in that language (M17). The before leg shows the doubled fr/de/ja text.
- **AC 41.8.9 (no other surface):** Given the finished story, when the existing gates run, then the counts are unchanged: tools 110/115, the 12 prompts byte-identical (16 hashes), the governance baseline `1e62c5ad5bf7`/141, 35 bootstrapped classes, 23 pack files, and 13 `gen:skills` files.
- **AC 41.8.10 (decision #51):** Given the error-handling knowledge skill, when it describes `ErrorMessage`, then it states the empty or `0` status edge truthfully, matching the live probe. The pack is regenerated by `gen:pack`, the skill's golden pins move with values taken from tool output, and `gen:pack:check`, `validate:prompts` and `check:provenance` pass.

## Spec Change Log

- 2026-10-20 (lead spec gate):
  - D1–D7 were taken as recommended (wave-7 decisions #44–#50).
  - The second plan-stage `deferred:` item (the error-handling skill's `ERROR #00:` edge) is folded into this story as decision #51. That adds the task under Execution, AC 41.8.10, and the narrowed pack exception in Never. It is removed from `deferred:`.
  - The first `deferred:` item (the `IRIS_ACCEPT_LANGUAGE` docs) is harvested at dev complete to 42.9.
  - The spine "Error text" conventions row now names the generic one-prefix rule.
- 2026-10-19 (implement stage; apply and report):
  - Decision #51's sentence tells the reader to compare the value with `""` and `0` before the cut, not to test `$$$ISOK`. The live probe showed `$$$ISOK("")` and `$$$ISOK(0)` are both 0 (as for any error), so `$$$ISOK` cannot tell the empty or `0` value from a real error status; the comparison can. The sentence also says the prefix stays, as the probe showed.
  - The skill gains two probe anchors (`ERROR #00: (no error description)` and `GetErrorCodes` returns `6219`), so `skills-pack-knowledge.test.ts` moves the anchor total from 170 to 172 (the error-handling skill from 27 to 29) with its sha256.
  - The Verification expects `BaseTest` (7) with 0 failures, but `TestAllSixteenHandlersExtendBase` is red at HEAD (19 handlers against a pin of 16). It is added to frontmatter `deferred:` and left unchanged here.
- 2026-10-19 (review pass; apply and report):
  - **Triggering finding:** the changeset bumped only `@iris-mcp/shared`, but decision #51 (folded in after D7 was written) changes a file that ships in `@iris-mcp/client-config` (`packages/client-config/skills-pack/skills/iris-mcp-objectscript-error-handling/SKILL.md`). D7's premise "the only package whose shipped file changes" no longer held, and every earlier Epic 41 skills-pack changeset bumps client-config.
  - **Amended:** the changeset front matter is now `"@iris-mcp/shared": patch` and `"@iris-mcp/client-config": patch`; the changeset summary names the pack; `story-41-8-doc-claims.test.ts` pins the two-entry bump map. The packages are one fixed group, so no released version number differs; only the client-config changelog gains the entry.
  - **Known-bad state avoided:** a shipped pack text with no release-note entry in its own package.
  - **KEEP:** the generic `StripErrorPrefix`, the `pLanguage` seam, the D4 order change, the pinned-language table, the `5296a1c836f4` to `d51856f74d6a` move and the live before/after record.
  - The doc-claims test also guards the changeset (it is consumed by `changeset version`), as `story-41-2-doc-claims.test.ts` does; two M14 rows (an empty word, two ` #` in the head) were added to `TestStripErrorPrefixKeepsEveryLookAlike`.

## Review Triage Log

### 2026-10-19 — Review pass
- verdicts: 25 findings — high 0, medium 13, low 10, false 2, maybe-false 0
- findings:
  - `[medium]` `[defer]` (Blind Hunter) The `IRIS_ACCEPT_LANGUAGE` text in `README.md:77`, `tool_support.md:21` and the `http-client.ts:183-193` comment contradicts the new behavior (and `tool_support.md` calls `Utils` "unmodified") — README and `http-client.ts` are already the first `deferred:` item (harvested to 42.9, spec forbids a README change); `tool_support.md:21` is added as a new deferred item; the CHANGELOG Known limits now names the stale text.
  - `[medium]` `[patch]` (Blind Hunter) The changeset omits `@iris-mcp/client-config` although the shipped skill copy changes — real (41.1 to 41.7 all bump it; D7's premise was overtaken by decision #51); changeset, its summary and the doc-claims bump map now carry both packages; Spec Change Log entry.
  - `[medium]` `[patch]` (Blind Hunter) Two `StripErrorPrefix` conditions (an empty word, two ` #` in the head) have no negative row — real; rows `" #5001: x"` and `"ERROR #5001 #7: x"` added; `mutation:` lines below (`< 2` for `'= 2` red on the second row, dropped `< 1` red on the first).
  - `[low]` `[reject]` (Blind Hunter) "in any script" is asserted but only ASCII look-alikes are pinned — the wording is the spec's D2; the probe log already classifies the non-ASCII punctuation, NBSP and tab; every real table word passes and no reachable input fails; extra fixtures need new probes for a hypothetical table.
  - `[medium]` `[patch]` (Blind Hunter) The CHANGELOG sentence "Each case was shown red against a mutation" is broader than the recorded mutations — real; reworded to the acceptance criteria whose pinning tests have a recorded mutation (same root cause as the Verification Gap and Intent Auditor rows on this claim).
  - `[medium]` `[defer]` (Blind Hunter) The tests mostly drive the explicit-language branch that no production caller passes; the path that matters (one-argument call under a non-English session) has only a manual `curl` — real, spec-designed (D5); a re-runnable live gate is out of the spec's footprint; new deferred item (severity medium) naming the fix shape and the QA stage.
  - `[low]` `[reject]` (Blind Hunter) Other hand-rolled strippers (`REST/UnitTest.cls:StatusText`, `Diagram.Loader:CleanStatusText`) stay on other rules — `CleanStatusText` is justified under Design Notes "Extend, don't copy"; `StatusText` is a private helper with its own 24-character contract that runs on an already-sanitized status, is untouched, and its behavior does not change.
  - `[low]` `[reject]` (Edge Case Hunter) A message that starts or ends with LF now keeps a space — D4 mandates LF to space (the method's comments promised it), the fallback test `$ZStrip(tSafe,"<>W")` still guards empty text, and the cosmetic space is not worth a guard.
  - `[low]` `[reject]` (Edge Case Hunter) A mixed-case `pLanguage` or an `Accept-Language` list may render English — no production caller passes a language; the argument is a documented tag read by `GetErrorText`, which is the arbiter.
  - `[medium]` `[defer]` (Edge Case Hunter) `SafeText` with no language under a non-English session is unpinned — same root cause as the explicit-language-branch row above; one deferred item.
  - `[medium]` `[patch]` (Edge Case Hunter) The changeset omits `@iris-mcp/client-config` — same root cause and fix as the second row.
  - `[low]` `[patch]` (Edge Case Hunter) "Every IRIS rendering begins with its own prefix" is false for `Unknown status code` renderings, and the Changed bullet's "any look-alike unchanged" contradicts Known limits — CHANGELOG sentences corrected (`or with Unknown status code`; "a look-alike that is part of the message") and the doc-claims string moved with them; the `Utils.cls` doc comment carries the spec's own wording and is left, because correcting a comment would move the embed hash for a wording nit (the shape cannot match `Unknown status code` text, so the behavior is safe).
  - `[medium]` `[defer]` (Verification Gap) The production no-language path is not observed by any automated test — same root cause as the explicit-language-branch row above; one deferred item.
  - `[medium]` `[patch]` (Verification Gap) The CHANGELOG "every case was shown red" sentence overstates the evidence (M11 to M13 methods stayed green under every recorded mutation) — same fix as the fifth row.
  - `[medium]` `[patch]` (Verification Gap) The doc-claims test reads the changeset at collection, so it fails once `changeset version` consumes the file — real (`story-41-2-doc-claims.test.ts` guards it); `it.skipIf(!changesetPresent)` plus a guarded read in the compliance loop; proven by holding the changeset aside and running the file (8 passed, 1 skipped), then restoring it byte-identical.
  - `[low]` `[reject]` (Verification Gap, other) `SafeText`'s forwarding of `pLanguage` to `SanitizeError` is not observed — the generic strip makes the output identical in every language, so the forward has no behavior to pin; AC .4's mutation pins the read that matters.
  - `[false]` `[reject]` (Verification Gap, other) `TestPinnedLanguagesAndRenderingsMatchTheInstance` depends on live tables the test did not create — by design (AC 41.8.6): an instance change must turn it red.
  - `[low]` `[reject]` (Verification Gap, other) `$$$AssertEquals($ListLength(tLangs), 15, ...)` compares a literal with the pin — it fails if the pin is edited, the live equality is the real guard, and removing a harmless assertion buys nothing.
  - `[low]` `[defer]` (Verification Gap, other) `BaseTest:TestAllSixteenHandlersExtendBase` is red at HEAD — pre-existing and already the second `deferred:` item; no `REST/*` class changed here.
  - `[medium]` `[defer]` (Intent Auditor) M17 has no automated check; the before/after strings appear only as CHANGELOG prose and in this spec — same root cause as the explicit-language-branch row; one deferred item.
  - `[medium]` `[defer]` (Intent Auditor) The language argument is exercised only by tests; the wire path runs through the one-argument form — same root cause; one deferred item.
  - `[low]` `[reject]` (Intent Auditor) M15 is met by two mechanisms (the English capture for en, en-us and es; the generic strip for the rest) that one assertion cannot tell apart — both outcomes are the specified behavior (the `Job.cls:922-930` capture stays by the Boundaries); AC .4's mutation exercises the generic path.
  - `[low]` `[reject]` (Intent Auditor) Other consumers keep their own prefix handling (`UnitTest.StatusText`, `Health.AreaErrorText`, `CleanStatusText`) — outside M17's route and the Boundaries; same disposition as the seventh row.
  - `[false]` `[reject]` (Intent Auditor) The skill edit about the empty or `0` status is absent from the Problem and Approach — the Boundaries name it (decision #51); it is covered by the sha256 and anchor pins and by AC 41.8.10.
  - `[medium]` `[patch]` (Intent Auditor) The CHANGELOG "each case was shown red" claim and the live before/after results cannot be checked from the diff — the claim is reworded (fifth row) and the live strings are recorded in this spec's Verification.

## Design Notes

**Governing architecture (Rule 6).** No AC contradicts an AD Rule.
- **AD-11:** the IRIS-side status text still passes through `SanitizeError`. The envelope shape is unchanged.
- **AD-14:** the embed moves once; there is no new class, and the count stays at 35.
- **AD-33:** no route's request or response shape changes; only the error-text value loses a doubled prefix. No route pin is needed.
- **AD-15:** no prompt changes.
- **AD-29:** a `patch` changeset; no version is cut and nothing is published.
- **Conventions:** "Error text", "IRIS-side unit tests", "Probes and references" (the IRIS version the APIs were verified on: 2026.2 Build 221U), "ObjectScript naming/pitfalls" and "Live testing on a shared instance".

**Ledger inbox:** DW-622 is addressed by the Utils, SafeText and test tasks and by AC 41.8.1, .2 and .6. Nothing is declined. The resolved bar (Rule #48) is met by AC 41.8.8 (live) plus the recorded mutations.

**Integration ACs (Rule 1/2).**
- Consumed-by: `SanitizeError` (this story); every REST handler through `SanitizeError` (614 existing call sites; AC 41.8.8 observes one live); `Coverage.Job:SafeText` (this story; AC 41.8.4).
- Consumes: `%SYSTEM.Status` `GetErrorText`, `GetOneStatusText` and `GetErrorCodes`; `%MessageDictionary` `GetLanguages` and `GetSessionLanguage` (tests only); the `%CSP.REST` per-request language match (M17).

**Extend, don't copy (Rule 2).**
- **Sibling `Diagram.Loader:CleanStatusText`** is not extended. Its contract differs: up to three stacked prefixes, alphanumeric word codes (`#ErrGeneral`), and a 44-character `.E1"#"1.AN` gate that strips `see #12: here`. Its diagram callers pin that contract in `DiagramLoaderTest`. The new helper shares no lines with it.
- **The knowledge skill's `ErrorMessage`** is agent content, not code (frontmatter `deferred:` item 2).

**Probe log (Rule #36 oracle, live 2026-10-20, IRIS 2026.2 Build 221U, HSCUSTOM).** Disposable `ExecuteMCPv2.Temp.Probe418A/B/C`; all languages were passed as arguments; leftovers are `[]` (CLS and RTN, generated included).
- **Languages and words.** `%ObjectErrors`, `%Utility` and all system domains have the same 15 languages, with the words in the matrix table. Word lengths are 2–7 (uk is the longest). No word holds a space. `es-cl` is mixed case.
- **Character classes.** `word?1.A` is 0 for ja, ko and zh-cn. `$ZStrip(word,"*PCWN")=word` is 1 for all 15. The codes `<`, `>`, `#`, `:`, `_`, `.`, `-`, `'`, `(`, U+00A0, U+3001, U+3002, U+FF1A, U+060C, U+061F, U+2014 and U+2026 are `P`; tab is `C`/`W`. U+30FC, U+9519 and U+0623 are none of P, C, W or N.
- **Other shapes.**
  - `<Ens>` codes render `<word> <Ens>ErrGeneral: queue full`, with no `#`.
  - The 5002 inner text is localized: fr `Erreur ObjectScript: <UNDEFINED>…`, ja `ObjectScript エラー:<UNDEFINED>…` (ja has no space before `<UNDEFINED>`), nl `ObjectScript fout : …`.
  - Combined statuses are joined by CR LF; embedded ones by CR LF plus `  > `.
  - `GetErrorText(s)` equals `GetErrorText(s,"")` under the `en-us` session; language `zz` falls back to English.
  - `GetOneStatusText($$$ERROR(5001,X),1,L)` = X in all 15 languages.
- **Today's `SanitizeError`** (session `en-us`): combined = `disk fullERROR #5001: second`, embedded = `Import failed  > ERROR #5001: disk full`, `<Ens>` unchanged, `""`/`0` = `(no error description)`, `0 garbage` = `Invalid status code structure ("0 garbage")`.
- **The candidate D2 rule** (run over all 15 languages × six shapes) strips exactly the real prefix and leaves `<Ens>` text alone. Every M13 and M14 row behaved as listed.
- **Request matching.** `MatchLanguage("*","%Utility","+s")` = `ar`, `fr` = `fr`, `de` = `de`, `en-US,en;q=0.9` = `en-us`. The REST worker's session language is `en-us`.

**Orchestrator decisions needed** (the Lead's calls, delegated; the wave-7 numbering starts at #44). The plan follows each recommendation.

- **D1 (#44). Orchestrator decision needed: how do the per-locale rows reach `SanitizeError` without changing any session language?** Recommended: an optional trailing `pLanguage` argument. An empty value keeps today's one-argument `GetErrorText(pStatus)` call; a set value calls `GetErrorText(pStatus, pLanguage)`. Why:
  - It drives the outermost method itself (the READY standard is surface-anchored).
  - `GetErrorText(s, L)` renders the same table a session in L reads; `%CSP.REST` sets exactly that session language per request.
  - All 614 call sites keep the same call path.

  Alternatives:
  - Test only the helper on live `GetErrorText(s, L)` text. That is an internal proxy.
  - Use `SetSessionLanguage` in the test. The shared-instance rule forbids it, and a failed restore leaks into later tests in the same job.
- **D2 (#45). Orchestrator decision needed: the generic rule.** Recommended: `StripErrorPrefix(pText)` returns the text after the first `": "` exactly when all of these hold, and returns `pText` unchanged otherwise:
  1. the head (the text before the first `": "`) contains exactly one `" #"`;
  2. the part after `" #"` is `?1.N`;
  3. the word before it is 1–16 characters long, and `$ZStrip(word, "*PCWN") = word` (no punctuation, control, whitespace or digit character, in any script).

  Why:
  - **The character bound.** Pattern `A` misses ja, ko and zh-cn; the P/C/W/N exclusion admits all 15 words and refuses `<`, `#`, `.`, `-`, a space, NBSP and digits. That handles `<TOKEN>` items and "a prefix not at the start".
  - **The length bound.** 16 is more than twice the longest real word (7), so a table this instance lacks still fits, while a long single token is refused. A sentence fails on its spaces.
  - **The rejected alternative** (D2b) anchored the digits to the status's first code, which is what the knowledge skill teaches. It would keep a short `Order #12: ` look-alike at the start of raw text. But it regresses a reachable input: `GetErrorText("")` and `GetErrorText(0)` render `ERROR #00: …` while `GetErrorCodes` returns `6219`, so today's strip would stop (Rule #54).
  - **The shape-only limit**, recorded under Known limits: `Order #12: shipped` at the very start of raw helper input is stripped. `SanitizeError` never passes such text first, because every IRIS rendering begins with its own prefix, `<word> <Domain>Code`, or `Unknown status code`. M3 pins the message case.

  Golden helper (probe-validated shape):
  ```objectscript
  Set tColon = $Find(pText, ": ")
  If tColon = 0 Quit pText
  Set tHead = $Extract(pText, 1, tColon - 3)
  If $Length(tHead, " #") '= 2 Quit pText
  Set tWord = $Piece(tHead, " #", 1)
  If ($Length(tWord) < 1) || ($Length(tWord) > 16) || ($ZStrip(tWord, "*PCWN") '= tWord) Quit pText
  If $Piece(tHead, " #", 2) '? 1.N Quit pText
  Quit $Extract(pText, tColon, *)
  ```
- **D3 (#46). Orchestrator decision needed: include `Coverage.Job:SafeText`'s English-only marker, a second occurrence of DW-622's root cause in the same embed?** Recommended: include it.
  - `SafeText` reads `GetOneStatusText(…, 1)`, which is language-free (live: X in all 15 languages), and passes an optional `pLanguage` to `SanitizeError`.
  - **Reachable:** `REST/Coverage.cls:304,382` run in a REST worker under the request's language. For a French request today's code gives `ERREUR #5001: ERREUR #5001: ERREUR #5002: …`. With only `SanitizeError` fixed it would still read `ERREUR #5001: ERREUR #5002: …`.
  - **Falsifiable:** M15's mutation, which restores the marker over a read in the requested language, turns 12 language rows red.
  - Resolving DW-622 with a known open occurrence would be a false `resolved-by`.
  - Alternative: leave it, and the lead appends `occurrence=` and routes the residual to a named Epic 42 story.
- **D4 (#47). Orchestrator decision needed: fix the dead LF→space step in the same method?** Recommended: include it. It is two lines moved in the method this story rewrites; the method's own comments promise it; and it is pinned by M6/M7. The cost is that combined and embedded texts gain a space. The grep found no test that pins the run-together text. Alternative: a `deferred:` LOW.
- **D5 (#48). Orchestrator decision needed: the live HTTP check (Rule #26, #48).** Recommended: drive M17's read-only refusal route with `curl` and the four `Accept-Language` headers, before the deploy (implement stage, expecting a doubled fr/de/ja prefix) and after it (implement record plus lead smoke).
  - It changes no instance or NLS setting. The header sets only that request's CSP language, as every client request does (this suite sends `en-US` on every request, and Node's default `*` made workers render Arabic until Story 35.3).
  - Alternative: no HTTP leg. The OS rows alone then cover AC 41.8.8's property, and the outermost surface stays unobserved.
- **D6 (#49). Orchestrator decision needed: the now-false comment in `CleanStatusText` (`Loader.cls:212-217`).** Recommended: rewrite the comment only, and keep the Arabic-only normalization.
  - A generic word there would rewrite legitimate text such as `Value <x> invalid` into `ERROR <x> invalid`.
  - Diagram text is never re-wrapped, so it never doubles.
  - With the per-request header, each request renders one language consistently.
- **D7 (#50). Orchestrator decision needed: the changeset and the docs.** Recommended:
  - `"@iris-mcp/shared": patch`, the only package whose shipped file (the embed) changes; precedent 40.5.
  - A CHANGELOG section plus `story-41-8-doc-claims.test.ts`.
  - No README change, because the `IRIS_ACCEPT_LANGUAGE` row stays true.
  - The counts paragraph says: no tool, action, key, preset row, prompt, refusal code, environment variable or route changes; tools 110/115; the 12 prompts byte-identical (16 hashes); baseline `1e62c5ad5bf7`/141; pack 23 files; 35 bootstrapped classes; and the move sentence, naming `Utils.cls`, `Coverage/Job.cls` and `Diagram/Loader.cls`.

**AC interpretations (apply and report):**
- "A short word, then ` #`, digits and `: `" is read as D2's exact bounds.
- "One pinned case per locale the instance has" is read as the 15 `%ObjectErrors` system tables. `en`, `en-us` and `es` share `ERROR`, and each is still its own row.
- **Rule #34 residual:** the tables are system-wide (`GetLanguages(…, "s")`), so a second namespace would not differ.

## Verification

- Run every command from `/Users/jbrandt/git/iris-execute-mcp-v2`, in the foreground, with `timeout: 600000`, one package or one OS class per call. No `pnpm turbo` parallel run (`35-1-DEV-1`).
- Every IRIS MCP call names `server:"default"` and `namespace:"HSCUSTOM"`. The `@iris-mcp/all` runs use `IRIS_HOST=127.0.0.1 IRIS_PORT=1` (DW-627).
- `CURL` is `curl -s -u _SYSTEM:SYS -H 'Accept-Language: <h>' 'http://localhost:52773/api/executemcp/v2/global'`.

**Shared surfaces:**
- `BOOTSTRAP_VERSION` (the embed), and the CHANGELOG's newest move and first section;
- the text `SanitizeError` returns for combined and embedded statuses (D4);
- the new optional arguments of `SanitizeError` and `SafeText`.

Tool, preset, prompt, refusal and baseline counts, the tools-list snapshot, the pack, and `gen:skills` are unchanged.

**Standing criterion:** every test added or changed passes on a fresh environment, in either order.
- **Disposable fixtures:** none. Statuses are built in memory, and no global is written.
- **OS test classes** run one class per `iris_execute_tests` call, and `total` is compared with the `Test*` count (Rule #35).
- **A residual (DW-508):** a second session's MCP server started from an older build can redeploy older classes. If OS results look like the old code, re-run the `iris_doc_load` step first.

**Commands:**
- `(once, first)` For `<h>` = `fr`, `de`, `ja` and `en-US,en;q=0.9`, run `CURL` before deploying -- expected: record each `status.errors` text. fr, de and ja show the doubled prefix (the before leg, D5).
  - **Before leg, recorded by the implement-stage lead, 2026-10-19, against the classes deployed at HEAD `30f596f` (HTTP 200 each; `errors[0].error`):**
    - `fr`: `ERREUR #5001: ERREUR #5001: Required parameter 'global' is missing or empty`
    - `de`: `FEHLER #5001: FEHLER #5001: Required parameter 'global' is missing or empty`
    - `ja`: `エラー #5001: エラー #5001: Required parameter 'global' is missing or empty`
    - `en-US,en;q=0.9`: `ERROR #5001: Required parameter 'global' is missing or empty`
  - The doubled prefix is observed for fr, de and ja; en-US shows a single prefix. `summary` repeats the `error` text; `params[0]` already carries one prefix only (the HTML-escaped inner status).
  - **After leg, recorded by the implement stage, 2026-10-19, against the clean classes deployed from this working tree (HTTP 200 each; `errors[0].error`; read-only `GET`, no credentials printed). Taken twice with identical text: after the first deploy, and again after the last mutation was reverted and the clean classes were redeployed.**
    - `fr`: `ERREUR #5001: Required parameter 'global' is missing or empty`
    - `de`: `FEHLER #5001: Required parameter 'global' is missing or empty`
    - `ja`: `エラー #5001: Required parameter 'global' is missing or empty` (the first characters printed as `エラー`)
    - `en-US,en;q=0.9`: `ERROR #5001: Required parameter 'global' is missing or empty`
  - **Contrast (AC 41.8.8):** fr, de and ja go from a doubled prefix to exactly one; en-US is one prefix before and after.
- `(loop)` `iris_doc_load` with `compile:true` on each glob: `/Users/jbrandt/git/iris-execute-mcp-v2/src/**/Utils.cls`, `/Users/jbrandt/git/iris-execute-mcp-v2/src/**/Coverage/Job.cls`, `/Users/jbrandt/git/iris-execute-mcp-v2/src/**/Diagram/Loader.cls` and `/Users/jbrandt/git/iris-execute-mcp-v2/src/**/Tests/SanitizeErrorLocaleTest.cls` -- expected: clean compile.
- `(loop)` `iris_execute_tests` with `level:"class"`, one call each, in sequence: `ExecuteMCPv2.Tests.SanitizeErrorLocaleTest` (its `Test*` count), `UtilsTest` (30), `CommandTest` (18), `ClassMethodEdgeTest` (11), `BaseTest` (7), `CoverageJobTest` (31), `DiagramLoaderTest` (11) -- expected: the totals match and 0 tests fail.
- `(loop)` `pnpm gen:bootstrap`, twice -- expected: the first prints the new `BOOTSTRAP_VERSION` and the second prints `Unchanged`. Then `pnpm --filter @iris-mcp/shared build` and `pnpm --filter @iris-mcp/shared exec vitest run src/__tests__/bootstrap.test.ts` -- expected: pass.
- `(loop)` `IRIS_HOST=127.0.0.1 IRIS_PORT=1 pnpm --filter @iris-mcp/all exec vitest run src/__tests__/changelog-bootstrap-move.test.ts src/__tests__/story-41-8-doc-claims.test.ts src/__tests__/story-40-5-doc-claims.test.ts src/__tests__/story-41-2-doc-claims.test.ts` -- expected: pass.
- `(loop)` `pnpm --filter @iris-mcp/dev exec vitest run src/__tests__/test-production-guard.test.ts` -- expected: pass.
- `(once)` For shared, dev, admin, interop, ops, data and client-config, one call each for `build`, `test`, `lint` and `type-check` (`pnpm --filter @iris-mcp/<pkg> <task>`) -- expected: green.
- `(once)` `IRIS_HOST=127.0.0.1 IRIS_PORT=1 pnpm --filter @iris-mcp/all exec vitest run $(ls src/__tests__/*.test.ts | awk 'NR%3==k')` for k = 0, 1 and 2, three calls -- expected: green, with no new failures.
- `(once)` One call each: `pnpm gen:governance-baseline:check` (`1e62c5ad5bf7`/141), `pnpm gen:tools-list-snapshot:check`, `pnpm gen:pack:check` (23), `pnpm gen:skills:check` (13), `pnpm validate:prompts` and `node scripts/check-epics-sync.mjs` -- expected: OK and unchanged.
- `(once, last)` Run `CURL` after deploying, for the same four headers -- expected: exactly one prefix each (M17). Then `iris_doc_list` (HSCUSTOM, CLS and RTN, `filter:"Probe418"`, generated included) -- expected: `[]`.

**Mutations (Rule 19).** Apply each one, observe red, revert, and confirm `git status --short` and `git diff --stat` are unchanged. Record each as `mutation: <change> → <red test>`.
- **AC .1:** restore the two-word loop. Expected red: the M1 rows for de, es-cl, fr, it, ja, ko, nl, pt-br, ru, uk and zh-cn.
- **AC .2:** drop the `$ZStrip` word check. Expected red: the M14 rows `<UNDEFINED> #5001: x`, `see ERROR #5001: here` and ` ERROR #5001: x`.
- **AC .3:** make the empty-language branch call `GetErrorText(pStatus, "fr")`, or another language than the test job's session language. Expected red: the M8 `<UNDEFINED>` row.
- **AC .4:** restore `SafeText`'s English marker over `GetErrorText(<sanitized>, pLanguage)`. Expected red: the M15 rows except en, en-us and es.
- **AC .5:** move the `$Replace` lines back below `$ZStrip`. Expected red: M6 and M7.
- **AC .6:** change one code point in `PinnedWord("uk")`. Expected red: the live-equality row.
- **AC .7:** change one byte of `Utils.cls` without regenerating. Expected red: the `bootstrap.test.ts` drift test. Also change the CHANGELOG `to` hash. Expected red: `changelog-bootstrap-move` and `story-41-8-doc-claims`.
- **AC .8:** the before leg (doubled) against the after leg (single) is its contrast.
- **AC .9:** pinned by the existing gates, whose red proofs belong to their own stories.

**Mutation record (implement stage, 2026-10-19).** Each mutation was applied to the file, deployed (OS rows) or run on the built path (TS rows), observed red, reverted by editing the file back, and the working tree was byte-identical afterwards (`git diff -- src | shasum -a 256` `93bbe46ca3c6...`, `Utils.cls` `735727608269...`, `Job.cls` `ee85c14554b6...`, the test class `35b46442b6c9...`; the CHANGELOG `1d3b0de8a6f8...`; the skill `fc3bdd1602d1...`). After the OS mutations the clean classes were redeployed and `iris_doc_export` of the four classes was identical to the local files.
- mutation: AC .1, restored the two-word loop in `SanitizeError` in place of the `StripErrorPrefix` call (the Arabic word as `$Char(1582,1591,1571)`) → `SanitizeErrorLocaleTest` 5 of 9 passed; the M1, M2 and M10 rows of `TestEveryLanguageKeepsExactlyOnePrefix` were red for exactly de, es-cl, fr, it, ja, ko, nl, pt-br, ru, uk and zh-cn (ar, en, en-us and es stayed green), and the same eleven in `TestCombinedAndEmbeddedStatusesJoinWithASpace`, `TestLookAlikesTokensAndBracketCodesAreKept` and `TestSafeTextKeepsItsCodeInEveryLanguage`.
- mutation: AC .2, dropped the `$ZStrip(tWord, "*PCWN") '= tWord` clause from `StripErrorPrefix` → `TestStripErrorPrefixKeepsEveryLookAlike` red on `see ERROR #5001: here`, ` ERROR #5001: x` and `<UNDEFINED> #5001: x` (and on `ERR-OR #5001: x`, `ERROR1 #5001: x` and `ERROR  #5001: x`); the other 8 methods stayed green.
- mutation: AC .3, made the empty-language branch call `GetErrorText(pStatus, "fr")` → `TestOneArgumentCallReadsTheSessionLanguage` red on "M8 the one-argument call equals the call that names the session language (en-us)", the `<UNDEFINED>` row; the plain-message row stayed green.
- mutation: AC .4, restored `SafeText`'s English `ERROR #5001: ` marker over `GetErrorText(<sanitized>, pLanguage)` → `TestSafeTextKeepsItsCodeInEveryLanguage` red for ar, de, es-cl, fr, it, ja, ko, nl, pt-br, ru, uk and zh-cn (12 rows; en, en-us and es stayed green).
- mutation: AC .5, moved the CR and LF `$Replace` lines back below `$ZStrip(..., "*C")` → `TestCombinedAndEmbeddedStatusesJoinWithASpace` red on the M6 and M7 rows of all 15 languages; the other 8 methods stayed green.
- mutation: AC .6, changed the first code point of `PinnedWord("uk")` from 1055 to 1056 → `TestPinnedLanguagesAndRenderingsMatchTheInstance` red on "the live rendering in uk equals its pin" (the uk rows of `TestEveryLanguageKeepsExactlyOnePrefix` and `TestCombinedAndEmbeddedStatusesJoinWithASpace` went red too).
- mutation: AC .7, changed one byte of `Utils.cls` (`characters` to `characterz` in a comment) without running `gen:bootstrap` → `bootstrap.test.ts` red on the embed-versus-disk drift test for Utils and on "BOOTSTRAP_VERSION matches SHA-256 hash of concatenated disk contents" (2 of 47); and changed the CHANGELOG `to` hash `d51856f74d6a` to `d51856f74d6b` → `changelog-bootstrap-move.test.ts` and `story-41-8-doc-claims.test.ts` ("states the counts that do not move and the bootstrap move as literals") red.
- mutation: AC .8, none beyond the contrast: the before leg (doubled fr, de, ja) against the after leg (one prefix) is the red/green pair, taken on the real HTTP route.
- mutation: AC .9, none: the counts are pinned by the existing gates (all green, below).
- mutation: AC .10, changed `6219` to `6218` in the skill source only, with no `gen:pack` → `skills-pack-knowledge.test.ts` red on the error-handling skill's sha256, "pack copy equal to the source" and "carries every probe anchor" rows (3 of 119), and `pnpm gen:pack:check` exited 1.

**Mutation record (review pass, 2026-10-19; the two rows added to the AC .2 pinning method).** Applied to the file, deployed to HSCUSTOM, run, reverted by editing back (`Utils.cls` `shasum` `2578e0c4b03f...` before and after), then redeployed clean.
- mutation: AC .2, changed `If $Length(tHead, " #") '= 2 Quit pText` to `< 2` in `StripErrorPrefix` → `TestStripErrorPrefixKeepsEveryLookAlike` red on "M14 unchanged: ERROR #5001 #7: x" (8 of 9 passed).
- mutation: AC .2, dropped the `($Length(tWord) < 1) ||` clause from `StripErrorPrefix` → `TestStripErrorPrefixKeepsEveryLookAlike` red on "M14 unchanged:  #5001: x" (8 of 9 passed).
- mutation: review patch, held `.changeset/story-41-8-epic-41-burn-down.md` aside (moved out and back, `shasum` `0018755ddb07...` before and after) → `story-41-8-doc-claims.test.ts` 8 passed and 1 skipped instead of an `ENOENT` failure at collection.

**Implement-stage results (2026-10-19).**
- **Probe (decision #51 and the pins).** Disposable `ExecuteMCPv2.Temp.Probe418D` (HSCUSTOM, IRIS 2026.2 Build 221U), deleted; `iris_doc_list` with `filter:"Probe418"`, `generated:true`, for CLS and for RTN returned `[]` at the start and the end. Session language `en-us`. `GetLanguages("%ObjectErrors","s")` and `("%Utility","s")` both returned `ar,de,en,en-us,es,es-cl,fr,it,ja,ko,nl,pt-br,ru,uk,zh-cn`, and the 15 renderings of `ERROR #5001: disk full` matched the matrix table, code point for code point. `GetErrorText("")` and `GetErrorText(0)` both returned `ERROR #00: (no error description)`, `GetErrorCodes` returned `6219` for both, `$$$ISOK("")` and `$$$ISOK(0)` are both 0, and `GetErrorText("", "fr")` returned `ERREUR #00: (pas de description d'erreur)`.
- **OS classes (one per call, `total` against the `Test*` count).** `SanitizeErrorLocaleTest` 9 of 9 (9 `Test*`); `UtilsTest` 30 of 30; `CommandTest` 18 of 18; `ClassMethodEdgeTest` 11 of 11; `CoverageJobTest` 31 of 31; `DiagramLoaderTest` 11 of 11; `BaseTest` 6 of 7 passed, total 7, 1 failed: `TestAllSixteenHandlersExtendBase` (the pre-existing stale handler count in frontmatter `deferred:` item 2; no `REST/*` class is touched here).
- **Bootstrap.** `BOOTSTRAP_VERSION` `5296a1c836f4` to `d51856f74d6a`; the second `pnpm gen:bootstrap` printed `Unchanged ... (not rewritten)`; shared rebuilt; `bootstrap.test.ts` 47 of 47.
- **Skill.** `iris-mcp-objectscript-error-handling/SKILL.md`: sha256 `779cd9829c4f...` to `fc3bdd1602d1...`; 6749 to 7045 bytes; 82 to 83 lines; frontmatter byte-unchanged; the probe anchors 27 to 29 (total 170 to 172); `gen:pack` regenerated 23 files, of which the skill's pack copy is the only one that changed; `gen:pack:check`, `validate:prompts` (52 sources) and `check:provenance` (12 distributions) green.
- **TS gates.** For shared, dev, admin, interop, ops, data and client-config: `build`, `test`, `lint` and `type-check` all green (shared lint prints one pre-existing warning in `cli/governance.ts`); `@iris-mcp/all` in three shards: 42, 43 and 42 files (127) all green, with the unarmed live gates skipped; `changelog-bootstrap-move`, `story-41-8-doc-claims`, `story-40-5-doc-claims`, `story-41-2-doc-claims` and the dev `test-production-guard` green; `gen:governance-baseline:check` OK (141 frozen keys), `gen:tools-list-snapshot:check` OK (115 entries), `gen:skills:check` OK (13), `check-epics-sync` OK.

## Auto Run Result

Status: done
Blocking condition: none

**Summary of the implemented change.**
- `Utils.cls`: new `StripErrorPrefix` (the D2 shape rule) replaces the two-word loop in `SanitizeError`, which gains an optional `pLanguage` (empty keeps the one-argument `GetErrorText(pStatus)` call). The CR and LF replacement now runs before the control-character strip, so a combined or embedded status reads with a space (D4).
- `Coverage/Job.cls`: `SafeText` gains `pLanguage` and returns the leading code plus `GetOneStatusText(<sanitized>, 1)`.
- `Diagram/Loader.cls`: comment only.
- The error-handling knowledge skill states the empty or `0` status edge (`ERROR #00: (no error description)`, `GetErrorCodes` 6219), regenerated by `gen:pack`; `skills-pack-knowledge.test.ts` moves its sha256 and gains two anchors.
- `BOOTSTRAP_VERSION` `5296a1c836f4` to `d51856f74d6a`; the second `gen:bootstrap` printed `Unchanged`.
- Live: `GET /global` with `Accept-Language` fr, de and ja went from a doubled prefix to one; `en-US,en;q=0.9` is one prefix before and after (Verification records).

**Files changed.**
- `src/ExecuteMCPv2/Utils.cls`: `StripErrorPrefix`, `SanitizeError(pStatus, pLanguage)`, D4 order.
- `src/ExecuteMCPv2/Coverage/Job.cls`: `SafeText(pText, pLanguage)`.
- `src/ExecuteMCPv2/Diagram/Loader.cls`: `CleanStatusText` comment.
- `src/ExecuteMCPv2/Tests/SanitizeErrorLocaleTest.cls`: new, 9 `Test*` methods, 15 pinned languages.
- `skills-pack-src/knowledge/iris-mcp-objectscript-error-handling/SKILL.md` and `packages/client-config/skills-pack/skills/iris-mcp-objectscript-error-handling/SKILL.md`: the edge sentence (source and generated copy).
- `packages/iris-mcp-all/src/__tests__/skills-pack-knowledge.test.ts`: the skill's sha256 and anchors.
- `packages/shared/src/bootstrap-classes.ts`: regenerated embed.
- `CHANGELOG.md`, `.changeset/story-41-8-epic-41-burn-down.md`, `packages/iris-mcp-all/src/__tests__/story-41-8-doc-claims.test.ts`: the docs and their pins.

**Review findings.** 25 findings from four layers (Blind Hunter, Edge Case Hunter, Verification Gap, Intent Auditor): high 0, medium 13, low 10, false 2.
- **Patches applied (grouped, 4 medium entries and 1 low):**
  - The changeset now also bumps `@iris-mcp/client-config` (the shipped skill copy lives there); the summary and the doc-claims bump map follow. This amends D7's "shared only" premise, which decision #51 overtook (Spec Change Log).
  - Two M14 rows (an empty word, two ` #` in the head) were added, with two recorded mutations.
  - The CHANGELOG's "every case was shown red" sentence now names what was mutated.
  - `story-41-8-doc-claims.test.ts` guards the consumed changeset (`it.skipIf`), as `story-41-2-doc-claims.test.ts` does.
  - Two CHANGELOG sentences were corrected (`Unknown status code`; "a look-alike that is part of the message"), and Known limits gained two bullets (stale language docs; the manual-only Accept-Language check).
- **Deferred (frontmatter `deferred:`, 4 items):**
  - The `IRIS_ACCEPT_LANGUAGE` docs in `README.md` and `http-client.ts` (low, the plan-stage item, unchanged).
  - `BaseTest:TestAllSixteenHandlersExtendBase` pins 16 handlers against 19 (low, pre-existing, red at HEAD).
  - `tool_support.md:21` calls the `Utils` prefix stripping "unmodified" (low, same root cause as the first item).
  - No re-runnable automated check of the one-argument path under a non-English request language (medium; fix shape an env-armed live gate).
- **Rejected:** 10 (8 low, 2 false), each with its reason in the Review Triage Log.

**Follow-up review recommendation:** `true`. Four medium entries were patched after the review layers ran, so no layer has re-read these files: `story-41-8-doc-claims.test.ts` (the `skipIf` guard, the two-entry bump map, the spread of the guarded changeset entry), `.changeset/story-41-8-epic-41-burn-down.md` and the reworded `CHANGELOG.md` sentences. Each ran green (`story-41-8-doc-claims` 10 tests, `changelog-bootstrap-move`, the three `@iris-mcp/all` shards), but they were not re-reviewed. Patched counts by verdict: high 0, medium 4 entries (7 findings), low 1.

**Verification performed (all foreground, after the last patch).**
- The four classes deployed with `iris_doc_load` (clean compile, the clean `Utils.cls` redeployed after the mutations); OS classes one per call: `SanitizeErrorLocaleTest` 9/9 (twice), `UtilsTest` 30/30 (twice), `CommandTest` 18/18, `ClassMethodEdgeTest` 11/11, `CoverageJobTest` 31/31, `DiagramLoaderTest` 11/11, `BaseTest` 6/7 (the deferred pre-existing failure).
- `gen:bootstrap` twice (Unchanged both), `@iris-mcp/shared` build and `bootstrap.test.ts` 47/47.
- `build`, `test`, `lint` and `type-check` green for shared (2072 tests), dev (1663), admin (498), interop (672), ops (350), data (165) and client-config (1008).
- `@iris-mcp/all` in three shards (127 files) green with `IRIS_HOST=127.0.0.1 IRIS_PORT=1`; `test-production-guard` 26/26.
- `gen:governance-baseline:check` OK (141 frozen keys; the baseline file untouched), `gen:tools-list-snapshot:check` OK (115), `gen:pack:check` OK (23), `gen:skills:check` OK (13), `validate:prompts` OK, `check:provenance` OK, `check-epics-sync` OK.
- Live HTTP before and after recorded under Verification (AC 41.8.8); `iris_doc_list` for `Probe418` and for `ExecuteMCPv2.Temp` (CLS, RTN, generated included) returned `[]`.

**Residual risks.**
- `BaseTest` stays red until its handler pin moves from 16 to 19 (a docs-free, test-only change outside this story's allowed writes); the Verification line "BaseTest (7), 0 fail" cannot be met until then.
- The one-argument path under a non-English request language is observed only by the recorded manual `curl` (deferred, medium).
- The `IRIS_ACCEPT_LANGUAGE` text in `README.md`, `tool_support.md` and `http-client.ts` is stale (deferred, low).
- The changeset bump map differs from D7 as recorded (client-config added); the packages are one fixed group.
