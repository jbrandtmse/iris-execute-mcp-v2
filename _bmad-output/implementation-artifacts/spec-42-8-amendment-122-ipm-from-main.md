---
title: 'Story 42.8 amendment (decision #122): IPM publishes from the main repository root'
type: 'feature'
created: '2026-11-21'
status: 'ready-for-dev'
baseline_revision: '869c5227d8a13c860b4fbdb19a31e94006025810'
amends: 'spec-42-8-claude-code-plugin-and-registry-listings.md'
supersedes: 'wave-8 decision #76 (DW-689 route), owner step O-IPM1, decision #109 (packaging-tag rerun rule)'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-iris-execute-mcp-v2-2026-10-14/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-42-8-claude-code-plugin-and-registry-listings.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-42-4-ipm-package-revival.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-42-5-release-workflow.md'
  - '{project-root}/_bmad-output/implementation-artifacts/orchestrator-decisions-wave-8.md'
deferred:
  - summary: >-
      Reading the Open Exchange listing's `PublishPM` flag in the release (to report the IPM step as `skipped (not set up)`
      before the owner ticks "Publish in Package Manager") is not built: the `mpapi/packages/get/<name>` endpoint is
      undocumented, and the IPM channel has no automated upload whose setup could be missing.
    evidence: >-
      GET https://openexchange.intersystems.com/mpapi/packages/get/IRIS-MCP-Server-Suite-2 on 2026-11-21 answered 200 with
      `PublishPM: false`, `PackageName: ""`, `Version: 0.1.1`; no public documentation of that endpoint was found.
    location: 'scripts/release.mjs IPM manual step'
    severity: low
  - summary: >-
      `zpm "load https://github.com/jbrandtmse/iris-execute-mcp-v2"` (IPM's git-clone load) sees the whole repository, not the
      export-ignore allow-list. It still installs the stamped tree (SourcesRoot `ipm/src`), but no gate proves that route.
    evidence: >-
      IPM `load <url>` git-clones (42.5 plan research); `.gitattributes export-ignore` affects `git archive` and GitHub's archive
      downloads only, not clones. The documented routes are bootstrap (default) and `zpm "install iris-execute-mcp-v2"` (decision #123).
    location: 'docs (Story 42.9 owns them); scripts/ci-ipm-archive.mjs'
    severity: low
  - summary: >-
      A pull request from a fork: CI fetches GitHub's archive of `GITHUB_SHA` (the merge commit). If GitHub does not serve that
      archive, the fork PR's `ipm` job fails with the URL and status (no silent fallback).
    evidence: >-
      Archive-by-sha verified only for a pushed branch commit (869c5227: 200, 13,826,049 bytes). No fork PR exists to probe.
    location: 'scripts/ci-ipm-archive.mjs served-archive step'
    severity: low
---

<intent-contract>

## Intent

**Problem.** Decision #122 (owner, 2026-11-21) removes the separate packaging repository `jbrandtmse/iris-execute-mcp-v2-ipm`. The existing Open Exchange listing `IRIS-MCP-Server-Suite-2` (Github = this repository) stays the one listing. IPM then publishes from a `module.xml` at this repository's root. The code built for decision #76 assumes the opposite:
- `ipm/module.xml` is not at the root, so Open Exchange and the registry find no module;
- the release pushes a staged tree to a repository that will never exist, with a deploy key and pinned GitHub host keys;
- `verify` looks for a tag on that repository;
- the DW-694 gate tars a staged packaging root, not what the registry would serve from this repository.

**What the registry actually does (verified from primary sources, Design Notes "Evidence"):**
- The registry (`zpm-registry` `ZPM.Package.UpdatePackage`) reads `<Name>` and `<Version>` from `raw.githubusercontent.com/<owner>/<repo>/master/module.xml`. This repository has no `master` branch, but GitHub redirects the renamed `master` to `main`, so that URL serves `main`'s file.
- It downloads `github.com/<owner>/<repo>/archive/<default_branch>.tar.gz`, the HEAD of `main` when the owner presses Release (not the tag). It extracts it and re-tars the `<repo>-<branch>/` folder with `tar --exclude=.git -zcvf … -C <folder> .`. That tar is what `zpm "install"` downloads.
- GitHub's archive honors `.gitattributes export-ignore`.
- IPM imports preloaded classes only from `<module root>/preload` (recursively), and resolves resources under `<module root>/<SourcesRoot>`.

**Approach.**
- **A committed, stamped, output-only IPM tree at the root.** It has three parts:
  - a root `module.xml` (SourcesRoot `ipm/src`);
  - the 35 stamped classes at `ipm/src/cls/ExecuteMCPv2/**`;
  - the stamped guard at `preload/ipm/src/cls/ExecuteMCPv2/InstallGuard.cls`.

  `gen-bootstrap.mjs --ipm` writes the tree from the embed **only at the version step**. `main` therefore always carries exactly the last released content, whenever the owner presses Release.
- **`gen:ipm:check`** proves the committed tree is unedited generator output. It recomputes the content hash from the tree and compares it with the tree's own marker. It also checks that the tree's version equals the shared version. In release mode, `prepare` also requires the tree's marker to equal `BOOTSTRAP_VERSION`.
- **A `.gitattributes` export-ignore allow-list.** The archive GitHub serves (and the registry re-serves) then holds only `module.xml`, `LICENSE`, `README.md`, `ipm/src/**` and `preload/**`.
- **The DW-694 gate is redefined.** CI fetches GitHub's real archive of the commit under test, checks that it matches local `git archive` and the allow-list, re-tars it the registry's way inside the container, and `load`s it on both editions offline.
- **The IPM release channel becomes a manual step.** There is no push, no key and no packaging repository. The run reports the owner's Open Exchange Release as a `manual step`. `verify` reports IPM as pending until the registry lists the version, then checks the served archive against the tag.

## Boundaries & Constraints

**Always:**
- **One generator, output-only files (AD-14, Rule #18).** The root `module.xml`, `ipm/src/cls/**` and `preload/**` are written only by `scripts/gen-bootstrap.mjs --ipm`. Each carries no hand edits, and `gen:ipm:check` refuses any.
  - `module.xml` carries the GENERATED/DO-NOT-EDIT comment naming `pnpm gen:ipm` and the version step.
  - `.cls` files cannot carry a header, because their bytes are the embed's; their guard is the hash check.
  - `classes[]` stays literally in `gen-bootstrap.mjs` (Rule #39 rosters unchanged).
- **The tree is frozen between releases.** `pnpm gen:bootstrap` (plain) never writes the IPM tree. `--ipm` writes it when one of these holds, and otherwise refuses with: `the IPM tree is already at <v>; it is regenerated only by the version step (pnpm run version), so main keeps the content the registry serves for <v>. Pass --force only to repair a damaged tree.`:
  - the tree is absent;
  - its version differs from the shared version (that is, the version step just bumped it);
  - `--force` is passed.
- **Archives are built from the embed, never from `src/` (AD-14).** Every stamped file equals the embed's content for the marker it carries: Setup and the guard stamp the marker, and no file holds the `dev` placeholder.
- **The layout follows IPM.** The resource path is `{SourcesRoot}/cls/<pkg path>.cls`. The preload path follows IPM's `OnItemRelativePath`: `preload/` + SourcesRoot + `/cls/…`. IPM imports the whole of `<root>/preload` recursively (`%IPM.Lifecycle.Base`, `preloadRoot = RootDirectory_"preload"`), so nothing else may ever live under `preload/`. `SourcesRoot` is ≤ 20 characters (`%IPM.Storage.Module.SourcesRoot` MAXLEN 20); `ipm/src` is 7.
- **The served archive is an allow-list.** `.gitattributes` export-ignores every top-level entry except `module.xml`, `preload`, `ipm`, `LICENSE` and `README.md`, and export-ignores `ipm/preload` (the guard's `dev` source).
- **The install name stays `zpm "install iris-execute-mcp-v2"`.** `IPM_MODULE_NAME` is unchanged. The registry binds the name to the first repository URL that publishes it, and neither the name nor this repository is on the registry today (probe).
- **42.5 to 42.8 constraints stay:**
  - `release.mjs` statically imports only `node:` builtins, `release-core.mjs` and `script-process.mjs`, and `release-core.mjs` stays pure;
  - error text has the form `<what happened>. <what to do>.`;
  - Rule 14 escapes; Rule #55 (no heredoc writes);
  - the `ci.yml`/`ci-checks.mjs` and `release.yml`/`release-checks.mjs` self-tests stay green;
  - containers run only through `scripts/throwaway-iris.mjs`, `--network none`;
  - CI is secret-free. The served-archive fetch is an unauthenticated public GET from the runner host, never from a container.
- **#121 semantics are preserved.** npm is never skippable. A set-up channel that fails still fails. The IPM channel can neither fail nor block a release, because it has no automated upload.

**Ask First:** none (the decisions below are the lead's at the spec gate).

**Never:**
- **No publish-shaped command, ever.** No stage runs `npm`/`pnpm publish`, `changeset publish`/`version`, `pnpm run version` on the real tree, `git tag`/`push`, `gh release`/`workflow run`/`secret`, a non-GET `gh api`, or anything on Open Exchange.
- **No `master` branch in this repository, ever.** The registry reads `…/master/module.xml`. Today GitHub's rename redirect sends that to `main`; a real `master` branch would shadow it and the registry would read the wrong manifest. The docs and the lead checklist state this.
- **No edit to ObjectScript sources, REST routes, the governance baseline (`1e62c5ad5bf7`/141), frozen goldens, `irislib/` or `irissys/`.** `BOOTSTRAP_VERSION` does not move in this rework, because no class changes; `scripts/bootstrap-sequence.json` is unchanged.
- **Nothing under `preload/` except the stamped guard,** and no `requirements.txt` at the root: IPM runs `pip install -r <root>/requirements.txt` when that file exists (`%IPM.Lifecycle.Base`, line 770). A test refuses both.
- **No change to the store or MCP Registry channels** (the #121 rework owns them).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Initial generation (this rework) | no root `module.xml`; shared `1.0.0`; embed `1.0.0+N.h` | `pnpm gen:ipm` writes `module.xml` (Version `1.0.0`, SourcesRoot `ipm/src`, 36 resources, the three invokes), 35 files under `ipm/src/cls/ExecuteMCPv2/`, `preload/ipm/src/cls/ExecuteMCPv2/InstallGuard.cls`; `ipm/module.xml` deleted | — |
| Same-version regeneration | tree at `1.0.0`, shared `1.0.0`, `pnpm gen:ipm` | refuses, exit 2, the text in Boundaries; nothing written | `--force` rewrites |
| Class edited, then `--ipm` at the same version | a class edited; `node scripts/gen-bootstrap.mjs --ipm`; tree version = shared version | the embed is written as plain `gen:bootstrap` would write it (sequence +1), then the same-version refusal; the tree is untouched, so it still equals the released content | exit 2 for the tree part; `--force` rewrites |
| Version step | pending changeset; `pnpm run version` | shared `1.1.0`; embed `1.1.0+N.h`; root `module.xml` `1.1.0`; tree Setup and guard stamp `1.1.0+N.h`; post-check `embeddedVersionProblems(…, {release:true})` `[]` | a mismatch names the file, `run pnpm run version` |
| Between releases | class edited, `gen:bootstrap` run; embed `1.1.0+N+1.h2`; tree `1.1.0+N.h` | `gen:ipm:check` OK (tree intact, `1.1.0` = shared); CI `ipm` build leg installs the embed; served leg installs the tree (`1.1.0+N.h`) | — |
| Hand-edited tree class | one byte changed in `ipm/src/cls/ExecuteMCPv2/Utils.cls` | `gen:ipm:check` exit 1: `ipm/src … does not hash to the marker 1.1.0+N.h it carries: the tree was edited by hand. Run pnpm gen:ipm -- --force from a clean version commit, or restore it from git.` | CI gates red |
| Hand-edited `module.xml` | e.g. SourcesRoot changed or a resource dropped | `gen:ipm:check` exit 1: `module.xml is not what the generator writes for the tree it describes` (byte comparison with the rendering from the tree's resources and version) | gates red |
| Tree extras | an extra `.cls` under `ipm/src`, a test or fixture class, any file under `preload/` but the guard, a root `requirements.txt` | `gen:ipm:check` exit 1 naming the path | gates red |
| Version drift | tree `1.0.0`, shared `1.1.0` (version step skipped) | `gen:ipm:check` exit 1: `module.xml is at 1.0.0, not the shared version 1.1.0. Run pnpm run version.` | gates and `prepare` red |
| Release-mode freshness | tag `v1.1.0`; tree marker ≠ `BOOTSTRAP_VERSION` | `prepare` refuses: `the IPM tree stamps <m1>, the embed <m2>: the version step did not run on the final content. Run pnpm run version.` | exit 1 |
| Dry-run staleness | dry-run branch between releases; tree marker ≠ `BOOTSTRAP_VERSION` | a note line `ipm: main carries <m1> for the registry; the next version step stamps <m2>`; not a failure | — |
| Served archive (DW-694) | CI `ipm` job, `GITHUB_SHA` | fetch `https://codeload.github.com/${GITHUB_REPOSITORY}/tar.gz/${GITHUB_SHA}`. Its members (the first path component stripped) must equal local `git archive --format=tar.gz HEAD` and must equal the allow-list set: `module.xml`, `LICENSE`, `README.md`, every `git ls-files ipm/src preload`. Extract it, re-tar it in the container with GNU tar `--exclude=.git -czf … -C <root> .`, then `load <tgz>` on a fresh `--network none` container per edition: `list` shows `iris-execute-mcp-v2` at the tree's version, 36 classes compiled, `GetBootstrapVersion()` equals the tree's marker, web application and `%ALL` mapping present, the guard document 200, `%IPM_Repo.Definition` 0 rows, parity cases agree | job fails naming the phase, the edition and the member or check |
| Served fetch fails | codeload non-200, or the network is down | job fails: `GitHub did not serve the archive of <sha> (<status>). The gate proves the archive the registry downloads; it never falls back to a local emulation in CI.` | exit 1 |
| Local run | no `GITHUB_ACTIONS` | `git archive --format=tar.gz HEAD` stands in, with the printed note `local emulation of GitHub's archive (CI fetches the real one)` | — |
| Allow-list regression | `/preload -export-ignore` removed | `gitattributes` pin red (`git check-attr export-ignore` over `git ls-files`); in CI the served member check names `preload/ipm/src/cls/ExecuteMCPv2/InstallGuard.cls` missing | red |
| IPM channel, rehearse | registry 404 for the package or no `1.1.0` | `ipm: ready (manual step after the tag: Release 1.1.0 on the Open Exchange listing IRIS-MCP-Server-Suite-2; the IPM registry does not list 1.1.0)` | registry unreadable: same status, the detail says it could not be read; never `not ready` |
| IPM channel, publish | registry does not list `<v>` | `ipm: manual step (…the same text…)`; a "Manual steps" block at the end of the summary and a `::warning::` annotation; exit unaffected | — |
| IPM channel, rerun | registry lists `<v>` | `ipm: already published` | — |
| Secrets | `release.yml`, `release-checks.mjs`, `release.mjs` | no `IPM_DIST_DEPLOY_KEY` anywhere; no `known_hosts`, `GIT_SSH_COMMAND` or `ssh` | the workflow self-test refuses a reintroduction |
| `verify`, not listed | after the tag, before the owner's Release | `jbrandtmse/iris-execute-mcp-v2 on IPM: pending (the registry does not list 1.1.0 yet: the owner presses Release on the Open Exchange listing)`; exit unaffected | registry unreadable: `pending (could not read …)`, exit unaffected |
| `verify`, listed | registry lists `1.1.0` | download the served tgz (`url` from the registry JSON). Its member set and every file's bytes equal `git archive v1.1.0` (local tag). Its `module.xml` `<Version>` is `1.1.0`. Line `ok, the IPM registry serves 1.1.0 and its archive equals the tag's` | mismatch: a failing problem naming the first differing members; local tag missing: `fetch the tags (git fetch --tags), then run verify again`, failing |

</intent-contract>

## Code Map

**The generator and the tree (AD-14; extend gen-bootstrap, Rule 2)**
- `scripts/gen-bootstrap.mjs` (325 lines):
  - Step 4b stops writing `ipm/module.xml`. The manifest renderer moves to the new lib, which takes `{ moduleName, version, classNames, guardName, sourcesRoot: 'ipm/src' }`.
  - New flag `--ipm`: after the embed write, write root `module.xml`, `ipm/src/cls/<path>.cls` for each `classes[]` entry (stamped content plus `\n`), and `preload/ipm/src/cls/ExecuteMCPv2/InstallGuard.cls`. Remove stale tree files the new class list no longer names. The same-version refusal applies, with `--force`. Only-if-different writes (mtime rule).
  - New flag `--ipm-check`: branch at the top, before any computation or write. It calls `ipmTreeProblems(root)` and exits 0/1.
  - The header comment documents both flags.
- New `scripts/lib/ipm-tree.mjs` (pure; imports only `node:` builtins):
  - `IPM_SOURCES_ROOT = 'ipm/src'`, `IPM_PRELOAD_PREFIX = 'preload'`;
  - `renderModuleXml(…)` (moved from gen-bootstrap Step 4b, SourcesRoot changed);
  - `ipmTreeFiles(embedLike)` → `Map<relativePath, content>`, the one function that maps an embed to tree paths. gen-bootstrap, `stageModule` and the checks all use it;
  - `readIpmTree(root)` (the manifest, the files, the marker);
  - `ipmTreeProblems(root, { sharedVersion })`, which checks:
    - the root `module.xml` exists and equals `renderModuleXml` of its own declarations;
    - every non-preload resource maps to exactly one file under `ipm/src/cls`, and there are no extra files;
    - `preload/` holds exactly the guard;
    - no test or fixture class, and no `dev` placeholder;
    - Setup and the guard stamp the same marker, whose semver equals `<Version>`, which equals `sharedVersion`;
    - the sha256-12 over the de-stamped files, in resource order with the guard last (the gen-bootstrap formula), equals the marker's hash;
    - no root `requirements.txt`.

    It also exports `ipmTreeMarker(root)`.
- `package.json` (root): `"gen:ipm": "node scripts/gen-bootstrap.mjs --ipm"`, `"gen:ipm:check": "node scripts/gen-bootstrap.mjs --ipm-check"`. The `check` word puts it in `prepare`'s root-check set and CI's scan automatically (DW-612).
- Generated and committed: `module.xml` (new), `ipm/src/cls/ExecuteMCPv2/**` (35 new, about 1.06 MB), `preload/ipm/src/cls/ExecuteMCPv2/InstallGuard.cls` (new). `ipm/module.xml` is deleted. `ipm/preload/ExecuteMCPv2/InstallGuard.cls` stays the guard's `dev` source (AD-14 path unchanged).
- `.gitattributes`: append the allow-list:
  ```
  /* export-ignore
  /module.xml -export-ignore
  /preload -export-ignore
  /ipm -export-ignore
  /ipm/preload export-ignore
  /LICENSE -export-ignore
  /README.md -export-ignore
  ```
  This was probed with `git archive` on a throwaway clone: exactly those paths, dot-directories excluded.
- `.prettierignore`: add `/module.xml`, `/ipm/src/`, `/preload/` (generated output).
- `scripts/lib/ci-checks.mjs`: add `'pnpm gen:ipm:check'` to the root-gate list (:293-299). `.github/workflows/ci.yml` gates job: the matching step. `ci-workflow.test.ts` self-test.

**The DW-694 gate (Rule #59: the path the registry takes)**
- `scripts/lib/ipm-archive.mjs` (831 lines):
  - `loadEmbed` stops reading `ipm/module.xml`. `moduleXml` becomes `renderModuleXml` for the embed (current `classes[]`, embed semver). `embedProblems` drops the `ipm/module.xml` version line.
  - `stageModule` writes `ipmTreeFiles(embed)` plus `module.xml`, so the build leg stages the same layout the tree has.
  - `archiveProblems` expects `ipm/src/cls/…` and `preload/ipm/src/cls/…` members, not `src/cls/…`. That is IPM's own `package` layout for SourcesRoot `ipm/src`: probe it in A1 and adjust to what `package` writes, never the reverse.
  - Delete `stagePackagingRoot` and the `ipmReadme` import.
  - Rework `registryArchiveProblems(entries, expectedFiles)`: the expected set is `servedFileSet(root)`, which is `module.xml`, `LICENSE`, `README.md` and `git ls-files ipm/src preload`, passed in.
  - New `stripArchivePrefix(entries)` drops the `<repo>-<ref>/` component that GitHub's archive carries.
  - `REGISTRY_*` constants keep their names.
- `scripts/ci-ipm-archive.mjs` (565 lines):
  - `prepareRegistryDirectory` becomes `prepareServedDirectory`. It obtains the served archive:
    - in CI, `deps.fetch` of `https://codeload.github.com/${GITHUB_REPOSITORY}/tar.gz/${GITHUB_SHA}`;
    - locally, `deps.run(['git','archive','--format=tar.gz','HEAD'])`.

    In CI it also runs `git archive` and requires equal member sets and bytes. It then checks the members against the allow-list set and extracts them under `registry/root` (`extractEntries`).
  - `registryLeg` is unchanged in mechanics (GNU tar inside the container, `load <tgz>`, install checks, parity). The expected marker and class count come from the committed tree (`ipmTreeMarker`, the `module.xml` resources), not from the embed.
  - The header contract (7a) is rewritten. The PASS line names both artifacts.
- `ci-ipm-archive.test.ts`, `ci-ipm-archive-tgz.test.ts`, `ipm-archive-fixture.ts`: the scripted-docker world gains `fetch` and `git` stand-ins. Rows: CI fetch OK, fetch 404 → exit 1 with no fallback, member mismatch GitHub-vs-local, allow-list extra/missing, preload missing, local emulation note.

**The release (AD-29)**
- `scripts/lib/release-core.mjs`:
  - Delete `IPM_DIST_REPOSITORY`, `IPM_DIST_BRANCH`, `GITHUB_SSH_KNOWN_HOSTS`, `githubKnownHostsText`, `ipmPushPlan`, `ipmDefaultBranch`, `ipmReadme`, `GIT_IDENTITY` (if unused).
  - Keep `IPM_MODULE`, `IPM_REGISTRY_PACKAGE_URL` and `ipmRegistryListsVersion`.
  - Add `OPEN_EXCHANGE_LISTING_URL = 'https://openexchange.intersystems.com/package/IRIS-MCP-Server-Suite-2'`, `STATUS.manualStep = 'manual step'`, and `ipmManualStepText(version)`.
  - `RELEASE_CHANNELS` `ipm` gains `manual: true`.
  - The header's publish-verb list drops `ipmPushPlan`.
- `scripts/release.mjs` (1800 lines, after the #121 rework):
  - `readReleaseFacts` reads `moduleVersion` from the root `module.xml` and adds `ipmTreeMarker`.
  - `embeddedVersionProblems(facts, { release })` names `module.xml`, not `ipm/module.xml`. With `release: true` it adds the freshness refusal. `prepare` passes `release: mode === 'release'`; `release-version.mjs` passes `true`.
  - `stageIpm` is replaced by an `ipm` channel detail `{ module, version, marker: facts.ipmTreeMarker, listing: OPEN_EXCHANGE_LISTING_URL, manual: true }`, with no files. `uploadPathProblems` drops the `ipm` branch.
  - `dryStep` `ipm`: a registry read → `ready (manual step …)` / `ready (would be already published)`.
  - `runChannel` `ipm`: `already published` or `manual step`.
  - Delete `publishIpm`, the deploy-key and known-hosts code, `IPM_DIST_DEPLOY_KEY` in `SECRET_VARIABLES` (:170) and in the redaction (:1158).
  - A "Manual steps" block after #121's "Skipped channels" block, plus a `::warning::` annotation per manual step.
  - `runVerify`: the packaging-tag check is replaced by the IPM pending/served-archive check (the matrix rows). It loads `readTgz` with a dynamic `import()` (the static-import rule).
  - The mcp-registry note at :1241 drops "or IPM" if reworded.
- `scripts/lib/release-checks.mjs` (:123) and `.github/workflows/release.yml` (:19-20 comment, :154): remove `IPM_DIST_DEPLOY_KEY`.
- `scripts/release-version.mjs`: spawn `gen-bootstrap.mjs --ipm` (not plain). Contract item 2 and the README step 1 text name the root `module.xml` and the tree.

**Tests (one row per matrix row; Rule 19 mutation lines in Verification)**
- New `packages/iris-mcp-all/src/__tests__/ipm-tree.test.ts`, covering:
  - `ipmTreeProblems` on the real repository (empty);
  - a scratch copy with each tamper row (byte edit, `module.xml` edit, extra class, extra preload file, `requirements.txt`, version drift, `dev` placeholder);
  - the `.gitattributes` pin: `git ls-files -z | git check-attr --stdin -z export-ignore` leaves exactly the served set (the A1b mutation target);
  - the `gen-bootstrap --ipm` refusal and `--force`, in the `gen-bootstrap-scratch` world.
- `ipm-manifest.test.ts`: retarget it to the root `module.xml`. It is `renderModuleXml` of the tree; at a version commit its resources equal `classes[]`.
- `packages/shared/src/__tests__/bootstrap.test.ts` (:2075-2091): read the name and version from the root `module.xml`.
- `gen-bootstrap-write.test.ts` (:43, :353-451): plain `gen:bootstrap` writes no IPM file; `--ipm` writes the tree; `gen-bootstrap-scratch.ts` copies `scripts/lib/ipm-tree.mjs` too.
- `release-core.test.ts`, `story-42-8-release-core.test.ts`, `release-script.test.ts`, `release-script-fixtures.ts`, `release-prepare.test.ts`, `release-fixture.ts`, `release-version.test.ts`, `release-workflow.test.ts`, `story-42-5-qa-real-oracles.test.ts`, `story-42-6-qa-gate-verify.test.ts`: delete the push, host-key, deploy-key and packaging-tag rows; add the manual-step, already-published, Manual-steps-block and annotation rows, the freshness rows (release and dry run), and the verify pending, listed-equal and listed-differs rows.
- Doc pins: `story-42-4-doc-claims.test.ts`, `story-42-5-doc-claims.test.ts`, `story-42-7-doc-claims.test.ts`, `story-42-8-doc-claims.test.ts` follow the doc edits below.

**Docs (minimal, Rule #43; 42.9 owns the install docs, #123)**
- `README.md` "Releasing" section only (:1159-1182):
  - step 1 names the root `module.xml` and the stamped tree;
  - step 6 names verify's IPM line;
  - the channel table's IPM row reads `IPM (the root module.xml; the owner's Open Exchange Release) | manual step | Story 42.8`;
  - the O-IPM1 paragraph is replaced by the owner step (Design Notes) and the "never create a `master` branch" sentence.
- `CHANGELOG.md`: an unreleased entry for the amendment; lines 33/37/39 describe the superseded design and stay as history.

## Tasks & Acceptance

**Execution** (dependency order):
1. `scripts/lib/ipm-tree.mjs`, `scripts/gen-bootstrap.mjs`, root `package.json`. Run `pnpm gen:ipm` once: the tree is generated and `ipm/module.xml` is deleted. Add `.gitattributes`, `.prettierignore`. **AC:**
   - `pnpm gen:ipm:check` exit 0;
   - `pnpm gen:bootstrap && git status --porcelain` shows nothing;
   - a second `pnpm gen:ipm` refuses with exit 2;
   - `BOOTSTRAP_VERSION` unchanged.
2. `scripts/lib/ci-checks.mjs`, `.github/workflows/ci.yml`: the gate is registered. **AC:** `ci-workflow.test.ts` green, and red with the step removed.
3. `scripts/lib/ipm-archive.mjs`, `scripts/ci-ipm-archive.mjs` and their tests: the build leg's new layout, and the served leg (DW-694). **AC:** every served/registry matrix row has a scripted-docker test; the tests are offline.
4. `scripts/lib/release-core.mjs`, `scripts/release.mjs`, `scripts/lib/release-checks.mjs`, `.github/workflows/release.yml`, `scripts/release-version.mjs` and the release tests: the manual-step channel, freshness and verify. **AC:**
   - `git grep -n "IPM_DIST\|iris-execute-mcp-v2-ipm\|known_hosts\|ipmPushPlan\|GITHUB_SSH_KNOWN_HOSTS" -- scripts .github packages` finds nothing;
   - every IPM matrix row is pinned.
5. `README.md` (Releasing only), `CHANGELOG.md`, the doc-claims tests. **AC:** the doc-claims tests are green; no IPM install-route text is added (42.9's domain).
6. Ledger:
   - DW-689 note `status=resolved-by:42-8-amendment-122` ("route: root module.xml of the main repository, stamped tree, decision #122; supersedes #76");
   - DW-694 note `status=resolved-by:42-8-amendment-122` ("gate redefined: GitHub's archive of the commit, allow-list, registry re-tar, load on both editions").

   Both go through `ledger.sh` only.

**Acceptance (testable):**
- Given the rework commit, when `gen:ipm:check` runs, then it exits 0. Given one tamper row each, then it exits 1 naming the path.
- Given a version-step rehearsal in a throwaway clone with a patch changeset, then:
  - the root `module.xml` is `1.0.1`;
  - the tree's Setup and guard stamp `BOOTSTRAP_VERSION` exactly;
  - `embeddedVersionProblems(facts,{release:true})` is `[]`;
  - `gen:ipm:check` is clean;
  - `pnpm gen:ipm` then refuses.
- Given CI on the rework commit, when the `ipm` job runs, then the served leg proves GitHub's archive of that commit equals local `git archive` and the allow-list, and installs on both editions.
- Given a release rehearsal, then the IPM line reads `ready (manual step after the tag: …)`, the run's exit is not affected by IPM, and no IPM secret is referenced.
- Given `release.mjs verify --version <v>` before the owner's Release, then IPM is `pending` and does not fail verify. After it, the served archive must equal `git archive v<v>`.

## Design Notes

**Governing ADs (Rule 6):**
- AD-14: the IPM manifest, the version marker, version-embedding artifacts, generated files.
- AD-29: Channels, IPM and the MCP Registry, CI, Publishing.
- AD-28: Names and endorsement. The served archive carries the main `README.md` and `LICENSE`; no file or listing name implies endorsement, and the existing listing is unchanged.
- AD-33 is not touched (no route change). No AC contradicts an AD's Rule once the drafts below are applied: today's AD-14 text "`ipm/module.xml` is generated by `scripts/gen-bootstrap.mjs`" and AD-29's "packaging repository" bullet are exactly what decision #122 supersedes, so the drafts are part of this amendment's gate (#122: "AD-14 and AD-29 … are amended at that amendment's gate").

**Consumed-by / Consumes (Rule 1/2):**
- Consumes: the embed computation of `gen-bootstrap.mjs`, `readTgz`/`extractEntries`, the throwaway harness, and #121's summary block.
- Consumed-by:
  - Open Exchange and zpm-registry (the root `module.xml` plus GitHub's archive of `main`);
  - CI `gates` (`gen:ipm:check`) and `ipm` (the served leg);
  - `release.mjs prepare` (freshness) and `verify` (served archive);
  - `release-version.mjs` (`--ipm`).

  Integration ACs: the served-leg matrix row (a consumer, IPM `load`, installs and the guard answers 200), and the verify-listed row.

**Rule 2 (extend, don't copy).** The tree writer extends `gen-bootstrap.mjs`, the one owner of `classes[]` and the marker, rather than adding a second generator that would recompute the embed. `renderModuleXml` and `ipmTreeFiles` are shared by the generator, `stageModule` and the checks, so the build leg, the committed tree and the check use one path map. The served leg extends `registryLeg`, keeping the GNU-tar-in-container mechanics that 42.8 built.

**Evidence (Rules #14, #16 and #42; read-only probes on 2026-11-21):**
- **Registry source.** `intersystems-community/zpm-registry` `src/cls/ZPM/Package.cls`, read from both `master` and the `deployed` branch:
  - `GetModuleMeta` reads `raw.githubusercontent.com` + path + `"master/module.xml"` for Name and Version;
  - `GetDefaultBranch` asks the GitHub API for `default_branch`;
  - `DownloadPackageFromGitHub` GETs `<repo>/archive/<branch>.tar.gz` and extracts it;
  - `Publish` loads `<name>-<branch>/`;
  - `LoadPackage` runs `$Zf(-100,"","tar","--exclude=.git","-zcvf",archive,"-C",Path,".")`;
  - `UpdatePackage` refuses a name bound to another repository URL, and a version already published.
- **`master` → `main`.** `gh api repos/jbrandtmse/iris-execute-mcp-v2/branches/master` answers `main` (55ae0eb6). `raw.githubusercontent.com/jbrandtmse/iris-execute-mcp-v2/master/README.md` answers 200 with the same sha1 as `/main/`; a nonexistent branch answers 404. The owner's published packages `ocupilot`, `ocutalon` and `iris-session-agent` are all `main`-default repositories with the same redirect.
- **export-ignore in GitHub's archive.** `doctrine/instantiator` export-ignores `/tests`, `/docs` and `/.github`, and `github.com/doctrine/instantiator/archive/2.2.x.tar.gz` holds only `composer.json LICENSE README.md src`.
- **Local and GitHub archives agree.** For 869c5227, `git archive` and `github.com/…/archive/869c5227.tar.gz` both list 2,706 files, with an empty diff. Archive-by-sha answers 200.
- **Sizes.**
  - Today `git archive HEAD` is 52,326,400 bytes as tar and 13,824,770 as tar.gz.
  - With the allow-list (probed in a throwaway clone, removed afterwards) only the allow-listed paths remain. The real tree is about 1.27 MB uncompressed.
  - The registry already serves archives far larger than either: `appmsw-docbook` at 139,297,667 bytes, `ocupilot` at 39,724,066 (a survey of 207 package records). Size is therefore not a blocker, and the allow-list is for minimality and hygiene, not a limit.
- **IPM source** (`intersystems/ipm` `main`):
  - `%IPM.Lifecycle.Base` imports `RootDirectory_"preload"` with `ImportDir(…,"*",…,1)`, recursively;
  - `%IPM.ResourceProcessor.Default.Document` resolves `NormalizeDirectory(SourcesRoot, Root)`, and `OnItemRelativePath` gives a preloaded item the path `preload/` + SourcesRoot + `/cls/…`;
  - `%IPM.Storage.Module.SourcesRoot` is MAXLEN 20;
  - `Lifecycle.Base:770` reads `<root>/requirements.txt`.
- **Open Exchange.**
  - `docs.openexchange.intersystems.com/apps/ipm/`: "Place the module.xml file in the root of your project in GitHub"; "Open exchange is the only place to publish applications to the public IPM registry"; tick "Publish in Package manager".
  - The listing (`mpapi/packages/get/IRIS-MCP-Server-Suite-2`): Github `https://github.com/jbrandtmse/iris-execute-mcp-v2`, PublishPM `false`, Version `0.1.1`, PackageName `""`.
  - The release form asks for the version and the notes (community.intersystems.com "How to publish an application on Open Exchange"). Whether the form's version is checked against `module.xml` is undocumented; the registry itself uses `module.xml`.
  - `GET pm.community.intersystems.com/packages/iris-execute-mcp-v2` answers 404, and no registry record names this repository.
- **The Claude Code plugin is unaffected by export-ignore.** `git-subdir` is "fetched with a sparse checkout … a partial clone", and `marketplace add owner/repo` clones (code.claude.com marketplace reference). export-ignore affects only `git archive`/GitHub archives.

**Why the tree is frozen between releases.** The registry packages `main`'s HEAD at the moment of the Release press, not the tag. If the tree followed every `gen:bootstrap`, a press made after later class commits would publish unreleased classes under the released version number. Freezing makes "what the registry serves for `<v>`" equal "what `v<v>` tagged", whenever the press happens, until the next version commit. The cost: each version commit carries a 35-file diff, and the stamped copy duplicates about 1.06 MB of class source in the repository.

**Why a committed tree and not `SourcesRoot src`.** `src/` holds the `"dev"` placeholder, which the guard and the bootstrap read as foreign (AD-14). An IPM install from `src/` would never be upgraded by IPM's own guard ordering, and it would break "archives are built from the embed". A release branch cannot work either: the registry reads only the default branch and `master/module.xml`.

**The GitHub "Source code" archives change.** With the allow-list, every GitHub archive of a commit after this rework (tag pages, `archive/<ref>.zip`, a manually created GitHub Release's source assets) holds only the IPM module. Nothing in the project publishes or consumes those archives: no workflow creates GitHub Releases, and the only release is the owner's `v0.1.0` with no assets. Clones, npm and the plugin are unaffected.

**Decided at the amendment gate (2026-11-21), wave-8 decision #124. BINDING on the rework stage:** recommendations 1, 2 and 4 to 8 are accepted as written. Recommendation 3 is **AMENDED**:
- No `.gitattributes` export rules: no allow-list and no deny-list. GitHub's "Download ZIP" and source archives stay the whole repository, and the served archive is about 13.8 MB, which the registry already handles.
- `gen:ipm:check` still refuses a root `requirements.txt` and anything but the guard under `preload/`.
- The CI served leg fetches GitHub's real archive of `GITHUB_SHA`, requires it equal to `git archive`, and asserts the module's members (root `module.xml`, `ipm/src/**`, `preload/**`) rather than an allow-listed whole.
- The A1b red proof is re-cut on a path that does not rely on export rules, for example the stamped guard moved out of `preload/` (or the root manifest's SourcesRoot broken) with the unit pins neutralized, red at the served install legs on both editions.
- Drop the allow-list rows, tasks and tests; amend the I/O matrix and Verification to match, recording the override in a Spec Change Log entry.

The lead amended the spine (AD-14, AD-29, the capability map) at this gate for #121, #122 and #124; `lint_spine.py` reports 0 findings. The rework runs in an isolated worktree on top of the #121 rework, after 42.9's implement stage has committed `README.md`.

**Orchestrator decision needed (each with a recommendation; the plan follows the recommendation):**
1. **Tree layout — recommended: SourcesRoot `ipm/src`, classes at `ipm/src/cls/**`, the stamped guard at `preload/ipm/src/cls/ExecuteMCPv2/InstallGuard.cls`, root `module.xml`; `ipm/preload/…` stays the guard's dev source.**
   - IPM reads preload only from `<root>/preload` and the manifest only from the root, so two root entries are unavoidable.
   - `ipm/src` keeps every other generated file in the existing `ipm/` directory.
   - The preload path mirrors IPM's own `package` layout, so the build leg can compare like with like.
   - Alternative: SourcesRoot `ipm` (classes at `ipm/cls`). It overlaps the guard's dev source under the SourcesRoot.
2. **When the tree regenerates — recommended: only in the version step (`--ipm`, the same-version refusal),** because the registry packages `main` HEAD at the Release press (`DownloadPackageFromGitHub` reads the default branch, not a tag). Alternative: on every `gen:bootstrap`. That would publish unreleased content under the released version.
3. **What GitHub serves — recommended: the `.gitattributes` allow-list.**
   - It gives a minimal, exact served archive (asserted member-for-member in CI).
   - It removes the root-file hazards IPM reacts to (`requirements.txt`) from the registry path.
   - It costs only the GitHub "Source code" archives, which nothing uses.
   - Alternatives: a deny-list of the bulky directories (about 13 MB stays served, and the member check becomes a deny check); or no export rules (13.8 MB served, which works today, as `ocupilot` shows at 39.7 MB).
4. **The IPM channel status — recommended: a new status `manual step`, never `skipped (not set up)`.**
   - It appears as a "Manual steps" block after #121's "Skipped channels" block, plus a `::warning::` annotation.
   - A rehearsal reads `ready (manual step …)`. A registry that already lists the version reads `already published`.
   - A registry read failure never blocks or fails the run.
   - Reason: under #121 "not set up" means a missing owner setup the release can detect. Here every run needs the press, the release cannot perform it, and the loud block keeps a forgotten press visible, the same safety call the Lead made for skipped channels.
5. **`verify` and IPM — recommended: `pending` (never failing) until the registry lists the version; once listed, the served tgz must equal `git archive v<v>` member-for-member and byte-for-byte, or verify fails.** The listing is a human step that may come days later, and a listed archive that differs from the tag is a real defect. This replaces 42.8's manual C3 tgz comparison.
6. **Who edits the README release runbook — recommended: this rework, limited to the "Releasing" section (steps 1 and 6, the channel table's IPM row, the O-IPM1 paragraph), started after 42.9's implement stage has committed `README.md`.** Those lines describe `release.mjs` behavior that this rework changes. 42.9 owns the install sections and the IPM-as-fallback text (#123), and two concurrent writers of `README.md` would conflict.
7. **The CI build leg — recommended: keep it (the embed, then IPM `package`, the guard refusal legs, install, parity), staged in the new layout.** Between releases it proves the next release's content installs. The served leg proves what users get. At a version commit both carry the same marker.
8. **The served-archive source in CI — recommended: GitHub's real archive of `GITHUB_SHA` (codeload), required equal to local `git archive`, with no fallback in CI.** That is the exact service the registry downloads from (Rule #59), at no secret cost. Local runs use `git archive`, which CI checks against GitHub's archive on every run.

**Ledger inbox (Rule 17):**
- DW-689: addressed (Task 6; the route is superseded by #122).
- DW-694: addressed (served-leg matrix rows; Tasks 3 and 6).
- Declined DW-704: the #121 rework owns it. This amendment only removes IPM from the channels that have an owner setup the release can detect.
- Declined DW-707: unrelated. The marketplace pin window is unchanged, and the root `module.xml` reaches `main` at the same merge without effect while PublishPM is false.

**Interaction with in-flight work:**
- The #121 rework (another worktree) changes the store channels in `release.mjs` and leaves IPM alone. This rework runs **after it lands, on top of it**: it rebases onto #121's summary block and channel loop, and deletes the IPM push path #121 left in place (including any IPM `not set up` branch #121 may have added).
- 42.9 is editing `README.md`, `docs/` and `packages/client-config` in this tree; this rework touches only `README.md`'s Releasing section (decision 6), after 42.9 commits.
- The npm `1.0.0` run (42.6) is not touched.

**What the owner must do, and when (exact wording for the Planner):**
- **O-IPM, after the `v1.1.0` release run has published and `main` holds the `v1.1.0` version commit, and before any later version commit reaches `main`:**
  1. Sign in to Open Exchange and open https://openexchange.intersystems.com/package/IRIS-MCP-Server-Suite-2; choose Edit.
  2. Confirm the GitHub URL is exactly `https://github.com/jbrandtmse/iris-execute-mcp-v2` (it is today). The registry binds the package name `iris-execute-mcp-v2` to this URL permanently on the first publish.
  3. Tick **"Publish in Package Manager"**. Save, and send for approval if Open Exchange asks, because an edit to a published app is re-approved.
  4. Press **Release**. Enter version **`1.1.0`**, which must equal `<Version>` in the root `module.xml` of `main`, and paste the `[1.1.0]` section of `CHANGELOG.md` as the release notes.
  5. After the approval, tell the lead. The lead runs `pnpm release verify --version 1.1.0` (the IPM line turns `ok`) and the C3 install.
- **Every later release:** after its tag, press Release on the same listing with the new version, before the next version commit reaches `main`. Do not tick "Publish in Package Manager" or press Release before `v1.1.0`: until then `main`'s root module carries 1.0.0 with post-1.0.0 classes.
- **Never create a `master` branch in `jbrandtmse/iris-execute-mcp-v2`:** the registry reads `…/master/module.xml`, which today redirects to `main`.
- **No other owner setup.** There is no repository, deploy key or secret to create, and O-IPM1 is cancelled. If an `IPM_DIST_DEPLOY_KEY` secret was already added to the `release` environment, delete it.

**Spine amendment drafts (Rule 20, for the lead at this gate):**
- **AD-14 Binds:** replace `ipm/module.xml` with "the root `module.xml`, `ipm/`, `preload/`".
- **AD-14 "The IPM manifest", replace with:**

  > *(Story 42.4; root route Story 42.8, decision #122)*. The root `module.xml`, the stamped classes under `ipm/src/cls/` (SourcesRoot `ipm/src`) and the stamped guard `preload/ipm/src/cls/ExecuteMCPv2/InstallGuard.cls` are committed, output-only and generated by `scripts/gen-bootstrap.mjs --ipm` from `classes[]` plus one IPM-only preloaded class, `ExecuteMCPv2.InstallGuard`, whose source is `ipm/preload/ExecuteMCPv2/InstallGuard.cls` and whose content joins the marker's hash.
  >
  > The tree is regenerated only by the version step, so `main` always carries the last released content. `gen:ipm:check` recomputes the tree's hash against its own marker, and holds its version to the shared version. The module is `iris-execute-mcp-v2` at the npm version.
  >
  > Archives are built from the generated embed, never from `src/`. CI's `ipm` job proves, offline on both editions, that the embed's archive installs and that GitHub's archive of the commit installs after the registry's re-tar. `.gitattributes` export-ignores everything but `module.xml`, `LICENSE`, `README.md`, `ipm/src` and `preload`. Nothing but the guard lives under `preload/`.
- **AD-14 "Version-embedding artifacts", append:** "It runs `gen-bootstrap.mjs --ipm`, which stamps the root `module.xml` and the IPM tree; `prepare` in a release refuses a tree whose marker is not `BOOTSTRAP_VERSION` (decision #122)."
- **AD-29 Binds:** add "the root `module.xml`, `.gitattributes`".
- **AD-29 CI, replace the `ipm` sentence with:** "The `ipm` job builds the IPM archive from the embed and installs it offline on both editions, and fetches GitHub's archive of the commit (equal to `git archive`), re-tars it as the registry does and installs it offline on both editions, after `gates` and `throwaway` (Stories 42.4 and 42.8)."
- **AD-29 Channels, replace the IPM sentence with:** "IPM publishes through the existing Open Exchange listing `IRIS-MCP-Server-Suite-2`, which points at this repository: the registry reads the root `module.xml` of `main` and serves a re-tar of GitHub's archive of `main`. The release performs no IPM upload; the run reports the owner's Release press on that listing as a `manual step` (decision #122, superseding #76)."
- **AD-29 "IPM and the MCP Registry", replace the IPM half with:** "IPM has no push, key or packaging repository. A rehearsal reads `ready (manual step …)`, a version the registry lists is `already published`, and IPM never blocks or fails a run. `verify` reports IPM `pending` until the registry lists the version, then requires the served archive to equal `git archive v<version>`. No `master` branch may exist in the repository (the registry reads `master/module.xml` through GitHub's rename redirect)."
- **Capability map, "Published install" row:** "`ipm/`, root `module.xml`, `preload/`".
- **Stack and Deferred:** no change. "IPM's module version equals the npm version (AD-14)" still holds.

**Cost estimate.**
- About 24 hand-edited files:
  - 9 scripts or configs: `gen-bootstrap.mjs`, `ipm-archive.mjs`, `ci-ipm-archive.mjs`, `release-core.mjs`, `release.mjs`, `release-checks.mjs`, `release-version.mjs`, `ci-checks.mjs`, root `package.json`;
  - 4 config: `.gitattributes`, `.prettierignore`, `ci.yml`, `release.yml`;
  - about 16 test files;
  - 2 docs.
- 1 new lib (about 220 lines) and 1 new test file (about 300 lines).
- 37 generated files added (about 1.07 MB), 1 deleted (`ipm/module.xml`).
- Net code and tests about +1,000 / −900 lines; the deletions are mostly the push, host-key and packaging-root paths and their tests.
- One rework stage of medium size, comparable to 42.8's Task 5 plus Task 7. CI adds one fetch of about 250 KB per `ipm` run, and the legs are unchanged in count.

## Verification

**How to run:**
- From `/Users/jbrandt/git/iris-execute-mcp-v2` (verify with `git rev-parse --show-toplevel`), one command per foreground call, `timeout: 600000`.
- `UNARMED` is `env -u IRIS_HOST -u IRIS_PORT -u IRIS_USERNAME -u IRIS_PASSWORD -u IRIS_NAMESPACE -u IRIS_HTTPS -u IRIS_REQUIRE_LIVE -u IRIS_THROWAWAY -u NPM_TOKEN -u OVSX_PAT -u VSCE_PAT -u GITHUB_TOKEN -u IPM_DIST_DEPLOY_KEY -u GITHUB_ACTIONS -u GITHUB_SHA -u GITHUB_REPOSITORY CI=true`.
- No stage pushes, tags, triggers CI, publishes, calls IRIS or the shared instance, or touches `~/.claude`. Docker runs only through `scripts/throwaway-iris.mjs`, and only by the lead.
- Rebuild `@iris-mcp/shared` before tests that read its dist.

**Commands:**
- `(loop)` `for f in scripts/gen-bootstrap.mjs scripts/lib/ipm-tree.mjs scripts/lib/ipm-archive.mjs scripts/ci-ipm-archive.mjs scripts/lib/release-core.mjs scripts/release.mjs scripts/lib/release-checks.mjs scripts/release-version.mjs scripts/lib/ci-checks.mjs; do node --check "$f" || exit 1; done` -- expected exit 0.
- `(loop)` `pnpm gen:ipm:check && pnpm gen:bootstrap && git status --porcelain -- module.xml ipm preload packages/shared/src/bootstrap-classes.ts scripts/bootstrap-sequence.json` -- expected: OK, and no output from `git status`.
- `(loop)` `git ls-files -z | git check-attr --stdin -z export-ignore | tr '\0' '\n' | paste - - - | awk '$3!="set"{print $1}'` -- expected: exactly `LICENSE`, `README.md`, `module.xml`, the 35 `ipm/src/cls/**` files, the guard under `preload/`.
- `(loop)` `UNARMED pnpm --filter @iris-mcp/shared exec vitest run src/__tests__/bootstrap.test.ts src/__tests__/gen-bootstrap-write.test.ts` -- expected green.
- `(loop)` The story files of `@iris-mcp/all` -- expected green:
  ```sh
  UNARMED pnpm --filter @iris-mcp/all exec vitest run src/__tests__/ipm-tree.test.ts src/__tests__/ipm-manifest.test.ts src/__tests__/ci-ipm-archive.test.ts src/__tests__/ci-ipm-archive-tgz.test.ts src/__tests__/release-core.test.ts src/__tests__/story-42-8-release-core.test.ts src/__tests__/release-script.test.ts src/__tests__/release-prepare.test.ts src/__tests__/release-version.test.ts src/__tests__/release-workflow.test.ts src/__tests__/ci-workflow.test.ts src/__tests__/story-42-5-qa-real-oracles.test.ts src/__tests__/story-42-6-qa-gate-verify.test.ts src/__tests__/story-42-4-doc-claims.test.ts src/__tests__/story-42-5-doc-claims.test.ts src/__tests__/story-42-7-doc-claims.test.ts src/__tests__/story-42-8-doc-claims.test.ts
  ```
- `(once)` `UNARMED pnpm --filter <pkg> test`, one call per package: client-config, shared, admin, data, dev, interop, ops -- expected green.
- `(once)` `@iris-mcp/all` in shards, `UNARMED pnpm --filter @iris-mcp/all test -- --shard=k/8` for k = 1..8 -- expected green.
- `(once)` `pnpm --filter <pkg> lint` and `type-check`, per package -- expected 0 errors.
- `(once)` The root checks -- expected all OK, baseline `1e62c5ad5bf7`/141 intact:
  ```sh
  pnpm gen:governance-baseline:check
  pnpm gen:skills:check
  pnpm gen:pack:check
  pnpm gen:listings:check
  pnpm validate:prompts
  pnpm gen:tools-list-snapshot:check
  node scripts/check-epics-sync.mjs
  ```
- `(once)` Archive reality (read-only):
  - `git archive --format=tar.gz HEAD | wc -c` (expected about 0.25 MB, not 13.8 MB) and its member list equals the check-attr list above;
  - `gh api repos/jbrandtmse/iris-execute-mcp-v2/branches/master --jq .name` prints `main` (the redirect still holds).
- `(once)` The version-step rehearsal in a throwaway clone (`os.tmpdir()`, `git remote remove origin`, a throwaway patch changeset, `pnpm run version`; remove it afterwards). Expected:
  - root `module.xml` `1.0.1`;
  - tree marker equal to `BOOTSTRAP_VERSION` `1.0.1+…`;
  - `embeddedVersionProblems(…,{release:true})` `[]`;
  - `gen:ipm:check` clean;
  - `pnpm gen:ipm` then exits 2.

**Mutations (Rule 19; apply, observe red, revert, tree byte-identical; record each as a `mutation:` line):**
- `ipmTreeProblems` without the hash recompute → `ipm-tree.test.ts` "a hand-edited class is refused" red.
- Without the semver-equals-shared line → "version drift" red.
- Without the extra-file or preload-extra check → the matching rows red.
- `gen-bootstrap --ipm` without the same-version refusal → the refusal row red.
- `embeddedVersionProblems` without release-mode freshness → `release-prepare.test.ts` freshness row red.
- The IPM channel returning `published` → the `release-script.test.ts` manual-step row red.
- No `::warning::` for a manual step → the annotation row red.
- `verify` failing on `pending` → the pending row red. `verify` without the byte comparison → the listed-differs row red.
- The served leg falling back to `git archive` when the CI fetch fails → the fetch-404 row red.
- `registryArchiveProblems` without the missing-member check → its row red.
- `.gitattributes` without `/preload -export-ignore` → the check-attr pin red.
- `IPM_DIST_DEPLOY_KEY` re-added to `release.yml` → `release-workflow.test.ts` red.

**Shared surfaces:**
- The root `package.json` scripts: `prepare`'s check set, and the CI root-gate list in `ci-checks.mjs`.
- `RELEASE_CHANNELS` and `STATUS` in `release-core.mjs`.
- The `release.yml` publish env declaration in `release-checks.mjs`.
- The README Releasing table and paragraphs (doc-claims).
- `.gitattributes`.
- The path `ipm/module.xml`, which moves to `module.xml`, and `bootstrap.test.ts`'s manifest read.
- `gen-bootstrap-scratch.ts`'s input copy list.

Standing criterion: every test added or changed passes on a fresh environment, in either order. No check mutates the shared IRIS instance. The OS %UnitTest suite is not involved, because no ObjectScript changes.

**Lead checklist (after the rework commit):**
- **A1:** CI on the rework commit, both editions green. The `ipm` log must show:
  - `[served] GitHub's archive of <sha>: <n> files, equal to git archive HEAD and to the allow-list`;
  - `[registry-community] … installed` and `[registry-health] … installed`, with the tree's marker;
  - the build leg's `package` layout `ipm/src/cls/…` (adjust `archiveProblems` to IPM's real output if it differs).
- **A1b (Rule #59, the path the gate guards).** On a red branch `red/42-8-amend-122-a1b`:
  - **Commit 1** removes `/preload -export-ignore` from `.gitattributes` and the check-attr pin's assertion, so `gates` stays green and `ipm` runs. Expected: `ipm` red at the served member check, naming `preload/ipm/src/cls/ExecuteMCPv2/InstallGuard.cls`, on GitHub's real archive.
  - **Commit 2** also makes the member check report-only. Expected: `registry-community` and `registry-health` red at the install checks (the guard document is not 200 and the guard class is absent). The install path catches the defect independently.
  - Delete the red branch afterwards.
- **A2:** the release dry run (`release-dry-run/**` on the rework commit). Expected:
  - the IPM line reads `ready (manual step after the tag: Release <v> on the Open Exchange listing IRIS-MCP-Server-Suite-2; …)`;
  - the dry-run staleness note appears if the embed moved;
  - no IPM line is `not ready`;
  - nothing references `IPM_DIST_DEPLOY_KEY`;
  - the summary shows the "Manual steps" block.
- **Tag `v1.1.0`** (with 42.7 and 42.8's other prerequisites). The publish summary lists IPM under "Manual steps", and the run's exit does not depend on IPM.
- **O-IPM (owner only):** the steps above.
- **C2:** `pnpm release verify --version 1.1.0`: IPM `pending` before O-IPM, then `ok … its archive equals the tag's` after.
- **C3:** on a networked harness throwaway IRIS (never the shared instance), `zpm "install iris-execute-mcp-v2"`. Then `zpm "list"` shows `1.1.0`, `GetBootstrapVersion()` equals the tree marker of `v1.1.0`, the REST application answers 200, and the guard document answers 200. Then remove the container. Story 42.8 stays `in-progress` until C3, as before.

## Auto Run Result

Status: ready-for-dev
Blocking condition: none

**Summary.** The plan for decision #122:
- a root `module.xml` plus a committed, stamped tree (`ipm/src`, `preload/`), written only by the version step (`gen-bootstrap.mjs --ipm`) and guarded by `gen:ipm:check`'s self-hash;
- a `.gitattributes` allow-list, so GitHub's archive, which the registry re-tars, holds only the module;
- the DW-694 gate fetches GitHub's real archive of the commit and installs it on both editions offline;
- the IPM release channel loses its push, keys and packaging repository and becomes a reported `manual step`;
- `verify` checks the served archive against the tag once the owner has pressed Release.

There are eight orchestrator decisions, one owner step after `v1.1.0`, and spine drafts for AD-14 and AD-29.
