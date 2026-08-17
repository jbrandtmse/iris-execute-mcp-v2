# Story 34.8: Request-Body UTF-8 Decoding

Status: done

<!-- Created 2026-08-16. Epic 34 re-opened a fifth time (Rule SC-5) on Project Lead escalation of 34-6-CR-7 before the first npm publish. -->

## Story

As a **caller sending non-ASCII data through any IRIS MCP tool**,
I want **my request body decoded correctly**,
so that **accented, CJK and emoji content is not silently corrupted at rest with an HTTP 200 and no error.**

## The defect — live-verified, pre-existing across every epic

`ExecuteMCPv2.Utils.ReadRequestBody` ([src/ExecuteMCPv2/Utils.cls:868-894](src/ExecuteMCPv2/Utils.cls#L868-L894)) reads the POST body via `%request.GetMimeData("BODY")` and hands the stream straight to `%DynamicObject.%FromJSON()`, where UTF-8 is interpreted as Latin-1.

Measured live:
- `é` (U+00E9) arrives as **2** characters, code points `[195,169]`
- `世界` arrives as **6** code points `[228,184,150,231,149,140]`
- `😀` arrives as **4** code points `[240,159,152,128]`

In every case, the raw UTF-8 bytes. Server-**originated** Unicode round-trips OUT correctly (control: `TargetWriteMetachars` returns `héllo-世界-😀` intact), so the defect is **strictly on the input path**.

The Project Lead reproduced it end-to-end through the MCP tool on 2026-08-16: sending `Write "héllo-世界-😀-"` returned `hÃ©llo-ä¸ç-ð`.

It affects `iris_execute_command`'s `command`, `iris_execute_classmethod`'s `args`, and `iris_global_set`'s `value` — so **non-ASCII data is written to globals corrupted**, silently, with HTTP 200. One central fix covers all **14** handler classes / **46** call sites (both counts mechanically derived, Rule #51).

## Acceptance Criteria

- **AC 34.8.1** — **PROBE FIRST** (Rules #14/#16). Before changing anything, pin **live** the correct decode mechanism for this `%CSP.REST` context: what `%request.GetMimeData("BODY")` actually returns here (class and encoding), whether `%request.CharSet` or the Content-Type charset is honoured, and which of `$ZCONVERT(...,"I","UTF8")`, a stream `TranslateTable`, or a character-stream copy is correct. **Record the exact working shape and the shapes that did NOT work, with their errors.** Delete probe classes before commit and verify deletion live.
- **AC 34.8.2** — the fix is **central** in `ReadRequestBody` (one change, all 14 handlers). Non-ASCII request-body content round-trips correctly for BMP accented, CJK, and astral/surrogate-pair input.
- **AC 34.8.3** — **chunk-boundary safety.** If the implementation reads the stream in pieces, a multi-byte UTF-8 sequence straddling a chunk boundary MUST NOT corrupt. Prove it with a fixture that deliberately places a multi-byte character across the boundary. **A naive per-chunk `$ZCONVERT` is the obvious wrong answer** — it decodes each fragment independently and mangles anything spanning the seam.
- **AC 34.8.4** — **large-body safety.** A body large enough to exceed the long-string ceiling must not `<MAXSTRING>`. Determine and pin the behaviour. **Do not trade a silent corruption for a silent failure** — that is the same defect class this epic has fought repeatedly.
- **AC 34.8.5** — Rule #19: the currently-working **ASCII path is byte-identical**. Proven mechanically, not by inspection — the ledger explicitly flags "risk of breaking the currently-working ASCII path" as the main hazard of this fix.
- **AC 34.8.6** — Rule #58 fixture diversity, submitted **THROUGH the request body** (not server-originated literals): accented BMP, CJK, astral/emoji, mixed ASCII+non-ASCII, non-ASCII in a JSON **key** as well as a value, and non-ASCII inside a `{byRef, value}` marker. Round-trip verified end-to-end through the deployed route.
- **AC 34.8.7** — the "Known Limitations" sections added in Story 34.7 for this defect are **UPDATED** in root `README.md` and `packages/iris-dev-mcp/README.md`. State explicitly that the fix is **forward-only**: data already written corrupted is **NOT** repaired.
- **AC 34.8.8** — Rule #48 mutation evidence (revert → red → restore byte-identically). Gates: `pnpm turbo run build test lint type-check` green; `gen:governance-baseline:check` (`:check` ONLY) exit 0 at frozen `1e62c5ad5bf7`/141/201/60; tool counts unmoved (#31); BOOTSTRAP_VERSION from→to recorded (#24; current `06b326631504`) and Constraint C-2 re-verified.

## Tasks / Subtasks

- [x] **Task 1 — Live probe** (AC: 34.8.1)
  - [x] Determine the actual class/encoding of `%request.GetMimeData("BODY")` in this handler context.
  - [x] Determine whether `%request.CharSet` / Content-Type charset is honoured, and what the TS client actually sends.
  - [x] Test candidate mechanisms; record the working shape verbatim and the failures with their errors.
- [x] **Task 2 — Central fix** (AC: 34.8.2, 34.8.3, 34.8.4)
- [x] **Task 3 — Back-compat proof** (AC: 34.8.5)
- [x] **Task 4 — Fixture-diverse round-trip tests** (AC: 34.8.6)
- [x] **Task 5 — Docs update** (AC: 34.8.7)
- [x] **Task 6 — Gates + mutation evidence** (AC: 34.8.8)

### Review Findings (code review, 2026-08-17)

Close kind **NORMAL** — all three adversarial layers (Blind Hunter, Edge Case Hunter, Acceptance Auditor) delivered explicit findings payloads inside the 20-minute bounded-close window against a frozen diff snapshot (Rule #57); `failed_layers` empty, review **NOT degraded**. 15 patches applied in-pass, 7 items deferred to the ledger, 1 dismissed.

**Verdict on the implementation: correct.** Reviewer-independent live evidence (HSCUSTOM, disposable `ExecuteMCPv2.Temp.Rv348Probe`, deleted and verified absent from server and disk): `SanitizeUnpairedSurrogates` is right on all 9 adversarial shapes including the exact boundary code units 55295/56319/57343/57344; a genuine astral emoji provably survives untouched; `DecodeUtf8Stream` decoded 4,500,000 and 11,250,000 raw bytes to EXACTLY the mechanically-computed expected size with an intact tail; the sanitizer measures LINEAR (100k/200k/400k consecutive unpaired surrogates in 0.018/0.035/0.094s). **Both HIGH findings were about the SAFETY NET, not the fix** — the fix itself held up under every attack.

Patches applied (all fixed and re-verified):

- [x] [Review][Patch] **HIGH — `TestDecodeUtf8StreamLargeBodyNoMaxString` could not detect the silent truncation AC 34.8.4 exists to prevent** [src/ExecuteMCPv2/Tests/Utf8DecodeTest.cls:206] — proven live: a decode regressed to a single `.Read(stream.Size)` satisfied all three original assertions (no throw, object returned, correct FIRST slice) while silently losing **801,596 characters**. Added a mechanically-derived total-size assertion plus a sequential rolling tail check; mutation-verified (both new assertions go RED on that exact regression, all others stay green), and kept fast (443ms — an initial `MoveTo()`-based tail check measured 26s and was replaced).
- [x] [Review][Patch] **HIGH — the publish gate never armed this story's only end-to-end proof** [packages/iris-dev-mcp/scripts/prepublish-gate.mjs:56] — `vitestArgs` hard-coded only `execute-classmethod-epic-gate.test.ts`, so `request-body-utf8-decode.test.ts` never received `IRIS_REQUIRE_LIVE=1` and would silently `ctx.skip()` on any machine where IRIS is unreachable or fixtures are absent, letting a publish ship this fix unexecuted (same class as ledger `34-4-R3` / AC 34.6.3). Replaced with a named `gateTestFiles` roster. Mutation-verified: gate now runs 2 files / 28 tests and exits 0 live; the new file alone with `IRIS_REQUIRE_LIVE=1` against a bogus host FAILS CLOSED (1 failed), while without it the same run reports "1 passed, 12 skipped" — exactly the hazard now closed.
- [x] [Review][Patch] MEDIUM — CHANGELOG's shipping pre-release section still told users the defect was unfixed [CHANGELOG.md:82] — the `### Documented (not fixed)` heading sat inside the Epic 34 section that ships; rewritten to `### Fixed`, including the forward-only and lenient-decoder caveats.
- [x] [Review][Patch] MEDIUM — Story 34.7's unreleased changeset also still said "documented, not fixed" [.changeset/execute-response-ceiling-and-gate-hardening.md:28] — `changeset version` would have folded that into the same release entry as this fix; marked superseded with a pointer to this story's changeset.
- [x] [Review][Patch] MEDIUM — ledger item `34-6-CR-7` was still `CLOSED-BY-DECISION` ("the underlying defect remains open") while both READMEs now say "resolved by Story 34.8" [_bmad-output/implementation-artifacts/deferred-work.md:2193] — added a terminal **RESOLVED** disposition with the reviewer's own live evidence.
- [x] [Review][Patch] MEDIUM — a file-wide fixture skip masked 8 fixture-independent tests [packages/iris-dev-mcp/src/__tests__/request-body-utf8-decode.test.ts:97] — only 4 of 12 tests need `ClassMethodArgsFixture`, but a missing fixture skipped all 12, so a real `/command` or `/global` decode regression could be masked on a bootstrapped-only instance (fixtures are deliberately outside the bootstrap manifest, Rule #39). Split into `skipReason` (reachability) and `fixtureSkipReason`; `IRIS_REQUIRE_LIVE` still honors both.
- [x] [Review][Patch] MEDIUM — `DecodeUtf8Stream(stream, 0)` was a non-terminating loop [src/ExecuteMCPv2/Utils.cls:944] — the guard was `< 0` while the documented sentinel is `-1`, and `.Read(0)` was live-confirmed to return `""` WITHOUT setting `AtEnd`, so the read loop would spin forever holding a Web Gateway connection. Guard is now `<= 0`; pinned by `TestDecodeUtf8StreamZeroChunkSizeFallsBackAndTerminates` (the pre-existing sweep starts at 1, so 0 was the one value never exercised).
- [x] [Review][Patch] MEDIUM — a discarded stream-write status could silently truncate the decoded body [src/ExecuteMCPv2/Utils.cls:960] — both call sites used a bare `Do tOut.Write(...)`, dropping the `%Status`; a failing write (IRISTEMP full/over quota, `<STORE>`) would let the loop continue and hand `%FromJSON` a silently truncated document — the same failure class AC 34.8.4 forbids, one layer down. Extracted `WriteDecoded`, which throws the real status.
- [x] [Review][Patch] MEDIUM — a decode-stage fault was reported to callers as "Invalid JSON in request body" [src/ExecuteMCPv2/Utils.cls:1112] — the new decode stage runs inside the pre-existing Try whose Catch hard-codes that text, so a server-side read/convert/temp-write fault misdirected operators to debug a payload that was fine, across all 46 call sites. Added a `tStage` discriminator with a distinct message.
- [x] [Review][Patch] MEDIUM — the malformed-input dispositions were documented nowhere user-facing [README.md, packages/iris-dev-mcp/README.md, .changeset/request-body-utf8-decode-fix.md] — the `?` substitution for invalid sequences and the **lenient overlong-encoding decode** existed only in ObjectScript comments. Both READMEs and the changeset now state them, including a **security note**: overlong forms are a classic filter-bypass vector, so any upstream proxy/WAF rule that byte-inspects these bodies for `/`, `.`, or quotes can be bypassed while IRIS still decodes the canonical character — and these endpoints execute arbitrary ObjectScript and write globals.
- [x] [Review][Patch] MEDIUM — the QA write-up claimed a permanent pin that did not exist [this story:195] — "a lone lead byte of every length (2/3/4-byte) at absolute end-of-stream" was probed but never pinned; the only such test remained the dev's 3-byte-only one. Added `TestDecodeUtf8StreamTruncatedTrailingSequenceEveryLeadLength` (all 6 shapes) and corrected the claim in place.
- [x] [Review][Patch] LOW — `IncompleteUtf8TailLength`'s banner stated an incorrect UTF-8 fact [src/ExecuteMCPv2/Utils.cls:1048] — "0xF0-0xFF a 4-byte sequence"; RFC 3629 caps valid 4-byte leads at 0xF4 and 0xF5-0xFF never appear in well-formed UTF-8. The wider classification is deliberate (it holds malformed trailing bytes back rather than splitting them) and is now documented as such, with the live finding that every such sequence decodes to `?` and leaks nothing invalid.
- [x] [Review][Patch] LOW — one `IncompleteUtf8TailLength` branch was unreachable from every fixture [src/ExecuteMCPv2/Tests/Utf8DecodeTest.cls:118] — the `tB2 < 128` arm (ASCII immediately before a trailing continuation byte); two assertions added to `TestIncompleteUtf8TailLengthShortChunkGuards`.
- [x] [Review][Patch] LOW — a hand-authored fixture size was wrong and had been copied into the story [packages/iris-dev-mcp/src/__tests__/request-body-utf8-decode.test.ts:405] — the comment said "~3,900 characters"; `"café-世界-😀-".repeat(300)` is 3,300 UTF-16 units / 5,400 raw bytes. Corrected and now asserted in the test (Rule #51).
- [x] [Review][Patch] LOW — `sprint-status.yaml` recorded the stale dev-only BOOTSTRAP_VERSION [_bmad-output/implementation-artifacts/sprint-status.yaml:2] — it stopped at `0af5e4eb83d4` while the shipped value was `88c834d76dbb`; now records the full chain and names the shipped value.

Deferred to `deferred-work.md` (see "Code review on Story 34.8" — full rationale and suggested resolution per item):

- [x] [Review][Defer] MEDIUM `34-8-CR-1` — the decode never consults `%request.CharSet`, so a client declaring `charset=ISO-8859-1` with a genuinely Latin-1 body regresses (it decoded correctly pre-fix). Unreachable for every client in this suite (`CharSet` is empty on all real calls); implementing charset negotiation at a release gate was judged riskier than the narrow gap it closes.
- [x] [Review][Defer] MEDIUM `34-8-CR-2` — no end-to-end test crosses the production 1,000,000-byte chunk boundary (largest HTTP fixture is 5,400 raw bytes). The reviewer verified the property live at 4,500,000 and 11,250,000 bytes, so what is missing is a permanent pin, not the behavior.
- [x] [Review][Defer] LOW `34-8-CR-3` — the `GetMimeData("BODY")` branch is decoded unconditionally although probed unreachable, and a multipart part's own `CharSet` is ignored (double-decode risk if it ever goes live) — Rule #54.
- [x] [Review][Defer] LOW `34-8-CR-4` — a CESU-8 surrogate PAIR decodes chunk-alignment-dependently (live: `??` at chunk 3, 😀 at chunk 6 and at 1,000,000). Malformed input only; both outputs are valid UTF-8.
- [x] [Review][Defer] LOW `34-8-CR-5` — the body is now materialized a second time in IRISTEMP with no size guard (inherent to the design; measured cost modest).
- [x] [Review][Defer] LOW `34-8-CR-6` — the invalid-output candidate set is closed by example rather than stated exhaustive (Rule #56). Probed clean: `F5` lead, `F8` 5-byte-style lead, bare `FF`, `F4 90 80 80`, and `ED BF BF` all decode to `?` and leak no surrogate.
- [x] [Review][Defer] LOW `34-8-CR-7` — `cycle-log-epic-34.md:90` carries the impossible timestamp `2026-08-16T25:00:00Z` in a machine-parsed TSV. Left to the Project Lead: this review was instructed not to write cycle-log entries.

Dismissed (1): the Blind Hunter's and Edge Case Hunter's shared concern that `SanitizeUnpairedSurrogates` could degrade to quadratic on many consecutive unpaired surrogates — measured live at 100k/200k/400k surrogates (0.018s / 0.035s / 0.094s), i.e. linear; quadratic would have cost ~16x at 4x input. The banner's claim is empirically supported.

**Gates re-verified after all patches:** `pnpm turbo run build test lint type-check` **29/29**; `ExecuteMCPv2.Tests` **388/388** (0 failed, 0 skipped) against a mechanical `Test*` count of exactly **388** (Rule #35 — 386 + 2 review-added); `@iris-mcp/dev` **665/665** across 39 files; `@iris-mcp/all` **120/120** across 18 files (Rule #31, tool counts unmoved); `Utf8DecodeTest` **35/35**; `gen:governance-baseline:check` (`:check` ONLY) exit 0 at frozen `1e62c5ad5bf7` / 141 / 201 / 60; Constraint C-2 exactly ONE `ExecuteMCPv2.REST.Command.1.int`; Rule #24 bootstrap regenerated for the review's `Utils.cls` changes — **BOOTSTRAP_VERSION `88c834d76dbb` → `01dc15bb27df`**, byte-identical on an immediate second regen (idempotent), 29 classes, `REST/Dispatch.cls` still last; live server confirmed byte-identical to disk by SHA-256 (files read as UTF-8 explicitly, avoiding the PowerShell ANSI artifact QA hit).

## Dev Notes

### Current implementation — the whole of it

```objectscript
ClassMethod ReadRequestBody(Output pBody As %DynamicObject) As %Status
{
    Set tSC = $$$OK
    Set pBody = ""
    Try {
        Set tStream = %request.GetMimeData("BODY")
        If '$IsObject(tStream) {
            Try { Set tStream = %request.Content } Catch { Set tStream = "" }
        }
        If '$IsObject($Get(tStream)) Quit
        Do tStream.Rewind()
        If 'tStream.Size Quit
        Set pBody = ##class(%DynamicObject).%FromJSON(tStream)
    } Catch ex {
        Set tSC = $$$ERROR($$$GeneralError, "Invalid JSON in request body: "_ex.DisplayString())
    }
    Quit tSC
}
```

The `%FromJSON(tStream)` call is where UTF-8 bytes become Latin-1 characters. **Do not guess the fix** — AC 34.8.1 exists because this is exactly the kind of IRIS-idiosyncratic behaviour that Rules #14/#16 say to probe rather than reason about. Story 34.1 is the model: probe, record the working shape, then code against it.

### The three traps this story is most likely to hit

1. **Chunk-boundary splitting (AC 34.8.3).** Reading the stream in fixed-size pieces and `$ZCONVERT`-ing each piece independently corrupts any multi-byte sequence spanning the seam. This will look correct for ASCII and for short non-ASCII test strings, and fail on real payloads — a Rule #58 blindness by construction.
2. **`<MAXSTRING>` on large bodies (AC 34.8.4).** Reading the whole body into one string is the simplest correct decode but caps at the long-string ceiling. This epic has already shipped one crash-as-truncation inversion and one silent partial; do not add a third.
3. **Breaking the ASCII path (AC 34.8.5).** Every currently-working call flows through this method. A double-decode or a wrong TranslateTable turns a working path into a broken one across all 14 handlers at once. Prove byte-identity mechanically.

### Blast radius

This is a **single central method behind every REST handler in the package** — the same shape as Story 34.4's `RenderResponseBody` override, which produced a near-miss that took down every route with an empty HTTP 200. Treat it with the same caution: verify live across multiple handlers, not just `/command`.

### Scope discipline

- Stories 34.0–34.7 stay `done` and are NOT re-touched beyond what these ACs require (Rule #52).
- **Out of scope:** repairing already-corrupted data at rest; the response path (Story 34.7's ceiling work); all other open ledger items.
- No new tool or action (Rule #31). Frozen governance baseline untouched (#23/#25) — `:check` only, never the bare generator.
- **Do NOT publish**, do not run `changeset version`, do not bump versions. Add a changeset describing the fix.

### Constraints

- ObjectScript: argumented `Quit` is **ILLEGAL** inside Try/Catch (ERROR #1043) — note the existing method already uses argumentless `Quit` inside its Try; preserve that discipline. Triple `$$$` macros; no underscores in method/class-parameter names; never touch a `Storage` section; `///` doc comments; indent all commands.
- **Rule #17** — glob-prefixed `iris_doc_load`: `c:/git/iris-execute-mcp-v2/src/**/Utils.cls`.
- **Rule #7** — if any render path is touched: full I/O restore before render, exactly ONE `RenderResponseBody`, namespace restored before render.
- **Rule #9** — propagate the real `%Status` text via `SanitizeError`; the existing catch wraps `ex.DisplayString()` — keep error text informative and non-leaking.
- **Rule #55** — never generate file content through a shell heredoc; use the file-editing tools.
- **Rule #51** — mechanical tallies only.
- Restore-after-mutation trap: `iris_doc_compile` alone recompiles the still-mutated **server** copy — re-upload via `iris_doc_load` after restoring a local file, and verify server matches disk.

### Testing

- `%UnitTest` under `ExecuteMCPv2.Tests.*`, plus vitest under `packages/**` (default suite; `packages/iris-dev-mcp/vitest.config.ts` excludes `src/**/*.integration.test.ts`). The end-to-end round-trip pin belongs in the **default** suite.
- Baselines: `ExecuteMCPv2.Tests` 353/353; `@iris-mcp/dev` 653/653 across 38 files; `iris-mcp-all` 120/18; turbo 29/29; epic gate 16/16, 0 skipped.
- **Rule #35** — compare `iris_execute_tests` totals against mechanical `Test*` counts; never trust a zero.
- Live IRIS: 2026.1 Build 235U; `HSCUSTOM` primary, `USER` second.

### References

- [Source: `_bmad-output/implementation-artifacts/deferred-work.md`] — `34-6-CR-7` with the full live measurement and the suggested resolution
- [Source: `src/ExecuteMCPv2/Utils.cls#L868-L894`] — `ReadRequestBody`
- [Source: `_bmad-output/implementation-artifacts/34-1-classmethod-invocation-probe.md`] — the probe-first model for AC 34.8.1
- [Source: `.claude/rules/project-rules.md`] — #7, #9, #14, #16, #17, #19, #24, #25, #31, #35, #51, #52, #54, #55, #58

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References

No `^ClineDebug` global was needed — every probe finding was captured directly in MCP tool call results (`iris_execute_classmethod` return values), which already gave verbatim, structured evidence without needing a separate debug-global capture step.

### Completion Notes List

**AC 34.8.1 — Probe findings (disposable `ExecuteMCPv2.Temp.Utf8Probe`, created and deleted this session — verified absent from both server and disk).** Probed by invoking the probe class THROUGH the real `/classmethod` REST dispatch (`iris_execute_classmethod`), so `%request` reflected an actual live HTTP POST exactly like production traffic — not a synthesized context.

- `%request.GetMimeData("BODY")` is **never populated** for this project's plain `application/json` POSTs (`mimeIsObject=0` on every call) — multipart-only mechanism, dead in practice for this project. Every real call falls through to the `%request.Content` fallback.
- `%request.Content` is a **`%CSP.BinaryStream`** holding the RAW, untranslated request bytes — confirmed byte-for-byte: submitting `café-世界-😀-end` produced raw codes `99,97,102,195,169,45,228,184,150,231,149,140,45,240,159,152,128,45,101,110,100` — exactly the UTF-8 byte encoding of that string, hand-verified against the UTF-8 spec.
- `%request.CharSet` is **empty** (`""`); `%request.ContentType` is `application/json` with **no charset parameter** — confirmed against `packages/shared/src/http-client.ts`, which sets `Content-Type: application/json` unconditionally, never `; charset=utf-8`.
- **Working fix, confirmed live:** `$ZCONVERT(rawBytes, "I", "UTF8")` on the raw byte string reconstructs the original text exactly. This matches `%Library.DynamicAbstractObject.cls`'s OWN documented note on `%FromJSON`: "for streams not containing 16-bit Unicode it may be necessary to explicitly convert... via $ZCONVERT... or entire streams by setting the TranslateTable attribute."
- **Trap 1 (negative result) — `$ZCONVERT` given a stream OREF directly does NOT throw and does NOT decode.** It silently stringifies the OREF itself: observed literal result `"25209@%CSP.BinaryStream"`. Every chunk must be materialized as a `%String` via `.Read()` first.
- **Trap 2 (negative result) — `TranslateTable` is not a usable stream-level fix here.** `%FromJSON`'s own docs suggest "setting the TranslateTable attribute of the stream", but a mechanical dictionary query (`SELECT Parent,Name FROM %Dictionary.PropertyDefinition WHERE Name='TranslateTable' AND Parent %STARTSWITH '%Stream.'`) found only `%Stream.FileCharacter` has that property among `%Stream.*` classes — confirmed live by `%Stream.TmpCharacter.TranslateTable = "UTF8"` throwing `<PROPERTY DOES NOT EXIST>`. Using it would require introducing a temp file; not pursued.
- **Trap 3 (negative result, the load-bearing one for AC 34.8.4) — a single `.Read(stream.Size)` call does not reliably return the full content of a large stream.** On a 49,000,000-byte raw stream, one such call **silently returned only ~3,589,128 characters — no exception of any kind**, never `<MAXSTRING>`. This is the actual justification for the chunked read-loop design, not just defensive style.

**AC 34.8.2 — Central fix.** `ExecuteMCPv2.Utils.ReadRequestBody` (`src/ExecuteMCPv2/Utils.cls`) now routes whichever stream it resolves (the `GetMimeData("BODY")` branch or the `%request.Content` fallback — both, since only the fallback is empirically reachable today but both are documented CSP "raw body" conventions) through a new `DecodeUtf8Stream` method before calling `%FromJSON`. One change, all 14 handler classes / 46 call sites covered transitively.

**AC 34.8.3 — Chunk-boundary safety.** `DecodeUtf8Stream` reads `UTF8CHUNKSIZE` (1,000,000) raw bytes at a time and uses a new `IncompleteUtf8TailLength` helper to detect/hold back 0-3 trailing bytes that are the unfinished start of a multi-byte sequence, prepending them to the next chunk. Live-verified via the probe with a deliberately tiny 16-byte chunk size against `café-世界-😀-end` (2-, 3-, and 4-byte sequences back to back) — output matched a single-shot decode exactly. Pinned permanently in `ExecuteMCPv2.Tests.Utf8DecodeTest` (`TestDecodeUtf8StreamChunkBoundarySafety`, a full chunk-size-1..N sweep in `TestDecodeUtf8StreamChunkBoundarySweep`, and an exact-split-offset case in `TestDecodeUtf8StreamMixedAsciiNonAsciiExactBoundarySplit`).

**AC 34.8.4 — Large-body safety.** Determined and pinned: reading in a `While 'stream.AtEnd` loop and accumulating DECODED output into a `%Stream.TmpCharacter` (never a growing `%String`) avoids both the MAXSTRING risk AND the silent-truncation trap found in probing (Trap 3 above). Live-verified at 49,000,000 raw bytes / 48,300,000 decoded characters with zero exceptions and a correct spot-check; permanently pinned in `ExecuteMCPv2.Tests.Utf8DecodeTest.TestDecodeUtf8StreamLargeBodyNoMaxString` at ~4.2M raw bytes (fast enough for the default suite, ~40ms).

**AC 34.8.5 — ASCII byte-identical, proven mechanically.** Every ASCII byte is already valid single-byte UTF-8, so the decode is a true no-op on ASCII content. Pinned with a deliberately tiny chunk size (forcing ASCII across many chunk boundaries too) in `TestDecodeUtf8StreamAsciiByteIdentical` and an exhaustive sweep of all 128 ASCII code points in `TestDecodeUtf8StreamAllAsciiCodePointsByteIdentical`, plus a live HTTP-level pin in the new TS test file and a direct live command comparison (`Set x=5+3 Write "result=",x,...` unchanged).

**AC 34.8.6 — Fixture-diverse round-trip tests, submitted THROUGH the request body.** New `packages/iris-dev-mcp/src/__tests__/request-body-utf8-decode.test.ts` (12 tests, default suite, graceful `ctx.skip()` degradation matching `execute-classmethod-epic-gate.test.ts`'s Rule #21 shape) drives the REAL deployed `/command`, `/classmethod`, and `/global` routes via the same tool handlers a real MCP client uses. Covers: accented BMP, CJK, astral/emoji (surrogate pair), mixed ASCII+non-ASCII, the exact Project Lead reproduction string, plain-scalar `/classmethod` args, a `{byRef, value}` marker, a non-ASCII JSON KEY on the SAME marker object (proving key-decoding doesn't desync adjacent value-decoding), mixed args across positions, `iris_global_set`/`iris_global_get` round-trip with independent read-back plus cleanup, and a ~3,900-character non-ASCII payload. All 12 pass live.

**AC 34.8.7 — Docs updated.** Both "Known Limitations" sections Story 34.7 added (root `README.md`, `packages/iris-dev-mcp/README.md`) are rewritten to state the defect is FIXED and to state explicitly that **the fix is forward-only** — data already written corrupted (e.g. via `iris_global_set` before upgrading) is NOT automatically repaired; there is no repair tool for previously-corrupted data.

**AC 34.8.8 — Gates + mutation evidence.**
- **Rule #48 mutation evidence, both layers.** Pushed the pre-fix `Utils.cls` content (from `git show HEAD:...`, via a mirrored-path `iris_doc_load` that never touched the real on-disk file) to the live server: `/command` reproduced the EXACT original bug (`Write "héllo-世界-😀-"` → `"hÃ©llo-ä¸ç-ð-"`, byte-identical to the story's own cited reproduction), all 21 new ObjectScript unit tests went RED (`<METHOD DOES NOT EXIST>` — the new methods genuinely don't exist pre-fix), and 11/12 new TS tests went RED (the 1 pass was the pure-ASCII test, correctly unaffected either way). Restored from the real on-disk fixed file via `iris_doc_load`, recompiled, and re-verified GREEN at both layers, confirming server matches disk.
- `ExecuteMCPv2.Tests` package: **374/374** (baseline 353 + 21 new = 374, mechanically matches — Rule #35).
- `@iris-mcp/dev`: **665/665** across **39** files (baseline 653/38 + 12 tests/1 file = 665/39, matches).
- `iris-mcp-all`: **120/120** across **18** files — unchanged, as expected (no cross-package surface touched).
- Epic gate (`execute-classmethod-epic-gate.test.ts`) re-run directly: **16/16, 0 skipped** — unchanged.
- `pnpm turbo run build test lint type-check`: **29/29 tasks successful** (one pre-existing, unrelated ESLint warning in `packages/shared/src/cli/governance.ts` — a file this story never touched).
- `pnpm run gen:governance-baseline:check` (check-only, never the bare generator): clean — 141 frozen keys still live, 201 total live keys, 60 post-foundation new keys, **0 drift**.
- Constraint C-2 re-verified: `iris_doc_list(generated=true, filter="ExecuteMCPv2.REST.Command")` still shows exactly ONE `ExecuteMCPv2.REST.Command.1.int` (unaffected — `Command.cls` was never touched by this story).
- Tool counts unmoved (Rule #31): no new tool, no new governance key — confirmed by the unchanged `iris-mcp-all` count above and the clean governance-baseline check.
- Rule #24: `Utils.cls` is bootstrapped — ran `pnpm run gen:bootstrap`; **BOOTSTRAP_VERSION `06b326631504` → `0af5e4eb83d4`**, recorded here and reflected in `packages/shared/src/bootstrap-classes.ts`.
- Added changeset `.changeset/request-body-utf8-decode-fix.md` (patch, all 8 `@iris-mcp/*` packages per the fixed group in `.changeset/config.json`). Did NOT run `changeset version` and did NOT bump any package version.
- Probe class `ExecuteMCPv2.Temp.Utf8Probe` deleted from the server (`iris_doc_delete` + `iris_doc_list` confirms zero matches) and from disk (`git status --short` shows no stray probe artifacts).

### File List

- `src/ExecuteMCPv2/Utils.cls` (modified; further modified by QA) — `ReadRequestBody` now UTF-8-decodes via new `DecodeUtf8Stream`/`IncompleteUtf8TailLength` methods and a new `UTF8CHUNKSIZE` parameter. QA added a new `SanitizeUnpairedSurrogates` method, wired into both `DecodeUtf8Stream` decode call sites, closing a defect QA found (see QA Results).
- `src/ExecuteMCPv2/Tests/Utf8DecodeTest.cls` (new; further modified by QA) — 21 ObjectScript unit tests for the new decode helpers (boundary cases, ASCII identity, chunk-boundary sweep, large-body safety, edge cases), plus 12 more QA-added tests (33 total): astral split at each of the 3 interior positions individually, exact-multiple-of-chunk-size, orphan-continuation-byte and overlong-encoding behavior pins, the two malformed-WTF-8-surrogate regression tests, and direct `SanitizeUnpairedSurrogates` coverage. **Code review added 2 more methods (35 total)** — `TestDecodeUtf8StreamZeroChunkSizeFallsBackAndTerminates` and `TestDecodeUtf8StreamTruncatedTrailingSequenceEveryLeadLength` — plus a total-size and tail assertion on the large-body test (which previously passed against a decode silently losing 801,596 characters) and two assertions covering the previously unreachable `tB2 < 128` branch.
- `packages/iris-dev-mcp/src/__tests__/request-body-utf8-decode.test.ts` (new) — 12 end-to-end TS tests against the real deployed `/command`, `/classmethod`, and `/global` routes. Unchanged by QA (re-run and re-verified against the QA-updated server).
- `packages/shared/src/bootstrap-classes.ts` (regenerated; further regenerated by QA and again at code review) — `BOOTSTRAP_VERSION` `06b326631504` → `0af5e4eb83d4` (dev) → `88c834d76dbb` (QA) → **`01dc15bb27df`** (code review, `Utils.cls` changed again; 29 classes, same order, regen confirmed idempotent by SHA-256 on an immediate second run). `01dc15bb27df` is the SHIPPED value.
- `packages/iris-dev-mcp/scripts/prepublish-gate.mjs` (modified at code review) — the live-IRIS publish gate now runs a named roster of gate files rather than only the epic gate, so `request-body-utf8-decode.test.ts` can no longer silently skip on the publish path.
- `CHANGELOG.md`, `.changeset/execute-response-ceiling-and-gate-hardening.md` (modified at code review) — both still described this defect as "documented, not fixed" in content that ships with this release; corrected.
- `_bmad-output/implementation-artifacts/deferred-work.md` (modified at code review) — `34-6-CR-7` re-dispositioned from `CLOSED-BY-DECISION` to terminal **RESOLVED**, plus 7 new deferred items (`34-8-CR-1`..`34-8-CR-7`).
- `README.md` (modified) — "Known Limitations" → "Non-ASCII Request-Body Content Was Mis-Decoded (Fixed in Story 34.8)", states the fix is forward-only. Verified accurate by QA; no further change needed.
- `packages/iris-dev-mcp/README.md` (modified) — matching "Known Limitations" update. Verified accurate by QA; no further change needed.
- `.changeset/request-body-utf8-decode-fix.md` (new; further modified by QA) — patch changeset for all 8 `@iris-mcp/*` packages; QA added a paragraph documenting the malformed-WTF-8-surrogate finding and fix, and corrected the ObjectScript test count (21 → 33).

## Change Log

- 2026-08-16: Story implemented — central `ReadRequestBody`/`DecodeUtf8Stream`/`IncompleteUtf8TailLength` fix, 21 ObjectScript tests, 12 TS end-to-end tests, docs and changeset updated. See Dev Agent Record above.
- 2026-08-16: QA pass (same-story) — live blast-radius verification across 3 additional handler families, adversarial fixture testing (astral-split-at-each-position, exact-chunk-multiple, invalid/malformed UTF-8), found and fixed a genuine defect (malformed WTF-8 input could produce invalid UTF-8 on a response), added 12 permanent regression tests, re-verified all gates. See QA Results below.

### QA Results (2026-08-16, bmad-qa-generate-e2e-tests)

**Priority 1 — live blast-radius verification across multiple handlers, ASCII byte-identity.**
Drove 3 handlers this epic never otherwise touched for UTF-8, spanning 2 REST classes outside `Command.cls`/`Global.cls`, all live against HSCUSTOM:
- `POST /security/permission` (`Security.cls:PermissionCheck`) — non-ASCII `target` (`utilisateur-café-世界-😀`, a nonexistent user/role) hit the clean, non-mutating error path; the error text correctly echoed the DECODED value verbatim (`"Target 'utilisateur-café-世界-😀' is not a known user or role"`, zero mojibake) — proving both the decode fix AND `SanitizeError`'s `$ZStrip(...,"*C")` control-character strip do not corrupt accented/CJK/astral content. An ASCII baseline on the SAME handler confirmed Rule #19 holds here too.
- `POST /security/webapp/get` (`Security.cls:WebAppGetByPost`) — non-ASCII `name` (nonexistent webapp) returned `{"exists":false,"name":"/app-café-世界-😀"}` — decoded input correctly echoed on the success path.
- `POST /monitor/health` (`Health.cls:HealthCheck`) — a non-ASCII `areas` entry mixed with a real one did not crash a THIRD, entirely different handler family; returned a well-formed, non-empty health envelope.
All four calls returned HTTP 200 with well-formed, non-empty, mojibake-free JSON envelopes. Full evidence (raw HTTP bodies) captured via a disposable Node script (scratchpad-only, not committed).

**Priority 2 — adversarial fixtures for chunk-boundary and large-body safety; invalid UTF-8 behavior determined, pinned, and one defect fixed.**
Live-probed via a disposable `ExecuteMCPv2.Temp.Utf8AdversarialProbe` (deleted from server and disk after use, verified via `iris_doc_list` and `git status`), then permanently pinned as 12 new methods in `Utf8DecodeTest.cls`:
- **Astral sequence split at each of the 3 interior positions individually** (not just the general chunk-size sweep): all 3 decode correctly (`TestDecodeUtf8StreamAstralSequenceSplitAtEachInteriorPosition`).
- **Body length an exact multiple of the chunk size**: decodes identically to the oracle (`TestDecodeUtf8StreamExactMultipleOfChunkSize`).
- **Truncated/invalid UTF-8 at end of body**: a lone lead byte of every length (2/3/4-byte) at absolute end-of-stream, with 0/1/2 of its continuation bytes present, does not throw; the well-formed leading text survives. **Correction (Story 34.8 code review):** this was PROBED but NOT permanently pinned — the 12 QA-added methods did not include it, and the only end-of-stream truncation test in the file remained the dev's 3-byte-only `TestDecodeUtf8StreamGenuinelyTruncatedTrailingSequenceDoesNotThrow`. The code review added `TestDecodeUtf8StreamTruncatedTrailingSequenceEveryLeadLength`, which now genuinely pins all six shapes (2-byte lead; 3-byte lead with 0 and 1 continuations; 4-byte lead with 0, 1 and 2 continuations), making the claim true.
- **Orphan continuation byte** (no valid lead — not a chunk-boundary-incomplete case per `IncompleteUtf8TailLength`, reaches `$ZConvert` directly): determined and pinned — becomes a literal `?`, matching `$ZConvert`'s own established substitution (`TestDecodeUtf8StreamOrphanContinuationByteBecomesQuestionMark`).
- **Overlong encoding** (`0xC0 0xAF`, non-canonical 2-byte encoding of `/`): determined and pinned — `$ZConvert` decodes it leniently to `/` rather than rejecting it (`TestDecodeUtf8StreamOverlongEncodingDecodesLeniently`) — a real, now-documented platform characteristic (more permissive than strict UTF-8), not a crash or data-loss risk.
- **Lone surrogate (WTF-8/CESU-8-encoded, `0xED [A0|B0] 0x80`)** — **a genuine defect, found and fixed.** `$ZConvert` decoded this malformed (never-valid-in-UTF-8) 3-byte sequence into a RAW, unpaired UTF-16 surrogate code unit (55296/56320) rather than rejecting it. Verified live with a hand-crafted raw HTTP body (bypassing any client-side JSON.stringify/UTF-8 auto-encoding, which always substitutes U+FFFD for an unpaired surrogate before it reaches the wire — this byte pattern is unreachable through this suite's own `IrisHttpClient` or any standard JSON+UTF-8 client): the unpaired surrogate reached the `/command` response and a strict `TextDecoder({fatal:true})` THREW on the actual response bytes — genuinely invalid UTF-8, HTTP 200, no error, no truncation flag. This is a NEW failure mode: the pre-Story-34.8 Latin-1 decode could never produce a surrogate from any input (Latin-1's range 0-255 never reaches the surrogate block), so this was strictly introduced by this story's UTF-8-aware decode. **Fixed** with a new `ExecuteMCPv2.Utils.SanitizeUnpairedSurrogates` method (O(n), single forward pass, no quadratic risk on pathological repeated-surrogate input), wired into both `DecodeUtf8Stream` decode call sites — substitutes `?` for any unpaired surrogate half while leaving every genuine surrogate pair (real astral characters, e.g. emoji) completely untouched, proven by re-running the exact same hand-crafted raw request live: strict decode now SUCCEEDS. Own mutation-verify (Rule #48) on this fix: reverted the `SanitizeUnpairedSurrogates` wiring → 2 of the 33 `Utf8DecodeTest` methods went RED (`TestDecodeUtf8StreamMalformedWtf8LoneHighSurrogateBecomesQuestionMark`, `...LowSurrogate...`), the other 31 (including the 6 direct `SanitizeUnpairedSurrogates` unit tests) stayed GREEN, confirming the mutation was correctly isolated to the integration point; restored byte-identical (`git diff` confirmed only the intended wiring returned), recompiled, re-confirmed 33/33 GREEN.
- **Large-body confirmation, independently reproduced (not re-trusted from the dev's word).** Via a second disposable probe (`ExecuteMCPv2.Temp.LargeReadProbe`, deleted from server and disk after use, verified via `iris_doc_list` and an empty `Temp/` directory listing), using DIFFERENT fixture content and a DIFFERENT sweep methodology than the dev's own probe: a single `.Read(stream.Size)` on a pure-ASCII stream returns the full content up to somewhere between 3M and 4M raw bytes, then silently caps at **3,641,144 characters** for every size tested from 4M up through 20M raw bytes — no exception, ever. This closely matches (same order of magnitude, ~3.6M) but is not bit-identical to the dev's own cited `~3,589,128` figure — expected, since the exact ceiling is evidently not a fixed constant across probe runs/fixtures, but the qualitative phenomenon (a real, silent, no-exception truncation somewhere around 3.6-3.7M characters) is independently confirmed. Then, end-to-end through the ACTUAL product fix (not a raw `.Read()`) at a QA-chosen size the dev never tested (10,000,000 raw bytes, non-ASCII content mixed in throughout so a partial-decode failure would show up as wrong content, not just a wrong length): `DecodeUtf8Stream` decoded all of it with zero exceptions (`threw=0`), and BOTH the first AND the last unit-worth of decoded content (seeked via `MoveTo` near the very end of the 8,979,564-character decoded stream) matched an isolated oracle decode exactly — proving the tail past the ~3.6M ceiling was not silently dropped or corrupted. Separately, re-ran the dev's own `TestDecodeUtf8StreamLargeBodyNoMaxString` (~4.2M raw bytes) after adding the sanitizer — still passes with zero exceptions (measured 165-993ms across repeated runs on this dev box, i.e. real but bounded, non-quadratic overhead from the added sanitization pass; well within acceptable bounds, noted for transparency, not a blocker).

**Priority 3.**
- **AC 34.8.6 Rule #58 fixture diversity**: re-verified all 6 required shapes are genuinely submitted THROUGH the request body via real HTTP in `request-body-utf8-decode.test.ts` (confirmed by the `[INFO] POST .../classmethod completed in Nms` live HTTP log lines observed during test runs, not mocks) — accented BMP, CJK, astral/emoji, mixed, non-ASCII JSON key (proven not to desync adjacent value decoding), non-ASCII inside a `{byRef, value}` marker. Nothing missing; no changes made.
- **AC 34.8.7**: both READMEs re-read in full and confirmed accurate — "fixed" and "forward-only, not repaired" are both true statements given the current implementation, including after QA's own fix (which closes a decode-fidelity gap, not a repair-of-existing-data capability). No changes needed.
- **Rule #48**: mutation-verify captured above for QA's own fix (revert → 2 red / 31 green → restore byte-identical → 33/33 green). Dev's own two-layer mutation-verify (pre-fix `Utils.cls` pushed live, both suites red, restored, both green) stands as recorded in the Dev Agent Record; not independently re-run by QA (redundant with QA's own equivalent-shape mutation-verify plus the full-suite re-runs below).
- **Rule #24/C-2**: `Utils.cls` changed again by QA — re-ran `pnpm run gen:bootstrap`: **BOOTSTRAP_VERSION `0af5e4eb83d4` → `88c834d76dbb`**, 29 classes, same order; re-ran immediately to confirm idempotence (identical version on the second run). `iris_doc_list(generated=true, filter="ExecuteMCPv2.REST.Command")` still shows exactly ONE `ExecuteMCPv2.REST.Command.1.int` (`Command.cls` untouched by QA).
- **Rule #25**: `pnpm run gen:governance-baseline:check` (`:check` ONLY) — exit 0, "OK — every frozen foundation key still exists in the live surface", 141 frozen / 201 live / 60 post-foundation-new, unchanged.
- **Rule #31**: tool counts unmoved — `@iris-mcp/all` 120/120 across 18 files, byte-identical to the pre-story baseline; no new tool/action, no governance key added by QA's fix (a purely internal ObjectScript helper).
- **Rule #35**: mechanical `Test*` grep count across `src/ExecuteMCPv2/Tests/*.cls` = **386**, matching `iris_execute_tests` package-level `total:386, passed:386, failed:0, skipped:0` exactly (independently re-derived by QA, not trusted from the dev's figure). `Utf8DecodeTest.cls` alone: mechanical count 33, matches `total:33, passed:33`.
- **Rule #54**: for each new/exercised branch — tail hold-back of 0/1/2/3 bytes (all exercised by the chunk-size-1..N sweep + the new explicit astral/exact-multiple tests), the orphan-continuation and overlong-encoding leniency branches (exercised by real, reachable malformed input over the actual REST endpoint's raw-byte HTTP surface — reachable by ANY HTTP client, not just this suite's own MCP tooling, so these are NOT unreachable defensive branches), and the new `SanitizeUnpairedSurrogates` pairing logic (valid-pair-preserved / lone-high / lone-low / two-adjacent-highs / valid-pair-then-orphan-low, each independently pinned) — all confirmed reachable by real input and correctly handled.
- **Full gate**: `pnpm turbo run build test lint type-check` **29/29 successful** (10 cached, 19 executed fresh after the `Utils.cls`/`bootstrap-classes.ts`/changeset changes); `@iris-mcp/shared` 1308/1308 across 65 files; `@iris-mcp/dev` 665/665 across 39 files (re-run twice against the QA-updated live server, unchanged); `@iris-mcp/all` 120/120 across 18 files; `ExecuteMCPv2.Tests` 386/386 (353 pre-story + 21 dev + 12 QA). `execute-classmethod-epic-gate.test.ts` explicitly re-run standalone: 16/16, 0 skipped, unchanged.
- Both probe classes (`ExecuteMCPv2.Temp.Utf8AdversarialProbe`, `ExecuteMCPv2.Temp.LargeReadProbe`) deleted from the server (`iris_doc_delete`, confirmed zero matches via `iris_doc_list` for each) and from disk (`Temp/` directory confirmed empty both times); disposable Node probe scripts kept in the session scratchpad only, never added to the repo (`git status --short` shows no stray artifacts beyond the intended file set).
- **Server-vs-disk byte-identity, verified rigorously** for both ObjectScript files QA touched: fetched live content via `iris_doc_get` and compared against disk. `Utils.cls`: SHA-256 hash match. `Utf8DecodeTest.cls`: `diff` reports zero differences. (Process note, not a product finding: the first comparison attempt for `Utils.cls` produced a false mismatch — PowerShell 5.1's default ANSI read of a BOM-less UTF-8 temp file mojibake'd the em-dashes and Arabic text in the class's own doc comments, e.g. `—` → `â€"`. Recognized as a tooling artifact rather than a real defect, corrected by re-reading with explicit UTF-8 encoding, and reconfirmed identical.)
