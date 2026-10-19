# Test Automation Summary - Story 40.4 (Test Depth Docs, Prompt and Capstone)

QA gap analysis against the I/O and Edge-Case Matrix and AC-1 to AC-9. The implement stage's pinning tests and recorded
mutations were re-checked. One file was added where the brief's real-runtime cases had no row: the prompt through the
built dev server over stdio, the corrected annotations under three presets, DW-601 and DW-602 against fixtures the
implement stage did not use, and `iris_test_status` on paths the unit tests only mock. No product source changed.

## Generated Tests

### Built dev and admin servers over stdio, real SDK Client (AC-1 to AC-7; Rules 3, #46, #58)
- [x] `packages/iris-mcp-all/src/__tests__/story-40-4-qa-live-gate.test.ts` - 16 tests, about 15 s armed, in
  `EXECMCPTMP404Q` (the `Story404Q.*` classes) and the empty `EXECMCPTMP404R`.
  - A1: `prompts/get` without `arguments` is InvalidParams (-32602) naming `deploy-and-test-class`, an empty `arguments`
    is too, and the connection renders the next call.
  - A2: the required argument alone renders one user message of steps 1 to 9 in order (step 8 optional coverage,
    step 4 `PRODUCTION_BUSY`, step 9 report); an undeclared extra argument renders the identical text.
  - A3: step 8 against reality: every `iris_*` token is on `tools/list`; the arguments it names are real
    (`classes` has `maxItems` 50, `action` has `poll` and `export`); the refusal phrases; the keys are disabled by
    default in the governance policy; the recipe it prints, passed as `IRIS_GOVERNANCE` to a spawned server, enables
    `iris_test_coverage` and nothing else.
  - A4: "outside `core`, needs `developer` or full" is what the `core`, `developer` and `full` presets list.
  - A5: `skills/deploy-and-test-class/SKILL.md` body equals the rendered prompt and its description is the listed one.
  - B1: `iris_execute_tests` hints are the four `false` under `full`, `core` and `developer`; the coverage pair is
    listed only where the presets show it; tool counts 33 / 15 / 33 unchanged.
  - B2: under the default governance `iris_execute_tests` and `iris_test_status:poll` are enabled; the coverage tool,
    `:cancel` and `:export` are refused with the denial shape, no directory written, no run id allocated, monitor idle.
  - C1: initializing and non-initializing `#dim` lines mixed in one method, `//` and `;` trailing comments, and a
    control; expected class lines 8, 10-11, 13, 18-19, 24, 26, 32-33, 42-43, 49, 51, 61-62, checked line by line against
    the stored class and the INT text, and against an independent text rule.
  - C2: the documented limit, live: a `#dim` that initializes nothing but has `= 8` in its trailing comment is read as
    initializing; after four other leading directives the compiler maps it onto the INT line of `Quit tL`, so lines
    `[42,43]` are reported where the text says `[43,44]`. The control without the `=` reports `[61,62]` exactly.
  - C3: `%` methods have `labelLine` 0 and still map; the same limit in `%LeadEq` reports the directive at line 27
    mapped onto `%Cm`'s `Set tB = tA + 1`.
  - C4: a class saved with a `///`-only edit and default-compiled is `not-up-to-date` (`lineMap` 0, label lines kept),
    fails the verdict without a tool error and is outside the total; a forced compile (`ck`) of the same edit is
    measured at the edited document's lines.
  - C5: the documented `%`-only limit (stale, not recognised, no executable lines, `notApplicable`) and the Cobertura
    file (valid; the stale ordinary class left out; the `%` class written with no line).
  - D1: a nonexistent `runIndex` is an error envelope naming its namespace; the same index exists in Q and not in R.
  - D2: a consumed (stale) `jobId` is an envelope that keeps the handle; with the `runIndex` it recovers the finished
    run from the result table; `cancel` of it is an envelope.
  - D3: a result table IRIS cannot read (a namespace that does not exist, real HTTP 404) reaches the new catches live:
    envelope with the handles and the do-not-re-submit text, by `runIndex` alone and behind a stale `jobId`.
  - D4: a malformed `runIndex` (text, 0, negative, fractional) or `jobId` (letters, a path) is answered, never thrown.

### Rosters and prose
- `packages/iris-mcp-all/scripts/prepublish-gate.mjs` `gateTestFiles` and `story-39-1-gate-guards.test.ts` `GATES`
  list the new gate (its arming guard runs for it); the "only gates that start Line-by-Line sessions" prose of the 40.1,
  40.2 and 40.3 gates and the roster comments now include it.

## Mutations (13, each red then reverted; dist rebuilt clean, scratch class restored to `src/`)
- step 8 loses its `GOVERNANCE_DISABLED` clause -> A3, A5 red.
- `classOrPackage` not required -> A1, A2 red.
- `readOnlyHint: true` on `iris_execute_tests` -> B1 red.
- coverage pair moved into `core` -> A4 red.
- `mutates.export` read -> B2, A3 red.
- `resolveByRunIndexOrError` never catches -> D3 red.
- the `No known run` envelope drops its `jobId` -> D2 red.
- an absent result row reported as existing -> D1 red.
- `.int()` dropped from `runIndex` -> D4 red.
- `isStale` always false -> C4, C5 red.
- `HasInitializer` stops at a comment (scratch `Coverage/Job.cls`) -> C1, C2, C3 red; C4, C5 red on totals.
- gate removed from `gateTestFiles` -> `live-gate-roster` red; from `GATES` -> completeness check red.

## Findings
- **The `reopen_if` of review row 8 has fired (low).** A `#dim` that initializes nothing, with `=` in a trailing comment,
  is reported as an executable class line, live, in two shapes: after four other leading directives it displaces the
  real `Quit` (reported `[42,43]`, true `[43,44]`), and in a `%` method (no label line to drop it) it takes another
  method's INT line (line 27, `Set tB = tA + 1` of `%Cm`). Both are documented known limits; QA C2 and C3 pin them. A
  3-line change in `HasInitializer` (stop at `//` or `;` outside quotes) was loaded as a scratch class and made the
  lines right; it moves `BOOTSTRAP_VERSION`, README and CHANGELOG Known limits, and the C1 to C5 pins.
- **Malformed arguments carry no `structuredContent` (observation).** A malformed `runIndex` or `jobId` never reaches the
  handler: the SDK validation answers `isError: true` with "Invalid arguments for tool iris_test_status", not thrown,
  with no `structuredContent` (the same for every tool; the 40.4.3 envelopes cover the handler paths).
- **Double full stop in the new catch texts (cosmetic).** IRIS texts end in "." and the golden template adds ". ", so
  the text reads "...web server configuration.. Poll again with runIndex 1". The tests match the sentence, not the dots.
- **Step 8 offers no remedy for `not-up-to-date` (recorded by review row 2).** Live: a default compile after a
  documentation-only save leaves the class stale (`lineMap` 0); only the forced compile (`ck`) rebuilds it.
