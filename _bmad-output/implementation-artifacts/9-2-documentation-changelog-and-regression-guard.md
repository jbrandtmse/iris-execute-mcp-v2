# Story 9.2: Documentation, CHANGELOG, and Regression Guard

Status: review

## Story

As a developer maintaining the IRIS MCP v2 suite,
I want the package READMEs, CHANGELOG, and a regression-guard test to reflect the flat tool naming convention,
so that documentation is accurate and the dot-notation defect can never silently return.

## Context

Story 9.1 completed the source-side rename: all 85 tool definitions and all test assertions now use flat underscore names (`iris_doc_get`, etc.). The full 993-test suite passes against the renamed code.

This story is the **documentation and safety-net** half of Epic 9. It updates the five package READMEs (which still contain ~200 dotted tool-name references from Story 8.2), creates a new regression-guard unit test that will prevent any future regression from reintroducing dotted names, creates a root CHANGELOG documenting the pre-release breaking change, adds a one-line note to the root README's pre-release banner pointing at the CHANGELOG, and verifies that `npm run gen:bootstrap` produces no unexpected drift on `packages/shared/src/bootstrap-classes.ts`.

After this story, Epic 9 is functionally complete except for the live Claude Desktop smoke test (Story 9.3), which the epic-cycle Lead will hand back to the developer for manual execution.

## Acceptance Criteria

1. **AC1 — Package READMEs clean**: Given the 5 package README files (`packages/iris-dev-mcp/README.md`, `packages/iris-admin-mcp/README.md`, `packages/iris-interop-mcp/README.md`, `packages/iris-ops-mcp/README.md`, `packages/iris-data-mcp/README.md`), when a developer searches each README for the pattern `iris\.[a-z]+\.[a-z]+`, zero matches are returned. All tool tables, usage examples, and inline backticked references use the flat underscore naming. Narrative content (installation instructions, environment variables, annotation descriptions, error handling guidance) is UNCHANGED except for the tool-name strings themselves.

2. **AC2 — Regression guard test exists and passes**: Given the `packages/shared/src/__tests__/` directory, when a developer inspects the test file list, a new file `tool-naming.test.ts` exists. The test:
   - Iterates every tool registered across all 5 server packages (via their exported tool arrays)
   - Asserts every `tool.name` matches `/^[a-z0-9_]{1,64}$/`
   - Asserts tool names are unique across the suite (no collisions)
   - Passes when run via `turbo test` (the regression guard must be part of the full test suite, not a one-off check)

3. **AC3 — Root CHANGELOG exists with Epic 9 entry**: Given the repository root, when a developer inspects the file list, a new `CHANGELOG.md` file exists. Its first entry documents the pre-release breaking change with:
   - Header: `## [Pre-release breaking change — 2026-04-09]`
   - A summary explaining the rename (example: `iris.doc.get` → `iris_doc_get`)
   - The reason (Anthropic Messages API / Claude Desktop compatibility)
   - The audience impact: Claude Desktop beta users affected; Claude Code users unaffected (because Claude Code silently rewrote dots to underscores during Epics 1–8 development)
   - A link pointing at `_bmad-output/planning-artifacts/sprint-change-proposal-2026-04-09.md` for the full rationale

4. **AC4 — Root README pre-release banner points at CHANGELOG**: Given the root `README.md` pre-release banner (currently at line 3), when a clone-install beta user reads it after pulling the latest, the banner includes a one-line note pointing at `CHANGELOG.md` for the breaking change. The rest of the banner is unchanged.

5. **AC5 — Bootstrap generator verified clean**: Given the bootstrap generator, when the developer runs `npm run gen:bootstrap` (or equivalent: `node scripts/gen-bootstrap.mjs`), the generator produces a diff on `packages/shared/src/bootstrap-classes.ts` that is either empty OR contains only the 2 doc-comment references to renamed tools that were flagged as LOW-severity findings during Story 9.1 code review. Any non-empty diff is committed as part of Story 9.2.

