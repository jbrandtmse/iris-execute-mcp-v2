---
title: 'Story 38.6: Editing and SQL Safety Docs, Prompt and Capstone'
type: 'feature'
created: '2026-10-16'
status: 'done'
baseline_revision: '6a3d60f6bd11adaf63cb8a29e5790a06d9c4ea63'
baseline_commit: '6a3d60f6bd11adaf63cb8a29e5790a06d9c4ea63'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/.claude/rules/project-rules.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-iris-execute-mcp-v2-2026-10-14/ARCHITECTURE-SPINE.md'
warnings:
  - oversized
deferred:
  - summary: >-
      Existing-tool annotation divergences (spine AD-4, Deferred): iris_sql_execute, iris_execute_command and iris_doc_put declare destructiveHint false although each can delete or overwrite existing state.
    evidence: |-
      Spine AD-4 lists them under "Known divergences", and the spine's Deferred section says "The Epic 38 gate routes them to one ledger entry with an owner". A hint changes only through a sanctioned AD-15 change, so 38.6 does not change them. The iris_execute_tests readOnlyHint divergence is DW-498 (owned by 40.4) and is not part of this entry.
    location: >-
      packages/iris-dev-mcp/src/tools/sql.ts; packages/iris-dev-mcp/src/tools/execute.ts; packages/iris-dev-mcp/src/tools/doc.ts
    severity: low
  - summary: >-
      The Epic 38 capstone re-implements the fixture helpers (putDoc, compileDoc, lineNumber, fixtureDocuments, fixtureGlobals, removeFixtures) of the Story 38.4 wire gate, and the 38.5 gate carries its own variants, instead of one promoted set.
    evidence: |-
      The spec named only the connection env, the wire session and the Atelier query helper for promotion into process-gate-helpers.ts (Task "process-gate-helpers.ts"), so the fixture helpers stayed per-gate; they were already duplicated between the 38.4 and 38.5 gates before this story. A future change to the cleanup contract (stem, global names, table oracle) must be made in three files or the gates diverge (Rule 2, a spec-forced copy).
    location: >-
      packages/iris-mcp-all/src/__tests__/epic38-capstone-gate.test.ts; story-38-4-qa-doc-edit-wire-gate.test.ts; story-38-5-qa-sql-wire-gate.test.ts
    severity: low
---

<intent-contract>

## Intent

**Problem:** Epic 38 shipped line-range reads, guarded line edits, a Storage guard and server-side SQL safety, but:
- the docs state some defaults only on one surface, and the client-config and launcher guides miss the two new SQL variables;
- no prompt teaches the read, edit, compile and test loop;
- a `STALE_CONTENT` retry that passes `mismatches[].current` back as `expected` fails when the range ends in an empty line (DW-552);
- `iris_execute_tests` and `deploy-and-test-class` send read-only queries to `iris_sql_execute`, which the `read-only` preset blocks (DW-555);
- no gate checks the whole surface together, or that the classes it tests are the shipped ones (DW-559).

**Approach:**
- Fix `mismatches[].current` (it gains one trailing line break) and repoint the SQL hints.
- Add the dev prompt `edit-and-test-class` and update `deploy-and-test-class`, then regenerate the skills.
- Enrich every doc surface with each new item's default state.
- Close the epic with one default-suite capstone in `iris-mcp-all`. It drives the built dev server over the real MCP SDK client, first asserts that the deployed `BOOTSTRAP_VERSION` equals the shipped embed, then runs the six legs of AC 38.6.3.

## Boundaries & Constraints

**Always:**
- **DW-552.** `current` is the addressed lines joined with `\n`, plus one `\n`, so `textToLines(current)` returns exactly the addressed lines for every range.
  - The refusal's text block (the numbered lines) and every other field are unchanged.
  - The `iris_doc_edit` description gains one sentence: `current` can be passed back as `expected` unchanged, and an `expected` built from a ranged read ends every line, the last included, with a line break.
- **Prompt.** One new dev `PromptDefinition`, `edit-and-test-class`. Its arguments are `className` (required), `change` (required) and `testClass` (optional).
  - Its body is the flow: ranged `iris_doc_get` → `iris_doc_edit` `apply` with `expected` → `iris_doc_compile` → `iris_execute_tests` → a check that `total` equals the number of `Test*` methods.
  - The main path uses only dev `core` tools.
  - It names no internal rule number and no repository path (AD-28).
- **`deploy-and-test-class` update.**
  - Step 2 keeps fixing the local source file, and adds the in-place route (ranged read, then `iris_doc_edit`, then `iris_doc_compile`) for a class that has no local source.
  - The manual `%UnitTest_Result` query names `iris_sql_query`.
  - The `(Rule #17)` and `(Rule #35)` citations go (AD-28).
  - Every invariant `prompt-safety-invariants.test.ts` pins today stays.
- **Skills.** `skills/` changes only through `pnpm gen:skills`, and `gen:skills:check` and `validate:prompts` pass clean.
- **Capstone.**
  - **Shape.** One `*.test.ts` in `packages/iris-mcp-all/src/__tests__/`. It runs in the default suite, carries its own `process.env.IRIS_REQUIRE_LIVE ===` arming comparison, and is listed in that package's `gateTestFiles`.
  - **Arming.** Unarmed, an unreachable IRIS or a stale dist skips it with the reason. Armed, it fails with "may not be skipped".
  - **What it drives.** The built `iris-dev-mcp` dist over stdio through the SDK `Client`, targeting `server:"default"` and an explicit namespace. Raw Atelier reads are the independent oracle.
- **Fixtures.** Every write goes to disposable `ExecuteMCPv2.Temp.*` documents, tables and globals whose names contain the stem `QaStory386Cap`, with global names of at most 31 characters.
  - They are removed, and their absence asserted, in `beforeAll` and in `afterAll`, never in a final `it()` (DW-556).
  - Each leg puts the fixture it needs, so the legs pass in either order.
- **Version check (DW-559).** Once a gate's first dev-server session has connected (the server's startup bootstrap runs before it accepts the connection, `server-base.ts:2151-2173`), the gate reads `SELECT ExecuteMCPv2.Setup_GetBootstrapVersion() AS Version` over raw Atelier.
  - It asserts the value equals `BOOTSTRAP_VERSION` from the built `packages/shared/dist/bootstrap-classes.js`, and does so before any leg, armed or not.
  - A mismatch fails, naming both values.
  - The capstone and both QA wire gates (38.4, 38.5) do this through one shared helper.
