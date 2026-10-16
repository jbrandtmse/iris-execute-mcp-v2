---
title: 'Story 38.6: Editing and SQL Safety Docs, Prompt and Capstone'
type: 'feature'
created: '2026-10-16'
status: 'ready-for-dev'
review_loop_iteration: 0
followup_review_recommended: false
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

## Spec Change Log

## Review Triage Log

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
- `(loop)` `pnpm --filter @iris-mcp/all exec vitest run src/__tests__/docs-prompt-sync.test.ts src/__tests__/validate-prompts.test.ts src/__tests__/skills-generated-frontmatter.test.ts src/__tests__/gen-skills-stray-file.test.ts src/__tests__/prompt-safety-invariants.test.ts src/__tests__/live-gate-roster.test.ts src/__tests__/story-38-6-doc-claims.test.ts src/__tests__/story-38-0-qa-doc-claims.test.ts src/__tests__/story-38-1-qa-doc-claims.test.ts src/__tests__/story-38-2-qa-doc-claims.test.ts src/__tests__/story-38-3-qa-doc-claims.test.ts src/__tests__/story-38-5-qa-doc-claims.test.ts src/__tests__/docs-visibility-roster-sync.test.ts src/__tests__/docs-governance-cli-recipes.test.ts src/__tests__/measure-tools-payload.test.ts` -- expected: pass.
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

## Auto Run Result

Status: ready-for-dev
Blocking condition: none

Planning only (the invocation said "Halt after planning."). The spec passed the READY FOR DEVELOPMENT gate on the first check. Nothing was implemented, and nothing was written to IRIS.