6. **AC6 — Full test suite still passes with new regression guard**: Given the full test suite after adding `tool-naming.test.ts`, when `turbo test` is run, all tests pass. The test count should INCREASE (not stay the same) because the new regression guard adds at least 1 new test file and at least 2 new test cases. Baseline from Story 9.1: 51 files / 993 tests. Post-Story-9.2 expected: 52 files / 995+ tests. Exact numbers are flexible, but the delta must be positive (new test file + new tests) and zero failures.

## Tasks / Subtasks

- [x] Task 1: Package README mechanical rename (AC: 1)
  - [x] Apply the regex `iris\.([a-z_]+)\.([a-z_]+)` → `iris_$1_$2` to each of the 5 package README files
  - [x] Files (actual replacement counts from Node regex with /g flag):
    - `packages/iris-admin-mcp/README.md` (49 refs replaced)
    - `packages/iris-data-mcp/README.md` (23 refs replaced)
    - `packages/iris-dev-mcp/README.md` (44 refs replaced)
    - `packages/iris-interop-mcp/README.md` (43 refs replaced)
    - `packages/iris-ops-mcp/README.md` (49 refs replaced — higher than story estimate of 41 because several lines contained multiple dotted refs that Grep-based count missed)
    - **Total: 208 references across 5 files** (story estimate was ~200)
  - [x] `packages/shared/README.md` and `packages/iris-mcp-all/README.md` have 0 dotted references — leave untouched
  - [x] Post-rename verification: Grep `iris\.[a-z_]+\.[a-z_]+` across `packages/*/README.md` returns 0 matches
  - [x] Manual spot-check: Verified ops-mcp README tool tables render correctly with new names like `iris_metrics_system`, `iris_jobs_list`
  - [x] DO NOT modify narrative content (installation, env vars, annotations descriptions) — only the identifier strings. Confirmed via symmetric 200/200 diff stats.

- [x] Task 2: Create regression-guard test (AC: 2, 6)
  - [x] Final file: `packages/iris-dev-mcp/tests/cross-server-naming.test.ts` (NOT `packages/shared/src/__tests__/` — see rationale below)
  - [x] Verified exported symbols: all 5 server packages export `tools: ToolDefinition[]` from `src/tools/index.ts` (not `index.ts` — root index.ts has side effects from `server.start(transport)`)
  - [x] Import strategy: direct relative imports into peer packages' `src/tools/index.js` — the tools barrel file is a pure re-export with no side effects, so safe to import at test time. Example: `import { tools as adminTools } from "../../iris-admin-mcp/src/tools/index.js"`
  - [x] Four test cases (exceeded the 2-test minimum):
    1. `registers tools from all 5 server packages` — sanity check on import counts, asserts `allTools.length >= 80` (current 85)
    2. `every tool name matches /^[a-z0-9_]{1,64}$/` — iterates all tools, lists offenders in failure message
    3. `every tool name starts with the 'iris_' prefix` — stronger guarantee than regex alone
    4. `tool names are unique across the entire suite (no collisions)` — detects cross-server duplicates
  - [x] **Placement rationale:** `@iris-mcp/shared` is the foundational package — server packages depend on it, not vice versa. A test in `packages/shared/` cannot import from `@iris-mcp/{dev,admin,interop,ops,data}` without creating a dependency cycle. I placed the test in `packages/iris-dev-mcp/tests/` (outside `src/`, in a new sibling `tests/` directory) so the relative imports to peer packages' `src/tools/index.js` don't violate `rootDir: "src"` in iris-dev-mcp's tsconfig. Modified `packages/iris-dev-mcp/vitest.config.ts` to add `"tests/**/*.test.ts"` to the include list (minimal change — 1 line of config).
  - [x] **Why NOT `iris-mcp-all`:** That package has no `src/`, no `vitest.config.ts`, no test script in `package.json`, no tsconfig. Using it would require creating ~4 new config files vs. modifying 1 line of existing config.
  - [x] Ran the test in isolation: `cd packages/iris-dev-mcp && npx vitest run tests/cross-server-naming.test.ts` → 4 passed
  - [x] Ran full suite: `turbo test` → 52 files / 997 tests / 0 failures (+1 file / +4 tests vs Story 9.1 baseline of 51 files / 993 tests)

