---
title: 'Story 42.1: Pre-Publish Package Fixes'
type: 'feature'
created: '2026-10-20'
status: 'done'
baseline_revision: '063416bdedca87c93ad57f9c9bf0ac4ab2f1fddc'
baseline_commit: '063416bdedca87c93ad57f9c9bf0ac4ab2f1fddc'
review_loop_iteration: 0
followup_review_recommended: true
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
  - summary: 'Five extension tests fail on a macOS host, on the baseline as well: four pin Windows paths (`C:\dev\repo` is not absolute on POSIX), and `33-3-3` (the full-stack clients activation flow that drives the real built CLI) times out waiting for a subprocess render. The `(loop)` extension command is therefore not green on this host.'
    evidence: 'Implement stage 2026-10-21: the same five tests fail in a pristine `git archive HEAD` copy of the extension (with the client-config dist copied in) on Node 26.8.1, darwin 25.6; the built CLI answers `detect --json` correctly when run by hand with a sandbox HOME.'
    location: 'extensions/iris-mcp-launcher/src/__tests__/clientsEngine.test.ts (dev-repo mode, unbuilt CLI); extensions/iris-mcp-launcher/src/__tests__/governanceEngine.test.ts (local mode, unbuilt CLI); extensions/iris-mcp-launcher/src/__tests__/clientsActivationFlow.test.ts (33-3-3)'
    severity: 'low'
  - summary: 'Each package keeps a tracked `CHANGELOG.md` that `changeset version` will fill, but `pnpm pack` does not put it in the tarball (the `files` lists name only `dist` and, for client-config, `skills-pack`; pnpm adds only `LICENSE`, `README.md` and `package.json`). The published packages would carry no changelog.'
    evidence: 'Implement stage 2026-10-21: `_bmad-output/implementation-artifacts/42-1-pack-file-lists.md` holds no `CHANGELOG.md` for any package; `packages/client-config` has none on disk until the first `changeset version`.'
    location: 'packages/*/package.json files; Story 42.6 (CHANGELOG sections) and Story 42.5'
    severity: 'low'
  - summary: '`pnpm --filter @iris-mcp/shared lint` reports one warning: an unused `eslint-disable` directive for `@typescript-eslint/no-dynamic-delete`. The file is untouched by this story.'
    evidence: 'Implement stage 2026-10-21: `eslint src/` in packages/shared prints 0 errors and 1 warning at src/cli/governance.ts:935.'
    location: 'packages/shared/src/cli/governance.ts:935'
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
- [x] Every `packages/*/package.json` (all 8) and the root `package.json`:
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
- [x] `packages/shared/package.json`:
  - Add `publishConfig.exports` with only `"."`.
  - Add `"!dist/test-helpers"` and `"!dist/**/*.map"` to `files`.
  - Remove the vitest peer and its meta.
  - The source `exports` stay, so the 90 in-repo test imports still resolve (DW-506).
- [x] The other 6 built packages' `package.json`: add `"!dist/**/*.map"` to `files`. Remove client-config's vitest peer and its meta.
- [x] `extensions/iris-mcp-launcher/package.json`:
  - Add `author`, and pin the setting description at :110.
  - Set `@types/node` to `^22.15.0`. This value is the Node version that VS Code 1.101's Electron runs; confirm it from the 1.101 release notes, and use that minor if it differs.
  - Refresh `package-lock.json` with `npm install` in that directory.
- [x] Run `pnpm install` to refresh `pnpm-lock.yaml`. Then run `tsc --noEmit` on all 7 packages and the extension; the plan probe found 0 errors with 22.20.5.

*The `@1` pin (AC 42.1.6, DW-260):*
- [x] `packages/client-config/src/synthesize.ts` and `src/index.ts`:
  - Export `IRIS_MCP_MAJOR = "1"` and `pinnedSpec(pkg) → "<pkg>@1"`.
  - Have `baseEntry` use `pinnedSpec`.
  - `PKG_BY_SERVER` names stay bare.
- [x] `extensions/iris-mcp-launcher/src/definitions.ts`:
  - Add a literal mirror `IRIS_MCP_MAJOR` and a `pinnedSpec`. Follow the `constants.ts` mirror precedent (no runtime dependency, self-contained VSIX).
  - Use them in `serverDefinitionProvider.ts`, `clientsEngine.ts` and `governanceEngine.ts`, including each `-p` of `universe`.
  - In `extension.ts`, set `def.cwd = vscode.Uri.file(os.homedir())`. This is VS Code's own default today (`extHostMcpNode.ts`, from 1.101). Making it explicit guards against VS Code changing that default.
- [x] Update every spec-pinning test listed in the Code Map to the pinned form, and extend `vscodeMock.ts` with `cwd` and `Uri`. Re-capture the client-config byte goldens with a disposable capture script against the built dist: cite the command and date in `golden.test.ts`'s header, then delete the script.
- [x] Pin every documented spec and fix DW-628 in all 5 places with the forms below. Re-render the certification table and update `certification-docs.test.ts:86-92` to the new header, keeping its caveat check. `<pkg>` placeholders become `<pkg>@1`.
  - `npx -y @iris-mcp/<server>@1`;
  - `npx -y -p @iris-mcp/client-config@1 iris-mcp-clients <command>`;
  - `npx -y -p @iris-mcp/shared@1 iris-mcp-governance|iris-mcp-credentials …`.
- [x] `scripts/lib/npx-pin-scan.mjs` and `packages/iris-mcp-all/src/__tests__/npx-pin.test.ts`:
  - Scan these surfaces for unpinned specs:
    - every tracked `*.md` outside `_bmad*`, `.claude`, `irislib`, `irissys` and `sources`;
    - the extension's `src` and `package.json`;
    - the client-config `src`, its `scripts` and its fixtures.

    Cover these forms: `npx`/`npm exec`/`-p`/`--package=`, and JSON/TOML/YAML arg arrays.
  - Keep a reasoned exemption list: CHANGELOG history, dated certification captures, and legacy-input fixtures.
  - Assert the output of client-config's dist `synthesizeEntry` for all five servers.
  - Assert that the extension mirror's literal equals `IRIS_MCP_MAJOR` from client-config's dist.

*Packaging truth:*
- [x] `packages/iris-mcp-all/src/__tests__/published-tarballs.test.ts`, with a `pnpmPack()` helper added to `pack-fixture.ts`:
  - `pnpm pack` each of the 8 packages into a temp dir, failing rather than skipping on a stale dist.
  - Assert that every `exports`/`main`/`types`/`bin` target of the packed `package.json` is in the tarball.
  - Assert that `LICENSE` and `README.md` are present.
  - Assert there is no `dist/test-helpers`, `__tests__` or `*.map` path, and no vitest peer.
  - Assert `mcpName` is present on the five servers.
