---
title: 'Story 42.6: Tarball Smoke and 1.0.0 Publish'
type: 'feature'
created: '2026-11-20'
status: 'done'
baseline_revision: 'fe7cae7cadd43fa0fcbcd165b2022721a7d2a75a'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-iris-execute-mcp-v2-2026-10-14/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-42-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-42-5-release-workflow.md'
warnings:
  - multiple-goals
  - oversized
deferred: []
---

<intent-contract>

## Intent

**Problem:** Nothing is on npm yet. The release workflow from 42.5 works, but four things stop `v1.0.0`:
- `ci-gate` accepts a `v*` tag on any commit with a green push run, including one that was never merged (DW-696, owner ruling, decision #82).
- `prepare` runs only the root scripts that end in `:check`, so `check:provenance` and `validate:prompts` never run on the publish path (DW-612).
- The tree is still at `0.0.x` with 62 pending changesets, the tarballs ship no `CHANGELOG.md` (DW-665), and the SDK pin is 2.3.1, whose bundled fast-uri 3.1.0 has advisories. `@modelcontextprotocol/server` 2.4.0 (2026-10-23) bundles fast-uri 3.1.8 (DW-637).
- No tarball has met a real MCP client against IRIS (DW-47), and nothing checks the registry after a publish (AC 42.6.3, DW-300).

**Approach:**
- **Code and the version commit (stages, on `epic42`):**
  - `ci-gate` refuses a tag run whose commit `main` does not contain, before it waits for CI.
  - `prepare` runs every root script that checks the tree, the same set CI's `gates` job runs.
  - Every package ships `CHANGELOG.md`.
  - The SDK pin moves to 2.4.0.
  - `pnpm run version -- --first-release` puts all eight packages at `1.0.0`, and the root CHANGELOG gets its `1.0.0` section.
  - New `release.mjs verify` checks the registry after a publish.
  - New `ci-package-smoke.mjs --keep <dir>` leaves an installed project behind for the real-client smoke.
- **The tag, the approval and the publish (lead, in order, after the mid-epic merge, decision #83):** the `## Verification` lead checklist.

## Boundaries & Constraints

**Always:**
- **Order inside the implement stage.** The version step runs first, on the clean tree the stage starts from, before any other edit: `pnpm run version -- --first-release` refuses a dirty tree. Its output is kept as it is (generated). Every later edit lands on top of it in the same story diff.
- **The tag commit must pass `prepare` in release mode.** All eight packages at `1.0.0`, no pending `.changeset/*.md`, `BOOTSTRAP_VERSION` `1.0.0+2.244fe8623c76`, `ipm/module.xml` `1.0.0`, `gen:bootstrap` a no-op, and every root check green. So this story adds **no changeset**: its own changes are named in the root `1.0.0` section.
- **The main-reachability rule (DW-696):**
  - It applies to a release-mode run (a push of `refs/tags/v<x.y.z>`). The check is `GET {api}/repos/{repo}/compare/main...{sha}`, with `status` `identical` or `behind` meaning reachable.
  - `ahead`, `diverged`, any other status, a non-2xx answer (404 for an unknown commit), a network error or a stall → refusal (exit 1), fail closed.
  - It runs after the environment guard and **before** the CI poll, so the refusal is immediate and no environment approval is ever requested.
  - A dry run prints one report line ("on main" / "not on main … a tag run stops here" / "unreadable …") and goes on.
  - No maintenance-branch allowance. The branch name is the constant `RELEASE_BRANCH = 'main'` in `release-core.mjs`.
- **Release checks = CI checks (DW-612).** `releaseCheckScripts` selects the root scripts whose name has a `check` or `validate` word (`(^|:)(check|validate)(:|$)`), the Rule #56 pattern of `ci-workflow.test.ts`. It still leaves out lifecycle hooks and `RELEASE_CHECK_EXEMPTIONS` (`format:check`). A test holds that set equal to the `pnpm …` entries of CI's root gate list.
- **42.5's constraints stay:**
  - `release.mjs` statically imports only `node:` builtins, `release-core.mjs` and `script-process.mjs`; `verify` loads anything else by `import()`.
  - `release-core.mjs` stays pure.
  - Error text has the form `<what happened>. <what to do>.`
  - Rule 14 escapes; Rule #55: no heredoc writes.
  - New code imports only builtins and existing repository modules.
- **`verify` is read-only.** It runs `npm view` and an `npx -y` start in a clean temporary `HOME`, npm cache and working directory, against a closed local port (`CLOSED_PORT_ENV`). It never publishes, deprecates, logs in, writes a userconfig or reaches IRIS.
- **`ci-package-smoke.mjs` with no argument is unchanged** (CI's `package` job). `--keep <dir>` runs the same smoke, installs into `<dir>`, keeps it, and writes `<dir>/.mcp.json`. `<dir>` must be absent or empty, and must not be inside the repository.

**Never:**
- **No publish-shaped command on the real tree.** Never `npm`/`pnpm publish`, `changeset publish`, `npm deprecate`, `npm login`, `npm trust`, `git tag`, `git push`, `gh release`, `gh workflow run`, `gh secret`, or a non-GET `gh api`. No stage creates or edits a GitHub environment, secret or setting. The one sanctioned version run is the implement stage's single `pnpm run version -- --first-release` (Orchestrator decision 1).
- **No docker and no IRIS call** in any stage (the real-client smoke and every throwaway are the lead's). No edit to protected surfaces:
  - ObjectScript classes and REST routes;
  - the governance baseline (`1e62c5ad5bf7`/141);
  - frozen goldens (`sdk-wire-golden.json`, `sdk-handler-golden.json` and the sanctioned-change ledger);
  - `irislib/` and `irissys/`.
  - `BOOTSTRAP_VERSION` moves ONLY through the version step's `gen:bootstrap`.
- **No new `.changeset/*.md`.** No change to `ci.yml`. No change to the `release.yml` jobs, steps, permissions or triggers: only its header comment may change.
- **No `npm unpublish`**, no prerelease tag, no `0.0.0-stage` placeholder, and no maintenance-branch path.
- **Never edit the per-package `CHANGELOG.md` files by hand.** They are the version step's output.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Tag on main: identical | release mode; compare `main...sha` → 200 `status: identical` | Line `commit <sha> is on main (compare: identical)`; the CI poll follows | — |
| Tag on main: behind | 200 `status: behind` (an older commit of main) | Same line with `behind`; the CI poll follows | — |
| Tag off main (DW-696) | 200 `status: ahead` or `diverged` | `refusing the tag run: <sha> is not on main (compare main...<sha>: <status>). Merge it to main, then tag the merged commit. No later job runs.`; exit 1; the CI runs are never read | expected refusal |
| Compare unreadable | release mode; non-2xx (404 unknown commit, 403), network error, 30 s stall, or a body without a known `status` | exit 1 naming the cause (`HTTP 404` …), before the CI poll | fail closed |
| Environment guard and main both fail | unprotected environment and `ahead` | Both refusal lines printed, exit 1 (the compare call still runs) | expected refusal |
| Dry run | `release-dry-run/**` push or dispatch; any compare result | One report line (`on main` / `not on main (<status>); a tag run stops here` / `unreadable (<why>); a tag run stops here`); the CI poll follows | never fails on this |
| Release checks | real root `package.json` | `releaseCheckScripts` = `check:provenance`, `gen:governance-baseline:check`, `gen:pack:check`, `gen:skills:check`, `gen:tools-list-snapshot:check`, `validate:prompts` (sorted; today it returns only the four `gen:*:check`, verified 2026-11-20); `format:check` reported "not run" | a failing one → `prepare` exit 1 naming it (42.5 path) |
| verify: published | each package `npm view <name>@<v> version dist.attestations --json` → version `<v>`, `dist.attestations.provenance.predicateType` starting `https://slsa.dev/provenance/`; `npx -y @iris-mcp/dev@<major>` in a clean temporary `HOME`, npm cache and working directory answers `initialize` with `serverInfo.version` `<v>` | One `ok` line per package and one for the npx start; exit 0 | — |
| verify: not published | E404 / `is not in this registry` (today) | `<name>@<v>: not on the registry` per package; the npx start is reported failed; exit 1 | expected before the publish |
| verify: no provenance | version present, `dist.attestations` missing | `<name>@<v>: published without a provenance attestation`; exit 1 | — |
| verify: usage | no `--version`, a non-`x.y.z` version, a major other than `1`, an unknown flag | exit 2 with usage | — |
| Smoke `--keep` | `node scripts/ci-package-smoke.mjs --keep <dir>`; built tree | The usual smoke, installing into `<dir>/` and keeping it. `<dir>/.mcp.json` names the five servers, each `{"command":"npx","args":["--no","--","<bin>"],"env":{IRIS_HOST…IRIS_NAMESPACE as "${VAR}"}}`. Prints the next steps; exit 0 | `<dir>` non-empty, inside the repository, or a second argument → exit 2 before packing; a smoke failure → exit 1 and `<dir>` left for inspection |

</intent-contract>

## Code Map

**The release (42.5; extend, never copy, Rule 2)**
- `scripts/lib/release-core.mjs`:
  - constants block :17-73 (`RELEASE_ENVIRONMENT` :39, `RELEASE_CHECK_EXEMPTIONS` :49 and its doc comment "whose name ends in `:check`" to reword);
  - `releaseMode` :111;
  - `ciGateDecision` :210, the sibling of the new pure `mainReachability(answer)` → `{ state: 'on-main' | 'off-main' | 'unreadable', status?, line, problem? }`;
  - `environmentProblems` :249.
- `scripts/release.mjs`:
  - header CONTRACT :11-37 (add the main rule and `verify`);
  - `githubGet` :277 and `apiRoot` :299, reused for the compare call;
  - `readEnvironmentGuard` :306, the sibling shape for a `readMainReachability(deps, env, sha)`;
  - `runCiGate` :369-419: insert the main check after the guard block (:382-392) and before `runsUrl` (:394);
  - `releaseCheckScripts` :478-486, to widen;
  - `runPrepare` :599 (checks loop :645-651, unchanged);
  - `USAGE` :1122, `parseArgs` :1133, `main` :1189: add the `verify` command;
  - `viewOutcome` :828 and the `npmViewArgv` builder (core :329) for `verify`'s npm view (extend `npmViewArgv` or add `npmViewJsonArgv`; keep the "only argv builders form a publish verb" contract).
- `scripts/lib/release-checks.mjs` :63-71 (`ci-gate` step) — unchanged; `release.yml` keeps `contents: read` on `ci-gate`, which the compare API needs (verified by a read-only GET on 2026-11-20).
- `scripts/lib/ci-checks.mjs` :285 `ROOT_GATE_SCRIPTS`: export it for the parity test (no value change; `ci-workflow.test.ts` stays green).
- `scripts/ci-package-smoke.mjs`:
  - `smokePackages` :185 (the install dir `work/install` at :221; the cleanup at :244);
  - `main` :272 (exit 2 on any argument today; `ci-package-smoke.test.ts` pins it);
  - `snapshotServers` :79, `binsOf` :59, `installManifest` :71, `cleanEnv` :124, `checkServer` :141 (the npx `--no` start precedent for `verify`).
- `scripts/lib/sdk-wire-golden-core.mjs`: `openRawWire({command,args,cwd,env})` :258, `handshake` :363, `CLOSED_PORT_ENV` :38 (for `verify`'s npx start).
- `scripts/release-version.mjs`: the version step. Probe (2026-11-20, throwaway clone of `233c4e5`): `--first-release` exits 0, consumes all 62 changesets, puts the 8 packages at `1.0.0`, creates `packages/client-config/CHANGELOG.md`, prepends `## 1.0.0` to the other seven, and prints ``BOOTSTRAP_VERSION` moves from `0.0.2+2.244fe8623c76` to `1.0.0+2.244fe8623c76``. 80 files, +2245/-934. `ipm/module.xml` `<Version>1.0.0</Version>`.

**Tests to extend** (all in `packages/iris-mcp-all/src/__tests__/`, in the default suite)
- `release-core.test.ts`: the pure-function tables.
- `release-script.test.ts`:
  - `describe("CI gate (AC 42.5.1)")` :195 and the environment-guard block :301, which use `gateDeps`/`TAG_ENV`/`DRY_ENV`;
  - the stalled-fetch block :391;
  - the static-import pin :77.
- `release-script-fixtures.ts`: `newFakeGithub` :59, `answerFor` :70 (add a `compare` answer, default `identical`), `fakeFetch` :82, `SHA` :14.
- `story-42-5-qa-real-oracles.test.ts`: precedent for bodies captured from the real API (Rule #36).
- `release-prepare.test.ts`: `releaseCheckScripts` cases (G8).
- `release-workflow.test.ts`: the `parseArgs` feed of `RELEASE_JOBS` run lines (G11; `verify` is not a workflow step).
- `ci-workflow.test.ts` :411-445: the Rule #56 block, whose regex the release now shares.
- `ci-package-smoke.test.ts`, `release-smoke-prebuilt.test.ts`, `smoke-repo-fixture.ts` (the offline synthetic smoke repo, for `--keep`).
- `package-manifests.test.ts` :241-248 (`files` assertions).
- `pack-fixture.ts` and `pack-provenance.test.ts`: real `pnpmPack` precedents.
- `changelog-bootstrap-move.test.ts`: the newest section naming a move must end at the embed's marker. The `1.0.0` section must name `0.0.2+2.244fe8623c76` → `1.0.0+2.244fe8623c76`, under a heading that starts `## [`.
- `story-42-5-doc-claims.test.ts`: pins the 42.5 section by position after 42.4, and `### Releasing` after `### Continuous Integration`.
- The `.changeset` readers (`story-42-1-qa-changeset-readers.test.ts` with `hide-changesets-preload.mjs`) already prove they tolerate consumed changesets. `release-1-0-0-mechanism.test.ts` fixture rows `skipIf(released)` by design (42.1); its real-tree rows run always.

**SDK pin (DW-637)**
- `packages/shared/package.json` :80 (`@modelcontextprotocol/server`) and :85 (`client`), `packages/iris-dev-mcp/package.json` :59, `packages/iris-mcp-all/package.json` :40 (`client`), and `pnpm-lock.yaml`.
- Pin literals:
  - `story-43-1-sdk-confinement.test.ts` :26 `PINNED`, :141, :185;
  - `story-43-1-qa-pack-confinement.test.ts` :10, :109-118;
  - `story-43-3-validator-unreachable.test.ts` header :4-5 (fast-uri 3.1.0 → 3.1.8; the tripwire stays);
  - `fixtures/tools-list-snapshot.json` `sdkVersion` (regenerate with `pnpm gen:tools-list-snapshot`, never by hand).
- Header comments that cite "SDK 2.3.1" as the capture provenance of a frozen golden stay as they are: they record how the golden was captured. These are `story-43-1-sanctioned-wire-changes`, `story-43-2-chokepoint-both-eras` and `story-43-3-confirmation-both-eras`.
- `story-43-3-doc-claims.test.ts` pins the historical CHANGELOG sentence about bumping once a release pins fast-uri 3.1.8. Leave it.
- **Plan-stage probe** (2026-11-20, throwaway clone of `233c4e5` with its own install; no IRIS, no docker):
  - **Only three manifests pin the SDK.** The pins are in shared (server, plus client as a dev dependency), dev (client, dev) and all (client, dev). The launcher and the root pin none.
  - **The lockfile** then resolves server, client and core at 2.4.0, with one core. zod stays 4.3.6. Every package builds.
  - **The wire is byte-identical** on 2.4.0: shared `sdk-wire-compat` 116/116, the 13 epic-43 files 590 + 179, and `epic43-capstone-gate` green. `gen-tools-list-snapshot --check` passes, because it does not compare `sdkVersion`.
  - **Exactly 12 tests fail, all on the pin literal.** Nine are in `story-43-1-sdk-confinement.test.ts` (`PINNED` :26, titles :141, :185) and three in `story-43-1-qa-pack-confinement.test.ts` (:116, :118, title :109).
  - **No exposure to the 2.4.0 changes.**
    - No source uses `x-mcp-header`, `.meta(`, `"$id"` or a root `$ref`.
    - `outputSchema` is always `z.toJSONSchema(z.object(...))`.
    - The snapshot has no `outputSchema`, which the spine's Deferred "Output schemas on the wire" also says.
  - **The full suites stay green:** shared 2575/2575 and dev 1490 passed, 319 live-skipped.

**Docs**
- `README.md` `### Releasing` :1101-1130: steps 3-4 gain the main rule; a `verify` step after approval.
- `CHANGELOG.md` :1: the new top section.

## Tasks & Acceptance

**Execution** (dependency order):

*Step 0: the version step (first, on the clean starting tree).*
- [x] Confirm `git status --porcelain` is empty and `BOOTSTRAP_VERSION` is `0.0.2+2.244fe8623c76`.
- [x] Run `pnpm run version -- --first-release` once.
- [x] Record the printed move literal in the spec's Verification, and keep every file it changed as it left them. DW-300.

*The release gate (DW-696).*
- [x] `scripts/lib/release-core.mjs`:
  - add `RELEASE_BRANCH = 'main'`;
  - add the pure `mainReachability({ status, body } | { error }, sha)` per the matrix rows (the statuses `identical`/`behind` are on main; anything else, a non-2xx status or an error is not);
  - add `compareUrl(api, repo, sha)` → `${api}/repos/${repo}/compare/${RELEASE_BRANCH}...${sha}?per_page=1`.
- [x] `scripts/release.mjs` `runCiGate`:
  - after the environment-guard block, read the compare answer through `githubGet` and judge it with `mainReachability`;
  - release mode: collect the guard refusal and the main refusal, print each, and return 1 if either fails, before `runsUrl`;
  - dry run: one report line, then go on;
  - update the header CONTRACT item 2.
- [x] `.github/workflows/release.yml`: header comment only ("ci-gate … and refuses a tag whose commit is not on main"). The self-test strips comments; no declared shape changes.

*The release checks (DW-612).*
- [x] `scripts/lib/release-core.mjs`:
  - export `ROOT_CHECK_SCRIPT = /(^|:)(check|validate)(:|$)/`;
  - reword the `RELEASE_CHECK_EXEMPTIONS` doc.
- [x] `scripts/release.mjs` `releaseCheckScripts`: select by `ROOT_CHECK_SCRIPT` in place of `endsWith(':check')`, keeping `isHook` and the exemptions; update its doc comment.
- [x] `scripts/lib/ci-checks.mjs`: `export` `ROOT_GATE_SCRIPTS` (value unchanged).
- [x] `ci-workflow.test.ts` :419 may import `ROOT_CHECK_SCRIPT` instead of its inline regex (Rule 2, one source); its assertions stay.

*The CHANGELOG in the tarballs (DW-665; Orchestrator decision 2).*
- [x] Every `packages/*/package.json` `files`: add `"CHANGELOG.md"`, after `dist`/`skills-pack` and before the `!` exclusions. In `@iris-mcp/all` it is `["CHANGELOG.md"]`. pnpm packs a listed file only when it exists, and all eight exist after Step 0.

*The SDK (DW-637; Orchestrator decision 3).*
- [x] Change the exact pins `2.3.1` → `2.4.0`: `@modelcontextprotocol/server` and `client` in `packages/shared/package.json`, and `client` in `packages/iris-dev-mcp/package.json` and `packages/iris-mcp-all/package.json`. Then run `pnpm install` (lockfile update) and rebuild every package.
- [x] Update the 12 pin literals the probe found (Code Map).
- [x] Replace the false `2.3.1 / fast-uri 3.1.0` claim in the header of `story-43-3-validator-unreachable.test.ts` with the true one (2.4.0 bundles fast-uri 3.1.8; the tripwire stays, Rule 14).
- [x] Do not regenerate `tools-list-snapshot.json` (a protected surface): its check passes. Its `sdkVersion` metadata reads 2.3.1, and the Design Notes record that.
- [x] If any frozen golden or `tools/list` byte differs on 2.4.0 (the probe saw none), stop the bump:
  - revert to 2.3.1 everywhere;
  - add a `deferred:` item with the differing bytes;
  - continue the story.
  - Never edit a golden. The 43.3 tripwire keeps the advisories unreachable, so the bump never blocks the release.

*verify (AC 42.6.3).*
- [x] `scripts/release.mjs`: a `verify --version <x.y.z>` command, exported `verify(options, deps)` on the `ciGate`/`prepare`/`publish` pattern, with every side effect in `deps`. It follows the matrix rows.
  - It walks `NPM_PUBLISH_ORDER` with `npm view <name>@<v> version dist.attestations --json`, judged by a pure `registryProblems(name, version, viewResult)` in `release-core.mjs`; `viewOutcome`'s E404 words mean "not on the registry".
  - Then `npx -y @iris-mcp/dev@1` through `openRawWire`/`handshake` (dynamic `import()`), with a temporary `HOME`, `npm_config_cache` and `cwd` removed on every exit path, and `CLOSED_PORT_ENV`.
    - The spec is the literal `@iris-mcp/dev@1`, because `scripts/lib/npx-pin-scan.mjs` (AD-29, `npx-pin.test.ts`) flags any other token, including `@${major}`.
    - A `--version` whose major is not `1` exits 2: "verify launches the @1 major. Update its pinned spec with the next major."
  - It prints one line per check, appends to `$GITHUB_STEP_SUMMARY` when set, and exits 0, 1 or 2.
  - `pnpm release verify --version 1.0.0` works through the existing alias.

*The real-client smoke helper (AC 42.6.1).*
- [x] `scripts/ci-package-smoke.mjs`:
  - `main` accepts exactly `--keep <dir>` (anything else → exit 2 with the usage line, as today);
  - `smokePackages({ keep })` installs into `<dir>` (absent or empty, absolute after resolve, outside `REPO_ROOT`) and skips removing it;
  - it writes `<dir>/.mcp.json`, five servers from `snapshotServers`, each as in the matrix;
  - it prints `cd <dir>`, `export IRIS_HOST=… IRIS_PORT=… IRIS_USERNAME=… IRIS_PASSWORD=… IRIS_NAMESPACE=…`, then `claude`;
  - with no argument, the behavior and the output are unchanged.

*Docs.*
- [x] `README.md` `### Releasing`:
  - step 3: commit and merge to `main`, CI green on the merged commit;
  - step 4: tag the commit on `main`; `ci-gate` refuses a tag whose commit `main` does not contain;
  - new step 6: `pnpm release verify --version <x.y.z>`;
  - the `prepare` sentence says it runs every root check script that CI runs.
- [x] `CHANGELOG.md`: a new top section `## [1.0.0] — <date of the version commit> — Story 42.6: Tarball Smoke and 1.0.0 Publish`, holding:
  - the first public release: all eight `@iris-mcp/*` at `1.0.0` on npm with provenance, one shared version, launched as `npx -y @iris-mcp/<pkg>@1`, Node `>=22.17.0`;
  - "`BOOTSTRAP_VERSION` moves from `0.0.2+2.244fe8623c76` to `1.0.0+2.244fe8623c76`" (the printed literal; class content unchanged);
  - each package's own `CHANGELOG.md` has its `## 1.0.0` section and now ships in the tarball;
  - the SDK `2.4.0` bump (fast-uri 3.1.8; wire unchanged), or, if reverted, nothing;
  - the release now refuses a tag that is not on `main`, and runs `check:provenance` and `validate:prompts` in `prepare`;
  - `release.mjs verify` and `ci-package-smoke.mjs --keep`;
  - the per-story "Pre-release" sections below are the history up to 1.0.0.
  - No tool, prompt, governance or wire change. Claims only what is true at the commit.

*Tests (unit and process; Rule 19 mutation lines for each).*
- [x] `release-core.test.ts`: `mainReachability` over every status (`identical`, `behind`, `ahead`, `diverged`, a missing or unknown `status`, 404, 500, `{error}`); `compareUrl`; `ROOT_CHECK_SCRIPT` positives and negatives; `registryProblems` (published, missing, no attestation, wrong predicate, wrong version).
- [x] `release-script.test.ts`:
  - ci-gate flows (fake GitHub with a `compare` answer):
    - `ahead` → exit 1 with the refusal text, and the fake recorded no `/actions/runs` request;
    - `identical` and `behind` → pass;
    - 404, 500, a network error and a stall → exit 1 before the runs read;
    - an unprotected environment plus `ahead` → both lines, exit 1;
    - a dry run plus `ahead` → report line, exit 0 on a green run;
    - the compare request carries the token and names `main...<sha>`.
  - `verify` flows with stand-in `npm`/`npx` (the 42.5 stand-in mechanism) and an injected wire: all published → 0; one E404 → 1 naming it; no attestation → 1; usage → 2; temporary dirs removed.
  - The static-import pin is unchanged.
- [x] `story-42-6-qa-real-oracles.test.ts` (new) or the 42.5 oracle file: compare bodies captured by read-only `gh api -X GET repos/jbrandtmse/iris-execute-mcp-v2/compare/main...<sha>?per_page=1` for `identical`, `ahead` and `behind`, plus the 404 body. Reduce them to `{status, ahead_by, behind_by, total_commits}` and `{message, status}`, and cite the command and date in the header (Rule #36).
- [x] `release-prepare.test.ts`:
  - `releaseCheckScripts` over the real root `package.json` equals the matrix row;
  - `releaseCheckScripts(...)` mapped to `pnpm <name>` equals, as a set, the `pnpm `-prefixed entries of `ROOT_GATE_SCRIPTS` (parity; red when a new CI root check is missing from `prepare`, and when `prepare` runs one CI does not);
  - a fake `run` that fails `check:provenance` makes `prepare` exit 1 naming it.
- [x] `package-manifests.test.ts`: every publishable package's `files` contains `CHANGELOG.md`, and the file exists with `## 1.0.0` as its first `## ` heading.
- [x] A real-pack test (the pattern of `pack-provenance.test.ts`/`pack-fixture.ts`; its existing skip conditions and time budget) asserts that each of the eight tarballs lists `CHANGELOG.md`.
- [x] `ci-package-smoke.test.ts` / `release-smoke-prebuilt.test.ts`: `main(['--keep', dir])` argument handling (non-empty dir, inside-repo dir, extra argument → 2); `--keep` over the offline synthetic smoke repository leaves `<dir>/node_modules` and a `.mcp.json` whose five entries match the matrix; `main([])` behavior unchanged.
- [x] `story-42-6-doc-claims.test.ts` (new):
  - the `1.0.0` section is the top `## [` section, names the move literal, and names the main rule, the checks, `verify` and the CHANGELOG shipping;
  - the README `### Releasing` names the main rule and `pnpm release verify --version`;
  - pin by title and relative order (the 42.5 doc-claims precedent), never `titles[0]` of a later story.
- [x] Update every existing test the version step or the SDK bump turns red. Never weaken an assertion: replace a literal with the new true value, or derive it from the tree. The probe found exactly these:
  - the 12 SDK pin literals above;
  - `changelog-bootstrap-move.test.ts`, which the new root section fixes (expected `1.0.0+2.244fe8623c76`, got the 42.4 section's `0.0.2+…`).
  - The 37 files that read `.changeset/*.md` pass, with 38 skips by design (`skipIf` on a consumed changeset, the 42.1 mechanism rows).
  - `story-42-1-qa-records` refuses a root `1.0.0` section while a package is below 1.0.0, which is why the section is written only after Step 0.

**Acceptance Criteria:**
- **AC 42.6.1 (DW-47):**
  - Given a built tree, when `node scripts/ci-package-smoke.mjs --keep <dir>` runs, then the eight tarballs are installed into `<dir>` from `file:` tarballs only, the five servers answer `initialize` and `tools/list` through `npx --no`, and `<dir>/.mcp.json` launches each through `npx`.
  - Given that project and an IRIS (lead checklist A4), when Claude Code makes one read call per server, then each returns a result, and the record names the call, the server and the deployed marker.
- **AC 42.6.2 / DW-300:**
  - Given the story commit, when `prepare` runs in release mode for `v1.0.0`, then the version state is "8 packages at 1.0.0, no pending changeset", and every root check passes. Locally: `readReleaseFacts` + `versionProblems(…, 'release')` with `tagVersion: '1.0.0'` returns `[]` on the committed tree.
  - The tag and the publish are lead checklist B4-B6.
- **AC 42.6.3:**
  - Given today's registry, when `node scripts/release.mjs verify --version 1.0.0` runs, then it exits 1 naming each package as not on the registry (the red leg, run by the implement stage and the lead).
  - Given the published release, when it runs again, then it exits 0 (lead checklist B7).
- **DW-696:** Given a release-mode run whose compare status is `ahead` or `diverged`, when `ci-gate` runs, then it exits 1 before reading the CI runs or requesting approval. Given `identical` or `behind`, it proceeds. Proven on the real path by lead checklist A3: a `v0.0.3` tag on the unmerged `epic42` story commit, with a green push run, is refused.
- **DW-612:**
  - Given the real root scripts, when `prepare` selects its checks, then they equal CI's root `pnpm` gates, `check:provenance` and `validate:prompts` included.
  - Given a throwaway clone whose commit breaks `check:provenance` (and one that drifts the pack), when the real `node scripts/release.mjs prepare` runs in dry-run mode with no docker on `PATH`, then it exits 1 naming that check. The unbroken control prints `<check>: ok` for every check and exits 3 (no docker).
- **DW-665:** Given the story commit, when each package is packed, then its tarball holds `CHANGELOG.md`, whose first `## ` is `## 1.0.0`.
- **DW-637:** Given the bump, when the epic-43 wire suites run, then every frozen golden is byte-identical. The pins read 2.4.0, and the lockfile resolves `server`, `client` and `core` at 2.4.0 alone. The fallback rule applies otherwise.

## Spec Change Log

## Review Triage Log

### 2026-11-20 — Review pass
- verdicts: 32 findings — high 0, medium 4, low 26, false 2, maybe-false 0
- findings:
  - `[low]` `[patch]` Blind 1: `verify --version 1.0.0` fails once `@1` resolves to a later 1.x — real; fixed by naming the cause in the mismatch error and one README clause (release.mjs, README step 6).
  - `[low]` `[reject]` Blind 2: verify reads npm only — CONTRACT item 8 and the README already say "the registry"; the fix is prose only and nothing is misreported.
  - `[low]` `[reject]` Blind 3: attestation presence, not validity — the matrix row defines the check as presence of a `https://slsa.dev/provenance/` predicate; signature checking is `npm audit signatures` territory and needs an install.
  - `[medium]` `[patch]` Blind 4: `verifyEnv` still passes `NODE_AUTH_TOKEN` and other `npm_config_*` variables (a registry override changes what verify reads) — `NPM_CONFIG_*` and `NODE_AUTH_TOKEN` are now dropped; the env test pins both.
  - `[low]` `[patch]` Blind 5: `ROOT_CHECK_SCRIPT` comment overstated a single source — comment corrected.
  - `[medium]` `[patch]` Blind 6: second half of "parity is red both ways" is local set arithmetic that cannot fail (Rule 19) — removed; the row is retitled to the half that drives `releaseCheckScripts`.
  - `[low]` `[reject]` Blind 7: `diverged` not captured from the real API — a diverged compare needs a diverged branch that does not exist; the status is the documented enum and the off-main set is pinned by a hand-made body only for that value.
  - `[low]` `[patch]` Blind 8: `--keep` early failures left the directory with no message — the kept-for-inspection line is now printed on the missing-tarball and `npm install` failures too.
  - `[low]` `[reject]` Blind 9: next steps omit the project-server approval and the unset-variable failure — A4 of the lead checklist names both; one more printed line changes the unchanged-shape output for no failure.
  - `[low]` `[patch]` Blind 10: CHANGELOG said all eight packages launch as `npx -y @iris-mcp/<pkg>@1` — reworded to the five servers; the doc-claims pin follows.
  - `[low]` `[reject]` Blind 11: capture date 2026-11-21 vs 2026-11-20 — the capture ran at 02:00 UTC on the 21st, 18:00 local on the 20th; both are true.
  - `[low]` `[patch]` Edge 1: a repo-internal directory named `..x` was judged outside — segment-wise test (`..` or `..` plus separator); pinned by a new row.
  - `[low]` `[patch]` Edge 2: early failures leave a half-built `--keep` directory silently — same fix as Blind 8.
  - `[low]` `[reject]` Edge 3: `<dir>/tarballs/<pkg>/extracted` trees sit in the kept project — the install manifest's `file:` specs resolve to them, so they must stay; a client reads only `.mcp.json` and `node_modules`.
  - `[low]` `[patch]` Edge 4: `--keep ""` resolved to the current directory — an empty value is now a usage error (exit 2), pinned in the `main` row.
  - `[low]` `[patch]` Edge 5: a dangling symlink passed `existsSync` — `lstatSync` now sees it; pinned by a new row.
  - `[low]` `[patch]` Edge 6: floating `@1` against `--version` — same fix as Blind 1.
  - `[medium]` `[patch]` Edge 7: `verifyEnv` is a denylist — same fix as Blind 4; an allowlist rewrite is not warranted by a read-only lead command.
  - `[low]` `[patch]` Edge 8: a rejecting `wire.close()` would replace the exit code — wrapped; the verdict is already judged.
  - `[false]` `[reject]` Edge 9: the compare read runs for non-release runs — the dry run must print its report line (matrix row), the workflow runs only on a tag or a `release-dry-run/**` push, and `GITHUB_REPOSITORY` is set on every runner; the environment guard does the same read.
  - `[low]` `[patch]` Edge 10: README/CHANGELOG verify claim vs floating `@1` — same fix as Blind 1.
  - `[low]` `[patch]` Edge 11: "clean environment" wording vs inherited variables — the denylist now covers every npm config and auth variable; PATH, proxy and locale variables are inherited by design.
  - `[low]` `[patch]` Gap 1: the signal-time cleanup registration of `verify` was never observed — the row now records `cleanups.add` and fails when the registration is removed (mutation line added).
  - `[low]` `[patch]` Gap 2: the `.mcp.json` order assertions use `toEqual` and ignore key order — now `JSON.stringify` equality and `Object.keys` order.
  - `[medium]` `[patch]` Gap 3: parity "both ways" half cannot fail — same fix as Blind 6; its mutation line now names one red row.
  - `[low]` `[reject]` Gap 4: sub-row behaviours (usage refusals, env isolation, `--keep` refusals) lack their own `mutation:` line — Rule 19 asks one demonstrated mutation per AC; each AC (42.6.1, 42.6.3, DW-696, DW-612, DW-665, DW-637) has one. Two lines were added for the rows patched in this pass.
  - `[low]` `[reject]` Gap 5: AC 42.6.2 is proven by a one-shot command — a permanent real-tree release-mode pin goes red at the next pending changeset; the command is in `## Verification` and lead checklist A2 runs `prepare` in release shape.
  - `[low]` `[reject]` Gap 6: `verify`'s `npx` child is not in `activeChildren` — `openRawWire` has a 240 s timeout and `verify` is a lead-run read-only command; reopen_if a signalled verify is seen to leave a process.
  - `[low]` `[reject]` Gap 7: the live wire success path is exercised only through a fake — the real-process row covers the failure path and lead checklist B7 covers the success path on the real registry; the fake's shape was checked against `handshake`/`openRawWire`.
  - `[low]` `[reject]` Gap 8: capture date — same as Blind 11.
  - `[false]` `[reject]` Intent 1: CI's epics-sync step is not in `prepare` — Design Notes state it is a planning-document check, not a package script, kept by CI only; the intent says "root script".
  - `[low]` `[reject]` Intent 2: capture-date observation — same as Blind 11.

## Design Notes

**Governing ADs and conventions (Rule 6):**
- **AD-29:**
  - Versions: one shared version from `1.0.0`, no prerelease; until 42.6 no story runs `changeset version`.
  - Publishing: a tagged, CI-green commit, through the approved environment, with provenance. The release workflow, npm credentials (decision #75), channels (`v1.0.0` is npm only, #77) and the bad-release policy (#78).
- **AD-14:** the version-embedding artifacts. `pnpm run version -- --first-release`'s `gen:bootstrap` is the only thing that moves `BOOTSTRAP_VERSION`, and the tag commit passes every `:check`.
- **AD-15:** no tool, wire or governance change, so no sanctioned change. The SDK bump is proven byte-identical on the frozen goldens.
- **AD-32:** the SDK v2 packages pinned exactly. The Stack row says the next bump waits for a release with fast-uri 3.1.8 or later, and 2.4.0 is one.
- **AD-28:** names imply no endorsement; `check:provenance` guards the notice.
- **AD-2:** cross-package checks live in `iris-mcp-all` and `scripts/lib`.
- **Conventions:**
  - error text;
  - live testing on a shared instance (throwaways only through the harness, and only by the lead);
  - live gates;
  - Stack rows Node, pnpm, `@changesets/cli` and SDK;
  - Deferred "Release operations".

**Why this shape:**
- **The compare API, not `git merge-base`.** `ci-gate` checks out at depth 1 with no `main` ref. The compare call is one GET with the token the job already holds (`contents: read`). A read-only probe on 2026-11-20 gave:
  - `main...<main sha>` `identical`;
  - `main...<origin/epic42>` `ahead` 115;
  - `main...<main~5>` `behind` 292;
  - an unknown sha `404`.
  - So `identical`/`behind` is exactly "an ancestor of main, or main itself".
- **Before the CI poll.** A refused tag ends at once, not after 180 minutes. Every later job `needs` `ci-gate`, so the `publish` job is never created and no approval is requested.
- **No re-check in `publish`.** The ruling puts the gate before approval, and `ci-gate` is that point. A re-check would only add a second network dependency to the approved job.
- **Main-reachability applies to release mode only.** A `malformedTag` is already refused. A dry run exists to rehearse unmerged commits, so there it only reports.
- **One pattern for "a check script" (Rule 2).** `ROOT_CHECK_SCRIPT` is the Rule #56 regex. The parity test against `ROOT_GATE_SCRIPTS` turns the "prepare runs what CI runs" claim into a mechanical one (Rule #44), so a new CI root check that `prepare` misses goes red.
  - `node scripts/check-epics-sync.mjs` is a planning-document check, not a package script. CI keeps it, and the release does not need it.
- **The version step runs first in the implement stage, not as a lead commit.**
  - Its 80-file output then sits inside the reviewed story diff (`baseline_revision` is before it).
  - The root `1.0.0` section names the move that this very run printed.
  - The order puts the step on the only clean tree the stage ever has.
  - This story adds no changeset, because a pending changeset at the tag makes `prepare` refuse. Its own changes are named in the root section.
- **`verify` lives in `release.mjs`.** It is the release script's own post-condition, reuses `npmViewArgv`/`viewOutcome`, and loads the wire helpers by `import()`, which keeps the static-import contract. It is a lead command, not a workflow step, because registry propagation can lag right after an upload.
- **`--keep` extends `smokePackages`, not a copy.** The install manifest (`file:` dependencies and overrides, so that `@iris-mcp/shared@1.0.0` never resolves from the registry) and the lockfile check are exactly what a hand-made project would get wrong.
- **Siblings:**
  - `mainReachability` is a sibling of `ciGateDecision` and `environmentProblems`; `readMainReachability` of `readEnvironmentGuard`;
  - `registryProblems` follows the `tarballProblems` pattern;
  - the ci-gate tests extend `release-script-fixtures.ts` `answerFor` (Rule 2).

**Integration ACs (Rule 1):**
- `release.yml` `ci-gate` (consumer) runs `release.mjs ci-gate`. Observable effect: the A2 dry run prints the main line, and the A3 tag run is refused.
- `prepare` (consumer) runs `releaseCheckScripts`. Observable effect: the A2 dry-run log shows `check:provenance: ok` and `validate:prompts: ok`, and the local real-process red runs (Verification) show the refusal.
- The lead checklist (consumer) runs `verify` and `ci-package-smoke.mjs --keep` (A4, A5, B7).

**Consumes:**
- 42.1: the template and `pnpmPack`.
- 42.3: `ci-package-smoke`, `ci-checks`, the harness.
- 42.5: `release.mjs`, `release-core`, the fixtures, `release.yml`.
- Epic 43: the wire goldens and the confinement tests.

**Consumed-by:**
- 42.7: enables the stores. It is the first release after 1.0.0, so the trusted-publisher configuration lands within 48 h before it.
- 42.8: the IPM, plugin and registry listings at `1.0.0`.
- 42.9: install docs that remove the "not yet published" caveats, and client re-certification against the published packages.

**Ledger inbox (Rule 17):**
- **DW-47:** AC 42.6.1, the `--keep` task, and lead checklist A4.
- **DW-300:** Step 0, AC 42.6.2 and lead checklist B4-B7.
- **DW-612:** the release-checks tasks and the parity test, plus the real-process red runs (Verification) and the green lines of A2. `gen:pack:check` was already on the path, since `prepare` ran every `:check`. `check:provenance` and `validate:prompts` were not (verified 2026-11-20: `releaseCheckScripts` returns only the four `gen:*:check`).
- **DW-637:** the SDK tasks. The condition is met: 2.4.0 bundles fast-uri 3.1.8, from a read-only `npm pack` of 2.4.0, 2.3.1 and core 2.4.0, and the source-map paths name `fast-uri@3.1.8`. Lead checklist B2 re-checks before the tag.
- **DW-665:** the `files` task (Orchestrator decision 2).
- **DW-696:** the release-gate tasks, the tests and lead checklist A3.

**Decided at the spec gate (2026-11-21):** all six recommendations were accepted as written. They are wave-8 orchestrator decisions:
- #85: the implement stage runs `pnpm run version -- --first-release` once, as its first action on its clean tree. It is the only stage allowed to run it, and only once.
- #86: every package ships `CHANGELOG.md`.
- #87: the SDK is bumped to 2.4.0, with a fallback to 2.3.1 and a recorded reason if any frozen golden byte moves.
- #88: the real-client smoke runs on a throwaway IRIS for Health through the harness. The Lead's test-container authorization of 2026-10-22 (decisions #55, #64, #71) already covers it, so no new authorization is needed.
- #89: the token is revoked after the publish, and `npm trust` for the 8 packages is an owner action item before the next release.
- #90: `v0.0.3` is the throwaway tag for DW-696's red proof.

Also in force: decision #82 (tags on `main` only, the owner's ruling) and decision #83 (the mid-epic merge order). The lead wrote the spine drafts below: AD-29 (tags on `main`, `prepare`'s check set, `CHANGELOG.md`, `verify`, the Versions bullet), AD-32, the SDK Stack row and the Deferred entry. `lint_spine.py` is clean. The Planner was told on 2026-11-21 that `NPM_TOKEN` is needed. The implement stage never pushes, tags or publishes, never runs docker outside the harness, and never edits the spine.

**Orchestrator decisions needed (as planned):**
1. **Orchestrator decision needed: who runs the 1.0.0 version step — recommended: the implement stage, as its first action on the clean starting tree, once,** because:
   - the step refuses a dirty tree, and the implement stage's start is the story's only clean tree;
   - the result is then reviewed with the story;
   - a failed stage is undone with `git restore . && git clean -fd` (the script prints exactly this).
   - The implement spawn prompt must therefore permit exactly one `pnpm run version -- --first-release` on the real tree and keep every other prohibition.
   - Alternative: the lead runs it as a separate commit before dispatch. That diff is then outside review, and the root section is written by a different hand from the one that saw the printed move.
2. **Orchestrator decision needed: ship `CHANGELOG.md` in the 1.0.0 tarballs (DW-665) — recommended: yes, for all eight packages,** because:
   - the history then travels with the exact bytes a user installed, offline;
   - it costs one `files` entry each (about 7–30 KB);
   - leaving it out is the default only by accident: npm 7+ dropped CHANGELOG from its always-included list, and pnpm never had it.
   - Against: the entries are long internal story notes. They are already public in the repository.
3. **Orchestrator decision needed: bump the SDK to 2.4.0 in this story (DW-637) — recommended: yes,** because:
   - the ledger's condition is met;
   - the probe shows the wire byte-identical and only 12 pin literals moving;
   - the spine's Stack row names this exact trigger.
   - The fallback (revert, `deferred:`) keeps it from ever blocking the tag.
   - Needs the AD-32 / Stack row amendment below.
4. **Orchestrator decision needed: the IRIS for the real-client smoke (A4) — recommended: a throwaway IRIS for Health through `scripts/throwaway-iris.mjs up` (Lead authorization; `HSCUSTOM`; host port 52792; no seed),** because the shared instance is not read-only for this smoke:
   - its deployed marker is `0.0.2+2.244fe8623c76` (read-only SQL `SELECT ExecuteMCPv2.Setup_GetBootstrapVersion()` on `default`/`HSCUSTOM`, 2026-11-20);
   - the 1.0.0 tarballs classify that as older and redeploy 35 classes (same content, marker `1.0.0+…`);
   - the redeploy would also make the dev checkout's own servers see a newer deployment.
   - The throwaway also proves the positive-absence first install from the published embed.
   - Alternative: the shared `HSCUSTOM`, accepting one same-content redeploy that the lead's rebuilt dev servers would make anyway.
5. **Orchestrator decision needed: what "switch to trusted publishing" closes in this story — recommended:**
   - The owner revokes the token and deletes `NPM_TOKEN` right after B7.
   - `npm trust github … --file release.yml --env release --allow-publish` for the eight packages becomes an owner action item, done within 48 h before the next release (42.7's).
   - Then the owner sets "require 2FA and disallow tokens".
   - Why: per the 42.5 research, npm lets an unused trusted-publisher configuration lapse, and the token publishes directly only until January 2027.
6. **Orchestrator decision needed: the throwaway tag of the DW-696 red proof — recommended: `v0.0.3`** on the unmerged story commit.
   - Even with the gate broken, `prepare`'s version check would refuse it (packages at 1.0.0), so no approval is ever requested.
   - The log line, not the exit alone, is the evidence.

**What the owner must provide, and when:**
- **Before B4:** the `NPM_TOKEN` environment secret on `release`:
  - granular;
  - `@iris-mcp` read and write;
  - bypass 2FA;
  - at most 7 days, so create it within a day or two of the tag.
- **At A4:** authorization for one throwaway container (decision 4).
- **At B5:** the approval (Review deployments).
- **After B7:** revoke and delete the token.
- **Before the next release:** the trusted-publisher configuration (decision 5).
- **Recommended, from 42.5 and still open:** a `v*` tag ruleset restricted to admins, and private vulnerability reporting.

**AC reinterpretations:**
1. **AC 42.6.1 "`npm pack` every package"** means the release's packing: pnpm pack, which applies `publishConfig` and rewrites `workspace:*` (DW-387). `npm pack` would ship unresolvable `workspace:*` dependencies.
   - "Launch through `npx`" means `npx --no -- <bin>` from the installed project's `.mcp.json`. A registry spec cannot resolve before the publish.
   - The registry path is covered after the publish by `verify`'s `npx -y @iris-mcp/dev@1`.
2. **AC 42.6.2's prerequisites** hold:
   - 42.1-42.5 are done (and 42.10 and 42.11);
   - the organization and the environment exist;
   - only the token is pending.
   - "By tagging `v1.0.0`" means a tag on the `main` merge commit (decisions #82 and #83).
3. **AC 42.6.3 "the registry 404s are gone"** means `verify` reports no `E404` for any of the eight, and `npx -y @iris-mcp/dev@1` starts in a clean environment.
   - "Switch to trusted publishing and delete the token" follows decision 5.

**Spine amendment drafts for the lead (Rule 20):**
- **AD-29, Publishing, append to "The release workflow":** "`ci-gate` refuses a tag run whose commit `main` does not contain (GitHub compare `main...<sha>` `identical` or `behind`; any other status or an unreadable answer refuses), before it waits for CI, so no approval is requested; there is no maintenance-branch allowance (decision #82, Story 42.6). `prepare` runs every root script whose name has a `check` or `validate` word, the same set as CI's root gates (DW-612). Every package ships its `CHANGELOG.md` (DW-665). `release.mjs verify --version <v>` is the post-publish check."
- **AD-29, Versions:** replace "Until Story 42.6, changesets use `patch` or `minor`, and no story runs `changeset version` or publishes" with "`1.0.0` was versioned in Story 42.6 (`pnpm run version -- --first-release`); later releases run `pnpm run version` on their changesets."
- **AD-32 and the Stack row:** "`@modelcontextprotocol/server` (runtime, `@iris-mcp/shared` only) and client (tests) | 2.4.0, pinned exactly (Story 42.6: bundles fast-uri 3.1.8, closing DW-637; the wire is byte-identical to 2.3.1 on every frozen golden)". In AD-32's "pinned exactly, starting at 2.3.1", add "; 2.4.0 since Story 42.6".
- **Deferred, "Release operations":** "the first publish (`1.0.0`, Story 42.6) used the token route; trusted publishing is configured before the next release."

**Residual risks:**
- Whether the `contents: read` job token can call the compare API on the runner. The A2 dry-run line shows it.
- Whether the granular token may create a new package in the scope. The fallback is decision #75's Lead 2FA publish, recorded as an exception.
- Whether "Re-run failed jobs" reuses the run's artifacts. If it doesn't, re-push the same tag on the same commit: published versions are skipped.
- `tools-list-snapshot.json` keeps `sdkVersion: "2.3.1"` metadata. Its check ignores the field, and the file is protected. It is cosmetic, and regenerating it with `--force` is a later choice.
- `checkDistFresh` is mtime-based, and a composite tsc build does not re-emit unchanged output (probe). After a branch switch or stash, delete the package's `tsconfig.tsbuildinfo` before rebuilding.

## Verification

**How to run:**
- Run from `/Users/jbrandt/git/iris-execute-mcp-v2`, one command per foreground call, with `timeout: 600000`.
- `UNARMED` is `env -u IRIS_HOST -u IRIS_PORT -u IRIS_USERNAME -u IRIS_PASSWORD -u IRIS_NAMESPACE -u IRIS_HTTPS -u IRIS_REQUIRE_LIVE -u IRIS_TEST_HOST -u IRIS_TEST_PORT -u IRIS_THROWAWAY -u NPM_TOKEN -u GITHUB_TOKEN CI=true`.
- After Step 0 and after the SDK bump, rebuild every package (`pnpm --filter <pkg> build`, one at a time). `serverInfo.version` and the marker come from the build.
- No stage pushes, tags, triggers CI, runs docker, publishes or calls IRIS. A local `pnpm pack` goes only into an `os.tmpdir()` directory.

**Record (Rule #24):** `BOOTSTRAP_VERSION` `0.0.2+2.244fe8623c76` → `1.0.0+2.244fe8623c76`, moved by the version step's `gen:bootstrap`. The class content and the sequence are unchanged. Paste the line the run printed here.

**Commands:**
- `(loop)` `for f in scripts/release.mjs scripts/lib/release-core.mjs scripts/lib/ci-checks.mjs scripts/ci-package-smoke.mjs; do node --check "$f" || exit 1; done` -- expected: exit 0.
- `(loop)` The story files of `@iris-mcp/all` -- expected: green, with `release-1-0-0-mechanism.test.ts`'s fixture rows skipped by design:
  ```sh
  UNARMED pnpm --filter @iris-mcp/all exec vitest run src/__tests__/release-core.test.ts src/__tests__/release-script.test.ts src/__tests__/release-prepare.test.ts src/__tests__/release-workflow.test.ts src/__tests__/release-version.test.ts src/__tests__/release-smoke-prebuilt.test.ts src/__tests__/ci-package-smoke.test.ts src/__tests__/ci-workflow.test.ts src/__tests__/package-manifests.test.ts src/__tests__/changelog-bootstrap-move.test.ts src/__tests__/story-42-6-doc-claims.test.ts src/__tests__/story-42-5-doc-claims.test.ts src/__tests__/story-42-1-qa-records.test.ts src/__tests__/story-43-1-sdk-confinement.test.ts src/__tests__/story-43-1-qa-pack-confinement.test.ts src/__tests__/story-43-3-validator-unreachable.test.ts src/__tests__/release-1-0-0-mechanism.test.ts src/__tests__/npx-pin.test.ts
  ```
  Add the new oracle and real-pack files.
- `(loop)` `UNARMED pnpm --filter @iris-mcp/shared exec vitest run src/__tests__/sdk-wire-compat.test.ts` -- expected: 116/116.
- `(once)` The epic-43 wire suites on 2.4.0, in two calls (the probe's split) -- expected: green, every frozen golden byte-identical.
  ```sh
  UNARMED pnpm --filter @iris-mcp/all exec vitest run src/__tests__/story-43-1-sdk-wire-golden.test.ts src/__tests__/story-43-1-qa-handler-golden.test.ts src/__tests__/story-43-1-sanctioned-wire-changes.test.ts src/__tests__/story-43-2-cross-era-pin.test.ts src/__tests__/story-43-2-chokepoint-both-eras.test.ts src/__tests__/story-43-3-confirmation-both-eras.test.ts src/__tests__/story-43-3-confirmation-raw-wire.test.ts
  UNARMED pnpm --filter @iris-mcp/all exec vitest run src/__tests__/story-43-4-sanctioned-golden-changes.test.ts src/__tests__/story-43-4-qa-sanctioned-wire.test.ts src/__tests__/epic43-capstone-gate.test.ts
  ```
- `(once)` `UNARMED pnpm --filter <pkg> test`, one call per package: client-config, shared, admin, data, dev, interop, ops -- expected: green.
  - Probe times were 1-20 s each.
  - Rule #35 does not apply: no OS %UnitTest runs.
- `(once)` `@iris-mcp/all` as four calls, `UNARMED pnpm --filter @iris-mcp/all test -- --shard=k/4` for k = 1..4 -- expected: green.
  - Half the suite took 572 s in the probe, so halves do not fit one call.
  - If a quarter still nears 9 minutes, split it by explicit file lists (`vitest list` ignores `--shard`).
- `(once)` `pnpm --filter <pkg> lint` and `pnpm --filter <pkg> type-check` per package -- expected: 0 errors.
- `(once)` The root checks -- expected:
  - all OK and the baseline unchanged;
  - `gen:bootstrap` changes nothing;
  - `git diff --stat` names only this story's files.
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
- `(once)` The tag-consistency check on the story tree -- expected: `[] []`.
  ```sh
  node --input-type=module -e "const r=await import('./scripts/release.mjs');const c=await import('./scripts/lib/release-core.mjs');const f=r.readReleaseFacts('.');console.log(JSON.stringify(c.versionProblems({versions:f.packages.map(p=>({name:p.name,version:p.version})),pending:f.pending,tagVersion:'1.0.0'},'release')),JSON.stringify(r.embeddedVersionProblems(f)))"
  ```
- `(once)` `UNARMED node scripts/ci-package-smoke.mjs` -- expected: exit 0, with output identical in shape to today's (the default path).
- `(once)` `UNARMED node scripts/ci-package-smoke.mjs --keep "$(mktemp -d)/proj"` -- expected:
  - exit 0;
  - `proj/.mcp.json` with five servers;
  - the next-steps lines.
  - Remove the directory afterwards.
- `(once)` The red leg of AC 42.6.3, read-only against the real registry: `UNARMED node scripts/release.mjs verify --version 1.0.0` -- expected:
  - exit 1;
  - eight "not on the registry" lines;
  - the npx start reported failed;
  - no temporary directory left.
- `(once)` The DW-612 real-process red runs, in a throwaway clone:
  1. Set up the clone:
     - `git clone --no-hardlinks` the repository at `HEAD` into `os.tmpdir()`;
     - `git remote remove origin`;
     - bring over the uncommitted story changes (`git -C <repo> diff HEAD --binary | git -C <clone> apply --index`, plus every untracked file from `git ls-files --others --exclude-standard`, copied with `rsync -a --from0 --files-from=-`);
     - commit there with `-c commit.gpgsign=false`;
     - `pnpm install --frozen-lockfile`, then build every package.
  2. Build a `PATH` with no docker: a temporary bin directory with symlinks to `command -v node pnpm npm git`, plus `/usr/bin:/bin`.
  3. Run `GITHUB_EVENT_NAME=workflow_dispatch GITHUB_REF=refs/heads/probe GITHUB_SHA=$(git rev-parse HEAD) node scripts/release.mjs prepare --out "$(mktemp -d)/a"` three times:
     - **control** -- expected: every check line `<name>: ok`, including `check:provenance: ok` and `validate:prompts: ok`, then exit 3 (no docker);
     - **provenance break** (committed in the clone) -- a one-line change that `pnpm check:provenance` alone refuses; expected: exit 1 and the line `pnpm run check:provenance failed`;
     - **pack drift** (a byte changed in a file under `packages/client-config/skills-pack/`, committed) -- expected: exit 1 and `pnpm run gen:pack:check failed`.
  4. Remove the clone.
  5. Record all three exits and lines here. This is the publish-path proof of DW-612 (Rule #59). On GitHub, `ci-gate` refuses such a commit earlier, because CI runs the same checks.

**Shared surfaces:**
- every `packages/*/package.json` (`version`, `files`, SDK pins) and `pnpm-lock.yaml`;
- `.changeset/` (all 62 consumed);
- every package `CHANGELOG.md` and the root `CHANGELOG.md` top section (`changelog-bootstrap-move`, `story-42-1-qa-records`, the 42.x doc-claims position pins);
- `BOOTSTRAP_VERSION`, `ipm/module.xml`;
- `release.mjs` commands (`parseArgs`, USAGE);
- `releaseCheckScripts`' result;
- `ci-checks.mjs` exports (`ROOT_GATE_SCRIPTS`);
- `ci-package-smoke.mjs` `main` arguments;
- `release-script-fixtures.ts` `answerFor` (a default `compare` answer, so the 42.5 ci-gate tests stay green);
- the README `### Releasing` text;
- the SDK pin literals.

Every test added or changed passes on a fresh environment, in either order, and creates and removes its own temporary fixtures. No check mutates the shared IRIS, so no `ExecuteMCPv2.Temp.*` fixture is used.

**Mutations (Rule 19):** apply each, observe red, revert, and confirm `git status --short` and `git diff --stat` are unchanged. Record each as `mutation: <change> → <red test>`.
- DW-696:
  - `mainReachability` accepts `ahead` → `release-core.test.ts` and the ci-gate `ahead` flow;
  - the main check moved after the CI poll → the "no `/actions/runs` request" assertion;
  - a dry run that refuses on `ahead` → the dry-run flow;
  - an unreadable compare treated as on main → the 404/500/error rows.
- DW-612:
  - `releaseCheckScripts` back to `endsWith(':check')` → the parity test and the real-scripts row;
  - a new `pnpm check:x` added to `ROOT_GATE_SCRIPTS` only → the parity test.
- DW-665: `CHANGELOG.md` dropped from one package's `files` → `package-manifests.test.ts` and the real-pack test.
- DW-637: `PINNED` left at 2.3.1 with the bump applied → `story-43-1-sdk-confinement.test.ts` (shows the pin test still discriminates).
- AC 42.6.3:
  - `registryProblems` ignoring a missing attestation → `release-core.test.ts` and the verify flow;
  - `verify` keeping its temporary `HOME` → the cleanup assertion.
- AC 42.6.1:
  - `--keep` removing `<dir>` → the `--keep` test;
  - one server missing from `.mcp.json` → same.
- AD-14 and the CHANGELOG: the move literal changed in the root section → `changelog-bootstrap-move.test.ts` and `story-42-6-doc-claims.test.ts`.

**Implementation record (2026-11-20).**
- Step 0 was run by the spawning agent before this stage (exit 0). Printed line: "`BOOTSTRAP_VERSION` moves from `0.0.2+2.244fe8623c76` to `1.0.0+2.244fe8623c76`". Its 80 files are untouched. `pnpm gen:bootstrap` after all edits: both files "Unchanged (not rewritten)", and `git status --porcelain` identical before and after.
- SDK 2.4.0: the shared `sdk-wire-compat` ran 116/116, the 13 epic-43 files ran 590 + 90 passed in the two calls (the 90 are the 43.4 files and the capstone), and no frozen golden, ledger or `tools-list-snapshot.json` byte moved, so the fallback was not used. `pnpm-lock.yaml` resolves `server`, `client` and `core` at 2.4.0 alone.
- The one test the probe did not list: `story-38-0-qa-dist-freshness.test.ts` pinned `@iris-mcp/all` `files: []`; it now pins `["CHANGELOG.md"]` (decision #86), and the package is still skipped as a package with no `dist` entry.
- `@iris-mcp/all` ran as 16 `--shard=k/16` calls, not 4: the harness moves any call past 180 s to the background, and a quarter exceeded that. Each shard is its own call; all 16 passed (212 files). Other packages: client-config 1015, shared 2575, admin 506 (8 skipped), data 163 (2), dev 1490 (319), interop 751, ops 350, all green. Lint and type-check are clean on the seven packages that have them.
- Root checks: governance baseline check OK (frozen keys all present), skills, pack, prompts, provenance, snapshot and epics-sync all OK. Tag consistency `[] []`.
- `ci-package-smoke.mjs` (no argument) exit 0, output in the shape of today's. `--keep <tmp>/proj`: exit 0, `proj/.mcp.json` with the five servers, the next-steps lines, directory removed afterwards.
- AC 42.6.3 red leg against the real registry (read-only): `node scripts/release.mjs verify --version 1.0.0` exit 1, eight "not on the registry" lines, the npx start reported failed (`npm error code E404`), 9 checks failed, no temporary directory left. `verify --version 2.0.0` and `verify` alone exit 2.
- DW-612 real-process runs, throwaway clone of `HEAD` plus the working tree (committed there), `PATH` with no docker, `prepare` in dry-run mode, then the clone and its bin directory removed:
  - control: `check:provenance: ok`, `gen:governance-baseline:check: ok`, `gen:pack:check: ok`, `gen:skills:check: ok`, `gen:tools-list-snapshot:check: ok`, `validate:prompts: ok`, `format:check: not run`, then "docker was not found on PATH", exit 3;
  - provenance break (`packages/client-config/package.json` `"skills-pack"` renamed in `files`; `pnpm check:provenance` alone exit 1 and `pnpm gen:pack:check` exit 0): exit 1, "problem: pnpm run check:provenance failed (exit 1): ... the tarball lacks the pack file skills-pack/...";
  - pack drift (one byte appended to `skills-pack/skills/audit-security-posture/SKILL.md`; `check:provenance` alone exit 0): exit 1, "problem: pnpm run gen:pack:check failed (exit 1): gen-pack --check: DRIFT in packages/client-config/skills-pack/skills/audit-security-posture/SKILL.md".
- Real oracles (Rule #36): compare bodies captured 2026-11-21 with `gh api -X GET` for `main` (identical), `epic42` (ahead 115), `main~5` (behind 292) and an unknown sha (404), plus three `npm view` transcripts.

**Mutations (Rule 19), each applied, observed red, reverted; `shasum` of the file and `git status --porcelain` identical afterwards:**
- mutation: `mainReachability` accepts `ahead` (release-core `ON_MAIN_STATUSES`) -> `release-core.test.ts` "compare status ahead is off main" and the ci-gate `ahead`, both-refusals, dry-run and real-process rows (5 red).
- mutation: the main check moved after the CI poll (refusal removed before `runsUrl`, added at the green return) -> the `ahead`/`diverged` "CI runs are never read" rows and the 404/500/403/no-status/stall rows (13 red).
- mutation: a dry run that refuses on `off-main` (`return 1` after the report line) -> the `ahead` and `diverged` dry-run rows (2 red).
- mutation: an unreadable compare treated as `on-main` -> the 404/403/500/missing-status/error/redirect/case rows of `release-core.test.ts` and the ci-gate rows (16 red in the two files).
- mutation: `releaseCheckScripts` back to `name.endsWith(':check')` -> the real-scripts row, the parity row, the failing-`check:provenance` row and two others in `release-prepare.test.ts` (6 red).
- mutation: `pnpm check:x` added to `ROOT_GATE_SCRIPTS` only -> the parity row of `release-prepare.test.ts` (1 red).
- mutation: `CHANGELOG.md` dropped from `packages/shared/package.json` `files` -> `package-manifests.test.ts` "lists CHANGELOG.md in files" and `published-tarballs.test.ts` "shared: the tarball lists CHANGELOG.md" (real `pnpm pack`) (2 red).
- mutation: `PINNED` left at 2.3.1 with the bump applied -> 9 red in `story-43-1-sdk-confinement.test.ts` (manifests, lockfile, `installedSdk`).
- mutation: `registryProblems` ignoring a missing attestation (`if (false)`) -> `release-core.test.ts` (2 rows), `story-42-6-qa-real-oracles.test.ts` (the lodash transcript) and the verify "without a provenance attestation" flow (4 red).
- mutation: `verify` keeping its temporary directory (`remove` a no-op) -> 5 verify rows, including the real-process row that lists the observed `TMPDIR`.
- mutation: `--keep` removing `<dir>` -> the three `smokePackages({ keep })` rows of `release-smoke-prebuilt.test.ts` (3 red).
- mutation: one server missing from `.mcp.json` (`.slice(1)`) -> the two `.mcp.json` rows of `ci-package-smoke.test.ts` and the `--keep` success row (3 red).
- mutation: the move literal changed in the root section (`...c76` to `...c77`) -> `changelog-bootstrap-move.test.ts` and `story-42-6-doc-claims.test.ts` (2 red).
- mutation (review pass): `deps.cleanups?.add(remove)` removed from `runVerify` -> the `release-script.test.ts` verify row "the lines are appended ... the cleanup registered for a signal" (1 red).
- mutation (review pass): `verifyEnv` no longer drops `NPM_CONFIG_*` and `NODE_AUTH_TOKEN` -> the `release-script.test.ts` verify row "starts npx -y @iris-mcp/dev@1 in a temporary HOME ..." (1 red).
- Not mutated: the doc-claims rows for the README (their literals are the README's own text); the SDK-fallback path (not taken).
- Test files added by the QA stage (QA): `packages/iris-mcp-all/src/__tests__/story-42-6-qa-gate-verify.test.ts` and `packages/iris-mcp-all/src/__tests__/story-42-6-qa-keep-process.test.ts`; their rows and mutations are in `## QA`.

**Lead checklist** (stages do none of it; record every run URL and result here).

*Phase A, on `epic42`, after the story commit (decision #83):*
1. **A1.** Push the story commit to `origin/epic42`. CI is green; record the run id.
2. **A2. Dry run.** Run `git push origin <sha>:refs/heads/release-dry-run/42-6`. Expected:
   - `ci-gate`: the environment is protected, the line `not on main (ahead); a tag run stops here`, and CI green;
   - `prepare`: "8 packages at 1.0.0, no pending changeset"; every check `ok`, `check:provenance` and `validate:prompts` included; 8 prepublish suites; 8 tarballs at `1.0.0`; the smoke, the vsix and the IPM tree;
   - `rehearse`: 8 `npm publish --dry-run` lines;
   - `publish`: skipped.
   - Then delete the branch. `npm view @iris-mcp/shared` is still E404.
3. **A3. DW-696 red on the real path.** Push the tag `v0.0.3` at the story sha (on `epic42`, not on `main`, with A1's green push run). Expected:
   - `ci-gate` exits 1 with `refusing the tag run: <sha> is not on main (compare main...<sha>: ahead)`;
   - no CI wait;
   - `prepare`, `rehearse` and `publish` are skipped, and no deployment review is requested.
   - Delete it: `git push --delete origin v0.0.3`.
4. **A4. Real-client tarball smoke (AC 42.6.1, DW-47).**
   - Run `node scripts/ci-package-smoke.mjs --keep <dir>`.
   - Start the throwaway (decision 4): `node scripts/throwaway-iris.mjs up --image <IRISHEALTH_COMMUNITY_IMAGE from scripts/lib/ci-checks.mjs> --namespace HSCUSTOM --host-port 52792 --state <f>`, with no seed.
   - Export `IRIS_HOST=127.0.0.1 IRIS_PORT=52792 IRIS_USERNAME=_SYSTEM IRIS_PASSWORD=SYS IRIS_NAMESPACE=HSCUSTOM IRIS_HTTPS=false`, `cd <dir>`, run `claude`, and approve the project servers.
   - Make one read call per server: dev `iris_server_info`; admin `iris_namespace_list`; interop `iris_production_status`; ops `iris_metrics_system`; data `iris_analytics_cubes` (or `iris_rest_manage` `list`).
   - Record each call's result, the negotiated era (the stderr era line), and the deployed marker (`SELECT ExecuteMCPv2.Setup_GetBootstrapVersion()` on the throwaway: `1.0.0+2.244fe8623c76`).
   - Then `down --state <f>`, remove `<dir>`, and confirm no container and no pulled image is left.
5. **A5.** Run `node scripts/release.mjs verify --version 1.0.0`. Exit 1, every package E404: the red leg before the publish.
6. **A6.** Send the Planner the `epic42` story sha and A1's green run id. **STOP.** The Planner merges `epic42` → wave-8 → `main`, pushes, and returns the `main` sha M.

*Phase B, after the Planner returns M:*
1. **B1. Check M** (read-only):
   - `git fetch origin`; then `git merge-base --is-ancestor <story sha> M`;
   - `git ls-tree --name-only M .changeset/` holds only `README.md` and `config.json` (another merge may have brought a changeset, which `prepare` would refuse);
   - all eight `git show M:packages/<dir>/package.json` are `1.0.0`;
   - `gh run list --commit M --workflow ci.yml` is green on a `push` run;
   - the `release` environment is unchanged.
2. **B2. DW-637 re-check** (record the date):
   - Run `npm view @modelcontextprotocol/server versions time --json`.
   - A newer release is a 1.0.x fix-forward item, not a blocker, unless it fixes an advisory reachable from our use (43.3's tripwire). In that case, stop and decide before tagging.
3. **B3. The token.** The owner confirms `NPM_TOKEN` exists on `release`. A GET of `repos/<owner>/<repo>/environments/release/secrets` lists names only.
4. **B4. Tag.** `git tag -a v1.0.0 M -m "1.0.0"`, then `git push origin v1.0.0`.
5. **B5. Watch the run.** Expected:
   - `ci-gate`: on main (`identical`), the environment protected, CI green on M;
   - `prepare`: release v1.0.0, 8 packages at 1.0.0;
   - `rehearse`: 8 dry-run lines.
   - Then the owner approves through **Review deployments**.
6. **B6. Publish.** The report shows all eight `published`, `auth: token`, and the three other channels `skipped: not enabled`.
7. **B7. Post-publish (AC 42.6.3).** Run `node scripts/release.mjs verify --version 1.0.0`. Expected:
   - exit 0;
   - eight `1.0.0` lines with provenance;
   - `npx -y @iris-mcp/dev@1` answers `initialize` with `1.0.0`.
   - Also check each package page on npmjs.com for the provenance badge.
8. **B8. The token, and trusted publishing.** The owner revokes the token and deletes the `NPM_TOKEN` secret. Record the action item: `npm trust github` for the eight packages within 48 h before 42.7's release, then "require 2FA and disallow tokens" (decision 5).
9. **B9.** Record every URL and result above. Story 42.6 closes on B7.

*If something fails (AD-29 bad-release policy; never `npm unpublish`):*
- **Red before `publish`** (`ci-gate`, `prepare` or `rehearse`): nothing was published.
  - Delete the `v1.0.0` tag, fix forward on `epic42`, re-merge through the Planner, and re-tag the new `main` commit.
  - This is the only case in which `v1.0.0` may move.
- **`publish` stops part-way:**
  - The report names published, failed and not-attempted packages.
  - Cause outside the repository (token, network, registry): **Re-run failed jobs** on the same run, or, if the rerun cannot reach the artifacts, re-push the same tag on the same commit. Published versions are skipped.
  - The token cannot create a new package (403 or 404 on the first upload of a name): the decision #75 fallback. The Lead publishes the remaining rehearsed tarballs from the run's artifact interactively with 2FA, in order, recorded as an AD-29 exception. Those packages carry no provenance, so AC 42.6.3 records the exception.
  - Cause in the code: never re-tag `v1.0.0` on another commit once any package is published. Release `1.0.1` of all eight through a patch changeset and `pnpm run version`.
  - `npm deprecate` each published `1.0.0` package whose install is broken or harmful, with "`<reason>`; use >=1.0.1".
- **A defect found after B7:** fix forward with `1.0.1`. A security, data-loss or broken-install defect also gets `npm deprecate @iris-mcp/<pkg>@1.0.0 "<reason>; use >=1.0.1"` (a Lead step).

## Auto Run Result

Status: done
Blocking condition: none

**Implement stage (2026-11-20, baseline `fe7cae7cadd43fa0fcbcd165b2022721a7d2a75a`).**
- **Summary:** the sanctioned version step ran once as the first action (exit 0: 8 packages at 1.0.0, 62 changesets consumed, `CHANGELOG.md` created or prepended per package, printed line: `` `BOOTSTRAP_VERSION` moves from `0.0.2+2.244fe8623c76` to `1.0.0+2.244fe8623c76` ``). On top of it: `ci-gate` refuses a tag whose commit `main` does not contain (compare `main...<sha>`, before the CI poll); `prepare` runs every root `check`/`validate` script (parity with CI's gate list); every package ships `CHANGELOG.md`; the SDK pin is 2.4.0 (no frozen golden or `tools/list` byte moved, so the 2.3.1 fallback was not used); new `release.mjs verify`; new `ci-package-smoke.mjs --keep <dir>`; README `### Releasing` and the root `1.0.0` CHANGELOG section.
- **Files changed:** the version step's output (8 `package.json`, 8 package `CHANGELOG.md`, `.changeset/*`, `ipm/module.xml`, `bootstrap-classes.ts`, `pnpm-lock.yaml`); `scripts/release.mjs`, `scripts/lib/release-core.mjs`, `scripts/lib/ci-checks.mjs` (export), `scripts/ci-package-smoke.mjs`, `.github/workflows/release.yml` (header comment only); `README.md`, `CHANGELOG.md`; SDK pins in four manifests plus the pin literals of `story-43-1-sdk-confinement`, `story-43-1-qa-pack-confinement` and `story-43-3-validator-unreachable`; new `story-42-6-doc-claims.test.ts` and `story-42-6-qa-real-oracles.test.ts`; extended release-core, release-script, release-prepare, release-smoke-prebuilt, ci-package-smoke, package-manifests, published-tarballs and story-38-0 tests plus the shared fixtures.
- **Review (4 layers, 32 findings):** high 0, medium 4, low 26, false 2. Patched: 18 rows (two medium entries by root cause: `verifyEnv` now drops every `NPM_CONFIG_*` variable and `NODE_AUTH_TOKEN`; the vacuous half of the parity test removed), plus the `--keep` hardening (segment-wise inside-repo test, empty value, dangling link, kept-directory note on early failures), the `verify` close guard and mismatch wording, the CHANGELOG launch claim, the signal-cleanup registration row and the `.mcp.json` order assertions. Rejected with recorded reasons: 14 rows (see the Review Triage Log). Deferred: none.
- **Follow-up review recommendation:** `true`. Two medium entries were patched on a first pass. The unverified risk is that the `verifyEnv` denylist change and the new `--keep` directory checks were verified only by their own targeted rows and two mutations, not by a second review.
- **Verification performed:** `node --check` of the four scripts; the story-file list of `@iris-mcp/all` (release-core, release-script, release-prepare, release-workflow, release-version, release-smoke-prebuilt, ci-package-smoke, ci-workflow, package-manifests, changelog-bootstrap-move, the 42.x doc-claims and oracle files, 43-1/43-3 pin files, release-1-0-0-mechanism, npx-pin, published-tarballs, smoke-runtime, story-38-0) green after the last patch; `pnpm gen:governance-baseline:check`, `gen:skills:check`, `gen:pack:check`, `validate:prompts`, `check:provenance`, `gen:tools-list-snapshot:check` and `check-epics-sync` OK; `gen:bootstrap` a no-op; the tag-consistency check prints `[] []`; `ci-package-smoke.mjs` exits 0 (default) and `--keep` exits 0 with a five-server `.mcp.json`; `verify --version 1.0.0` exits 1 with eight "not on the registry" lines and the npx start failed, no temporary directory left; spine lint 0 findings. Before the review patches the implement subagent also ran every package suite, 16 shards of `@iris-mcp/all` (212 files), the shared `sdk-wire-compat` (116/116), the epic-43 wire suites (590 + 90), lint and type-check per package, and the three DW-612 real-process runs (control exit 3, provenance break exit 1, pack drift exit 1) in a throwaway clone that was removed. The review patches touched only `scripts/` and tests of `@iris-mcp/all`, so those wide runs were not repeated.
- **Residual risks:** the real-client smoke, the dry run, the `v0.0.3` red proof, the tag, the publish and `verify` after it are the lead's checklist (A and B). The implement subagent used a few shell heredocs for edits (Rule #55) and verified each result. `.mcp.json` carries the five `IRIS_*` variables the spec lists, not `IRIS_HTTPS`; the server defaults it to false and it has not met a real client. `tools-list-snapshot.json` keeps `sdkVersion: "2.3.1"` (protected file; its check ignores the field). Containers used: none. Images pulled: none.

## QA

Stage: QA (2026-11-20), build commit `6b5e514`, baseline `fe7cae7`. Gap analysis against the I/O matrix and the ACs: the implement stage's tests were already broad (every compare status, the verify flows, the `--keep` directory rules, the real-pack CHANGELOG rows), so the additions go at what could still pass while the thing it guards was broken. No product code changed.

**Tests added (all in the default suite of `@iris-mcp/all`; none opts out of it, none needs `IRIS_REQUIRE_LIVE`):**
- `packages/iris-mcp-all/src/__tests__/story-42-6-qa-gate-verify.test.ts` (58 rows):
  - DW-696: the gate over bodies a real HTTP call can bring back (an HTML page on a 200, an empty body, `null`, an array, a bare string, a status that is an object or `null`, 502, 401, 403 secondary rate limit, 429), each in a tag run (exit 1, cause named, CI never read) and a dry run (report line, goes on); non-tag runs (dispatch on a branch, dispatch FROM a tag ref, release-dry-run push, a non-`v` tag, a pull request) on `ahead` and `diverged` are never refused; a malformed `v` tag is exit 2 before the compare is read; an off-main tag run ends at once against a CI that never turns green, with the same world on `main` as the waiting control; an off-main run with a red CI run prints the main refusal and never the CI verdict; the whole script as a real process on a dry run and on a tag run with a compare 500.
  - More compare bodies from the real API (captured 2026-11-20 with read-only `gh api -X GET .../compare/main...<ref>?per_page=1`: wave-7 branch behind 1, wave-8 branch ahead 37, `main` identical, `not-a-sha` and `abc` HTTP 404 with the text status `"404"`, and the 13 top-level keys of a full body).
  - DW-612: `prepare`'s check set against the CI workflow FILE (`.github/workflows/ci.yml`, the `gates` job), not the constant that builds the declared steps; the comparison is shown able to fail in both directions.
  - AC 42.6.3: `verify` over a wrong version, a wrong predicate and a non-JSON answer (each one package, seven ok, the npx start still checked, no non-`view` npm call); a network fault of `npm view` is `npm view failed`, never `not on the registry`; an npm that cannot start; a runner that rejects (the directory is removed and the summary says exit 1); a `wire.close` that rejects changes no verdict; both children (`npm view` and the npx start) carry no variable of the secret classes in any case and no secret VALUE.
  - AC 42.6.2: the committed tree read as a release (one shared version of 1.0.0 or later, the marker and `ipm/module.xml` in step, `[]` in release mode, durable across later releases because the tag version is the tree's own; the real-pending row is `skipIf` a changeset is pending), and each of the eight packages alone at another version, on disk, is exactly one problem naming it; a pending changeset, a marker at another semver and a module at another version are each a problem of their own.
- `packages/iris-mcp-all/src/__tests__/story-42-6-qa-keep-process.test.ts` (12 rows):
  - `ci-package-smoke.mjs` as a real process: eight refused argument shapes (including `--keep=dir`, which no in-process row covered) are exit 2 with the usage line and nothing made; a relative `--keep` from the repository root is refused as inside the repository with nothing created; the same relative name from outside resolves against the working directory and is refused only as non-empty.
  - The kept project's `.mcp.json` EXECUTED as a client does (cwd = the project, `${VAR}` expanded from an environment that holds the five variables): each entry answers `initialize` and `tools/list`. Before this, the smoke started the servers with its own arguments, so a wrong `command` or `args` in `.mcp.json` passed every row that compares the file with the generator's output. A second row shows the entry fails from a directory that is not the project.

**Mutations (Rule 19), each applied with a one-line substitution, run, then `git checkout --` of the file; `shasum` and `git status --short` identical afterwards (printed by the helper after every one):**
- mutation: `ON_MAIN_STATUSES` gains `ahead` -> 10 red in `story-42-6-qa-gate-verify.test.ts` (the five non-tag rows, the pending-CI row, the red-CI row, the real-process row, two real-body rows).
- mutation: an unreadable compare judged `on-main` -> 24 red (every tag-run and dry-run body row).
- mutation: the main refusal moved after the CI poll (removed before `runsUrl`, added at the green return) -> 14 red, among them "a tag run off main ends at once even when CI would never turn green" (it waits instead) and the red-CI row.
- mutation: a dry run that returns 1 on `off-main` -> 6 red (the non-tag rows and the real-process dry run).
- mutation: `releaseMode` ignores the event (a dispatch from a tag ref becomes a release) -> 1 red, "a manual dispatch FROM a tag ref" (no existing row saw this).
- mutation: `check:provenance` added to `RELEASE_CHECK_EXEMPTIONS` (prepare drops it) -> 2 red, the workflow-file parity rows.
- mutation: the `check:provenance` step removed from `ci.yml` -> 2 red, the same rows.
- mutation: `pnpm validate:prompts` removed from `ROOT_GATE_SCRIPTS` -> 2 red in `release-prepare.test.ts` (the constant side of the parity).
- mutation: `...OIDC_VARIABLES` dropped from `SECRET_VARIABLES` -> 1 red, "neither child sees a secret".
- mutation: `registryProblems` ignores a wrong version -> 1 red, the verify wrong-version row.
- mutation: `NPM_NOT_FOUND` also matches `ENOTFOUND` -> 1 red, "a network failure of npm view is `npm view failed`".
- mutation: a rejecting `wire.close()` rethrown instead of swallowed -> 1 red, "a wire whose close rejects changes no verdict".
- mutation: `verify`'s `finally { remove(); }` emptied -> 6 red, including the runner-rejects row.
- mutation: `versionProblems` skips the first package in a release check -> 1 red, `@iris-mcp/client-config alone at another version`.
- mutation: `packages/iris-ops-mcp/package.json` at `1.0.1` -> 3 red, the committed-tree rows.
- mutation: relative `--keep` resolved against `REPO_ROOT` instead of the working directory -> 1 red, the outside-the-repository relative row.
- mutation: `.mcp.json` names `<bin>-x` -> 1 red, "every entry launches from the project directory" (the shape rows of `ci-package-smoke.test.ts` go red on it too).
- mutation: `"CHANGELOG.md"` dropped from `packages/iris-mcp-all/package.json` `files` -> 2 red, `package-manifests.test.ts` and `published-tarballs.test.ts` ("iris-mcp-all: the tarball lists CHANGELOG.md", the real `pnpm pack`).
- mutation: `packages/client-config/CHANGELOG.md` deleted while `files` lists it (pnpm omits a missing file silently) -> 2 red, the same two files (client-config row).
mutations_demonstrated=19

**Runs:** the new files plus `story-42-6-qa-real-oracles`, `story-42-6-doc-claims`, `release-core`, `release-prepare`, `release-smoke-prebuilt`, `ci-package-smoke`, `ci-workflow`, `package-manifests`, `published-tarballs` and `release-workflow`: 12 files, 604 passed, 0 failed; `release-script`, `release-core`, `story-42-6-qa-real-oracles` and `ci-package-smoke` (293) before the additions, also green. The read-only `node scripts/release.mjs verify --version 1.0.0` against the real registry ran again: eight "not on the registry" lines, the npx start failed (E404), 9 checks failed, no temporary directory left. Commands used `UNARMED`'s unset list; nothing was armed and no IRIS was called.

**First-run failures:** none. Both new files passed on their first run; the mutations above are what show they can fail.

**Defects found:** none that blocks the tag.
- deferred: `compareUrl` puts `GITHUB_SHA` into the path without percent-encoding (the runs URL beside it uses `encodeURIComponent`). The runner always sets a 40-hex value, so no real input reaches it (Rule #54), but a value with `?`, `#` or `/` would change the request. Low; a one-line `encodeURIComponent(sha)` plus a row if the lead wants the two URLs consistent.
- note: `@iris-mcp/all` has no `type-check` or `lint` script, so its tests are not type-checked; the new files use the same patterns as `release-script.test.ts`. An ad-hoc `tsc --strict` run shows the same class of notices on both (the injected-dependency shapes), none specific to the new files' logic.
- note: the `qa-rules.md` stage rules say not to commit, and the lead's dispatch prompt asks for one local commit of the QA additions. The prompt was followed; nothing was pushed.

**Containers used:** none. Images pulled: none.
