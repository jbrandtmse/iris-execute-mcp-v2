---
title: 'Story 42.3: CI Workflow'
type: 'feature'
created: '2026-10-21'
status: 'done'
baseline_revision: 'eaa56ff97ce0d3dfd7fdaaa81c27e9d5bb8b4136'
baseline_commit: 'eaa56ff97ce0d3dfd7fdaaa81c27e9d5bb8b4136'
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
  - summary: >-
      A burst of pushes to `main` can still lose CI runs of the middle commits: with `cancel-in-progress: false`, GitHub cancels an earlier pending run of the same concurrency group when a newer run queues.
    evidence: |-
      Review 2026-10-21 (edge-case layer), confirmed against docs.github.com/en/actions/using-jobs/using-concurrency ("any existing pending job or workflow in the same concurrency group will be canceled"). The group is `ci-${{ github.ref }}`, so every push to main shares one group. The Design Notes spell this block (decision 62), so a fix is a spec amendment: `group: ci-${{ github.ref == 'refs/heads/main' && github.sha || github.ref }}` gives each main commit its own group, and the self-test mutation strings that name the old group line change with it. A tag push has its own group and its own run either way.
    location: >-
      .github/workflows/ci.yml concurrency block; Design Notes (decision 62)
    severity: low
  - summary: >-
      The oldest-image leg goes red again on 2026-11-13. `iris-community:2025.3`, the oldest tag that still starts, carries a Community license key that expires that day, and a Community image refuses to start once its key has expired. `2026.1` passes the bootstrap guard too, and its key expires on 2027-03-27.
    evidence: >-
      Rework iteration 1, 2026-10-22: through `throwaway-iris.mjs run --image <tag> -- <the bootstrap-guard gate>`, the keys of 2024.3, 2025.1 and 2025.2 had expired ("Community License expired", "Invalid Community Edition license"), and 2025.3 and 2026.1 passed all 9 legs. `$SYSTEM.License.KeyExpirationDate()` read in a throwaway of each: 2025.3 `2026-11-13`, 2026.1 `2027-03-27`. Manifest-list digests from `hub.docker.com/v2/repositories/intersystems/iris-community/tags`: 2025.3 `sha256:f456892d143d54a1cf3f202f04b672c7d594ec3cde5f47a69dbf5451329dc300`, 2026.1 `sha256:c57b65b2b454494091e7b3e49f6a53b3335f40adf475bcfcee0866083f35a7c2`.
    location: >-
      scripts/throwaway-iris.mjs OLDEST_IRIS_COMMUNITY_IMAGE; Story 42.9 (the tested floor); the release date of 1.0.0
    severity: medium
  - summary: >-
      The nine DocDB lifecycle tests of `data.integration.test.ts` never run in CI. They are allowlisted by name, because a fresh instance has neither an enabled `%Service_DocDB` nor a `Security.DocDBs` record for the test database, and the Epic 35 F5 gate of the all roster needs the service disabled. The data setup file's probe also still assumes a disabled service answers HTTP 403 (this pass reads the `#822` answer too). Three of the nine tests return early when the insert did not run.
    evidence: >-
      Rework iteration 1, 2026-10-22, on a throwaway `irishealth-community:2026.2`: `GET /api/docdb/v1/HSCUSTOM` answers HTTP 200 with `ERROR #822: Access Denied`; with the service enabled, `POST .../db/<name>` creates the database but every property, document and find route still answers #822 until `$$Create^%SYS.DOCDB(<name>, $namespace, .props)` registers a record; with both, the whole lifecycle passed, and `dropDatabase` removes the record again. A DocDB name with an underscore is refused ("it must be a valid Class Name").
    location: >-
      packages/iris-data-mcp/src/__tests__/data.integration.test.ts; scripts/lib/ci-checks.mjs DOCDB_SKIPS; packages/iris-mcp-all/src/__tests__/epic35-defect-gate.test.ts F5
    severity: low
  - summary: >-
      The resource and role list tests of `admin.integration.test.ts` assert nothing when the create did not succeed: their `expect(names).toContain(...)` sits inside `if (!result.isError && created.resource)`, and no test requires `created.resource` or `created.role` to be true. This is another occurrence of DW-684 (armed tests that return early and report passed).
    evidence: >-
      Rework review 2026-10-22 (verification-gap and intent layers): `created.resource` and `created.role` are never asserted anywhere in the file; a failed create leaves both list tests green without an assertion, and run alone (`-t "verifies resource in resource.list"`) they assert nothing. The guard pre-dates this pass. Requiring the create to succeed is a per-suite policy call, because a shared instance with a leftover resource would fail it.
    location: >-
      packages/iris-admin-mcp/src/__tests__/admin.integration.test.ts (the two list verification tests); DW-684
    severity: medium
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
- [x] [Lead, after implement] DW-681: given the admin integration suite armed against the throwaway, when its OAuth tests are collected, then their skip condition is evaluated at run time (after `beforeAll`), so they run when OAuth is available and skip with a reason otherwise. The two `ci-live-suite` allowlist entries for them are removed (or kept only for the genuinely unavailable case, with that reason). Pin it, and record its `mutation:` line.
- [x] [Lead, after implement] DW-682: given a burst of pushes to `main`, when a newer run queues, then no earlier `main` run is cancelled or superseded: `main` gets a per-sha concurrency group, and the workflow self-test pins it while keeping cancel-in-progress for other refs. Record its `mutation:` line.
- [x] [CI] gates (node 22.17.0) / test @iris-mcp/shared: `governance-baseline-check.test.ts` (3) and `governance-derivation-lockstep.test.ts` (1) fail because `scripts/gen-governance-baseline.mjs --check` imports `packages/shared/src/governance-baseline.ts` directly ("Unknown file extension .ts"); Node strips types by default only from 22.18, and the floor is 22.17.0 — https://github.com/jbrandtmse/iris-execute-mcp-v2/actions/runs/39730712530 — make every repo script that imports a `.ts` file work on the 22.17.0 floor (import the built `.js`, or run it with the flag the floor needs), and add a check that catches a `.ts` import from a script on the floor. -- Resolved: `--check` imports the built `packages/shared/dist/governance-baseline.js` (the only `.ts` import in the 49 scripts of `scripts/`, `packages/*/scripts/` and `extensions/*/scripts/`). The check is `scripts/lib/script-ts-import-scan.mjs` with `script-ts-imports.test.ts` (a literal specifier, or a path variable that reaches `import()` or `require()`), and the two shared tests run the generator with `--no-experimental-strip-types`, so they fail on every Node as the floor does. Run on a real Node 22.17.0 binary: the generator `--check`, the 7 root gate scripts, and the `shared`, `client-config`, `admin`, `data`, `dev`, `interop` and `ops` test suites and both `all` shards, all green.
- [x] [CI] gates (node 24.0.0) / test @iris-mcp/all: 22 tests of `story-41-5-qa-gen-skills-refusal.test.ts` (and its sibling `gen:skills and validate:prompts CLI, scratch copy`) fail with "Path is a directory" at `rmSync(dir, { force: true })` on a symlink to a directory (`:105`, `stubOps`) — Node 24.0.0's `rmSync` refuses a symlinked directory — same run — remove a symlink with `unlinkSync` (or `rmSync` only after `lstat` says it is not a link) everywhere the tests do this. -- Resolved: `removeLink` in `pack-fixture.ts` (an `lstat` check, then `unlinkSync`) replaces the 4 `rmSync(link, { force: true })` calls of `story-41-1-qa-fixture.ts`, `story-41-5-qa-gen-skills-refusal.test.ts` and `validate-prompts-pack-checks.test.ts` (the only non-recursive `rmSync` calls on a directory link in any test); `symlink-removal.test.ts` pins `removeLink` and fails on any test file that makes links and calls `rmSync` with `force` alone. Both `all` shards run green on a real Node 24.0.0 binary.
- [x] [CI] throwaway / suite bootstrap-guard-oldest: `intersystems/iris-community:2024.3` never starts: "Invalid Community Edition license, may have exceeded core limit" — same run — move `OLDEST_IRIS_COMMUNITY_IMAGE` forward to the oldest tag that starts and passes the bootstrap guard (candidates in order: 2025.1, 2025.2, 2025.3, 2026.1; manifest-list digests from Docker Hub), and record the reason (Community licenses expire, so the oldest testable tag moves forward over time) in the spec and the CHANGELOG for Story 42.9's tested floor. -- Resolved: `OLDEST_IRIS_COMMUNITY_IMAGE` is `intersystems/iris-community:2025.3@sha256:f456892d143d54a1cf3f202f04b672c7d594ec3cde5f47a69dbf5451329dc300` (manifest list: amd64 `3dfa0ee6…`, arm64 `afca69c6…`). Probed through `throwaway-iris.mjs run --image <tag> -- <the bootstrap-guard gate>` on 2026-10-22, in the order the item gave: 2025.1 and 2025.2 did not start ("Community License expired"; 2024.3 had not either), 2025.3 passed all 9 legs, and so did 2026.1. Community licenses expire, so the oldest testable tag moves forward over time; the 2025.3 key expires on **2026-11-13** (the 2026.1 key on 2027-03-27), so the lead moves the constant to 2026.1 (`sha256:c57b65b2…`) if 1.0.0 will be released after that date (deferred item 5). 2025.3 is the tested floor for Story 42.9 until then. The spine's Stack row "IRIS CI images" names `:2024.3` and is the lead's to edit (not edited here). The reason is in the CHANGELOG ("Fixed") and the harness constant's comment.
- [x] [CI] throwaway / suite integration-admin: `admin.integration.test.ts:341` (resource in `resource.list`) and `:379` (role in `role.list`) expect the created resource and role in the list and get `false`, on a fresh `irishealth-community:2026.2` seeded into `HSCUSTOM` — same run — find why on a fresh instance (list paging, a default filter, or the create landing elsewhere) and fix the test or the code, whichever is wrong. -- Resolved: the list tools return one page of 50 rows plus a `nextCursor` (documented in their input schema), and a fresh IRIS for Health holds more resources and roles than one page; the test looked at page 1 only and passed on a used instance only because the create had already failed there. The test is wrong, not the tool: `listAllNames` follows `nextCursor`. Reproduced on a throwaway (2 red), fixed (28 passed, 0 skipped).
- [x] [CI] throwaway / suite integration-data: all 6 `DocDB lifecycle integration` tests of `data.integration.test.ts` fail from `:107` (creating the test database returns `isError: true`) on the same fresh instance — same run — read the actual error, then fix the cause (a missing setup step, privilege or edition prerequisite on a fresh instance) or, if DocDB genuinely cannot run there, skip with a reason that `ci-live-suite`'s allowlist names. -- Resolved by skipping, with the evidence. The actual errors, in the order they appear on a throwaway `irishealth-community:2026.2`: (1) `%Service_DocDB` is disabled and the API answers `ERROR #822: Access Denied` with HTTP 200, which the setup file's probe (written for a 403) read as "available"; (2) with the service enabled, `MCPDataTest_DocDB` is refused ("it must be a valid Class Name"; the name is `MCPDataTestDocDB` now); (3) with both fixed, every property, document and find route still answers #822, because `CheckAccess^%SYS.DOCDB` needs a `Security.DocDBs` record that creating a database through the REST route does not make (`$$Create^%SYS.DOCDB` makes one, and then the whole lifecycle passes). The seed could do (1) and (3), but the Epic 35 F5 gate of the all roster (`prepublish-all`, which runs before `integration-data`) skips when the service is enabled, and the lifecycle would then run on a hand-built security record the tools cannot create. So the probe now reads #822 as "not available", the 9 lifecycle tests skip, and `DOCDB_SKIPS` in `scripts/lib/ci-checks.mjs` allowlists them by full name with the reason (deferred item 6).
- [x] [CI] throwaway / suite integration-dev: `tools.integration.test.ts:386` expects `SQLCODE: -30` but gets `SQLCODE: -1 ... IDENTIFIER expected, reserved word TABLE found` — the fixture's table name contains the reserved word `TABLE` — same run — use a non-reserved, non-existent table name so IRIS reports -30. -- Resolved: the query is `SELECT * FROM NoSuchSchema12345.NoSuchTable12345`. Reproduced on a throwaway (SQLCODE -1 with the old name), fixed (31 passed).