- **Docs.** Each item in the Docs table (Design Notes) states its default state on every surface listed for it (Rules #30/#43).
  - The env-var enumeration is exhaustive as of 2026-10-16. The source is a grep of `IRIS_SQL_MAX_ROWS` over `*.md` outside `node_modules`, `dist` and `_bmad*`.
- **Release.** A CHANGELOG top section for 38.6 and `.changeset/story-38-6-editing-and-sql-safety-docs-prompt-and-capstone.md` (`"@iris-mcp/dev": minor`).
- **Source text and live runs.** Source text is ASCII (Rule 14), and comments state the contract. Every live run names its target with the six `IRIS_*` variables and `IRIS_REQUIRE_LIVE=1`.

**Never:**
- **No new surfaces.** No tool, action, governance key, preset row, `TOOL_PAIRS` or annotation change, and no tool-count change.
- **Generated and installer-managed files.**
  - No ObjectScript change, so `BOOTSTRAP_VERSION` stays `d352a6a32158`.
  - No hand edit under `skills/`.
  - No edit to `governance-baseline.ts`, `baseline-classifications.ts` or `ipm/module.xml`, and never the bare baseline generator.
- **Owned elsewhere.** Do not fix DW-554, DW-556 (other gates' final cleanup `it()`), DW-558, DW-542, DW-549, DW-528, DW-530 or DW-498, and use no flat `IRIS_GOVERNANCE` shape.
- **Bootstrap-version check scope.** None in the in-process dev-package gates or `epic35-defect-gate` (see Design Notes).
- **Release.** No `changeset version`, no publish and no CI wiring (AD-29).
- **Owned by later stories.** No preset declaration on prompts and no skills-pack work (Epic 41). No `regenerateStorage` confirmation helper (Epic 43).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Stale range ending in an empty line | `iris_doc_edit` replace of lines n..n+1, where line n+1 is `""`, with a wrong `expected` | `STALE_CONTENT`; `mismatches[0].current` is e.g. `"\tSet x = 1\n\n"`; the text block is unchanged | `isError`, nothing stored |
| Retry with `current` (DW-552) | the same edit with `expected: mismatches[0].current` unchanged | applies; the re-read shows the new text | No error expected |
| Every range shape | one line, one empty line, several lines, the document's last line, a CRLF document, an insert anchor | `textToLines(current)` equals the addressed lines | No error expected |
| `expected` from a ranged read | each element of `iris_doc_get` `lines` followed by `\n` | matches, including a range that ends in an empty line | No error expected |
| Prompt, optional argument omitted | `prompts/get` `edit-and-test-class` with `{className, change}` | one user message; the steps in order; the test step tells the model to find the test class that covers `className`, or to ask | No error expected |
| Prompt, all arguments | `testClass` given | the test step names it | No error expected |
| Skill generation | `pnpm gen:skills` | `skills/edit-and-test-class/SKILL.md` and its `skills/README.md` row; `--check` clean | `--check` exits 1 on drift |
| Running hint (DW-555) | `iris_execute_tests` returns `status:"running"`; the tool description | the manual query names `iris_sql_query` with `parameters [runIndex]`, and neither surface names `iris_sql_execute` for it | No error expected |
| Version, match | deployed equals shipped after the first session connects | the legs run | No error expected |
| Version, mismatch | deployed is `dev`, an older hash or empty | the gate fails before any leg, naming the deployed and shipped values | test failure, armed or not |
| Unarmed prerequisites | IRIS unreachable, or a stale shared or dev dist | every capstone test skips with the reason | skip |
| Armed prerequisites | the same, with `IRIS_REQUIRE_LIVE=1` | `beforeAll` throws `... may not be skipped: <reason>` | test failure |

</intent-contract>

## Code Map

- **DW-552** -- `packages/iris-dev-mcp/src/tools/doc-edit.ts` (672 lines).
  - `findStaleEdits` (:223-241) keeps `current: string[]`.
  - `staleRefusal` (:304-339) builds the text from `formatNumberedLines(entry.current, ...)` (:320, unchanged) and sets `current: joinLines(entry.current)` (:336). That second line is the fix point.
  - The description is :445-466, the `expected` schema :434-439, and `text` :427-433.
  - `textToLines` is in `packages/shared/src/lines.ts:147`, as `splitLines(stripLeadingBom(text).replace(/\r?\n$/, ""))`. `joinLines` is `:131`. Neither changes.
- **Pins of today's `current`** (each gains the trailing `\n`):
  - `packages/iris-dev-mcp/src/__tests__/doc-edit.test.ts`: :766, :783, :819, :820. The array at :1422 stays.
  - `doc-edit-live-gate.test.ts:424`.
  - `packages/iris-mcp-all/src/__tests__/story-38-4-qa-doc-edit-wire-gate.test.ts:442`.
  - The dev `README.md` example at :534.
- **DW-555** -- `packages/iris-dev-mcp/src/tools/execute.ts`:
  - `buildRunningHint` (:378-406, the query at :396);
  - the `iris_execute_tests` description (:1226);
  - the JSDoc (:361);
  - `presets.ts:28-30` (header comment).

  Tests that touch the hint: `execute.test.ts` and `test-status.test.ts`. None pins `iris_sql_execute` in the hint. `iris_sql_query` (`sql.ts:341`) takes `parameters` and is in dev `core` (`presets.ts:55`).
- **Prompts.**
  - **The type.** `packages/shared/src/tool-types.ts:187` `PromptDefinition {name, title, description, arguments, build}` and :157 `PromptArgumentDefinition {name, description, required}`. There is no skill-description field and no preset field (AD-28's per-skill preset lands in Epic 41).
  - **Helpers.** `isArgProvided` and `argOrPlaceholder` (`packages/shared/src/prompt-helpers.ts:20,29`).
  - **Siblings to follow.** `deployAndTestClass.ts` (the flow; the `total` wording at :39-40) and `diagnoseSlowQuery.ts:22-36` (an optional argument with `isArgProvided`).
  - **Registration.** `packages/iris-dev-mcp/src/prompts/index.ts:17-22` holds the array, wired at `src/index.ts:16-29`.
  - **`deployAndTestClass.ts` lines that change.**
    - :34: the `(Rule #17)` citation goes. "glob-prefixed path" and "REFUSED" stay.
    - :35: step 2, the overlap.
    - :38: `iris_sql_execute` becomes `iris_sql_query`.
    - :39: the `(Rule #35)` citation goes. "returned `total`", "PARTIAL" and "rerun" stay.
  - **Dev `core`.** It includes `iris_doc_get`, `iris_doc_edit`, `iris_doc_compile`, `iris_execute_tests`, `iris_sql_query` and `iris_global_get`, and excludes `iris_test_status` and `iris_doc_search` (`presets.ts:40-75`).
- **Prompt and skill pins.**
  - **Dev.** `packages/iris-dev-mcp/src/__tests__/prompts.test.ts`: `OWN_PROMPT_NAMES` (:33-38, 4 names), the count title (:93), and the `callRequest(server, "prompts/get", ...)` harness. The `FOREIGN_PROMPT_NAMES` lists are in the ops (:33), interop (:42) and admin (:39) `prompts.test.ts`.
  - **`iris-mcp-all/src/__tests__/` names and counts.**
    - `docs-prompt-sync.test.ts`: `EXPECTED_COUNTS` (:50, dev 4), "11 prompts" (:149-157), the `tool_support.md` `dev` count and "pack of N" (:159-189), and a no-other-README check (:96-116). The header comments (:22-23) and the :85 title are stale.
    - `validate-prompts.test.ts`: `toHaveLength(11)` (:80) and its title (:67).
    - `skills-generated-frontmatter.test.ts`: `EXPECTED_SKILL_NAMES` (:39-51, 11 names) and its title (:114).
  - **`iris-mcp-all/src/__tests__/` invariants and drift.**
    - `prompt-safety-invariants.test.ts`: the deploy invariants are at :273-297. It reads the built dist.
    - `gen-skills-stray-file.test.ts:71-75`: `--check` must be clean.
  - **Scripts.**
    - `scripts/gen-skills.mjs` writes `skills/<name>/SKILL.md` (frontmatter `name` and `description`, body `build({})`) and `skills/README.md`. It loads `dist/prompts/index.js`.
    - `scripts/validate-prompts.mjs` checks only that every `iris_*` token names a real tool.
    - Root `package.json:18-20` defines `gen:skills`, `gen:skills:check` and `validate:prompts`. They need built dists.
- **Capstone support** (`packages/iris-mcp-all/src/__tests__/`).
  - `process-gate-helpers.ts` (143 lines) exports `resolveSdkEsmDir` (:18), `staleDistReason` (:39), `isIrisReachable` (:54), `inheritedEnv` (:75) and `spawnAndWaitForExit` (:113). It has no session or Atelier helper and nothing that reads a version.
  - `story-38-5-qa-sql-wire-gate.test.ts` (1112 lines):
    - arming :74-75;
    - `connectionEnv` / `openSession` (with `call`, `callOn`, `raw`, `listTools`, `close`) / `withSession` :129-185;
    - raw Atelier `atelier(query)` / `scalar` / `rowTotal` :191-226;
    - a seeded persistent `SOURCE` :231-266;
    - cleanup :268-297; `seed` :299-305;
    - `beforeAll` :322-336 (the "may not be skipped" throw is at :322); `afterAll` :338-347;
    - the `SQL_READ_ONLY` leg :543-574; the `SQL_ROWS_AFFECTED_CAP` leg :646-671.
  - `story-38-4-qa-doc-edit-wire-gate.test.ts` (667 lines):
    - an inline `openSession` / `withSession` :104-155;
    - `EDIT_SOURCE` :160-174 and `STORE_SOURCE` :177;
    - the helpers `readDoc`, `removeDoc`, `putDoc`, `compileDoc`, `freshEdit` and `freshStore` :184-215;
    - line helpers :224-243; cleanup :267-287; `beforeAll` :301-308; `afterAll` :311-320;
    - the ranged-read leg :410-418, the `STALE_CONTENT` leg :424-445, and `STORAGE_DROPPED` through `iris_doc_edit` :447-471.
  - **Refusal shapes.**
    - The `iris_doc_put` `STORAGE_DROPPED` shape (`{code, name, namespace, droppedStorage:["Default"]}`) and its text are pinned in `packages/iris-dev-mcp/src/__tests__/doc-put-storage-guard-live-gate.test.ts:230-236,392-412`.
    - The SQL refusal shapes are in `spec-38-5-sql-write-safety.md` (the matrix Texts).
  - **Version sources.**
    - **Shipped.** `BOOTSTRAP_VERSION` lives in `packages/shared/src/bootstrap-classes.ts:25` and `dist/bootstrap-classes.js:24`. It is not exported from the shared index, and `iris-mcp-all` does not depend on `@iris-mcp/shared`. Import it through `pathToFileURL`, as `epic35-defect-gate.test.ts:191-197` imports the shared dist.
    - **Deployed.** `Setup.cls:218-221` (`GetBootstrapVersion`, `SqlProc`); source `Setup.cls:27` holds the placeholder `"dev"`.
    - **The product probe.** `packages/shared/src/bootstrap.ts:140-187` `probeCustomRest` is the same SELECT. Any deployed value other than the shipped one is `stale` and is redeployed, `"dev"` included.
  - `packages/iris-mcp-all/scripts/prepublish-gate.mjs`: `gateTestFiles` :105-125, six entries, each 38.x entry with a two-line comment. `vitestArgs` :127 has no `--no-file-parallelism` (the dev script has it at :97-101, DW-511).
  - `live-gate-roster.test.ts:22-36`: an armed file is a direct `*.test.ts` that matches `/process\.env\.IRIS_REQUIRE_LIVE\s*===/`. `vitest.config.ts` includes `src/**/*.test.ts` and excludes `*.integration.test.ts`, with `testTimeout` 20 000.
  - **Capstone precedents.** `epic35-defect-gate.test.ts:1-30` (a header that names the legs and the paths) and `packages/iris-dev-mcp/src/__tests__/test-status-epic-gate.test.ts:1-24`.
- **Docs.** Gaps found at plan time; the Docs table in Design Notes is the work list.
  - **Root `README.md`.**
    - The env table is :69-98 (`IRIS_SQL_READ_ONLY` :88, `IRIS_SQL_MAX_ROWS_AFFECTED` :89) and the single-server list is :100.
    - Read-only preset :427-449; SQL write safety :451-459 (residuals :459); governance tables :502-536; parent keys :540-560; the fail-fast list :581.
    - The payload table is :657-669; the dev row :663 reads 84,040 / 43,214, not the 83,996 / 43,170 recorded in the context file.
    - The rosters :643-647; the prompts heading :703 ("11 prompts") and table :705-717.
    - Absent: `startLine`/`endLine`, `allowStorageRegeneration`, `STORAGE_DROPPED`, the version-checked save and `STALE_CONTENT`.
  - **Dev `README.md`.**
    - The config env table :27-35 has no SQL rows. The doc tools table is :141-151.
    - The SQL table :181-187 (`iris_sql_execute` :185 states no defaults); the paragraphs :193-197.
    - The `iris_doc_edit` details :403-431 and its example :521-534; the prompts table :252-262.
  - **`tool_support.md`.** Rows :31 (`iris_doc_get`), :32 (`iris_doc_put`), :42 (`iris_sql_execute`), :58 (`iris_doc_edit`) and :59 (`iris_sql_query`); notes :71 and :73; the prompt pack :374 ("11 ... `dev` 4").
  - **Client config.** `docs/client-config/claude-code.md:275-303`, `claude-desktop.md:242-270` and `cursor.md:273-301` each have a "Read-only Mode + SQL Resource Caps" table that lists only `IRIS_SQL_MAX_ROWS`/`IRIS_SQL_TIMEOUT`, says "`iris_sql_execute` specifically" and "All three are optional". `docs/client-config/README.md` has no env table.
  - **Launcher.** `extensions/iris-mcp-launcher/README.md:351-356` lists the variables the launcher passes through untouched (`IRIS_TIMEOUT`, `IRIS_SQL_MAX_ROWS`, `IRIS_SQL_TIMEOUT`, `IRIS_ACCEPT_LANGUAGE`); `src/env.ts:118-140` `LAUNCHER_OWNED_VARS` confirms no code change.
- **Doc-text pins to preserve.**
  - Story 38.1:
    - the fail-fast list's first parenthesis must still contain "unsupported `MCP_TRANSPORT`/`--transport` value", and the capture stops at the first `)`;
    - the :738 transport sentence.
  - Story 38.2:
    - the dev `iris_doc_get` row's parameter cell equals the schema, with no `|` inside it;
    - the example blocks match the built output.
  - Story 38.3: the dev `iris_doc_put` row and details.
  - Story 38.5 (`story-38-5-qa-doc-claims.test.ts`):
    - the root env rows (default cell starts `*(unset`), the single-server substring and the dev README phrases;
    - the SQL row cells and `tool_support.md` rows 14 and 31;
    - its changeset is read unconditionally.
  - `docs-governance-cli-recipes.test.ts`: the client-config placeholder path, the CLI bin path and the anchor.
  - CHANGELOG:
    - the 38.0-38.5 sections are located by `## [Pre-release ...] . Story 38.N`;
    - `docs-visibility-roster-sync` takes the first `full|core|developer N/N/N/N/N` string in the CHANGELOG, so the new section carries none.
- **Records.** `node scripts/check-epics-sync.mjs` (no package script) passes with exit 0 and "OK: no genuine drift ...". `scripts/measure-tools-payload.mjs` prints the table to stdout; the README rows are format-pinned by `docs-visibility-roster-sync`.

## Tasks & Acceptance

**Execution:**
- `packages/iris-dev-mcp/src/tools/doc-edit.ts` -- `staleRefusal` sets `current: joinLines(entry.current) + "\n"`, and the description gains the DW-552 sentence. -- AC-4.
- `packages/iris-dev-mcp/src/__tests__/doc-edit.test.ts`, `doc-edit-live-gate.test.ts`, `packages/iris-mcp-all/src/__tests__/story-38-4-qa-doc-edit-wire-gate.test.ts` -- move the five `current` pins to the trailing `\n`. Add unit rows for every range shape in the matrix:
  - each asserts `textToLines(current)` equals the addressed lines;
  - each passes `current` back as `expected` through the tool handler against a mocked Atelier, and the edit applies;
  - one pins the description sentence. -- AC-4.
- `packages/iris-dev-mcp/src/tools/execute.ts`, `presets.ts` -- the hint (:396), the description (:1226), the JSDoc (:361) and the `presets.ts` header name `iris_sql_query` for the manual `%UnitTest_Result` query. Add a pin in `execute.test.ts`: the hint and the description name `iris_sql_query` and never `iris_sql_execute`. -- AC-5.
- `packages/iris-dev-mcp/src/prompts/editAndTestClass.ts` (new), `prompts/index.ts` -- `editAndTestClassPrompt`, appended last, and its title (for example "Edit And Test Class"). -- AC-2.
  - **The body says, in order:**
    1. a ranged `iris_doc_get` (`startLine`/`endLine`) of the lines to change, with its `ts`;
    2. `iris_doc_edit` `action:"apply"`, where every edit's `expected` is built from the read's `lines` with each line followed by a line break;
    3. on `STALE_CONTENT`, pass each `mismatches[].current` back as `expected` once the change still applies to it, else re-read;
    4. on `DOCUMENT_CONFLICT`, re-read and redo it;
    5. on `STORAGE_DROPPED`, keep the Storage lines; never `regenerateStorage` unless the user explicitly asks (disabled by default; it changes the data layout);
    6. on `GOVERNANCE_DISABLED`, stop and tell the user;
    7. IRIS reformats class source on save, so take line numbers for further edits from the result or a fresh ranged read;
    8. `iris_doc_compile`, then fix the reported lines with another ranged read and edit, until it compiles;
    9. `iris_execute_tests` on `testClass`, or on the class that tests `className`, found or asked. On `status:"running"`, follow its `hint` and never re-submit;
    10. compare the returned `total` against the number of `Test*` methods in the test class (read its source) and rerun if it is short;
    11. if a local source file of the class exists it is now stale, so say so, because loading it from disk would overwrite the edit;
    12. report `unifiedDiff`, the compile result and the counts.
- `packages/iris-dev-mcp/src/prompts/deployAndTestClass.ts` -- make the four line changes in the Code Map. Step 2 adds: a class with no local source is fixed in place (ranged `iris_doc_get` → `iris_doc_edit` → `iris_doc_compile`, as in `edit-and-test-class`). -- AC-2, AC-5.
- `packages/iris-dev-mcp/src/__tests__/prompts.test.ts` -- 5 owned names (title included). Add `prompts/get` through `callRequest` for `edit-and-test-class`: one call with `testClass` omitted and one with it given. The ops, interop and admin `FOREIGN_PROMPT_NAMES` gain the new name. -- AC-2.
- `packages/iris-mcp-all/src/__tests__/prompt-safety-invariants.test.ts` -- add a `describe` that pins:
  - the step order;
  - `expected` and the line-break rule;
  - the `STALE_CONTENT` retry;
  - no `regenerateStorage` unless asked;
  - `iris_doc_compile`;
  - the `total`-vs-`Test*` check and the rerun;
  - every `iris_*` token being a dev `core` tool or `iris_test_status`;
  - no `/Rule #\d/`, and no repository path, in either prompt.

  For `deploy-and-test-class` it adds `iris_sql_query` present, `iris_sql_execute` absent and the in-place route named. -- AC-2, AC-5.
- `packages/iris-mcp-all/src/__tests__/docs-prompt-sync.test.ts`, `validate-prompts.test.ts`, `skills-generated-frontmatter.test.ts` -- update the counts and names (dev 5, 12 prompts and skills) and the stale header comments. -- AC-2.
- `skills/**` -- run `pnpm gen:skills` after building dev; never hand-edit. -- AC-2.
- `packages/iris-mcp-all/src/__tests__/process-gate-helpers.ts` -- promote, unchanged in behavior, the 38.5 gate's connection env, `openSession`/`withSession` and the raw Atelier query helper, parameterized by the connection. Add `assertDeployedBootstrapVersion(...)`: the SELECT above against `BOOTSTRAP_VERSION` from the built shared dist, throwing with both values on a mismatch. -- AC-6.
- `story-38-5-qa-sql-wire-gate.test.ts`, `story-38-4-qa-doc-edit-wire-gate.test.ts` -- switch to the promoted helpers, with no assertion changed. Each calls `assertDeployedBootstrapVersion` in `beforeAll` right after its admin session opens. -- AC-6.
- `packages/iris-mcp-all/src/__tests__/epic38-capstone-gate.test.ts` (new) -- the capstone. Its header names each leg, the path it drives and the fixtures. The legs run in this order, but each leg puts the fixture it needs. -- AC-3, AC-4, AC-6.
  - **Order of setup.** `beforeAll` checks the dists, the SDK, reachability and arming as the wire gates do; removes leftovers and asserts none remain; then opens the admin session and runs the version check. `afterAll` removes the fixtures, asserts nothing named `QaStory386Cap` remains, and closes the sessions.
  - **Fixtures.**
    - `ExecuteMCPv2.Temp.QaStory386CapEdit.cls`: non-persistent, with a method body that holds an empty line.
    - `ExecuteMCPv2.Temp.QaStory386CapRows.cls`: persistent, `Parameter DEFAULTGLOBAL = "^ExecuteMCPv2.QaStory386CapR"`, with a `Seed` class method; table `ExecuteMCPv2_Temp.QaStory386CapRows`.
  - **Leg 1.** A ranged read equals the matching slice of a full read.
  - **Leg 2.** An edit whose `expected` is built from a ranged read applies; the re-read and `iris_doc_compile` succeed.
  - **Leg 3.**
    - A stale edit on a range ending in an empty line is refused with `STALE_CONTENT`, and the document is unchanged (same content and `ts`).
    - The retry with `mismatches[0].current` applies (DW-552 end to end).
  - **Leg 4.** A storage-dropping `iris_doc_put` on the seeded persistent class is refused with `STORAGE_DROPPED` (`droppedStorage:["Default"]`). The stored source still holds the Storage block, and the row count is unchanged (oracle).
  - **Leg 5.** In a session with `IRIS_GOVERNANCE_PRESET=read-only`:
    - an `iris_sql_query` SELECT returns the seeded rows;
    - an `iris_sql_query` UPDATE is refused with `SQL_READ_ONLY` (`readOnlySource:"tool"`), and the values are unchanged (oracle);
    - `iris_sql_execute` is denied with `GOVERNANCE_DISABLED`.
  - **Leg 6.** In a session with `IRIS_SQL_MAX_ROWS_AFFECTED` set below the seeded count, an `iris_sql_execute` DELETE of every row is refused with `SQL_ROWS_AFFECTED_CAP` (`rowsAffected`, `maxRowsAffected`, `capSource:"operator"`), and the rows are intact (oracle).
  - **Mechanics.** Per-test timeouts are sized for compiles. Any `IRIS_GOVERNANCE` uses the `{"global":{...}}` shape.
- `packages/iris-mcp-all/scripts/prepublish-gate.mjs` -- add the capstone to `gateTestFiles` with the two-line comment (what it drives; which `QaStory386Cap` fixtures it writes). Add `--no-file-parallelism` to `vitestArgs`, with the DW-511 reason, because three gates now spawn dev servers that bootstrap the same shared instance. Update any test that pins `vitestArgs`. -- AC-3.
- Docs, per the Docs table in Design Notes -- AC-1.
  - **Root `README.md`.** A new subsection "Agent code editing" next to "SQL write safety" covers:
    - ranged reads, the `iris_doc_put` existing-document save and Storage guard (`allowStorageRegeneration`, default `false`);
    - `iris_doc_edit` and `regenerateStorage`, with defaults;
    - a refusal-code table (`STALE_CONTENT` with the `current` retry, `DOCUMENT_CONFLICT`, `STORAGE_DROPPED`, `SQL_READ_ONLY`, `SQL_ROWS_AFFECTED_CAP`: what happened, what to do).

    The env rows :88-89 add "global: every profile inherits it; no per-profile key". The fail-fast list :581 adds the two SQL variables (no `)` before the transport clause). Add a prompts table row, and "11 prompts" becomes "12 prompts".
  - **Dev `README.md`.**
    - The `iris_sql_execute` row :185 states the three defaults.
    - The :195 paragraph adds: `true`/`false` (case-insensitive), a non-negative integer with `0` valid, global with no per-profile key, and that a malformed value fails startup.
    - The `iris_doc_edit` details add the `current` retry, and the :534 example gains `\n`.
    - Add a prompts table row.
  - **`tool_support.md`.**
    - Rows :31 (`startLine`/`endLine`, optional, whole document when omitted), :32 (`allowStorageRegeneration` default false, `STORAGE_DROPPED`, the version-checked save and `DOCUMENT_CONFLICT`), :42 (the three defaults) and :58 (`STALE_CONTENT`/`DOCUMENT_CONFLICT`, how to disable `apply`).
    - The :73 note adds the variable facts and "statement-level read-only, not side-effect-free" with the residuals.
    - The :374 pack line reads 12 prompts, `dev` 5.
  - **Client config.** `docs/client-config/claude-code.md`, `claude-desktop.md`, `cursor.md`:
    - the table gains `IRIS_SQL_READ_ONLY` and `IRIS_SQL_MAX_ROWS_AFFECTED` with defaults;
    - the wording covers both SQL tools and fixes the "All three" count;
    - one line says queries under the read-only preset go through `iris_sql_query`.
  - **Launcher.** `extensions/iris-mcp-launcher/README.md:351-356` lists both variables and `IRIS_TEST_TIMEOUT` among the pass-through variables.
  - **Verdicts with no change.** `docs/client-config/README.md`; `docs/epic-summary.md:40`.
- `packages/iris-mcp-all/src/__tests__/story-38-6-doc-claims.test.ts` (new; default suite; no IRIS) -- for each Docs-table row and surface, assert that the anchor row or section carries the default-state phrase. Also assert the client-config and launcher variables, the CHANGELOG 38.6 section's headings, and the changeset's exact bump map. -- AC-1.
- `CHANGELOG.md` -- a top section `## [Pre-release — 2026-10-16] — Story 38.6: Editing and SQL safety docs, prompt and capstone`, with no `N/N/N/N/N` roster string:
  - `### Added`: the `edit-and-test-class` prompt and skill;
  - `### Changed`: `current` with its trailing line break (DW-552, orchestrator decision #11), the `iris_sql_query` hints (DW-555) and the `deploy-and-test-class` update;
  - `### Documentation`: the enriched surfaces. -- AC-1.
- `.changeset/story-38-6-editing-and-sql-safety-docs-prompt-and-capstone.md` -- `"@iris-mcp/dev": minor`, with a summary. -- AC-1.
- Root `README.md` payload table :657-669 -- re-measure after the rebuild with `pnpm measure:tools-payload` and write in the dev full and core figures and "Last re-measured at Story 38.6". -- AC-7.
- This spec's `## Verification` -- the implement stage records the epic-close records and every `mutation:` line. -- AC-7.

**Acceptance Criteria:**
- **AC-1 (38.6.1).** Given the finished docs, when `story-38-6-doc-claims.test.ts` runs, then:
  - every Docs-table item states its default state on each surface listed for it, including the three client-config guides and the launcher README;
  - the CHANGELOG has the 38.6 top section;
  - the changeset bumps exactly `@iris-mcp/dev` minor;
  - every existing doc-claims test stays green.
- **AC-2 (38.6.2).** Given the built dev server, when a real request handler lists and gets `edit-and-test-class` with and without `testClass`, then:
  - it renders the body content listed in Tasks, in that order, names only real tools, with the main path in dev `core`, and carries no internal rule number or repository path;
  - `deploy-and-test-class` names the in-place route;
  - `pnpm gen:skills` regenerates the skills, and `gen:skills:check` and `validate:prompts` pass clean.
- **AC-3 (38.6.3, Rule #21).** Given the armed capstone on the `QaStory386Cap` fixtures, when it runs on the built servers, then:
  - legs 1-6 give the outcomes in Tasks, with the rows and documents intact where a refusal is expected;
  - afterwards nothing named `QaStory386Cap` remains;
  - reverting the `STALE_CONTENT` guard and rebuilding the dev dist turns leg 3 red. The path is the built dev server over stdio → `iris_doc_edit` → Atelier PUT.
- **AC-4 (DW-552).** Given a `STALE_CONTENT` refusal for any range shape, when `mismatches[].current` is passed back unchanged as `expected`, then the edit applies, in the unit rows and in capstone leg 3; the description carries the sentence.
- **AC-5 (DW-555).** Given the `iris_execute_tests` running hint and description, `deploy-and-test-class` and its generated skill, when they are rendered, then the `%UnitTest_Result` query names `iris_sql_query`, and none names `iris_sql_execute` for it.
- **AC-6 (DW-559).** Given the capstone and the 38.4 and 38.5 wire gates, when their admin session has connected, then each asserts that the deployed `Setup_GetBootstrapVersion()` equals the shipped `BOOTSTRAP_VERSION` before any leg, and a mismatch fails naming both values.
- **AC-7 (38.6.4, gates).** Given the finished tree, when the Verification commands run, then:
  - every per-package build, test, lint and type-check passes;
  - `:check` exits 0 at `1e62c5ad5bf7`/141;
  - the tool counts are unchanged (dev 31/32, suite 107/112, dev `core` 14/15), and the prompts move 11 -> 12 (dev 4 -> 5);
  - `gen:bootstrap` is idempotent with `BOOTSTRAP_VERSION` `d352a6a32158` (epic: `2159ec9e6f69` -> `d352a6a32158`);
  - `check-epics-sync.mjs` prints OK;
  - the payload table matches the re-measure;
  - the guarded files and `src/` show no diff.

### Review Findings

Code review, 2026-10-16. Tier `full-opus`; layers Blind Hunter, Edge Case Hunter, Verification Gap and Acceptance Auditor all delivered. 25 raw findings → 12 entries (high 0, medium 2, low 10) plus 7 rejected. **Review Outcome:** CLEAN; 9 patched, 3 deferred to the ledger (DW-562 `escalated`, DW-563 `by-design`, DW-564 `wontfix-accepted`); story status `done`.

- [x] [Review][Patch] (medium) The stale-dist half of the I/O matrix rows "Unarmed prerequisites" and "Armed prerequisites" had no automated pin, and `epic38-gate-guards` accepted any skip reason: dropping `?? staleDistReason(REPO_ROOT, "iris-dev-mcp")` from the capstone turned nothing red [packages/iris-mcp-all/src/__tests__/epic38-gate-guards.test.ts:85] (verification-gap; fix-risk low: test-only)
- [x] [Review][Patch] (low) The root README refusal table's `SQL_READ_ONLY` and `SQL_ROWS_AFFECTED_CAP` rows misstate several variants: "the rows were rolled back" and "narrow the statement" are wrong for a statement that cannot run under a cap or carries `%NOJOURN`, the parameter-cap remedy is missing, and the read-only row names the preset where the `readOnly` parameter is meant and lists only the operator remedy; the pin checked only cell length [README.md:477] (blind-hunter+edge-case-hunter+acceptance-auditor; fix-risk low: docs and one test)
- [x] [Review][Patch] (low) The three client-config guides' `IRIS_SQL_MAX_ROWS_AFFECTED` and `IRIS_SQL_READ_ONLY` rows omit that under a ceiling only SELECT, INSERT, UPDATE and DELETE run, and that a call can only tighten either variable [docs/client-config/claude-code.md:281] (blind-hunter; fix-risk low: docs)
- [x] [Review][Patch] (low) The `--no-file-parallelism` comment in the `@iris-mcp/all` prepublish script gives a wrong reason: the three gates share no Atelier work queue and DW-511 concerns the `%UnitTest` gates; the shared state is the bootstrap redeploy of one instance [packages/iris-mcp-all/scripts/prepublish-gate.mjs:130] (blind-hunter; fix-risk low: comment)
- [x] [Review][Patch] (low) The version-check failure tells the user to run a built server so its bootstrap redeploys, although the gate's own built server has just connected (its bootstrap failed or did not run, and the gate drains its stderr) [packages/iris-mcp-all/src/__tests__/process-gate-helpers.ts:386] (blind-hunter+edge-case-hunter; fix-risk low: message text, pins unchanged)
- [x] [Review][Patch] (low) The `core` preset is still advertised as "~10-tool" in the root README and the three client-config guides; the runtime `core` rosters are 8 to 15 tools (dev 15 after Epic 38) [README.md:91] (blind-hunter; fix-risk low: docs)
- [x] [Review][Patch] (low) `deploy-and-test-class` step 2 replaced the package-wide exit "until `iris_doc_load` reports zero compile errors" with "until the class compiles", which a package target can satisfy with other classes still failing [packages/iris-dev-mcp/src/prompts/deployAndTestClass.ts:35] (edge-case-hunter; fix-risk low: one sentence, skill regenerated)
- [x] [Review][Patch] (low) Rule 19: AC sub-claims whose pinning tests exist but carry no `mutation:` line on their own path: capstone legs 4-6 (the Storage guard, the forced read-only of `iris_sql_query`, the operator ceiling), the `deploy-and-test-class` in-place route, the no-rule-number hygiene pin, and the changeset bump map [_bmad-output/implementation-artifacts/spec-38-6-editing-and-sql-safety-docs-prompt-and-capstone.md:527] (verification-gap; fix-risk low: mutation runs, tree restored)
- [x] [Review][Patch] (low) The capstone header says every leg spawns the built dev dist; legs 1-4 use the admin session `beforeAll` spawns, and only legs 5 and 6 start their own server [packages/iris-mcp-all/src/__tests__/epic38-capstone-gate.test.ts:5] (verification-gap; fix-risk low: comment)
- [x] [Review][Defer] (medium) The default `@iris-mcp/all` suite (`vitest run`, file-parallel) still runs the three bootstrapping gates at the same time; on a stale instance one gate's version check or legs can overlap a sibling server's redeploy and compile, so the epic gate's result in its required home depends on scheduling [packages/iris-mcp-all/vitest.config.ts:4] — deferred (DW-562): out-of-footprint (the package's vitest config, untouched since Epic 25), and the spec scoped `--no-file-parallelism` to the prepublish script; `escalated owner=burndown` (edge-case-hunter+verification-gap; fix-risk med: whole-package serial run, though QA's serial run was green at 428 tests)
- [x] [Review][Defer] (low) The `iris_doc_edit` description says `current` "can be passed back as `expected` unchanged" without the README's and prompt's condition "once the change still applies to it" [packages/iris-dev-mcp/src/tools/doc-edit.ts:456] — deferred (DW-563): spec-bound, `by-design` (the intent dictates the sentence; the refusal text, frozen by the intent, said "Retry with the current text below as expected" before this story) (blind-hunter)
- [x] [Review][Defer] (low) Every generated `skills/*/SKILL.md` frontmatter carries the generator's DO-NOT-EDIT banner naming `scripts/gen-skills.mjs` and `packages/iris-dev-mcp/src/prompts/*.ts`, repository paths that AD-28 keeps out of agent content [skills/edit-and-test-class/SKILL.md:2] — deferred (DW-564): pre-existing generator output (all 12 skills), out-of-footprint, and AD-28's mechanical check lands in Epic 41; `wontfix-accepted` (acceptance-auditor)

**Rejected.**
- `false` Blind 2 (the `expected` line-break rule is not in the parameter description; `text` drops a trailing empty line): the rule is in the same tool definition the model receives, and "one trailing line break is ignored" is the documented 38.4 contract of `text`.
- `false` Blind 6 (the `iris_execute_tests` description still writes `ti.InstanceIndex = <runIndex>`): that sentence names no `parameters`, so it describes a literal that `iris_sql_query` runs correctly, and it defers to the `hint`, which carries the exact `= ?` call.
- `low` Blind 10 (the spec's `(loop)` line omits the QA SDK-wire test): the fix edits the spec, and the `(once)` `pnpm --filter @iris-mcp/all test` line runs the file.
- `low` Edge 3 (another branch's server redeploys a different version mid-run): needs two embeds against one namespace at the same time; the fix adds a second check, and the version skew itself is DW-508 (Story 42.2).
- `low` Edge 4 (an HTTP 200 non-JSON Atelier body gives a bare `SyntaxError`): `atelierQuery` already appends the query to the error; a login page on the Atelier route is not a realistic gate state; the fix adds a guard.
- `low` Edge 5 (a `total` larger than the `Test*` count has no instruction): the check guards the short partial snapshot; the fix adds a branch to the prompt.
- `low` Edge 6 (`className` given with `.cls` renders `X.cls.cls`): the argument says "without the extension", the sibling prompts do not normalize either, and the fix adds a guard.

## Spec Change Log

## Review Triage Log

### 2026-10-16 — Review pass
- verdicts: 32 findings — high 0, medium 6, low 22, false 3, maybe-false 1
- findings (Blind Hunter 10, Edge Case Hunter 11, Verification Gap 4, Intent Alignment 7 divergences; rows in layer order):
  - `[medium]` `[patch]` Blind 1: `packages/iris-dev-mcp/README.md` (iris_execute_tests re-attach section) still sends the manual `%UnitTest_Result` query to `iris_sql_execute`, which the read-only preset blocks (DW-555) — confirmed by reading the section; reworded to `iris_sql_query`, pinned by a new `story-38-6-doc-claims` test (mutation: reverted wording -> red).
  - `[low]` `[reject]` Blind 2: DW-559 is closed only for the three bootstrapping gates — decided by orchestrator decision #16 and plan interpretation 1 (the in-process dev gates never bootstrap; the check there would fail without a defect); the residual is named in this log and in the Auto Run Result.
  - `[low]` `[patch]` Blind 3: `story-38-6-doc-claims` located the CHANGELOG section by position and pinned a moving re-measure sentence by story number — a later story's section would turn it red; the section is now found by heading and the sentence pinned by shape (mutation: a newer section inserted above 38.6 -> still green, with the 38.5 claims test).
  - `[low]` `[reject]` Blind 4: the `STALE_CONTENT` text still says "Retry with the current text below as expected" — the intent contract freezes the refusal's text block, and the sentence was already there before DW-552; the tool description and the README carry the `mismatches[].current` instruction.
  - `[low]` `[reject]` Blind 5: `edit-and-test-class` gaps (gutter, insert rule, `ts`, `DOCUMENT_CONFLICT` wording) — `lines` is the structured field and carries no gutter, the insert rule is in the `iris_doc_edit` description the model sees, step 1 keeping `ts` is spec step 1, and "the class changed after you read it" is true of a conflict; no harm named.
  - `[low]` `[patch]` Blind 6: `deploy-and-test-class` said `parameters: [<runIndex>]` but wrote the predicate as `= <runIndex>`, while the tool hint and the README use `= ?` — the prompt (and its generated skill) now says `= ?`; pinned in `prompt-safety-invariants` (mutation: back to `= <runIndex>` -> red).
  - `[low]` `[reject]` Blind 7: the no-local-source branch sits in step 2 — that is what the spec's Tasks and plan interpretation 2 prescribe (the class has no local source, so it is fixed in place after the first compile error report).
  - `[low]` `[patch]` Blind 8: the "main path uses only dev core tools" claim was pinned loosely (core plus `iris_test_status` for both prompts) — the pin is now per prompt, core only for `edit-and-test-class` (mutation: `iris_test_status` added to the body -> red).
  - `[low]` `[defer]` Blind 9: the capstone re-implements the 38.4 gate's fixture helpers — the spec named only the session, env and Atelier helpers for promotion, and the 38.4 and 38.5 gates already duplicated the rest; recorded in the frontmatter `deferred:` list for a ledger owner.
  - `[false]` `[reject]` Blind 10: the "Agent code editing" section sits in the wrong place — the spec asks for it "next to SQL write safety", and it directly follows that content in the root README.
  - `[medium]` `[patch]` Edge 1: the same stale dev README bullet as Blind 1 (carried; one patch).
  - `[low]` `[reject]` Edge 2: the default suite still runs the three bootstrapping gates in parallel — the spec adds `--no-file-parallelism` to the prepublish script only (Tasks, plan interpretation 3); a race needs a stale deployment, and the full `@iris-mcp/all` suite ran green; named as a residual.
  - `[low]` `[reject]` Edge 3: the check compares only the `Setup_GetBootstrapVersion()` stamp — that is the contract (the same predicate as the bootstrap probe, and a `src/`-loaded `Setup` reports `dev`); a hand-loaded handler with an unchanged stamp is outside it.
  - `[low]` `[patch]` Edge 4: the docs say any other value fails startup, but an empty `IRIS_SQL_READ_ONLY` / `IRIS_SQL_MAX_ROWS_AFFECTED` counts as unset (`config.ts`) — the dev README sentence now says so, pinned in `story-38-6-doc-claims` (mutation: phrase removed -> red).
  - `[low]` `[patch]` Edge 5: the `skills-generated-frontmatter.test.ts` header still said 11 prompts — updated to 12 with the new name (the spec asks for the stale header comments).
  - `[maybe-false]` `[reject]` Edge 6: a stored line ending in a lone CR, or a BOM on the first line, would not round-trip through `textToLines` — if true it is low; Atelier content lines carry no line terminators and a BOM only precedes a document's first byte, so no input reaches it (checked against the matrix CRLF row, covered as an `expected` written with CRLF).
  - `[low]` `[reject]` Edge 7: the in-place route of `deploy-and-test-class` has no refusal guidance — the prompt names only `apply`, `regenerateStorage` is disabled by default, and the loop is named for the details.
  - `[low]` `[reject]` Edge 8: no step for an uncoded `iris_doc_edit` error — the model reads the error text; no concrete harm.
  - `[low]` `[reject]` Edge 9: a `className` given with `.cls` yields `X.cls.cls` — the argument description says "without the extension".
  - `[low]` `[reject]` Edge 10: the refusal text vs `current` (same as Blind 4).
  - `[low]` `[reject]` Edge 11: `afterAll` after a failed `openWireSession` — the same structure as the 38.4 and 38.5 gates; vitest reports the `beforeAll` failure first and the `afterAll` error is noise.
  - `[low]` `[patch]` Verification Gap 1: the position-dependent CHANGELOG pin (same as Blind 3, carried).
  - `[medium]` `[patch]` Verification Gap 2: the capstone's cleanup absence assertions had no positive control and no recorded mutation, so a blind oracle would pass — `freshRows` now asserts the document, global and table oracles each see the fixture; mutations: the global filter made blind -> legs 4-6 red; the global kill loop disabled -> `afterAll` red ("no QaStory386Cap global after the run"); each followed by a clean re-run that purged the leak.
  - `[medium]` `[patch]` Verification Gap 3 (Other): the stale dev README bullet (carried; one patch).
  - `[low]` `[reject]` Verification Gap 4 (Other): the default-suite parallelism (same as Edge 2).
  - `[low]` `[patch]` Intent 1: nothing would fail if a wire gate dropped its `assertDeployedBootstrapVersion` call — new `epic38-gate-guards.test.ts` pins the call after the admin session and ahead of every `describe` in the three gates (mutation: call removed from the 38.5 gate -> red); the live AC-6 mutation already showed the gates failing on a mismatch.
  - `[medium]` `[patch]` Intent 2: the dev README still names `iris_sql_execute` for the manual query (carried; one patch); the description is read from the same exported tool definition `tools/list` serves, so that half is rejected.
  - `[low]` `[reject]` Intent 3: only one range shape on the wire — the spec's matrix and Tasks put every shape in unit rows and one end-to-end shape in capstone leg 3.
  - `[medium]` `[patch]` Intent 4: the matrix rows "Unarmed prerequisites" and "Armed prerequisites" had no automated test — `epic38-gate-guards.test.ts` runs the capstone file in its own vitest process against a closed local port, unarmed (all 6 skipped, exit 0) and armed (`may not be skipped: <reason>`, non-zero); mutations: the armed throw disabled -> the armed case red; the throw made unconditional -> the unarmed case red.
  - `[low]` `[reject]` Intent 5: `--no-file-parallelism` is only in the prepublish script (same as Edge 2).
  - `[false]` `[reject]` Intent 6: the prompt tests do not use an SDK `Client` — AC-2 says "a real request handler", and `prompts.test.ts` drives the real dev server handler through `callRequest`.
  - `[false]` `[reject]` Intent 7: the dev `execute.js` mtime is older than its source — `checkDistFresh` compares the newest dist file with the newest source file across the package, and every armed gate ran after the build and passed (a stale dist throws "may not be skipped").

## Design Notes

**Orchestrator decision #16 (spec gate, 2026-10-16).** The version-guard mutation is approved: it alters the shipped `BOOTSTRAP_VERSION` in the built shared dist, which makes the dev server redeploy the ExecuteMCPv2 classes, with identical content, to the shared instance. That is the normal bootstrap path. One condition applies. After the revert and rebuild, one more armed gate start must return the deployed version to the shipped `d352a6a32158`, and the story must verify it with a read-only version query, recorded in `## Verification`. Never leave the instance on a mutated version marker. The planner's recommendation to close DW-559 as resolved, with the named leftover risk for the non-bootstrapping dev gates, is accepted for adjudication.

**Governing ADs.**
- **AD-24.** One line utility; the `STALE_CONTENT` round trip (DW-552) uses `textToLines`/`joinLines` unchanged.
- **AD-25.** Capstone legs 5 and 6, and the docs' "statement-level read-only, not side-effect-free" wording.
- **AD-28.** Prompts are authored once, and skills are generated. Every `iris_*` token is a real tool. No internal references; that is why the deploy prompt loses its two rule citations. The per-skill preset check lands in Epic 41.
- **AD-14.** The DW-559 check, and no bootstrapped-class change.
- **AD-15.** The `current` value change is a sanctioned pre-release change (orchestrator decision #11; the field shipped in 38.4 of this unreleased epic) and is recorded under CHANGELOG "Changed". The hint and description edits change text only.
- **AD-6.** The read-only preset blocks `iris_sql_execute` and runs `iris_sql_query`. Tests use the `{"global":{...}}` shape.
- **AD-7, AD-10.** No preset rows change; prompts change no tool count.
- **AD-2.** The cross-package gate lives in `iris-mcp-all` and imports the built dists.
- **AD-9.** Operator variables: global, inherited, malformed values fail fast; documented.
- **AD-23.** Docs keep stdio-only.
- **AD-5.** `:check` only.
- **AD-29.** A minor changeset; no versioning or publish.
- **Conventions.** Live gates (the capstone in the default suite, on the roster), Live testing on a shared instance, Configuration variables, Tool descriptions, Refusals, Error text.

**Docs table** (Rule #30; every surface states the default state). "Done" means verified present at plan time; keep it.

| Item | Default state to state | Root README | Dev README | `tool_support.md` |
|---|---|---|---|---|
| `iris_doc_get` `startLine`/`endLine` | optional; omitted = the whole document | add (subsection) | done :145/:333 | add row :31 |
| `iris_doc_put` `allowStorageRegeneration`, `STORAGE_DROPPED`, version-checked save, `DOCUMENT_CONFLICT` | `false` | add (subsection) | done :146/:345-372 | add row :32 |
| `iris_doc_edit:apply` | write, enabled by default (S-3); disable with `{"global":{"iris_doc_edit:apply":false}}`; inherits an explicit `iris_doc_put` disable; blocked by `read-only` | done :536 | done | add the disable to row :58 |
| `iris_doc_edit:regenerateStorage` | disabled by default | done | done | done |
| `STALE_CONTENT` and the `current` retry (DW-552) | -- | add (refusal table) | add | add row :58 |
| `iris_sql_query` | read, enabled by default, runs under `read-only`, inherits an explicit `iris_sql_execute` disable | done :443 | done | done |
| `iris_sql_execute` `readOnly`/`countOnly`/`maxRowsAffected` | `false` / `false` / no cap | done :455-457 | add row :185 | add row :42 |
| `IRIS_SQL_READ_ONLY` | unset = off; `true`/`false`; global, no per-profile key; malformed fails startup | add the global wording and the fail-fast list | add :195 | add note :73 |
| `IRIS_SQL_MAX_ROWS_AFFECTED` | unset = no cap; non-negative integer, `0` valid; same | same | same | same |
| Residual effects | -- | done :459 | done :195 | add note :73 |
| `edit-and-test-class` | -- | add (table, 12 prompts) | add (table) | add (:374) |

The client-config guides and the launcher README carry both SQL variables, as in Tasks.

**Plan-time interpretations (apply-and-report, Rule 5).**
1. **DW-559 "where cheap".**
   - **Cheap.** The check is cheap where a gate already starts the built dev server: its startup bootstrap redeploys any deployment whose version differs (`bootstrap.ts:140-187`), so a mismatch after connect means the gate is testing something other than the shipped embed. That covers the capstone and the 38.4 and 38.5 wire gates.
   - **Not cheap.** In the in-process gates, the check is not cheap:
     - the 10 dev-package `*live-gate*`/`*epic-gate*` files and `epic35-defect-gate`;
     - they never bootstrap, they run in the default suite whenever IRIS is reachable, and the dev package cannot see the shipped constant without a new shared export;
     - so the check there would either fail without a defect (on a `src/`-loaded `Setup`, which reports `dev`, or on a story that loaded a changed handler before restarting a built server) or need a redeploy of product classes on every run.
   - **Residual.** Those gates still test whatever is deployed; the capstone covers the epic's handlers on the shipped embed. Lead adjudication: `resolved-by` this story, with that residual named.
2. **The `deploy-and-test-class` overlap.** The overlap is step 2 (fix compile errors). Local-source classes keep the disk-then-reload route, and a class with no local source gets the in-place route, so the two prompts never fight over one copy.
3. **`--no-file-parallelism`.** It is added to the `iris-mcp-all` gate script, which the epic context assumed already ran serially (it did not): three gates now spawn bootstrapping dev servers against one shared instance.
4. **The new prompt's arguments and name.** `edit-and-test-class` is a substring of no other prompt or README, as `docs-prompt-sync` requires.

**Integration (Rules 1/2).**
- **Integration ACs.**
  - The real dev `McpServerBase` request handler serves `prompts/get` for the new prompt (AC-2).
  - `gen-skills.mjs` reads it from the built dist and writes `skills/edit-and-test-class/SKILL.md` (AC-2).
  - The capstone drives the built server through the SDK client against live IRIS (AC-3).
  - The two wire gates consume the promoted helpers (AC-6).
- **Consumed-by:**
  - this story's capstone and the two wire gates (the helpers);
  - MCP clients and the Epic 41 skills pack (the prompt and skill);
  - Story 42.3 CI, which runs every roster.
- **Consumes:**
  - 38.2 ranged reads;
  - 38.3 `STORAGE_DROPPED` and the existing-document save;
  - 38.4 `iris_doc_edit`;
  - 38.5 `iris_sql_query`, the SQL endpoint and the operator variables;
  - the bootstrap probe semantics;
  - `process-gate-helpers.ts`.
- **Extend, don't copy.**
  - The prompt follows `deployAndTestClass.ts` and `diagnoseSlowQuery.ts`.
  - The session and Atelier helpers are promoted from the 38.5 wire gate rather than copied a third time, and the 38.4 inline copy is retired.
  - The fixtures follow the 38.4 `EDIT_SOURCE`/`STORE_SOURCE` and the 38.5 `SOURCE`/`seed`.
  - The version read reuses `probeCustomRest`'s SELECT but not the function. The function maps every error to `missing` and returns no value on `current`, and the gate needs an oracle that is independent of the code that decides the redeploy.

**Ledger inbox.**
- DW-552: AC-4, the matrix rows, capstone leg 3.
- DW-555: AC-5.
- DW-559: AC-6, interpretation 1.

None is declined. Context only: DW-554 (the shape), DW-556 (the capstone uses `afterAll`).

**Epic-close records (AC 38.6.4).** The implement stage writes them under Verification:
- the `:check` output;
- the counts;
- `BOOTSTRAP_VERSION` from -> to, for 38.6 and for the epic;
- the `check-epics-sync` line.

The spine routes the annotation divergences to the lead's Epic 38 gate. They are recorded in the frontmatter `deferred:` list for harvest into one owned ledger entry.

## Verification

Every command runs from `/Users/jbrandt/git/iris-execute-mcp-v2` in the foreground with `timeout: 600000`. IRIS is reached only as `default`: localhost:52773, HSCUSTOM, `IRIS_HTTPS=false`.
- **Live writes.** Only the capstone's `ExecuteMCPv2.Temp.QaStory386CapEdit.cls` and `ExecuteMCPv2.Temp.QaStory386CapRows.cls`, with their table, storage globals (`^ExecuteMCPv2.QaStory386CapR*`) and generated routines.
  - Plus the existing fixtures of the re-run gates: `QaStory384Wire*`, `QaStory385Wire*` and the dev `doc-edit-live-gate` stem.
  - Each is removed before and after by its own gate.
- **No OS %UnitTest run is needed:** there is no ObjectScript change.
- **Build order:** shared, then dev, then `iris-mcp-all`.

**Shared surfaces:**
- **Prompts and skills.**
  - the dev prompt array, order and counts (dev `prompts.test.ts`; the ops, interop and admin foreign lists; `docs-prompt-sync`; `validate-prompts`; `skills-generated-frontmatter`);
  - the generated `skills/` tree and `skills/README.md`;
  - the documented prompt counts.
- **Gates and helpers.**
  - the `iris-mcp-all` `gateTestFiles` and `vitestArgs`;
  - the `process-gate-helpers.ts` exports used by both wire gates.
- **Tool output and text.**
  - the `STALE_CONTENT` `current` pins and the dev README example;
  - the `iris_doc_edit` and `iris_execute_tests` description text and the payload table;
  - the `CHANGELOG.md` top section, which the doc-claims regexes and the roster-string first match read.

Standing criterion: every test added or changed passes on a fresh environment, in either order.

**Commands:**
- `(loop)` `pnpm --filter @iris-mcp/dev build && pnpm --filter @iris-mcp/dev exec vitest run src/__tests__/doc-edit.test.ts src/__tests__/execute.test.ts src/__tests__/test-status.test.ts src/__tests__/prompts.test.ts` -- expected: pass.
- `(loop)` `pnpm --filter @iris-mcp/ops exec vitest run src/__tests__/prompts.test.ts && pnpm --filter @iris-mcp/interop exec vitest run src/__tests__/prompts.test.ts && pnpm --filter @iris-mcp/admin exec vitest run src/__tests__/prompts.test.ts` -- expected: pass.
- `(loop)` `pnpm gen:skills && pnpm gen:skills:check && pnpm validate:prompts` -- expected: `--check` clean; `validate-prompts: OK`.
- `(loop)` `pnpm --filter @iris-mcp/all exec vitest run src/__tests__/docs-prompt-sync.test.ts src/__tests__/validate-prompts.test.ts src/__tests__/skills-generated-frontmatter.test.ts src/__tests__/gen-skills-stray-file.test.ts src/__tests__/prompt-safety-invariants.test.ts src/__tests__/live-gate-roster.test.ts src/__tests__/story-38-6-doc-claims.test.ts src/__tests__/story-38-0-qa-doc-claims.test.ts src/__tests__/story-38-1-qa-doc-claims.test.ts src/__tests__/story-38-2-qa-doc-claims.test.ts src/__tests__/story-38-3-qa-doc-claims.test.ts src/__tests__/story-38-5-qa-doc-claims.test.ts src/__tests__/docs-visibility-roster-sync.test.ts src/__tests__/docs-governance-cli-recipes.test.ts src/__tests__/measure-tools-payload.test.ts src/__tests__/bootstrap-version-check.test.ts src/__tests__/epic38-gate-guards.test.ts` -- expected: pass.
- `(loop)` `IRIS_HOST=localhost IRIS_PORT=52773 IRIS_NAMESPACE=HSCUSTOM IRIS_USERNAME=_SYSTEM IRIS_PASSWORD=SYS IRIS_HTTPS=false IRIS_REQUIRE_LIVE=1 pnpm --filter @iris-mcp/all exec vitest run src/__tests__/epic38-capstone-gate.test.ts` -- expected: all pass, none skipped.
- `(loop)` the same variables with `pnpm --filter @iris-mcp/all exec vitest run src/__tests__/story-38-4-qa-doc-edit-wire-gate.test.ts` -- expected: all pass, none skipped.
- `(loop)` the same variables with `pnpm --filter @iris-mcp/all exec vitest run src/__tests__/story-38-5-qa-sql-wire-gate.test.ts` -- expected: all pass, none skipped.
- `(loop)` the same variables with `pnpm --filter @iris-mcp/dev exec vitest run --no-file-parallelism src/__tests__/doc-edit-live-gate.test.ts` -- expected: all pass, none skipped.
- `(once)` One command per package, each running `build`, then `test`, `lint` and `type-check` where defined. The packages are shared, dev, admin, interop, ops, data and client-config, followed by `pnpm --filter @iris-mcp/all test` (35-1-DEV-1). Expected: green.
- `(once)` `pnpm gen:governance-baseline:check` -- expected: exit 0 at `1e62c5ad5bf7`/141.
- `(once)` `pnpm gen:bootstrap && git diff --stat -- packages/shared/src/bootstrap-classes.ts` -- expected: no diff (`d352a6a32158`).
- `(once)` `node scripts/check-epics-sync.mjs` -- expected: exit 0, `OK: no genuine drift ...`.
- `(once)` `pnpm measure:tools-payload` after the rebuild -- expected: the README payload rows match the output.
- `(once)` `git diff --stat 8f134196ae80fcbbfc4d915195ddbc01c072f7b6 -- packages/shared/src/governance-baseline.ts packages/shared/src/baseline-classifications.ts ipm/module.xml src/` -- expected: empty.
- `(once)` `iris_doc_list` (`generated:true`) and `iris_global_list` with the filter `QaStory386` (`server:"default"`, `namespace:"HSCUSTOM"`) -- expected: empty.

**Planned mutations (Rule 19).** For each one, apply it, observe red, revert, rebuild any dist it touched, and check that `git status --short` and `git diff --stat` are unchanged. Record each as `mutation: ... -> ...`.

| AC | Mutation | Expected red |
|---|---|---|
| AC-1 | "enabled by default" removed from the `tool_support.md` `iris_doc_edit` row; the `IRIS_SQL_READ_ONLY` row dropped from `cursor.md` | `story-38-6-doc-claims` |
| AC-2 | `editAndTestClassPrompt` removed from the dev array (dist rebuilt) | dev `prompts.test.ts`, `docs-prompt-sync`, `validate-prompts`, `gen:skills:check` |
| AC-2 | the `total`-vs-`Test*` sentence removed from the body | the new `prompt-safety-invariants` describe |
| AC-3 | `findStaleEdits` returns `[]` (dev dist rebuilt) | capstone leg 3 (the stale edit is stored), on the built-server path |
| AC-4 | `current` back to `joinLines(entry.current)` | the `doc-edit.test.ts` round-trip rows; the capstone leg 3 retry |
| AC-5 | the hint's query back to `iris_sql_execute` | the `execute.test.ts` pin |
| AC-6 | `BOOTSTRAP_VERSION` in `packages/shared/dist/bootstrap-classes.js` changed by one hex digit (restored by rebuilding shared) | the capstone version check. Side effect: the spawned server sees a stale deployment and redeploys the unchanged embed (identical content, stamp `d352a6a32158`), as any built server does on a stale instance; read the version back afterwards |
| AC-7 | the capstone entry removed from `gateTestFiles` | `live-gate-roster.test.ts` |

### Implementation record (2026-10-16)

**Epic-close records (AC-7).**
- `:check`: `pnpm gen:governance-baseline:check` exited 0. Frozen foundation keys 141 (hash `1e62c5ad5bf7`), live keys 206, post-foundation new keys 65: "OK -- every frozen foundation key still exists in the live surface." The baseline file shows no diff.
- Counts: tools unchanged (dev 31 package / 32 runtime, suite 107 package / 112 runtime, dev `core` 14 package / 15 runtime; the `measure:tools-payload` run shows dev 32 / 15 / 32 visible). Prompts 11 -> 12 (dev 4 -> 5), skills 12 (`gen:skills` "13 file(s) from 12 prompt(s)"; `validate-prompts: OK -- 24 source(s) checked (12 prompt(s) + 12 generated skill(s))`).
- `BOOTSTRAP_VERSION`: Story 38.6 `d352a6a32158` -> `d352a6a32158` (no ObjectScript change; `pnpm gen:bootstrap` regenerated the same content, `git diff --stat -- packages/shared/src/bootstrap-classes.ts` empty). Epic 38: `2159ec9e6f69` -> `d352a6a32158`.
- Deployed version (decision #16): the read-only query `SELECT ExecuteMCPv2.Setup_GetBootstrapVersion() AS Version` through `iris_sql_query` (`server:"default"`, `namespace:"HSCUSTOM"`) returned `d352a6a32158` before the AC-6 mutation and again after the revert, a clean rebuild of shared (dist file `shasum` identical to the backup) and one more armed capstone start (6 passed). The instance was never left on a mutated marker: the shipped embed carries its own `Parameter BOOTSTRAPVERSION = "d352a6a32158"`, so only the exported constant of the dist was mutated.
- `node scripts/check-epics-sync.mjs`: exit 0, `OK: no genuine drift (all absences are the documented expected class; no orphans).` (229 sprint keys, 229 `epics.md` sections, 0 genuine drift, 0 orphans, 0 duplicates).
- Payload re-measure (`pnpm measure:tools-payload` after the rebuild): dev full and developer 32 / 84,218 / ~21,055 (was 84,040 / ~21,010), dev core 15 / 43,392 / ~10,848 (was 43,214 / ~10,804); the other four servers are unchanged. The README table and its "Last re-measured at Story 38.6" sentence match.
- `git diff --stat 8f134196ae80fcbbfc4d915195ddbc01c072f7b6 -- packages/shared/src/governance-baseline.ts packages/shared/src/baseline-classifications.ts ipm/module.xml src/` is empty.
- Live instance: `iris_doc_list` (`generated:true`) and `iris_global_list` with the filter `QaStory38` (`server:"default"`, `namespace:"HSCUSTOM"`) are empty after the last run; each capstone run also asserts no `QaStory386Cap` document, global or table in `beforeAll` and `afterAll`.

**Results on the final tree.**
- Per package (build, test, lint, type-check): shared 1601 tests; dev 1392 (57 files, live gates included); admin 498; interop 343; ops 350; data 165; client-config 514; all `pnpm --filter @iris-mcp/all test` 414 tests in 38 files (the default suite, the three live gates among them). Lint is clean (one existing warning in shared).
- `(loop)` lines: dev doc-edit, execute, test-status and prompts 234 tests; ops, interop and admin `prompts.test.ts` pass; `gen:skills`, `gen:skills:check` and `validate:prompts` clean; the 15-file all docs and prompts set 179 tests (story-38-6-doc-claims 33).
- Live gates, each in its own call, armed with the six `IRIS_*` variables and `IRIS_REQUIRE_LIVE=1`: capstone 6 passed; Story 38.4 wire gate 10 passed; Story 38.5 wire gate 28 passed; dev `doc-edit-live-gate` (`--no-file-parallelism`) 10 passed. None was skipped.
- Unarmed or armed with an unreachable instance (a closed local port, `IRIS_PORT=59999`): the capstone skips all 6 tests and logs `[SKIP] epic38-capstone-gate: IRIS is not reachable at ...`; armed it throws `IRIS_REQUIRE_LIVE is set, so the Epic 38 capstone gate may not be skipped: IRIS is not reachable at ...`. A stale shared dist, armed, produced the same "may not be skipped" error with the staleness reason.
- Version mismatch rows (`dev`, an older hash, an empty version, no row) are covered without IRIS by the new `bootstrap-version-check.test.ts` (8 tests: the SELECT is sent, a match returns the version, each mismatch names both values, a route error is named, and the raw `GET /doc` oracle returns `ts` and lines).

**Mutations (Rule #19).** Each was applied, observed red, reverted by restoring the backed-up file, and checked with `shasum` of the file and an unchanged `git status --short` and `git diff --stat`; every dist touched was rebuilt.
- mutation: AC-1 "enabled by default" removed from the `tool_support.md` `iris_doc_edit` row, and the `IRIS_SQL_READ_ONLY` row dropped from `cursor.md` -> `story-38-6-doc-claims` 2 tests went red (the `tool_support.md` row 30 test, the `cursor.md` variables test).
- mutation: AC-1 `--no-file-parallelism` removed from `vitestArgs` in `packages/iris-mcp-all/scripts/prepublish-gate.mjs` -> `story-38-6-doc-claims` "vitest runs the gate files with --no-file-parallelism" went red.
- mutation: AC-2 `editAndTestClassPrompt` removed from the dev prompt array (dev dist rebuilt) -> dev `prompts.test.ts` 5 tests, `docs-prompt-sync` 3 tests, `validate-prompts` 1 test and `pnpm gen:skills:check` (exit 1, stray `skills/edit-and-test-class`) went red.
- mutation: AC-2 step 10, the `total`-vs-`Test*` sentence, removed from the `editAndTestClass.ts` body (dev dist rebuilt) -> `prompt-safety-invariants` 2 tests went red (the step-order test and the running-result and rerun test).
- mutation: AC-3 `findStaleEdits` returns an empty list before comparing (dev dist rebuilt) -> `epic38-capstone-gate` leg 3 went red (`isError` was undefined: the stale edit was applied and stored) on the path built dev server over stdio -> `iris_doc_edit` -> Atelier `GET` then `PUT`; legs 5 and 6 stayed green.
- mutation: AC-4 `current: joinLines(entry.current) + "\n"` back to `joinLines(entry.current)` -> `doc-edit.test.ts` 12 tests went red (3 refusal-shape pins and 9 round-trip rows, including the range that ends in an empty line); with the dev dist rebuilt, capstone leg 3 went red at the refusal's `current` shape (`"\tSet tSC = $$$OK\n\n"`).
- mutation: AC-5 the `buildRunningHint` query back to `iris_sql_execute` -> the `execute.test.ts` DW-555 pin went red (1 test); the `deploy-and-test-class` body's `iris_sql_query` back to `iris_sql_execute` (dev dist rebuilt) -> the `prompt-safety-invariants` deploy test went red (1 test).
- mutation: AC-6 the exported `BOOTSTRAP_VERSION` in `packages/shared/dist/bootstrap-classes.js` changed from `d352a6a32158` to `d352a6a32159` -> the capstone, the 38.4 wire gate and the 38.5 wire gate each failed in `beforeAll` with `The deployed ExecuteMCPv2 classes report BOOTSTRAP_VERSION "d352a6a32158" but the shipped embed ... is "d352a6a32159"` (every test skipped by the failed hook, no leg ran); reverted by a clean rebuild of shared, see the deployed-version record above.
- mutation: AC-6 the comparison `deployed !== shipped` disabled in `assertDeployedBootstrapVersion` -> `bootstrap-version-check.test.ts` 4 mismatch tests went red.
- mutation: AC-7 the capstone entry removed from `gateTestFiles` -> `live-gate-roster.test.ts` (the iris-mcp-all case) and the `story-38-6-doc-claims` roster test went red.

**Review patches (Rule #19; each applied, observed red, reverted from a backup copy with `cmp` identical and `git status --short` / `git diff` fingerprints unchanged, dev dist rebuilt where it was touched).**
- mutation: AC-5 the dev README re-attach section's `iris_sql_query` back to `iris_sql_execute` -> `story-38-6-doc-claims` "the iris_execute_tests re-attach section sends the manual %UnitTest_Result query to iris_sql_query" went red.
- mutation: AC-1 the dev README phrase "an empty value counts as unset" removed -> `story-38-6-doc-claims` "the SQL write safety note states the accepted values..." went red.
- mutation: AC-1 a newer CHANGELOG section inserted above the 38.6 section -> `story-38-6-doc-claims` and `story-38-5-qa-doc-claims` stay green (the section is found by heading, the re-measure sentence by shape).
- mutation: AC-5 the `deploy-and-test-class` predicate `WHERE ti.InstanceIndex = ?` back to `= <runIndex>` (dev dist rebuilt) -> `prompt-safety-invariants` "deploy-and-test-class sends the manual %UnitTest_Result query to iris_sql_query" went red.
- mutation: AC-2 `iris_test_status` added to the `edit-and-test-class` step 9 text (dev dist rebuilt) -> `prompt-safety-invariants` "every iris_* token of edit-and-test-class is a dev core tool..." went red.
- mutation: AC-3 the capstone's `iris_global_list` oracle filter made blind (`QaStory386CapNope`) -> legs 4, 5 and 6 went red at "the global oracle sees the data global" (live, armed); the leaked globals were purged by the next clean run.
- mutation: AC-3 the capstone's global kill loop disabled (`continue` before the kill) -> the `afterAll` hook failed with "no QaStory386Cap global after the run" (live, armed); the leaked `^ExecuteMCPv2.QaStory386CapRD` was purged by the next clean run (its `beforeAll` asserts none remain), and the final `iris_doc_list` and `iris_global_list` with the filter `QaStory386` came back empty.
- mutation: AC-3 the capstone's armed throw disabled (`if (skipReason && REQUIRE_LIVE && false)`) -> `epic38-gate-guards` "armed, with IRIS not reachable: the capstone fails in beforeAll" went red; the throw made unconditional (`if (skipReason)`) -> "unarmed, with IRIS not reachable: every capstone test is skipped" went red. Path: the capstone file in its own vitest process, closed local port.
- mutation: AC-6 the `assertDeployedBootstrapVersion` call removed from the 38.5 wire gate's `beforeAll` -> `epic38-gate-guards` "story-38-5-qa-sql-wire-gate.test.ts calls assertDeployedBootstrapVersion right after its admin session opens" went red.

**Results after the review patches.**
- `(loop)`: dev 234 tests; ops, interop and admin `prompts.test.ts` pass; `gen:skills`, `gen:skills:check` (13 files match) and `validate:prompts` (24 sources, 12 prompts + 12 skills) clean; the 17-file all set 193 tests (adds `bootstrap-version-check` 8 and `epic38-gate-guards` 5); the four live gates, each in its own call, armed: capstone 6, 38.4 gate 10, 38.5 gate 28, dev `doc-edit-live-gate` 10, none skipped.
- `(once)` after the last patch: `pnpm gen:bootstrap` regenerated `d352a6a32158` with no diff (a `touch` of `packages/shared/dist/bootstrap-classes.js` then restored the dist mtime that `checkDistFresh` compares); per package build, test, lint and type-check: shared 1601, dev 1392, admin 498, interop 343, ops 350, data 165, client-config 514 tests, and `@iris-mcp/all` 39 files, 420 tests; `:check` exit 0 (141 frozen keys, 206 live, 65 post-foundation); `check-epics-sync` OK; the payload re-measure equals the README rows; the guarded files and `src/` show no diff since the foundation commit; `iris_doc_list` (`generated:true`) and `iris_global_list` with the filter `QaStory386` (`server:"default"`, `namespace:"HSCUSTOM"`) empty.

**Notes for the lead.**
- `pnpm gen:bootstrap` rewrites `packages/shared/src/bootstrap-classes.ts` with identical content, which raises its mtime above the shared dist; `tsc` then does not re-emit, `checkDistFresh` reports the dist stale, and armed gates throw "may not be skipped". It was fixed here by removing `packages/shared/dist` and `packages/shared/tsconfig.tsbuildinfo` and rebuilding shared. Run the `(once)` `gen:bootstrap` check before, not between, the live gates, or rebuild shared after it.
- The matrix row "a CRLF document" is covered as an `expected` written with CRLF line breaks against LF-based lines: Atelier `content` elements carry no line terminators (rule #54), so a CR-terminated stored line cannot occur.
- In the promoted helpers, a raw Atelier failure is a thrown `Error` (it was a vitest `expect` failure inside the 38.5 gate); the gates' own assertions are unchanged.
- `iris-mcp-all` has no `type-check` script. A manual `tsc --strict` over its new and changed gate and test files reports one error, at an unchanged line of `story-38-5-qa-sql-wire-gate.test.ts` (`withSession(env, ...)` with a `{ IRIS_SQL_READ_ONLY?: undefined }` union), which was there before this story.

### QA record (2026-10-16)

**Tests added (QA).**
- `packages/iris-mcp-all/src/__tests__/story-38-6-qa-edit-prompt-sdk-wire.test.ts` (QA; default suite, no IRIS, 8 tests): a real SDK `Client` over `InMemoryTransport.createLinkedPair()` against the built `McpServerBase` with the dev dist tools, presets and prompts (rule #46). It pins `initialize` advertising `prompts`; `prompts/list` (five names, `edit-and-test-class` last, `className`/`change` required, `testClass` optional); `prompts/get` with `testClass` omitted (twelve steps in order, each with its content) and given (the test step names it); `prompts/get` with `arguments` omitted entirely (a prompt with required arguments is a clean InvalidParams naming it, the connection stays usable, `objectscript-review` renders from the same omission); `deploy-and-test-class` (in-place route, `iris_sql_query`, never `iris_sql_execute`); `tools/list` serving the DW-552 sentence and the DW-555 description; every `iris_*` token being a real tool, and those of `edit-and-test-class` visible under `IRIS_TOOLS_PRESET=core`; and no rule number or repository path in either prompt.

**Gap analysis (no further test needed).**
- AC-4, DW-552 on the real wire: capstone leg 3 refuses a stale range ending in an empty line, asserts the exact `current` (`"\tSet tSC = $$$OK\n\n"`) and the unchanged stored document, then passes `current` back as `expected` and asserts the stored result. The other range shapes stay in the `doc-edit.test.ts` rows; the real Atelier last element of a class is an empty string (probed read-only on `ExecuteMCPv2.Setup.cls`), the shape those rows fake.
- AC-2, AC-5 skills: `pnpm gen:skills:check` ("13 generated file(s) match source") and `pnpm validate:prompts` ("24 source(s) checked (12 prompt(s) + 12 generated skill(s))") clean.
- AC-3, rule #59: the recorded AC-3 mutation (`findStaleEdits` returns an empty list, dev dist rebuilt) names the path the gate guards (the built dev server over stdio, `iris_doc_edit`, Atelier `GET` then `PUT`); the capstone's `DEV_ENTRY` is that dist, `prepublish-gate.mjs` arms it with `IRIS_REQUIRE_LIVE=1` and lists it in `gateTestFiles`, and `epic38-gate-guards.test.ts` pins the armed and unarmed branches. Leg 3 has two independent red points under a `current` without the trailing line break (the exact-shape assertion, and the retry that stays stale). Not re-run destructively.

**Mutations (rule #19).** Each applied to a built `iris-dev-mcp` dist file (gitignored), observed red, restored from a backup copy, and checked with `shasum` against the pre-mutation hashes; `git status --short` unchanged throughout.
- mutation: AC-2 `isArgProvided(args.testClass)` made always false in `dist/prompts/editAndTestClass.js` -> `story-38-6-qa-edit-prompt-sdk-wire` "names the test class in the test step when testClass is given" went red (1 test).
- mutation: AC-2 `editAndTestClassPrompt` removed from `dist/prompts/index.js` -> 6 of 8 tests went red (list, render, given, omission, hygiene, tool tokens).
- mutation: AC-2 a non-core tool (`iris_test_status`) added to the `edit-and-test-class` step 9 text in the dist -> "every iris_* token ... visible under the core preset" went red.
- mutation: AC-5 the `deploy-and-test-class` manual query `iris_sql_query` back to `iris_sql_execute` in the dist -> "deploy-and-test-class names the in-place route and the iris_sql_query manual query" went red.
- mutation: AC-4 "can be passed back as" changed in the `iris_doc_edit` description in `dist/tools/doc-edit.js` -> "tools/list serves the DW-552 sentence ..." went red.
- mutation: AC-5 `iris_sql_query over` changed to `iris_sql_execute over` in the `iris_execute_tests` description in `dist/tools/execute.js` -> the same test went red.

**Results.** The new file passes in file order and under two shuffled orders (seeds 7 and 991). `pnpm --filter @iris-mcp/all exec vitest run --no-file-parallelism` with the six explicit `IRIS_*` variables: 40 files, 428 tests pass (420 plus 8). The armed capstone: 6 passed, none skipped. After the runs `iris_doc_list` (`generated:true`) and `iris_global_list` with the filter `QaStory38` (`server:"default"`, `namespace:"HSCUSTOM"`) are empty. A manual `tsc --strict` over the new file reports no error in it (the one error is in the unchanged `process-gate-helpers.ts`, an `.mjs` import with no declaration).

### Code review record (2026-10-16)

**Patches.** The README refusal table's two SQL rows now name each variant and remedy. The three client-config guides now state what the ceiling refuses and that a call can only tighten either variable. The prepublish comment now gives the bootstrap-overlap reason. The version-check message now names the gate's own failed bootstrap. The `core` size is "8- to 15-tool", derived from the payload table. `deploy-and-test-class` step 2 has its package-wide exit back, and the skill was regenerated with `pnpm gen:skills`. `epic38-gate-guards` binds each arming case to the reason the capstone derives and pins the dist-freshness checks of all three gates. The capstone header is corrected.

**Mutations (Rule #19).** Each was applied with the backups in place, observed red, and reverted with `cp -p` from the backup. `shasum` of every touched file, `git status --short` and `git diff --stat` were identical to before.
- mutation: AC-1 the README `SQL_READ_ONLY` row's "With `readOnly: true`, run it without `readOnly`." removed -> `story-38-6-doc-claims` "the two SQL rows name each refusal variant and its remedy" went red.
- mutation: AC-1 "; a call's `readOnly: false` cannot weaken it" removed from `cursor.md` -> `story-38-6-doc-claims` "cursor.md lists both variables with their defaults" went red.
- mutation: AC-1 the `claude-desktop.md` core size set back to "~10-tool" -> `story-38-6-doc-claims` "the core preset's stated size spans the smallest and largest core roster" went red.
- mutation: AC-1 the changeset bump `"@iris-mcp/dev": minor` changed to `patch` -> `story-38-6-doc-claims` "the changeset bumps exactly @iris-mcp/dev, minor" went red.
- mutation: AC-6 "that bootstrap failed or did not run" removed from the `assertDeployedBootstrapVersion` message -> `bootstrap-version-check` 4 mismatch tests went red.
- mutation: matrix rows "Unarmed/Armed prerequisites" `?? staleDistReason(REPO_ROOT, "iris-dev-mcp")` dropped from the capstone `beforeAll` -> `epic38-gate-guards` "epic38-capstone-gate.test.ts derives its skip reason from both dists' freshness" went red (before this review nothing did); the capstone's reachability reason text changed -> the unarmed and the armed arming cases went red.
- mutation: AC-2 the `deploy-and-test-class` step-2 exit set back to "Repeat until the class compiles with zero errors." in the built `dist/prompts/deployAndTestClass.js` -> `prompt-safety-invariants` "deploy-and-test-class fixes a class that has no local source in place" went red.
- mutation: AC-2 `(Rule #17)` re-inserted into the built deploy prompt -> `prompt-safety-invariants` "carries no internal rule number and no repository path" and `story-38-6-qa-edit-prompt-sdk-wire` "neither prompt cites an internal rule number or a repository path" went red (with `gen-skills-stray-file`, the drift check over the mutated dist).
- mutation: AC-2 the in-place route sentence removed from the built deploy prompt -> `prompt-safety-invariants` "deploy-and-test-class fixes a class that has no local source in place" and `story-38-6-qa-edit-prompt-sdk-wire` "deploy-and-test-class names the in-place route" went red.
- mutation: AC-3 legs 4-6, in the built dev dist: the `iris_doc_put` Storage guard bypassed (`dropped = []` in `dist/tools/doc.js`), `iris_sql_query` no longer forced read-only, and the operator ceiling ignored (`ceiling = undefined`), both in `dist/tools/sql.js` -> the armed capstone (path: the built dev server over stdio -> `iris_doc_put` / `iris_sql_query` / `iris_sql_execute` -> the Atelier PUT and the ExecuteMCPv2 SQL endpoint) failed legs 4, 5 and 6, each at its refusal assertion (`isError` undefined: the write went through). Legs 1-3 and `afterAll` passed. The deployed `BOOTSTRAP_VERSION` was read as `d352a6a32158` before the run and after it, so nothing was redeployed. The shipped-version mutation was not re-run.

**Results.** The dev loop ran 234 tests. The 18-file `@iris-mcp/all` docs, prompts and gate-guards set passed 206 tests. The armed capstone passed 6 after the restore. The full `@iris-mcp/all` default suite passed 40 files, 433 tests. `gen:skills:check` (13 files) and `validate:prompts` (24 sources) are clean. Dev lint and type-check are clean. `iris_doc_list` (`generated:true`) and `iris_global_list` filtered on `QaStory38` (`server:"default"`, `namespace:"HSCUSTOM"`) are empty.

## Auto Run Result

Status: done
Blocking condition: none

**Implemented change.**
- DW-552: `mismatches[].current` of a `STALE_CONTENT` refusal gains one trailing line break, so `textToLines(current)` returns the addressed lines for every range and `current` passes back as `expected` unchanged; the `iris_doc_edit` description says so.
- DW-555: the `iris_execute_tests` running hint, description, JSDoc, the `presets.ts` header and the `deploy-and-test-class` prompt name `iris_sql_query` for the manual `%UnitTest_Result` query.
- New dev prompt and generated skill `edit-and-test-class` (dev 4 -> 5 prompts, suite 11 -> 12); `deploy-and-test-class` gains the in-place route and loses its two rule citations.
- DW-559 and the Epic 38 capstone: the session, env and Atelier helpers are promoted to `process-gate-helpers.ts` with `assertDeployedBootstrapVersion`; the 38.4 and 38.5 wire gates use them and check the deployed version in `beforeAll`; new `epic38-capstone-gate.test.ts` (six legs, `QaStory386Cap` fixtures); the prepublish gate lists it and runs files one at a time.
- Docs: new "Agent code editing (Epic 38)" section, each default stated on every Docs-table surface, the client-config guides and the launcher README, the CHANGELOG 38.6 section, the changeset (`@iris-mcp/dev` minor), the payload re-measure.
- BOOTSTRAP_VERSION `d352a6a32158` -> `d352a6a32158` for this story (no ObjectScript change; `gen:bootstrap` idempotent); for the epic `2159ec9e6f69` -> `d352a6a32158`. Decision #16: the deployed version read back as `d352a6a32158` after the AC-6 mutation, the revert and one more armed capstone start.

**Files changed.**
- `packages/iris-dev-mcp/src/tools/doc-edit.ts`, `execute.ts`, `presets.ts`: the `current` line break and description sentence; the `iris_sql_query` hint, description and comments.
- `packages/iris-dev-mcp/src/prompts/editAndTestClass.ts` (new), `index.ts`, `deployAndTestClass.ts`: the prompt, its registration and the deploy prompt update; `skills/edit-and-test-class/SKILL.md`, `skills/deploy-and-test-class/SKILL.md` and `skills/README.md` regenerated.
- `packages/iris-mcp-all/src/__tests__/process-gate-helpers.ts`, `epic38-capstone-gate.test.ts` (new), `bootstrap-version-check.test.ts` (new), `epic38-gate-guards.test.ts` (new), `story-38-4-qa-doc-edit-wire-gate.test.ts`, `story-38-5-qa-sql-wire-gate.test.ts`, `story-38-6-doc-claims.test.ts` (new), `prompt-safety-invariants.test.ts`, `docs-prompt-sync.test.ts`, `validate-prompts.test.ts`, `skills-generated-frontmatter.test.ts`; the dev, ops, interop and admin `prompts.test.ts`, the dev `doc-edit.test.ts`, `doc-edit-live-gate.test.ts` and `execute.test.ts`: the new and moved pins.
- `packages/iris-mcp-all/scripts/prepublish-gate.mjs`: the capstone entry and `--no-file-parallelism`.
- `README.md`, `packages/iris-dev-mcp/README.md`, `tool_support.md`, `docs/client-config/claude-code.md`, `claude-desktop.md`, `cursor.md`, `extensions/iris-mcp-launcher/README.md`, `CHANGELOG.md`, `.changeset/story-38-6-editing-and-sql-safety-docs-prompt-and-capstone.md`.

**Review findings.** 32 findings, mechanically counted from the Review Triage Log: high 0, medium 6, low 22, false 3, maybe-false 1.
- Patches applied: 13 rows over 8 root causes. The dev README's stale `iris_sql_execute` re-attach bullet (medium, found by four layers); the capstone's cleanup oracles lacking a positive control (medium); the missing automated pin of the capstone's arming rows (medium) and of the three gates' version-check call; the position-dependent CHANGELOG and re-measure pins in `story-38-6-doc-claims`; the `= <runIndex>` vs `parameters` predicate of the deploy prompt; the loose core-only token pin of `edit-and-test-class`; the empty-value-is-unset doc phrase; and the stale 11-prompt header comment.
- Deferred: 1 (the capstone's re-implemented fixture helpers, low, in the frontmatter `deferred:` list), plus the plan-time annotation-divergence item.
- Rejected: 18, each with its reason in the log. The substantive ones: the `STALE_CONTENT` text sentence (the intent freezes the text block), the DW-559 scope for the in-process gates (orchestrator decision #16), and the prepublish-only `--no-file-parallelism` (spec Tasks).

**Follow-up review recommendation: true.** Three medium entries were patched. The named unverified risk is the new `epic38-gate-guards.test.ts`, which runs the capstone in a nested vitest process (`spawnSync` of `process.execPath` on the resolved `vitest.mjs`) and was verified on macOS only; a different OS or runner layout is not demonstrated.

**Verification performed.** Every `(loop)` line was run after the last patch and the `(once)` lines once, as recorded under `## Verification`: package suites green, four armed live gates pass with none skipped, `:check` exit 0 at `1e62c5ad5bf7`/141, `gen:bootstrap` idempotent, `check-epics-sync` OK, the payload table equals the re-measure, guarded files and `src/` unchanged, and no `QaStory386` leftovers on the instance. The Matrix Test Audit found no uncovered row once the arming rows got `epic38-gate-guards.test.ts`.

**Residual risks.**
- DW-559 covers the capstone and the 38.4 and 38.5 wire gates; the in-process dev-package gates and `epic35-defect-gate` still test whatever is deployed (decision #16 and plan interpretation 1).
- The default `@iris-mcp/all` suite runs the three bootstrapping gates in parallel; only the prepublish script is serial. A race needs a stale deployment, and a bootstrap redeploy is idempotent.
- `pnpm gen:bootstrap` rewrites `bootstrap-classes.ts` with identical content and raises its mtime above the shared dist, so armed gates report a stale dist until shared is rebuilt or the dist file touched.
- `iris-mcp-all` has no `type-check` script; a manual strict `tsc` over its changed tests shows one error in an unchanged line of the 38.5 gate.
