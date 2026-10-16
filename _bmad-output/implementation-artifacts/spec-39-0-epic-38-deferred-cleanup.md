---
title: 'Story 39.0: Epic 38 Deferred Cleanup'
type: 'bugfix'
created: '2026-10-16'
status: 'ready-for-dev'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/.claude/rules/project-rules.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-iris-execute-mcp-v2-2026-10-14/ARCHITECTURE-SPINE.md'
warnings:
  - multiple-goals
  - oversized
deferred: []
---

<intent-contract>

## Intent

**Problem:** Epic 38 left three ledger entries.
- **DW-565.** A governance key inside a layer that names nothing a server enforces is accepted silently and does nothing. Examples: `{"global":{"iris_doc_putt":false}}`, or a bare `"iris_doc_edit": false`, which leaves the default-enabled `iris_doc_edit:apply` enabled. Governance fails open one level below DW-554.
- **DW-543.** The `makeEnvHarness` test helper is copied into 43 test files, and the copies scrub different subsets of the startup variables. In the plan probe, a hostile developer environment turned 35 test files red across six packages: 25 harness copies and 10 other files.
- **DW-567.** The `iris_doc_list` `type` description offers `'cls'` for category CLS, which Atelier answers with HTTP 400.

**Approach:**
- **DW-565.**
  - Each server warns at startup about keys it can prove are dead: the key names a tool it registers, but is none of that tool's keys.
  - A new `iris-mcp-governance check` command checks every key against the suite's full key universe, which the `universe` command already loads. It exits 1 when a key matches nothing.
- **DW-543.** Promote one env harness, plus one per-file setup scrub, into `packages/shared/src/__tests__/`. That directory never ships. Move all 43 copies onto it.
- **DW-567.** Replace the example with one shared, probe-verified text.

## Boundaries & Constraints

**Always:**
- **No IRIS writes of our own.** This story's own tests never write to IRIS.
  - The `CLEAN` and `HOSTILE` runs use the closed port `127.0.0.1:1`.
  - Armed runs name all six `IRIS_*` variables (`ENV`, under Verification).
  - MCP calls use `server:"default"` and `namespace:"HSCUSTOM"`.
- **Valid input behaves identically.** For a valid governance document, every key in the suite universe, all of these are byte-identical to today: startup, the effective policy, `iris_server_profiles`, and the `validate`, `effective`, `diff` and `universe` outputs.
- **Startup never fails on a dead key inside a layer.** It warns only. Messages name keys and never echo a value. Each message follows `<what happened>. <what to do about it>.`
- **Counts stay put.**
  - No MCP tool, action, governance key, preset row or prompt changes. The new `check` subcommand is not an MCP tool and moves no tool count.
  - The counts stay at dev 31 package / 32 advertised tools, suite 107 / 112, and 12 prompts.
  - `GOVERNANCE_BASELINE` stays `1e62c5ad5bf7`/141. Check it with `:check` only.
  - `BOOTSTRAP_VERSION` stays `089f8f0a62b2`. There is no ObjectScript change.
