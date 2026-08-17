# Test Automation Summary — Story 34.8 (Request-Body UTF-8 Decoding)

QA verification pass. Independently re-verified the dev's central `ReadRequestBody` /
`DecodeUtf8Stream` / `IncompleteUtf8TailLength` fix, drove live blast-radius testing across
3 additional REST handler families, adversarially tested chunk-boundary/large-body/invalid-UTF-8
behavior, **found and fixed one genuine product defect** (malformed WTF-8 input could produce
invalid UTF-8 on an HTTP response), and added 12 new permanent regression tests pinning it and
the other adversarial findings.

## Generated / Modified Tests

### ObjectScript (`%UnitTest`, live IRIS `HSCUSTOM`, IRIS 2026.1 Build 235U)
- [x] `src/ExecuteMCPv2/Tests/Utf8DecodeTest.cls` — 33/33 passed (21 dev + 12 new QA tests):
  astral-sequence split at each of the 3 interior positions individually, exact-multiple-of-
  chunk-size body length, orphan-continuation-byte behavior pin, overlong-encoding behavior
  pin, two malformed-WTF-8-lone-surrogate regression tests (the defect QA found and fixed),
  and 6 direct `SanitizeUnpairedSurrogates` unit tests (valid pair preserved, lone
  high/low surrogate substituted, two adjacent unpaired highs, valid-pair-then-orphan-low,
  ordinary-content no-op).
- [x] `ExecuteMCPv2.Tests` package — 386/386 passed, 0 failed, 0 skipped (mechanically
  re-counted: `grep -c "^Method Test"` across all `Tests/*.cls` = 386, matches exactly;
  353 pre-story baseline + 21 dev + 12 QA).

### Vitest (`packages/iris-dev-mcp`)
- [x] `src/__tests__/request-body-utf8-decode.test.ts` — 12/12 passed (dev's file; re-run
  twice against the QA-updated live server, unchanged, no new TS tests needed).
- [x] Full package default suite — 665/665 passed, 39/39 files, 0 skipped.

### Repo-wide gates
- [x] `pnpm turbo run build test lint type-check` — 29/29 successful (10 cached, 19 executed
  fresh after `Utils.cls`/`bootstrap-classes.ts`/changeset changes); `@iris-mcp/shared`
  1308/1308 (65 files); `@iris-mcp/all` 120/120 (18 files, byte-identical to baseline).
- [x] `pnpm gen:governance-baseline:check` (`:check` ONLY) — exit 0, frozen `1e62c5ad5bf7` /
  141 / 201 / 60, unchanged.
- [x] `pnpm run gen:bootstrap` — 29 classes, same order; `BOOTSTRAP_VERSION` `0af5e4eb83d4`
  (dev) → `88c834d76dbb` (QA, `Utils.cls` further changed by the fix below) →
  **`01dc15bb27df`** (code review, `Utils.cls` changed again by the review patches — this is
  the SHIPPED value); re-run immediately each time to confirm idempotence (byte-identical
  file on the second regen, verified by SHA-256 at the review stage).
- [x] Constraint C-2: exactly one `ExecuteMCPv2.REST.Command.1.int` via
  `iris_doc_list(generated=true)` (`Command.cls` untouched by QA).

## Product Defect Found and Fixed

**Malformed WTF-8/CESU-8 input could produce genuinely invalid UTF-8 on an HTTP response
(HTTP 200, no error, no truncation flag).** `$ZConvert(...,"I","UTF8")` is lenient enough to
decode the never-valid-in-UTF-8 3-byte sequence `0xED [0xA0-0xBF] [0x80-0xBF]` into a raw,
unpaired UTF-16 surrogate code unit instead of rejecting it. Live-verified with a hand-crafted
raw HTTP body (bypassing the sanitization any standard JSON+UTF-8 client — including this
suite's own `IrisHttpClient` — always performs before such a byte pattern could reach the
wire): the unpaired surrogate reached the `/command` response and a strict
`TextDecoder({fatal:true})` **threw** on the actual response bytes. This was a NEW failure
mode introduced by this story's UTF-8-aware decode — the pre-Story-34.8 Latin-1 decode could
never produce a surrogate from any input.

