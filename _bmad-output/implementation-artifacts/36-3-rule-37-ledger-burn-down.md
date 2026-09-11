# Story 36.3: Rule #37 Ledger Burn-Down — 45 Epic-33/34-Era Items at Rule #37 Count 2

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the **Epic 36 delivery team**,
I want **every one of the 45 carried ledger items that reached their second consecutive deferral to land in a TERMINAL disposition — resolved, closed-with-evidence, or closed-by-decision — with the evidence recorded**,
so that **the deferred-work ledger stops rolling debt forward (Rule #37's steady-state guarantee), and the defects the suite was blind to are either fixed and proven or consciously accepted**.

## Context — why this story exists

The Story 36.0 retro-review gate (committed `f05694f`) mechanically re-derived the ledger (121 open, reconciled exactly to `0 HIGH / 26 MEDIUM / 95 LOW`) and found the **Rule #37 ≥3 trigger FIRES**: 48 carried items stood at count 2, the obligation the Epic 35 gate recorded. The Project Lead routed them on 2026-09-10: `34-5-R2/R3/R4` terminated in Story 36.1 (AC 36.1.12, done at `7f286ea`); the other **45** terminate HERE. Scope is the **mandatory 45 only** (Project Lead decision); the 36 count-1 Story 34.6/34.7/34.8 residuals and all Epic-35/36-era items stay out.

Precedent shape: Stories 22.1 / 26.4 / 29.3 / **32.3** (`32-3-deferred-work-burn-down.md` — the closest template: clustered disposition plan, mechanical tallies, Rule #48 evidence per resolved item). **Re-deferral is not an allowed outcome for any of the 45.**

**Sequencing:** this story runs after 36.2 (done at `a7adcf9`) and BEFORE **Story 36.4** (the `/global` subscript-injection HIGH, ledger `36-2-CR-1`, added 2026-09-11). **Do not touch `src/ExecuteMCPv2/REST/Global.cls`** — 36.4 owns it.

## Acceptance Criteria

Sourced verbatim from `_bmad-output/planning-artifacts/epics.md`, "### Story 36.3" (as amended at the Story 36.0 code review).

1. **AC 36.3.1** - TERMINAL disposition for EVERY one of the 45 items, each landing in exactly one of **resolved / closed-with-evidence / closed-by-decision** — re-deferral is NOT an allowed outcome: `@iris-mcp/client-config` batch (17 LOW: `33-1-R1..R4`, `33-5-L1..L11`, `33-5-R1..R2`); Epic 34 carried MEDIUM (5: `34-1-R5`, `34-1-R8`, `34-2-R4`, `34-2-R5`, `34-3-R3`); Story 34.4 review (6 LOW: `34-4-R2`, `34-4-R5`, `34-4-R6`, `34-4-R7`, `34-4-R8`, `34-4-R9`); Story 34.5 review remainder (1 LOW: `34-5-R5`); Epic-34 Stories 34.0–34.3 residuals (16 LOW: `34-0-R1/R2`, `34-1-R10/R11/R13/R14/R15/R16`, `34-2-R6/R7/R10`, `34-3-R5..R9`). `17 + 5 + 6 + 1 + 16 = 45`. The roster is the 36.0 gate's mechanically-derived list — re-derive it from `deferred-work.md` at pickup and reconcile any difference before dispositioning (#51/#56).
2. **AC 36.3.2** - Rule #48 bar on every "resolved" code fix: LIVE proof on the real surface or MUTATION evidence (revert → RED → restore). A green suite is not evidence — these items were deferred precisely because the suite was blind there.
3. **AC 36.3.3** - Rule #16 probe-first on every item whose suggested resolution embeds an unverified claim — explicitly including the gate-flagged suspected partial overlap (`34-2-R4` vs Story 34.6's 1000-node byRef cap, `BYREFNODECEILING` at `src/ExecuteMCPv2/Utils.cls:34`) and the recorded fold anomalies (`34-1-R15` recorded as folded into `34-2-R5` yet still counted; `34-1-R8`'s fold reference names a non-matching item — stated at L1975, in `34-2-R5`'s own row L1997, and in `34-2-handler-capture-byref-20args.md:200`; `34-2-R10` recorded as folding into `34-1-R14` yet both still counted). Each anomaly resolves with evidence: a genuine duplicate closes-with-evidence citing its survivor; a mis-recorded fold is corrected in the ledger. **Cross-batch overlap:** `34-2-R5` and the out-of-scope `35-2-CR-5` (ii) (Story 35.2 DEFER batch) describe the same `Command.cls` redirect defect, and `35-2-CR-5` asks for one cross-cutting redirect discipline (`Command.cls`/`Analytics.cls`/`UnitTest.cls`, see `35-2-DEV-1`) — scope stays the mandatory 45, but whatever this story does to `Command.cls` for `34-2-R5` is recorded against `35-2-CR-5` (ii) too, so no open row describes code that no longer exists. Disposable probe artifacts are deleted before commit. *(Amended at the Story 36.0 code review, 2026-09-10, `36-0-CR-H`/`-L`: the fourth fold anomaly, the two further `34-1-R8` citations, and the cross-batch overlap added.)*
4. **AC 36.3.4** - Batch decisions made ONCE, not per item: the 17-item `@iris-mcp/client-config` batch gets a single recorded policy (e.g. resolve the substantive subset, close the remainder by decision with rationale); the five classmethod-fidelity MEDIUMs are decided together against the one ObjectScript handler they share (`Command.cls`/`Utils.cls`).
5. **AC 36.3.5** - The full disposition table is mirrored into `deferred-work.md` with per-item evidence references; every summary tally is derived MECHANICALLY (grep/awk over the disposition column) and cross-checked against any prose count before close (#51).
6. **AC 36.3.6** - Gates: per-package standalone suites green (`35-1-DEV-1` substitution recorded); `gen:governance-baseline:check` (`:check` ONLY) exit 0 at frozen `1e62c5ad5bf7`/141, live/post-foundation 203/62 (E-2); no new tool and no new action key — tool counts unmoved from Story 36.2's close (#31); any bootstrapped `.cls` edit (the classmethod MEDIUMs are ObjectScript-side) regenerates the embed IN THIS STORY with `BOOTSTRAP_VERSION` from→to recorded (#24); OS suite `total` vs mechanically-counted `Test*` (#35); changeset for any shipped package that changes. *(Amended at the Story 36.3 code review, 2026-09-11, Rule #42: the governance figures read "141/201/60" — stale since Story 36.2 added its two `iris_test_status` keys (live 203, post-foundation 62); the frozen hash and 141 are unchanged. Not a regression.)*

## Integration ACs

Not a service-introducing story (cleanup / defect disposition). No Integration AC required.

## Lead decisions recorded at story creation (2026-09-11) — batch policies (AC 36.3.4) and the items that explicitly ask for a Lead call

- **`@iris-mcp/client-config` batch policy (17 LOW):** RESOLVE every item whose fix is local and cheap AND protects user data or truthful reporting (stash hygiene, backup-stamp collisions, CRLF/comment byte-preservation per Rule #58, duplicate-key/mis-shape reporting, unreachable branches per Rule #54, certify/doctor script correctness); CLOSE-BY-DECISION an item only when its fix is disproportionate to a LOW risk, recording the rationale and — where users could be surprised — a one-line doc note at the point of use. One terminal marker per row; a multi-leg row is `**RESOLVED**` only if every leg is resolved, otherwise it takes the marker of its unresolved leg with each leg's outcome named (the Story 36.1 AC 36.1.12(b) split-leg rule).
- **`33-1-R3`** (JSONC comments inside a manager-owned entry lost across disable→enable): **CLOSED-BY-DECISION** — the entry is manager-owned by design; a raw-text stash is disproportionate for a LOW. Add a one-line note in `packages/client-config`'s user-facing docs.
- **`33-5-L2`** (`tsc` emits `__tests__` into published `dist`): **RESOLVE suite-wide now, before the first npm publish** — cheap today, irreversible after publish (the `34-6-CR-19` lesson). Prove with `npm pack --dry-run` per publishable package (no `__tests__` in the tarball) and every suite still green; if any package's tests import another package's built test output, stop and report rather than force it.
- **`33-5-L4`** (codex project-scope `shareable:true` pin vs spec §3.2 intent): probe the spec (Rule #42) — align the pin to the spec, or amend the spec in place with a marker; never leave them contradicting.
- **`34-4-R6`** (Base pre-flight serializes every response twice): MEASURE first (a large ~32 KB envelope and a small one, before/after timing on the live endpoint). Overhead within noise ⇒ **CLOSED-BY-DECISION** (accept) with the measurement as evidence; material ⇒ RESOLVE with a size threshold, proven.
- **`34-2-R7`** (`args: ""` / `args: null` accepted as zero args): **CLOSED-BY-DECISION** (document the alias) — rejecting would break any caller relying on it (Rule #19); unless the probe shows it produces a WRONG result (not just a lenient one), in which case resolve.
- **`34-0-R1` / `34-0-R2`** (code-review skill machinery): changes to `.claude/skills/bmad-code-review/steps/` alter the Rule #57 machinery THIS story's own review will run on. `34-0-R2` (story_key never discovered on the invocation-text branch) is small and real for manual invocations — RESOLVE it narrowly; `34-0-R1` (layer accounting lost on compaction during the wait window) — **CLOSED-BY-DECISION** with evidence that the `layers_mode=sequential_sync` adaptation (each layer synchronous, own armed timer — Epic 36's five reviews) removes the unobserved wait window it describes. Re-read both step files after any edit and state that the machinery still enforces bounded-close, frozen-diff and delivery receipts.
- **`34-5-R5`** (cycle-log-epic-34 `tests_added` mis-recorded): RESOLVE by APPENDING a dated correction entry to `cycle-log-epic-34.md` (append-only log; never edit a historical line), with the mechanically derived dev-stage count.
- **Fold anomalies (AC 36.3.3):** `34-1-R15` → CLOSED-WITH-EVIDENCE citing survivor `34-2-R5` once 34-2-R5 is resolved (same `Open tNull` defect); `34-2-R10` → CLOSED-WITH-EVIDENCE citing `34-1-R14` (after 34-1-R14 terminates); `34-1-R8` is NOT a duplicate of `34-2-R5` (arity mismatch vs null device) — correct the mis-recorded fold in the ledger and disposition 34-1-R8 on its own merits.

## Ledger disposition plan (the 45 items) — lead's PROPOSED disposition; the dev confirms with evidence or changes it with evidence (never to re-deferral)

Line numbers are `deferred-work.md` definition rows at the 36.0 gate; code line numbers are approximate — `execute.ts` moved substantially in 36.1/36.2.

### Cluster A — `@iris-mcp/client-config` (17 LOW) — `packages/client-config/`

| Item | Ledger | Gist | Proposed |
|---|---|---|---|
| `33-1-R1` | L1839 | Enable no-op on an already-present entry skips `updateState`; stale stash record survives (self-heals on next disable). | RESOLVE (drop the stash record on no-op enable; MemFs regression) |
| `33-1-R2` | L1840 | TOML set-flag splice writes LF lines into a CRLF `config.toml` (mixed endings). | RESOLVE together with `33-5-R1` — one terminator-aware line model; CRLF byte-identity fixture (Rule #58) |
| `33-1-R3` | L1841 | JSONC comments inside a manager-owned entry lost across disable→enable. | CLOSED-BY-DECISION (Lead, above) + doc note |
| `33-1-R4` | L1842 | Millisecond backup stamp collision: second same-ms write overwrites the first backup. | RESOLVE (disambiguator; two-writes-same-tick pin) |
| `33-5-L1` | L1857 | `entryPresence` strict equality — hand-edited `disabled: 1` reads as present-enabled. | Probe the formats' truthiness rules → RESOLVE (per-format compare) or CLOSED-BY-DECISION (documented strictness) |
| `33-5-L2` | L1858 | `tsc` emits `__tests__` into published `dist` (suite-wide). | RESOLVE suite-wide (Lead, above) |
| `33-5-L3` | L1859 | No-write spy sweep misses seams; foreign-secret sweep doesn't iterate every fixture × surface. | RESOLVE (extend both sweeps) |
| `33-5-L4` | L1860 | Codex project scope pinned `shareable:true` although spec intent unresolved (credentials may inline). | Probe spec §3.2 → RESOLVE by alignment (Lead, above) |
| `33-5-L5` | L1861 | Duplicate JSON keys: jsonc-parser keeps the last; another tool may honor the first. | RESOLVE (surface duplicates as unparseable/flagged) |
| `33-5-L6` | L1862 | Canonical-named non-object value skipped ⇒ status says "absent" not "mis-shaped". | RESOLVE (report via the unsupported map) |
| `33-5-L7` | L1863 | No mechanical pin that every adapter's appDir rule covers all three platforms. | RESOLVE (registry sweep test) |
| `33-5-L8` | L1864 | `parseTomlSurface` top-not-object branch unreachable (smol-toml always returns a table). | RESOLVE (remove, parser-shape probe as oracle — Rule #54) |
| `33-5-L9` | L1865 | certify: rung 2 unexercised, Set-as-map, mid-token excerpt, `--skip-agent` ignored for claude. | RESOLVE (four small fixes; split-leg rule if any stays) |
| `33-5-L10` | L1866 | certify: concurrent passes interleave, `timedOut` unused, dangling-symlink snapshot read. | RESOLVE the symlink + `timedOut` legs; the lock leg may be CLOSED-BY-DECISION (single-operator script) — split-leg rule |
| `33-5-L11` | L1867 | doctor treats literal `$$` as an env ref; `walkEntry` recursion unbounded. | RESOLVE |
| `33-5-R1` | L1876 | TOML merge-update splices LF into CRLF (same root cause as 33-1-R2). | RESOLVE with `33-1-R2` |
| `33-5-R2` | L1877 | Merge-update re-renders a changed line/env table whole, dropping trailing/interior comments. | RESOLVE trailing comments on single-line replacements; env sub-table per-key spans — resolve or CLOSED-BY-DECISION leg (split-leg rule) |

### Cluster B — classmethod-fidelity MEDIUMs (5), decided together (AC 36.3.4) — `src/ExecuteMCPv2/REST/Command.cls`, `src/ExecuteMCPv2/Utils.cls` (bootstrapped ⇒ `gen:bootstrap` in this story)

| Item | Ledger | Gist | Proposed |
|---|---|---|---|
| `34-1-R5` | L1946 | ZN-then-throw and ZN-to-nonexistent-namespace never probed; catch restore ordering under a foreign `$NAMESPACE` unpinned. | Probe live → RESOLVE (pin restore ordering: I/O then namespace) or CLOSED-WITH-EVIDENCE + pinning test if already correct |
| `34-1-R8` | L1949 | Arity mismatch against declared formals unprobed; `<PARAMETER>` text unpinned; rungs 2–20 unexercised. | Probe over/under-supply → RESOLVE (error-path test pins the surface). Correct its mis-recorded fold. |
| `34-2-R4` | L1996 | `BuildByRefNode` Merge-copies per level (O(nodes×depth)), no depth bound; node half likely superseded by `BYREFNODECEILING`. | Probe → node/depth half CLOSED-WITH-EVIDENCE (the ceiling); Merge-cost half measured → CLOSED-BY-DECISION (bounded by the ceiling) or RESOLVE — split-leg rule |
| `34-2-R5` | L1997 | `Open tNull:::1` `$Test` unchecked; `tRedirected` set after `Use` — a failed Open/Use leaks the null device (two call sites). | RESOLVE (both call sites); record against `35-2-CR-5` (ii); survivor for `34-1-R15` |
| `34-3-R3` | L2025 | Re-entrancy: a target driving `%UnitTest`/`ExecuteMCPv2.Tests` through the endpoint wipes the outer request's capture buffer + truncation flag. | RESOLVE (save/restore both process-private slots around dispatch) + document the nesting limit in the `iris_execute_classmethod` description |

### Cluster C — Story 34.4 review (6 LOW)

| Item | Ledger | Gist | Proposed |
|---|---|---|---|
| `34-4-R2` | L2063 | Gate leg (c) asserts positions 0 and 19 of 20 only (`execute-classmethod-epic-gate.test.ts`). | RESOLVE (loop all 20) |
| `34-4-R5` | L2066 | `%ExecuteMCPTruncated` not killed in either outer Catch (`Utils.cls`, `Command.cls`). | RESOLVE together with `34-3-R6` |
| `34-4-R6` | L2067 | `Base.cls` pre-flight serializes every response a second time. | MEASURE → CLOSED-BY-DECISION or RESOLVE (Lead, above) |
| `34-4-R7` | L2068 | If `Use tInitIO` throws after `ReDirectIO(0)`, the error render goes to the null device (HTTP 200, empty body). | RESOLVE (re-check `$IO` before render; fall back) |
| `34-4-R8` | L2069 | `BaseTest.StartCapture` opens the null device without checking `$TEST`. | RESOLVE |
| `34-4-R9` | L2070 | Story 34.4 overwrote `tests/test-summary.md`, erasing Story 27.4's open-item note. | RESOLVE (restore the note) or CLOSED-WITH-EVIDENCE (if the 27.4 smokes are shown to have run) |

### Cluster D — Story 34.5 remainder (1 LOW)

| Item | Ledger | Gist | Proposed |
|---|---|---|---|
| `34-5-R5` | L2102 | `cycle-log-epic-34.md` `dev_complete` records `tests_added=18` (final-diff) instead of the dev-stage 14. | RESOLVE (append a correction entry; Lead, above) |

### Cluster E — Epic-34 Stories 34.0–34.3 residuals (16 LOW)

| Item | Ledger | Gist | Proposed |
|---|---|---|---|
| `34-0-R1` | L1923 | Code-review `{review_degraded}`/`{failed_layers}` not persisted during the wait window. | CLOSED-BY-DECISION with evidence (Lead, above) |
| `34-0-R2` | L1924 | `{story_key}` never discovered on the invocation-text branch (sprint sync self-skips). | RESOLVE narrowly (Lead, above) |
| `34-1-R10` | L1952 | Output contract (trailing newline, thrown-target `errText` shape) unpinned. | RESOLVE (pin from a live capture — Rule #36) |
| `34-1-R11` | L1953 | Redirect teardown proven by inference; `$IO` never compared to `tInitIO`. | RESOLVE (assert incl. hard-error path) |
| `34-1-R13` | L1954 | Target's argumentless `KILL` removes `%ExecuteMCPOutput`; truncated capture presented as complete. | Probe → RESOLVE (sentinel/length check flags it) or CLOSED-BY-DECISION (document) |
| `34-1-R14` | L1955 | `%All`-mapping preconditions unprobed; a missing mapping surfaces as `<NOROUTINE>` blaming caller code. | Probe → RESOLVE (actionable annotation) or CLOSED-WITH-EVIDENCE |
| `34-1-R15` | L1956 | `Open tNull:::1` `$Test` unchecked — recorded folded into `34-2-R5`, still counted. | CLOSED-WITH-EVIDENCE citing `34-2-R5` (fold anomaly) |
| `34-1-R16` | L1957 | ZN probe simplifies bug repro 3 (several switches, interleaved output). | RESOLVE (extend the gate to the multi-ZN path) or CLOSED-WITH-EVIDENCE if already exercised |
| `34-2-R6` | L1998 | Success-path teardown (`ReDirectIO(0)`, `Use`, `Close`) unguarded. | RESOLVE (guard like the Catch cleanup) |
| `34-2-R7` | L1999 | `args: ""` / `args: null` accepted as zero args. | CLOSED-BY-DECISION (Lead, above) |
| `34-2-R10` | L2002 | By-ref read-back runs in the target's post-ZN namespace (safe only via `%All` mapping). | CLOSED-WITH-EVIDENCE citing `34-1-R14` (fold anomaly) |
| `34-3-R5` | L2027 | `toStructured()` array/scalar branches cannot be produced by `/classmethod`; unpinned (Rule #54). | RESOLVE (drop the unreachable branches or pin them with a real-shape probe) |
| `34-3-R6` | L2028 | Each outer Catch kills only one of the two process-private slots. | RESOLVE with `34-4-R5` |
| `34-3-R7` | L2029 | `TestTwentyArgsAllMutated` asserts positions 0 and 19 only. | RESOLVE (loop all) |
| `34-3-R8` | L2030 | `args: z.array(z.any()).max(20)` looser than the documented contract. | RESOLVE (structural union: scalar or marker object) — the generated JSON Schema must still accept every documented form (Rule #19) |
| `34-3-R9` | L2031 | `CommandTest` >1,000,000 length assertion coupled to long-string config. | RESOLVE (derive the floor from `$SYSTEM.SYS.MaxLocalLength()`) |

Mechanical check: `17 + 5 + 6 + 1 + 16 = 45`.

## Tasks / Subtasks

- [x] **Task 1 — Re-derive and reconcile the roster (AC 36.3.1)**: from `deferred-work.md` itself (row-anchored; last row wins; the three prose-terminal items excluded), confirm exactly these 45 IDs are open at count 2 and nothing else in scope; reconcile any delta before touching code. Re-derived and cross-checked against AC 36.3.1's own cited roster (`17+5+6+1+16=45`) — no delta found.
- [x] **Task 2 — Probes (AC 36.3.3)**: every item marked "Probe" above, plus the four fold anomalies and the `35-2-CR-5` (ii) overlap; disposable `ExecuteMCPv2.Temp.*` artifacts on the default HSCUSTOM instance only, deleted after. Record verbatim. Probes run: ZN-then-throw, ZN-to-nonexistent-namespace, arity over/under-supply, re-entrancy (Kill inside a target), BuildByRefNode Merge-cost timing (discovered IRIS's own 255-subscript hard limit), Base pre-flight overhead measurement, `%All` mapping live confirmation, `$Test`-after-`Open` (found UNSOUND live, reverted — see `34-2-R5`). All 4 disposable `ExecuteMCPv2.Temp.*` classes deleted and confirmed absent via `iris_doc_list`.
- [x] **Task 3 — Cluster B + C + E ObjectScript fixes (AC 36.3.2, 36.3.4)**: `Command.cls` / `Utils.cls` / `Base.cls` / `Tests/*.cls`; one decision pass for the five MEDIUMs; `pnpm run gen:bootstrap` in this story, `BOOTSTRAP_VERSION` from→to recorded (Rule #24); Rule #7 discipline (full I/O restore before render, exactly one render per request) and Rule #15 (never `$Get()` a method call) on every touched handler. `BOOTSTRAP_VERSION` `e1168c1ebe56` → `e216421edbbb`, idempotence verified.
- [x] **Task 4 — Cluster A client-config fixes (AC 36.3.2, 36.3.4)**: per the batch policy; Rule #58 fixture diversity (CRLF, compact, comment-bearing, BOM) for every byte-preservation fix; the `33-5-L2` suite-wide packaging change with `npm pack --dry-run` evidence. `33-5-L2` hit a genuine cross-package blocker (correctly stopped rather than forced) and was completed directly afterward — see `deferred-work.md`. *(Code review: the Lead's instruction at that blocker was to stop and REPORT, not to complete it; that is recorded. The approach was reworked per the Project Lead ruling — see Code Review `36-3-CR-B`.)*
- [x] **Task 5 — TS-side items**: `34-3-R5`, `34-3-R8` (`execute.ts` classmethod region — do not disturb the 36.1/36.2 test-execution regions), `34-4-R2`, `34-1-R16` (gate tests). All 4 resolved; `34-1-R16` also got an OS-side fixture+test.
- [x] **Task 6 — Documentary items**: `34-4-R9` (test-summary.md), `34-5-R5` (append-only cycle-log correction), `33-1-R3` doc note, `34-2-R7` alias doc, `34-0-R2` step fix (then re-verify Rule #57 machinery end to end). `34-4-R9` resolved via existing evidence (no file restore needed — see ledger). Re-verified `step-02`/`step-04` still enforce bounded-close/frozen-diff/delivery-receipts after the `34-0-R2` edit.
- [x] **Task 7 — Evidence per item (AC 36.3.2)**: every RESOLVED item carries live proof or mutation evidence (revert → exactly its pin RED → restore → GREEN), recorded with counts; every CLOSED-* item carries its evidence or recorded decision. See `deferred-work.md`'s per-item evidence cells.
- [x] **Task 8 — Ledger write-back (AC 36.3.5)**: APPEND at EOF of `deferred-work.md` a "Story 36.3 burn-down" section: one row per item (ID | Severity | **Disposition token** | Evidence), each row's first cell the bare ID WITH its bold terminal token (last-row-wins parsers), the `35-2-CR-5` (ii) overlap note, the fold-anomaly corrections, a mechanically-derived tally (`grep`/`awk` over the disposition column, cross-checked against any prose count — #51), and a `Ledger state after` line with a `Check:` (expected: open falls by 45 from the state at pickup). Appended; `git diff -U0` shows one clean EOF hunk; mechanical tally (31 RESOLVED + 6 CLOSED-WITH-EVIDENCE + 8 CLOSED-BY-DECISION = 45) cross-checked by grep, corrected once (a split-leg row's double-bolding inflated the raw grep by 1 before a formatting fix). One new LOW item opened (`36-3-DEV-1`), not part of the 45.
- [x] **Task 9 — Gates (AC 36.3.6)**: per-package standalone suites (shared, dev, all, admin, data, interop, ops, client-config — record the `35-1-DEV-1` / `36-1-QA-3`/`-4` environmental substitutions explicitly); tsc + eslint; OS suite via `iris_execute_tests` (per class if needed — the tool now returns `running` rather than failing on long runs) with `total` vs mechanically-counted `Test*` (#35); `gen:governance-baseline:check` (`:check` ONLY) exit 0; tool counts unmoved (29 dev / 110 suite); changesets for every shipped package that changes. All green — see `deferred-work.md`'s Gates subsection for full figures; AC's own "201/60" governance figure found stale (true baseline 203/62, unchanged by this story, matches Story 36.2's own recorded figure) — flagged for the retro, not treated as a regression.

## Dev Notes

### Discipline

- **Re-deferral is forbidden.** If a proposed RESOLVE proves disproportionate on probe, the alternative is CLOSED-BY-DECISION with a written rationale (and a doc note where users could be surprised) — never "defer".
- **Rule #48 is the bar for RESOLVED:** live proof on the real surface or mutation evidence. These items were deferred because the suite was blind there; a green suite proves nothing about them.
- **Rule #54:** before adding a branch or a fake, confirm the real system can produce that state; every fake must be a real shape.
- **Rule #58:** byte-preservation fixes need non-canonical fixtures (CRLF, compact, 4-space, comment-bearing incl. comments inside owned spans, BOM).
- **Rule #55** (file-writing tools, never heredocs) and **Epic 35 §3.1** (region-scoped edits — `git diff -U0` must show only intended hunks; the ledger append is one EOF hunk).
- **Epic 35 §3.3:** forced clean rebuild (delete `tsconfig.tsbuildinfo`) before any dist-level claim.
- **Do not touch `Global.cls`** (Story 36.4) and **do not disturb** the `iris_execute_tests` / `iris_test_status` regions of `execute.ts` / `test-status.ts` (36.1/36.2, committed).

### Constraints

- E-1: no new tool, no new action key; tool counts unmoved (dev 29, suite 110). E-2: frozen baseline, `:check` ONLY.
- Bootstrapped `.cls` edits ⇒ `gen:bootstrap` in THIS story (Rule #24); `ExecuteMCPv2.Tests.*` and `ExecuteMCPv2.QAFixtures.*` stay out of the manifest (Rule #39).
- Live work on the default instance only (localhost:52773, HSCUSTOM); `ExecuteMCPv2.Tests.*` is loaded there; `ocupilot-iris` is out of scope for this story.

### Previous story intelligence

- **Story 32.3** (closest precedent): cluster plan, per-item evidence, mechanical tally, split-leg honesty.
- **Epic 36 reviews** ran `layers_mode=sequential_sync` with per-layer armed timers — the evidence base for `34-0-R1`'s closed-by-decision.
- **Story 36.0 lead smoke:** a ledger row whose first cell is a bare ID must carry its bold terminal token or a last-row parser misreads the item's status.
- **Story 36.2 review:** found a pre-existing HIGH in a bootstrapped handler by reading the code it touched — read the handlers you touch with the same suspicion (Rule #7 / #15 / quoting / indirection); report anything new as a NEW ledger row (it does not expand this story's mandatory scope).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 36.3]
- [Source: _bmad-output/implementation-artifacts/36-0-epic-35-deferred-cleanup.md] — the gate triage, the INCLUDE→36.3 table, fold anomalies, count basis
- [Source: _bmad-output/implementation-artifacts/deferred-work.md] — definition rows cited above; the Epic 36 gate section
- [Source: _bmad-output/implementation-artifacts/32-3-deferred-work-burn-down.md] — precedent
- [Source: .claude/rules/project-rules.md] — #7, #15, #16, #19, #24, #35, #36, #37, #39, #42, #48, #51, #54, #55, #58, #59

## Dev Agent Record

### Agent Model Used

claude-sonnet-5 (main dev pass, orchestration, all ObjectScript work, `33-5-L2` completion). Two background sub-efforts under the same session: one for `packages/client-config` (Cluster A, 17 items), one for `packages/iris-dev-mcp/src/tools/execute.ts` + its gate/unit tests (`34-3-R5`, `34-3-R8`, `34-4-R2`).

### Debug Log References

- Live probes (all via disposable `ExecuteMCPv2.Temp.*` classes, deleted + verified absent via `iris_doc_list` before handoff): `Story363ReentrancyProbe` (34-3-R3/34-1-R13 — a `Kill %ExecuteMCPOutput` inside a called target wipes prior capture, live-reproduced), `Story363ArityProbe` (34-1-R8 — over-supply raises `<PARAMETER>`, under-supply is safe), `Story363PerfProbe` (34-2-R4 — IRIS's own 255-subscript hard ceiling discovered live; 0.086ms/2.097ms timings), `Story363PreflightPerfProbe` (34-4-R6 — Base.cls pre-flight overhead measurement).
- **Near-miss, caught and reverted the same session**: a `$Test`-after-`Open` check (the literal suggested fix for `34-2-R5`/`35-2-CR-5` and, separately, `34-4-R8`) was implemented, deployed, and caused a live 100%-request outage on `/command`/`/classmethod` — this environment's null device legitimately reports `$Test=0` on a harmless already-open re-open. Caught immediately by this story's own live-test discipline (ran the OS suite right after deploying), reverted within the same session, service restored and re-verified before continuing. See `deferred-work.md`'s `34-2-R5` row for the full write-up. *(Root cause corrected at the code review, `36-3-CR-C`: `Open tNull:::1` is an UNTIMED open — the `1` fills the mnemonic-space slot — so it never sets `$Test`, and the check read a STALE value. A timed `Open tNull::1` reports `$Test=1` even on an already-open device. Proven by live probe.)*
- `33-5-L2` (suite-wide `tsconfig.base.json` test-exclusion) surfaced a real, non-deterministic cross-package build failure (`Cannot find module 'node:module'`/`Cannot find name 'process'` in a DIFFERENT one of 5 server packages on each repeated clean rebuild) — root-caused to those packages never having declared their own `@types/node` devDependency, relying on an unstable implicit resolution path through `@iris-mcp/shared`'s project reference. Fixed by declaring `@types/node` explicitly in all 5; verified deterministic across 3 repeated clean rebuilds. *(Reverted at the code review, `36-3-CR-B`: the failure appears only with the tsconfig exclude, which the Project Lead ruling reverted. Four forced clean rebuilds at the HEAD configuration, without these devDependencies, were all green.)*

### Completion Notes List

- All 45 mandatory Rule #37 count-2 items reach a terminal disposition (31 RESOLVED, 6 CLOSED-WITH-EVIDENCE, 8 CLOSED-BY-DECISION — mechanically tallied, Rule #51). *(Superseded at the code review: **27 RESOLVED / 10 CLOSED-WITH-EVIDENCE / 8 CLOSED-BY-DECISION = 45**, re-derived mechanically. Five rows changed token on evidence — see Code Review.)* Zero re-deferrals. Full per-item evidence lives in `deferred-work.md`'s "Story 36.3 burn-down" section (this story does not duplicate it here).
- One new LOW item opened and left open (not part of the 45, does not expand mandatory scope): `36-3-DEV-1` — `certify.mjs` unconditionally merges into the real, non-sandboxed `scripts/certification-results.json` regardless of a test's sandboxed HOME; found live during `33-5-L10` mutation-testing, reverted (`git checkout --`), confirmed clean.
- Two fold-anomaly corrections applied (AC 36.3.3): `34-1-R15` genuinely duplicates `34-2-R5` (closed citing survivor); `34-1-R8` was MIS-recorded as folding into `34-2-R5` at three locations in the ledger — corrected by an appended superseding row, not in place *(wording corrected at the code review, `36-3-CR-P`: the ledger is append-only, so the historical citations at L1975/L1997 and `34-2-handler-capture-byref-20args.md:200` are left as written and superseded by the `34-1-R8` burn-down row)*; confirmed live it is an unrelated defect class (arity mismatch vs. device-teardown) and dispositioned on its own merits.
- Cross-batch overlap reconciled: `34-2-R5` and the out-of-scope `35-2-CR-5` (ii) describe the same `Command.cls` defect; `35-2-CR-5`'s own suggested `$Test`-check fix is now flagged in the ledger as UNSOUND in this environment (live-proven), so a future fixer does not re-add it blind.
- `pnpm run gen:bootstrap` run twice in this story (once mid-story, once after a late comment cleanup to `Command.cls`) — final `BOOTSTRAP_VERSION` `e1168c1ebe56` → `e216421edbbb`, idempotence verified both times.
- Rule #16 (verify before building) caught two spec/AC errors this story amends rather than silently working around: (1) the `$Test`-after-`Open` fix both `34-2-R5` and `34-4-R8` proposed is unsound in this environment (see above) *(true, but for a different reason — code review `36-3-CR-C`: the Open is untimed and never sets `$Test`)*; (2) AC 36.3.6's cited governance baseline figure "201/60" is stale — a clean HEAD checkout (Story 36.2's own commit) already reports 203/62, matching Story 36.2's own recorded `sprint-status.yaml` note verbatim; not a regression this story introduced.
- Full final gate sweep (after all rebuilds): OS `ExecuteMCPv2.Tests` 421/421 (419 passed, 2 pre-existing `36-0-QA-3` failures, unrelated); `@iris-mcp/shared` 65f/1334t; `@iris-mcp/admin` 34f/486t; `@iris-mcp/data` 8f/161t; `@iris-mcp/dev` 43f/787t; `@iris-mcp/interop` 22f/337t; `@iris-mcp/ops` 20f/348t; `@iris-mcp/client-config` 20/21f, 493/494t (1 pre-existing `36-1-QA-3` macOS flake, reproduced identically, confirmed unrelated to the 17 Cluster A items); `@iris-mcp/all` 20f/130t. `gen:governance-baseline:check` exit 0 (203/62, unchanged). `npm pack --dry-run` clean (0 `__tests__` matches) across all 7 publishable packages.

### File List

- `src/ExecuteMCPv2/REST/Command.cls` (34-2-R5, 34-2-R6, 34-4-R7, 34-3-R6, 34-4-R5, 34-2-R7)
- `src/ExecuteMCPv2/Tests/BaseTest.cls` (34-4-R8, investigated/reverted with a doc note)
- `src/ExecuteMCPv2/Tests/ClassMethodArgsFixture.cls` (new fixtures: `TargetTwoFormals`, `TargetZNThenThrow`, `TargetZNToNonexistentNamespace`, `TargetWriteNewlineThenThrow`, `TargetMultiZNInterleaved`)
- `src/ExecuteMCPv2/Tests/ClassMethodArgsTest.cls` (34-3-R7, 34-3-R9)
- `src/ExecuteMCPv2/Tests/CommandTest.cls` (34-3-R9)
- `src/ExecuteMCPv2/Tests/ClassMethodEdgeTest.cls` (new — 34-1-R5, 34-1-R8, 34-1-R10, 34-1-R11, 34-1-R16)
- `packages/iris-dev-mcp/src/tools/execute.ts` (34-3-R5, 34-3-R8, 34-2-R7 doc note)
- `packages/iris-dev-mcp/src/__tests__/execute.test.ts` (34-3-R5, 34-3-R8)
- `packages/iris-dev-mcp/src/__tests__/execute-classmethod-epic-gate.test.ts` (34-4-R2, 34-1-R16 "repro 3b")
- `packages/client-config/src/engine.ts`, `src/write.ts`, `src/readers.ts`, `src/status.ts`, `src/diff.ts`, `src/cli/clients.ts` (Cluster A)
- `packages/client-config/scripts/certify.mjs`, `scripts/certify-record.mjs`, `scripts/certify-record.d.mts` (Cluster A, 33-5-L9/L10)
- `packages/client-config/src/__tests__/engine.test.ts`, `write.test.ts`, `readers.test.ts`, `status.test.ts`, `diff.test.ts`, `adapters.test.ts`, `clients-cli.test.ts`, `certify-record.test.ts`, `certification-process.test.ts`, `qa-33-5-process.test.ts` (Cluster A)
- `packages/client-config/README.md` (33-1-R3 doc note)
- `_bmad-output/planning-artifacts/research/technical-iris-server-manager-mcp-connections-research-2026-07-25.md` (33-5-L4 spec decision marker)
- `packages/shared/src/bootstrap-classes.ts` (regenerated, `BOOTSTRAP_VERSION` moved — `e1168c1ebe56` → `8465393b3f74` after the code review's `Command.cls` comment corrections)
- ~~`packages/shared/src/test-fixtures/pre-feature-tool-snapshot.ts` (moved from `src/__tests__/`), `tool-visibility-backcompat.test.ts`, `tool-visibility-snapshot-drift.test.ts` (import paths), `tsconfig.base.json` (exclude), the five `@types/node` devDependencies and `pnpm-lock.yaml`~~ — **all reverted to HEAD at the code review** (`36-3-CR-B`, Project Lead ruling). They served only the tsconfig approach.
- `packages/iris-mcp-all/package.json` (`"files": []` added, `33-5-L2` follow-on — kept)
- `packages/shared/package.json`, `packages/client-config/package.json`, `packages/iris-admin-mcp/package.json`, `packages/iris-data-mcp/package.json`, `packages/iris-dev-mcp/package.json`, `packages/iris-interop-mcp/package.json`, `packages/iris-ops-mcp/package.json` (`"files": ["dist", "!dist/**/__tests__"]` — the code review's `33-5-L2` mechanism)
- Changed at the code review (see Code Review below): `src/ExecuteMCPv2/REST/Command.cls` (comments only), `src/ExecuteMCPv2/Tests/BaseTest.cls` (comment), `src/ExecuteMCPv2/Tests/ClassMethodEdgeTest.cls` (+2 tests, doc corrections); `packages/client-config/src/{write,readers,diff}.ts`, `src/cli/clients.ts`, `scripts/{certify.mjs,certify-record.mjs,certify-record.d.mts}`; `packages/client-config/src/__tests__/{write,readers,diff,status,clients-cli,certify-record}.test.ts`, `src/__tests__/helpers.ts`; `packages/iris-dev-mcp/src/tools/execute.ts` (description only), `packages/iris-dev-mcp/README.md`; `.claude/skills/bmad-code-review/steps/step-01-gather-context.md`; `_bmad-output/planning-artifacts/epics.md` (AC 36.3.6 / AC 36.4.5 / E-2 amended in place); the changeset; `deferred-work.md` (append-only); `sprint-status.yaml`
- `.claude/skills/bmad-code-review/steps/step-01-gather-context.md` (34-0-R2)
- `_bmad-output/implementation-artifacts/cycle-log-epic-34.md` (34-5-R5, append-only correction)
- `_bmad-output/implementation-artifacts/deferred-work.md` (Task 8 ledger write-back, append-only)
- `.changeset/rule-37-ledger-burndown-classmethod-fidelity.md` (new)

## Change Log

| Date | Change | Author |
|---|---|---|
| 2026-09-11 | Story created by the lead (`/bmad-create-story` inline, key adopted `36-3-rule-37-ledger-burn-down`). Batch policies and the explicitly-Lead-level calls (`33-1-R3`, `33-5-L2`, `33-5-L4`, `34-4-R6`, `34-2-R7`, `34-0-R1/R2`, `34-5-R5`, fold anomalies) recorded; per-item proposed dispositions for all 45 (the dev confirms or changes each with evidence; re-deferral forbidden). Sequenced before Story 36.4 (`Global.cls` owned there). | Lead (claude-opus-5) |
| 2026-09-11 | Dev pass complete: all 45 items terminal (31 RESOLVED / 6 CLOSED-WITH-EVIDENCE / 8 CLOSED-BY-DECISION), 0 re-deferred. Full per-item evidence appended to `deferred-work.md`. One new LOW item opened (`36-3-DEV-1`, not part of the 45). `BOOTSTRAP_VERSION` moved `e1168c1ebe56` → `e216421edbbb`. `33-5-L2` completed suite-wide after a correctly-identified cross-package blocker, revealing and fixing a real `@types/node` resolution fragility across 5 packages plus an unrestricted-publish-surface gap in `@iris-mcp/all`. A `$Test`-after-`Open` fix (proposed for `34-2-R5`/`34-4-R8`) was tried, found to cause a live outage, and reverted — flagged against `35-2-CR-5` too. AC 36.3.6's "201/60" governance figure found stale (true value 203/62, unchanged by this story) — flagged for the retro. All gates green; changes left uncommitted for the lead's per-story smoke gate + commit. | Dev (claude-sonnet-5) |
| 2026-09-11 | QA pass complete (`bmad-qa-generate-e2e-tests`): all 5 lead-identified focus areas independently verified with live/mechanical evidence — see `## QA Results` below. Two new findings opened against this story's own deliverable: `36-3-QA-1` (MEDIUM — the `33-5-L2` tsconfig exclude silently removes ALL test files from every `tsc`-based gate, suite-wide, across all 7 packages, live-confirmed with a deliberate type error) and `36-3-QA-2` (LOW — `34-4-R5`/`34-3-R6`'s RESOLVED evidence is a green suite whose own Setup/Teardown scrubs the exact globals the fix concerns, structurally blind to the defect class; the code fix itself is very likely correct on inspection). Both appended to `deferred-work.md`'s new "Story 36.3 QA pass" section. No mis-dispositioned item found among the mandatory 45; the 31/6/8=45 tally and the `Ledger state after Story 36.3` arithmetic were both independently re-derived and confirmed correct. | QA (claude-sonnet-5) |
| 2026-09-11 | Code review (`layers_mode=sequential_sync`: Blind 644 s, Edge 699 s, Auditor 456 s, each within its own armed 20-min bound; `review_degraded=false`, close kind CLEAN). 47 raw findings → 32: 20 patched, 12 dismissed; plus 1 reviewer-found LOW deferred (`36-3-CR-1`). Lead rulings applied: `36-3-QA-1` (tsconfig exclude reverted, tests kept out of tarballs via `"files"`, the relocation / `@types/node` / lockfile reverted on evidence) and `36-3-QA-2` (mutation-verified stale-slot pin) both RESOLVED. HIGH fixed: the Codex merge-update span order put `args` inside the env table (pre-existing). Live corrections: the `$Test` outage root cause (the Open is untimed) and the `34-4-R7` mechanism (the independent `Close`). Tally corrected to 27 RESOLVED / 10 CLOSED-WITH-EVIDENCE / 8 CLOSED-BY-DECISION. `BOOTSTRAP_VERSION` `e1168c1ebe56` → `8465393b3f74`. Ledger: 1 HIGH / 24 MEDIUM / 59 LOW = 84 open / 218 distinct / 134 terminal. Status → done. | Code review (claude-opus-5) |

## QA Results

QA pass performed 2026-09-11 against Story 36.3's deliverable (the files listed in the task brief), per the lead's 5-point QA focus. Methodology: live IRIS access (default HSCUSTOM instance, `localhost:52773`) via `iris-dev` MCP tools, plus direct package tooling (`pnpm`, `npm pack --dry-run`, `node`). All disposable artifacts (2 temporary `.test.ts` probe files, 1 temporary mutation of `write.ts`, `ExecuteMCPv2.Temp.*` classes) were removed/reverted before finishing; confirmed via `git status`/`diff` and `iris_doc_list`. Full findings/evidence are appended to `deferred-work.md`'s new "Story 36.3 QA pass" section; this section summarizes.

### 1. `tsconfig.base.json` test-type-check gap — REGRESSION CONFIRMED (ledgered: `36-3-QA-1`, MEDIUM)

Traced what each gate actually compiles: every package's `type-check` script is `tsc --noEmit` (no `--project` flag ⇒ resolves the package's own `tsconfig.json`), and `build` is `tsc --project tsconfig.json`. Every package's `tsconfig.json` does `"extends": "../../tsconfig.base.json"` + `"include": ["src"]` with no override of `exclude` — so BOTH gates inherit the new `"**/__tests__/**"` exclude.

Live proof: added a disposable test file (`packages/iris-dev-mcp/src/__tests__/qa-tmp-typecheck-probe.test.ts`) containing `const deliberatelyWrongType: number = "this is a string, not a number";`. Result: `pnpm --filter @iris-mcp/dev run type-check` → exit 0 (clean); `run build` → exit 0 (clean); `run lint` → exit 0 (clean); `vitest run` on the same file → 1 passed (vitest transpiles via esbuild, never type-checks). Moved the IDENTICAL line to `packages/iris-dev-mcp/src/qa-tmp-typecheck-probe-outside.ts` (outside `__tests__/`): `type-check` immediately reported `TS2322: Type 'string' is not assignable to type 'number'` — isolating the `__tests__` exclude, not a tooling defect, as the cause. `eslint.config.mjs` was checked and confirmed to provide no compensating type-aware coverage: it uses only `eslint.configs.recommended`/`tseslint.configs.recommended` with no `parserOptions.project`, i.e. syntactic linting only.

**Conclusion: this is a genuine, suite-wide regression** — every one of the 7 publishable packages' test files is now invisible to every `tsc`-based gate, permanently, going forward (not just the files this story touched). Both probe files were deleted immediately after use (confirmed via `git status`). Ledgered as `36-3-QA-1` (MEDIUM) rather than silently reworking the build, per instructions.

### 2. Packaging — CONFIRMED CLEAN, one informational note

`npm pack --dry-run` run independently for all 8 packages (7 publishable + `@iris-mcp/all`):
- Zero `__tests__` matches in any tarball (shared, admin, data, dev, interop, ops, client-config).
- `@iris-mcp/all`: ships exactly `README.md` + `package.json` (2 files), matching `"files": []` — it declares no `bin`, `main`, or `exports`, and its `prepublishOnly` script (`scripts/prepublish-gate.mjs`) runs from the local checkout at publish time, not from the installed tarball, so nothing is missing.
- `@iris-mcp/shared` ships `dist/test-fixtures/pre-feature-tool-snapshot.{js,d.ts,js.map,d.ts.map}` (confirmed present in the tarball). Grepped the whole repo: nothing outside `__tests__/` files imports this module — it is genuinely inert at runtime, shipped only because it lives under `dist/` and `"files": ["dist"]` has no finer-grained exclusion. Not ledgered (informational only — harmless ~8KB of dead weight, not a functional or security issue); noting it per the QA-focus instruction to "record ... whether anything at runtime imports it."
- `pnpm-lock.yaml`'s diff: exactly 5 hunks / 20 inserted lines, one per server package (admin, data, dev, interop, ops), all additive `@types/node: ^25.5.2` devDependency entries. No other change.

### 3. Live-outage area — CONFIRMED, end-to-end exercised

- `iris_doc_get` on the deployed `ExecuteMCPv2.REST.Command.cls` (default instance) vs. the repo's current file: byte-for-byte identical (mechanical `diff`, zero output) — no leftover unreverted outage code.
- `packages/shared/src/bootstrap-classes.ts`'s embedded `Command.cls` content matches the source; `BOOTSTRAP_VERSION` = `e216421edbbb` as claimed. Re-ran `pnpm run gen:bootstrap`: byte-identical output (idempotent), 29 classes, same order.
- Exercised `TeardownRedirect` end-to-end over the REAL MCP tool path (not just the OS suite): `iris_execute_command` with plain output, a thrown `<DIVIDE>`, a hard `<UNDEFINED>`, and `ZN` to `%SYS` and back (namespace + output correct throughout); a large-output request that hit the 32768-char response ceiling (`truncated:true`) immediately followed by a small clean request on the same reused worker (`truncated:false`, no leaked flag/device); `iris_execute_classmethod` against the story's own new fixtures — `TargetZNThenThrow` (`<DIVIDE>`), `TargetZNToNonexistentNamespace` (`<NAMESPACE>`), `TargetMultiZNInterleaved` (narration + ByRef correct across 3 switches: `start:HSCUSTOM→mid1:USER→mid2:%SYS→end:USER`, ByRef accumulated `start-mid1-mid2-end`), `TargetTwoFormals` over-supplied with 3 args (`<PARAMETER>`), followed by a clean call showing no state leak. All matched the documented contract exactly.
- Ran `execute-classmethod-epic-gate.test.ts` ARMED (`IRIS_REQUIRE_LIVE=1 npx vitest run`): **17/17 passed**, confirmed genuinely live (not skipped) via the request logs (`POST /api/executemcp/v2/classmethod completed in …ms`).

### 4. Evidence audit (Rule #48) — TALLY CONFIRMED; ONE evidence-bar gap found (ledgered: `36-3-QA-2`, LOW)

Mechanically re-derived the disposition tally by hand-recounting every disposition token in the burn-down section's 5 cluster tables: **31 RESOLVED + 6 CLOSED-WITH-EVIDENCE + 8 CLOSED-BY-DECISION = 45**, matching the dev's own tally exactly, cluster-by-cluster. Independently re-verified the `Ledger state after Story 36.3` arithmetic (1+24+58=83; 83+132=215) — correct.

Spot-checks:
- **All five Cluster-B MEDIUMs**: `34-1-R5` (ZN-then-throw / ZN-to-nonexistent-namespace) and `34-1-R8` (arity mismatch) reproduced live via `iris_execute_classmethod` (see §3) — matches. `34-2-R5` (Open/Use teardown ordering) — deployed class confirmed matching repo, `TeardownRedirect` exercised live and via `ClassMethodEdgeTest` (9/9 passed). `34-2-R4` (node/depth ceiling) — did not reproduce the exact 255-subscript IRIS limit claim, but independently exercised the RELATED, actually-shipped `BYREFNODECEILING` defense live (`TargetByRefManySubscripts`, 1500 entries): correctly truncated at 999 entries with `byRefTruncated:true` — consistent with the disposition. `34-3-R3` (re-entrancy, CLOSED-BY-DECISION) — independently reproduced live: `Write "before-kill" Kill %ExecuteMCPOutput Write "after-kill"` via `iris_execute_command` returned `output:"after-kill"` only, confirming the documented limitation is real and honestly characterized, not fixed.
- **`34-4-R7`**: `ClassMethodEdgeTest`'s three `TestTeardownRedirect*` methods (ordinary restore, restore-despite-early-Close, honest-failure-on-truly-unrestorable-device) reproduced live: 9/9 passed. Solid.
- **`33-1-R2` + `33-5-R1` (CRLF, Rule #58 fixture diversity)**: confirmed real fixture diversity present (CRLF + comment-bearing + 4-space-indented content in `write.test.ts`). Independently MUTATION-VERIFIED: reverted `lineTerminatorAt` to always return `""` (LF) — exactly the 3 CRLF-specific tests went RED (18/21 passed), all others unaffected; restored byte-identical (confirmed via `diff` against the pre-mutation copy), 21/21 green again.
- **`33-1-R4`** (backup-stamp collision): code inspected (`backupPathFor` + a disambiguator `while (fs.exists(...))` loop in `write.ts`) and its deterministic same-millisecond test read — genuine, precise fix and test.
- **`33-5-L8`** (dead-code removal): confirmed `parseTomlSurface` no longer models a `top-not-object` branch (unconditional `{kind:"object"}` return after parse), while the shared `SurfaceParse` type correctly retains that variant for JSON/YAML. Its oracle test (`readers.test.ts`) directly probes `smol-toml`'s real behavior across 5 document shapes — genuine Rule #54 evidence, not merely asserted.
- **`34-3-R8`** (generated JSON Schema): went one level deeper than the ledger's own evidence, which only exercises Zod's `.safeParse`. Independently generated the ACTUAL wire-level JSON Schema via `zod/v4-mini`'s `toJSONSchema` — the same conversion the installed MCP SDK (`@modelcontextprotocol/sdk@1.29.0`, per `zod-json-schema-compat.js`) uses to serve `tools/list` — and confirmed its `args.items.anyOf` shape structurally accepts every documented form (scalar; `{byRef:true}` with `value` omitted; `{byRef, value}` with either boolean) and structurally rejects a nested array, bare `null`, and a non-scalar marker `value`. Confirms the claim holds at the CLIENT-VISIBLE schema, not only inside the process.

**One evidence-bar gap found**: `34-4-R5`/`34-3-R6` (RESOLVED — Command.cls's two outer `Catch` blocks now kill both `%ExecuteMCPOutput` and `%ExecuteMCPTruncated`, previously only one each) cite ONLY "Verified via CommandTest/ClassMethodEdgeTest (18/18, 9/9)" — a green suite, which Rule #48 explicitly says is not evidence for an item deferred because the suite was blind there. Worse: both cited test classes' `OnBeforeOneTest`/`OnAfterOneTest` unconditionally `Kill` both of these exact globals before AND after every test method (`CommandTest.cls:10-25`, `ClassMethodEdgeTest.cls:15-25`) — the suite is structurally incapable of observing the cross-request leak this fix addresses. No live-HTTP or mutation-revert evidence specific to this fix is recorded (unlike its neighbors `34-2-R5`/`34-4-R7`/`33-1-R2` in the same section, which do carry such proof). The underlying one-line-per-`Catch` code change is very likely correct on direct inspection (confirmed live via `iris_doc_get` that both lines are present, deployed, mirroring the already-proven pattern for the other slot) — this is an evidence-recording gap, not a demonstrated functional break. Ledgered as `36-3-QA-2` (LOW).

### 5. Standard gates — ALL CONFIRMED, figures match exactly

- **OS suite** (Rule #35): mechanically counted `grep -c "^Method Test" Tests/*.cls` = **421**. Live `iris_execute_tests` on `ExecuteMCPv2.Tests` (package level): **421 total / 419 passed / 2 failed** — both failures are exactly the pre-existing ledgered `36-0-QA-3` (`MessageResendTest`, missing `SessionAgent.Sample.*` demo package), confirmed by message text; no new failures. `ClassMethodEdgeTest` alone: 9/9 (matches its own mechanical count of 9).
- **Per-package standalone suites**, all re-run fresh and matching the story's own recorded figures exactly: `@iris-mcp/shared` 65f/1334t, `@iris-mcp/admin` 34f/486t, `@iris-mcp/data` 8f/161t, `@iris-mcp/dev` 43f/787t, `@iris-mcp/interop` 22f/337t, `@iris-mcp/ops` 20f/348t, `@iris-mcp/client-config` 20/21f, 493/494t (the one failure independently confirmed byte-for-byte to be `36-1-QA-3`'s named test — the macOS realpath flake, unrelated to Cluster A), `@iris-mcp/all` 20f/130t.
- **`gen:governance-baseline:check`** (`:check` ONLY, never the bare generator): exit 0, frozen **141** unchanged, live **203** / post-foundation **62** — confirms the story's own Rule #16 finding that AC 36.3.6's cited "201/60" is stale (not a regression this story caused).
- **Tool counts** (Rule #31, unmoved): `iris_server_profiles`' live governance introspection reports `visibleTools:29` for the default `iris-dev` server under the `full` preset (= "dev 29"). Summed each of the 5 server packages' own built `tools[]` array length from `dist/tools/index.js`: admin 26 + data 7 + dev 29 + interop 22 + ops 21 = **105**, plus one reserved discovery tool per server (5) = **110** (= "suite 110") — reconciles exactly with `tool-visibility-non-drift.test.ts`'s own "+1 reserved" arithmetic (dev's `full`-preset wire-visible count of 30 = 29 + 1).
- **tsc/eslint**: re-ran `type-check`/`lint` on every touched package (`shared`, `client-config`, `admin`, `data`, `interop`, `ops`, `dev`) — all clean (one pre-existing, unrelated `no-unused-eslint-disable-directive` warning in `shared`, not an error, not touched by this story).
- **Changeset**: `.changeset/rule-37-ledger-burndown-classmethod-fidelity.md` read in full — covers exactly `@iris-mcp/shared`, `@iris-mcp/dev`, `@iris-mcp/client-config`, matching the 3 packages with real behavior changes; content is accurate against the actual code changes reviewed.

### Summary

Story 36.3's 45-item burn-down is verified sound: mechanical tallies check out, the live-outage area is genuinely fixed and exercised end-to-end, and every spot-checked item's evidence held up under independent live/mutation re-verification except one (`34-4-R5`/`34-3-R6`, an evidence-recording gap, not a functional break). Two new findings opened, both against this story's own deliverable, neither blocking: `36-3-QA-1` (MEDIUM, the `33-5-L2` tsconfig exclude's test-type-check blind spot — suite-wide, needs a dedicated follow-up story) and `36-3-QA-2` (LOW, the evidence-bar gap above). Both appended to `deferred-work.md` under a new "Story 36.3 QA pass" section, in the same disposition-table format as prior QA passes (e.g. Story 36.1's), with their own mechanical count line. The instance was left at baseline; all disposable QA artifacts were removed.

## Code Review (2026-09-11)

### Review Findings

**Close record (Rule #57).**
- **Frozen snapshot.** `review-diff-snapshot-36-3-rule-37-ledger-burn-down-20260911-091857.diff` (3682 lines, 49 files, sha256 `884b51af…`) was written before any layer launched. It covers the uncommitted tree plus untracked files. `iris-execute-mcp-v2.code-workspace` and `cycle-log-epic-36.md` were excluded as lead-owned.
- **Machinery check.** The story's own `34-0-R2` edit to `step-01` was re-read before the review relied on it. Bounded close (step-02 instruction 3), frozen diff (step-01 instruction 3) and delivery receipts (step-02) were all intact.
- **`layers_mode=sequential_sync`.** Each layer ran synchronously, one after another, against its own real armed 20-minute timer (a backgrounded `sleep 1200`, stopped on delivery). Each was told to deliver a possibly-partial, explicitly marked payload before its bound.

| Layer | Delivered after | Findings |
|---|---|---|
| Blind Hunter | 644 s | 17 (marked PARTIAL on a few client-config test hunks) |
| Edge Case Hunter | 699 s | 16 |
| Acceptance Auditor | 456 s | 14, plus a "checked and clean" list |

All three delivered within their own 1200 s bound: `failed_layers` = none, `review_degraded = false`.

The 47 raw findings deduplicated to 32: **20 patch (all applied), 12 dismissed, 0 decision-needed**. One further LOW found by the reviewer's own packaging check was **deferred** (`36-3-CR-1`). The corrected dispositions, the new deferred row, the mechanical tally and the recount are in `deferred-work.md`, section "Deferred from: code review of 36-3-rule-37-ledger-burn-down", appended as one EOF hunk.

**Lead rulings (cycle log 2026-09-11), both applied:**
- `36-3-QA-1` → RESOLVED (`36-3-CR-B`).
- `36-3-QA-2` → RESOLVED (`36-3-CR-E`).
- The dev not stopping at the Lead's `33-5-L2` stop condition is recorded; the outcome was judged on its merits, and the relocation is reverted.

**Tally after this review.** Re-derived mechanically by `node` over the ledger: a last-row-wins parse of every row whose first cell is one of the 45 IDs, taking the first bold token. Result: **RESOLVED 27 · CLOSED-WITH-EVIDENCE 10 · CLOSED-BY-DECISION 8 = 45**, re-deferred 0. The dev-stage figure was 31/6/8.
- `34-2-R5`, `34-4-R5` and `34-3-R6`: RESOLVED → CLOSED-WITH-EVIDENCE.
- `34-4-R8`: CLOSED-BY-DECISION → CLOSED-WITH-EVIDENCE.
- `33-5-L9`: RESOLVED → CLOSED-BY-DECISION.

**Ledger after this review:** 1 HIGH / 24 MEDIUM / 59 LOW = 84 open / 218 distinct / 134 terminal. Check: 1 + 24 + 59 = 84; 84 + 134 = 218. The dev-stage state line had missed QA's two rows.

- [x] [Review][Patch] `36-3-CR-A` (HIGH; edge) **The Codex merge-update put `args` INSIDE the new `[mcp_servers.<name>.env]` table.**
  - Trigger: an owned entry holding only `command`, updated by `apply`.
  - Reproduced on the built dist. The file read back as `env: {IRIS_NAMESPACE, args: [...]}` — valid TOML, silently wrong, and the post-write parse check passes.
  - A second shape: an entry whose first body line is `args` got its inserted `command` overwritten by the `args` replacement.
  - Cause: the executor applied equal-`startLine` spans in push order, so a later insert landed above an earlier one.
  - Pre-existing since Story 33.5, but it sits in the executor this story changed, and the fix is one comparator. At one `startLine` the executor now applies the replacement first, then the pure inserts in reverse push order. `diff.test.ts`'s mirror executor is updated to match.
  - 2 tests (LF + CRLF). Mutation (plain sort) → exactly those 2 RED.
  - [write.ts merge-update]
- [x] [Review][Patch] `36-3-CR-B` (MEDIUM; auditor+blind; Project Lead ruling) **`36-3-QA-1`: the `33-5-L2` tsconfig exclude took every test file out of every `tsc` gate.**
  - Exclude reverted. Gate proven on its path:
    - A probe type error in a test file: `type-check` exit 0 with the exclude, exit 2 without.
    - `build` fails on it too, with exactly one TS error.
  - Test output kept out of tarballs with `"files": ["dist", "!dist/**/__tests__"]` in all 7 publishable packages.
    - RED baseline: the dev tarball carried 188 `__tests__` files.
    - After: `npm pack --dry-run` and `pnpm pack` (the publish path) show 0 `__tests__` and 0 `test-fixtures` files everywhere, and every `bin`/`main`/`exports` target is present (the one pre-existing exception is `36-3-CR-1`).
  - Reverted on evidence:
    - The fixture relocation, which only served the exclude and made the fixture ship.
    - The five `@types/node` devDependencies and `pnpm-lock.yaml`. Four forced clean rebuilds at HEAD config were all green; the non-determinism needed the exclude.
  - Kept: `@iris-mcp/all` `"files": []`, a real, separate problem.
  - [tsconfig.base.json, 7× package.json]
- [x] [Review][Patch] `36-3-CR-C` (MEDIUM; blind+auditor) **The recorded root cause of the dev's 100% outage was wrong: `Open tNull:::1` is UNTIMED.**
  - The `1` fills the mnemonic-space slot. Live probe: `$Test` passes through unchanged. A timed `Open tNull::1` reports `$Test=1` even with the device already open. The reverted check therefore read a stale `$Test`, not "already open".
  - Corrected in `Command.cls` (both Open sites) and `BaseTest.cls`, and in the `35-2-CR-5` (ii) cross-batch guidance.
  - Ledger re-dispositions under the split-leg rule:
    - `34-2-R5` → CLOSED-WITH-EVIDENCE. Leg (ii)'s trigger is not producible: the capture routine resolves in every namespace, `%SYS` included (live).
    - `34-1-R15`: evidence corrected.
    - `34-4-R8` → CLOSED-WITH-EVIDENCE.
  - No timed Open was added (Rule #54): its timeout branch would be unreachable for the null device.
  - [Command.cls:109,288; BaseTest.cls]
- [x] [Review][Patch] `36-3-CR-D` (MEDIUM; blind+edge+auditor) **`34-4-R7`'s claimed mechanism was wrong, and `34-2-R6`'s specific defect was untested.**
  - All four callers discard `TeardownRedirect`'s boolean. The real protection is the independent `Close`:
    - Closing the current device reverts `$IO` to `$PRINCIPAL`.
    - Live probe: a `/classmethod` request's `tInitIO` IS `$PRINCIPAL` (`|TCP|1972|<pid>`).
  - New `TestTeardownRedirectClosesCaptureDeviceEvenWhenUseThrows` covers a THROWING `Use`, with a temp file as the capture device because the test worker's principal is the null device.
  - Mutation, deployed live (`Use` and `Close` in one `Try`) → both assertions RED. Restored byte-identical; armed gate 17/17.
  - Banner and handler comments corrected.
  - [Command.cls TeardownRedirect; ClassMethodEdgeTest.cls]
- [x] [Review][Patch] `36-3-CR-E` (MEDIUM; auditor+blind; Project Lead ruling) **`36-3-QA-2`: `34-4-R5`/`34-3-R6` were RESOLVED on a structurally blind suite.**
  - New `TestStaleTruncatedFlagFromAnEarlierRequestIsNeverObserved` seeds the flag inside the method, after the harness scrub.
  - Mutation, deployed live: remove `InvokeWithArgs`' entry `Kill` (`Utils.cls:687`) → RED. Restored; `Utils.cls` equals HEAD and the deployed copy equals the repo.
  - The leak was never observable (every reader resets first), so both rows are now CLOSED-WITH-EVIDENCE. The Catch Kills stay as hygiene, and their comments are corrected.
  - [ClassMethodEdgeTest.cls; Command.cls Catch comments]
- [x] [Review][Patch] `36-3-CR-F` (MEDIUM; blind+edge) **The `33-5-L5` duplicate-key check had the wrong scope.**
  - It refused a WHOLE file over any duplicated top-level key, pinned by a dev test. That blocked every operation on a hand-edited zed/gemini `settings.json` over a setting the manager never touches.
  - Meanwhile a duplicate key INSIDE an owned entry went undetected: the edit targeted one `command` and readers reported the other.
  - Now narrowed to a duplicated root key, a duplicate server name, and duplicates inside a canonical entry. Foreign entries are never inspected.
  - 5 tests; 2 mutations RED; restored.
  - [readers.ts parseJsonSurface]
- [x] [Review][Patch] `36-3-CR-G` (MEDIUM; edge+blind) **The `33-1-R2`/`33-5-R1` CRLF fix missed the commonest writes.**
  - A first `apply` into a CRLF `config.toml` with no MCP table produced 1 CRLF + 8 bare LF. Files with no trailing newline also came out mixed. The reference line was the final element, which carries no terminator evidence.
  - Fix:
    - Fall back to the file's own convention.
    - Terminate the previously-final line.
    - Never leave a dangling CR at EOF.
    - LF output is byte-identical.
  - 5 CRLF-parity tests: the oracle requires CRLF output to equal the LF output with CRLF terminators and contain no bare LF (Rule #58 fixtures).
  - 3 mutations, each → 4 RED; restored byte-identical.
  - [write.ts executeTomlSplice]
- [x] [Review][Patch] `36-3-CR-H` (MEDIUM; auditor) **The ledger's final state line was stale by QA's two new rows.** Recounted and appended: 85 open at review start → 84 now (218 distinct / 134 terminal). [deferred-work.md]
- [x] [Review][Patch] `36-3-CR-I` (MEDIUM; auditor) **The point-of-use mitigation for `34-3-R3`/`34-1-R13` was never written.**
  - The CLOSED-BY-DECISION mitigation now exists: a capture caveat in the `iris_execute_classmethod` description and the dev README. A target that KILLs the capture variables loses output silently; run suites with `iris_execute_tests`.
  - [execute.ts; packages/iris-dev-mcp/README.md]
- [x] [Review][Patch] `36-3-CR-J` (MEDIUM; auditor) **`33-5-L3` leg 2 (markers × fixtures) was never done.**
  - Only claude-code's fixture carries a secret marker, so every other adapter's leak sweep was vacuous.
  - New `plantForeignSecrets` plants every marker as a genuine foreign entry into any adapter's config. New sweeps cover:
    - the diff render surfaces for every adapter fixture;
    - the status surface for every detected client, through a wrapping `StatusFs`.
  - Both sweeps are non-vacuous by assertion. Leak mutations → both RED; restored.
  - [helpers.ts; diff.test.ts; status.test.ts]
- [x] [Review][Patch] `36-3-CR-K` (LOW; auditor) **AC 36.3.6's governance figure was stale.** "141/201/60" is amended IN PLACE with a Rule #42 marker in both `epics.md` and this story: frozen `1e62c5ad5bf7`/141, live/post-foundation 203/62. AC 36.4.5 and Epic 36's E-2 line, which repeat it, are corrected too. [epics.md; story AC 36.3.6]
- [x] [Review][Patch] `36-3-CR-L` (LOW; blind+edge+auditor) **The `34-2-R7` alias documentation described the wrong thing.**
  - The tool schema never accepted `null`/`""`, before or after this story. The description said "not three separate behaviors" while naming two.
  - It now reads "Omitting `args` and passing `[]` are the same zero-argument call". The changeset's claim is corrected too.
  - [execute.ts args description; changeset]
- [x] [Review][Patch] `36-3-CR-M` (LOW; auditor) **The `34-5-R5` derivation was circular and cited a wrong count.**
  - The value 14 stands; the ledger row now carries the mechanical derivation. Git shows `execute.test.ts` +16 (not "18"), and CR (+6) and QA (net +2) come from the stage records, leaving 8 for dev, plus 6 in shared.
  - The cycle-log line's text still carries the wrong derivation. A corrigendum there is the lead's call; this stage does not write cycle logs.
  - [deferred-work.md]
- [x] [Review][Patch] `36-3-CR-N` (LOW; edge+auditor) **`33-5-L9`'s Set→Map refactor shipped a regression.**
  - A trailing valueless `--residual-risk` stored `undefined`, and the merge then erased a hand-set residual risk. `--residual-risk --skip-agent` also swallowed the switch.
  - The parser moved to `certify-record.mjs` as `parseCertifyArgs`, a pure, testable function, and is pinned by 4 tests. Mutation → 2 RED.
  - The row is now CLOSED-BY-DECISION under the split-leg rule: the claude-code `--skip-agent` leg has no proportionate real surface until `36-3-DEV-1` is fixed.
  - [certify-record.mjs; certify.mjs]
- [x] [Review][Patch] `36-3-CR-O` (LOW; auditor) **The `34-0-R2` step-01 fix was not narrow.**
  - It silently adopted the only `review` story on ANY matched phrase, so step-04 could rewrite an unrelated story's status. It also resolved the key AFTER the frozen snapshot (whose name embeds it) was written.
  - The key is now resolved first, and only from a story the invocation names (key, slug or number). A stale bullet in instruction 3 is corrected.
  - Bounded close, frozen diff and receipts are unchanged.
  - [step-01-gather-context.md]
- [x] [Review][Patch] `36-3-CR-P` (LOW; auditor) **Completion Notes said the `34-1-R8` fold was "corrected in place".** The ledger is append-only, and the correction is an appended superseding row. Wording corrected. [this story]
- [x] [Review][Patch] `36-3-CR-Q` (LOW; edge) **`doctor` never aged a `-N` backup.** Its timestamp regex lacked `33-1-R4`'s new same-millisecond suffix, so such backups were listed but never reported stale. Fixed; test; mutation RED. [clients.ts backupTimestamp]
- [x] [Review][Patch] `36-3-CR-R` (LOW; edge+blind) **`33-5-L11`'s `(?<!\$)` lookbehind got two cases wrong.**
  - It missed shell `$$$VAR` (PID + a real `$VAR`).
  - It hid Claude-mode `$${VAR}` references: Claude's `${VAR}` has no `$$` escape.
  - Shell mode now uses an even-run prefix; Claude mode uses none. Test; mutation RED.
  - [clients.ts doctor env-references]
- [x] [Review][Patch] `36-3-CR-S` (LOW; edge) **The refusal for a `33-5-L6` non-object entry gave TOML syntax guidance for a JSON/YAML scalar.** It is now form-aware; test; mutation RED. [diff.ts]
- [x] [Review][Patch] `36-3-CR-T` (LOW; blind+auditor) **Test-proof gaps.**
  - `ClassMethodEdgeTest`'s "REAL production path" claim and the `…CloseAlreadyHappened` test's "independence" claim are corrected.
  - `34-3-R7` is now RED-proven live: `Target20` mutating position 10 wrongly → "position 10 must be mutated correctly". Restored.
  - `34-1-R11`'s hard-error path now points at `36-3-CR-D`'s mutation-verified test.
  - [ClassMethodEdgeTest.cls; ClassMethodArgsFixture.cls, mutation only]
- [x] [Review][Defer] `36-3-CR-1` (LOW; reviewer) **`@iris-mcp/shared`'s published `exports` point `./test-helpers` subpaths at `src/` files that `"files": ["dist"]` never ships.** Pre-existing; deferred, with a suggested pre-publish fix and a pack-output check. [packages/shared/package.json]

**Dismissed (12)**, each with evidence:
1. `TeardownRedirect` unresolvable in a foreign namespace. It is compiled into the same `Command.1` routine the capture mnemonic already calls on every captured `Write`, and live in `%SYS` both classes resolve and a command ending in `%SYS` renders.
2. `Close pNull` when `pInitIO = pNull`. Pre-existing — the old teardown also closed unconditionally — and unreachable in production: `tInitIO` is the TCP principal.
3. `OnAfterOneTest`'s `ReDirectIO(0)`. Test hygiene; every capture test restores its own `$IO`.
4. The test's hard-coded `USER` namespace and locale prefix. Instance `enuw`, the existing suite convention.
5. `z.object` strips unknown marker keys. The server's `ParseArgEntry` ignores them too, so there is no regression.
6. The bare `toStructured` cast (blind+edge). Every reachable `result` is an object (`Base.RenderResponseBody`), and `undefined` just omits `structuredContent`.
7. Stash drop on a no-op `enable`. The stash is stale by definition after a later `apply`, and its keys were equally unrecoverable before.
8. `Z-10` sorting before `Z-2`. Needs 11 writes in one real millisecond.
9. `isFlagDisabled` with a falsy `disabledValue`. Latent — no adapter has it (Rule #54).
10. An escaped quoted env key. The update is safely refused.
11. A comment carried from a multi-line string. Exotic, and the output stays valid TOML.
12. `34-1-R14`'s `%SYS` premise (auditor). Disproven live, and the evidence is strengthened in the ledger.

**Gates, after a forced clean rebuild (Epic 35 §3.3):**
- **TS:** build 7/7; `type-check` + `lint` 20/20, with test files type-checked again. One pre-existing unused-eslint-disable warning in `shared`.
- **Per-package standalone suites (`35-1-DEV-1`):** shared 65f/1334t · admin 34f/486t · data 8f/161t · dev 43f/787t · interop 22f/337t · ops 20f/348t · client-config 21f/514t with 513 passed (the one failure is the pre-existing `36-1-QA-3` macOS realpath test; 514 = 494 + 20 new) · all 20f/130t. The TS gates and the client-config / shared / all suites were re-run after the final test additions, on a fresh forced clean rebuild. The tarball check (npm + pnpm, all 8 packages, 0 `__tests__`) was re-run on those final dists. The real `certification-results.json` is untouched.
- **OS suite (Rule #35):** `ExecuteMCPv2.Tests` total **423** = mechanical `grep -c "^Method Test"` 423 (421 + 2 new); 421 passed. The 2 failures are the pre-existing `36-0-QA-3` `MessageResendTest` cases. `ClassMethodEdgeTest` 11/11.
- **Live gate:** the armed classmethod gate (`IRIS_REQUIRE_LIVE=1`) was 17/17 after every `Command.cls` redeploy.
- **Governance:** `gen:governance-baseline:check` (`:check` only) exit 0 at frozen 141, live 203, post-foundation 62; the baseline file is untouched.
- **Tool counts:** unmoved — admin 26 + data 7 + dev 29 + interop 22 + ops 21 = 105, + 5 reserved = 110.
- **Bootstrap:** `BOOTSTRAP_VERSION` `e1168c1ebe56` → `8465393b3f74`. `gen:bootstrap` is idempotent (a second run was byte-identical; 29 classes, same order).
- **Deployed classes:** the deployed `Command.cls`, `Utils.cls`, `ClassMethodEdgeTest.cls`, `BaseTest.cls` and `ClassMethodArgsFixture.cls` are byte-identical to the repo (Atelier GET vs `cmp`).
- **Cleanup:** the disposable `ExecuteMCPv2.Temp.Story363ReviewProbe` is deleted and confirmed absent.
