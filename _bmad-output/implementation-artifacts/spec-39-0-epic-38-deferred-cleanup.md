---
title: 'Story 39.0: Epic 38 Deferred Cleanup'
type: 'bugfix'
created: '2026-10-16'
status: 'done'
baseline_revision: 'bab8ba38301636cf5d8bd814d50d8a6d662f2073'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/.claude/rules/project-rules.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-iris-execute-mcp-v2-2026-10-14/ARCHITECTURE-SPINE.md'
warnings:
  - multiple-goals
  - oversized
deferred:
  - summary: >-
      AC-7 (no __tests__, env-harness or startup-env path in the shared tarball) is verified only by the one-time npm pack command, with no default-suite test, so a later move of the harness into src/test-helpers/ would ship it unnoticed.
    evidence: |-
      The AC-7 mutation (a copy of env-harness.ts under packages/shared/src/test-helpers/) was caught only by running npm pack --dry-run by hand; a search of packages/*/src finds no test that runs it. Verification-gap review of Story 39.0 filed it; the packaging gate is DW-506 (Story 42.1), so this is an occurrence of DW-506.
    location: >-
      packages/shared/package.json (files), packages/shared/src/__tests__/env-harness.ts
    severity: low
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

### 2026-10-16 — Review pass
- verdicts: 26 findings — high 0, medium 6, low 18, false 2, maybe-false 0 (tallied from the rows below by grep; 8 rows repeat an earlier row's root cause and are marked `carried`, so the rows group into 4 medium root causes)
- findings:
  - `[medium]` `[patch]` BH1 — `story-39-0-doc-claims` asserts the Story 39.0 CHANGELOG section is first in the file — Story 39.1 adds its own top section and turns it red with no regression; patched: the assertion is dropped, the section is found by title as the 38.x tests do.
  - `[medium]` `[patch]` BH2 — changeset, CHANGELOG and README list "a typo such as `iris_doc_putt`" among the keys a server warns about at startup, but `deadKeyReason` in server scope is silent for a tool no server registers (only `check` reports it) — the spec's own lead example would be misread; patched: all three texts now say a misspelled tool name logs nothing at startup and only `check` reports it.
  - `[medium]` `[patch]` BH3 — nothing in the default suite pins that a package's `vitest.config.ts` lists the scrub (only shared had mutation evidence) — a config can lose it unnoticed on a clean machine; patched: `startup-env-roster.test.ts` loads each of the 7 configs and asserts the shared setup file is listed; mutation recorded (AC-5).
  - `[low]` `[reject]` BH4 — a bare key on a per-action tool whose `action` is `.optional()`/`.nullable()`/`.default()` is live in the gate (falls back to the bare key) but reported dead — verified by introspection of the five built dists: all 41 `action` fields are bare `ZodEnum`, so no tool reaches it; `wontfix-theoretical`, real only when a tool declares a wrapped `action` enum.
  - `[low]` `[patch]` BH5 — the shared config's `env: { LOG_LEVEL: "DEBUG" }` pin is dead (the setup scrub deletes `LOG_LEVEL` after vitest applies `env`) under a comment that says it pins the default — the logger default is DEBUG, so behavior is unchanged; patched: the pin and the false comment are replaced by a comment that says what the scrub does (a deletion; CLEAN and HOSTILE shared runs re-verified).
  - `[low]` `[patch]` BH6 — CHANGELOG Tests bullet says "every package's `vitest.config.ts` runs the scrub" but client-config's config is unchanged (its HOSTILE run was green, so the spec made the change conditional) — patched: the bullet names the seven packages and says why client-config is unchanged.
  - `[low]` `[reject]` BH7 — the second row of `doc-type-description.test.ts` checks example types in isolation, so `'cls'` always passes although it is valid only with category `*` — the exact-text row (`toBe(EXPECTED_TEXT)`) is the real guard, its mutation (old text restored) is red in both rows; a category-aware example check is more than a direct fix for a row that cannot let the DW-567 text change through.
  - `[low]` `[reject]` EH1 — same root as BH4 (false "has no effect" for a wrapped-enum tool's bare key); `carried` reject, `wontfix-theoretical`.
  - `[medium]` `[patch]` EH2 — same root as BH2 (typo wording at changeset:8, CHANGELOG, README); `carried`: patched with BH2.
  - `[low]` `[reject]` EH3 — `it.skipIf(!changesetPresent)` skips the bump pin once `changeset version` consumes the file — the same pattern as the 38.1, 38.2, 38.3 and 38.7 doc-claims tests; the pin runs while the file exists, which is when AC-9 is judged, and its mutation went red.
  - `[low]` `[reject]` EH4 — the roster scan matches only `env.NAME` and `env["NAME"]`, and `stripComments` does not skip regex literals — a grep of the scanned sources finds no `env?.NAME`, destructured or dynamic read, and the spec fixes the scan forms; the two-way equality check also fails for a listed variable a swallowed region hides; `wontfix-theoretical`, real when a source reads the environment through one of those forms.
  - `[low]` `[patch]` EH5 — same root as BH6 (CHANGELOG "every package"); carried: patched with BH6.
  - `[false]` `[reject]` EH6 — `validate` exits 0 for a loader-valid document that holds a dead key, which `start()` now warns about — the intent contract defines a valid document as one whose keys are all in the suite universe, forbids any change to `validate`, and makes the warning the feature; `false`, by design.
  - `[medium]` `[patch]` VG1 — the roster guard compares the source against shared's built `dist/__tests__/startup-env.js`, but `checkDistFresh` skips `src/__tests__/` (`SRC_DIRS_NOT_SHIPPED`, verified in `scripts/lib/dist-freshness.mjs:65,267`), so a source-only list edit leaves the guard green against an old list — patched: `loadRoster` compares the mtimes of the source list and its built copy and fails with the rebuild instruction; mutation recorded (AC-6).
  - `[medium]` `[patch]` VG2 — same root as BH3 (the six non-shared `setupFiles` entries have no mutation evidence and no default-suite pin); carried: patched with BH3.
  - `[low]` `[defer]` VG3 — AC-7 (no `__tests__`, `env-harness` or `startup-env` path in the shared tarball) is checked only by the `(once)` `npm pack` command, with no default-suite test — the packaging gate belongs to DW-506 / Story 42.1 (Boundaries); deferred as an occurrence of DW-506.
  - `[low]` `[reject]` VG4 — the README `@iris-mcp/dev` payload rows are checked only by the `(once)` `pnpm measure:tools-payload` run — the README states that byte counts are not test-pinned and the drift is accepted until the next re-measure; `by-design`.
  - `[low]` `[reject]` VG5 (Other) — `env-harness.test.ts:75` asserts `toHaveLength(24)` on a test-local array — redundant, harmless; the roster equality assertions above it are the pin.
  - `[low]` `[reject]` VG6 (Other) — `doc-type-description.test.ts:37,87` checks types without their category; carried from BH7: `carried` reject.
  - `[low]` `[reject]` VG7 (Other) — `story-39-0-doc-claims.test.ts:92` `skipIf`; carried from EH3: `carried` reject.
  - `[low]` `[patch]` VG8 (Other) — the baseline-only-key filter in `cmdCheck` (`governance.ts`) is pinned by `governance-cli-check.test.ts` "a frozen-baseline key whose tool no package carries is in the universe" but has no recorded mutation — LOW closed in this pass: the filter removed, the row went red, reverted; the line is in `## Verification` (AC-2).
  - `[low]` `[reject]` VG9 (Other) — hermeticity: the real-dist rows depend on sibling packages' built dists, which `turbo` does not order before `shared:test` — they fail loudly ("could not locate built tools"), `governance-cli-universe.test.ts` already used the pattern, and the project runs per-package standalone builds and tests (env rules); `by-design`.
  - `[low]` `[reject]` IA1 — the built-process surface has no row for form (c) through the interop server or for the hidden-tool row; they live in the in-process fixture tier — Tasks 10 and 11 place exactly those rows there, and the built-process tier carries forms (a) and (b), the silent rows and the valid documents; `by-design`.
  - `[low]` `[patch]` IA2 — no committed test asserts a config carries the scrub (the `HOSTILE` run is manual); carried from BH3: patched with BH3.
  - `[false]` `[reject]` IA3 — the harness snapshots the environment at construction, so under vitest "restored exactly" means restored to the scrubbed state — `false`: the matrix row's "each value is restored exactly" is what `env-harness.test.ts` pins (it builds the harness after setting hostile values), and restoring the scrubbed state in real suites is the intended behavior.
  - `[low]` `[patch]` IA4 — the baseline-only filter is exercised only through the injected loader; carried from VG8: patched with VG8.

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

**Mutation evidence (Rule 19; applied, red observed, reverted with `cmp` byte-identical, dists rebuilt).**

- AC-1: mutation: `logger.warn(warning)` -> `void warning` in `packages/shared/src/server-base.ts` (shared dist rebuilt) -> red: 6 start() rows of `governance-unmatched-keys.test.ts` (forms a, b, c, framework key, hidden tool, both channels) and 8 rows of `story-38-7-qa-governance-process.test.ts` (4 new form (a)/(b) rows on both channels, plus the 4 pre-existing unknown-profile WARN rows, which share the loop).
- AC-1: mutation: `governanceKeysByTool([...this.options.tools, ...this.tools.values()])` -> `[...this.tools.values()]` in `packages/shared/src/server-base.ts` -> red: `governance-unmatched-keys.test.ts` "a hidden tool counts as registered" (1 of 21).
- AC-2: mutation: the final `return 1` of `cmdCheck` -> `return 0` in `packages/shared/src/cli/governance.ts` (shared dist rebuilt) -> red: 7 rows (5 in `governance-cli-check.test.ts`, 2 built-bin rows in `governance-cli-e2e.test.ts`).
- AC-2: mutation: `cmdCheck` calls `unmatchedGovernanceKeys(..., "server")` instead of `"suite"` in `packages/shared/src/cli/governance.ts` (shared dist rebuilt) -> red: the same 7 rows, including the `iris_doc_putt` form (d) row.
- AC-3: mutation: `keys.includes(key)` -> `keysByTool.has(key)` in `deadKeyReason`, `packages/shared/src/governance.ts` (shared dist rebuilt) -> red: 11 rows in shared (the all-universe-keys row, the start() rows, the `check` exit-1 rows) and 5 rows of the process gate, among them the all-universe-keys row and the new `STARTING` per-action row. The two pre-existing `STARTING` documents hold only single-operation keys, so they cannot catch this mutation; a `STARTING` document with per-action keys was added for that reason.
- AC-3: mutation: `const frameworkKeys = deriveKeysForTool(serverDiscoveryTool, "framework")` -> `const frameworkKeys: string[] = []` in `loadUniverseCatalog`, `packages/shared/src/cli/governance.ts` (shared dist rebuilt) -> red: 3 `governance-cli-universe.test.ts` rows and the `check` framework-key row; the `universe --json` capture differs from the pre-change capture.
- AC-4: mutation: `IRIS_GOVERNANCE_PRESET` removed from `STARTUP_ENV_VARS` in `packages/shared/src/__tests__/startup-env.ts` (shared dist rebuilt) -> red: 4 rows of `env-harness.test.ts` (roster, default setup, unset setup, `scrubStartupEnv`) and `startup-env-roster.test.ts` naming `IRIS_GOVERNANCE_PRESET (read in packages/shared/src/governance.ts)`. The first draft of `env-harness.test.ts` iterated the module's own list and only the count row went red; its behavior rows now run over a hand-copied roster.
- AC-5: mutation: `setupFiles` removed from `packages/shared/vitest.config.ts` -> red: `HOSTILE` shared, 17 files and 86 tests (`server-param.test.ts`, `server-base.test.ts`, the `audit-*` files and others; the 15 harness files stay green because the harness scrubs for itself). Re-run after the review pass dropped the dead `env: { LOG_LEVEL }` pin from that config; the first run, with the pin, was 11 files and 68 tests.
- AC-5: mutation: the `setupFiles` line removed from `packages/iris-data-mcp/vitest.config.ts` (a default-suite pin, no `HOSTILE` run needed) -> red: `startup-env-roster.test.ts` "iris-data-mcp: the vitest config the runner loads lists the shared scrub as a setup file" (1 of 10; `expected [] to include` the shared setup file). The test loads each of the 7 configs, so the one mutation stands for the six non-shared entries.
- AC-6: mutation: `void process.env.IRIS_PROBE_X;` appended to `packages/shared/src/logger.ts` (shared dist rebuilt) -> red: `startup-env-roster.test.ts` naming `IRIS_PROBE_X (read in packages/shared/src/logger.ts)`; and `"IRIS_UNREAD_PROBE"` added to `PLATFORM_ENV_VARS` (dist rebuilt) -> red, naming it. Without the rebuild the test fails on `staleDistReason`, not on the read.
- AC-6: mutation: `"LOG_LEVEL"` removed from `STARTUP_ENV_VARS` in `packages/shared/src/__tests__/startup-env.ts` and shared NOT rebuilt (the freshness gate skips `src/__tests__/`) -> red: `startup-env-roster.test.ts` fails in `loadRoster` with "startup-env.ts is newer than the built dist/__tests__/startup-env.js" (3 of 10 skipped behind it). Reverted with `cmp` byte-identical; `packages/shared/dist` and `tsconfig.tsbuildinfo` deleted and rebuilt, because the compiler emits nothing for a content-identical file.
- AC-2: mutation: the `.filter((finding) => !universeKeys.has(finding.key))` removed from `cmdCheck` in `packages/shared/src/cli/governance.ts` (in-process rows run on source, no rebuild) -> red: `governance-cli-check.test.ts` "a frozen-baseline key whose tool no package carries is in the universe, so it is not reported" (1 of 24). Reverted with `cmp` byte-identical.
- AC-7: mutation: a copy of the harness at `packages/shared/src/test-helpers/env-harness.ts` (built) -> red: `npm pack --dry-run --json --ignore-scripts` lists `dist/test-helpers/env-harness.{js,js.map,d.ts,d.ts.map}`; after removing the copy and its four dist files the check shows 0 matching paths.
- AC-8: mutation: `"CLS takes no type filter (leave it unset). "` -> `"e.g., 'cls' for CLS. "` in `DOC_TYPE_DESCRIPTION`, `packages/iris-dev-mcp/src/tools/doc.ts` -> red: both rows of `doc-type-description.test.ts`.
- AC-9: mutation: `"@iris-mcp/dev": patch` -> `minor` in `.changeset/story-39-0-epic-38-deferred-cleanup.md` -> red: `story-39-0-doc-claims.test.ts` "the changeset bumps exactly shared minor and dev patch".

## Auto Run Result

Status: done
Blocking condition: none

**Summary.** Story 39.0 closes the three Epic 38 ledger entries.
- DW-565: every server warns once per dead governance key it can prove (forms a, b, c) and never fails; the new `iris-mcp-governance check` reports every key that matches nothing in the suite universe (form d included) and exits 1.
- DW-543: one env harness (`makeEnvHarness`) and one `setupFiles` scrub live under `packages/shared/src/__tests__/` (never published); all 43 copies use the harness; the default suites of the eight packages are green under `HOSTILE` with counts equal to `CLEAN`.
- DW-567: one probe-verified `DOC_TYPE_DESCRIPTION` serves `iris_doc_list`, `iris_package_list` and `iris_doc_export`.

No tool, action, key, preset row or prompt moved; `GOVERNANCE_BASELINE` stays `1e62c5ad5bf7`/141 (`:check` OK), `BOOTSTRAP_VERSION` stays `089f8f0a62b2` (no ObjectScript change).

**Files changed.**
- `packages/shared/src/governance.ts`: `governanceKeysByTool`, `unmatchedGovernanceKeys` (forms a to d, server and suite scope).
- `packages/shared/src/server-base.ts`: `start()` logs the server-scope findings of both channels.
- `packages/shared/src/cli/governance.ts`: `check` subcommand, `loadUniverseCatalog` extracted from `universe` (output byte-identical), help, dispatch and unknown-command list.
- `packages/iris-dev-mcp/src/tools/{doc,packages,export}.ts`: shared `DOC_TYPE_DESCRIPTION`.
- `packages/shared/src/__tests__/{startup-env,startup-env.setup,env-harness}.ts` (new) and `test-helpers.ts` (re-exports the harness); seven `vitest.config.ts` files gain `setupFiles`.
- 43 test files: local `makeEnvHarness` removed, promoted harness imported (shared 15, dev 8, admin 9, interop 6, ops 5).
- New tests: `env-harness`, `governance-unmatched-keys`, `governance-cli-check` (shared); `doc-type-description` (dev); `startup-env-roster`, `story-39-0-doc-claims` (all); extended `governance-cli-e2e` and `story-38-7-qa-governance-process`.
- Docs: root `README.md`, `packages/shared/README.md`, `CHANGELOG.md`, `.changeset/story-39-0-epic-38-deferred-cleanup.md` (shared minor, dev patch).

**Review (4 layers, 26 findings; tallied by grep in the triage log).** Patches applied: 4 medium root causes and 3 low.
- Medium: the doc-claims test pinned the CHANGELOG section as first in the file; the startup-warning wording named a misspelled tool name although only `check` reports it; no default-suite pin that each package's config lists the scrub; the roster guard's freshness check could not see `src/__tests__/startup-env.ts`.
- Low: a dead `LOG_LEVEL` env pin in the shared config; the CHANGELOG "every package" wording; the baseline-only-key filter had no mutation line.

Deferred: 1 (AC-7 packaging gate, an occurrence of DW-506 / Story 42.1).

Rejected, with the recorded reason (full rows in the triage log):
- wrapped `action` enum reported dead (BH4, EH1): all 41 real `action` fields are bare enums;
- `doc-type-description` example check is category-blind (BH7, VG6): the exact-text row is the guard;
- `skipIf` on the changeset pin (EH3, VG7): the 38.x precedent;
- roster scan forms (EH4): no source uses another form;
- `validate` versus the startup warning (EH6): the contract defines a valid document as every key in the universe;
- README payload rows not test-pinned (VG4): documented convention;
- `toHaveLength(24)` self-check (VG5): harmless;
- dist-order hermeticity (VG9): fails loudly, accepted pattern;
- form (c) and hidden-tool rows in-process only (IA1): the spec's tiering;
- harness construction-time snapshot (IA3): intended.

**Follow-up review recommendation: true.** Two or more medium entries were patched (4 root causes). Unverified risk, named: the patch pass added the roster guard's mtime comparison and the config-wiring test (a dynamic `import()` of each `vitest.config.ts` inside vitest), plus doc wording edits; no review layer has seen them (mutation evidence for the first two is recorded).

**Verification performed (all foreground, one package per call).**
- Baseline before any source change: dists rebuilt clean; shared `HOSTILE` was 26 files / 203 tests red (plan-time 19 / 66), the other packages red as listed in the subagent record; `CLEAN` shared had one red (`server-discovery.test.ts`, ambient `IRIS_PORT=1`) that the harness removes.
- `(loop)` lines green after the last patch: shared governance files (7 files, 180 tests); `HOSTILE` shared 76 files / 1693 tests; `HOSTILE` migrated files in dev (39), admin (48), interop (23), ops (22); dev DW-567 files (103); `@iris-mcp/all` roster, 38.7 process gate, 39.0 doc-claims, recipes (65).
- `(once)` after the last patch: `build`, `test`, `lint`, `type-check` per package (shared 1693; dev 1413; admin 498; interop 345; ops 350; data 165; client-config 514), with 0 errors; the one lint warning (`cli/governance.ts:935`, unused disable directive) is in `git show bab8ba3` unchanged. Armed: `ENV` dev 59 files / 1413 tests and `ENV` `@iris-mcp/all` 47 files / 525 tests, green.
- `HOSTILE` equals `CLEAN` in every suite: shared 1693; dev 1112 passed / 301 skipped; admin 490 / 8; interop 345; ops 350; data 163 / 2; client-config 514; `@iris-mcp/all` 466 / 59.
- `universe` JSON and text captures: byte-identical to the pre-change captures. `gen:governance-baseline:check`, `check-epics-sync`, `gen:skills:check`: OK. `measure:tools-payload` equals the README dev rows (84,852 / 43,743).
- `npm pack --dry-run`: 130 files, 0 paths match `__tests__`, `env-harness` or `startup-env`; frozen-file `git diff --stat` against `da9b9d5` empty; `function makeEnvHarness` only in `env-harness.ts`.
- Leftover scan on `server:"default"`, `namespace:"HSCUSTOM"`: `iris_doc_list` (`generated:true`) on `QaStory38` and `ExecuteMCPv2.Temp` empty, `iris_global_list` `QaStory38` empty, `Ens_Config.Production` Temp count 0.
- Live read-only probe by the lead: `GET docnames/CLS/cls` and `RTN/cls` answer 400; `RTN/mac`, `*/cls`, `CLS/*` answer 200.
- Mutation evidence: every AC has a recorded `mutation:` line in `## Verification`, plus three lines added in the review pass (AC-5 per-package wiring, AC-6 source-only list edit, AC-2 baseline-only filter).

**Residual risks.** The guard in `startup-env-roster.test.ts` compares file mtimes and, like the existing dist-freshness gate, needs a dist delete after a content-identical touch. `dist/test-helpers/integration-config.*` still ships in the shared tarball (the inverse of DW-506, as the spec noted). Review rounds also relocated two `universe` error strings that now carry `—` instead of a literal em dash; the runtime text is identical.
