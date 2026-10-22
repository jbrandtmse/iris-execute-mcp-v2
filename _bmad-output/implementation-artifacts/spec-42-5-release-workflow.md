---
title: 'Story 42.5: Release Workflow'
type: 'feature'
created: '2026-10-22'
status: 'done'
baseline_revision: 'ade31b5ac2b6f5daa4b6bb8ea6654d8e17e198e8'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-iris-execute-mcp-v2-2026-10-14/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-42-context.md'
warnings:
  - multiple-goals
  - oversized
deferred:
  - summary: >-
      The public IPM registry builds its package by tarring the packaging repository's default-branch root as-is (no IRIS build,
      no `-dev`), and users install that tar non-dev. CI's `ipm` job proves a different artifact: IPM's own `package` output after a
      `load -dev`. No gate installs the registry-shaped artifact (the staged tree, tarred) non-dev before a user does.
    evidence: >-
      Plan research 2026-10-22: intersystems-community/zpm-registry `src/cls/ZPM/Package.cls` (`UpdatePackage`,
      `DownloadPackageFromGitHub`, `LoadPackage`: `tar --exclude=.git -zcvf … -C Path .`); the registry's objectscript-math-0.0.5.tgz
      is the repo root verbatim. Rule #59: the proof must run on the path users take.
    location: 'Story 42.8 (Open Exchange listing; its live check installs from the registry on a networked throwaway)'
    severity: medium
---

<intent-contract>

## Intent

**Problem:** Nothing can publish the suite, and nothing guarantees that a publish comes from a checked state:
- There is no `release.yml` and no release script.
- Each package's `prepublishOnly` runs the live gates against an IRIS that a release runner does not have. Per-package hooks also cannot gate a multi-package release: a failure on the fifth package leaves four already published (DW-387).
- An armed gate fails closed unless all five `IRIS_*` variables are set (DW-675).
- The IPM registry route is unchosen (DW-689).
- AD-14's version step does not exist.
- There is no bad-release policy and no `SECURITY.md`.
- CI, which the release consumes, has a recurring flake (DW-693).

**Approach:**
- **`.github/workflows/release.yml`.** On a `v*` tag it runs four jobs: `ci-gate`, `prepare`, `rehearse` and `publish`.
  - `ci-gate` waits for a green `ci.yml` run on the tagged commit and checks the `release` environment's protection.
  - `prepare` runs the root release script's gate set once: every `prepublishOnly`, armed against a throwaway IRIS. It then packs and checks every artifact.
  - `rehearse` is the dry run. It has no environment, no OIDC and no secrets.
  - `publish` sits behind the approved `release` environment. It uploads the exact rehearsed bytes, channel by channel, in order.
- **Dry runs.** A push to a `release-dry-run/**` branch, or a manual dispatch, runs every job except `publish`.
- **The version step.** A root `version` script runs `changeset version` and regenerates every artifact that embeds the version.
- **DW-693.** One newline-terminated audit reader in `scripts/lib`, used by every audit reader, plus a deterministic probe-copy test.

## Boundaries & Constraints

**Always:**
- **Nothing is published by this story.**
  - No stage runs `npm publish` or `pnpm publish` (not even `--dry-run`), `changeset version` on the real tree, `changeset publish`, `npm stage publish`, `vsce`/`ovsx publish`, an IPM `publish`/`repo`, `git tag`, `git push` or `gh release`.
  - No stage creates or edits a GitHub environment, secret or setting.
  - No stage pushes or triggers CI.
  - Every publish-shaped behavior is proven against scripted stand-ins on `PATH` (`npm`, `git`, `vsce`, `ovsx`, `docker`) or injected dependencies. The first real run of `release.yml` is the lead's dry run (Verification).
- **The release can never publish without the approved environment.**
  - Only `publish` has `environment: release`, only `publish` has `id-token: write`, and `secrets.` appears only in `publish`. `github.token` appears only in `ci-gate` and `publish`, both with `actions: read`, for the CI and environment reads.
  - `publish` runs only when `github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v')`, and only after `ci-gate`, `prepare` and `rehearse`.
  - `ci-gate` refuses a tag run when the environment is missing or unprotected, so GitHub never auto-creates an unprotected `release` environment.
  - The script's real mode refuses outside that event, ref and sha.
- **The gate set** (DW-387, DW-675):
  - Every `prepublishOnly` runs once, before any upload, through `scripts/throwaway-iris.mjs exec … node scripts/ci-live-suite.mjs prepublish-<short>` on a seeded `irishealth-community:2026.2` (`CI_IMAGES` digest, `HSCUSTOM`, port 52791). The harness's child environment exports `IRIS_REQUIRE_LIVE=1`, all five `IRIS_*` and `IRIS_HTTPS`.
  - Packing and uploading run no lifecycle script: `pnpm pack` with scripts ignored, then `npm publish <tgz> --ignore-scripts`.
- **The only way to publish** is `node scripts/release.mjs publish` inside `release.yml` (alias `pnpm release`). No workflow `run:` and no `package.json` script holds a raw publish verb.
- **The npm publish order is exactly** `client-config, shared, admin, data, dev, interop, ops, all`, and every package follows its `workspace:*` dependencies. The first failure stops everything after it, and the report names each package and channel as published, already published, failed, not attempted, or skipped.
- **The toolchain.**
  - `ci-gate` and `prepare` run on Node `22.17.0`, the floor and CI's throwaway leg.
  - `rehearse` and `publish` run on Node `26.0.0`, which bundles npm 11.12.1, at or above trusted publishing's 11.5.1.
  - pnpm stays `9.15.0` and `@changesets/cli` stays 2.x, used for versioning only.
  - Every `uses:` is pinned by a 40-hex SHA with a version comment.
- **Repo conventions.**
  - Rule 14: non-ASCII in code is written as escapes. Rule #55: no heredoc writes.
  - Error text has the form `<what happened>. <what to do>.`
  - New scripts import only `node:` builtins and existing repository scripts and modules, with no new dependency.
  - `ci-gate`, `rehearse` and `publish` run without `pnpm install`. So `scripts/release.mjs` statically imports only `node:` builtins, `scripts/lib/release-core.mjs` and `scripts/lib/script-process.mjs` (both builtins-only), and loads every `prepare`-only module (harness, pack, smoke, IPM staging) by dynamic `import()` inside `prepare`. A test pins the static import list.

**Never:**
- **No change to `ci.yml`, its registry or its self-test behavior.** Refactoring `ci-workflow-check.ts` exports is allowed; every assertion stays as it is.
- **No change to protected surfaces:** the tool surface, REST routes, ObjectScript classes, `BOOTSTRAP_VERSION` (`0.0.2+2.244fe8623c76`), the governance baseline (`1e62c5ad5bf7`/141), frozen goldens, `tools-list-snapshot.json`, `irislib/` and `irissys/`.
- **No package content change, and so no changeset.** `packages/*/src/__tests__/` is excluded from every tarball.
- **No `changeset publish`, no changesets/action and no pnpm or Changesets upgrade.**
- **No `npm unpublish`, no prerelease tag, and no `0.0.0-stage` placeholder.**
- **No GitHub Release asset.** The extension and IPM channels ship disabled. Their enabling stories (42.7 and 42.8) flip them on and add their secrets.
- **No docker on the development machine.** Stages never touch the shared IRIS; this story needs no IRIS call.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| CI gate: green | `ci-gate`; a `ci.yml` run (by `path`) with `head_sha` = sha, `status: completed`, `conclusion: success` | Pass at once. Prints the run URL | — |
| CI gate: pending | No run yet, or runs still in progress | Poll every 60 s up to `--timeout-minutes` (default 180), then pass when one succeeds | Timeout: exit 1 naming the sha |
| CI gate: red | Every run on the sha completed, none `success` | Exit 1, listing each run's URL and conclusion; no later job runs | expected refusal |
| CI gate: API failure | Non-2xx or a network error | Exit 1 (fail closed), naming the status | fail closed |
| Environment guard | `GET /environments/release` and its deployment-branch policies | Protected means: at least one required reviewer, `can_admins_bypass: false`, and custom policies equal to exactly one tag policy `v*`. `prevent_self_review: true` is reported as a warning | Tag run: missing, unprotected or unreadable → exit 1 before `prepare`. Dry run: one report line, exit 0 |
| Mode | Event and ref | `release` only for a `push` of `refs/tags/v<x.y.z>`; otherwise `dry-run`. Recorded in the manifest | — |
| Prepare: version state | Any run | Every `@iris-mcp/*` version equals the tag version (in a dry run, one shared version), with no prerelease and no pending `.changeset/*.md` | Tag run: exit 1 listing every problem. Dry run: the same lines, prefixed "a tag run would refuse:", and exit 0 (today client-config is `0.0.1` and changesets are pending) |
| Prepare: tree integrity | Any run | `BOOTSTRAP_VERSION`'s semver and `ipm/module.xml` `<Version>` equal `@iris-mcp/shared`'s version. `pnpm gen:bootstrap` leaves `git status --porcelain` empty. Every root script whose name ends in `:check` passes, except `format:check` (a named reason: it is not a CI gate) | exit 1 in both modes, listing every problem |
| Prepare: gate set | Healthy runner | `up`, then seed, then the 8 `prepublish-<short>` suites in publish order, then `down` | Any red suite: exit 1 after `down`. The container is removed on every exit path, signals included |
| Prepare: artifacts | After the gates | 8 tarballs via `pnpmPack` (scripts ignored). Each tarball manifest has the release version, no `workspace:`, and `exports` equal to the source's `publishConfig.exports` when present, else its `exports`. `smokePackages` passes on these exact tarballs. The vsix comes from the extension's `package` script, with `vsce ls` recorded. The IPM tree comes from `stageModule` of the built embed, plus a generated `README.md` and `LICENSE`, with `embedProblems` empty. `release-manifest.json` records version, sha, mode, channels, files and sha256 | exit 1 naming the artifact |
| Rehearse | `publish --dry-run --artifacts <dir>` | Hashes are verified. One `npm publish <tgz> --access public --provenance --ignore-scripts --dry-run` per package, in order. `npm view <name>@<v> version` marks "would be already published". Every disabled channel runs its dry step and reports readiness (for example, publisher `TBD-at-publish-time` or the packaging repository absent). `NPM_TOKEN` is never read. No `vsce`/`ovsx publish`, `git push` or userconfig write | An enabled channel's dry step fails: exit 1. A disabled channel's problems: "not ready" only |
| Publish: refusals | Real mode; not `push` of `refs/tags/v<manifest.version>`, `GITHUB_SHA` ≠ manifest sha, a hash mismatch, a manifest mode not `release`, the environment guard failing on re-check, or npm < 11.5.1 | Exit 2 before any upload, naming the condition. The npm-version and hash checks also run in a dry run (exit 1 there) | expected refusal |
| Publish: auth | `NPM_TOKEN` set or empty | Set: a 0600 temp userconfig holding the token, passed as `--userconfig` and deleted on every exit path; logs `auth: token`. Empty: no userconfig, npm uses OIDC (trusted publishing); logs `auth: oidc`. The token is never printed | — |
| Publish: npm | In order | A version already on the registry is skipped. Otherwise upload; the first failure stops the rest | exit 1 with the report |
| Publish: channels | After npm | A disabled channel prints "skipped: not enabled (Story 42.7/42.8)". An enabled channel runs its step:<br>• Marketplace: `vsce publish --packagePath <vsix> --skip-duplicate`, from the extension's `node_modules/.bin`.<br>• Open VSX: `ovsx publish <vsix> --skip-duplicate`, from the extension's `node_modules/.bin`.<br>The two read their own credential environment and are "not ready" when the CLI is absent.<br>• IPM: refuse when `GET https://pm.community.intersystems.com/packages/iris-execute-mcp-v2` already lists the version. Then clone `IPM_DIST_REPOSITORY` with `IPM_DIST_DEPLOY_KEY` (a 0600 temp key file, removed on exit), replace the tree (keeping `.git`), commit `iris-execute-mcp-v2 <v> from <sha>`, tag `v<v>`, and push `master` and the tag with no force. An existing tag with an identical tree is "already published"; with a different tree, it fails.<br>Dry step: the same GET plus a read-only `git ls-remote` | Failure: stop, report, exit 1 |
| Version step | `pnpm run version [-- --first-release]` on a clean tree | `--first-release` (every version below 1.0.0, template present) copies `scripts/release/changeset-1.0.0.md` into `.changeset/`. Then `changeset version`, then one shared non-prerelease version, then `gen:bootstrap`. The marker, the two stamped parameters and `module.xml` carry it, and the sequence and hash are unchanged. Prints the `BOOTSTRAP_VERSION` move literal and the next steps | Dirty tree, missing template, mixed or prerelease versions: exit 1 or 2 naming it. Run as the `npm version` lifecycle hook (`npm_command=version`): exit 2 saying use `pnpm run version` |
| DW-693 reader | Text ending in a partial line; blank lines; CRLF | Only newline-terminated, non-blank lines are returned. A terminated corrupt line throws. A missing file reads as `[]` | — |
| DW-693 probe-copy | The probe exits on stdin EOF before its SIGTERM listener runs | The test asserts the SIGTERM the client SENT to the probe's pid, recorded by a `ChildProcess.prototype.kill` spy, before `open()` resolved. The probe's pid is one of `starts()` | — |

</intent-contract>

## Code Map

**What the release reuses (Rule 2 — extend, never copy)**
- `scripts/lib/ci-checks.mjs`:
  - `NODE_LEGS` :31, `RUNNER` :34, `PINNED_ACTIONS` :37-41 (checkout `fbc6f399…` v5.1.0, pnpm/action-setup `fc06bc12…` v4.4.0, setup-node `a0853c24…` v5.0.0);
  - `CI_HOST_PORTS` :48, `LIVE_NAMESPACE` :51, `CI_IMAGES` :57, `publishablePackages()` :79, `LIVE_SUITES` :232 (`prepublish-<short>` at :195).
- `.github/workflows/ci.yml`:
  - `on: push/pull_request/workflow_dispatch` :34-37 (push unfiltered, so every tag push also runs CI), `permissions: contents: read` :39.
  - The `throwaway` job :117-210 is the precedent for the steps `prepare` re-runs: `npm ci` in `extensions/iris-mcp-launcher`, the sysctl port reservation, `up` of the health image at :151, seed, and the 8 prepublish suites at :156-179.
