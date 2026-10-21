---
title: 'Story 42.2: Bootstrap Downgrade Guard'
type: 'feature'
created: '2026-10-21'
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
  - summary: 'AD-14 Ownership and IPM-upgrade bullets are not implemented here: bootstrap does not detect IPM-installed classes, and no IRIS-side no-downgrade check exists for the IPM install/upgrade path. Story 42.4 owns both. It should reuse this story''s marker grammar and ordering table, and add a parity test between the TypeScript comparator and the ObjectScript one.'
    evidence: 'Plan 2026-10-21: `ipm/module.xml` installs from `src/` (SourcesRoot src), so an IPM install reports "dev", which this story classifies as foreign (never redeployed). Once 42.4 builds archives from stamped output, an IPM install carries a real marker, so ownership needs its own signal. No IPM packaging exists yet, so a branch for it here would be unreachable (Rule #54).'
    location: 'Story 42.4; packages/shared/src/bootstrap.ts; src/ExecuteMCPv2/Setup.cls'
    severity: 'med'
  - summary: 'Story 42.3''s CI throwaway job should extend `scripts/throwaway-iris.mjs` rather than add a second container helper (Rule 2), and should run `pnpm live:bootstrap-guard` (the AC 42.2.5 check), which is off every prepublish roster by design.'
    evidence: 'Plan 2026-10-21: the 42.2 gate arms only on IRIS_THROWAWAY and refuses any target that already holds ExecuteMCPv2 classes, so a prepublish run against a real instance cannot run it.'
    location: 'Story 42.3 (scripts/ci-throwaway.sh, .github/workflows/ci.yml)'
    severity: 'med'
  - summary: 'Armed live gates now fail closed unless all five of IRIS_HOST/PORT/USERNAME/PASSWORD/NAMESPACE are set. The release path (`prepublishOnly` -> `prepublish-gate.mjs`, Story 42.5 release script, Story 42.6 publish) must export all five or the gates go red.'
    evidence: 'DW-627 lead trailer 2026-10-20: "the prepublish gate must then export all five IRIS_* (42.6)". `prepublish-gate.mjs` sets only IRIS_REQUIRE_LIVE=1 (admin:36, data:68, dev:118, all:305).'
    location: 'packages/*/scripts/prepublish-gate.mjs; Story 42.5; Story 42.6'
    severity: 'med'
  - summary: 'Concurrency residual: the re-probe before compile stops this server compiling over a newer build that compiled first. It cannot undo source PUTs that two builds interleaved, so the namespace can hold mixed source under a newer compiled marker. The next `unconfigured` self-heal recompile would then compile that source.'
    evidence: 'Plan 2026-10-21: each Atelier request is a separate IRIS process, so no lock can span the 35 PUTs and the compile (bootstrap.ts:244-271).'
    location: 'packages/shared/src/bootstrap.ts'
    severity: 'low'
---

<intent-contract>

## Intent

**Problem:** The bootstrap redeploys its embedded classes whenever the deployed version differs, including when a newer build deployed them. An older server on a shared instance therefore silently downgrades the classes and can reinstall the pre-36.4 `Global.cls` (DW-508, HIGH). Separately, 62 of the 63 test files that can reach IRIS run their legs whenever localhost:52773 answers. So a contributor's plain `pnpm test` touches their own instance, and the default-suite outage gate bootstraps it (DW-627, DW-518).

**Approach:**
- Stamp an orderable marker `<semver>+<sequence>.<hash>` at generation time.
- Classify the deployed marker as older, current, newer or foreign. Redeploy only an absent or older deployment, and otherwise log one warning naming both markers and the remedy.
- Prove the guard on a throwaway IRIS container. On the shared instance a namespace cannot isolate the deploy (Design Notes).
- Route every live test leg through one opt-in arming helper, and pin with a connection-refusing preload that an unarmed run connects to nothing.

## Boundaries & Constraints

