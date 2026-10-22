---
title: 'Story 42.4: IPM Package Revival'
type: 'feature'
created: '2026-10-22'
status: 'done'
baseline_revision: 'b37cec5d1d509f30ac22f570e92fd738bf9ef703'
baseline_commit: 'b37cec5d1d509f30ac22f570e92fd738bf9ef703'
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
      The public IPM registry is fed only through Open Exchange, which reads `module.xml` from the ROOT of a GitHub repository.
      That collides with AD-14 ("IPM archives are built from the generator's stamped output, never from `src/`") and with the
      manifest living at `ipm/module.xml`: an Open Exchange build of this repository would package `src/` (Setup's `dev`
      placeholder) or find no manifest. Story 42.5 (registry publish) and 42.8 (Open Exchange listing) must choose the route.
    evidence: >-
      Plan 2026-10-22 research: docs.openexchange.intersystems.com/apps/ipm/ ("Open exchange is the only place to publish
      applications to the public IPM registry"; tick "Publish in Package manager"; keep module.xml "in the root of your project
      in GitHub"). Options for 42.5/42.8: a committed stamped module tree at the root of a release branch or a dedicated repository,
      or a direct registry publish if one exists for this registry. The CI archive of this story is the artifact either route can reuse.
    location: 'Story 42.5 (release workflow, AC 42.5.3); Story 42.8 (Open Exchange); AD-14 IPM manifest bullet'
    severity: medium
  - summary: >-
      `zpm "uninstall iris-execute-mcp-v2"` removes the classes but leaves the `/api/executemcp/v2` web application and the `%ALL`
      package mapping, because the manifest configures them through `<Invoke>` methods that have no Unconfigure counterpart
      (`ExecuteMCPv2.Setup.Uninstall()` exists but nothing calls it). Not an AC of this story.
    evidence: >-
      Plan 2026-10-22: IPM 0.10.5 removes a `<WebApplication>` element's app on Unconfigure, but nothing a Configure-phase Invoke
      created (research of `%IPM.Lifecycle.*`, IPM v0.10.10 source). The manifest keeps the Invoke because AD-31 binds IPM Configure
      to `Setup.Configure` (no application roles, no MatchRoles).
    location: 'scripts/gen-bootstrap.mjs (module.xml Invokes); src/ExecuteMCPv2/Setup.cls Uninstall'
    severity: low
---

<intent-contract>

## Intent

**Problem:** IRIS administrators have no working IPM route, and nothing proves one would work:
- `ipm/module.xml` is a stale hand-written `0.1.0` manifest. It lists 13 of today's 35 classes plus test classes. It is not generated and has never been installed or tested.
- The bootstrap's `zpm "install iris-execute-mcp-v2"` fallback is inaccurate.
- AD-14's Ownership and IPM-upgrade bullets are unbuilt (DW-674):
  - bootstrap would redeploy over classes that IPM installed;
  - an IPM install can downgrade a newer deployment. IPM's own version check ignores the marker's `+<sequence>.<hash>` part and never sees a bootstrap deployment.
- CI's oldest-image leg goes red on 2026-11-13, when the `2025.3` Community license key expires (DW-686).

**Approach:**
- **Manifest.** Generate `ipm/module.xml` from `gen-bootstrap.mjs` `classes[]`, plus one IPM-only, preloaded `ExecuteMCPv2.InstallGuard`. The guard runs Story 42.2's marker ordering inside IRIS before IPM reloads anything.
- **Offline proof.** A new `ipm` CI job builds the archive from the stamped embed on a `--network none` throwaway, then installs it on fresh `--network none` throwaways of both editions.
- **Ownership.** Bootstrap treats the guard's presence as IPM ownership: it writes nothing and warns once, naming the `zpm` command.
- **Fallback text.** Correct the `zpm` fallback message.
- **CI image.** Move the oldest CI leg to `2026.1`.

## Boundaries & Constraints

**Always:**
- **The shared IRIS.** The shared IRIS (localhost:52773, HSCUSTOM, marker `0.0.2+1.995fbbb1055d`) gets one read-only marker probe and nothing else. No stage runs a 42.4-built server, an armed suite or an IPM verb against it; the lead's smoke does the normal per-story upgrade.
- **Throwaways.**
  - Every container is started, inspected, entered and removed only through `scripts/throwaway-iris.mjs`. No new script builds a docker argv of its own.
  - Every container a script starts is removed on every exit path, signals included.
  - Throwaways run `--network none` wherever the AC says so.
- **Generated outputs.** They change only through `pnpm gen:bootstrap` (Rules #18 and #24): `packages/shared/src/bootstrap-classes.ts`, `scripts/bootstrap-sequence.json` and `ipm/module.xml`. `BOOTSTRAP_VERSION` moves from `0.0.2+1.995fbbb1055d` to `0.0.2+2.<hash>`, and the implement stage records the hash.
- **The archive** is staged from the generated embed (`BOOTSTRAP_CLASSES`, `IPM_INSTALL_GUARD`), never from `src/` (AD-14).
- **Name and version.** The module name `iris-execute-mcp-v2` is declared once, in the generator. The module `<Version>` equals the `packages/shared/package.json` version, which equals the marker's semver.
- **Byte-identical behavior.**
  - `parseCli(["run", …])`, the root `live:bootstrap-guard` script and every `prepublishOnly` stay byte-identical.
  - With no `ExecuteMCPv2.InstallGuard` on the instance, every `BootstrapResult` is deep-equal to today's: no new key. The only difference is the ownership request on a write path.
- **Repo conventions.**
  - Rule 14: non-ASCII in code and JSON is written as escapes.
  - Rule #55: no heredoc writes.
  - Changesets are `patch`.
  - ObjectScript rules: `$$$` macros, no argumented `Quit` inside Try/Catch, no `$Get()` around a method call, error text in the form `<what happened>. <what to do>.`

**Never:**
- **No publishing or registry verb.** The only IPM verbs any script issues are `load`, `package` and `list`, never `publish`, `install`, `repo`, `enable` or `update` (AC 42.4.4). No `npm publish`, `pnpm publish`, `changeset version`/`publish`, `git tag`, `secrets.` or upload-artifact step.
- **No change to `classes[]`.** No new bootstrapped class: the guard is IPM-only, is not in `BOOTSTRAP_CLASSES`, and bootstrap never deploys it.
- **No `-dev` install on an install container.** A refused developer-mode load keeps IPM's record at the refused version (probe Q3c).
- **No `<WebApplication>` element, application roles or `MatchRoles`** (AD-31). Configure stays `ExecuteMCPv2.Setup.Configure`.
- **No change to protected surfaces:** the tool surface, REST routes, governance baseline `1e62c5ad5bf7`/141, frozen goldens, `tools-list-snapshot.json`, the warning text of the newer, foreign and unknown cases, or `irislib/`/`irissys/`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Generate | `pnpm gen:bootstrap` on a clean tree | `ipm/module.xml`, the embed and the sequence state are unchanged (not rewritten). The second run prints "Unchanged" for both outputs | — |
| Drift (AC 42.4.1) | `ipm/module.xml` hand-edited; or `classes[]`, the shared version or the guard changed without a regeneration | The default suite goes red, naming the file and `pnpm gen:bootstrap` | red |
| Build (AC 42.4.2) | Embed staged on a fresh `iris-community:2026.2` `--network none` container in `USER` (IPM imported from `/usr/irissys/dist/install/misc/zpm.xml`) | `load -dev` then `package` leave exactly one `.tgz` holding `module.xml`, 35 `src/cls/ExecuteMCPv2/**.cls` members equal to the embed, `preload/src/cls/ExecuteMCPv2/InstallGuard.cls`, and no `Tests`/`QAFixtures` member. The archive's manifest declares what `ipm/module.xml` declares | exit 1 naming the phase |
| Offline install (AC 42.4.2) | The archive on a fresh `--network none` `iris-community:2026.2` (`USER`) and a fresh `irishealth-community:2026.2` (`HSCUSTOM`) | Every check below holds | exit 1 naming the edition and the check |
| ↳ nothing fetched | | Both containers inspect as `NetworkMode: none`. `%IPM_Repo.Definition` holds 0 rows after the IPM import and after every installing verb | |
| ↳ compiled | | `load <archive>` succeeds and `list` names `iris-execute-mcp-v2 <version>`. Exactly 36 `ExecuteMCPv2.*` classes are compiled and up-to-date (the 35 of `classes[]` plus the guard; counted from `%Dictionary.CompiledClass` with `GeneratedBy` empty and `$System.OBJ.IsUpToDate`), none of them `Tests`/`QAFixtures`. `GetBootstrapVersion()` equals `BOOTSTRAP_VERSION` | |
| ↳ REST app | | `/api/executemcp/v2` has the install namespace, `ExecuteMCPv2.REST.Dispatch`, `Enabled=1` and empty `MatchRoles`. `%ALL` maps `ExecuteMCPv2`. An in-container GET of `/api/executemcp/v2/config/namespace` answers 200 | |
| Guard: newer (DW-674) | Community install container; a synthetic compiled `ExecuteMCPv2.Setup` with marker `<semver>+<seq+1>.<hash>` | `load <archive>` fails with the guard's text naming both markers. Setup's marker is unchanged, `list` has no module, and the repository count is 0 | expected refusal |
| Guard: foreign / unknown | Synthetic Setup with `dev`; Setup defined with no `BOOTSTRAPVERSION` | Refused the same way | expected refusal |
| Guard: older | Synthetic Setup with `<semver>+<seq-1>.<hash>` | The install succeeds and the marker becomes `BOOTSTRAP_VERSION` | — |
| Guard: absent | Fresh health container (no Setup) | The install succeeds | — |
| Parity (DW-674) | Every case of the shared case table, run through `##class(ExecuteMCPv2.InstallGuard).Classify(d, e)` in each install container | Each result equals `classifyDeployedMarker(d, e)` from the shared dist | exit 1 listing every mismatch |
| Bootstrap, IPM-owned (DW-674) | The guard document answers 200 and the probe is `stale`, `unconfigured` or `missing`, at startup or on the re-check before compile | At startup: no PUT, compile, Configure, mapping or `^UnitTestRoot`. On the re-check before compile *(amended by the lead after implement, 2026-10-22: the PUTs of `stale` and `missing` precede the re-check, so "no PUT" cannot hold there)*: nothing further is written (no compile, Configure, mapping or `^UnitTestRoot`); documents already uploaded stay. One `[WARN]` "Bootstrap: leaving the ExecuteMCPv2 classes in '<ns>' on <host>:<port> alone: …" naming "installed by IPM", the deployed marker (or absent), this build's marker, `zpm "install iris-execute-mcp-v2 <semver>"` and the `zpm "uninstall …"` hand-back. Result: `ipmOwned: true`, `probeFound: true`, every step flag false | — |
| Bootstrap, not IPM-owned | The guard document answers 404 | The result is deep-equal to today's (no `ipmOwned` key) | — |
| Bootstrap, ownership unread | The guard GET fails another way (5xx, timeout) | No write. `probeStatus: "unknown"` with `readFailure` naming it, and one warning (decision #54) | — |
| Bootstrap, current / newer / foreign / unknown | As today | Unchanged; no ownership request | — |
| Harness `up --network none` | `--image`, `--namespace`, `--network none`, optional `--mount <hostDir>:/opt/iris-mcp/<name>`, `--state` | `docker run -d --network none` (read-only `-v` when mounted), no `-p`. Readiness is the session loop plus the unexpire step, with no web poll. State is `{name, id, image, namespace, network: "none", mount?}` with mode 0600 | `--host-port` with `--network none`, a bad mount or a symlinked host directory → exit 2 |
| Harness `session` / `cp` | `session --state --namespace --script <file>`; `cp --state --from /tmp/iris-mcp-<…> --to <hostPath>` | Each re-inspects first (name, label, running, NetworkMode or port). `session` pipes the script into `iris session iris -U <NS>` and prints its output; `cp` copies out | an unlabelled or wrong container → exit 2. `exec` on a `--network none` state → exit 2 (no port) |
| Fallback text (AC 42.4.3) | Configure fails during bootstrap | `manualInstructions` item 3 names `zpm "install iris-execute-mcp-v2 <semver of BOOTSTRAP_VERSION>"` in the target namespace, as a `%Admin_Manage` user with IPM 0.10+ there, and `zpm "repo -r -n registry -reset-defaults"` when no registry is configured. The name and version equal `ipm/module.xml`'s | — |
| Oldest leg (DW-686) | `bootstrap-guard-oldest` | Runs on `iris-community:2026.1@sha256:c57b65b2…7c2` and passes every leg (the IPM-owned leg included) | red |

</intent-contract>

## Code Map

**The generator and its outputs**
- `scripts/gen-bootstrap.mjs` -- the one generator.
  - `classes[]` `:14-50` (35 entries; `bootstrapRoster()` regex-parses this literal, so it stays a literal and the guard is declared OUTSIDE it).
  - LF + `trimEnd` read `:82-85`; hash `:92-97`; marker `:108-146`.
  - The placeholder stamp is Setup-only today (`:151-165`), and `bootstrap-classes.ts` is emitted at `:169-234`.
  - Write-if-changed at `:236-254`. `ipm/module.xml` must follow the same rule: the dist freshness check is mtime-based (DW-591).
- `packages/shared/src/bootstrap-classes.ts` -- generated, with `BOOTSTRAP_VERSION` at `:29`; never hand-edited. `scripts/bootstrap-sequence.json` is `{"sequence": 1, "hash": "995fbbb1055d"}`.
- `ipm/module.xml` -- today a hand-written `0.1.0` manifest (13 classes plus Tests). It becomes output-only.
- `src/ExecuteMCPv2/Setup.cls` -- unchanged. These are the members the guard and the proof read:
  - `BOOTSTRAPVERSION` `:34` (`"dev"` on disk);
  - `Configure(pNamespace="")` `:44` (defaults to `$NAMESPACE`; no MatchRoles);
  - `ConfigureMapping` `:130`;
  - `GetBootstrapVersion()` `:226`.

**Bootstrap (TypeScript)**
- `packages/shared/src/bootstrap.ts`:
  - `MANUAL_INSTRUCTIONS` `:114-131`, with item 3 at `:130-131` (AC 42.4.3; the epic's `:95-96` is stale). It is used at `:484` via `.replace("NAMESPACE", ns)`, first occurrence only.
  - `setupClassAbsence` `:190-205` (404 = positive absence; Rule 2: generalize it to any document).
  - `probeCustomRest` `:257`.
  - `warnDeploymentLeftAlone` `:553-589`: the `LeftAlone` union gains an `ipm` variant.
  - `markerAllowsCompile` `:607-632`: the re-check before compile also re-checks ownership.
  - `bootstrap()` `:669-838`: the write paths are the unconfigured branch `:730`, the stale/missing branch `:756`, and the privileged steps.
- `packages/shared/src/bootstrap-version.ts` -- `parseBootstrapMarker`/`classifyDeployedMarker`, the oracle of the parity check. Unchanged. It uses ASCII `\d` (JS), BigInt ordering, and treats leading zeros as meaningless.
- `packages/shared/src/server-base.ts:2905,3161` -- `manualInstructions` is logged only; `BootstrapResult` is on no tool wire (exported type, `index.ts:129`).

**Tests that pin these**
- `packages/shared/src/__tests__/bootstrap.test.ts`:
  - `MANUAL_INSTRUCTIONS` `:1664-1673`; Configure-fails cases `:815-863` and `:1084-1163`;
  - the 35-class roster `:1677+`;
  - drift check `:1915-2050` (`classPaths` and the hash formula: the guard joins both);
  - the fetch-sequence cases of every write path, which change with the ownership GET.
- `packages/shared/src/__tests__/gen-bootstrap-write.test.ts` -- scratch-copy runs of the generator. The copy must now include `ipm/`. `:190` is the "checked-in embed equals generator output" drift case; the manifest joins it.
- `packages/shared/src/__tests__/bootstrap-version.test.ts` -- it pins literal markers (`EMBEDDED` `:9`), so it is unaffected by the move.
- `packages/iris-mcp-all/src/__tests__/changelog-bootstrap-move.test.ts` -- the newest CHANGELOG section that names a move must end at the embed's marker. `story-42-2-doc-claims.test.ts:79-80` holds history literals and stays true.
- `packages/iris-mcp-all/src/__tests__/bootstrap-guard-legs.ts` -- `LEGS` `:357-367`, `REMEDY` `:300-304`, `leavingLines` `:295`. It is shared by the hermetic `story-42-2-bootstrap-guard-orchestration.test.ts` (fake Atelier, `stateful-fake-atelier.ts:320-323`: GET doc → 404 when missing) and by the live `story-42-2-bootstrap-guard-live-gate.test.ts`, which the CI `bootstrap-guard`/`bootstrap-guard-oldest` suites run.

**Harness and CI**
- `scripts/throwaway-iris.mjs`:
  - Images `:69-88`, with `OLDEST_IRIS_COMMUNITY_IMAGE` `:80-81` (DW-686).
  - Builders and parsers: `buildRunArgv` `:222` (always `-p` today); `buildSessionArgv` `:253` (`-U %SYS` only); `parseCli` `:400`.
  - Inspection and state: `inspectProblems` `:496` (always checks a port); `parseState` `:554` (port required).
  - Lifecycle: `startContainer` `:635` (session loop, unexpire, then web poll); `upHarness` `:762`; `loadThrowaway` `:806`; `execHarness` `:847`; `downHarness` `:890`; `defaultDeps` `:913`; `main` `:988`.
- Pins on the harness:
  - `packages/iris-mcp-all/src/__tests__/throwaway-iris.test.ts` (the oldest pin `:99-103`, `parseCli` `:338`);
  - `story-42-3-qa-harness-lifecycle.test.ts` with `fake-docker.ts` (a scripted docker as the only PATH entry);
  - `story-42-2-qa-throwaway-wiring.test.ts`.
- `scripts/lib/ci-checks.mjs`:
  - pins `JOB_TIMEOUT_MINUTES` `:54` and `CI_IMAGES` `:57`;
  - `buildDeclaredSteps` `:295-332` returns `{gates, throwaway, package}`.
- `.github/workflows/ci.yml` -- the three jobs, and the header comment `:1-21` (which names 2025.3).
- `packages/iris-mcp-all/src/__tests__/ci-workflow-check.ts` -- `JOB_KEYS` `:74`; the "only gates runs a matrix" check `:161`; the floor-node loop over `["throwaway","package"]` `:232`; package needs `:293-296`. `ci-workflow.test.ts` holds the README CI section naming each job.
- `scripts/ci-seed-throwaway.mjs:54` `bootstrapRoster()` -- reuse it to read `classes[]`.
- `scripts/lib/script-process.mjs` (`isEntryPoint`, `spawnInherited`) -- reuse it.

**Docs**
- `README.md`:
  - `### 4. Verify` `:327` (the new IPM subsection goes after it);
  - `### Shared Instances: Upgrade Every Client Together` `:1020-1040` (the table gains an IPM row and the remedies gain a bullet; `story-42-2-doc-claims.test.ts` pins the Newer and Foreign rows and the remedy sentences, so keep them);
  - `### Continuous Integration` `:1069-1079` ("three jobs"; 2025.3).
- `CHANGELOG.md` -- the newest section is Story 42.3 at `:5`.

**IPM facts, live probes 2026-10-22.** IPM is 0.10.5 on `iris-community:2026.2` (Build 221U), `irishealth-community:2026.2` and `iris-community:2026.1` (Build 234U). The exported source is at `/private/tmp/claude-501/-Users-jbrandt-git-iris-execute-mcp-v2/03eb9a39-2d9e-4087-85ac-363a9bb86d2a/scratchpad/ipm-probe/ipm-src/`, and the probe logs and modules are in `…/scratchpad/ipm-probe/`.
- **Offline copy and import.**
  - Every image carries `/usr/irissys/dist/install/misc/zpm.xml`. No `%IPM` is present in USER, %SYS or HSCUSTOM; the Health image's HSLIB has a `0.10.5-SNAPSHOT`.
  - `$System.OBJ.Load(<zpm.xml>,"ck")` imports IPM into the current namespace only. Its Python wheels come from inside the kit, and `%IPM_Repo.Definition` stays at 0 rows.
- **Phases.**
  - The new `module.xml` is stored before any phase runs (`%IPM.Utils.Module:LoadNewModule:1054`).
  - The phases are Initialize, Reload, `*`, Validate, Compile and Activate (the last also runs Configure) (`%IPM.Lifecycle.Base:GetCompletePhasesForOne:159`).
- **`<Invoke>`.** `Phase` defaults to Configure and `When` to After. A `%Status` error aborts the phase and the install (`%IPM.Storage.InvokeReference:12,17,24,79`; `%IPM.Storage.Module:ExecutePhases:573-611`).
- **Preload.** A `Preload="true"` file lives under `<root>/preload/<SourcesRoot>/cls/…` and is compiled in Initialize (`%IPM.Lifecycle.Base:%Initialize:560-566`).
  - The working guard is `<Invoke … Phase="Initialize" When="After"/>`. It reads the previously compiled class's parameter; `Initialize/Before` runs the OLD guard, and on a fresh install fails with `<CLASS DOES NOT EXIST>`.
  - Research found that a failed preload compile is swallowed. The Invoke then fails closed on a fresh install.
- **IPM's own downgrade check** refuses a lower module version when an IPM record exists ("Cannot downgrade …", `LoadNewModule:1043-1046`). No flag bypasses it, it ignores build metadata, and it is skipped when no record exists.
- **Rollback.** A non-dev load rolls back on refusal (`:1156-1159`). A plain load over a `-dev` install inherits dev mode and keeps the refused version in the record (`:1104-1115`).
- **`package <m> -path <p>`** writes `<p>.tgz` and re-runs Initialize through Activate. It exports the classes from the namespace; the probe found the members byte-identical to the source.
- **`load <abs>.tgz`** runs the same phases. The probe's 35-class module compiled, configured the web app and the `%ALL` mapping, and answered GET 200 on all three images.
- **Registry and commands.**
  - The registry answers 404 for `iris-execute-mcp-v2`, `iris-mcp` and `iris-execute-mcp` (`pm.community.intersystems.com/packages/<name>`, 2026-10-22).
  - `zpm "repo -r -n registry -reset-defaults"` adds the community registry to the current namespace. `enable -community` also maps IPM to every namespace, so it is not used here.

**Reference:** `../OcuPilot/scripts/ci-ipm-archive.sh`, the Lead's own code: adapt, don't copy. It is the precedent for:
- `--network none` on both containers;
- import from `zpm.xml`;
- the repository-count measurement after every verb;
- reading back exactly one `.tgz`;
- the structural manifest comparison;
- split session markers;
- removing both containers on every exit.

## Tasks & Acceptance

**Execution** (dependency order):
- `ipm/preload/ExecuteMCPv2/InstallGuard.cls` (new, hand-written source) -- class `ExecuteMCPv2.InstallGuard Extends %RegisteredObject`, self-contained (it references no other `ExecuteMCPv2` class and compiles alone in IPM's preload). Its source sits outside `src/`, so a `src/**` load never deploys it (Design Notes).
  - `Parameter BOOTSTRAPVERSION = "dev";` -- the placeholder line, stamped by the generator.
  - `ClassMethod Classify(pDeployed As %String, pEmbedded As %String) As %String` -- an exact port of `classifyDeployedMarker`/`parseBootstrapMarker`. It returns `current|older|newer|foreign`.
    - Use `[0-9]`, never `\d` (ICU `\d` matches non-ASCII digits).
    - Compare numbers as digit strings: strip leading zeros, then compare length, then the string.
    - `deployed = embedded` (string equality) is `current` first.
  - `ClassMethod DeployedState(Output pMarker As %String) As %String` -- returns one of:
    - `absent`: no `%Dictionary.ClassDefinition` row for `ExecuteMCPv2.Setup`;
    - `marker`: compiled, with a non-empty `BOOTSTRAPVERSION`;
    - `unknown`: anything else (defined but not compiled, or no or empty parameter).
  - `ClassMethod Check() As %Status` -- the IPM Invoke target. `absent`, `older` and `current` return `$$$OK`. `newer`, `foreign` and `unknown` return `$$$ERROR($$$GeneralError, <text>)`.
    - The text names the namespace, the deployed marker (or why none was read) and this package's marker, and says nothing was installed.
    - The remedy: for `newer`, install a package at least as new; for `foreign`/`unknown`, delete class `ExecuteMCPv2.Setup` in this namespace to install deliberately.
  - Rationale: DW-674, IPM-upgrade half.
- `scripts/gen-bootstrap.mjs` -- extend it (Rule 2):
  - **(a) The guard input.** Declare `ipmGuard = { name: 'ExecuteMCPv2.InstallGuard.cls', path: 'ipm/preload/ExecuteMCPv2/InstallGuard.cls' }` and `IPM_MODULE_NAME = 'iris-execute-mcp-v2'` outside `classes[]`. Read the guard with the same normalization and hash it after the 35 classes, with the same separator.
  - **(b) Stamping.** Stamp the placeholder into both Setup and the guard, and error naming the file when either lacks it.
  - **(c) The embed.** Emit `export const IPM_MODULE_NAME` and `export const IPM_INSTALL_GUARD: BootstrapClass` (stamped) into `bootstrap-classes.ts`, outside `BOOTSTRAP_CLASSES`.
  - **(d) The manifest.** Emit `ipm/module.xml`, write-if-changed:
    - an XML comment `GENERATED by scripts/gen-bootstrap.mjs … DO NOT EDIT … pnpm gen:bootstrap` that states the counts, computed from `classes.length`;
    - `<Name>`, `<Version>` (the shared semver), a `<Description>` that does not imply InterSystems endorsement (AD-28), `<Keywords>`, `<Packaging>module</Packaging>` and `<SourcesRoot>src</SourcesRoot>`;
    - `<Resource Name="ExecuteMCPv2.InstallGuard.CLS" Preload="true"/>`, then one `<Resource Name="<class>.CLS"/>` per `classes[]` entry in order;
    - `<Invoke Class="ExecuteMCPv2.InstallGuard" Method="Check" Phase="Initialize" When="After"/>`, then `<Invoke Class="ExecuteMCPv2.Setup" Method="Configure"/>` and `<Invoke Class="ExecuteMCPv2.Setup" Method="ConfigureMapping"/>`.
  - Rationale: AC 42.4.1 and DW-674.
- `pnpm gen:bootstrap` -- run it twice. The first run regenerates `bootstrap-classes.ts`, `scripts/bootstrap-sequence.json` (sequence 2) and `ipm/module.xml`; the second must print "Unchanged". Record `BOOTSTRAP_VERSION` from `0.0.2+1.995fbbb1055d` to the new value (Rule #24).
- `packages/shared/src/bootstrap.ts`:
  - **(a) Ownership read.** Generalize `setupClassAbsence` into `documentAbsence(http, config, version, document)` (Rule 2), and add `ipmOwnership(…)`, which reads the guard document `IPM_INSTALL_GUARD.name`: 200 → `ipm`, 404 → `none`, anything else → `unknown` with a reason. It never throws.
  - **(b) Startup check.** In `bootstrap()`, after the `newer`, `foreign`, `unknown` and `current` returns and before any write on the `unconfigured`, `stale` and `missing` paths:
    - `ipm` → set `ipmOwned: true` and `probeFound: true`, log the warning, return;
    - `unknown` → set `probeStatus: "unknown"`, `probeFound: true` and `readFailure`, log the existing unknown warning with that reason, return.
  - **(c) Re-check before compile.** `markerAllowsCompile` re-checks ownership the same way.
  - **(d) The warning.** Add the `ipm` variant of `warnDeploymentLeftAlone`. Its text and remedies are listed in Design Notes.
  - **(e) The fallback text.** Rewrite `MANUAL_INSTRUCTIONS` item 3 (AC 42.4.3). Its text is listed in Design Notes.
  - **(f) The result type.** `BootstrapResult` gains optional `ipmOwned?: boolean`, present only when true.
  - Rationale: DW-674 ownership half, and AC 42.4.3.
- `packages/shared/src/__tests__/fixtures/bootstrap-marker-parity-cases.json` (new) -- `[{deployed, embedded, expected}]`, with at least 40 cases. They cover:
  - each classification in each grammar kind (stamped, legacy, unparseable);
  - every semver part and the sequence, both directions;
  - leading zeros; integers past 2^53 and past 19 digits;
  - `dev`, `""`, surrounding whitespace, a trailing `\n`, uppercase hex, 11/13-hex legacy, a prerelease semver, and Arabic-Indic digits (U+0661 and its neighbours, written in the JSON as backslash-u escapes, never as literal characters; Rule 14);
  - an unparseable or legacy embedded marker.

  Take `expected` from a run of the TS reference (Rule #36), and cite the command in the consuming test's header.
- `packages/shared/src/__tests__/bootstrap-version.test.ts` -- add a table-driven describe over the fixture: the TS output equals `expected` for every case. Add a completeness case: every classification and every parse kind occurs, and so do a >2^53 case and a non-ASCII-digit case.
- `packages/shared/src/__tests__/bootstrap.test.ts`:
  - ownership cases, one per matrix row: IPM-owned at startup for `stale`, `unconfigured` and `missing`; IPM-owned found on the re-check; not owned (deep-equal to today's result, no `ipmOwned` key); ownership unread; and current/newer/foreign/unknown making no ownership request;
  - the AC 42.4.3 text pins, including name and version equal to `ipm/module.xml`'s `<Name>`/`<Version>`;
  - the drift check extended to `IPM_INSTALL_GUARD` (stamped content equals disk) and to the new hash formula;
  - the existing fetch-sequence expectations updated for the ownership GET.
- `packages/shared/src/__tests__/gen-bootstrap-write.test.ts` -- the scratch copy includes `ipm/`. Add these cases:
  - the checked-in `ipm/module.xml` is exactly the generator's output;
  - an unchanged run keeps the manifest's mtime;
  - a missing guard placeholder is an error that writes nothing;
  - a changed shared version moves `<Version>`.
- `packages/iris-mcp-all/src/__tests__/ipm-manifest.test.ts` (new, default suite; AC 42.4.1) -- parse `ipm/module.xml` and assert:
  - the non-preload resources equal `bootstrapRoster().names`, as `.CLS`, in order;
  - exactly one Preload resource, the guard;
  - the three Invokes in order with their attributes;
  - `<Version>` equals the shared version, which equals the embed marker's semver;
  - `<Name>` equals the embed's `IPM_MODULE_NAME`;
  - no `ExecuteMCPv2.Tests.`/`QAFixtures` resource, and no `<WebApplication>`, `MatchRoles` or role attribute;
  - the DO-NOT-EDIT header;
  - the header's stated counts equal the counted `<Resource` lines, which equal the roster length plus 1 (Rule #51).
- `scripts/throwaway-iris.mjs` -- extend it (Rule 2), keeping `run`'s argv and result byte-identical:
  - **`up`:**
    - `--network none` (mutually exclusive with `--host-port`): no `-p`, readiness without the web poll, and state `network: "none"`;
    - `--mount <absolute real directory>:/opt/iris-mcp/<[a-z0-9-]+>` → `-v …:ro`, refusing `..`, `:`, a symlink or a missing directory.
  - **`session --state <f> --namespace <NS> --script <file>`** → `docker exec -i <id> iris session iris -U <NS>`, printing its output and exiting with docker's status.
  - **`cp --state <f> --from <container path under /tmp/iris-mcp-…> --to <host path>`**: copy out.
  - **Inspection and state:**
    - `inspectProblems` takes `{port}` or `{network: "none"}`. `none` requires `HostConfig.NetworkMode === "none"` and no port binding.
    - `parseState` accepts exactly one of `port` or `network`.
    - `exec` refuses a `--network none` state (exit 2).
    - `session` and `cp` run `loadThrowaway` first.
  - **DW-686:** `OLDEST_IRIS_COMMUNITY_IMAGE` becomes `intersystems/iris-community:2026.1@sha256:c57b65b2b454494091e7b3e49f6a53b3335f40adf475bcfcee0866083f35a7c2`. Its comment carries the dated floor: 2025.3 passed every guard leg in CI run 39749804619 (sha `6a8574f`, 2026-10-22) and its key expires 2026-11-13; the 2026.1 key is valid to 2027-03-27.
  - Update the header contract and usage.
- `scripts/lib/ipm-archive.mjs` (new; pure helpers, importable without side effects):
  - `stageModule(dir, embed)` -- writes `module.xml`, `src/cls/<path>.cls` per `BOOTSTRAP_CLASSES` entry and `preload/src/cls/ExecuteMCPv2/InstallGuard.cls`, with mode `a+rX`. It refuses content that still holds the `"dev"` placeholder, or a marker other than `BOOTSTRAP_VERSION`.
  - `manifestDeclarations(xml)` -- Name, Version, SourcesRoot, each Resource's Name/Preload, each Invoke's Class/Method/Phase/When. IPM re-serializes on export, so comparisons are structural.
  - `archiveProblems(members, extractedDir, embed)` -- the member set, and content equal after LF/trimEnd.
  - Session-script builders that use split markers (`"IRISMCP-"_"X-START:"`), and `markerValue(output, name)`.
  - `synthesizedSetup(marker | null)` -- a one-class fixture source.
  - `parityProblems(cases, irisResults, classify)`.
  - `IPM_VERBS` = `['load','package','list']`.
- `scripts/ci-ipm-archive.mjs` (new; AC 42.4.2):
  - **Usage.** `node scripts/ci-ipm-archive.mjs [--edition community|health]` (default both).
  - **Preflight.** It requires the built shared dist (`packages/shared/dist/bootstrap-classes.js`, `bootstrap-version.js`) and a manifest whose Name and Version match the embed.
  - **Driver.** It drives `throwaway-iris.mjs` (its exported subcommand functions with `defaultDeps`, or its CLI) through the flow in Design Notes. It prints a phase line and, on failure, the container log. It removes every container in `finally` and on SIGINT/SIGTERM, and removes its temp directories.
  - **Exits.** 0 pass; 1 a check failed (naming the phase and edition); 2 usage or refusal; 3 no docker; 4 a container did not start.
- `packages/iris-mcp-all/src/__tests__/bootstrap-guard-legs.ts` -- add the leg `ipm-owned-older`: seed an older marker plus a stub `ExecuteMCPv2.InstallGuard` document; it expects `ipm` (byte-identical, one warning with the `REMEDY.ipm` strings).
  - Every other leg's seed removes a guard document left from an earlier leg, so the legs stay independent.
  - The hermetic orchestration test and the CI `bootstrap-guard*` suites pick the leg up unchanged (Rule #48: the live proof of the ownership half).
- `scripts/lib/ci-checks.mjs` and `.github/workflows/ci.yml`:
  - **Registry.** `JOB_TIMEOUT_MINUTES.ipm = 45`, and the `ipm` job's `DECLARED_STEPS` are install, build and `node scripts/ci-ipm-archive.mjs`.
  - **Workflow.** The `ipm` job has `needs: [gates, throwaway]`, Node at the floor, the same three pinned actions and no strategy.
  - **Header comment.** It describes four jobs and names the oldest image as 2026.1.
- `packages/iris-mcp-all/src/__tests__/ci-workflow-check.ts` and `ci-workflow.test.ts`:
  - the job set includes `ipm`;
  - the floor-node check covers `ipm`;
  - `ipm.needs` includes gates and throwaway;
  - the README names the `ipm` job.

  Each new check gets a case that goes red.
- `packages/iris-mcp-all/src/__tests__/throwaway-iris.test.ts`, `fake-docker.ts` and `story-42-3-qa-harness-lifecycle.test.ts` -- cover every new flag, subcommand and refusal with injected deps and the scripted docker:
  - the `--network none` argv and state;
  - the mount argv and its refusals;
  - `session`'s stdin and namespace;
  - `cp`;
  - `exec` refusing a network-none state;
  - inspection of an unlabelled container, a container with a port, and a container with another network.

  The DW-686 pin moves to 2026.1.
- `packages/iris-mcp-all/src/__tests__/ci-ipm-archive.test.ts` (new):
  - **Helpers.** Staging from a synthetic embed, including its refusals; declaration comparison; archive problems over a real `tar czf` fixture; marker parsing; parity problems.
  - **Verb set.** The IPM verbs the script's session scripts issue equal `IPM_VERBS` in both directions, and contain no `publish`, `install`, `repo`, `enable` or `update` (AC 42.4.4).
  - **Scripted run.** A full run against the scripted docker passes. Each phase's failure exits 1 naming it, with every container removed on every path. A missing `--network none` is refused.
- `README.md`:
  - **New subsection.** A `### Optional: Install the IRIS-Side Classes with IPM` subsection after `### 4. Verify`. It covers:
    - the command, the namespace, `%Admin_Manage`, IPM 0.10+ in that namespace, and the registry command;
    - that a package is published from the first release;
    - the ownership rule (the server never redeploys an IPM installation, and `zpm "uninstall"` hands the namespace back);
    - the IRIS-side no-downgrade guard;
    - never `-dev`.
  - **Shared Instances.** A table row for IPM-owned deployments, and a remedy bullet.
  - **CI section.** Four jobs, the `ipm` job, and the oldest leg 2026.1 with the dated floor.
  - Default states: no new governed action.
- `CHANGELOG.md` -- a new top section, "Story 42.4: IPM Package Revival", covering:
  - the generated manifest, the guard, ownership, the fallback text, the `ipm` job and DW-686 (the dated tested floor);
  - "`BOOTSTRAP_VERSION` moves from `0.0.2+1.995fbbb1055d` to `<the marker pnpm gen:bootstrap prints>`", written with the literal value (`changelog-bootstrap-move.test.ts` reads it);
  - no tool, wire or governance change.
- `.changeset/story-42-4-ipm-package-revival.md` (new) -- `"@iris-mcp/shared": patch`.
- `packages/iris-mcp-all/src/__tests__/story-42-4-doc-claims.test.ts` (new) -- it pins the README IPM subsection's commands, the IPM row and bullet of Shared Instances, the CI section's `ipm` job and 2026.1, and the CHANGELOG move literals (on the pattern of `story-42-2-doc-claims.test.ts`).

**Acceptance Criteria:**
- **AC 42.4.1:**
  - Given the regenerated tree, when the default suite runs, then `ipm-manifest.test.ts` and the generator drift case are green. The manifest lists the guard as the only Preload resource, followed by exactly `classes[]` in order. Its `<Version>` is the shared version, and its counts are mechanically equal to the roster plus 1.
  - Given `ipm/module.xml` edited by hand, or a `classes[]`, shared-version or guard change without `pnpm gen:bootstrap`, then the default suite fails, naming the file and the command (mutation recorded).
- **AC 42.4.2:** Given the story commit pushed, when its CI run completes (lead checklist 1), then the `ipm` job log shows:
  - one archive built on a `--network none` `iris-community:2026.2`;
  - its installs on fresh `--network none` `iris-community:2026.2` (`USER`) and `irishealth-community:2026.2` (`HSCUSTOM`);
  - `%IPM_Repo.Definition` = 0 at every read, NetworkMode `none` on all three containers, 36 compiled classes with the embed's marker, and the REST application configured and answering 200.

  Locally, `ci-ipm-archive.test.ts` proves the same flow against the scripted docker.
- **AC 42.4.3:** Given a bootstrap whose Configure fails, when `manualInstructions` is read, then item 3 names `zpm "install iris-execute-mcp-v2 <semver>"` in the target namespace with its prerequisites. The name and version are those of `ipm/module.xml`. Given the version or name changed in one place only, then `bootstrap.test.ts` fails.
- **AC 42.4.4 / DW-34:**
  - Given this story's diff, when `ci-ipm-archive.test.ts` and `ci-workflow.test.ts` run, then no script issues an IPM verb outside `load`/`package`/`list`, and the workflow holds no publish, upload or secret.
  - The DW-34 revival (generated manifest and offline proof) lands here. Publishing is 42.5 (the registry) and 42.8 (Open Exchange).
- **DW-674 (ownership):**
  - Given a deployment whose `ExecuteMCPv2.InstallGuard` document exists, when a 42.4 server starts on `stale`, `unconfigured` or `missing` (or finds the guard on the re-check before compile), then it writes nothing and logs one warning naming the `zpm` command. Bootstrap unit tests prove this.
  - Live, the `ipm-owned-older` leg leaves every class byte-identical in CI's `bootstrap-guard` and `bootstrap-guard-oldest` suites.
- **DW-674 (IRIS-side guard and parity):**
  - Given the archive, when it is loaded over a newer, `dev` or marker-less `Setup`, then the load is refused before any class is replaced, and nothing remains installed.
  - Given an older `Setup`, then it installs.
  - Given every case of the shared table, then `InstallGuard.Classify` equals `classifyDeployedMarker` on both editions.
- **DW-686:** Given the story commit's CI run, when `bootstrap-guard-oldest` runs, then it runs on `iris-community:2026.1@sha256:c57b65b2…7c2` and passes every leg. The CHANGELOG, the README CI section and the harness comment record 2025.3's green run 39749804619 of 2026-10-22.
- **Shared instance:** Given each stage's end, when `SELECT ExecuteMCPv2.Setup_GetBootstrapVersion()` runs read-only (`server:"default"`, `namespace:"HSCUSTOM"`), then it returns `0.0.2+1.995fbbb1055d`.

## Spec Change Log

## Review Triage Log

### 2026-10-22 - Review pass
- verdicts: 35 findings - high 0, medium 14, low 15, false 6, maybe-false 0
- findings (layer order: Blind Hunter BH1-9, Edge Case Hunter EH1-9, Verification Gap VG1-4 and VGo1-3, Intent Alignment IA1-10):
  - BH1 `[medium]` `[patch]` The `zpm uninstall` hand-back and the "IPM 0.10 or later" floor are asserted, not shown. The hand-back half is disproved: a throwaway probe (`load -dev` then `uninstall` of the staged module on `iris-community:2026.2`, IPM 0.10.5) showed `InstallGuard`, `Setup` and `Utils` defined after the load and none defined after the uninstall. The floor half is real (see EH1): the Check invoke now carries `CheckStatus="true"`, and the README says the proof ran on IPM 0.10.5 and the earlier versions are untested.
  - BH2 `[medium]` `[patch]` "Uploads nothing" is false on the re-check path (the class documents are uploaded before the re-check). CHANGELOG, changeset and the `bootstrap()` JSDoc now say that a guard found only at the re-check leaves the uploaded documents in place and skips the compile and everything after; the README remedy bullet says the same.
  - BH3 `[medium]` `[patch]` The AD-24 forbidden-construct exemption covered a whole file. `FORBIDDEN_EXEMPTIONS` now lists the exact constructs and counts (`OBJ.Load* / OBJ.Import* x2`), and the test holds the found set equal to the listed set.
  - BH4 `[low]` `[patch]` `installChecksScript` hard-coded the harness account, password and port. It imports `THROWAWAY_USERNAME`, `THROWAWAY_PASSWORD` and `CONTAINER_WEB_PORT` from `scripts/throwaway-iris.mjs`.
  - BH5 `[low]` `[reject]` Nothing mechanical warns before the next license-key expiry (2027-03-27). A calendar-dependent check in the default suite goes red on a date with no code change, and DW-686 is the dated record; not worth a guard now.
  - BH6 `[low]` `[patch]` The README lacked two consequences of IPM ownership (a namespace reached by the `%ALL` mapping is not self-configured; deleting `Setup` does not reinstall into an IPM namespace). Added to the remedy bullet and pinned in `story-42-4-doc-claims.test.ts`.
  - BH7 `[low]` `[reject]` `MANUAL_INSTRUCTIONS` item 3 names a package that is not published before 1.0.0. The spec's Design Notes state that this is expected for a pre-1.0 build (42.5 publishes from 1.0.0), and the text is pinned by AC 42.4.3.
  - BH8 `[low]` `[reject]` Literal non-ASCII characters (an arrow, box-drawing dashes) in comments. Rule 14 exempts comments where the project convention allows them, and the `bootstrap.ts` JSDoc already uses the arrow on 15 lines. The literal non-ASCII bytes found in code (three `￿` regex bounds and one Arabic-Indic digit) were replaced by escapes during verification.
  - BH9 `[low]` `[patch]` The docs read as if the guard refusals were proven on both editions; only the community run does them. README, CHANGELOG and the `ci.yml` header now say so, and `story-42-4-doc-claims.test.ts` pins it.
  - EH1 `[medium]` `[patch]` IPM 0.10.0 to 0.10.4 ignore a returned error `%Status` unless the invoke has `CheckStatus` (`%IPM.Storage.InvokeReference` at v0.10.0, v0.10.4 and v0.10.5, read through the GitHub API). Without it the guard is a silent no-op there. `scripts/gen-bootstrap.mjs` now emits `CheckStatus="true"` on the Check invoke only; the attribute is outside the Task text of this spec (a one-attribute extension, source-verified for 0.10.0 to 0.10.11, run only on 0.10.5, where the real proofs passed with it). Pinned by `ipm-manifest.test.ts`; `BOOTSTRAP_VERSION` did not move.
  - EH2 `[low]` `[reject]` The guard class present with no IPM module installed (aborted install, manual copy). A refused or failed non-dev load rolls back (the proofs showed no guard class left after a refusal), and copying a file out of `ipm/` by hand is contrived; the remedy is to delete the class.
  - EH3 `[low]` `[patch]` The AD-24 scan did not read `ipm/preload`. It now walks `ipm/preload/**/*.cls` as ObjectScript.
  - EH4 `[medium]` `[patch]` Same root cause as BH3 (exemption keyed by file).
  - EH5 `[low]` `[patch]` `upHarness` skipped the mount-directory check when `deps.checkMountDirectory` was missing. It now refuses (exit 2, no docker call); tested.
  - EH6 `[low]` `[reject]` The state file unreadable right after `upHarness` wrote it and disarmed the teardown. No real path reaches it (the harness wrote the file a moment earlier, and a failed write is handled inside `upHarness`).
  - EH7 `[medium]` `[patch]` Same root cause as BH2 (claim of "uploads nothing" on every write path).
  - EH8 `[medium]` `[patch]` Same root cause as EH1 (claim about IPM 0.10 and later).
  - EH9 `[false]` `[reject]` The `uninstall` hand-back is unproven: disproved by the probe in BH1 (the guard class is removed by `uninstall`).
  - VG1 `[medium]` `[patch]` Install-phase checks of the scripted run that no fault exercised (list version, `GetBootstrapVersion()`, the older-leg load, the fresh-health load, the refusal naming the deployed marker, `cp`, the synthetic Setup load and delete, the output directory). Eleven fault rows, a `cp` failure case and a parity-listing case were added; each clause is shown to fail by a mutation.
  - VG2 `[low]` `[patch]` `GUARD_REFUSAL_TEXT` was an untied copy of the guard's wording. A test now holds the embedded guard source to the constant.
  - VG3 `[low]` `[patch]` The IRIS-side `InstallGuard` has no default-suite host (by design: the red-proofs are lead branches `guard` and `parity`), and several pinning tests lacked `mutation:` lines. The lines were written after demonstrating each mutation (see Verification).
  - VG4 `[medium]` `[patch]` The scripted-run block depends on the built shared dist and ran on Windows. It now fails clearly in `beforeAll` when the dist is missing or stale, and is skipped on `win32`.
  - VGo1 `[low]` `[patch]` Two unused symbols (`GUARD_REFUSAL_TEXT` import, `_network`); both are used or removed. `@iris-mcp/all` has no `lint` script (pre-existing), so the changed test files were linted ad hoc: clean.
  - VGo2 `[medium]` `[patch]` AC 42.4.1 wants a manifest drift failure to name the file and the command. `ipm-manifest.test.ts` and the generator tests now carry that message.
  - VGo3 `[medium]` `[patch]` Same root cause as BH3.
  - IA1 `[false]` `[reject]` The default suite cannot run real IPM or IRIS. AC 42.4.2 says so ("Locally, `ci-ipm-archive.test.ts` proves the same flow against the scripted docker"); the real behavior is shown by the `ipm` job and by this pass's throwaway runs of `ci-ipm-archive.mjs` on both editions.
  - IA2 `[low]` `[reject]` The seam (a guard produced by a real IPM install read by the bootstrap) is covered by neither side alone. The ownership signal is the Atelier document `ExecuteMCPv2.InstallGuard.cls` answering 200, and the live `ipm-owned-older` leg exercises that read against a real IRIS; the real install was shown to define the class.
  - IA3 `[false]` `[reject]` The proof issues `load`, not `install`. AC 42.4.4 forbids `install`; the uninstall hand-back was probed once through the harness.
  - IA4 `[false]` `[reject]` The guard legs run over a one-class synthetic Setup. That is the spec's own matrix ("a synthetic compiled `ExecuteMCPv2.Setup`").
  - IA5 `[medium]` `[patch]` The matrix row says "no PUT" for a guard found "on the re-check before compile". That cannot hold for `stale` and `missing`: the PUTs precede the re-check. The only coherent reading is "nothing further is written" (no compile, Configure, mapping or `^UnitTestRoot`; documents already uploaded stay), which the code, the warning text and the tests implement; only one reading is possible, so this is not an `intent_gap`. The docs were corrected (BH2). The lead should amend the matrix row when it next touches the spec.
  - IA6 `[medium]` `[patch]` Same root cause as VGo2.
  - IA7 `[medium]` `[patch]` A signal arriving while `upHarness` waited for the container's session found the container neither registered nor armed in the script, so it was not removed. The container is now registered before `upHarness` starts it; tested with a scripted-docker signal on the first readiness session.
  - IA8 `[low]` `[patch]` The parity failure listed the first 20 mismatches; the matrix says every mismatch. It now lists all; tested with 68 mismatches.
  - IA9 `[false]` `[reject]` Whether `bootstrap-guard-oldest` passes on 2026.1 is a CI fact. It was also run through the harness on the 2026.1 image in this pass: 10 of 10 legs, `ipm-owned-older` included.
  - IA10 `[false]` `[reject]` The `FORBIDDEN_EXEMPTIONS` entry is outside the intent's text: forced by the existing AD-24 scan, which flags `$System.OBJ.Load` in the proof's session scripts; it is now exact (BH3).

## Design Notes

**Governing ADs and conventions (Rule 6):**
- **AD-14:**
  - the generated manifest from the same class list;
  - archives built from the stamped embed, never from `src/`;
  - the module version equals the npm version;
  - Ownership and IPM upgrades, which this story confirms (amendment drafts below).
- **AD-29:**
  - CI stays secret-free and publishes nothing;
  - throwaways refuse the live ports;
  - the new `ipm` job is registered in `ci-checks.mjs` and `ci.yml`, with the self-test;
  - it runs after `gates` and `throwaway`, so no artifact comes from a red commit.
- **AD-15:** with no guard present, every `BootstrapResult` is deep-equal to today's. The fallback-text change is log-only and named in the CHANGELOG.
- **AD-31:** Configure through `Setup.Configure`, with no application roles and no MatchRoles; the proof asserts this.
- **AD-12:** the guard's comparison is an IRIS-side check that must run before commit, inside IPM's install transaction. That is a recorded exception; the draft below names it.
- **AD-28:** the module name and description do not imply InterSystems endorsement.
- **AD-1:** the servers still reach IRIS only over the web port. The in-container `iris session` is container setup inside the harness, the one docker caller.
- **AD-33:** no route is changed.
- **Conventions:**
  - Live testing on a shared instance;
  - Probes and references (verified-on versions: IPM 0.10.5 on IRIS 2026.1 Build 234U and 2026.2 Build 221U);
  - Error text;
  - ObjectScript naming and pitfalls;
  - the Stack row "IRIS CI images".

**Why the guard is a separate, IPM-only class whose presence marks ownership:**
- **Why not Setup itself.**
  - The guard must run before IPM reloads the package, and must read the OLD deployed marker. Preloading `Setup` itself would overwrite that marker first.
  - `Initialize/Before` runs the previously installed class, and on a fresh install fails with `<CLASS DOES NOT EXIST>`. So the guard is a self-contained class: preloaded, run at `Initialize/After`, and carrying its own stamped marker.
- **Why presence is the ownership signal.**
  - Its presence follows the `ExecuteMCPv2` package mapping exactly. A namespace that sees the classes through `%ALL` also sees the guard.
  - That makes presence a better signal than IPM's own module table, which lives only in the namespace where IPM was imported.
  - Bootstrap reads it with the existing positive-absence rule (404 = not IPM).
- **Why its source is outside `src/`.** A developer `iris_doc_load` of `src/**/*.cls` would otherwise plant a false ownership signal. The path `ipm/preload/…` also fails a hand `zpm "load ipm/"`, because the layout is not IPM's, so nobody installs from the repository by accident.
- **Why its content joins the marker's hash.** An archive with a different guard must not share a marker with this one.

**The IRIS-side check, in detail.**
- **Where it runs.** `Check()` runs inside IPM's lifecycle (`Initialize/After`), after IPM stores the new record and before Reload. It runs on `load`, `install` and `update` alike.
- **Refusal.** A refusal rolls everything back on a non-dev install.
- **Why it is needed.** IPM's own check:
  - compares module versions without our `+<sequence>.<hash>`;
  - never sees a bootstrap deployment;
  - is skipped with no IPM record.

  The guard covers all three.
- **The ordering.** It is 42.2's, in both directions (`Classify` is a port, and the parity check holds it equal on the real instances). The policy mirrors `probeCustomRest`:
  - only a provable absence (no class definition) or an older or equal marker installs;
  - an existing `Setup` whose marker cannot be read is `unknown` and is refused.
- **Copy, not shared code (Rule 2).** The ObjectScript `Classify` is a deliberate port of the TS comparator: the IPM install path has no TypeScript. The parity check is what keeps the two unified.

**Bootstrap warning (`ipm` variant).** It is one line, starting `Bootstrap: leaving the ExecuteMCPv2 classes in '<ns>' on <host>:<port> alone`, so `leavingLines` matches it.
- **It names:**
  - "installed by IPM (class ExecuteMCPv2.InstallGuard is present)";
  - that this server never redeploys an IPM installation;
  - the deployed marker (or "absent") and `BOOTSTRAP_VERSION`.
- **Remedies, which the `REMEDY.ipm` strings pin:**
  - stale: `run zpm "install iris-execute-mcp-v2 <semver of BOOTSTRAP_VERSION>" in '<ns>' as a user with %Admin_Manage`;
  - unconfigured: `Do ##class(ExecuteMCPv2.Setup).Configure("<ns>")` as a user with `%Admin_Manage`;
  - missing: uninstall and reinstall with zpm;
  - always: `to hand '<ns>' back to this server, run zpm "uninstall iris-execute-mcp-v2" there and restart this server`.

**MANUAL_INSTRUCTIONS item 3 (AC 42.4.3).** It replaces `zpm "install iris-execute-mcp-v2"` "in any namespace". The item:
- is headed "IPM (InterSystems Package Manager 0.10 or later, installed in the target namespace)";
- says to run in the target namespace, as a user with `%Admin_Manage`, `zpm "install iris-execute-mcp-v2 <semver>"`, where `<semver>` is the semver of `BOOTSTRAP_VERSION` (this server's version);
- says to run `zpm "repo -r -n registry -reset-defaults"` first when `zpm "repo -list"` shows no registry;
- says that IPM then owns the classes there, and this server never redeploys them.

Items 1 and 2 and the first-occurrence `NAMESPACE` replacement are unchanged. For a pre-1.0 build the version names a package that is not yet published, which is expected (42.5 publishes from `1.0.0`).

**The `ipm` CI flow (`scripts/ci-ipm-archive.mjs`).**
1. **Stage.** Stage the embed into a temp directory, along with a fixtures directory holding `cases.json` and the synthetic Setup files.
2. **Build.**
   1. `up` the community 2026.2 image (`--network none`, stage mounted).
   2. In a session: import IPM, read the repository count (0), `load -dev /opt/iris-mcp/stage`, empty `/tmp/iris-mcp-ipm-out`, then `package iris-execute-mcp-v2 -path /tmp/iris-mcp-ipm-out/iris-execute-mcp-v2`.
   3. Read the repository count (0), list the output directory (exactly one `.tgz`), `cp` it out, and `down` the container.
3. **Check the archive on the host.** `tar tzf`, then extract it. Compare the declarations and the members against the embed.
4. **Install on community** (`USER`, archive and fixtures mounted).
   1. Import IPM and read the repository count (0).
   2. Run the guard legs: newer, `dev`, unknown. Each one loads a synthetic Setup with `$System.OBJ.Load(…,"ck")`, then requires `load /opt/iris-mcp/install/<tgz>` to fail with the guard text. It then reads Setup's marker (unchanged), `list` (no module) and the repository count (0), and deletes the synthetic Setup.
   3. Run the older leg, which installs.
   4. Run the install checks of the matrix, then parity over `cases.json`, then `down`.
5. **Install on health** (`HSCUSTOM`). Do the same, with a fresh install instead of the guard legs, and `down`.

The IPM verbs are exactly `load`, `package` and `list`. The CI script's `InstallGuard.Classify` results are compared with `classifyDeployedMarker` from `packages/shared/dist/bootstrap-version.js`, over the fixture cases plus three runtime cases built from `BOOTSTRAP_VERSION`.

**Rule 2 (extend, don't copy):**
- `throwaway-iris.mjs` gains `--network none`, `--mount`, `session` and `cp` rather than a second harness or a `.sh` script.
- `setupClassAbsence` becomes `documentAbsence`.
- `warnDeploymentLeftAlone` gains a variant.
- `bootstrap-guard-legs.ts` gains a leg.
- `gen-bootstrap.mjs` emits the manifest; there is no second generator.
- `bootstrapRoster()` is reused by the manifest test.
- `fake-docker.ts` is extended.

The OcuPilot script is a functional reference only (AD-12 reference-code rule).

**Integration ACs:**
- Consumer `ci-ipm-archive.mjs` reads the generator's embed and `ipm/module.xml`, and produces an installed, configured service on two editions (AC 42.4.2).
- Consumer `bootstrap()` reads the guard's presence and produces no write plus one warning (the `ipm-owned-older` leg, live).

- **Consumed-by:**
  - **42.5:** the release workflow builds and publishes the IPM archive with `lib/ipm-archive.mjs` staging, and its root `version` script regenerates `ipm/module.xml` through `gen:bootstrap`. Deferred item 1 is the registry route.
  - **42.8:** the Open Exchange listing reuses the manifest metadata.
  - **42.9:** the README states the tested floor, 2026.1, and the IPM install route.
- **Consumes:** 42.2 (the marker grammar, `classifyDeployedMarker`, the guard legs) and 42.3 (the harness, the CI registry, the self-test, the scripted docker).

**Ledger inbox:**
- **DW-34:** addressed by AC 42.4.1, AC 42.4.2 and AC 42.4.4 (the revival and the offline proof). Its publishing half is 42.5's and 42.8's; the lead re-owns the residual at adjudication.
- **DW-674:** addressed by the two DW-674 ACs and the `ipm-owned-older` leg.
- **DW-686:** addressed by the DW-686 AC.

**AC reinterpretations:**
1. **One archive, three containers.** "Build on one throwaway, install on a second … on both editions" means one archive built on `iris-community:2026.2` and installed on fresh containers of both editions. The release ships one archive, so this proves that the same artifact installs on both. All three containers run `--network none`.
2. **A Node script and its own job.** "Adapted from `ci-ipm-archive.sh`" becomes a Node script over the extended harness (Rule 2) in its own `ipm` job, not in `package`. The job has the same `needs` and runs in parallel with `package`, within its own 45-minute budget.
3. **"Nothing was fetched" is measured** by NetworkMode `none` on every container, plus 0 `%IPM_Repo.Definition` rows after every installing verb.
4. **"REST application configured" is measured** by the web application's properties, the `%ALL` mapping and an in-container HTTP 200.
5. **AC 42.4.3's line numbers.** `bootstrap.ts:95-96` is now `:130-131`.
6. **The manifest adds one resource.** It is generated from `classes[]` plus one IPM-only preloaded guard (DW-674).

**Decided at the spec gate (2026-10-22):** all six recommendations were accepted as written. They are wave-8 orchestrator decisions #67 (the ownership signal is the presence of `ExecuteMCPv2.InstallGuard`), #68 (one archive installed on both editions, three containers), #69 (its own `ipm` CI job), #70 (the module name stays `iris-execute-mcp-v2`), #71 (the implement and QA stages may run throwaways on the terms of #55 and #64: harness only, own containers only, removed before return, pulls reported) and #72 (the registry route goes to 42.5's plan). The lead wrote the spine drafts below: AD-14 (manifest, Ownership, IPM upgrades, no longer [ASSUMPTION]), AD-12's exception list, AD-29's CI bullet, the "IRIS CI images" Stack row and the Deferred release-operations entry. `lint_spine.py` is clean. The implement stage does not edit the spine, never pushes, never triggers CI and never writes to the shared IRIS. The first CI run of this story's commit is the lead's checklist at its smoke. The lead upgrades HSCUSTOM to the new `BOOTSTRAP_VERSION` there.

**Orchestrator decisions needed (as planned):**
1. **The IPM ownership signal.** Recommended: (A) the presence of the IPM-only `ExecuteMCPv2.InstallGuard` class.
   - (A) follows the `%ALL` package mapping, needs no IPM-schema query, and was proven by probe Q3.
   - (B) is an owner parameter stamped per channel. It needs two variants of the stamped Setup, and a dictionary read whose failure modes are harder.
   - (C) queries `%IPM_Storage.Module`. That only works in the namespace IPM was imported into, so it is wrong under `%ALL`.
2. **The proof topology.** Recommended: one archive, installed on both editions (three containers), rather than a build and an install per edition (four containers). This is reinterpretation 1.
3. **Where the proof runs.** Recommended: its own `ipm` job with `needs: [gates, throwaway]`, rather than steps inside `package`. It keeps the 30-minute package budget, runs in parallel, and needs no matrix, so the self-test's "only gates has a strategy" rule stands.
4. **The module name.** Recommended: keep `iris-execute-mcp-v2`. It is the existing name, the registry answers 404 for it, it is lowercase, and it does not imply endorsement.
5. **Throwaways for the implement and QA stages.** Recommended: authorize them on the terms of decisions #55 and #64 (harness only, own containers only, removed before return, pulls reported). Then `node scripts/ci-ipm-archive.mjs` and `pnpm live:bootstrap-guard` run once on the real path before review. IPM's behavior cannot be shown by a scripted docker, and without this the first live run is the lead's CI run.
6. **The registry route (deferred item 1).** Recommended: route it to 42.5's plan, and keep `ipm/module.xml` plus the CI-built archive here.

**Spine amendment drafts for the lead (Rule 20):**
- **AD-14, IPM manifest:** "`ipm/module.xml` is generated by `scripts/gen-bootstrap.mjs` from `classes[]`, plus one IPM-only preloaded class, `ExecuteMCPv2.InstallGuard`, whose source is `ipm/preload/ExecuteMCPv2/InstallGuard.cls` and whose content joins the marker's hash. The module is `iris-execute-mcp-v2` at the npm version. Archives are built from the generated embed, never from `src/`, and CI's `ipm` job proves one installs offline on both editions (Story 42.4)."
- **AD-14, Ownership** (drop [ASSUMPTION]): "When `ExecuteMCPv2.InstallGuard` is present, IPM installed the classes: bootstrap writes nothing on any path that would write, and logs one warning naming the `zpm` command. A 404 for it is the positive absence; any other failure is unknown, and nothing is written."
- **AD-14, IPM upgrades** (drop [ASSUMPTION]): "The preloaded guard runs at IPM's `Initialize/After`, before Reload. It orders the deployed `ExecuteMCPv2.Setup` marker against its own stamped one with the 42.2 table, and refuses newer, foreign and unknown inside IPM's transaction. IPM's own check ignores build metadata and never sees a bootstrap deployment. Installs never use `-dev`."
- **AD-12, recorded exceptions:** add "the IPM install guard's marker comparison (AD-14)".
- **Stack row "IRIS CI images":** replace `:2025.3` with `:2026.1` (key valid to 2027-03-27), and add "2025.3 passed the guard in CI run 39749804619 on 2026-10-22 before its key expired 2026-11-13".
- **AD-29, CI:** append "The `ipm` job builds the IPM archive and installs it offline on both editions, after `gates` and `throwaway` (Story 42.4)."
- **Deferred, Release operations:** IPM's version policy is settled, since the module version equals the npm version (AD-14). Remove "and IPM (… 42.4)".

## Verification

Run from `/Users/jbrandt/git/iris-execute-mcp-v2`, one command per foreground call, with `timeout: 600000`. After editing a package's `src/`, rebuild it (`pnpm --filter <pkg> build`).

`UNARMED` is `env -u IRIS_HOST -u IRIS_PORT -u IRIS_USERNAME -u IRIS_PASSWORD -u IRIS_NAMESPACE -u IRIS_HTTPS -u IRIS_REQUIRE_LIVE -u IRIS_TEST_HOST -u IRIS_TEST_PORT -u IRIS_THROWAWAY`.

No stage pushes, triggers CI, or writes to the shared IRIS. Docker runs only under Orchestrator decision 5, and only through the harness.

**Commands:**
- `(loop)` Syntax-check the scripts -- expected: exit 0.
  ```sh
  for f in scripts/gen-bootstrap.mjs scripts/throwaway-iris.mjs scripts/ci-ipm-archive.mjs scripts/lib/ipm-archive.mjs scripts/lib/ci-checks.mjs; do
    node --check "$f" || exit 1
  done
  ```
- `(loop)` `pnpm gen:bootstrap` twice -- expected: the second run prints "Unchanged" for the embed and the manifest, and `git diff --stat` names only this story's files.
- `(loop)` `UNARMED CI=true pnpm --filter @iris-mcp/shared exec vitest run src/__tests__/bootstrap.test.ts src/__tests__/bootstrap-version.test.ts src/__tests__/gen-bootstrap-write.test.ts` -- expected: green.
- `(loop)` Run the `@iris-mcp/all` story files (`UNARMED CI=true`) -- expected: green.
  ```sh
  UNARMED CI=true pnpm --filter @iris-mcp/all exec vitest run \
    src/__tests__/ipm-manifest.test.ts src/__tests__/ci-ipm-archive.test.ts \
    src/__tests__/throwaway-iris.test.ts src/__tests__/story-42-3-qa-harness-lifecycle.test.ts \
    src/__tests__/story-42-2-qa-throwaway-wiring.test.ts src/__tests__/ci-workflow.test.ts \
    src/__tests__/ci-seed-throwaway.test.ts src/__tests__/story-42-2-bootstrap-guard-orchestration.test.ts \
    src/__tests__/changelog-bootstrap-move.test.ts src/__tests__/story-42-2-doc-claims.test.ts \
    src/__tests__/story-42-4-doc-claims.test.ts
  ```
- `(loop)` `pnpm --filter @iris-mcp/shared lint` and `pnpm --filter @iris-mcp/all lint` -- expected: 0 warnings.
- `(once)` `UNARMED CI=true pnpm --filter <pkg> test`, one call per package -- expected: green. The packages are shared, client-config, admin, data, dev, interop and ops; run `@iris-mcp/all` as `-- --shard=1/2` and `-- --shard=2/2`.
- `(once)` `pnpm lint` and `pnpm type-check` (per package if turbo flakes), plus `npm --prefix extensions/iris-mcp-launcher run type-check` -- expected: green.
- `(once)` The root checks -- expected: all OK, with the baseline at `1e62c5ad5bf7`/141.
  ```sh
  pnpm gen:governance-baseline:check
  pnpm gen:skills:check
  pnpm gen:pack:check
  pnpm validate:prompts
  pnpm check:provenance
  pnpm gen:tools-list-snapshot:check
  node scripts/check-epics-sync.mjs
  ```
- `(once)` `UNARMED node scripts/ci-package-smoke.mjs` -- expected: exit 0 (the shared dist changed).
- `(once)`, only under decision 5. Each item is its own foreground call, so each fits the 10-minute cap:
  - `node scripts/ci-ipm-archive.mjs --edition community` -- expected: exit 0;
  - `node scripts/ci-ipm-archive.mjs --edition health` -- expected: exit 0;
  - `pnpm live:bootstrap-guard` -- expected: every leg passes, `ipm-owned-older` included. If one call cannot hold every leg, run the gate through `node scripts/throwaway-iris.mjs run -- pnpm --filter @iris-mcp/all exec vitest run src/__tests__/story-42-2-bootstrap-guard-live-gate.test.ts -t <leg title>`, one call per group of legs.

  Report each container's name and that it was removed, and every image pulled.
- `(once)` A read-only HSCUSTOM `SELECT ExecuteMCPv2.Setup_GetBootstrapVersion()`, before and after -- expected: `0.0.2+1.995fbbb1055d` both times.

**Mutations (Rule 19).** Apply each, observe red, revert, confirm `git status --short` and `git diff --stat` are unchanged, and record `mutation: … → …`.
- AC 42.4.1: hand-edit one `<Resource>` in `ipm/module.xml` → `gen-bootstrap-write.test.ts` and `ipm-manifest.test.ts` go red.
  - mutation: hand-edited one `<Resource>` of `ipm/module.xml` (`ExecuteMCPv2.Utils.CLS` to `ExecuteMCPv2.Utilz.CLS`) -> `gen-bootstrap-write.test.ts` "the checked-in ipm/module.xml is exactly what the generator writes, so a run on a clean tree rewrites neither the embed nor the manifest" and "an unchanged run keeps the manifest's mtime and content, and a changed run rewrites it" went red; `ipm-manifest.test.ts` "lists the guard as the only preloaded resource, first, followed by exactly classes[] in order as .CLS" went red. Reverted; tree fingerprint byte-identical.
- AC 42.4.1: drop the guard from the hash formula in the generator → the `bootstrap.test.ts` drift check goes red.
  - mutation: `scripts/gen-bootstrap.mjs` hashed `rawContents` without `guardContent`, then `node scripts/gen-bootstrap.mjs` regenerated (marker `0.0.2+3.995fbbb1055d`) -> `bootstrap.test.ts` "the marker's hash is the SHA-256 hash of concatenated disk contents, the IPM install guard last" went red, and so did `gen-bootstrap-write.test.ts` "the guard's content joins the marker: editing it raises the sequence by 1, moves the hash and reaches the embedded guard, not Setup". Reverted the generator and restored the embed, the sequence state and the manifest from backups; tree fingerprint byte-identical.
- AC 42.4.2: remove `--network none` from the build `up` in the script → `ci-ipm-archive.test.ts` goes red on the scripted run.
  - mutation: removed `network: NETWORK_NONE` from the `upHarness` options of `startContainer` in `scripts/ci-ipm-archive.mjs` (the harness then asks for a published port and refuses, exit 2) -> 41 tests of `ci-ipm-archive.test.ts` went red, among them "passes a full run: one archive built on a no-network community container, installed on community and health, every container removed", "--edition community starts the build container and that edition's install container only" and every fault case of the scripted run. Reverted; tree fingerprint byte-identical.
- AC 42.4.2: make the archive check skip the content comparison → `ci-ipm-archive.test.ts` goes red.
  - mutation: `archiveProblems` of `scripts/lib/ipm-archive.mjs` with the content comparison disabled (`if (false && …)`) -> `ci-ipm-archive.test.ts` "archiveProblems over a real tar czf of a staged module > reports a changed class", "> reports a changed guard" and "an archive that differs from the embed ends the run in the archive phase > a class that differs from the embed" went red. Reverted; tree fingerprint byte-identical.
- AC 42.4.3: change the version in item 3 to a literal → `bootstrap.test.ts` goes red.
  - mutation: item 3 of `MANUAL_INSTRUCTIONS` in `packages/shared/src/bootstrap.ts` with `${PACKAGE_SEMVER}` replaced by the literal `9.9.9` -> `bootstrap.test.ts` "item 3 names the package IPM installs (AC 42.4.3) > names the install command with the module name and the semver of BOOTSTRAP_VERSION" and "> takes the name and the version from ipm/module.xml: either changing in one place only fails here" went red, as did the two Configure-fails cases ("should report configured=false + manualInstructions when unconfigured and Configure fails", "should populate manualInstructions when configure fails"). Reverted; tree fingerprint byte-identical.
- AC 42.4.4: add a `repo` verb to a session script → `ci-ipm-archive.test.ts` goes red on the verb-set case.
  - mutation: `importIpmScript` of `scripts/lib/ipm-archive.mjs` with a `##class(%IPM.Main).Shell("repo -list",0,0)` statement added -> `ci-ipm-archive.test.ts` "the IPM verbs the proof issues (AC 42.4.4) > are the only verbs in the source text of the script and of its helpers: every Shell call names one of IPM_VERBS", "> reads the verb of every Shell call of a script, and an unreadable one as the empty verb" and "scripts/ci-ipm-archive.mjs as a process against a scripted docker > issues exactly the verbs load, package and list in the sessions of a full run, and no other" went red. Reverted; tree fingerprint byte-identical.
- DW-674 ownership: remove the ownership check from `bootstrap()` → `bootstrap.test.ts` and the orchestration test (`ipm-owned-older`) go red. Remove it from `markerAllowsCompile` → the re-check case goes red.
  - mutation: the `leftToIpm` call removed from `bootstrap()` in `packages/shared/src/bootstrap.ts`, shared dist rebuilt -> `bootstrap.test.ts` "bootstrap never writes over an IPM installation (DW-674) > an IPM installation found at startup on the 'stale' path: nothing is written, ipmOwned is true, and one warning names the zpm command" (and the fetch-sequence cases of every write path) went red; `story-42-2-bootstrap-guard-orchestration.test.ts` "ipm-owned-older: IPM-owned at startup: an older marker and the InstallGuard document (DW-674)" went red. Reverted, shared dist rebuilt; tree fingerprint byte-identical.
  - mutation: `markerAllowsCompile` made to `return true;` after the marker checks (no ownership re-check) -> `bootstrap.test.ts` "an IPM installation found at the re-check before compile (stale)", "(unconfigured)", "(missing)" and "the ownership read fails at the re-check before compile: unknown, no compile and nothing later; one warning" went red. Reverted; tree fingerprint byte-identical.
- DW-674 parity: change one fixture `expected` → `bootstrap-version.test.ts` goes red. The IRIS side's red is lead branch `parity`.
  - mutation: `expected` of the "stamped: a lower major" case of `bootstrap-marker-parity-cases.json` changed from `older` to `newer` -> `bootstrap-version.test.ts` "the shared parity case table (DW-674) > case 1 ('stamped: a lower major'): the comparator says 'newer'" went red. Reverted; tree fingerprint byte-identical.
- DW-686: revert the constant to the 2025.3 digest → the `throwaway-iris.test.ts` oldest pin goes red.
  - mutation: `OLDEST_IRIS_COMMUNITY_IMAGE` in `scripts/throwaway-iris.mjs` set back to the `2025.3` digest -> `throwaway-iris.test.ts` "throwaway-iris: the images > pins the oldest IRIS Community tag whose key is valid for months ahead (2026.1) by its manifest-list digest" went red. Reverted; tree fingerprint byte-identical.
- Harness: drop the NetworkMode check from `inspectProblems` → `throwaway-iris.test.ts` goes red on the network-none inspection cases.
  - mutation: the `mode !== NETWORK_NONE` problem removed from `inspectProblems` in `scripts/throwaway-iris.mjs` -> `throwaway-iris.test.ts` "the inspection of a --network none container > refuses the default bridge network", "> refuses the host network", "> refuses no host config at all", "> checks the network mode of a stopped container too, when a stopped one is allowed", "> refuses a container that publishes a port when the state says --network none, and the reverse" and "exec, logs and down on a --network none state > down refuses a container on another network with exit 2…" went red; `story-42-3-qa-harness-lifecycle.test.ts` "session and cp re-inspect first: an unlabelled container, a container that has gained a port and a missing container are refused…" went red. Reverted; tree fingerprint byte-identical.

Added in the review pass (each applied, observed red, reverted; `git status --short` and the diff hash were identical to before):
- AC 42.4.1 (the Check invoke carries `CheckStatus`, and every manifest drift failure names the file and the command):
  - mutation: removed ` CheckStatus="true"` from the checked-in `ipm/module.xml` -> `ipm-manifest.test.ts` "has the three invokes, in order, with their attributes" went red with the message "ipm/module.xml is generated and must not be edited by hand: run pnpm gen:bootstrap"; `gen-bootstrap-write.test.ts` "the checked-in ipm/module.xml is exactly what the generator writes…" and "an unchanged run keeps the manifest's mtime and content…" went red with "ipm/module.xml differs from the generator's output: run pnpm gen:bootstrap".
- AC 42.4.1 (a shared-version change without a regeneration):
  - mutation: `packages/shared/package.json` version `0.0.2` -> `0.0.3`, no `pnpm gen:bootstrap` -> `ipm-manifest.test.ts` "is the shared package's version, which is the semver of the embedded marker, under the embed's module name" went red (message names the file and the command).
- AC 42.4.1 (Rule #51, the header's counts are the counted lines):
  - mutation: the header of `ipm/module.xml` stating `35 resources` instead of `36` -> `ipm-manifest.test.ts` "states counts that equal the counted <Resource lines, which equal the roster length plus one (Rule #51)" went red.
- AC 42.4.2 (every container is removed on every exit path, signals included):
  - mutation: `startContainer` in `scripts/ci-ipm-archive.mjs` registering the container only after `upHarness` returned -> `ci-ipm-archive.test.ts` "removes the container it is still waiting for, and exits 143, when SIGTERM arrives while the harness starts it" went red (the container was left).
- AC 42.4.2 (each install-phase check of the script can be the one that fails):
  - mutation: the `GetBootstrapVersion()` `need(...)` deleted -> "the version-call-wrong fault in a community run…" and "the version-wrong fault in a health run…" went red.
  - mutation: the `list` version `need(...)` deleted -> "the list-version-wrong fault in a community run…" and "…in a health run…" went red.
  - mutation: the `cp` exit status ignored (`need(true, …)`) -> "ends the build phase with exit 1, naming it, when the archive cannot be copied out of the build container, and removes it" went red.
  - mutation: the parity listing capped at 20 again (`problems.slice(0, 20)`) -> "lists every parity mismatch, not the first few, when the two comparators disagree on many cases" went red.
  - mutation: `GUARD_REFUSAL_TEXT` in `scripts/lib/ipm-archive.mjs` reworded ("declined the install") -> `ci-ipm-archive.test.ts` "expects the guard refusal text that the embedded install guard builds…" went red.
  - the stale-dist gate: after an edit of `packages/shared/src/bootstrap.ts` made `src/` newer than `dist/`, the scripted-run suite failed in `beforeAll` with "The scripted run loads the built shared dist (pnpm --filter @iris-mcp/shared build)…" instead of failing every case on a marker mismatch; the rebuild turned it green.
- AC 42.4.2 and AC 42.4.4 (the `ipm` job in the workflow):
  - mutation: `needs: [gates, throwaway]` of the `ipm` job in `.github/workflows/ci.yml` -> `needs: [gates]` -> `ci-workflow.test.ts` "runs the four jobs, the gates job on exactly the three Node legs, and the package and ipm jobs after the other two", "the real ci.yml has no problem" and the ipm-job cases went red.
  - mutation: a `secrets.NPM_TOKEN` env entry added to the `ipm archive` step -> `ci-workflow.test.ts` "the real ci.yml has no problem" and "is registered with install, build and the archive proof, a 45-minute budget, and no strategy, condition or launcher step" went red.
- DW-674 (ownership that cannot be read is never a licence to write):
  - mutation: `leftToIpm` in `packages/shared/src/bootstrap.ts` returning `false` for an `unknown` ownership -> `bootstrap.test.ts` "the ownership read fails at startup ('an HTTP 500'): unknown, nothing is written, one warning naming the failure", "…('a timeout')…" and "the ownership read fails at the re-check before compile: unknown, no compile and nothing later; one warning" went red.
- Harness (the mount check and the `exec` refusal never silently skip):
  - mutation: `upHarness` calling `deps.checkMountDirectory?.(…)` (no check when none is supplied) -> `throwaway-iris.test.ts` "never skips the host-directory check: a mount with no checker in the dependencies is refused with exit 2 and no docker call, and a start with no mount needs none" went red.
  - mutation: `execHarness` calling `loadThrowaway(…, { needsPort: false })` -> `throwaway-iris.test.ts` "exec refuses a state with no port with exit 2, before docker is called, and runs nothing" and `story-42-3-qa-harness-lifecycle.test.ts` "exec refuses it; session pipes the script in and returns docker's status; cp copies a file out; logs and down work" went red.
- AD-24 scan (the exemption is exact):
  - mutation: a second forbidden token (`ImportDir`) added to a comment of `scripts/lib/ipm-archive.mjs` -> `document-write-paths.test.ts` "no construct the roster does not model (OBJ.Load*, OBJ.Import*, ImportDir, SetTextFrom*, %Routine %New) exists in the scanned sources" went red.
- The IRIS-side `InstallGuard` (`Classify`, `Check`) has no default-suite host by design: its red-proofs are the lead's CI branches `guard` and `parity` (lead checklist 2.2 and 2.3).

**QA additions (QA).** Files:
- `packages/iris-mcp-all/src/__tests__/story-42-4-qa-parity-table.test.ts` (new, default suite): the parity table keeps 21 boundary cases (the ASCII neighbours of 0-9 and a-f, a bad character after a good digit and a bad first character, a hash of f, a third part after the hash, an embedded marker with a neighbour character, NUL, a Latin-1 letter), and the CHANGELOG's case count equals the fixture's length (Rule #51).
- `packages/shared/src/__tests__/fixtures/bootstrap-marker-parity-cases.json`: 70 to 91 cases; `expected` from a run of `classifyDeployedMarker` in `packages/shared/dist/bootstrap-version.js` over each pair (Rule #36).
- `scripts/lib/ipm-archive.mjs`, `scripts/ci-ipm-archive.mjs`, `packages/iris-mcp-all/src/__tests__/ci-ipm-archive.test.ts`: the install checks also read the install guard's document through Atelier from inside the container (200) and a document that does not exist (404), so the real IPM-installed guard is shown to be what the bootstrap's ownership read sees; 5 fault rows and 1 name case added.
- `CHANGELOG.md`: the case count and the new check.

Real-path runs (QA; throwaways through the harness only): `ci-ipm-archive.mjs` on both editions, 94/94 parity cases on each; `pnpm live:bootstrap-guard` 10/10; the guard gate on the `iris-community:2026.1` digest 10/10 (`ipm-owned-older` included).

Mutations of the IRIS-side `InstallGuard` (the dist copy of the embedded guard was patched, `ci-ipm-archive.mjs --edition community` run on real IRIS and IPM, and the dist restored by checksum; none leaked):
- mutation: `IsDigits` accepting ":" (`> 57` to `> 58`), "/" (`< 48` to `< 47`), and `IsHash` accepting "/" (`>= 48` to `>= 47`), ":" (`<= 57` to `<= 58`) or a backtick (`>= 97` to `>= 96`) -> all five PASSED against the 70-case table (the gap) and each went red at `parity-community` against the 91-case table, naming cases 70 to 83.
- mutation: `IsHash` rejecting "f" (`<= 102` to `<= 101`) -> red at `install-community`: the guard refused the older leg, whose hash holds an f (the table's f cases hold the gap open for a marker whose hash has none).
- mutation: `Check` accepting a newer / `dev` / marker-less `Setup` -> red at `guard-newer` / `guard-dev` / `guard-unknown`.
- mutation: `Check` also refusing a current deployment -> red at `build` (`package` re-runs Initialize over the dev-loaded classes); also refusing an absent one -> red at `build` (`load -dev` on a fresh namespace).
- mutation: `Classify` comparing the sequence before the semver -> red at `parity-community` (8 cases); the length comparison of `CompareDigits` removed -> cases 22 and 23; the leading-zero strip removed -> 4 cases.
- mutation: the `Configure` invoke removed from `ipm/module.xml` -> red at `install-community` (the web application reads `|||`); the `ConfigureMapping` invoke removed -> red at `install-community` (`%ALL` does not map the package).
- mutation (live, DW-674 ownership): the startup `leftToIpm` check disabled in `packages/shared/dist/bootstrap.js` -> `pnpm live:bootstrap-guard` red on exactly the `ipm-owned-older` leg; restored by checksum.

Mutations of the default suite (each applied, observed red, reverted; the tree fingerprint of `git status --short` plus `git diff` was identical afterwards):
- mutation: `ExecuteMCPv2.Utils.CLS` hand-edited to `Utilz.CLS` in `ipm/module.xml` -> `ipm-manifest.test.ts` "lists the guard as the only preloaded resource, first, followed by exactly classes[] in order as .CLS".
- mutation: `${PACKAGE_SEMVER}` of `MANUAL_INSTRUCTIONS` item 3 replaced by `9.9.9` -> 4 cases of `bootstrap.test.ts`; `<Version>` of the manifest alone changed to 0.0.3 -> "takes the name and the version from ipm/module.xml: either changing in one place only fails here".
- mutation: an ownership request made on every probe outcome in `bootstrap()` -> 44 cases of `bootstrap.test.ts`, among them "a 'current' / 'newer' / 'foreign' / 'unknown' probe makes no ownership request".
- mutation: a `repo -list` Shell statement in `importIpmScript` -> `ci-ipm-archive.test.ts` verb-set cases (3), the scripted run's verb case included.
- mutation: the dev-placeholder refusal of `embedProblems` disabled -> "refuses a class that still holds the dev placeholder" and "refuses a guard that still holds the dev placeholder".
- mutation: `OLDEST_IRIS_COMMUNITY_IMAGE` back to the 2025.3 digest -> `throwaway-iris.test.ts` "pins the oldest IRIS Community tag ... (2026.1) by its manifest-list digest" (and no other case: the pin is the only guard).
- mutation: `JOB_TIMEOUT_MINUTES.ipm` 45 to 60 in `scripts/lib/ci-checks.mjs` -> 4 cases of `ci-workflow.test.ts`.
- mutation: the README heading of the IPM subsection renamed -> 7 cases of `story-42-4-doc-claims.test.ts`.
- mutation (QA): the "/"-as-major case of the parity table changed -> `story-42-4-qa-parity-table.test.ts` "holds a case for the character before 0 ("/") as the major"; the CHANGELOG count 91 changed to 90 -> "states in the CHANGELOG the number of cases the fixture holds (Rule #51)".
- mutation (QA, seam): the `GUARDDOC` check removed from `scripts/ci-ipm-archive.mjs` -> the 3 `guard-document-*` fault cases of `ci-ipm-archive.test.ts`; `GUARD_DOCUMENT` renamed in `scripts/lib/ipm-archive.mjs` -> "reads the ownership signal under the name the bootstrap reads" and, on the real path, red at `install-community` (the Atelier GET answers 404).

Shared surfaces (QA): the parity table now holds 91 cases (`bootstrap-version.test.ts`, `ci-ipm-archive.test.ts`'s scripted table, `ci-ipm-archive.mjs`'s parity run); the shared `src/` mtime moved, so a local run of the scripted-run block or the live gates needs the shared dist at least as new (`touch packages/shared/dist/bootstrap.js` after a checkout, since `tsc` does not re-emit an unchanged file).

**Lead checklist (after the story commit is pushed to `epic42`; lead only):**
1. **First run.** Record the run URL and per-job durations. Check that:
   - the `ipm` job shows the build, both installs, the three guard refusals, the older upgrade, parity N/N and repository count 0 at every read;
   - `bootstrap-guard` and `bootstrap-guard-oldest` (on 2026.1) pass every leg, `ipm-owned-older` included.

   When it is green, rerun it once.
2. **Red branches.** Branch each of these from the story commit as `ci-red-42-4-<slug>`, push them together, and record each run's URL and red step:
   1. `configure`: drop the Configure `<Invoke>` in the generator and regenerate → `ipm` red at the REST-application check.
   2. `guard`: make `InstallGuard.Check` accept `newer` and regenerate → `ipm` red at the newer-refusal leg.
   3. `parity`: make `InstallGuard.Classify` compare the sequence before the semver and regenerate → `ipm` red at parity.
   4. `src-stage`: stage `Setup.cls` from `src/`, with the stage refusal removed → `ipm` red at the in-container marker check.
   5. `ipm-owned`: remove the ownership check from `bootstrap()` → `throwaway` red at `bootstrap-guard`. `gates` red is expected too.
   6. `network`: start the build container without `--network none` → `ipm` red at the network check.
3. **Clean up.** Delete every `ci-red-42-4-*` branch locally and on origin, and confirm `git ls-remote --heads origin 'ci-red-42-4-*'` prints nothing.
4. **Smoke.** At the smoke, a 42.4-built server upgrades the shared HSCUSTOM from `0.0.2+1.995fbbb1055d` to the new marker. The guard document answers 404 there, so the path is the normal one. Remove the probe image `iris-community:2026.1` if this session pulled it (the plan probe inferred a pull).

**Shared surfaces:**
- `BOOTSTRAP_VERSION` and `scripts/bootstrap-sequence.json`; the embed's exports (`IPM_MODULE_NAME`, `IPM_INSTALL_GUARD`); `ipm/module.xml`.
- The bootstrap fetch sequences (the `bootstrap.test.ts` cases); `MANUAL_INSTRUCTIONS`; the `BootstrapResult` shape.
- `LEGS`/`REMEDY` in `bootstrap-guard-legs.ts`, and the leg count of the orchestration and live gates.
- `throwaway-iris.mjs` exports, CLI, usage, state and inspection; `OLDEST_IRIS_COMMUNITY_IMAGE`; `fake-docker.ts`.
- `DECLARED_STEPS`, `JOB_TIMEOUT_MINUTES`, the job set and the README CI section (the `ci-workflow` self-test). `CI_LIVE_EXEMPTIONS` gains an entry, with its reason, for any new test file the live-capable scan (`scripts/lib/live-gate-scan.mjs`) flags.
- The README Quick Start and Shared Instances sections (the doc-claims tests); the CHANGELOG's newest move (`changelog-bootstrap-move.test.ts`); `.changeset/`.

**Must stay unchanged:** the tool surface, `tools-list-snapshot.json`, the goldens, governance baseline `1e62c5ad5bf7`/141, `classes[]` (35), every `prepublishOnly`, and `parseCli(["run", …])`.

**Standing criterion:** every test added or changed passes on a fresh environment, in either order. Each creates and removes its own temp directories, listeners and containers.

**IRIS:** nothing writes to the shared instance. No `ExecuteMCPv2.Temp.*` fixture and no OS `%UnitTest` class runs. Every IRIS-side check runs in a throwaway.

## Auto Run Result

Status: done
Blocking condition: none

**Summary.** Story 42.4 makes the IPM package real and proves it offline.
- `ipm/module.xml` is now generated by `scripts/gen-bootstrap.mjs` from `classes[]` plus one IPM-only, preloaded class, `ExecuteMCPv2.InstallGuard` (source `ipm/preload/ExecuteMCPv2/InstallGuard.cls`, outside `src/`). The guard orders the deployed `Setup` marker against its own at IPM's `Initialize/After` and refuses a newer, `dev` or unreadable one.
- The bootstrap treats the guard document's presence as IPM ownership: on `stale`, `unconfigured` and `missing` it writes nothing and warns once (also on the re-check before a compile). `BootstrapResult` gains `ipmOwned`; a 404 leaves the result deep-equal to before.
- `MANUAL_INSTRUCTIONS` item 3 names `zpm "install iris-execute-mcp-v2 <semver>"`, its prerequisites and the registry command.
- The new `ipm` CI job (`scripts/ci-ipm-archive.mjs`, `scripts/lib/ipm-archive.mjs`) builds one archive from the stamped embed on a `--network none` container and installs it on fresh `--network none` containers of both editions. The harness gained `up --network none`, `--mount`, `session` and `cp`.
- The oldest CI image is `iris-community:2026.1` (DW-686).
- `BOOTSTRAP_VERSION` moved from `0.0.2+1.995fbbb1055d` to `0.0.2+2.244fe8623c76` (sequence 2; the guard joins the hash).

**Files changed.** 31 files (30 plus this spec, counted from `git diff --stat` against the baseline, untracked files included): the generator, the embed, the sequence state and the manifest; `InstallGuard.cls`; `bootstrap.ts`; the harness, the proof script and its helpers; `ci-checks.mjs` and `ci.yml`; the README, CHANGELOG and changeset; the new and changed tests and fixtures (`ipm-manifest`, `ci-ipm-archive`, `story-42-4-doc-claims`, the parity table, and the bootstrap, generator, harness, workflow, scripted-docker and guard-leg tests).

**Review.** Four layers, 35 findings: high 0, medium 14, low 15, false 6, maybe-false 0 (mechanically recounted from the triage log). Patched in this pass, grouped by root cause: seven medium groups and six low ones. Nothing deferred; no new `deferred:` item. Rejected with a recorded reason: BH5, BH7, BH8, EH2, EH6, IA2 (low) and EH9, IA1, IA3, IA4, IA9, IA10 (false).
- One patch extends the spec's Task text: the Check invoke carries `CheckStatus="true"` (IPM 0.10.0 to 0.10.4 ignore a refusal without it; source-verified, run on 0.10.5 only).
- One matrix row is imprecise: "no PUT" on the re-check before a compile cannot hold for `stale` and `missing` (IA5). The implementation writes nothing further; the lead should amend the row.

**Follow-up review recommendation: true.** Seven medium entries were patched. Unverified risks: the `CheckStatus` effect on IPM 0.10.0 to 0.10.4 (read from IPM source, not run); the signal-during-start test depends on a scripted-docker signal on the first readiness session.

**Verification.**
- `(loop)`, on the final tree: syntax checks; `pnpm gen:bootstrap` twice ("Unchanged" for the embed and the manifest on both runs, nothing else changed); the three shared suites (269 tests); the 12 `@iris-mcp/all` story files, `document-write-paths` included (661 tests); shared lint clean. `@iris-mcp/all` has no `lint` script (pre-existing), so its changed test files were linted ad hoc: clean.
- `(once)`, after the last patch: shared 2554, client-config 1015, admin 506, data 163, dev 1490, interop 751, ops 350, `@iris-mcp/all` shard 1 2773 and shard 2 2029 tests, all green; root lint, type-check and the launcher type-check green; the seven root checks OK (governance baseline unchanged); `ci-package-smoke` exit 0; spine lint 0 findings.
- Real throwaway runs on the final tree, all through the harness: `ci-ipm-archive.mjs --edition community` and `--edition health` exit 0 (guard refusals on newer, `dev` and marker-less `Setup`; older upgrade; 36 classes compiled; REST app with no `MatchRoles`, `%ALL` mapped, GET 200; `%IPM_Repo.Definition` 0 rows at every read; parity 73 of 73 on each edition). `pnpm live:bootstrap-guard`: 10 of 10 legs, `ipm-owned-older` included. The guard gate on the `iris-community:2026.1` digest: 10 of 10 legs.
- Shared HSCUSTOM: `SELECT ExecuteMCPv2.Setup_GetBootstrapVersion()` read `0.0.2+1.995fbbb1055d` before and after; nothing else touched it.

**Containers (all started and removed through `scripts/throwaway-iris.mjs`; no image pulled).**
- Implement-stage exploratory and final runs: `iris-mcp-throwaway-d84377cd1776`, `-e01af370a076`, `-a17d0cebbd4a`, `-8f92a5dd17bc`, `-5906f3cde328`, `-32a19d14877e`, `-6733d2c496f3`, `-c576a8ece1fb`, `-15e10461e474`.
- Review pass: `-2695d820b8f5` (uninstall probe, `down`); `-a54b0e4373a1` (a 2026.1 guard run that failed on a stale dist, removed by `run`); `-bad1f183b9d6` (the 2026.1 guard run); `-7d930f148a03`, `-41cfa4fd63b4` (community proof); `-d3c967cb6d1e`, `-2cd78f8c9aa7` (health proof); `-2b3ae58ce553` (`live:bootstrap-guard`).

Residual risks: the real IPM `Check` on older IPM versions; the lead's first CI run of the `ipm` job and the six red branches of the lead checklist remain the proof on the real runner.
