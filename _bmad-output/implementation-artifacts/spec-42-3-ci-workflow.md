---
title: 'Story 42.3: CI Workflow'
type: 'feature'
created: '2026-10-21'
status: 'ready-for-dev'
baseline_revision: '0dc95abad3c8f38c4955559d14961599a1caa08d'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-iris-execute-mcp-v2-2026-10-14/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-42-context.md'
warnings:
  - multiple-goals
  - oversized
deferred:
  - summary: 'CI runs only the launcher extension''s arming guard, `liveArming.test.ts`, `type-check` and `build` in the gates job, plus its two live files armed. The full launcher suite stays out of CI until Story 42.7 makes it green (DW-532). Four of its baseline failures also fail on Linux: they pin `C:\` paths, and `node:path` `isAbsolute` is false for them on POSIX.'
    evidence: 'Plan 2026-10-21: `clientsEngine.test.ts:74,98` and `governanceEngine.test.ts:83,112` against `clientsEngine.ts:60,122` and `governanceEngine.ts:48,111`. `clientsActivationFlow.test.ts:154` (33-3-3) times out on macOS, and returns early (reporting passed) when the CLI is unbuilt (`:155-158`). DW-532 is routed to 42-7.'
    location: 'extensions/iris-mcp-launcher/src/__tests__; Story 42.7; .github/workflows/ci.yml gates job'
    severity: 'medium'
  - summary: 'The two OAuth tests in `admin.integration.test.ts` never run anywhere. `it.skipIf(!oauthAvailable)` is evaluated when the file is collected, before `beforeAll` sets the flag. CI allowlists both skips with this reason.'
    evidence: 'Plan 2026-10-21: `packages/iris-admin-mcp/src/__tests__/admin.integration.test.ts:633,665` (skipIf) against `:137-143` (the flag is set in beforeAll).'
    location: 'packages/iris-admin-mcp/src/__tests__/admin.integration.test.ts; scripts/lib/ci-checks.mjs allowedSkips'
    severity: 'medium'
  - summary: 'Locally, `pnpm live:bootstrap-guard` (the harness `run` mode) still publishes a dynamic host port. Docker 25 to 29 pick that port with their own allocator, which ignores `net.ipv4.ip_local_reserved_ports`, so about 1 run in 28,000 lands on a refused port and fails closed (exit 4). CI avoids this with fixed, sysctl-reserved host ports.'
    evidence: 'Plan 2026-10-21: moby `libnetwork/portallocator` (v25.0.15 `portallocator_linux.go`, v28.5.2 `portallocator.go`) reads `ip_local_port_range` and does not skip reserved ports. The 42.2 review had already recorded the exit-4 fail-closed.'
    location: 'scripts/throwaway-iris.mjs run mode'
    severity: 'low'
---

<intent-contract>

## Intent

**Problem:** Nothing runs this repository's gates on a machine other than the Lead's, and parts of the Epic 42 safety case have never run at all:
- Story 42.2's live proof of DW-508 has never run in CI (DW-672);
- an armed live run can pass by skipping every leg (DW-676);
- the publish-time gates hang only off `prepublishOnly`, which the tarball path skips (DW-443).

**Approach:**
- Add a secret-free `.github/workflows/ci.yml` with three jobs, all pinned exactly:
  - `gates`, on a Node matrix;
  - one `throwaway` job against throwaway IRIS containers that refuse the live ports;
  - a `package` job that runs only after both are green.
- A code-declared registry lists every check, and a default-suite self-test holds it equal to the workflow.
- A wrapper fails any armed suite in which a test skipped, unless an allowlist entry names that test with a reason.

## Boundaries & Constraints