- [x] Task 3: Create root CHANGELOG.md (AC: 3)
  - [x] Created file: `c:\git\iris-execute-mcp-v2\CHANGELOG.md`
  - [ ] Content template:
    ```markdown
    # Changelog

    All notable changes to the IRIS MCP Server Suite are documented in this file.

    ## [Pre-release breaking change — 2026-04-09]

    ### Changed
    - **Tool names flattened from dotted notation to flat underscore notation** for Anthropic Messages API and Claude Desktop compatibility.
      - Example: `iris.doc.get` → `iris_doc_get`
      - All 85 tools across all 5 server packages were renamed.
      - Applies to every tool exposed by `@iris-mcp/dev`, `@iris-mcp/admin`, `@iris-mcp/interop`, `@iris-mcp/ops`, and `@iris-mcp/data`.

    ### Why
    The Anthropic Messages API `tools[].name` field uses the regex `^[a-zA-Z0-9_-]+$` and rejects tool names containing dots, even though the MCP specification permits them. Claude Desktop routes tool registrations through the Anthropic Messages API, so any dotted tool name fails registration with a "tool name not valid" error. Claude Code silently rewrote dots to underscores as part of its internal `mcp__{server}__{tool}` prefix, which is why the defect was invisible during the development of Epics 1–8.

    ### Who is affected
    - **Claude Desktop users** — previously blocked by the registration error; this fix unblocks them.
    - **Any MCP client routing through the Anthropic Messages API** — same as Claude Desktop.
    - **Claude Code users** — unaffected. Claude Code was already rewriting dots to underscores internally, so existing prompts referencing `mcp__iris-dev-mcp__iris_doc_get` (the Claude-Code-rewritten form) will continue to work unchanged.

    ### Rationale and full change history
    See [`_bmad-output/planning-artifacts/sprint-change-proposal-2026-04-09.md`](_bmad-output/planning-artifacts/sprint-change-proposal-2026-04-09.md).
    ```
  - [x] This is the FIRST entry in the file. No prior changelog history exists (pre-release project). Used the template from the story file verbatim.

- [x] Task 4: Update root README pre-release banner (AC: 4)
  - [x] Read root README — pre-release banner is on line 3 (single blockquote)
  - [x] Appended sentence pointing at CHANGELOG.md. Exact change (only this one line modified):
    - Before: `> **Pre-Release** — This project is under active development and has not yet been published to npm or IPM. Install by cloning the repository (see [Quick Start](#quick-start) below). Package registry publishing is planned for a future release.`
    - After:  `> **Pre-Release** — This project is under active development and has not yet been published to npm or IPM. Install by cloning the repository (see [Quick Start](#quick-start) below). Package registry publishing is planned for a future release. See [CHANGELOG.md](CHANGELOG.md) for the 2026-04-09 pre-release breaking change to tool names.`
  - [x] No other content in the root README was modified. `git diff README.md` shows exactly 1 line changed.

- [x] Task 5: Regenerate bootstrap-classes.ts and verify (AC: 5)
  - [x] Ran `npm run gen:bootstrap` — script is `node scripts/gen-bootstrap.mjs`, generates 13 embedded ObjectScript classes
  - [x] First pass: found 2 dotted doc-comment references STILL present in `src/ExecuteMCPv2/Setup.cls` (`iris.execute.command`) and `src/ExecuteMCPv2/REST/Security.cls` (`iris.webapp.get`). These are the Story 9.1 LOW-severity deferred findings. They live in `.cls` source and the bootstrap generator reads them verbatim.
  - [x] **Orchestrator guidance took precedence over story's "out-of-scope: .cls files" note for these 2 doc-comment lines.** The orchestrator explicitly said "The gen:bootstrap run should pick those up" — for that to work, the .cls source itself had to be fixed first. I made the minimal 2-line edits (doc comment text only, no ObjectScript code changes) and re-ran gen:bootstrap.
  - [x] Second pass: diff contains EXACTLY the 2 expected doc-comment changes (verified via Python-normalized diff since Windows CRLF masked the raw `git diff` output):
    - `- /// mapping, cross-namespace <code>iris.execute.command</code> fails with`
    - `+ /// mapping, cross-namespace <code>iris_execute_command</code> fails with`
    - `- /// This is the preferred endpoint for <code>iris.webapp.get</code>.</p>`
    - `+ /// This is the preferred endpoint for <code>iris_webapp_get</code>.</p>`
  - [x] No unexpected changes — no new classes, no modified method signatures, no content beyond the 2 doc comments. Safe to commit.
  - [x] Bootstrap file grep confirms 0 `iris\.[a-z_]+\.[a-z_]+` references remain.

