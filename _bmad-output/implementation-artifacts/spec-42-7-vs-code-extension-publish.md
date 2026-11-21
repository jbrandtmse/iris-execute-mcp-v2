---
title: 'Story 42.7: VS Code Extension Publish'
type: 'feature'
created: '2026-11-20'
status: 'done'
baseline_revision: '19eaf1a191e20a2382aa5c6173b74081331eb85f'
review_loop_iteration: 0
followup_review_recommended: true
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
| Lookup unreadable | non-2xx other than 404, a network error, a 30 s stall, or a 200/206 that is not the store's own answer (wrong content type; Open VSX JSON whose namespace, name or version differ) — spec-gate amendment by the lead after review M1 | `failed (could not ask <store> whether <name>@<v> is published …)`; no upload; what follows `not attempted` | fail closed, exit 1 |
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
    - `storeOutcome(response)` → published (only with the store's own evidence: Marketplace 200/206 `application/vsix`; Open VSX 200 `application/json` with matching namespace, name and version) / absent (404) / unknown (anything else) — amended after review M1;
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
    5. `pnpm build` (every package: the real-CLI tests need all five server dists; review H1 — a real-CLI test whose dist is missing fails under `CI=true`, re-review R1);
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
10. `packages/iris-mcp-all/src/__tests__/release-*.test.ts`, `release-script-fixtures.ts`, `stand-in-clis.ts`, `story-38-7-doc-claims.test.ts` -- a test per matrix row (lookup outcomes from captured real statuses, Rule #36: 200/206 with the store's own evidence (review M1) → published, 404 → absent, 403/500/stall → unknown); secret containment per child; a lockstep mismatch per file; heading release vs dry; the rename and stamp in `release-version`; the default-enabled channels -- AC 42.7.2.
11. `extensions/iris-mcp-launcher/README.md`, `CHANGELOG.md`, root `README.md`, root `CHANGELOG.md` -- docs per the Code Map, with the default state of each channel (Rule #30/#43); new `packages/iris-mcp-all/src/__tests__/story-42-7-doc-claims.test.ts` pinning the channel table, the disclaimer, and the absence of "not yet published" in the extension README.

**Acceptance Criteria:**
- Given the launcher at this story's tree, when `npx --no -- vitest run` runs in `extensions/iris-mcp-launcher` on macOS (locally) and in CI's `launcher` job on Linux, macOS and Windows, then every test passes, and the only skips are the two live files, unarmed (DW-532).
- Given an artifacts directory prepared with publisher `iris-mcp`, when `release.mjs publish --dry-run` runs with both store lookups `absent`, then both store channels report `ready (would publish iris-mcp-launcher@<v>)` and no `vsce`/`ovsx` publish runs; and when `publish` runs in release mode, then `vsce` runs `publish --packagePath <vsix> --skip-duplicate --oidc`, `ovsx` runs `publish <vsix> --skip-duplicate` with `OVSX_PAT` (or `--trusted-publishing` without it), both after npm, each from the launcher's `node_modules/.bin`, and the report says `published` (AC 42.7.2).
- Given the real launcher, when the implement stage runs `npm run package -- --out "$(mktemp -d)/"` there, then exactly one `iris-mcp-launcher-1.0.0.vsix` results, whose `extension.vsixmanifest` names `Publisher="iris-mcp"` and `Version="1.0.0"`, while the manifest carries `"private": true`, and the task-5 enumeration row is green (AC 42.7.1, DW-389). No stage runs any `npm publish`, not even `--dry-run`.
- Given the MCP Clients view opened with a workspace folder, when it runs any clients CLI command, then the spawned process's `cwd` is that folder's path; with no folder, the user's home (DW-663).
- Given the lead checklist, when the next release tag publishes, then both stores list `iris-mcp.iris-mcp-launcher@<v>`, and installs from the Marketplace into a clean VS Code and from Open VSX into VSCodium (or Cursor) start the servers, with the result recorded (AC 42.7.2, AC 42.7.3; lead and owner, after npm 1.0.0 is live).

### Review Findings

The code review of 2026-11-21 (frozen diff `19eaf1a..c87662a`) is recorded under `## Review` at the end of this file: 1 high, 6 medium and 16 low entries, every one dispositioned. The scoped re-review of the patch commit (`c87662a..ed84b21`, iteration 2) is under `### Re-review (iteration 2)` there: 0 high, 2 medium and 5 low entries patched, 8 entries rejected.

## Spec Change Log

- **2026-11-21, decision #128 (owner via the Planner; DW-719, DW-720): the seam this story closes without.** The owner cannot register the Marketplace publisher `iris-mcp` until they have a verified domain, so O1 and O2 do not happen for v1.1.0, and Open VSX waits with the Marketplace. AC 42.7.2's "both channels enabled" is amended: `RELEASE_CHANNELS` ships `vscode-marketplace` with `enabled: false, enabledBy: 'owner: publisher needs a verified domain (DW-719)'`, so a release reports it `skipped: not enabled (…)` and Open VSX, IPM and the MCP Registry still run; Open VSX stays enabled and skips as not set up. The docs say the extension is not on either store yet and installs from `iris-mcp-launcher-<version>.vsix` on the tag's GitHub Release, which the maintainer attaches by hand for now (DW-720 automates it). **This story closes with the seam open:** DW-719 (decision-pending, owner-blocked) owns the verified domain, O1, O2 and O4 for both stores, the flip back to `enabled: true`, the store-install docs and the first store publish. The code paths for both stores stay built and tested (the credential matrix and the process-level rows run them with the channel on).

## Review Triage Log

### 2026-11-21 — Review pass
- verdicts: 37 findings — high 0, medium 8, low 27, false 2, maybe-false 0
- findings:
  - `[low]` `[reject]` (blind) The extension README says the extension is on both stores before the first store release — Task 11 requires exactly this rewrite (the README is the store listing and ships with the v1.1.0 publish); spec-bound, by-design.
  - `[medium]` `[reject]` (blind) The Marketplace rehearsal cannot see a missing publisher or trusted-publisher record — the matrix names the namespace GET for Open VSX only; a Marketplace refusal after npm is the spec's fix-forward / re-run-failed-jobs case (AD-29); spec-bound, by-design.
  - `[false]` `[reject]` (blind) The store-lookup oracle never covers a never-published extension — read-only GETs on 2026-11-21 for `iris-mcp/iris-mcp-launcher/1.0.0` answer 404 on Open VSX and on the Marketplace `vspackage` URL, and 404 for the Open VSX namespace `iris-mcp`; the 404 mapping is the observed answer.
  - `[low]` `[reject]` (blind) The Marketplace lookup downloads the full vsix (the Range header is ignored) — the spec lists this as a named residual risk (decision 2 fallback / "Residual risks" third bullet); the script cancels the body at once.
  - `[low]` `[reject]` (blind) The publish job installs the whole launcher dev tree under `id-token: write` — the spec rejects the dedicated lockfile alternative in Design Notes; `--ignore-scripts` is the chosen mitigation.
  - `[low]` `[reject]` (blind) The old publish checklist items (icon, categories, keywords, `.vscodeignore` inspection) were dropped — the icon is a spec "Never" (an authored asset); the rest is pre-existing listing polish, closed `wontfix-accepted` with reopen_if the Marketplace listing review (lead C2) finds the listing bare.
  - `[low]` `[patch]` (blind) The new working-directory behavior is missing from the extension README — one paragraph added under "MCP Clients view".
  - `[low]` `[patch]` (blind) CRLF CHANGELOG: the renamed heading loses its `\r` (Rule #58) — `renameUnreleasedHeading` keeps the line's `\r`; a CRLF test added and mutation-verified.
  - `[low]` `[reject]` (blind) The changelog date is the UTC date — the heading is a date label; no named harm, and a time-zone option adds a parameter.
  - `[low]` `[patch]` (blind) The fixtures comment cites a nonexistent `story-42-7-store-lookup-oracle.test.ts` — the comment now names `release-core.test.ts`, where the captured statuses live.
  - `[low]` `[reject]` (edge) `workspaceFolders[0]` may be a non-file URI or a deleted folder — the extension declares no virtual-workspace support, so a non-file URI is not reachable, and a deleted folder only yields a spawn error the view renders inline; a guard adds a branch no real input reaches (Rule #54).
  - `[medium]` `[patch]` (edge) The "no folder open" test restores `HOME`/`USERPROFILE` by assigning `undefined`, leaving the string `"undefined"` in `process.env` — a `restoreEnv` helper deletes absent keys; the governance row restores the same way.
  - `[medium]` `[patch]` (edge) The DW-663 clients rows remove their temp directories while later spawns may still run (Windows `EBUSY` flake) — `recordedCwds` now waits for the first record and then for the line count to hold still for 400 ms before returning.
  - `[medium]` `[reject]` (edge) Open VSX's namespace and lookup run after the Marketplace has uploaded, so a missing namespace fails after a partial store release — the matrix says publish `failed` before upload per channel, the rehearsal is the preflight, and a store failure after npm is the spec's re-run-failed-jobs path; spec-bound, by-design.
  - `[low]` `[patch]` (edge) The oracle test file named in the fixtures does not exist — same fix as the blind row above.
  - `[low]` `[patch]` (edge) `STORE_LOOKUP_TIMEOUT_MS` is exported and read by nothing (the 30 s guard is `defaultDeps`' `fetchTimeoutMs`) — removed it and the unused `STORE_CHANNEL_IDS`.
  - `[low]` `[patch]` (edge) CRLF in the heading rename — same fix as the blind row above.
  - `[low]` `[reject]` (edge) `extensionChangelogProblems` (first `## [` heading) and the version step (first `## ` heading) disagree for a non-bracket heading before the first bracket one — each states its own rule in the spec; the version step refuses that file loudly, so no release proceeds on it.
  - `[medium]` `[patch]` (verification-gap) The governance CLI `cwd` has no test through the real `activate()` wiring — a `governanceActivationFlow.test.ts` row runs a stub governance CLI and asserts its `process.cwd()` is the home directory; mutation: `os.homedir()` to `process.cwd()` at the call site turns it red.
  - `[medium]` `[patch]` (verification-gap) The same `HOME`/`USERPROFILE` state leak — same fix as the edge row above.
  - `[medium]` `[patch]` (verification-gap) The DW-663 rows stop waiting after the first spawn and delete the temp directories under later ones — same fix as the edge row above.
  - `[low]` `[patch]` (verification-gap) Dangling oracle file reference — same fix as the blind row above.
  - `[low]` `[patch]` (verification-gap) Dead exports `STORE_CHANNEL_IDS` and `STORE_LOOKUP_TIMEOUT_MS` — removed.
  - `[low]` `[patch]` (verification-gap) The root README install block still names `iris-mcp-launcher-0.1.0.vsix` — corrected to 1.0.0; "not yet on any Marketplace" stays true until the store publish, and the store install docs are Story 42.9's.
  - `[low]` `[patch]` (verification-gap) Mutation lines missing for the governance `C:\` pin, the URL encoding and the non-release vsix check — each mutation applied, observed red, reverted, and recorded in `## Verification`.
  - `[low]` `[reject]` (verification-gap) A near-tautology in the "real changelog once versioned" test — its `99.0.0` assertion can fail; the first-heading read is the same regex by design.
  - `[low]` `[reject]` (verification-gap) The `launcher` CI job has no guard for silently skipped real-CLI files — the job builds both dists the files read; a guard adds a mode the suite does not have.
  - `[low]` `[reject]` (intent-alignment) No test runs the real `npm run package` — the AC is a command run (done in the verification pass: one `iris-mcp-launcher-1.0.0.vsix`, `Publisher="iris-mcp"`), not a test.
  - `[low]` `[patch]` (intent-alignment) The cited oracle file is missing — same fix as the blind row above.
  - `[low]` `[reject]` (intent-alignment) Real CLI behavior is asserted only through stand-ins — the auditor read the installed vsce 4.1.1 and ovsx 1.4.0 sources and found the flags and the stdout skip lines the stand-ins mimic.
  - `[low]` `[reject]` (intent-alignment) The macOS and Windows CI legs are untested until a push — the lead's A1/A1b are the gate; by design.
  - `[medium]` `[patch]` (intent-alignment) The governance `cwd` is proven only at the injected spawn — same fix as the verification-gap governance row.
  - `[low]` `[patch]` (intent-alignment) `STORE_LOOKUP_TIMEOUT_MS` unused — same fix as the edge row above.
  - `[low]` `[reject]` (intent-alignment) The extension README states the store install before the tag that publishes it — same as the first blind row.
  - `[low]` `[reject]` (intent-alignment) The store channels are enabled unconditionally, so a tag cut from this branch would try them — decision #77 and #82 (tags on `main` only, after the epic-end merge) make the first store release the next tag; by design.
  - `[low]` `[reject]` (intent-alignment) The CHANGELOG gate is exercised only on fixtures — by design: the real tree must be `[Unreleased]` until the version step runs; the version-step rehearsal in a clone covers the real file.
  - `[false]` `[reject]` (intent-alignment) The launcher lock was outside the diff so its lockstep fields could not be seen — `embeddedVersionProblems` reads `[]` on the real tree (the lock's two fields are `1.0.0`).

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
    4. Run `OVSX_PAT=<token> npx ovsx create-namespace iris-mcp` (the token stays out of the command's arguments and the process list; review L3).
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

**Recorded mutations (Rule 19; implement stage, 2026-11-20):** each was applied, the named test went red, the change was reverted, and `git status --short` plus `git diff` were byte-identical to before. Test files named are in `packages/iris-mcp-all/src/__tests__/` unless they carry the launcher path.
- mutation: `clientsEngine.test.ts` dev-repo mode, `developmentRepoPath` back to `"C:\\git\\iris-execute-mcp-v2"` → `resolveClientsCli > dev-repo mode: the extension host interpreter + the repo's built CLI` red on macOS (`expected false to be true`).
- mutation: `clientsActivationFlow.test.ts` 33-3-3, the `thePanel().html = "";` line before the refresh message deleted (the vacuous wait) → 33-3-3 red after 60 s (`timed out ... waiting for: the re-toggled roster to persist`).
- mutation: `clientsEngine.ts` spawn options `{ env, cwd }` → `{ env }` → `clientsEngine.test.ts` "DW-663: the spawn receives the caller's cwd" and both `clientsActivationFlow.test.ts` DW-663 rows (folder open, no folder) red.
- mutation: `governanceEngine.ts` spawn options `{ env, cwd }` → `{ env }` → `governanceEngine.test.ts` "DW-663: the spawn receives the caller's cwd" red.
- mutation: `"private": true` deleted from the extension `package.json` → `package-manifests.test.ts` "the manifests that are not private are exactly the eight packages" and "the extension is private ..." red. Publisher back to the placeholder → "the extension is private, is published under the publisher iris-mcp ..." red.
- mutation: `RELEASE_CHANNELS` `open-vsx` back to `enabled: false` → `release-script.test.ts` "by default both stores run and IPM does not" and "the channels are enabled by default ...", and `release-core.test.ts` "the constants" red.
- mutation: `vsceArgv` without `--oidc` → `release-core.test.ts` "the extension stores take a prebuilt vsix ...", `release-script.test.ts` "all four enabled ..." and the OVSX_PAT containment row red.
- mutation: the OIDC variables not passed to the store CLIs (`oidcEnv(env)` dropped from the store CLI env) → `release-script.test.ts` "the job's OIDC request variables reach the three publish CLIs ..." and the OVSX_PAT containment row red.
- mutation: `OVSX_PAT` removed from `SECRET_VARIABLES` (so every child holds it) → the three `Secret containment` rows red; `VSCE_PAT` removed → "no other child holds OVSX_PAT or VSCE_PAT" and the OVSX_PAT row red.
- mutation: the `published` lookup outcome no longer returns `already published` (treated as absent) → `release-script.test.ts` "Already on a store ..." red.
- mutation: the `unknown` lookup outcome no longer fails (treated as absent) → six `Lookup unreadable` rows red (403, 500, redirect, network error, stall, Open VSX 503).
- mutation: the `skippedDuplicate` check deleted → "Skip-duplicate race ..." red.
- mutation: `ovsxArgv` ignores its `token` flag → `release-core.test.ts` argv row and the OVSX_PAT containment row red.
- mutation: Marketplace lookup without `Range: 'bytes=0-0'` → `release-core.test.ts` "the Marketplace lookup asks for one byte" and `release-script.test.ts` "the lookups are read-only GETs ..." red.
- mutation: an absent Open VSX namespace treated as present → "Open VSX namespace absent" (publish) and the rehearsal row red.
- mutation: the dry step's `would be already published` branch disabled → "a version that a store already holds reads ..." red.
- mutation: the release-mode vsix version check removed from `uploadPathProblems` → "Version lockstep at the upload ..." red.
- mutation: `extensionChangelogProblems` always passes → three `extensionChangelogProblems` rows in `release-core.test.ts` and the `release-prepare.test.ts` heading rows (release refusal, dry-run report) red.
- mutation: `embeddedVersionProblems` ignores the lock (both lock fields) → `release-prepare.test.ts` "the extension's lock is at another version" and "... holds another version for its own package", and `release-version.test.ts` "the lockstep check refuses ..." red.
- mutation: `release-version.mjs` skips the heading rename → six `release-version.test.ts` rows red ("stamps the manifest and both version fields ...", "a first release stamps the extension ...", the process run, and the 1.0.1 patch row among them).
- mutation: `RELEASE_JOBS` rehearse without the store CLI install step → `release-workflow.test.ts` "the real release.yml has no problem" red; `OVSX_PAT` dropped from the publish step env in `RELEASE_JOBS` → the same row red.
- mutation: the `launcher` job deleted from `ci.yml` → `ci-workflow.test.ts` "the real ci.yml has no problem" and the launcher rows red; the whole-suite step deleted from `ci-checks.mjs` → "the real ci.yml has no problem" and "the registry declares the job" red.
- mutation: the root README channel table's Marketplace row back to `disabled` → `story-42-7-doc-claims.test.ts` "the channel table ..." and `story-42-5-doc-claims.test.ts` "states each channel's default state ..." red; the extension README's "Install it from a store" back to "Status: not yet published" → "no longer says that the extension is not yet published" red; its disclaimer deleted → "carries the disclaimer" red.
- mutation: `governanceEngine.test.ts` fail-closed row, `developmentRepoPath` back to `"C:\\dev\\iris-execute-mcp-v2"` → `resolveGovernanceCli ... fail-closed: an unbuilt CLI ...` red on macOS.
- mutation: `extension.ts` governance host `runGovernanceCli(..., os.homedir())` → `process.cwd()` → `governanceActivationFlow.test.ts` "DW-663: ... the editor's CLI runs in the user's home directory" red.
- mutation: `storeLookupUrl`'s `part` helper without `encodeURIComponent` → `release-core.test.ts` "a part of the URL that holds a reserved character is encoded ..." red.
- mutation: `uploadPathProblems` version check without the `manifest?.mode === 'release'` condition → `release-script.test.ts` "the version check is a release's ..." red.
- mutation: `release-version.mjs` heading rename without keeping the line's `\r` → `release-version.test.ts` "a changelog with CRLF line endings keeps them ..." red.

**Recorded mutations (code review, 2026-11-21):** each applied, observed red, reverted, the file `cmp`-identical to its saved copy.
- mutation: `storeOutcome` returns `published` for any 200/206 (the status-only shape) → `release-core.test.ts` the four "a Marketplace 200 that is ... is `unknown`" rows and six "an Open VSX answer that is ... is `unknown`" rows, and `release-script.test.ts` "a Marketplace 200 that is not the store's answer ..." and "in a rehearsal, a store 200 that is not the store's answer ..." red (12). Recounted mechanically in the re-review (Rule #51), the same mutation turns 16 rows red: `release-core.test.ts` 4 Marketplace and 7 Open VSX rows (the 206 row too), and `release-script.test.ts` 5 (the Marketplace HTML row, the three "an Open VSX 200 that is ..." rows and the rehearsal row).
- mutation (re-review): with `packages/iris-ops-mcp/dist/tools/index.js` hidden and `CI=true`, `governanceEngineRealCli.test.ts` fails 4 of 4 ("... may not skip on CI, where the launcher job builds every package first: ..."); without `CI`, 4 skipped; restored, `shasum` identical. With `packages/shared/dist/profiles.js` hidden and `CI=true`, `envContract.test.ts` "on CI ... the oracle is built ..." red; without `CI`, it passes and the two contract suites skip.
- mutation (re-review): `openVsxNamespaceState` back to any 200 → `release-script.test.ts` "an Open VSX namespace 200 that is not JSON ..." red.
- mutation: `storeOutcome`'s Open VSX `namespace`/`name`/`version` check always passes → `release-script.test.ts` "an Open VSX 200 that is JSON for another version ..." and "... JSON with no version ..." red.
- mutation: `storeLookup` asks `readStatus` for no JSON (`json: false`) → `release-script.test.ts` "Already on a store ..." red (a real Open VSX hit is no longer read).
- mutation: the store-CLI failure detail without the `ended with no output` fallback → `release-script.test.ts` "a store CLI that exits non-zero with no output ..." red.
- mutation: the `launcher` build step back to `pnpm --filter @iris-mcp/client-config --filter @iris-mcp/shared build` in `ci-checks.mjs` and `ci.yml` → `ci-workflow.test.ts` "the registry declares the job ...", "fails on the dist build step removed" and "fails on the build narrowed to two of the packages" red. The real path: with `packages/iris-ops-mcp/dist/tools/index.js` hidden, `governanceEngineRealCli.test.ts` reports 4 of 4 skipped (the CI state before the fix); restored, 4 passed.
- mutation: the panel's `fileExists` adapter back to `stat(candidatePath)` → `governanceActivationFlow.test.ts` "a relative governanceFile is found where the CLI reads it ..." red (`expected [ 'universe' ] to include 'validate'`).
- mutation: the version step's extension precheck disabled → `release-version.test.ts` "a changelog whose first `## ` heading is not `## [Unreleased]` ...", "an `## [Unreleased]` heading that is not the first ..." and "a lock with fewer version fields ..." red (the tree is left changed).
- mutation: a `## [0.2.0]` section put above `## [Unreleased]` in the real extension CHANGELOG → `release-core.test.ts` "the real changelog of the extension is not at a release heading ..." red (`the first heading is [0.2.0]`).
- mutation: the real extension `package.json` at `1.0.1` → `story-42-6-qa-gate-verify.test.ts` "reads all eight packages at one plain version ..." red (AC 42.7.1's real-tree lockstep).

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

*Phase A record (lead, 2026-11-21, story sha `c874000`):*
- **A1:** CI is green, https://github.com/jbrandtmse/iris-execute-mcp-v2/actions/runs/44878867919.
  - Every `launcher` leg (ubuntu-24.04, macos-15, windows-2025) shows 32 files passed and `457 passed | 3 skipped (460)`. The skips are exactly the two live files: `localSpawnIntegration` 2 and `governanceUiRoundTrip` 1.
  - The gates (22.17.0, 24.0.0, 26.0.0), throwaway, package and ipm jobs are green.
- **A1b:** red on the path the job guards, https://github.com/jbrandtmse/iris-execute-mcp-v2/actions/runs/44878910834.
  - The throwaway branch `red/42-7-launcher` (`4e33987`) inverts one assertion in `constants.test.ts`.
  - Its `launcher` job failed on all three OS legs, each at `src/__tests__/constants.test.ts > hardcoded Server Manager constants`. The gates jobs stayed green, so the launcher job alone caught it.
  - The branch was deleted afterwards. The temporary worktree was already removed.
- **A2:** dry run, https://github.com/jbrandtmse/iris-execute-mcp-v2/actions/runs/44878912402.
  - `ci-gate` passed.
  - `prepare` packaged `the extension iris-mcp-launcher@1.0.0 (publisher iris-mcp): iris-mcp-launcher-1.0.0.vsix, 20 files`, and printed `a tag run would refuse: the first heading of extensions/iris-mcp-launcher/CHANGELOG.md is ## [Unreleased]` (by design).
  - `rehearse` gave 8 npm `dry run ok` lines. `vscode-marketplace` read `ready (would publish iris-mcp-launcher@1.0.0)`. `open-vsx` read `not ready (the Open VSX namespace iris-mcp does not exist … owner step O1)`, so `rehearse` exited 1 (DW-704, by design, before O1). `ipm` read `skipped: not enabled (Story 42.8)`.
  - The branch was deleted afterwards.
  - Observation, ledgered as DW-705 (wontfix-accepted): the Marketplace reads `ready` before the publisher exists. O1 must come before any tag after the merge.
- **A3:** the sha and run ids were sent to the Planner. The merge waits for the end of the epic (decision #83).
- **Status:** the story stays `in-progress`. Phase B waits for npm `1.0.0` (42.6 B7), and Phase C for the `v1.1.0` release (decision #95) and owner steps O1 to O3.

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

Status: done
Blocking condition: none

**Summary.** The launcher suite is green (DW-532), both CLI spawns pass an explicit `cwd` (DW-663), the extension is `iris-mcp`, private, at `1.0.0` with exact `@vscode/vsce` 4.1.1 and `ovsx` 1.4.0 pins (DW-389), the version step and `prepare` keep it in lockstep with the shared version, a `launcher` CI job runs the suite on Linux, macOS and Windows, and the Marketplace and Open VSX channels are enabled with a read-only lookup before each upload, OIDC for the Marketplace, trusted publishing or `OVSX_PAT` for Open VSX, and per-CLI secret containment. No store was touched. The story stays open for the lead's Phase A/B/C evidence (see Residual risks).

**Files changed.**
- `extensions/iris-mcp-launcher/package.json`, `package-lock.json`: publisher `iris-mcp`, `private`, `1.0.0`, exact CLI pins.
- `extensions/iris-mcp-launcher/src/clientsEngine.ts`, `governanceEngine.ts`, `extension.ts`: required `cwd` on both CLI spawns (clients: first workspace folder else home; governance: home).
- `extensions/iris-mcp-launcher/src/__tests__/*`: platform-neutral path pins, the 33-3-3 wait fix, `workspaceFolders` in the mock, DW-663 rows for both engines and both activation flows.
- `extensions/iris-mcp-launcher/README.md`, `CHANGELOG.md`: store install, disclaimer, working-directory note, `[Unreleased]`.
- `scripts/lib/release-core.mjs`, `scripts/release.mjs`, `scripts/lib/release-checks.mjs`, `.github/workflows/release.yml`: store channels, lookups, argv, containment, CLI install steps, `OVSX_PAT`.
- `scripts/release-version.mjs`: stamps the extension and renames its `[Unreleased]` heading (CRLF-safe).
- `scripts/lib/ci-checks.mjs`, `.github/workflows/ci.yml`: the `launcher` 3-OS job.
- `packages/iris-mcp-all/src/__tests__/*`: a test per matrix row, the manifest enumeration rows, `story-42-7-doc-claims.test.ts` (new).
- `README.md`, `CHANGELOG.md` (root): channel table, store authentication, the 1.0.0 vsix name.

**Review findings.** 37 findings (high 0, medium 8, low 27, false 2); 18 patched, 19 rejected with the reasons in the triage log; none deferred (`deferred: []`). Patched by root cause: the `HOME`/`USERPROFILE` leak in the DW-663 test, the temp-directory teardown race in the DW-663 clients rows, the governance `cwd` wiring pinned through `activate()`, the dangling oracle reference, the unused `STORE_*` exports, the CRLF heading rename, the stale `0.1.0.vsix` in the root README, the missing README working-directory note, and four missing `mutation:` lines.

**Follow-up review recommended: true.** Three medium entries were patched (the test-hygiene fixes and the new governance activation row). The unverified risk is the clients DW-663 helper, which waits for the CLI's spawn count to hold still for 400 ms: it is proven on macOS only, and the `windows-2025` leg of the new `launcher` job has not run.

**Verification performed (this Mac, after the last patch).**
- `node --check` on the five scripts: ok.
- Launcher suite before: 5 failed, 438 passed, 3 skipped; after: 0 failed, 448 passed, 3 skipped (the two unarmed live files). `npm run type-check` and `npm run build`: exit 0.
- The 15 story files of `@iris-mcp/all`: 944 passed, 2 skipped. The four `@iris-mcp/all` shards: 1596, 1299, 1295 and 1362 passed, 0 failed.
- Per-package tests, lint and type-check for client-config, shared, admin, data, dev, interop and ops were green in the implement pass and those packages are untouched since.
- The seven root checks and `gen:bootstrap`: OK, nothing changed; `BOOTSTRAP_VERSION` unmoved at `1.0.0+2.244fe8623c76`; the tag-consistency check prints `[] []`; `lint_spine.py`: 0 findings.
- The real vsix: one `iris-mcp-launcher-1.0.0.vsix` (22 files) with `Publisher="iris-mcp"` and `Version="1.0.0"`, packed into `os.tmpdir()`.
- Store lookups (read-only GET): 200 for `intersystems-community.servermanager@3.10.2` and 404 for `@0.0.1` on both stores (implement pass); 404 for `iris-mcp/iris-mcp-launcher@1.0.0` on both and for the Open VSX namespace `iris-mcp` today.
- The version-step rehearsal in a throwaway clone: exit 0, the extension at `1.0.1`, its CHANGELOG headed `## [1.0.1]`, `embeddedVersionProblems` empty; the clone removed.
- Mutations: about 35 applied across the implement and review passes, each red then reverted, recorded in `## Verification`.

**Residual risks.**
- `v1.0.0` must be tagged from a `main` commit that predates this story, or after the extension CHANGELOG heading is renamed: release-mode `prepare` refuses while the first heading is `## [Unreleased]` (by design).
- The Marketplace ignores `Range: bytes=0-0` (the real answer is the full body); the script cancels the body at once. Whether that counts as a download is unknown.
- The Open VSX namespace `iris-mcp` does not exist (404): the rehearsal reads `not ready` until the owner's step O1.
- The macOS and Windows legs of the `launcher` job are unproven until the lead's A1 and A1b.
- The spec says the story stays `in-progress` until the lead's C-phase evidence; this run records `done` per its dispatch contract, so the lead holds it open as 42.6 was.
- Rule #55 slips by the implement subagent and by this stage: a few small script edits and appends went through a shell heredoc or script instead of the file tools; every file was verified to be text and the content landed.

## QA

QA stage (2026-11-20), against build commit `62c34ec`. Method: a gap analysis of the matrix and the five priority areas, then a survivor hunt (about 22 mutations on the real tree, each restored with `git checkout --` and the tree compared byte-for-byte). Mutations that the existing suite already turned red were left as the implement stage recorded them; the ones below are the survivors found, the tests added for them, and the extra mutations QA demonstrated. No file was created: every test went into an existing file (the `release-script.test.ts` file already carries inline `(QA, ...)` describes). Oracles read read-only on 2026-11-20: Open VSX and Marketplace statuses for `intersystems-community.servermanager` 3.10.2 (200 both) and 0.0.1 (404 both), `iris-mcp` namespace 404, `iris-mcp.iris-mcp-launcher@1.0.0` 404 on both (all as the fixtures assume); the installed vsce 4.1.1 `log.done` was run under and outside `GITHUB_ACTIONS` and prints the skip line to stdout, ending the line, exactly as `skippedDuplicate` reads it; ovsx 1.4.0 `console.log`s its line to stdout (source).

**Tests added (QA)**
- `packages/iris-mcp-all/src/__tests__/release-script.test.ts`, new `describe("Publish: the extension stores, QA gaps ...")`, 5 tests:
  - a store request is a plain GET with no body, with exactly the headers `Range`+`User-Agent` (Marketplace) or `Accept`+`User-Agent` (Open VSX), in a release and a rehearsal, and no secret in any URL or header though every secret is in the job's environment;
  - a manifest with no `publisher` fails an enabled store channel (`failed (the publisher is missing)`) and is `not ready` in a rehearsal, and the stores are not asked;
  - a store CLI that cannot start (the `runCaptured` shape: `status: null`, `error`, no output) is `failed` with the error's own words, redacted, and what follows is `not attempted`;
  - a rehearsal stops at the first enabled store that is not ready: Open VSX is `not attempted` and its namespace and version are not read.
- `packages/iris-mcp-all/src/__tests__/release-script-fixtures.ts` (supporting): `FakeInit` gains `method`/`body`, and `FakeStores.requests` records `method` and `hasBody`.
- `packages/iris-mcp-all/src/__tests__/release-version.test.ts`, 1 test: a copy of the extension's REAL `package-lock.json` and `package.json` is stamped in the two version fields of its own and nowhere else (the fixture lock is hand-written, npm decides the real field order).
- `extensions/iris-mcp-launcher/src/__tests__/clientsActivationFlow.test.ts`, 2 tests: an EMPTY `workspaceFolders` array is no folder (home), and the folder is read when a command runs, not at activation (`recordedCwds` gains an `afterActivation` hook).
- `extensions/iris-mcp-launcher/src/__tests__/governanceActivationFlow.test.ts`, 1 test: with a workspace folder open the governance CLI still runs in home, never the folder (the existing DW-663 row was folded into a `governanceCwds(folder?)` helper, assertions unchanged).

**Mutations demonstrated by QA (`mutation: <what> -> <red test>`; each restored, tree identical)**
- mutation: `vsixReadiness` without the `typeof channel.publisher !== 'string'` check -> the two new missing-publisher rows red (this one SURVIVED the whole implement-stage suite before QA).
- mutation: `uploaded.error?.message` dropped from the upload-failure detail -> the new `cannot start` row red (survived before).
- mutation: an `Authorization` header added to the Open VSX namespace GET -> the new plain-GET row red (survived before: only the version GET's headers were pinned).
- mutation: `readStatus` sends `method: "HEAD"` -> the new plain-GET row red (survived before: the fakes never recorded the method).
- mutation: the store CLI `cwd` of `runChannel` set to the repo root -> `Publish channels ... all four enabled` red.
- mutation: `OVSX_PAT` removed from the redaction list -> `a failing store CLI that echoes a secret` red.
- mutation: `npmEnv = childEnv(env, oidcEnv(env))` (the OIDC variables leak into `npm view`/`--version`) -> `the job's OIDC request variables reach the three publish CLIs ... and no other child` and `no other child holds OVSX_PAT or VSCE_PAT` red.
- mutation: `OVSX_PAT` passed to `vsce` as well as `ovsx` -> three `Secret containment` rows red.
- mutation: the two store channels swapped in `RELEASE_CHANNELS` -> 14+ rows red (the order npm, Marketplace, Open VSX, IPM; the order test, the report rows and the OIDC row).
- mutation: the extension lock's top-level `version` key moved after `packages` (a reordering npm could produce) in the REAL lock -> the new real-lock stamp row red, while all 30 other `release-version.test.ts` rows stayed green.
- mutation: a new tracked non-private `package.json` (added to a temporary copy of the index through `GIT_INDEX_FILE`, so the real index never moved) -> `enumerates the root, the eight packages and the extension` and `the manifests that are not private are exactly the eight packages` red (DW-389: "a new non-private manifest appears").
- mutation: `"private": true` removed from the extension `package.json` -> the same two package-manifests rows red (re-demonstrated by QA).
- mutation: the governance spawn `cwd` follows `workspaceFolders[0]` -> the new governance folder row red (the older row, with no folder open, stayed green).
- mutation: the clients `cwd` expression `workspaceFolders ? workspaceFolders[0]!.uri.fsPath : os.homedir()` (breaks on `[]`) -> the new empty-array row red alone.
- mutation: the clients `cwd` cached at first use -> the new late-folder row red (plus the older DW-663 rows, polluted by the process-wide cache).
- mutation: the Windows leg dropped from the `launcher` matrix of the REAL `ci.yml` -> nine `ci-workflow.test.ts` rows red; the whole-suite step narrowed to one file in the real `ci.yml` -> six rows red; a runner dropped from the code-declared `LAUNCHER_RUNNERS` in `ci-checks.mjs` -> seven rows red.
- mutation: `OVSX_PAT` added to the rehearse job's store CLI install step env in the REAL `release.yml` -> five `release-workflow.test.ts` rows red.

**First-run failures:** two of my own new tests were wrong about the design, not the code: a rehearsal STOPS at the first enabled store that is not ready (Open VSX reads `not attempted`, as in a release), so I had expected a second `not ready` line that the script, by design, never prints; both tests were rewritten to pin the stopping behavior.

**Priorities, as found**
1. Store channels: the implement stage's tests already pinned the lookup outcomes (200/206/404/403/500/301/network/stall), fail-closed, per-CLI containment, the order and the readiness line of a disabled channel; QA closed the four survivors above.
2. Lockstep: the three lockstep fields, the heading refusal (release vs dry) and the rename were already red-on-mutation; QA added the real-lock oracle.
3. DW-389: covered; QA added the new-manifest mutation.
4. DW-663: the real `activate()` path was covered for one folder and none; QA added the empty array, the late folder and governance-with-folder.
5. `launcher` CI job: covered for the code roster, `ci.yml` and every OS leg; QA re-demonstrated the mutations on the real files.

**Verification (after the QA edits, unarmed):** `release-script`, `release-version`, `release-core` and `release-prepare` (418 passed); the launcher suite (31 files, 451 passed, 3 skipped, up from 448); launcher `type-check` clean. `package-manifests`, `ci-workflow` and `release-workflow` ran green under their baselines before each mutation.

**Defects and findings (none blocking)**
- deferred: the store lookup trusts any 200/206 without looking at what came back. The real Marketplace answer is `application/vsix` (a zip) and the real Open VSX answer is JSON that names the version; a CDN, proxy or captive-portal 200 with an HTML body would read as `published`, and a release would skip the upload with exit 0 and the row `already published`. Suggested fix, to be probe-first (#16): read the content type (Marketplace `application/vsix`, Open VSX JSON) and treat a 200 with another type as `unknown`. Not trivial (the fakes need real content types, and `fakeFetch` always answers `application/json`), so it is recorded, not fixed. reopen_if: the first store release reads `already published` for a version that is not on the store.
- deferred (low): a store CLI killed by a signal or by the 30-minute `runCaptured` timeout returns `status: null` with no `error` and no output, so the row reads `failed ()` with an empty detail; the exit code is still 1 and the status is `failed`. A fallback such as `exited without a status` would read better.
- note: the fake `fetch` answers a 301 as a final status; the real `fetch` follows redirects, so a `(HTTP 301)` cause can only come from a redirect with no usable `Location`. The branch is fail-closed either way and harmless.
- containers used: none. Shared IRIS: not touched. No store, registry or GitHub call other than public read-only GETs (curl) to `open-vsx.org` and `marketplace.visualstudio.com`.

## Review

Code review, 2026-11-21, of the frozen diff `git diff 19eaf1a c87662a` (the lockfile checked mechanically, the rest by four layers: Blind Hunter, Edge Case Hunter, Verification Gap, Acceptance Auditor; tier `full-opus`, every layer delivered). Fix-risk is given per entry. Patch commit: see the closing report.

**Lockfile (mechanical):** `@vscode/vsce` 4.1.1 and `ovsx` 1.4.0 resolve exactly; the lock's `version` and `packages[""].version` are `1.0.0`; every entry resolves from `registry.npmjs.org`; the additions are vsce 4.x's and ovsx's own dependencies (`@napi-rs/keyring` replacing `keytar`, `@inquirer/*`, `@node-rs/crc32`, `yauzl-promise`); install scripts only in `@vscode/vsce-sign`, `esbuild`, `fsevents`, which `--ignore-scripts` skips in `rehearse` and `publish`.

**Checks that held:** `id-token: write` and `secrets.` only in `publish`; `launcher` in `DECLARED_STEPS`, `ci.yml` and the self-test; a red leg fails `ci-gate` (whole-run `conclusion`); the real tree is in lockstep (extension, lock and shared all `1.0.0`); the lead checklist publishes nothing before O3, and B1/Phase C wait on npm 1.0.0; OIDC variables and `OVSX_PAT` reach only their CLIs; no test was weakened by the DW-532 or DW-663 changes (Rule 3: the release script, the CI self-test and the launcher flows run as real processes and through the real `activate()`).

**High**
- H1 — The `launcher` job built only client-config and shared, so `governanceEngineRealCli.test.ts` (which needs all five servers' `dist/tools/index.js`) skipped 4 of 4 on every leg, against AC 1 ("the only skips are the two live files") and #59 (blind, edge, verification-gap, auditor). **Patched**: the step is `pnpm build` (the gates/throwaway/package sibling), in `ci-checks.mjs`, `ci.yml` and the self-test, plus a narrowed-build mutation row; the CI header and root README corrected. Fix-risk low (tsc-only builds, portable). Proven only by CI: see the lead items.

**Medium**
- M1 — (lead-routed, QA) A store lookup read only the status, so a proxy or captive-portal 200 read as `already published` and the release skipped the upload with exit 0 (blind, auditor, verification-gap). **Patched**: `storeOutcome(store, answer, expected)` needs the store's own evidence: Marketplace 200/206 typed `application/vsix`; Open VSX 200 `application/json` whose `namespace`, `name` and `version` match; 404 stays `absent`; anything else `unknown` (fail closed). The fakes now answer the real content types and bodies (re-probed 2026-11-21, five Marketplace extensions, recorded in the `release-core.test.ts` header). Fix-risk low.
- M2 — With a relative `governanceFile`, the panel's `fileExists` checked the extension host's directory while the CLI (now in home, DW-663) read home (blind). **Patched**: the adapter resolves against `os.homedir()`; a `governanceActivationFlow` row proves the editor runs `validate` on a relative file. Fix-risk low.
- M3 — `governanceCwds` deleted its temp directories while the panel's `universe` spawn could still run in them (Windows EBUSY), and read the log after the first spawn only (blind, edge, verification-gap). **Patched**: the clients helper's 400 ms hold-still wait (a near-copy: the two activation-flow files share no helper module). Fix-risk low.
- M4 — "the real changelog of the extension ..." could not fail: it compared the file's first heading with itself (verification-gap). **Patched**: it asserts the first heading is `[Unreleased]` or the manifest's version. Fix-risk low.
- M5 — With no folder open, Cursor's project scope (`.cursor/mcp.json` in home) is its user file (`~/.cursor/mcp.json`) (auditor). **decision-pending**, DW-702 (owner burndown): refuse or flag project scope when the project directory is home, or document it. Fix-risk med; out of footprint (client-config).
- M6 — A store not ready in `rehearse` (no Open VSX namespace before O1, or a store outage) blocks `publish`, npm included (blind, edge). **by-design**, DW-704: the matrix row "Open VSX namespace absent" makes the dry run exit 1. Consequence for the lead: O1 must come before any post-merge tag, a 1.0.x fix included.

**Low**
- L1 — (QA) A store CLI ending non-zero with no output read `failed ()`. **Patched**: `<cli> ended with no output (exit N)`. (A signal already carries `ended by <signal>` from `runCaptured`.)
- L2 — The version step found a bad extension heading or lock only after `changeset version` and gen-bootstrap had changed the tree, and could stamp one file but not another (blind, edge x2, auditor). **Patched**: a read-only precheck of all three before anything is written; the refusal rows now assert a clean tree.
- L3 — The root README told the owner `ovsx create-namespace ... -p <token>` (token in argv) (blind). **Patched**: `OVSX_PAT=<token> npx ovsx create-namespace iris-mcp`, pinned. The spec's O1 step 4 keeps the old form (intent text, not edited here).
- L4 — "an answer that cannot be read stops the release before any upload" was untrue (npm, and maybe the Marketplace, upload first) (edge). **Patched** in the README, root CHANGELOG and `release.mjs` header.
- L5 — The extension CHANGELOG line "until then the extension installs only from a `.vsix`" would be wrong in the section that ships to the stores (auditor). **Patched**.
- L6 — The doc-claims row "its first section records the story" searched every section (auditor). **Patched**.
- L7 — 33-3-3 restored `HOME`/`USERPROFILE`/`APPDATA` by assigning `undefined` (verification-gap). **Patched**.
- L8 — A first Open VSX publish with `OVSX_PAT` unset fails after npm and the Marketplace (blind, edge). **wontfix-accepted**, DW-703 (O2 sets the secret; re-run failed jobs recovers).
- L9 — Invalid JSON in the extension manifest or lock crashes `readReleaseFacts` uncaught (edge). **wontfix-theoretical**: the crash still exits non-zero; real if a non-JSON manifest could be committed past CI.
- L10 — The clients CLI's `npx` now runs in the workspace, so a workspace `.npmrc` applies (edge). **by-design** (decision #98): the extension declares no `untrustedWorkspaces` support, so it runs only in trusted workspaces.
- L11 — Nothing checks the skip count on the CI legs (auditor). **Patched at the cause** (H1); the lead's A1 records it.
- L12 — The extension CHANGELOG says the suite passes on Windows before a Windows run (auditor). **by-design**: A1/A1b is the gate; reword if A1's Windows leg is red.
- L13 — Spec frontmatter `status: done` vs "stays `in-progress`" (auditor). **by-design**: frontmatter is build-auto state; sprint-status stays `in-progress` until C4.
- L14 — The fake 301 row is a final 3xx, which the real `fetch` returns only for a redirect with no `Location` (blind, verification-gap). **wontfix-theoretical**: fail-closed either way; the reachable case (a redirect to a 200 page) is now `unknown` under M1, and the probed store URLs do not redirect.
- L15 — AC 42.7.1's real-tree lockstep row had no `mutation:` line (verification-gap). **Closed**: applied and recorded under `## Verification`.
- L16 — (Rule 2, on this review's own M3 patch) the hold-still loop copies the clients helper's. Kept: about eight lines, and no shared test-helper module exists.
- Dismissed: "a `v1.0.0` tag cut after this merge publishes nothing" (edge). `v1.0.0` is tagged on `main` `55ae0eb`, which predates the enabled store channels.

**Re-review recommended:** yes. H1's proof is the first CI run (A1). M1 to M3 and L2 change behavior.

**For the lead:** at A1, record each `launcher` leg's counts and expect exactly 3 skipped (the two unarmed live files). A Windows red there is likely test hygiene, not product (the M3 fix is proven on macOS only). O1 must come before any tag after the epic-end merge (M6). DW-702 is for the decision sheet.

### Re-review (iteration 2)

Scoped re-review, 2026-11-21, of the frozen diff `git diff c87662a ed84b21` (the first review's patch commit). Four layers ran, tier `full-opus`, and all four delivered: Blind Hunter (12 rows), Edge Case Hunter (9), Verification Gap (2 gaps and 2 other findings), Acceptance Auditor (4). That is 29 rows, grouped into 15 entries. Review outcome: no HIGH, and both MEDIUMs patched.

**Per-patch verdicts (each mutation re-run in this pass: reverted, observed red, restored, tree identical):**
- **H1 holds.** `ci.yml`, `ci-checks.mjs` and the self-test agree on `run: pnpm build`. That is turbo's build of every `packages/*`, including the five servers' `dist/tools/index.js` and the shared and client-config CLIs. Locally, after a full build, the launcher suite is 452 passed and 3 skipped. The skips are exactly the two live files: `governanceUiRoundTrip` has 1 test and `localSpawnIntegration` has 2. The same holds under `CI=true`. Mutation: narrowing `ci.yml` alone turns 5 `ci-workflow.test.ts` rows red. The cause H1 exposed (a silent skip) now also fails on CI: see R1.
- **M1 holds.** `storeOutcome` gives `published` only for a Marketplace 200/206 typed `application/vsix`, or an Open VSX 200 typed `application/json` with matching `namespace`, `name` and `version`. A 404 is `absent`, and everything else is `unknown`. The fakes use the real types and bodies; the auditor re-probed both stores read-only and they match. Mutation (status-only): 16 rows red, not the 12 recorded. The `## Verification` line is corrected (Rule #51).
- **M2 holds.** The governance CLI reads the path as given, relative to its cwd (home). The panel's `fileExists` now resolves against `os.homedir()`. Mutation: back to `stat(candidatePath)` turns the relative-file row red (`expected [ 'universe' ] to include 'validate'`).
- **M3: not enough. Re-patched (R2).**
- **M4 holds.** Mutation: a `## [0.9.0]` first heading in the real extension CHANGELOG turns the row red.
- **L1 holds.** It reads the right exit. A whitespace-only stderr is rejected below.
- **L2 holds.** The precheck runs after the git, changeset and CLI checks and before the first write. Mutation (precheck disabled): the 3 refusal rows go red, each through its `git status --porcelain` assertion.
- **L3: the README overclaimed. Re-patched (R4).**
- **L4 to L7: hold.** L4's runtime sentence is now scoped to its store (R5).

**New entries:**
- **R1 (MEDIUM; verification-gap + blind; fix-risk low).** The cause of H1 survived it. A real-CLI file whose dist is missing, or whose local-mode resolution fails, still skips silently on CI, with a green leg. **Patched.**
  - The fix is a new helper, `extensions/iris-mcp-launcher/src/__tests__/builtDist.ts` (`skipUnbuilt`, `onCi`). On CI (`CI=true`, which GitHub Actions sets on every runner) it throws, naming the reason. Off CI it still skips, so an unbuilt clone runs. The `skipIf`/`skipAll` of `governanceEngineRealCli`, `clientsEngineRealCli` and `clientsPanelRealCli` now call it, and `envContract` asserts its oracle is built on CI.
  - The two live files keep their own arming, so they skip unarmed on CI as before. The helper's rows are in `builtDist.test.ts`.
  - Mutations on the guarded path are recorded under `## Verification`. Premise change: the first review rejected "no guard for silently skipped real-CLI files" before H1 showed that the mechanism had hidden a real defect.
- **R2 (MEDIUM, Rule 19 hermeticity; verification-gap + edge + blind + auditor; fix-risk low).** `governanceCwds` waited for a 400 ms quiet period, not for a signal, and had no deadline of its own.
  - The panel spawns `universe` only after `validate` exits, so on a slow Windows runner the gap can exceed 400 ms. The temp directories were then deleted under a live spawn (EBUSY), and the spawn was missed.
  - **Patched:** the stub now writes a start line (command and cwd) and an exit line to one log. The helper waits, with a 30 s deadline and a named failure, until `universe` has started and every started run has exited. One log also removes the `cwd.log`/`argv.log` read race.
  - The clients helper's quiet period (L16) was not flagged and is unchanged.
- **R3 (LOW; edge + verification-gap + blind; patched).** `openVsxNamespaceState` read any 200 as `present`, which is M1's sibling. A 200 is now `present` only when it is JSON. Otherwise it is `could not be read (HTTP 200, but the answer is <type>, not JSON ...)`. New row in `release-script.test.ts`.
  - The child-process `STORE_STUB` now types its answers as the real stores do (JSON). Untyped, the real-process rows would have read the namespace as unknown.
- **R4 (LOW; blind + auditor; patched).** The root README said that `OVSX_PAT=<token> npx ...` keeps the token out of the shell history. The shell records the typed line. It now says what is true (not in the arguments or the process list), and how to keep the line out of the history. Pinned in `story-42-7-doc-claims.test.ts`.
- **R5 (LOW; edge + blind; patched).** The store row's sentence "Nothing was uploaded" read as global while npm (and the Marketplace) had already uploaded. It is now "Nothing was uploaded to <store>". The `release.mjs` header says the earlier channels have already run. The three pinning rows are updated.
- **R6 (LOW, Rule #51; blind + auditor; closed).** The M1 mutation tally is corrected from 12 to 16 under `## Verification`.
- **R7 (LOW; blind; patched).** The relative `governanceFile` rule (read from home) is now in the extension README settings row and in the setting's description in `package.json`, not only in the CHANGELOG.

**Rejected:**
- Spec text stale (Code Map :115 `storeOutcome(status)`, :150 the narrowed build, Task 10 "200/206 → published", and the matrix's "Lookup unreadable" row) (auditor + blind). The fix edits the spec under review, and the matrix is inside the frozen intent block. It is for the lead (below).
- Spec O1 step 4 still has `-p <token>` (blind). This is a spec edit: for the lead.
- The first store release: "the next release after 1.0.0" against decision #95's v1.1.0 (blind). DW-704 (by-design) stands; nothing new.
- The Open VSX "JSON that did not parse" reads "does not name ..." (blind). It fails closed either way, the case is rare, and the fix adds a branch.
- A whitespace-only stderr hides a signal in the L1 fallback (edge). The real CLIs print text on failure, and the case is rare.
- The doc-claims row "its first section records the story" will need an update when a later story adds a section (edge + blind). By design: it pins this story's docs, as L6 asked, and the story that adds a section updates it.
- The L2 refusal message form (auditor). Nothing is mis-stated, by the auditor's own reading.
- The real-process `STORE_STUB` answered untyped (verification-gap other). The in-process path covers the typed branches with real `Response` objects, and the stub is now typed anyway (R3).

**Runs on the patched tree:**
- Launcher, unarmed: 32 files, 457 passed and 3 skipped. The same under `CI=true`.
- `@iris-mcp/all`: `ci-workflow`, `release-core`, `release-script`, `release-version`, `story-42-7-doc-claims` and `package-manifests`, 606 passed.
- `node --check` passes on the four changed or touched scripts. The launcher's `tsc --noEmit` is clean.

**Re-review recommended:** no. **For the lead:**
- At A1, a `launcher` leg now fails, rather than skips, if any real-CLI dist is missing. Expect 3 skipped per leg.
- R2 makes the A1 Windows leg's governance rows wait on exit signals. The clients rows still use the quiet period.
- Rule #42: amend Code Map :115 and :150, Task 10, and O1 step 4 (`OVSX_PAT=<token> npx ovsx create-namespace iris-mcp`) at Phase C.