- `scripts/throwaway-iris.mjs`:
  - exported `upHarness`/`execHarness`/`downHarness`/`defaultDeps`;
  - `buildChildEnv` :455-470 (`IRIS_REQUIRE_LIVE=1`, host, port, `_SYSTEM`/`SYS`, namespace, `IRIS_HTTPS=false`, `IRIS_THROWAWAY`), which is DW-675's satisfier.
- `scripts/ci-live-suite.mjs` `runSuite` :115 runs `pnpm run prepublishOnly` with the no-skip rule; `scripts/ci-seed-throwaway.mjs` seeds the throwaway.
- `scripts/ci-ipm-archive.mjs` `startRun` :156 and `cleanup` :171-174: the signal-safe container-teardown pattern. Move it to `scripts/lib` if `prepare` can share it.
- `scripts/lib/pnpm-pack.mjs` `pnpmPack(dir, dest, {ignoreScripts=true})` :51 returns `{tarball, bytes, root, files, manifest}`. Only pnpm applies `publishConfig.exports` and rewrites `workspace:*`.
- `scripts/ci-package-smoke.mjs`:
  - `smokePackages` :183 packs its own tarballs into a temp directory and deletes it at :244. Extend it to accept prebuilt tarballs.
  - `main` :256 (exit 2 on any argument) stays byte-identical.
- `scripts/lib/ipm-archive.mjs`: `loadEmbed(repoRoot)` :69 (reads `packages/shared/dist/bootstrap-classes.js` and `ipm/module.xml`), `embedProblems` :121, `stageModule(dir, embed)` :159.
- `scripts/lib/script-process.mjs`: `isEntryPoint` :23, `spawnInherited` :39.
- `scripts/release/changeset-1.0.0.md`: the 8-package `major` template.
  - `release-1-0-0-mechanism.test.ts` (`makeFixture`, ~:55) runs the REAL `changeset version` in a tmp fixture with `node_modules` linked. That is the precedent for the version-step test.
  - `gen-bootstrap-write.test.ts` builds the generator scratch copy.
- `scripts/gen-bootstrap.mjs`:
  - The semver comes from `packages/shared/package.json` (:119-120). The hash covers unstamped content (:97-107), so a semver-only change keeps the sequence and hash (:150-155).
  - It writes only on change (:296-316) and has no `--check`. Drift is caught by `bootstrap.test.ts` (~:2485, ~:2496) and `ipm-manifest.test.ts:68`.
- `serverInfo.version` is read from `package.json` at runtime (`packages/iris-*-mcp/src/index.ts:20,24`), and every golden is version-tolerant. `@iris-mcp/client-config` is at `0.0.1` and the rest at `0.0.2`; the fixed group lifts all eight to the same version.

**The self-test to extend**
- `packages/iris-mcp-all/src/__tests__/ci-workflow-check.ts`:
  - `yaml` parse :26, `stripComments` :87 (exported), `workflowProblems` :139;
  - the pin loop :189-206 (inline, so export it);
  - the hygiene regexes :239-249 and the permissions check :250-258.
- `ci-workflow.test.ts`:
  - It reads `ci.yml` at :52-53. Its README CI-section pin is near :490.
  - Rule #56 `ROOT_SCRIPT_EXEMPTIONS` :411-444: root script names matching `(^|:)(check|validate)(:|$)`. `version` and `release` don't match.
- `fake-docker.ts` (a scripted docker as the only PATH entry) is the precedent for stand-in CLIs.

**DW-693 sites** (each read through the shared reader once fixed)

| Site | Lines | Note |
|---|---|---|
| `packages/iris-mcp-all/src/__tests__/process-gate-helpers.ts` | `completeAuditLines` :944; `pollAuditEntries` :958; `settledAuditCount` :985 | The guarded reader today |
| `scripts/lib/sdk-handler-golden-core.mjs` `settledAuditEntries` | :120-137 | Consumers: chokepoint-both-eras :245, 43-2-qa-hand-wire :268, 43-3-qa-wire :142, `story-42-10-qa-audit-namespace-built.test.ts:66`, `runHandlerSession` :167 (handler golden :129, :173; `scripts/capture-sdk-handler-golden.mjs:52`) |
| `packages/shared/src/__tests__/test-helpers.ts` `auditLines` | :59-70 | 16 calls: data-policy-server ×8; sdk-wire-compat 640, 1768, 1878; interop message-body-governance :171, logs-diagram-policy :441, message-search-governance :132, :156, :240 |
| `sdk-wire-compat.test.ts` `entriesAfterMarker` | :1116-1130 | — |
| Private `waitForLineCount` copies in `packages/shared/src/__tests__/` | audit-concurrency-shutdown :90; audit-interceptor :96; audit-mixed-outcome-concurrency :118; audit-outcome-derivation :111; audit-outcome-fidelity :138; audit-redaction-interceptor :130 | — |
| Post-drain reads | `audit.test.ts:30` `readLines`, :362; audit-concurrency-shutdown :198, :229; audit-mixed-outcome-concurrency :298 | Low risk |
| `story-43-4-qa-probe-copy.test.ts` | `lines` :111, `events()`/`audit()` :115-116; flaky assertion :168-169; launcher SIGTERM listener :41-46 | — |
| `story-39-5-qa-live-gate.test.ts` `afterAll` | :572-576 | — |
| `story-43-1-qa-dw579-process.test.ts` `readEntries` | :88 | — |

- The copy guard is `gate-helper-copies.test.ts` (`REPLACED_NAMES` :21-75).
- **Imports from `scripts/lib`.** `iris-mcp-all` tests import `../../../../scripts/lib/*.mjs` statically (`sdk-confirmation-rig.ts:19-20`). Shared compiles its tests with tsc (`rootDir: src`), so its `.mjs` import needs a `.d.mts`, on the precedent of `packages/client-config/scripts/certify-record.d.mts`.
- **Flake root cause** (CI runs 39819176668 attempt 2 and 39838191935): the SDK's `_dispose` ends stdin and then sends SIGTERM. A loaded child sees EOF first and exits 0, and Node never runs the queued SIGTERM in JavaScript. A probe reproduced it: SDK order 60/60 recorded; SIGTERM 100 ms after EOF, 0/20.

**Live facts behind the release design** (fetched 2026-10-22)
- **npm trusted publishing:**
  - It needs npm ≥ 11.5.1, Node ≥ 22.14 and a GitHub-hosted runner with `id-token: write`. Provenance is automatic for a public repo and package.
  - A configuration needs an existing package, and lapses unless used within 48 h. It is per package (up to 10 each), set with `npm trust github … --file release.yml --env release --allow-publish` (npm ≥ 11.15, 2FA).
  - Configurations created after 2026-09-03 are stage-only unless direct publish is allowed.
- **npm tokens:**
  - Granular write tokens enforce 2FA unless "bypass 2FA" is set, and last 7 days by default (90 at most). Direct publish with a token ends in January 2027.
  - With a token, `--provenance` still needs `id-token: write`, and a new package needs `--access public`.
  - `npm publish <tgz>` runs no package script. `--dry-run` needs no auth but GETs the registry.
- **pnpm 9.15:** `pnpm publish` packs, then runs `npm publish --ignore-scripts <tgz>`. Its `--dry-run` still runs `prepublishOnly`. `-r publish` drops `--provenance`.
- **Changesets:** 2.x `changeset publish` publishes concurrently, not in dependency order. 3.x needs pnpm ≥ 10.
- **GitHub environments:**
  - Required reviewers work on a public Free-plan repository. "Prevent self-review" makes a solo maintainer's release unapprovable. Admin bypass is on by default.
  - Environment secrets reach only jobs that reference the environment, after approval.
  - A tag policy matches `GITHUB_REF`. A `workflow_dispatch` on a tag ref also matches it, hence the `push`-event condition. Dispatch needs the file on the default branch.
  - Today: no environments, no rulesets, no Actions secrets, default token `read`. The remote tag `v0.1.0` → `5b64512` already exists.
- **Artifact actions:** `actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9` (v7.0.2) and `actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333` (v8.0.2). Artifacts are per run.
- **IPM registry (DW-689):**
  - `zpm-registry` reads `raw.githubusercontent.com/<o>/<r>/master/module.xml` for the name and version, and archives the API `default_branch`.
  - The name is locked to its first repository URL, so the repository is permanent. All 564 GitHub records are bare repository roots.
  - The Open Exchange release press is manual and has no API. IPM's `load <url>` git-clones.
- **Extension stores:**
  - `vsce` has no `--dry-run`. `package`/`ls` are offline, and `publish --packagePath <vsix> --skip-duplicate` takes a prebuilt vsix. Global Azure DevOps PATs die 2026-12-01. `--oidc` (vsce 4.0) awaits the Marketplace backend.
  - `ovsx` 1.3.0 has no `--dry-run`. Its first publish needs a PAT, a namespace and the Eclipse agreement.
  - The launcher has `publisher: "TBD-at-publish-time"` and `@vscode/vsce` 3.9.2 in its own `package-lock.json`, and no `ovsx`.

## Tasks & Acceptance

**Execution** (dependency order):

*DW-693 first: the release consumes a green CI.*
- `scripts/lib/audit-lines.mjs` (new) -- `completeAuditLines(text)`, moved unchanged from `process-gate-helpers.ts`. Add `readAuditEntries(file)`, which returns `completeAuditLines(existsSync ? readFileSync : "").map(JSON.parse)`. Its doc comment states the contract: one `${line}\n` per append. Pair it with a hand-written `scripts/lib/audit-lines.d.mts`. -- DW-693.
- `packages/iris-mcp-all/src/__tests__/process-gate-helpers.ts` -- re-export `completeAuditLines` from the new module and delete the local copy. `story-43-1-qa-dw579-process.test.ts:88` imports `readAuditEntries`.
- `scripts/lib/sdk-handler-golden-core.mjs` -- `settledAuditEntries` reads through `completeAuditLines`, so all of its consumers are covered.
- `packages/shared/src/__tests__/test-helpers.ts`:
  - `auditLines` reads through the shared reader.
  - Add an exported `waitForAuditLines(file, min, timeoutMs)`, which replaces the six private `waitForLineCount` copies (Rule 2).
  - `entriesAfterMarker`, `audit.test.ts`'s `readLines`/:362 and the post-stop reads switch to the shared reader.
- `packages/iris-mcp-all/src/__tests__/story-43-4-qa-probe-copy.test.ts`:
  - `events()` and `audit()` use `readAuditEntries`.
  - Replace :168-169 with a `ChildProcess.prototype.kill` spy that records `{pid, signal}` and calls the original, restored in `afterEach`. Assert that SIGTERM was sent to the probe's pid before `open()` resolved, and that the probe's pid is one of `starts()`.
  - Keep "probe gone, serving process up" (:170-171).
- `packages/iris-mcp-all/src/__tests__/story-39-5-qa-live-gate.test.ts` -- its `afterAll` parses through `readAuditEntries`.
- `scripts/lib/audit-reader-scan.mjs` (new) and `packages/iris-mcp-all/src/__tests__/audit-reader-guard.test.ts` (new):
  - **What it flags:** a `readFileSync(…)` whose expression is split on a newline (`"\n"`, `/\n/`, `/\r?\n/`, ternaries included), and a variable from `readFileSync` that is later split, in any comment-stripped test or script file that mentions `audit`.
  - **Scan roots:** `packages/*/src`, `scripts` and `extensions/*/src`, reusing `live-gate-scan.mjs` `testSources` and `script-ts-import-scan.mjs` `stripComments`.
  - **Exceptions:** a kept-list entry (with its reason and a staleness check) for `story-43-3-confirmation-both-eras.test.ts:463`.
  - **Coverage:** a corpus case proves the scan sees shared `test-helpers.ts`, `sdk-handler-golden-core.mjs` and one interop test, and detector self-tests cover each pattern plus negatives.
  - `gate-helper-copies.test.ts` adds `completeAuditLines` and `readAuditEntries` to the never-local names.
