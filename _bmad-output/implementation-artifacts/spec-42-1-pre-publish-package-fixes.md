---
title: 'Story 42.1: Pre-Publish Package Fixes'
type: 'feature'
created: '2026-10-20'
status: 'ready-for-dev'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-iris-execute-mcp-v2-2026-10-14/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-42-context.md'
warnings:
  - multiple-goals
  - oversized
deferred:
  - summary: 'The extension''s two CLI spawns (`clientsEngine.ts:341`, `governanceEngine.ts:324`) pass no `cwd`, so they inherit the extension host''s cwd (macOS/Linux: whatever launched VS Code, often the project from `code .`; Windows: the VS Code install dir). The clients CLI treats `process.cwd()` as its project directory (`clients.ts:165`) and the extension never passes one, so the MCP Clients view''s project scope depends on how VS Code was started, and a project-local 1.x copy of client-config or shared can shadow the pinned spec.'
    evidence: 'Plan probe 2026-10-20: npm exec resolves a local 1.x copy from the nearest ancestor with package.json/node_modules (libnpmexec index.js:41-69, :191-192; offline fake-package probe printed LOCAL-1.5.0 for `@1`). Not fixed here: neutralizing the cwd would change the CLI''s project scope.'
    location: 'extensions/iris-mcp-launcher/src/clientsEngine.ts:341; extensions/iris-mcp-launcher/src/governanceEngine.ts:324; packages/client-config/src/cli/clients.ts:165'
    severity: 'low'
  - summary: 'Publishing must go through pnpm: `pnpm publish` runs every package''s `prepublishOnly` (`verify-iris-reachable.mjs`, `prepublish-gate.mjs`), which fails in a release environment with no IRIS, and only pnpm applies `publishConfig.exports` and rewrites `workspace:*`. A direct `npm publish` ships the dev-only exports and unresolvable `workspace:*` dependencies. Story 42.5''s single release script must own both (DW-394 evidence also suggests stripping `prepublishOnly`).'
    evidence: 'Plan probe 2026-10-20: `changeset publish` (2.30.0, changesets-cli.cjs.js:713-735, 813-866) runs `pnpm publish`; pnpm 9.15 runs `prepublishOnly`, packs with overrides, then `npm publish --ignore-scripts <tarball>` (pnpm.cjs:211891); `npm pack` kept all four exports keys.'
    location: 'packages/*/package.json scripts.prepublishOnly'
    severity: 'med'
  - summary: 'Seven READMEs say `IRIS_USERNAME` defaults to `_SYSTEM`, but `config.ts` treats it as required and the server exits with "IRIS_USERNAME environment variable is required".'
    evidence: 'Plan probe 2026-10-20 (local install of the packed meta-package; the dev server stopped at config load).'
    location: 'README.md:73; packages/iris-*-mcp/README.md:31; packages/iris-mcp-all/README.md:69; packages/shared/src/config.ts:162-169'
    severity: 'low'
---

<intent-contract>

## Intent

**Problem:** Nothing is published, and the packages are not publishable as they stand. No package declares a Node floor (the root says `>=18`), none carries license, repository, author or MCP Registry metadata, `@iris-mcp/shared` exports three `./test-helpers` subpaths that point at unshipped source, and all 231 `npx` specs the suite writes, spawns or documents are unpinned. The documented client-config CLI form fails as an unknown command, the meta-package README promises commands that a global install never links, and nothing makes the first release land on exactly `1.0.0`.

**Approach:** Fix every manifest, document and spec site in place, pinning specs to `@1` from one exported constant. Add default-suite checks in `packages/iris-mcp-all` that read the real publish path (`pnpm pack`, and a real `changeset version` in a throwaway fixture), so Story 42.3 can promote them to CI gates. Publish nothing.

## Boundaries & Constraints

**Always:**
- **Never publish or version.** No `npm`/`pnpm`/`changeset publish`, no `changeset version` on the real tree, no `vsce`/`ovsx publish`, no `npm login`/`adduser`, no `npm stage publish`, no `git tag`, no GitHub release.
  - `pnpm pack` and `npm pack` go only into `os.tmpdir()` or the scratchpad.
  - Pending changesets, this story's own included, stay `patch`/`minor` (AD-29).
- **One major.** It comes from one source: `IRIS_MCP_MAJOR` exported by `@iris-mcp/client-config`. The extension holds a literal mirror, and a test pins it equal.
  - Specs use `@1`, never `^1`, because `^` is cmd.exe's escape character on the win32 spawn path.