### Review Findings

Code review 2026-10-22 (four layers, all delivered: Blind Hunter, Edge Case Hunter, Verification Gap, Acceptance Auditor; review tier full-opus). 39 rows, grouped into 28 root-cause entries: 16 kept (high 0, medium 6, low 10) and 12 rejected (appendix below). Each kept entry lists severity, fix-risk and disposition (Rule 15).

- [x] [Review][Patch] DW-681: the two OAuth tests of `admin.integration.test.ts` used `it.skipIf(!oauthAvailable)`, which vitest decides when the file is collected, before `beforeAll` sets the flag. Each test now calls `testContext.skip()` at run time, and the two allowlist entries are gone. A read-only `iris_oauth_list` on the shared IRIS for Health 2026.2 answers without error, so the OAuth tests should run in the throwaway. Pinned by a scan that no armed file's `skipIf`/`runIf` reads a `let`, by a case showing the scan finds that pattern, and by a real vitest report in which a flag set in `beforeAll` is unset for `skipIf` and set for `ctx.skip()`. [packages/iris-admin-mcp/src/__tests__/admin.integration.test.ts:630; scripts/lib/ci-checks.mjs] — med, fix-risk low, in-story; DW-681 resolved
- [x] [Review][Patch] DW-682: every push to `main` shared one concurrency group, so GitHub could cancel a pending run on `main`. The group is now `ci-${{ github.ref == 'refs/heads/main' && github.sha || github.ref }}`, with cancel-in-progress kept for every other ref. The self-test pins the exact group (`CONCURRENCY_GROUP`), with a case for a shared group and one for a per-commit group. [.github/workflows/ci.yml:35; packages/iris-mcp-all/src/__tests__/ci-workflow-check.ts] — low, fix-risk low, in-story; DW-682 resolved
- [x] [Review][Patch] `lockfileProblems` checked `resolved` only on the top-level `@iris-mcp/*` entries, so a nested copy fetched from the registry passed AC 42.3.3's "no `@iris-mcp/*` registry fetch". It now checks every nested key, with a new case. [scripts/ci-package-smoke.mjs:102] — med, fix-risk low, in-story
- [x] [Review][Patch] The self-test never compared some keys that change what runs: a matrix `exclude` or `include` (a leg dropped while `matrix.node` stays equal), a workflow or job `env`/`defaults`, a step `shell`, or an action input such as `with: ref: main`. A new KEYS check allows only the keys the registry's workflow uses, at every level, with six cases plus one for a strategy on another job. [packages/iris-mcp-all/src/__tests__/ci-workflow-check.ts] — med, fix-risk low, in-story
- [x] [Review][Patch] `stripComments` cuts each line at its first whitespace-`#`, which also hides a token inside a YAML-quoted value or a block scalar. The hygiene patterns now read the comment-free text plus the parsed values, with a case for a quoted `#${{ secrets.TOKEN }}`. [packages/iris-mcp-all/src/__tests__/ci-workflow-check.ts] — low, fix-risk low, in-story
- [x] [Review][Defer] An armed suite can go green on tests that return early. vitest reports an early `return` as passed, and the interop and admin integration suites guard with `if (!created.x) return;` after a create test that tolerates `isError`. The README and CHANGELOG claim "cannot go green by skipping a leg"; that is narrowed here to what the wrapper can see. Changing the guards is a per-suite policy call, so the root cause is DW-684. [README.md:1077; packages/iris-interop-mcp/src/__tests__/interop.integration.test.ts:204] — med, fix-risk med, out-of-footprint; escalated (DW-684, owner burndown)
- [x] [Review][Patch] Rule 2 / DW-680 `reopen_if`: three more copies of the preload child runner and its environment scrub had appeared (`ci-live-suite.test.ts` `runScript` and `runGate`, `throwaway-iris.test.ts` `verify-iris-reachable` run, and the `ci-seed-throwaway.test.ts` process run), and the scrub lists already differed. They now use `live-gate-child-run.ts`, which gains `runScriptUnderPreload` and `scrubbedEnv` on the same core as `runVitestUnderPreload`; that function's result also gains `stdout` and `stderr`. [packages/iris-mcp-all/src/__tests__/live-gate-child-run.ts] — low, fix-risk med, in-story; DW-680 occurrence, launcher copy re-accepted
- [x] [Review][Patch] Rule 2: `isEntryPoint()` was copied into three new scripts, and `ci-live-suite`'s `spawnInherited` repeated the harness's `runCommand`. Both now live in the new `scripts/lib/script-process.mjs` (`isEntryPoint(moduleUrl)`, `spawnInherited(argv, {label, env, cwd, onChild})`), used by all four scripts. Signal forwarding stays with each caller. [scripts/lib/script-process.mjs] — med, fix-risk low, in-story
- [x] [Review][Patch] The `ci-checks.mjs` header said a new package changes the registry without anyone editing it, while `PACKAGE_DIRS` says a new package must be added there. The header now describes what is hand-listed and what is read from disk. [scripts/lib/ci-checks.mjs:17] — low, fix-risk low, in-story
- [x] [Review][Patch] The seed header said `assertThrowawayEnv` guarantees "a throwaway container this harness started", but the check reads only the environment's shape, as the spec defines ("harness-shaped"). The seed header and `throwawayEnvProblems` now say so and name `exec`'s inspect as the step that binds the name to a container. The behaviour is by design. [scripts/ci-seed-throwaway.mjs:9; scripts/throwaway-iris.mjs:345] — low, fix-risk low, in-story
- [x] [Review][Defer] `bootstrap()` sets `compiled` true whatever the compile console says. `General.Compile` answers HTTP 200 when only some classes failed, so in CI a broken bootstrapped class surfaces later as 404 or 500 from the suites. A console check in `bootstrap` must hold for localized success and error lines across the 2023.1+ range (Rule #13), so the fix-risk is high. [packages/shared/src/bootstrap.ts:746,788] — med, fix-risk high, out-of-footprint (the behaviour predates 42.3); escalated (DW-685, owner burndown)
- [x] [Review][Patch] `seedDocuments` walked with suffix `''`, so a Finder `.DS_Store` under `Tests/` threw "deploys classes only" on macOS. Dotfiles are now left out, in the script and in the test's own disk listing. [scripts/ci-seed-throwaway.mjs:69] — low, fix-risk low, in-story
- [x] [Review][Patch] No test showed that `exec` forwards a signal to its command; the only signal test covered `run`. A new real-process case sends SIGTERM to `exec` and checks that the command ends, the harness exits 143 and the container is kept for `down`. It also guards this pass's move of `runCommand` onto `spawnInherited`. [packages/iris-mcp-all/src/__tests__/story-42-3-qa-harness-lifecycle.test.ts] — low, fix-risk low, in-story
- [x] [Review][Patch] The `/matrix|needs/` filter of the "package job after the other two" case could never select "does not need …", so the case could not fail on its own title. The filter is now `/matrix|does not need/`, with a mutated `needs` checked through it. [packages/iris-mcp-all/src/__tests__/ci-workflow.test.ts:107] — low, fix-risk low, in-story
- [x] [Review][Patch] The scratch live-capable case filtered a made-up path and never ran the scan's pattern, so it was red only when the case before it was. It now classifies a synthetic `liveGateTarget(` source with `LIVE_CAPABLE` before the coverage filter. [packages/iris-mcp-all/src/__tests__/ci-workflow.test.ts] — low, fix-risk low, in-story
- [x] [Review][Defer] The spine has two "IRIS CI images" Stack rows that disagree: `:744` names `:2024.3`, and a stale row at `:759` does not. This is outside the diff, and the spine is the lead's to edit (Rule 20). Lead action: delete the row at `:759` in the bookkeeping commit. — low, fix-risk low, out-of-footprint; lead action, no ledger entry

**Explicit checks the lead asked for:**
- **The seed's success-line requirement.** The `Compilation finished successfully` line is the one `packages/iris-dev-mcp/src/__tests__/live-doc-helpers.ts:120` already requires from the dev live gates on this same edition (IRIS for Health 2026.2, English locale). The first CI run is the remaining proof.
- **The log tail.** `run` prints it when its command fails and when the container is not ready. `up` prints it when the container is not ready. A failure before readiness (`docker run` or `docker port`) prints none, because there is either no container or no readiness log.
- **The self-test guards.** The job-level `if`, action-step `if` and `gates` matrix `node-version` guards each have a case. This pass added the KEYS and parsed-values guards above.
- **Action pins.** Verified read-only with `git ls-remote`: `actions/checkout` v5.1.0 → `fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09`; `actions/setup-node` v5.0.0 → `a0853c24544627f65ddf259abe73b1d18a591444`; `pnpm/action-setup` v4.4.0 (an annotated tag `a15d269c…`) → commit `fc06bc1257f339d1d5d8b3a19a8cae5388b55320`. All three match `PINNED_ACTIONS`.

**Rejected:**
- `[low]` Two exports are both called `publishablePackages`. They have different contracts: a disk scan with a `repoRoot` parameter, which the synthetic-repository smoke test needs, and the registry in CI order. The import path tells them apart.
- `[false]` The README says the package job pins "every tool by an exact version". That sentence is about the workflow's tools (actions, Node legs, pnpm). The smoke deliberately resolves third-party ranges as a user's `npx` does.
- `[low]` `down` on a container that no longer exists exits 2. The harness never uses `--rm`, and nothing in the job removes the container, so the case cannot arise in CI; a fix adds a branch for a state nobody has shown. reopen_if: a `down` step fails on "No such object".
- `[false]` A signal between `writeState` and `disarm` in `up` cannot happen: they are two synchronous statements, and no handler can run between them.
- `[false]` A signal during `exec`'s `loadThrowaway` does not let the suite run on. The handler runs only after the synchronous spawn, so it kills the child. The new `exec` SIGTERM case exercises this path.
- `[low]` `openRawWire` spawns `npx` without a shell on Windows. No CI job or AC runs the smoke on Windows, and `shell: true` would make `wire.close()` kill `cmd.exe` and orphan the server. reopen_if: a Windows run of `node scripts/ci-package-smoke.mjs`.
- `[low]` The `tools/list` cursor loop has no bound. The servers send no `nextCursor`, and the 30-minute job timeout bounds the loop.
- `[low]` One allowlist entry can absorb several skipped tests with the same full name. No two tests of an armed file share a full name, and the fix adds a guard.
- `[false]` The build commit says "no bootstrap change". It means the bootstrapped classes and `BOOTSTRAP_VERSION`, which are unchanged; `deployClasses`/`compileClasses` are named in the CHANGELOG and the changeset.
- `[low]` Some tests need a built dist (hermeticity). This was already triaged at the implement review: `turbo test` depends on `build`, and the CI job builds first.
- `[low]` `parseCli(["run", …])` now refuses a repeated flag. This was already adjudicated at the implement review with a reopen_if, and every valid call is pinned byte-identical.
- `[false]` The em-dashes in `prepublish-gate.mjs` are in comments carried over from existing text. Rule 14 exempts prose comments.

### Review Findings (rework re-review, iteration 1 of 3)

Code review 2026-10-22, on the rework diff `eaa56ff..HEAD`. Four layers ran and all delivered (Blind Hunter, Edge Case Hunter, Verification Gap, Acceptance Auditor); review tier full-opus; none of them edited or committed anything. 36 rows: 14 rejected (appendix below), and 22 kept in 13 root-cause entries (high 0, medium 4, low 9). Each entry lists severity, fix-risk and disposition (Rule 15).

**The six `[CI]` items:**
- Items 1, 2, 3, 4 and 6 are confirmed fixed. After this pass's patches, the floor checks ran on the real Node 24.0.0 and 22.17.0 binaries (Verification below).
- Item 5 is resolved as the item allowed: a skip with an allowlisted reason. The defect it uncovered in the product is ledgered as DW-688.
- The amd64 run of 2025.3 is still proven only by the lead's next CI run.

**Patches (all applied):**
- [x] [Review][Patch] **Windows symlink guard.** The case "a link to a file and a dangling link go too" makes file and dangling symlinks with no Windows guard. Without the symlink privilege, Windows answers EPERM; the sibling tests skip there. The case now runs under `it.skipIf(process.platform === "win32")`. [packages/iris-mcp-all/src/__tests__/symlink-removal.test.ts:47]
  - low; fix-risk low; in-story
- [x] [Review][Patch] **The symlink-removal header named the wrong failing call.** It said the call that fails is `rmSync` with `force` and no `recursive`.
  - The probe on real binaries: Node 24.0.0 throws `ERR_FS_EISDIR` on every non-recursive `rmSync` of a directory link (no options, `force`, `maxRetries`, `recursive: false`), and 22.17.0 removes the link in all four forms.
  - The header now states that condition, and says why the scan matches only the force-only form: the same files remove regular files non-recursively, and the 24.0.0 leg catches any other form.
  - [packages/iris-mcp-all/src/__tests__/symlink-removal.test.ts:1-12]
  - low; fix-risk low; in-story
- [x] [Review][Patch] **The scan header left out four forms the scan misses.** They are an initializer continued after a trailing operator, a second declarator in one statement, a `createRequire` require, and an import after a regular expression placed right after `)`. A probe of each returns `[]`. No script uses any of them: every `.ts` literal in the script directories is a comment or a vitest file argument. The header now lists them. [scripts/lib/script-ts-import-scan.mjs:15-20]
  - low; fix-risk low; in-story
- [x] [Review][Patch] **Rule 14: a test title narrated history.** It read "the generator as it stood in the first CI run is found". It is now titled by what it checks. The fixture constant keeps its provenance comment (Rule #36). [packages/iris-mcp-all/src/__tests__/script-ts-imports.test.ts:59]
  - low; fix-risk low; in-story
- [x] [Review][Patch] **The floor-leg checks were not pinned into the default suite.** Unlike the 42.1 checks, `script-ts-imports` and `symlink-removal` had no pin keeping them in the default suite of `@iris-mcp/all`. A later exclude could drop the only checks for items 1 and 2 with nothing red (Rule #59). A new `it.each` case pins both (mutation recorded). [packages/iris-mcp-all/src/__tests__/ci-workflow.test.ts:429]
  - low; fix-risk low; in-story
- [x] [Review][Patch] **The README did not say the DocDB lifecycle never runs in CI.** Its CI section said every integration suite runs, but not that the 9 DocDB lifecycle tests are allowlisted skips. The allowedSkips paragraph now names the allowlist's content and the reason. [README.md:1077]
  - low; fix-risk low; in-story
- [x] [Review][Patch] **The generator's text did not say what `--check` reads.** Its header and inline comment did not say that `--check` reads the built shared dist, or that a direct `node` run reads whatever dist was built last. Both now say so.
  - The stdout label `(committed)` stays: a test pins it, and it names where the frozen set comes from.
  - [scripts/gen-governance-baseline.mjs:19-22,175-177]
  - low; fix-risk low; in-story
- [x] [Review][Patch] **The final tree had not run on the floor binaries.** After the rework's own review patches, its floor checks had run only on the host Node.
  - Now run on real Node 24.0.0: 4 files, 135 passed.
  - And on 22.17.0: 3 files, 118 passed; the shared generator tests, 5 passed; `pnpm gen:governance-baseline:check`, OK at 141.
  - low; fix-risk low; in-story

**Deferred (each ledgered or handed to the lead):**
- [x] [Review][Defer] **A DocDB database created through `iris_docdb_manage create` is unusable on IRIS 2026.2.**
  - The REST create (`httpPostDatabase`, `irislib/%Api/DocDB/v1.cls:299-313`) registers no `Security.DocDBs` record. Every other route runs `CheckAccess^%SYS.DOCDB`, which refuses a database without one (`irislib/%SYS/DOCDB.int:15`). So every property, document, find and drop call answers a raw `#822`, even with `%Service_DocDB` enabled.
  - InterSystems' own `Ens.Setting.Report.base:629` calls `$$Create^%SYS.DOCDB` itself. The data README names only the service as the prerequisite.
  - This is a product defect that predates 42.3. This story's Never list forbids touching the tool surface and the bootstrapped classes.
  - med; fix-risk high (a real fix is a `%SYS` write on create); out-of-footprint; escalated (DW-688, owner burndown; decide before the 1.0.0 publish)
- [x] [Review][Defer] **The DocDB lifecycle now runs nowhere.** CI allowlists it, and the shared IRIS skips it too, because the service is disabled there (read-only `iris_docdb_manage list`). So the `TEST_DB` rename and the probe's "unavailable" side cannot be shown red, and the first clause of DW-687's `reopen_if` cannot fire.
  - med; fix-risk med; in-epic; DW-687 occurrence (fixing DW-688 makes the lifecycle runnable in CI)
- [x] [Review][Defer] **Community license expiry is handled as a one-time step for one image.**
  - From 2026-11-13, `bootstrap-guard-oldest` turns `throwaway` red and skips `package` on every CI run on every ref, not only at the `v1.0.0` tag. Under decision #63, that red would land on an unrelated story's commit.
  - The 2026.2 pins' keys expire too: the shared IRIS for Health 2026.2 Community key runs to 2027-06-26 (read-only `iris_license_info`).
  - Story 42.9 must state the tested floor as a dated value.
  - med; fix-risk low; in-epic; DW-686 occurrence (owner 42-6). Lead attention: decision #65 is the lead's.
- [x] [Review][Defer] **The resource and role list tests assert nothing when the create did not succeed.** Already ledgered as a DW-684 occurrence at 08:17:18Z, so no new line was added.
  - med; fix-risk med; out-of-footprint; escalated (DW-684, owner burndown)
- [x] [Review][Defer] **A spine convention is stale.** "Live testing on a shared instance" still says only the lead starts a throwaway, while decision #64 let the rework stage start them.
  - low; out-of-footprint; lead action under Rule 20, no ledger entry

**Rejected:**
- `[low]` **Three other page-1 list checks** in `admin.integration.test.ts` (database, namespace, web app): outside the rework range and not HIGH. A missed row there is a false red, never a false green, and the fresh-instance run passed all three (28/0). reopen_if: an armed `integration-admin` run fails one of them on an instance with more than 50 rows.
- `[low]` **`probeDocDb` matches the `#822` text instead of `errors[].code`:**
  - the `#n` token is the part of the message that is stable across locales;
  - the text match was proven on a throwaway;
  - a code check cannot be verified live in this review.
  - reopen_if: the probe misreads an `#822` answer.
- `[low]` **The prefix-free `#822` match is unpinned.** Pinning it means extracting the probe from a setup file that probes on import, and the match handles a localized prefix by construction.
- `[low]` **The symlink scan misses forms without `force`.** This is real (probed), but in the link-making test files every non-recursive `rm` removes a regular file, so widening the scan would flag them. The 24.0.0 leg catches such a call; the header is corrected (above).
- `[low]` **`MAKES_LINKS` does not list `installDeclaredDependencies`.** Its two users remove only recursively.
- `[low]` ×4 **The scan's blind spots** (trailing operator, second declarator, `createRequire`, regex after `)`): no script uses any of them, a fix adds lexer branches, and the 22.17.0 leg is the real gate. The header now lists them.
- `[low]` **`listAllNames` follows a positional cursor.** The CI throwaway has no concurrent writer, and a fix adds a retry. reopen_if: a resource or role list verification flakes on an armed run.
- `[low]` **`removeScratchRepo` lost its try/catch.** Already adjudicated at the rework's own review, with a `reopen_if`.
- `[false]` **The governance tests need the built shared dist.** The generator already needed the five server dists, and CI builds first.
- `[low]` **The Verification loops do not list the new files.** The fix edits the spec's command list. Both files run in the default `@iris-mcp/all` suite, and this pass's runs are recorded under Verification.
- `[false]` **Rule #55 was breached.** The heredoc-written file is intact (ASCII, no NUL bytes, `node --check` passes, 26 tests green). The deviation is already in the cycle log for the retro.

**Not a finding:**
- Rule 3: this is a build-pipeline story, so it is exempt.
- Rule 6: AD-29 holds. The new allowlist entries carry a reason, and the 2025.3 pin is a manifest-list digest that the Stack row names.
- Rule 2: there is no shared pagination helper or JS lexer to extend.

## Spec Change Log

- 2026-10-22, lead, at the smoke: the first CI run (https://github.com/jbrandtmse/iris-execute-mcp-v2/actions/runs/39730712530, sha 221181a) was red; six [CI] items added for rework iteration 1 (wave-8 decisions #63 and #64).
- 2026-10-22, implement stage, rework iteration 1: scope is the six unchecked `[CI]` items only. The failed-job logs are at `/private/tmp/claude-501/-Users-jbrandt-git-iris-execute-mcp-v2/03eb9a39-2d9e-4087-85ac-363a9bb86d2a/scratchpad/ci-42-3-run1-failed.log` (grep it by job and step; never read it whole). Lead authorization (decisions #55 and #64) overrides the "no docker" lines of this spec for this pass only: reproduce the fresh-instance failures (admin list checks, DocDB, the SQL fixture) and find the oldest Community tag that starts and passes the bootstrap guard, using ONLY `node scripts/throwaway-iris.mjs run|up|exec|logs|down` (e.g. `up --image intersystems/irishealth-community:2026.2@sha256:462de1fb3597272fde0e03afad006af1b18b59c90f1c1fb5566c79b027a7af0a ...`, then `exec ... -- <cmd>`, then `down`; for the oldest-tag probe, `run --image intersystems/iris-community:<tag>@sha256:<manifest-list digest from Docker Hub> -- <cmd>`). Never a raw `docker` command and never another container (this host also runs containers of other projects). Every container the pass starts is taken down before it returns. Armed live runs happen only against a throwaway (`IRIS_THROWAWAY` set by the harness), never against localhost:52773. Every other suite runs `UNARMED`. Each pinning test touched gets its `mutation:` line in `## Verification`. The spine is not edited: its Stack row "IRIS CI images" names `:2024.3`, and the lead updates it when the oldest tag moves (report the new tag and digest).
- 2026-10-22, lead, after the implement stage: added the DW-681 and DW-682 acceptance items (deferred findings that are in-story and small). Code review patches them, or they take the story's one rework iteration.
- 2026-10-22, implement stage, rework iteration 1 (result): the six `[CI]` items are resolved (see their lines). Two spec statements changed by what the probes showed. (a) The oldest image is `iris-community:2025.3`, not `2024.3` (decision #64): Community images carry a license key that expires, and the keys of 2024.3, 2025.1 and 2025.2 had expired on 2026-10-22, so the oldest testable tag moves forward over time. The 2025.3 key expires on 2026-11-13 and the 2026.1 key on 2027-03-27; the Design Notes, the I/O matrix row "Bootstrap guard (DW-672)" and the Code Map line that name 2024.3 describe the plan, and `OLDEST_IRIS_COMMUNITY_IMAGE` is the source of truth. The 2025.3 manifest list is `sha256:f456892d…` (amd64 `3dfa0ee6…`, arm64 `afca69c6…`). (b) The allowlist holds 13 entries, not 4: the 4 capture legs and the 9 DocDB lifecycle tests of `integration-data`, which skip on a fresh instance (deferred item 6). No acceptance criterion changed. The lead authorization (decisions #55 and #64) was used for docker through `scripts/throwaway-iris.mjs` only; every container this pass started was removed (see `## Auto Run Result`).

## Review Triage Log

### 2026-10-21 — Review pass
- verdicts: 31 findings — high 0, medium 11, low 12, false 8, maybe-false 0
- findings:
  - `[medium]` `[patch]` Blind: the seed's compile-failure test passes through the HTTP client's throw, so the `compileProblems(compiled)` consumer could be deleted with every test green — `General.Compile` replaces the compile status with the status of the documents it updated (`irislib/%Atelier/v1/Utils/General.cls`), so a partly failing compile answers HTTP 200 with the failure only in the console; patched: the fake gained `compileConsole`, and a seed case drives that answer (mutation recorded)
  - `[medium]` `[patch]` Blind: `compileProblems` treats a response with no recognizable error as success, and its console regex is anchored while `bootstrap-guard-legs.ts` is not — patched: it now requires the `Compilation finished successfully` line `compileDocs` requires, scans unanchored for `ERROR #n`, and fails a missing response
  - `[medium]` `[patch]` Blind: a container that fails to start loses its log, because `runHarness` learns the id only after `startContainer` returns and `upHarness` prints nothing — patched: the readiness part of `startContainer` prints `docker logs --tail 200` before the container is removed (`run` and `up`); the old 40-line print is gone
  - `[low]` `[patch]` Blind: tests hard-code counts of artifacts they do not own — `Tests 28 skipped` and `26 problem(s)` depend on the admin integration file; patched to assert problems equal skipped minus the allowlisted. The 62-file and 97-PUT counts are the spec's contract, and the `6`/`8`/`6` pins are the deliberate reminder for a new package, so they stay
  - `[medium]` `[patch]` Blind: the self-test leaves job-level and action-step properties unguarded — patched: a job-level `if` and an `if` on an action step are findings, with cases. `persist-credentials` and `fail-fast` are hygiene beyond the acceptance criteria and have no named harm, so they stay unpinned
  - `[low]` `[reject]` Blind: no per-step timeout, so one hung suite uses the whole 150-minute budget — the spec fixes the job timeouts and the `{run, workingDirectory?, if?, id?}` step shape; a hang costs CI minutes in a run the Lead reads step by step, and the fix adds a registry field and a test (reopen_if: a first CI run hangs a suite)
  - `[low]` `[patch]` Blind: the `ci.yml` header says `gates` runs "every check the repository has" — reworded to name the exclusions (the launcher's full suite, DW-532; `format:check`, which exits 2 on the tree today, run 2026-10-21)
  - `[medium]` `[patch]` Edge: readiness failure after `docker run` loses the log in `up` and `run` — same root cause as the Blind finding above, same patch
  - `[medium]` `[patch]` Edge: the `gates` job's setup-node `node-version` is not checked against `matrix.node`, so three legs could run one Node while the self-test stays green — patched with a check and a case
  - `[medium]` `[patch]` Edge: a job-level `if` on `package` (for instance `always()`) runs it after a red job and the self-test does not notice — patched with a check and cases
  - `[false]` `[reject]` Edge: `bootstrapRoster` matches nothing if `gen-bootstrap.mjs` changes format, so the disjointness guard passes vacuously — `ci-seed-throwaway.test.ts` pins `roster.names.length` to 35 and to the embed's keys, so a format drift is red in the `gates` job before the seed runs
  - `[low]` `[defer]` Edge claim: runs on `main` are never cancelled — GitHub cancels an earlier pending run of the same group even with `cancel-in-progress: false` (docs.github.com, using-concurrency, fetched 2026-10-21), so a burst of pushes to `main` can lose the middle commits' runs. Spec-bound: the Design Notes spell the block, and a loopback would re-derive the whole story for a one-line, rarely reached change. Recorded in `deferred:` for the Lead, with the one-line fix
  - `[low]` `[reject]` Edge claim: `parseCli(["run", ...])` now refuses a repeated flag where the old code took the last — no caller repeats a flag (the root script, the tests and the workflow do not), the result for every valid call is byte-identical (pinned), and the refusal is the same code that rejects a repeated `up` option on purpose; restoring last-wins for `run` alone needs a branch (reopen_if: a script passes `--image` twice)
  - `[low]` `[patch]` Edge claim: the "0 unlisted skips" line is logged only when a JSON report exists, so the four plain `prepublish-*` suites log nothing of the kind — patched: a plain suite logs that no test of it can skip, with a case
  - `[medium]` `[patch]` Edge claim: the `status.errors` and per-document `errors` branches of `compileProblems` are unreachable (the client throws first; real documents carry no `errors`) — patched with the first Blind finding: those branches are removed (Rule #54), the console path is the one kept and tested at the seed level
  - `[medium]` `[patch]` Verification gap: a job-level `if` on `package` passes the self-test — same root cause as the Edge finding above, same patch and cases
  - `[medium]` `[patch]` Verification gap: the throwaway and package Node checks, the `run-name` check, the job-set check and the `uses:` count check have no case that goes red, so each could be deleted with every test green — patched with one case per check; each check was disabled in turn and the named case went red (recorded)
  - `[low]` `[reject]` Verification gap: the smoke script's CLI, tool-count and lockfile checks were never shown red, only the server-bin leg — AC 42.3.3 names one mutation (the shebang), which is recorded, and Rule 19 asks one demonstrated mutation per acceptance criterion, not per assertion
  - `[low]` `[reject]` Verification gap: several pinning tests have no `mutation:` line — every acceptance criterion has its recorded mutation (the Verification list the spec set), Rule 19 is per criterion, and each test this pass added or changed got its line
  - `[low]` `[patch]` Verification gap: the `0600` mode and `wx` flag of the state file are not pinned (the layer proposed `defer`) — patched: a test runs the real writer in a temp directory, with both mutations recorded
  - `[medium]` `[patch]` Verification gap, other: the seed-level compile-failure test passes via the client's exception — same root cause as the first Blind finding, same patch
  - `[low]` `[reject]` Verification gap, other: the gate-forwarding cases need a fresh build — `turbo test` depends on `build`, the CI job builds first, and the sibling dist-reading tests have the same precondition
  - `[low]` `[patch]` Verification gap, other: no test enumerates the root check scripts, and the header overclaims (Rule #56) — patched: a test lists the root `check`/`validate` scripts and requires each to be a `gates` step or a reasoned exemption (`format:check`), with a case that a new script is found
  - `[false]` `[reject]` Intent: the tests are hermetic, and the runtime outcomes (Actions scheduling, docker, real IRIS, a real install) are checked by no committed test — the spec forbids docker and CI in this stage and assigns those outcomes to the Lead's checklist
  - `[false]` `[reject]` Intent: the 4 capture-leg allowlist entries are checked only against string literals — checked against a real report: the four Story 39.x gate files run unarmed under the preload with the JSON reporter give `skipped` tests whose `fullName` equals each entry (no connect was logged)
  - `[false]` `[reject]` Intent: the bootstrap-guard suites are wired but no committed oracle shows the 9 legs green or red — the spec assigns that to the Lead's first run and lead branch 5
  - `[false]` `[reject]` Intent: the body of the package smoke is in no default-suite test — it needs the registry, so the spec makes it a once-by-hand Verification command and the `package` job, with the shebang mutation recorded
  - `[false]` `[reject]` Intent: DW-443 rests on CI being the gate while `prepublishOnly` is unchanged — decision 57 and the Never list keep every `prepublishOnly` byte-identical
  - `[false]` `[reject]` Intent: real-hook forwarding was verified once, on `data` — the spec asks for that once-command, and the four gates' forwarding is also pinned by `ci-live-suite.test.ts`
  - `[low]` `[patch]` Intent: "every check" is narrower than its wording and `ROOT_GATE_SCRIPTS` is hand-listed — same root cause as the header and enumeration findings above, same patches
  - `[false]` `[reject]` Intent: the diff touches `deployClasses`/`compileClasses`, lint scripts, `NO_COLOR` and other things the intent text does not name — each is a Tasks line of the spec, and `NO_COLOR` is the recorded fix for the `CI=true` stand-in

### 2026-10-22 — Review pass (rework iteration 1; follow-up pass)
- verdicts: 34 findings — high 0, medium 3, low 30, false 1, maybe-false 0
- routes: patch 19 rows (9 root causes, all low), defer 3 rows (2 entries), reject 12 rows
- findings:
  - `[low]` `[patch]` Blind: comments narrate the rework and the first CI run (`script-ts-imports.test.ts`, `symlink-removal.test.ts`, `ci-checks.mjs`) — patched: the narration is gone and the contract stays; the dated key-expiry note in `throwaway-iris.mjs` and its test stays, as the pin's provenance (Rule #36)
  - `[low]` `[patch]` Blind: the scan reads a `/` after `return`, `typeof`, `case` and the like as division, so a quote in a later regular expression opens a string that hides a real import — reproduced (`return /['"]/.test(s);` then `import('./x.ts')` gave `[]`); patched with a keyword rule in the lexer and two cases
  - `[low]` `[patch]` Blind: `--check` trusts the built dist with no freshness check, and its messages call the dist "committed" — the staleness half is false (`deriveLiveKeys` already reads the built dists, `pregen:governance-baseline:check` builds shared first, the frozen set cannot change without the forbidden regeneration, and CI builds before it tests); the wording half is patched ("built baseline")
  - `[low]` `[patch]` Blind: the DocDB probe matches the English `ERROR #822` and covers only the disabled-service state — locale half patched (`#822`, Rule #13); the other half (a service enabled with no `Security.DocDBs` record) is not reachable by the harness, which leaves the service disabled, so no action
  - `[low]` `[patch]` Blind: `listAllNames` ends the loop silently when a later page is an error, so the test fails as "row missing" — patched: it throws with that page's text
  - `[low]` `[reject]` Blind: the CHANGELOG records the six fixes under "Fixed" in an unreleased section, in two places — item 3 asks for the oldest-image reason in the CHANGELOG, Story 42.9 reads it there, and the harm is stylistic (reopen_if: a release-notes generator reads that section)
  - `[low]` `[patch]` Edge: regular expression after a keyword — same root cause and patch as the second row
  - `[low]` `[reject]` Edge: a path assigned after its declaration (`let p; p = './x.ts'; import(p)`) is not traced — no script does this and the fix adds a branch; now stated in the scan's header (reopen_if: a script assigns a `.ts` path after declaring it)
  - `[low]` `[reject]` Edge: a literal that spans lines (a multi-line template) is not found — no script has one; stated in the header
  - `[low]` `[reject]` Edge: a static import that shares its line with another statement is not found — a top-level import has its own line; stated in the header
  - `[low]` `[reject]` Edge: `import()` inside a template's `${...}` is masked — no script has one; stated in the header
  - `[low]` `[reject]` Edge: a bare specifier whose package `exports` target is a `.ts` file passes the scan — the only such targets are the `@iris-mcp/shared` test helpers, and no script imports them (grep of `scripts/` and `packages/*/scripts/`); stated in the header (reopen_if: a script imports such a specifier)
  - `[low]` `[patch]` Edge: the words of an import's string argument are read as variable names (`import('./lib/outPath.js')` reported through `outPath`) — reproduced; patched: quoted strings are blanked before identifiers are read, with a case. The same name declared in another scope is still matched, as the header now says
  - `[low]` `[patch]` Edge: the symlink scan misses wrapped, extra-option and async forms — same root cause and patch as the Verification-gap finding on the same scan
  - `[low]` `[patch]` Edge: `listAllNames` hides a later-page error — same root cause and patch as the fifth row
  - `[low]` `[patch]` Edge: the DocDB probe is locale-fragile — same root cause and patch as the fourth row
  - `[medium]` `[defer]` Edge: the oldest-image leg goes red on 2026-11-13 when the 2025.3 key expires — real, and already recorded as `deferred:` item 5 with the digest of 2026.1 to move to; a default-suite date check would turn unrelated commits red, so there is no code check
  - `[low]` `[reject]` Edge: `removeLink` replaced a try/catch that swallowed unlink errors, so an unlink that fails would skip `removeTempRoot` — no failing unlink of a link the test just made was shown, and `unlinkSync` removes a link or junction on Windows too (reopen_if: a scratch-copy test leaks a temp root after an unlink error)
  - `[low]` `[patch]` Edge: `--check` verifies the dist rather than the frozen source — same root cause as the third row (the wording patch)
  - `[low]` `[patch]` Edge: the symlink-removal header claims more than its pattern matched — same patch as the symlink scan; the header now states the pattern
  - `[low]` `[patch]` Edge: the scan's contract covers more than it finds — patched: the header lists what it does not find (the rejected rows above)
  - `[low]` `[patch]` Verification gap: the symlink scan matched one literal shape (a trailing comma, an extra option, `rm`, a prettier-wrapped call all passed it) — patched: `rm` and `rmSync`, any options object with `force: true` and no `recursive`, an optional trailing comma, and cases for each; the scan finds nothing in the real sources
  - `[medium]` `[defer]` Verification gap: the resource and role list tests assert nothing when the create did not succeed (`created.*` is never required) — the guard `if (!result.isError && created.resource)` pre-dates this pass and is the class DW-684 owns (tests that return early); a strict assertion is a per-suite policy call that would fail on a shared instance with a leftover. Recorded in `deferred:` as an occurrence of DW-684
  - `[low]` `[patch]` Verification gap: item 3 (the oldest image) had no `mutation:` line — written
  - `[low]` `[patch]` Verification gap: item 5's allowlist pins had "none needed" instead of a mutation — written (a name dropped, a title renamed)
  - `[low]` `[patch]` Verification gap: item 2's scan half had no `mutation:` line, and the `removeLink` cases pass on every Node but 24.0.0 — written (red on Node 26, naming `pack-fixture.ts`); the test header now says the cases cannot tell on other Nodes
  - `[low]` `[reject]` Verification gap, other: the label "all of it" counts allowlist entries, not the `it(` blocks of the DocDB `describe` — a tenth lifecycle test is an unlisted skip in the armed run, which names it and goes red
  - `[false]` `[reject]` Intent: the runner surface (the Node 22.17.0 and 24.0.0 legs, an amd64 image, the `package` job) is unproven by the default suite — the spec names this; the lead's next CI run is that proof, and runs on real 22.17.0 and 24.0.0 binaries are recorded under Verification
  - `[low]` `[patch]` Intent: items 1 and 2 are shown on the host Node with a flag, and the `removeLink` cases cannot fail off Node 24.0.0 — same patches as the item 2 mutation line and the scan-header row (the scan is the observer elsewhere)
  - `[low]` `[reject]` Intent: the oldest-image unit test restates the constant, the key expires 2026-11-13 and the matrix row names 2024.3 — decision #64 and the Spec Change Log record the move, the contract block is read-only, the expiry is `deferred:` item 5, and the mutation line is written
  - `[medium]` `[defer]` Intent: the admin assertions are still wrapped in `if (!result.isError && created.resource)`, and a skipped or early-returning test is reported as passed — same root cause as the DW-684 row above
  - `[low]` `[reject]` Intent: the DocDB skip is decided in the shared probe, the allowlist matches file and test name rather than cause, and the lifecycle has no CI coverage — carried: `deferred:` item 6 (reopen_if: a DocDB skip in CI whose cause is not #822)
  - `[low]` `[patch]` Intent: comments record incident history — same root cause and patch as the first row
  - `[low]` `[reject]` Intent: the spine Stack row, the epics row and other text still say 2024.3 — the spine and `epics.md` are the lead's (Rule 20), and the report names the new tag and digest; `docs/migration-v1-v2.md:323` is about v1's own requirement

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

**Mutations (Rule 19).** Apply each, observe red, revert, then check `git status --short` and `git diff --stat` unchanged, and record it as `mutation: … → …`. Run 2026-10-21 on the implementation tree, each with `UNARMED CI=true`; after each revert the tree fingerprint (`git diff HEAD` plus the hashes of the untracked files) and the restored file's mtime matched the one taken before the first mutation:
- AC 42.3.1:
  - mutation: matrix `"22.17.0"` to `"22.18.0"` in `ci.yml` → `ci-workflow.test.ts` 5 red (the real-file case, the legs case, the changed-leg and dropped-leg cases, the comment case)
  - mutation: the `check-epics-sync` step deleted from `ci.yml` → `ci-workflow.test.ts` 4 red (the real-file case, naming the dropped step; the dropped-step and moved-step cases fail to find their own target)
  - mutation: root `engines.node` `>=22.17.0` to `>=22.18.0` → `ci-workflow.test.ts` 3 red (the real-file case and the floor case, which names the root manifest)
- AC 42.3.2:
  - mutation: `IRIS_HTTPS` dropped from `buildChildEnv` → `throwaway-iris.test.ts` 4 red: the `buildChildEnv` `toEqual`, the orchestration env, the `exec` env, and the `verify-iris-reachable` `CI=true` child run (it reports "CI is set but IRIS_HTTPS is not")
  - mutation: `assertThrowawayInspect` removed from `loadThrowaway` (what `exec`, `logs` and `down` run first) → `throwaway-iris.test.ts` 16 red, every unlabelled, other-label, other-name, other-port, two-container and not-running refusal of the three subcommands
  - mutation: `up` accepting `--host-port 52773` (`parseCli` stops validating it) → `throwaway-iris.test.ts` 1 red, the `parses up` case
- AC 42.3.3: mutation: the shebang removed from `packages/iris-data-mcp/src/index.ts` and `pnpm --filter @iris-mcp/data build` → `node scripts/ci-package-smoke.mjs` exit 1 with exactly one problem, `iris-data-mcp: the server exited (code 2, ...) before it answered` (`sh` reads the bin as a script); the other 7 bins passed. With that mutation in place, `pnpm --filter @iris-mcp/data test` (163 passed) and `@iris-mcp/all` shards 1/2 (2431 passed) and 2/2 (2014 passed) stayed green under `CI=true`, which makes it lead branch 7's oracle. Reverted, `data` rebuilt, and the smoke passes again.
- AC 42.3.4: each of these on `ci.yml`, with the real-file case of `ci-workflow.test.ts` going red and the named case beside it:
  - mutation: `actions/checkout@<sha> # v5.1.0` to `actions/checkout@v5` → 5 red (the three pins cases among them)
  - mutation: `continue-on-error: true` added to `gates` → 2 red
  - mutation: `pnpm lint` to `pnpm lint || true` → 5 red (the `|| true` case, and the dropped-step and moved-step cases)
  - mutation: `env: X: ${{ secrets.X }}` added to the lint step → 4 red
  - mutation: the `concurrency` block removed → 4 red (the removed-block and cancels-main cases)
  - mutation: `contents: read` to `contents: write` → 4 red (wider permissions, permission added)
  - mutation: the `sysctl` step removed → 5 red; `ip_local_reserved_ports=52790,52791` to `52773,52791` → 5 red (the reserves-52773 case)
- AC 42.3.5:
  - mutation: `needs: [gates, throwaway]` to `needs: [gates]` → `ci-workflow.test.ts` 3 red (the real-file case and the package-needs case)
  - mutation: `, ...process.argv.slice(2)` removed from `iris-data-mcp`'s `prepublish-gate.mjs` → `ci-live-suite.test.ts` 1 red (the `iris-data-mcp` forwarding case, which runs the gate with a stand-in `pnpm`); and the `data.json` check above, with the same removal, exits 1 and writes no report
- DW-676:
  - mutation: `skipped` removed from `SKIP_STATUSES` in `ci-live-suite.mjs` → `ci-live-suite.test.ts` 8 red, among them the real-path `integration-admin` case (it would exit 0 with every test skipped)
  - mutation: a scratch live-capable test file that no suite runs → `ci-workflow.test.ts` 2 red (the coverage case names it); the file was removed
- DW-666: mutation: the `eslint-disable-next-line` directive re-added at `governance.ts:935` → `pnpm --filter @iris-mcp/shared lint` exits 1 (`935:3 warning Unused eslint-disable directive`, `--max-warnings 0`)
- Seed:
  - mutation: `src/ExecuteMCPv2/Setup.cls` added to the list `seedDocuments` builds → the guard throws "shares ExecuteMCPv2.Setup.cls with the bootstrap roster" and `ci-seed-throwaway.test.ts` is red
  - mutation: the same, with the guard also disabled → 4+ red, among them the 62-files case ("expected 63 to be 62") and the none-of-the-bootstrapped-classes case ("ExecuteMCPv2.Setup.cls: expected true to be false")
- Review pass 2026-10-21 (each with `UNARMED CI=true`; after each revert `git diff 23ffa9a` hashed the same as before the first mutation):
  - mutation: the `printContainerLogs` call removed from the readiness catch of `startContainer` in `throwaway-iris.mjs` → `throwaway-iris.test.ts` 5 red (the `run` session and HTTP-poll cases; the `up` unexpiry, session and HTTP-poll cases)
  - mutation: `const compileFailures = compileProblems(compiled)` replaced by `[]` in `ci-seed-throwaway.mjs` → `ci-seed-throwaway.test.ts` 1 red, the console-only compile failure case (the thrown-error case still passed before this case existed, which is why it is new)
  - mutation: the "finished successfully" requirement removed from `compileProblems` → `ci-seed-throwaway.test.ts` 5 red (four unit cases and the console-only seed case)
  - mutation: each new check of `ci-workflow-check.ts` disabled in turn (the `gates` matrix `node-version`, the floor of `throwaway` and `package`, `run-name`, the job set, the `uses:` count, a job-level `if`, an `if` on an action step) → `ci-workflow.test.ts` 1 red each (2 for the floor check), the case named for it
  - mutation: the plain-suite line removed from `ci-live-suite.mjs` → `ci-live-suite.test.ts` 1 red, the plain-suite case
  - mutation: the state file mode `0o600` changed to `0o644` (and, separately, `flag: 'wx'` dropped) in `defaultDeps` → `throwaway-iris.test.ts` 1 red, the real state writer case, both times
  - mutation: `pnpm gen:pack:check` removed from `ROOT_GATE_SCRIPTS` → `ci-workflow.test.ts` 5 red, among them the two Rule #56 root-script cases
  - oracle check (not a mutation): the 4 capture-leg `allowedSkips` names equal the `fullName` of vitest's own `skipped` tests, from the 4 Story 39.x gate files run unarmed under the connect-refusing preload with `--reporter=json` (the connect log was never created)
- Lead branch 3 (checked here, so the branch is known to go red): `liveGateTarget` in `extensions/iris-mcp-launcher/src/__tests__/liveArming.ts` made to arm when `IRIS_HOST` is set (`... && env["IRIS_HOST"] === undefined` added to its first condition) → `liveArming.test.ts` red (`is not armed by IRIS_HOST alone` and the `IRIS_REQUIRE_LIVE` value table).

**QA pass (QA).** Gap analysis against the I/O matrix and the ACs found rows with no real-process or real-runtime pinning test. Files added (all in `packages/iris-mcp-all/src/__tests__/`, default suite, no docker, no push, no CI, nothing armed):
- `story-42-3-qa-harness-lifecycle.test.ts` (QA) and its helper `fake-docker.ts` (QA): `scripts/throwaway-iris.mjs` as a real process against a scripted `docker` that is the only entry of its PATH (the matrix rows "Harness up", "exec / logs / down", "run fails"; AC 42.3.2 local): `up` argv, state file mode 0600, `exec` environment, output and exit code, `logs`, `down` and its idempotence, an unlabelled container refused, `run` log before removal, SIGTERM, and the three `up` failures.
- `story-42-3-qa-package-smoke-runtime.test.ts` (QA): `smokePackages` over a synthetic repository with the real `pnpm pack`, `npm install` (`npm_config_offline=true`) and `npx --no` (AC 42.3.3, "exit 1 naming the bin"); `openRawWire`'s `{command, args, cwd}` option; `pnpmPack`'s `ignoreScripts` option.
- `story-42-3-qa-ci-wiring.test.ts` (QA): the `--max-warnings 0` policy of every `lint` script and the real ESLint of `@iris-mcp/shared` under it (DW-666); the `steps.<id>` and expression-context references of `ci.yml`, which `ci-workflow.test.ts` cannot see when the registry shares the typo; the usage exit of `ci-seed-throwaway.mjs` and `ci-package-smoke.mjs`.
- Run in the QA stage, each with `UNARMED CI=true`: the three files 25 passed; the spec's 10-file loop plus the three, 13 files, 515 passed; `@iris-mcp/all` shards 1/2 (97 files, 2512 passed, 358 skipped) and 2/2 (96 files, 1975 passed, 330 skipped). After every mutation below was reverted, `git diff HEAD` hashed as the empty diff, as before the first one. The marker probe after the pass: `0.0.2+1.995fbbb1055d`.
- mutation: `removeState` made a no-op in `defaultDeps` of `throwaway-iris.mjs` → `story-42-3-qa-harness-lifecycle.test.ts` 1 red (the lifecycle case: the state file survives `down`); `throwaway-iris.test.ts` 1 red as well
- mutation: the SIGINT and SIGTERM handlers of `main` in `throwaway-iris.mjs` removed (the loop over an empty list) → `story-42-3-qa-harness-lifecycle.test.ts` 1 red (the SIGTERM case: status null, signal SIGTERM, not 143); the 198 cases of `throwaway-iris.test.ts` stayed green
- mutation: `stdio: 'inherit'` to `'ignore'` in `runCommand` of `throwaway-iris.mjs` (the output of `ci-live-suite.mjs` under `exec` would never reach the CI log) → `story-42-3-qa-harness-lifecycle.test.ts` 2 red (the exec output case and the failing-`run` case); `throwaway-iris.test.ts` stayed green
- mutation: the tool-count comparison of `checkServer` in `ci-package-smoke.mjs` made always true → `story-42-3-qa-package-smoke-runtime.test.ts` 1 red (the defect run does not name `iris-count-mcp`); `ci-package-smoke.test.ts` stayed green (AC 42.3.3)
- mutation: the `rmSync(work, …)` of `smokePackages` removed → `story-42-3-qa-package-smoke-runtime.test.ts` 2 red (the clean and the failing run both leave a `ci-package-smoke-*` directory)
- mutation: `cwd` dropped from the `command` branch of `openRawWire` in `sdk-wire-golden-core.mjs` → `story-42-3-qa-package-smoke-runtime.test.ts` 3 red (both smoke runs and the `openRawWire` case); `story-43-1-raw-wire-driver.test.ts` stayed green
- mutation: `pnpmPack` made to ignore its `ignoreScripts` option (always `--config.ignore-scripts=true`) → `story-42-3-qa-package-smoke-runtime.test.ts` 1 red (`prepack` did not run); `published-tarballs.test.ts` stayed green
- mutation: `--max-warnings 0` removed from the `lint` script of `packages/shared/package.json` → `story-42-3-qa-ci-wiring.test.ts` 2 red (the script pin and the real ESLint case, where an unused directive exits 0); `package-manifests.test.ts` and `ci-workflow.test.ts` stayed green (DW-666)
- mutation: `id: seed` renamed `id: sed` in BOTH `ci.yml` and the registry (`ci-checks.mjs`), so the two stay equal → `story-42-3-qa-ci-wiring.test.ts` 2 red (16 unresolved `steps.seed` references, and the case whose own mutation target is gone); `ci-workflow.test.ts` stayed green, which is the gap this test closes (AC 42.3.5: every suite is gated on `steps.seed.outcome`)

**Code review pass (CR), 2026-10-22.** Each run below used `UNARMED CI=true` and nothing else: no docker, no push, no CI, nothing armed. After each mutation was reverted, the tree fingerprint (`git diff HEAD` plus the hashes of the untracked files) matched the one taken before it.
- Runs:
  - `node --check` passes on the 7 loop scripts and on the new `scripts/lib/script-process.mjs`;
  - the 10-file loop plus the three QA files: 13 files, 529 passed;
  - `@iris-mcp/all` shard 1/2: 97 files, 2526 passed, 358 skipped; shard 2/2: 96 files, 1976 passed, 330 skipped;
  - `@iris-mcp/admin` `type-check` and `lint` (`--max-warnings 0`) are clean;
  - the read-only marker probe returns `0.0.2+1.995fbbb1055d`.
- Oracle check (not a mutation), DW-681: a fixture sets a flag in `beforeAll`. In vitest's own JSON report, a `skipIf` on that flag is `skipped`, and a run-time `ctx.skip()` on it is `passed` (`ci-live-suite.test.ts`, "DW-681: skipIf is decided when the file is collected").
- Mutations, each with the `ci-workflow.test.ts` cases it turned red unless another file is named:
  - mutation: (DW-681) the first OAuth test of `admin.integration.test.ts` reverted to `it.skipIf(!oauthAvailable)` → 1 red, the collection-time scan case, naming `skipIf(!oauthAvailable) reads let oauthAvailable`
  - mutation: (DW-682) the `ci.yml` group reverted to `ci-${{ github.ref }}` → 5 red: the real-file case, three concurrency cases whose target is gone, and the comment case
  - mutation: the `CONCURRENCY_GROUP` check disabled → 2 red, the shared-group and per-commit-group cases
  - mutation: `unknownKeys` made a no-op → 6 red: workflow `env`, job `defaults`, step `shell`, matrix `exclude`, strategy `max-parallel`, checkout `ref`
  - mutation: the hygiene scan reads only the comment-stripped text → 1 red, the quoted `#${{ secrets.TOKEN }}` case
  - mutation: the strategy-on-another-job check disabled → 1 red, its case
  - mutation: `liveGateTarget(` removed from `LIVE_CAPABLE` → 3 red, among them the rewritten scratch live-capable case
  - mutation: the `package` needs check disabled → 2 red, among them the repaired `/matrix|does not need/` filter case
  - mutation: the nested `resolved` check of `lockfileProblems` disabled → `ci-package-smoke.test.ts` 1 red, the nested-registry-copy case
  - mutation: the dotfile filter of `seedDocuments` removed → `ci-seed-throwaway.test.ts` 1 red, the synthetic `.DS_Store` case
  - mutation: `exec`'s signal handlers in `main` looped over an empty list → `story-42-3-qa-harness-lifecycle.test.ts` 1 red, the new `exec` SIGTERM case
  - mutation: `spawnInherited` never calls `onChild` → `story-42-3-qa-harness-lifecycle.test.ts` 2 red, both SIGTERM cases. Under this mutation the harness swallows the signal, so its two test processes outlived the timed-out case; they were this run's own processes and were killed.

**Rework iteration 1 (2026-10-22).** The unarmed runs used `UNARMED CI=true`; the live runs used only `throwaway-iris.mjs up|exec|down|run` against a container the harness started (never localhost:52773). Real Node 22.17.0 and 24.0.0 binaries came from the `node` npm package in a scratch directory and ran with `PATH` set to them. After each mutation was reverted, `git diff` of the touched file showed only the intended change.
- Runs:
  - on a fresh throwaway `irishealth-community:2026.2` in `HSCUSTOM`, after the seed (62 classes), through `ci-live-suite.mjs`: `integration-admin` 28 passed, 0 skipped; `integration-data` 12 tests, 3 passed, 9 skipped, 0 unlisted (9 allowlisted); `integration-dev` 31 passed, 0 skipped;
  - the bootstrap guard on `iris-community`: 2025.1 and 2025.2 never started (the harness gave up after 300 s), 2025.3 and 2026.1 passed 9 legs each;
  - Node 22.17.0: the 7 root gate scripts, the generator `--check`, the test suites of shared (2451), client-config (1015), admin (506, 8 skipped), data (163, 2 skipped), dev (1490, 319 skipped), interop (751), ops (350), `all` shard 1/2 (2548 passed with the one stale allowlist-count case, fixed after) and 2/2 (1982), the launcher `type-check`, `build` and guard, and `node scripts/ci-package-smoke.mjs` (8 packages, 5 servers, 3 CLIs);
  - Node 24.0.0: the 7 root gate scripts, `all` shards 1/2 (2549) and 2/2 (1982), and the launcher `type-check`, `build` and guard;
  - Node 26.8.1: the 15-file loop (559 passed), `all` shards 1/2 (2549 passed, 358 skipped) and 2/2 (1982 passed, 330 skipped), shared (2451), admin (506), data (163), dev (1490); `lint` (`--max-warnings 0`) and `type-check` of shared, admin, data, dev and all;
  - the read-only marker probe returns `0.0.2+1.995fbbb1055d`.
- mutation: (item 1) the `--check` import of `scripts/gen-governance-baseline.mjs` put back to `outPath` (the `.ts` file) → `governance-baseline-check.test.ts` 3 red and `governance-derivation-lockstep.test.ts` 1 red (the generator started with `--no-experimental-strip-types`), and `script-ts-imports.test.ts` 1 red, naming `scripts/gen-governance-baseline.mjs:192 ... (through outPath)`
- mutation: (item 1) the generator as it stood at `221181a`, scanned: `tsImportProblems` finds line 10 and `outPath`; the generator on a real Node 22.17.0 fails with `ERR_UNKNOWN_FILE_EXTENSION` before the fix and prints OK after it
- mutation: (item 2) `removeLink` in `pack-fixture.ts` made `rmSync(linkPath, { force: true })` again → on a real Node 24.0.0, `validate-prompts-pack-checks.test.ts` and `story-41-5-qa-gen-skills-refusal.test.ts` red with `Path is a directory: .../qa-41-1-scratch-.../packages/iris-admin-mcp`, the same failure as the CI run, and `symlink-removal.test.ts` red on its link case (green on Node 26, where `rmSync` still removes the link)
- mutation: (item 4) `listAllNames` of `admin.integration.test.ts` made to stop after the first page → `integration-admin` on the throwaway 2 red (the resource and the role verification), 26 passed
- mutation: (item 5) the `#822` line removed from `probeDocDb` in `integration-setup.ts` → `ci-live-suite.mjs integration-data` on a fresh throwaway exits 1: 6 DocDB tests fail and 9 allowlist entries are stale
- mutation: (item 6) the SQL fixture of `tools.integration.test.ts` put back to `NonExistent.Table.ThatDoesNotExist12345` → `integration-dev` on the throwaway 1 red (`SQLCODE: -1 ... reserved word TABLE found`), 30 passed
- mutation: (item 5, allowlist) `'drops the test database'` dropped from `DOCDB_SKIPS` in `ci-checks.mjs` → `ci-workflow.test.ts` 1 red (every allowlisted skip names an existing file, a test title that is in it, and a reason; the 13 entries) and `ci-live-suite.test.ts` 1 red (the nine `integration-data` entries); and the title `it("drops the test database"` renamed in `data.integration.test.ts` → `ci-workflow.test.ts` 1 red, the same case
- Review pass 2026-10-22, rework iteration 1 (each with `UNARMED CI=true`; after the last revert the tree fingerprint, `git diff HEAD` plus the hashes of the untracked files, matched the one taken before the first mutation):
  - mutation: (item 1) the keyword rule dropped from the regex-start condition of the lexer in `script-ts-import-scan.mjs` → `script-ts-imports.test.ts` 1 red, the import after `return /['"]/` case; and the `(?<![\w$.])` lookbehind of `REGEX_KEYWORD` removed → 1 red, the line that divides by `todo`
  - mutation: (item 1) quoted strings no longer blanked before identifiers are read in `tsLiteralBehind` → `script-ts-imports.test.ts` 1 red, the case where `import('./lib/outPath.js')` must not be reported through `outPath`
  - mutation: (item 2) `forceOnlyRemovals` of `symlink-removal.test.ts` put back to the one-literal `rmSync(<path>, { force: true })` pattern → 1 red, the case of wrapped, extra-option, `rm` and `fs.rmSync` forms
  - mutation: (item 2, scan half, on Node 26.8.1) `removeLink` in `pack-fixture.ts` made `rmSync(linkPath, { force: true })` again → `symlink-removal.test.ts` 2 red: the scan, naming `iris-mcp-all/src/__tests__/pack-fixture.ts`, and the real-directory case (on Node 26 the call throws on a real directory); the two link cases stay green on every Node but 24.0.0, so the scan is what fails there
  - mutation: (item 3) `OLDEST_IRIS_COMMUNITY_IMAGE` put back to the 2024.3 digest → `throwaway-iris.test.ts` 1 red, the oldest-image pin
  - not pinned by a test that can fail: the page-error throw of `listAllNames` (diagnostic text only; the item 4 line covers its pagination), the prefix-free `#822` match (the item 5 line covers the match), and the `--check` message wording

**Code review pass, rework re-review iteration 1 (2026-10-22).**
- Every run used `UNARMED CI=true` and nothing else: no docker, no throwaway, no push, no CI, nothing armed.
- The real floor binaries were `scratchpad/node24` (v24.0.0) and `scratchpad/node22` (v22.17.0), from the rework, with `PATH` set to each.
- After the revert, `git diff | shasum` matched the fingerprint taken before the mutation (`3ba3c02d…`).
- Runs:
  - `node --check` passes on `scripts/gen-governance-baseline.mjs` and `scripts/lib/script-ts-import-scan.mjs`.
  - Host Node 26.8.1: `ci-workflow.test.ts` 86 passed (84 plus the 2 new floor-leg pins), `symlink-removal.test.ts` 6, `script-ts-imports.test.ts` 26.
  - Node 24.0.0: `symlink-removal`, `script-ts-imports`, `ci-workflow` and `validate-prompts-pack-checks`, 4 files, 135 passed.
  - Node 22.17.0:
    - the first three of those files: 3 files, 118 passed;
    - shared `governance-baseline-check` and `governance-derivation-lockstep`: 5 passed;
    - `pnpm gen:governance-baseline:check`: OK, 141 frozen keys, baseline file unchanged.
  - The read-only marker probe returns `0.0.2+1.995fbbb1055d`.
- Probe (not a mutation), on real binaries, of `rmSync` on a link to a directory:
  - Node 24.0.0 throws `ERR_FS_EISDIR` with no options, with `force`, with `maxRetries` and with `recursive: false`;
  - 22.17.0 removes the link in all four forms.
- mutation: (the floor-leg pin) `src/__tests__/symlink-removal.test.ts` added to the `exclude` of `packages/iris-mcp-all/vitest.config.ts` → `ci-workflow.test.ts` 1 red, `symlink-removal.test.ts, a floor-leg check, exists and is inside the include and outside the exclude`.

**Lead checklist (AC 42.3.6; lead only, after the story commit is pushed to `epic42`):**
1. Wait for the story commit's run, and record its URL and per-job durations.
   - If it is red on an unlisted skip, a Linux-only failure or an oldest-image compile error, take the failed-smoke path: unexpected skips become seed fixes or reasoned `allowedSkips` entries, and the oldest leg follows decision 5.
   - Once it is green, rerun it once (`gh run rerun <id>`). A red rerun of the unchanged commit reopens DW-444.
   - Calibration the first run is expected to need (none of these has an `allowedSkips` entry, by design): environmental skips such as the DocDB legs of `data.integration.test.ts`, a keyring in the credentials process gate, `story-40-2-qa-live-gate` QA-11 when the runner user is root, and a `launcher-live` leg that skips for an unbuilt `dist/`, another pnpm SDK store layout or an unreachable IRIS. The seed compiles the 62 test and fixture classes in ONE synchronous Atelier request (client timeout 10 minutes); if a Web Gateway cuts it near 60 seconds, batch the compile by dependency closure (`LocFixtureChild` extends `LocFixtureBase`). The `package` job needs `registry.npmjs.org` for the third-party dependencies.
   - The two OAuth tests of `integration-admin` run for the first time anywhere (DW-681) and have no allowlist entry. If they show as unlisted skips, `iris_oauth_list` answered an error in the throwaway; record the reason as an `allowedSkips` entry. On the shared IRIS for Health 2026.2 it answers cleanly (probed read-only 2026-10-22).
2. Branch each mutation from the story commit as `ci-red-42-3-<slug>`, push them all together, and record each run's URL and the expected red:
   1. `selftest`: one `uses:` sha changed to its tag, the matrix `22.17.0`→`22.18.0`, and the `check-epics-sync` step deleted → `gates` red at the `@iris-mcp/all` test step; the log names the pins, matrix and step-equality cases.
   2. `lint`: the directive re-added at `governance.ts:935` → `gates` red at `pnpm lint`.
   3. `launcher`: `liveArming.ts` armed by a set `IRIS_HOST` (the first condition of `liveGateTarget` gets `&& env["IRIS_HOST"] === undefined`; checked locally, `liveArming.test.ts` goes red) → `gates` red at the launcher guard step.
   4. `skip`: `packages/iris-admin-mcp/src/__tests__/integration-setup.ts` forces `__IRIS_AVAILABLE__ = false` → `throwaway` red at `integration-admin` (vitest exited 0, and `ci-live-suite` lists the skips); `package` not run.
   5. `guard` (DW-672, DW-508): `packages/shared/src/bootstrap.ts` `probeCustomRest` reverted to `deployedVersion === BOOTSTRAP_VERSION ? current : stale` (42.2's mutation) → `throwaway` red at `bootstrap-guard` (the newer, foreign and DW-518 legs). `gates` is also red, which is expected.
   6. `roster` (DW-443): one assertion of `packages/iris-admin-mcp/src/__tests__/resource-listprivileges-live-gate.test.ts` broken → `throwaway` red at `prepublish-admin`; `package` shows `skipped`.
   7. `package`: the shebang mutation (delete line 1 of `packages/iris-data-mcp/src/index.ts`; the default suites were run green with it, see the mutations above) → only `package` is red, at the smoke step.
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

Status: done
Blocking condition: none

This is the result of rework iteration 1 (2026-10-22) and covers only that pass: the six `[CI]` items the first CI run (run 39730712530, sha 221181a) added. Nothing was committed, pushed or triggered, and no `BOOTSTRAP_VERSION`, tool, golden, snapshot, baseline (`1e62c5ad5bf7`/141), `.changeset/` or spine change was made (`BOOTSTRAP_VERSION` stays `0.0.2+1.995fbbb1055d`, probed read-only on the shared IRIS before the pass ended; the changeset is unchanged because no `@iris-mcp/shared` source changed).

**What each item came to** (details on its line under `## Tasks & Acceptance`, mutations under `## Verification`):
- Node 22.17.0: `gen-governance-baseline.mjs --check` imports the built `dist/governance-baseline.js`; `scripts/lib/script-ts-import-scan.mjs` and `script-ts-imports.test.ts` catch a `.ts` import in any script; the two shared tests run the generator with `--no-experimental-strip-types`.
- Node 24.0.0: `removeLink` (an unlink) replaces `rmSync(link, { force: true })` in 4 places; `symlink-removal.test.ts` pins it.
- Oldest image: `iris-community:2025.3@sha256:f456892d…`, because the keys of 2024.3, 2025.1 and 2025.2 had expired. Its key expires on **2026-11-13**, so the lead moves the constant to 2026.1 (`sha256:c57b65b2…`, key to 2027-03-27) if the release comes after that day.
- `integration-admin`: the test now follows `nextCursor` (the tool paginates at 50 rows; a fresh IRIS for Health has more resources and roles).
- `integration-data`: the DocDB lifecycle cannot run on a fresh instance (service disabled, no `Security.DocDBs` record; the F5 gate needs the service disabled), so its probe reads `#822` as unavailable and `DOCDB_SKIPS` allowlists the 9 tests by name.
- `integration-dev`: the SQL fixture no longer contains the reserved word `TABLE`.

**Files changed:** `scripts/gen-governance-baseline.mjs`; `scripts/throwaway-iris.mjs` (constant and comment); `scripts/lib/ci-checks.mjs` (`DOCDB_SKIPS`); `scripts/lib/script-ts-import-scan.mjs` (new); `.github/workflows/ci.yml` (header comment); `README.md`; `CHANGELOG.md`; and in `packages/`: `iris-admin-mcp` and `iris-dev-mcp` integration tests, `iris-data-mcp` integration test and `integration-setup.ts`, `shared` governance tests (2), `iris-mcp-all` `pack-fixture.ts`, `story-41-1-qa-fixture.ts`, `story-41-5-qa-gen-skills-refusal.test.ts`, `validate-prompts-pack-checks.test.ts`, `throwaway-iris.test.ts`, `ci-workflow.test.ts`, `ci-live-suite.test.ts`, and the new `script-ts-imports.test.ts` and `symlink-removal.test.ts`.

**Review of this pass (4 layers, 34 findings: high 0, medium 3, low 30, false 1, maybe-false 0).** Patched (19 rows, 9 root causes, all low): comments that narrated the rework; a lexer bug that hid a later `.ts` import after `return /.../`; identifiers read from an import's string; the scan header's statement of what it does not find; the symlink-removal scan widened to wrapped, extra-option and `rm` forms; the `--check` message wording; the prefix-free `#822` match; the `listAllNames` later-page error; and the missing `mutation:` lines (oldest image, allowlist pins, the scan half of item 2). Deferred (3 rows, 2 entries): the 2025.3 key expiry (already `deferred:` item 5) and the admin list tests that assert nothing after a failed create (a new `deferred:` item, an occurrence of DW-684). Rejected (12), with reasons in the Review Triage Log, among them: scan blind spots no script reaches (now stated in its header), the CHANGELOG layout, and the descriptive intent observations.

**Verification performed** (all unarmed with `UNARMED CI=true` except the live runs of the implement step, which used only the harness on throwaways): `node --check` of the scripts; the 15-file loop 562 passed; shared lint 0 warnings; launcher guard 12 passed; per-package tests shared 2451, client-config 1015, admin 506 (8 skipped), data 163 (2 skipped), dev 1490 (319 skipped), interop 751, ops 350; `@iris-mcp/all` shard 1/2 2552 passed (358 skipped) and 2/2 1982 passed (330 skipped); `pnpm lint` and `pnpm type-check` green; launcher `type-check` and `build` green; the seven gate checks OK (baseline unchanged); `node scripts/ci-package-smoke.mjs` exit 0 (8 packages, servers 27/8/33/25/22 tools, 3 CLIs); the data `prepublishOnly` with reporter arguments exit 1 with `data.json` written and an empty connect log; the marker probe `0.0.2+1.995fbbb1055d`. No commit, push or CI run by any layer (`git log --branches --not --remotes` shows only the lead's `eaa56ff`; `gh run list` shows only run 39730712530).

**Follow-up review recommended: false.** This pass patched no `high` finding and changed no product code. The proof that matters is the lead's next CI run: the generator on a real Node 22.17.0, the Node 24.0.0 shards, the integration suites on a fresh seeded throwaway and the bootstrap guard on 2025.3 all passed locally, but the Actions runner, an amd64 image and the `package` job (it never ran in the first run) are still unproven.

**Residual risks:**
- The 2025.3 license expiry (2026-11-13) above. The amd64 image of 2025.3 was not run (this host pulls arm64); the manifest list names it, and the 2024.3 failure was the key, not the architecture.
- The DocDB lifecycle has no CI coverage (deferred item 6). Any other environmental skip (a keyring, QA-11 as root, a `launcher-live` leg) would still show up as an unlisted skip in the first run.
- Containers started and removed by this pass, all through `scripts/throwaway-iris.mjs`: `iris-mcp-throwaway-dbc678202a4a`, `-b38ac674c702`, `-41c2405481c3`, `-1f51ee61bf66` and `-7b418c4c4bd7` (`run`, which removes its own), and `-5ce5a96ca3f5`, `-997d40429020` and `-98103da99a4f` (`up`, then `down`, each reported "removed"). A further `up` (port 52791) failed before a container existed ("port is already allocated" by something else on this host), so nothing was created.
- Shell heredocs: one scratch probe script and one rewrite of `scripts/lib/script-ts-import-scan.mjs` went through a shell heredoc (Rule #55) before this was noticed; the file was re-read in full and parses (`node --check`), and its tests pass. Everything after that used the file tools.