- `packages/iris-mcp-all/src/__tests__/audit-lines.test.ts` (new) -- partial last line, blank lines, CRLF, whitespace-only lines, a missing file, and a terminated corrupt line that throws (Rule #58).

*The release.*
- `scripts/lib/release-core.mjs` (new; pure, importable without side effects):
  - **Constants:**
    - `NPM_PUBLISH_ORDER` (the literal AC order);
    - `RELEASE_CHANNELS`: `[{id:'npm',enabled:true},{id:'vscode-marketplace',enabled:false,enabledBy:'Story 42.7'},{id:'open-vsx',enabled:false,enabledBy:'Story 42.7'},{id:'ipm',enabled:false,enabledBy:'Story 42.8'}]`;
    - `RELEASE_ENVIRONMENT='release'`, `RELEASE_TAG_PATTERN='v*'`, `IPM_DIST_REPOSITORY='jbrandtmse/iris-execute-mcp-v2-ipm'` (branch `master`), `RELEASE_CHECK_EXEMPTIONS={'format:check': 'not a CI gate (exempted by ROOT_SCRIPT_EXEMPTIONS in ci-workflow.test.ts)'}`.
  - **Decisions:** `releaseMode(env)`, `ciGateDecision(runs, sha)`, `environmentProblems(env, policies)`, `versionProblems(state, mode)`, `tarballProblems(manifest, sourceManifest, version)`.
  - **Builders:** `npmPublishArgv(tgz, {dryRun})`, `npmUserconfig(token)`, `vsceArgv`/`ovsxArgv(vsix)`, `ipmPushPlan(tree, version, sha)`, `ipmReadme(version)` (no endorsement, AD-28), `releaseReport(results)`.
- `scripts/release.mjs` (new; `isEntryPoint`; exports `ciGate`, `prepare`, `publish` plus `defaultDeps`, on the pattern of `throwaway-iris.mjs`):
  - **`ci-gate`.** Uses `fetch`, `GITHUB_TOKEN`, `GITHUB_API_URL` and `GITHUB_REPOSITORY` to read the CI runs and the environment guard rows of the matrix.
  - **`prepare --out <dir>`.** The consistency checks, then the gate set through the harness (container removed on every exit path), then the artifacts and `release-manifest.json`.
  - **`publish --artifacts <dir> [--dry-run]`.** The rehearse and publish rows.
  - **Output and exits.** Each phase prints a line, and the report is appended to `$GITHUB_STEP_SUMMARY` when set. Exits: 0 pass; 1 a check or upload failed; 2 usage or refusal; 3 no docker; 4 the container did not start.
  - Rationale: AC 42.5.2-42.5.4, DW-387 and DW-675.
- `scripts/ci-package-smoke.mjs` -- `smokePackages` accepts `{tarballs}` and then skips its own packing. With no options its behavior and the CLI are byte-identical.
- `scripts/release-version.mjs` (new), root `package.json` `"version": "node scripts/release-version.mjs"` and `"release": "node scripts/release.mjs"` -- the version-step row. It re-checks with the same `versionProblems` (Rule 2). -- AD-14.
- `scripts/lib/release-checks.mjs` (new) -- `RELEASE_JOBS`, the declared shape of `release.yml`:
  - per job: `needs`, `permissions`, `environment`, `if`, node, `timeout-minutes` (ci-gate 200, prepare 90, rehearse 20, publish 30) and the ordered `uses`/`run` steps;
  - `ARTIFACT_ACTIONS` pins;
  - it imports `PINNED_ACTIONS`, `RUNNER` and `NODE_LEGS` from `ci-checks.mjs`.
  - Before writing a pin, the implement stage re-verifies each new action SHA with a read-only `gh api repos/<action>/git/ref/tags/<tag>`, dereferencing annotated tags.
- `.github/workflows/release.yml` (new) -- exactly `RELEASE_JOBS`:
  - **Workflow level:**
    - `on: push: {tags: ['v*'], branches: ['release-dry-run/**']}` and `workflow_dispatch: {}`;
    - `permissions: {}`;
    - `concurrency: {group: release-${{ github.ref }}, cancel-in-progress: false}`.
  - **Every job:** `ubuntu-24.04`, and checkout with `persist-credentials: false`.
  - **`ci-gate`:** `{actions: read, contents: read}`, `GITHUB_TOKEN: ${{ github.token }}`.
  - **`prepare`:** `{contents: read}`. Steps: pnpm, install, build, launcher `npm ci`, the sysctl reservation of 52791, `prepare --out ${{ runner.temp }}/release-artifacts`, then upload with `if-no-files-found: error`.
  - **`rehearse`:** `{contents: read}`; download, then `publish --dry-run`.
  - **`publish`:**
    - `environment: release`, `{contents: read, id-token: write, actions: read}`;
    - the `if` from Boundaries, and `needs: [ci-gate, prepare, rehearse]`;
    - it runs `publish` with `NPM_TOKEN: ${{ secrets.NPM_TOKEN }}` and `GITHUB_TOKEN: ${{ github.token }}`, and the script re-runs the environment guard before any upload;
    - setup-node takes no `registry-url`.
- `packages/iris-mcp-all/src/__tests__/ci-workflow-check.ts` -- export the pin loop as `actionPinProblems(steps, allowed)`. `ci.yml`'s results are unchanged.
- `packages/iris-mcp-all/src/__tests__/release-workflow-check.ts` and `release-workflow.test.ts` (new) -- hold `release.yml` equal to `RELEASE_JOBS`, and assert:
  - **Triggers:** exactly the declared ones (no `pull_request*`, `workflow_run` or `schedule`), plus the `if` literal.
  - **Exclusivity:** `environment`, `id-token: write` and `secrets.` occur in `publish` only, and `github.token` only in `ci-gate` and `publish`.
  - **Release-script calls:** `publish --dry-run` only in `rehearse`, and bare `publish` only in `publish`.
  - **Pins and hygiene:** every pin is a 40-hex SHA from the allowed set. There is no `continue-on-error`, `|| true`, `npx -y`, `@latest`, or raw publish, push or tag verb in any `run:`.
  - **Repo-wide:** `.github/workflows/` holds exactly `ci.yml` and `release.yml`; no other workflow references `secrets.`; and no `package.json` script holds a publish verb.
  - **Order:** `NPM_PUBLISH_ORDER` equals `publishablePackages()` as a set, and puts each package after its `workspace:*` dependencies. `RELEASE_CHANNELS` order is pinned.
  - A case per check goes red.
- `packages/iris-mcp-all/src/__tests__/release-core.test.ts` (new) -- every pure function against each matrix row.
- `packages/iris-mcp-all/src/__tests__/release-script.test.ts` (new):
  - **Injected-dependency flows** for `ciGate`, `prepare` and `publish`, covering every row.
  - **Stand-ins.** Extend `fake-docker.ts`'s mechanism (Rule 2) into stand-in `npm`, `git`, `vsce` and `ovsx` that record their argv and env.
  - **Scripted runs.** Run `node scripts/release.mjs publish --dry-run` and `publish` with a fixture artifacts directory (synthetic tarballs, manifest and hashes) and the stand-ins as the only `PATH` entries.
  - **Gate set.** Assert, through the scripted docker, that the gate set runs every `prepublish-<short>` suite through `exec`. Assert, through `buildChildEnv`, that the child env holds all five `IRIS_*` plus `IRIS_HTTPS` and `IRIS_REQUIRE_LIVE=1` (DW-675).
  - **Imports.** The static `import` list of `scripts/release.mjs` is exactly `node:` builtins, `release-core.mjs` and `script-process.mjs`, so `ci-gate`, `rehearse` and `publish` run with no `node_modules`.
- `packages/iris-mcp-all/src/__tests__/release-version.test.ts` (new):
  - **Fixture.** The `makeFixture` of `release-1-0-0-mechanism.test.ts` plus the gen-bootstrap scratch inputs. Export both builders into a shared fixture module (Rule 2), `git init` it, and run the REAL `changeset version` there.
  - **First release.** `--first-release` gives 8 packages at `1.0.0`. The marker is `1.0.0+<the fixture's sequence>.<hash>`, and `module.xml` is `1.0.0`. The `.changeset` entries are consumed, and the printed move literal is derived from the generator run (Rule #36).
  - **Refusals.** A missing template, a dirty tree and `npm_command=version` each refuse, with the files unchanged.
- `SECURITY.md` (new):
  - supported versions: the latest `1.x`;
  - reporting through GitHub private vulnerability reporting (Security tab → Report a vulnerability), with no email address;
  - scope: the npm packages, IRIS classes, extension and IPM package;
  - handling: fix-forward, then an advisory, then `npm deprecate` of the affected versions.
- `README.md` -- add `### Releasing` after `### Continuous Integration` (:1088). It covers:
  - the steps: `pnpm run version` (`-- --first-release` once), the root CHANGELOG section naming the move, commit, CI green, tag `v<x.y.z>`, approval in `release`;
  - the four channels and their default states, and the manual Open Exchange release press;
  - the dry run;
  - npm auth (token for 1.0.0, then trusted publishing);
  - the bad-release policy;
  - a link to `SECURITY.md`.
- `CHANGELOG.md` -- a new top section, "Story 42.5: Release Workflow".
  - It names no `BOOTSTRAP_VERSION` move: "does not move".
  - It records no tool, wire or governance change, and that nothing is published.
- `packages/iris-mcp-all/src/__tests__/story-42-5-doc-claims.test.ts` (new) -- pins the Releasing commands, the channel states, the dry-run trigger, the policy, the SECURITY reporting route and the CHANGELOG claims.

**Acceptance Criteria:**
- **AC 42.5.1:**
  - Given `release.yml`, when `release-workflow.test.ts` runs, then:
    - the triggers are exactly `v*` tags, `release-dry-run/**` branches and `workflow_dispatch`;
    - `publish` alone holds `environment: release`, `id-token: write` and `secrets.`, needs all three jobs and runs only on a tag push;
    - and any drift fails, naming the job and key (mutation recorded).
  - Given a sha whose CI runs all failed, or that has no green run by the timeout, when `ci-gate` runs, then it exits 1 and no later job runs. Proven locally, and live by lead checklist 3.
- **AC 42.5.2 / DW-387 / DW-675:**
  - Given a run with the scripted docker, when `prepare` runs, then every package's `prepublishOnly` suite runs exactly once through the harness's `exec`, before any artifact is packed. The child env holds all five `IRIS_*`, `IRIS_HTTPS` and `IRIS_REQUIRE_LIVE=1`.
  - Given a fixture artifacts directory and the stand-in `npm`, when `publish` runs, then the stand-in records one `publish <tgz> --access public --provenance --ignore-scripts` per package, in `NPM_PUBLISH_ORDER`.
  - Given a tarball whose manifest holds `workspace:`, or exports outside its source's `publishConfig.exports`, when `prepare` checks it, then it exits 1 naming the package.
  - Given the repository, when `release-workflow.test.ts` runs, then no workflow `run:` and no `package.json` script holds a publish verb. Only `release-core.mjs`'s argv builders form one.
- **AC 42.5.3:**
  - Given a failure at any package or enabled channel, when `publish` runs, then nothing after it is attempted, the exit is 1, and the report names every package and channel as published, already published, failed, not attempted or skipped.
  - Given the extension and IPM channels disabled, when `publish` runs, then each prints "skipped: not enabled (<story>)".
  - Given all four enabled (stand-ins), when `publish` runs, then the order is npm, Marketplace, Open VSX, IPM.
- **AC 42.5.4:**
  - Given the stand-ins, when `publish --dry-run` runs, then every npm call carries `--dry-run`, `NPM_TOKEN` is never read, and no `vsce`/`ovsx publish`, `git push` or userconfig write happens.
  - Given `release.yml`, when `release-workflow.test.ts` runs, then `rehearse` has no environment, no `id-token` and no secret.
  - Given the story commit on GitHub, when the lead runs checklist 2, then the dry run is green, and `npm view @iris-mcp/shared` still answers E404 afterwards ("proven before the first real run").
- **AD-14 version step:** Given the fixture, when `pnpm run version -- --first-release` runs, then all eight packages are at `1.0.0`, `BOOTSTRAP_VERSION` and `ipm/module.xml` carry it with the sequence and hash unchanged, and `versionProblems` is empty.
- **DW-689:**
  - Given the IPM channel enabled and the stand-in `git`, when `publish` runs, then:
    - it refuses a version the registry already lists;
    - otherwise it pushes the staged tree to `IPM_DIST_REPOSITORY` `master` and tag `v<v>`, with no `--force`;
    - its dry step never pushes.
  - The route and its spine draft are recorded under Design Notes.
- **DW-693:**
  - Given a file ending in a partial line, when any audit reader reads it, then only complete entries return.
  - Given a raw split-and-parse reader reintroduced in any file that mentions audit, when `audit-reader-guard.test.ts` runs, then it fails, naming the file and line.
  - Given the probe exiting on stdin EOF before its listener runs, when the probe-copy test runs, then it stays green. Given a client that sends no SIGTERM, then it goes red.
  - Each fix is proven red once (mutations).

**Review patches (pass 1; grouped by root cause; `[x]` when done):**
- [x] [Review] G1 `scripts/release-version.mjs` + `release-version.test.ts` -- `pnpm run version -- --first-release` hands the script `["--","--first-release"]` under pnpm 9.15.0 (verified), and `main()` refuses it -- drop exactly one leading `--` from argv before parsing (a second `--` or any other argument stays an unknown argument, exit 2). Add a test that runs the REAL `pnpm run version -- --first-release` in the version fixture (spawn `pnpm`, cwd the fixture, `cleanEnv`) and expects exit 0 and all eight at 1.0.0, and a script-level case with argv `["--","--first-release"]`.
- [x] [Review] G2 `scripts/release.mjs` `main()` + `release-prepare.test.ts` -- `main()` registers SIGINT/SIGTERM handlers that call `process.exit` at once, so the handlers `runGateSet` registers later (forwarding the signal to the running gate command) never run on the real path; the "as a real process" tests call `runGateSet` alone -- extract the handler installation into an exported `installSignalHandlers(cleanups, proc = process)` that `main()` calls, whose handler kills `activeChildren`, runs the cleanups, and exits from `setImmediate` (so listeners registered later in the same signal still run); make the real-process driver call it before `runGateSet`, and assert both that the container is removed and that the signal reached the running command.
- [x] [Review] G3 `scripts/lib/release-core.mjs` `ciGateDecision` + `release-core.test.ts` + `release-script-fixtures.ts` -- a green `pull_request` run has `head_sha` = the PR head but built the merge ref, so it can pass the gate while the push run on the tagged commit is red -- count only runs whose `event` is `push` or `workflow_dispatch`; add `event: "push"` to the run fixtures; keep the `@refs/pull/N/merge` path-suffix case (with event push); add cases: a green `pull_request` run alone is `pending`, next to a failed push run it is `red`.
- [x] [Review] G4 `scripts/lib/release-core.mjs` `ipmPushPlan` + `scripts/release.mjs` `dryStep`/`publishIpm` + `release-core.test.ts` + `release-script.test.ts` -- (a) `ls-remote --exit-code ... refs/heads/master` exits 2 on a new empty packaging repository, so the dry step reports "absent or not readable" (verified on a local bare repo); (b) nothing checks that the default branch is `master`; (c) the push is not atomic; (d) the "IPM_DIST_DEPLOY_KEY is not set" text omits the workflow side -- make `lsRemoteArgv` `["ls-remote","--symref",url,"HEAD"]` (exit 0 and empty output is an empty, readable repository; exit non-zero is "absent or not readable"; output `ref: refs/heads/<b>\tHEAD` with `<b>` other than `IPM_DIST_BRANCH` is "not ready: its default branch is <b>, not master, and the registry reads the default branch"); put `--atomic` right after `push` in `pushArgv`; reword the key message to "IPM_DIST_DEPLOY_KEY is not set. Add the deploy key as a release-environment secret, and to the publish step's env in release.yml and scripts/lib/release-checks.mjs." Update the argv pins and add tests: empty repository is ready, default branch `main` is not ready, a failing ls-remote is "absent or not readable".
- [x] [Review] G5 `scripts/release.mjs` `publish()` + `release-script.test.ts` -- a throw inside a channel (for example a file-system error in `publishIpm`) skips `releaseReport`, so published packages go unreported -- catch around `runChannel`, turn it into a `failed` result whose detail is the redacted message, and go on to print the report (exit 1). Add a test whose injected `run` throws on the first `git` call of an enabled IPM channel after eight npm uploads: exit 1, the report names the eight packages as published and the channel as failed.
- [x] [Review] G6 `scripts/release.mjs` `defaultDeps` + test -- `fetch` has no timeout, so a stalled connection holds `ci-gate` until the job budget -- `defaultDeps({ fetchTimeoutMs = 30_000 } = {})` passes `signal: AbortSignal.timeout(fetchTimeoutMs)` unless `init.signal` is set. Test it against a local `node:http` server that never answers, with a 100 ms timeout: the promise rejects.
- [x] [Review] G7 `scripts/release-version.mjs` + `release-version.test.ts` -- (a) `--first-release` copies the template before it resolves `changeset`'s bin and leaves the copy behind when `changeset version` fails; (b) with no pending changeset and no `--first-release` it exits 0 and says to tag a version that is already released -- resolve the bin first; remove the copied `.changeset/release-1-0-0.md` when `changeset version` exits non-zero; refuse (exit 2, before changing anything) with "no changeset is pending. Add one with pnpm changeset, or use --first-release for the first release." Tests: a fixture with the `node_modules` link removed leaves no copy and a clean tree; a fixture with no pending changeset exits 2.
- [x] [Review] G8 `scripts/release.mjs` `releaseCheckScripts` + `release-prepare.test.ts` -- it drops every `:check` script whose name merely starts with `pre` or `post` -- drop only a hook: a name starting with `pre`/`post` whose remainder is itself a script. Test with `prettier:check` (kept), `pregen:x:check` with `gen:x:check` present (dropped) and `postfoo:check` with no `foo:check` (kept).
- [x] [Review] G9 `release-prepare.test.ts`, `release-script.test.ts`, a new `release-smoke-prebuilt.test.ts` -- (a) the `smokePackages({ tarballs })` branch has no test over the real function; (b) the real `loadPrepareModules` never runs; (c) nothing pins that `prepare` calls `pnpmPack(dir, dest)` without `{ ignoreScripts: false }` -- (a) call the real `smokePackages` with `tarballs: []` and expect exit 1 and "no prebuilt tarball was given for this package." for every publishable package with nothing packed, and (on the pattern of `story-42-3-qa-package-smoke-runtime.test.ts`, with its skip conditions and its time budget) one run over tarballs packed by `pnpmPack` into a tmp dir that expects exit 0 and "using the prebuilt tarball of" for all eight and no "packed" line; (b) a test that calls `defaultDeps().loadModules(REPO_ROOT)` and asserts the shapes (`harness.upHarness`, `checks.LIVE_SUITES`, `pack.pnpmPack`, `smoke.smokePackages`, `ipm.stageModule`); (c) make the fake `pack.pnpmPack` record its argument count and assert it is 2.
- [x] [Review] G10 `release-fixture.ts`, `release-version.test.ts` -- the version fixture copies the real manifests, the real pending changesets and the real embed, so the first-release and bump tests `skipIf` the tree is released and derive their expected version from the real changesets (Story 42.6 turns all three into silent skips); `release-version.test.ts` also runs `git commit` without `-c commit.gpgsign=false` -- `makeVersionFixture({ version = "0.0.2" })` seeds all eight manifests at `version`, replaces the pending changesets by one synthetic `patch` changeset naming `@iris-mcp/shared`, and runs `scripts/gen-bootstrap.mjs` in the fixture before the commit so the embed and `ipm/module.xml` start consistent and clean; drop `released`, `hasPending` and the `skipIf`s; expect fixed values (first release 1.0.0; a bump 0.0.3); add a post-release case seeded at `1.0.0` (a patch changeset gives 1.0.1 everywhere, the marker and `module.xml` carry it, `--first-release` is refused and changes nothing); the `git commit` call gets `commit.gpgsign=false`. Leave `makeFixture` and `release-1-0-0-mechanism.test.ts` as they are.
- [x] [Review] G11 `release-workflow.test.ts` -- nothing feeds the `run:` lines of `RELEASE_JOBS` through `parseArgs`, so a flag renamed in both the parser and its tests passes -- for every declared `run` that starts with `node scripts/release.mjs`, substitute `${{ runner.temp }}` and assert `parseArgs` accepts it with the expected command and options (ci-gate: none; prepare: `out`; rehearse: `dryRun: true` and `artifacts`; publish: `dryRun: false` and `artifacts`).
- [x] [Review] G12 `README.md`, `story-42-5-doc-claims.test.ts` -- (a) the README says to approve "in the `release` environment (GitHub, Settings, Environments)", which names where the environment is configured, not where a pending deployment is approved; it has no resume rule; (b) the doc-claims test pins `titles[0]` to the 42.5 CHANGELOG section and the heading after Continuous Integration to `### Releasing`, so the next story's section turns it red -- say that the run page's "Review deployments" button approves the run; add: "If a publish stops part-way, fix the cause and run the release again: versions already on the registry are skipped. If the fix changes a package, release a new patch version." Pin the section by its title and by its position after the 42.4 section (relative order, as the 42.4 doc-claims test does), and `### Releasing` by its position after `### Continuous Integration` (not adjacency).
- [x] [Review] G13 `release-workflow-check.ts`, `release-workflow.test.ts`, `release-script.test.ts` -- (a) the `declared["ci-gate"].node !== RELEASE_NODE.floor` check compares the declaration with the constant it is built from and cannot fail; (b) the workflow-level check (a secret, `github.token` or `id-token` outside the jobs), the release-asset regex and the `ipm` / `gh release` branches of `RAW_VERB` have no red case; (c) the "a reordered list fails the dependency check" fixture duplicates `admin` and drops `client-config`; (d) a `calls("git").every(argv[0] === "ls-remote")` assertion passes with zero git calls -- delete (a); add red cases for (b) (a workflow-level `run-name` -- an allowed key -- that holds `secrets.NPM_TOKEN`, `github.token` or `id-token`, each asserting the "outside the jobs" problem; an `upload-release-asset` step; `ipm publish`; `gh release create`; each pattern first checked against `RAW_VERB`'s source); use a real permutation in (c) (`client-config`, `admin`, `shared`, ...) and assert the violation count; assert at least one git call in (d).
- [x] [Review] G14 spec `## Verification` -- Rule 19 mutation lines are missing for pinning tests of: AC 42.5.2 (the `exports` branch of `tarballProblems`; a publish verb in a workflow `run:` or a `package.json` script; the gate set before packing), AC 42.5.3 (the skipped text of a disabled channel; the channel order), AC 42.5.4 (a dry run that runs a channel publish), AD-14 (the dirty-tree refusal), DW-689 (the dry step never pushes), DW-693 (a scan detector, for example the variable kind; `waitForAuditLines`), the doc claims, and every test added by G1-G13 -- apply each mutation, observe red, revert (the tree byte-identical, checked with `git ls-files -m -o` hashes and `git diff --stat`), and record `mutation: <change> -> <red test>` under the "Recorded mutations" block. Several mutations in different source files may share one test run when each red test is attributed to its own mutation by name.

## Spec Change Log

## Review Triage Log

### 2026-10-22 — Review pass
- verdicts: 44 findings — high 3, medium 14, low 23, false 4, maybe-false 0
- findings:
  - `[high]` `[patch]` BH1 (Blind) G1: pnpm 9.15.0 hands the script `["--","--first-release"]` (probe run by this triage and by 3 layers), so `main()` exits 2 "unknown argument" on the documented `pnpm run version -- --first-release`; no test goes through pnpm — fix in `scripts/release-version.mjs` plus a pnpm-run test (also reported by Edge case as EH1 and by Intent alignment as IA1).
  - `[medium]` `[patch]` BH2 signal handling: `main()`'s SIGINT/SIGTERM handler calls `process.exit` first, so `runGateSet`'s later handlers (forwarding the signal to the running gate command) never run on the real path, and the "real process" tests drive `runGateSet` alone — fix the handler order and drive the real order in the test (G2).
  - `[medium]` `[patch]` BH3 `ciGateDecision` accepts a green `pull_request` run whose `head_sha` equals the tag sha although it built the merge ref — count only `push`/`workflow_dispatch` runs (G3; also EH13).
  - `[low]` `[reject]` BH4 one transient API error ends a 180-minute poll — the matrix row "Non-2xx or a network error: exit 1 (fail closed)" and a pinning test make this specified behavior (by-design).
  - `[low]` `[reject]` BH5 nothing checks `repository.url` before the first upload — all eight manifests are correct today and nothing in the release changes them (wontfix-theoretical).
  - `[low]` `[patch]` BH6 README names Settings, Environments as where to approve, and has no resume step — reword to the run page's review button and add the resume rule (G12).
  - `[low]` `[reject]` BH7 `SECURITY.md` has no timeline, no fallback route and "latest 1.x" before 1.0.0 — all three are decision #79 / the spec's SECURITY bullet (private reporting only, no email, supported = latest 1.x); a response-time promise is the Lead's call (by-design).
  - `[medium]` `[patch]` BH8 the IPM dry step never checks that the packaging repository's default branch is `master` — compare `ls-remote --symref HEAD` (G4; with EH7).
  - `[low]` `[patch]` BH9 the "IPM_DIST_DEPLOY_KEY is not set" text omits that the publish step's `env:` and `release-checks.mjs` also need the key — reword (G4).
  - `[high]` `[patch]` EH1 (Edge) same root cause as G1 (the `--` argv) — grouped with G1.
  - `[low]` `[reject]` EH2 `runCaptured` kills only the direct child on its 30-minute timeout — the job's `timeout-minutes` (20/30/90) ends a hung run first and no release step is skipped silently (wontfix-theoretical).
  - `[low]` `[patch]` EH3 `defaultDeps().fetch` has no timeout, so a stalled connection holds `ci-gate` until the job budget — add a 30 s abort (G6).
  - `[low]` `[reject]` EH4 same as BH4 (transient API error) — by-design, as BH4.
  - `[medium]` `[patch]` EH5 `publish()` has `try/finally` and no `catch`: a throw inside a channel (file-system error in `publishIpm`) skips `releaseReport`, so already-published packages go unreported — catch per channel into a `failed` result (G5).
  - `[low]` `[patch]` EH6 the IPM push is not atomic, so `master` can advance while the tag is rejected and a rerun then fails at `git commit` — add `--atomic` (G4).
  - `[medium]` `[patch]` EH7 `ls-remote --exit-code ... refs/heads/master` exits 2 on a new empty packaging repository, so the dry step reports "absent or not readable" and an enabled IPM channel could never rehearse ready (verified on a local bare repo) — read `ls-remote --symref HEAD` instead (G4).
  - `[low]` `[reject]` EH8 `rehearse`/`publish` have no extension install and no `IPM_DIST_DEPLOY_KEY` env — Boundaries and Consumed-by hand both to Stories 42.7 and 42.8 (by-design).
  - `[low]` `[patch]` EH9 `--first-release` copies the template before it resolves `changeset`'s bin, and leaves it behind when `changeset version` fails — resolve first, remove the copy on failure (G7).
  - `[low]` `[patch]` EH10 `pnpm run version` with no pending changeset and no `--first-release` exits 0 and tells the maintainer to tag a released version — refuse with exit 2 (G7).
  - `[low]` `[patch]` EH11 `releaseCheckScripts` drops any `:check` script whose name merely starts with `pre`/`post` (a future `prettier:check` would never run in `prepare`) — drop only real hooks (G8; with VG13).
  - `[low]` `[reject]` EH12 the audit scan sees only `readFileSync` — the spec names exactly `readFileSync(...)` as what it flags, and the reviewers' spot-check found no other raw reader in the tree (by-design).
  - `[medium]` `[patch]` EH13 same root cause as BH3 — grouped with G3.
  - `[medium]` `[patch]` VG1 the `smokePackages({ tarballs })` branch has no test that runs it (`release-prepare.test.ts` fakes `smokePackages`) — add a test over the real function (G9).
  - `[medium]` `[patch]` VG2 the real `loadPrepareModules` never runs in a test and no assertion pins that `prepare` calls `pnpmPack(dir, dest)` without `{ ignoreScripts: false }` — add both (G9).
  - `[medium]` `[patch]` VG3 the first-release and bump tests skip themselves once the real packages reach 1.0.0, so AD-14's pinning test vanishes in Story 42.6 — the fixture must own its versions (G10).
  - `[medium]` `[patch]` VG4 nothing feeds the `run:` lines of `RELEASE_JOBS` through `parseArgs` — a flag renamed in both places passes (G11).
  - `[medium]` `[patch]` VG5 `story-42-5-doc-claims.test.ts` pins `titles[0]` to the 42.5 CHANGELOG section and the heading after Continuous Integration to `### Releasing`, so the next story's section turns it red (G12).
  - `[low]` `[patch]` VG6 `release-version.test.ts` runs `git commit` without `commit.gpgsign=false` — it depends on the developer's git config (G10).
  - `[medium]` `[patch]` VG7 the version fixture copies the real manifests, the real pending changesets and the real embed, so expected values are derived from tree state the test did not create — seed the fixture (G10; with VG3).
  - `[low]` `[reject]` VG8 `expect(pids).toContain(sigtermPids[0])` follows `toEqual([probe])` with `probe = pids[0]` — the pinning assertion is `toEqual([probe])` (goes red when no SIGTERM is sent, demonstrated); the `toContain` is the spec's literal wording and harmless.
  - `[low]` `[patch]` VG9 the `declared["ci-gate"].node !== RELEASE_NODE.floor` check compares the declaration with the constant it is built from and cannot fail — delete it (G13).
  - `[medium]` `[patch]` VG10 the workflow-level secret / `github.token` / `id-token` check, the release-asset regex and the `ipm` / `gh release` branches of `RAW_VERB` have no red case, against the spec's "a case per check goes red" — add them (G13).
  - `[low]` `[patch]` VG11 a `calls("git").every(argv[0] === "ls-remote")` assertion passes with zero git calls — assert at least one (G13).
  - `[low]` `[patch]` VG12 pinning tests of AC 42.5.2 (exports branch, publish-verb ban), 42.5.3 (skipped text, order), 42.5.4 (a dry run that runs a channel publish), AD-14 (dirty-tree refusal), DW-689 (dry step never pushes), DW-693 (scan detectors) and the patched behavior have no `mutation:` line — demonstrate and record them (G14).
  - `[low]` `[patch]` VG13 same root cause as EH11 — grouped with G8.
  - `[low]` `[reject]` VG14 `StrictHostKeyChecking=accept-new` trusts GitHub's host key on first use on an ephemeral runner — the IPM channel ships disabled; Story 42.8 owns enabling it and may pin host keys (wontfix-accepted, reopen_if the IPM channel is enabled without a pinned host key).
  - `[low]` `[patch]` VG15 the "a reordered list fails the dependency check" fixture is `[admin, shared, admin, ...]` (a duplicate, `client-config` dropped) — use a real permutation (G13).
  - `[high]` `[patch]` IA1 (Intent) D1: the documented `pnpm run version -- --first-release` is refused on the surface a person types — grouped with G1.
  - `[false]` `[reject]` IA2 D2: GitHub's own evaluation of `release.yml` (token read of the environment, artifact hand-off, npm 11.12.1 dry run) is not exercised locally — this is the spec's stated boundary ("the first real run of `release.yml` is the lead's dry run", Residual risks, Verification checklist 2); no defect in the diff, and the reviewer confirmed npm 11.19 skips provenance in a dry run.
  - `[medium]` `[patch]` IA3 D3: the real `prepare` internals (`loadPrepareModules`, the `pnpmPack` call, the `smokePackages` tarballs branch) are faked in `release-prepare.test.ts` — grouped with VG1/VG2 under G9.
  - `[low]` `[reject]` IA4 D4: the stores' dry steps report "not installed" in the shipped jobs because neither job installs the extension — both channels ship disabled and the install step is 42.7's (Consumed-by); same as EH8 (by-design).
  - `[false]` `[reject]` IA5 D5: the audit scan's blind spots are the ones its header states (wrappers, passed-on variables, `.ts` under `scripts/`); the reviewer's spot-check of the tree found no raw audit reader outside the shared reader.
  - `[false]` `[reject]` IA6 D6: the probe-copy test now asserts what the client SENT, as the intent specifies, and keeps "the probe is gone" — not a divergence.
  - `[false]` `[reject]` IA7 D7: the `readAuditEntries` edit in `story-39-5-qa-live-gate.test.ts` sits in a live-armed gate the default suite skips; the spec names exactly this edit (Tasks, DW-693).

## Design Notes

**Governing ADs and conventions (Rule 6):**
- **AD-29:**
  - publishing only from a tagged, CI-green commit, through an approved protected environment, with provenance;
  - secrets only in `release.yml`;
  - the root release script is the only way to publish;
  - every versioned listing is a release step;
  - CI stays secret-free.
- **AD-14:** the version-embedding artifacts and the root `version` script; the IPM archive staged from the embed, never `src/`; the module version equals the npm version.
- **AD-15:** no tool, wire, governance or golden change, so nothing is sanctioned. `smokePackages`' default path and `ci-package-smoke.mjs`'s CLI stay byte-identical.
- **AD-28:** names and the packaging README imply no endorsement.
- **AD-2:** cross-package checks live in `iris-mcp-all` and `scripts/lib`.
- **Conventions:**
  - Live gates (five `IRIS_*`, armed only by `IRIS_REQUIRE_LIVE`);
  - Live testing on a shared instance (throwaways only through the harness; on GitHub runners here);
  - Error text;
  - Turbo test tasks;
  - Stack rows Node, pnpm and `@changesets/cli`;
  - Deferred "Release operations" and "Development toolchain staleness".

**Why this shape:**
- **The gates run in `prepare`, not in `publish`.** The approver then approves a run whose gate set, packing, smoke and rehearsal are already green. The approved job only uploads bytes that `rehearse` already exercised.
- **Uploading with npm.** pnpm 9.15's own publish is "pack, then `npm publish --ignore-scripts <tgz>`" (pnpm source). The release script does the same thing explicitly, so it controls the order, stopping, idempotency and the provenance flag (`pnpm -r publish` drops `--provenance`).
- **One auth path covers both phases.** npm uses OIDC whenever no token userconfig is written. Moving to trusted publishing is then: configure trusted publishers, delete the `NPM_TOKEN` environment secret. No workflow edit is needed.
- **Two layers keep the dry run from publishing.** Its jobs carry no environment, no OIDC and no secret, and the `push`-event condition excludes it from `publish`. That holds even for a dispatch on a tag ref.
- **The environment guard runs before `prepare`.** A tag pushed before the Lead creates a protected `release` environment stops at `ci-gate`. GitHub would otherwise auto-create an unprotected environment when `publish` first referenced it.
- **The script is named `version`**, as AD-14 says, and run as `pnpm run version`. `pnpm version` passes through to `npm version`, which runs a `version` script as a lifecycle hook, so the script refuses when `npm_command=version`.
- **Copies:**
  - The release self-test is a sibling of `ci-workflow-check.ts`, not a widening of it. `workflowProblems` bans secrets, publish and artifacts outright, which is right for `ci.yml`; the release check reuses its exported pin loop and `stripComments`.
  - `release-checks.mjs` reuses `ci-checks.mjs` constants.
  - No sibling release script exists.

**Integration ACs:**
- `release.yml` (consumer) runs `scripts/release.mjs ci-gate|prepare|publish`. The observable effect is the lead's dry run (checklist 2). Locally, the scripted runs in `release-script.test.ts` show the same.
- `prepare` (consumer) drives the harness and `ci-live-suite.mjs`, and each package's `prepublish-gate.mjs` resolves its live target without throwing (DW-675; the dry-run log shows the 8 suites passing).
- `pnpm run version` (consumer) runs `changeset version` and `gen:bootstrap`, and produces a consistent `1.0.0` tree (fixture test, real CLI).
- The `settledAuditEntries`/`auditLines` consumers read through the shared reader; their existing tests stay green.

**Consumes:**
- 42.1: the template, `pnpmPack`, the exports check, `mcpName`;
- 42.2: live targets;
- 42.3: the harness, `ci-live-suite.mjs`, seed, `ci-checks.mjs`, package smoke, the self-test;
- 42.4: `loadEmbed`, `stageModule`, `embedProblems`, the generated manifest.

**Consumed-by:**
- **42.6:**
  - tags `v1.0.0` after `pnpm run version -- --first-release` and the root `1.0.0` section;
  - adds `check:provenance` to `prepare` and proves it and `gen:pack:check` red on that path (DW-612);
  - decides DW-665;
  - uses the first-publish route, then configures trusted publishing.
- **42.7:** enables the Marketplace and Open VSX channels: publisher, auth method, an exact `ovsx` devDependency, and the publish job's install step and secrets.
- **42.8:**
  - enables `ipm` once the packaging repository and deploy key exist;
  - lists it on Open Exchange;
  - adds the MCP Registry as a channel and `server.json` as a version embedder of `version`;
  - holds the deferred registry-path install proof.
- **42.9:** the docs.

**Ledger inbox (Rule 17):**
- **DW-387:** addressed by AC 42.5.2 and the gate-set and tarball tasks. The per-package `prepublishOnly` hooks stay, so a stray manual `pnpm publish` still fails closed without an armed IRIS.
- **DW-675:** addressed by AC 42.5.2 (the harness's `buildChildEnv`, plus the `release-script.test.ts` env assertion).
- **DW-689:** addressed by the IPM channel, `IPM_DIST_REPOSITORY` and Orchestrator decision 2.
- **DW-693:** addressed by the DW-693 tasks and AC.

**Decided at the spec gate (2026-10-22):** all seven recommendations were accepted as written. They are wave-8 orchestrator decisions:
- #75: the npm first-publish route is a short-lived token, then trusted publishing. It stays provisional until the Lead provisions the `release` environment and `NPM_TOKEN`; the fallback is a Lead 2FA publish, recorded as an AD-29 exception.
- #76: IPM goes through the packaging repository `jbrandtmse/iris-execute-mcp-v2-ipm`, which the Lead creates for 42.8.
- #77: `v1.0.0` is npm only.
- #78: a bad release is fixed forward, and a harmful version is `npm deprecate`d, never unpublished.
- #79: `SECURITY.md` points to private vulnerability reporting.
- #80: the gate set re-runs in `prepare`.
- #81: the dry-run trigger is `release-dry-run/**` or a dispatch, never a tag.

The lead wrote the spine drafts: AD-29 (release workflow, npm credentials, channels, bad-release policy), AD-14, the Node, pnpm and `@changesets/cli` Stack rows, and the Deferred entries. `lint_spine.py` is clean. The Lead-only items were asked of the Lead directly on 2026-10-22, because the Planner session is unreachable: the environment (reviewer `jbrandtmse`, prevent self-review OFF, admin bypass OFF, tags `v*`), `NPM_TOKEN`, private vulnerability reporting and the packaging repository. None of them blocks this story; the GitHub dry run and the red branches in the lead checklist need no Lead item, except the `v0.0.2` tag-refusal check, which needs the environment. The implement stage does not edit the spine, never pushes, tags, publishes, or creates environments or secrets.

**Orchestrator decisions needed (as planned):**
1. **Orchestrator decision needed: the npm first-publish route — recommended: (a) a granular access token for 1.0.0, then trusted publishing** because npm cannot configure a trusted publisher on a package that doesn't exist yet. (a) is the only route that gives 1.0.0 provenance through the gated workflow.
   - **The token:** scope `@iris-mcp` read-and-write, bypass 2FA on, at most 7 days. It is a `release`-environment secret named `NPM_TOKEN`.
   - **Within 48 h before the next publish:** run `npm trust github @iris-mcp/<pkg> --file release.yml --repo jbrandtmse/iris-execute-mcp-v2 --env release --allow-publish` for all eight packages. Then delete the secret and set "Require two-factor authentication and disallow tokens".
   - Token publishing ends in January 2027.
   - **Rejected:** (b) a laptop 2FA publish (no provenance, bypasses AD-29), and (c) `npm stage publish` (8 public `0.0.0-stage` placeholders, against D2).
   - **Risk:** npm's docs don't confirm that a token can create a new package in the scope (third-party sources say select the scope). If 42.6's first upload is refused for that reason, fall back to (b) for 1.0.0 only, recorded as an AD-29 exception.
2. **Orchestrator decision needed: the IPM registry route (DW-689) — recommended: a dedicated packaging repository, `jbrandtmse/iris-execute-mcp-v2-ipm`, default branch `master`** because the registry reads only `master/module.xml` and the default-branch root of the listed repository. A `…/tree/<branch>/<dir>` URL can't work, and a root manifest here would make the registry tar the whole monorepo or put stamped copies on `main` (both against AD-14).
   - The release pushes the `stageModule` tree there with a deploy key (`IPM_DIST_DEPLOY_KEY`, a `release`-environment secret).
   - The Open Exchange "Release app" press stays a manual Lead step, listed in the runbook.
   - **The name is permanent:** the registry locks it to its first repository URL.
   - **Rejected:** an `ipm-dist` branch (unreadable by the registry), a stamped root manifest, and ORAS on GHCR (unverified, needs Python in IRIS).
3. **Orchestrator decision needed: which channels the `v1.0.0` run uses — recommended: npm only.** The Marketplace and Open VSX are enabled by 42.7, and IPM by 42.8 once the repository, key and Open Exchange app exist, because none of their credentials exist and 42.7 and 42.8 are scheduled after npm 1.0.0. IPM starts at the next version.
4. **Orchestrator decision needed: the bad-release policy — recommended: fix-forward, with `npm deprecate` for harmful versions,** because `@1` clients receive the fix automatically, and `unpublish` breaks installs and is limited by npm's 72-hour rule.
   - Always fix forward: a new patch through the same workflow.
   - Add `npm deprecate @iris-mcp/<pkg>@<bad> "<reason>; use >=<fixed>"` (a manual Lead step) for a security, data-loss or broken-install defect.
   - Never `unpublish`.
   - For the extension and IPM: publish the fix (no rollback).
5. **Orchestrator decision needed: the `SECURITY.md` channel — recommended: GitHub private vulnerability reporting** because it needs no published email address and keeps the advisory flow on GitHub. The Lead enables the repository setting.
6. **Orchestrator decision needed: run the gate set again in the release (decision #57 already made CI the gate) — recommended: yes, in `prepare`** because AC 42.5.2 ("runs the full gate set once") and DW-675 ask for it. CI measured it at about 16 minutes, and it removes any CI-to-release drift (an expired image key, a different runner).
7. **Orchestrator decision needed: the dry-run trigger — recommended: a push to `release-dry-run/**` plus `workflow_dispatch`, never a tag,** because dispatch works only once the file is on `main`, and a dry-run tag would match the environment's tag policy.

**What the Lead must provide (Lead-only, before 42.6):**
- **The environment `release`:**
  - required reviewer `jbrandtmse`;
  - "Prevent self-review" OFF, or a solo maintainer can never approve;
  - admin bypass OFF;
  - deployment branches and tags: Selected, with exactly one tag rule, `v*`.
- **The `NPM_TOKEN` environment secret** (decision 1).
- **Private vulnerability reporting** turned on (decision 5).
- **Recommended:** a tag ruleset on `v*` that restricts creation, update and deletion to admins.
- **For 42.8:** the packaging repository and its deploy key (decision 2).

**AC reinterpretations:**
1. **AC 42.5.1:** "runs only after CI has passed" means the workflow starts on the tag, but its first job waits for, and requires, a green `ci.yml` run on the sha before any other job runs.
2. **AC 42.5.2, "the full gate set":**
   - CI green on the sha (every CI job);
   - plus every package's `prepublishOnly`, once, armed on a throwaway;
   - plus the release consistency checks (every root `*:check`, generator no-diff, versions equal to the tag).
   - "Publishing must go through pnpm" means pnpm packs (applying `publishConfig` and rewriting `workspace:*`) and npm uploads that tarball, as pnpm itself does.
3. **AC 42.5.3:** the extension and IPM steps are implemented and dry-run here, but ship disabled. They are enabled by 42.7 and 42.8, which add their credentials.
4. **AC 42.5.4:** "proven before the first real run" means the lead's green GitHub dry run (checklist 2). Every tag run also rehearses before approval.

**Spine amendment drafts for the lead (Rule 20):**
- **AD-29 Publishing, append:**
  - "`release.yml` runs `ci-gate` → `prepare` → `rehearse` → `publish`.
  - Only `publish` holds the `release` environment, `id-token: write` and secrets, and only on a `v*` tag push. The dry run (`release-dry-run/**` or a dispatch) cannot reach it.
  - `prepare` runs every `prepublishOnly` once, armed on a seeded IRIS for Health throwaway, before anything is packed. Packing and uploading run no lifecycle script: pnpm packs, and npm 11 uploads with provenance, in the order client-config, shared, admin, data, dev, interop, ops, all, stopping at the first failure.
  - The 1.0.0 publish uses a short-lived environment token, then trusted publishing bound to `release.yml` and `release`.
  - The channels are npm, then the Marketplace, then Open VSX, then IPM, each enabled by its story. IPM reaches the registry through the packaging repository `jbrandtmse/iris-execute-mcp-v2-ipm`, and the Open Exchange release press is a manual release step (Story 42.5)."
- **AD-14 Version-embedding artifacts:** drop "(lands in Story 42.5)" and add: "The root `version` script is run as `pnpm run version` (`-- --first-release` once). It refuses to run as the `npm version` hook."
- **Stack rows:**
  - Node: "the release's `rehearse` and `publish` jobs run 26.0.0 (bundled npm 11.12.1 ≥ 11.5.1)".
  - pnpm: "9.15.0; the release packs with it and npm uploads, so no pnpm upgrade is needed".
  - `@changesets/cli`: "2.30.0, versioning only; `changeset publish` is not used".
- **Deferred:**
  - "Release operations": the bad-release policy, `SECURITY.md` and the first-publish route are decided (decisions 1, 4 and 5).
  - "Development toolchain staleness": the release path pins are recorded; no upgrade is needed.

**Residual risks:**
- Whether the `actions: read` `GITHUB_TOKEN` can read the environment; checklist 2's guard line shows it.
- npm's OIDC-then-token order during the token phase (42.6 shows it).
- The Marketplace auth for GitHub Actions (42.7).

## Verification

Run from `/Users/jbrandt/git/iris-execute-mcp-v2`, one command per foreground call, with `timeout: 600000`. After editing a package's `src/`, rebuild it (`pnpm --filter <pkg> build`); shared's `test-helpers.ts` change needs a shared build before interop type-checks.
- `UNARMED` is `env -u IRIS_HOST -u IRIS_PORT -u IRIS_USERNAME -u IRIS_PASSWORD -u IRIS_NAMESPACE -u IRIS_HTTPS -u IRIS_REQUIRE_LIVE -u IRIS_TEST_HOST -u IRIS_TEST_PORT -u IRIS_THROWAWAY -u NPM_TOKEN -u GITHUB_TOKEN`.
- No stage pushes, tags, triggers CI, runs docker, publishes or calls IRIS. A local `pnpm pack` or `vsce package` goes only into an `os.tmpdir()` directory.

**Commands:**
- `(loop)` `for f in scripts/release.mjs scripts/release-version.mjs scripts/lib/release-core.mjs scripts/lib/release-checks.mjs scripts/lib/audit-lines.mjs scripts/lib/audit-reader-scan.mjs scripts/lib/sdk-handler-golden-core.mjs scripts/ci-package-smoke.mjs; do node --check "$f" || exit 1; done` -- expected: exit 0.
- `(loop)` Run the `@iris-mcp/all` story files -- expected: green.
  ```sh
  UNARMED CI=true pnpm --filter @iris-mcp/all exec vitest run src/__tests__/release-core.test.ts src/__tests__/release-script.test.ts src/__tests__/release-prepare.test.ts src/__tests__/release-workflow.test.ts src/__tests__/release-version.test.ts src/__tests__/release-smoke-prebuilt.test.ts src/__tests__/story-42-5-doc-claims.test.ts src/__tests__/audit-lines.test.ts src/__tests__/audit-reader-guard.test.ts src/__tests__/story-43-4-qa-probe-copy.test.ts src/__tests__/process-gate-helpers.test.ts src/__tests__/gate-helper-copies.test.ts src/__tests__/ci-workflow.test.ts src/__tests__/release-1-0-0-mechanism.test.ts src/__tests__/changelog-bootstrap-move.test.ts src/__tests__/story-42-1-qa-changeset-readers.test.ts
  ```
  The implement stage added `release-prepare.test.ts` (the `prepare` command and the gate set; the spec's `release-script.test.ts` row for `prepare` lives there) and lists `story-42-1-qa-changeset-readers.test.ts`, which runs every test file that mentions `.changeset` (the new ones do) with the pending changesets hidden. Review pass 1 added `release-smoke-prebuilt.test.ts` (the real `smokePackages({ tarballs })` over a synthetic repository of eight packages, offline) and `smoke-repo-fixture.ts`, which holds the synthetic smoke repository that `story-42-3-qa-package-smoke-runtime.test.ts` had inline: it was moved, not copied, so both tests share it.
- `(loop)` `pnpm --filter @iris-mcp/shared build`, then run the shared audit files -- expected: green.
  ```sh
  UNARMED CI=true pnpm --filter @iris-mcp/shared exec vitest run src/__tests__/audit.test.ts src/__tests__/audit-interceptor.test.ts src/__tests__/audit-concurrency-shutdown.test.ts src/__tests__/audit-mixed-outcome-concurrency.test.ts src/__tests__/audit-outcome-derivation.test.ts src/__tests__/audit-outcome-fidelity.test.ts src/__tests__/audit-redaction-interceptor.test.ts src/__tests__/sdk-wire-compat.test.ts src/__tests__/data-policy-server.test.ts src/__tests__/gen-bootstrap-write.test.ts
  ```
- `(loop)` `pnpm --filter @iris-mcp/shared lint && pnpm --filter @iris-mcp/shared type-check && pnpm --filter @iris-mcp/interop type-check` -- expected: 0 warnings, 0 errors.
- `(once)` `UNARMED CI=true pnpm --filter <pkg> test`, one call per package -- expected: green. The packages are shared, client-config, admin, data, dev, interop and ops; run `@iris-mcp/all` as `-- --shard=1/2` and `-- --shard=2/2`. Rule #35 does not apply: no OS %UnitTest runs.
- `(once)` `pnpm lint` and `pnpm type-check` (per package if turbo flakes) -- expected: green.
- `(once)` The root checks -- expected: all OK, the baseline unchanged, and `git diff --stat` naming only this story's files.
  ```sh
  pnpm gen:governance-baseline:check
  pnpm gen:skills:check
  pnpm gen:pack:check
  pnpm validate:prompts
  pnpm check:provenance
  pnpm gen:tools-list-snapshot:check
  node scripts/check-epics-sync.mjs
  pnpm gen:bootstrap
  ```
- `(once)` `UNARMED node scripts/ci-package-smoke.mjs` -- expected: exit 0 (the `smokePackages` default path is unchanged).
- `(once)` Package the launcher into a temp directory -- expected: one `.vsix`, and `vsce ls` lists the files `prepare` records. This mirrors `prepare`'s vsix step locally.
  ```sh
  OUT="$(mktemp -d)"
  cd extensions/iris-mcp-launcher && npm run build && npm run package -- --out "$OUT/" && npm exec -- vsce ls
  ls "$OUT"; rm -rf "$OUT"
  ```
  The package step runs inside the extension's directory, as `prepare` does: `npm --prefix extensions/iris-mcp-launcher exec -- vsce package` runs `vsce` from the repository root, whose manifest has no `engines.vscode`, and fails.

**Shared surfaces:**
- root `package.json` scripts (`version`, `release`; Rule #56 test);
- the `.github/workflows/` file set;
- `ci-workflow-check.ts` exports;
- the exports of `process-gate-helpers.ts` (`completeAuditLines`) and shared `test-helpers.ts` (`auditLines`, `waitForAuditLines`);
- `gate-helper-copies.test.ts` `REPLACED_NAMES`;
- `smokePackages`' options;
- the README `## Contributing` subsections (the `ci-workflow.test.ts` README pin);
- the CHANGELOG top section (`changelog-bootstrap-move.test.ts`, `story-42-1-qa-records.test.ts`).

No changeset is added. Every test added or changed passes on a fresh environment, in either order, and creates and removes its own temp fixtures. No check mutates the shared IRIS, so no `ExecuteMCPv2.Temp.*` fixture is used.

**Mutations (Rule 19):** apply each, observe red, revert, and confirm `git status --short` and `git diff --stat` are unchanged. Record each as `mutation: <change> → <red test>`.
- **AC 42.5.1:**
  - give `rehearse` `id-token: write` → `release-workflow.test.ts`;
  - drop the publish job's `push` clause → same;
  - make `ciGateDecision` accept `failure` → `release-core.test.ts`.
- **AC 42.5.2:**
  - skip one prepublish suite in `prepare` → `release-script.test.ts`;
  - drop `--ignore-scripts` → same;
  - reorder `NPM_PUBLISH_ORDER` → `release-workflow.test.ts`;
  - let `tarballProblems` pass `workspace:` → `release-core.test.ts`;
  - run one prepublish suite directly instead of through the harness's `exec` (so it has no `IRIS_*`) → `release-script.test.ts`.
- **AC 42.5.3:** continue after a failed package → `release-script.test.ts`.
- **AC 42.5.4:**
  - omit `--dry-run` on one npm call → the scripted dry run;
  - read `NPM_TOKEN` in dry-run → same.
- **AD-14:** skip `gen:bootstrap` in the version script → `release-version.test.ts`.
- **DW-693:**
  - `completeAuditLines` returning the partial line → `audit-lines.test.ts` and `process-gate-helpers.test.ts`;
  - a raw reader put back in `test-helpers.ts` → `audit-reader-guard.test.ts`;
  - the client teardown sending no SIGTERM (an own-property `_dispose` replacement; never edit `node_modules`) → `story-43-4-qa-probe-copy.test.ts`.
  - Also show the old :169 assertion red, and the new one green, with the real SIGTERM delayed 100 ms.

**Recorded mutations** (implement stage, 2026-10-22). Each was applied to the file named, the named tests went red, the file was restored, and the tree (`git ls-files -m -o` hashes plus `git diff --stat`) was byte-identical afterwards. The mutation helper kept its backup outside the repository. Test names are shortened. Review pass 1 (2026-10-22) added the lines tagged (G<n>), re-ran the AD-14 line (its test names changed), and checked every restore the same way: the hash of the tree was identical before and after each run, and each restored file is `cmp`-identical to its backup. Mutations in different files shared a run only where each red test belongs to one mutation by name.
- AC 42.5.1:
  - mutation: `rehearse` given `id-token: write` in `release.yml` → `release-workflow.test.ts` (7 red: "fails on rehearse given id-token: write", "the real release.yml has no problem", "publish alone holds the environment, the OIDC permission and the secret", "rehearse has no environment, no id-token permission and no secret", and 3 more).
  - mutation: the `push` clause dropped from the `publish` job's `if` in `release.yml` → `release-workflow.test.ts` (5 red: "fails on publish without its push clause", "fails on publish without its condition", "the real release.yml has no problem", "publish alone holds ...", "a word that only appears in a comment ...").
  - mutation: `ciGateDecision` accepts `failure` as a green run (`scripts/lib/release-core.mjs`) → `release-core.test.ts` (4 red: "every run completed and none succeeded is red", "a conclusion other than success never passes", "a failed run next to one still going is pending", "a success on another sha, or of another workflow, does not count").
  - mutation: `ciGate` returns 0 on a red CI (`scripts/release.mjs`) → `release-script.test.ts` (3 red: "red: every run completed and none succeeded exits 1 at once", "a dry run still fails when CI is red", "ci-gate as a real process: green exits 0, red exits 1").
  - mutation: `environmentProblems` ignores `can_admins_bypass` → `release-core.test.ts` and `release-script.test.ts` (5 red, among them "a tag run with the environment unprotected (admin bypass) exits 1 before it reads CI" and "the environment guard failing on re-check (unprotected) is refused").
  - (G3) mutation: the event filter removed from `ciGateDecision` (a run of any event counts) → `release-core.test.ts` (2 red: "a push and a workflow_dispatch run count; a run of any other event never does", "a green pull_request run on the sha (it built the merge ref) is pending alone, and red next to a failed push run") and `release-script.test.ts` (1 red: "a green pull-request run on the sha (it built the merge ref) does not pass the gate: alone it waits out the timeout, next to a failed push run it is red at once").
  - (G6) mutation: `defaultDeps().fetch` passes no timeout signal → `release-script.test.ts` (3 red: "defaultDeps().fetch aborts a request that is never answered after fetchTimeoutMs: the promise rejects", "ci-gate over a GitHub API that stalls exits 1 and says the CI runs could not be read", "the default timeout is 30 seconds, added to a request that has no signal and not to one that has"; the test that gives a request its own signal stays green).
  - (G6) mutation: `defaultDeps().fetch` sets its own timeout signal over the caller's → `release-script.test.ts` (2 red: "a request that is given its own signal keeps it: the default timeout is not added over it", "the default timeout is 30 seconds, added to a request that has no signal and not to one that has"). It ran with the two DW-689 (G4) mutations below that name this run, 5 red in all.
  - (G11) mutation: the `--out` flag renamed `--output` in `parseArgs` AND in its own unit test, the case that a parser test alone cannot see → `release-workflow.test.ts` (1 red, the only one over `release-script.test.ts`, `release-prepare.test.ts` and `release-workflow.test.ts`: "parseArgs accepts each with the command and options the job stands for: ci-gate none, prepare --out, rehearse --dry-run --artifacts, publish --artifacts").
  - (G13) mutation: the workflow-level check (a secret, `github.token` or `id-token` outside the jobs) disabled in `release-workflow-check.ts` → `release-workflow.test.ts` (3 red: "fails on a secret named at the workflow level", "fails on github.token named at the workflow level", "fails on id-token named at the workflow level").
  - (G13) four more mutations, applied with the one above in one run of `release-workflow.test.ts`, each with its own red test: the release-asset pattern replaced by one that never matches → "fails on a release asset step"; the `ipm` branch of `RAW_VERB` removed → "fails on a raw ipm publish"; the `gh release` branch of `RAW_VERB` removed → "fails on a raw gh release create"; the test's own dependency detector reversed (`> index` to `< index`) → "a reordered list fails the dependency check (the detector can fail)". Seven red in all.
- AC 42.5.2:
  - mutation: one prepublish suite skipped in `prepare` (`ops` filtered out of `suiteIds`) → `release-prepare.test.ts` (4 red: "a healthy dry run: up, the seed, the eight prepublish suites in publish order, down; then ...", "the command of each suite is the CI registry's ...", "every exec'd command gets all five IRIS_* variables ...", "a suite id that the CI registry does not know ...").
  - mutation: `--ignore-scripts` dropped from `npmPublishArgv` → `release-core.test.ts` and `release-script.test.ts` (5 red: "npmPublishArgv is publish <tgz> --access public --provenance --ignore-scripts, in that order", "one `publish <tgz> --access public --provenance --ignore-scripts` per package, in NPM_PUBLISH_ORDER", the dry-run publish tests, ...).
  - mutation: `@iris-mcp/shared` and `@iris-mcp/admin` swapped in `NPM_PUBLISH_ORDER` → `release-workflow.test.ts` (3 red: "NPM_PUBLISH_ORDER is exactly client-config, shared, admin, ...", "every package follows its workspace:* dependencies", "a reordered list fails the dependency check").
  - mutation: `tarballProblems` ignores a `workspace:` specifier → `release-core.test.ts` ("a tarball that still holds workspace: is a problem in every dependency field") and `release-prepare.test.ts` ("a tarball that still holds workspace: is exit 1 naming the package").
  - mutation: the `prepublish-dev` suite run through `harnessDeps.runCommand` directly, outside the harness's `exec`, so it has no `IRIS_*` → `release-prepare.test.ts` (1 red: "every exec'd command gets all five IRIS_* variables, IRIS_HTTPS and IRIS_REQUIRE_LIVE=1 from the harness's own buildChildEnv ...").
  - mutation: `publishRefusals` skips the `GITHUB_SHA` check → `release-core.test.ts` and `release-script.test.ts` (2 red: "each condition is refused by name ...", "GITHUB_SHA is not the prepared sha: exit 2 ...").
  - mutation: the cleanup that deletes the token userconfig removed from `publish` → `release-script.test.ts` (4 red: "NPM_TOKEN set: a 0600 userconfig holds the token ... it is gone afterwards", "the userconfig is deleted when an upload fails, too", "publish (real mode) with the token ...", "a SIGTERM during an upload ends the script ... and deletes the userconfig").
  - (G14) mutation: the `exports` check of `tarballProblems` disabled → `release-core.test.ts` (3 red: "exports outside the source's publishConfig.exports are a problem: ...", "a package with no publishConfig is held to its own exports, and a package with none to none", "reports every problem of a tarball at once") and `release-prepare.test.ts` (1 red: "a tarball whose exports are not the source's publishConfig.exports is exit 1 naming the package").
  - (G14) mutation: `&& npm publish` appended to a `run:` of the real `.github/workflows/release.yml` → `release-workflow.test.ts` (2 red: "the real release.yml has no problem", "a word that only appears in a comment is not a finding").
  - (G14) mutation: `publish` removed from the verb group of the workflow check's `RAW_VERB`, and (in the same run, a different test) a root script `"publish:all": "npm publish"` added to `package.json` → `release-workflow.test.ts` (3 red: "fails on a raw npm publish" and "fails on a raw pnpm publish" for the first; "no package.json script holds a publish, push or tag verb" for the second).
  - (G14) mutation: a red gate set no longer stops `prepare` (`if (code !== 0) return code;` replaced by a log line) → `release-prepare.test.ts` (4 red: "a red suite stops the gate set after `down`: exit 1, the later suites do not run, nothing is packed, the container is removed", "a failing seed stops before any suite", "no docker on PATH is exit 3 and nothing is packed; ...", "the lines of the run are appended to the step summary, whatever the exit code"); and, in the same run, one package packed before the gate set starts → `release-prepare.test.ts` (2 red: "a healthy dry run: up, the seed, the eight prepublish suites in publish order, down; then ...", "prepare packs with pnpmPack(dir, dest) and no third argument: ...").
  - (G9) mutation: `prepare` passes `{ ignoreScripts: false }` to `pnpmPack` → `release-prepare.test.ts` (1 red: "prepare packs with pnpmPack(dir, dest) and no third argument: lifecycle scripts stay ignored ...").
  - (G9) mutation: the packer's module path wrong in `loadPrepareModules` → `release-prepare.test.ts` (1 red: "loads the five modules from the repository root, with every member that prepare and runGateSet call") and `release-script.test.ts` (1 red: "every module that only prepare needs is loaded by a dynamic import() inside prepare's loader, and nowhere else").
  - (G9) mutation: `smokePackages` ignores its `tarballs` (`prebuilt === undefined` replaced by `true`, so it always packs) → `release-smoke-prebuilt.test.ts` (3 red: "with no prebuilt tarball it fails (exit 1) naming every package, and packs nothing and installs nothing", "a package that is missing from the list fails the smoke by name, while the seven others are used", "with the eight tarballs it exits 0, uses each prebuilt tarball, packs none, starts every bin and removes its temporary directories"); `story-42-3-qa-package-smoke-runtime.test.ts` stays green.
  - (G8) mutation: `releaseCheckScripts` drops every `:check` name that starts with `pre` or `post` → `release-prepare.test.ts` (2 red: "releaseCheckScripts drops only a lifecycle hook: a pre/post name whose remainder is itself a script", "a root script like prettier:check, which merely starts with pre, runs in prepare; its neighbours' hooks do not"). The G5, G6, G8 and G9 mutations of `scripts/release.mjs` shared one run of `release-script.test.ts` and `release-prepare.test.ts` (9 red in all, each attributed above).
  - (G2) mutation: `installSignalHandlers` ends the process at once (`proc.exit(code)` in place of `setImmediate(() => proc.exit(code))`) → `release-prepare.test.ts` (2 red: "as a real process: SIGTERM during a command removes the container, reaches the command and exits 143; SIGINT does the same and exits 130", "a signal runs the cleanups and ends the process from setImmediate, so a listener registered later for the same signal still runs before it ends") and `release-script.test.ts` (1 red: "main() installs its signal handlers through installSignalHandlers and ends no run itself, ...").
  - (G2) mutation: the handler no longer kills `activeChildren`, and (same run) `main()` registers its own SIGTERM handler in place of `installSignalHandlers` → `release-prepare.test.ts` (1 red: "a signal kills the child processes that runCaptured started, and the exit handler runs the cleanups once") and `release-script.test.ts` (1 red: "main() installs its signal handlers through installSignalHandlers and ends no run itself, ...").
  - (G5) mutation: the `catch` around `runChannel` in `publish` removed → `release-script.test.ts` (1 red: "a throw inside the channel (a file-system error) after eight uploads is a failed channel: the report still names the eight packages as published, exit 1, the message redacted").
- AC 42.5.3:
  - mutation: `publish` continues after a failed package (the `failed` check of the npm loop turned off) → `release-script.test.ts` (4 red: "the first failure stops everything after it ...", "a registry check that fails for another reason than a 404 stops the release ...", "a package whose npm publish exits 1 after an earlier success is reported ...", "a failing dry-run publish fails the rehearsal and stops after it").
  - (G14) mutation: the text of a disabled channel changed to `skipped (<story>)` in `skippedText` → `release-core.test.ts` (2 red: "the statuses are the five of the acceptance criteria", "names every package and channel with its status, grouped by channel, in the order given") and `release-script.test.ts` (5 red, among them "the extension and IPM channels are disabled: each prints `skipped: not enabled (<story>)`, and no store CLI and no git runs" and "every disabled channel runs its dry step and reports its readiness: ...").
  - (G14) mutation: `vscode-marketplace` and `open-vsx` swapped in `RELEASE_CHANNELS` → `release-workflow.test.ts` ("the channels are npm, then the Marketplace, Open VSX and IPM; only npm is enabled, ..."), `release-core.test.ts` ("the constants name the order, the channels, ..."), `release-script.test.ts` (4 red, among them "all four enabled: the order is npm, the Marketplace, Open VSX, IPM; vsce and ovsx run from the extension's node_modules/.bin on the vsix") and `release-prepare.test.ts` ("eight tarballs in publish order, the vsix with its file list, ...").
- AC 42.5.4:
  - mutation: `--dry-run` omitted on the `@iris-mcp/ops` call of `npmPublishArgv` → `release-script.test.ts` (3 red: the in-process dry run, "every npm publish call carries --dry-run ...", and the scripted `publish --dry-run`).
  - mutation: `NPM_TOKEN` read in a dry run (the `dryRun` branch of the auth step removed, so the token userconfig is written) → `release-script.test.ts` (2 red: "one `npm publish <tgz> ... --dry-run` per package, in order; NPM_TOKEN is never read ...", and the scripted `publish --dry-run`).
  - (G14) mutation: a dry run runs a channel's upload (the `if (dryRun)` of `runChannel` turned off) → `release-script.test.ts` (6 red, among them "every npm publish call carries --dry-run, and a dry run with every channel enabled runs no vsce or ovsx publish, no git push and no commit" and "an enabled channel whose dry step fails fails the rehearsal (exit 1); a disabled channel's problems are `not ready` only").
- AD-14:
  - mutation: `gen-bootstrap.mjs` skipped in `scripts/release-version.mjs` (re-run in review pass 1, the test names having changed) → `release-version.test.ts` (6 red: "lands all eight packages on 1.0.0; the marker, the two stamped parameters and ipm/module.xml carry it ...", "every package moves from 0.0.2 to one shared version, 0.0.3 (never 1.0.0), and the marker, the stamps and ipm/module.xml carry it", "a patch changeset moves every package to 1.0.1, and the marker, the stamps and ipm/module.xml carry it", "a first release needs no pending changeset of its own: the template is the changeset", "the documented command, the real `pnpm run version -- --first-release`, ...", "the script drops one leading `--`: ...").
  - (G14) mutation: the dirty-tree refusal removed from `scripts/release-version.mjs` → `release-version.test.ts` (2 red: "on a dirty tree: exit 2 naming the changed file, and nothing is versioned", "an untracked file also makes the tree dirty").
  - (G1) mutation: the leading `--` is not dropped from the arguments → `release-version.test.ts` (2 red: "the documented command, the real `pnpm run version -- --first-release`, reaches the script as [--, --first-release] and lands all eight packages on 1.0.0", "the script drops one leading `--`: [--, --first-release] versions the first release, and [--] alone versions the pending changeset").
  - (G7) mutation: the copied template is not removed when `changeset version` fails → `release-version.test.ts` (1 red: "when `changeset version` itself fails (exit 1), the copied template is removed again and the tree is clean").
  - (G7) mutation: the bin of `@changesets/cli` is resolved after the template is copied → `release-version.test.ts` (1 red: "without node_modules/@changesets/cli it refuses (exit 2) before the copy: no .changeset/release-1-0-0.md, a clean tree").
  - (G7) mutation: the refusal for no pending changeset removed → `release-version.test.ts` (1 red: "with no changeset pending and no --first-release: exit 2 before it changes anything, and no next steps are printed").
  - (G10) mutation: the check for a package already at 1.0.0 made `> 0` instead of `>= 0` → `release-version.test.ts` (2 red: "--first-release is refused (exit 2) naming the packages already at 1.0.0, and nothing changes", "--first-release when one package is already at 1.0.0: exit 2, and nothing changes"). The six mutations of `scripts/release-version.mjs` from the dirty-tree line to this one ran together (9 red), each red test belonging to one.
  - (G10) control, not a mutation of the code: with the real tree changed (`@iris-mcp/client-config` at 0.0.7, `@iris-mcp/shared` at 0.0.9 and a real pending minor changeset) `release-version.test.ts` stays green (18 of 18), so the fixture owns its versions, changesets and embed. Dropping `commit.gpgsign=false` from the fixture's `git` call, with signing forced by `GIT_CONFIG_*` and an unusable `gpg.program`, turns it red (17 of 18, the fixture cannot be committed); with the call intact and signing forced it is green (18 of 18).
- DW-689:
  - mutation: `--force` added to `ipmPushPlan`'s push → `release-core.test.ts` and `release-script.test.ts` ("ipmPushPlan clones, replaces the tree, commits ... with no force" and "otherwise it clones with the deploy key ... never with force").
  - mutation: the registry's "already lists the version" refusal removed from the IPM channel → `release-script.test.ts` ("a version the registry already lists is refused (exit 1) with no git call at all").
  - (G14) mutation: the dry step asks the packaging repository with the push argv (`.pushArgv` in place of `.lsRemoteArgv`) → `release-script.test.ts` (6 red, among them "every npm publish call carries --dry-run, and a dry run with every channel enabled runs no vsce or ovsx publish, no git push and no commit" and "every disabled channel runs its dry step and reports its readiness: ...").
  - (G4) mutation: `lsRemoteArgv` back to `ls-remote --exit-code <url> refs/heads/master`, and (same run) `--atomic` dropped from `pushArgv` → `release-core.test.ts` ("the ls-remote asks for HEAD with its symref, ..." for the first, "the push is atomic: ..." for the second, and "ipmPushPlan clones, replaces the tree, ..." for both) and `release-script.test.ts` ("an empty repository is ready: ..." and "every disabled channel runs its dry step ..." for the first, "otherwise it clones with the deploy key, ... never with force" for the second).
  - (G4) mutation: the default-branch check of the IPM dry step disabled (same run) → `release-script.test.ts` (2 red: "a default branch other than master is not ready, and an enabled IPM channel fails the rehearsal on it (exit 1)", "an unreadable registry and a wrong default branch are both reported").
  - (G4) mutation: the deploy-key message back to "Add the deploy key to the release environment." (same run) → `release-script.test.ts` (1 red: "a missing deploy key, a failing clone and a failing push are failures that name the step"). The four mutations of this run produced 9 red tests in all.
  - (G4) mutation: the `remote.status !== 0` reason ("absent or not readable") of the IPM dry step disabled → `release-script.test.ts` (2 red: "a failing ls-remote is `absent or not readable`, in both a disabled and an enabled channel", "every disabled channel runs its dry step and reports its readiness: ..."); and, in the same run as the G6 line above, any symref counted as a wrong default branch (`branch !== undefined`) → `release-script.test.ts` (1 red: "a repository whose default branch is master is ready").
  - (G13) mutation: the IPM dry step makes no `git` call at all (`remote` fixed to a success with no output) → `release-script.test.ts`, run on its own test: red on the new assertion of "every npm publish call carries --dry-run, and a dry run with every channel enabled runs no vsce or ovsx publish, no git push and no commit", "the IPM dry step did ask the packaging repository: expected 0 to be greater than 0" (the `.every(...)` it had passed with zero calls).
- DW-693:
  - mutation: `completeAuditLines` returns the partial last line (`scripts/lib/audit-lines.mjs`) → `audit-lines.test.ts` and `process-gate-helpers.test.ts` (13 red, among them "is empty for an empty text and for a text with no newline", "returns the newline-terminated lines in order and leaves a trailing partial line out", and the `pollAuditEntries` and `settledAuditCount` partial-line tests).
  - mutation: a raw split-and-parse reader put back into `packages/shared/src/__tests__/test-helpers.ts` → `audit-reader-guard.test.ts` (2 red: "every test and script that mentions audit reads its file through scripts/lib/audit-lines.mjs ..." naming the file and line, and "reports a raw reader that is put back into the real shared test helper").
  - mutation: the client's teardown sends no SIGTERM (`StdioClientTransport.prototype._dispose` replaced from the test; `node_modules` untouched) → `story-43-4-qa-probe-copy.test.ts` (2 red: the `pinned 2026-07-28` and `auto` probe tests, "the client sent SIGTERM to the probe, and to nothing else, before open() resolved").
  - mutation: the same replacement, with the SIGTERM sent 100 ms after the EOF → the new `story-43-4-qa-probe-copy.test.ts` stays green (5 of 5), and the OLD test (HEAD's file with the same replacement, run as a temporary file that was then deleted) is red on its `:169` assertion in both probe tests ("the first process, the probe, got SIGTERM: expected [] to include <pid>").
  - (G14) mutation: the variable kind of the audit-reader scan disabled in `scripts/lib/audit-reader-scan.mjs` → `audit-reader-guard.test.ts` (3 red: "names the kind: a call that holds readFileSync is direct, a variable the nearest declaration initializes from one is a variable", "reports a variable that holds the file text, at its line", "reports a variable that is trimmed first, at its line").
  - (G14) mutation: `waitForAuditLines` of `packages/shared/src/__tests__/test-helpers.ts` returns at once (`entries.length >= 0`) → the six shared audit files that call it (28 red, among them "AC 29.0.4 (positive): IRIS_AUDIT_LOG set -> exactly one entry line after the header" of `audit-interceptor.test.ts` and "N (>=20) concurrent handleToolCalls produce well-formed, non-interleaved ..." of `audit-concurrency-shutdown.test.ts`).
- Doc claims (G12, G14):
  - mutation: five edits to the documents, in one run of `story-42-5-doc-claims.test.ts`, each with its own red test (5 red): README step 5 back to "(GitHub, Settings, Environments)" → "says where the approval is given: the run page's Review deployments button, not the page that configures the environment"; the README paragraph "A publish that stops part-way" removed → "says what to do when a publish stops part-way: run the release again, and release a new patch version if the fix changes a package"; README step 4 changed to "Tag the commit `vX`" → "gives the steps with their commands: the version step, the first-release flag, the CHANGELOG section, CI green, the tag, the approval"; CHANGELOG "Nothing is published" changed to "Something is published" → "says nothing is published and no changeset is added, with no tool, wire or governance change, and that BOOTSTRAP_VERSION does not move"; SECURITY.md "No email address is published" changed to "An email address is published" → "names the supported versions, and reports through GitHub private vulnerability reporting with no email address".
  - control, not a mutation of the code: a later `###` subsection between `### Continuous Integration` and `### Releasing`, and a later story's section above Story 42.5's in `CHANGELOG.md`, leave `story-42-5-doc-claims.test.ts` green (16 of 16), so the two position pins are relative.

**Implement-stage notes** (for the review and the lead):
- *A dry run packs each package at the version it has today.* The matrix says each tarball carries "the release version", and "in a dry run, one shared version", but today `client-config` is `0.0.1` and the rest `0.0.2`, and checklist 2 expects `prepare` green with 8 tarballs. So a tag run checks every tarball and every internal dependency against the tag version; a dry run checks each tarball against its own source version (`tarballProblems`' optional `dependencyVersions`). The dry run's manifest records the shared package's version at the top and each package's own version in the npm channel. The real `pnpm pack` output of the current tree was checked this way (all 8 pass).
- *Additions beyond the Code Map:* `release-prepare.test.ts` (the `prepare` and gate-set rows, split from `release-script.test.ts` for size), `release-script-fixtures.ts`, `stand-in-clis.ts` and `release-fixture.ts` (test helpers; the last holds the moved `makeFixture` of the 42.1 mechanism test, plus the version-step fixture), `packages/shared/src/__tests__/gen-bootstrap-scratch.ts` (the shared builder of the generator's scratch inputs, now used by `gen-bootstrap-write.test.ts`), and a `lexSource` export in `scripts/lib/script-ts-import-scan.mjs` (its `lex`, unchanged, so the audit scan can ignore text inside literals). `ci-gate` also refuses a `v*` tag that is not `v<MAJOR.MINOR.PATCH>` (exit 2), so an approver is never asked to approve a run that `publish` would refuse. `ci-gate` and `prepare` append their lines to `$GITHUB_STEP_SUMMARY` too.
- *The container teardown is not shared with `ci-ipm-archive.mjs`.* That script's cleanup is entangled with its three containers and its temporary root; `runGateSet` has one container and uses the harness's own `createTeardown`, so a copy of the pattern would only have duplicated it.
- *Read-only facts checked live (2026-10-22):* `actions/upload-artifact` `v7.0.2` is `cf430e03…` and `actions/download-artifact` `v8.0.2` is `9000827c…` (both lightweight tags on commits, `gh api repos/<action>/git/ref/tags/<tag>`); the IPM registry answers `GET /packages/<name>` with `{name, version, versions[], …}` and 404 for an unregistered name (`ipmRegistryListsVersion` reads both fields); `npm publish --dry-run --provenance` only generates provenance when it is not a dry run (npm 11.19 `libnpmpublish`), so the rehearsal needs no OIDC token; `vsce package --out <dir>/` and `vsce ls` work offline from the extension (`npm run package -- --out <dir>/`).
- *Not done by this stage (lead checklist):* the GitHub dry run, the red branches and the `v0.0.2` tag refusal. No docker was started, no image pulled and no container left; `prepare`'s gate set ran only against the scripted docker.
- *Residual risks the dry run will show:* whether the `actions: read` token can read the `release` environment (the guard line says); whether `git status --porcelain` is empty after `pnpm build` and `pnpm run gen:bootstrap` on the runner; `npm run build` and `npm run package` in the launcher on the runner; `npm view` of a never-published package answering `E404` (the script treats that, and `is not in this registry`, as "not published").

**Lead checklist** (at the smoke; stages do none of it). Record each run URL.
1. Push the story commit to `origin/epic42`. CI is green.
2. **Dry run.**
   - Run `git push origin <sha>:refs/heads/release-dry-run/42-5`.
   - Expected in the release run:
     - `ci-gate` passes and prints the environment guard line ("missing … a tag run stops here" until the Lead creates it);
     - `prepare` is green, with 8 prepublish suites armed, 8 tarballs, the smoke, the vsix and the IPM tree;
     - `rehearse` shows 8 `npm publish --dry-run` lines in order, and the three other channels "skipped: not enabled" with their readiness;
     - `publish` is skipped, and no environment deployment is requested.
   - Then `npm view @iris-mcp/shared` still answers E404. Delete the branch.
3. **CI-gate red.** Push a commit on top that breaks one default-suite test to `release-dry-run/42-5-red-ci`. CI is red, the release's `ci-gate` is red naming that run, and nothing after it runs. Delete the branch.
4. **Self-test red.** On a branch `red/42-5-release-selftest` (no dry-run trigger), give `rehearse` `id-token: write`. CI `gates` is red at `release-workflow.test.ts`. Delete the branch.
5. **Guard red.** On a branch `red/42-5-audit-guard`, add a raw split-and-parse audit reader to one test. CI `gates` is red at `audit-reader-guard.test.ts`. Delete the branch.
6. **After the Lead creates `release`:**
   - Repeat 2. The guard line says "protected (required reviewers: jbrandtmse; admin bypass off; tags v*)".
   - Then push tag `v0.0.2` at the story sha. Expected: `ci-gate` passes, `prepare` is red at the tag consistency check (client-config is `0.0.1`, and changesets are pending), and no approval is requested.
   - Delete the tag (`git push --delete origin v0.0.2`).

## Auto Run Result

Status: done
Blocking condition: none

**Summary.** Story 42.5 is implemented and nothing was published, tagged, pushed or versioned on the real tree.
- `.github/workflows/release.yml` runs `ci-gate`, `prepare`, `rehearse` and `publish`. Only `publish` holds the `release` environment, `id-token: write` and `secrets.`, and only on a `push` of a `v*` tag. A `release-dry-run/**` push or a dispatch runs every job except `publish`.
- `scripts/release.mjs` (`ci-gate`, `prepare`, `publish [--dry-run]`) with `scripts/lib/release-core.mjs` (pure decisions and argv builders) and `scripts/lib/release-checks.mjs` (the declared workflow shape). The gate set runs the 8 `prepublish-<short>` suites through the throwaway harness's `exec` before anything is packed. Packing uses `pnpm pack` and uploading uses `npm publish <tgz> --ignore-scripts`, in the AC order. The channels Marketplace, Open VSX and IPM are implemented, dry-run, and ship disabled.
- `scripts/release-version.mjs` and the root `version` and `release` scripts (AD-14); `SECURITY.md`; README `### Releasing`; a CHANGELOG 42.5 section (`BOOTSTRAP_VERSION` does not move: `0.0.2+2.244fe8623c76`).
- DW-693: one newline-terminated reader (`scripts/lib/audit-lines.mjs`) used by every audit reader, a lexical guard (`audit-reader-scan.mjs`, `audit-reader-guard.test.ts`), and a probe-copy test that asserts the SIGTERM the client sent.
- `smokePackages` accepts prebuilt tarballs (default path and CLI unchanged); `ci-workflow-check.ts` exports `actionPinProblems`; no change to `ci.yml`.

**Files changed (49).** New: `.github/workflows/release.yml`, `SECURITY.md`, `scripts/release.mjs`, `scripts/release-version.mjs`, `scripts/lib/{release-core,release-checks,audit-lines,audit-reader-scan}.mjs`, `scripts/lib/audit-lines.d.mts`, and test files and helpers under `packages/iris-mcp-all/src/__tests__/` (`audit-lines`, `audit-reader-guard`, `release-core`, `release-prepare`, `release-script`, `release-smoke-prebuilt`, `release-version`, `release-workflow`, `story-42-5-doc-claims`; helpers `release-fixture`, `release-script-fixtures`, `release-workflow-check`, `smoke-repo-fixture`, `stand-in-clis`) and `packages/shared/src/__tests__/gen-bootstrap-scratch.ts`. Changed: `README.md`, `CHANGELOG.md`, `package.json`, `scripts/ci-package-smoke.mjs`, `scripts/lib/sdk-handler-golden-core.mjs`, `scripts/lib/script-ts-import-scan.mjs` (`lexSource` export), the audit tests of `@iris-mcp/shared`, and the `@iris-mcp/all` tests named in the spec.

**Review (first pass; 4 layers, 44 findings: high 3, medium 14, low 23, false 4).**
- Patched (14 root causes, G1-G14, 30 findings), all verified and mutation-checked: `pnpm run version -- --first-release` was refused because pnpm 9.15.0 passes a literal `--` (G1, the one high); signal handlers of `main()` preempted the gate set's (G2); `ci-gate` counted green `pull_request` runs (G3); the IPM dry step failed on an empty packaging repository and ignored the default branch, plus an atomic push and the key message (G4); a throw in a channel skipped the report (G5); no fetch timeout (G6); first-release leftovers and the no-pending refusal (G7); `:check` scripts starting with `pre`/`post` (G8); the untested smoke tarballs branch, module loader and `pnpmPack` arguments (G9); the version fixture now owns its versions and changesets, so Story 42.6 cannot turn the AD-14 tests into skips (G10); declared workflow commands run through `parseArgs` (G11); README approval step and resume rule, and relative doc pins (G12); missing red cases for the workflow check (G13); missing mutation lines (G14).
- Deferred: none added by this review (the frontmatter `deferred:` item is the plan stage's).
- Rejected, with the recorded reason: BH4/EH4 retry on a transient API error (specified fail-closed behavior); BH5 `repository.url` check (all eight correct, theoretical); BH7 SECURITY.md timeline and fallback (decision #79); EH2 process-group kill (job timeouts bound it); EH8/IA4 extension install and IPM key wiring (Stories 42.7 and 42.8 own them); EH12 scan beyond `readFileSync` (the spec names exactly that); VG8 probe-copy `toContain` (the pinning assertion is `toEqual([probe])`); VG14 host-key trust on first use (IPM channel ships disabled; reopen if enabled without a pinned host key); IA2 GitHub-side behavior (the lead's dry run is the stated boundary); IA5-IA7 (no divergence).
- Follow-up review recommended: true. This pass patched a high (G1) and 9 medium entries. The unverified risk is the patch round itself: G2's signal order (`setImmediate` exit) and G10's reworked version fixture are new code that no layer has reviewed yet. Patched entries by verdict: high 1, medium 9, low 4; the 30 patched findings by verdict: high 3, medium 14, low 13.

**Verification performed (all with the `UNARMED` prefix, after the last patch).**
- `node --check` of the eight scripts: exit 0.
- `@iris-mcp/all` story files (16 files): 498 passed. Shared audit files (10 files): 239 passed. Shared lint and type-check, interop type-check: clean.
- Full package tests: shared 2575, client-config 1015, admin 506 (+8 skipped), data 163 (+2 skipped), dev 1490 (+319 skipped), interop 751, ops 350, all green; `@iris-mcp/all` in three shards (70, 70 and 69 files; 1728, 1852 and 1632 passed). Three shards, not the spec's two, because two shards of this package outlast one 10-minute call.
- `pnpm lint` and `pnpm type-check` (turbo): green. The root checks: governance baseline (frozen keys all present, 71 post-foundation keys), skills, pack, prompts, provenance, tools-list snapshot, epics sync all OK; `pnpm gen:bootstrap` unchanged (`BOOTSTRAP_VERSION` `0.0.2+2.244fe8623c76`, no move). `lint_spine.py`: 0 findings.
- `node scripts/ci-package-smoke.mjs`: exit 0 (default path). The launcher packages into a temp directory when run inside the extension's directory (22 files, one `.vsix`, `vsce ls` 20 lines); the spec's `npm --prefix ... exec -- vsce package` form failed on the missing `engines.vscode` of the root manifest, so the Verification command now runs inside the extension's directory, as `prepare` does.
- Mutations (Rule 19): about 60 recorded under "Recorded mutations", each applied, observed red and reverted with the tree byte-identical.
- Publish paths without publishing: `npm`, `git`, `vsce`, `ovsx` and `docker` are scripted stand-ins on `PATH` or injected dependencies; `npm publish` ran only against the stand-in. `GITHUB_TOKEN` and `NPM_TOKEN` were unset in every command. No container was started and no image pulled; the shared IRIS was not touched.

**Residual risks (for the lead's dry run, checklist 2).** Whether the `actions: read` token can read the `release` environment and its deployment rules; whether `git status --porcelain` is empty after `pnpm build` and `pnpm run gen:bootstrap` on the runner; whether the launcher `npm run build` and `package` work on the runner; `npm view` of a never-published package answering E404 (treated as "not published"); `git ls-remote --symref` against the real packaging repository (checked only on local bare repositories).