- [x] `packages/iris-mcp-all/src/__tests__/package-manifests.test.ts`:
  - Every manifest's `engines.node` equals the root floor, matching `/^>=22\.\d+\.\d+$/`.
  - Every declared `@types/node` is major 22, and it is declared in all 7 TypeScript packages and the extension.
  - Every field from the metadata task is present on the 8 packages and the extension. `license` is `MIT`, and the root `LICENSE` starts `MIT License`. `repository.directory` equals the package's own directory.
  - The deny-list check passes: no `official`, `endorsed` or `by InterSystems`; no description starting with `InterSystems`; no name containing `intersystems`.
  - The extension is exempt from `engines.node`, and the reason is stated in the test.

*`@iris-mcp/all` (AC 42.1.2):*
- [x] Update the docs, comment and certification files below. Every doc claim that `@iris-mcp/all` links commands or can be launched gets the same correction (Rule #56).
  - `README.md:25` and `packages/iris-mcp-all/README.md`: a global install links no command. A project install puts the seven commands in `node_modules/.bin`. MCP clients use per-server `npx -y @iris-mcp/<server>@1`.
  - Fix the "real aggregate stdio server" claim in `client-config/src/types.ts:124` and `.changeset/clients-managed-servers.md:7`.
  - In `certification-results.json`, correct the residual-risk prose: it has no `bin`, so it never starts, published or not. Then re-render the table.
- [x] `packages/client-config/README.md:5` and `README.md:976`: name the skills pack (DW-630 occurrence).

*Node floor (AC 42.1.1):*
- [x] `README.md:44,63`: change to Node.js 22.17 or later. Reword the Node 18/20 comments at `governance-cross-server.test.ts:186,189`, `governance-cross-server-coverage.test.ts:192,194` and `http-client.test.ts:37`. Keep `CHANGELOG.md:332` as history. The full verdict list is in Design Notes.

*Release mechanism (AC 42.1.4, DW-394):*
- [x] `scripts/release/changeset-1.0.0.md`: the release changeset template. It names all 8 `@iris-mcp/*` packages as `major` and carries one release line. It lives outside `.changeset/`, which Changesets would consume.
- [x] `packages/iris-mcp-all/src/__tests__/release-1-0-0-mechanism.test.ts`:
  - Assert that no pending changeset declares `major` and that no `.changeset/pre.json` exists.
  - Build a fixture under `os.tmpdir()`: the root `package.json`, `pnpm-workspace.yaml`, `.changeset/`, and each package's `package.json` and `CHANGELOG.md`, plus a `node_modules` symlink to the repo's.
  - Copy the template in and run the repo's real `node_modules/.bin/changeset version`, then assert the matrix row.
  - Run the red control: the same fixture without the template gives `0.1.0`. Both runs take about 1.6 s.
- [x] Add a presence guard to the 9 changeset readers in the Code Map, using the existing `skipIf`/`existsSync` pattern.

*Records and the SDK pin:*
- [x] DW-637: re-check `npm view @modelcontextprotocol/server` and the fast-uri version bundled in the newest release. At planning, 2.3.1 was the latest and upstream PR #2973 was open.
  - If a release bundles fast-uri ≥ 3.1.8, bump every exact `server` and `client` pin and refresh the lockfile.
    - Keep the bump only if the epic-43 golden, cross-era and capstone tests stay green.
    - Otherwise revert it and add a `deferred:` item.
  - Record the verdict in Design Notes.
- [x] `CHANGELOG.md`, `.changeset/story-42-1-pre-publish-package-fixes.md` and `_bmad-output/implementation-artifacts/42-1-pack-file-lists.md`:
  - Add a top `## [Pre-release — <date>] — Story 42.1: Pre-Publish Package Fixes` section, with `### Changed (AD-15 sanctioned)` naming the `@1` pin (D3) and the Node floor (D4). Re-apply pins existing managed entries.
  - Add the story changeset: `minor` for client-config, `patch` for the rest.
  - Write the final `pnpm pack` file list per package (AC 42.1.8).

**Acceptance Criteria:**
- **AC 42.1.1.** Given the root and all 8 package manifests, when `package-manifests.test.ts` runs, then each declares `engines.node >=22.17.0` and a 22.x `@types/node`. Every Node 18/20 doc mention has its verdict applied, and the full type-check is green.
- **AC 42.1.2.** Given the probe evidence (no `<prefix>/bin` after a global install), when a reader follows any `@iris-mcp/all` instruction, then no doc claims that it links or launches a command.
  - **Re-probe (2026-10-21, npm 11.19.0).** The `pnpm pack` meta-package tarball and the five server and shared tarballs, with their `@iris-mcp/*` dependencies rewritten to `file:` tarballs so they resolve offline of the registry: a project `npm install` of the meta-package alone puts all seven commands in `node_modules/.bin` (`iris-admin-mcp iris-data-mcp iris-dev-mcp iris-interop-mcp iris-mcp-credentials iris-mcp-governance iris-ops-mcp`); `npm install -g --prefix <p>` of it creates **no** `<p>/bin`, and the seven land only in `<p>/lib/node_modules/@iris-mcp/all/node_modules/.bin`. The docs now say exactly that.
- **AC 42.1.3 (DW-506).** Given `pnpm pack` of `@iris-mcp/shared`, when `published-tarballs.test.ts` runs, then no export target is missing and no test-helper ships. The test goes red when `publishConfig.exports` is removed.
- **AC 42.1.4 (DW-394).** Given the pending changesets plus the template, when the mechanism test runs the real `changeset version` in a fixture, then all 8 packages are exactly `1.0.0`, each with one `## 1.0.0` section. Without the template the result is `0.1.0`.
- **AC 42.1.5 (DW-31, DW-630).** Given every package, when the manifest test runs, then the metadata, the `mcpName` and the AD-28 deny-list hold.
- **AC 42.1.6 (DW-260).** Given every spec the suite writes, spawns or documents, when `npx-pin.test.ts` and the extension suite run, then each spec carries `@1` from `IRIS_MCP_MAJOR`. The extension's activation-flow test shows that every provided definition has `cwd.fsPath === os.homedir()`.
- **AC 42.1.7 (DW-628).** Given the 5 documented CLI lines, when they are read, then each uses `-p @iris-mcp/client-config@1 iris-mcp-clients`. The tarball probe records exit 0 for the new form and exit 2 for the old one.
  - **Probe result (2026-10-21, npm 11.19.0, Node 26.8.1, `pnpm pack` tarballs in the scratchpad, a throwaway npm cache and HOME, deleted afterwards).**
    - New form `npx -y -p <client-config tgz> iris-mcp-clients detect --json`: **exit 0**, stdout opens `{"ok":true,"command":"detect","data":{"adapterDataVersion":"2026-07-28.1",...`.
    - Old form `npx -y file:<client-config tgz> iris-mcp-clients list`: **exit 2**, stderr `Error: unknown command "iris-mcp-clients". Valid commands: detect, status, diff, apply, enable, disable, remove, restore, doctor, skills.`
    - The governance recipe `npx -y -p <shared tgz> iris-mcp-governance --help`: **exit 0**.
    - The `@1` suffix itself cannot resolve until the packages are published (Story 42.6); the probe uses the tarball path in the position the pinned spec takes.
- **AC 42.1.8.** Given the final tree, when it is packed, then `42-1-pack-file-lists.md` holds each package's list, and Verification holds the count table.
- **Back-compat (AD-15).** Given the changes above, when `pnpm gen:tools-list-snapshot:check` and the epic-43 golden tests run, then both are unchanged: no wire byte moved.

## Spec Change Log

## Review Triage Log

### 2026-10-21 — Review pass
- verdicts: 40 findings — high 0, medium 5, low 28, false 7, maybe-false 0
- findings (layer order: blind-hunter 10, edge-case-hunter 10, verification-gap 9, intent-alignment 11):
  - `[low]` `[reject]` BH1 pre-pin managed entries stay unpinned until re-applied; `enable` of a stashed client restores the stashed entry verbatim; `status`/`doctor` never compare `args` — real, but an unpinned entry still resolves exactly as it did before the story and the CHANGELOG says only that re-apply pins; the fix is new engine behavior (re-pin on enable, a doctor check), more than a direct correction. reopen_if: a 2.0 ships while managed entries still hold the bare spec.
  - `[low]` `[reject]` BH2 the `>=22.17.0` floor is declared but never exercised; `@types/node ^22.17.0` resolves to 22.20.5 — the spec's Tasks fix `^22.17.0`; running the floor needs a CI node matrix, which Story 42.3 owns (Consumed-by); editing the declared range is a spec change.
  - `[low]` `[patch]` BH3 extension CHANGELOG records none of the launcher behavior change, and the extension README says a project-local copy "can never shadow" the pinned one — an ancestor `package.json` or `node_modules` of the home directory still can; patched: README reworded to "is not picked up", extension CHANGELOG `Changed` bullet added (Story 42.1).
  - `[low]` `[patch]` BH4 client-config README says the `-p` form "is required because the bin is named differently" — the package has one bin, so the real failure is `iris-mcp-clients` reaching the CLI as a command (spec probe, exit 2); patched: the sentence now says exactly that (kept short so `certification-docs.test.ts`'s 300-character caveat window still holds).
  - `[low]` `[reject]` BH5 the 2026-07-28 Project Lead decision is now cited next to the no-`bin` reason — cosmetic attribution wording; the spec directs the correction of the false "real aggregate" premise and the CHANGELOG records the change.
  - `[low]` `[reject]` BH6 certification note says all 2026-07-28 blocks used `iris-mcp-all` — the blanket sentence pre-dates the diff; the per-block text the diff wrote matches each block's own `server` field (claude-code `iris-dev-mcp`; vscode, cline, kimi-code `iris-mcp-all`); cosmetic.
  - `[low]` `[patch]` BH7 `@iris-mcp/all` keywords include `mcp-server` while its docs say it is not a server — removed from `packages/iris-mcp-all/package.json`.
  - `[low]` `[patch]` BH8 the eight per-package `LICENSE` copies are not tied to the root file — `package-manifests.test.ts` now asserts each package's `LICENSE` (extension included) is a byte copy of the root; mutation line recorded.
  - `[low]` `[patch]` BH9 stale comments and records — patched: "the 42 pending minors" tally removed from `release-1-0-0-mechanism.test.ts` (Rule #51), the `pnpmPack` JSDoc no longer demands an existing directory, the CHANGELOG test list now names `meta-package-docs.test.ts` and `pinnedDefinitionsActivationFlow.test.ts`; the `governanceEngine.test.ts` title (describes the production derivation, still true) and the golden capture date (the capture ran 2026-10-20, before midnight) were checked and are not stale.
  - `[low]` `[patch]` BH10 scan surface narrower than "every spec the suite writes, spawns or documents"; `.mdc` not read; shared, the servers and root `scripts/` unscanned — probe: 987 files, zero unexempted hits outside the tooling's own synthetic input, so a drift-guard gap only; patched: `listScanSurface` reads every tracked text file (`.mdc` added, lockfiles apart), `PIN_TOOLING_FILES` exempts the tooling's own files with a reason, and the surface test pins shared, server, `.mdc` and root-script members.
  - `[low]` `[reject]` EC1 stash `enable` restores a pre-pin entry — same root cause as BH1.
  - `[low]` `[reject]` EC2 on Node below 22 the dev server's `globSync` import fails opaquely; `engines.node` is advisory — the `globSync` dependency pre-dates the story (the old `>=18` floor was the error this story fixes); a startup version guard is new server behavior, outside this story.
  - `[low]` `[reject]` EC3 `os.homedir()` throwing or returning an empty string in `activate` — no realistic extension-host reach; VS Code's own default calls the same function.
  - `[low]` `[reject]` EC4 the scan misses a spec after another `npx` flag, a bare array element without `-y`, `pnpm dlx`/`bunx` — the spec lists the forms to cover and the widened-surface probe found no such occurrence; theoretical.
  - `[false]` `[reject]` EC5 scoped packages published through `pnpm publish` default to restricted access — `.changeset/config.json` already sets `"access": "public"`, which `changeset publish` passes; the release script is Story 42.5's.
  - `[low]` `[reject]` EC6 `pnpmPack` swallows spawn errors and breaks on a Windows temp path with spaces — a failure still throws (status null or non-zero), so only the message is thin; the spaced path is Windows-only and hypothetical here.
  - `[low]` `[reject]` EC7 a deleted or renamed pending changeset skips its bump-map test silently — the spec's Tasks prescribe exactly this `skipIf`/`existsSync` presence guard; by design.
  - `[medium]` `[patch]` EC8 `meta-package-docs.test.ts` asserted `.changeset/clients-managed-servers.md` is on the scan surface, which fails once `changeset version` consumes it — same root cause as VG2; assertion removed (the other three anchors prove the surface is non-empty); the after-release probe (all 168 files, changesets moved away) is green.
  - `[medium]` `[patch]` EC9 the root README rewrite dropped the "Once published" caveat of the sentence it replaced, against the spec's keep-the-caveats boundary — restored ("Once published, `@iris-mcp/all` installs ...").
  - `[false]` `[reject]` EC10 AC 42.1.1 read literally wants `@types/node` on the root and `@iris-mcp/all` — Tasks & Acceptance declares it in the seven TypeScript packages and the extension, and the root and the meta-package have no TypeScript to type.
  - `[medium]` `[patch]` VG1 Zed and Goose re-apply never observe the pinned `args` (the update branches of `mergeUpdateEntry`; only claude-code JSON and Codex TOML were pinned) — added a Zed and a Goose re-apply test over the legacy fixtures (owned `args` pinned, bytes outside the entry identical); mutation lines recorded for all four families.
  - `[medium]` `[patch]` VG2 the AC 42.1.2 pinning test breaks after `changeset version` — same root cause as EC8; one fix.
  - `[low]` `[patch]` VG3 the sanctioned `it.skipIf` in the Story 43.4 gate guard is checked by construct name and count only — the guard now also requires the exact `it.skipIf(!changesetPresent)` call and the `changesetPresent` initializer; mutation `skipIf(true)` observed red.
  - `[low]` `[patch]` VG4 the codex TOML and claude-code JSON re-apply tests carry no `mutation:` line — written (Rule 19, in-pass): `diff.ts` mutations observed red per family.
  - `[low]` `[reject]` VG5a AC 42.1.8 has no pinning test — it is a point-in-time record (file lists and byte counts that move with every later change); a test on it would be brittle by design, and the final `pnpm pack` run re-checked every recorded list against the tarballs.
  - `[false]` `[reject]` VG5b the AD-15 back-compat AC has no `mutation:` line — it is pinned by `gen:tools-list-snapshot:check` and the Epic 43 golden tests, which run in the default suite and carry their own mutation evidence; both were green and the snapshot is byte-unchanged.
  - `[low]` `[patch]` VG6 no test covers AC 42.1.1's "every Node 18/20 doc mention has its verdict applied" — `package-manifests.test.ts` now ties the README floor to `engines.node` and sweeps the documents for Node 18/20; mutation line recorded.
  - `[low]` `[reject]` VG7 AC 42.1.5's DW-630 wording (description no longer "read-only foundation", READMEs name the skills pack) is untested — static prose; the safety-relevant part (AD-28 deny-list) is pinned.
  - `[false]` `[reject]` VG8 hygiene note (fixed tick count in the activation-flow wait; fail-not-skip on a stale dist) — filed by the layer as "no change needed"; no bad outcome.
  - `[low]` `[reject]` IA-a the packed `exports` override works only through pnpm — documented in the CHANGELOG limits and already in the spec's `deferred:` list (Story 42.5 owns the release script).
  - `[low]` `[reject]` IA-b installed-user behavior is evidenced by one-off probes, and the pinned `@1` was never executed — the spec asks for the probes as recorded evidence, and `@1` cannot resolve before the first publish.
  - `[low]` `[reject]` IA-c the Node floor is never run on a 22.17 runtime — same root cause as BH2.
  - `[false]` `[reject]` IA-d the extension test's expected `fsPath` shares the mock's win32 drive-letter lowering — the mock is pinned to `@types/vscode` 1.125.0 and the real `Uri.file` lowers the drive letter; the expected value is derived from `os.homedir()`, not from the mock.
  - `[false]` `[reject]` IA-e local-mode definitions also get the home `cwd` — AC 42.1.6 says every provided definition has `cwd.fsPath === os.homedir()`; the matrix's "local mode unchanged" is the spawn target, which is unchanged.
  - `[medium]` `[patch]` IA-f re-apply coverage covers only TOML and claude-code JSON — same root cause as VG1.
  - `[low]` `[patch]` IA-g pin enforcement bounded to Markdown, the extension and client-config — same root cause as BH10.
  - `[low]` `[reject]` IA-h after-release behavior rests on static presence guards — spec-prescribed; the (once) probe ran the whole `@iris-mcp/all` suite with the 57 pending changesets moved away and it was green, with no `ENOENT`.
  - `[low]` `[reject]` IA-i the release fixture is hand-assembled, not the full tree — spec-prescribed (root manifest, workspace file, `.changeset/`, package manifests and changelogs, linked `node_modules`); Story 42.6 runs the real command.
  - `[low]` `[patch]` IA-j the `LICENSE` copies are not asserted equal — same root cause as BH8.
  - `[false]` `[reject]` IA-k the certification `residualRisk` rewrite for copilot, cline and kimi-code is unbacked — `certification-results.json` records `"server": "iris-mcp-all"` for the vscode, cline and kimi-code blocks, and the claude-code block's own `server` is `iris-dev-mcp`, which is what its rewritten text says.

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

**Implementation record (2026-10-21):**
- **DW-637 verdict: no bump.** `npm view @modelcontextprotocol/server` still lists 2.3.1 (published 2026-10-05) as `latest`, and no later version exists. Its dist bundles fast-uri 3.1.0 (`fast-uri@3.1.0/node_modules/fast-uri/...` paths in the dist), below the 3.1.8 bar. Upstream PR #2973 ("bundle fast-uri 3.1.8 in dist to clear nine advisories") is still open and unmerged (`gh pr view`). The exact `server` and `client` pins stay at 2.3.1 and the lockfile moved only for `@types/node`. The spine Stack row already says the bump waits for such a release, so no `deferred:` item was added.
- **Extension `@types/node`.** The VS Code 1.101 release notes (code.visualstudio.com/updates/v1_101) say "Electron 35 ... Chromium 134.0.6998.205 and Node.js 22.15.1", so `^22.15.0` stands (no different minor). `npm install` refreshed the extension's lockfile to 22.20.5, and `npm ci` then installed cleanly.
- **Legacy-input fixtures and tests.** The client-config fixtures that model a user's existing config (`fixtures/**`, except the golden stages' synthesized lines) keep their unpinned `@iris-mcp/<pkg>` entries and are exempt, with a reason, in `scripts/lib/npx-pin-scan.mjs`. In the golden stages the exemption covers only the pre-existing `iris-dev-mcp` / `iris-data-mcp` line; the applied `ops` / `interop` entry is scanned and pinned (re-captured). A test literal that has to stay unpinned carries an inline `npx-pin-exempt: <reason>` marker, and the scan test fails on a marker whose line holds no spec or on an exemption that matches nothing. Tests that apply the canonical entry over a legacy fixture and expected a no-op now say so with `legacyUnpinnedEntry`, and two new tests pin the upgrade (`diff.test.ts` TOML, `engine.test.ts` JSON): only the owned `args` moves.
- **Existing tests changed beyond the Code Map.**
  - `story-43-3-doc-claims.test.ts` and `story-43-4-doc-claims.test.ts` pinned the Story 43.4 / 43.3 CHANGELOG sections as the top two; they now pin the order (43.4 directly above 43.3) wherever the sections sit, because the 42.1 section is the new top.
  - `story-43-4-qa-gate-guards.test.ts` forbids any skip construct in the Story 43.4 tests. The changeset-presence guard of `story-43-4-doc-claims.test.ts` is the one construct it now sanctions, by name and exactly once; every other file stays skip-free.
  - `golden.test.ts`'s header cites the re-capture command and date (Rule #36); the capture script was deleted.
- **Release mechanism test lifecycle.** The fixture runs skip once every package is at least 1.0.0 (the template has then been applied); the checks on the real tree run always. The red control computes its expected version from the pending changesets (0.1.0 with a minor pending, 0.0.3 with only patches, unchanged with none), so the suite also passes with every pending changeset moved away.
- **Per-package `LICENSE`.** `pnpm pack` adds only the package's own `LICENSE`, so each of the eight packages carries a byte copy of the root MIT `LICENSE` (the extension already had one).
- **Judgment calls.** The package keywords avoid the word "intersystems" (a nominative mention would pass the deny-list, but AD-28 says no keyword implies ownership). `mcpName` is asserted on the five servers and on nothing else, so Story 42.8 sees a change to that set.

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
- `(loop)` `pnpm --filter @iris-mcp/all exec vitest run src/__tests__/package-manifests.test.ts src/__tests__/published-tarballs.test.ts src/__tests__/npx-pin.test.ts src/__tests__/release-1-0-0-mechanism.test.ts src/__tests__/meta-package-docs.test.ts` -- expected: green.
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

**Mutations applied and recorded** (`mutation: <change> → <red test>`, one per AC; each applied to the real file, the named test observed red on the path it guards, then the file restored from a scratchpad copy and compared byte-identical with `cmp`; run 2026-10-21):
- **AC 42.1.1:** mutation: `packages/iris-data-mcp/package.json` `engines.node` `>=22.17.0` → `>=20.0.0` → red: `package-manifests.test.ts` "the Node floor (AC 42.1.1, AD-29) > @iris-mcp/data (packages/iris-data-mcp) declares engines.node equal to the root floor" (1 of 79 red).
  - mutation (documented floor, review pass 2026-10-21): root `README.md` `- **Node.js** 22.17 or later` → `- **Node.js** 18 or later` → red: `package-manifests.test.ts` "the documented Node floor (AC 42.1.1) > the root README prerequisites and build requirement state the manifest floor" and "no document names Node 18 or 20 (the CHANGELOG history excepted)" (2 of 91 red; README restored and compared byte-identical with `cmp`).
- **AC 42.1.2:** mutation: root `README.md` `### Meta-package` paragraph restored to the pre-story claim (`Once published, all servers will be installable at once with npm install -g @iris-mcp/all`) → red: `meta-package-docs.test.ts` "the two places that describe a global install > the root README says the same under the meta-package heading" and "no document or source claims @iris-mcp/all links or launches a command > the sweep finds nothing on the npx-pin scan surface" (2 of 6 red; README restored from a scratchpad copy and compared byte-identical with `cmp`, 2026-10-21).
- **AC 42.1.3:**
  - mutation: `packages/shared/package.json` `publishConfig` (its `exports`) removed → red: `published-tarballs.test.ts` "the eight packed tarballs > shared: no problem is found in its tarball" and "@iris-mcp/shared (AC 42.1.3, DW-506) > advertises only its root export once packed" (the real `pnpm pack` tarball keeps the three `./test-helpers` exports), plus the `package-manifests.test.ts` shared-exports row (3 of 105 red).
  - mutation: `"!dist/test-helpers"` removed from shared's `files` → red: `published-tarballs.test.ts` "shared: no problem is found in its tarball" and "ships no test helper, test, source map or source file" (the packed tarball holds `dist/test-helpers/*`), plus the `package-manifests.test.ts` files row (3 of 105 red).
- **AC 42.1.4:**
  - mutation: `scripts/release/changeset-1.0.0.md` with `"@iris-mcp/data": major` → `minor` → red: `release-1-0-0-mechanism.test.ts` "the template names all eight packages as major and sits outside .changeset/" (1 of 6 red; the real `changeset version` still lands on 1.0.0 because the fixed group follows the other seven majors, so the static template row is what catches one wrong entry).
  - mutation: every `major` in the template → `minor` → red: the same row and "changeset version in a throwaway fixture > with the template, all eight packages are exactly 1.0.0 ..." (`@iris-mcp/client-config: expected '0.1.0' to be '1.0.0'`; 2 of 6 red).
- **AC 42.1.5:**
  - mutation: `repository.directory` removed from `packages/iris-ops-mcp/package.json` → red: `package-manifests.test.ts` "registry metadata (AC 42.1.5, DW-31) > @iris-mcp/ops (packages/iris-ops-mcp) > names its repository and its own directory in it" (1 of 79 red).
  - mutation: `mcpName` removed from `packages/iris-ops-mcp/package.json` → red: `package-manifests.test.ts` "mcpName ... > @iris-mcp/ops ... carries io.github.jbrandtmse/<bin>" and "no other package carries an mcpName", plus `published-tarballs.test.ts` "iris-ops-mcp: no problem is found in its tarball" and "the five servers carry mcpName and the others do not" (4 of 105 red).
  - mutation (review pass 2026-10-21): one space appended to `packages/iris-ops-mcp/LICENSE` → red: `package-manifests.test.ts` "the license text each package ships (AC 42.1.5) > @iris-mcp/ops (packages/iris-ops-mcp) ships a LICENSE that is a byte copy of the root LICENSE" (1 of 91 red; file restored and compared byte-identical with `cmp`).
- **AC 42.1.6:**
  - mutation: `packages/client-config/src/synthesize.ts` `baseEntry` back to `["-y", PKG_BY_SERVER[server]]` (client-config rebuilt, then rebuilt again after restoring) → red: `npx-pin.test.ts` "what the code writes > synthesizeEntry yields `npx -y <pkg>@1` for all five servers, in every mode, on every adapter" and "the built `iris-mcp-clients apply` writes the pinned entry into a temp client config" (2 of 39 red), and 7 of 28 in `synthesize.test.ts` + `golden.test.ts`.
  - mutation: one `"args": ["-y", "@iris-mcp/dev@1"]` row of `docs/client-config/cursor.md` → unpinned → red: `npx-pin.test.ts` "no unpinned spec on the surface > every spec is pinned, exempted with a reason, or the scan names file:line" (names `docs/client-config/cursor.md:54  @iris-mcp/dev`).
  - mutation: `extensions/iris-mcp-launcher/src/definitions.ts` `IRIS_MCP_MAJOR = "1"` → `"2"` → red: `npx-pin.test.ts` "the constant > the extension's literal mirror equals client-config's IRIS_MCP_MAJOR" (`extension mirror is "2" but @iris-mcp/client-config exports "1"`), and 6 tests of the extension's `pinnedDefinitionsActivationFlow.test.ts` + `serverDefinitionProvider.test.ts`.
  - mutation: `def.cwd = cwd;` removed from `extensions/iris-mcp-launcher/src/extension.ts` → red: `pinnedDefinitionsActivationFlow.test.ts` "npx mode: every definition spawns the @1-pinned package and starts in the user's home directory" and "local developmentRepoPath mode: ... the cwd is still the home directory" (`expected undefined to be '/Users/jbrandt'`; 2 of 3 red).
  - mutation (re-apply over an unpinned entry, review pass 2026-10-21; each applied to `packages/client-config/src/diff.ts`, restored and compared byte-identical with `cmp`):
    - `case "standard"` `merged.args = fresh.args;` → `merged.args = existing.args;` → red: `engine.test.ts` "apply (AC 33.1.1 + I1) > re-apply over a previously applied UNPINNED entry pins the owned args; every foreign byte is identical" (claude-code JSON), plus the cline JSONC apply-update row (2 of 84 red);
    - Zed `mergedCommand.args = freshCommand.args;` → `mergedCommand.args = mergedCommand.args;` → red: `diff.test.ts` "Zed re-apply over the legacy fixture's unpinned entry pins the owned command.args" (1 of 84 red);
    - Goose `merged.args = fresh.args;` → `merged.args = existing.args;` → red: `diff.test.ts` "YAML CST ops (Goose) > re-apply over the legacy fixture's unpinned entry pins the owned args" (1 of 84 red);
    - Codex TOML `const argsUnchanged = Array.isArray(existing.args) && jsonDeepEqual(existing.args, fresh.args);` → `const argsUnchanged = Array.isArray(existing.args);` → red: `diff.test.ts` "TOML section splices (Codex) > re-apply of the pinned entry over a previously applied unpinned entry rewrites only the owned args line" (plus two existing apply-update rows; 3 of 84 red).
  - mutation (scan surface beyond Markdown and the extension): `// npx -y @iris-mcp/dev` added as line 1 of `scripts/lib/dist-freshness.mjs` → red: `npx-pin.test.ts` "no unpinned spec on the surface > every spec is pinned, exempted with a reason, or the scan names file:line" (names `scripts/lib/dist-freshness.mjs:1  @iris-mcp/dev`; 1 of 46 red; file restored and compared byte-identical with `cmp`).
  - mutation (the Story 43.4 skip guard): `it.skipIf(!changesetPresent)` → `it.skipIf(true)` in `story-43-4-doc-claims.test.ts` → red: `story-43-4-qa-gate-guards.test.ts` "the capstone and the Story 43.4 tests contain no skip construct and never read IRIS_REQUIRE_LIVE" (1 of 6 red; file restored and compared byte-identical with `cmp`).
- **AC 42.1.7:** mutation: `packages/client-config/README.md` line `Ships as a bin ...` back to `npx -y @iris-mcp/client-config iris-mcp-clients <command>` → red: `certification-docs.test.ts` "33-5-16: the CLI npx header carries the not-yet-published caveat", and in `npx-pin.test.ts` (3 of 46 red) "no unpinned spec on the surface" (names `packages/client-config/README.md:20`), "the documented bin invocations use the -p form > every documented `npx ... iris-mcp-clients|governance|credentials` line names its package with -p and the pin" (`npx runs the package, not the iris-mcp-clients bin: use -p <package> iris-mcp-clients`) and "packages/client-config/README.md documents `npx -y -p @iris-mcp/client-config@1 iris-mcp-clients <command>`". The same checker is shown by control rows to reject the old form, a pinned package used as the command, and a missing pin.

**QA tests added `(QA)`** (2026-10-21; gap analysis against the I/O matrix and the ACs; each file is in its package's default suite, none touches IRIS):
- `packages/iris-mcp-all/src/__tests__/story-42-1-qa-packed-clis.test.ts` `(QA)` -- AC 42.1.7 and the matrix rows "Documented CLI form" and "Synthesized entry": `pnpm pack` of client-config and shared, the PACKED bins run in real child processes (`detect --json` exit 0 with the envelope; the old form's argv `iris-mcp-clients list` exit 2 `unknown command "iris-mcp-clients"`; `apply` writes `["-y","@iris-mcp/dev@1"]`; `--help` of all three bins), and each documented `npx -y -p @iris-mcp/<pkg>@1 <bin>` line names a package whose packed manifest has that bin. The manual probe of AC 42.1.7 is now an automated test.
- `packages/iris-mcp-all/src/__tests__/story-42-1-qa-packed-servers.test.ts` `(QA)` -- AC 42.1.3 and "Every tarball": the five servers packed with `pnpm pack`, given a `node_modules` of ONLY their declared runtime dependencies plus the PACKED shared (root export only), start against a closed port and answer `tools/list`; the list equals the repository build's, entry for entry.
- `packages/iris-mcp-all/src/__tests__/story-42-1-qa-changeset-readers.test.ts` (with `hide-changesets-preload.mjs`) `(QA)` -- matrix row "After release": every test file that mentions `.changeset` (found by reading the sources) runs in its own vitest process with the real `.changeset/*.md` hidden from `node:fs`; all must pass. Replaces the manual "move the changesets away" probe as a guard for Stories 42.2 to 42.6.
- `packages/iris-mcp-all/src/__tests__/story-42-1-qa-meta-package-commands.test.ts` `(QA)` -- AC 42.1.2: the commands a project install of `@iris-mcp/all` links are derived from the manifests (Rule #51) and the two READMEs are pinned to that set and count.
- `packages/iris-mcp-all/src/__tests__/story-42-1-qa-records.test.ts` `(QA)` -- AC 42.1.8 and the record tasks: the root CHANGELOG section (sanctioned heading, `@1`, floor, re-apply sentence), the story changeset's bump map (guarded), and the internal consistency of `42-1-pack-file-lists.md`.
- `extensions/iris-mcp-launcher/src/__tests__/pinnedDefinitionsResolveFlow.test.ts` `(QA)` -- AC 42.1.6, matrix row "Extension definitions": the definition the editor LAUNCHES (the one `resolveMcpServerDefinition` returns) keeps the `@1` args and the home-directory `cwd`, in npx and local mode.

**QA mutations `(QA)`** (each applied to the real file, the named test observed red on the path it guards, the file restored from a scratchpad copy and compared byte-identical with `cmp`, `git status --short` unchanged; run 2026-10-21):
- **AC 42.1.2:** mutation: `"iris-dev-extra": "./dist/index.js"` added to `bin` in `packages/iris-dev-mcp/package.json` → red: `story-42-1-qa-meta-package-commands.test.ts` "are the five servers' commands and the two commands of @iris-mcp/shared", "the meta-package README names exactly those commands and counts them" and "the root README and the install comment repeat the same count" (3 of 4 red).
- **AC 42.1.3 and "Every tarball":** mutation: `"zod": "^4.3.6"` removed from `dependencies` in `packages/iris-ops-mcp/package.json` → red: `story-42-1-qa-packed-servers.test.ts` "iris-ops-mcp" (the packed server cannot load; `published-tarballs.test.ts` and `package-manifests.test.ts` stayed green, so only the runtime test sees an undeclared dependency).
- **AC 42.1.4 (matrix row "After release"):** mutation: `const CHANGESET_PRESENT = existsSync(...)` → `const CHANGESET_PRESENT = true;` in `story-40-4-doc-claims.test.ts` → red: `story-42-1-qa-changeset-readers.test.ts` "runs them all in a child vitest process with the real .changeset hidden" (`ENOENT ... readFileSync '.../.changeset/story-40-4-test-depth-docs-prompt-and-capstone.md'`); the mutated file alone stayed green with the changesets present.
- **AC 42.1.5 and the records:** mutation: the `LICENSE` bullet deleted from the `@iris-mcp/ops` block of `42-1-pack-file-lists.md` → red: `story-42-1-qa-records.test.ts` "agrees with itself ..." and "each list carries package.json, LICENSE and README.md ..." (2 of 7 red). mutation: `"@iris-mcp/client-config": minor` → `patch` in `.changeset/story-42-1-pre-publish-package-fixes.md` → red: "bumps @iris-mcp/client-config by a minor and the other seven packages by a patch". mutation: `### Changed (AD-15 sanctioned)` → `### Changed` in `CHANGELOG.md` → red: "names the @1 pin and the Node floor under 'Changed (AD-15 sanctioned)' ...".
- **AC 42.1.6:**
  - mutation: `return server;` in `extension.ts` `resolveMcpServerDefinition` replaced by a new `McpStdioServerDefinition(label, command, args, env)` (drops `cwd`) → red: `pinnedDefinitionsResolveFlow.test.ts` (both tests); `pinnedDefinitionsActivationFlow.test.ts`, `activationFlow.test.ts` and `governanceActivationFlow.test.ts` stayed green.
  - mutation: `packages.push(pinnedSpec(PACKAGE_NPM_NAME[key]))` → `packages.push(PACKAGE_NPM_NAME[key])` in `governanceEngine.ts` (the `universe` `-p` list) → red: `governanceEngine.test.ts` "published mode for `universe` additionally -p-installs the five server packages ...".
  - mutation: `pinnedSpec(CLIENTS_CLI_NPM_PACKAGE)` → `CLIENTS_CLI_NPM_PACKAGE` in `clientsEngine.ts` → red: `clientsEngine.test.ts` "published mode: npx -y -p @iris-mcp/client-config@1 iris-mcp-clients".
- **AC 42.1.7:**
  - mutation: the unknown-command exit `return 2;` → `return 1;` in `packages/client-config/src/cli/clients.ts` (client-config rebuilt, then rebuilt again after restoring) → red: `story-42-1-qa-packed-clis.test.ts` "the old form hands the bin its own name as the command: exit 2, unknown command" (`expected 1 to be 2`).
  - mutation: `docs/client-config/cursor.md:244` `-p @iris-mcp/shared@1 iris-mcp-credentials` → `-p @iris-mcp/client-config@1 iris-mcp-credentials` → red: `story-42-1-qa-packed-clis.test.ts` "every documented `npx -y -p @iris-mcp/<pkg>@1 <bin>` line names a package whose packed manifest has that bin" (1 of 8 red).
- **Back-compat (AD-15, no wire byte moved):** mutation: `"List, get details, or delete REST API dispatch classes on IRIS. "` → `"List, fetch details, ..."` in `packages/iris-data-mcp/src/tools/rest.ts` (data rebuilt, then rebuilt again after restoring) → red: `pnpm gen:tools-list-snapshot:check` exit 1 (`iris-data-mcp iris_rest_manage.description differs at $.description (character 6)`) and `tools-list-snapshot.test.ts` (3 of 28 red). The story's diff touches no server source file.

**Pack counts:** final `pnpm pack` of the eight packages, 2026-10-21 (the full lists are in `_bmad-output/implementation-artifacts/42-1-pack-file-lists.md`; no tarball holds a `dist/test-helpers`, `__tests__` or `*.map` path):

| Package | Files | Tarball bytes |
|---|---:|---:|
| `@iris-mcp/client-config` | 64 | 174366 |
| `@iris-mcp/shared` | 73 | 521250 |
| `@iris-mcp/admin` | 43 | 50793 |
| `@iris-mcp/data` | 17 | 25545 |
| `@iris-mcp/dev` | 73 | 233665 |
| `@iris-mcp/interop` | 45 | 78086 |
| `@iris-mcp/ops` | 37 | 44063 |
| `@iris-mcp/all` | 3 | 5714 |

**Shared surfaces:** every `package.json`, `pnpm-lock.yaml`, the extension `package-lock.json`, the client-config synthesized-entry shape (byte goldens and local `PKG` copies), the extension definition, clients and governance argv, the doc strings pinned by doc-claim tests, the rendered certification table, `.changeset/` (the new file and 9 guarded readers), and the `CHANGELOG.md` top section. `tools-list-snapshot.json` and the SDK goldens must stay unchanged.

**Standing criterion:** every test added or changed passes on a fresh environment, in either order. It builds its own temp fixtures under `os.tmpdir()` and removes them.

**IRIS:** this story's checks never touch IRIS, and no OS %UnitTest class runs. The pre-existing live legs in full package suites may answer from localhost:52773 (DW-627, Story 42.2); they write only their own disposable `ExecuteMCPv2.Temp.*` fixtures. Run each suite in its own call, never re-submitted.

## Auto Run Result

Status: done
Blocking condition: none

**Summary of the implemented change.** Story 42.1 makes the eight `@iris-mcp/*` packages publishable and pins every `npx` spec to `@1`. Nothing was published, versioned or tagged, no `major` changeset sits in `.changeset/`, no tool, annotation, description, schema or wire byte moved, and no ObjectScript class was touched (`BOOTSTRAP_VERSION` unchanged).
- **The `@1` pin.** `@iris-mcp/client-config` exports `IRIS_MCP_MAJOR` and `pinnedSpec()`; `iris-mcp-clients apply` writes `["-y", "@iris-mcp/<pkg>@1"]`; the extension holds a literal mirror, uses it in the provider and in the clients and governance CLI spawns (each `-p` of `universe` included), and sets every provided definition's `cwd` to the home directory. All documented specs are pinned and the five DW-628 CLI lines use `-p @iris-mcp/client-config@1 iris-mcp-clients`.
- **Manifests.** All eight packages and the root declare `engines.node >=22.17.0`; `@types/node` is major 22 (the extension `^22.15.0`); the eight packages carry license, repository, author, homepage, bugs and keywords (plus a `LICENSE` copy each); the five servers carry `mcpName`. `@iris-mcp/shared` publishes only its root export through `publishConfig.exports`, and no tarball ships test helpers, source maps or a vitest peer.
- **`@iris-mcp/all`.** The READMEs, a type comment, the certification records and `.changeset/clients-managed-servers.md` now say it has no `bin`: a global install links nothing, a project install links the seven commands.
- **Release mechanism.** `scripts/release/changeset-1.0.0.md` (all eight `major`, outside `.changeset/`); a real `changeset version` in a throwaway fixture lands every package on `1.0.0` (and `0.1.0` without the template); the nine changeset readers skip once their changeset is consumed.
- **Tests added in `@iris-mcp/all`.** `package-manifests`, `published-tarballs` (with `pnpmPack()`), `npx-pin` (with `scripts/lib/npx-pin-scan.mjs`), `release-1-0-0-mechanism` and `meta-package-docs`; in the extension `pinnedDefinitionsActivationFlow`; in client-config re-apply tests for the Zed, Goose, Codex and claude-code families.
- **Records.** Root CHANGELOG section, `.changeset/story-42-1-pre-publish-package-fixes.md` (client-config `minor`, the rest `patch`), `42-1-pack-file-lists.md`, the extension CHANGELOG entry; DW-637 verdict in Verification: no bump (2.3.1 is still the newest release and bundles fast-uri 3.1.0).

**Files changed (103: 85 modified, 18 new).**
- Manifests and lockfiles: root and eight package `package.json`, `pnpm-lock.yaml`, the extension `package.json` and `package-lock.json`, eight new `LICENSE` copies.
- client-config source: `synthesize.ts`, `index.ts`, `types.ts` (comment), `scripts/certification-results.json`, `README.md` (certification table re-rendered), 11 re-captured golden stage files and the tests that pin the spec.
- Extension source: `definitions.ts`, `serverDefinitionProvider.ts`, `clientsEngine.ts`, `governanceEngine.ts`, `extension.ts`, comments in `env.ts` and `types.ts`, `vscodeMock.ts` (`Uri`, `cwd`), the tests that pin spec output, `README.md`, `CHANGELOG.md`.
- Documents: root `README.md`, `docs/client-config/*.md`, `docs/migration-v1-v2.md`, the five server READMEs, the `@iris-mcp/all` README, root `CHANGELOG.md`.
- Pin and release tooling: `scripts/lib/npx-pin-scan.mjs`, `scripts/release/changeset-1.0.0.md`, the five new `@iris-mcp/all` test files, `pack-fixture.ts`, the nine changeset-reading doc tests, the Story 43.3 and 43.4 doc-claims tests that pinned the old CHANGELOG order, and the Story 43.4 gate guard that forbade any skip.
- Records: this spec, `42-1-pack-file-lists.md`, the story changeset.

**Review findings breakdown.** 40 findings from four layers (blind-hunter 10, edge-case-hunter 10, verification-gap 9, intent-alignment 11): high 0, medium 5, low 28, false 7. After grouping by root cause, 12 entries were patched (3 medium, 9 low, 0 high), none was deferred, and 17 low plus 7 false findings were rejected.
- **Patches applied.**
  - Medium: the AC 42.1.2 test no longer breaks once `changeset version` consumes a changeset (EC8, VG2); the root README keeps its "Once published" caveat (EC9); Zed and Goose re-apply tests added, with mutation lines for all four families (VG1, IA-f).
  - Low: extension README/CHANGELOG (BH3); the `-p` explanation (BH4); the `mcp-server` keyword on `@iris-mcp/all` (BH7); `LICENSE` equality test (BH8, IA-j); three stale comments/records (BH9); the scan now reads every tracked text file, `.mdc` included (BH10, IA-g); the Story 43.4 skip guard checks the exact guard (VG3); mutation lines for the re-apply tests (VG4); the documented Node floor test (VG6).
- **Rejected, with the recorded reason** (full rows in `## Review Triage Log`):
  - Low: BH1/EC1 stashed or pre-pin entries stay unpinned until re-applied (new engine behavior; reopen_if a 2.0 ships with managed entries on the bare spec); BH2/IA-c the floor never runs on 22.17 (a CI matrix is Story 42.3's, `^22.17.0` is the spec's); BH5 attribution wording; BH6 pre-existing blanket certification sentence; EC2 Node below 22 fails at the `globSync` import (pre-existing dependency); EC3 `os.homedir()` failing (not reachable); EC4 exotic spec forms (theoretical); EC6 `pnpmPack` message quality; EC7 changeset presence guards (spec-prescribed); VG5a AC 42.1.8 is a point-in-time record; VG7 static DW-630 wording; IA-a pnpm-only `publishConfig` (already in `deferred:`); IA-b no executed `@1` before publish; IA-h static guards (the after-release probe ran green); IA-i hand-assembled fixture (spec-prescribed).
  - False: EC5 `access` is already `public` in `.changeset/config.json`; EC10 `@types/node` scope is the seven TypeScript packages and the extension; VG5b the AD-15 AC is pinned by the generator checks and Epic 43 goldens; VG8 non-finding; IA-d the oracle is `os.homedir()`, not the mock; IA-e every provided definition gets the home `cwd` (AC 42.1.6); IA-k the rewritten residual risks match each block's own `server` field.
- **Deferred.** No item was added by this pass. The `deferred:` list in the frontmatter holds the six items from the plan and implement stages: the two extension CLI spawns without a `cwd` (low), publishing only through pnpm (med), seven READMEs claiming an `IRIS_USERNAME` default (low), five extension tests that fail on a macOS host and on the baseline (low), `CHANGELOG.md` absent from `pnpm pack` tarballs (low), and one unused `eslint-disable` warning in `packages/shared/src/cli/governance.ts` (low).

**Follow-up review recommendation: `true`.** The review pass patched three medium entries (a first-pass threshold of two). The unverified risk is the patch pass itself: the scan now reads every tracked text file (987 files today; its exemption list gained one entry for the tooling's own synthetic input), and the `package-manifests`, `meta-package-docs`, Zed/Goose re-apply and Story 43.4 guard changes were written after the four layers read the diff, so no independent layer has reviewed them. Mutation evidence for each is recorded in `## Verification`.

**Verification performed (after the last patch; all foreground, one command per call).**
- `(loop)` `pnpm --filter @iris-mcp/client-config test`: 37 files, 1015 tests green. The five new `@iris-mcp/all` files plus the manifest and guard tests: green. Extension `type-check`: clean. Extension `test`: 427 of 432 pass; the same 5 tests fail on the pristine baseline (`git archive 063416b` copy, client-config built there): four pin `C:\` paths that are not absolute on POSIX, and `33-3-3` (the real subprocess render) times out.
- `(once)` full suites: shared 2289, dev 1715, admin 514, interop 751, ops 350, data 165, client-config 1015, and `@iris-mcp/all` 168 files in four batches (56 + 41 + 39 + 32), all green; the skips are the unarmed live gates of Stories 39 and 41.
- `(once)` `type-check` clean for the 7 packages and the extension; `lint` 0 errors (one warning in an untouched shared file); `gen:tools-list-snapshot:check`, `gen:governance-baseline:check`, `gen:pack:check`, `gen:skills:check`, `check:provenance` and `validate:prompts` all clean; `changeset status --verbose`: minor 0.1.0, no major.
- `(once)` all 57 pending changesets moved to the scratchpad, the whole `@iris-mcp/all` suite green with no `ENOENT`, changesets restored, `git status --short` identical.
- `(once)` CLI form probe on `pnpm pack` tarballs (throwaway HOME and npm cache): new form exit 0, old form exit 2 (`unknown command "iris-mcp-clients"`), governance recipe exit 0. All eight packs re-run: every recorded file list matches; byte counts for client-config (174366) and `@iris-mcp/all` (5714) updated in `42-1-pack-file-lists.md` and the Pack counts table.
- No IRIS tool was called; the full package suites' live legs, where they ran, wrote only their own disposable fixtures.

**Residual risks.**
- Entries a pre-pin manager wrote stay on the bare spec until the user re-applies; `enable` of a stashed client restores such an entry as it was, and `status`/`doctor` do not flag it. The bare spec behaves as it did before this story.
- The Node floor is declared and documented but nothing runs on a 22.17 runtime; `@types/node` resolves to 22.20.5 (Story 42.3's CI owns a matrix).
- The `@1` form and `npx -p` against the registry cannot be run before the first publish; the probes used tarball paths in the spec's position.
- Publishing must go through pnpm (`publishConfig.exports`, `workspace:*` rewriting); a direct `npm publish` would ship the source exports (deferred to Story 42.5).