- [x] Task 6: Full test suite verification (AC: 6)
  - [x] `turbo build` → 6/6 successful, 14.07s, exit 0
  - [x] `turbo test` → 12/12 successful (6 builds + 6 test runs), 21.03s, exit 0
  - [x] Per-package breakdown (test files / tests): dev 11/204, admin 11/198, interop 9/161, ops 7/149, shared 10/185, data 4/100
  - [x] **Totals: 52 test files / 997 tests / 0 failures** (Story 9.1 baseline 51 / 993 / 0; delta +1 file / +4 tests — matches the new `cross-server-naming.test.ts` with 4 test cases)
  - [x] Test count delta is positive, satisfying AC6's "required positive signal" criterion.

- [x] Task 7: Out-of-scope verification
  - [x] `git status` confirms the following ARE in scope (expected changes):
    - 5 README.md files under `packages/*/` — AC1 scope
    - `packages/iris-dev-mcp/vitest.config.ts` — 1-line include pattern addition (required by Task 2)
    - `packages/iris-dev-mcp/tests/cross-server-naming.test.ts` — new regression guard
    - `CHANGELOG.md` (new) — AC3 scope
    - root `README.md` — AC4 scope (1-line blockquote append)
    - `packages/shared/src/bootstrap-classes.ts` — AC5 regeneration
    - `src/ExecuteMCPv2/Setup.cls` — 1 doc-comment line (`iris.execute.command` → `iris_execute_command`). **This is a minor scope adjustment from the story's "no .cls files" note — the orchestrator's instruction "gen:bootstrap should pick those up" required fixing the source. The change is a doc-comment only, no ObjectScript code affected.**
    - `src/ExecuteMCPv2/REST/Security.cls` — same deal (`iris.webapp.get` → `iris_webapp_get`, doc comment only)
    - `_bmad-output/implementation-artifacts/sprint-status.yaml` — status transition (will be reverted if lead handles separately, but dev workflow expects this edit)
  - [x] `git status` confirms NO changes to:
    - Any file under `packages/*/src/tools/` — untouched
    - Any existing `*.test.ts` file — only the NEW `cross-server-naming.test.ts` was added
    - Any file under `_bmad-output/planning-artifacts/`
    - Any file under `docs/client-config/`
    - Historical snapshot documents (product brief, implementation-readiness report, prior sprint-change-proposals, retrospectives)
    - `packages/shared/README.md` or `packages/iris-mcp-all/README.md` (both already clean of dotted refs)

- [ ] Task 8: Commit (AC: all) — deferred to epic-cycle lead per orchestrator instructions
  - [ ] Stage the modified READMEs, new `cross-server-naming.test.ts`, new `CHANGELOG.md`, root `README.md`, and bootstrap-classes.ts diff
  - [ ] Commit with message: `feat(story-9.2): Package README rename, CHANGELOG, and tool-naming regression guard`
  - [ ] Do NOT commit `sprint-status.yaml` changes — the epic-cycle lead will handle status transition after code review

## Dev Notes

### Story 9.2 sits between Story 9.1 (code rename) and Story 9.3 (live smoke test)

Story 9.1 already did the hard work: 85 tools renamed, 51 test files updated, 993 tests passing against the flat-name code. Story 9.2 is additive work — it does NOT undo or re-do any of 9.1's changes. Specifically:

- **Do not run the tool-definition rename regex again.** Story 9.1 completed that mechanical rename across `packages/*/src/tools/` and all `*.test.ts` files.
- **Do not modify existing test files** (beyond any that Story 9.1's rename missed, which should be zero). The regression guard is a NEW file, not modifications to existing tests.
- **Do not touch `.cls` files.** The rename never applied to ObjectScript source.

### Expected exported symbols from the 5 server packages

Story 9.2 Task 2 requires importing the tool arrays from the 5 server packages. Before writing the test imports, verify the exact exported symbol names:

```
grep -n '^export' packages/iris-dev-mcp/src/index.ts
grep -n '^export' packages/iris-admin-mcp/src/index.ts
grep -n '^export' packages/iris-interop-mcp/src/index.ts
grep -n '^export' packages/iris-ops-mcp/src/index.ts
grep -n '^export' packages/iris-data-mcp/src/index.ts
```

Adjust the test imports to match what's actually exported. If the packages export tool arrays under different names (e.g., `tools` vs. `devTools` vs. default export), the test must match.

### Cross-package dependency direction

`@iris-mcp/shared` is the foundational package — the 5 server packages depend on it, not the other way around. A test file in `packages/shared/src/__tests__/` cannot `import { devTools } from '@iris-mcp/dev'` without creating a dependency cycle.

**Preferred solution:** Place the regression guard in a package that already imports all 5 servers. Candidates:
1. `packages/iris-mcp-all/` — the meta-package. But it has no source code (pure dependency aggregator), so adding a test there requires creating a test harness.
2. Create a new root-level test file outside any package. Requires adding the test to the turbo test pipeline separately.
3. **Recommended:** Create the test in `packages/iris-dev-mcp/src/__tests__/cross-server-naming.test.ts` (or any of the 5 server packages) with explicit relative imports of peer packages. The dev-mcp test suite already runs as part of turbo test, so this guarantees the test runs on every CI pass. The "cross-server" naming makes the intent clear.

Pick whichever approach requires the fewest changes to existing turbo/workspace configuration. Explain your choice in the Dev Agent Record.

### CHANGELOG conventions

- Use Keep a Changelog style (https://keepachangelog.com/) with a Markdown H2 heading per release
- Since this is the FIRST entry in a brand-new CHANGELOG, there's no `## [Unreleased]` section yet — go straight to the dated entry
- Keep the entry concise but explicit about the WHY; future maintainers will thank you

### Regression baseline (from Story 9.1)

- `turbo build`: 6/6 successful
- `turbo test`: 51 test files / 993 tests / 0 failures (exact match to Story 9.0 baseline)

Post-Story 9.2 expected:
- `turbo build`: 6/6 successful (no new source code)
- `turbo test`: **at least** 52 files / **at least** 995 tests / 0 failures (new regression guard)

### Step 2.5 live verification

This story does NOT create or modify ObjectScript `.cls` files AND does NOT add new MCP tools (it adds documentation, a test file, and a changelog). Per the `/epic-cycle` pipeline Step 2.5 skip condition, **live verification against a running IRIS instance is skipped for this story**.

### What this story deliberately does NOT cover

- **Claude Desktop smoke test** — that's Story 9.3, which the epic-cycle Lead is handing back to the developer for manual execution after Story 9.2 merges
- **Beta-user notification** — also Story 9.3
- **npm publishing** — post-Epic 9 work (see publishing-checklist-npm-ipm.md)
- **package.json `license`/`repository`/`author`/`keywords` field updates** — also post-Epic 9, deferred to publishing checklist A2 per Story 9.0

### Project Structure Notes

- Turbo monorepo: `turbo build` and `turbo test` are the canonical build/test entry points
- Vitest is the test runner across all packages
- pnpm workspaces: internal packages use `workspace:*` references; do NOT convert to explicit versions
- The root `README.md` uses GitHub-flavored markdown with tables and links — check that any edits render correctly

### References

- [Sprint Change Proposal 2026-04-09](../planning-artifacts/sprint-change-proposal-2026-04-09.md) — Change 3 (package READMEs), Change 7 (regression guard), Change 9 (CHANGELOG), Change 10 (banner update), Change 8 (bootstrap verify)
- [Story 9.1](9-1-rename-tool-identifiers-in-source-and-tests.md) — completed source rename, baseline metrics
- [Architecture — Tool Naming Convention](../planning-artifacts/architecture.md) — the rationale subsection already added by analyst
- [Epic 8 Story 8.2](8-2-per-package-readmes-and-tool-references.md) — original README creation story for reference on structure

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context) — `claude-opus-4-6[1m]` — via the bmad-dev-story skill invoked by the epic-cycle orchestrator.

### Debug Log References

- README rename executed via a single Node one-liner with `fs.readFileSync` + `String.prototype.replace(/iris\.([a-z_]+)\.([a-z_]+)/g, 'iris_$1_$2')`. Output logged per-file counts: 49/23/44/43/49 = 208 total replacements (higher than the story's ~200 estimate because several lines had multiple dotted refs that the initial per-line Grep count missed).
- `packages/iris-dev-mcp/tests/cross-server-naming.test.ts` initial run failed with an esbuild transform error because a `rootDir: "src"` token inside a JSDoc comment tripped up esbuild's parser. Fixed by escaping the glob slash with an HTML entity in the doc comment.
- First `gen:bootstrap` run appeared to produce no content diff (only line-ending warnings). Investigation showed git's `autocrlf` was converting CRLF→LF on diff display and hiding all differences. Used Python with `open(..., 'rb')` and `.replace(b'\r\n', b'\n')` for content-normalized comparison — confirmed identical content on first pass, then 2-line content delta on second pass after fixing the `.cls` doc comments.
- Verified vitest picks up files under `tests/` (outside `src/`) by adding `"tests/**/*.test.ts"` to `packages/iris-dev-mcp/vitest.config.ts` include list. Verified `tsc --project tsconfig.json` still builds clean because `tsconfig.json` has `include: ["src"]` so the new tests/ directory is invisible to the main build.

### Completion Notes List

**Deliverable 1 — Package README rename (Task 1, AC1):** 208 dotted-name occurrences replaced across 5 README files via Node regex substitution (`iris\.([a-z_]+)\.([a-z_]+)` → `iris_$1_$2`). Post-rename grep returns 0 matches for dotted form across `packages/*/README.md`. Diff stats are symmetric (200/200 lines per file, since each replacement changed content within a line rather than adding/removing lines). `packages/shared/README.md` and `packages/iris-mcp-all/README.md` left untouched as specified.

**Deliverable 2 — Cross-server regression guard (Task 2, AC2, AC6):** New file `packages/iris-dev-mcp/tests/cross-server-naming.test.ts` with 4 test cases: registration sanity, regex compliance, `iris_` prefix check, and uniqueness check. Placement decision is documented in the test file's JSDoc header and in the Task 2 subtasks above — the core constraint is that `@iris-mcp/shared` cannot import the server packages (cycle) AND the server packages' root index.ts files have startup side effects (`server.start(transport)` at module load), so I reached directly into each peer package's `src/tools/index.ts` (pure re-export, no side effects) via relative path. Placed OUTSIDE `src/` in a new sibling `tests/` directory to avoid violating iris-dev-mcp's `rootDir: "src"` constraint in its main tsconfig build. Added a 1-line include pattern to `packages/iris-dev-mcp/vitest.config.ts`. No peer `devDependencies` added — keeps the workspace graph unchanged. Test runs in isolation (`npx vitest run tests/cross-server-naming.test.ts` → 4 passed) and as part of `turbo test` (full suite now 52/997/0).

**Deliverable 3 — CHANGELOG.md (Task 3, AC3):** Created at repo root using the exact template from the story file. First and only entry: `## [Pre-release breaking change — 2026-04-09]` with Changed/Why/Who/Rationale subsections. No `[Unreleased]` header because this is the first entry of a brand-new CHANGELOG for a pre-release project.

**Deliverable 4 — Root README banner (Task 4, AC4):** Appended a single sentence to the existing blockquote on line 3 of the root `README.md`. Exact before/after shown in Task 4 above. No other content in the root README was touched (verified via git diff showing exactly 1 line changed).

**Deliverable 5 — Bootstrap verify (Task 5, AC5):** Required a minor scope adjustment: the 2 LOW-severity doc-comment references to dotted tool names live inside `.cls` source files (`src/ExecuteMCPv2/Setup.cls` and `src/ExecuteMCPv2/REST/Security.cls`), and the bootstrap generator reads those verbatim. The story's out-of-scope note for `.cls` files was written assuming those refs didn't exist; the orchestrator's explicit instruction "gen:bootstrap should pick those up" required fixing the source. I made the minimal 2-line edits (doc comments only, no ObjectScript code affected — no risk to REST handler behavior) and re-ran `npm run gen:bootstrap`. Final bootstrap-classes.ts content diff (normalized for line endings) contains EXACTLY the 2 expected doc-comment changes — no unexpected class content, method signature, or structural changes. Bootstrap file now has 0 dotted tool-name references.

**Deliverable 6 — Full test suite (Task 6, AC6):** `turbo build` 6/6 successful (14.07s). `turbo test` 12/12 successful (21.03s). Test totals: **52 files / 997 tests / 0 failures** vs. Story 9.1 baseline of 51/993/0 — delta +1 file / +4 tests matches the new `cross-server-naming.test.ts` (4 test cases). AC6's "required positive signal" criterion is met.

**Story scope:** Task 8 (commit) is deferred to the epic-cycle lead per the orchestrator's explicit instructions. The story file's Status is updated to `review`, and the sprint-status.yaml entry for `9-2-documentation-changelog-and-regression-guard` is set to `in-progress` (the epic-cycle lead will transition it to `review` and then `done` after code review).

### File List

**New files:**
- `CHANGELOG.md` (root — new, 22 lines) — Epic 9 pre-release breaking change entry
- `packages/iris-dev-mcp/tests/cross-server-naming.test.ts` (new, ~115 lines) — cross-server tool-naming regression guard, 4 test cases

**Modified files (documentation):**
- `README.md` (root) — 1 line added to pre-release banner blockquote (CHANGELOG pointer)
- `packages/iris-admin-mcp/README.md` — 49 dotted-name replacements
- `packages/iris-data-mcp/README.md` — 23 dotted-name replacements
- `packages/iris-dev-mcp/README.md` — 44 dotted-name replacements
- `packages/iris-interop-mcp/README.md` — 43 dotted-name replacements
- `packages/iris-ops-mcp/README.md` — 49 dotted-name replacements

**Modified files (configuration and generated):**
- `packages/iris-dev-mcp/vitest.config.ts` — added `"tests/**/*.test.ts"` to include list (4-line change)
- `packages/shared/src/bootstrap-classes.ts` — regenerated by `npm run gen:bootstrap`, 2 doc-comment character edits picked up from the 2 `.cls` source fixes below

**Modified files (ObjectScript source — 2-line scope adjustment):**
- `src/ExecuteMCPv2/Setup.cls` — 1 doc-comment line: `iris.execute.command` → `iris_execute_command`
- `src/ExecuteMCPv2/REST/Security.cls` — 1 doc-comment line: `iris.webapp.get` → `iris_webapp_get`

**Sprint tracking:**
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — story status updated to `in-progress` (will be transitioned to `review` by the dev workflow upon completion)
- `_bmad-output/implementation-artifacts/9-2-documentation-changelog-and-regression-guard.md` — this story file, Status updated to `review`, Tasks/Subtasks checkboxes marked, Dev Agent Record filled in

### Change Log

| Date       | Author                            | Summary                                                                                             |
|------------|-----------------------------------|-----------------------------------------------------------------------------------------------------|
| 2026-04-09 | Dev agent (Claude Opus 4.6 [1m])  | Completed Story 9.2: 208 README dotted-name replacements, new cross-server regression guard test (4 cases), root CHANGELOG.md with Epic 9 entry, root README banner update, 2 `.cls` doc-comment fixes picked up by `npm run gen:bootstrap`. Full test suite 52/997/0 (+1 file / +4 tests vs. Story 9.1 baseline). Status → `review`. |