**Always:**
- **Leave the shared IRIS alone** (localhost:52773, container `iris-community-edition`, HSCUSTOM marker `0.0.2+1.995fbbb1055d`). No stage runs docker, writes IRIS, or runs an armed suite against a reachable IRIS. The only armed runs are the ones `## Verification` names, each aimed at a closed loopback port or at no target, under the connect-refusing preload. Read-only probes are allowed.
- **Throwaways only.** Every CI IRIS target is a container that `scripts/throwaway-iris.mjs` created and labelled. The harness refuses ports 52773 and 1972, the name `iris-community-edition`, and any image that is not digest-pinned.
- **Extend, don't copy (Rule 2).** `scripts/throwaway-iris.mjs` gains the CI subcommands; there is no `scripts/ci-throwaway.sh`. The roster and live-capable scans move into one module that their two tests import.
- **Behavior that stays the same:** `parseCli(["run", …])`'s result and the root `live:bootstrap-guard` script stay byte-identical (both are pinned). Every `prepublishOnly` stays byte-identical. A gate script with no extra arguments behaves exactly as today.
- **Repo conventions:** changesets are `patch` or `minor` only. Non-ASCII in code is written as escapes, and comments state the contract (Rule 14). File content is never written through a shell heredoc (Rule #55).

**Never:**
- No `secrets.` reference, no `pull_request_target`, and no publish, tag, release or push step. No `continue-on-error`, and no `|| true`.
- No `prepack` or `prepare` hook (see decision 2).
- No change to the tool surface, the frozen goldens, `tools-list-snapshot.json`, the governance baseline (`1e62c5ad5bf7`/141), any bootstrapped class or `BOOTSTRAP_VERSION`.
- No edits to `irislib/` or `irissys/`. No `npm publish`, `pnpm publish`, `changeset version`/`publish`, `vsce`, `ovsx`, `npm login` or `git tag`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Push | Any branch or tag push, a PR, or `workflow_dispatch` | `gates` runs on 22.17.0, 24.0.0 and 26.0.0; `throwaway` runs; `package` runs after both pass. `run-name` carries the head sha | — |
| Superseded run | A second push to the same non-`main` ref | The older run is cancelled, but `gh run list --workflow ci.yml --commit <old sha>` still finds it. Runs on `main` are never cancelled | — |
| Armed suite, clean | Every test of the suite passed; each expected file is in the report | Exit 0 | — |
| Armed suite skipped (DW-676) | Any test is `skipped`, `pending`, `todo` or `disabled` and no allowlist entry names it; or the report has 0 tests or lacks an expected file | Exit 1, listing every offending file and test at once | names each |
| Allowlisted skip | An entry `{file, test, reason}` matches a skipped test | Passes. An entry that matches no test in the report fails as stale | exit 1 |
| Not a throwaway | `ci-live-suite.mjs <exec suite>` without `IRIS_REQUIRE_LIVE=1`, without a harness-shaped `IRIS_THROWAWAY`, with `IRIS_HOST`≠`127.0.0.1`, or with port 52773 or 1972 | Refuses before spawning anything | exit 2 |
| Harness `up` | `--image` (digest-pinned), `--namespace`, `--host-port`, `--state` | Starts a labelled container on `127.0.0.1:<port>`, waits for readiness and writes the state file. On any failure it removes the container and writes no state | 2 refusal / 3 no docker / 4 not ready |
| Harness `exec` / `logs` / `down` | `--state <file>` | Each re-inspects the container (name, label, running, port) before acting. `exec` runs the command with the throwaway env, now including `IRIS_HTTPS=false`. `logs` prints the container log tail. `down` removes it and is idempotent | refuses an unlabelled container (exit 2); a missing state means `logs` and `down` exit 0 |
| Harness `run` fails | The command exits non-zero | Prints the container log tail, then tears down, and exits with the command's code | — |
| Bootstrap guard (DW-672) | A fresh `iris-community` 2026.2 container, and separately 2024.3, in `USER` | The 9 legs pass with 0 skips. With the probe reverted to equality, the newer, foreign and DW-518 legs fail | red |
| Seed | A fresh `irishealth-community` 2026.2 container in `HSCUSTOM` | Runs the real `bootstrap()`, then PUTs and compiles only `ExecuteMCPv2.Tests.*` and `ExecuteMCPv2.QAFixtures.*`. It fails if `Ens.Director` is not visible, which means the namespace is not interoperability-enabled | exit 1 on any compile error |
| Package smoke | 8 packed tarballs | Installed together into a clean directory, with every `@iris-mcp/*` dependency resolved to the local tarballs. Each of the 5 server bins, started through `npx --no`, answers `initialize` (2025-11-25) and a `tools/list` with the snapshot's tool count. The 3 CLI bins exit 0 on a read-only call | exit 1 naming the bin |
| Red gate (DW-443) | `gates` or `throwaway` red | `package` does not run (`needs`), so the tarball path never runs on a red commit | — |

</intent-contract>

## Code Map

**Harness (extend):** `scripts/throwaway-iris.mjs`
- Image constants `:46-50`. `IRIS_COMMUNITY_IMAGE` `sha256:cd2ebcab…` is a **multi-arch manifest list** (linux/amd64 `d4331089…`, linux/arm64 `31d0ef38…`), not arm64-only as 42.2 recorded. The same holds for `IRISHEALTH_COMMUNITY_IMAGE` `462de1fb…` (amd64 `788c8626…`). No new digest is needed for x86 runners.
- The oldest pullable tag is `iris-community:2024.3@sha256:0d6dbb91f71c69a65d8577741647e961168e90699e26d158e984a2a2919a874d` (a manifest list: amd64 `6167245b…`, arm64 `dd991c1b…`). Sources, fetched 2026-10-21: `hub.docker.com/v2/repositories/intersystems/iris-community/tags`, and `registry-1.docker.io/v2/intersystems/<repo>/manifests/<digest>` (content-type `manifest.list.v2`).
- Functions:
  - `validateHostPort` `:110`; `buildRunArgv` `:163` (`-p 127.0.0.1::52773`); `buildChildEnv` `:247` (5 vars plus arming, no `IRIS_HTTPS`); `parseCli` `:271`;
  - `inspectProblems`/`assertThrowawayInspect` `:326-375`; `createTeardown` `:381`; `runHarness` `:440`; `defaultDeps` `:522`; `main` `:576`.
- Pins on these:
  - `throwaway-iris.test.ts`: `:51,67-68` (the digest value), `:136,411` (the `run` argv), `:191` (`buildChildEnv` `toEqual`), `:212-228,640-645` (the `parseCli`/usage shape);
  - `story-42-2-qa-throwaway-wiring.test.ts`: `:50-78` (the root script shape).

**Fresh-container facts (Rule #16/#54):**
- The shared instance is IRIS for Health 2026.2 (features `HEALTHSHARE`; namespaces `HSCUSTOM`, `HSLIB`, `HSSYS`, `USER`, … — read-only `iris_server_info` 2026-10-21).
- 22 `@iris-mcp/all` roster gates hard-code HSCUSTOM through `interop-namespace-fixture.ts:70` (`FIXTURE_HOME_NAMESPACE`), plus `story-39-4-qa-live-gate.test.ts:78`. `story-39-7-burn-down-live-gate.test.ts:33` needs HSLIB.
- The dev gates `execute-classmethod-epic-gate`, `execute-tests-running-contract-epic-gate` and `test-status-epic-gate`, plus `epic35-defect-gate` and `custom-rest.integration`, need `src/ExecuteMCPv2/Tests/**` (60 classes) and `QAFixtures/*` (2) loaded. Nothing loads them today.
- The integration setups probe IRIS and the custom REST service once, before any test runs, and skip the whole file otherwise (`packages/*/src/__tests__/integration-setup.ts`; e.g. admin `:25-66`).
- The Lead's OcuPilot CI installs to stock `HSCUSTOM` (Health) and `USER` (plain) and asserts that interoperability works there without enabling it (`../OcuPilot/.github/workflows/ci.yml:371-374`). That is the evidence that both namespaces are interoperability-enabled stock; the seed re-checks it.

**Gate scripts and hooks:**
- `packages/{iris-admin-mcp,iris-data-mcp,iris-dev-mcp,iris-mcp-all}/scripts/prepublish-gate.mjs`: `spawnSync("pnpm", ["exec","vitest","run",…gateTestFiles])` (dev `:116`). They forward no argv, so a reporter cannot be passed in. Their header claims "This repo has no CI".
- `prepublishOnly`:
  - admin = verify-iris-reachable + gate;
  - data, dev and all = gate only;
  - shared, client-config, interop and ops = `verify-iris-reachable.mjs` only.
  - No package has `prepack`, `prepare` or `postpack`.
- `scripts/verify-iris-reachable.mjs:80` and `scripts/lib/iris-target.mjs:64-85` fail closed under `CI` unless all six `IRIS_*` are set, `IRIS_HTTPS` included. The harness never sets `IRIS_HTTPS`, so today this would fail in CI. It also needs `cwd` = the package directory.
- Integration configs: `packages/{shared,iris-dev-mcp,iris-admin-mcp,iris-data-mcp,iris-interop-mcp,iris-ops-mcp}/vitest.integration.config.ts`. interop and ops have no `test:integration` script, so use `pnpm exec vitest run --config vitest.integration.config.ts`.
- The process gates are in `packages/iris-mcp-all/src/__tests__/`: `credentials-cli-process-gate`, `governance-file-process-gate`, `host-guard-process-gate`, `server-manager-precedence-gate` and `server-manager-process-gate`. They arm through `liveArmingSkipReason()` and skip, not throw, when unreachable.
- The launcher's live files are `extensions/iris-mcp-launcher/src/__tests__/{governanceUiRoundTrip,localSpawnIntegration}.test.ts`; its guard is `live-arming-guard.test.ts` plus `liveArming.test.ts`. It has its own `package-lock.json` and its scripts are `test`, `type-check` and `build`, with no lint.

**Scans to move (Rule 2):**
- `packages/iris-mcp-all/src/__tests__/live-gate-roster.test.ts:21-59`: `listedGateFiles`, `ARMED_GATE`, `NAMED_EXEMPTIONS`, `armedTestFiles`.
- `packages/iris-mcp-all/src/__tests__/live-arming-guard.test.ts:55-97`: `LIVE_CAPABLE`, `walk`, `testSources`.

**vitest 2.1.9:**
- `--reporter=default --reporter=json --outputFile.json=<path>` works.
- Per-test statuses are `passed|failed|skipped|pending|todo|disabled`. `ctx.skip()` and `skipIf` both come out as `skipped`, while an early `return` comes out as `passed`.
- File names in the report are absolute.

**Smoke reuse:**
- `scripts/lib/sdk-wire-golden-core.mjs`: `CLOSED_PORT_ENV` `:38`, `openRawWire({entry, env})` `:255` (spawns `process.execPath`), `handshake` `:357`.
- `packages/iris-mcp-all/src/__tests__/fixtures/tools-list-snapshot.json` `servers`: admin 27, data 8, dev 33, interop 25, ops 22. It is captured under preset `full`, the default when `IRIS_TOOLS_*` is unset.
- `pack-fixture.ts:149` `pnpmPack` runs `pnpm --config.ignore-scripts=true pack`.
- 42.1's probe (spec `:248`) found that `@iris-mcp/*` dependencies must resolve to `file:` tarballs to stay off the registry.
- Bins:
  - the servers `iris-{dev,admin,interop,ops,data}-mcp` (shebang at `src/index.ts:1`, pinned by no test);
  - `iris-mcp-clients` (client-config);
  - `iris-mcp-credentials` and `iris-mcp-governance` (shared; both print `Usage: <bin>` on `--help`);
  - `@iris-mcp/all` has no bin.

**Seed reuse:**
- `packages/shared/src/bootstrap.ts`: `deployClasses` `:348` and `compileClasses` `:367` are hard-wired to `BOOTSTRAP_CLASSES`.
- `bootstrap` `:660` is `(http, config, version)`, exported at `index.ts:120`, together with `IrisHttpClient` and `negotiateVersion`.
- `scripts/verify-iris-reachable.mjs` is the precedent for a script that imports the shared dist.

**Gates inputs:**
- 42.1's checks are default-suite files of `@iris-mcp/all` (`vitest.config.ts` includes `src/__tests__/**/*.test.ts` and excludes `*.integration.test.ts`):
  - `release-1-0-0-mechanism.test.ts`
  - `package-manifests.test.ts` (metadata and the engines floor)
  - `published-tarballs.test.ts` (exports versus tarball)
  - `npx-pin.test.ts`
- The other gate scripts:
  - `scripts/check-epics-sync.mjs` is read-only, and exits 0 today (run 2026-10-21).
  - The `:check` scripts need built dists; `check:provenance` spawns `npm pack --dry-run --offline`.
  - Lint is `eslint src/` with no `--max-warnings`. The one standing warning is `packages/shared/src/cli/governance.ts:935` (DW-666; `no-dynamic-delete` is not in `recommended`, so the line alone is removed).
- Tooling:
  - `yaml` 2.9.0 is a dependency of `client-config` only; `@iris-mcp/all` cannot import it.
  - `actionlint` is not installed locally.
- Action pins (`gh api repos/<o>/<r>/commits/<tag> --jq .sha`, 2026-10-21; each `action.yml` declares `using: node24`):
  - `actions/checkout` `fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09` (v5.1.0)
  - `actions/setup-node` `a0853c24544627f65ddf259abe73b1d18a591444` (v5.0.0)
  - `pnpm/action-setup` `fc06bc1257f339d1d5d8b3a19a8cae5388b55320` (v4.4.0; reads `packageManager` `pnpm@9.15.0`, so pass no `version`)

**Reference:** `../OcuPilot/.github/workflows/ci.yml` and `../OcuPilot/ui/tools/ci.test.mjs:1-200`: the declared-gate equality with duplicates kept, comment-stripped absence checks, the pinned-action allowlist, the `sysctl` reservation, `logs` on `failure() || cancelled()`, and `down` on `always()`.

## Tasks & Acceptance

**Execution** (dependency order):
- `scripts/lib/live-gate-scan.mjs` (new) and `packages/iris-mcp-all/src/__tests__/live-gate-roster.test.ts`, `live-arming-guard.test.ts` -- move the scans (Code Map) into the module, adding `readRoster(packageDir)` and `liveCapableTestFiles()`, and import them back. Both tests' cases and assertions stay the same. Rationale: Rule 2; the registry and the self-test reuse them.
- `scripts/throwaway-iris.mjs` -- extend (DW-672, AC 42.3.2).
  - **New:**
    - add `OLDEST_IRIS_COMMUNITY_IMAGE`;
    - correct the image comments to "multi-arch manifest list", citing the source above;
    - `buildChildEnv` adds `IRIS_HTTPS: 'false'` and takes an optional `namespace`, default `USER`;
    - `buildRunArgv` takes an optional `hostPort` (`-p 127.0.0.1:<port>:52773`, validated; omitting it keeps today's argv);
    - `validateNamespace` (`^[A-Z][A-Z0-9]{0,63}$`);
    - an exported `assertThrowawayEnv(env)`: `IRIS_REQUIRE_LIVE=1`, a valid `IRIS_THROWAWAY` name, `IRIS_HOST=127.0.0.1` and a port that is not refused.
  - **Subcommands:**
    - `run [--image] [--host-port]` stays, and prints `docker logs --tail 200` before teardown when the command fails;
    - `up --image --namespace --host-port --state` keeps the container only on success (state JSON `{name, id, port, image, namespace}`, written with mode 0600);
    - `exec --state -- <cmd>`, `logs --state` (`docker logs --tail 400`) and `down --state` each run `assertThrowawayInspect` first.
  - **Contract:**
    - `parseCli(["run", …])` returns exactly what it returns today;
    - every subcommand goes through injected deps, with no spawn on import;
    - update the header contract.
- `packages/shared/src/bootstrap.ts` -- `deployClasses(http, config, version, classes = BOOTSTRAP_CLASSES)` and `compileClasses(…, names = [...BOOTSTRAP_CLASSES.keys()])`.
  - `compileClasses` also returns the Atelier response, so a caller can read the compile errors.
  - Both parameters are optional. Callers that omit them get today's requests, and the bootstrap callers ignore the return (AD-15; the fetch-count pins in `bootstrap.test.ts` stay green).
  - Rebuild shared. The seed uses these (Rule 2).
- `packages/{iris-admin-mcp,iris-data-mcp,iris-dev-mcp,iris-mcp-all}/scripts/prepublish-gate.mjs` -- append `...process.argv.slice(2)` to the vitest args, and replace the "no CI" header claim with the contract. Rationale: AC 42.3.2 and DW-676 (the JSON report reaches the real gate).
- `packages/shared/src/cli/governance.ts:935` -- delete the unused directive (DW-666). In the 7 `packages/*/package.json`, `lint` becomes `eslint src/ --max-warnings 0`.
- `scripts/lib/ci-checks.mjs` (new) -- the code-declared CI registry (AD-29), plain ESM that both the scripts and the tests import:
  - **Pins and legs:**
    - `NODE_LEGS = ['22.17.0','24.0.0','26.0.0']`
    - `RUNNER = 'ubuntu-24.04'`
    - `PINNED_ACTIONS` (the three pins above, as `{action, sha, tag}`)
    - `CI_HOST_PORTS = {guard: '52790', live: '52791'}`
    - `LIVE_NAMESPACE = 'HSCUSTOM'`
  - **`DECLARED_STEPS`:** per job, the ordered `{run, workingDirectory?, if?, id?}` of every step that has a `run:`, with duplicates kept. The content is listed under Design Notes.
  - **`LIVE_SUITES`:** id → `{kind: 'vitest'|'plain'|'harness', cwd, command[], expectedFiles(), allowedSkips: [{file, test, reason}]}`.
    - `bootstrap-guard`: harness `run --host-port 52790 --`, followed by the exact command of the root `live:bootstrap-guard` script.
    - `bootstrap-guard-oldest`: the same, with `--image <OLDEST_IRIS_COMMUNITY_IMAGE>`.
    - `prepublish-<pkg>`, for each of the 8 packages with a `prepublishOnly`: `pnpm run prepublishOnly` in the package directory. It is `vitest` when the package has `scripts/prepublish-gate.mjs` (its expected files are the roster), else `plain`.
    - `integration-<pkg>` ×6: `pnpm exec vitest run --config vitest.integration.config.ts`.
    - `process-gates`: the 5 files.
    - `launcher-live`: the 2 files, through `npx --no -- vitest run`.
  - **`allowedSkips` to start with:**
    - the 4 `it.runIf(CAPTURE)` capture legs (`story-39-1`, `-2`, `-3`, `-4` live gates; reason: they run only under the golden-capture CLI);
    - the 2 OAuth tests in `admin.integration` (deferred item 2).
    - Build the rest by grepping every armed file for `skipIf`, `runIf`, `ctx.skip`, `.skip(` and `.todo(`. Never add an entry for an unverified environmental skip (DocDB, keyring): the first CI run calibrates those.
  - **`CI_LIVE_EXEMPTIONS`:** live-capable `*.test.ts` files that run in no armed suite, each with a reason, such as unit tests of the arming helpers.
- `scripts/ci-live-suite.mjs` (new) -- `node scripts/ci-live-suite.mjs <suite-id>`. The exports and tests are DW-676's, the AC 42.3.2 wiring is DW-672's.
  - **Refuses first** (exit 2, nothing spawned): every suite except the two `harness` ones requires `assertThrowawayEnv(process.env)` to pass. The `harness` suites start their own container.
  - **Runs** the suite's command in its cwd.
    - For `vitest` and `harness` suites, it appends `--reporter=default --reporter=json --outputFile.json=<mkdtemp>/report.json`.
    - It then applies the exported pure `classifyVitestReport(report, {cwd, expectedFiles, allowedSkips})`, which returns problems.
  - **Exit code:**
    - the command's own code when that is non-zero (the skip summary is still printed);
    - 1 on any problem, listing all of them;
    - otherwise 0.
- `scripts/ci-seed-throwaway.mjs` (new) -- refuses first, like `ci-live-suite`, through `assertThrowawayEnv`. Then it:
  1. loads the config from the shared dist (as `verify-iris-reachable.mjs` does) and runs `bootstrap()`; it fails unless `errors` is empty and either `probeStatus` is `current` or `deployed`, `compiled`, `configured` and `mapped` are all true;
  2. checks that `Ens.Director` is visible in `%Dictionary.CompiledClass`, failing closed with the namespace named;
  3. PUTs and compiles every file under `src/ExecuteMCPv2/Tests/**` and `src/ExecuteMCPv2/QAFixtures/*`, through the extended `deployClasses`/`compileClasses`, and fails on any compile error in the returned response.
  - An exported `seedDocuments(repoRoot)` asserts that this list is disjoint from `gen-bootstrap.mjs` `classes[]`: `Setup.cls` from `src/` would pin `dev` (AD-14).
- `scripts/ci-package-smoke.mjs` (new) -- AC 42.3.3, DW-443. Exported pure helpers: `publishablePackages()`, `binsOf(manifest)`, `installManifest(tarballs)` (with `dependencies` and `overrides` as `file:` for every `@iris-mcp/*` package) and `expectedToolCount(server)`.
  - **Main:**
    1. `pnpm pack` every non-private `packages/*` package, with scripts on (the real path);
    2. `npm install --no-audit --no-fund` in a fresh temp directory;
    3. for each server bin, `npx --no -- <bin>` with `CLOSED_PORT_ENV` and no `IRIS_TOOLS_*`, then `handshake(2025-11-25)` and `tools/list`, whose count must equal the snapshot;
    4. for the CLIs: `--help` must print `Usage: <bin>`, and `iris-mcp-clients detect --json` must exit 0 with `HOME` set to an empty temp directory;
    5. removes the temp directories.
  - **Extend, don't copy:** `openRawWire` gains optional `{command, args, cwd}` (default unchanged). `pnpmPack` moves to `scripts/lib/pnpm-pack.mjs` with an `ignoreScripts` option, and `pack-fixture.ts` re-exports it unchanged.
- `packages/iris-mcp-all/package.json` and `pnpm-lock.yaml` -- devDependency `"yaml": "2.9.0"` (already in the lockfile), for the self-test.
- `.github/workflows/ci.yml` (new) -- exactly `DECLARED_STEPS` (Design Notes):
  - `permissions: contents: read`;
  - `on`, `concurrency` and `run-name` exactly as written under Design Notes;
  - `timeout-minutes` gates 60, throwaway 150, package 30;
  - setup steps: pnpm, then node with `cache: pnpm`;
  - a header comment stating what runs and why.
- `packages/iris-mcp-all/src/__tests__/ci-workflow.test.ts` (new; the AC 42.3.1/42.3.4/42.3.5 self-test) parses `ci.yml` with `yaml` and asserts:
  - **Steps:** each job's run steps equal `DECLARED_STEPS` in both directions, with duplicates kept (`run`, `working-directory`, `if`, `id`). `LIVE_SUITES` ids used in the workflow equal the registry's ids.
  - **Pins:** every `uses:` is in `PINNED_ACTIONS` with a 40-hex sha and a trailing `# <tag>`. `runs-on` is `RUNNER`. Every image reference in the workflow and the registry is one of the harness's digest constants. `packageManager` is an exact `pnpm@x.y.z`. No `@latest` and no `npx -y`.
  - **Node matrix:** `gates.strategy.matrix.node` equals `NODE_LEGS`. `NODE_LEGS[0]` equals the `engines.node` floor of the root and of every `packages/*` manifest. The other legs are `<even major>.0.0`, rising by 2 with no gap. Every other job uses `NODE_LEGS[0]`.
  - **Hygiene:**
    - over the comment-stripped text: no `continue-on-error`, `|| true`, `secrets.`, `pull_request_target`, or publish/push command;
    - `permissions` is exactly `{contents: read}`, and no job widens it;
    - `concurrency` cancels except on `refs/heads/main`;
    - the `sysctl` step reserves exactly `CI_HOST_PORTS`, and none of them is refused;
    - `logs` runs on `failure() || cancelled()`, and `down` on `always()`.
  - **DW-443:** `package.needs` ⊇ {`gates`, `throwaway`}, and every package with a `prepublishOnly` has its `prepublish-<pkg>` step.
  - **DW-676:**
    - every `scripts/prepublish-gate.mjs`, every `vitest.integration.config.ts`, the 5 process gates and the 2 launcher live files is covered by a suite;
    - every live-capable `*.test.ts` file (`live-gate-scan.mjs`) is in a suite or in `CI_LIVE_EXEMPTIONS`;
    - every `allowedSkips`/exemption entry names an existing file and a non-empty reason.
  - **42.1:** the four 42.1 check files exist and are inside `@iris-mcp/all`'s vitest include, not its exclude.
  - **Docs:** the README CI section names each job and every `NODE_LEGS` entry.
- `packages/iris-mcp-all/src/__tests__/ci-live-suite.test.ts` (new):
  - `classifyVitestReport` over **real** reports. They are produced at test time by child `vitest run --reporter=json` over tiny temp fixture files: one passing, one `it.skip`, one `ctx.skip`, one `todo`, one with 0 tests, and one with a missing expected file. These cover the allowlisted and stale-allowlist rows.
  - The refusal rows.
  - **The real path (Rule #59):** `node scripts/ci-live-suite.mjs integration-admin` with a harness-shaped fake `IRIS_THROWAWAY`, all five `IRIS_*` set, and `IRIS_HOST=127.0.0.1` on a closed port (`reserveClosedPort`), under `no-live-iris-preload.mjs`. The admin setup cannot reach IRIS, so vitest exits 0 with every test skipped. `ci-live-suite` must exit 1 naming those tests, and the connect log may hold no 52773 or 1972 entry.
- `packages/iris-mcp-all/src/__tests__/throwaway-iris.test.ts` (extend) -- every new subcommand, flag and refusal with injected deps:
  - `up` failure removes the container and writes no state;
  - `exec` and `down` refuse an unlabelled container;
  - `down` without state is a no-op;
  - `run` prints logs on failure;
  - `buildChildEnv` now includes `IRIS_HTTPS`.
  - Plus a child run of `scripts/verify-iris-reachable.mjs` with `CI=true` and the harness env at a closed port: it must report unreachable, never "IRIS_HTTPS is not set".
- `packages/iris-mcp-all/src/__tests__/ci-seed-throwaway.test.ts` and `ci-package-smoke.test.ts` (new):
  - **Seed:** `seedDocuments` holds exactly the 62 fixture files and none of the bootstrap classes; the env refusals; one hermetic seed run against `stateful-fake-atelier.ts`, extended if it lacks generic document PUT/compile and the `Ens.Director` query (Rule 2).
  - **Smoke:** its pure helpers (packages, bins, the overrides map, the counts equal to the snapshot).
- `README.md` `## Contributing` -- a new `### Continuous Integration` section:
  - the three jobs, the Node legs, the images and namespaces;
  - that the workflow is secret-free and publishes nothing;
  - the fail-on-skip rule;
  - that `pnpm live:bootstrap-guard` needs Docker and removes its own container.
- `CHANGELOG.md` gets a Story 42.3 section at the top, and there is a new `.changeset/story-42-3-ci-workflow.md` (`"@iris-mcp/shared": patch`).

**Acceptance Criteria:**
- **AC 42.3.1:** Given `ci.yml` and `DECLARED_STEPS`, when `ci-workflow.test.ts` runs, then the gates job's run steps equal the declared ones. These are install, `pnpm build`, `pnpm lint`, `pnpm type-check`, 8 per-package test steps, the six `:check`/validate/provenance scripts, `node scripts/check-epics-sync.mjs`, and the launcher's `npm ci`, `type-check`, `build` and guard. The matrix is exactly `22.17.0, 24.0.0, 26.0.0`. Given a dropped step, an undeclared step, a changed leg or a moved `engines.node` floor, then it fails naming the difference.
- **AC 42.3.2:** Given the story commit pushed to `origin`, when its CI run completes green (lead checklist step 1), then:
  - the throwaway job's log shows the 2026.2 bootstrap-guard suite, the oldest-image suite, and every `prepublish-*`, `integration-*`, `process-gates` and `launcher-live` suite passing through `ci-live-suite.mjs`, each reporting 0 unlisted skips;
  - the seed has passed against `irishealth-community:2026.2` in `HSCUSTOM`;
  - `down` has removed the container.
- **AC 42.3.2 (local):** Given the harness, when `throwaway-iris.test.ts` runs with injected deps, then:
  - every refusal holds (ports 52773 and 1972, the shared name, a floating image, a bad namespace, an unlabelled container);
  - `up` removes the container on failure;
  - `run` prints logs before teardown on failure;
  - the child env satisfies `verify-iris-reachable.mjs` under `CI=true`.
- **AC 42.3.3:** Given that run, when its package job runs, then:
  - all 8 tarballs installed with no `@iris-mcp/*` registry fetch;
  - the 5 servers answered `initialize` and `tools/list` with 27, 8, 33, 25 and 22 tools;
  - the 3 CLIs exited 0.
  - Locally, `node scripts/ci-package-smoke.mjs` does the same, and the shebang mutation turns it red.
- **AC 42.3.4:** Given any one of these mutations to `ci.yml`, when `ci-workflow.test.ts` runs, then it fails: an unpinned `uses:`, a `continue-on-error`, a `|| true`, a `secrets.` reference, wider `permissions`, the `concurrency` block removed, or the `sysctl` step removed or reserving 52773.
- **AC 42.3.5 / DW-443:**
  - Given a red `gates` or `throwaway` job, when the run continues, then the package job does not run (lead branch 6).
  - Given a `prepublishOnly` with no matching CI suite, or `package.needs` without `throwaway`, when the self-test runs, then it fails.
  - Given the forwarding removed from one `prepublish-gate.mjs`, when that package's `prepublishOnly` runs with the reporter arguments, then no JSON report is written, so `ci-live-suite` fails "report missing".
- **AC 42.3.6:** Given the story commit on `origin`, when the lead runs the `## Verification` lead checklist, then each listed throwaway branch's run goes red in the named job and step, each run URL is recorded under `## Verification`, and every throwaway branch is deleted locally and on `origin`.
- **DW-676:** Given an armed suite in which a test skipped, when `ci-live-suite.mjs` checks it, then it exits non-zero naming the test. This is proven locally on the real `integration-admin` path, and in CI by lead branch 4.
- **DW-672:**
  - Given CI's bootstrap-guard suites, when the story commit's run executes them on the amd64 runner, then they pass with the existing manifest-list pin.
  - Given the probe reverted to equality on lead branch 5, when its run executes, then they fail, and the run URL is recorded.
- **DW-666:** Given this story's diff, when `pnpm --filter @iris-mcp/shared lint` runs, then it exits 0 with no warning. Given the directive re-added, then lint exits non-zero.
- **Shared instance:** Given each stage's end, when `SELECT ExecuteMCPv2.Setup_GetBootstrapVersion()` runs read-only (`server:"default"`, `namespace:"HSCUSTOM"`), then it returns `0.0.2+1.995fbbb1055d`.

## Spec Change Log

## Review Triage Log

## Design Notes

**Governing ADs and conventions (Rule 6):**
- **AD-29** (CI: secret-free; throwaways refuse the live ports; a gate is registered in code and in `ci.yml` with a self-test; publishing waits for CI green);
- **AD-14** (the seed never deploys a bootstrapped class from `src/`; the real `bootstrap()` does);
- **AD-15** (`deployClasses`/`compileClasses` defaults and the unchanged `prepublishOnly` are proven by the existing tests staying green);
- **AD-2** (the cross-package checks live in `scripts/` and `iris-mcp-all`, and each script shares its implementation with its test);
- **AD-1** (only the harness's container setup uses `docker exec`; the seed and the suites go through the web port);
- **Conventions:** Live gates, Live testing on a shared instance, Turbo test tasks, and the Stack row (Node floor 22.17.0; legs 22.x, 24.x and 26.x).

**`DECLARED_STEPS` (the run steps, in order):**
- **`gates`**, ×3 Node legs:
  - `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm lint`, `pnpm type-check`;
  - `pnpm --filter <pkg> test` for shared, client-config, admin, data, dev, interop, ops and all;
  - `pnpm gen:governance-baseline:check`, `pnpm gen:skills:check`, `pnpm gen:pack:check`, `pnpm validate:prompts`, `pnpm check:provenance`, `pnpm gen:tools-list-snapshot:check`, `node scripts/check-epics-sync.mjs`;
  - then, with working directory `extensions/iris-mcp-launcher`: `npm ci`, `npm run type-check`, `npm run build`, `npx --no -- vitest run src/__tests__/live-arming-guard.test.ts src/__tests__/liveArming.test.ts`.
- **`throwaway`:**
  1. Setup: install, build, the launcher's `npm ci`, `cat /proc/sys/net/ipv4/ip_local_port_range`, then `sudo sysctl -w net.ipv4.ip_local_reserved_ports=52790,52791` (`id: setup`).
  2. `node scripts/ci-live-suite.mjs bootstrap-guard` and `… bootstrap-guard-oldest`, each with `if: ${{ !cancelled() && steps.setup.outcome == 'success' }}`.
  3. `node scripts/throwaway-iris.mjs up --image <the literal IRISHEALTH_COMMUNITY_IMAGE reference> --namespace HSCUSTOM --host-port 52791 --state ${{ runner.temp }}/throwaway-live.json` (`id: up`, same `if`).
  4. `… exec --state … -- node scripts/ci-seed-throwaway.mjs` (`id: seed`, `if` on `steps.up`).
  5. `… exec --state … -- node scripts/ci-live-suite.mjs <id>` for the 8 `prepublish-*`, the 6 `integration-*`, `process-gates` and `launcher-live`, each with `if` on `steps.seed`.
  6. `… logs --state …` (`if: ${{ failure() || cancelled() }}`) and `… down --state …` (`if: ${{ always() }}`).
  - The `!cancelled()` conditions let one run show every suite's result. The job still fails if any step failed.
- **`package`** (`needs: [gates, throwaway]`): install, build, `node scripts/ci-package-smoke.mjs`.
- `on: push` (every branch and tag), `pull_request`, `workflow_dispatch`.
- `concurrency: {group: ci-${{ github.ref }}, cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}}`.
- `run-name: ci ${{ github.ref_name }} ${{ github.event.pull_request.head.sha || github.sha }}`. A run for a sha is `gh run list --workflow ci.yml --commit <sha>`. A cancelled run there means a later push superseded it.

**Rule 2:**
- **Extended:** `throwaway-iris.mjs` (subcommands, no `.sh`); `deployClasses`/`compileClasses` (optional class list); `openRawWire` (optional command); `pnpmPack` (moved, with an option); the two scans (moved into `live-gate-scan.mjs`).
- **Not unified here:** the four gate scripts stay separate copies (pre-existing). Each gains only its one argv line.

**Integration ACs:** consumer `.github/workflows/ci.yml` runs `ci-live-suite.mjs` under `throwaway-iris.mjs exec`. The observable effect is a red step naming the skipped tests (the `ci-live-suite.test.ts` real-path case, and lead branch 4). Consumer `ci-workflow.test.ts` reads `ci-checks.mjs` and goes red on any drift.
- **Consumed-by:**
  - 42.4 (the IPM offline proof joins the `package` job and reuses `up`/`exec`/`down`);
  - 42.5 (`release.yml` requires a green CI run on the tagged sha; tags run CI because `push` is unfiltered; the release script exports all five `IRIS_*`, DW-675);
  - 42.6 (the tarball smoke reuses `ci-package-smoke.mjs`);
  - 42.7 (adds the full launcher suite, DW-532);
  - 42.9 (the README's tested range comes from the oldest-image leg).
- **Consumes:** 42.1's checks; 42.2's harness, gate, arming helper and preload.

**Ledger inbox:**
- **DW-443:** addressed by the DW-443 task items and AC 42.3.5 (CI as the gate, `needs`, the `prepublish-<pkg>` suites, lead branch 6).
- **DW-666:** addressed by the `governance.ts:935` task and the DW-666 AC.
- **DW-672:** addressed by the harness, the `bootstrap-guard*` suites, the DW-672 AC and lead branch 5. The amd64 question is settled by the evidence that the pin is a manifest list.
- **DW-676:** addressed by `ci-live-suite.mjs`, the coverage assertions, the launcher guard step, the `process-gates` suite, the DW-676 AC and lead branch 4.

**AC reinterpretations:**
- `scripts/ci-throwaway.sh` becomes subcommands of `scripts/throwaway-iris.mjs` (Rule 2; the lead's call delegated to the plan).
- "Its own scratch compose file" becomes a generated, labelled `docker run` removed with `rm -v`. The repo has no compose file to collide with.
- "npm pack" becomes `pnpm pack`: only pnpm applies `publishConfig.exports` and rewrites `workspace:*` (DW-387).
- "Launch each bin with a stdio initialize" applies to the 5 server bins; the 3 CLI bins get a read-only invocation.
- "A sysctl port reservation" means that CI publishes fixed host ports 52790 and 52791, which the reservation keeps clear of the runner's ephemeral ports. Docker's dynamic allocator ignores reservations (deferred item 3).
- "42.1's checks" run inside the `@iris-mcp/all` test step; the self-test pins that they are included.
- "The floor of each major" is 22.17.0, 24.0.0 and 26.0.0.

**Decided at the spec gate (2026-10-22):** all seven recommendations were accepted as written. They are wave-8 orchestrator decisions #56 (`irishealth-community:2026.2` in `HSCUSTOM` for the armed suites), #57 (CI as the publish-time gate, no `prepack`), #58 (a CI-only armed suite for the five process gates), #59 (the 7 lead branches for AC 42.3.6), #60 (the bootstrap guard on `iris-community:2024.3`, moving forward a tag if it is red), #61 (the launcher's full suite out of CI until 42.7) and #62 (runs on `main` are never cancelled). The lead wrote the three spine drafts below: the Stack row, the AD-29 CI bullet and the Live gates convention. `lint_spine.py` is clean. The implement stage does not edit the spine, never pushes, never triggers CI and never runs docker. The first CI run and the 7 red branches are the lead's checklist at its smoke.

**Orchestrator decisions needed (as planned):**
1. **Where the armed rosters run.** Orchestrator decision needed: which image and namespace — recommended: `irishealth-community:2026.2` in `HSCUSTOM` (option A). The gates were written and proven against IRIS for Health 2026.2 `HSCUSTOM`. 23 of them hard-code HSCUSTOM, one needs HSLIB, and plain IRIS has neither. Plain IRIS stays covered by the bootstrap guard on 2026.2 and 2024.3 (all 35 classes compile).
   - Other options: (B) port the 23 gates to `IRIS_NAMESPACE` and make the HSLIB leg conditional, which touches other epics' gates; (C) an edition matrix, which needs (B) anyway.
   - This narrows AC 42.3.2's "iris-community" wording for the live suites.
2. **DW-443 mechanism.** Recommended: CI is the gate, with no `prepack`. `package` `needs` both gate jobs, CI runs every `prepublishOnly` armed, and 42.5's release consumes CI green. A `prepack` would make every `pnpm pack` (42.6's local smoke, the package job) need a live IRIS and rerun 54 live files.
3. **DW-676's five process gates.** Recommended: a CI-only armed suite (`process-gates`), not the prepublish roster. Their contract ("never fails on a pristine or offline checkout") stays intact, and CI still covers their armed side.
4. **AC 42.3.6 scope.** Recommended: the 7 lead branches below. They cover each self-test and each check this story adds or wires for the first time. Pre-existing checks carry their owning stories' mutation evidence, and the step-equality self-test proves none of them can be dropped silently. Breaking every step would cost about 25 runs.
5. **The oldest-image leg.** Recommended: run the bootstrap-guard gate on `iris-community:2024.3`, the oldest tag Docker Hub serves. If its first run is red on a compile error, the lead records the errors (they bear on the 2023.1+ support claim), moves `OLDEST_IRIS_COMMUNITY_IMAGE` forward one tag (2025.1, 2025.2, 2025.3, 2026.1), and reruns. The oldest green tag becomes 42.9's tested floor.
6. **The launcher's full suite.** Recommended: it stays out of CI until 42.7 (DW-532; deferred item 1). Its baseline failures also fail on Linux.
7. **`main` exemption.** Recommended: never cancel runs on `main`. Every main commit, the future tag targets among them, keeps a complete run. A superseded run on any other ref is cancelled but still findable by sha.

**Spine amendment drafts for the lead (Rule 20), pending decisions 1, 3 and 5:**
- **Stack row "IRIS CI images":** "`intersystems/iris-community:2026.2` and `:2024.3` (the bootstrap guard, `USER`) and `intersystems/irishealth-community:2026.2` (the armed rosters, integration suites, process gates and launcher live files, `HSCUSTOM`), each pinned by its manifest-list digest."
- **AD-29 CI, append:** "CI's armed suites run only against a throwaway (`IRIS_THROWAWAY`), and a suite in which any test skipped fails unless its allowlist names the test with a reason (DW-676). The package job runs only after the gate and throwaway jobs pass, so no tarball is built from a red commit (DW-443)."
- **Live gates convention:** replace "From Story 42.3, CI runs every roster." with "CI runs every package's `prepublishOnly`, armed, plus every integration suite, the five process gates and the launcher's live files, against a seeded IRIS for Health throwaway (Story 42.3)."

**Rule #42 note for the retro:** 42.2 recorded the pinned digest as arm64. It is the multi-arch manifest list.

## Verification

Run from `/Users/jbrandt/git/iris-execute-mcp-v2`, one command per foreground call with `timeout: 600000`. Rebuild a package after editing its `src/` (`pnpm --filter <pkg> build`). `UNARMED` = `env -u IRIS_HOST -u IRIS_PORT -u IRIS_USERNAME -u IRIS_PASSWORD -u IRIS_NAMESPACE -u IRIS_HTTPS -u IRIS_REQUIRE_LIVE -u IRIS_TEST_HOST -u IRIS_TEST_PORT -u IRIS_THROWAWAY`. No stage runs docker, pushes, or triggers CI. `actionlint` is not installed and is not run; YAML validity is proven by the self-test's parse and by the lead's first run.

**Commands:**
- `(loop)` `for f in scripts/throwaway-iris.mjs scripts/ci-live-suite.mjs scripts/ci-seed-throwaway.mjs scripts/ci-package-smoke.mjs scripts/lib/ci-checks.mjs scripts/lib/live-gate-scan.mjs scripts/lib/pnpm-pack.mjs; do node --check "$f" || exit 1; done` -- expected: exit 0.
- `(loop)` `UNARMED CI=true pnpm --filter @iris-mcp/all exec vitest run src/__tests__/ci-workflow.test.ts src/__tests__/ci-live-suite.test.ts src/__tests__/ci-seed-throwaway.test.ts src/__tests__/ci-package-smoke.test.ts src/__tests__/throwaway-iris.test.ts src/__tests__/story-42-2-qa-throwaway-wiring.test.ts src/__tests__/live-gate-roster.test.ts src/__tests__/live-arming-guard.test.ts src/__tests__/published-tarballs.test.ts src/__tests__/story-42-2-bootstrap-guard-orchestration.test.ts` -- expected: green.
- `(loop)` `pnpm --filter @iris-mcp/shared lint` -- expected: exit 0, 0 warnings.
- `(loop)` `(cd extensions/iris-mcp-launcher && UNARMED npx --no -- vitest run src/__tests__/live-arming-guard.test.ts src/__tests__/liveArming.test.ts)` -- expected: green.
- `(once)` `UNARMED CI=true pnpm --filter <pkg> test` for each of shared, client-config, admin, data, dev, interop and ops (one call each), and `@iris-mcp/all` as `-- --shard=1/2` and `-- --shard=2/2` -- expected: green. The `CI=true` stands in for the runner.
- `(once)` `pnpm lint` and `pnpm type-check` (per package if turbo flakes); `npm --prefix extensions/iris-mcp-launcher run type-check`; `npm --prefix extensions/iris-mcp-launcher run build` -- expected: green, with 0 lint warnings.
- `(once)` `pnpm gen:governance-baseline:check`, `pnpm gen:skills:check`, `pnpm gen:pack:check`, `pnpm validate:prompts`, `pnpm check:provenance`, `pnpm gen:tools-list-snapshot:check`, `node scripts/check-epics-sync.mjs` -- expected: all OK (baseline `1e62c5ad5bf7`/141).
- `(once)` `UNARMED node scripts/ci-package-smoke.mjs` -- expected: exit 0 for all 8 bins. It reaches registry.npmjs.org for third-party dependencies only, and no IRIS.
- `(once)` `UNARMED NODE_OPTIONS=--import=<repo>/scripts/lib/no-live-iris-preload.mjs IRIS_MCP_CONNECT_LOG=<scratch>/c.log pnpm --filter @iris-mcp/data run prepublishOnly --reporter=default --reporter=json --outputFile.json=<scratch>/data.json` -- expected: a non-zero exit (armed with no target, so it fails closed naming the variables), `data.json` exists (the forwarding works on the real hook), and `c.log` is empty.
- `(once)` A read-only HSCUSTOM `SELECT ExecuteMCPv2.Setup_GetBootstrapVersion()` before and after -- expected: `0.0.2+1.995fbbb1055d` both times.

**Mutations (Rule 19).** Apply each, observe red, revert, then check `git status --short` and `git diff --stat` unchanged, and record it as `mutation: … → …`:
- AC 42.3.1: matrix `22.17.0`→`22.18.0` in `ci.yml` → the matrix case; delete the `check-epics-sync` step → the step-equality case; root `engines.node` `>=22.18.0` → the floor case.
- AC 42.3.2: `buildChildEnv` without `IRIS_HTTPS` → the `verify-iris-reachable` CI case; `exec` without `assertThrowawayInspect` → the unlabelled-container case; `up` accepting `--host-port 52773` → the refusal case.
- AC 42.3.3: remove the shebang from `packages/iris-data-mcp/src/index.ts` and rebuild → `ci-package-smoke.mjs` exits 1 naming `iris-data-mcp`. Then confirm that the default suites stay green with that mutation, which makes it lead branch 7's oracle.
- AC 42.3.4: `actions/checkout@v5` → the pins case; add `continue-on-error: true` / `|| true` / `${{ secrets.X }}` → the absence cases; remove `concurrency` → its case.
- AC 42.3.5: drop `throwaway` from `package.needs` → the needs case; remove the argv forward from `iris-data-mcp`'s gate → the `data.json` check above (no report).
- DW-676: `classifyVitestReport` ignoring `skipped` → the real-path `integration-admin` case (it would exit 0); add a scratch live-capable test file → the coverage case.
- DW-666: re-add the directive → shared lint fails.
- Seed: add `src/ExecuteMCPv2/Setup.cls` to `seedDocuments` → the disjointness case.

**Lead checklist (AC 42.3.6; lead only, after the story commit is pushed to `epic42`):**
1. Wait for the story commit's run, and record its URL and per-job durations.
   - If it is red on an unlisted skip, a Linux-only failure or an oldest-image compile error, take the failed-smoke path: unexpected skips become seed fixes or reasoned `allowedSkips` entries, and the oldest leg follows decision 5.
   - Once it is green, rerun it once (`gh run rerun <id>`). A red rerun of the unchanged commit reopens DW-444.
2. Branch each mutation from the story commit as `ci-red-42-3-<slug>`, push them all together, and record each run's URL and the expected red:
   1. `selftest`: one `uses:` sha changed to its tag, the matrix `22.17.0`→`22.18.0`, and the `check-epics-sync` step deleted → `gates` red at the `@iris-mcp/all` test step; the log names the pins, matrix and step-equality cases.
   2. `lint`: the directive re-added at `governance.ts:935` → `gates` red at `pnpm lint`.
   3. `launcher`: `liveArming.ts` armed by a set `IRIS_HOST` → `gates` red at the launcher guard step.
   4. `skip`: `packages/iris-admin-mcp/src/__tests__/integration-setup.ts` forces `__IRIS_AVAILABLE__ = false` → `throwaway` red at `integration-admin` (vitest exited 0, and `ci-live-suite` lists the skips); `package` not run.
   5. `guard` (DW-672, DW-508): `packages/shared/src/bootstrap.ts` `probeCustomRest` reverted to `deployedVersion === BOOTSTRAP_VERSION ? current : stale` (42.2's mutation) → `throwaway` red at `bootstrap-guard` (the newer, foreign and DW-518 legs). `gates` is also red, which is expected.
   6. `roster` (DW-443): one assertion of `packages/iris-admin-mcp/src/__tests__/resource-listprivileges-live-gate.test.ts` broken → `throwaway` red at `prepublish-admin`; `package` shows `skipped`.
   7. `package`: the shebang mutation → only `package` is red, at the smoke step.
3. Delete every branch, locally (`git branch -D ci-red-42-3-<slug>`) and on origin (`git push origin --delete ci-red-42-3-<slug>`). Confirm with `git ls-remote --heads origin 'ci-red-42-3-*'`, which must print nothing.

**Shared surfaces:**
- `scripts/throwaway-iris.mjs` exports, CLI and `buildChildEnv` output (the `throwaway-iris.test.ts` and `story-42-2-qa-throwaway-wiring.test.ts` pins);
- the `live-gate-roster` and `live-arming-guard` scans (moved);
- the four `prepublish-gate.mjs` argv handling;
- the 7 `lint` scripts;
- `deployClasses`/`compileClasses` signatures (bootstrap tests);
- `openRawWire` (the golden capture and tests);
- `pnpmPack` (the 42.1 pack tests);
- `@iris-mcp/all` devDependencies and `pnpm-lock.yaml`;
- `.changeset/` (the guarded changeset readers, the 1.0.0 mechanism test);
- the `CHANGELOG.md` top section;
- the README Contributing section.

**Must stay unchanged:** the tool surface, `tools-list-snapshot.json`, the goldens, the governance baseline and `BOOTSTRAP_VERSION`.

**Standing criterion:** every test added or changed passes on a fresh environment, in either order. Each creates and removes its own temp directories and listeners.

**IRIS:** nothing writes to the shared instance. No `ExecuteMCPv2.Temp.*` fixture or OS `%UnitTest` class runs. The only IRIS contact is the read-only marker probe.

## Auto Run Result

Status: ready-for-dev
Blocking condition: none

Planned and halted after planning, as the invocation directed. Seven orchestrator decisions are recorded under Design Notes, and the plan follows each recommendation. Three spine amendment drafts (Rule 20) wait for the lead at the spec gate.
