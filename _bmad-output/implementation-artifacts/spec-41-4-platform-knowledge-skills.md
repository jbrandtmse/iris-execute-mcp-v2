---
title: 'Story 41.4: Platform Knowledge Skills'
type: 'feature'
created: '2026-10-19'
status: 'done'
baseline_revision: '05eead9dc6e4affff0355088eb5c0f80dd81843f'
baseline_commit: '05eead9dc6e4affff0355088eb5c0f80dd81843f'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/.claude/rules/project-rules.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-iris-execute-mcp-v2-2026-10-14/ARCHITECTURE-SPINE.md'
warnings:
  - oversized
deferred: []
---

<intent-contract>

## Intent

**Problem:** The pack has three knowledge skills about the ObjectScript language, and none about the platform an agent writes against: running SQL from ObjectScript, the `Config`/`SYS`/`Security` system classes and the `%SYS` switch, and interoperability hosts, messages and productions. Agents meet exactly these traps (a clean compile that hides broken embedded SQL, a deprecated property that reads empty, a production change lost at the next compile) with nothing to load. Nothing in the pack is adapted yet, so the 41.1 provenance machinery has never carried a real row.

**Approach:**

- **Three skills, six in all.** Three hand-authored, live-verified knowledge skills under `skills-pack-src/knowledge/<name>/SKILL.md`, each its golden text from Design Notes, shipped unchanged by `gen:pack`: `iris-mcp-objectscript-sql`, `iris-mcp-system-classes` and `iris-mcp-interoperability` (decision 1). The knowledge-skill count becomes 6, read from the `knowledge/` directories (AC 41.4.3, #51).
- **One adapted skill.** `iris-mcp-objectscript-sql` is adapted from the upstream `objectscript-sql-patterns` skill: it carries the adaptation header after its frontmatter, and the notice gains its first provenance row (decision 2). The other two adapt nothing.
- **Tool-free.** None of the three names an `iris_*` tool, so none declares a preset (decision 3).
- **The tests follow.** `skills-pack-knowledge.test.ts` covers the six, with one documented exception for the exact header line of an adapted skill. Every count pin and fixture that the new files and the first real row move is updated.

## Boundaries & Constraints

**Always:**

- **One source, byte-exact.** Each new `SKILL.md` equals its golden text byte for byte (sha256 in Design Notes); the notice equals its golden form (the current notice plus exactly the golden row under the separator row, sha256 in Design Notes). LF, exactly one final LF. The SQL skill's header line holds the one non-ASCII character of the three files (U+00A9); everything else is ASCII.
- **Verified claims.** Every factual claim maps to a probe-log row whose verdict is "holds", run on IRIS 2026.2 Build 221U (Design Notes). Every code block was compiled verbatim (only a class name changed for the class block). Any rewording follows the probe discipline: run the new claim in a disposable `ExecuteMCPv2.Temp.Probe414*` class on `server:"default"`, `namespace:"HSCUSTOM"`, delete it, confirm `iris_doc_list filter:"Probe414" generated:true` is `[]`, and move the golden text, its sha256, its anchors and this spec's change log in the same pass.
- **Wording.** No internal rule number, DW/AD/AC/Story id, repository path, project class or helper, repository tooling, `iris_*` token or the word "probe" in any skill. IRIS codes (`ERROR #5809`, `#1043:`), IRIS syntax and the pack's own skill names are allowed. No bullet of the always-on rule appears in a skill.
- **Frontmatter and size.** Line 1 `---`; only `name` (equal to the directory) and `description` (content first, then `Use when`, at most 1,024 characters, no XML-like tag). At most 500 lines and 1,200 words by the suite's `wordCount`.
- **The header exception is narrow.** The knowledge test exempts exactly one line, the first non-blank line after the frontmatter, only when it equals `ADAPTATION_HEADER` and only for a skill whose typed oracle marks it adapted. Each side of that rule has a negative control.
- **Generated and shared code.** The pack changes only through `pnpm gen:pack` (AD-14). No script or core module changes: the 41.1 machinery already handles a first row (verified, Design Notes). File content is written with the file tools, never a heredoc (#55).

**Never:**

- **Upstream content.** The implement stage does not open the upstream copy: the golden text and row are complete here. Nothing comes from upstream `skills/kb/ipm-module-authoring.md` or `iris-objectscript-eval`. No other upstream file is adapted.
- **Other surfaces.** No change to any prompt, tool, action, governance key, preset, refusal code, route, bootstrapped class, `gen:skills` output, script under `scripts/`, or the notice's MIT block.
- **Other stories' scope.** No preset-declaration format, pack-wide internal-reference check or catalog (41.5), no installer (41.6), no plugin (42.8).
- **Files not to edit:** `.claude/rules/*`, `CLAUDE.md`, the spine, `epics.md`, `irislib/`, `irissys/`, `src/`, the installer-managed `.claude/skills/bmad-*`, and the 41.3 section of `CHANGELOG.md`.
- **IRIS.** No HSCUSTOM global write (`^ClineDebug` included). No production class or message class compiled in HSCUSTOM. Never start, stop or read a production; never stop IRIS; never target an `ocupilot-slot-*` profile; security and configuration objects are read only.
- **Git.** No `git commit`, `git push`, `git reset` or `git rebase`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Real tree | The six committed knowledge sources and the notice with one row | `gen:pack` writes the three new `skills/<name>/SKILL.md` and the new notice copy; a second run changes nothing; `gen:pack:check` reports `22 pack file(s)` | No error expected |
| Validator (Integration) | `pnpm validate:prompts` | `51 source(s) checked (12 prompt(s) + 39 content file(s): 12 workflow, 20 pack, 6 knowledge, 1 rule)` | Exit 1 names a bad token per file |
| Provenance (Integration) | `pnpm check:provenance` | `1 provenance row(s), 39 agent file(s), 8 distribution(s)` | Exit 1, one `[rule] label: message` line per problem |
| Tarball (Integration) | `npm pack --dry-run --json --ignore-scripts --offline` in `packages/client-config` | Lists the three new `skills-pack/skills/<name>/SKILL.md` and `skills-pack/IRIS-MCP-THIRD-PARTY-NOTICES.md`, whose bytes equal the source notice | `check:provenance` names a missing pack file or a tarball with adapted content and no notice |
| Row removed | The golden row deleted from the source notice, pack regenerated | `check:provenance` exits 1 with `[claim-row]` for `knowledge:iris-mcp-objectscript-sql/SKILL.md` and `pack:skills/iris-mcp-objectscript-sql/SKILL.md` | Mutation only; restored |
| Header removed | The header line deleted from the SQL source, pack regenerated | `check:provenance` exits 1 with `[row-file]` for `skills/iris-mcp-objectscript-sql/SKILL.md`; the knowledge test is red | Mutation only; restored |
| Header exception, adapted | The SQL skill | ASCII, hygiene, tool-name and rule-copy checks pass on its text without line 6; line 6 equals `ADAPTATION_HEADER`; `hasValidAdaptationHeader` is `true` | No error expected |
| Header exception, controls | The header line at the end of an adapted body; the header as line 6 of a skill not marked adapted; a header with `(c)` for the copyright sign | Each is flagged: non-ASCII and the classes "a tool or server name" and "a repository file" (and, for `(c)`, a failed header check) | The test goes red |
| Not adapted | The other five skills | None matches `/iris-agentic-dev/i` | The test goes red |
| Skill content | The three new sources | Exact `name` and `description`; at most 500 lines and 1,200 words; no `iris_*` token; hygiene clean; no rule bullet; every probe anchor; one `SKILL.md` per directory; code blocks 2, 1, 1 | No error expected |

</intent-contract>

## Code Map

**Sources and docs:**

- `skills-pack-src/knowledge/` -- holds the three 41.3 skills today; this story adds three directories, each with only `SKILL.md`.
- `skills-pack-src/IRIS-MCP-THIRD-PARTY-NOTICES.md:11-12` -- the table header and separator row; the golden row goes on the line after `:12`. Today 0 rows, sha256 `b1548c77da7600b180695fe8d698201360a3da61961d88f79148468fa527eef2`.
- `skills-pack-src/README.md:40` -- names "the three core knowledge skills"; `:51-63` -- the adapted-content section (header and row format); `:65-70` -- the excluded sources.
- `CHANGELOG.md:5` -- newest heading, `## [Pre-release — 2026-10-19] — Story 41.3: Core knowledge skills`; its subsections `### Added` (`:12`), `### Changed`, `### Tests`, `### Known limits`. `:18`'s "the notice still has no provenance row" is 41.3's history and stays.
- `.changeset/story-41-3-core-knowledge-skills.md` -- the changeset precedent (`"@iris-mcp/client-config": minor`).

**Machinery (unchanged; verified to handle a first row):**

- `scripts/lib/provenance-core.mjs:38-40` `ADAPTATION_HEADER`, `:77` `PROVENANCE_HEADER_ROW`, `:138-167` `parseProvenanceRows`, `:176-186` `hasValidAdaptationHeader`, `:227-338` `checkProvenance` (rules `row-file` `:276-286`, `header`/`claim-row` `:295-301`, `distribution` `:304-335`), `:346-356` `provenanceSummary`.
- `scripts/lib/skills-pack.mjs:439-472` `listAgentContentFiles` (`.md` only; the notice and the pack README are not agent files; knowledge labels `knowledge:<n>/<f>` with packRel `skills/<n>/<f>`, so the `rule:` packRel caveat of DW-614 does not apply); `:363-385` the knowledge loop of `assemblePack`; `:134-151` `renderPackReadme` names no skill, so the pack README does not change.
- `scripts/lib/provenance-inputs.mjs:20` `PACK_SHIPPING_PACKAGES = ['@iris-mcp/client-config']`; `:103-135` one distribution per non-private package (8 on the real tree, pinned by no test).
- `scripts/check-provenance.mjs:59-62` -- the OK line format.

**Tests to extend** (all under `packages/iris-mcp-all/src/__tests__/`; `vitest.config.ts:21` sets `fileParallelism: false`):

- `skills-pack-knowledge.test.ts` -- the sibling to extend (Rule 2), 420 lines:
  - `:38-47` `Skill` interface; `:49-152` the `SKILLS` table of typed oracles;
  - `:211-218` `scannedText`, `:221-224` `hygieneProblems`, `:240-246` `textProblems` -- where the header exception goes;
  - `:260-266` "are exactly the three planned skills"; `:298-303` the ASCII check; `:329-335` the hygiene check;
  - `:338-340` "the probe anchors total 75"; `:342-348` "the notice still has no provenance row" (red on the first row);
  - `:355-420` negative controls, where the exception's controls go.
- `story-41-3-qa-knowledge-gate-process.test.ts` -- `:33-36` hard-codes `SKILL_NAMES` (3); `:84,87` the `3 knowledge` regex; `:402-407` the untouched-skill loop; `:442` compares the directory list with `SKILL_NAMES` (red with six). Its baseline (`:290-298`) runs the committed knowledge test in a child process on a scratch copy of the real sources and notice.
- `skills-pack-frontmatter.test.ts` -- in-memory `realNotice`/`inputsWith` (`:229-242`) pass only the notice as `packFiles`, so a real row adds `row-file` and breaks the exact expectations at `:254`, `:258`, `:263-265`, `:270-276`, `:287-292`, `:302`; CLI pins `:352` and `:373`; the sweep `:414-445` (knowledge `>= 3`) stays.
- `pack-provenance.test.ts` -- `noticeWithRows` (`:75-78`) inserts fixture rows under the separator, above the real row; `inputsFor` (`:91-116`) passes the notice plus `extraPackFiles` only. A real row adds `row-file` to every `check(inputsFor(...))` and moves `:164`, `:178`, `:187-189`, `:197`, `:218`, `:316-318` (exact problem lists) and the parsed-row counts `:268`, `:279`, `:381`. The real-tree test `:566` covers the row unchanged.
- `story-41-1-qa-provenance-cli.test.ts` -- `:96,99` (`0 provenance row(s), 33 agent file(s)`), `:105`, `:111` (`1 provenance row(s), 35 agent file(s)`), and `:275-280` (the header-row swap: the expected rule set gains `claim-row`, because the real adapted skill then has no row).
- `story-41-1-qa-validate-prompts-pack.test.ts:49,52,60,146`; `story-41-1-qa-pack-scratch-cli.test.ts:151,319`; `skills-pack-rule.test.ts:392`.
- Unchanged: `skills-pack.test.ts` (diffs the real tree; `:328-361` writes `zz-probe-skill`), `story-41-1-qa-pack-tarball.test.ts` (`>= 19`, notice equality), `validate-prompts.test.ts` (derives its counts), `story-41-2-doc-claims.test.ts` (refuses `objectscript-review`; the row cites `objectscript-sql-patterns`), `story-41-3-qa-frontmatter-process.test.ts`, `agent-text-hygiene.ts`.

**IRIS evidence** (read-only references the golden texts rest on):

- `irislib/%occStatus.inc:83-84` (`ThrowSQLCODE`, `ThrowSQLIfError`); `irislib/%occErrors.inc:1893,2093-2094` (5540, 5809, 5810); `irislib/%SQL/Statement.cls:243,411,519,570,802`; `irislib/%SQL/StatementResult.cls:194,204,222,277`; `irislib/%Library/Persistent.cls:506,823,1706`; `irislib/%Exception/SQL.cls:16,44-46`.
- `irissys/Config/CommonMultipleMethods.cls:43,71,96,109`; `irissys/Config/Databases.cls:27-32,322`; `irissys/Config/Namespaces.cls:298`; `irissys/SYS/Database.cls:17,116,202,249,276`; `irissys/Security/Roles.cls:141,174,373,413`; `irissys/Security/SSLConfigs.cls:142-148,163,173`; `irissys/SYS/Stats/Global.cls:22-34,79`; `irissys/SYS/Stats/Routine.cls:27,45`; `irislib/%SYS/ProcessQuery.cls:48,133,177,237`; `irislib/%SYS/Namespace.cls:29`.
- `irislib/Ens/Host.cls:5,13-14,34,559,565,731,734`; `irislib/Ens/Settings.cls:48-110` (`GetSettings` walks every superclass; `-Name` hides); `irislib/Ens/BusinessService.cls:131-138,182`; `irislib/Ens/BusinessOperation.cls:620-701,707,713`; `irislib/Ens/BusinessProcess.cls:142-160,839,846-850,864`; `irislib/Ens/Request.cls:8,16-28`; `irislib/Ens/MessageBody.cls:7-8,30`; `irislib/Ens/Config/Production.cls:101,123-170,173-190,680`; `irislib/Ens/Config/Item.cls:150`; `irislib/Ens/Projection/Production.cls:12-40`; `irislib/Ens/Director.cls:151-157,1451-1475`; `irislib/EnsLib/File/InboundAdapter.cls:469-479`; `irislib/EnsLib/File/OutboundAdapter.cls:142,147,160`; `irislib/Ensemble.inc:45-84`; `%Projection.XML` (live `iris_doc_get`, lines 1-80: an XML-enabled subclass's compile writes `^oddXML` entries in the local database).

## Tasks & Acceptance

**Execution:**

- `skills-pack-src/knowledge/iris-mcp-objectscript-sql/SKILL.md`, `.../iris-mcp-system-classes/SKILL.md`, `.../iris-mcp-interoperability/SKILL.md` -- NEW: each its golden text from Design Notes, byte for byte; check the sha256. Nothing else goes in the three directories -- AC 41.4.1, 41.4.2.
- `skills-pack-src/IRIS-MCP-THIRD-PARTY-NOTICES.md` -- insert the golden provenance row as the line after the separator row, and change nothing else; check the golden sha256 -- AC 41.4.3.
- `pnpm gen:pack` -- regenerates the pack (three skill directories and the notice copy). That output is part of the diff -- AD-14.
- `skills-pack-src/README.md` -- contributor doc: name the six knowledge skills in place of "the three core knowledge skills" (all tool-free); in the adapted-content section, name `iris-mcp-objectscript-sql` as the one adapted skill (header on the first non-blank line after its frontmatter, row citing `skills/skills/objectscript-sql-patterns/SKILL.md`), and say that `skills-pack-knowledge.test.ts` exempts exactly that header line from its ASCII and wording checks, only for a skill its table marks as adapted.
- `packages/iris-mcp-all/src/__tests__/skills-pack-knowledge.test.ts` -- extend, don't copy (Rule 2):
  - the header comment covers Stories 41.3 and 41.4; `Skill` gains an optional typed `adaptedFrom` (the upstream source path, as in the row);
  - `SKILLS` gains the three oracles (name, sha256, description, code blocks, anchors; `adaptedFrom: "skills/skills/objectscript-sql-patterns/SKILL.md"` on the SQL skill);
  - "are exactly the planned skills": the directory names equal the six oracle names, and their count, read from the directory, is within 6 to 10 (AC 41.4.3, #51);
  - **the header exception:** for a skill with `adaptedFrom`, the first non-blank line after the frontmatter must equal `ADAPTATION_HEADER` (imported from `provenance-core.mjs`) and `hasValidAdaptationHeader` must be `true`; the ASCII check, the hygiene scan, the tool-name check and the rule-copy check then read the text without exactly that line. A skill without `adaptedFrom` is checked whole and must not match `/iris-agentic-dev/i`;
  - **controls for the exception** (with the existing controls): the header at the end of an adapted body is flagged (non-ASCII, "a tool or server name", "a repository file"); the header as the first body line of a skill not marked adapted is flagged the same way; a header with `(c)` in place of the copyright sign fails the header check and is flagged by the hygiene scan;
  - the notice test becomes "the notice holds exactly the rows of the adapted skills": `parsed.problems` is `[]`, and `parsed.rows` mapped to `{packFile, source, adaptation}` equals the golden row; the set of oracle `adaptedFrom` skills equals the set of row pack files;
  - "the probe anchors total 170: 22, 27, 26, 32, 31, 32", in `SKILLS` order (gotchas, error-handling, unit-tests, sql, system-classes, interoperability) -- AC 41.4.1, 41.4.2, 41.4.3.
- `packages/iris-mcp-all/src/__tests__/story-41-3-qa-knowledge-gate-process.test.ts` -- the hermetic directory check (`:442`) and the untouched-skill loop cover all six knowledge skills; the count regex reads `6 knowledge`; the offender and look-alike rows keep editing only the skills they name. The baseline stays green because the committed knowledge test carries the exception.
- `packages/iris-mcp-all/src/__tests__/skills-pack-frontmatter.test.ts` and `pack-provenance.test.ts` -- in-memory fixtures that feed `checkProvenance` the real notice also carry, as `packFiles`, the committed pack files its rows name (read from the pack), so the real row adds no problem and the exact expected problem lists stay as they are. Parsed-row counts are derived as the real notice's rows plus the rows the fixture inserts. Fixture names stay clear of the six real skill names.
- Count pins, each derived from the CLI output (#51) and cross-checked by hand: `story-41-1-qa-provenance-cli.test.ts:96,99` becomes `1 provenance row(s), 39 agent file(s), 1 distribution(s)`, and `:105,111` become `2 provenance row(s), 41 agent file(s)`; `:275-280` expects `["claim-row","notice"]` (title says why); `skills-pack-frontmatter.test.ts:352` becomes `1 provenance row(s), 41 agent file(s), 1 distribution(s)` and `:373` `2 provenance row(s), 41 agent file(s)`; `story-41-1-qa-validate-prompts-pack.test.ts:49,52` becomes `51 source(s) checked (12 prompt(s) + 39 content file(s): 12 workflow, 20 pack, 6 knowledge, 1 rule)`, `:60` `51 source(s) checked`, `:146` `(12 prompt(s) + 44 content file(s): 12 workflow, 23 pack, 7 knowledge, 2 rule)`; `story-41-1-qa-pack-scratch-cli.test.ts:151` and `skills-pack-rule.test.ts:392` become `22 pack file(s)`, and `story-41-1-qa-pack-scratch-cli.test.ts:319` `37 pack file(s)`. Search every `packages/*/src/__tests__/` for `pack file(s)`, `agent file(s)`, `provenance row(s)`, `source(s) checked`, `knowledge,` and `realNotice` before finishing (Rule 19).
- `CHANGELOG.md` -- a new top section `## [Pre-release — YYYY-MM-DD] — Story 41.4: Platform knowledge skills`, dated the UTC day it is written: `### Added` (the three skills, one line each on what they cover; the first provenance row); `### Changed` (the notice gains its row; the knowledge test's header exception); `### Tests`; `### Known limits` (no installer until 41.6, no catalog until 41.5, no tool named); a paragraph that tools stay 110 package / 115 advertised, prompts 12, `gen:skills` 13 files, `BOOTSTRAP_VERSION` `5296a1c836f4`, baseline `1e62c5ad5bf7`/141, and the pack goes from 19 to 22 files (#43).
- `.changeset/story-41-4-platform-knowledge-skills.md` -- NEW: `"@iris-mcp/client-config": minor` (three skills, one of them adapted, and the notice's first row) -- AD-29.

**Acceptance Criteria:**

- **The system-class skill (AC 41.4.1).** Given the committed source and its pack copy, when `skills-pack-knowledge.test.ts` and `pnpm gen:pack:check` run, then `iris-mcp-system-classes` equals its golden text (sha256), its pack copy is byte-identical, and every one of its 31 anchors is present; and given the probe log, when the reviewer maps each claim to a row (`Config`/`SYS`/`Security` and their join, deprecated properties, the `%SYS` switch, per-process against instance-wide counters), every row reads "holds".
- **The interoperability skill (AC 41.4.2).** Given the committed source and its pack copy, when the same checks run, then `iris-mcp-interoperability` equals its golden text, its pack copy is byte-identical, and its 32 anchors are present; and every claim (host signatures, `Ens.Request`/`Ens.Response`, adapters and settings, the production XData) maps to a "holds" row, run by compiling a host or by reading the IRIS class it extends.
- **The SQL skill.** Given the same, `iris-mcp-objectscript-sql` equals its golden text, its 32 anchors are present, and its two code blocks are the ones compiled verbatim (class name aside) and run as twins.
- **Count and provenance (AC 41.4.3).** Given the committed tree, when the default suite and `pnpm check:provenance` run, then the knowledge-skill count read from `skills-pack-src/knowledge/` is 6, the notice holds exactly the golden row, and `check:provenance` prints `1 provenance row(s), 39 agent file(s), 8 distribution(s)`; and when the row is removed and the pack regenerated (mutation), `check:provenance` exits 1 with `[claim-row]` for both labels of the SQL skill and `pack-provenance.test.ts` "real tree passes every provenance rule" goes red.
- **The wording.** Given the three new sources, when `pnpm validate:prompts` and `skills-pack-knowledge.test.ts` run, then no `iris_*` token is present, the hygiene scan (with the two existing overrides and the header exception) is empty, and no rule bullet is copied.
- **Unchanged counts.** Given the suite, when the `(once)` checks run, then `gen:governance-baseline:check` reports `1e62c5ad5bf7`/141, `gen:tools-list-snapshot:check` reports no drift, `gen:skills:check` reports `13 generated file(s)`, `git diff --stat packages/shared/src/bootstrap-classes.ts` is empty, and tools stay at 110 package / 115 advertised.

### Review Findings

Code review, 2026-10-19. Review tier `full-opus`; all four layers delivered (Blind Hunter, Edge Case Hunter, Verification Gap, Acceptance Auditor); outcome CLEAN. 28 rows gave 12 entries (high 0, medium 5, low 7); 7 rows were rejected. Every skill correction was confirmed by a live probe or a read of the IRIS source (wave-7 decision #15; probe-log rows Q30 to Q32, I1, I2, C21).

- [x] [Review][Patch] SQL skill: a run-time error such as -400 sets `%msg` only when it is empty, so `$$$ThrowSQLIfError(SQLCODE, %msg)` after an earlier statement in the same method throws that statement's text [skills-pack-src/knowledge/iris-mcp-objectscript-sql/SKILL.md:20] — medium, blind-hunter+edge-case-hunter+verification-gap+acceptance-auditor (and QA's live finding); fixed: compile-time errors replace `%msg`, run-time errors do not, each method with embedded SQL starts with `%msg` undefined, and clear it before a statement whose error text you report (Q31, Q32)
- [x] [Review][Patch] SQL skill: the table-name rule is the default only (`User` is `SQLUser`; `SqlTableName` and a package's SQL name replace it) [skills-pack-src/knowledge/iris-mcp-objectscript-sql/SKILL.md:14] — medium, blind-hunter; fixed (Q30)
- [x] [Review][Patch] Interoperability skill: a business process's `SendRequestAsync` declares `Ens.Request`, not `%Library.Persistent` [skills-pack-src/knowledge/iris-mcp-interoperability/SKILL.md:12] — medium, all four layers; fixed (I1)
- [x] [Review][Patch] Interoperability skill: only classes derived from `Ens.MessageBody` keep their data in `^Ens.MessageBodyD` (`Ens.StreamContainer`, `Ens.StringContainer` and `EnsLib.HL7.Message` keep their own) [skills-pack-src/knowledge/iris-mcp-interoperability/SKILL.md:13] — medium, all four layers; fixed (I2)
- [x] [Review][Patch] Interoperability preamble "None of it needs a running production" read as a claim about behavior that several bullets contradict [skills-pack-src/knowledge/iris-mcp-interoperability/SKILL.md:8] — low, blind-hunter; now "without running a production"
- [x] [Review][Patch] System-class skill: "Close a `%SQL.Statement` result" names no method an agent can call (`%CloseCursor` is `Private`) [skills-pack-src/knowledge/iris-mcp-system-classes/SKILL.md:51] — low, blind-hunter; now "Kill", as C21 ran it
- [x] [Review][Patch] The changeset and the contributor README said every claim was run; the CHANGELOG said every code block was compiled unchanged [.changeset/story-41-4-platform-knowledge-skills.md:7] — low, blind-hunter+acceptance-auditor; all three now match the evidence (run or source read; the host block compiled under another class name)
- [x] [Review][Patch] The CHANGELOG's `### Tests` named no QA test file [CHANGELOG.md:42] — low, blind-hunter+acceptance-auditor; both QA files added
- [x] [Review][Patch] The QA process test re-implemented the fixture's `problemRules` as a local `pairs` (Rule 2) [packages/iris-mcp-all/src/__tests__/story-41-4-qa-first-row-process.test.ts:76] — low, blind-hunter; moved into `story-41-1-qa-fixture.ts` as `problemPairs`; the per-file `scratch`/`afterEach` stays, the idiom every sibling uses over the shared `makeScratchRepo`
- [x] [Review][Patch] The "Unchanged counts" AC had no `mutation:` line (Rule 19) [_bmad-output/implementation-artifacts/spec-41-4-platform-knowledge-skills.md:135] — low, verification-gap; CR1 demonstrated and recorded
- [x] [Review][Patch] "the header appears once" could not fail alone beside `not.toContain(ADAPTATION_HEADER)` (Rule 19; QA's note) [packages/iris-mcp-all/src/__tests__/skills-pack-knowledge.test.ts:481] — low, lead+QA; removed, its intent kept as the remaining assertion's message, CR3 demonstrated
- [x] [Review][Defer] Story 41.5's pack-wide internal-reference check must accept the exact adaptation header, an obligation recorded only in this spec's Consumed-by note [_bmad-output/planning-artifacts/epics.md:5590] — deferred: medium, in-epic, DW-623 `routed owner=41-5-workflow-skills-refresh`

Rejected:

- `low` Blind Hunter: the core skills do not link to the platform skills — skills load by their descriptions, not by links, and the fix edits two 41.3 golden texts outside this story.
- `false` Edge Case Hunter: `DatabaseDirectory` called with no argument raises `<UNDEFINED>` — a missing required argument failing loudly is correct; the method's input check is for an empty name, as C16 ran it.
- `false` Edge Case Hunter: `FindName` called with no argument — the `<UNDEFINED>` is raised inside the `Try` and comes back as a status, as the method promises.
- `low` Edge Case Hunter: `committedRowFiles` throws ENOENT at collection for a row whose pack file is missing — loud and names the path, and `check:provenance` and the real-tree tests name it too (as adjudicated in the implement review).
- `low` Edge Case Hunter: no green control left for a consistent notice with zero rows — the shipped tree has a row, and a control needs a second fixture shape; it matters only if the pack returns to zero adapted files.
- `low` Verification Gap: the floors `>= 19`, `>= 3` and `run.total >= 58` sit below the real totals — an exact check beside each pins the real value, and the spec keeps those tests unchanged.
- `false` Verification Gap: a concurrent run could collide with `zz-probe-skill` — the suite runs files serially (`fileParallelism: false`) and the probe directory is removed in `finally`.

## Spec Change Log

- **2026-10-19, lead spec gate.** Wave-7 decisions #12, #13 and #14 were taken as recommended (Design Notes). The spine's AD-28 lists the three platform skills and names the adapted SQL skill as the first provenance row (Rule 20). The plan's two new facts for the project rules are recorded on DW-615 for the user, since retrospectives are skipped this run.
- **2026-10-19, code review (wave-7 decision #15).** Four over-broad claims corrected, each confirmed by a live probe or a read of the IRIS source. SQL: `%msg` after a run-time error and per method (Q31, Q32), and the table-name rule as a default with its exceptions (Q30). Interoperability: the declared request type of the send methods (I1) and `^Ens.MessageBodyD` for `Ens.MessageBody` classes only (I2). Two wording fixes: the interoperability preamble now reads "without running a production", and the system-class skill says to kill a `%SYS` statement result, not close it (C21). The golden texts, sha256 values (`b48e137b...` to `135b2a37...`, `dd15048c...` to `f5f22ff7...`, `ea093f10...` to `f10dec5d...`), byte, line and word counts, the anchors (sql 29 to 32, two interoperability anchors replaced, 167 to 170 in all) and the SQL AC's anchor count moved together. Line 6, the header, and the provenance row are unchanged, so the notice sha256 `d2e80ca6...` stands. This supersedes the implement review's Blind Hunter 1 rejection and the Auto Run Result's residual-risk paragraph. The changeset, contributor README and CHANGELOG now say each claim was run or checked against the IRIS source.

## Review Triage Log

### 2026-10-19 — Review pass
- verdicts: 33 findings — high 0, medium 2, low 27, false 4, maybe-false 0
- findings:
  - `[low]` `[reject]` Blind Hunter 1: interoperability "Messages" says every message body class keeps its data in `^Ens.MessageBodyD` and that the send methods take a `%Library.Persistent` — real imprecision (`Ens.StringContainer` and `Ens.StreamContainer` have their own extents; `Ens.BusinessProcess.SendRequestAsync` is typed `Request`), but no reader who follows the skill's own examples is misled, and the fix rewords a golden text pinned by sha256 in this spec, so it is a spec edit; noted for the lead in the final report
  - `[low]` `[patch]` Blind Hunter 2: `checkedText` splices index -1 on CRLF text (`hasValidAdaptationHeader` accepts CRLF, `indexOf` is LF-exact) — real, latent (sources are LF-only and a "no CR" check exists); fixed with an `at < 0` guard, a CRLF control, and M13d
  - `[low]` `[reject]` Blind Hunter 3: no `<PROTECT>` coverage in the system-class skill — a new unprobed claim and a golden-text edit; the description names only the two errors the skill covers
  - `[false]` `[reject]` Blind Hunter 4: two skills give opposite `New $NAMESPACE` advice — the gotchas skill itself offers "save `$NAMESPACE` in a local variable and set it back yourself" as its second option, which is the system-class skill's advice for handlers, and each lists the other under Related skills
  - `[low]` `[reject]` Blind Hunter 5: the production-class section lacks a `ProductionDefinition` skeleton, and "loads it again from the XData" omits the invalid-XData case — an omission and a simplification of a probed claim (I28), golden text, no harm named
  - `[low]` `[reject]` Blind Hunter 6: the "None of it needs a running production" and "observed" preambles blur compile, run and source-read evidence — the spec's AC interpretations accept the same-build source read as evidence and the preambles say how each skill was checked; golden text
  - `[low]` `[reject]` Blind Hunter 7: the deprecated-property advice names no replacement for `CRLFile` and `SNIName` — the sentence is conditional on the property's comment, rows C12 to C14 hold, golden text
  - `[low]` `[reject]` Blind Hunter 8: one-off measurements written as facts — the spec's AC interpretations record that these numbers are presented as observations, and the delta bullet claims only what row C31 holds
  - `[low]` `[patch]` Blind Hunter 9: the real-tree tool-name test asserts the same call twice, the second on the exempted text, so it cannot fail alone — real, harmless; the redundant assertion was removed (the exemption is exercised by the `textProblems` checks and their controls)
  - `[low]` `[patch]` Blind Hunter 10: gates not shown red on the path they guard (the "not adapted" test, the second-copy and `(c)` controls, no offender row for the adapted skill) — closed by M12 to M18 and two offender rows for the adapted skill
  - `[low]` `[patch]` Blind Hunter 11: README and CHANGELOG say the header is "the first line after the frontmatter" where the shipped rule is the first non-blank line — corrected in both; the stale `Auto Run Result` is written at finalize, and the M10 and M11 wording is accurate as written
  - `[low]` `[patch]` Edge Case Hunter 1: `checkedText` on CRLF text — same root cause as Blind Hunter 2, fixed once
  - `[low]` `[reject]` Edge Case Hunter 2: `committedRowFiles` throws ENOENT at collection if a notice row names a pack file that is missing — on an inconsistent tree the failure is loud and `check:provenance` and the real-tree tests still name the missing file; the spec chose to reuse the committed pack bytes
  - `[low]` `[patch]` Edge Case Hunter 3: the "exactly one line" claim has no CRLF control — same root cause as Blind Hunter 2, control added
  - `[medium]` `[patch]` Edge Case Hunter 4: the child-process offender and look-alike rows edit only the core skills, so the exemption's one real consumer has no end-to-end offender check — real; two offender rows for the adapted skill added, with M17
  - `[medium]` `[patch]` Verification Gap 1: no offender row reaches the adapted skill through the real-tree path (demonstrated: skipping the wording tests for it stays green) — same root cause as Edge Case Hunter 4; fixed once, M17 shows it can fail
  - `[low]` `[patch]` Verification Gap 2a: the duplicate `checkedText` tool-name assertion cannot fail alone — same root cause as Blind Hunter 9
  - `[low]` `[reject]` Verification Gap 2b: the 6 to 10 bounds, the `run.total >= 58` floor and the frontmatter sweep's `>= 3` cannot fail alone or sit below the real total — the bounds restate AC 41.4.3 beside the exact-name check, the floor is a sanity floor that was already about 13 below the 41.3 total and is not changed by the spec, the sweep's `>= 3` is stated to stay, and the per-skill `resultOf` rows carry the baseline
  - `[low]` `[patch]` Verification Gap 3: pins with no `mutation:` line (the three controls, the SQL anchors, the code-block counts, the oracle-against-notice cross-check, the gate-process widening) — M12 to M18 written under `## Verification`; the "Unchanged counts" AC is pinned by the existing `(once)` gates
  - `[low]` `[patch]` Verification Gap 4a: the title "passes with no adapted file and no row" is false now that the fixture carries the real row — retitled "passes with only the real notice's own row and its committed pack file"
  - `[low]` `[reject]` Verification Gap 4b: the in-memory fixtures read the committed pack copy of the real row's file — the spec's own decision ("reuse the committed pack bytes"); M11 shows the fixtures exercise it, and a second adapted skill would replace it with synthetic bytes
  - `[low]` `[patch]` Verification Gap, other 1: `checkedText` on CRLF text — same root cause as Blind Hunter 2
  - `[low]` `[patch]` Verification Gap, other 2: the comment "(the other two stay untouched)" is stale with six skills — now "the other five"
  - `[false]` `[reject]` Intent Alignment 1: the claims hold on a live instance but no test contacts IRIS — by design: the plan's 92-row probe log is the evidence, the tests pin the text, and this stage re-probes only a claim it changes (none was)
  - `[low]` `[reject]` Intent Alignment 2: "run on IRIS" against source reads in the skills' preambles — same as Blind Hunter 6
  - `[false]` `[reject]` Intent Alignment 3: an agent has nothing installed to load — out of this story: the installer, catalog and plugin are Stories 41.5, 41.6 and 42.8, which the intent excludes
  - `[low]` `[reject]` Intent Alignment 4: `8 distribution(s)`, `22 pack file(s)` and `51 source(s)` are pinned only on scratch copies — the spec records the 8 as pinned by no test, the real tree is covered by the real-tree provenance test, the pack diff test and the `(loop)` commands
  - `[low]` `[reject]` Intent Alignment 5: the tarball and frontmatter-sweep floors stay at `>= 19` and `>= 3` — the spec lists those tests as unchanged and they enumerate whatever the pack holds
  - `[low]` `[reject]` Intent Alignment 6: no test pins the notice's sha256 — the spec's notice test is the parsed-row test; the MIT block is pinned by the existing hash and the golden form was checked with `shasum` in every `(loop)` pass
  - `[low]` `[reject]` Intent Alignment 7: the exemption's controls are synthetic and no process-level row injects the header into a real non-adapted skill — the real-tree "not adapted" test covers it (M12) and the child-process rows now cover the adapted skill (M17)
  - `[low]` `[patch]` Intent Alignment 8: `checkedText` against `hasValidAdaptationHeader` on CRLF — same root cause as Blind Hunter 2
  - `[low]` `[reject]` Intent Alignment 9: the fixtures depend on the committed pack — same as Verification Gap 4b
  - `[false]` `[reject]` Intent Alignment 10: the row's adaptation prose cannot be checked against the upstream file — not testable here, and the golden row is the lead's decided text

## Design Notes

**Orchestrator decisions needed** (the Lead's calls, delegated). This plan follows each recommendation.

- **Orchestrator decision needed: how many platform skills, and their names** -- recommended: three, `iris-mcp-objectscript-sql`, `iris-mcp-system-classes` and `iris-mcp-interoperability`, for six knowledge skills in all, because:
  - the story names three topics, and each fits one skill inside 41.3's budget (1,115, 910 and 981 words; 107, 65 and 89 lines, after the code-review corrections);
  - a fourth (an adapted list-patterns skill) is not one of the three topics, and decision 2 finds it is not a better start;
  - six is inside 6 to 10, counted from the `knowledge/` directories;
  - the names follow the "Pack names" convention; `objectscript-` in the SQL name says it is SQL run from ObjectScript code, matches the core three, and differs from the upstream `objectscript-sql-patterns` and `iris-sql`, so an installed copy never shadows another kit's skill.
- **Orchestrator decision needed: adapt anything from the upstream kit** -- recommended: adapt `skills/skills/objectscript-sql-patterns/SKILL.md` into `iris-mcp-objectscript-sql` (the pack's first provenance row), and nothing else. The plan read four upstream files as untrusted data at `b6205bb` (`iris-sql` by its headings only) and executed nothing:
  - **`objectscript-sql-patterns`: clearly the better start.** The project's rules hold nothing on embedded SQL, and the upstream skill's core traps held live: the table-name rule (Q1, Q2), `If SQLCODE` treating an error as "not found" (Q5), `INTO` variables set to `""` on 100 (Q11), `COUNT(*) INTO` giving 0 (Q12), `%Prepare` returning a status (Q16), double-quoted strings giving -29 (Q16), and errors that appear only at `%Next(.sc)` (Q18). One explanation was wrong and is corrected: an object property set to `""` IS `NULL` in SQL (Q23), where upstream says `IS NULL` is false. Its lock-timeout, operator and date sections were not run and are dropped. Having read it, writing the same traps without credit would be an unattributed derivative; MIT allows adaptation with the notice.
  - **`objectscript-list-patterns`: not adapted.** It is not one of the three topics, and its central claim is false on 2026.2: appending 80,000 items by string concatenation took 0.0030 s, the same as `$ListBuild` accumulation (0.0030 s), so "O(n^2) string concat is always wrong for >10 items" does not hold. Only its `$List(l, *+1)` claim held (0.11 s for 20,000, 1.44 s for 80,000). The rest is general `$List` reference, and the one list trap with a real failure (object references in `$List`) already ships in the gotchas skill.
  - **`iris-sql`: not adapted.** A 591-line SQL-dialect reference rather than SQL from ObjectScript; keeping one upstream source per adapted file keeps the row one-to-one.
  - **`ensemble-production`: not adapted.** It covers running productions through the upstream's own tools and Python API, not the authoring patterns AC 41.4.2 names, and its "a typed `OnRequest` is rejected at compile time" is false on 2026.2: typed `OnRequest`, `OnMessage` and `OnProcessInput` all compiled (I12, I19, I24).
  - **The cost:** the header line carries a non-ASCII character and names the upstream kit and the notice, so the knowledge test needs the one-line exception, and 41.5's pack-wide check must accept that exact line; the first real row moves the fixtures listed in the Code Map; 41.6 must ship the notice beside this skill (already AC 41.6).
  - **The alternative** -- write the SQL skill from scratch -- is not honest once the plan has read the upstream file on the same topic.
- **Orchestrator decision needed: the platform skills name no tool** -- recommended: no `iris_*` token in any of the three, so no preset declaration (decision #8 continued), because the declaration format is 41.5's (AC 41.5.4), the workflow skills already drive the tools in these domains (`trace-message-flow`, `recover-stuck-production`, `audit-security-posture`, `check-system-health`), and a skill about classes and code holds for any client.

**AC interpretations** (apply and report):

- **"Each claim is probed live" (41.4.1, 41.4.2).** Every claim maps to a row: a compile, a run or a read-only query on the live instance, or a read of the IRIS class source of the same build (the local IRIS 2026.2 Build 221U snapshot, plus a live `iris_doc_get` of `%Projection.XML`, which the snapshot lacks). Where a run would write the shared namespace, the claim was checked against that source instead: compiling a production class writes its configuration rows, `^IRIS.Temp.EnsProdConfigChange` and an audit record (`Ens/Projection/Production.cls:12-40`), and compiling any XML-enabled class, which every `Ens.Request` subclass is, writes `^oddXML` entries (`%Projection.XML`). So no production class and no message class was compiled; host classes were compiled with the existing `Ens.StringRequest` and `Ens.StringResponse`, which also gave the message facts (I1 to I4). No production ran, so no disposable namespace was needed.
- **SQL data without a global write.** The SQL probes used a persistent class whose storage is process-private (`Parameter DEFAULTGLOBAL = "^||Probe414Item"`, giving `^||Probe414ItemD`), killed at the end of every call.
- **"Embedded SQL".** The skill covers embedded SQL and `%SQL.Statement`, the two ways ObjectScript runs SQL, plus the `%OpenId` and `%DeleteId` failure paths that 41.3's review routed to "the platform SQL skill".
- **"Safe `%SYS` switching".** The core gotchas skill already covers `New $NAMESPACE` scope and the `Catch` namespace, and the always-on rule holds the `<CLASS DOES NOT EXIST>` bullet; the system-class skill goes further (the error case, `<NAMESPACE>`, result sets that outlive the switch, mappings) and refers to the gotchas skill instead of repeating it.
- **Numbers observed once.** "3.5 billion", "51 times", "200,430 and 200,488" and the timings are what this instance printed; the text presents them as observations, not constants.

**Spine text for the lead** (Rule 20, light path):

- **AD-28, Knowledge skills.** Add after the core-three bullet: "The platform knowledge skills (Story 41.4) are `iris-mcp-objectscript-sql`, `iris-mcp-system-classes` and `iris-mcp-interoperability`, so the pack holds six. They name no `iris_*` tool. `iris-mcp-objectscript-sql` is adapted from upstream `skills/skills/objectscript-sql-patterns/SKILL.md` and carries the pack's first provenance row."
- **memlog line.** "AD-28 (41.4): three tool-free platform knowledge skills (six in all); iris-mcp-objectscript-sql adapted from upstream objectscript-sql-patterns with the header and the first provenance row. Prevents an unattributed derivative and a count outside 6-10."

**Governing ADs:**

- **AD-28:** one source per skill; skill frontmatter; adapted content (the exact header as the first non-blank line after the frontmatter, a row pinned to `b6205bb`, nothing from the excluded sources); no internal references; every `iris_*` token names a real tool (none here); the "Pack names" convention.
- **AD-14:** the pack changes only through `gen:pack`. **AD-2:** no check logic moves out of `scripts/lib/`; the tests import it. **AD-29:** a minor changeset. **AD-30:** suite-prefixed names for 41.6's owned files. **AD-15:** no prompt changes.
- **Project rules:** #16, #35, #36, #43, #44, #51, #54, #55, #56, #59 and Rule 14.

No AC contradicts an AD.

**Extend, don't copy (Rule 2):** the three skills join the one knowledge test's `SKILLS` table; the header exception sits beside the two existing hygiene overrides in the same file, built on `ADAPTATION_HEADER` and `hasValidAdaptationHeader` from `provenance-core.mjs`, not a second header parser. No new test file is needed for the skills themselves. The fixture changes reuse the committed pack bytes rather than new fixture text.

**Integration (Rules 1/2):**

- **Integration ACs:** the `validate:prompts` CLI counts 6 knowledge and 20 pack sources; the `check:provenance` CLI counts 1 row and 39 agent files and goes red without the row; client-config's npm tarball lists the three skills and a notice equal to the source.
- **Consumed-by:**
  - **41.5:** the catalog lists six knowledge skills; the pack-wide internal-reference check must accept the exact adaptation header line of an adapted skill (it names the upstream kit and the notice); the preset declaration decides what a tool-free skill declares.
  - **41.6:** installs `skills/<name>/` for the six, and writes the notice beside the adapted skill (AC 41.6.1).
  - **41.7:** docs name the adapted skill and the notice; the live check lists the installed skills.
  - **42.8:** the plugin's `skills/` and its distribution, which `check:provenance` must then cover.
- **Consumes:** 41.1's `checkProvenance`, `parseProvenanceRows`, `hasValidAdaptationHeader`, `ADAPTATION_HEADER` and the notice; 41.3's frontmatter rule, knowledge-test pattern and hygiene list.

**Ledger inbox (Rule 17):** `LEDGER slice 41-4-platform-knowledge-skills` is empty; no entry is owned by this story.

**The first provenance row, verified before planning on it.** A scratch script called the real pure functions (no repository file touched): `skillFrontmatterProblems` is `[]` for the three drafts; `hasValidAdaptationHeader` is `true` for the SQL skill only; the notice with the golden row parses to 1 row and no problem, and `isExcludedSource` is `false` for its source; `checkProvenance` over that notice, the SQL skill's `knowledge:` and `pack:` agent files, the pack files and a pack-shipping distribution returns `[]`, and `provenanceSummary` gives 1 row. Without the row it returns `claim-row` twice; a tarball carrying the adapted text without the notice gives `distribution`.

**The golden notice row** (the line after `| --- | --- | --- |`):

~~~text
| `skills/iris-mcp-objectscript-sql/SKILL.md` | `skills/skills/objectscript-sql-patterns/SKILL.md` | Rewritten for IRIS 2026.2 and run on it again: kept the table-name, SQLCODE, fetch-time error, double-quote and INTO-variable traps; corrected the NULL and empty-string section; dropped the lock-timeout, ObjectScript-operator and date sections; added first-run compilation of embedded SQL, undefined host variables, %msg, select mode, and the %OpenId and %DeleteId failures |
~~~

The notice with this row: 2,369 bytes, 41 lines, sha256 `d2e80ca61ad50a3914b997da7f1f2b30fbb1fb407a342e8048b5d51e92f67911`.

**Golden texts.** Each file is the text between the fences, ending in a single LF.

- `skills-pack-src/knowledge/iris-mcp-objectscript-sql/SKILL.md`: 7,525 bytes, 107 lines, 1,115 words, sha256 `135b2a3770f7dfd2676807edc6439f2f93a81c2843721bb0d2e5d28bd571e916`. Line 6 is the header; its copyright sign is U+00A9.

~~~markdown
---
name: iris-mcp-objectscript-sql
description: "Running SQL from ObjectScript with embedded SQL and %SQL.Statement: the SQL table name of a class, SQLCODE 0, 100 and negative values, what INTO variables hold when no row is found, errors that appear only when a statement runs or a row is fetched, NULL against the empty string, and what %OpenId and %DeleteId return for a missing ID. Use when writing or reviewing &sql or %SQL.Statement code, or when a query reports SQLCODE -30 or -29, finds no row you expected, or returns an empty value."
---

Adapted from intersystems-community/iris-agentic-dev (MIT, © 2025 InterSystems Corporation); see IRIS-MCP-THIRD-PARTY-NOTICES.md

# SQL in ObjectScript

Every behavior below was observed on IRIS 2026.2.

## The table name of a class

- By default, the last dot of a class name separates the schema from the table, and every earlier dot becomes an underscore. `Ens.Request` is the table `Ens.Request`, and `Ens.Config.Item` is the table `Ens_Config.Item`. A class of the package `User` is in the schema `SQLUser`, and a class's `SqlTableName`, or its package's SQL name, replaces the default.
- The dotted form of a longer name is read as another table: `SELECT Name FROM Ens.Config.Item` fails with SQLCODE -30, `Table 'CONFIG.ITEM' not found`.
- To look a name up, query `SELECT SqlSchemaName, SqlTableName FROM %Dictionary.CompiledClass WHERE Name = ?`.

## SQLCODE

- After `&sql(...)`, `SQLCODE` is 0 when the statement worked, 100 when it found or changed no row, and negative for an error.
- `If SQLCODE` is true for 100 and for every error alike, so it reports an error as "not found". Test `SQLCODE = 100` and `SQLCODE < 0` apart.
- `%msg` holds the text of an error, but not always this statement's. A successful statement leaves it as it was, still holding the text of an earlier error. An error found when the statement is compiled, such as -30 or -29, replaces it, but an error raised while the statement runs, such as -400, sets `%msg` only when it is empty.
- A method that holds embedded SQL starts with `%msg` undefined and gives the caller's `%msg` back when it returns. In a method that runs several statements, `Set %msg = ""` before each one whose error text you report, and read `%msg` only when SQLCODE is negative.
- An `UPDATE` or `DELETE` that changes no row gives 100, not an error, and `%ROWCOUNT` is 0. After an `INSERT`, `%ROWID` holds the new row's ID and `%ROWCOUNT` is 1.
- `$$$ThrowSQLIfError(SQLCODE, %msg)` throws a `%Exception.SQL` when SQLCODE is negative and does nothing for 0 or 100. Its `AsStatus()` reads `ERROR #5540: SQLCODE: -400 Message: ...`. Like the status macros, it needs no `Include`.

## Embedded SQL

- `&sql(...)` is compiled the first time it runs, not with the class. A class whose embedded SQL names a missing table or column compiles cleanly, and the statement then sets SQLCODE -30, with `%msg` reading `Table 'MYAPP_DATA.MISSING' not found compiling embedded cached query`, or -29 for a column. A clean compile proves nothing about the SQL inside a class: run it.
- An input host variable that is undefined is read as NULL, with no error. `WHERE Code = :tCode` with `tCode` undefined finds nothing and gives 100.
- When no row is found, every `INTO` variable is set to `""`, including one that held a value or was undefined. A default set before the query does not survive it, so check SQLCODE, not the variable.
- `SELECT COUNT(*) INTO :tCount` always returns one row: SQLCODE is 0, and `tCount` is 0 when nothing matches.
- A `SELECT ... INTO` that matches several rows takes the first one and gives 0. For several rows, use a cursor or `%SQL.Statement`.

```objectscript
ClassMethod FindName(pCode As %String, Output pName As %String) As %Status
{
    Set tSC = $$$OK, pName = ""
    Try {
        &sql(SELECT Name INTO :tName FROM MyApp_Data.Item WHERE Code = :pCode)
        If SQLCODE = 100 {
            Set tSC = $$$ERROR($$$GeneralError, "No item with code "_pCode)
        }
        Else {
            $$$ThrowSQLIfError(SQLCODE, %msg)
            Set pName = tName
        }
    }
    Catch ex {
        Set tSC = ex.AsStatus()
    }
    Quit tSC
}
```

- No row and an SQL error, such as a missing table, each end in `tSC` as a different status, and the method returns once.

## %SQL.Statement

- `%Prepare` returns a `%Status` and does not throw. A missing table fails there, and so does a string in double quotes: SQL reads double quotes as a name, so `WHERE Name = "Apple"` gives `SQLCODE: -29` with `Field 'APPLE' not found`. Write SQL strings in single quotes.
- `%ExecDirect` returns a result object even when the statement fails. Test its `%SQLCODE` and `%Message`, which for a missing table are -30 and `Table ... not found`.
- An error in a selected expression, such as a division by zero, appears only when a row is fetched. `%Execute` leaves `%SQLCODE` at 0. Then `%Next(.tSC)` returns 0, as it does after the last row, with `SQLCODE: -400` and `<DIVIDE>` in `tSC`, and `%SQLCODE` is -400. Check both after the loop, as below.
- After the last row, `%SQLCODE` is 100 and `%ROWCOUNT` is the number of rows fetched.
- Values come back in logical form. A `%Date` column gives a day number such as `67000`, from embedded SQL and from a statement whose `%SelectMode` is its default, 0. Set `%SelectMode = 1` before `%Prepare` to get the ODBC form, `2024-06-09`.
- Pass values as `?` arguments of `%Execute`, never by joining them into the statement text.

```objectscript
ClassMethod ListNames(pMinPrice As %Numeric, Output pNames As %List) As %Status
{
    Set tSC = $$$OK, pNames = ""
    Try {
        Set tStmt = ##class(%SQL.Statement).%New()
        $$$ThrowOnError(tStmt.%Prepare("SELECT Name FROM MyApp_Data.Item WHERE Price > ? ORDER BY Name"))
        Set tRS = tStmt.%Execute(pMinPrice)
        $$$ThrowSQLIfError(tRS.%SQLCODE, tRS.%Message)
        Set tFetch = $$$OK
        While tRS.%Next(.tFetch) {
            Set pNames = pNames_$ListBuild(tRS.%Get("Name"))
        }
        $$$ThrowOnError(tFetch)
        $$$ThrowSQLIfError(tRS.%SQLCODE, tRS.%Message)
    }
    Catch ex {
        Set tSC = ex.AsStatus()
    }
    Quit tSC
}
```

- An error from `%Prepare`, such as a missing table, and an error during the fetch each end in `tSC`. No matching row is no error: `pNames` is then an empty list.

## NULL and the empty string

- An ObjectScript `""` in a property is SQL NULL. A saved object whose `Name` is `""` matches `Name IS NULL`, and `INTO` gives back `""`.
- SQL's `''` is another value. It is stored as `$Char(0)`, which `INTO` and the object property both return as a string of length 1, and only `Name = ''` matches it. A property set to `$Char(0)` matches `Name = ''` too.
- To find rows with no value in either form, test `Name IS NULL OR Name = ''`.

## Objects by ID

- `%OpenId(tId)` returns `""` for a missing ID, with no error. Pass a status as the third argument to learn why: `%OpenId(tId, , .tSC)` sets `tSC` to `ERROR #5809: Object to Load not found, class '...', ID '...'`.
- Test the result with `$IsObject`, or the ID with `%ExistsId`, before you use it: `%OpenId(tId).Name` raises `<INVALID OREF>` for a missing ID.
- `%DeleteId(tId)` returns `ERROR #5810: Object to Delete not found` for a missing ID.

## Related skills

- `iris-mcp-objectscript-error-handling`: `%Status` values, exceptions and the `Try` and `Catch` method shape used above.
- `iris-mcp-system-classes`: class queries of the system classes, which run through `%SQL.Statement` too.
~~~

- `skills-pack-src/knowledge/iris-mcp-system-classes/SKILL.md`: 6,443 bytes, 65 lines, 910 words, sha256 `f5f22ff75c2c75726c5c4fd8b3098492b735700cf22853c11d37d83092f9b310`.

~~~markdown
---
name: iris-mcp-system-classes
description: "Using the IRIS system classes from ObjectScript: what the Config, SYS and Security classes hold and when one answer needs two of them, class queries with fewer columns than the class, deprecated properties that still read but no longer follow the configuration, switching to %SYS and back safely, and counters of one process against the whole instance. Use when code calls Config, SYS or Security classes, switches $NAMESPACE to %SYS, reports system metrics, or fails with CLASS DOES NOT EXIST or NAMESPACE around a namespace switch."
---

# IRIS system classes

Every behavior below was observed on IRIS 2026.2.

## Config, SYS and Security

- `Config.*` classes read and write the instance's configuration file, the settings it starts with. `SYS.*` classes report on the running instance, such as whether a database is mounted. `Security.*` classes hold users, roles, resources and the rest of authorization.
- All three are classes of the `%SYS` namespace. In `USER`, `##class(%Dictionary.CompiledClass).%ExistsId("Config.Databases")` is 0, and calling such a class from outside `%SYS` raises `<CLASS DOES NOT EXIST>`. `%SYS.ProcessQuery`, whose name starts with `%`, exists in `USER` too.
- One answer often needs two of them. For a database, `##class(Config.Databases).Get(name, .props)` gives its `Directory` and how it mounts, but no size and no mounted state. `##class(SYS.Database).%OpenId(directory)` gives `Size` in MB, `Mounted` and `ReadOnly`. Join the two on the directory. `##class(Config.Namespaces).Get(ns, .props)` names a namespace's globals database in `props("Globals")`.
- Read a class before you call it, because the usual method names are often missing. `Config.Namespaces` has no `NamespaceList` method; its `List` class query lists the namespaces.
- A class query often returns fewer columns than the class has properties. The `List` query of `Security.Roles` has no `Resources` column, and its `ListAll` query has one. `Get(name, .props)` returns the properties of one item.
- `Get` on a missing name returns an error status, such as `ERROR #883: Role ... does not exist` from `Security.Roles` and `ERROR #420: Database ... does not exist` from `Config.Databases`.
- The `%All` role grants every permission, yet `Get("%All", .props)` gives it an empty `Resources`. A permission check that walks a role's resources has to treat `%All` as granting everything, and should match the role name exactly, not as part of a longer name.

## Deprecated properties

- A deprecated property can still be read. Look for `[ Deprecated ]` on the property, or query `%Dictionary.CompiledProperty` with `Deprecated = 1`. For `Security.SSLConfigs` that gives `CRLFile`, `Protocols` and `SNIName`.
- It may no longer follow the configuration. `Protocols` still reads through SQL and on the object, but it read empty for each of three TLS configurations whose `TLSMinVersion` and `TLSMaxVersion` were 16 and 32, TLS 1.2 to 1.3. `Get(name, .props)` leaves it out. Use the replacement that the property's comment names.

## Switching to %SYS

```objectscript
ClassMethod DatabaseDirectory(pName As %String, Output pDir As %String) As %Status
{
    Set tSC = $$$OK, pDir = ""
    If pName = "" Quit $$$ERROR($$$GeneralError, "A database name is required")
    Set tOrigNS = $NAMESPACE
    Try {
        Set $NAMESPACE = "%SYS"
        Set tSC = ##class(Config.Databases).Get(pName, .tProps)
        Set $NAMESPACE = tOrigNS
        If $$$ISOK(tSC) Set pDir = $Get(tProps("Directory"))
    }
    Catch ex {
        Set $NAMESPACE = tOrigNS
        Set tSC = ex.AsStatus()
    }
    Quit tSC
}
```

- The method checks its input before the switch, keeps the original namespace in a local variable, and restores it right after the system call and first in `Catch`. It returned in the original namespace for a database that exists, for a missing one with `ERROR #420`, and for an empty name.
- `Set $NAMESPACE` is not undone by an error. When a called method switches and then fails, the caller's `Catch` runs in `%SYS`.
- Local variables keep their values across a switch.
- Switching to a namespace that does not exist raises `<NAMESPACE>` and leaves you where you were. `##class(%SYS.Namespace).Exists(name)` checks first.
- Kill a `%SQL.Statement` result of a `%SYS` class query, prepared with `%PrepareClassQuery`, before you switch back. Killed after the switch, it raised `<CLASS DOES NOT EXIST>`. One still open when its method returned raised the error after the method's own `Catch` had finished, so the caller got it. A `%ResultSet` of the same query could be killed after the switch without an error, and so could an object of such a class opened by ID, which could also still be read.
- In a REST handler, avoid `New $NAMESPACE`. The switch then lasts until the method returns, so its `Catch` and its error response run in `%SYS`. Whether the application's own classes exist there depends on package mappings: a mapped package resolved in `%SYS`, while `Ens.Director` did not. A handler that works on one instance can therefore fail on another, so restore the namespace yourself.

## One process or the whole instance

- `##class(%SYS.ProcessQuery).%OpenId($Job)` reports the current process only. Its `CommandsExecuted` and `GlobalReferences` count that process's own work: a loop of 100,000 passes added about 200,000 commands.
- A server process that handles many requests keeps counting across them. One REST worker's `CommandsExecuted` was 3.5 billion, so a handler that reports it describes that worker, not the instance and not the request.
- Instance-wide totals since startup come from `SYS.Stats.Routine.Sample().RtnCommands`, and from `SYS.Stats.Global.Sample()` as `RefLocal + RefPrivate + RefRemote`, run in `%SYS`. The instance's command total was 51 times the worker's, and both totals only grew between samples.
- `SYS.Stats.Routine.Sample()` is declared to return a `SYS.Stats.Global`, but it returns a `SYS.Stats.Routine`, which is the object that has `RtnCommands`.
- A delta does not tell the two kinds apart. Over one short call on a quiet instance, the instance's commands grew by 200,430 and the process's by 200,488. Compare totals instead.

## Related skills

- `iris-mcp-objectscript-gotchas`: `New $NAMESPACE` and `Catch`, and calling `Ens` classes where they do not exist.
- `iris-mcp-objectscript-error-handling`: turning an exception into a `%Status`.
~~~

- `skills-pack-src/knowledge/iris-mcp-interoperability/SKILL.md`: 7,467 bytes, 89 lines, 981 words, sha256 `f10dec5dcb06dc19900a344f82670637e9d93c8c864a8b5f408b1d56a9682d9c`.

~~~markdown
---
name: iris-mcp-interoperability
description: "Writing IRIS interoperability (Ensemble) components in ObjectScript: business service, process and operation classes and their method signatures, Ens.Request and Ens.Response messages, adapters, settings and message maps, synchronous and asynchronous sends, and why the production class XData, not the configuration tables, defines a production. Use when creating or editing a business host, a message class or a production class, or when a host does not compile, a request is not handled, a setting does not appear, or a configuration change does not last."
---

# Interoperability components

Every behavior below was observed on IRIS 2026.2, by compiling business hosts or by reading the IRIS classes they extend, without running a production.

## Messages

- A request class extends `Ens.Request`, and a response class extends `Ens.Response`. Both are persistent. The send methods declare their request as a `%Library.Persistent`, except a business process's `SendRequestAsync`, which declares an `Ens.Request`.
- A message class derived from `Ens.MessageBody`, as `Ens.Request` and `Ens.Response` are, keeps its data in `^Ens.MessageBodyD`: `Ens.MessageBody`, `Ens.StringRequest` and `Ens.StringResponse` all compile to it. Other message classes keep their own, such as `Ens.StreamContainer` in `^Ens.StreamContainerD`. Leave the storage of a message class to the compiler.
- `Parameter RESPONSECLASSNAME` on a request class names its response class, and `NewResponse(.tResponse)` creates one. Without it, `NewResponse` returns `ERROR <Ens>ErrGeneral: Ens.StringRequest has no value for parameter RESPONSECLASSNAME`.
- `Ens.StringRequest` and `Ens.StringResponse` each carry one `StringValue` property, enough for a first test of a host.

## Business operations

```objectscript
Class MyApp.Ops.FileWriter Extends Ens.BusinessOperation
{

Parameter ADAPTER = "EnsLib.File.OutboundAdapter";

Parameter SETTINGS = "Prefix:Basic,-ThrottleDelay";

Property Prefix As %String [ InitialExpression = "out" ];

Method Write(pRequest As Ens.StringRequest, Output pResponse As Ens.StringResponse) As %Status
{
    Set tSC = ..Adapter.PutString(..Prefix_".txt", pRequest.StringValue)
    If $$$ISERR(tSC) Quit tSC
    Set pResponse = ##class(Ens.StringResponse).%New()
    Set pResponse.StringValue = "written"
    $$$LOGINFO("wrote "_$Length(pRequest.StringValue)_" characters")
    Quit $$$OK
}

XData MessageMap
{
<MapItems>
  <MapItem MessageType="Ens.StringRequest">
    <Method>Write</Method>
  </MapItem>
</MapItems>
}

}
```

- `Parameter ADAPTER` names the adapter class, and `..Adapter` is its instance. `EnsLib.File.OutboundAdapter` offers `PutString(filename, data)`, `PutLine` and `PutStream`. A misspelled adapter class still compiles.
- `XData MessageMap` sends each request type to a method. The compiler turns the map into `If pRequest.%IsA(...)` tests in map order, so the first match wins: list a subclass before its superclass. A request that matches no item goes to `OnMessage`, whose default returns an error.
- A map that names a missing method fails the compile with `Method Missing referenced in MessageMap does not exist`. The compiler does not check that the method's argument type matches the map's message type.
- A handler, like `Write` above, may type its arguments with the message classes, and so may an override of `OnMessage`. The response is an `Output` argument: create it in the method.
- A transaction that a handler leaves open is committed after it returns, with a warning in the event log.
- `Parameter INVOCATION` is `"Queue"` unless you set `"InProc"`.
- The log macros `$$$LOGINFO`, `$$$LOGWARNING`, `$$$LOGERROR` and `$$$TRACE` work in a business host without an `Include`. Any other class needs `Include Ensemble`, or the compile fails with `MPP5610 : Referenced macro not defined: 'LOGINFO'`.

## Settings

- `Parameter SETTINGS` lists the properties a production can set, each as `Name:Category`. A host's settings are its own list plus every superclass's list. Above, `Prefix:Basic` adds `Prefix` under Basic Settings, and `-ThrottleDelay` hides an inherited setting, leaving `Prefix` and 14 inherited ones.
- The adapter's settings, such as `FilePath`, come from the adapter class's own list, not from the host's.

## Business services

- A service overrides `OnProcessInput(pInput As %RegisteredObject, Output pOutput As %RegisteredObject, ByRef pHint As %String) As %Status`. A narrower type for `pInput`, such as `%Stream.Object`, compiles.
- With an inbound adapter, the adapter calls the service with what it read. `EnsLib.File.InboundAdapter` passes a file stream, with its file name in `pInput.Attributes("Filename")`.
- `..SendRequestSync(target, tRequest, .tResponse, timeout)` waits for the response, and `..SendRequestAsync(target, tRequest)` does not. The target is the name of a production item, and a name the running production does not know returns an error status.
- The comment on `OnProcessInput` says not to call the send methods from outside it, for example from a CSP page. From there, `##class(Ens.Director).CreateBusinessService(name, .tService)` returns a service to call `ProcessInput` on, or an error status when the production does not know the name, the item is disabled or the production is quiescent.

## Business processes

- A process overrides `OnRequest(request As %Library.Persistent, Output response As %Library.Persistent) As %Status`. Typed arguments compile here too.
- `..SendRequestAsync(target, tRequest, 1, "key")` asks for a response and returns without waiting. The response arrives in `OnResponse(request, .response, callrequest, callresponse, pCompletionKey)`, with the completion key you passed. The default `OnResponse` returns an error, so implement it whenever you ask for a response. `OnComplete` runs when every response is in or the wait has timed out.
- A process that calls another process with `SendRequestSync` can deadlock when both share the production's actor pool, as the IRIS comment on that method warns. Send asynchronously and handle the answer in `OnResponse`, or give the called process a pool of its own.

## The production class defines the production

- A production is a class that extends `Ens.Production`. Its `XData ProductionDefinition` lists the items and their settings.
- Compiling that class deletes the production's row in the configuration tables and loads it again from the XData. A change made only in the tables, such as `Ens_Config.Item`, is lost at the next compile.
- `##class(Ens.Config.Production).LoadFromClass(name)` does the same reload. Call it before `%OpenId(name)` in code that edits a production, so the code starts from what the class holds.
- `SaveToClass()` writes the XData back into the class and saves the class definition, but does not compile it. Until a compile or `LoadFromClass`, a query of the tables does not see an item that was only saved to the class.
- The item index covers the production and the name together and is not unique. Find an item through its production, for example with `FindItemByConfigName`, not by its name alone.
- `##class(Ens.Director).UpdateProduction()` applies a changed configuration to the running production.

## Related skills

- `iris-mcp-objectscript-error-handling`: the `%Status` values that every host method returns.
- `iris-mcp-objectscript-gotchas`: why `Ens` classes are missing in `%SYS` and in some other namespaces.
~~~

**Probe log** (AC 41.4.1, 41.4.2). Plan stage, 2026-10-19, `server:"default"`, namespace `HSCUSTOM`.

- **Target:** `iris_server_info` reported `IRIS for UNIX (Ubuntu Server LTS for ARM64 Containers) 2026.2 (Build 221U)`.
- **Before and after:** `iris_doc_list filter:"Probe414" generated:true` returned `[]` before the first put and after the last delete.
- **Classes:** 19 disposable `ExecuteMCPv2.Temp.Probe414*` classes, compiled with `ck`. Two compiles failed as intended: `Probe414OpBadMap`, and `Probe414NoInc` before `Include Ensemble` was added. `Probe414OpBadAdapter` was expected to fail and compiled (I7). 18 were deleted with one `iris_doc_delete`, then `Probe414Rs` with a second.
- **Writes:** no HSCUSTOM global. SQL data lived only in process-private globals (`^||Probe414ItemD`/`I`), killed at the end of every call. No message class or production class was compiled (AC interpretations). No production was started, stopped or read. Configuration and security objects were read only (`Config.Namespaces.Get`, `Config.Databases.Get` and `:List`, `SYS.Database.%OpenId`, `Security.Roles` `Get`/`Exists`/`:List`/`:ListAll`/`%OpenId`, `Security.SSLConfigs` `:List`/`Get`/SQL/`%OpenId`).
- **Reads:** `%Dictionary.CompiledClass`, `CompiledStorage`, `CompiledIndex` and `CompiledProperty` (`iris_sql_query`); the compiled `.int` of `Probe414Op` (`iris_routine_intermediate`, the `MessageHandler` section only); `%Projection.XML` (`iris_doc_get` 1-80); the IRIS source in the Code Map.
- **Upstream (data only):** `skills/skills/objectscript-sql-patterns/SKILL.md`, `objectscript-list-patterns/SKILL.md`, `ensemble-production/SKILL.md` (lines 1-36, 173-224, 384-509) and the headings of `iris-sql/SKILL.md`. Nothing was executed.
- **Code-review probe (2026-10-19, wave-7 decision #15).** Same target (`iris_server_info`: 2026.2 Build 221U). Two disposable classes, `ExecuteMCPv2.Temp.Probe414CRItem` (persistent, `DEFAULTGLOBAL = "^||Probe414CRItem"`, killed at the end of the call) and `ExecuteMCPv2.Temp.Probe414CRSql`, compiled with `ck`, run, then deleted with one `iris_doc_delete`; `iris_doc_list filter:"Probe414" generated:true` was `[]` before the first put and after the delete. No HSCUSTOM global, no message or production class. Read-only: `%Dictionary.CompiledClass` and `CompiledStorage` queries, the compiled `.int` of `Probe414CRSql`. Rows Q30 to Q32 are new; Q1 stands with Q30; I1, I2 and C21 gained the evidence named in them.

Each row: claim -- probe -- observed -- verdict. Anchor numbers match the lists below.

*The SQL skill:*

- **Q1, the table name rule.** `%Dictionary.CompiledClass`: `Ens.Request` -> `Ens`/`Request`, `Ens.Config.Item` -> `Ens_Config`/`Item`, `%Dictionary.CompiledClass` -> `%Dictionary`/`CompiledClass`, the probe item class -> `ExecuteMCPv2_Temp`/`Probe414Item`. Holds.
- **Q2, the dotted form.** `%Prepare("SELECT Name FROM Ens.Config.Item")` -> `ERROR #5540: SQLCODE: -30 Message:  Table 'CONFIG.ITEM' not found`; `Ens_Config.Item` prepared with status 1. Holds.
- **Q3, the lookup query.** The same `%Dictionary.CompiledClass` query (Q1). Holds.
- **Q4, SQLCODE values and `%msg`.** `Into`, `Dml`, `Probe414SqlMissing`: 0 on a hit, 100 on no row and on an `UPDATE`/`DELETE` of no row, -30/-29/-400 on errors with `%msg` set. Holds.
- **Q5, `If SQLCODE`.** ObjectScript truth of 100 and of the negative codes observed in Q4 (every nonzero number is true). Holds.
- **Q6, `%msg` after success.** `Extra`: after a -29, a successful statement (SQLCODE 0) left `%msg` defined and still `Field 'NOPE' not found ...`. Holds. This corrected the draft's "a successful statement does not set `%msg`".
- **Q7, DML counters.** `Dml`: `insert:SQLCODE=0,rowid=3,rowcount=1;update2:SQLCODE=0,rowcount=2;update0:SQLCODE=100,rowcount=0;delete0:SQLCODE=100,rowcount=0`. Holds.
- **Q8, `$$$ThrowSQLIfError`.** `Exception`, no `Include`: no throw on 100; on -400, `class=%Exception.SQL,code=-400,status=ERROR #5540: SQLCODE: -400 Message: ...,codes=5540`. Source `%occStatus.inc:84`. Holds.
- **Q9, first-run compilation.** `Probe414SqlMissing` (missing table and missing column) compiled cleanly; at run time SQLCODE -30 and -29. `Extra`: `&sql(... FROM MyApp_Data.Missing)` -> `Table 'MYAPP_DATA.MISSING' not found compiling embedded cached query from ...`. No `MyApp` class exists in the namespace (`%Dictionary.CompiledClass` count 0). Holds.
- **Q10, undefined host variable.** `Into`: `WHERE Code = :tUndef` -> `SQLCODE=100`, no error. Holds.
- **Q11, `INTO` on no row.** `Into`: a variable set to `untouched` and a killed one were both `""` (`$Data` 1) after SQLCODE 100. Holds.
- **Q12, `COUNT(*)`.** `Into`: `SQLCODE=0,tCount=0` for no match, with `tCount` killed first. Holds.
- **Q13, several rows.** `Into`: `ORDER BY Name DESC` over two rows -> `SQLCODE=0,tName=Pear,rowcount=1`; `Cursor`: `DECLARE`/`OPEN`/`FETCH`/`CLOSE` gave both rows, then 100. Holds.
- **Q14, `FindName`, compiled verbatim.** `Probe414Verbatim` (verbatim, table `MyApp_Data.Item`): compiled; run -> `ERROR #5540: SQLCODE: -30 Message:  Table 'MYAPP_DATA.ITEM' not found compiling embedded cached query ...`. Holds.
- **Q15, `FindName` outcomes.** `Probe414Twin` (same text, table pointed at the probe table): `findA:ok=1,name=Apple`; `findNone=ERROR #5001: No item with code none`; the missing table of Q14. Holds.
- **Q16, `%Prepare` and double quotes.** `Dynamic`: a missing table and `WHERE Name = "Apple"` both return error statuses (`SQLCODE: -30 ...`, `SQLCODE: -29 Message:  Field 'APPLE' not found ...`); nothing thrown. Holds.
- **Q17, `%ExecDirect`.** `Dynamic`: `isObj=1,SQLCODE=-30,msg= Table 'NO_SUCH.TABLE414' not found`. Holds.
- **Q18, fetch-time error.** `Dynamic`: `SELECT Name, Price/? ...` with 0 -> `%SQLCODE` 0 after `%Execute`, `%Next(.tSC)` returned 0 at once, `tSC` = `SQLCODE: -400 ... <DIVIDE>...`, `%SQLCODE` -400 afterwards. Holds.
- **Q19, end of rows.** `Dynamic`: `rows=Apple/2,Pear/3,afterSQLCODE=100,rowcount=2`. Holds.
- **Q20, select mode.** `Dynamic`: `defaultSelectMode=0;dueLogical=67000;dueOdbc=2024-06-09;embeddedDue=67000` (`%SelectMode = 1` set before `%Prepare`). Holds.
- **Q21, `ListNames`, compiled verbatim.** `Probe414Verbatim`: compiled; run -> `ERROR #5540: SQLCODE: -30 Message:  Table 'MYAPP_DATA.ITEM' not found` (from `%Prepare`). Holds.
- **Q22, `ListNames` outcomes.** `Probe414Twin`: `list1:ok=1,names=Apple,Pear`; `list99:ok=1,count=0`; a twin whose statement selects `Price/?` -> with 0, `ERROR #5540: SQLCODE: -400 ... <DIVIDE>`; with 1, OK. Holds (the draft's "an execute error" path was never run and was removed).
- **Q23, `""` is NULL.** `NullEmpty`: an object saved with `Name = ""` and a row with no `Name` both match `IS NULL` (`isNull=2`); `INTO` of that row gives length 0. Holds. Contradicts the upstream skill's explanation.
- **Q24, `''` is `$Char(0)`.** `NullEmpty`: an SQL-inserted `''` -> `INTO` and the object property both length 1, `$Ascii` 0; `= ''` matched one row. Holds.
- **Q25, a `$Char(0)` property.** `NullEmpty`: `objChar0EqEmpty=1`. Holds.
- **Q26, `IS NULL OR = ''`.** `NullEmpty`: `nullOrEmpty=3` over the three rows. Holds.
- **Q27, `%OpenId` on a missing ID.** `OpenId`: `isObj=0,value=[]`, `sc=ERROR #5809: Object to Load not found, class '...', ID '999999'`; without a status argument, `""` and no error. Holds.
- **Q28, chaining and `%ExistsId`.** `OpenId`: `%ExistsId` 0 and 1; `%OpenId(999999).Name` -> `<INVALID OREF>`. Holds.
- **Q29, `%DeleteId`.** `OpenId`: `ERROR #5810: Object to Delete not found, class '...', ID '999999'`. Holds.
- **Q30, the default and its exceptions (code review).** Source `%occDetermineSchemaName.inc:14-17`: the package's SQL name when one is set, `SQLUser` for the package `User`, else the dots of the package become underscores. `Probe414CRItem` (`[ SqlTableName = Probe414CRTable ]`, process-private storage): `%Dictionary.CompiledClass` -> `ExecuteMCPv2_Temp`/`Probe414CRTable`; `Probe414CRSql.TableNames`: `%Prepare` of `ExecuteMCPv2_Temp.Probe414CRTable` status 1, of `ExecuteMCPv2_Temp.Probe414CRItem` -> `SQLCODE: -30 ... Table 'EXECUTEMCPV2_TEMP.PROBE414CRITEM' not found`. No `User.*` class exists in HSCUSTOM, so the `User` case rests on the source. Holds (Q1 alone stated the rule without exceptions).
- **Q31, which errors replace `%msg` (code review).** `Probe414CRSql.Inner`, one method: a -29 (`Field 'NOPE' not found ...`) then a -400 (`SELECT Price/0 INTO ...`) left the -29 text; with `%msg` set to `STALE TEXT` first, a -30 (`Table 'EXECUTEMCPV2_TEMP.NOSUCHTABLE414' not found ...`) and a -29 (`Field 'NOPE2' ...`) each replaced it, and a -400 left `STALE TEXT`; with `%msg` `""` or killed, the -400 read `Unexpected error occurred:  <DIVIDE>...`; a later successful statement left that text. Confirms QA's run (`QA414Twin.RunCodes`, `QA414Probe.Div2`). Holds.
- **Q32, `%msg` per method and the clearing advice (code review).** `Probe414CRSql.Run` set `%msg = "CALLER TEXT"` and called `Inner`: `atStart=0` in `Inner`, `callerAfter=CALLER TEXT`; the compiled `.int` of `Inner` opens with `New %ROWCOUNT,%ROWID,%msg,SQLCODE`. After a stale `%msg`, `$$$ThrowSQLIfError(SQLCODE, %msg)` on a -400 threw `ERROR #5540: SQLCODE: -400 Message: STALE TEXT`; after `Set %msg = ""`, `ERROR #5540: SQLCODE: -400 Message: Unexpected error occurred:  <DIVIDE>...`. Holds.

*The system-class skill:*

- **C1, what the three families hold.** Source: `Config.CommonMultipleMethods` `Get`/`Create`/`Modify`/`Delete` take `CPFFile` and `$$$CPFSave+$$$CPFWrite+$$$CPFActivate`; `SYS.Database.Mounted` is a runtime property; `Security.*` classes are users, roles, resources. Holds.
- **C2, `%SYS` only.** `Visibility`: `Config.Databases`, `SYS.Database`, `Security.Users`, `SYS.Stats.Global` = 0 in HSCUSTOM and USER, 1 in `%SYS`; the class docs run their examples at a `%SYS>` prompt (`Config/Databases.cls:27-32`). Holds.
- **C3, calling one outside `%SYS`.** `Switching`: `SYS.Stats.Routine.Sample()` in HSCUSTOM -> `<CLASS DOES NOT EXIST>`. Holds.
- **C4, `%SYS.ProcessQuery` in USER.** `Visibility`: 1 in HSCUSTOM, `%SYS` and USER. Holds (narrowed from the draft's "every namespace").
- **C5, `Config.Databases.Get`.** `DbJoin`: keys `ClusterMountMode,Directory,MountAtStartup,MountRequired,Server,StreamLocation`; no `Size`, no `Mounted`. Holds.
- **C6, `SYS.Database` by directory.** `DbJoin`: `sysOpened=1,sizePositive=1,mounted=1,readOnly=0`. Holds.
- **C7, `props("Globals")`.** `DbJoin`: `Config.Namespaces.Get("HSCUSTOM")` -> `db=HSCUSTOM`. Holds.
- **C8, no `NamespaceList`.** `DbJoin`: `%Dictionary.CompiledMethod` `Config.Namespaces||NamespaceList` 0, `CompiledQuery` `Config.Namespaces||List` 1. Holds.
- **C9, `List` against `ListAll`.** `Roles`: `List=Name,Description,GrantedRoles,CanBeEdited,EscalationOnly`; `ListAll=Name,Description,GrantedRoles,Resources,EscalationOnly`. Holds.
- **C10, `Get` on a missing name.** `Roles`: `ERROR #883: Role NoSuchRole414 does not exist.`; `RunDatabaseDirectory`: `ERROR #420: Database NOSUCHDB414 does not exist`. Holds.
- **C11, `%All`.** `Roles`: `Get("%All")` status 1, `Resources` empty; `%Developer` has resources. Holds.
- **C12, deprecated properties.** `Probe414Sys2.Deprecated`: `%Dictionary.CompiledProperty` with `Deprecated = 1` for `Security.SSLConfigs` -> `CRLFile,Protocols,SNIName`. Holds.
- **C13, `Protocols` reads empty.** `Probe414Sys3.DeprecatedRead`: SQL (SQLCODE 0) and the object both give `Protocols` empty for all three configurations, each with `TLSMinVersion` 16 and `TLSMaxVersion` 32. Holds.
- **C14, `Get` leaves it out.** `Deprecated`: `Get` -> `Protocols` undefined for each configuration. Holds.
- **C15, `DatabaseDirectory`, compiled verbatim.** `Probe414Sys` and `Probe414Verbatim`, verbatim: compiled. Holds.
- **C16, its outcomes.** `RunDatabaseDirectory`: `ok=1,hasDir=1,ns=HSCUSTOM`; `missing=ERROR #420: ...,dir=[],ns=HSCUSTOM`; `empty=ERROR #5001: A database name is required,ns=HSCUSTOM`. Holds.
- **C17, an error does not undo `Set $NAMESPACE`.** `Switching`: a called method set `%SYS` then divided by zero -> caller's `Catch` saw `afterThrow=%SYS,error=<DIVIDE>`. Holds.
- **C18, locals.** `Switching`: `localInSys=kept`. Holds.
- **C19, a missing namespace.** `Switching`: `missingNs=<NAMESPACE>,nsAfter=HSCUSTOM`. Holds.
- **C20, `%SYS.Namespace.Exists`.** `Switching`: `exists=0,1` for a missing namespace and `%SYS`. Holds.
- **C21, a statement result killed after the switch.** `Probe414Sys2.CloseAfterSwitch`: `%PrepareClassQuery("Security.Roles","ListAll")` result killed in HSCUSTOM -> `<CLASS DOES NOT EXIST>`, data `Security.Roles`; killed before the switch: no error. Holds. The text says to kill the result, not to close it: `%CloseCursor` is `Private` (`%Library/IResultSet.cls:307`, `%SQL/CustomQuery.cls:203`), so no public method closes it (code review).
- **C22, one left open at method end.** `Probe414Sys.Deprecated` restored the namespace with a `Security.SSLConfigs` `:List` statement result still open; the call itself failed with `<CLASS DOES NOT EXIST>%CloseCursor *Security.SSLConfigs` although the method had a `Catch`. Holds.
- **C23, `%ResultSet` is not affected.** `Probe414Rs`: a `%ResultSet` of `Security.Roles:ListAll`, executed with an open row, and one never executed, both killed after the switch with no error; one left open at method end returned normally. Holds. This narrowed the draft's "close the result set of a `%SYS` class query" and showed that the suite's own handlers, which use `%ResultSet`, do not carry the trap (no deferred item).
- **C24, an object by ID.** `CloseAfterSwitch`: `Security.Roles.%OpenId("%developer")`, read (`Name` = `%Developer`) and killed after the switch, no error. Holds.
- **C25, mappings and the REST-handler advice.** `Visibility`: the probe item class (a mapped package) = 1 in `%SYS` and USER; `Ens.Director` = 0 in `%SYS`. The advice also rests on C17 and the gotchas skill's `New $NAMESPACE` row (`inCatch=%SYS`). Holds.
- **C26, per-process counter.** `Counters`: `processDelta=200488` (and 200,935 in the second run) for a 100,000-pass loop. Holds.
- **C27, a worker's total.** `Probe414Sys3.Counters`: `processTotal=3504819233`. Holds.
- **C28, instance totals.** `Probe414Sys3.Counters`: `SYS.Stats.Routine.Sample().RtnCommands` and `SYS.Stats.Global.Sample()` `RefLocal + RefPrivate + RefRemote` (56,738,158,872), both read in `%SYS`. Holds.
- **C29, the ratio and growth.** `Probe414Sys3.Counters`: `instanceTotal=178223276805,instanceOverProcess=51`; `commandsMonotonic=1`, `globalRefsMonotonic=1`. Holds.
- **C30, the declared type.** Source `SYS/Stats/Routine.cls:45` (`As SYS.Stats.Global`); `Counters`: `routineSampleClass=SYS.Stats.Routine`. Holds.
- **C31, deltas.** `Counters`, run twice: `processDelta=200488,instanceDelta=200430` both times. Holds. The text does not claim the lag this shows; it claims only that a delta does not separate the two.

*The interoperability skill:*

- **I1, `Ens.Request`/`Ens.Response` and the send signatures.** Source `Ens/Request.cls:5`, `Ens/Response.cls:5`, `Ens/MessageBody.cls:9` (`%Persistent`); `SendRequestSync`/`Async` declare `pRequest As %Library.Persistent` in `BusinessService.cls:138,182`, `BusinessOperation.cls:713,726`, `Host.cls:126` and `BusinessProcess.cls:143`, while `BusinessProcess.cls:160` `SendRequestAsync` declares `pRequest As Request` (`Ens.Request`). Holds (narrowed in code review from "the send methods take a `%Library.Persistent`").
- **I2, one storage for `Ens.MessageBody` classes.** `%Dictionary.CompiledStorage`: `Ens.MessageBody`, `Ens.Request`, `Ens.Response`, `Ens.StringRequest`, `Ens.StringResponse` all `^Ens.MessageBodyD`; `Ens.StreamContainer` `^Ens.StreamContainerD`, `Ens.StringContainer` `^Ens.StringContainerD`, `EnsLib.HL7.Message` `^EnsLib.H.MessageD` (code review, read-only query); source `MessageBody.cls:7-8,30`, `StreamContainer.cls:300`. Holds (narrowed in code review from "every message body class").
- **I3, `NewResponse`.** `Probe414Op.NewResponseOfString`: `sc=ERROR <Ens>ErrGeneral: Ens.StringRequest has no value for parameter RESPONSECLASSNAME;isObj=0`. Holds.
- **I4, `StringValue`.** Source `StringRequest.cls:9`, `StringResponse.cls:9`. Holds.
- **I5, the `FileWriter` block, compiled verbatim.** `Probe414FileWriter` (class name changed): compiled. Holds.
- **I6, the outbound adapter methods.** Source `EnsLib/File/OutboundAdapter.cls:142,147,160`. Holds.
- **I7, a misspelled adapter.** `Probe414OpBadAdapter` (`ADAPTER = "No.Such.Adapter414"`): compiled. Holds.
- **I8, map order.** `Probe414Op` compiled `.int`: `If pRequest.%IsA("Ens.StringRequest") { ... Set tSC=..Write(.pRequest,.pResponse) ... Quit }` then `..OnMessage`; source `BusinessOperation.cls:640-667`. Holds.
- **I9, the default `OnMessage`.** Source `BusinessOperation.cls:707-709` (`$$$EnsErrRequestNotHandled`). Holds.
- **I10, a missing map method.** `Probe414OpBadMap`: compile failed with `ERROR #5001: Method Missing referenced in MessageMap does not exist`. Holds.
- **I11, no argument-type check.** `Probe414OpMacros`: a map from `Ens.StringRequest` to a method typed `Ens.StringResponse` compiled; source `BusinessOperation.cls:638` (the check is a `TODO`). Holds.
- **I12, typed handler and `OnMessage`.** `Probe414Op` (`Write`) and `Probe414OpTyped` (`OnMessage(pRequest As Ens.StringRequest, Output pResponse As Ens.StringResponse)`): compiled. Holds.
- **I13, an open transaction.** `Probe414Op` compiled `.int`: `If $TLevel>0 ... TCommit ... LogWarning(... "open user transaction" ...)` after the handler. Holds.
- **I14, `INVOCATION`.** Source `Ens/Host.cls:13-14` (`"Queue"`; modes Queue and InProc). Holds.
- **I15, log macros in a host.** `Probe414OpMacros`: `$$$LOGINFO`, `$$$LOGWARNING`, `$$$LOGERROR` and `$$$TRACE` compiled with no `Include`; source `Ens/Host.cls:5` (`Include Ensemble`). Holds.
- **I16, outside a host.** `Probe414NoInc`: `MPP5610 : Referenced macro not defined: 'LOGINFO'`; with `Include Ensemble`, compiled. Holds.
- **I17, settings.** `Probe414FileWriter.GetSettings`: `Prefix` first, in category `Basic` ("Basic Settings"), then 14 inherited; `-ThrottleDelay` hidden; source `Ens/Settings.cls:48-110`. Holds.
- **I18, adapter settings.** `Probe414Op.Settings`: `adapterHasFilePath=1;hostHasFilePath=0`. Holds.
- **I19, `OnProcessInput`.** Source `BusinessService.cls:132`; `Probe414Svc` with `pInput As %Stream.Object`: compiled. Holds.
- **I20, the file inbound adapter.** Source `EnsLib/File/InboundAdapter.cls:469-479` (a file stream, `Attributes("Filename")`, `..BusinessHost.ProcessInput(tStream)`). Holds.
- **I21, an unknown target.** Source `BusinessService.cls:142`, `BusinessProcess.cls:146` (`$$$EnsErrBusinessDispatchNameNotRegistered`, returned as a status). Holds.
- **I22, the `OnProcessInput` comment.** Source `BusinessService.cls:131`. Holds.
- **I23, `CreateBusinessService`.** Source `Ens/Director.cls:1451-1475` (not registered, disabled, quiescent and "Not a BusinessService" errors). Holds.
- **I24, typed `OnRequest`.** `Probe414Proc` (`OnRequest(pRequest As Ens.StringRequest, Output pResponse As Ens.StringResponse)`): compiled. Holds. Contradicts the upstream claim.
- **I25, `SendRequestAsync` and `OnResponse`.** Source `BusinessProcess.cls:160` (`pResponseRequired`, `pCompletionKey`), `:846-850` (default `OnResponse` returns `$$$EnsError($$$NotImplemented)`); `Probe414Proc` with an `OnResponse` keyed on the completion key compiled. Holds.
- **I26, `OnComplete`.** Source `BusinessProcess.cls:863-864`. Holds.
- **I27, the deadlock warning.** Source `BusinessProcess.cls:142`. Holds.
- **I28, compile reloads.** Source `Ens/Projection/Production.cls:12-40` (deletes the `Ens.Config.Production` row, validates and calls `LoadFromClass`). Holds.
- **I29, `LoadFromClass`.** Source `Ens/Config/Production.cls:173-190`. Holds.
- **I30, `SaveToClass`.** Source `Ens/Config/Production.cls:123-170` (saves the class definition; no compile, no `%Save` of the production); `Ens/Production.cls:226-228` (`OnConfigChange` is empty by default). Holds.
- **I31, the item index.** `%Dictionary.CompiledIndex` `Ens.Config.Item||Name`: `Production:Exact,Name:Exact`, not unique, not the ID key; source `Item.cls:150`, `Production.cls:680`. Holds.
- **I32, `UpdateProduction`.** Source `Ens/Director.cls:151-157`. Holds.

**Flagged for the retro:** none of the probes contradicts a `.claude/rules/*` file. Two facts the rules lack: embedded SQL compiles when it first runs (Q9), and a `%PrepareClassQuery` result must be closed before the namespace is switched back (C21, C22).

**Probe anchors**, one per claim row, which `skills-pack-knowledge.test.ts` requires verbatim (the test types each without the outer Markdown code span shown here). 95 new, 170 in all.

- **sql (32):**
  - `` `Ens.Config.Item` is the table `Ens_Config.Item` ``
  - `` `Table 'CONFIG.ITEM' not found` ``
  - `SELECT SqlSchemaName, SqlTableName FROM %Dictionary.CompiledClass WHERE Name = ?`
  - `100 when it found or changed no row`
  - `` Test `SQLCODE = 100` and `SQLCODE < 0` apart ``
  - `still holding the text of an earlier error`
  - `` `%ROWID` holds the new row's ID ``
  - `` `ERROR #5540: SQLCODE: -400 Message: ...` ``
  - `` `Table 'MYAPP_DATA.MISSING' not found compiling embedded cached query` ``
  - `` with `tCode` undefined finds nothing and gives 100 ``
  - `` every `INTO` variable is set to `""` ``
  - `` `tCount` is 0 when nothing matches ``
  - `takes the first one and gives 0`
  - `&sql(SELECT Name INTO :tName FROM MyApp_Data.Item WHERE Code = :pCode)`
  - `` No row and an SQL error, such as a missing table, each end in `tSC` ``
  - `` `Field 'APPLE' not found` ``
  - `` `%ExecDirect` returns a result object even when the statement fails ``
  - `` `%Execute` leaves `%SQLCODE` at 0 ``
  - `` `%ROWCOUNT` is the number of rows fetched ``
  - `` the ODBC form, `2024-06-09` ``
  - `While tRS.%Next(.tFetch) {`
  - `No matching row is no error`
  - `` A saved object whose `Name` is `""` matches `Name IS NULL` ``
  - `` It is stored as `$Char(0)` ``
  - `` A property set to `$Char(0)` matches `Name = ''` too ``
  - `` test `Name IS NULL OR Name = ''` ``
  - `` `ERROR #5809: Object to Load not found, class '...', ID '...'` ``
  - `` `%OpenId(tId).Name` raises `<INVALID OREF>` ``
  - `` `ERROR #5810: Object to Delete not found` ``
  - `` A class of the package `User` is in the schema `SQLUser`, and a class's `SqlTableName` ``
  - `` but an error raised while the statement runs, such as -400, sets `%msg` only when it is empty ``
  - `` A method that holds embedded SQL starts with `%msg` undefined ``
- **system-classes (31):**
  - `` `Config.*` classes read and write the instance's configuration file ``
  - `` `##class(%Dictionary.CompiledClass).%ExistsId("Config.Databases")` is 0 ``
  - `` calling such a class from outside `%SYS` raises `<CLASS DOES NOT EXIST>` ``
  - `` exists in `USER` too ``
  - `but no size and no mounted state`
  - `` gives `Size` in MB, `Mounted` and `ReadOnly` ``
  - `` `props("Globals")` ``
  - `` has no `NamespaceList` method ``
  - `` its `ListAll` query has one ``
  - `` `ERROR #883: Role ... does not exist` ``
  - `` gives it an empty `Resources` ``
  - `` `CRLFile`, `Protocols` and `SNIName` ``
  - `read empty for each of three TLS configurations`
  - `` `Get(name, .props)` leaves it out ``
  - `Set tSC = ##class(Config.Databases).Get(pName, .tProps)`
  - `` for a missing one with `ERROR #420` ``
  - `` the caller's `Catch` runs in `%SYS` ``
  - `Local variables keep their values across a switch`
  - `` raises `<NAMESPACE>` and leaves you where you were ``
  - `` `##class(%SYS.Namespace).Exists(name)` ``
  - `` Killed after the switch, it raised `<CLASS DOES NOT EXIST>` ``
  - `` after the method's own `Catch` had finished ``
  - `` A `%ResultSet` of the same query could be killed after the switch without an error ``
  - `which could also still be read`
  - `` a mapped package resolved in `%SYS`, while `Ens.Director` did not ``
  - `a loop of 100,000 passes added about 200,000 commands`
  - `` `CommandsExecuted` was 3.5 billion ``
  - `` `RefLocal + RefPrivate + RefRemote` ``
  - `51 times the worker's`
  - `` but it returns a `SYS.Stats.Routine` ``
  - `grew by 200,430 and the process's by 200,488`
- **interoperability (32):**
  - `` except a business process's `SendRequestAsync`, which declares an `Ens.Request` ``
  - `` as `Ens.Request` and `Ens.Response` are, keeps its data in `^Ens.MessageBodyD` ``
  - `` `ERROR <Ens>ErrGeneral: Ens.StringRequest has no value for parameter RESPONSECLASSNAME` ``
  - `` each carry one `StringValue` property ``
  - `<MapItem MessageType="Ens.StringRequest">`
  - `` offers `PutString(filename, data)`, `PutLine` and `PutStream` ``
  - `A misspelled adapter class still compiles`
  - `tests in map order, so the first match wins`
  - `` goes to `OnMessage`, whose default returns an error ``
  - `` `Method Missing referenced in MessageMap does not exist` ``
  - `does not check that the method's argument type matches`
  - `` and so may an override of `OnMessage` ``
  - `is committed after it returns, with a warning in the event log`
  - `` `Parameter INVOCATION` is `"Queue"` ``
  - `` work in a business host without an `Include` ``
  - `` `MPP5610 : Referenced macro not defined: 'LOGINFO'` ``
  - `` leaving `Prefix` and 14 inherited ones ``
  - `come from the adapter class's own list`
  - `` A narrower type for `pInput`, such as `%Stream.Object`, compiles ``
  - `` `pInput.Attributes("Filename")` ``
  - `a name the running production does not know returns an error status`
  - `` The comment on `OnProcessInput` says not to call the send methods from outside it ``
  - `or the production is quiescent`
  - `Typed arguments compile here too`
  - `` The default `OnResponse` returns an error ``
  - `` `OnComplete` runs when every response is in or the wait has timed out ``
  - `can deadlock when both share the production's actor pool`
  - `Compiling that class deletes the production's row in the configuration tables`
  - `does the same reload`
  - `but does not compile it`
  - `covers the production and the name together and is not unique`
  - `applies a changed configuration to the running production`

Rows and anchors map one to one, in order: Q1 to Q32, C1 to C31 and I1 to I32.

**Scratch copies (convenience only; the spec text is authoritative).** The plan's measured drafts are at `/private/tmp/claude-501/-Users-jbrandt-git-iris-execute-mcp-v2/03eb9a39-2d9e-4087-85ac-363a9bb86d2a/scratchpad/skills414/<name>/SKILL.md` and the notice at `.../scratchpad/notice414/IRIS-MCP-THIRD-PARTY-NOTICES.md`; the skill drafts predate the code-review corrections, so only the notice is still byte-equal to its golden form. If they are gone, recreate from the fences above and check the sha256.

## Verification

- **How commands run.** Every command runs from `/Users/jbrandt/git/iris-execute-mcp-v2` in the foreground with `timeout: 600000`, one package or one test-file group per call.
- **Builds.** `validate:prompts` and `check:provenance` need the built dists of shared, the five servers and client-config. No package `src/` changes, so no rebuild is needed unless one is stale.
- **IRIS.** No live gate and no stateful OS test class. The only IRIS writes allowed are disposable `ExecuteMCPv2.Temp.Probe414*` classes to re-run a changed claim, each deleted, with `iris_doc_list filter:"Probe414" generated:true` = `[]` afterwards.

**Shared surfaces:** these change, and other tests assert on them.

- The pack file set (19 -> 22) and client-config's tarball list.
- The notice: its first provenance row, which every fixture feeding the real notice to `checkProvenance` sees.
- The validator OK line (45 -> 51 sources: 39 content files, 6 knowledge, 20 pack).
- `check:provenance`'s OK line (0 -> 1 row, 33 -> 39 agent files).
- `listAgentContentFiles` output (6 more files); the knowledge directory set that `story-41-3-qa-knowledge-gate-process.test.ts` pins.
- The 41.1 and 41.3 count pins listed in the Code Map; `skills-pack-src/README.md`; the CHANGELOG's newest section.

**Standing criterion:** every test added or changed passes on a fresh environment, in either order.

**Commands:**

- `(loop)` `shasum -a 256 skills-pack-src/knowledge/*/SKILL.md skills-pack-src/IRIS-MCP-THIRD-PARTY-NOTICES.md` -- expected: the three new golden values, the three 41.3 values unchanged, and the golden notice value.
- `(loop)` `pnpm gen:pack` twice, then `git status --short packages/client-config/skills-pack` -- expected: the three new skill directories and the notice copy, and no change on the second run. Then `pnpm gen:pack:check` -- expected: `22 pack file(s) match their sources`.
- `(loop)` `pnpm validate:prompts`, then `pnpm check:provenance` -- expected: `51 source(s) checked (12 prompt(s) + 39 content file(s): 12 workflow, 20 pack, 6 knowledge, 1 rule)`; `1 provenance row(s), 39 agent file(s), 8 distribution(s)`.
- `(loop)` `npm pack --dry-run --json --ignore-scripts --offline` in `packages/client-config` -- expected: lists the three new `skills-pack/skills/<name>/SKILL.md` and `skills-pack/IRIS-MCP-THIRD-PARTY-NOTICES.md`.
- `(loop)` `pnpm --filter @iris-mcp/all exec vitest run` over `src/__tests__/skills-pack-knowledge.test.ts src/__tests__/skills-pack-frontmatter.test.ts src/__tests__/pack-provenance.test.ts src/__tests__/skills-pack.test.ts src/__tests__/skills-pack-rule.test.ts src/__tests__/validate-prompts.test.ts src/__tests__/story-41-2-doc-claims.test.ts src/__tests__/story-41-2-qa-rule-text-hygiene.test.ts src/__tests__/skills-generated-frontmatter.test.ts` -- expected: pass.
- `(loop)` the five `src/__tests__/story-41-1-qa-*.test.ts` files in one call, and the two `src/__tests__/story-41-3-qa-*.test.ts` files in another -- expected: pass.
- `(once)` One call each: `pnpm --filter @iris-mcp/shared test`, and the same for dev, admin, interop, ops and client-config; the full `@iris-mcp/all` suite in three calls (`ls src/__tests__/*.test.ts | awk 'NR%3==k'`, k = 1, 2, 0) -- expected: green.
- `(once)` `pnpm gen:skills:check` (`13 generated file(s)`), `pnpm gen:governance-baseline:check` (`1e62c5ad5bf7`/141), `pnpm gen:tools-list-snapshot:check`, `node scripts/check-epics-sync.mjs` and `git diff --stat packages/shared/src/bootstrap-classes.ts` (empty) -- expected: OK.

**Planned mutations (Rule 19).** Apply each, observe red, revert (re-running `gen:pack` where it applies), and confirm `git status --short` and `git diff --stat` are unchanged. Record each as `mutation: <change> → <test>`.

- **M1** (AC 41.4.3, on the guarded path): delete the golden row from the source notice and run `gen:pack` -> `pnpm check:provenance` exits 1 with `[claim-row]` for `knowledge:iris-mcp-objectscript-sql/SKILL.md` and `pack:skills/iris-mcp-objectscript-sql/SKILL.md`; `pack-provenance.test.ts` "real tree passes every provenance rule" and the knowledge test's notice-row test go red.
- **M2** (AC 41.4.3): delete line 6 (the header) of the SQL source and run `gen:pack` -> `pnpm check:provenance` exits 1 with `[row-file]`; the knowledge test's header test goes red.
- **M3** (the exception is keyed to the oracle): apply the exception to every skill, not only one with `adaptedFrom` -> the control "the header as the first body line of a skill not marked adapted is flagged" goes red.
- **M4** (the exception is one line): drop the exception -> the SQL skill's ASCII and hygiene tests go red, naming "a tool or server name" and "a repository file".
- **M5** (AC 41.4.1): change "51 times" to "50 times" in the system-class source -> "carries every probe anchor" goes red, naming the anchor (the sha256 and pack-copy rows too).
- **M6** (AC 41.4.2): reverse "so the first match wins" in the interoperability source -> the anchor test goes red.
- **M7** (AC 41.4.3, the count): move one new knowledge directory out and re-run `gen:pack` -> "are exactly the planned skills" goes red with 5, and the moved count pins (`22 pack file(s)`, `51 source(s) checked`, `39 agent file(s)`) go red.
- **M8** (the row oracle): change the row's source cell to `skills/skills/iris-sql/SKILL.md` (a valid path) -> `check:provenance` stays green, and the knowledge test's notice-row test goes red (the oracle pins the specific source).
- **M9** (the wording): add the line "- Call `iris_production_item`." to the interoperability source -> `pnpm validate:prompts` stays green (a real tool), and the knowledge test's tool-name and hygiene tests go red.
- **Unchanged counts:** pinned by the existing `(once)` gates; this story edits no prompt, tool, preset, governance or bootstrapped input. mutation: CR1 (below).

**Demonstrated mutations (implement pass).** Each was applied with the file tools, observed red, and reverted; a sha256 listing of `skills-pack-src/`, the pack and the `__tests__` directory, `git status --short` and `git diff --stat` were identical before and after each one (M7 also changed the knowledge test once, on purpose, see below). M10 and M11 are added to the plan: they cover the 41.1 and 41.3 pins this story moved.

- mutation: M1, the golden row deleted from the source notice and `pnpm gen:pack` re-run -> `pnpm check:provenance` exit 1 with `[claim-row] pack:skills/iris-mcp-objectscript-sql/SKILL.md` and `[claim-row] knowledge:iris-mcp-objectscript-sql/SKILL.md`; `pack-provenance.test.ts` "real tree passes every provenance rule" and "the check-provenance CLI > exits 0 on the real tree", and the knowledge test "the notice holds exactly the rows of the adapted skills", went red.
- mutation: M2, line 6 (the header) deleted from the SQL source and `pnpm gen:pack` re-run -> `pnpm check:provenance` exit 1 with `[row-file] skills/iris-mcp-objectscript-sql/SKILL.md ... without the adaptation header`; the knowledge test "opens with the adaptation header as its first body line" and the sha256 row went red.
- mutation: M3, `checkedText` stopped requiring `adapted` (the exception applied to every skill) -> the control "flags the same header in a skill that is not marked adapted: non-ASCII, a tool or server name, a repository file" went red (the only red test).
- mutation: M4, `checkedText` returned the whole text (the exception dropped) -> the SQL skill's "is ASCII, LF only ..." and "names nothing of this repository ..." (`["a repository file", "a tool or server name"]`), its header test, and the control "passes an adapted skill whose header is its first body line, and nothing else" went red.
- mutation: M5, "51 times" changed to "50 times" in the system-class source, pack not regenerated -> "carries every probe anchor" went red naming `51 times the worker's`; the sha256 row and the pack-copy row went red too.
- mutation: M6, "so the first match wins" changed to "so the last match wins" in the interoperability source, pack not regenerated -> "carries every probe anchor" went red naming `tests in map order, so the first match wins`; the sha256 and pack-copy rows went red too.
- mutation: M7, `knowledge/iris-mcp-interoperability/` moved out and `pnpm gen:pack` re-run (21 pack files) -> the knowledge test "are exactly the six planned skills, and six is within the 6 to 10 the pack allows" went red with 5 directories; the `22 pack file(s)` pins (`story-41-1-qa-pack-scratch-cli.test.ts`, `skills-pack-rule.test.ts`), the `37 pack file(s)` pin, the `51 source(s) checked` pins, the `44 content file(s)` pin, and the `39 agent file(s)` and `41 agent file(s)` pins (`story-41-1-qa-provenance-cli.test.ts`, `skills-pack-frontmatter.test.ts`) went red. Before this pass the knowledge test read each source at collection, so the missing directory failed the whole file with ENOENT and 0 tests ran; `readSourceBytes` now returns no bytes for a missing source, so the directory test is the test that reports the 5 against 6.
- mutation: M8, the row's source cell changed to `skills/skills/iris-sql/SKILL.md` and `pnpm gen:pack` re-run -> `pnpm check:provenance` stayed green (1 row, 39 agent files); the knowledge test "the notice holds exactly the rows of the adapted skills" went red.
- mutation: M9, "- Call `iris_production_item`." added to the interoperability source and `pnpm gen:pack` re-run -> `pnpm validate:prompts` stayed green (51 sources); the knowledge test "names no iris_* tool" (`["iris_production_item"]`) and "names nothing of this repository ..." (`["a tool or server name"]`) went red, with the sha256 row.
- mutation: M10, the `claim-row` push in `checkProvenance` (`scripts/lib/provenance-core.mjs`) disabled -> `story-41-1-qa-provenance-cli.test.ts` "a notice without the provenance table header row (no row is then read, ...) is refused" went red (it now expects `["claim-row", "notice"]`), along with the other `claim-row` pins in that file and in `pack-provenance.test.ts`; reverted, `git diff --stat -- scripts` empty.
- mutation: M11, `...REAL_ROW_FILES` removed from `inputsFor` in `pack-provenance.test.ts` and `...committedRowFiles(realNotice)` removed from `inputsWith` in `skills-pack-frontmatter.test.ts` -> 27 tests across the two files went red (`row-file` for the real row), so the fixtures feed the real row's pack file, and the exact problem lists stay unchanged only because of it.

**Review-pass mutations.** The review pass added the CRLF control and two offender rows for the adapted skill, and closed the missing lines for the controls and pins that M1 to M11 did not name. Each was applied with the file tools, observed red, and reverted; `git diff <baseline_revision> | shasum -a 256` was identical before and after each one.

- mutation: M12, the adaptation header added after the frontmatter of `iris-mcp-objectscript-unit-tests` (source only) -> the knowledge test "is not adapted: it carries no mention of the upstream project" went red for that skill (with its sha256, pack-copy, ASCII and hygiene rows).
- mutation: M13a, `checkedText` removed every line equal to `ADAPTATION_HEADER` instead of the first -> the control "flags a second copy of the header in an adapted body" went red (the only red test).
- mutation: M13b, `checkedText` stopped requiring `hasValidAdaptationHeader` -> the control "flags the header at the end of an adapted body: non-ASCII, a tool or server name, a repository file" went red (the only red test).
- mutation: M13c, `checkedText` matched the header by its `Adapted from` prefix and stopped requiring `hasValidAdaptationHeader` -> the controls "flags the header at the end of an adapted body ...", "fails the header check for a header with (c) in place of the copyright sign, and flags it as wording" and "reads an adapted skill with CRLF line endings whole ..." went red.
- mutation: M13d, the `at < 0` guard removed from `checkedText` -> the control "reads an adapted skill with CRLF line endings whole: its header is flagged and no other line is dropped" went red (the only red test).
- mutation: M14, the SQL oracle's `adaptedFrom` changed to `skills/skills/iris-sql/SKILL.md` in the knowledge test -> "the notice holds exactly the rows of the adapted skills" went red at the cross-check of the oracle against the notice (the only red test).
- mutation: M15, "takes the first one and gives 0" changed to "takes the last one and gives 0" in the SQL source, pack not regenerated -> "carries every probe anchor" went red for `iris-mcp-objectscript-sql` (with its sha256 and pack-copy rows).
- mutation: M16, the opening fence of the interoperability code block changed from backticks to tildes in the source, pack not regenerated -> "holds 1 fenced code block(s)" went red for `iris-mcp-interoperability` (with its sha256 and pack-copy rows).
- mutation: M17, the real-tree "names no iris_* tool" and "names nothing of this repository ..." tests made to skip the adapted skill -> `story-41-3-qa-knowledge-gate-process.test.ts` rows "an iris_* tool name that is a real tool, below the adaptation header" and "an internal rule number, below the adaptation header" went red (the only red tests).
- mutation: M18, `iris-mcp-interoperability` dropped from `SKILL_NAMES` and the validator regex changed to `5 knowledge` in `story-41-3-qa-knowledge-gate-process.test.ts` -> "control: the unmodified copy passes and counts the six knowledge skills" and "these rows are hermetic > the real node_modules and the real knowledge sources are intact" went red (the only red tests).

**QA pass (2026-10-19).** Gap analysis against the I/O matrix and the ACs; three real-runtime gaps closed (Rule 3). Test files (QA):

- `packages/iris-mcp-all/src/__tests__/story-41-4-qa-first-row-process.test.ts` (QA, new, 15 tests): the real `check:provenance` process, with the real npm packer and the real `gen-pack.mjs`, on scratch copies of the real tree, against the REAL adapted skill and its real row. The unmodified copy is green (`1 provenance row(s), 39 agent file(s), 1 distribution(s)`, pack regeneration a no-op); then each damage alone, with the exact `[rule] label` pairs: the row removed, pack regenerated (`claim-row` for `knowledge:` and `pack:`); the row removed, pack not regenerated (`claim-row` x2, `distribution`, `notice-sync`); the header removed (`row-file`, the only rule that sees it, because the file then no longer mentions the upstream); the header above the frontmatter (`skill-frontmatter` x2, because the header rule accepts it as the first line of a file with no frontmatter); the credit line altered four ways (`header` x2 plus `row-file`); the row citing an excluded or malformed source three ways (`excluded-source`); the row's pack-file cell renamed (`claim-row` x2, `row-file`); the skill directory renamed (`claim-row`, `row-file`, `skill-frontmatter`); and a row citing another valid source is green here (the knowledge test owns which file is cited, M8). Capture: the first run of the file agreed with every expectation typed from `provenance-core.mjs`.
- `packages/iris-mcp-all/src/__tests__/story-41-3-qa-knowledge-gate-process.test.ts` (QA, changed): four offender rows run the COMMITTED knowledge test in a child process on scratch copies, for the header exemption, with the ASCII test and the header-or-not-adapted test now watched for every skill (`watchedTests`): a second exact copy of the credit line in the adapted skill (ASCII, wording and header tests red); a different ASCII credit-like line (wording red only); the adapted skill's own header with `(c)` (wording and header red); the exact credit line as the first body line of a skill that is not adapted (ASCII, wording and "not adapted" red). The baseline and every offender row also check that the other five skills' watched tests stay green.

Live runtime check of the shipped text (one time, `server:"default"`, namespace `HSCUSTOM`; nothing in the default suite writes to IRIS): the four code blocks were compiled verbatim in disposable `ExecuteMCPv2.Temp.QA414*` classes (`FindName` and `ListNames` against a missing table, then as twins on a process-private table; `DatabaseDirectory`; the `FileWriter` host), 15 classes in all, all deleted, `iris_doc_list filter:"QA414" generated:true` is `[]`. No `%UnitTest` snippet exists in the three skills, so no `iris_execute_tests` run applied. Every claim run held except the one finding below. The `FileWriter` block is illustrative at run time (it needs a running production and a file adapter); its compile, its settings (15: `Prefix` plus 14 inherited, no `ThrottleDelay`), its compiled `MessageHandler` (map order, open-transaction commit) and the adapter's `PutString` were checked instead.

- mutation: QM1, the `claim-row` push in `checkProvenance` disabled (`if (false && ...)`) -> the four "row removed", "row removed without regen", "pack-file cell renamed" and "directory renamed" rows of `story-41-4-qa-first-row-process.test.ts` went red; reverted, `git diff | shasum` identical.
- mutation: QM2, the `excluded-source` push disabled -> the three excluded-source rows went red (the only red tests).
- mutation: QM3, the `row-file` missing-header branch disabled -> "header removed" and the four "credit line altered" rows went red (the only red tests).
- mutation: QM4, the `skill-frontmatter` loop in `checkProvenance` disabled -> "header moved above the frontmatter" and "directory renamed" went red (the only red tests).
- mutation: QM5, `checkedText` in `skills-pack-knowledge.test.ts` made to drop every line equal to the header -> the offender row "a second, exact copy of the credit line" (and the child baseline, through the knowledge test's own control) went red; restored, the file's sha256 equals the pre-mutation value.
- mutation: QM6, `checkedText` made to ignore `adapted` -> the offender row "the exact credit line as the first body line" in the non-adapted skill (and the child baseline) went red.
- mutation: QM7, `checkedText` made to drop every line that contains `Adapted from` -> the three adapted-skill credit rows went red (and the child baseline).
- finding (QA, skill text, not edited by QA; decision 15 gives the correction to code review): `iris-mcp-objectscript-sql` says SQLCODE is "negative for an error, whose text is in `%msg`" and "Read `%msg` only when SQLCODE is negative". Run on 2026.2 Build 221U in one method (disposable `QA414Twin.RunCodes` and `QA414Probe.Div2`, both deleted): an error found while the statement is compiled (-30, -29) always replaces `%msg`, but a RUNTIME error (-400, `SELECT Price/0 INTO ...`) writes `%msg` only when `%msg` is undefined or empty. With `%msg` set to `STALE TEXT` first, the -400 statement left `STALE TEXT` (a new statement text and the same text twice alike); with `%msg` killed or `""` it read `Unexpected error occurred:  <DIVIDE>...`. So in a method that runs several statements, `$$$ThrowSQLIfError(SQLCODE, %msg)` after a -400 can throw an earlier statement's message; each method starts with `%msg` undefined, so the skill's one-statement blocks are not affected. A correction is one sentence (set `%msg = ""` before a statement whose error text matters), and moves the golden text, its sha256 and an anchor, so it is a spec change.
- note: removing the "the header appears once" assertion from the knowledge test left everything green, because `expect(checkedText(text, true)).not.toContain(ADAPTATION_HEADER)` in the same test fails on a second copy too; the two assertions guard one thing.

**Code-review mutations (2026-10-19).** Each was applied with the file tools, observed red, and reverted; `git status --short` and `git diff --stat` were identical before and after, and the three skill sha256 values equal the golden ones afterwards.

- mutation: CR1 (Unchanged counts), "to check" changed to "to verify" in the generated `skills/audit-security-posture/SKILL.md` -> `pnpm gen:skills:check` exit 1 with `DRIFT in skills/audit-security-posture/SKILL.md`; reverted, the file's sha256 is `f9e2115c...` again and the check reports `13 generated file(s)`. `gen:governance-baseline:check`, `gen:tools-list-snapshot:check` (115 entries) and the empty `bootstrap-classes.ts` diff were green in the same pass.
- mutation: CR2 (the SQL and interoperability corrections), "sets `%msg` only when it is empty" changed to "always replaces `%msg`" in the SQL source and "which declares an `Ens.Request`" to "which declares a `%Library.Persistent` too" in the interoperability source, pack not regenerated -> "carries every probe anchor" went red for both skills, naming exactly those two anchors (with their sha256 and pack-copy rows).
- mutation: CR3 (the header appears once, after the redundant assertion was removed), a second copy of the header added above the SQL skill's related-skills list -> "opens with the adaptation header as its first body line ..." went red at `not.toContain(ADAPTATION_HEADER)`, with the ASCII, wording, sha256 and pack-copy rows.

## Auto Run Result

Status: done
Blocking condition: none

**Implement stage (2026-10-19).** One implement pass, one review pass, one patch round.

- **Summary.** Three platform knowledge skills (`iris-mcp-objectscript-sql`, `iris-mcp-system-classes`, `iris-mcp-interoperability`) written byte for byte from the golden texts (sha256 `b48e137b…`, `dd15048c…`, `ea093f10…`), the pack's first provenance row added to the notice (sha256 `d2e80ca6…`), the pack regenerated through `pnpm gen:pack` (19 to 22 files; a second run changes nothing), and the knowledge test extended to six oracles with the one-line adaptation-header exception and its controls. No script, `src/`, prompt, tool, preset, governance or bootstrapped input changed (`BOOTSTRAP_VERSION` stays `5296a1c836f4`).
- **Files changed.**
  - `skills-pack-src/knowledge/iris-mcp-objectscript-sql/SKILL.md`, `.../iris-mcp-system-classes/SKILL.md`, `.../iris-mcp-interoperability/SKILL.md`: new sources.
  - `skills-pack-src/IRIS-MCP-THIRD-PARTY-NOTICES.md`: the golden row under the separator row; `skills-pack-src/README.md`: six skills, the one adapted skill and the narrow exemption.
  - `packages/client-config/skills-pack/` (three skill directories and the notice copy): generated by `gen:pack`.
  - `packages/iris-mcp-all/src/__tests__/skills-pack-knowledge.test.ts`: six oracles, `adaptedFrom`, the exemption (`checkedText`), the notice-row test and six controls; `pack-fixture.ts` (`committedRowFiles`), `pack-provenance.test.ts` and `skills-pack-frontmatter.test.ts`: the fixtures carry the real row's committed pack file; `skills-pack-rule.test.ts`, `story-41-1-qa-pack-scratch-cli.test.ts`, `story-41-1-qa-provenance-cli.test.ts`, `story-41-1-qa-validate-prompts-pack.test.ts`: count pins moved; `story-41-3-qa-knowledge-gate-process.test.ts`: six skills and two offender rows for the adapted skill.
  - `CHANGELOG.md`, `.changeset/story-41-4-platform-knowledge-skills.md`: the release notes and the minor changeset.
- **Review findings.** 33 findings from four layers: high 0, medium 2, low 27, false 4. 14 rows (7 root causes) patched: the CRLF mismatch in `checkedText` (guard and control), a redundant assertion, the missing mutation lines (M12 to M18), two offender rows for the adapted skill, the "first non-blank line" wording in README and CHANGELOG, a stale test title, a stale comment. 19 rows rejected with reasons in the triage log, none deferred (`deferred:` is empty). Patched entries at entry verdict: 1 medium, 6 low.
- **Follow-up review recommendation.** `false`: no patched `high`, and one patched `medium` entry.
- **Verification.** All `(loop)` commands green after the last patch: the three golden sha256 values and the notice's; `gen:pack` twice (22 files, no change) and `gen:pack:check` (`22 pack file(s)`); `validate:prompts` (`51 source(s) checked (12 prompt(s) + 39 content file(s): 12 workflow, 20 pack, 6 knowledge, 1 rule)`); `check:provenance` (`1 provenance row(s), 39 agent file(s), 8 distribution(s)`); the npm tarball lists the three skills and the notice; the nine-file group (463 tests), the four `story-41-1-qa-*` files (118), the two `story-41-3-qa-*` files (56) and the two `story-41-2-qa-*` files (79). All `(once)` commands green: shared 2071, dev 1663, admin 498, interop 672, ops 350, client-config 514, `@iris-mcp/all` in three slices (39, 38 and 38 files; 894, 1074 and 685 tests passed), `gen:skills:check` (`13 generated file(s)`), `gen:governance-baseline:check`, `gen:tools-list-snapshot:check` (115 entries), `check-epics-sync`, and an empty `git diff --stat` for `bootstrap-classes.ts`. Mutations M1 to M18 are recorded under `## Verification`.
- **Residual risks.** The review found two imprecisions in the golden interoperability text that this pass left alone because the golden text is the lead's decided text (Review Triage Log, Blind Hunter 1): "Every message body class keeps its data in one place, `^Ens.MessageBodyD`" holds only for classes derived from `Ens.MessageBody` (`Ens.StringContainer` and `Ens.StreamContainer` have their own extents), and "the send methods take a `%Library.Persistent`" is not true of `Ens.BusinessProcess.SendRequestAsync`, which is typed `Request`. Neither misleads a reader who follows the skill's own examples; a reword would move the golden text, its sha256 and its anchors together. No IRIS call was made in this stage, so no probe class exists.

**Plan stage (2026-10-19).** Halted after planning, as directed.

- **Planned:** three platform knowledge skills (six in all), one of them adapted with the pack's first provenance row; golden texts, the golden row and the golden notice are pinned by sha256, and a script confirmed the spec's blocks, row and 92 anchor lists equal the measured drafts.
- **Probed:** 19 disposable `ExecuteMCPv2.Temp.Probe414*` classes on `server:"default"`, `HSCUSTOM`, all deleted; `iris_doc_list filter:"Probe414" generated:true` is `[]`. No HSCUSTOM global written; no production, production class or message class touched.
- **Orchestrator decisions needed:** three (skill count and names; adapt `objectscript-sql-patterns` only; tool-free), each with its recommendation in Design Notes.
- **Deferred:** none. A suspected latent trap in the suite's REST handlers was ruled out live (C23).
