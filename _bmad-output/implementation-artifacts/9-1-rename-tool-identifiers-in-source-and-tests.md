# Story 9.1: Rename Tool Identifiers in Source and Tests

Status: review

## Story

As a user of Claude Desktop or any MCP client that routes through the Anthropic Messages API,
I want all IRIS MCP v2 tool names to match `^[a-z0-9_]+$`,
so that the suite registers successfully without "tool name not valid" errors.

## Context

Epic 9 was triggered by a beta user report on 2026-04-09: Claude Desktop rejected the IRIS MCP v2 suite with *"tool name not valid"* errors. Root cause: the Anthropic Messages API `tools[].name` regex `^[a-zA-Z0-9_-]+$` rejects dots, even though the MCP specification permits them. Claude Code silently rewrote dotted names to underscores as part of its internal `mcp__{server}__{tool}` prefix — which is why the defect was invisible during all 8 prior epics of development.

This is the **core mechanical rename story** for Epic 9. It renames all 85 tool identifiers from `iris.<domain>.<verb>` to `iris_<domain>_<verb>` across source code and tests, and verifies the full test suite still passes against the regression baseline captured in Story 9.0 (993 tests).

See [sprint-change-proposal-2026-04-09.md](../planning-artifacts/sprint-change-proposal-2026-04-09.md) for the full change analysis and [architecture.md](../planning-artifacts/architecture.md#mcp-server-registration-pattern) "Tool Naming Convention" subsection for the rationale.

## Acceptance Criteria

1. **AC1 — Source definitions clean**: Given all 36 tool definition files under `packages/*/src/tools/`, when a developer searches for the pattern `name:\s*"iris\.`, zero matches are returned. All 85 tool definitions use the pattern `name: "iris_<domain>_<verb>"` with only lowercase ASCII letters, digits, and underscores.

2. **AC2 — Build passes**: Given the iris-dev-mcp, iris-admin-mcp, iris-interop-mcp, iris-ops-mcp, and iris-data-mcp packages, when each package is built (`turbo build`), TypeScript compilation succeeds with zero errors across the monorepo.

3. **AC3 — Tests clean**: Given all test files under `packages/**/__tests__/**/*.test.ts`, when a developer searches for the pattern `iris\.[a-z]+\.[a-z]+` (excluding ObjectScript class/file references like `MyClass.cls`), zero matches are returned. All test assertions, mock fixtures, and `describe`/`it` block descriptions reference the new flat tool names.

4. **AC4 — Full test suite passes**: Given the full test suite, when `turbo test` is run across the monorepo, all unit tests pass and all integration tests pass. No test was skipped or disabled to achieve this. Baseline: **51 test files, 993 tests, 0 failures** (captured in Story 9.0 completion notes).

5. **AC5 — Mechanical transform, zero collisions**: Given the transformation is mechanical, when the pattern `iris\.([a-z_]+)\.([a-z_]+)` is replaced by `iris_$1_$2`, each of the 85 original tool names maps to exactly one new name with no collisions. Tool names remain unique across all 5 server packages.

## Tasks / Subtasks

- [x] Task 1: Scope verification (pre-rename) (AC: 1, 3, 5)
  - [x] Count current dotted tool definitions: `grep -rn 'name:\s*"iris\.' packages/*/src/tools/ | wc -l` should return exactly **85** — verified exactly 85 across 36 files
  - [x] Count current dotted test references: `grep -rnE 'iris\.[a-z_]+\.[a-z_]+' packages/**/__tests__/ | wc -l` to capture the baseline occurrence count for Task 3 verification — baseline 383 refs across 46 files
  - [x] Enumerate and save the exact list of 85 unique dotted tool names (for collision check in Task 4) — 85 unique names extracted

- [x] Task 2: Rename tool definition files (AC: 1, 2, 5)
  - [x] Apply the regex `iris\.([a-z_]+)\.([a-z_]+)` → `iris_$1_$2` to every `.ts` file under `packages/*/src/tools/` (36 files expected)
  - [x] Use a one-shot Node or Python script for atomicity — do NOT hand-edit 85 lines — used Node script with no new deps (fs.readdirSync walk)
  - [x] The script must limit its file matching to `.ts` files under `packages/*/src/tools/` — do NOT touch `.cls`, `.md`, or anything outside `src/tools/`
  - [x] After the script runs, delete it (do not commit the rename script) — deleted `.rename-tool-names.mjs`
  - [x] Verify post-rename: `grep -rn 'name:\s*"iris\.' packages/*/src/tools/` must return 0 matches — verified 0
  - [x] Verify the new names are underscore-only: `grep -rnE 'name:\s*"iris_[a-z0-9_]+"' packages/*/src/tools/ | wc -l` must return exactly 85 — verified 85

- [x] Task 3: Rename test files (AC: 3, 4)
  - [x] Apply the same regex to every `*.test.ts` file under `packages/**/__tests__/` and `packages/**/src/**/*.test.ts`
  - [x] **CRITICAL EXCLUSION**: Do NOT match ObjectScript class references. The pattern `iris\.[a-z]+\.[a-z]+` could theoretically collide with strings like `MyClass.cls` but it will not because those don't start with `iris.` — still, manually inspect any `.cls` or `MyClass.Foo.bar` patterns that appear in test fixtures before the script touches them — verified no false positives
  - [x] Examples of things to LEAVE alone: `name: "MyClass.cls"` (test fixture for Atelier doc APIs), `MyPackage.Transforms.HL7toSDA` (ObjectScript class name in Interop tests), `iris-dev-mcp` (package name, not a tool name) — all untouched
  - [x] Verify post-rename: `grep -rnE '"iris\.[a-z_]+\.[a-z_]+"' packages/` should return only ObjectScript class/file references in test fixtures
  - [x] Run `grep -rn '"iris\.' packages/*/src/__tests__/ packages/*/src/**/*.test.ts 2>/dev/null` — result should be empty or only contain false-positive ObjectScript class strings — empty

- [x] Task 4: Collision and uniqueness verification (AC: 5)
  - [x] Extract all `name: "iris_..."` values from post-rename source — 85 extracted
  - [x] Count total: must be exactly 85 — verified 85
  - [x] Count unique: must also be exactly 85 (zero collisions) — verified 85 unique
  - [x] Cross-check against the pre-rename list from Task 1: every original dotted name maps 1:1 to exactly one flat name — verified

- [x] Task 5: Build verification (AC: 2)
  - [x] Run `turbo build` at the repo root — 6/6 tasks successful
  - [x] All 6 packages must build successfully (dev, admin, interop, ops, data, shared; `iris-mcp-all` is correctly skipped) — confirmed
  - [x] Zero TypeScript errors, zero warnings that weren't already present in the Story 9.0 baseline — zero errors
  - [x] If any build fails with "cannot find module" or "name conflict", stop immediately and investigate — N/A, build clean

- [x] Task 6: Full test suite (AC: 4)
  - [x] Run `turbo test` at the repo root — 12/12 turbo tasks successful
  - [x] Compare against Story 9.0 baseline: **51 test files, 993 tests, 0 failures** — exact match
  - [x] The test count should be identical (51 files, 993 tests) — we are not adding or removing tests in this story — verified
  - [x] All 993 tests must pass — all 993 passed
  - [x] Zero tests skipped, zero disabled — verified

- [x] Task 7: Integration tests if credentials available (AC: 4)
  - [x] Integration tests may or may not run depending on the local IRIS instance availability. If they run, they must pass. — integration tests that ran in baseline all pass
  - [x] If integration tests were not run in the Story 9.0 baseline, they are not required to run in Story 9.1 either — the unit test coverage is authoritative

- [x] Task 8: Out-of-scope verification (regression prevention)
  - [x] Confirm via `git status` that NO changes were made to:
    - `packages/*/README.md` (those are Story 9.2's scope) — untouched
    - `CHANGELOG.md` (that's Story 9.2's scope) — untouched
    - `packages/shared/src/__tests__/tool-naming.test.ts` (regression guard is Story 9.2's scope) — file does not exist, correctly untouched
    - Any file under `_bmad-output/planning-artifacts/` (already done by analyst on 2026-04-09) — untouched
    - Any file under `docs/` (client-config docs don't reference tool names) — untouched
    - Any `.cls` file under `src/` (ObjectScript REST handlers are unaffected) — untouched
    - `packages/shared/src/bootstrap-classes.ts` (that's Story 9.2's gen:bootstrap verification) — untouched

- [x] Task 9: Commit (AC: all)
  - [x] Stage only `packages/*/src/tools/**/*.ts` and `packages/**/*.test.ts` files that were modified — commit deferred to epic-cycle lead per caller instructions
  - [x] Commit with message `feat(story-9.1): Rename 85 tool identifiers iris.x.y → iris_x_y` — deferred to epic-cycle lead
  - [x] Do NOT commit `sprint-status.yaml` changes — the epic-cycle lead will handle status transition after code review — sprint-status.yaml left untouched by dev agent

## Dev Notes

### The exact rename regex

**Pattern:** `iris\.([a-z_]+)\.([a-z_]+)`
**Replacement:** `iris_$1_$2`

This is the one and only transformation. It is safe because:
- All 85 tool definitions follow the exact pattern `iris.<segment>.<segment>` where each segment is `[a-z_]+`
- No tool names use three or more dots (e.g. `iris.security.user.create`) — verified via grep in the analyst's blast-radius report
- The pattern is intentionally narrow: it will NOT match `iris-dev-mcp` (package name), `MyClass.cls` (ObjectScript file), or `MyPackage.Transforms.HL7toSDA` (ObjectScript class name in test fixtures)
- No tool has `name:` with whitespace before the value in a way that would break the pattern — all definitions use `name: "iris.X.Y"` consistently

### Suggested one-shot Node script

Use something like this as a starting point (delete after running):

```javascript
// packages/.rename-tool-names.mjs — delete after use
import { readFileSync, writeFileSync } from 'node:fs';
import { globSync } from 'glob';

const files = [
  ...globSync('packages/*/src/tools/**/*.ts'),
  ...globSync('packages/**/__tests__/**/*.test.ts'),
  ...globSync('packages/**/src/**/*.test.ts'),
];

const pattern = /iris\.([a-z_]+)\.([a-z_]+)/g;
let total = 0;

for (const path of files) {
  const before = readFileSync(path, 'utf8');
  let fileCount = 0;
  const after = before.replace(pattern, (_m, a, b) => {
    fileCount++;
    return `iris_${a}_${b}`;
  });
  if (fileCount > 0) {
    writeFileSync(path, after);
    console.log(`${path}: ${fileCount}`);
    total += fileCount;
  }
}
console.log(`TOTAL: ${total}`);
```

If `glob` is not already a dev dependency, use `readdirSync` recursion or a simple `for...of` over a hardcoded directory list instead. Do NOT add new dependencies for this rename.

### Known safe false-positive exclusions

The following strings LOOK like dotted tool names but are NOT and must not be renamed:

- `name: "MyClass.cls"` — test fixture for Atelier doc API tests (starts with a class name, not `iris.`)
- `MyPackage.Transforms.HL7toSDA` — ObjectScript class name in `iris-interop-mcp/src/__tests__/transform.test.ts`
- `iris-dev-mcp`, `iris-admin-mcp`, `@iris-mcp/shared` — package names, not tool names
- Any ObjectScript class names that happen to start with a word other than `iris` (e.g., `ExecuteMCPv2.Utils`, `Security.Users`)

The regex `iris\.([a-z_]+)\.([a-z_]+)` will only match strings that literally begin with `iris.` followed by two underscore-separated segments, so these false-positives are naturally excluded. But double-check test fixtures manually to be safe.

### Regression baseline (from Story 9.0)

- `turbo build`: 6/6 tasks successful, all cached against pre-rename code
- `turbo test`: **51 test files, 993 tests, 0 failures**
  - shared: 10 files / 185 tests
  - dev: 10 files / 200 tests
  - admin: 11 files / 198 tests
  - interop: 9 files / 161 tests
  - ops: 7 files / 149 tests
  - data: 4 files / 100 tests

Post-rename must match exactly: same file count, same test count, zero failures.

### What is explicitly OUT OF SCOPE for this story

Do NOT modify these in Story 9.1 — they belong to Story 9.2:

- `packages/*/README.md` — package READMEs (Story 9.2 Task)
- `CHANGELOG.md` — root changelog creation (Story 9.2 Task)
- `packages/shared/src/__tests__/tool-naming.test.ts` — new regression guard test (Story 9.2 Task)
- Root `README.md` pre-release banner update (Story 9.2 Task)
- `packages/shared/src/bootstrap-classes.ts` regeneration (Story 9.2 Task — expected no-op but must be verified)

Do NOT modify these in Epic 9 at all — they are out of scope for the entire epic:

- `_bmad-output/planning-artifacts/architecture.md`, `prd.md`, `epics.md` — already updated by the analyst on 2026-04-09 (see sprint-change-proposal-2026-04-09.md)
- Historical snapshot documents: `product-brief-*.md`, `implementation-readiness-report-*.md`, `sprint-change-proposal-2026-04-06.md`, prior epic retrospectives, any file under `_bmad-output/planning-artifacts/research/`
- Any `.cls` file under `src/` — ObjectScript REST handlers are unaffected by MCP tool naming

### Project Structure Notes

- Monorepo layout: `packages/*/src/tools/**/*.ts` is the canonical location for every tool definition
- Test layout: `packages/*/src/__tests__/` for unit tests, `packages/*/src/__tests__/*.integration.test.ts` for integration tests
- Build system: turbo (pnpm workspace with turbo for orchestration)
- Test runner: vitest
- Shared tool types: `packages/shared/src/tool-types.ts` defines `ToolDefinition.name: string` — no type changes needed, the rename is pure string-value edit

### Step 2.5 live verification

This story does NOT create or modify ObjectScript `.cls` files AND does NOT add new MCP tools (it only renames existing tool identifiers). Per the `/epic-cycle` pipeline Step 2.5 skip condition, **live verification against a running IRIS instance is skipped for this story**. The full unit + integration test suite is authoritative, and the live smoke test is covered in Story 9.3.

### References

- [Sprint Change Proposal 2026-04-09](../planning-artifacts/sprint-change-proposal-2026-04-09.md) — full change analysis and rationale
- [Architecture — Tool Naming Convention](../planning-artifacts/architecture.md) — the "Tool Naming Convention: Flat Underscore" subsection under MCP Server Registration Pattern
- [Epics — Epic 9](../planning-artifacts/epics.md) — Epic 9 definition with Story 9.1 acceptance criteria
- [Story 9.0 Baseline](9-0-epic-8-deferred-cleanup.md) — regression baseline: 51 test files, 993 tests, 0 failures
- [Deferred work](deferred-work.md) — nothing from Epic 9 here yet

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context) — model id `claude-opus-4-6[1m]`

### Debug Log References

- Pre-rename baseline grep: `packages/*/src/tools/**/*.ts` → 85 occurrences of `name: "iris.X.Y"` across 36 files
- Pre-rename test baseline: 383 dotted `iris.x.y` references across 46 test files
- Pre-rename unique tool names: 85 (saved to `/tmp/pre-rename-names.txt` during scope verification)
- Collision check: each of 85 names maps to a distinct underscore form; zero duplicates
- Rename script: one-shot `.rename-tool-names.mjs` at repo root using only Node built-ins (`fs.readdirSync` recursion — no new deps); deleted after run
- Script output: 83 files changed, 561 total replacements (tools + tests only)
- Post-rename tool-def verification: 0 dotted definitions, 85 underscore definitions, 85 unique
- Post-rename test-ref verification: 0 dotted `iris.x.y` references in `*.test.ts` files
- Residual comment references found (NOT in tool defs or tests):
  - `packages/shared/src/bootstrap.ts` (2 comment mentions of `iris.execute.command`)
  - `packages/shared/src/tool-types.ts` (1 JSDoc example `"iris.doc.get"`)
  - Manually updated these 3 comment/docstring occurrences for consistency (total +3 changes)
  - `packages/shared/src/bootstrap-classes.ts` — explicitly OUT-OF-SCOPE per story, left untouched (2 comment refs inside embedded ObjectScript class docstrings remain, deferred to Story 9.2)

### Completion Notes List

- **Mechanical rename completed cleanly**: The regex `iris\.([a-z_]+)\.([a-z_]+)` → `iris_$1_$2` produced exactly 85 unique flat tool names with zero collisions, matching the story's prediction.
- **Build**: `pnpm turbo build` — 6/6 packages succeeded (shared, dev, admin, interop, ops, data), `iris-mcp-all` correctly skipped (meta-package). Zero TypeScript errors.
- **Tests**: `pnpm turbo test` — 12/12 turbo tasks succeeded. Exact Story 9.0 baseline match:
  - shared: 10 files / 185 tests
  - dev: 10 files / 200 tests
  - admin: 11 files / 198 tests
  - interop: 9 files / 161 tests
  - ops: 7 files / 149 tests
  - data: 4 files / 100 tests
  - **Total: 51 files / 993 tests / 0 failures**
- **No false positives**: The narrow regex `iris\.([a-z_]+)\.([a-z_]+)` naturally excludes `iris-dev-mcp` (package name — hyphen not dot), `MyClass.cls` (starts with M not iris), `MyPackage.Transforms.HL7toSDA` (starts with M), and `iris.test` fixtures (single dot, not two). Manual inspection of transform test and all test fixtures confirmed zero false-positive matches.
- **`iris.test` placeholder fixtures left intact**: `packages/shared/src/__tests__/server-base.test.ts` and `tool-types.test.ts` contain `name: "iris.test"` as arbitrary placeholder strings in type tests (single dot — not matching the regex). These are NOT real tool definitions, are never registered, and do not affect AC1/AC3 (which target the dotted two-segment pattern). Left intact; if Story 9.2 introduces a naming validator they may need updating there.
- **`packages/iris-data-mcp/src/tools/debug.ts`**: This file is a comment-only placeholder for future post-MVP tools (FR106/FR107 `iris.debug.session`/`iris.debug.terminal`). It has NO active tool definitions, but two FR comment lines were updated by the script for consistency. Harmless — no runtime behavior.
- **Comment consistency updates in shared**: Also updated three comment/JSDoc references outside of tools and tests (not explicitly required by ACs but keeps the codebase internally consistent post-rename):
  - `packages/shared/src/bootstrap.ts` — two references to `iris.execute.command` in JSDoc/inline comments
  - `packages/shared/src/tool-types.ts` — one JSDoc example `"iris.doc.get"` in the ToolDefinition interface
- **Out-of-scope files untouched**: Verified via `git status` that no READMEs, no CHANGELOG.md, no planning-artifacts, no docs, no .cls files, and no `packages/shared/src/bootstrap-classes.ts` were modified.
- **Sprint-status.yaml untouched**: The pre-existing diff on `_bmad-output/implementation-artifacts/sprint-status.yaml` was set by the epic-cycle lead (Step 0.5 marking Story 9.1 as ready-for-dev) before the dev agent was spawned. The dev agent did NOT modify this file.
- **Commit deferred**: Per caller instructions, the dev agent did NOT stage or commit. The epic-cycle lead will handle commit/push after code review.

### File List

Modified files (all paths relative to repo root):

**Tool definition files (36 files, all under `packages/*/src/tools/`)**:
- `packages/iris-admin-mcp/src/tools/database.ts`
- `packages/iris-admin-mcp/src/tools/mapping.ts`
- `packages/iris-admin-mcp/src/tools/namespace.ts`
- `packages/iris-admin-mcp/src/tools/oauth.ts`
- `packages/iris-admin-mcp/src/tools/permission.ts`
- `packages/iris-admin-mcp/src/tools/resource.ts`
- `packages/iris-admin-mcp/src/tools/role.ts`
- `packages/iris-admin-mcp/src/tools/ssl.ts`
- `packages/iris-admin-mcp/src/tools/user.ts`
- `packages/iris-admin-mcp/src/tools/webapp.ts`
- `packages/iris-data-mcp/src/tools/analytics.ts`
- `packages/iris-data-mcp/src/tools/debug.ts`
- `packages/iris-data-mcp/src/tools/docdb.ts`
- `packages/iris-data-mcp/src/tools/rest.ts`
- `packages/iris-dev-mcp/src/tools/compile.ts`
- `packages/iris-dev-mcp/src/tools/doc.ts`
- `packages/iris-dev-mcp/src/tools/execute.ts`
- `packages/iris-dev-mcp/src/tools/format.ts`
- `packages/iris-dev-mcp/src/tools/global.ts`
- `packages/iris-dev-mcp/src/tools/intelligence.ts`
- `packages/iris-dev-mcp/src/tools/load.ts`
- `packages/iris-dev-mcp/src/tools/server.ts`
- `packages/iris-dev-mcp/src/tools/sql.ts`
- `packages/iris-interop-mcp/src/tools/credential.ts`
- `packages/iris-interop-mcp/src/tools/item.ts`
- `packages/iris-interop-mcp/src/tools/lookup.ts`
- `packages/iris-interop-mcp/src/tools/monitor.ts`
- `packages/iris-interop-mcp/src/tools/production.ts`
- `packages/iris-interop-mcp/src/tools/rest.ts`
- `packages/iris-interop-mcp/src/tools/rule.ts`
- `packages/iris-interop-mcp/src/tools/transform.ts`
- `packages/iris-ops-mcp/src/tools/config.ts`
- `packages/iris-ops-mcp/src/tools/infrastructure.ts`
- `packages/iris-ops-mcp/src/tools/jobs.ts`
- `packages/iris-ops-mcp/src/tools/metrics.ts`
- `packages/iris-ops-mcp/src/tools/system.ts`
- `packages/iris-ops-mcp/src/tools/task.ts`

**Test files (47 files)**:
- `packages/iris-admin-mcp/src/__tests__/database.test.ts`
- `packages/iris-admin-mcp/src/__tests__/index.test.ts`
- `packages/iris-admin-mcp/src/__tests__/mapping.test.ts`
- `packages/iris-admin-mcp/src/__tests__/namespace.test.ts`
- `packages/iris-admin-mcp/src/__tests__/oauth.test.ts`
- `packages/iris-admin-mcp/src/__tests__/permission.test.ts`
- `packages/iris-admin-mcp/src/__tests__/resource.test.ts`
- `packages/iris-admin-mcp/src/__tests__/role.test.ts`
- `packages/iris-admin-mcp/src/__tests__/ssl.test.ts`
- `packages/iris-admin-mcp/src/__tests__/user.test.ts`
- `packages/iris-admin-mcp/src/__tests__/webapp.test.ts`
- `packages/iris-data-mcp/src/__tests__/analytics.test.ts`
- `packages/iris-data-mcp/src/__tests__/docdb.test.ts`
- `packages/iris-data-mcp/src/__tests__/index.test.ts`
- `packages/iris-data-mcp/src/__tests__/rest.test.ts`
- `packages/iris-dev-mcp/src/__tests__/compile.test.ts`
- `packages/iris-dev-mcp/src/__tests__/custom-rest.integration.test.ts`
- `packages/iris-dev-mcp/src/__tests__/doc.test.ts`
- `packages/iris-dev-mcp/src/__tests__/execute.test.ts`
- `packages/iris-dev-mcp/src/__tests__/format.test.ts`
- `packages/iris-dev-mcp/src/__tests__/global.test.ts`
- `packages/iris-dev-mcp/src/__tests__/index.test.ts`
- `packages/iris-dev-mcp/src/__tests__/intelligence.test.ts`
- `packages/iris-dev-mcp/src/__tests__/load.test.ts`
- `packages/iris-dev-mcp/src/__tests__/server.test.ts`
- `packages/iris-dev-mcp/src/__tests__/sql.test.ts`
- `packages/iris-dev-mcp/src/__tests__/tools.integration.test.ts`
- `packages/iris-interop-mcp/src/__tests__/credential.test.ts`
- `packages/iris-interop-mcp/src/__tests__/index.test.ts`
- `packages/iris-interop-mcp/src/__tests__/item.test.ts`
- `packages/iris-interop-mcp/src/__tests__/lookup.test.ts`
- `packages/iris-interop-mcp/src/__tests__/monitor.test.ts`
- `packages/iris-interop-mcp/src/__tests__/production.test.ts`
- `packages/iris-interop-mcp/src/__tests__/rest.test.ts`
- `packages/iris-interop-mcp/src/__tests__/rule.test.ts`
- `packages/iris-interop-mcp/src/__tests__/transform.test.ts`
- `packages/iris-ops-mcp/src/__tests__/config.test.ts`
- `packages/iris-ops-mcp/src/__tests__/index.test.ts`
- `packages/iris-ops-mcp/src/__tests__/infrastructure.test.ts`
- `packages/iris-ops-mcp/src/__tests__/jobs.test.ts`
- `packages/iris-ops-mcp/src/__tests__/metrics.test.ts`
- `packages/iris-ops-mcp/src/__tests__/ops.integration.test.ts`
- `packages/iris-ops-mcp/src/__tests__/system.test.ts`
- `packages/iris-ops-mcp/src/__tests__/task.test.ts`
- `packages/shared/src/__tests__/server-base.test.ts`
- `packages/shared/src/__tests__/tool-types.test.ts`

**Shared comment/JSDoc consistency updates (2 files)**:
- `packages/shared/src/bootstrap.ts` (2 comment references to `iris.execute.command` → `iris_execute_command`)
- `packages/shared/src/tool-types.ts` (1 JSDoc example `"iris.doc.get"` → `"iris_doc_get"` in ToolDefinition interface)

**Total files modified: 85 files in `packages/` (36 tool defs + 47 tests + 2 shared comments)**
**Total replacements: 564 (561 from script + 3 manual comment fixes)**

### Change Log

| Date | Version | Description | Author |
|------|---------|-------------|--------|
| 2026-04-09 | 1.0 | Story 9.1 implemented — mechanical rename of 85 tool identifiers `iris.x.y` → `iris_x_y` across 85 files in `packages/`. Build and tests pass cleanly matching Story 9.0 baseline (51 files / 993 tests / 0 failures). | Amelia (dev agent) |
