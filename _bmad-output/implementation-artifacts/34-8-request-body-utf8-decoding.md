# Story 34.8: Request-Body UTF-8 Decoding

Status: ready-for-dev

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

- [ ] **Task 1 — Live probe** (AC: 34.8.1)
  - [ ] Determine the actual class/encoding of `%request.GetMimeData("BODY")` in this handler context.
  - [ ] Determine whether `%request.CharSet` / Content-Type charset is honoured, and what the TS client actually sends.
  - [ ] Test candidate mechanisms; record the working shape verbatim and the failures with their errors.
- [ ] **Task 2 — Central fix** (AC: 34.8.2, 34.8.3, 34.8.4)
- [ ] **Task 3 — Back-compat proof** (AC: 34.8.5)
- [ ] **Task 4 — Fixture-diverse round-trip tests** (AC: 34.8.6)
- [ ] **Task 5 — Docs update** (AC: 34.8.7)
- [ ] **Task 6 — Gates + mutation evidence** (AC: 34.8.8)

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

### Debug Log References

### Completion Notes List

### File List
