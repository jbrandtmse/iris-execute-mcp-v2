---
title: 'Story 41.3: Core Knowledge Skills'
type: 'feature'
created: '2026-10-19'
status: 'done'
baseline_revision: 'c7cb9f90ad3176f7c8d6fc31e6f4e28b081dcb6d'
baseline_commit: 'c7cb9f90ad3176f7c8d6fc31e6f4e28b081dcb6d'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/.claude/rules/project-rules.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-iris-execute-mcp-v2-2026-10-14/ARCHITECTURE-SPINE.md'
warnings:
  - oversized
deferred:
  - summary: "SanitizeError strips only the English and Arabic ERROR #N: prefixes, but this instance also has French and German message tables, so a status whose text is read in those languages keeps its prefix and doubles when re-wrapped"
    evidence: "Plan probes 2026-10-19: GetErrorText(sc,\"fr\") = 'ERREUR #5001: disk full', GetErrorText(sc,\"de\") = 'FEHLER #5001: disk full'. src/ExecuteMCPv2/Utils.cls:181 loops over 'ERROR #' and the Arabic word only. Project rule #13 asks strippers to handle localized prefixes; the epic-11 retro predicted ERREUR/FEHLER doubling."
    location: "src/ExecuteMCPv2/Utils.cls:179-185"
    severity: low
---

<intent-contract>

## Intent

**Problem:** The skills pack holds the always-on checklist and the 12 generated workflow skills, but no knowledge skill. An agent that hits a `%Status`, `%UnitTest` or ObjectScript language trap has nothing deeper to load than 16 checklist bullets. Also, no check requires a pack `SKILL.md` to open with frontmatter holding `name` and `description` (DW-613). An adaptation header placed above the frontmatter passes `check:provenance`, while the skill loses its name and description in every client.

**Approach:**

- **Three skills.** Three hand-authored, probe-verified knowledge skills, each one flat `SKILL.md` under `skills-pack-src/knowledge/<name>/`, with the golden text in Design Notes. `gen:pack` ships them unchanged.
  - The names are `iris-mcp-objectscript-gotchas`, `iris-mcp-objectscript-error-handling` and `iris-mcp-objectscript-unit-tests` (decision 1).
  - They name no `iris_*` tool (decision 2) and adapt nothing (decision 3).
- **The frontmatter gate.** A new `skill-frontmatter` rule in `check:provenance` closes DW-613. It checks every `skills/<n>/SKILL.md` agent file against one strict frontmatter reader, shared from `scripts/lib/skills-pack.mjs`.

## Boundaries & Constraints

**Always:**

- **One source, byte-exact.** Each skill's text lives only in its source file, which equals its golden text byte for byte. The sha256 values are in Design Notes.
  - Any rewording follows the probe discipline: probe the new claim in a disposable `ExecuteMCPv2.Temp.Probe413*` class on `server:"default"`, `namespace:"HSCUSTOM"`, delete the class, and confirm `iris_doc_list filter:"Probe413" generated:true` returns `[]`. Then add or amend its row in the probe log.