- **Test helpers stay unpublished.** They live only under `packages/shared/src/__tests__/`, which is excluded by `files: ["dist", "!dist/**/__tests__"]`. Consumers reach them through the existing `@iris-mcp/shared/test-helpers` export or a relative path. `packages/shared/package.json` stays byte-identical; DW-506 belongs to Story 42.1.
- **Build first.** Rebuild shared first, then every package, before any suite run. Dists were stale at plan time: `client-config` src is newer than its dist, and the `@iris-mcp/all` doc-claims tests go red on stale dists.
- **No heredocs (Rule #55).** Write the 43-file migration with the file tools, never a shell heredoc, and check it with `git diff --stat`.

**Never:**
- **Governance.**
  - No generated suite-key artifact in `@iris-mcp/shared`.
  - No server that loads another package's dist.
  - No fail-fast on keys inside a layer.
  - No change to the behavior of `validate`, `set` or `unset`, or to `warnIfNotBaseline`.
  - `iris_server_profiles` and the governance resource do not report dead keys.
  - Never run the bare governance-baseline generator.
- **Test helpers.**
  - No new `exports` subpath.
  - No helper under `packages/shared/src/test-helpers/`, which ships as `dist/test-helpers/`.
  - Do not migrate the 32 other inline env save/restore blocks.
  - No change to any `vitest.integration.config.ts` or to `extensions/iris-mcp-launcher`.
  - Do not promote the process-gate fixture helpers (DW-561, Story 39.6). Extend the Story 38.7 process gate in place.
- **Documents.** No client-side refusal of CLS plus a type. DW-567 is a description change only.
- **ObjectScript.** No change under `src/`.

## I/O & Edge-Case Matrix

Message forms. `<src>` is `IRIS_GOVERNANCE` or `IRIS_GOVERNANCE_FILE (path: <p>)`. `<layer>` is `"global"` or `profile "<name>"`, the same labels `validateLayer` uses.
- **(a)** `<src>: "<key>" under <layer> has no effect, because <key> is governed per action. Set the actions you mean instead: <k1>, <k2>, ...`
- **(b)** `<src>: "<key>" under <layer> has no effect, because <tool> takes no action. Use "<tool>" instead.`
- **(c)** `<src>: "<key>" under <layer> has no effect, because <tool> has no action "<action>". Use one of: <k1>, <k2>, ...`
- **(d)** `<src>: "<key>" under <layer> has no effect, because no tool of the suite has this key. Check it for a typo; iris-mcp-governance universe lists every key.`

The tool is the part of the key before its first `:`. Keys are listed in derivation order and joined with `, `.

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| DW-565 bare multi-action name | built dev server; `IRIS_GOVERNANCE={"global":{"iris_doc_edit":false}}` | Keeps running. Exactly one `[WARN]`, form (a): `... Set the actions you mean instead: iris_doc_edit:apply, iris_doc_edit:regenerateStorage.` The policy report equals the no-governance report. | warn only |
| DW-565 action on a single-operation tool | dev server; `{"global":{"iris_doc_put:apply":false}}` | One `[WARN]`, form (b) ending `Use "iris_doc_put" instead.` | warn only |
| DW-565 unknown action, file, profile layer | interop server; file `{"profiles":{"default":{"iris_production_control:strat":false}}}` | One `[WARN]`, form (c), source `IRIS_GOVERNANCE_FILE (path: <p>)`, layer `profile "default"`, listing the 6 `iris_production_control:*` keys | warn only |
| DW-565 key of another server, or unknown to the suite | dev server; `{"global":{"iris_production_control":false,"iris_doc_putt":false}}` | No new warning: dev registers neither tool | none |
| DW-565 hidden tool | dev server; `IRIS_TOOLS_DISABLE=iris_doc_edit`; `{"global":{"iris_doc_edit":false,"iris_doc_edit:apply":false}}` | One form (a) warning, for the bare key only. Hidden tools count as registered. | warn only |
| DW-565 valid document | each `STARTING` document of the 38.7 process gate; a document holding every key of `universe`, on both channels | No line containing `has no effect`. The reported policy and attribution equal the direct engine render of the same document (`getEffectivePolicy` and `getEffectiveConfigSources`). | none |
| DW-565 `check`, everything matches | `check --file <valid> --root <repo>` | Exit 0. stdout: `OK: all <M> key(s) in <sources> match the suite's <K> governance keys.` `<K>` is the `universe` key count (207 on 2026-10-16), derived, never hard-coded. | none |
| DW-565 `check`, dead keys | a file with `iris_doc_putt`, `iris_doc_edit` and `iris_doc_put:apply`; optionally `IRIS_GOVERNANCE` too | Exit 1. stderr: one form (a), (b), (c) or (d) line per key, then `Error: <N> of <M> key(s) in <sources> have no effect on any server.` | exit 1 |
| DW-565 `check --json` | the same inputs | Exactly one stdout object: `{"ok","sources","checked","universeKeys","universeSource","unmatched":[{"source","layer","key","message"}]}` | exit 0 or 1 |
| DW-565 `check` sources | `IRIS_GOVERNANCE` set and no file; `--file` set; both | Sources are checked env first, then file. `<sources>` is `IRIS_GOVERNANCE`, `IRIS_GOVERNANCE_FILE (path: <p>)`, or both joined with ` and `. | none |
| DW-565 `check` errors | no file and no `IRIS_GOVERNANCE`; an invalid document; `--root /nonexistent`; a positional argument or an unknown option | No input: exit 2, `Error: "check" needs a governance document: pass --file <path>, or set IRIS_GOVERNANCE_FILE or IRIS_GOVERNANCE.` plus usage. Invalid document: exit 1 with the server loader's exact text, `--json` `{"ok":false,"error"}`. Missing dist: exit 1 with the universe loader's message. Bad arguments: exit 2. | as stated |
| DW-543 harness | every `STARTUP_ENV_VARS` and `CONNECTION_ENV_VARS` name set to a hostile value | After `setup()`: every startup variable is unset. The connection variables are `u`/`p`/`default.example.com`/`DEFAULTNS`, with `IRIS_PORT`/`IRIS_HTTPS` unset, or all unset with `connection:"unset"`. After `teardown()`, each value is restored exactly. | none |
| DW-543 every suite | `HOSTILE` | Each default suite (shared, dev, admin, interop, ops, data, client-config, all) has 0 failed, and passed and skipped equal the `CLEAN` run | none |
| DW-543 roster | a non-test source in shared or a server package reads a variable not in the lists, or a listed variable is read nowhere | `startup-env-roster.test.ts` fails, naming the variable | test red |
| DW-567 descriptions | the dev `tools/list` | The `type` description of `iris_doc_list`, `iris_package_list` and `iris_doc_export` is one text. It does not offer `'cls'` for CLS. It says CLS takes no type filter. Every example in it is accepted by Atelier. | none |

</intent-contract>

## Code Map

**DW-565, governance engine.** `packages/shared/src/governance.ts`:
- `validateLayer` (:263-293): the layer labels `'"global"'` and `` `profile "${name}"` ``.
- `parseGovernanceRoot` (:354-410): unchanged.
- `unknownProfileWarnings` (:420-432): the sibling to follow. It is a pure function returning warning strings, with the same source labels.
- `governanceKeysOfTool` (:671-678): private. It is the gate's own derivation (`tool:action` per enum value, else `tool`).

**DW-565, server.** `packages/shared/src/server-base.ts`:
- The constructor registers only VISIBLE tools into `this.tools` (:642-654), plus the framework tool (:673). `this.options.tools` (:548) holds every package tool, hidden ones included.
- `start()` parses governance at :2019 and :2031. The unknown-profile warning loop is at :2033-2046; add the new findings in that loop, with `logger.warn`.
- `computeGovernanceKey` (:1207-1240) falls back to the bare tool key for a non-member action. That is why form (b) and form (c) keys are dead.

**DW-565, CLI.** `packages/shared/src/cli/governance.ts`:
- `HELP_TEXT` (:524-613) and `VALUED_OPTIONS` (:195). A source-scan test cross-checks every `parseArgs` call against `VALUED_OPTIONS`; `check` uses only `--file` and `--root`.
- Helpers: `resolveFilePath` (:247), `loadFileOrThrow` (:263), `noFileError` (:270).
- Unchanged: `cmdValidate` (:621-653, the pattern for the `--json` contract) and `warnIfNotBaseline` (:505).
- `cmdUniverse` (:1274-1490): the dist load and key derivation (:1321-1378) becomes one helper shared with `check`. Its dependencies are `resolveContainerDir` (:1194), `candidateToolEntries` (:1216) and `defaultLoadPackageTools` (:1233).
- The `runCli` dispatch (:1548-1570) and its unknown-command list. `governance-cli.test.ts:91` pins the prefix `validate, get, set, unset, preset, effective, diff`, so append `, check` at the end.
- `deriveKeysForTool` and `SERVER_PACKAGES` live in `governance-baseline-derivation.ts`.

**DW-565, tests to extend.**
- `packages/shared/src/__tests__/governance-cli-universe.test.ts`: the patterns for the real built dist plus an injected loader.
- `governance-cli-e2e.test.ts`: spawns the built bin, with captured strings.
- `governance-enforcement.test.ts`: the 38.7 `start()` warning rows.
- `packages/iris-mcp-all/src/__tests__/story-38-7-qa-governance-process.test.ts` (380 lines). Reuse its `startStub` (:88), `runToExit` (:119), `writeGovernanceFile` (:130), `governanceReport` (:138), `STARTING` (:241) and the unknown-profile describe (:309-380).

**DW-565, docs.**
- Root `README.md`: the CLI table (:198-219) and the CLI sentence (:427).
- Add a new paragraph after the governance paragraph at :379. Do not edit :379 itself, because the 38.x doc-claims tests pin it.
- `packages/shared/README.md` (:112-118).
- The precedents: the `CHANGELOG.md` top section, and `.changeset/story-38-7-epic-38-burn-down.md`. Doc-claims tests find CHANGELOG sections by title, so a new top section is safe.

**DW-543, the copies.** `grep -rln "function makeEnvHarness"` finds 43 files: shared 15, dev 8, admin 9, interop 6, ops 5.
- 26 copies are byte-identical. The canonical one is `packages/iris-dev-mcp/src/__tests__/loc-e2e.test.ts`. It saves 6 variables, deletes `IRIS_GOVERNANCE` and `IRIS_PROFILES`, sets the four connection defaults, and mocks fetch, exit and console error/warn/info.
- 12 other shapes:
  - the shared copies call `bootstrapSpy.mockClear()`;
  - most shared copies leave the connection variables alone;
  - `governance-cross-server(-coverage)` and dev `env-diff-cross-profile` mock no fetch;
  - `governance-preset-cross-surface` returns `exitMock`;
  - several copies have wider clear-lists: `governance-file` (`GOVERNANCE_ENV_VARS` :809-821), `doc-get-range-framework` (`CLEARED_ENV` :52-62), `tool-visibility-surfacing`, `governance-enforcement` and `governance-preset(-cross-surface)`.
- 32 other test files have their own inline `savedEnv` blocks. They are not migrated.

**DW-543, support files.**
- `packages/shared/src/__tests__/test-helpers.ts` (90 lines; imports `vi`). It is exported as `@iris-mcp/shared/test-helpers`, which points at src, and is used by about 50 files.
- `packages/shared/package.json` has three `test-helpers` subpaths pointing at src. Plan-time `npm pack --dry-run` shows 0 `__tests__` paths, but does show that `dist/test-helpers/integration-config.*` ships.
- The env variables read by the non-test source of `packages/shared/src` (grep, 2026-10-16). The server packages read none (AD-3). The 33 names split into:
  - **6 connection:** `IRIS_HOST`, `IRIS_PORT`, `IRIS_USERNAME`, `IRIS_PASSWORD`, `IRIS_NAMESPACE`, `IRIS_HTTPS`.
  - **3 platform:** `HOME`, `APPDATA`, `XDG_CONFIG_HOME`. They are read only by Server Manager discovery, which is inert while `IRIS_SERVER_MANAGER` is unset.
  - **24 startup:** `IRIS_PROFILES`, `IRIS_TIMEOUT`, `IRIS_ACCEPT_LANGUAGE`, `IRIS_GOVERNANCE`, `IRIS_GOVERNANCE_FILE`, `IRIS_GOVERNANCE_PRESET`, `IRIS_TOOLS_PRESET`, `IRIS_TOOLS_DISABLE`, `IRIS_TOOLS_ENABLE`, `IRIS_SERVER_MANAGER`, `IRIS_SM_SERVERS`, `IRIS_SM_SETTINGS_PATHS`, `IRIS_SM_WORKSPACE`, `IRIS_CREDENTIAL_HELPER`, `IRIS_SQL_MAX_ROWS`, `IRIS_SQL_TIMEOUT`, `IRIS_SQL_READ_ONLY`, `IRIS_SQL_MAX_ROWS_AFFECTED`, `IRIS_TEST_TIMEOUT`, `IRIS_AUDIT_LOG`, `IRIS_AUDIT_LOG_MAX_MB`, `IRIS_AUDIT_LOG_PARAMS`, `LOG_LEVEL`, `MCP_TRANSPORT`.
- `packages/shared/src/logger.ts:55` reads `LOG_LEVEL` once, at import. That is why the scrub must be a vitest `setupFiles` entry, which runs before the test module is imported.
- `packages/*/vitest.config.ts`: shared sets `env:{LOG_LEVEL:"DEBUG"}` (leave it), and `@iris-mcp/all` sets `fileParallelism:false`.
- `packages/iris-mcp-all/src/__tests__/process-gate-helpers.ts`: `inheritedEnv` (:77-87) drops `IRIS_*` and `MCP_TRANSPORT` and is unchanged; `staleDistReason` is at :41. The children of `server-manager-precedence-gate` go red on an ambient `LOG_LEVEL=ERROR`, and the setup scrub removes it.

**DW-567.** `packages/iris-dev-mcp/src/tools/doc.ts`:
- The `docListTool` `type` field is at :635-642. The precedent for a shared text is `MODIFIED_SINCE_DESCRIPTION` (:598).
- The same example appears in `packages.ts:132-139` and `export.ts:264-270`. Both files already import from `./doc.js` (`packages.ts:19`, `export.ts:44`).
- Atelier truth: `irislib/%Api/Atelier/v1.cls` `GetDocNames` (:1675). CLS requires type `*`, and anything else gives 400. RTN takes `mac,int,inc,bas,mvi,mvb`, or a comma list of them. OTH silently drops unknown types. Category `*` takes any extension.
- Plan probe, read-only `GET docnames/<cat>/<type>` on HSCUSTOM, 2026-10-16, IRIS 2026.2 build 221U, Atelier v8:
  - 200: `RTN/mac`, `RTN/int`, `RTN/inc`, `RTN/bas`, `RTN/mvi`, `RTN/mvb`, `RTN/mac,inc`, `*/cls` and `CLS/*`.
  - 400 with an empty error list: `CLS/cls` and `RTN/cls`.
- The payload table is in root `README.md` :676-688 (the dev rows).

## Tasks & Acceptance

**Execution.** The steps are in dependency order: the harness first, because the DW-565 tests use it.

*DW-543: the env harness.*
1. `packages/shared/src/__tests__/startup-env.ts` (new, no `vitest` import): `CONNECTION_ENV_VARS`, `STARTUP_ENV_VARS` (the 24, exhaustive as of 2026-10-16, with the grep as its source), `PLATFORM_ENV_VARS`, and `scrubStartupEnv(): () => void`.
2. `packages/shared/src/__tests__/startup-env.setup.ts` (new): calls `scrubStartupEnv()`.
3. `packages/shared/src/__tests__/env-harness.ts` (new): `makeEnvHarness(options?)`.
   - It takes `{ onSetup?, connection?: "defaults" | "unset", mockFetch?: boolean }`, with the defaults `"defaults"` and `true`.
   - It returns `{ setup, teardown, fetchMock, exitMock }`.
   - It saves every startup and connection variable at construction, scrubs them in `setup`, and restores them in `teardown`, with the canonical copy's mocks.
   - Re-export everything from `packages/shared/src/__tests__/test-helpers.ts`.
4. `packages/{shared,iris-dev-mcp,iris-admin-mcp,iris-interop-mcp,iris-ops-mcp,iris-data-mcp,iris-mcp-all}/vitest.config.ts`: add `setupFiles` pointing at that one setup file. Shared uses `src/__tests__/startup-env.setup.ts`; the others use `../shared/src/__tests__/startup-env.setup.ts`. Do the same for `packages/client-config/vitest.config.ts` only if its `HOSTILE` run is red after the rebuild.
5. The 43 harness files, each under `packages/<pkg>/src/__tests__/<name>.test.ts`:
   - **shared:** governance-classification, governance-cross-server, governance-cross-server-coverage, governance-enforcement, governance-enforcement-coverage, governance-file, governance-preset, governance-preset-cross-surface, governance-resource, governance-resource-coverage, resolve-profile-client, server-discovery, server-discovery.e2e, server-param-integration, tool-visibility-surfacing.
   - **iris-dev-mcp:** doc-get-range-framework, env-diff-cross-profile, env-diff-governance, env-promote-governance, loc-e2e, loc-governance, sqlAnalyze-governance, test-status-governance.
   - **iris-admin-mcp:** audit-governance, audit-governance-coverage, ldap-governance, ldap-governance-coverage, resource-governance, service-governance, service-governance-coverage, x509-governance, x509-governance-coverage.
   - **iris-interop-mcp:** control-governance, control-governance-e2e, defaultSettings-governance, diagram-governance, item-governance, message-resend-governance.
   - **iris-ops-mcp:** backup-e2e, backup-governance, database-governance, health-governance, process-governance.

   In each file:
   - delete the local `makeEnvHarness`, and any clear-list constant only it used;
   - import the promoted one, from `./env-harness.js` in shared and from `@iris-mcp/shared/test-helpers` elsewhere;
   - map the copy's shape onto the options. No assertion changes.
6. Tests for the env harness:
   - `packages/shared/src/__tests__/env-harness.test.ts` (new): the harness matrix row, and each option.
   - `packages/iris-mcp-all/src/__tests__/startup-env-roster.test.ts` (new): scan the non-test `src/**/*.ts` of shared and the five servers, excluding `__tests__/` and `test-helpers/`, for `env.X` and `env["X"]` reads. Assert two-way equality with the three lists, imported from shared's BUILT `dist/__tests__/startup-env.js`. When the dist is stale, fail with `staleDistReason`.

*DW-565: governance keys that name nothing.*

7. `packages/shared/src/governance.ts`: add two exports.
   - `governanceKeysByTool(tools: Iterable<ToolDefinition>): Map<string, string[]>`, built on the private `governanceKeysOfTool`.
   - `unmatchedGovernanceKeys(config, source, keysByTool, scope: "server" | "suite")`, returning `{source, layer, key, message}[]`.
   - It walks `global`, then each profile, in document order. It classifies with forms (a)–(c). A tool missing from the map is skipped in `"server"` scope and gives form (d) in `"suite"` scope. It never reads a value.
8. `packages/shared/src/server-base.ts` `start()`: inside the existing warning loop, log the `"server"`-scope findings of both channels, over `this.options.tools` ∪ `this.tools.values()`. Nothing else changes.
9. `packages/shared/src/cli/governance.ts`:
   - Extract the universe dist-load and derivation into one helper. Both `universe` and `check` call it, and `universe` output stays byte-identical.
   - Add `cmdCheck`: `check [--file <path>] [--root <path>] [--json]`. It reads `IRIS_GOVERNANCE` from the CLI's own env, then the resolved file, and follows the matrix.
   - Add `check` to the dispatch, to the end of the unknown-command list, to `HELP_TEXT` (the command block, and the `--json` read-command list) and to the exit-code text.
10. Tests:
    - `packages/shared/src/__tests__/governance-unmatched-keys.test.ts` (new):
      - the classifier rows for forms (a)–(d) in both scopes;
      - an all-`universe`-keys document gives `[]`;
      - in-process `start()` rows, through `makeEnvHarness`: definitive warnings, the hidden-tool row, other-server keys silent, and the policy `toEqual` unchanged.
    - `packages/shared/src/__tests__/governance-cli-check.test.ts` (new): `runCli` over the real built dist, plus an injected loader for the error rows.
    - Extend `packages/shared/src/__tests__/governance-cli-e2e.test.ts` with built-bin `check` rows: exit 0, 1 and 2, and `--json` with exactly one object.
11. `packages/iris-mcp-all/src/__tests__/story-38-7-qa-governance-process.test.ts`: add a Story 39.0 describe, reusing the file's helpers.
    - The built dev server logs the form (a) and (b) WARN lines for the matrix documents, on both channels, and the policy report equals the no-governance report.
    - Other-server and suite-unknown keys log nothing.
    - The existing `STARTING` rows also assert that no `has no effect` line appears.

*DW-567: the `type` description.*

12. `packages/iris-dev-mcp/src/tools/doc.ts`: export `DOC_TYPE_DESCRIPTION` and use it in `docListTool`, in `packages/iris-dev-mcp/src/tools/packages.ts` and in `packages/iris-dev-mcp/src/tools/export.ts`. The text: `Document type filter within the category: the file extension without the dot. RTN takes 'mac', 'int', 'inc', 'bas', 'mvi' or 'mvb', or a comma list such as 'mac,inc'. CLS takes no type filter (leave it unset). With category '*', 'cls' lists only classes. Default: all types within the chosen category.`
13. `packages/iris-dev-mcp/src/__tests__/doc-type-description.test.ts` (new): pin the three `type` descriptions as `tools/list` advertises them to the constant and to the content in AC-8. Use a real SDK `Client` over `InMemoryTransport.createLinkedPair()` against a constructed dev server (the Rule #46 pattern). The header cites the 2026-10-16 probe.

*Docs.*

14. Docs:
    - Root `README.md`: a `check` row in the CLI table, a new paragraph after :379 (the startup WARN and `check`; valid documents unchanged), and the dev payload rows from `pnpm measure:tools-payload`.
    - `packages/shared/README.md`: add `check` to the bin bullet.
    - `CHANGELOG.md`: a top section `## [Pre-release — 2026-10-16] — Story 39.0: Epic 38 deferred cleanup`, with Added (`check` and the startup WARN; DW-565), Fixed (DW-567) and Tests (DW-543). It states that no count moves.
    - `.changeset/story-39-0-epic-38-deferred-cleanup.md`: `@iris-mcp/shared` minor, `@iris-mcp/dev` patch.
    - `packages/iris-mcp-all/src/__tests__/story-39-0-doc-claims.test.ts` (new): pins the section, the three DW ids, the exact bump map, the README `check` row and the README paragraph.

**Acceptance Criteria:**
- AC-1 (DW-565, startup). Given a built server whose `IRIS_GOVERNANCE` or governance file holds a key that names a tool the server registers (hidden or visible) but is none of that tool's keys, when it starts, then it logs exactly one `[WARN]` per such key in form (a), (b) or (c), keeps running, and reports the same effective policy as without the key. A key whose tool it does not register logs nothing.
- AC-2 (DW-565, CLI). Given `iris-mcp-governance check`, when any key in the checked documents matches no key of the suite universe, then it exits 1 with one message per key and the summary line. Otherwise it exits 0 with the OK line. `--json` writes exactly one object on exit 0 and exit 1. The error rows behave as the matrix says.
- AC-3 (DW-565, back-compat, AD-15). Given any valid document, when a server starts or `validate`, `effective`, `diff` or `universe` run, then nothing changes. A server start logs no `has no effect` line. The CLI outputs are byte-identical to before, and the `universe --json` captures before and after differ by nothing.
- AC-4 (DW-543, harness). Given the promoted harness, when `setup` and `teardown` run under hostile values for all 30 names, then the matrix row holds. `function makeEnvHarness` then exists only in `packages/shared/src/__tests__/env-harness.ts`.
- AC-5 (DW-543, every suite). Given `HOSTILE` in the environment, when each default suite runs, then it has 0 failed, and passed and skipped equal its `CLEAN` run.
- AC-6 (DW-543, roster, Rule #56). Given `startup-env-roster.test.ts`, when a scanned source reads an unlisted variable, or a listed variable is read nowhere, then it fails, naming the variable.
- AC-7 (DW-543, unpublished, DW-506). Given the shared package, when `npm pack --dry-run --json --ignore-scripts` runs, then no path contains `__tests__`, `env-harness` or `startup-env`, and `packages/shared/package.json` is unchanged.
- AC-8 (DW-567). Given the dev server's `tools/list`, when the `type` parameter of `iris_doc_list`, `iris_package_list` or `iris_doc_export` is read, then it equals `DOC_TYPE_DESCRIPTION`. The text contains neither `'cls' for CLS` nor `e.g., 'cls'`, contains `CLS takes no type filter`, and every example in it returned 200 in the plan probe. The README payload rows equal `pnpm measure:tools-payload`.
- AC-9 (docs and counts). Given the delivered tree, when `story-39-0-doc-claims` and the counts checks run, then the CHANGELOG section, the changeset map and the README pins hold, and every count in Boundaries is unchanged.

## Spec Change Log

## Review Triage Log

## Design Notes

**Orchestrator decision #20: DECIDED at the spec gate, 2026-10-16, as recommended (a startup WARN for keys a server can prove dead, plus `iris-mcp-governance check` for keys unknown to the whole suite; never fail-fast). The lead wrote the AD-8 line (Rule 20). The planning text follows.** what should catch a governance key that names nothing (DW-565)?

**Recommended:**
- **(i)** At startup, a server WARNs, and never fails, only on keys it can prove are dead: the tool is registered on that server, but the key is none of its keys. Hidden tools count as registered.
- **(ii)** A key unknown to the whole suite is reported only by the new `iris-mcp-governance check`, which exits 1 when such a key exists.

**Not recommended:**
- **(iii)** A suite-key list generated into `@iris-mcp/shared` for a startup suite check.
- **(iv)** Failing fast on dead keys.

**Evidence for the recommendation:**
- **Plan probe, 2026-10-16** (Node v26.8.1; IRIS 2026.2 build 221U, Atelier v8):
  - `validate` accepts `{"global":{"iris_doc_putt":false,"iris_production_control":false,"iris_doc_put:apply":false},"profiles":{"default":{"iris_sql_execut":false}}}`.
  - `universe --json` has 207 keys: 206 package keys plus the framework key, 41 multi-action tools, 0 baseline-only keys. None of the typo keys is among them.
  - The built dev server on a closed port, with `iris_doc_edit:false` and three other dead keys, logs no governance line and is still running at 4 s. The default-enabled `iris_doc_edit:apply` stays enabled.
- **Why (i) is safe.** Tool names are unique across the suite (the `universe` duplicate guard), so (i) has no false positives. Valid documents are silent, which is AC-3.
- **Why not (iii).** Each npx-launched server resolves its own `@iris-mcp/shared`, so a generated list would go stale under version skew and then falsely report "no tool in the suite". It would also need regenerating in every story that adds a tool (39.1 and 39.5), plus a drift test.
- **Why not (iv).** A document written for a newer server would stop an older one from starting. AD-7 and AD-8 already set the precedent that an unknown name warns.

**For the lead (Rule 20).** If this is decided, add to AD-8's "Governance documents" sub-rule: "A key inside a layer that names a tool registered on the server, but is not one of its keys, logs one `[WARN]` per key and never fails startup. A key matching no tool of the suite is reported by `iris-mcp-governance check`, which exits 1."

**Plan-time interpretations** (apply and report):
- **I1 (DW-543).**
  - "Those variables" means the 24 `STARTUP_ENV_VARS`, a superset of the bullet's list.
  - The six connection variables stay out of `HOSTILE` and out of the setup scrub, because they are the live gates' target. The harness scrubs and defaults them for each test.
  - "Every suite" means the eight default vitest suites. Integration configs and the launcher extension are out (the launcher is not a workspace package, and DW-532 owns its reds).
  - The mechanism has two parts. The `setupFiles` scrub clears ambient values before each test file, which also covers files that do not use the harness: plan probe reds in `server-param`, `server-base`, `audit-*`, dev `index` and `env-promote-execute`, and the `@iris-mcp/all` `server-manager-precedence-gate`. The harness gives per-test isolation.
- **I2 (DW-567, widened under Rule #16).** The same wrong example is in `iris_package_list` and `iris_doc_export`. One constant fixes all three.
- **I3 (DW-543).** "Move the copies" means the 43 named copies. The 32 inline `savedEnv` blocks stay; the setup scrub keeps them green under `HOSTILE`.
- **I4 (DW-565).** "The whole suite" means the `universe` key set: the baseline, the five packages' dist keys and the framework key.

**Governing ADs.**
- **AD-2.** The cross-package roster guard lives in `iris-mcp-all` and reads built dist. Shared never imports a leaf package, and `check` loads dist by file URL.
- **AD-3.** Handlers read no env, which is why the roster guard scans only shared and the servers.
- **AD-4.** The key shapes behind forms (a)–(c).
- **AD-5.** `:check` only.
- **AD-6.** The cascade is unchanged.
- **AD-7.** The unknown-name-warns precedent, and hidden tools.
- **AD-8.** The governance documents sub-rule.
- **AD-9.** Explicit file paths only (J1).
- **AD-15.** Valid input is byte-identical, and the descriptions are corrected.
- **AD-29.** Patch and minor changesets.
- **Conventions:** Error text, Logging, Tool descriptions, Configuration variables, Live testing on a shared instance, Probes.

**Extend, don't copy (Rule 2).**
- `unmatchedGovernanceKeys` follows `unknownProfileWarnings`. It is a separate function because it inspects keys, not profile names.
- `governanceKeysByTool` reuses the gate's `governanceKeysOfTool`.
- `check` reuses the extracted `universe` loader, `resolveFilePath`, `loadFileOrThrow` and `parseGovernanceConfig`.
- `makeEnvHarness` is the 43 copies made one.
- `scrubStartupEnv` serves both the setup file and the harness.
- `DOC_TYPE_DESCRIPTION` follows `MODIFIED_SINCE_DESCRIPTION`.
- The process rows extend the 38.7 gate rather than copying its helpers (DW-561).

**Integration (Rules 1 and 2).**
- **Integration ACs:**
  - AC-1: the `McpServerBase.start()` of the built dev server produces the stderr WARN.
  - AC-2: the built bin produces the exit codes.
  - AC-5: the 43 migrated files and every suite stay green under `HOSTILE`.
- **Consumed-by:**
  - `start()` on all five servers, and `check`, consume `unmatchedGovernanceKeys`.
  - Every new test file in Stories 39.1–39.6 uses `makeEnvHarness`, not a copy.
  - Story 39.2's new `dataPolicy` operator variable must join `STARTUP_ENV_VARS`. The roster guard forces it.
- **Consumes:**
  - the 38.7 `validateLayer` labels and process-gate helpers;
  - the 32.2 `universe` loader;
  - `deriveKeysForTool` and `SERVER_PACKAGES`.

**Ledger inbox (Rule 17).** None is declined.
- DW-565: AC-1, AC-2 and AC-3.
- DW-543: AC-4 to AC-7.
- DW-567: AC-8.

**Observation, not filed.** `dist/test-helpers/integration-config.*` ships in the shared tarball (plan-time `npm pack --dry-run`). That is the inverse of DW-506; the lead may append it there as an occurrence for Story 42.1.

## Verification

Every command runs from `/Users/jbrandt/git/iris-execute-mcp-v2`, in the foreground, with `timeout: 600000`, one package per call.

**Prefixes.** `ENV`, `CLEAN` and `HOSTILE` are defined below. Keep `HOSTILE` in a scratchpad env file and `source` it; it never goes into the repo.
- `ENV` is `IRIS_HOST=localhost IRIS_PORT=52773 IRIS_NAMESPACE=HSCUSTOM IRIS_USERNAME=_SYSTEM IRIS_PASSWORD=SYS IRIS_HTTPS=false IRIS_REQUIRE_LIVE=1`.
- `CLEAN` is `IRIS_HOST=127.0.0.1 IRIS_PORT=1`.
- `HOSTILE` is `CLEAN` plus these values:
  - **Profiles and connection:** `IRIS_PROFILES='{"hostile":{"host":"hostile.invalid"}}'`, `IRIS_TIMEOUT=1`, `IRIS_ACCEPT_LANGUAGE=xx-HOSTILE`.
  - **Governance:** `IRIS_GOVERNANCE='{"global":{"iris_doc_put":false,"iris_global_set":false}}'`, `IRIS_GOVERNANCE_FILE=/nonexistent/hostile-governance.json`, `IRIS_GOVERNANCE_PRESET=read-only`.
  - **Tool visibility:** `IRIS_TOOLS_PRESET=core`, `IRIS_TOOLS_DISABLE='iris_doc_*'`, `IRIS_TOOLS_ENABLE=iris_hostile_tool`.
  - **Server Manager and credentials:** `IRIS_SERVER_MANAGER=required`, `IRIS_SM_SERVERS=hostile-sm`, `IRIS_SM_SETTINGS_PATHS=/nonexistent/settings.json`, `IRIS_SM_WORKSPACE=/nonexistent/workspace`, `IRIS_CREDENTIAL_HELPER=/nonexistent/helper`.
  - **SQL and tests:** `IRIS_SQL_MAX_ROWS=1`, `IRIS_SQL_TIMEOUT=1`, `IRIS_SQL_READ_ONLY=true`, `IRIS_SQL_MAX_ROWS_AFFECTED=0`, `IRIS_TEST_TIMEOUT=1`.
  - **Audit:** `IRIS_AUDIT_LOG=/nonexistent/audit.jsonl`, `IRIS_AUDIT_LOG_MAX_MB=not-a-number`, `IRIS_AUDIT_LOG_PARAMS=true`.
  - **Logging and transport:** `LOG_LEVEL=ERROR`, `MCP_TRANSPORT=http`.

**Live writes.** This story's own tests write nothing to IRIS. The armed `(once)` runs execute existing gates, which create and remove their own disposable `QaStory38*` and `ExecuteMCPv2.Temp.Story38*` fixtures. No OS `%UnitTest` class runs, because there is no ObjectScript change.

**Shared surfaces:**
- the 43 harness files;
- seven `vitest.config.ts` files (`setupFiles`);
- the CLI `HELP_TEXT` and unknown-command list (`governance-cli.test.ts:91`);
- the README CLI table and governance paragraphs (the 38.x doc-claims);
- startup stderr, which is new only for dead keys (the process gates that read log lines);
- three `type` descriptions, and with them the dev payload rows;
- the CHANGELOG top section and `.changeset/`;
- the `universe` output, after the refactor.

Standing criterion: every test added or changed passes on a fresh environment, in either order.

**Commands:**
- `(once)` before any change:
  - Run `pnpm --filter @iris-mcp/shared build`, then one build per package: dev, admin, interop, ops, data and client-config.
  - Run `CLEAN` and then `HOSTILE` `pnpm --filter <pkg> exec vitest run` for each of the eight packages, and record passed, skipped and failed. The plan-time `HOSTILE` reds were: shared 19 files / 66 tests, dev 4/22, admin 5/11, interop 5/10, ops 1/1, `@iris-mcp/all` one extra file; data and client-config were green.
  - Capture `node packages/shared/dist/cli/governance-cli.js universe --root . --json` and its text mode to the scratchpad.
- `(loop)` `pnpm --filter @iris-mcp/shared build && pnpm --filter @iris-mcp/shared exec vitest run src/__tests__/governance-unmatched-keys.test.ts src/__tests__/governance-cli-check.test.ts src/__tests__/governance-cli.test.ts src/__tests__/governance-cli-universe.test.ts src/__tests__/governance-cli-e2e.test.ts src/__tests__/governance-enforcement.test.ts src/__tests__/env-harness.test.ts` -- expected: pass.
- `(loop)` `HOSTILE pnpm --filter @iris-mcp/shared exec vitest run` -- expected: 0 failed, and counts equal `CLEAN`.
- `(loop)` One call per package for dev, admin, interop and ops: `HOSTILE pnpm --filter <pkg> exec vitest run <that package's migrated files>` -- expected: pass.
- `(loop)` `pnpm --filter @iris-mcp/dev build && pnpm --filter @iris-mcp/dev exec vitest run src/__tests__/doc-type-description.test.ts src/__tests__/doc.test.ts src/__tests__/packages.test.ts src/__tests__/export.test.ts` -- expected: pass.
- `(loop)` `pnpm --filter @iris-mcp/all exec vitest run src/__tests__/startup-env-roster.test.ts src/__tests__/story-38-7-qa-governance-process.test.ts src/__tests__/story-39-0-doc-claims.test.ts src/__tests__/docs-governance-cli-recipes.test.ts` -- expected: pass.
- `(once)` One command per package (shared, dev, admin, interop, ops, data, client-config): `build`, then `test`, `lint` and `type-check`. Then `ENV pnpm --filter @iris-mcp/dev exec vitest run --no-file-parallelism` and `ENV pnpm --filter @iris-mcp/all test` -- expected: green. An armed gate fails rather than skips, so a green run proves the scrub leaves the armed gates intact.
- `(once)` `HOSTILE` full suites, one call each: dev, admin, interop, ops, data, client-config and all -- expected: 0 failed, and counts equal `CLEAN`.
- `(once)` The `universe` captures again -- expected: `diff` against the first capture is empty.
- `(once)` `pnpm gen:governance-baseline:check`, `pnpm measure:tools-payload` (the README rows must equal its output), `node scripts/check-epics-sync.mjs` and `pnpm gen:skills:check` -- expected: OK, with no drift.
- `(once)` `cd packages/shared && npm pack --dry-run --json --ignore-scripts` -- expected: no path contains `__tests__`, `env-harness` or `startup-env`.
- `(once)` `git diff --stat da9b9d58fef04e0892b028a9365925c2e94387cc -- packages/shared/package.json packages/shared/src/governance-baseline.ts packages/shared/src/baseline-classifications.ts packages/shared/src/bootstrap-classes.ts ipm/module.xml src/` -- expected: empty. Also, `grep -rln "function makeEnvHarness" packages --include='*.ts' | grep -v /dist/` -- expected: only `env-harness.ts`.
- `(once)` After the armed runs, a leftover scan with `server:"default"` and `namespace:"HSCUSTOM"` -- expected: empty, 0. Scan with:
  - `iris_doc_list` (`generated:true`) filtered on `QaStory38` and on `ExecuteMCPv2.Temp`;
  - `iris_global_list` filtered on `QaStory38`;
  - `SELECT COUNT(*) FROM Ens_Config.Production WHERE Name %STARTSWITH 'ExecuteMCPv2.Temp.'`.

**Planned mutations (Rule 19).** For each one: apply it, observe red, revert, rebuild any dist it touched, and confirm `git status --short` and `git diff --stat` are unchanged. Record each as `mutation: ... -> ...`, naming the path.

| AC | Mutation | Expected red |
|---|---|---|
| AC-1 | The new `logger.warn` in `start()` replaced with `void` (shared dist rebuilt) | the `start()` rows; the built-process WARN rows |
| AC-1 | The server scope built from `this.tools` only | the hidden-tool row |
| AC-2 | `check` returns 0 when keys are unmatched; separately, the suite scope treated as the server scope | the `check` exit-1 rows; the `iris_doc_putt` form (d) row |
| AC-3 | The classifier compares keys with tool names only | the all-`universe`-keys row; the `STARTING` no-WARN rows |
| AC-3 | The framework tool dropped from the extracted loader | the `governance-cli-universe` rows; the `universe` diff |
| AC-4 | `IRIS_GOVERNANCE_PRESET` removed from `STARTUP_ENV_VARS` | the `env-harness.test.ts` row; `startup-env-roster` |
| AC-5 | `setupFiles` removed from the shared config | `HOSTILE` shared (`server-param.test.ts`, among others) |
| AC-6 | A temporary `process.env.IRIS_PROBE_X` read added to a shared source | `startup-env-roster`, naming `IRIS_PROBE_X` |
| AC-7 | `env-harness.ts` copied into `src/test-helpers/` | the pack check lists it |
| AC-8 | The old `'cls' for CLS` text restored | `doc-type-description` |
| AC-9 | The changeset bump changed | `story-39-0-doc-claims` |

## Auto Run Result

Status: ready-for-dev
Blocking condition: none
