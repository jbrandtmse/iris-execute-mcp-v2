---
title: 'Story 42.7: VS Code Extension Publish'
type: 'feature'
created: '2026-11-20'
status: 'ready-for-dev'
baseline_revision: '9124c068a086e022b42906d8506f5010cf9cbf54'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-iris-execute-mcp-v2-2026-10-14/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-42-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-42-6-tarball-smoke-and-1-0-0-publish.md'
warnings:
  - multiple-goals
  - oversized
deferred: []
---

<intent-contract>

## Intent

**Problem:** The VS Code extension (`extensions/iris-mcp-launcher`, 0.1.0) is on no store. Five things stop it:
- Its publisher is the placeholder `TBD-at-publish-time`, and its manifest is publishable to npm by accident (DW-389).
- Its full test suite is red on macOS and Linux at baseline, so CI runs only its arming guard (DW-532).
- Its two CLI spawns pass no `cwd`, so the MCP Clients view's project scope depends on how VS Code was launched (DW-663).
- The release's `vscode-marketplace` and `open-vsx` channels are disabled, and as written they could not authenticate:
  - Azure DevOps global PATs stop working on 2026-12-01.
  - `vsce`/`ovsx` get no credential and no OIDC variables.
  - The publish job installs neither CLI.
  - An exit 0 under `--skip-duplicate` is reported `published` even when nothing was uploaded.
- No version policy says what version the extension ships at (spine Deferred, "Release operations").

**Approach:**
- **Code (stages, on `epic42`):**
  - The extension gets the publisher `iris-mcp`, `private: true`, and a version in lockstep with the shared npm version.
  - The launcher suite goes green, and CI runs it on Linux, macOS and Windows.
  - The CLI spawns get an explicit `cwd`.
  - Both store channels are enabled:
    - the Marketplace through `vsce publish --oidc` (trusted publishing, no secret);
    - Open VSX through trusted publishing, or the `OVSX_PAT` secret for its first publish;
    - a read-only store lookup before each upload, so a version already on a store reads `already published`.
- **The stores' first publish (lead and owner):** it happens at the next release tag (decision #77: `v1.0.0` is npm only), after the epic-end merge. It closes AC 42.7.2 and AC 42.7.3 through the `## Verification` lead checklist.

## Boundaries & Constraints

**Always:**
- **Lockstep version.** The extension's `package.json` `version` and its `package-lock.json` (`version` and `packages[""].version`) equal the shared `@iris-mcp/*` version.
  - In this story that is `1.0.0`. `embeddedVersionProblems` refuses any mismatch in both modes, as it does for `ipm/module.xml`.
  - `pnpm run version` stamps all three.
  - It renames the extension CHANGELOG's `## [Unreleased]` heading to `## [<version>] — <YYYY-MM-DD>`.
  - A release-mode `prepare` refuses unless the first `## [` heading of `extensions/iris-mcp-launcher/CHANGELOG.md` names the release version. A dry run reports it as "a tag run would refuse".
- **One store id.** `publisher` is `iris-mcp`, which is both the Marketplace publisher id and the Open VSX namespace (Open VSX matches it case-sensitively). Nothing published carries "intersystems" in our names (AD-28). `extensionDependencies` keeps `intersystems-community.servermanager`, a dependency, not our name.
- **Credentials reach only their CLI.**
  - The OIDC request variables (`ACTIONS_ID_TOKEN_REQUEST_TOKEN`/`_URL`) reach `npm publish`, `vsce publish` and `ovsx publish`, and nothing else.
  - `OVSX_PAT` reaches only `ovsx publish`, as an environment variable, never in argv.
  - `VSCE_PAT` and `OVSX_PAT` join `SECRET_VARIABLES`, so no other child sees them. An ambient `VSCE_PAT` never reaches `vsce`, so the Marketplace always uses OIDC.
  - Every secret is redacted from every report line.
  - `secrets.` appears only in the `publish` job (AD-29).
- **Store CLIs, pinned exactly.** `@vscode/vsce` `4.1.1` (OIDC trusted publishing is in the stable CLI since 4.1.0) and `ovsx` `1.4.0` (trusted publishing and `OVSX_PAT`) are exact `devDependencies` of the launcher. The `rehearse` and `publish` jobs install them with `npm ci --ignore-scripts` in `extensions/iris-mcp-launcher`, so no install script runs in a job.
- **A store lookup before each upload** (the npm `viewOutcome` shape: published / absent / unknown):
  - `published` → `already published`, and no upload.
  - `absent` → upload with `--skip-duplicate`. A CLI line ending `is already published. Skipping publish.` with exit 0 is still `already published`.
  - `unknown` → `failed`, with nothing uploaded and nothing after it attempted (fail closed).
- **42.5/42.6 constraints stay.**
  - `release.mjs` statically imports only `node:` builtins, `release-core.mjs` and `script-process.mjs`, and `release-core.mjs` stays pure.
  - Only the argv builders form a publish verb.
  - Error text has the form `<what happened>. <what to do>.`
  - Rule 14 escapes; Rule #55 (no heredoc writes).
  - The release-workflow self-test holds `release.yml` equal to `release-checks.mjs`, and the CI self-test holds `ci.yml` equal to `ci-checks.mjs`.