- **Verified claims.** Every factual claim in a skill matches a probe-log row whose verdict is "holds", run on IRIS 2026.2 Build 221U.
  - Every code block was compiled verbatim. A test snippet ran through `iris_execute_tests`, one class per call, with `total` compared to the expected `Test*` count (#35).
- **Deeper, not a copy.** No bullet of the always-on rule appears in a knowledge skill (whitespace-normalized substring, pinned).
- **User-facing wording.**
  - None of these appear: an internal rule number, a DW, AD, AC or Story id, a repository path, a project class or helper, repository tooling, the word "probe".
  - No `iris_*` token appears (decision 2).
  - IRIS error codes (`ERROR #5001`, `#1043:`) and the pack's own skill names are allowed.
- **Frontmatter.**
  - Line 1 is `---`.
  - Only `name` and `description` appear. `name` equals the directory name.
  - `description` names the content first, holds `Use when`, has at most 1,024 characters and has no XML-like tag.
- **Size and text.** At most 500 lines and 1,200 words (by the suite's word counter) per skill. ASCII, LF, one final LF (Rule 14).
- **Generated and shared code.**
  - The pack changes only through `pnpm gen:pack` (AD-14).
  - Logic lives in `scripts/lib/` and is shared by the CLI and the tests (AD-2).
  - File content is written with the file tools, never a heredoc (#55).

**Never:**

- **Upstream content.**
  - Adapt nothing from the upstream kit: the implement stage does not open the competitor copy, and the notice keeps 0 provenance rows (decision 3).
  - Nothing comes from upstream `skills/kb/ipm-module-authoring.md` or `iris-objectscript-eval`.
- **Other surfaces.** No change to any prompt, tool, action, governance key, preset, refusal code, route or bootstrapped class, or to `gen:skills` output.
- **Other stories' scope.** No preset-declaration format (41.5), no pack-wide internal-reference check (41.5), no catalog (41.5), no installer (41.6), no plugin (42.8).
- **Files this story must not edit:**
  - `.claude/rules/*`, `CLAUDE.md`, the spine, `epics.md`, `irislib/` and `irissys/`. The lead applies the drafted spine text.
  - `src/ExecuteMCPv2/Utils.cls`: the deferred finding is the lead's to route.
  - The installer-managed `.claude/skills/bmad-*` files.
- **IRIS.**
  - No HSCUSTOM global write, `^ClineDebug` included.
  - Never stop or restart IRIS, never start a production, never target an `ocupilot-slot-*` profile.
- **Git.** No `git commit`, `git push`, `git reset` or `git rebase`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Real tree | The three committed sources | `gen:pack` writes `skills/<name>/SKILL.md` three times; a second run changes nothing; `gen:pack:check` reports `19 pack file(s)` | No error expected |
| Validator (Integration) | `pnpm validate:prompts` | `45 source(s) checked (12 prompt(s) + 33 content file(s): 12 workflow, 17 pack, 3 knowledge, 1 rule)` | Exit 1 names a bad token per file |
| Provenance (Integration) | `pnpm check:provenance` | `0 provenance row(s), 33 agent file(s), 8 distribution(s)` | Exit 1, one `[rule] label: message` line per problem |
| Tarball (Integration) | `npm pack --dry-run --json --ignore-scripts --offline` in `packages/client-config` | Lists `skills-pack/skills/<name>/SKILL.md` for all three | The provenance check names a missing pack file |
| Good frontmatter | `SKILL.md` with LF or CRLF; a plain, double-quoted (JSON) or single-quoted value; `#` comment lines (the workflow banner); a description with `->` | No `skill-frontmatter` problem | No error expected |
| Header above frontmatter (DW-613) | Adapted `SKILL.md` whose line 1 is the adaptation header, then the frontmatter, with a provenance row | `check:provenance` exits 1 with exactly `[skill-frontmatter]` for `knowledge:<n>/SKILL.md` and `pack:skills/<n>/SKILL.md`; `hasValidAdaptationHeader` returns `true` for the same text (the gap, pinned) | Nothing is written |
| Header after frontmatter | The same skill with the header as the first non-blank line after the frontmatter | Green | No error expected |
| Bad frontmatter | Each alone: BOM before `---` (decision 4); no closing `---`; no `name` or `description`; an empty value; `name` that is not the directory, not kebab-case, longer than 64 characters, or contains `claude` or `anthropic`; `description` longer than 1,024 characters or holding a tag such as `<UNDEFINED>`; an unknown or duplicate key; an indented or multi-line value; a plain value with `: ` or ` #`, or starting with a YAML indicator; invalid JSON in a double-quoted value | One named `skill-frontmatter` problem per file | `check:provenance` exits 1 |
| Not a skill file | `knowledge/<n>/references/x.md` with no frontmatter | No `skill-frontmatter` problem | No error expected |
| Skill content | The three real sources | Exact `name` and `description`; ASCII, LF; at most 500 lines and 1,200 words; no `iris_*` token; hygiene scan clean; no rule bullet; every probe anchor present; each directory holds only `SKILL.md` | No error expected |
| Bad skill text | Sample text with `Rule #7`, `DW-613`, `packages/shared`, `` `iris_doc_put` ``, a URL, or a copied rule bullet | Each is flagged by name (negative controls) | The test goes red |

</intent-contract>

## Code Map

**Pack build** (`scripts/`, AD-2):

- `scripts/lib/skills-pack.mjs` -- the format home.
  - `:1-24` is the module comment, `:31` is `KNOWLEDGE_SOURCE_DIR`, and `:53` is `SKILL_FILENAME`, which is not exported yet.
  - `:197-219` is the knowledge loop of `assemblePack`, which stays unchanged: it byte-copies `knowledge/<n>/**` and refuses a missing `SKILL.md` or a workflow-name collision.
  - `:261-306` is `listAgentContentFiles`, also unchanged. Its labels are `knowledge:<n>/<f>` and `pack:skills/<n>/<f>`, with packRel `skills/<n>/<f>`.
- `scripts/lib/provenance-core.mjs` -- the check to extend.
  - `:12` already imports from `skills-pack.mjs`.
  - `:172-182` is `hasValidAdaptationHeader`, which stays unchanged. It strips a BOM, accepts CRLF, skips a leading `---` block, and treats a file whose line 1 is not `---` as frontmatter-less. That is the DW-613 gap.
  - `:221-326` is `checkProvenance`. Its agent-file loop at `:282-290` is where the rule goes.
  - `:334-344` is `provenanceSummary`, unchanged: the OK line format is pinned by tests.
- `scripts/check-provenance.mjs:40-55` -- prints each problem as `  - [<rule>] <label>: <message>`. Unchanged.
- `scripts/lib/provenance-inputs.mjs:144` -- `gatherProvenanceInputs` takes its `agentFiles` from `listAgentContentFiles`. Unchanged.
- `scripts/lib/validate-prompts-core.mjs:20` -- `extractIrisTokens`, reused for the no-tool pin.
- `scripts/gen-pack.mjs` and `scripts/lib/generated-tree.mjs` -- unchanged (41.1 seam).

**Sources and docs:**

- `skills-pack-src/knowledge/` -- does not exist yet; this story creates it.
- `skills-pack-src/README.md`:
  - `:5-15` is the layout table and the refusals;
  - `:36-55` covers adapted content;
  - `:57-61` is the Checks list (`check:provenance` at `:60`).
- `CHANGELOG.md:5` -- the newest heading format, `## [Pre-release — YYYY-MM-DD] — Story 41.2: ...`. `story-41-2-doc-claims.test.ts:51-68` finds sections by title and checks relative order, so a new top section is safe.
- `.changeset/story-41-2-objectscript-pre-write-rule.md` -- the changeset precedent.

**Tests** (all under `packages/iris-mcp-all/src/__tests__/`):

- Siblings to extend (Rule 2):
  - `story-41-2-qa-rule-text-hygiene.test.ts:27-46` holds `FORBIDDEN` and `problemsOf` (13 classes, with negative controls at `:70-91`).
  - `skills-pack-rule.test.ts:47-52` holds `wordCount`.
- Count pins that move. Derive each from the CLI output and cross-check by hand (#51):
  - `skills-pack-rule.test.ts:399` and `story-41-1-qa-pack-scratch-cli.test.ts:151` -- `16 pack file(s)` becomes 19.
  - `story-41-1-qa-pack-scratch-cli.test.ts:319` -- `31` becomes 34. The five byte-variant knowledge skills stay as they are, because `gen:pack` does not read frontmatter.
  - `story-41-1-qa-validate-prompts-pack.test.ts:49-52` -- the title and the line become `45 source(s) checked (12 prompt(s) + 33 content file(s): 12 workflow, 17 pack, 3 knowledge, 1 rule)`. `:60` becomes `45 source(s) checked`. `:146` becomes `(12 prompt(s) + 38 content file(s): 12 workflow, 20 pack, 4 knowledge, 2 rule)`.
  - `story-41-1-qa-provenance-cli.test.ts:96-99` -- `27 agent file(s)` becomes 33, title included. `:102-105` -- `29` becomes 35.
  - `:107-111` ("CRLF with a BOM passes") splits in two (decision 4): CRLF alone stays green with 35 agent files, and the BOM variant becomes a red row with `[skill-frontmatter]` for both labels.
- Fixtures that feed `checkProvenance`:
  - `pack-provenance.test.ts:81-83` `adaptedText` is already valid (`name: k`, `description: d`, under `skills/k/`).
  - Re-check `:165-200`, and every `skillText` and inline `SKILL.md` text in `story-41-1-qa-provenance-cli.test.ts`. Any that now raises `skill-frontmatter` is given valid frontmatter, unless the row exists to pin a refusal.
- Hermeticity (Rule 19): `skills-pack.test.ts:328-360` writes a temporary `zz-probe-skill` into the REAL `knowledge/`, with `---\nname: zz-probe-skill\n---` at `:335`. Under the new rule, a parallel real-tree provenance run would see it without a `description`. Give it `description: "Probe."`.
- Real-tree gate: `pack-provenance.test.ts:566` "real tree passes every provenance rule". It covers the new rule on the committed tree with no change.
- Unchanged: `skills-generated-frontmatter.test.ts`, which reads root `skills/` only and checks the DO-NOT-EDIT banner; the workflow-count pins of 12; and the prompt-count pins.

**IRIS evidence the golden texts rest on** (read-only references):

- `irislib/%occStatus.inc:8,15,23,27,53,66,68,70,81`
- `irislib/%occErrors.inc:1434,1435,1468`
- `irislib/%Exception/General.cls:39-42`
- `irislib/%UnitTest/TestCase.cls:5,51,86-90,111-140,153-176,215-246,338-375,381`
- `irislib/%UnitTest/Manager.cls:249-260,320-337,386,432,636-640,779-781,1156,1240,1333-1371`
- `irislib/%Library/Persistent.cls:934`
- `src/ExecuteMCPv2/REST/UnitTest.cls:104,187-198`: the suite's own test runner calls `RunTest(":<class>", "/noload/nodelete/norecursive")`, so every `iris_execute_tests` probe exercised that call.

## Tasks & Acceptance

**Execution:**

- `skills-pack-src/knowledge/iris-mcp-objectscript-gotchas/SKILL.md`, `.../iris-mcp-objectscript-error-handling/SKILL.md`, `.../iris-mcp-objectscript-unit-tests/SKILL.md` -- NEW. Each is its golden text from Design Notes, byte for byte (ASCII, LF, one final LF); check against the recorded sha256. Nothing else goes in the three directories -- AC 41.3.1, 41.3.2.
- `scripts/lib/skills-pack.mjs` -- add the shared frontmatter reader -- DW-613:
  - **Exports:** `SKILL_FILENAME`; `SKILL_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/`; `SKILL_NAME_MAX_LENGTH = 64`; `SKILL_DESCRIPTION_MAX_LENGTH = 1024`; `SKILL_FRONTMATTER_FIELDS = ['name', 'description']`; and the pure function `skillFrontmatterProblems(text, dirName) -> string[]`.
  - **The grammar,** fail-safe (refuse anything outside it):
    - a leading U+FEFF is a problem;
    - lines split on LF, with one trailing CR stripped from each;
    - line 1 is exactly `---`, and a later `---` line closes the block;
    - each line between is blank, a comment (first non-space character `#`), or `key: value` at column 1;
    - `value` is either a double-quoted string that `JSON.parse` reads as one string, a single-quoted string (`''` escapes `'`), or a non-empty plain scalar. A plain scalar has no `: ` or ` #`, does not end with `:`, and does not start with any of `` -?:,[]{}#&*!|>'"%@` ``;
    - keys come only from `SKILL_FRONTMATTER_FIELDS`, each once;
    - `name` matches `SKILL_NAME`, has at most 64 characters, equals `dirName`, and contains neither `claude` nor `anthropic`;
    - `description` is non-empty after trim, has at most 1,024 characters, and contains no `/<\/?[A-Za-z][^<>]*>/`.
  - **Messages** name the problem and the fix, for example `does not open with a --- frontmatter line, so clients read no name or description`.
  - **The module comment** states the contract and the seam: a new field, such as 41.5's preset declaration, extends `SKILL_FRONTMATTER_FIELDS` and the grammar.
- `scripts/lib/provenance-core.mjs` -- in `checkProvenance`, add `add('skill-frontmatter', file.label, message)` for each problem of each agent file whose `packRel` matches `^skills/([^/]+)/SKILL\.md$` (dirName = group 1). Workflow sources, pack copies and knowledge sources are all covered. Update the module and function comments (contract only). Leave `provenanceSummary` and the OK line unchanged -- DW-613, AD-2.
- `skills-pack-src/README.md` -- contributor doc:
  - add a "Knowledge skills" section: one directory per skill, holding `SKILL.md` and any files beside it; the frontmatter rules above; a description that names the content and says `Use when`; no `iris_*` token in these three;
  - add the `skill-frontmatter` rule to the `check:provenance` line of Checks.
- `pnpm gen:pack` -- regenerates the pack with the three skills. That generated output is part of the diff; the stage never commits -- AD-14.
- `packages/iris-mcp-all/src/__tests__/agent-text-hygiene.ts` -- NEW test helper. MOVE `FORBIDDEN` and `problemsOf` from `story-41-2-qa-rule-text-hygiene.test.ts`, and `wordCount` from `skills-pack-rule.test.ts`. Both files then import them, with behavior unchanged: their test counts stay 19 and 80 -- Rule 2.
- `packages/iris-mcp-all/src/__tests__/skills-pack-frontmatter.test.ts` -- NEW, default suite:
  - unit rows for every Good, Bad and Not-a-skill matrix row, through `skillFrontmatterProblems`;
  - unit rows through `checkProvenance` (rule tag and labels);
  - CLI rows on a scratch copy (`makeScratchRepo({ clientConfigManifest: true })`, `runScript`, `problemRules`, `toCrlf`, `BOM`) for: header above frontmatter, header after frontmatter, missing description, BOM, and name not equal to the directory;
  - a pin that `hasValidAdaptationHeader` returns `true` for the header-above text;
  - a pin that every committed `skills/*/SKILL.md` in the pack has no problem;
  - each refusal row removes its own input -- DW-613.
- `packages/iris-mcp-all/src/__tests__/skills-pack-knowledge.test.ts` -- NEW, default suite, for the three real sources:
  - the exact `name` and `description` (typed oracles from the golden texts), a description that holds `Use when`, and each directory holding only `SKILL.md`;
  - ASCII bytes only (LF and `0x20`-`0x7e`), no CR, exactly one final LF;
  - at most 500 lines and at most 1,200 words by `wordCount`;
  - `extractIrisTokens` returns `[]`;
  - the hygiene scan of the shared `FORBIDDEN` list, after removing the `name:` line and every pack skill name. Two documented overrides apply, each with a negative control:
    - "a path" is replaced by "a repository path" (any top-level entry of the repository, read with `readdirSync(REPO_ROOT)`, followed by `/`) plus "an absolute path" (`/Users/`, `/home/`, `/private/`, `/tmp/`, `/usr/`, `/opt/`, `/var/`). Reason: the qualifier string `/noload/nodelete/norecursive` is IRIS syntax;
    - the number-sign class also accepts `#<n>:`. Reason: IRIS compile errors read `#1043: QUIT argument not allowed`;
  - no bullet of the real rule source, whitespace-normalized, is a substring of a skill (with a negative control);
  - every probe anchor in Design Notes is present;
  - the code-block counts are gotchas 0, error-handling 2 and unit-tests 1 -- AC 41.3.1, 41.3.3.
- Existing tests -- move every Code Map pin and fixture.
  - Search every `packages/*/src/__tests__/` for `pack file(s)`, `agent file(s)`, `source(s) checked`, `0 knowledge`, `KNOWLEDGE_SOURCE_DIR` and `SKILL.md` text fed to `checkProvenance` (Rule 19).
  - The expected numbers come from the CLI output (#51).
- `CHANGELOG.md` -- add a top section titled `## [Pre-release — YYYY-MM-DD] — Story 41.3: Core knowledge skills`, dated the UTC day it is written:
  - `### Added`: the three skills, each with one line on what it covers; the `skill-frontmatter` rule;
  - `### Changed`: a pack `SKILL.md` whose first bytes are a BOM is now refused by `check:provenance`;
  - `### Tests`: the new files;
  - `### Known limits`: no installer until 41.6, no catalog until 41.5; the skills name no tool; the platform skills come in 41.4;
  - a paragraph saying that tools stay at 110 package / 115 advertised, prompts at 12, `gen:skills` at 13 files, `BOOTSTRAP_VERSION` at `5296a1c836f4`, and the baseline at `1e62c5ad5bf7`/141. This is the minimal docs that #43 requires.
- `.changeset/story-41-3-core-knowledge-skills.md` -- NEW: `"@iris-mcp/client-config": minor`, because the pack gains three skills and a frontmatter rule -- AD-29.

**Acceptance Criteria:**

- **The skills (AC 41.3.1).** Given the committed sources, when `skills-pack-knowledge.test.ts` and `pnpm gen:pack:check` run, then:
  - each of the three `SKILL.md` files equals its golden text (sha256 below);
  - its frontmatter holds exactly the golden `name` (equal to its directory) and `description` (holding `Use when`);
  - its pack copy is byte-identical;
  - the notice still has 0 provenance rows.
- **The probes (AC 41.3.2).** Given the probe log in Design Notes, when the reviewer maps each claim of the three skills to its row, then:
  - every row's verdict is "holds", and every code block was compiled verbatim;
  - each test snippet's `total` equalled its expected `Test*` count;
  - the probe leftovers are `[]`.
- **The wording (AC 41.3.3).** Given the three sources and their pack copies, when `pnpm validate:prompts` and `skills-pack-knowledge.test.ts` run, then:
  - no `iris_*` token is present;
  - the hygiene scan (with its two documented overrides) is empty;
  - no rule bullet is copied.
- **The frontmatter gate (DW-613).** Given a scratch copy holding an adapted `SKILL.md` whose adaptation header sits above its frontmatter, with a provenance row, when `node scripts/check-provenance.mjs` runs, then it exits 1 with exactly the rule `skill-frontmatter`, for the source and for the pack copy. Given the committed tree, when the default suite runs, then `pack-provenance.test.ts` "real tree passes every provenance rule" is green, and it goes red when a committed knowledge `SKILL.md` loses its `description` line (mutation M1).
- **Unchanged counts.** Given the suite, when the `(once)` checks run, then:
  - `gen:governance-baseline:check` reports `1e62c5ad5bf7`/141;
  - `gen:tools-list-snapshot:check` reports no drift;
  - `gen:skills:check` reports `13 generated file(s)`;
  - `git diff --stat packages/shared/src/bootstrap-classes.ts` is empty;
  - tools stay at 110 package / 115 advertised.

## Spec Change Log

- **2026-10-19, lead spec gate.** Wave-7 decisions #7, #8, #9 and #10 were taken as recommended (Design Notes). The spine is amended (Rule 20): AD-28 gains the knowledge-skill names bullet and the skill-frontmatter bullet, and the conventions table gains "Pack names". The plan's one `deferred:` item (`SanitizeError` localized prefixes) is harvested by the lead at dev-complete.

## Review Triage Log

### 2026-10-19 — Review pass
- verdicts: 36 findings — high 0, medium 0, low 32, false 3, maybe-false 1
- findings:
  - Blind Hunter:
    - `[low]` `[reject]` unit-tests skill omits that `OnAfterOneTest` is skipped after a failed or skipping `OnBeforeOneTest`, and that `OnAfterAllTests` still runs after a failed `OnBeforeAllTests` — confirmed at `irislib/%UnitTest/Manager.cls` (hook order), but it is an omission, not a false claim, and the fix edits the golden text, which is the spec's; rejected.
    - `[low]` `[reject]` "every Assert macro" over-claims: `$$$AssertFilesSQLUnorderedSame` exists (`irislib/%outUnitTest.inc:22`) and is not covered — real, but the fix edits the spec's golden text and sha256; recorded for the lead under Residual risks.
    - `[low]` `[reject]` "checking its totals" gives no query for the count — omission; fix edits the golden text.
    - `[low]` `[reject]` the `Process` example calls `..Validate` and `..Count`, which are not defined — the block was compiled inside a class that defined both (probe E18); the names are illustrative placeholders; negligible.
    - `[low]` `[reject]` error-handling omits `$$$THROWONERROR`/`$$$TOE`, `TROLLBACK` in `Catch` and the SQLCODE throw macros — omissions beyond the golden text.
    - `[maybe-false]` `[reject]` "removes one prefix in any language" was run for en, es, fr and de only — what would settle it: `GetErrorText(sc, <lang>)` for every shipped message table; if a prefix held a space the helper would leave it in place, which is a cosmetic double prefix (low), so rejected.
    - `[low]` `[reject]` the `#<n>:` override lets `item #58:` through — by design: the spec defines the override and gives `Rule #n` its own entry; the three skills are clean and any edit also trips the sha256 pin.
    - `[low]` `[reject]` the path override misses `c:/git/...` and `~/x` and reads `readdirSync(REPO_ROOT)` — by design: the spec defines it as a top-level repository entry plus the listed absolute roots.
    - `[false]` `[reject]` "negative controls miss 5 of 14 classes" — `story-41-2-qa-rule-text-hygiene.test.ts` runs `it.each(FORBIDDEN)` over the same pattern objects that `skillForbidden` reuses, so every unchanged class has a sample-based control; the two replaced classes have their own rows.
    - `[low]` `[reject]` the reader accepts plain scalars YAML reads as non-strings (`description: 2024`) — the spec's grammar allows a plain scalar; no pack source uses one; a guard adds branches for a case no one writes.
    - `[low]` `[reject]` a quoted value followed by a comment gets the "fix the quotes" message — negligible wording.
    - `[low]` `[reject]` `iris-mcp-` prefix is unenforced and "exactly the three planned skills" will move in 41.4 — by design: the prefix is a convention in the spec and README, and every count pin moves with the story that adds skills.
    - `[low]` `[patch]` `scripts/check-provenance.mjs` header and failure hint do not mention the `skill-frontmatter` rule or that a `workflow:` skill is generated — header bullet and one hint line added (grouped with the Edge, Verification and Gap rows below).
  - Edge Case Hunter:
    - `[low]` `[reject]` plain `null`, `~`, `true`, `123` accepted — same as the Blind row on non-string scalars.
    - `[low]` `[reject]` a TAB before `#` or after `:` in a plain value is accepted — the spec's grammar names the space forms; negligible.
    - `[low]` `[reject]` lengths count UTF-16 units — the pack's skills are ASCII; negligible.
    - `[low]` `[patch]` `check-provenance.mjs` hint and header stale — same root cause as the Blind row above; patched.
    - `[low]` `[reject]` `$$$ThrowStatus` on an OK status throws a spurious General error (`StatusException.cls` `ThrowIfInterrupt`) — confirmed; omission, fix edits the golden text.
    - `[low]` `[reject]` `$$$ThrowOnError` does not throw a `StatusException` for an `<INTERRUPT>`-wrapping status — confirmed at `ThrowIfInterrupt`; a corner of a corner, fix edits the golden text.
    - `[low]` `[reject]` `$$$QuitOnError` in a loop does not compile — omission, fix edits the golden text.
    - `[low]` `[reject]` `$$$AssertFilesSQLUnorderedSame` omitted — same as the Blind "every Assert macro" row.
    - `[low]` `[reject]` `item #58:` passes the number-sign override — same as the Blind row; by design.
  - Verification Gap Reviewer:
    - `[low]` `[patch]` the "notice has 0 provenance rows" pin passed when the table header was absent or a row was malformed — now also asserts the header row is present and `problems` is empty; mutation lines M13 written.
    - `[low]` `[patch]` ACs and pins with no `mutation:` line (notice rows, fenced-block counts, moved count pins, the wording class for a project class, M7 recorded before the sha256 pin) — M13 to M16 written, M7 re-run on the final tree; the "Unchanged counts" AC is pinned by the existing gates and has a note.
    - `[low]` `[reject]` the `hasValidAdaptationHeader` `true` pins depend on the DW-613 gap staying open — by design: the spec requires the gap pinned.
    - `[low]` `[reject]` "each refusal row ran in a scratch copy" is a trivially green post-condition — harmless guard that the spec's "each refusal row removes its own input" asks for.
    - `[low]` `[reject]` scratch CLI rows copy `packages/client-config/dist`, which the test does not build — the same dependency the 41.1 rows already had; the pipeline's `test` task depends on `build`.
    - `[false]` `[reject]` "exactly the three planned skills" can race `skills-pack.test.ts` writing `zz-probe-skill` — `packages/iris-mcp-all/vitest.config.ts` sets `fileParallelism: false`.
    - `[false]` `[reject]` agent-file count pins hold only for the committed set — intended: the pins are derived from the CLI output and move with 41.4.
    - `[low]` `[patch]` header comment of `check-provenance.mjs` lists no `skill-frontmatter` rule — same root cause; patched.
    - `[low]` `[patch]` failure hint points at `skills-pack-src/` for a generated `workflow:` skill — same root cause; patched.
  - Intent Alignment Auditor:
    - `[low]` `[reject]` no client loader or YAML library is the oracle for the reader — by design: the spec's grammar is a fail-safe subset typed by hand.
    - `[low]` `[reject]` live-IRIS claims are checked by the probe log and text pins, not by compiling in the suite — by design: the probe log is the evidence, the sha256 pin ties the text to it.
    - `[low]` `[reject]` `8 distribution(s)` appears in no test; scratch copies print `1 distribution(s)` — the Integration row is run as a `## Verification` command on the real tree, and `pack-provenance.test.ts` enumerates distributions.
    - `[low]` `[patch]` the intent lists "a project class or helper" but no hygiene pattern matched one — a skill-specific pattern (`ExecuteMCPv2`, `SanitizeError`) and two negative-control rows added; mutation line M16.
    - `[low]` `[reject]` "Use when" and "names the content first" are checked for the three skills only — by design: the AC scopes them to the three skills.

## Design Notes

**Orchestrator decisions needed** (the Lead's calls, delegated). This plan follows each recommendation.

- **Orchestrator decision needed: the skill names** — recommended: the suite prefix, `iris-mcp-objectscript-gotchas`, `iris-mcp-objectscript-error-handling` and `iris-mcp-objectscript-unit-tests`. The evidence:
  - **They become installed directory names in every client.**
  - **The upstream kit's names would collide.** It ships `objectscript-unit-test`, `objectscript-guardrails`, `objectscript-review`, `objectscript-tdd`, `objectscript-repair` and `objectscript-debugging`, plus `iris-*` names such as `iris-sql`. A user with both kits would get near-identical names.
  - **Same-named skills shadow each other.** In Claude Code, a personal skill shadows a project skill of the same name; only plugin skills are namespaced (code.claude.com/docs/en/skills, re-checked 2026-10-19).
  - **The installer may write only what it owns (AD-30).** Decisions #2 and #5 prefixed the notice and the rule for that reason.
  - **The cost:** longer names, and a pack that mixes prefixed knowledge skills with unprefixed workflow skills. Those keep their prompt names (AD-15).
- **Orchestrator decision needed: knowledge skills name no tool** — recommended: no `iris_*` token in the three skills, so they declare no preset, the same reasoning as the rule (AD-28: "It names no `iris_*` tool, so it declares no preset"). The evidence:
  - The preset-declaration format and its check are 41.5's (AC 41.5.4; epic context: "How a skill declares it is not yet defined").
  - The tool-driven loops already ship as workflow skills (`deploy-and-test-class`, `edit-and-test-class`), which name `iris_execute_tests`.
  - A tool-free skill stays correct for an agent with any IRIS tooling.
  - **The cost:** the unit-test skill explains `%UnitTest.Manager.RunTest` instead of naming the suite's test tool.
- **Orchestrator decision needed: adapt nothing from the upstream kit** — recommended: none, so 0 provenance rows. The plan stage read five upstream files at `b6205bb` as untrusted data and executed nothing; the implement stage must not open the competitor copy. None is clearly the better start:
  - `skills/skills/objectscript-unit-test/SKILL.md` is built around the upstream's own tools (`iris_generate_test`, `iris_test`, `iris_doc`), none of which this suite has;
  - `skills/skills/objectscript-guardrails/SKILL.md` is a 15-item hard-gate checklist that overlaps the always-on rule rather than going deeper;
  - `skills/kb/iris-error-codes.md` and `skills/kb/objectscript-idioms.md` are general references written around the upstream's own debug tools (headings read only);
  - the golden texts here rest on our rules, the retros, IRIS's own source and 64 live probe rows, with the exact error text this instance prints.

  The cost: none. The AC allows adaptation only where it is clearly better.
- **Orchestrator decision needed: refuse a `SKILL.md` that starts with a byte-order mark** — recommended: refuse, the stricter side (#44). The evidence:
  - Claude Code "reads the frontmatter only when the opening `---` is the file's first line" (code.claude.com/docs/en/skills, 2026-10-19), and whether a BOM-prefixed first line counts is not documented.
  - The Agent Skills standard (agentskills.io/specification) requires YAML frontmatter, and other clients' BOM handling is unknown.
  - All pack sources here are ASCII.
  - **The cost:** 41.1's pinned green row "the same adapted skill as CRLF with a BOM passes" splits into a green CRLF row and a red BOM row. Byte-copy coverage of a BOM (#58) is unaffected, since `gen:pack` still copies any bytes; only `check:provenance` refuses.

**Design choice (no escalation): the DW-613 gate is a `check:provenance` rule, not a `gen:pack` refusal.**

- DW-613 is that check's own blind spot. It already enumerates every agent file, fails closed, and has a CLI and a default-suite real-tree test that share one core (AD-2).
- A `gen:pack` refusal would turn 41.1's five byte-variant knowledge fixtures red. They hold no `description`, and two hold no frontmatter. That would also change `gen:pack` from a byte copier into a validator.
- The rule covers every `skills/<n>/SKILL.md` label: workflow sources, pack copies and knowledge sources.
- The 12 generated workflow skills pass today. Their descriptions are `JSON.stringify` output, each name equals its directory, and `promote-environment-change` holds `->`, which is not an XML tag; the description rule is a tag pattern, not "no `<` or `>`", for that reason. All 12 were checked on 2026-10-19 (each at most 345 characters).

**AC interpretations** (apply and report):

- **41.3.1, "written from our rules and retros".** The skills draw on the rules, the retros, IRIS's own source and live behavior. The probes found facts the rules lack, for example the `$$$GeneralError` include. They go deeper than the checklist and never copy it (pinned). Nothing comes from upstream.
- **41.3.1, "a description that says when to load it".**
  - The first sentence says what the skill covers, and a `Use when` sentence gives the triggers.
  - At most 1,024 characters, and no XML-like tag: the Claude API refuses tags in a description, so the descriptions name `UNDEFINED`, not `<UNDEFINED>`.
  - The descriptions are 515, 480 and 490 characters.
- **41.3.2, "probed live".** Every claim maps to a row run on the live instance:
  - a compile, a run, an `iris_execute_tests` call, a read-only SQL query or global read;
  - or, where a run would need a file or global write, a ranged `iris_doc_get` of the live system class (the `/load` deletion, the directory check, `%Save()`'s return type, `$$$AssertFilesSame`).

  Code blocks compiled verbatim; the unit-test example compiled under a `Probe413` class name.
- **41.3.3, the wording check.** This is the per-skill check. The pack-wide one is 41.5's, and its forward note follows. The skills legitimately hold:
  - IRIS codes in two forms, `ERROR #<n>` and `#<n>:`;
  - the qualifier string `/noload/nodelete/norecursive`;
  - their own `iris-mcp-` names.
- **Size.** At most 500 lines comes from the Claude Code and Agent Skills guidance; at most 1,200 words is this plan's budget. The skills are 55, 81 and 100 lines, and 762, 814 and 880 words.
- **DW-613, "every pack `SKILL.md`".** The rule checks every `skills/<n>/SKILL.md` agent file. "Its header comes after it" holds because the frontmatter must be first and the existing header rule wants the first non-blank line after it.

**Spine text for the lead** (Rule 20, light path):

- **AD-28, Knowledge skills.** Add: "The core knowledge skills (Story 41.3) are `iris-mcp-objectscript-gotchas`, `iris-mcp-objectscript-error-handling` and `iris-mcp-objectscript-unit-tests`. Like the rule, they name no `iris_*` tool, so they declare no preset."
- **AD-28, One pack.** Add: "Every `SKILL.md` in the pack opens with frontmatter on its first line, holding only `name` and `description`. `name` equals its directory and is lower-case letters and digits in hyphen-joined groups, at most 64 characters, without `claude` or `anthropic`. `description` is at most 1,024 characters, with no XML tag. `check:provenance` enforces this with its `skill-frontmatter` rule (Story 41.3). A later field, such as a preset declaration, extends that rule."
- **Conventions row "Pack names".** "Hand-authored pack content carries the suite prefix: `iris-mcp-<name>` for rules and knowledge skills, and `IRIS-MCP-THIRD-PARTY-NOTICES.md` for the notice, so an installed copy never collides with a user's own file or another kit's skill. Generated workflow skills keep their prompt names (AD-15)."
- **memlog line.** "AD-28 (41.3): three suite-prefixed, tool-free knowledge skills; every pack SKILL.md opens with name/description frontmatter, enforced by check:provenance skill-frontmatter. Prevents name collisions with other kits, and a header or BOM that hides a skill's name and description."

**Governing ADs:**

- **AD-28:** one source per skill; the pack shape; the header and provenance rules (0 rows here); no internal references; tool names.
- **AD-14:** the pack changes only through `gen:pack`.
- **AD-2:** the reader and the rule live in `scripts/lib/`, shared by the CLI and the tests.
- **AD-29:** a minor changeset.
- **AD-30:** suite-prefixed names for 41.6's owned files.
- **AD-15:** the workflow skill names are untouched.
- **Project rules:** #16, #35, #36, #43, #44, #51, #55, #56, #58, #59 and Rule 14.

No AC contradicts an AD.

**Extend, don't copy (Rule 2):**

- The frontmatter reader is one function in `skills-pack.mjs`, used by `checkProvenance` and the tests. Its sibling `hasValidAdaptationHeader` stays as it is (it also serves non-`SKILL.md` files).
- The hygiene list and the word counter move into a shared helper; neither is copied.
- The tool-token pin reuses `extractIrisTokens`.
- `skills-generated-frontmatter.test.ts` keeps its own banner parse; its subject is the generator's banner, not the portable format.

**Integration (Rules 1/2):**

- **Integration ACs:** the `validate:prompts` CLI counts 3 knowledge and 3 pack sources; the `check:provenance` CLI counts 33 agent files and refuses a header above the frontmatter on a scratch copy; client-config's npm tarball lists the three `SKILL.md` files.
- **Consumed-by:**
  - **41.4:** adds the platform skills under the same frontmatter rule and content-test pattern, and counts 6 to 10 in total.
  - **41.5:**
    - the catalog lists the three;
    - the preset declaration extends `SKILL_FRONTMATTER_FIELDS` and the grammar, and decides what "declares the preset it needs" means for a tool-free skill;
    - the pack-wide internal-reference check accepts `#<n>:`, `/noload/nodelete/norecursive` and the pack's own skill names.
  - **41.6:** installs `skills/<name>/`, owned by name.
  - **41.7:** docs, and the live check that lists the installed skills.
  - **42.8:** the plugin's `skills/`.
- **Consumes:** 41.1's `assemblePack`, `listAgentContentFiles`, `checkProvenance`, `gatherProvenanceInputs` and the validator; 41.2's rule source (the no-copy pin), hygiene list and word counter.

**Ledger inbox (Rule 17):** DW-613 is addressed by the `skills-pack.mjs`, `provenance-core.mjs` and `skills-pack-frontmatter.test.ts` tasks, the AC "The frontmatter gate (DW-613)", the matrix rows "Header above frontmatter (DW-613)", "Header after frontmatter", "Bad frontmatter" and "Not a skill file", and mutations M1 to M3. No other entry is owned by this story.

**Golden texts.** Each file is the text between the fences, ending in a single LF.

- `skills-pack-src/knowledge/iris-mcp-objectscript-gotchas/SKILL.md`: 5,115 bytes, 55 lines, 762 words, sha256 `99452fa1228345f1b4359d2871de417aa14a05ab7a75bda0051a3f31cba20bf4`.

~~~markdown
---
name: iris-mcp-objectscript-gotchas
description: "ObjectScript language traps that compile or run differently from what the code suggests: which macros a class gets without an Include, extra arguments, JSON null against a missing key in a dynamic object, object references inside $List, numeric-looking subscripts, New $NAMESPACE and Catch blocks, missing Ens classes, and Open timeouts. Use when writing, reviewing or debugging ObjectScript, or when IRIS reports MPP5610, PARAMETER, INVALID CLASS, INVALID OREF or CLASS DOES NOT EXIST and the cause is not obvious."
---

# ObjectScript gotchas

Each section names the error or the wrong value you see, then its cause and the fix. Every behavior below was observed on IRIS 2026.2.

## Macros and include files

- `$$$Name` is a macro, which the compiler expands before the code runs. `$$Name` calls the label `Name` as a function, and `$Name` is a system function such as `$Piece`.
- Every class gets the status macros without an `Include`: `$$$OK`, `$$$ERROR`, `$$$ISERR`, `$$$ISOK`, `$$$ADDSC`, `$$$ThrowOnError`, `$$$ThrowStatus` and `$$$QuitOnError`.
- Error-code macros are different. Inside `$$$ERROR($$$GeneralError, "text")` the code name works in any class, because `$$$ERROR` looks the name up itself. On its own, as in `Set tCode = $$$GeneralError`, it needs `Include %occErrors` above the `Class` line. Without it the compile fails with `MPP5610 : Referenced macro not defined: 'GeneralError'`.
- The `$$$Assert` macros work only in a `%UnitTest.TestCase` subclass. In any other class the compile fails with `MPP5610` for the macro. Adding `Include %outUnitTest` does not help: the compile then fails with `MPP5376 : Method or Property 'AssertEqualsViaMacro' does not exist`, because each macro calls a method of the test case.

## Calls and arguments

- A call with more arguments than the method declares compiles, then raises `<PARAMETER>` when it runs. Read the signature of a method you have not used before you call it, rather than guessing from a similar one.
- A call with fewer arguments is legal. A missing argument takes its default; with no default it is undefined, so `$Data(pB)` is 0.

## Dynamic objects

- `$Get(tObj.%Get("x"), "d")` fails with `<INVALID CLASS> Class '%Library.DynamicObject' does not support MultiDimensional operations`, because `$Get` treats its first argument as a variable. Use `tObj.%Get("x", "d")`.
- That default covers only a missing key. A key that holds JSON `null` returns `""`, not the default, and `%IsDefined` is 1 for it.
- To tell a missing key from `null` and from an empty string, use `%GetTypeOf(key)`, which returns `"unassigned"`, `"null"` and `"string"` for the three.
- A key that contains `_` needs quotes only in property syntax: `Set tObj."max_results" = 5`. `%Get("max_results")` and `%Set("page_size", 10)` take the key as a string and need nothing more.

## Object references in lists and arrays

- `$ListBuild(tObj)` stores the reference as a string such as `5143@%Library.ListOfDataTypes`. `$ListGet` gives back that string: `$IsObject` on it is 0, and calling a method on it raises `<INVALID OREF>`.
- Keep references in a local array, `Set tItems(1) = tObj`, or in a `%DynamicArray`, `Do tArr.%Push(tObj)`. Both give back an object you can use.

## Subscripts

- A string subscript that is a canonical number is that number: `tA("1")` and `tA(1)` are one node.
- `"01"` and `"1.0"` are not canonical numbers, so `tA("01")` and `tA("1.0")` are separate nodes. A numeric literal is made canonical first, so `tA(1.0)` is `tA(1)`.
- `$Order` returns numeric subscripts first, in numeric order, and then strings in string order: `1`, `2`, `10`, `"01"`, `"b"`.

## Namespaces

- `New $NAMESPACE` undoes a namespace switch when the method returns, not when its `Try` block ends. A `Catch` in the same method still runs in the namespace you switched to.
- So put the work for the other namespace in a method of its own that starts with `New $NAMESPACE`. Its caller, and the caller's `Catch`, stay in the original namespace. Otherwise, save `$NAMESPACE` in a local variable and set it back yourself, first thing in every `Catch`.
- Not every namespace has the `Ens.*` classes, and `%SYS` has none. Before you call one from code that can run elsewhere, check `##class(%Dictionary.CompiledClass).%ExistsId("Ens.Director")`, which is 1 where the class is compiled and 0 in `%SYS`.

## Open and $Test

- `Open` sets `$Test` only when you give it a timeout. `Open tFile::5` sets `$Test` to 1 when the device opened within 5 seconds and to 0 when it did not.
- Without a timeout, `Open` leaves `$Test` as an earlier command set it, 0 or 1, so a check of `$Test` after it tests something else.
- The arguments of `Open` are positional: device, parameters, timeout, mnemonic space. In `Open tFile:::1` the `1` is the mnemonic space, so that `Open` has no timeout and sets no `$Test`.

## Related skills

- `iris-mcp-objectscript-error-handling`: `%Status` values, exceptions and the `Try` and `Catch` method shape.
- `iris-mcp-objectscript-unit-tests`: writing and running `%UnitTest` test classes.
~~~

- `skills-pack-src/knowledge/iris-mcp-objectscript-error-handling/SKILL.md`: 5,954 bytes, 81 lines, 814 words, sha256 `e1618ef052f13f34e719d5fcba8e103e28cadd8a27ba15ee439c0ff88023c5e4`.

~~~markdown
---
name: iris-mcp-objectscript-error-handling
description: "How %Status values and exceptions work in ObjectScript: making, testing, combining and reading a status, the Try and Catch method shape, ThrowOnError, ThrowStatus and AsStatus, what a runtime error looks like inside a Catch, and reading error text without its translated ERROR #N prefix. Use when writing a method that returns %Status, handling, rethrowing or logging an error, converting between exceptions and statuses, or putting error text that IRIS returned into a new error."
---

# %Status and error handling

Every behavior below was observed on IRIS 2026.2.

## What a %Status is

- `$$$OK` is 1. An error status is an encoded string whose numeric value is 0. Test a status with `$$$ISERR(tSC)` or `$$$ISOK(tSC)`, which look at that number, never with `tSC = 1` or by its text.
- Because the test is numeric, any value that does not start with a nonzero number counts as an error: `$$$ISERR("")` and `$$$ISERR("done")` are both 1. Check that a method returns `%Status` before you test its result this way.
- `$$$ERROR($$$GeneralError, "disk full")` makes an error with code 5001. `$System.Status.GetErrorCodes(tSC)` returns `5001`, and `$$$ERRORISTYPE(tSC, $$$GeneralError)` is 1 when the status holds that one error and no other.

## Reading and combining statuses

- `$System.Status.GetErrorText(tSC)` returns `ERROR #5001: disk full`.
- `$$$ADDSC(tSC, tSC2)`, like `$System.Status.AppendStatus`, puts two statuses into one, and `$$$ADDSC($$$OK, tSC2)` is simply `tSC2`. The text of a combined status has one line per error, separated by CR LF. `GetErrorCodes` then returns `5001,5001`, and `$System.Status.GetOneErrorText(tSC, 2)` returns the second line alone.
- `$System.Status.EmbedStatus(tOuter, tInner)` keeps the cause under your own error. Its text reads `ERROR #5001: Import failed`, then a line `  > ERROR #5001: disk full`, and `GetErrorCodes` reports only the outer code. Use it to add context instead of rewriting the inner text.

## The translated prefix

- The word in the prefix depends on the language the text is read in. The same status reads `ERREUR #5001: disk full` from `GetErrorText(tSC, "fr")` and `FEHLER #5001: disk full` from `GetErrorText(tSC, "de")`. So never match the word `ERROR`.
- To get the message without its prefix, cut at the error's own code:

```objectscript
ClassMethod ErrorMessage(pSC As %Status) As %String
{
    Set tText = $System.Status.GetErrorText(pSC)
    Set tTag = " #"_$Piece($System.Status.GetErrorCodes(pSC), ",")_": "
    If $Piece(tText, tTag) '[ " " Set tText = $Piece(tText, tTag, 2, *)
    Quit tText
}
```

- It removes one prefix in any language and keeps the rest of the text as it was. `ERROR #5001: file: missing` becomes `file: missing`, and a message that itself contains `Order #12: ` keeps it. On a combined status only the first line loses its prefix.
- Wrapping the whole text in a new `$$$ERROR($$$GeneralError, ...)` gives `ERROR #5001: ERROR #5001: file: missing`. Wrap the message instead: `$$$ERROR($$$GeneralError, "Import failed: "_..ErrorMessage(tSC))` gives `ERROR #5001: Import failed: file: missing`.

## Exceptions

- `$$$ThrowOnError(expr)` stores the value of `expr` in a local variable named `sc`, then throws a `%Exception.StatusException` when it is an error. It overwrites any `sc` of your own: after `Set sc = "mine"` and `$$$ThrowOnError($$$OK)`, `sc` is 1.
- `$$$ThrowStatus(tSC)` throws a status you already have.
- In `Catch ex`, `ex.AsStatus()` turns any exception into a status. A thrown status comes back unchanged, with its own code and text.
- A runtime error arrives as a `%Exception.SystemException`. For an undefined variable, `ex.Name` is `<UNDEFINED>`, `ex.Code` is 9, `ex.Location` is the line as `label+offset^routine`, and `ex.Data` is the variable name. `ex.AsStatus()` gives code 5002, `ERROR #5002: ObjectScript error: <UNDEFINED>`, followed by the location, a `*` and the variable name. `$ZERROR` holds the same text from `<UNDEFINED>` on.
- `##class(%Exception.General).%New(name, code, location, data)` makes your own exception, but its `code` is only a field: `AsStatus()` always gives `ERROR #5035: General exception Name '...' Code '...' Data '...'`. To raise a status with a code of your choosing, use `$$$ThrowStatus`.
- `Throw ex` inside a `Catch` passes the same exception up to the caller's `Catch`, with its original `Name` and `Location`.
- `$$$QuitOnError(expr)` expands to an argumented `Quit`. Outside `Try` it returns the error status from the method. Inside `Try` or `Catch` it does not compile: `#1043: QUIT argument not allowed : 'sc'`. Use `$$$ThrowOnError` there.
- There is no `Finally` block: `Finally { }` fails to compile with `#1026: Invalid command : 'Finally'`. Code that must run on both paths goes after the `Try` and `Catch` blocks.

## The method shape

```objectscript
ClassMethod Process(pId As %String) As %Status
{
    Set tSC = $$$OK
    Try {
        $$$ThrowOnError(..Validate(pId))
        Set tCount = ..Count(pId)
        If tCount = 0 {
            $$$ThrowStatus($$$ERROR($$$GeneralError, "Nothing to process for "_pId))
        }
    }
    Catch ex {
        Set tSC = ex.AsStatus()
    }
    Quit tSC
}
```

- An error status from `Validate`, the status thrown for an empty count, and a runtime error inside `Count` all end up in `tSC`, and the method returns once, after the blocks.

## Statuses that get lost

- `Do ..Save()` throws away the `%Status` that `Save` returns: the call looks fine and the next line runs. Assign the result and check it, or wrap the call in `$$$ThrowOnError`.
- `%Save()` on a persistent object returns a `%Status` too, so write `$$$ThrowOnError(tObj.%Save())`.

## Related skills

- `iris-mcp-objectscript-gotchas`: language traps such as macros that need an `Include`, extra arguments and namespace switches.
- `iris-mcp-objectscript-unit-tests`: asserting on statuses in `%UnitTest` tests.
~~~

- `skills-pack-src/knowledge/iris-mcp-objectscript-unit-tests/SKILL.md`: 6,209 bytes, 100 lines, 880 words, sha256 `88fabb181a627bb05a47f8029e651ccee4d408f57dd4557031c02eb41bdc10c5`.

~~~markdown
---
name: iris-mcp-objectscript-unit-tests
description: "Writing and running %UnitTest tests in ObjectScript: the TestCase class shape and its setup and teardown hooks, which methods run and in what order, every Assert macro and what it returns, skipping a test, what happens when setup or a test fails, and running a class with %UnitTest.Manager and checking its totals. Use when creating or editing a %UnitTest.TestCase class, running IRIS unit tests, or when a run reports fewer tests than expected, zero tests, or a failure you cannot explain."
---

# %UnitTest in ObjectScript

Every behavior below was observed on IRIS 2026.2.

## A test class

```objectscript
Class MyApp.Tests.Cart Extends %UnitTest.TestCase
{

Property Cart As %DynamicObject;

Method OnBeforeOneTest(testname As %String) As %Status
{
    Set ..Cart = {"items":[{"price":2},{"price":3}]}
    Quit $$$OK
}

Method OnAfterOneTest(testname As %String) As %Status
{
    Set ..Cart = ""
    Quit $$$OK
}

Method TestItemCount()
{
    Do $$$AssertEquals(..Cart.items.%Size(), 2, "two items")
}

Method TestTotal()
{
    Set tTotal = 0
    Set tIter = ..Cart.items.%GetIterator()
    While tIter.%GetNext(.tKey, .tItem) {
        Set tTotal = tTotal + tItem.price
    }
    Do $$$AssertEquals(tTotal, 5, "prices add up")
}

}
```

- Tests are instance methods with no arguments. `OnBeforeAllTests()` and `OnAfterAllTests()` run once for the class, and `OnBeforeOneTest(testname)` and `OnAfterOneTest(testname)` run around each test. Each hook returns a `%Status`.
- One test-case object serves every test of the class, so a property that one test sets is still set in the next. Reset shared state in `OnBeforeOneTest`, as above.
- Put setup in the hooks, not in `%OnNew`. The manager passes itself to `%New`, and the constructor of `%UnitTest.TestCase` keeps it for the assertion macros. An `%OnNew` that does not call `##super(initvalue)` leaves it unset, and the first assertion fails with `<INVALID OREF>`.

## Which methods run, and in what order

- Every method whose name starts with `Test` runs as a test. That includes a helper named `TestingHelper`, so give helpers another name. The match is case-sensitive: `testLowerCase` never runs.
- The order is fixed. Names with a number right after `Test` run first, by that number, so `Test2` runs before `Test10`. The other names follow in string order.
- Write each test so it passes alone. A run can target a single method, and a test that relies on what an earlier test left behind fails when it runs by itself. Create what a test needs in `OnBeforeOneTest` and remove it in `OnAfterOneTest`.

## Assertions

| Macro | Passes when |
| --- | --- |
| `$$$AssertEquals(a, b, msg)` | `a = b` |
| `$$$AssertNotEquals(a, b, msg)` | `a '= b` |
| `$$$AssertTrue(cond, msg)` | `cond` is true |
| `$$$AssertNotTrue(cond, msg)` | `cond` is false |
| `$$$AssertStatusOK(sc, msg)` | `sc` is OK |
| `$$$AssertStatusNotOK(sc, msg)` | `sc` is an error |
| `$$$AssertStatusEquals(sc1, sc2, msg)` | both are OK, or both hold the same errors with the same arguments |
| `$$$AssertSuccess(msg)` | always; it records a pass |
| `$$$AssertFailure(msg)` | never; it records a failure |
| `$$$AssertSkipped(msg)` | it marks the test skipped |
| `$$$LogMessage(msg)` | it is a note in the log, not an assertion |

- `$$$AssertFilesSame(file1, file2, msg)` compares two files.
- The description is optional in every assertion except `$$$AssertSkipped`, where leaving it out fails the test with `<UNDEFINED>`. A comparison without a description logs its expression instead, such as `1 + 1== 2`.
- `$$$AssertEquals` compares with `=`, which compares strings: `"1.0"` and `1` are not equal, while `+"1.0"` and the literal `1.0` both equal `1`.
- An assertion returns 1 when it passes and 0 when it fails, so it can guard the rest of a test: `If '$$$AssertStatusOK(tSC, "saved") Quit`.
- A failed assertion does not end the test. The method goes on with its next line, and the test is reported failed when it ends.

## Skipped tests and failed setup

- `$$$AssertSkipped(reason)` in `OnBeforeOneTest` skips that test: its method does not run, and it is reported skipped. Inside a test, call it and then `Quit`; the test is reported skipped too.
- In `OnBeforeAllTests`, `$$$AssertSkipped` does not skip the class. The first test does not run, yet it is reported passed, and the other tests run as usual. Skip from `OnBeforeOneTest` instead.
- An error status from `OnBeforeOneTest` fails that one test without running it.
- An error status from `OnBeforeAllTests` stops the whole class. None of its tests runs, and the run has no test results for it.
- A runtime error in a test, such as `<UNDEFINED>`, ends and fails that test with `ERROR #5002: ObjectScript error: <UNDEFINED>` and the location. The next test still runs.

## Running tests

- `##class(%UnitTest.Manager).RunTest(testspec, qspec)` runs tests and returns a `%Status`.
- The testspec is a suite, a class and a method, separated by colons. `":MyApp.Tests.Cart"` runs one class, and `":MyApp.Tests.Cart:TestTotal"` runs one method of it.
- For classes already compiled on the server, pass `"/noload/nodelete/norecursive"`. The default, `/load`, first loads the classes from the test directory, and a run that loads and runs them deletes the loaded classes when it finishes unless `/nodelete` is given.
- `RunTest` checks that `^UnitTestRoot` names a directory that exists. It is a global, so each namespace has its own: set it in the namespace where the tests run.
- Results stay in that namespace and can be read with SQL from `%UnitTest_Result.TestInstance`, `TestSuite`, `TestCase`, `TestMethod` and `TestAssert`. `TestMethod.Status` is 1 for passed, 0 for failed and 2 for skipped, and `TestAssert` holds one row per assertion.
- After a run, compare the number of test methods reported for each class with the number of `Test` methods in it. When the count is short, the run's `TestMethod` rows show which tests never ran.

## Related skills

- `iris-mcp-objectscript-error-handling`: making and checking the `%Status` values that tests assert on.
- `iris-mcp-objectscript-gotchas`: language traps such as macros that work only in a test class.
~~~

**Probe log** (AC 41.3.2). Plan stage, 2026-10-19, on `server:"default"`, namespace `HSCUSTOM`.

- **Target:** `iris_server_info` reported `IRIS for UNIX (Ubuntu Server LTS for ARM64 Containers) 2026.2 (Build 221U)`.
- **Before:** `iris_doc_list filter:"Probe413" generated:true` returned `[]`.
- **Classes:** 21 disposable `ExecuteMCPv2.Temp.Probe413*` classes were put, compiled with `ck`, run, and deleted with one `iris_doc_delete` call.
- **After:** `iris_doc_list filter:"Probe413" generated:true` returned `[]`.
- **Writes:** no HSCUSTOM global was written. The only writes were the `%UnitTest` framework's own result rows from `iris_execute_tests`, run indices 1338 to 1347.
- **Reads only:** `^UnitTestRoot` in HSCUSTOM and USER (`iris_global_get`); `%UnitTest_Result` in HSCUSTOM and USER (`iris_sql_query`); ranged `iris_doc_get` of `%UnitTest.Manager`, `%UnitTest.TestCase` and `%Library.Persistent` (these match `irislib/` line for line).
- **Retro evidence (corroborating):**
  - epic-11:90,127 and epic-21:43 (localized prefixes);
  - epic-20:26 and epic-35:23 (`<PARAMETER>`);
  - epic-4:62 (`New $NAMESPACE`);
  - epic-23:32 (no `Ens.*`);
  - epic-36:26,36 (`$Test` and `Open`; `$Name` subscripts);
  - epic-18:35 (unchecked statuses);
  - epic-3:68-69 and epic-10:79 (`RunTest` qualifiers, `^UnitTestRoot`);
  - epic-22:39 (`TestMethod` rows).

Each row gives the claim, the probe, what was observed, and the verdict.

*The gotchas skill:*

- **G1, `$$$` is a macro, `$$` a label call, `$` a system function.**
  - Probe: `Probe413Labels.Calls`.
  - Observed: `macro=1;label=8;function=b`.
  - Holds.
- **G2, every class gets the status macros.**
  - Probe: `Probe413Run` and `Probe413Status` compiled with no `Include`.
  - Observed: `$$$OK`, `$$$ERROR`, `$$$ISERR`, `$$$ISOK`, `$$$ThrowOnError`, `$$$ADDSC`, `$$$ThrowStatus`, `$$$QuitOnError` and `$$$ERRORISTYPE` all compiled. `Macros` returned `OK=1;codes=5001;isErr=1;isOK=1;thrown=%Exception.StatusException`.
  - Holds.
- **G3, a code macro needs `Include %occErrors` on its own, but not inside `$$$ERROR`.**
  - Probe: the first `Probe413Run`, and `Probe413ErrInc`.
  - Observed: `MPP5610 : Referenced macro not defined: 'GeneralError'` for the standalone use only. With the include, `GeneralError=5001;ObjectScriptError=5002`. Mechanism: `irislib/%occStatus.inc:15`.
  - Holds. This corrects the plan's first draft.
- **G4, `$$$Assert` only in a test case.**
  - Probe: `Probe413NoMacro` and `Probe413IncTest`.
  - Observed: `MPP5610 : Referenced macro not defined: 'AssertEquals'`, then `MPP5376 : Method or Property 'AssertEqualsViaMacro' does not exist in this class.` Source: `TestCase.cls:5`.
  - Holds.
- **G5, extra arguments compile, then raise `<PARAMETER>`.**
  - Probe: `Probe413ArgCompile.Direct` (compiled) and `Probe413Run.ExtraArg`.
  - Observed: `direct:<PARAMETER> TakesOne^...` and `extra:<PARAMETER>`.
  - Holds.
- **G6, fewer arguments.**
  - Probe: `Probe413Run.ExtraArg`.
  - Observed: `fewerDefault:b=dflt;fewerNoDefault:bDefined=0`.
  - Holds.
- **G7, `$Get` around `%Get`, and the `%Get` default.**
  - Probe: `Probe413GetWrap.GetWrap`.
  - Observed: `<INVALID CLASS> Class '%Library.DynamicObject' does not support MultiDimensional operations;default=d`.
  - Holds.
- **G8, JSON `null` against the default; `%IsDefined`.**
  - Probe: `Probe413Run.DynNull`.
  - Observed: `getA=;getB=dflt;getE=;defA=1;defB=0;defE=1`.
  - Holds.
- **G9, `%GetTypeOf`.**
  - Probe: the same call.
  - Observed: `typeA=null;typeB=unassigned;typeE=string`.
  - Holds.
- **G10, keys that contain `_`.**
  - Probe: `Probe413Run.DynUnderscore`.
  - Observed: `get=5;json={"max_results":5,"page_size":10}`.
  - Holds.
- **G11, an object reference in `$List`.**
  - Probe: `Probe413Run.ListOref` and `Probe413More.ListOrefCall`.
  - Observed: `listIsObject=0;listValue=5143@%Library.ListOfDataTypes`, and `call:<INVALID OREF>;direct=1`.
  - Holds.
- **G12, a local array or `%DynamicArray` keeps the reference.**
  - Probe: `ListOref`.
  - Observed: `arrayIsObject=1;dynIsObject=1`.
  - Holds.
- **G13, canonical subscripts.**
  - Probe: `Probe413Run.Subscripts`.
  - Observed: `num1=1;str01=0;str1dot0=0;num1dot0=1`.
  - Holds.
- **G14, `$Order` order.**
  - Probe: the same call.
  - Observed: `order=[1][2][10][01][b]`.
  - Holds.
- **G15, `New $NAMESPACE` and `Catch`.**
  - Probe: `Probe413Run.NSNew`.
  - Observed: `start=HSCUSTOM;inCatch=%SYS;afterReturn=HSCUSTOM`.
  - Holds.
- **G16, the two patterns.**
  - Probe: G15, plus `EnsExists`, which saves and restores explicitly.
  - Observed: both returned in `HSCUSTOM`.
  - Holds.
- **G17, `Ens.*` is not everywhere; `%SYS` has none.**
  - Probe: `Probe413Run.EnsExists`, `Probe413More.EnsByNamespace` and `InteropEnabled`.
  - Observed: `HSCUSTOM=1;%SYS=0`, `USER=1`, and USER is interoperability-enabled here. So the claim was narrowed to `%SYS`.
  - Holds as narrowed.
- **G18, a timeout sets `$Test`.**
  - Probe: `Probe413Run.OpenTimeout` and `Probe413More.OpenTimeoutFails` (a read-only open of a missing file; nothing was created).
  - Observed: `withTimeout=1` and `expired=0`.
  - Holds.
- **G19, no timeout leaves `$Test` alone.**
  - Probe: `OpenTimeout`.
  - Observed: `noTimeoutAfter0=0;noTimeoutAfter1=1`.
  - Holds.
- **G20, `Open` arguments are positional; `:::1` is a mnemonic space.**
  - Probe: `OpenTimeout` and `Probe413More.MnemonicSlot`.
  - Observed: `mnemonicSlot=0` (`$Test` untouched), and `Open dev:::"^%X364"` gave `mnemonic=%X364`.
  - Holds.

*The error-handling skill:*

- **E1, `$$$OK` is 1, an error's value is 0, and the test is numeric.**
  - Probe: `Probe413Status.Shape`, with source `%occStatus.inc:8,23,27`.
  - Observed: `plus=0;isErr=1;eq1=0;okIsErr=0`.
  - Holds.
- **E2, anything not starting with a nonzero number is an error.**
  - Probe: `NotAStatus`.
  - Observed: `empty=1;word=1;two=0;one=0`.
  - Holds.
- **E3, code 5001; `GetErrorCodes`; `ERRORISTYPE`.**
  - Probe: `Shape` and `Append`.
  - Observed: `codes=5001;isType=1`; on a combined status, `isType=0`.
  - Holds.
- **E4, `GetErrorText`.**
  - Probe: `Shape`.
  - Observed: `text=ERROR #5001: disk full`.
  - Holds.
- **E5, `ADDSC` and `AppendStatus`.**
  - Probe: `Append`.
  - Observed: `ERROR #5001: first\r\nERROR #5001: second;codes=5001,5001;second=ERROR #5001: second;okPlus=ERROR #5001: second;appendOk=ERROR #5001: second`.
  - Holds.
- **E6, `EmbedStatus`.**
  - Probe: `Probe413Strip.Embed`.
  - Observed: `ERROR #5001: Import failed\r\n  > ERROR #5001: disk full;codes=5001`.
  - Holds.
- **E7, the translated prefix.**
  - Probe: `Lang`.
  - Observed: `fr=ERREUR #5001: disk full;de=FEHLER #5001: disk full` (`en` and `es` gave `ERROR`).
  - Holds.
- **E8, `ErrorMessage`, compiled verbatim.**
  - Probe: `Probe413Strip.Cases`.
  - Observed: `en=file: missing;fr=file: missing;de=file: missing;lookalike=Order #12: late;samecode=see #5001: here;combined=first\r\nERROR #5001: second`. The `fr` and `de` cases ran through `ErrorMessageIn`, the same logic with a language parameter.
  - Holds. This replaced the draft's shape-based strip, which turned `see #12: here` into `here`.
- **E9, doubling, and wrapping the message.**
  - Probe: `Strip` and `Cases`.
  - Observed: `wrappedRaw=ERROR #5001: ERROR #5001: file: missing` and `rewrapped=ERROR #5001: Import failed: file: missing`.
  - Holds.
- **E10, `ThrowOnError` uses `sc` and throws a `StatusException`.**
  - Probe: `ThrowOnErrorSc` and `Macros`, with source `%occStatus.inc:70`.
  - Observed: `sc=1` and `thrown=%Exception.StatusException`.
  - Holds.
- **E11, `ThrowStatus`.**
  - Probe: `ThrowStatus`.
  - Observed: `%Exception.StatusException:ERROR #5001: thrown`.
  - Holds.
- **E12, `AsStatus` gives a thrown status back unchanged.**
  - Probe: `StatusError`.
  - Observed: `codes=5001;text=ERROR #5001: boom`.
  - Holds.
- **E13, a runtime error in `Catch`.**
  - Probe: `SystemError`.
  - Observed: `class=%Exception.SystemException;name=<UNDEFINED>;code=9;location=SystemError+3^...;data=tNeverSet;codes=5002;text=ERROR #5002: ObjectScript error: <UNDEFINED>SystemError+3^... *tNeverSet;zerror=<UNDEFINED>SystemError+3^... *tNeverSet`.
  - Holds. The `$ZERROR` wording was corrected in the draft.
- **E14, `%Exception.General` always gives 5035.**
  - Probe: `GeneralException`, with source `General.cls:39-42` and `%occErrors.inc:1468`.
  - Observed: `code=5001;codes=5035;text=ERROR #5035: General exception Name 'MyApp.NotFound' Code '5001' Data 'order 42'`.
  - Holds.
- **E15, rethrow.**
  - Probe: `Rethrow`.
  - Observed: `outer:<UNDEFINED> RethrowInner+2^...`.
  - Holds.
- **E16, `QuitOnError`.**
  - Probe: `QuitOutside` and `Probe413QuitOnErr`.
  - Observed: `ERROR #5001: boom` outside a `Try`. Inside one, `#1043: QUIT argument not allowed : 'sc'`.
  - Holds.
- **E17, no `Finally`.**
  - Probe: `Probe413Finally`.
  - Observed: `#1026: Invalid command : 'Finally'`.
  - Holds.
- **E18, `Process`, compiled verbatim.**
  - Probe: `ProcessAll`.
  - Observed: `[ok]=OK;[]=ERROR #5001: An id is required;[none]=ERROR #5001: Nothing to process for none;[boom]=ERROR #5002: ObjectScript error: <UNDEFINED>Count+1^... *tMissing`.
  - Holds.
- **E19, `Do` drops a status.**
  - Probe: `Dropped`.
  - Observed: `continued`.
  - Holds.
- **E20, `%Save()` returns `%Status`.**
  - Probe: live `iris_doc_get %Library.Persistent.cls:934`.
  - Observed: `Method %Save(related As %Integer = 1) As %Status`.
  - Holds.

*The unit-test skill:*

- **U1, the example class, compiled verbatim as `Probe413TestShape`.**
  - Probe: `iris_execute_tests`, class level, run 1338.
  - Observed: total 2 of 2 expected, both passed.
  - Holds.
- **U2, instance methods with no arguments; the hooks.**
  - Probe: source `Manager.cls:1240` and `TestCase.cls:111-140`, plus U1.
  - Observed: the hooks ran around each test.
  - Holds.
- **U3, one object per class.**
  - Probe: `Probe413TestOrder`, whose `Trail` property is carried across tests, run 1339, with source `Manager.cls:1156`.
  - Observed: total 4 of 4, all passed.
  - Holds.
- **U4, `%OnNew` without `##super`.**
  - Probe: `Probe413TestNoSuper`, run 1345, with source `TestCase.cls:88`.
  - Observed: total 1 of 1, failed with `ERROR #5002: ObjectScript error: <INVALID OREF>GetSourceLocation+15^%UnitTest.TestCase.1`.
  - Holds.
- **U5, the `Test` prefix, case-sensitive.**
  - Probe: `Probe413TestNames`, run 1341.
  - Observed: total 2 of 2 expected (`TestReal`, `TestingHelper`). `testLowerCase` and `CheckSomething` never ran.
  - Holds.
- **U6, the order.**
  - Probe: `Probe413TestOrder`, run 1339, with source `Manager.cls:1333-1371`.
  - Observed: each test asserted its own position, `Test2,Test10,TestA,TestB`, and all passed.
  - Holds.
- **U7, a test that leans on another fails alone.**
  - Probe: `Probe413TestOrder:TestB`, method level, run 1340.
  - Observed: total 1, failed: `AssertEquals: TestB runs fourth`.
  - Holds.
- **U8, the macro table.**
  - Probe: source `%outUnitTest.inc` and `TestCase.cls:338-375`, plus `Probe413TestAsserts`, run 1342.
  - Observed: total 8 of 8 expected; 5 passed, 2 failed (`TestErrorStops`, `TestFailsOnPurpose`), 1 skipped (`TestSkipsItself`). `AssertStatusEquals` passed on two separately built equal errors.
  - Holds.
- **U9, `$$$AssertFilesSame`.**
  - Probe: live `iris_doc_get %UnitTest.TestCase.cls:381`.
  - Observed: `Method AssertFilesSameViaMacro(autoquoted, file1, file2, description) As %Boolean`.
  - Holds.
- **U10, the optional description, except `AssertSkipped`.**
  - Probe: `Probe413TestSkipNoReason`, run 1347, then SQL over its asserts.
  - Observed: total 2 of 2; `TestNoReason` failed with `<UNDEFINED>AssertSkippedViaMacro+2^%UnitTest.TestCase.1 *message`. `TestNoDescription` passed, and its log reads `1 + 1== 2`.
  - Holds.
- **U11, `AssertEquals` uses `=`.**
  - Probe: `TestStringEquality`, run 1342, with source `TestCase.cls:156`.
  - Observed: passed.
  - Holds.
- **U12, the return value.**
  - Probe: `TestReturnValue`, run 1342, with source `TestCase.cls:163,220`.
  - Observed: passed.
  - Holds.
- **U13, a failed assertion does not end the test.**
  - Probe: SQL over run 1342.
  - Observed: `TestFailsOnPurpose` holds `AssertFailure` with status 0, then `AssertSuccess` "still running after a failed assertion" with status 1.
  - Holds.
- **U14, skipping from `OnBeforeOneTest` and inside a test.**
  - Probe: `Probe413TestBeforeOne`, run 1344, and `TestSkipsItself`, run 1342.
  - Observed: `TestSkipped` skipped with duration 0; `TestSkipsItself` skipped.
  - Holds.
- **U15, `AssertSkipped` in `OnBeforeAllTests`.**
  - Probe: `Probe413TestSkipAll`, run 1346, then SQL.
  - Observed: total 2 of 2, both reported passed, but TestA has duration 0 and no assertion rows. Only TestB ran.
  - Holds. This corrects the draft's "skips nothing".
- **U16, a setup error fails one test.**
  - Probe: run 1344.
  - Observed: `TestSetupFails` failed with duration 0: `ERROR #5001: per-test setup failed`.
  - Holds.
- **U17, an `OnBeforeAllTests` error.**
  - Probe: `Probe413TestBeforeAll`, run 1343.
  - Observed: total 0 against 2 expected: "produced no method-level results ... OnBeforeAllTests: ERROR #5001: setup failed".
  - Holds.
- **U18, a runtime error fails one test, and the run goes on.**
  - Probe: run 1342.
  - Observed: `TestErrorStops` failed with `ERROR #5002: ObjectScript error: <UNDEFINED>TestErrorStops+1^... *tNeverSet`, and `TestZAfterError` passed.
  - Holds.
- **U19, `RunTest` returns `%Status`.**
  - Probe: live `iris_doc_get %UnitTest.Manager.cls:386`.
  - Observed: `ClassMethod RunTest(ByRef testspec As %String, qspec As %String, ByRef userparam) As %Status`.
  - Holds.
- **U20, the testspec forms.**
  - Probe: source `Manager.cls:249-250,432`, plus every run above, which used `RunTest(":<class>", ...)`, and run 1340, which used `":<class>:TestB"` (`src/ExecuteMCPv2/REST/UnitTest.cls:187-198`).
  - Holds.
- **U21, `/noload/nodelete/norecursive`; the default `/load` deletes what it loaded.**
  - Probe: live `iris_doc_get %UnitTest.Manager.cls:318-338`, plus every run above, which used that qspec (`UnitTest.cls:104`).
  - Holds.
- **U22, the directory check; the global per namespace.**
  - Probe: live `iris_doc_get %UnitTest.Manager.cls:636-641` (also `:779-781`), and `iris_global_get`.
  - Observed: HSCUSTOM `/durable/iris/mgr/` (defined); USER undefined.
  - Holds.
- **U23, results per namespace; `Status` 1, 0 and 2; one `TestAssert` row per assertion.**
  - Probe: SQL over runs 1342 and 1346, with source `Result/TestMethod.cls:13`.
  - Observed: `COUNT(*)` of the `Probe413` cases is 10 in HSCUSTOM and 0 in USER.
  - Holds.
- **U24, comparing counts and reading `TestMethod` rows.**
  - Probe: advice resting on U17 and U23.
  - Holds.

Claims that failed in the draft and were corrected before the golden text: G3 (the `$$$GeneralError` include), G17 (narrowed to `%SYS`), E8 (the strip), E13 (the `$ZERROR` wording), U10 (`AssertSkipped` needs its reason) and U15 (`OnBeforeAllTests` skip).

**Flagged for the retro:** none of the corrections above contradicts a `.claude/rules/*` file. DW-615 already holds the 41.2 list. One new item goes to the lead as the `deferred:` entry in the frontmatter: `SanitizeError` knows only two prefix words.

**Probe anchors**, one per row, which `skills-pack-knowledge.test.ts` requires verbatim. 65 in all, checked against the golden texts by a scratch script: none missing.

- **gotchas (20):**
  - `` `$$Name` calls the label ``
  - `` `$$$ThrowStatus` and `$$$QuitOnError` ``
  - `MPP5610 : Referenced macro not defined: 'GeneralError'`
  - `Include %occErrors`
  - `MPP5376 : Method or Property 'AssertEqualsViaMacro' does not exist`
  - `` then raises `<PARAMETER>` when it runs ``
  - `` `$Data(pB)` is 0 ``
  - `does not support MultiDimensional operations`
  - `` returns `""`, not the default ``
  - `` `"unassigned"`, `"null"` and `"string"` ``
  - `` `Set tObj."max_results" = 5` ``
  - `5143@%Library.ListOfDataTypes`
  - `` calling a method on it raises `<INVALID OREF>` ``
  - `` `Do tArr.%Push(tObj)` ``
  - `` `tA("1")` and `tA(1)` are one node ``
  - `` `1`, `2`, `10`, `"01"`, `"b"` ``
  - `` not when its `Try` block ends ``
  - `%ExistsId("Ens.Director")`
  - `` `Open tFile::5` ``
  - `` In `Open tFile:::1` the `1` is the mnemonic space ``
- **error-handling (22):**
  - `` never with `tSC = 1` ``
  - `` `$$$ISERR("")` and `$$$ISERR("done")` are both 1 ``
  - `` `$$$ERRORISTYPE(tSC, $$$GeneralError)` ``
  - `` returns `ERROR #5001: disk full` ``
  - `separated by CR LF`
  - `` `  > ERROR #5001: disk full` ``
  - `` `ERREUR #5001: disk full` ``
  - `` `FEHLER #5001: disk full` ``
  - `If $Piece(tText, tTag) '[ " " Set tText = $Piece(tText, tTag, 2, *)`
  - `` `Order #12: ` ``
  - `` `ERROR #5001: ERROR #5001: file: missing` ``
  - `` `ERROR #5001: Import failed: file: missing` ``
  - `` `sc` is 1 ``
  - `` `ex.Code` is 9 ``
  - `` `ERROR #5002: ObjectScript error: <UNDEFINED>` ``
  - ``` `ERROR #5035: General exception Name '...' Code '...' Data '...'` ```
  - `` with its original `Name` and `Location` ``
  - `` `#1043: QUIT argument not allowed : 'sc'` ``
  - `` `#1026: Invalid command : 'Finally'` ``
  - `$$$ThrowStatus($$$ERROR($$$GeneralError, "Nothing to process for "_pId))`
  - `` `Do ..Save()` throws away ``
  - `` `$$$ThrowOnError(tObj.%Save())` ``
- **unit-tests (23):**
  - `While tIter.%GetNext(.tKey, .tItem) {`
  - `Tests are instance methods with no arguments`
  - `One test-case object serves every test of the class`
  - `` the first assertion fails with `<INVALID OREF>` ``
  - `` a helper named `TestingHelper` ``
  - `` `testLowerCase` never runs ``
  - `` `Test2` runs before `Test10` ``
  - `fails when it runs by itself`
  - ``| `$$$AssertStatusEquals(sc1, sc2, msg)` |``
  - `` `$$$AssertFilesSame(file1, file2, msg)` ``
  - `` `1 + 1== 2` ``
  - `` `"1.0"` and `1` are not equal ``
  - ``` `If '$$$AssertStatusOK(tSC, "saved") Quit` ```
  - `A failed assertion does not end the test`
  - `its method does not run, and it is reported skipped`
  - `yet it is reported passed`
  - `fails that one test without running it`
  - `None of its tests runs`
  - `The next test still runs`
  - `` `":MyApp.Tests.Cart:TestTotal"` ``
  - `` `"/noload/nodelete/norecursive"` ``
  - `each namespace has its own`
  - `` `TestMethod.Status` is 1 for passed, 0 for failed and 2 for skipped ``

The test types each anchor literally, without the outer Markdown code span shown here.

**Docs re-check** (Rule #14, 2026-10-19):

- **code.claude.com/docs/en/skills:**
  - "Claude Code reads the frontmatter only when the opening `---` is the file's first line. Otherwise it treats the whole file, `---` markers included, as skill content. If the YAML between the markers doesn't parse, the skill still loads with no fields set."
  - "Outside Claude Code, only `name`, `description`, `license`, `compatibility`, `metadata`, and `allowed-tools` are allowed."
  - "Keep `SKILL.md` under 500 lines."
- **agentskills.io/specification:**
  - `name`: 1-64 characters, lower-case letters, digits and hyphens, no leading, trailing or doubled hyphen, matching the parent directory.
  - `description`: 1-1024 characters, saying what the skill does and when to use it.
- **platform.claude.com/docs/en/agents-and-tools/agent-skills/overview:**
  - `name` "Cannot contain XML tags" and "Cannot contain reserved words: anthropic, claude".
  - `description` "Cannot contain XML tags".

## Verification

- **How commands run.** Every command runs from `/Users/jbrandt/git/iris-execute-mcp-v2` in the foreground with `timeout: 600000`, one package or one test-file group per call.
- **Builds.** The built dists of shared, the five servers and client-config are required by `validate:prompts` and `check:provenance`. No package `src/` changes, so no rebuild is needed unless one goes stale.
- **IRIS.** No live gate and no stateful OS test class. The only IRIS writes allowed are disposable `ExecuteMCPv2.Temp.Probe413*` classes, to re-probe a changed claim, each deleted with leftovers `[]`.

**Shared surfaces:** these change, and other tests assert on them.

- The pack file set (16 → 19) and client-config's tarball list.
- The validator OK line (39 → 45 sources: 33 content files, 3 knowledge).
- `check:provenance`'s agent-file count (27 → 33), and its rule set, which gains `skill-frontmatter`; every fixture fed to `checkProvenance` is affected.
- The 41.1 scratch pins listed in the Code Map, and 41.1's CRLF-plus-BOM provenance row (decision 4).
- The hygiene list and word counter, which move into `agent-text-hygiene.ts`.
- `skills-pack-src/README.md`.
- The CHANGELOG's newest section.
- `listAgentContentFiles` output, with 6 more files.

**Standing criterion:** every test added or changed passes on a fresh environment, in either order.

**Commands:**

- `(loop)` `shasum -a 256 skills-pack-src/knowledge/*/SKILL.md` -- expected: the three sha256 values in Design Notes.
- `(loop)` `pnpm gen:pack` twice, then `git status --short packages/client-config/skills-pack` -- expected: only the three new skill directories, and no change on the second run. Then `pnpm gen:pack:check` -- expected: `19 pack file(s) match their sources`.
- `(loop)` `pnpm validate:prompts`, then `pnpm check:provenance` -- expected: the matrix OK lines (`45 source(s) checked (...)`; `0 provenance row(s), 33 agent file(s), 8 distribution(s)`).
- `(loop)` `npm pack --dry-run --json --ignore-scripts --offline` in `packages/client-config` -- expected: it lists the three `skills-pack/skills/iris-mcp-objectscript-*/SKILL.md`.
- `(loop)` `pnpm --filter @iris-mcp/all exec vitest run` over these files -- expected: pass:
  - `src/__tests__/skills-pack-frontmatter.test.ts` and `src/__tests__/skills-pack-knowledge.test.ts`;
  - `src/__tests__/skills-pack-rule.test.ts` and `src/__tests__/story-41-2-qa-rule-text-hygiene.test.ts`;
  - `src/__tests__/pack-provenance.test.ts`, `src/__tests__/skills-pack.test.ts` and `src/__tests__/validate-prompts.test.ts`;
  - `src/__tests__/skills-generated-frontmatter.test.ts` and `src/__tests__/story-41-2-doc-claims.test.ts`.
- `(loop)` the five `src/__tests__/story-41-1-qa-*.test.ts` files in one call -- expected: pass.
- `(once)` One call each:
  - `pnpm --filter @iris-mcp/shared test`, and the same for dev, admin, interop, ops and client-config;
  - the full `@iris-mcp/all` suite in three calls (`ls src/__tests__/*.test.ts | awk 'NR%3==k'`, k = 1, 2, 0) -- expected: green.
- `(once)` `pnpm gen:skills:check` (`13 generated file(s)`), `pnpm gen:governance-baseline:check` (`1e62c5ad5bf7`/141), `pnpm gen:tools-list-snapshot:check`, `node scripts/check-epics-sync.mjs` and `git diff --stat packages/shared/src/bootstrap-classes.ts` (empty) -- expected: OK.

**Planned mutations (Rule 19).** Apply each, observe red, revert (re-running `gen:pack` where it applies), and confirm `git status --short` and `git diff --stat` are unchanged. Record each as `mutation: <change> → <test>`.

- **M1** (DW-613, on the guarded path): delete the `description:` line of the real gotchas source and run `gen:pack` → `pnpm check:provenance` exits 1 with `[skill-frontmatter]` for `knowledge:` and `pack:`, and `pack-provenance.test.ts` "real tree passes every provenance rule" goes red.
  - mutation: M1 applied as planned (the `description:` line of the real gotchas source deleted, `pnpm gen:pack` re-run) → `pnpm check:provenance` exit 1 with `[skill-frontmatter] pack:skills/iris-mcp-objectscript-gotchas/SKILL.md` and `[skill-frontmatter] knowledge:iris-mcp-objectscript-gotchas/SKILL.md`; `pack-provenance.test.ts` "real tree passes every provenance rule" red. Reverted (line restored, `gen:pack` re-run); the changed-and-untracked file digest was identical to before.
- **M2** (DW-613): `checkProvenance` skips the new rule → the scratch CLI row "header above the frontmatter" and the rule's unit rows go red.
  - mutation: `const skill = null;` in the `checkProvenance` agent-file loop (the rule never runs) → `skills-pack-frontmatter.test.ts` 9 red: the five `checkProvenance` rows (three labels with no description, the directory-name row, the every-file row) and the four scratch CLI rows (header above the frontmatter, no description, BOM, name not the directory). Reverted; digest identical.
- **M3** (DW-613): the reader skips its line-1 check → the header-above rows go red, while `hasValidAdaptationHeader` stays `true` (the gap).
  - mutation: the reader's line-1 check replaced by `if (false)` in `skillFrontmatterProblems` → `skills-pack-frontmatter.test.ts` 8 red: the header-above, no-frontmatter, empty-file, blank-first-line and trailing-space-opener reader rows, the message row, the CLI row "header above the frontmatter", and the gap pin (`hasValidAdaptationHeader` stays `true`, as its first expectation shows; the second expectation, that the reader refuses the text, is the one that goes red). Reverted; digest identical.
- **M4** (decision 4): the reader strips a BOM → the BOM rows go red.
  - mutation: the BOM early-return replaced by `if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);` → 3 red: the reader row "a BOM before the opening line" and the scratch CLI row "a skill that starts with a BOM" in `skills-pack-frontmatter.test.ts`, and "the same adapted skill as CRLF with a BOM before its frontmatter is refused" in `story-41-1-qa-provenance-cli.test.ts`. Reverted; digest identical.
- **M5:** the name-equals-directory check is removed → the mismatch rows go red.
  - mutation: `if (name !== dirName)` replaced by `if (false)` → 4 red in `skills-pack-frontmatter.test.ts`: the reader row "a name that is not its directory", the `checkProvenance` rows "takes the directory name from the pack path" and "reports every file with a problem", and the scratch CLI row "a skill whose name is not its directory". Reverted; digest identical.
- **M6:** the tag check becomes "no `<` or `>`" → the real-tree sweep goes red on `promote-environment-change` (`->`). With the tag check removed instead, the `<UNDEFINED>` row goes red.
  - mutation: the tag pattern replaced by `/[<>]/` → 8 red in `skills-pack-frontmatter.test.ts`, among them "raises no problem for any of them" (the committed-pack sweep, red on `promote-environment-change`) and "a generated workflow description holds '->'". The tag pattern replaced by `/(?!)/` (never matches) → 2 red: the `<UNDEFINED>` and the closing-tag reader rows. Both reverted; digest identical.
- **M7** (AC 41.3.1): `Use when` is removed from a description → the knowledge test goes red.
  - mutation: " Use when creating" changed to " When creating" in the unit-tests description (re-run on the final tree) → `skills-pack-knowledge.test.ts` 3 red: the sha256 row, "holds exactly its name and description" and "has a pack copy equal to the source". Reverted; the three sha256 values equal the golden ones again.
- **M8** (AC 41.3.3): `` `iris_doc_put` `` is added to a skill → the knowledge test goes red, while `validate:prompts` stays green because the name is real.
  - mutation: the line "- Call `iris_doc_put`." added to the gotchas source, `pnpm gen:pack` re-run → `pnpm validate:prompts` stays green (`45 source(s) checked`, because the name is real), and `skills-pack-knowledge.test.ts` goes red on "names no iris_* tool" and on "names nothing of this repository" for the gotchas skill. Reverted (`gen:pack` re-run); digest identical.
- **M9** (AC 41.3.3): "see Rule #7" is added, then `packages/shared` → the hygiene test goes red for each.
  - mutation: the line "- See Rule #7." added to the unit-tests source → `skills-pack-knowledge.test.ts` "names nothing of this repository" red with two classes (an internal rule number, a number sign that is no IRIS error code); then "- See packages/shared." instead → the same test red with "a repository path". Both reverted; digest identical.
- **M10:** bullet 5 of the rule is pasted into a skill → the no-copy test goes red.
  - mutation: the rule's fifth bullet (the `Quit` bullet) pasted at the end of the gotchas source → `skills-pack-knowledge.test.ts` "goes deeper than the always-on rule: it copies none of the rule's bullets" red (and the hygiene test, whose problem list holds the copy). Reverted; digest identical.
- **M11** (AC 41.3.2): `` `Test2` runs before `Test10` `` is reversed → the anchor test goes red.
  - mutation: "so `Test2` runs before `Test10`" changed to "so `Test10` runs before `Test2`" in the unit-tests source → `skills-pack-knowledge.test.ts` "carries every probe anchor" red, naming the missing anchor `` `Test2` runs before `Test10` `` (the sha256 and pack-copy rows go red too). Reverted; digest identical.
- **M12:** a stray `.DS_Store` is placed in a knowledge directory → the "only `SKILL.md`" test goes red.
  - mutation: a stray `.DS_Store` file placed in `skills-pack-src/knowledge/iris-mcp-objectscript-gotchas/` → `skills-pack-knowledge.test.ts` "is the only file in its source directory and in its pack directory" red (`[ '.DS_Store', 'SKILL.md' ]`). File removed; digest identical. The digest of every mutation run is `git ls-files -m -o --exclude-standard` (outside `_bmad-output/`) sorted, sha256 of each file, sha256 of that list.
- **M13** (AC 41.3.1, the notice keeps 0 provenance rows; added in the review pass).
  - mutation: a well-formed provenance row added to the real notice source → `skills-pack-knowledge.test.ts` "the notice still has no provenance row" red. Then the table header row changed to `| Pack File | ...` (the case the old assertion could not see) → the same test red, on the header-present assertion. Both reverted with `git checkout --` on the notice; the tree digest equalled the digest taken before.
- **M14** (AC 41.3.1, the fenced-block shape; added in the review pass).
  - mutation: an extra fenced block (a fence line, `x`, a fence line) added to the gotchas source → `skills-pack-knowledge.test.ts` red on "holds 0 fenced code block(s)" (with the sha256 and pack-copy rows). Removed; the three sha256 values equal the golden ones again.
- **M15** (the moved count pins, 19, 34, 45, 33 and 35; added in the review pass).
  - mutation: the unit-tests knowledge directory moved out of `skills-pack-src/knowledge/` and `pnpm gen:pack` re-run (the pack drops to 18 files) → 9 red across `skills-pack-rule.test.ts`, `story-41-1-qa-pack-scratch-cli.test.ts`, `story-41-1-qa-provenance-cli.test.ts` and `story-41-1-qa-validate-prompts-pack.test.ts`: the `19 pack file(s)` and `34 pack file(s)` pins, the `45 source(s) checked` pins, and the `33` and `35 agent file(s)` pins. Directory moved back and `pnpm gen:pack` re-run; `gen:pack:check` reports 19 files and the tree digest equalled the digest taken before.
- **M16** (AC 41.3.3, a project class or helper; added in the review pass).
  - mutation: the line "- Call ExecuteMCPv2.Utils." added to the unit-tests source → `skills-pack-knowledge.test.ts` "names nothing of this repository, its planning or its tooling" red (with the sha256 and pack-copy rows). Removed; the three sha256 values equal the golden ones again.
- **Unchanged counts** (AC "Unchanged counts"): pinned by the existing `(once)` gates, `gen:skills:check`, `gen:governance-baseline:check`, `gen:tools-list-snapshot:check` and the empty `git diff --stat packages/shared/src/bootstrap-classes.ts`. This story edits no prompt, tool, preset, governance or bootstrapped input, so no mutation of those gates applies; their own stories hold their mutation evidence.

### QA stage (2026-10-19)

**Tests added (QA).** Both are in the default suite (`src/__tests__/*.test.ts`), need no IRIS and no network, and write only to scratch roots under `os.tmpdir()` that each test removes.

- `packages/iris-mcp-all/src/__tests__/story-41-3-qa-frontmatter-process.test.ts` (QA), 29 tests. The real `scripts/check-provenance.mjs` in a scratch copy, one defect at a time, the pack built by the real `gen-pack.mjs`. 18 red rows: a missing name, an upper-case name, `claude` and `anthropic` in the name, a 65-character name, a 1,025-character description, an XML-like tag (opening and closing), an extra key, a repeated key, a folded value, an empty description, no closing line, a blank line or a title above the frontmatter, no frontmatter, and CRLF with a missing description or a tag. Each is red with exactly the rule tag `skill-frontmatter`, with the expected problems for the `knowledge:` label and again for the `pack:` label and no other problem line, and then green once repaired in the same scratch copy (the negative control). 9 accepted rows (CRLF in every form, 64-character name, 1,024-character description, quoted values holding `: `, ` #` and `->`, single quotes, comment lines, the other field order, a reference file with no frontmatter) and 2 hermeticity rows. The BOM, header-above, missing-description and name-not-directory CLI rows already exist in `skills-pack-frontmatter.test.ts` and are not repeated.
- `packages/iris-mcp-all/src/__tests__/story-41-3-qa-knowledge-gate-process.test.ts` (QA), 25 tests. Part 1: `scripts/validate-prompts.mjs` on the three real knowledge skills (an unknown `iris_*` token names the source and the pack copy for each skill; a one-letter slip is unknown; a real tool name, a rule number, a DW id, an AD id and a repository path all pass the validator, which pins that it checks tool names only). Part 2: the committed `skills-pack-knowledge.test.ts` run in a child vitest process against a scratch copy with one offending line added to one real skill (source and pack copy): a real tool name, an unknown `iris_*` token, `Rule #7:`, `item #58`, `DW-613`, `AD-28`, `packages/shared/...`, `.claude/rules`, `/Users/...`, a URL. For each, the wording test goes red with the expected class named in the console report, the other wording tests of that skill and of the two untouched skills stay green, and the sha256 test is red only for the edited skill. Negative controls: IRIS codes, an IRIS qualifier, a pack skill name and `AD-hoc` added to each skill keep every wording test green.

**Live verification of the shipped text (Rule 3, one-time, nothing added to the default suite).** `server:"default"`, namespace `HSCUSTOM`, IRIS for UNIX 2026.2 (Build 221U). Before: `iris_doc_list` filter `QA413` generated included returned `[]`. 19 disposable `ExecuteMCPv2.Temp.QA413*` classes were put and compiled with `ck`, then deleted with one `iris_doc_delete`; after: `[]` again. No HSCUSTOM global was written (the `^UnitTest` result rows of runs 1358 to 1365 are the framework's own, as in the plan stage's 1338 to 1347). Sources are byte-equal to the golden sha256 values.

- Fenced blocks, 3 in all: `ErrorMessage` (error-handling), `Process` (error-handling) and the `Cart` test class (unit-tests); the gotchas skill has none. Compiled verbatim: `ErrorMessage` and `Process` compile with no `Include` (the `Process` helper methods `Validate` and `Count` had to be added); `Cart` compiles with only the class name changed.
- Illustrative-only: `Process`. Alone it does not compile (`MPP5392 : No such method 'Validate' defined in this class.`, same for `Count`); the text around it does not say the two helpers are placeholders (already rejected as negligible in the review triage, not re-filed).
- Behavior of each block against its surrounding text, all as stated: `ErrorMessage` gives `file: missing` for `ERROR #5001: file: missing`, keeps `Order #12: late` and `see #5001: here`, strips only the first line of a combined status, and wrapping the whole text gives `ERROR #5001: ERROR #5001: file: missing` while wrapping the message gives `ERROR #5001: Import failed: file: missing`. "Removes one prefix in any language" holds for all 15 system message tables (ar, de, en, en-us, es, es-cl, fr, it, ja, ko, nl, pt-br, ru, uk, zh-cn), both through an explicit-language twin and through the verbatim block under each session language (the session language restored afterwards). This closes the review row "run for en, es, fr and de only". `Process` returns OK for a good id, and the `Validate` error, the thrown empty-count status and the `Count` runtime error (`ERROR #5002: ObjectScript error: <UNDEFINED>Count+2^... *tMissing`) all end up in `tSC`.
- `iris_execute_tests`, one class per call, `total` against the `Test*` count: `Cart` 2 of 2 (run 1358), `Cart:TestTotal` at method level 1 of 1 (1359), an order and naming class 5 of 5 (1360), an assertions class 8 of 8 with 3 passed, 4 failed and 1 skipped as designed (1361), a per-test hook class 3 of 3 (1362), a failing `OnBeforeAllTests` class 0 of 2 with the class-level reason `OnBeforeAllTests: ERROR #5001: setup failed` (1363), a skipping `OnBeforeAllTests` class 2 of 2 (1364) and a `%OnNew` without `##super` class 1 of 1 failing with `<INVALID OREF>` (1365). SQL over `%UnitTest_Result` confirmed: `Test2` before `Test10` then string order, `TestingHelper` runs, `testLowerCase` and `CheckSomething` do not; `"1.0"` against `1` fails while `+"1.0"` and `1.0` pass; a failed assertion does not end the test and returns 0 (a passed one returns 1); `$$$AssertEquals(1 + 1, 2)` logs `1 + 1== 2`; `$$$AssertSkipped()` with no reason fails with `<UNDEFINED>...*message`; a setup error fails one test with duration 0 and no assertion rows; `TestA` of the skipping `OnBeforeAllTests` class is reported passed with no assertion rows; `TestMethod.Status` is 1, 0 and 2.
- The inline snippets of the gotchas skill, run in one class compiled with no `Include`: `$$$`, `$$` and `$` forms; extra arguments compile and raise `<PARAMETER>`; fewer arguments and `$Data(pB)` is 0; `$Get(tObj.%Get(...))` raises `<INVALID CLASS> Class '%Library.DynamicObject' does not support MultiDimensional operations`; JSON `null`, `%IsDefined`, `%GetTypeOf`; underscore keys; `$ListBuild` of an object; local array and `%DynamicArray`; canonical subscripts and `$Order` order; `New $NAMESPACE` and the `Catch` namespace; `%ExistsId("Ens.Director")` is 1 in HSCUSTOM and 0 in `%SYS`; `Open` and `$Test` including the literal `Open tFile::5` and `Open tFile:::1`. The standalone `$$$GeneralError` compile error (`MPP5610 : Referenced macro not defined: 'GeneralError'`), the `Include %occErrors` fix, `$$$Assert` in a plain class (`MPP5610`), `$$$QuitOnError` inside `Try` (`#1043: QUIT argument not allowed : 'sc'`) and `Finally` (`#1026: Invalid command : 'Finally'`) all print the quoted text.
- The inline snippets of the error-handling skill: `$$$OK`, `$$$ISERR`, `$$$ISOK`, `GetErrorCodes`, `$$$ERRORISTYPE`, `GetErrorText`, `$$$ADDSC`, `AppendStatus`, `GetOneErrorText`, `EmbedStatus`, `ThrowOnError` overwriting `sc`, `ThrowStatus`, `AsStatus`, the `SystemException` fields and `$ZERROR`, `%Exception.General` giving 5035, rethrow, `$$$QuitOnError` outside `Try`, a dropped status, and `%Save()` returning `%Library.Status` (`%Status`). All as stated.

**QA findings (live).** Three wording points, all low, none a code defect; the text is the lead's and the review stage's to change, and each changed claim goes through the probe discipline and the anchor and sha256 pins.

- The gotchas skill quotes `MPP5376 : Method or Property 'AssertEqualsViaMacro' does not exist` for `Include %outUnitTest`. That holds in an instance `Method`. In a `ClassMethod` the compile prints `MPP5392 : No such method 'AssertEqualsViaMacro' defined in this class.` (classes `QA413CFAssertInc` and `QA413CFAssertInc2`, deleted). An agent writing a class method sees a different code and text. The probe anchor `MPP5376 : Method or Property 'AssertEqualsViaMacro' does not exist` pins the current wording.
- The error-handling skill says a thrown status "comes back unchanged" from `ex.AsStatus()`. The code and the text are identical, but the value is not byte-identical: it gains the location of the throw (570 against 627 characters; `tBack = tSC` is 0).
- The unit-tests skill says `TestAssert` "holds one row per assertion". It also holds one row per `$$$LogMessage` and an automatic `Duration of execution` row per test method (run 1361: `TestNoDescription` has one assertion row and one duration row), so a row count over-counts assertions.

**QA mutations (Rule 19).** Each applied, observed red, reverted; `git status --short` and the sha256 of the four touched files (`scripts/lib/skills-pack.mjs`, `scripts/lib/validate-prompts-core.mjs`, `agent-text-hygiene.ts`, `skills-pack-knowledge.test.ts`) equal before and after.

- mutation: `SKILL_NAME_RESERVED_WORDS` loses `anthropic` → `story-41-3-qa-frontmatter-process.test.ts` 1 red, the row "the reserved word anthropic in the name".
- mutation: `XML_LIKE_TAG = /(?!)/` (never matches) → 3 red: the opening-tag, closing-tag and CRLF-tag rows.
- mutation: `SKILL_DESCRIPTION_MAX_LENGTH = 2048` → 1 red, the 1,025-character row (the exactly-1,024 accepted row stays green).
- mutation: the allowed-fields check replaced by `if (false)` → 1 red, the extra-key row. (Adding `license` to `SKILL_FRONTMATTER_FIELDS` instead turns most rows red, because every listed field becomes required; that coarser mutation was dropped.)
- mutation: the `\r` strip in the line split removed → 4 red: the two CRLF red rows and the two CRLF accepted rows.
- mutation: `IRIS_TOKEN_RE = /\biris_zz[a-z0-9_]+\b/g` → `story-41-3-qa-knowledge-gate-process.test.ts` 7 red: the four validator rows (unknown token in each skill, the one-letter slip), the two `iris_*` offender rows and the baseline, whose child run also goes red on the gate's own tool-name negative control.
- mutation: `AD` removed from the planning-id pattern in `agent-text-hygiene.ts` → 1 red, the AD-id row; the shared list's only sample is `DW-615`, so the `AD` alternative had no pin before this row.
- mutation: `repositoryPathPattern` in `skills-pack-knowledge.test.ts` given a `/zz` suffix (never matches) → 3 red: the repository-path row, the dotted-entry row and the baseline.

## Auto Run Result

Status: done
Blocking condition: none

**Summary.** Three suite-prefixed, tool-free knowledge skills (`iris-mcp-objectscript-gotchas`, `iris-mcp-objectscript-error-handling`, `iris-mcp-objectscript-unit-tests`) are in `skills-pack-src/knowledge/`, each equal to its golden text (sha256 checked), and `pnpm gen:pack` shipped the 3 copies unchanged (19 pack files; a second run changes nothing). DW-613 is closed by a `skill-frontmatter` rule in `check:provenance`, backed by one strict reader, `skillFrontmatterProblems`, shared from `scripts/lib/skills-pack.mjs`. `BOOTSTRAP_VERSION` stays `5296a1c836f4`; tools stay 110 package / 115 advertised; the governance baseline is untouched.

**Files changed.**
- `skills-pack-src/knowledge/iris-mcp-objectscript-{gotchas,error-handling,unit-tests}/SKILL.md`: the three golden texts (new).
- `packages/client-config/skills-pack/skills/iris-mcp-objectscript-{gotchas,error-handling,unit-tests}/SKILL.md`: generated copies from `pnpm gen:pack` (new).
- `scripts/lib/skills-pack.mjs`: the frontmatter reader and its exports.
- `scripts/lib/provenance-core.mjs`: the `skill-frontmatter` rule in `checkProvenance`.
- `scripts/check-provenance.mjs`: header comment lists the new rule; the failure hint covers a generated workflow skill.
- `skills-pack-src/README.md`, `CHANGELOG.md`, `.changeset/story-41-3-core-knowledge-skills.md`: docs and a minor changeset for `@iris-mcp/client-config`.
- `packages/iris-mcp-all/src/__tests__/agent-text-hygiene.ts` (new): the shared hygiene list and word counter, moved out of two siblings.
- `skills-pack-frontmatter.test.ts` (113 tests) and `skills-pack-knowledge.test.ts` (58 tests), both new.
- Count pins and fixtures moved in `pack-provenance`, `skills-pack`, `skills-pack-rule`, `story-41-1-qa-{pack-scratch-cli,pack-tarball,provenance-cli,validate-prompts-pack}` and `story-41-2-qa-rule-text-hygiene` tests; the 41.1 "CRLF with a BOM passes" row became a green CRLF row and a red BOM row (decision 4).

**Review.** 36 findings from four layers: high 0, medium 0, low 32, false 3, maybe-false 1. Patches applied (all low, 4 root causes): the `check-provenance.mjs` header and hint; the notice "0 provenance rows" pin now also asserts the header row and an empty `problems`; a skill-specific hygiene class for a project class or helper with two negative controls; mutation lines M13 to M16 and an M7 re-run. Deferred: none. Rejected: 29 rows, each with its reason in the triage log (spec-bound golden text, spec-defined overrides, omissions beyond the golden scope, three refuted claims).

**Follow-up review recommended:** `false`. Patched by verdict: high 0, medium 0, low 7 rows.

**Verification performed.**
- `shasum -a 256` of the three sources equals the golden values; ASCII, LF, 55 / 81 / 100 lines.
- `pnpm gen:pack` twice: unchanged tree digest; `gen:pack:check`: 19 pack files match. `pnpm validate:prompts`: 45 sources (12 prompts + 33 content files: 12 workflow, 17 pack, 3 knowledge, 1 rule). `pnpm check:provenance`: 0 provenance rows, 33 agent files, 8 distributions. `npm pack --dry-run` in `packages/client-config` lists the three `SKILL.md` files.
- Vitest: the nine listed files pass (401 tests) and the four `story-41-1-qa-*` files pass (118 tests), re-run after the review patches.
- `(once)` after the last patch: shared 2071, dev 1663, admin 498, interop 672, ops 350 and client-config 514 tests pass; the full `@iris-mcp/all` suite passes in three slices (38 + 38 + 37 = 113 files; 792 + 1047 + 696 tests, 4 skipped); `gen:skills:check` 13 files; `gen:governance-baseline:check` OK with 141 frozen keys; `gen:tools-list-snapshot:check` OK (115 entries); `check-epics-sync` OK; `bootstrap-classes.ts` has no diff.
- Mutations M1 to M16 each observed red and reverted (digest or sha256 equal afterwards); the lines are in `## Verification`.
- IRIS: no probe was written in this stage; `iris_doc_list` filter `Probe413` (generated included) on `server:"default"`, `namespace:"HSCUSTOM"` returns `[]`.

**Residual risks.**
- Golden-text over-claims, left as the spec has them because a fix edits the golden text and its sha256 (the lead's call, with a re-probe of the new claim):
  - the unit-tests description says "every Assert macro", yet `$$$AssertFilesSQLUnorderedSame` is not covered;
  - `ErrorMessage` "removes one prefix in any language" was run for en, es, fr and de only;
  - the error-handling skill does not say that `$$$ThrowStatus` with an OK status throws a spurious error, nor that `$$$QuitOnError` does not compile inside a loop;
  - the unit-tests skill does not say that `OnAfterOneTest` is not called after a failed or skipping `OnBeforeOneTest`.
- The new tests read the real `knowledge/` directory and rely on `fileParallelism: false` in `packages/iris-mcp-all/vitest.config.ts`; the CLI rows rely on a built `packages/client-config/dist`, as the 41.1 rows already did.
- The `deferred:` item in the frontmatter (`SanitizeError` localized prefixes) is the lead's to harvest; `src/ExecuteMCPv2/Utils.cls` is untouched.