**Always:**
- **Leave the shared IRIS alone** (localhost:52773, container `iris-community-edition`). No stage of this story runs an armed gate, starts an MCP server built from this story's code, `iris_doc_load`s, compiles or runs `%UnitTest` against it. HSCUSTOM keeps marker `d51856f74d6a` (read-only probes are fine). Never stop, restart, `exec` into or remove a container the session did not start.
- **Live checks run only in a throwaway container** that `scripts/throwaway-iris.mjs` started. The harness removes it on every exit path. It refuses port 52773, the name `iris-community-edition`, a floating image tag, and any container it did not create.
- **Existing probe paths keep their behavior** (AD-15): an absent deployment gets the full install; an equal marker is `current` or `unconfigured`; an older deployment takes today's `stale` upgrade flow. The one addition is a re-probe immediately before each compile.
- **Generated files change only through their generators** (Rules #18/#24): rerun `pnpm gen:bootstrap` and record `BOOTSTRAP_VERSION` `d51856f74d6a` → new.
- **Repo conventions:** changesets are `patch` or `minor` only. Non-ASCII in code uses escapes, and comments state the contract (Rule 14).

**Never:**
- No IPM-ownership branch and no IRIS-side comparator; both belong to Story 42.4.
- No new product environment variable (no force-redeploy switch).
- No new bootstrapped class (both rosters stay as they are).
- No REST route or response change (AD-33).
- No change to the tool surface, the frozen goldens, `tools-list-snapshot.json` or the governance baseline.
- No publishing, versioning or tagging, and no edits to `irislib/` or `irissys/`.

## I/O & Edge-Case Matrix

Embedded marker `E` = `0.0.2+1.<h>` in the examples.

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Absent | Version query fails or is empty | `missing`: full install, as today | as today |
| Equal | Deployed = `E` exactly | `current` / `unconfigured`, as today | as today |
| Older | Legacy bare 12-hex (pre-42.2 build); lower semver; same semver with lower sequence | `stale`: redeploy and compile (plus the privileged steps if the web app is absent), as today | as today |
| Newer (DW-508) | Higher semver; same semver with higher sequence | `newer`: no PUT, compile, Configure, mapping or `^UnitTestRoot`. One `[WARN]` names both markers and the remedy: upgrade this server to a build at least as new as the deployed one (its semver and sequence), and run the same or a newer build on every client that shares the instance | none thrown |
| Foreign | Same semver and sequence with a different hash; `dev`; any unparseable value | `foreign`: nothing runs. One `[WARN]` names both markers and the remedy: run one build per instance; to install this server's classes deliberately, delete class `ExecuteMCPv2.Setup` in `<ns>` and restart this server | none thrown |
| Race | On a deploy path, the re-probe before compile reads a marker that is newer or foreign | Skip the compile and every later step; one `[WARN]` names both markers | none thrown |
| Live: newer (Integration) | Throwaway seeded at a newer marker; a built `iris-dev-mcp` starts with its default profile there | Every doc's content and `ts`, and the compiled marker, are unchanged; stderr carries the newer warning | none |
| Live: DW-518 (Integration) | The epic37 shape: `default` = 127.0.0.1:9, `other` = throwaway seeded newer; first `server:"other"` call | Same as the row above (lazy per-profile bootstrap) | none |
| Live: older and legacy | Seeded at a lower sequence, and separately at a bare hash | After first touch, every doc equals the embed and the compiled marker equals the shipped one | none |
| Unarmed (DW-627) | `IRIS_REQUIRE_LIVE` unset (an `IRIS_HOST` alone does not arm; decision #51) | Every leg of the 63 files skips before any request. The preload records zero connects to port 52773 or 1972 | none |
| Armed, incomplete | `IRIS_REQUIRE_LIVE=1` set, with any of the five `IRIS_*` missing | Fails, naming the missing variables; no request | throws |
| Armed, complete | All five set | Reachable: legs run. Unreachable: skip, or throw under `IRIS_REQUIRE_LIVE`, as today | as today |

</intent-contract>

## Code Map

**Root cause (AC 42.2.1):** `packages/shared/src/bootstrap.ts`:
- `:161` compares with `===`;
- `:177` returns `stale` for any other value;
- `:517-551` then redeploys and compiles;
- `:48-52` is the `ProbeResult` union and `:59` the `BootstrapResult.probeStatus` union;
- `:244-271` holds deploy and compile. The re-probe goes before each `compileClasses` call (`:505`, `:543`).
- Log wording `Bootstrap: REST service is current …` (`:483`) stays: `story-43-3-qa-fallback.test.ts:168` pins it.

**Generator and embed:**
- `scripts/gen-bootstrap.mjs`: the hash is `:91-96` (computed over the `dev`-placeholder content, so it stays independent of semver and sequence), the stamp `:112-115`, the header `:119-143`, and write-if-changed `:185-195`.
- `src/ExecuteMCPv2/Setup.cls`: the doc comments at `:16-26` and `:208-217` describe equality redeploy (wrong after this story). The placeholder line `:27` stays byte-identical.
- `packages/shared/package.json`: `version` 0.0.2, the in-repo `exports` `./test-helpers*`, and `publishConfig.exports` (root only, so new test helpers never ship).

**Consumers:**
- `packages/shared/src/server-base.ts:2892-2915` (startup) and `:3132-3170` (lazy per profile) log only `errors` and `manualInstructions`. No change is needed: the warning is logged inside `bootstrap()`.
- `BootstrapResult` is exported at `index.ts:129` and `okBootstrap` literals appear in 22 test files, so any new field must be optional.

**Tests that pin today's format or flow:**
- `packages/shared/src/__tests__/bootstrap.test.ts`:
  - stale fixtures `:179`, `:750`, `:817`, using the non-hex `oldhash12345`;
  - fetch counts `:553`, `:616`, `:806`, `:873`;
  - format regex `:1233`;
  - drift recompute `:1261-1364`.
- `packages/shared/src/__tests__/gen-bootstrap-write.test.ts`: `:48` (`versionOf` regex) and `:55-63` (the scratch tree has no `package.json`).
- `packages/shared/src/__tests__/bootstrap.integration.test.ts:50` (status list).
- `packages/iris-mcp-all/src/__tests__/changelog-bootstrap-move.test.ts:25,29` (12-hex regexes).
- `scripts/lib/sdk-handler-golden-core.mjs:97` `readBootstrapVersion`, which is `[0-9a-f]+`. Its eight consumers throw on the new format. The frozen handler golden stays valid: its flows take only the `current` path (no compile or PUT recorded).
- 41.8 gates: `story-41-8-qa-gate-guard.test.ts:57,294` (the default suite) and `story-41-8-qa-accept-language-live-gate.test.ts:178`.
- `packages/iris-mcp-all/src/__tests__/process-gate-helpers.ts`:
  - `assertDeployedBootstrapVersion` `:627-642`, whose message says "that bootstrap failed or did not run", pinned by `bootstrap-version-check.test.ts:85-103`;
  - `irisTargetFromEnv` `:181-190` (defaults localhost/52773/_SYSTEM/SYS/HSCUSTOM), `isIrisReachable` `:62-71`, `connectionEnv` `:192-200`, `atelierQuery`, and the doc GET (`{ts, content}`, `:600-602`) to reuse.

**Live-gate arming (DW-627), enumerated 2026-10-21:**
- **The 63 files.** The scan is `git grep -l -E 'process\.env\.IRIS_(TEST_)?HOST \?\?|irisTargetFromEnv\(\)|getIntegrationConfig\(|__IRIS_AVAILABLE__'` over `packages/*/src/**/*.test.ts`, `packages/*/tests/**/*.test.ts` and `extensions/iris-mcp-launcher/src/__tests__/*.test.ts`. By package: launcher 2, admin 2, data 2, dev 16, interop 1, all 34, ops 1, shared 5. 52 are in the default suite and 11 are `*.integration.test.ts`.
- **A.** 26 `@iris-mcp/all` spawned-server gates, using `irisTargetFromEnv` plus `isIrisReachable`: `epic38/39/40-capstone-gate`, `story-38-4-qa-doc-edit-wire-gate`, `story-38-5-qa-sql-wire-gate`, `story-38-7-qa-wire-gate`, and every `story-39-*`/`story-40-*` `*-live-gate`.
- **B.** `story-41-8-qa-accept-language-live-gate` is already opt-in. It is stricter: `IRIS_REQUIRE_LIVE` only, and all five variables. Keep its arming.
- **C.** 17 gates with inline `process.env.IRIS_* ??` defaults plus `ping`:
  - all: `epic35-defect-gate`;
  - dev: `execute-classmethod-epic-gate`, `request-body-utf8-decode`, `execute-tests-running-contract-epic-gate`, `test-status-epic-gate`, `global-injection-epic-gate`, `doc-put-bom-live-gate`, `doc-get-range-live-gate`, `doc-put-storage-guard-live-gate`, `doc-edit-live-gate`, `sql-safety-live-gate`, `story-38-7-qa-live-gate`, `doc-type-description-live-gate`, `storage-guard-write-paths-live-gate`, `story-42-11-qa-live-gate`;
  - admin: `resource-listprivileges-live-gate`;
  - data: `analytics-cubes-wire-gate`.
- **D.** 8 gates that read `IRIS_TEST_*` (defaults, private probe):
  - all: `epic37-default-outage-gate` (`:74-78`, `:85`), `credentials-cli-process-gate`, `governance-file-process-gate`, `host-guard-process-gate`, `server-manager-precedence-gate`, `server-manager-process-gate`;
  - launcher: `governanceUiRoundTrip`, `localSpawnIntegration`.
- **E.** 11 integration files, through the 6 `packages/*/src/__tests__/integration-setup.ts`, `packages/shared/src/__tests__/integration-helpers.ts:17-53` and `packages/shared/src/test-helpers/integration-config.ts:29-43`:
  - admin, data, interop and ops `.integration`;
  - dev `custom-rest` and `tools`;
  - shared `atelier`, `errors`, `health`, `http-client` and `bootstrap`.
- **Meta tests that move with the arming:**
  - `live-gate-roster.test.ts:28-64` detects armed files with `/process\.env\.IRIS_REQUIRE_LIVE\s*===/`;
  - `gate-helper-copies.test.ts:21-74,183-240`;
  - `epic38-gate-guards.test.ts:136-152` and `story-39-1-gate-guards.test.ts:149-165` (unarmed/armed against a closed port);
  - `story-41-8-qa-gate-guard.test.ts:298-324` (zero requests while unarmed with a full target, which needs B's stricter arming).
- **Rosters:** `packages/{iris-admin-mcp,iris-data-mcp,iris-dev-mcp,iris-mcp-all}/scripts/prepublish-gate.mjs` (54 files in all) set `IRIS_REQUIRE_LIVE=1` and no target.
- **Preload precedent:** `packages/iris-mcp-all/src/__tests__/hide-changesets-preload.mjs`, with `story-42-1-qa-changeset-readers.test.ts` as its child-vitest runner.

**Docs:**
- `README.md`: `## Known Limitations` (`:988`) and `### Migrated or %SYS-Reset Instances (Self-Healing)` (`:1007-1016`).
- `packages/shared/README.md` `### Bootstrap` (`:60-70`).
- `tool_support.md:481,495` ("guarantees that every server restart reconciles", "version-stamped auto-upgrade").
- `CHANGELOG.md:5`: the newest-first section format.
- An example changeset: `.changeset/story-42-11-storage-guard-on-every-document-write.md`.

**Throwaway building blocks:**
- The local image `intersystems/iris-community:2026.2@sha256:cd2ebcab02d1ef80ec155def4418399f353d867162688c36a3705760e750bdaa` (arm64, the same 2026.2 build as the shared instance). Docker 29.7.2 is on the host.
- The OcuPilot shapes:
  - `../OcuPilot/scripts/ci-image-compile.sh:45-102` (`docker run`, trap, bounded `iris session` readiness loop);
  - `ci-ipm-archive.sh:86-132` (name refusal, INT/TERM trap);
  - `Installer.cls:1768-1775` (`Security.Users.UnExpireUserPasswords("_SYSTEM",.n)`; exists, `irissys/Security/Users.cls:424`).

## Tasks & Acceptance

**Execution:**
- `scripts/bootstrap-sequence.json` (new) -- the generator's state, `{"sequence": <int>, "hash": "<12hex>"}`. Commit it first by hand as `{"sequence": 0, "hash": ""}`; the first generator run makes it sequence 1 -- this is the monotonic sequence, kept in a tiny file so a merge conflict is explicit (resolve by keeping the higher sequence, then rerun the generator).
- `scripts/gen-bootstrap.mjs`:
  - Read `packages/shared/package.json` `version` and require `^\d+\.\d+\.\d+$`.
  - Read the state file. A missing file throws: "restore it from git; the sequence never goes backwards".
  - When the computed hash differs from the state's hash, raise the sequence by exactly 1 and write the state. Otherwise leave it.
  - Stamp `BOOTSTRAP_VERSION = "<semver>+<sequence>.<hash>"` into both the embed and the Setup copy.
  - Update the header comments to the contract.
  - Rationale: AC 42.2.2, AC 42.2.3. An unchanged rerun stays byte-identical.
- `packages/shared/src/bootstrap-version.ts` (new) -- `parseBootstrapMarker`, plus `classifyDeployedMarker(deployed, embedded)` returning `"current" | "older" | "newer" | "foreign"` per the matrix. The grammar is `^(\d+)\.(\d+)\.(\d+)\+(\d+)\.([0-9a-f]{12})$`; a legacy marker matches `^[0-9a-f]{12}$`; `dev` and anything else are foreign. Rationale: one comparator for the probe, the gate and Story 42.4.
- `packages/shared/src/bootstrap.ts`:
  - Classify in `probeCustomRest`. `older` maps to the existing `stale`. Add `{status:"newer"|"foreign"; deployedVersion}`. `newer` and `foreign` make no `IsConfigured` call.
  - In `bootstrap()`, `newer` and `foreign` return with every step flag false and `probeFound: true`, logging exactly one `logger.warn` per the matrix.
  - Re-probe immediately before each `compileClasses`. A newer or foreign reading skips the compile and every later step, with a warning.
  - Widen `BootstrapResult.probeStatus` and add the optional `deployedVersion?: string`.
  - Bring the doc comments up to date.
  - Rationale: AC 42.2.1, AC 42.2.2, DW-508.
- `src/ExecuteMCPv2/Setup.cls` -- doc comments only, stating the marker grammar and the ordering. The placeholder line stays as it is. Then run `pnpm gen:bootstrap` and record from→to. Rationale: AC 42.2.3 and Rule #24; the comments become true.
- `packages/shared/src/__tests__/bootstrap-version.test.ts` (new); `bootstrap.test.ts`; `gen-bootstrap-write.test.ts`; `bootstrap.integration.test.ts`:
  - **bootstrap-version.test.ts** covers every matrix classification row: legacy, semver, sequence, hash, `dev`, garbage and boundary values.
  - **bootstrap.test.ts**:
    - stale fixtures become valid legacy hex;
    - new probe and orchestration tests for `newer`, `foreign` and the race (no PUT, no compile, one warn naming both markers);
    - deploy-path fetch counts become +1 for the re-probe;
    - the format regex follows the grammar;
    - the drift check also asserts the semver equals `packages/shared/package.json`, the sequence and hash equal the state file, and the hash equals the recomputed one.
  - **gen-bootstrap-write.test.ts**:
    - the scratch tree copies `package.json` and the state file;
    - an unchanged rerun keeps the sequence;
    - a class edit raises it by exactly 1;
    - a missing state file throws.
  - **bootstrap.integration.test.ts**: the status list gains `newer` and `foreign`.
- `scripts/lib/sdk-handler-golden-core.mjs`; `packages/iris-mcp-all/src/__tests__/changelog-bootstrap-move.test.ts`; `story-41-8-qa-gate-guard.test.ts`; `story-41-8-qa-accept-language-live-gate.test.ts` -- widen every marker regex to the grammar (legacy accepted as the `from` side). Rationale: the shared surface of the new format.
- `packages/iris-mcp-all/src/__tests__/process-gate-helpers.ts`; `bootstrap-version-check.test.ts`:
  - `assertDeployedBootstrapVersion`'s message also names the guard ("or refused to replace a newer or foreign deployment").
  - `irisTargetFromEnv` delegates to the shared helper, with no default target.
- `packages/shared/src/test-helpers/live-target.ts` (new, exported as `./test-helpers/live-target`, in-repo only) -- `resolveLiveTarget(env = process.env)`:
  - armed iff `IRIS_REQUIRE_LIVE` ∈ {`1`, `true`}; a non-empty `IRIS_HOST` alone does NOT arm (spec gate, decision #51);
  - unarmed → `{armed:false, reason}`, before anything else;
  - armed → all five `IRIS_*` must be set, else throw naming the missing ones. `IRIS_HTTPS` is optional (`false`);
  - returns `{armed:true, requireLive, target}`;
  - the contract extends 41.8's `liveSkipReason` (`:185-219`).

  Rationale: DW-627, one choke point.
- The 63 files of Code Map families A, C, D and E, plus `packages/shared/src/test-helpers/integration-config.ts`, `packages/shared/src/__tests__/integration-helpers.ts` and the 6 `integration-setup.ts` files:
  - Resolve the target only through `resolveLiveTarget`, and skip with its reason before any probe or spawn when unarmed. An integration setup sets `__IRIS_AVAILABLE__=false` without probing.
  - Remove every inline `?? "<default>"` and every `IRIS_TEST_*` read; family D moves to `IRIS_*`.
  - Keep each gate's own `IRIS_REQUIRE_LIVE` skip-to-throw behavior and its roster detectability.
  - The two launcher files hold a ~10-line local copy of the arming check, because AD-2 keeps the extension self-contained.
  - Add a header line to the epic37 gate recording its write footprint (DW-518).
  - Rationale: DW-627, DW-518.
- `packages/iris-mcp-all/src/__tests__/live-gate-roster.test.ts`; `gate-helper-copies.test.ts`; `epic38-gate-guards.test.ts`; `story-39-1-gate-guards.test.ts` -- update their detection and pins to the new arming. The roster scan's non-empty assertion must stay meaningful (Rule #59).
- `scripts/lib/no-live-iris-preload.mjs` (new) -- loaded via `NODE_OPTIONS=--import`. It patches `net.Socket.prototype.connect`: a connect to a watched port (default 52773 and 1972; the list comes from `IRIS_MCP_WATCH_PORTS`) is refused and appended to the file named by `IRIS_MCP_CONNECT_LOG`. Rationale: an oracle that is also the safety net.
- `packages/iris-mcp-all/src/__tests__/live-arming-guard.test.ts` (new):
  - **(a) Static scan.** No test file in the workspace or the launcher reads `process.env.IRIS_(TEST_)?(HOST|PORT|USERNAME|PASSWORD|NAMESPACE)` with a `??` or `||` default, and none names `IRIS_TEST_(HOST|PORT|USERNAME|PASSWORD|NAMESPACE)`.
  - **(b) Behavioral run.** The scan's live-capable files must number at least 63 (2026-10-21). For each pnpm package, they run in one child `vitest run` with its default config, and the integration files with `vitest.integration.config.ts`. Every `IRIS_*` and `IRIS_REQUIRE_LIVE` variable is deleted from the environment, and the preload is set. Each child run must exit 0 with an empty connect log.
  - **(c) Control.** A control file connects to a stand-in listener whose port is watched, and that connect must be logged. This proves the interception works in the vitest pool.
  - **(d) Helper unit table.** Empty env, `REQUIRE_LIVE` only, `IRIS_HOST` only (unarmed), all five.
- `extensions/iris-mcp-launcher/src/__tests__/live-arming-guard.test.ts` (new) -- runs the launcher's two live files unarmed in a child vitest with the preload, and expects zero logged connects.
- `scripts/throwaway-iris.mjs` (new; root `package.json` gains `"live:bootstrap-guard": "node scripts/throwaway-iris.mjs run -- pnpm --filter @iris-mcp/all exec vitest run src/__tests__/story-42-2-bootstrap-guard-live-gate.test.ts"`):
  - `run -- <cmd…>` validates first: the pinned digest, no port 52773 or 1972, never the name `iris-community-edition`. It then installs the teardown (`docker rm -f -v <the id it created>` on exit, INT and TERM).
  - It runs `docker run -d --label iris-mcp.owner=throwaway -p 127.0.0.1::52773 <image>` and reads the port with `docker port`.
  - It waits on a bounded `iris session` loop, runs `UnExpireUserPasswords("_SYSTEM")`, and polls `GET /api/atelier/` until it answers 200.
  - It then runs the command with `IRIS_REQUIRE_LIVE=1`, `IRIS_HOST=127.0.0.1`, `IRIS_PORT`, `IRIS_USERNAME=_SYSTEM`, `IRIS_PASSWORD=SYS`, `IRIS_NAMESPACE=USER` and `IRIS_THROWAWAY=<name>`.
  - A missing docker exits non-zero; it never skips.
  - Pure helpers (validation, argv) are exported for 42.3, with a unit test `packages/iris-mcp-all/src/__tests__/throwaway-iris.test.ts`.
  - Rationale: AC 42.2.5 isolation.
- `packages/iris-mcp-all/src/__tests__/story-42-2-bootstrap-guard-live-gate.test.ts` (new, default suite) -- it skips unless `IRIS_THROWAWAY` is set, and it is off every roster: list it as a named exemption in `live-gate-roster.test.ts`.
  - **Before any write, fail closed unless:** the port is not 52773; `docker inspect $IRIS_THROWAWAY` publishes that port and carries the label; the version query FAILS (no ExecuteMCPv2 classes are deployed yet); and the shared and dev dists are fresh (`staleDistReason`; armed, staleness fails rather than skips).
  - **Seeding:** PUT the dist's `BOOTSTRAP_CLASSES` with Setup's marker replaced (plus one seed comment line in Setup.cls), compile, then run `Setup_Configure` and `Setup_ConfigureMapping`.
  - **Probe first:** the first seed compile shows whether the 35 classes compile in plain-IRIS `USER`. If they do not, record the compile errors as a `deferred:` item (they matter for the 2023.1+ plain-IRIS support claim) and pin the harness to `intersystems/irishealth-community:2026.2@sha256:462de1fb3597272fde0e03afad006af1b18b59c90f1c1fb5566c79b027a7af0a` (also local).
  - **Legs:** each spawns a fresh built `iris-dev-mcp` and checks the Live rows of the matrix:
    - newer at startup, seeded as the same semver with sequence+1;
    - newer through the lazy `other` profile (DW-518), seeded as the semver major+1. Build the profiles the way `epic37-default-outage-gate.test.ts:186-199` does;
    - foreign, both a same-sequence different hash and `dev`;
    - older, a lower sequence;
    - legacy;
    - then current, on a second start after an upgrade.
  - **Oracles:** every doc's content and `ts` from Atelier GET, the compiled marker, and the server's stderr.
  - Rationale: AC 42.2.5, DW-508, DW-518.
- `README.md`; `packages/shared/README.md`; `tool_support.md`; `CHANGELOG.md`; `.changeset/story-42-2-bootstrap-downgrade-guard.md` (`"@iris-mcp/shared": minor`); `packages/iris-mcp-all/src/__tests__/story-42-2-doc-claims.test.ts` (new; its changeset read is guarded):
  - **README:** a new `### Shared Instances: Upgrade Every Client Together` after `:1016`. A server built before this release still redeploys its own classes over a newer deployment, so every client sharing an instance is upgraded together. It also gives the marker ordering and both remedies.
  - Correct the shared README and `tool_support.md` claims.
  - **CHANGELOG:** a Story 42.2 section with the line ``BOOTSTRAP_VERSION` moves from `d51856f74d6a` to `<new>`` and `### Changed (AD-14)`.
  - Rationale: AC 42.2.4, Rule #43.

**Acceptance Criteria:**
- **AC 42.2.1:** Given the baseline `bootstrap.ts`, when the new `bootstrap-version.test.ts` and `bootstrap.test.ts` newer-row tests run against an equality-only probe, then they fail. The spec's Design Notes cite `bootstrap.ts:161,177` as the root cause.
- **AC 42.2.2:** Given a deployed marker that classifies as newer or foreign, when a built server bootstraps, then it sends no PUT and no compile, and logs exactly one warning naming both markers and the remedy.
- **AC 42.2.3:**
  - Given a class edit, or a `packages/shared/package.json` version bump, without regeneration, when the shared suite runs, then the drift test fails.
  - Given `pnpm gen:bootstrap` rerun with no class change, then neither the embed nor the state file changes.
  - Given this story's diff, when the `bootstrap.test.ts` roster and order tests run, then they pass unchanged: 35 classes, Dispatch last.
- **AC 42.2.4:** Given the README, when `story-42-2-doc-claims.test.ts` runs, then the shared-instance section says pre-fix servers still downgrade and that every client is upgraded together.
- **AC 42.2.5 (amended at the spec gate, decision #49):** this story WRITES the throwaway gate and `scripts/throwaway-iris.mjs` but never runs docker on this machine (`.claude/rules/iris-objectscript-basics.md:167` forbids docker commands, and that file is the Lead's to change). Its live execution is Story 42.3's CI throwaway job (DW-672). Here:
  - a hermetic orchestration test drives the real probe and deploy code against a fake Atelier listener: every newer, foreign and DW-518 case issues zero PUTs and zero compiles and logs one warning naming both markers; the older and legacy cases redeploy every class; the equal case does nothing;
  - with the probe reverted to equality and shared rebuilt, the hermetic newer and foreign cases go red;
  - `throwaway-iris.mjs`'s pure helpers (validation, argv, refusals of port 52773/1972, the `iris-community-edition` name and floating tags) are unit-tested without docker; `node --check` passes on the script;
  - when CI runs `pnpm live:bootstrap-guard` (Story 42.3), every newer, foreign and DW-518 leg leaves every doc's content, `ts` and the compiled marker byte-identical, and the older and legacy legs end with every doc equal to the embed.
- **DW-627:** Given no `IRIS_REQUIRE_LIVE` (with or without `IRIS_HOST`), when `pnpm --filter @iris-mcp/all test` runs on a host where localhost:52773 answers, then `live-arming-guard.test.ts` passes with an empty connect log. Given one family-C gate reverted to inline defaults with no arming, then (a) and (b) both fail.
- **DW-518:** Given a newer deployment on the target, when the epic37 shape's first `other` call bootstraps lazily, then nothing is redeployed. The gate's header records its write footprint.
- **Shared instance:** Given each stage's end, when `SELECT ExecuteMCPv2.Setup_GetBootstrapVersion()` runs read-only in HSCUSTOM, then it returns `d51856f74d6a`. The one exception is when the lead has run the upgrade in Orchestrator decision 4, or a restart of the session's own MCP servers did it; record which.

## Spec Change Log

## Review Triage Log

## Design Notes

**Governing ADs (Rule 6):**
- **AD-14** (embed, generator, rosters, Downgrades, the [ASSUMPTION] marker bullets);
- **AD-15** (startup-path back-compat: unchanged paths are pinned by the existing fetch-count tests, and the frozen handler golden, `current` only, stays byte-unchanged);
- **AD-33** (newer classes left in place must serve older `@1` clients; no route changes here);
- **AD-29** (nothing publishes before this lands; patch/minor only);
- **AD-2** (cross-package checks in `iris-mcp-all`; the extension self-contained);
- **AD-1** (IRIS is reached only over the web port; the harness's `docker exec` is container setup, not a server path);
- **Conventions:** Live gates, Live testing on a shared instance, Probes, Frozen goldens, Turbo test tasks.

**Root cause (AC 42.2.1, confirmed):** `probeCustomRest` returns `stale` for every deployed value except the exact embed (`bootstrap.ts:161,177`). `bootstrap()` then PUTs and compiles all 35 classes with `ignoreConflict=1` (`:244-271`, `:517-551`), so an older build overwrites a newer one.

**Why no disposable namespace on the shared instance (evidence):**
- `iris_mapping_list %ALL package` returns `ExecuteMCPv2 → HSCUSTOM`. The bootstrap's own `ConfigureMapping` creates it, and `interop-namespace-fixture.ts` relies on it.
- The IRIS docs (GSA_config_namespace_addmap, fetched 2026-10-21) say: "%ALL mappings override any namespace-specific mappings to the same resource", and "You cannot create namespace-specific mappings to resources that are mapped in the %ALL namespace".
- So an Atelier PUT or compile of `ExecuteMCPv2.*` into any scratch namespace lands in HSCUSTOM's database.
- In addition, the `missing` path's `Setup_Configure(<ns>)` would repoint the shared `/api/executemcp/v2` web app (currently `NameSpace` HSCUSTOM).

**Marker ordering (recommended in decision 2):**
- semver first, then the sequence;
- equal semver and sequence with a different hash is foreign;
- a legacy bare hash is older, because every build that stamps one predates the fix. This keeps the git-clone beta's upgrade path;
- `dev` and unparseable values are foreign, as in the spine;
- a version bump with no class change keeps the hash and the sequence, so it orders as older and upgrades.
- The marker is at most about 30 characters, inside the `%String` SQL-proc default of 50.

**Rule 2 (extend, don't copy):**
- `resolveLiveTarget` generalizes 41.8's `liveSkipReason`. 41.8's gate keeps its stricter arming, and its guard (`:298-324`) still holds.
- `irisTargetFromEnv` and `getIntegrationConfig` delegate to it.
- The 42.2 gate reuses `process-gate-helpers.ts` (spawn, `atelierQuery`, doc GET, `shippedBootstrapVersion`).
- The preload follows `hide-changesets-preload.mjs`.
- The launcher's arming copy is justified by AD-2.
- The comparator is new: `atelier.ts:231-237` `parseVersionString` reads only the major number, and no semver dependency exists.

**Integration ACs:** the matrix rows "Live: newer" and "Live: DW-518" (the built `iris-dev-mcp` consumes `bootstrap()` and the comparator, and the observable effect is unchanged classes plus a stderr warning), and the "Unarmed" row (every live gate consumes `resolveLiveTarget`; the effect is zero connections).
- **Consumed-by:**
  - 42.3 (CI runs the rosters armed with all five `IRIS_*`, runs `live:bootstrap-guard`, and extends `throwaway-iris.mjs`);
  - 42.4 (the marker grammar, the ordering table and `module.xml` from the stamped output; adds IPM ownership and the IRIS-side check);
  - 42.5 (its `version` script reruns `gen:bootstrap` after `changeset version`; the drift test enforces it);
  - 42.6 (publishes only after this lands; must export the five `IRIS_*`).
- **Consumes:** the AD-14 generator, `process-gate-helpers.ts`, and the 41.8 opt-in shape.

**DW-518 write footprint:** `epic37-default-outage-gate`'s legs (`iris_server_info`, `iris_license_info`) only read. Its one write is the first-touch bootstrap of `other`:
- `current`, `newer`, `foreign`: nothing;
- `stale`: PUT 35 classes and compile them, plus `Setup_Configure` and `Setup_ConfigureMapping` if the web app is absent, then `^UnitTestRoot`;
- `missing`: PUT, compile, Configure, the `%ALL` mapping and `^UnitTestRoot`.

**Ledger inbox:**
- **DW-508:** addressed by the bootstrap, generator and comparator tasks and AC 42.2.1–42.2.5.
- **DW-518:** addressed by the epic37 header task, the live gate's lazy-profile leg and the DW-518 AC.
- **DW-627:** addressed by the `live-target.ts`, 63-file, guard and preload tasks and the DW-627 AC, including the 42.11 and 43.1 occurrences (families C and D).

**AC reinterpretations:**
- **AC 42.2.5's "disposable namespace"** becomes the `USER` namespace of a disposable container (evidence above).
- **AC 42.2.2's "monotonic sequence plus the hash"** becomes `<semver>+<sequence>.<hash>`: the AC's sequence plus the spine's semver.
- **AC 42.2.3:** no class is added, so the rosters stay unchanged; the generator gains a state file.
- **DW-627's "an IRIS_HOST the caller set"** arms the gates, and an armed gate then requires all five variables (fail closed, Rule 13).

**Decided at the spec gate (2026-10-21; these override the plan text below where they differ):**
- **#49, isolation: NOT (A) as planned.** No stage runs any `docker` command on this machine: `.claude/rules/iris-objectscript-basics.md:167` forbids docker commands, and agent rule files are the Lead's to change (the plan's rule draft goes to the Lead as information only). This story still WRITES `scripts/throwaway-iris.mjs` and the throwaway gate exactly as planned; it proves the guard with a hermetic orchestration test against a fake Atelier listener (amended AC 42.2.5), and Story 42.3's CI runs the gate live (DW-672, routed to 42.3). Spine Live testing convention amended.
- **#50, marker:** `<semver>+<sequence>.<hash>` as recommended; AD-14 amended (Format, Ordering, Concurrency confirmed; Ownership and IPM upgrades stay [ASSUMPTION] for 42.4).
- **#51, arming: stricter than planned.** Only `IRIS_REQUIRE_LIVE` (`1`/`true`) arms a live leg; a set `IRIS_HOST` does NOT, because users export it to run the servers and the pipeline runs every suite with a closed-port `IRIS_HOST`. Armed, all five `IRIS_*` are required (fail closed); `IRIS_TEST_*` is retired. The matrix rows, the `resolveLiveTarget` rule, the helper unit table and the DW-627 AC above are amended to match; spine Live gates convention amended.
- **#52, HSCUSTOM upgrade:** at the lead's post-commit smoke, by a built 42.2 server process's first touch (the session's MCP servers are not restarted). No plan, implement, QA or review stage writes HSCUSTOM.
- **#53, AD-14 Ownership and IPM upgrades:** Story 42.4, through a `DW-n:` bullet at harvest.
- AD-15 gets a Story 42.2 bullet (written by the lead).

**Orchestrator decisions needed (as planned):**
1. Orchestrator decision needed: how is AC 42.2.5's live check isolated, given that no namespace on the shared instance can be? — recommended: (A) a story-owned throwaway `iris-community:2026.2` container, because the `%ALL` mapping overrides any namespace mapping (evidence above). The image is local and pinned by digest, the port is dynamic, the container is labelled and always removed, and HSCUSTOM is never touched.
   - Other options:
     - (B) a package-renamed embed in a scratch namespace (not the real surface, and it needs a test seam in production code);
     - (C) move the live leg to Story 42.3's CI throwaway (narrows a HIGH's AC, Rule #48);
     - (D) seed and restore HSCUSTOM (forbidden).
   - (A) requires amending `.claude/rules/iris-objectscript-basics.md:167` ("IRIS is NOT running in Docker - do not use docker commands"). The rule is stale: the shared instance is the container `iris-community-edition`. Draft: "The shared IRIS (container `iris-community-edition`, localhost:52773) is never stopped, restarted, reconfigured or exec'd into, through docker or otherwise. Docker is used only by `scripts/throwaway-iris.mjs`, to start and remove throwaway containers it created."
2. Orchestrator decision needed: what is the bootstrap marker format? — recommended: `<semver>+<sequence>.<hash>` over the spine's [ASSUMPTION] `<semver>+<hash>`, because it satisfies AC 42.2.2 literally and keeps today's per-story upgrade working. With semver only, every dev build between releases has the same semver, so the next bootstrapped-class story's build sees HSCUSTOM as foreign and never redeploys it. The 25+ armed gates' `assertDeployedBootstrapVersion` would then fail on every such story, and the per-story upgrade that happens today would need a manual `ExecuteMCPv2.Setup` delete. A sequence alone could not name a release in the warning.
   - Draft AD-14 amendment (Rule 20):
     - **Format.** "`<semver of @iris-mcp/shared>+<sequence>.<content hash>`, stamped at generation; the sequence lives in `scripts/bootstrap-sequence.json` and rises by one whenever the hash changes."
     - **Ordering.** "semver, then sequence; equal both with a different hash, `dev`, or an unparseable marker is foreign; a bare 12-hex marker (a pre-42.2 build) is older."
     - **Concurrency.** "Re-checks the marker immediately before each compile."
     - Remove [ASSUMPTION] from Format, Ordering and Concurrency; keep it on Ownership and IPM upgrades (Story 42.4).
   - Also draft an AD-15 sanctioned-list entry: "Story 42.2: the bootstrap no longer redeploys over a newer or foreign deployment, including `dev`, which it used to overwrite (AD-14 Downgrades)."
3. Orchestrator decision needed: how does an armed gate resolve its target? — recommended: armed by `IRIS_REQUIRE_LIVE` or `IRIS_HOST`; once armed, all five variables are required; `IRIS_TEST_*` is retired. This is because Rule 13 forbids a silent default target, the env rules already arm with all five, and eight gates read `IRIS_TEST_*` but ignore `IRIS_*` (DW-627's 43.1 occurrence).
   - Draft Live-gates convention: "A live leg runs only when armed (`IRIS_REQUIRE_LIVE` 1/true, or a caller-set `IRIS_HOST`). Armed, its target is the five `IRIS_*` variables, all required, never a default. Unarmed, it makes no request. Targets resolve through `@iris-mcp/shared/test-helpers/live-target`, and a scan refuses inline defaults. The throwaway gate arms on `IRIS_THROWAWAY` and is off the rosters."
   - Draft Live-testing convention, appended: "A check that deploys the `ExecuteMCPv2` package cannot be isolated in a namespace of the shared instance (the `%ALL` mapping wins); it runs in a throwaway container."
4. Orchestrator decision needed: when is HSCUSTOM upgraded to the 42.2 marker? — recommended: at the lead's post-commit smoke, because the session's own MCP servers would otherwise upgrade it whenever they happen to restart. The first touch by any 42.2-built server (`d51856f74d6a` is legacy, so older) upgrades it. That includes this session's own MCP servers, which run `/Users/jbrandt/git/iris-execute-mcp-v2/packages/*/dist/index.js`, if they restart after a rebuild. Afterwards, any pre-42.2 build that still runs (another worktree) downgrades it again, which is the AC 42.2.4 residual. Recommended: the lead upgrades it deliberately at the post-commit smoke, by restarting the session's servers; no plan, implement, QA or review stage touches it.
5. Orchestrator decision needed: who implements AD-14's Ownership and IPM-upgrade bullets? — recommended: Story 42.4, through a `DW-n:` bullet (`deferred:` item 1), because IPM packaging lands there and a branch for it here would be unreachable (Rule #54). Today neither story's ACs name them.

## Verification

Run every command from `/Users/jbrandt/git/iris-execute-mcp-v2`, with `timeout: 600000`, in the foreground, one per call.
- Rebuild after source edits: `pnpm --filter @iris-mcp/shared build`, then `pnpm --filter "./packages/*" build` before any gate that uses dists.
- **`UNARMED`** is the prefix `env -u IRIS_HOST -u IRIS_PORT -u IRIS_USERNAME -u IRIS_PASSWORD -u IRIS_NAMESPACE -u IRIS_REQUIRE_LIVE -u IRIS_TEST_HOST -u IRIS_TEST_PORT -u IRIS_THROWAWAY`.

**Commands:**
- `(loop)` `pnpm gen:bootstrap` after any `.cls` edit -- expected: prints the new marker; record `BOOTSTRAP_VERSION` `d51856f74d6a` → `0.0.2+1.<hash>` here. A second run reports "Unchanged".
- `(loop)` `UNARMED pnpm --filter @iris-mcp/shared exec vitest run src/__tests__/bootstrap.test.ts src/__tests__/bootstrap-version.test.ts src/__tests__/gen-bootstrap-write.test.ts` -- expected: green.
- `(loop)` `UNARMED pnpm --filter @iris-mcp/all exec vitest run src/__tests__/live-arming-guard.test.ts src/__tests__/live-gate-roster.test.ts src/__tests__/gate-helper-copies.test.ts src/__tests__/changelog-bootstrap-move.test.ts src/__tests__/bootstrap-version-check.test.ts src/__tests__/throwaway-iris.test.ts src/__tests__/story-42-2-doc-claims.test.ts src/__tests__/story-41-8-qa-gate-guard.test.ts src/__tests__/epic38-gate-guards.test.ts src/__tests__/story-39-1-gate-guards.test.ts` -- expected: green, and the connect log empty.
- NOT RUN HERE (spec gate, decision #49): `pnpm live:bootstrap-guard`. No stage of this story runs any `docker` command. Run instead `(loop)` `node --check scripts/throwaway-iris.mjs` and the hermetic orchestration test above; the gate's live run is Story 42.3's CI (DW-672).
- `(loop)` `npm --prefix /Users/jbrandt/git/iris-execute-mcp-v2/extensions/iris-mcp-launcher test` -- expected: green except the 5 baseline macOS failures recorded in Story 42.1; the new guard passes.
- `(once)` `UNARMED pnpm --filter <pkg> test` for each of `@iris-mcp/shared`, `dev`, `admin`, `interop`, `ops`, `data`, `client-config` and `all` (split `all` by file globs if it would pass 10 minutes) -- expected: green, with no IRIS touched.
- `(once)` `pnpm --filter <pkg> type-check` and `pnpm --filter <pkg> lint` for the 7 TypeScript packages -- expected: green.
- `(once)` `pnpm gen:governance-baseline:check`, `pnpm gen:tools-list-snapshot:check`, `pnpm gen:pack:check`, `pnpm gen:skills:check`, `pnpm check:provenance`, `pnpm validate:prompts` -- expected: clean (the baseline is `1e62c5ad5bf7`/141).
- `(once)` Read-only HSCUSTOM probe, before and after each stage: `SELECT ExecuteMCPv2.Setup_GetBootstrapVersion()` (`server:"default"`, `namespace:"HSCUSTOM"`) -- expected: `d51856f74d6a` both times.

**Mutations to apply and record** (`mutation: <change> → <red test>`; apply to the real file, observe red on the guarded path, restore, check that `git status --short` is unchanged; rebuild shared around each dist-path mutation):
- **AC 42.2.1 / 42.2.2:** `classifyDeployedMarker` returns `older` for every mismatch → the `bootstrap-version.test.ts` newer and foreign rows, and the `bootstrap.test.ts` newer orchestration test.
- **AC 42.2.3:** `packages/shared/package.json` version `0.0.2` → `0.0.3` without regenerating → the drift check. Also: one Setup.cls comment character edited without regenerating → the drift check.
- **AC 42.2.4:** delete the README "upgrade every client together" sentence → `story-42-2-doc-claims.test.ts`.
- **AC 42.2.5:** the probe reverted to `deployed === BOOTSTRAP_VERSION ? current : stale` (shared rebuilt) → the hermetic orchestration test's newer, foreign and DW-518 cases (fake Atelier; the throwaway gate's legs go red in Story 42.3's CI). Separately: the comparator returns `newer` for older → the older and legacy cases.
- **DW-627:** `doc-type-description-live-gate.test.ts` back to inline `?? "localhost"` with no arming → `live-arming-guard.test.ts` (a) and (b). The connect log names `52773`, and the preload refused it. Also: `resolveLiveTarget` treats an empty env as armed → (d).

**Shared surfaces:**
- the `ProbeResult` / `BootstrapResult` unions;
- the `BOOTSTRAP_VERSION` format and every regex that reads it (the Code Map list);
- the bootstrap fetch-count pins;
- the `assertDeployedBootstrapVersion` message;
- the arming of all 63 live files and the four arming-meta tests;
- the `live-gate-roster` exemption list;
- the shared in-repo `exports` (`./test-helpers/live-target`; `publishConfig.exports` unchanged);
- `.changeset/` (the new file is read by guarded readers);
- the `CHANGELOG.md` top section.

The bootstrap rosters, `tools-list-snapshot.json`, the SDK goldens and the governance baseline must stay unchanged.

**Standing criterion:** every test added or changed passes on a fresh environment, in either order. The throwaway gate creates and removes its own container. No test depends on another test's leftovers.

**IRIS:** nothing in this story writes to the shared instance, so no `ExecuteMCPv2.Temp.*` fixture and no OS `%UnitTest` class runs there. ObjectScript changes are comments only, compiled only inside the throwaway container by the live check.

## Auto Run Result

Status: ready-for-dev
Blocking condition: none
