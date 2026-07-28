# Story 33.5: Late-Findings Cleanup (review layers returned post-commit)

Status: done

## Story

As an iris-mcp maintainer,
I want the still-live findings from the late-returning 33.0/33.4 review layers terminally dispositioned,
so that two confirmed HIGHs (parse-error content leak, apply-update key wipe) and the live MEDIUMs don't ship to the merge.

## Origin (lead triage, 2026-07-28)

All five Epic-33 reviews closed on silent layers; the layers then returned post-commit (the Epic-32 §3.1 pattern, now confirmed systemic). Lead triage of ~50 raw findings across the 33.0 and 33.4 batches, deduped: **~40% stale** (fixed in-story by the 33.0 review, 33.1, or the 33.2 byte-preservation rework; or falsified by 33.4's Kimi probe). The 33.1/33.2/33.3 layer batches returned idle-only (no findings payloads). Every included item was re-probed live by the lead or carries a layer's live reproduction.

## Acceptance Criteria

1. **AC 33.5.1 (HIGH, lead-probed live 2026-07-28)** — TOML (and probed YAML) parse errors no longer echo source lines: `readConfigEntries`/`diagnoseConfigSurface` error text carries reason + line:col/code only (the JSONC `formatJsoncErrors` discipline), never file content. Regression pins plant a secret marker on the offending line for both parsers and assert absence from status/doctor/`--json` surfaces.
2. **AC 33.5.2 (HIGH, lead-probed live 2026-07-28)** — `apply` (update mechanism) preserves unmanaged keys on owned entries (`autoApprove`, `timeout`, user env extras) and NEVER changes enablement state: a `disabled: true` entry stays disabled through apply; the native flag is not stamped onto an update that the user didn't request as a toggle. Confirm text surfaces key preservation.
3. **AC 33.5.3 (MEDIUM)** — TOML region math is multi-line aware: `"""` strings and multi-line arrays inside owned tables don't truncate regions (string-aware scan or a documented refusal naming the form); a comment between the previous property and an owned LAST JSON property doesn't leave a dangling comma (probe first — the 33.2 rework may already cover it).
4. **AC 33.5.4 (MEDIUM)** — A comment-only JSONC file (`// just a comment`) is a VALID empty document (VS Code accepts it), not `unparseable`; a TOML datetime literal at the root key defeats neither drift guard nor entry classification (`isPlainObject` rejects Date instances).
5. **AC 33.5.5 (MEDIUM)** — `status` never throws when an injected `exists` probe throws (per-probe degradation, the detect.ts:77-80 pattern).
6. **AC 33.5.6 (MEDIUM, harness)** — certify.mjs: (a) a failed pass never overwrites a passing record (keep-passing guard); (b) re-running merges per-client records instead of wholesale-replacing (preserves hand-authored `sharing`/`ac3344` evidence); (c) unsupported verification surfaces fail fast BEFORE any real-config write; (d) the clobber-gate refusal names the `iris-mcp-clients restore` recovery path.
7. **AC 33.5.7 (LOW batch)** — `__proto__` foreign entries surfaced (defineProperty/Object.create(null) reader discipline); TOML array-of-tables classified (or documented refusal); `serializeTomlEntry` quotes non-`[A-Za-z0-9_-]` keys + escapes control chars; doctor emits no restart-hint block for config-drift findings; the generated certification table carries the file-level-vs-agent-side qualifier (aa-33-4 #1); docs npx headers carry the unpublished caveat (aa-33-4 #4, verify 33-4-R5's coverage); certify.mjs CLIENT_IDS derived from `CLIENT_ADAPTERS`, not a hand-mirrored literal; kimi re-run note connects the explicit-mode requirement (aa-33-4 #3); pass-created empty backup dirs + non-preexisting session-index cleanup completed.

## Integration ACs

**No new consumers** — cleanup story (Rule 1 N/A). Every fix is verified through the built CLI's real surfaces (`status`/`doctor`/`apply` over sandbox configs), per Rule #48's live-or-mutation bar.

## Triage table (all ~50 raw items, terminal dispositions — Rule #37)

| # | Item | Source | Disposition |
|---|------|--------|-------------|
| 33-5-1 | apply-update wipes unmanaged keys + implicit re-enable | blind-33.0 #1, edge-33.0 M5 | **INCLUDE** (AC 33.5.2) — lead-probed live |
| 33-5-2 | TOML/YAML parse-error content leak | edge-33.0 H1, blind-33.0 #5, eh-33-4 #1 | **INCLUDE** (AC 33.5.1) — lead-probed live (TOML) |
| 33-5-3 | TOML multiline string/array region corruption | blind-33.0 #3, edge-33.0 H3 | **INCLUDE** (AC 33.5.3) |
| 33-5-4 | comment-between-comma dangling comma | edge-33.0 M2 | **INCLUDE** (AC 33.5.3 — probe first) |
| 33-5-5 | status throws on throwing exists | edge-33.0 M1 | **INCLUDE** (AC 33.5.5) |
| 33-5-6 | comment-only JSONC → unparseable | eh-33-4 #3 | **INCLUDE** (AC 33.5.4) |
| 33-5-7 | TOML datetime defeats shape guard | eh-33-4 #2, bh-33-4 L1 | **INCLUDE** (AC 33.5.4) |
| 33-5-8 | certify: failed pass clobbers good record | bh-33-4 M1, eh-33-4 #4 | **INCLUDE** (AC 33.5.6a) |
| 33-5-9 | certify: re-run destroys hand-authored evidence | bh-33-4 H1 | **INCLUDE** (AC 33.5.6b) |
| 33-5-10 | certify: unsupported surfaces fail after write; clobber refusal lacks recovery hint | eh-33-4 #4, bh-33-4 M2 | **INCLUDE** (AC 33.5.6c/d) |
| 33-5-11 | `__proto__` foreign entry dropped | edge-33.0 L2 | **INCLUDE** (AC 33.5.7) |
| 33-5-12 | TOML array-of-tables invisible | blind-33.0 #8 | **INCLUDE** (AC 33.5.7) |
| 33-5-13 | serializeTomlEntry escaping | blind-33.0 #9, edge-33.0 M3 | **INCLUDE** (AC 33.5.7) |
| 33-5-14 | drift restart-hint non-remedy | bh-33-4 L3 | **INCLUDE** (AC 33.5.7) |
| 33-5-15 | certified-live table qualifier | aa-33-4 #1 | **INCLUDE** (AC 33.5.7) |
| 33-5-16 | docs npx unpublished caveat + kimi re-run mode note | aa-33-4 #3/#4, bh-33-4 M6 | **INCLUDE** (AC 33.5.7) |
| 33-5-17 | certify CLIENT_IDS hand-mirror | aa-33-4 #6 | **INCLUDE** (AC 33.5.7) |
| 33-5-18 | certify session-index/empty-dir residue | bh-33-4 M4, eh-33-4 #8 | **INCLUDE** (AC 33.5.7) |
| — | TOML header regex legal forms | blind-33.0 #2, edge-33.0 H2 | **STALE** (33.0 review HIGH: trailing-comment-aware + refusal) — story verifies |
| — | already-in-state YAML/TOML destructive descriptors | edge-33.0 M4, aa-33.0 #2 | **STALE** (33.0 review null-native redesign) |
| — | tomlEdit missing native-flag branch | blind-33.0 #6 | **STALE** (33.1 shipped `set-flag`; Codex native) |
| — | CRLF insert forcing | blind-33.0 #7 | **STALE** (33.2 rework: file-detected EOL; TOML set-flag CRLF = existing 33-1-R2) |
| — | kimi-code dual-ownership via .mcp.json | blind-33.0 #4 | **STALE** (33.4 falsified + removed) |
| — | trailing-comma stash dangling | aa-33.0 #1 | **STALE** (33.1 QA F3) — story verifies |
| — | strict-JSON read with JSONC tolerance | blind-33.0 #10 | **DISMISSED** (33.0 review: lenient read by design) |
| — | kimi sibling-entry inference label | aa-33.4 #2 | **DISMISSED** (disclosed in residualRisk) |
| — | UTC date stamps | bh-33-4 L8 | **DISMISSED** (benign) |
| — | exists-throwing fake note | aa-33.0 #3 | **DISMISSED** (informational) |
| — | flag strict-equality (`disabled: 1`) | blind-33.0 #11 | **LEDGER** (LOW) |
| — | tests shipped in dist | blind-33.0 #12 | **LEDGER** (LOW — convention decision, mirrors shared) |
| — | proof-surface gaps (spy coverage, marker sweep) | blind-33.0 #13 | **LEDGER** (LOW) |
| — | shareable pin forces codex shareable:true | blind-33.0 #14 | **LEDGER** (LOW — spec decision) |
| — | duplicate JSON keys first/last | edge-33.0 L1 | **LEDGER** (LOW) |
| — | non-object canonical value invisible | edge-33.0 L3 | **LEDGER** (LOW) |
| — | appDir platform-completeness pin | edge-33.0 L4 | **LEDGER** (LOW) |
| — | TOML top-not-object unreachable branch | bh-33-4 L2 | **LEDGER** (LOW) |
| — | certify rung-2 unexercised / flags Set / excerpt truncation / --skip-agent claude | bh-33-4 M5/L4/L5/L6 | **LEDGER** (LOW) |
| — | certify no mutual exclusion / timedOut dead / dangling symlink | eh-33-4 #5/#6/#7 | **LEDGER** (LOW) |
| — | doctor $$ false positive / walkEntry recursion | eh-33-4 #9/#10 | **LEDGER** (LOW) |
| — | tally disagreements (21 vs 22; stale notes) | bh-33-4 L7, aa-33-4 #5 | **LEDGER** (bookkeeping; this story's close corrects) |

## Tasks / Subtasks

- [x] Task 1: H1 parse-error sanitization (AC 33.5.1) + secret-marker pins on both parsers' error surfaces (status, doctor, --json)
- [x] Task 2: H2 apply-update preservation (AC 33.5.2): merge semantics for unmanaged keys; enablement never changes on apply; confirm text states preservation; mutation-verify (revert → red → restore)
- [x] Task 3: M-batch engine fixes (AC 33.5.3–33.5.5): TOML string/array-aware regions + comment-comma probe, comment-only JSONC, TOML datetime, status probe-throw degradation
- [x] Task 4: certify.mjs harness (AC 33.5.6) + LOW batch (AC 33.5.7)
- [x] Task 5: Ledger mirror — write every LEDGER row above into `deferred-work.md` (33-5-L1… numbering), correct the tally disagreements in the affected story notes
- [x] Task 6: Gates — full turbo, baseline `:check`, NUL scan; every HIGH/MEDIUM fix live-probed or mutation-verified (Rule #48)

## Dev Notes

- Lead's live probes (2026-07-28): P1 TOML leak CONFIRMED (`api_key = "SECRETVALUE123"` echoed through `readConfigEntries`); P2 Cline apply CONFIRMED (`disabled: true` → `false`, `autoApprove` wiped). Reproduce both before fixing; mutation-verify after.
- The stale column is load-bearing: do NOT re-fix what earlier stages already fixed — verify the stale claims hold on the current tree first (Rule #47), then focus on the INCLUDE set.
- Fixture diversity lesson (the 33.2 smoke HIGH): every byte-preservation pin must include compact/4-space/CRLF/comment-bearing variants, not only canonical formatting.
- Rules #36/#49: expected values captured from real runs. Rule #51: mechanical tallies at close (the ledger count, the test count).

## Dev Agent Record

### Agent Model Used

claude (k3[1m]), 2026-07-28, via bmad-dev-story.

### Debug Log References

Live probes run during the story (all disposable, deleted after use):
- P1 re-probe (smol-toml 1.7.1 / yaml 2.9.0 error shapes): TOML `TomlError.codeblock` echoes the offending line AND the line above (secret confirmed leaking); yaml message echoes the offending line + caret; both parsers carry structured position (TOML `.line`/`.column`, yaml `.linePos`). Comment-only JSONC: `parseJsonc` returns `undefined` + 1 error (the eh-33-4 #3 mechanism). TOML datetime: smol-toml `TomlDate` class instance. `__proto__`: jsonc-parser builds objects via ASSIGNMENT (prototype mutated at parse time); yaml/toml build own properties.
- P2 re-probe (dist engine, sandbox HOME): Cline apply over `disabled: true` + `autoApprove` + `timeout` + env extras → `disabled:false`, all extras wiped (bug CONFIRMED before fix; PRESERVED after).
- 33-5-4 probe: comment between previous property and owned LAST JSON property → dangling comma CONFIRMED (33.2 rework did not cover it).
- 33-5-3 probes: `"""` string with header-looking line and nested multi-line array (`  ["a"],`) both truncated the TOML region (orphaned lines on remove) CONFIRMED.
- Built-bin live verification (Integration AC, `live-check-335.mjs`, deleted): 10/10 PASS — TOML secret absent from built `status` text + `doctor --json`; built `apply` on Cline preserved `disabled:true`/`autoApprove`/`timeout`/env extras end-to-end.

Mutation verifications (Rule #48, revert → red → restore):
- TOML sanitization mutant (raw message restored): 4 pins red across readers/status/CLI surfaces → restored.
- YAML sanitization mutants (full-line reason ×2): readers + strengthened CLI pins red → restored (the FIRST CLI YAML pin was too weak — secret planted 2 lines above the offending line; strengthened to plant it ON the offending line after the mutant survived).
- Update-merge mutant (skip mergeUpdateEntry + TOML replace-region): 7 pins red → restored.
- Region-math mutant (no top-level gating): 2 multiline pins red → restored.
- Comment-comma mutant (whitespace-only backward scan): 3 pins red; the no-comment byte-identity pin stayed green (correct — unchanged path) → restored.
- Probe-throw mutant (unguarded resolveScopePath exists): FIRST pin was non-discriminating (a universally-throwing probe degrades at DETECTION, never reaching scopeStatus — Rule #54); rewritten to model the real transient shape (first call per path succeeds, second throws) → red on mutant → restored.

### Completion Notes List

- **AC 33.5.1 (HIGH)** — `readers.ts`: `sanitizeTomlError` (reason + structured line:col from TomlError properties; codeblock dropped) and `sanitizeYamlError` (first-line reason minus the ` at line L, column C:` suffix, minus a trailing quoted-token segment; line:col from `linePos`). Thrown-error paths use a first-line-only `sanitizeThrownError`. Secret-marker pins on readConfigEntries + diagnoseConfigSurface (TOML marker on offending line AND the line above — the lead's P1 shape; YAML marker on the offending line; JSONC already-disciplined), plus CLI-level pins: built `status` text, `status --json`, `doctor --json` for both parsers.
- **AC 33.5.2 (HIGH)** — apply-UPDATE is now a MERGE, never a replace: `mergeUpdateEntry` (JSONC/YAML — manager-owned command/args overwritten per entry shape, env carriers merged key-wise so user extras survive, every other key preserved, native flag NEVER stamped by an update) + TOML line-level surgery `tomlMergeUpdate` (new `merge-update` op with disjoint line spans applied bottom-up by the executor — only manager-owned lines touched; comments, unmanaged scalars, the flag, and other sub-tables stay byte-exact; env sub-table replaced with the key-wise merge, inline env form handled, missing managed lines inserted; datetime/un-re-renderable values = documented REFUSAL). Confirm text states the preservation contract. A disabled entry stays disabled through apply (lead probe P2 shape pinned at diff + built-bin levels).
- **AC 33.5.3** — `scanTomlStructure` mini-lexer (per-line top-level flags over strings/bracket nests) gates all TOML region/insert/flag-line math — multiline strings and nested arrays no longer truncate regions; trailing blank/comment trimming is top-level-gated too (string content never trimmed). removalEdits last-property branch is comment-aware (whole-line `//`, `/* */`, and trailing `//` on the comma's own line): comma + property go as two edits, the comment survives, no dangling comma; the no-comment path is byte-identical to pre-33.5 (pinned).
- **AC 33.5.4** — comment-only JSONC is a VALID empty document (jsonc scanner: no real tokens ⇒ `empty`); `isPlainObject` is prototype-checked (TomlDate/class instances rejected): a TOML datetime at the root key is root-wrong-shape (drift guard) / ok:false (reader), and datetime VALUES are skipped from entry classification.
- **AC 33.5.5** — status.ts `safeExists` per-probe degradation wraps the `resolveScopePath` probe (the unguarded call the finding named); pin models the real transient shape.
- **AC 33.5.6** — certify.mjs: (a) keep-passing guard via extracted `scripts/certify-record.mjs#mergeCertificationRecord` (a failed pass NEVER overwrites a certified-live record); (b) records MERGE over the existing record (hand-authored `sharing`/`ac3344`/`residualRisk` survive a re-run); (c) `VERIFIERS` map single-sources the scripted verification surfaces — unsupported clients fail BEFORE detection/writes (cursor pinned exit 2 with an empty sandbox tree); (d) the clobber-gate refusal names `iris-mcp-clients restore --client <id>`. Unit-tested via the extracted lib (6 tests) + process-level pins.
- **AC 33.5.7 (LOW batch)** — `__proto__` foreign entries surfaced (defineProperty + jsonc prototype rehabilitation in `rehabilitateProto`); TOML array-of-tables surfaced via the additive `unsupported` reader map (status lists the name among foreign; every write action is a documented refusal naming the form); `tomlString` escapes control chars (code-point comparisons — the Rule #55 lesson; an early edit wrote literal control bytes into diff.ts, caught by scan and rewritten byte-clean) + `tomlKey` quotes non-`[A-Za-z0-9_-]` keys; doctor emits NO restart-hint block for config-drift findings (parseability still earns it; two stale pins updated); the generated certification cells carry the file-level-vs-agent-side qualifier derived from recorded evidence; the CLI npx header carries the not-yet-published caveat (33-4-R5's docs/client-config coverage verified); certify CLIENT_IDS derived from CLIENT_ADAPTERS via dist import; the kimi-code residualRisk connects the explicit-mode/no-env-expansion requirement (envExpansion: none probed in adapters.ts); pass-created empty backup dirs cleaned deepest-first via `passCreatedPaths` (session-index cleanup was already complete per 33-4-R4).
- **Task 5 (ledger)** — all 12 LEDGER rows mirrored to `deferred-work.md` as 33-5-L1…L12 with dispositions + suggested resolutions; the two STALE-verify claims re-verified green on the current tree (trailing-comment headers, trailing-comma byte-exact inverse); the 33.4 tally disagreement corrected in `33-4-certification-docs.md` (mechanically reconstructed: 33.3-close 16 test files → 33.4-close 18 files/372; the dev note's "17/350" undercounted by 1 file/21 tests).
- **Task 6 (gates)** — `pnpm turbo run build test lint type-check` 29/29; `gen:governance-baseline:check` (`:check` ONLY) exit 0 (frozen `1e62c5ad5bf7` / 141 / 201 / 60 unchanged — no new MCP tool/governance key; Rules #28/#31/#53 untriggered: no server packages touched); NUL/control-byte scan over the change set CLEAN; client-config tally 18 files/372 → **19 files/411 tests** (+1 file `certify-record.test.ts`, +39 tests, runner-derived per Rule #51); extension untouched (git status); all four disposable probe/repro scripts deleted.

### File List

- `packages/client-config/src/readers.ts` — error sanitization, comment-only JSONC, prototype-checked isPlainObject, `__proto__` defineProperty + rehabilitate, `unsupported` map.
- `packages/client-config/src/status.ts` — safeExists probe degradation, unsupported names in foreign list.
- `packages/client-config/src/diff.ts` — scanTomlStructure + multiline-aware region/insert math, mergeUpdateEntry, tomlMergeUpdate + merge-update op, comment-aware removalEdits, tomlString/tomlKey hardening, AoT refusal, confirm-text preservation.
- `packages/client-config/src/write.ts` — merge-update executor (bottom-up spans).
- `packages/client-config/src/engine.ts` — (review) `ownEntry` own-property guards on the 4 bare `parsed.entries[name]` lookups.
- `packages/client-config/src/index.ts` — export mergeUpdateEntry + scanTomlStructure.
- `packages/client-config/src/cli/clients.ts` — no restart-hint block for config-drift findings.
- `packages/client-config/scripts/certify.mjs` — VERIFIERS map + fail-fast, derived CLIENT_IDS, clobber restore hint, keep-passing + merge record write, empty backup-dir cleanup.
- `packages/client-config/scripts/certify-record.mjs` — NEW: mergeCertificationRecord + passCreatedPaths (testable extraction).
- `packages/client-config/scripts/certify-record.d.mts` — NEW: type declarations for the lib.
- `packages/client-config/scripts/render-certification-table.mjs` — file-level-vs-agent-side qualifier (cells + details intro).
- `packages/client-config/scripts/certification-results.json` — kimi-code residualRisk: explicit-mode/no-expansion re-run requirement.
- `packages/client-config/README.md` — npx caveat, apply-update preservation note, certify mode notes, regenerated certification sections.
- `packages/client-config/src/__tests__/readers.test.ts` — sanitization/comment-only/datetime/`__proto__`/AoT pins.
- `packages/client-config/src/__tests__/status.test.ts` — probe-throw degradation + TOML secret report pins.
- `packages/client-config/src/__tests__/diff.test.ts` — merge-update/preservation/multiline/comment-comma/AoT/quoting pins; 2 stale op assertions updated; merge-update-aware applyTomlSplice.
- `packages/client-config/src/__tests__/clients-cli.test.ts` — TOML+YAML secret-marker surface pins; drift restart-hint flip.
- `packages/client-config/src/__tests__/certification-docs.test.ts` — 33-5-15/33-5-16 pins.
- `packages/client-config/src/__tests__/certification-process.test.ts` — restart-hint updates, certify 33.5.6c/d + 33-5-17 pins, qualified-cell anchors.
- `packages/client-config/src/__tests__/certify-record.test.ts` — NEW: record-merge + pass-created-paths unit tests.
- `_bmad-output/implementation-artifacts/deferred-work.md` — 33-5-L1…L12 ledger section.
- `_bmad-output/implementation-artifacts/33-4-certification-docs.md` — dated tally correction (33-5-L12).
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — status bookkeeping.
- `_bmad-output/implementation-artifacts/33-5-late-findings-cleanup.md` — this story file.

## Change Log

- 2026-07-28 (dev): Story 33.5 implemented — both lead-probed HIGHs fixed and mutation-verified (TOML/YAML parse-error sanitization with secret-marker pins on every surface; apply-update merge semantics preserving unmanaged keys + enablement with the TOML line-surgery merge-update op), the MEDIUM batch (multiline TOML region math, comment-comma removal, comment-only JSONC, TOML datetime shape guard, status probe-throw degradation), the certify.mjs harness batch (keep-passing guard, record merge, fail-fast unsupported surfaces, restore-path hint), the full LOW batch, the 12-row ledger mirror (33-5-L1…L12) with the 33.4 tally correction. Gates: turbo 29/29, baseline `:check` exit 0, NUL scan clean, 19 files/411 tests (+1/+39). Changes left UNCOMMITTED for the lead's per-story smoke gate + commit.
- 2026-07-28 (qa): QA E2E/edge layer added (`qa-33-5-process.test.ts` 22 tests built-bin, `qa-33-5-unit.test.ts` 21 tests; +2 files/+43, runner-derived → **21 files/454**). The lead's P1/P2 reproductions independently re-run against the BUILT dist and pinned dead (P1: TOML secret absent from status text/`status --json`/doctor text/`doctor --json`/apply refusal, file byte-identical after refusal; P2: Cline apply preserves `disabled:true`/`autoApprove`/`timeout`/env extras, confirm text states preservation, matrix reads present-disabled). Sanitization adversarial sweep: 11 exotic cases (CRLF, tab-indented, unicode secrets, secret in a trailing comment on the offending line, secret three lines above, multi-error files ×2 per family) × five surfaces — zero leaks, line:col retained. Preservation sweeps across all four native-flag clients (nested objects, arrays, comments INSIDE owned entries, env extras; datetime documented refusal byte-identical). TOML multiline lifecycle (apply→disable→enable→remove over `"""`/nested arrays/quoted keys, zero orphans). Comment-only JSONC lifecycle. Probe-throw multi-scope degradation (per-scope isolation + universal-throw detection-level degradation). certify-record merge/keep-passing + passCreatedPaths matrices. **TWO product defects found by the sweeps and FIXED in the package** (not tested-around), both mutation-verified (revert → red → restore): (1) comment-only JSONC apply REFUSED as "unsupported document shape" despite AC 33.5.4 making it a valid empty document — `diff.ts insertionEdits` now treats a token-free/tree-less document like an empty file, preserving trivia (5 pins red on mutant); (2) JSONC/YAML apply-update REPLACED the whole entry value, dropping every comment INSIDE the owned entry and reformatting untouched keys — now PER-KEY surgery (jsonc per-key replace/insert edits; new yaml `merge-update` op in `write.ts`), whole-value fallback only for a genuine no-op (5 pins red on mutant; no-op-fallback pin stayed green on both mutants, correct). Gates after fixes: turbo 29/29, baseline `:check` exit 0, NUL/control-byte scan clean, disposable probe deleted. All changes UNCOMMITTED.

### Review Findings

2026-07-28 — bmad-code-review of the uncommitted working tree. **All three spawned layers (bh-33-5, eh-33-5, aa-33-5) failed to return within the review window — SIXTH consecutive Epic-33 story; mandates executed reviewer-direct per the 32.3 precedent.** Outcome: **0 decision-needed / 3 patch (all applied + mutation-verified per Rule #48) / 2 defer (33-5-R1, 33-5-R2 → deferred-work.md) / 0 dismissed / 0 HIGH / 0 MEDIUM.**

Acceptance-auditor mandate, reviewer-direct: every AC 33.5.1–33.5.7 re-verified — the two HIGHs adversarially re-probed against the real parsers (TOML dup-key/bad-value/secret-in-key/unclosed-string/CRLF/bad-date first lines all generic; YAML dup-key/tab/CRLF/multi-error/token-quote first lines all covered by the strips — sanitization holds against CRLF/BOM/multi-error forms); ledger rows 33-5-L1…L12 present in deferred-work.md with full fields; the 33-4 tally correction is mechanically reconstructable; the stale-verify pins (trailing-comment headers, trailing-comma byte-exact inverse) green in the suite; client-config tally verified runner-mechanically at **21 files / 454 tests** pre-patch (Rule #51). Rule #55: control-byte scan over the change set CLEAN (re-verified at review).

Reviewer-direct probes found three live defects the suite was blind to; all patched:

- [x] [Review][Patch] YAML materialization error leaked the unresolved-alias NAME [readers.ts:160] — `doc.toJS()` throws `Unresolved alias (...): SECRETALIAS` OUTSIDE the errors array (probe 2026-07-28, yaml 2.9.0); `sanitizeThrownError`'s quoted-token strip never matched the unquoted tail. Fixed: strip a trailing unquoted bare token after the quoted strip. Pin in readers.test.ts (alias name absent, generic reason retained); mutation-verified (mutant → the pin red → restored); live-verified through the BUILT bin (`status` text + `status --json` over a sandbox HOME).
- [x] [Review][Patch] Prototype-chain READ lookups on the `entries`/`unsupported` maps [diff.ts:566/573, engine.ts:325/373/419/476, cli/clients.ts:1550] — the READ side of 33-5-11: the maps are defineProperty-built, but a bare `map[name]` lookup walks the prototype chain — an absent entry named `__proto__` misread as PRESENT (Object.prototype) and `unsupported["__proto__"]` produced a garbage `[object Object]` refusal (probe-verified live). CLI validates server names, but diff/engine are library surfaces and stash names come from state.json. Fixed: `ownEntry` own-property helper (readers.ts) at all 7 bare sites; 2 pins in diff.test.ts (absent-`__proto__` plans add; own-`__proto__` entry apply-update preserves unmanaged keys + enablement); mutation-verified (bare-lookup mutant → both pins red → restored).
- [x] [Review][Patch] TOML merge-update re-rendered UNCHANGED managed lines/env table, dropping their comments for zero effect [diff.ts tomlMergeUpdate] — probe-verified: trailing comments on unchanged `command`/`args` lines and interior comments in an unchanged env table were lost on every apply. Fixed: skip spans whose value is unchanged (command/args value equality; env skip when the key-wise merge is a no-op) — the JSONC/YAML per-key discipline now holds for TOML too. 3 pins (byte-identical no-span update; no-op env merge; the pre-existing no-op splice test updated to assert ZERO spans); two mutants (force-render command; force-render env) → 2 + 3 pins red → restored; live-verified through the BUILT bin (apply over unchanged values byte-identical incl. `enabled = false`).

- [x] [Review][Defer] TOML merge-update splices LF-only lines into a CRLF file [diff.ts tomlMergeUpdate] — deferred to deferred-work.md as 33-5-R1 (same class as 33-1-R2, different op; cosmetic; fold into the 33-1-R2 terminator-carry fix).
- [x] [Review][Defer] A CHANGED managed TOML line's trailing comment / a CHANGED env table's interior comments are dropped [diff.ts tomlMergeUpdate] — deferred to deferred-work.md as 33-5-R2 (unchanged regions byte-exact post-patch; per-key env spans + trailing-comment re-attachment as the suggested resolution).

Gates at review close: package suite **21 files / 459 tests** green (+5 review pins), lint clean, type-check clean, full build clean; disposable probe/live-check scripts deleted; control-byte scan re-run CLEAN.