**Fixed** in `src/ExecuteMCPv2/Utils.cls`: new `SanitizeUnpairedSurrogates` method (single
forward O(n) pass, no quadratic risk on pathological repeated-surrogate input), wired into
both `DecodeUtf8Stream` decode call sites. Substitutes `?` for any surrogate half without a
valid pairing partner — matching `$ZConvert`'s own observed substitution for other invalid
sequences — while leaving every genuine surrogate pair (real astral characters, e.g. emoji)
completely untouched. Re-verified live after the fix: the identical hand-crafted request now
produces a strictly-valid-UTF-8 response.

Reachable only through a hand-crafted raw HTTP body, never through this suite's own MCP tool
clients — but fixed rather than left as a new, undocumented gap, consistent with this epic's
standing policy against shipping a silent-corruption path under HTTP 200 (the same class of
defect Story 34.7's `SurrogateSafeCutLength` closed on the output/truncation side).

## Live Mutation Evidence (QA's own fix, revert → red → restore → green)

Reverted the `SanitizeUnpairedSurrogates` wiring in `DecodeUtf8Stream` back to bare
`$ZConvert(...)` calls → `Utf8DecodeTest` went 31/33 (2 RED: the two malformed-WTF-8
regression tests; the 6 direct `SanitizeUnpairedSurrogates` unit tests stayed GREEN, correctly
isolating the mutation to the integration point) → restored, confirmed byte-identical via
`git diff` (only the intended wiring returned) → recompiled → 33/33 GREEN. Package-level
re-run after restoration: 386/386 GREEN.

## Coverage

- **Multi-handler blast radius** (Priority 1) — 3 additional REST handlers this epic never
  otherwise touched for UTF-8, spanning 2 handler classes outside `Command.cls`/`Global.cls`,
  driven live with non-ASCII request bodies:
  - `POST /security/permission` — non-ASCII `target` hit the clean error path; error text
    echoed the DECODED value verbatim, zero mojibake (also proves `SanitizeError`'s
    `$ZStrip(...,"*C")` doesn't corrupt accented/CJK/astral content). ASCII baseline on the
    same handler confirmed too.
  - `POST /security/webapp/get` — non-ASCII `name` echoed correctly in a
    `{exists:false, name:...}` response.
  - `POST /monitor/health` — non-ASCII `areas` entry mixed with a real one did not crash a
    third, entirely different handler family; well-formed health envelope returned.
  All returned HTTP 200 with well-formed, non-empty, mojibake-free JSON.
- **Adversarial fixtures** (Priority 2) — astral sequence split at each of 3 interior
  positions individually; body length an exact multiple of the chunk size; truncated lead
  bytes of every length (2/3/4-byte) at end-of-stream; orphan continuation byte (→ `?`,
  determined and pinned); overlong encoding (→ decodes leniently, determined and pinned);
  lone surrogate WTF-8 (→ found broken, fixed, pinned). Large-body safety re-confirmed
  (~4.2M-byte ObjectScript test, zero exceptions, real but bounded added overhead from the
  new sanitizer, ~165-993ms across repeated runs).
- **~3.6M silent-truncation claim, independently reproduced** — a second disposable probe
  (`ExecuteMCPv2.Temp.LargeReadProbe`, different fixture content and sweep methodology than
  the dev's own probe) confirmed a single `.Read(stream.Size)` silently caps at **3,641,144
  characters** for every size from 4M-20M raw bytes tested, no exception ever — same
  phenomenon and order of magnitude as the dev's own `~3,589,128` figure, not bit-identical
  (expected: the exact ceiling isn't a fixed constant across runs/fixtures). Then, end-to-end
  through the actual `DecodeUtf8Stream` fix at a QA-chosen 10,000,000-raw-byte size (non-ASCII
  mixed throughout) the dev never tested: zero exceptions, and BOTH the first AND the last
  unit-worth of decoded content (seeked near the very end of the 8,979,564-character decoded
  stream) matched an isolated oracle decode exactly — the tail past the ceiling was not
  silently dropped or corrupted.
- **Fixture diversity** (AC 34.8.6 / Rule #58) — all 6 required shapes (accented BMP, CJK,
  astral/emoji, mixed, non-ASCII JSON key, non-ASCII inside a `{byRef, value}` marker)
  confirmed genuinely submitted through the request body via real HTTP (live `[INFO] POST
  .../classmethod` log lines observed, not mocks). Nothing missing.
- Probe classes `ExecuteMCPv2.Temp.Utf8AdversarialProbe` and `ExecuteMCPv2.Temp.LargeReadProbe`
  deleted from server (confirmed via `iris_doc_list`) and disk (directory confirmed empty);
  disposable Node probe scripts kept in the session scratchpad only, never added to the repo.
- Server-vs-disk verification for `Utils.cls` and `Utf8DecodeTest.cls`: live content fetched
  via `iris_doc_get` and hash/diff-compared against the on-disk files — byte-identical.
  (Process note: the first comparison attempt produced a false mismatch caused by PowerShell
  5.1's default ANSI read of a BOM-less UTF-8 temp file, not a real server/disk drift;
  re-verified correctly with explicit UTF-8 reads throughout, confirmed identical.)

## Code review (2026-08-17) — post-review test figures

Close kind **NORMAL** (all three adversarial layers delivered inside the bounded-close window;
review NOT degraded). Two HIGH findings, both about the SAFETY NET rather than the decode:

- `ExecuteMCPv2.Tests.Utf8DecodeTest` **33 → 35** methods. `TestDecodeUtf8StreamLargeBodyNoMaxString`
  gained a mechanically-derived total-size assertion and a sequential rolling tail check: it
  previously passed against a decode that silently lost **801,596 characters** (proven live), i.e.
  it could not detect the exact failure AC 34.8.4 exists to prevent. Mutation-verified — both new
  assertions go RED on that regression. Runtime kept at ~443ms (a first `MoveTo()`-based tail check
  measured 26s and was replaced). Two new methods added:
  `TestDecodeUtf8StreamZeroChunkSizeFallsBackAndTerminates` (a chunk size of 0 was a
  non-terminating loop; `.Read(0)` live-confirmed to return empty WITHOUT setting `AtEnd`) and
  `TestDecodeUtf8StreamTruncatedTrailingSequenceEveryLeadLength` (makes the QA write-up's
  2/3/4-byte truncated-lead claim actually true — it had been probed but never pinned). Two
  assertions were also added to `TestIncompleteUtf8TailLengthShortChunkGuards` for the previously
  unreachable `tB2 < 128` branch.
- `packages/iris-dev-mcp/scripts/prepublish-gate.mjs` now runs a named roster of live-IRIS gate
  files. It previously armed only `execute-classmethod-epic-gate.test.ts` with
  `IRIS_REQUIRE_LIVE=1`, so `request-body-utf8-decode.test.ts` — the only end-to-end proof of this
  fix — would silently skip and let a publish ship it unexecuted. Mutation-verified: the gate now
  runs **2 files / 28 tests** and exits 0 against live IRIS; the new file alone with
  `IRIS_REQUIRE_LIVE=1` against a bogus host **fails closed**, versus "1 passed, 12 skipped"
  without it.
- `request-body-utf8-decode.test.ts` still **12 tests**, but the fixture-existence skip is now
  scoped to the 4 tests that need `ClassMethodArgsFixture`; the other 8 (`/command`, `/global`) no
  longer skip when only the fixture is missing.

**Final gates:** `pnpm turbo run build test lint type-check` **29/29** · `ExecuteMCPv2.Tests`
**388/388** (0 failed, 0 skipped) against a mechanical `Test*` count of exactly **388** (Rule #35)
· `@iris-mcp/dev` **665/665** across 39 files · `@iris-mcp/all` **120/120** across 18 files (Rule
#31 unmoved) · `Utf8DecodeTest` **35/35** · `gen:governance-baseline:check` (`:check` ONLY) exit 0
at frozen `1e62c5ad5bf7` / 141 / 201 / 60 · Constraint C-2 exactly ONE
`ExecuteMCPv2.REST.Command.1.int` · server byte-identical to disk by SHA-256.

## Next Steps

- None outstanding for Story 34.8's own scope. The malformed-WTF-8-surrogate finding is fully
  resolved (fixed + pinned), not deferred.
- 7 code-review items deferred to `deferred-work.md` (2 MEDIUM / 5 LOW) — see "Code review on
  Story 34.8". The two MEDIUMs are `34-8-CR-1` (`%request.CharSet` never consulted) and
  `34-8-CR-2` (no end-to-end test crosses the production 1MB chunk boundary; the property itself
  was verified live at 4.5M and 11.25M bytes, only the permanent pin is missing).