- **Captured and generated files keep their rules.**
  - Captured evidence is never rewritten: the dated verbatim captures in `certification-results.json` (`:23`, `:34`), the history in the root and extension `CHANGELOG.md`, and the legacy-input fixtures that model a user's pre-existing entries.
  - Generated files change only through their generator: the certification table (`render-certification-table.mjs`), the client-config byte goldens (re-captured from the built engine, Rule #36), and the skills pack.
- **Cross-package checks** live in `packages/iris-mcp-all` (AD-2, Rule #45). Each is proven red on the path it guards (Rule #59).
- **No wire byte changes.** The frozen SDK goldens, `sdk-golden-sanctioned-changes.json` and `tools-list-snapshot.json` stay byte-unchanged.
- **No IRIS writes.** The shared instance is never written by this story's checks.
- **Rule 14.** Non-ASCII characters in code use escapes. Comments state the contract, never the history.

**Never:**
- **No tool-surface changes.** That means no change to any tool annotation, description, schema, Storage guard or audit field. DW-560, DW-662, DW-652 and DW-654 go to the proposed split story (Design Notes).
- **`@iris-mcp/all` stays a meta-package.** No launcher `bin`, and no new MCP server.
- **Leave these `cwd`s alone:**
  - the extension's clients and governance CLI spawns (deferred above);
  - synthesized client entries: server-manager mode reads `.vscode/settings.json` from `process.cwd()` (`packages/shared/src/server-manager-source.ts:299-300`).
- **Leave other stories' work.** Keep the "not yet published" caveats (Story 42.9). Add no `server.json` and do no registry publish (Story 42.8). Leave the extension's `publisher` and `engines.node` alone (Story 42.7).
- **SDK pins stay exact.** Bump them only per the DW-637 task below.
- **No root CHANGELOG `1.0.0` section** (Story 42.6 writes it).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Synthesized entry (Integration: client-config CLI consumes `pinnedSpec`) | `iris-mcp-clients apply` for `iris-dev-mcp` into a temp client config | Entry `{command:"npx", args:["-y","@iris-mcp/dev@1"]}`; every adapter family's golden stages 1–3 carry the pinned spec | none |
| Previously applied unpinned entry | Config holds the manager's old `["-y","@iris-mcp/dev"]` plus foreign entries | Re-`apply` rewrites only the owned `command`/`args`; foreign bytes identical (AD-30) | none |
| Extension definitions (Integration: VS Code consumes the mirror) | `provideMcpServerDefinitions` in npx mode | `args ["-y","@iris-mcp/<pkg>@1"]`; `def.cwd` is `Uri.file(os.homedir())`; local `developmentRepoPath` mode unchanged | none |
| Extension CLI fallbacks | Clients fallback; governance, including `universe` | `["-y","-p","@iris-mcp/client-config@1","iris-mcp-clients",…]`; `-p @iris-mcp/shared@1` and each server `-p @iris-mcp/<pkg>@1`; win32 argv still valid | none |
| Documented CLI form (DW-628) | Packed client-config tarball: `npx -y -p <tgz> iris-mcp-clients detect --json` vs the old `npx -y file:<tgz> iris-mcp-clients list` | New form exits 0 with the JSON envelope. Old form exits 2: `unknown command "iris-mcp-clients"` | Recorded as evidence |
| Shared tarball (DW-506) | `pnpm pack` of `@iris-mcp/shared` | Packed `exports` has only `"."`. No `dist/test-helpers/**`, no `*.map`, no vitest peer. In-repo test-helper imports still resolve | none |
| Every tarball | `pnpm pack` of all 8 packages | Every `exports`/`main`/`types`/`bin` target is present. `LICENSE` and `README.md` present. `engines.node` is the floor; the five servers carry `mcpName` | A missing target or forbidden path fails, naming the package and path |
| Global meta install | `npm i -g @iris-mcp/all` | README states that no command is linked, and points to the per-server `npx -y @iris-mcp/<server>@1` | none |
| Release mechanism | Fixture plus `scripts/release/changeset-1.0.0.md`, then real `changeset version` | All 8 packages exactly `1.0.0`; each CHANGELOG's first `## ` is its only `## 1.0.0` and holds the release line; `workspace:*` untouched | Control without the template must be `0.1.0` |
| After release | Every pending `.changeset/*.md` consumed | Changeset-reading doc tests skip (no `ENOENT`) | none |
| Drift | An unpinned `@iris-mcp/` spec in a doc, extension source, or generated output; or the mirror ≠ `IRIS_MCP_MAJOR` | Scan test fails, naming `file:line` or the two values | none |

</intent-contract>

## Code Map

- `package.json` (root) -- `engines.node` (`>=18.0.0` at :43), and the description at :5, which reads like an InterSystems product title (AD-28).
- `packages/{shared,client-config,iris-*-mcp,iris-mcp-all}/package.json`:
  - no `engines`, `license`, `repository`, `author`, `keywords`, `homepage`, `bugs` or `mcpName`;
  - `@types/node` is `^25.5.2` in shared (:57) and client-config (:35), and undeclared in the five servers.
- `packages/shared/package.json` -- the `exports` `./test-helpers*` (×3 → `src/`); the `files` list ships `dist/test-helpers/integration-config.*`; vitest peer plus meta at :50-54.
- `packages/client-config/package.json`:
  - description at :4 (DW-630);
  - vitest peer at :40-44, which client-config has no use for;
  - `files` keeps `skills-pack` (AD-28).
- `extensions/iris-mcp-launcher/package.json`:
  - `@types/node ^20` at :169, no `author`, and a setting description with a spec at :110;
  - its own `package-lock.json`, outside the pnpm workspace.
- `packages/iris-dev-mcp/src/tools/load.ts:12,405` -- `fs.globSync`, the only shipped API newer than Node 22.0. It is experimental (stderr warning) on 22.0–22.16 and stable from 22.17.0.
- `packages/client-config/src/synthesize.ts:36-42,125-127`:
  - `PKG_BY_SERVER` produces `args:["-y",PKG]`;
  - the new `IRIS_MCP_MAJOR` and `pinnedSpec()` live here, exported via `src/index.ts` (next to `PKG_BY_SERVER` at :209).
- `extensions/iris-mcp-launcher/src/definitions.ts:8-14` -- `PACKAGE_NPM_NAME`; the mirror goes here.
- The extension's other spec sites:
  - `serverDefinitionProvider.ts:358-364` (args);
  - `extension.ts:659-666` (`new McpStdioServerDefinition(...)`; set `def.cwd`);
  - `clientsEngine.ts:150-158`;
  - `governanceEngine.ts:62,141-160`.
- `extensions/iris-mcp-launcher/src/__tests__/vscodeMock.ts:421-437` -- has no `cwd` and no `Uri`. Add both, shaped per `@types/vscode` 1.125.0 (Rule #54).
- Tests that pin spec output:
  - `synthesize.test.ts:47,210-216`, `golden.test.ts` (byte goldens under `fixtures/golden/{vscode,cline,codex,goose}*`, stages 1–3);
  - local `PKG` copies in `diff.test.ts:48-52`, `e2e.test.ts:58-62`, `engine-e2e.test.ts:115-119`, `engine.test.ts:42-46`, `write.test.ts:33-37`;
  - extension: `serverDefinitionProvider.test.ts:120-139,629,1090,1179`, `selectServers.test.ts:853`, `definitions.test.ts:104-110` (names stay bare), `clientsEngine.test.ts:63-72,318-321`, `governanceEngine.test.ts:50-75,256,277,301`.
- Docs (DW-628 form plus unpinned arrays):
  - `packages/client-config/README.md:17`, `docs/client-config/README.md:5,121`, `docs/client-config/{claude-code,claude-desktop,cursor}.md` (`:4`, and the credentials `-p` form at `:246`/`:213`/`:244`);
  - `extensions/iris-mcp-launcher/README.md` (incl. `:210`, `:265`);
  - `docs/migration-v1-v2.md`, the five `packages/iris-*-mcp/README.md` (`:18` plus three arrays each), `packages/iris-mcp-all/README.md`;
  - `certification-docs.test.ts:86-92` pins the old header.
- `@iris-mcp/all` claims:
  - `README.md:25`, `packages/iris-mcp-all/README.md:16-21,85`;
  - the false "real aggregate stdio server" at `packages/client-config/src/types.ts:124` and `.changeset/clients-managed-servers.md:7`;
  - the residual-risk prose in `packages/client-config/scripts/certification-results.json:29,71,97,159`, rendered into `packages/client-config/README.md:314-431` by `scripts/render-certification-table.mjs`.
- Reuse in `packages/iris-mcp-all/src/__tests__/`:
  - `pack-fixture.ts` (`REPO_ROOT`, `makeTempRoot`) -- add a `pnpmPack()` helper;
  - `story-43-1-qa-pack-confinement.test.ts` (the npm dry-run sibling);
  - `process-gate-helpers.js` `staleDistReason`, and `scripts/lib/dist-freshness.mjs` `checkDistFresh`;
  - `docs-governance-cli-recipes.test.ts` (doc-reading precedent);
  - turbo already makes `@iris-mcp/all#test` depend on every build plus `client-config#build`.
- Changeset readers that throw `ENOENT` once the changesets are consumed:
  - at module load: `story-38-5-qa-doc-claims.test.ts:133`, `story-43-3-doc-claims.test.ts:28`, `story-43-4-doc-claims.test.ts:35`;
  - at collection: `story-40-4-doc-claims.test.ts:359`;
  - inside a test: `story-38-6-doc-claims.test.ts:353`, `story-40-1-doc-claims.test.ts:216-232`, `story-40-2-doc-claims.test.ts:234-250`, `story-40-3-doc-claims.test.ts:264-282`, `story-40-5-doc-claims.test.ts:179-200`.

  The guard pattern is `story-38-3-qa-doc-claims.test.ts:391`.
- `.changeset/` -- 56 pending files (102 patch, 42 minor, 0 major, no `pre.json`); `config.json` `fixed: [["@iris-mcp/*"]]`; `@changesets/cli` 2.30.0. `changeset status` plans 0.1.0 for all 8.
- `CHANGELOG.md:5` -- newest section first (`## [Pre-release — <date>] — Story N.M: <title>`), with `### Changed (AD-15 sanctioned)` precedent at :15. The 42.1 section must not name `BOOTSTRAP_VERSION` (`changelog-bootstrap-move.test.ts:28`).

## Tasks & Acceptance

**Execution:**

*Manifests and lockfiles:*
- [ ] Every `packages/*/package.json` (all 8) and the root `package.json`:
  - Set `engines.node` to `>=22.17.0`.
  - Add metadata to the 8 packages:
    - `license: "MIT"`;
    - `repository: {type:"git", url:"git+https://github.com/jbrandtmse/iris-execute-mcp-v2.git", directory:"packages/<dir>"}`;
    - `author: "jbrandtmse (https://github.com/jbrandtmse)"`, matching the root `LICENSE` holder; no email;
    - `homepage` (`…/tree/main/packages/<dir>#readme`) and `bugs` (`…/issues`);
    - non-empty `keywords`. No name, description or keyword says or implies InterSystems ownership or endorsement (AD-28).
  - Give the five servers `mcpName: "io.github.jbrandtmse/<bin name>"`, which the MCP Registry checks against the published `package.json`.
  - Declare `@types/node: "^22.17.0"` in the devDependencies of the 7 TypeScript packages.
  - Rewrite the root description and client-config's description (DW-630, DW-31).
- [ ] `packages/shared/package.json`:
  - Add `publishConfig.exports` with only `"."`.
  - Add `"!dist/test-helpers"` and `"!dist/**/*.map"` to `files`.
  - Remove the vitest peer and its meta.
  - The source `exports` stay, so the 90 in-repo test imports still resolve (DW-506).
- [ ] The other 6 built packages' `package.json`: add `"!dist/**/*.map"` to `files`. Remove client-config's vitest peer and its meta.
- [ ] `extensions/iris-mcp-launcher/package.json`:
  - Add `author`, and pin the setting description at :110.
  - Set `@types/node` to `^22.15.0`. This value is the Node version that VS Code 1.101's Electron runs; confirm it from the 1.101 release notes, and use that minor if it differs.
  - Refresh `package-lock.json` with `npm install` in that directory.
- [ ] Run `pnpm install` to refresh `pnpm-lock.yaml`. Then run `tsc --noEmit` on all 7 packages and the extension; the plan probe found 0 errors with 22.20.5.

*The `@1` pin (AC 42.1.6, DW-260):*
- [ ] `packages/client-config/src/synthesize.ts` and `src/index.ts`:
  - Export `IRIS_MCP_MAJOR = "1"` and `pinnedSpec(pkg) → "<pkg>@1"`.
  - Have `baseEntry` use `pinnedSpec`.
  - `PKG_BY_SERVER` names stay bare.
- [ ] `extensions/iris-mcp-launcher/src/definitions.ts`:
  - Add a literal mirror `IRIS_MCP_MAJOR` and a `pinnedSpec`. Follow the `constants.ts` mirror precedent (no runtime dependency, self-contained VSIX).
  - Use them in `serverDefinitionProvider.ts`, `clientsEngine.ts` and `governanceEngine.ts`, including each `-p` of `universe`.
  - In `extension.ts`, set `def.cwd = vscode.Uri.file(os.homedir())`. This is VS Code's own default today (`extHostMcpNode.ts`, from 1.101). Making it explicit guards against VS Code changing that default.
- [ ] Update every spec-pinning test listed in the Code Map to the pinned form, and extend `vscodeMock.ts` with `cwd` and `Uri`. Re-capture the client-config byte goldens with a disposable capture script against the built dist: cite the command and date in `golden.test.ts`'s header, then delete the script.
- [ ] Pin every documented spec and fix DW-628 in all 5 places with the forms below. Re-render the certification table and update `certification-docs.test.ts:86-92` to the new header, keeping its caveat check. `<pkg>` placeholders become `<pkg>@1`.
  - `npx -y @iris-mcp/<server>@1`;
  - `npx -y -p @iris-mcp/client-config@1 iris-mcp-clients <command>`;
  - `npx -y -p @iris-mcp/shared@1 iris-mcp-governance|iris-mcp-credentials …`.
- [ ] `scripts/lib/npx-pin-scan.mjs` and `packages/iris-mcp-all/src/__tests__/npx-pin.test.ts`:
  - Scan these surfaces for unpinned specs:
    - every tracked `*.md` outside `_bmad*`, `.claude`, `irislib`, `irissys` and `sources`;
    - the extension's `src` and `package.json`;
    - the client-config `src`, its `scripts` and its fixtures.

    Cover these forms: `npx`/`npm exec`/`-p`/`--package=`, and JSON/TOML/YAML arg arrays.
  - Keep a reasoned exemption list: CHANGELOG history, dated certification captures, and legacy-input fixtures.
  - Assert the output of client-config's dist `synthesizeEntry` for all five servers.
  - Assert that the extension mirror's literal equals `IRIS_MCP_MAJOR` from client-config's dist.

*Packaging truth:*
- [ ] `packages/iris-mcp-all/src/__tests__/published-tarballs.test.ts`, with a `pnpmPack()` helper added to `pack-fixture.ts`:
  - `pnpm pack` each of the 8 packages into a temp dir, failing rather than skipping on a stale dist.
  - Assert that every `exports`/`main`/`types`/`bin` target of the packed `package.json` is in the tarball.
  - Assert that `LICENSE` and `README.md` are present.
  - Assert there is no `dist/test-helpers`, `__tests__` or `*.map` path, and no vitest peer.
  - Assert `mcpName` is present on the five servers.
- [ ] `packages/iris-mcp-all/src/__tests__/package-manifests.test.ts`:
  - Every manifest's `engines.node` equals the root floor, matching `/^>=22\.\d+\.\d+$/`.
  - Every declared `@types/node` is major 22, and it is declared in all 7 TypeScript packages and the extension.
  - Every field from the metadata task is present on the 8 packages and the extension. `license` is `MIT`, and the root `LICENSE` starts `MIT License`. `repository.directory` equals the package's own directory.
  - The deny-list check passes: no `official`, `endorsed` or `by InterSystems`; no description starting with `InterSystems`; no name containing `intersystems`.
  - The extension is exempt from `engines.node`, and the reason is stated in the test.

*`@iris-mcp/all` (AC 42.1.2):*
- [ ] Update the docs, comment and certification files below. Every doc claim that `@iris-mcp/all` links commands or can be launched gets the same correction (Rule #56).
  - `README.md:25` and `packages/iris-mcp-all/README.md`: a global install links no command. A project install puts the seven commands in `node_modules/.bin`. MCP clients use per-server `npx -y @iris-mcp/<server>@1`.
  - Fix the "real aggregate stdio server" claim in `client-config/src/types.ts:124` and `.changeset/clients-managed-servers.md:7`.
  - In `certification-results.json`, correct the residual-risk prose: it has no `bin`, so it never starts, published or not. Then re-render the table.
- [ ] `packages/client-config/README.md:5` and `README.md:976`: name the skills pack (DW-630 occurrence).

*Node floor (AC 42.1.1):*
- [ ] `README.md:44,63`: change to Node.js 22.17 or later. Reword the Node 18/20 comments at `governance-cross-server.test.ts:186,189`, `governance-cross-server-coverage.test.ts:192,194` and `http-client.test.ts:37`. Keep `CHANGELOG.md:332` as history. The full verdict list is in Design Notes.

*Release mechanism (AC 42.1.4, DW-394):*
- [ ] `scripts/release/changeset-1.0.0.md`: the release changeset template. It names all 8 `@iris-mcp/*` packages as `major` and carries one release line. It lives outside `.changeset/`, which Changesets would consume.
- [ ] `packages/iris-mcp-all/src/__tests__/release-1-0-0-mechanism.test.ts`:
  - Assert that no pending changeset declares `major` and that no `.changeset/pre.json` exists.
  - Build a fixture under `os.tmpdir()`: the root `package.json`, `pnpm-workspace.yaml`, `.changeset/`, and each package's `package.json` and `CHANGELOG.md`, plus a `node_modules` symlink to the repo's.
  - Copy the template in and run the repo's real `node_modules/.bin/changeset version`, then assert the matrix row.
  - Run the red control: the same fixture without the template gives `0.1.0`. Both runs take about 1.6 s.
- [ ] Add a presence guard to the 9 changeset readers in the Code Map, using the existing `skipIf`/`existsSync` pattern.

*Records and the SDK pin:*
- [ ] DW-637: re-check `npm view @modelcontextprotocol/server` and the fast-uri version bundled in the newest release. At planning, 2.3.1 was the latest and upstream PR #2973 was open.
  - If a release bundles fast-uri ≥ 3.1.8, bump every exact `server` and `client` pin and refresh the lockfile.
    - Keep the bump only if the epic-43 golden, cross-era and capstone tests stay green.
    - Otherwise revert it and add a `deferred:` item.
  - Record the verdict in Design Notes.
- [ ] `CHANGELOG.md`, `.changeset/story-42-1-pre-publish-package-fixes.md` and `_bmad-output/implementation-artifacts/42-1-pack-file-lists.md`:
  - Add a top `## [Pre-release — <date>] — Story 42.1: Pre-Publish Package Fixes` section, with `### Changed (AD-15 sanctioned)` naming the `@1` pin (D3) and the Node floor (D4). Re-apply pins existing managed entries.
  - Add the story changeset: `minor` for client-config, `patch` for the rest.
  - Write the final `pnpm pack` file list per package (AC 42.1.8).

**Acceptance Criteria:**
- **AC 42.1.1.** Given the root and all 8 package manifests, when `package-manifests.test.ts` runs, then each declares `engines.node >=22.17.0` and a 22.x `@types/node`. Every Node 18/20 doc mention has its verdict applied, and the full type-check is green.
- **AC 42.1.2.** Given the probe evidence (no `<prefix>/bin` after a global install), when a reader follows any `@iris-mcp/all` instruction, then no doc claims that it links or launches a command.
- **AC 42.1.3 (DW-506).** Given `pnpm pack` of `@iris-mcp/shared`, when `published-tarballs.test.ts` runs, then no export target is missing and no test-helper ships. The test goes red when `publishConfig.exports` is removed.
- **AC 42.1.4 (DW-394).** Given the pending changesets plus the template, when the mechanism test runs the real `changeset version` in a fixture, then all 8 packages are exactly `1.0.0`, each with one `## 1.0.0` section. Without the template the result is `0.1.0`.
- **AC 42.1.5 (DW-31, DW-630).** Given every package, when the manifest test runs, then the metadata, the `mcpName` and the AD-28 deny-list hold.
- **AC 42.1.6 (DW-260).** Given every spec the suite writes, spawns or documents, when `npx-pin.test.ts` and the extension suite run, then each spec carries `@1` from `IRIS_MCP_MAJOR`. The extension's activation-flow test shows that every provided definition has `cwd.fsPath === os.homedir()`.
- **AC 42.1.7 (DW-628).** Given the 5 documented CLI lines, when they are read, then each uses `-p @iris-mcp/client-config@1 iris-mcp-clients`. The tarball probe records exit 0 for the new form and exit 2 for the old one.
- **AC 42.1.8.** Given the final tree, when it is packed, then `42-1-pack-file-lists.md` holds each package's list, and Verification holds the count table.
- **Back-compat (AD-15).** Given the changes above, when `pnpm gen:tools-list-snapshot:check` and the epic-43 golden tests run, then both are unchanged: no wire byte moved.

## Spec Change Log

## Review Triage Log

## Design Notes

**Governing ADs (Rule 6):**
- **AD-2:** cross-package checks live in `iris-mcp-all`; client-config never depends on a server; the extension stays self-contained.
- **AD-14:** generated files change only through their generators.
- **AD-15:** the `@1` pin and the Node 22 floor are already-sanctioned changes, named in the CHANGELOG.
- **AD-28:** names and endorsement.
- **AD-29:** versions, pins, runtime and native code.
- **AD-30:** client-config rewrites only owned entries.
- **AD-32:** the SDK is pinned exactly (DW-637).
- **Conventions:** Frozen goldens (untouched), Turbo test tasks, Probes, and Live testing on a shared instance.

**Rule 2 (extend, don't copy):**
- The extension mirror extends the `constants.ts` pattern (a literal plus a test pinned against the real source).
- `pnpmPack()` extends `pack-fixture.ts`.
- `npx-pin.test.ts` follows `docs-governance-cli-recipes.test.ts`.
- `published-tarballs.test.ts` is a sibling of `story-43-1-qa-pack-confinement.test.ts`. It uses pnpm rather than `npm pack --dry-run`, because only pnpm applies `publishConfig.exports`, and pnpm is the path publishing actually takes.

**Integration ACs:** the I/O rows "Synthesized entry" (the client-config CLI consumes `pinnedSpec`) and "Extension definitions" (VS Code consumes the mirror).
- **Consumed-by:**
  - 42.3, which promotes the manifest, tarball, pin and release tests to CI, and keeps its Node floor equal to `engines.node`;
  - 42.5, whose release script uses the template and pnpm;
  - 42.6, which applies the template, writes the root `1.0.0` section and uses the pack lists;
  - 42.7, which persists the mirrored major;
  - 42.8, whose plugin entries use `pinnedSpec` and whose `server.json` names equal `mcpName`;
  - 42.9, which removes the caveats.
- **Consumes:** the Epic 43 exact SDK pin, and the AD-28 skills pack (unchanged).

**Decisions recorded by this story:**
- **AC 42.1.2:** correct the README rather than add a launcher.
  - Evidence: `npm i -g` (npm 11.19.0) of the packed meta-package created no `<prefix>/bin`. The seven commands landed only in the nested `all/node_modules/.bin`. A project install exposes all seven.
  - A launcher would collide with the leaf bins, and the Lead declined an aggregate server on 2026-07-28.
- **AC 42.1.4 mechanism:** a `major` changeset naming all 8 packages, kept as a template outside `.changeset/` and applied once by Story 42.6, only while the group is below `1.0.0`. One major entry makes the fixed group `0.0.2 → 1.0.0` whatever the 144 patch/minor labels say, so DW-394's patch/minor boundary is moot for 1.0.0.
  - Rejected: committing the major now (AD-29 forbids it), pre-setting `1.0.0` (gives 1.1.0), pre mode (a prerelease tag), and no config option exists.
  - The suite-wide root CHANGELOG `1.0.0` section is Story 42.6's. The per-story root sections are pruned at the Epic 42 retro (AD-15).
- **DW-260 cwd verdict:**
  - **Extension definitions: not real.** VS Code 1.101 and 1.142 start them in `homedir()` when no `cwd` is set. The explicit home `cwd` changes nothing.
  - **Synthesized client entries: real.** The client picks the cwd, often the project, and a local 1.x copy wins. The `@1` pin is the mitigation, and a non-1.x copy no longer shadows (probe: `LOCAL-0.0.2` for a bare spec, registry for `@1`).
- **Exports mechanism:** `publishConfig.exports`, not a dev-only mechanism. Publishing already requires pnpm for `workspace:*` rewriting, so this adds no new dependency on pnpm.
- **MCP Registry** (fetched 2026-10-20): the npm validator compares the published version's `mcpName` with `server.json` `name`. Ownership is proved through the `io.github.<user>/*` namespace via GitHub login. Sources: `registry/docs/modelcontextprotocol-io/package-types.mdx` and `internal/validators/registries/npm.go`.

**Node 18/20 mentions (Rule #56, as of 2026-10-20):**

| Location | Verdict |
|---|---|
| `README.md:44` | fix |
| `README.md:63` | fix |
| `package.json:43` | fix |
| extension `package.json:169` | fix |
| `governance-cross-server.test.ts:186` | reword |
| `governance-cross-server.test.ts:189` | reword |
| `governance-cross-server-coverage.test.ts:192` | reword |
| `governance-cross-server-coverage.test.ts:194` | reword |
| `http-client.test.ts:37` | reword |
| `CHANGELOG.md:332` | keep as history |

The search found no CI, `.nvmrc` or bundler target files.

**Declined ledger entries:**
- **Declined DW-560:** moved to the proposed split story below. An annotation correction changes frozen wire bytes and needs the goldens-ledger generalization.
- **Declined DW-662:** moved to the split story. It is a description replace, so it needs the Frozen-goldens convention amended to permit a sanctioned correction.
- **Declined DW-652:** moved to the split story. It is a feature-sized guard extension on three tools.
- **Declined DW-654:** moved to the split story. It needs the sanctioned-change loader to reach the handler golden's `audit` array.

**AC reinterpretations:**
- **Floor value.** AC 42.1.1's `>=22` is planned as `>=22.17.0`. The spine Stack row assigns 42.1 to fix the minor, and `fs.globSync` is stable from 22.17.0.
- **Changeset count.** AC 42.1.4's "22 pending changesets" is stale: there are 56 (flag for the retro, Rule #42).
- **"One consolidated section".** This means one `## 1.0.0` section per package CHANGELOG. The root `1.0.0` section belongs to Story 42.6.
- **"One exported constant".** This is the client-config constant plus a mirror in the extension, pinned equal by a test.
- **SDK floor.** The v1 SDK-floor bump is not applicable (decision #33).

**Decided at the spec gate (2026-10-21):** all five recommendations below were accepted as written. They are wave-8 orchestrator decisions #34 (the split: the four entries now belong to Story 42.10, `42-10-pre-1-0-tool-surface-corrections`, which runs right after this story), #35 (floor `>=22.17.0`, and no `engines.node` in the extension), #36 (the extension mirror) and #37 (`mcpName`). Spine AD-29 and the Stack row are amended to match.

**Orchestrator decisions needed (as planned):**
1. **Split DW-560, DW-662, DW-652 and DW-654 into a new story ordered before 42.6.** Recommended: proposed key `42-10-pre-1-0-tool-surface-corrections`, placed right after 42.1 in sprint order and made a 42.6 prerequisite. The evidence:
   - All four are AD-15 wire and audit changes that share the frozen-goldens machinery:
     - `story-43-4-sanctioned-golden-changes.test.ts:145-151,153-160,217-232,247-249` and `story-43-4-qa-sanctioned-wire.test.ts:217-223` reject every non-43.4 entry;
     - the loader cannot reach `sdk-handler-golden.json`'s `audit` array (DW-654);
     - the spine needs AD-4, AD-24 and Frozen-goldens amendments.
   - DW-652 alone is a feature:
     - a refusal per file in `load.ts` (DW-540's 409 trick);
     - a multi-class XML scanner for the `format.ts` import;
     - a pre-dialog preflight in `env-promote.ts:853`;
     - an override parameter on three frozen-baseline tools;
     - live refusal pins.
   - 42.1's package scope alone is already about 60 files, with 231 spec rows.
   - Alternative: split only DW-652 and DW-654.
   - Handoff notes for the split story:
     - The DW-560 occurrence adds `iris_ldap_manage`, `iris_x509_manage` and `iris_service_manage`. More candidates: `iris_doc_load`, `iris_execute_classmethod`, `iris_global_set`, `iris_production_item` and `iris_env_promote`.
     - DW-662 also covers the `confirm` schema text at `message-resend.ts:447-448`.
     - For DW-654, `deriveAuditNamespace` (`server-base.ts:2394-2401`) ignores `tool.scope`; there are 25 SYS tools, all on admin.
2. **Node floor `>=22.17.0`.** Recommended over the literal `>=22`. Otherwise `iris_doc_load` warns on stderr on 22.0–22.16. If it is accepted, update the spine Stack row (Rule 20).
3. **`IRIS_MCP_MAJOR` mirror in the extension.** Recommended over a generator. The VSIX has no runtime dependencies and no bundler, so it cannot import client-config, and an equality test gives the same guarantee for one character.
4. **`mcpName` values `io.github.jbrandtmse/<bin>`.** Recommended. Registry names are effectively permanent, and these match the bin and server keys.
5. **No `engines.node` in the extension.** Recommended. VS Code runs it on its own Node, and `engines.vscode` governs. Story 42.7 owns the VSIX manifest.

## Verification

Build first, once per source change: `pnpm --filter "./packages/*" build` (timeout 600000). Run every command from `/Users/jbrandt/git/iris-execute-mcp-v2`.

**Commands:**

*Loop:*
- `(loop)` `pnpm --filter @iris-mcp/client-config test` -- expected: green, including the re-captured goldens and `certification-docs`.
- `(loop)` `pnpm --filter @iris-mcp/all exec vitest run src/__tests__/package-manifests.test.ts src/__tests__/published-tarballs.test.ts src/__tests__/npx-pin.test.ts src/__tests__/release-1-0-0-mechanism.test.ts` -- expected: green.
- `(loop)` `npm --prefix /Users/jbrandt/git/iris-execute-mcp-v2/extensions/iris-mcp-launcher ci` (only after a lockfile change), then `npm --prefix /Users/jbrandt/git/iris-execute-mcp-v2/extensions/iris-mcp-launcher run type-check`, then `npm --prefix /Users/jbrandt/git/iris-execute-mcp-v2/extensions/iris-mcp-launcher test` -- expected: green.

*Once, full per-package suites* (one command each, `timeout: 600000`; split `@iris-mcp/all` by file globs if it would exceed 10 minutes):
- `(once)` `pnpm --filter <pkg> test` for each of `@iris-mcp/shared`, `dev`, `admin`, `interop`, `ops`, `data`, `client-config` and `all` -- expected: green.
- `(once)` `pnpm --filter <pkg> type-check` and `pnpm --filter <pkg> lint` for the 7 TypeScript packages -- expected: green.

*Once, generator checks and changeset status:*
- `(once)` `pnpm gen:tools-list-snapshot:check`, `pnpm gen:governance-baseline:check`, `pnpm gen:pack:check`, `pnpm gen:skills:check`, `pnpm check:provenance`, `pnpm validate:prompts` -- expected: all clean.
- `(once)` `pnpm changeset status --verbose` -- expected: minor 0.1.0, no major.

*Once, manual probes:*
- `(once)` Move every pending `.changeset/*.md` to the scratchpad and run `pnpm --filter @iris-mcp/all test` -- expected: green, with no `ENOENT`. Restore them, then check that `git status --short` is unchanged.
- `(once)` Run `pnpm pack` of client-config and shared into the scratchpad, then the documented forms against the tarballs -- expected: new forms exit 0, the old form exits 2. Record the result under AC 42.1.7. Delete the tarballs.
- `(once)` Run `pnpm pack` of all 8 packages, then write `42-1-pack-file-lists.md`, plus a count table (package, file count, tarball bytes) appended here under `**Pack counts:**`.

**Mutations to apply and record** (`mutation: <change> → <red test>`, one per AC; the implement stage fills these in):
- **AC 42.1.1:** one package's `engines`.
- **AC 42.1.3:** drop `publishConfig.exports`, or drop `!dist/test-helpers`.
- **AC 42.1.4:** template bump set to `minor`.
- **AC 42.1.5:** drop `repository.directory` or `mcpName`.
- **AC 42.1.6:**
  - unpin `synthesize.ts`;
  - unpin one doc row;
  - set the extension mirror to `"2"`;
  - remove `def.cwd`.
- **AC 42.1.7:** revert `README.md:17`.

**Shared surfaces:** every `package.json`, `pnpm-lock.yaml`, the extension `package-lock.json`, the client-config synthesized-entry shape (byte goldens and local `PKG` copies), the extension definition, clients and governance argv, the doc strings pinned by doc-claim tests, the rendered certification table, `.changeset/` (the new file and 9 guarded readers), and the `CHANGELOG.md` top section. `tools-list-snapshot.json` and the SDK goldens must stay unchanged.

**Standing criterion:** every test added or changed passes on a fresh environment, in either order. It builds its own temp fixtures under `os.tmpdir()` and removes them.

**IRIS:** this story's checks never touch IRIS, and no OS %UnitTest class runs. The pre-existing live legs in full package suites may answer from localhost:52773 (DW-627, Story 42.2); they write only their own disposable `ExecuteMCPv2.Temp.*` fixtures. Run each suite in its own call, never re-submitted.

## Auto Run Result

Status: ready-for-dev
Blocking condition: none

The plan stage halted after planning, as the invocation asked (`Halt after planning.`). Nothing was implemented or committed. Every probe ran in the scratchpad, and the working tree holds only this spec.