- **Extension conventions.**
  - The `vscode` mock keeps real API shapes (Rule #54, pinned to `@types/vscode`).
  - The extension stays dependency-free at runtime, with no bundler.
  - The literal `IRIS_MCP_MAJOR = "1"` stays.

**Never:**
- **No publish-shaped command, ever.** No `vsce publish`/`login`, `ovsx publish`/`create-namespace`, `npm`/`pnpm publish`, `changeset publish`/`version`, `pnpm run version` on the real tree, `npm login`/`trust`, `git tag`/`push`, `gh release`/`workflow run`/`secret`, or a non-GET `gh api`. No stage creates a GitHub, Marketplace or Open VSX account, setting, policy or secret.
- **No docker, no IRIS call.** No edit to ObjectScript, REST routes, the governance baseline (`1e62c5ad5bf7`/141), frozen goldens, `irislib/` or `irissys/`. `BOOTSTRAP_VERSION` does not move.
- **No new `.changeset/*.md`.** No `@iris-mcp/*` package changes, and the tag commit must have no pending changeset.
- **No change to the npm channel's behavior or order.** No `npm unpublish`, no `vsce unpublish`, no pre-release (`--pre-release`), no extension icon (an authored asset).
- **No major-persistence code** (Orchestrator decision 7).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Store upload | release mode; lookup → absent; CLI exit 0 | `vscode-marketplace`: `iris-mcp-launcher@<v>: published (auth: oidc)`; then `open-vsx` the same (`auth: oidc`, or `auth: token` with `OVSX_PAT`) | — |
| Already on a store | lookup → published (a rerun of the same tag) | `already published`; no CLI publish call | — |
| Skip-duplicate race | lookup → absent; CLI exit 0, a stdout line ending `is already published. Skipping publish.` | `already published` | — |
| Lookup unreadable | non-2xx other than 404, a network error, or a 30 s stall | `failed (could not ask <store> whether <name>@<v> is published …)`; no upload; what follows `not attempted` | fail closed, exit 1 |
| Upload fails | CLI exit non-zero | `failed (<last 4 lines, redacted>)`; what follows `not attempted` | exit 1 |
| Open VSX namespace absent | GET `https://open-vsx.org/api/iris-mcp` → 404 | rehearse: `open-vsx: not ready: the Open VSX namespace iris-mcp does not exist …`; publish: `failed` before upload | dry run exit 1 |
| Dry step ready | publisher not the placeholder, CLI installed, namespace present, lookup absent | rehearse `ready (would publish <name>@<v>)`; on lookup published, `ready (would be already published)` | — |
| Secret containment | `NPM_TOKEN`, `OVSX_PAT`, `VSCE_PAT` and the OIDC variables set | `npm view`, `git`, `vsce` and `ovsx` see none of them except as the "Credentials" rule lists | — |
| Version lockstep | extension `package.json` or lock ≠ shared version | `prepare` (both modes) and `pnpm run version`'s check name the file and say `run pnpm run version` | exit 1 |
| CHANGELOG heading | release mode; first `## [` heading of the extension CHANGELOG ≠ `[<v>]` | `prepare` refuses, naming the heading; a dry run reports `a tag run would refuse: …` | exit 1 (release) |
| Clients CLI `cwd` (DW-663) | a workspace folder is open / no folder | spawn `cwd` = `workspaceFolders[0].uri.fsPath` / `os.homedir()` | — |
| Governance CLI `cwd` (DW-663) | any | spawn `cwd` = `os.homedir()` (the same directory the server definitions use) | — |

</intent-contract>

## Code Map

**The release (42.5/42.6; extend, never copy, Rule 2)**
- `scripts/lib/release-core.mjs`:
  - `RELEASE_CHANNELS` :31-36: set the two store channels to `enabled: true` and drop their `enabledBy`; IPM stays `Story 42.8`.
  - `PLACEHOLDER_PUBLISHER` :69, kept as the readiness check.
  - `vsceArgv` :433 → `['publish', '--packagePath', vsix, '--skip-duplicate', '--oidc']`.
  - `ovsxArgv` :438 → `['publish', vsix, '--skip-duplicate']` plus `'--trusted-publishing'` when no token. Take `{ token: boolean }`.
  - New pure functions:
    - `storeLookupUrl(store, publisher, name, version)`:
      - Open VSX: `https://open-vsx.org/api/<p>/<n>/<v>`;
      - Marketplace: `https://marketplace.visualstudio.com/_apis/public/gallery/publishers/<p>/vsextensions/<n>/<v>/vspackage`, read with `Range: bytes=0-0`; HEAD answers 405.
      - Probed read-only on 2026-11-20: `intersystems-community.servermanager` 3.10.2 → 200 on both, 0.0.1 → 404 on both.
    - `storeOutcome(status)` → published / absent / unknown;
    - `skippedDuplicate(stdout)`;
    - `extensionChangelogProblems(text, version)`.
  - The `releaseReport` and `skippedText` shapes are unchanged.
- `scripts/release.mjs`:
  - header CONTRACT :11-37 (items 4 and 5: the store channels, OIDC and `OVSX_PAT`);
  - `SECRET_VARIABLES` :131 (add `OVSX_PAT`, `VSCE_PAT`); `childEnv` :137 and `redact` :146, reused;
  - `readReleaseFacts` :466: add the extension's version, lock versions and CHANGELOG text;
  - `embeddedVersionProblems` :496, the sibling to extend with the extension's lockstep;
  - `runPrepare` versionIssues block :655-671: the CHANGELOG-heading check joins `versionIssues`;
  - `packVsix` :584: unchanged, except that it now packs `iris-mcp-launcher-<shared v>.vsix` under `iris-mcp`;
  - `uploadPathProblems` :829: in release mode the vsix detail's version must equal `manifest.version`;
  - `vsixReadiness` :870 and `dryStep` :1050: add the namespace GET (Open VSX only) and the lookup;
  - `runChannel` :1089: lookup → upload → `skippedDuplicate`, with the per-CLI env built from `childEnv` plus the OIDC variables, plus `OVSX_PAT` for ovsx only; returns `detail: 'auth: oidc' | 'auth: token'`;
  - `runPublish` :897 (the channel loop :1008-1031): unchanged in shape.
  - `deps.fetch` (already used by `ipmRegistryState` :1069) does the GETs with a 30 s stall guard.
- `scripts/lib/release-checks.mjs` `RELEASE_JOBS`:
  - rehearse :88-98 and publish :99-118: add the step `{ run: 'npm ci --ignore-scripts', workingDirectory: 'extensions/iris-mcp-launcher' }` after download;
  - the publish step env adds `OVSX_PAT: '${{ secrets.OVSX_PAT }}'`.
- `.github/workflows/release.yml`: mirror those steps and the env; update the header comment (rehearse and publish now install the store CLIs).
- `scripts/release-version.mjs` :70-160: after `gen-bootstrap`:
  - stamp the extension `package.json` and `package-lock.json` to the new version;
  - rename `## [Unreleased]` (it must be the first `## ` heading; otherwise exit 1 naming the file);
  - add both files to its next-steps line;
  - its post-check already runs `embeddedVersionProblems`.

**CI (DW-532)**
- `scripts/lib/ci-checks.mjs`:
  - `RUNNER` :34, `JOB_TIMEOUT_MINUTES` :54, `LAUNCHER_*` :116-125, `buildDeclaredSteps` :295-336, `DECLARED_STEPS` :339.
  - Add a `launcher` job: a matrix of `ubuntu-24.04`, `macos-15` and `windows-2025`, Node 22.17.0. Verify each runner label against GitHub's runner-images list, and record it.
  - Its steps:
    1. checkout;
    2. pnpm setup;
    3. setup-node with the pnpm cache;
    4. `pnpm install --frozen-lockfile`;
    5. `pnpm --filter @iris-mcp/client-config --filter @iris-mcp/shared build` (the real-CLI tests use both dists);
    6. in the launcher, `npm ci`;
    7. `npm run build`;
    8. `npx --no -- vitest run`.
  - It has `needs: []` and `timeout-minutes: 30`. `package`/`ipm` keep `needs: [gates, throwaway]`.
- `.github/workflows/ci.yml`: the new job, mirrored.
- `packages/iris-mcp-all/src/__tests__/ci-workflow.test.ts` (and `ci-workflow-check.ts`): the self-test's job roster and runner pins.

**The extension**
- `extensions/iris-mcp-launcher/package.json`:
  - `version` → `1.0.0`;
  - `publisher` → `iris-mcp`;
  - add `"private": true`;
  - `devDependencies`: `@vscode/vsce` `4.1.1` exact, add `ovsx` `1.4.0` exact;
  - `package` script unchanged.
  - Probe on 2026-11-20 (an `os.tmpdir()` copy): `private: true` with publisher `iris-mcp` packages a 22-file vsix with vsce 3.9.2 and 4.1.0, manifest `Publisher="iris-mcp"`. Neither the vsce 4.1.0 nor the ovsx 1.4.0 source reads `private`.
  - A copy under the session scratchpad path packages zero files, so use `os.tmpdir()`.
- `package-lock.json`: regenerate with `npm install` in the launcher, never by hand.
- `src/clientsEngine.ts`:
  - `ClientsSpawnImpl` :300, whose options gain `cwd: string`;
  - `realSpawn` :312;
  - `runClientsCli` :325, whose spawn :342 passes `cwd`.
- `src/governanceEngine.ts`: `SpawnImpl` :255, `runGovernanceCli` :311, spawn :324, the same change.
- `src/extension.ts`:
  - the governance host :365-382 (`runGovernanceCli` :381) gets `os.homedir()`;
  - the clients host :470-485 (`runClientsCli` :484) gets `vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir()`.
  - The server-definition `cwd` precedent is at :660-671.
- `src/__tests__/vscodeMock.ts` :329 `workspace`: add `workspaceFolders` (`readonly WorkspaceFolder[] | undefined`, each `{ uri, name, index }`, the `@types/vscode` shape) backed by `mockState`, reset in `resetMockState`.
- DW-532 red tests (probe 2026-11-20, `npx vitest run` in the launcher: 5 failed, 438 passed, 3 skipped, 63 s; the two files that "cannot load" in the ledger now load, because `npm ci` installed the Server Manager types):
  - `src/__tests__/clientsEngine.test.ts` :76-84 and :100-106, and `src/__tests__/governanceEngine.test.ts` :85-92 and :114-121, pin `C:\…` as `developmentRepoPath`, which is not absolute on POSIX. Build the path with `path.resolve(os.tmpdir(), …)` and `path.join`, so that it is absolute on every OS.
  - `src/__tests__/clientsActivationFlow.test.ts` :208-235 (33-3-3) has a vacuous wait. After the "refresh" message, the `waitFor` compound condition already holds on the PREVIOUS render's html (claude-code was unchecked before the refresh). The `flushEditor` that follows does not outlast the refresh's three CLI spawns (detect, modes, status), so `busy` is still true. The re-toggle is dropped by the busy guard (`clientsPanel.ts` :351), and the roster never persists: 60 s timeout.
  - The fix: wait for a render that happens after the refresh message, by counting `setHtml` assignments in the mock, or by clearing the recorded html before sending it.
- `README.md` (the extension):
  - `> **Status: not yet published.**` :8 and the vsix install section :63-76: rewrite as store install (Marketplace, Open VSX), keeping the vsix route for development;
  - the "Marketplace / Open VSX publish checklist" :383-404: replace with a short "Publishing" note pointing at the root README `### Releasing`;
  - add the line "an independent community project, not made, endorsed or supported by InterSystems" (the `ipmReadme` wording).
  - This README is the store listing page.
- `CHANGELOG.md` (the extension): the heading `## [0.1.0] — Unreleased (not yet published)` → `## [Unreleased]`; add this story's entries.

**Tests to extend** (in `packages/iris-mcp-all/src/__tests__/`, in the default suite)
- `release-core.test.ts`:
  - :59-60, the channel table;
  - :378-381, the argv builders;
  - :481-491, the report rows; their fixtures keep `0.1.0` as synthetic data.
- `release-script.test.ts`:
  - `describe("Publish channels (AC 42.5.3)")` :1277-1320: the default-disabled test becomes default-enabled; the vsce/ovsx argv rows; `newWorld` channels;
  - the dry-step block near :1508.
- `release-script-fixtures.ts`:
  - :170-183 vsix artifacts;
  - :288, the fixture extension `package.json` (lockstep version, publisher; add a lock and a CHANGELOG);
  - `answerFor`/`fakeFetch` :59-82, for the store GETs.
- `stand-in-clis.ts`: `vsce`/`ovsx` stand-ins that can print the skip line and record their env.
- `release-prepare.test.ts` :89-164 and :539-563 (the vsix behaviors and the manifest's channel `enabled` flags), and `release-version.test.ts` (stamp and rename).
- `release-workflow.test.ts` :163 and :246-293 (the publish-verb scan stays green; the new steps); `package-manifests.test.ts` :62, :120-170; `npx-pin.test.ts`.
- `story-38-7-doc-claims.test.ts` :204-205 pins "the launcher CHANGELOG has a 0.1.0 section": re-point it at the `[Unreleased]` section.
- `story-42-2-qa-launcher-arming-parity.test.ts` and `live-arming-guard.test.ts`, for the launcher job's steps.

**Docs**
- Root `README.md` `### Releasing` :1101-1131:
  - step 1 (the version step stamps the extension and renames its heading);
  - the channel table :1116-1123 (Marketplace and Open VSX enabled);
  - a "Store authentication" paragraph after "npm authentication" :1129.
- Root `CHANGELOG.md`: a new top section `## [Unreleased] — Story 42.7: VS Code Extension Publish`, above `## [1.0.0]` (:5). There is no BOOTSTRAP move.

## Tasks & Acceptance

**Execution:**
1. `extensions/iris-mcp-launcher/src/__tests__/clientsEngine.test.ts`, `governanceEngine.test.ts`, `clientsActivationFlow.test.ts`, `vscodeMock.ts` -- make the 4 path pins platform-neutral and fix the 33-3-3 vacuous wait (Code Map) -- DW-532: green on every OS, with no assertion weakened.
2. `scripts/lib/ci-checks.mjs`, `.github/workflows/ci.yml`, `ci-workflow.test.ts` (+ its check helper) -- add the `launcher` 3-OS job and its self-test rows -- DW-532: the full suite gates every release (a release waits for a green `ci.yml`).
3. `extensions/iris-mcp-launcher/src/clientsEngine.ts`, `governanceEngine.ts`, `extension.ts` -- pass an explicit `cwd` per the matrix rows; tests with a recording `spawnImpl` (each engine), plus an activation-flow row with `workspaceFolders` set and unset -- DW-663.
4. `extensions/iris-mcp-launcher/package.json`, `package-lock.json` -- publisher, `private`, version `1.0.0`, exact CLI pins (`npm install`) -- DW-389, AC 42.7.1.
5. `packages/iris-mcp-all/src/__tests__/package-manifests.test.ts` -- a row enumerating every tracked `package.json` (`git ls-files '*package.json'`, outside `node_modules` and fixtures) and asserting the non-private set equals `NPM_PUBLISH_ORDER`; and a row asserting that the extension is private, its publisher is `iris-mcp`, and no published name contains `intersystems` -- DW-389 (Rule #56).
6. `scripts/lib/release-core.mjs` -- enable the two channels, the argv builders and the new pure functions -- AC 42.7.2.
7. `scripts/release.mjs` -- secrets, lockstep facts and checks, the CHANGELOG-heading check, dry step, lookup, upload, auth detail, header -- AC 42.7.2; every matrix row.
8. `scripts/lib/release-checks.mjs`, `.github/workflows/release.yml` -- the `npm ci --ignore-scripts` steps and `OVSX_PAT` -- AC 42.7.2.
9. `scripts/release-version.mjs` -- stamp the extension, rename its heading, and update the next-steps text -- the lockstep policy (Orchestrator decision 4).
10. `packages/iris-mcp-all/src/__tests__/release-*.test.ts`, `release-script-fixtures.ts`, `stand-in-clis.ts`, `story-38-7-doc-claims.test.ts` -- a test per matrix row (lookup outcomes from captured real statuses, Rule #36: 200/206 → published, 404 → absent, 403/500/stall → unknown); secret containment per child; a lockstep mismatch per file; heading release vs dry; the rename and stamp in `release-version`; the default-enabled channels -- AC 42.7.2.
11. `extensions/iris-mcp-launcher/README.md`, `CHANGELOG.md`, root `README.md`, root `CHANGELOG.md` -- docs per the Code Map, with the default state of each channel (Rule #30/#43); new `packages/iris-mcp-all/src/__tests__/story-42-7-doc-claims.test.ts` pinning the channel table, the disclaimer, and the absence of "not yet published" in the extension README.

**Acceptance Criteria:**
- Given the launcher at this story's tree, when `npx --no -- vitest run` runs in `extensions/iris-mcp-launcher` on macOS (locally) and in CI's `launcher` job on Linux, macOS and Windows, then every test passes, and the only skips are the two live files, unarmed (DW-532).
- Given an artifacts directory prepared with publisher `iris-mcp`, when `release.mjs publish --dry-run` runs with both store lookups `absent`, then both store channels report `ready (would publish iris-mcp-launcher@<v>)` and no `vsce`/`ovsx` publish runs; and when `publish` runs in release mode, then `vsce` runs `publish --packagePath <vsix> --skip-duplicate --oidc`, `ovsx` runs `publish <vsix> --skip-duplicate` with `OVSX_PAT` (or `--trusted-publishing` without it), both after npm, each from the launcher's `node_modules/.bin`, and the report says `published` (AC 42.7.2).
- Given the real launcher, when the implement stage runs `npm run package -- --out "$(mktemp -d)/"` there, then exactly one `iris-mcp-launcher-1.0.0.vsix` results, whose `extension.vsixmanifest` names `Publisher="iris-mcp"` and `Version="1.0.0"`, while the manifest carries `"private": true`, and the task-5 enumeration row is green (AC 42.7.1, DW-389). No stage runs any `npm publish`, not even `--dry-run`.
- Given the MCP Clients view opened with a workspace folder, when it runs any clients CLI command, then the spawned process's `cwd` is that folder's path; with no folder, the user's home (DW-663).
- Given the lead checklist, when the next release tag publishes, then both stores list `iris-mcp.iris-mcp-launcher@<v>`, and installs from the Marketplace into a clean VS Code and from Open VSX into VSCodium (or Cursor) start the servers, with the result recorded (AC 42.7.2, AC 42.7.3; lead and owner, after npm 1.0.0 is live).

## Spec Change Log

## Review Triage Log

## Design Notes

**Governing ADs and conventions (Rule 6):**
- **AD-29:**
  - Versions: one shared version (the extension joins it, decision 4).
  - Pins: the literal `@1` copy in the extension; the major-persistence `[ASSUMPTION]` is corrected by decision 7.
  - Publishing:
    - Channels: npm, then the Marketplace, then Open VSX, then IPM. This story enables the two stores (decision #77: `v1.0.0` is npm only).
    - Tags on `main` only (#82).
    - Secrets only in `release.yml`; the release script is the only way to publish.
    - The bad-release policy: fix forward; there is no rollback for the extension.
- **AD-28:** no endorsement in any name or listing; the publisher and namespace are `iris-mcp`; the README disclaimer.
- **AD-30:** the MCP Clients view writes only what it owns. The `cwd` decides which project's config it targets.
- **AD-2:** the extension imports no workspace package (a literal copy of the major); the cross-package checks live in `iris-mcp-all`.
- **AD-14:** the version-embedding artifacts. `pnpm run version` now also stamps the extension; the tag commit passes every check. `BOOTSTRAP_VERSION` does not move.
- **Conventions:**
  - error text;
  - live testing on a shared instance (throwaways only through the harness, only by the lead);
  - the Stack rows (VS Code engine `^1.101.0`, Node, pnpm);
  - Deferred "Release operations" (the extension version policy is settled here).

**Why this shape:**
- **OIDC for the Marketplace, not a PAT.**
  - Microsoft's publishing page (fetched 2026-11-20): "On December 1, 2026, global Personal Access Tokens (PATs) in Azure DevOps are retired." A Marketplace PAT needs "All accessible organizations", which is a global PAT.
  - GitHub Actions trusted publishing is `vsce publish --oidc` with `id-token: write`. The policy is set per publisher: owner, repository, workflow, environment.
  - The next tag comes after the epic-end merge, so after 2026-12-01: a PAT would be dead on arrival.
  - vsce 4.1.0 (2026-10-28) is the first stable release whose help shows `--oidc`, after #1337 "align token exchange with the Marketplace contract".
- **Open VSX needs a token once.** The Open VSX wiki ("Trusted Publishing", fetched 2026-11-20): "The extension must already exist with at least one active version. Publish the first version the ordinary way, with an access token." Registration is per extension, under Settings → Trusted Publishers. So the first publish uses `OVSX_PAT`, and the owner then registers the trusted publisher and deletes the secret. This is the same arc as npm (decision #89). `ovsx` 1.4.0 lets a `--pat`/`OVSX_PAT` take precedence over trusted publishing, and `--trusted-publishing` fails without an ID token, so a missing setup is a clear failure.
- **Lookup before upload (the npm `viewOutcome` sibling, Rule 2).** `--skip-duplicate` exits 0 on both an upload and a skip. vsce prints `Version <v> is already published. Skipping publish.`, and ovsx prints `<message> is already published. Skipping publish.` (vsce 4.1.0 `out/publish.js` :162-180; ovsx 1.4.0 `lib/publish.js` :150). The lookup makes "already published" an observed fact, the skip line covers the race, and an unreadable store fails closed, like `npm view`.
- **`npm ci --ignore-scripts` in the launcher, not a separate lockfile.** vsce already lives there (`prepare` packs with it), and `vsixReadiness` already looks in that `.bin`. `--ignore-scripts` keeps install code out of the job that holds `id-token: write` (probe: vsce 4.1.0 installed with `--ignore-scripts` packages normally).
  - Rejected: a dedicated `scripts/release/store-clis` lockfile. It is a second lockfile to keep current, for the same two pins.
- **The `launcher` CI job.** "Green on every platform" (DW-532) is only mechanical where CI runs it. The suite spawns real CLIs (win32 `.cmd` shims, `ELECTRON_RUN_AS_NODE`), so Windows is the platform most likely to differ. The job builds only the two dists the real-CLI tests read.
- **Siblings (Rule 2):**
  - `storeOutcome`/`runChannel`'s lookup extend the `viewOutcome` + `ipmRegistryState` pattern;
  - `extensionChangelogProblems` sits beside `versionProblems`;
  - the extension lockstep extends `embeddedVersionProblems`;
  - the `cwd` change extends the server-definition precedent (`extension.ts` :660);
  - the `launcher` job follows `buildDeclaredSteps`' job shape.

**Integration ACs (Rule 1):**
- `release.yml` `rehearse` (consumer) runs `release.mjs publish --dry-run` with the CLIs installed. Observable effect: the A2 dry-run log shows both store channels `ready (would publish …)`, or `not ready: …` naming the missing owner setup.
- `release.yml` `publish` (consumer), at the next tag. Observable effect: the report rows and the store listings (C3).
- CI `ci.yml` (consumer). Observable effect: the `launcher` job is green on three OSes (A1) and red on a broken test (A1b).

**Consumes:**
- 42.5: `release.mjs`, `release-core`, `release-checks`, the fixtures and stand-ins, `release-version`.
- 42.6: `verify`, the main-only tag gate, the lead-checklist pattern.
- 42.3: `ci-checks` and the self-test.
- 42.1: `IRIS_MCP_MAJOR` and `npx-pin.test.ts`.

**Consumed-by:**
- 42.8: its IPM channel runs after Open VSX in the same loop. Its dry runs on `epic42` show the store channels `not ready` until the owner has created the publisher and the namespace (owner step O1).
- 42.9: the install docs (extension from the stores) and client re-certification.

**Ledger inbox (Rule 17):**
- **DW-389:** tasks 4-5, the AC 42.7.1 bullet, lead A2.
- **DW-532:** tasks 1-2, the first AC, lead A1/A1b.
  - Probe 2026-11-20: 5 failures in 3 files on this macOS host (4 `C:\` pins and 33-3-3).
  - The ledger's "2 files cannot load" no longer reproduces after `npm ci`.
- **DW-663:** task 3, the matrix rows, the fourth AC.

**Decided at the spec gate (2026-11-21).** The lead accepted all nine recommendations below as written, as wave-8 orchestrator decisions #91 to #99:
- #91: the publisher;
- #92: Marketplace OIDC;
- #93: the Open VSX first-publish token;
- #94: lockstep versions;
- #95: `v1.1.0` is the first store release;
- #96: the 3-OS launcher CI job;
- #97: the spine correction for the major;
- #98: DW-663's working directories;
- #99: the CLI pins.

The lead wrote the spine drafts below: AD-29 (Pins, Versions, Channels), the Stack row and the Deferred entry; `lint_spine.py` is clean. The Planner was told on 2026-11-21 about the owner-only store accounts. They block only the lead's dry-run readiness lines and Phases B and C, never the implement or QA stages. The implement stage never pushes, tags, publishes or logs in to a store, runs no docker outside the harness, and never edits the spine.

**Orchestrator decisions needed (planned around the recommendation):**
1. **Orchestrator decision needed: the publisher id and display name — recommended: id `iris-mcp` on both stores, display name "IRIS MCP Server Suite",** because:
   - AC 42.7.1 names it;
   - it matches the npm scope the Lead reserved (D1);
   - Open VSX requires the namespace to equal `publisher`;
   - a read-only GET on 2026-11-20 found `iris-mcp` free on Open VSX (`/api/iris-mcp` 404) and no `iris-mcp.iris-mcp-launcher` on the Marketplace (404). The Marketplace publisher page 404 is not proof, so the owner confirms when creating it.
   - The id cannot change after creation.
2. **Orchestrator decision needed: Marketplace authentication — recommended: trusted publishing (`vsce publish --oidc`), no PAT and no Marketplace secret,** because global PATs retire on 2026-12-01, before the next tag.
   - Fallback if the first OIDC publish of a new extension is refused: the owner uploads the run artifact's exact vsix on the publisher management page (Update / New extension), recorded as an AD-29 exception.
   - A pre-12-01 PAT ("Marketplace (Manage)", "All accessible organizations") is not planned: it would expire before use.
3. **Orchestrator decision needed: Open VSX authentication — recommended: `OVSX_PAT` on the `release` environment for the first publish only, then a trusted publisher, and the token deleted,** because Open VSX refuses a trusted-publisher registration for an extension that does not exist yet (wiki, above).
4. **Orchestrator decision needed: the extension version policy (spine Deferred) — recommended: lockstep with the shared npm version,** because:
   - "already published" then happens only on a rerun of the same tag, exactly as on npm;
   - a changed extension can never be silently skipped as a duplicate;
   - the version step and `prepare` enforce it mechanically.
   - Cost: an unchanged extension is republished with every release (one update notice).
   - Rejected: independent versioning. It needs a "changed since the last tag but not bumped" check and makes `already published` the normal case.
5. **Orchestrator decision needed: which tag first publishes the extension — recommended: `v1.1.0`, cut once after the epic-42 end merge, carrying 42.7-42.9,** because:
   - decision #83 keeps 42.7-42.9 on `epic42` until the epic end;
   - this story changes no `@iris-mcp/*` package, so a release of its own would need an artificial changeset and an extra Planner merge;
   - 42.8 adds client-facing capability (plugin detection in the installer, registry listing): a minor;
   - `1.0.x` stays the fix-forward line for 1.0.0 defects (AD-29 bad-release policy; the 42.6 checklist treats a needed fix as 1.0.x).
   - Alternative: `v1.0.1` with a patch changeset, only if the Planner wants the extension out before 42.8.
6. **Orchestrator decision needed: CI coverage for "every platform" — recommended: a `launcher` job on `ubuntu-24.04`, `macos-15` and `windows-2025`,** because only CI can prove Windows.
   - Risk: Windows-only reds surface at A1 and take the failed-smoke path (rework).
   - Alternative: Linux plus local macOS, with Windows recorded as a residual risk.
7. **Orchestrator decision needed: the AD-29 `[ASSUMPTION]` "the extension persists the server major at first activation" — recommended: correct it; no code now,** because:
   - the major is the compile-time literal `"1"`, so within 1.x nothing can move it, and persistence code would be a branch no real input reaches (Rule #54);
   - the story that ships a major-2 extension must ask before moving, and can treat a user with no record as on `1` (every earlier install was).
8. **Orchestrator decision needed: the `cwd` of the CLI spawns (DW-663) — recommended: clients CLI = the first workspace folder, else `os.homedir()`; governance CLI = `os.homedir()`,** because:
   - project scope then means "this workspace";
   - the governance CLI resolves a relative `irisMcpLauncher.governanceFile` in the same directory as the servers (which start in home);
   - home is deterministic where the extension host's cwd was not (`/` from the macOS Dock).
   - Residual: with no folder open, project scope means the home directory. A project-local 1.x `@iris-mcp/client-config` in the workspace can still be the one `npx` runs; it is the same major.
9. **Orchestrator decision needed: the store CLI pins — recommended: `@vscode/vsce` `4.1.1` and `ovsx` `1.4.0`, exact,** because:
   - 4.1.1 (2026-11-12) is the newest stable vsce release, adding only a vsce-sign bump to 4.1.0;
   - ovsx 1.4.0 (2026-11-09) is the newest release and has trusted publishing and `--skip-duplicate`;
   - both require Node 22 or later, and the jobs run 22.17.0 and 26.0.0.
   - Add a Stack row.

**What the owner must provide, and when:**
- **O1, before lead A2 (soon, because 42.8's dry runs read it too):**
  - **Marketplace:** at https://marketplace.visualstudio.com/manage, with a Microsoft account, Create publisher with ID `iris-mcp` and Name "IRIS MCP Server Suite".
  - **Open VSX:**
    1. Create an Eclipse account with the GitHub Username field set to `jbrandtmse`.
    2. Sign in at open-vsx.org with GitHub, go to Settings, choose "Log in with Eclipse", and agree to the Publisher Agreement.
    3. Generate an access token under Settings → Access Tokens.
    4. Run `npx ovsx create-namespace iris-mcp -p <token>`.
    5. Optional: claim namespace ownership for the verified badge.
- **O2, before the next tag:**
  - The Marketplace trusted-publishing policy: publisher `iris-mcp` → Trusted Publishing → Create, with owner `jbrandtmse`, repository `iris-execute-mcp-v2`, workflow `release.yml`, environment `release`. The repository is public, so the 48-hour rule, which is stated for private repositories, does not apply.
  - The `OVSX_PAT` secret on the `release` environment.
  - Decision #89's `npm trust github` for the eight packages, then delete `NPM_TOKEN`.
  - Install VSCodium (or Cursor) on the dev machine. Only VS Code is installed today.
- **O3, at the tag:** approve the `release` environment.
- **O4, after the first Open VSX publish:** Settings → Trusted Publishers → namespace `iris-mcp` → GitHub Actions (`jbrandtmse`, `iris-execute-mcp-v2`, `release.yml`, `release`); delete `OVSX_PAT` and revoke the token.

**What waits on npm `1.0.0` being live (42.6 B7):** none of the implement or QA work does (fakes, the dev-repo mode, a local vsix). Lead B1, the local vsix launching the published servers through `npx -y @iris-mcp/<pkg>@1`, waits on it. So does all of Phase C (the store publish at the next tag, and AC 42.7.3).

**AC reinterpretations:**
1. **AC 42.7.1 "after confirming that `vsce package` and `vsce publish` still work":**
   - `vsce package` is confirmed by the probe and the third AC;
   - `vsce publish` statically (neither CLI reads `private`, vsce 4.1.0 / ovsx 1.4.0 source, 2026-11-20) and really at C2.
2. **AC 42.7.2 "published … through the release workflow, after npm 1.0.0":** this story enables the channels. The upload is the next tag's (decision #77, decision 5). The story stays `in-progress` after review, until the lead's C-phase evidence, as 42.6 waited for B7.
3. **AC 42.7.3 "an Open VSX client (VSCodium or Cursor)":** VSCodium is preferred, because it installs from Open VSX by default. The extension depends on `intersystems-community.servermanager`, which is on Open VSX (GET 200, 2026-11-20).

**Spine amendment drafts for the lead (Rule 20):**
- **AD-29, Publishing → Channels, append:** "The Marketplace and Open VSX channels are enabled (Story 42.7): `vsce publish --oidc` (trusted publishing; Azure DevOps global PATs retired 2026-12-01) and `ovsx publish`, with trusted publishing, or with `OVSX_PAT` for the first publish only. A read-only store lookup before each upload makes a version already there `already published`, and an unreadable store fails closed. The CLIs are installed in `rehearse` and `publish` with `npm ci --ignore-scripts`. The OIDC variables reach only the three publish CLIs, and `OVSX_PAT` only `ovsx`."
- **AD-29, Pins, replace the `[ASSUMPTION]` bullet with:** "The extension's major is the literal `@1`. A story that moves it to a new major asks the user before the move, and treats a user with no recorded major as on `1` (Story 42.7, decision 7)."
- **AD-29, Versions, append:** "The VS Code extension's version equals the shared version (lockstep, Story 42.7): `pnpm run version` stamps it and renames its CHANGELOG's `[Unreleased]` heading; `prepare` refuses a mismatch."
- **Stack, new row:** "`@vscode/vsce` / `ovsx` (launcher dev, release only) | 4.1.1 / 1.4.0, pinned exactly (Story 42.7)".
- **Deferred, "Release operations":** "the version policy for the plugin (Story 42.8); the extension's is lockstep (Story 42.7)."

**Residual risks:**
- Whether the Marketplace accepts the OIDC first publish of a new extension: the page does not say (decision 2's fallback).
- Whether the `windows-2025`/`macos-15` legs pass: unknown until A1 (decision 6).
- The Marketplace lookup is a 1-byte ranged GET of the vsix. Whether that counts as a download is unknown.

## Verification

**How to run:**
- Run from `/Users/jbrandt/git/iris-execute-mcp-v2`, one command per foreground call, with `timeout: 600000`.
- `UNARMED` is `env -u IRIS_HOST -u IRIS_PORT -u IRIS_USERNAME -u IRIS_PASSWORD -u IRIS_NAMESPACE -u IRIS_HTTPS -u IRIS_REQUIRE_LIVE -u IRIS_TEST_HOST -u IRIS_TEST_PORT -u IRIS_THROWAWAY -u NPM_TOKEN -u OVSX_PAT -u VSCE_PAT -u GITHUB_TOKEN CI=true`.
- No stage pushes, tags, triggers CI, runs docker, publishes or calls IRIS.
- Local packing goes only into an `os.tmpdir()` directory.
- Rebuild `@iris-mcp/client-config` and `@iris-mcp/shared` before the launcher suite if their dist is stale.

**Commands:**
- `(loop)` `for f in scripts/release.mjs scripts/lib/release-core.mjs scripts/lib/release-checks.mjs scripts/lib/ci-checks.mjs scripts/release-version.mjs; do node --check "$f" || exit 1; done` -- expected: exit 0.
- `(loop)` In `extensions/iris-mcp-launcher`: `UNARMED npx --no -- vitest run` -- expected: 0 failed. The only skips are the unarmed live files (the probe took about 63 s).
- `(loop)` In `extensions/iris-mcp-launcher`: `npm run type-check && npm run build` -- expected: exit 0.
- `(loop)` The story files of `@iris-mcp/all` -- expected: green, plus the new `story-42-7-*` files:
  ```sh
  UNARMED pnpm --filter @iris-mcp/all exec vitest run src/__tests__/release-core.test.ts src/__tests__/release-script.test.ts src/__tests__/release-prepare.test.ts src/__tests__/release-workflow.test.ts src/__tests__/release-version.test.ts src/__tests__/ci-workflow.test.ts src/__tests__/package-manifests.test.ts src/__tests__/npx-pin.test.ts src/__tests__/story-38-7-doc-claims.test.ts src/__tests__/story-42-2-qa-launcher-arming-parity.test.ts src/__tests__/live-arming-guard.test.ts src/__tests__/story-42-6-doc-claims.test.ts src/__tests__/story-42-5-doc-claims.test.ts
  ```
- `(once)` `UNARMED pnpm --filter <pkg> test`, one call per package: client-config, shared, admin, data, dev, interop, ops -- expected: green.
- `(once)` `@iris-mcp/all` as four calls, `UNARMED pnpm --filter @iris-mcp/all test -- --shard=k/4` for k = 1..4 -- expected: green. Split further by file list if a quarter nears 9 minutes.
- `(once)` `pnpm --filter <pkg> lint` and `type-check` per package -- expected: 0 errors.
- `(once)` The root checks -- expected: all OK, the baseline unchanged, and `gen:bootstrap` changing nothing:
  ```sh
  pnpm gen:governance-baseline:check
  pnpm gen:skills:check
  pnpm gen:pack:check
  pnpm validate:prompts
  pnpm check:provenance
  pnpm gen:tools-list-snapshot:check
  node scripts/check-epics-sync.mjs
  pnpm gen:bootstrap && git status --porcelain
  ```
- `(once)` The tag-consistency check on the story tree -- expected: `[] []` (the extension at `1.0.0`):
  ```sh
  node --input-type=module -e "const r=await import('./scripts/release.mjs');const c=await import('./scripts/lib/release-core.mjs');const f=r.readReleaseFacts('.');console.log(JSON.stringify(c.versionProblems({versions:f.packages.map(p=>({name:p.name,version:p.version})),pending:f.pending,tagVersion:'1.0.0'},'release')),JSON.stringify(r.embeddedVersionProblems(f)))"
  ```
- `(once)` The real vsix (the third AC) -- expected: one vsix, `Publisher="iris-mcp"`, `Version="1.0.0"`:
  ```sh
  cd extensions/iris-mcp-launcher && O=$(mktemp -d) && npm run package -- --out "$O/" && unzip -p "$O"/*.vsix extension.vsixmanifest | grep -o 'Publisher="[^"]*"\|Version="1.0.0"'
  ```
- `(once)` The real store lookups (read-only GET, the oracle for task 10) -- expected: `published` for `intersystems-community.servermanager@3.10.2` on both stores and `absent` for `@0.0.1`. Run `storeLookupUrl` plus `fetch` from a `node --input-type=module -e` one-liner, and record the statuses in the test header.
- `(once)` The version-step rehearsal, in a throwaway clone of the story tree (the 42.6 clone recipe, `os.tmpdir()`, `git remote remove origin`) -- expected: exit 0. Then:
  - the extension `package.json`/lock at `1.0.1`;
  - its CHANGELOG headed `## [1.0.1] — <date>`;
  - `embeddedVersionProblems` empty.
  - Remove the clone.
  - The setup: a throwaway patch changeset in the clone, then `pnpm run version`.

**Shared surfaces:**
- `RELEASE_CHANNELS` (default-enabled stores);
- `vsceArgv`/`ovsxArgv`;
- `SECRET_VARIABLES`;
- `RELEASE_JOBS` (the rehearse and publish steps, the publish env);
- `DECLARED_STEPS` and the CI job roster (the new `launcher` job);
- `readReleaseFacts`/`embeddedVersionProblems` (the extension facts);
- the fixture extension manifest, lock and CHANGELOG in `release-script-fixtures.ts`;
- the extension `package.json` (version, publisher, private, devDependencies) and `package-lock.json`;
- the extension CHANGELOG heading (`story-38-7-doc-claims`);
- `vscodeMock.ts` `workspace`;
- `ClientsSpawnImpl`/`SpawnImpl` options;
- the root README `### Releasing` channel table.

Every test added or changed passes on a fresh environment, in either order, and creates and removes its own temporary fixtures. No check mutates the shared IRIS, so no `ExecuteMCPv2.Temp.*` fixture is used.

**Mutations (Rule 19):** apply each, observe red, revert, and confirm `git status --short` and `git diff --stat` are unchanged. Record each as `mutation: <change> → <red test>`.
- DW-532: restore one `C:\` pin → its engine test, on POSIX; restore the vacuous 33-3-3 wait → 33-3-3 times out on this host.
- DW-663: drop `cwd` from the clients spawn options → the recording-spawn row and the activation row.
- DW-389: remove `"private": true` → the enumeration row.
- Channels:
  - a store channel back to `enabled: false` → the default-enabled publish test;
  - `vsceArgv` without `--oidc` → the argv row;
  - the OIDC variables not passed to `vsce` → the env row;
  - `OVSX_PAT` reaching `vsce` or `npm` → containment;
  - lookup `published` treated as `absent` → the "no CLI call" row;
  - `unknown` treated as `absent` → the fail-closed row;
  - the skip line ignored → the race row.
- Lockstep: `embeddedVersionProblems` ignores the lock → the lock-mismatch row; `release-version` skips the rename → its rename row.
- CI: drop the `launcher` job from `ci.yml` → the self-test.

**Lead checklist** (stages do none of it; record every URL and result here).

*Phase A, on `epic42`, after the story commit; no npm dependency:*
1. **A1.** Push, and CI is green, including `launcher` on all three runners. Record the run id.
2. **A1b. The launcher job proven red (Rule #59).**
   - Push a throwaway branch with one launcher assertion inverted. `launcher` goes red on each OS. Record the URL.
   - Delete the branch.
3. **A2. Dry run.** Run `git push origin <sha>:refs/heads/release-dry-run/42-7`. Expected:
   - `prepare`: the vsix `iris-mcp-launcher-1.0.0.vsix (publisher iris-mcp)`, and the CHANGELOG line `a tag run would refuse: … [Unreleased] …`;
   - `rehearse`: both store channels `ready (would publish iris-mcp-launcher@1.0.0)`, or, before O1, `not ready: …` naming the missing namespace.
   - Delete the branch.
4. **A3.** Hand the Planner the sha and the run ids (decision #83: the merge waits for the epic end).

*Phase B, after npm `1.0.0` is live (42.6 B7):*
1. **B1. The local vsix launches the published servers.**
   - Start a throwaway IRIS for Health through `scripts/throwaway-iris.mjs up` (Lead authorization, decisions #55/#64/#71/#88; host port 52792; `HSCUSTOM`).
   - Open VS Code with a clean profile (`--user-data-dir` and `--extensions-dir` in a temp directory), and install Server Manager from the Marketplace and the A2 vsix.
   - Add a Server Manager entry for `127.0.0.1:52792`.
   - "MCP: List Servers" shows the five definitions, and each starts with `npx -y @iris-mcp/<pkg>@1` and reports `1.0.0`.
   - Record, then `down`. Remove the temp directories, and confirm no container or pulled image is left.

*Phase C, the next release (decision 5), after the epic-end merge and O2:*
1. **C1.** The version commit (`pnpm run version`) carries the extension at the tag version. The tag is on the `main` merge commit.
2. **C2.** Watch the release:
   - `rehearse`: both store channels `ready (would publish …)`;
   - after O3, `publish`: npm `published (auth: oidc)` ×8, `vscode-marketplace` `published (auth: oidc)`, `open-vsx` `published (auth: token)`.
   - Read-only GETs: `https://open-vsx.org/api/iris-mcp/iris-mcp-launcher/<v>` → 200, and the Marketplace listing `iris-mcp.iris-mcp-launcher` → 200.
3. **C3. AC 42.7.3.**
   - Install from the Marketplace into a clean VS Code profile, and from Open VSX into VSCodium. On a throwaway as in B1, the five servers start.
   - Record each.
   - Then O4.
4. **C4.** Story 42.7 closes on C3.

*If something fails (AD-29; never unpublish):*
- **Red before `publish`:** nothing was published. Fix forward and re-tag the new `main` commit.
- **npm published, then a store failed:**
  - A cause outside the repository: **Re-run failed jobs**. npm reads `already published`, and the stores retry.
  - The Marketplace refuses the OIDC first publish: the decision-2 fallback (the owner uploads the artifact's vsix), recorded as an exception.
  - A cause in the code: release the next patch version.

## Auto Run Result

Status: ready-for-dev
Blocking condition: none
