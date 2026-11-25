---
title: 'Story 45.2: Auto-Install Setting, Off Under Read-Only'
type: 'feature'
created: '2026-11-25'
status: 'done'
baseline_revision: 'fd7a20cb44fd83fbe84ed76266e0a0d19ae0eb33'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-45-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-iris-execute-mcp-v2-2026-10-14/ARCHITECTURE-SPINE.md'
warnings: ['oversized']
deferred:
  - summary: >-
      The sibling docs do not name IRIS_AUTO_INSTALL, the per-profile autoInstall or IRIS_SIDE_NOT_INSTALLED.
    evidence: |-
      Blind Hunter: tool_support.md, docs/client-config/{claude-code,claude-desktop,cursor}.md, the launcher README's left-alone variable list and packages/shared/README.md (refusal-code table and the new exports recordSideRefusal, IrisSideNotInstalledError, applyAutoInstall) carry IRIS_DATA_POLICY-style entries but not the new setting. The spec scoped this story's docs to README.md and CHANGELOG.md (Rule #43: the closing rollup enriches).
    location: >-
      tool_support.md; docs/client-config/*.md; extensions/iris-mcp-launcher/README.md; packages/shared/README.md
    severity: low
  - summary: >-
      deriveAuditOutcome records the IRIS_SIDE_NOT_INSTALLED refusal as `error`, not `denied`.
    evidence: |-
      Edge Case Hunter: server-base.ts deriveAuditOutcome maps GOVERNANCE_DISABLED, CONFIRMATION_DECLINED and CONFIRMATION_SCOPE_CHANGED to `denied` and every other isError result to `error`, so the new refusal is audited as `error`. Whether it should read `denied` is an audit-log decision the spec does not make (and a refusal after earlier Atelier writes is not "nothing changed"); the lead decides.
    location: >-
      packages/shared/src/server-base.ts deriveAuditOutcome
    severity: medium
  - summary: >-
      Install-off profiles refuse after EVERY server upgrade, not only after a release that changes the IRIS-side classes: owner decision whether that is the intended C-2 trade.
    evidence: |-
      Code review (Blind Hunter, verified): the marker is `<semver>+<sequence>.<hash>` and its semver follows packages/shared/package.json; the release version step restamps it (release 1.2.0 moved BOOTSTRAP_VERSION 1.1.0+5.6cbac260e73f -> 1.2.0+5.6cbac260e73f with the same hash, commit 4fcb0706). Markers order by semver first, so after any release the deployed side reads `stale` and an install-off profile refuses until an operator upgrades once. The docs and the refusal now say "after every upgrade"; the behavior is the spec's (`stale` refuses). C-2 was accepted on the premise that 1.3.0 changes the classes. Options: accept (docs already true), or have install-off profiles treat a semver-only difference (same sequence and hash) as current (an AD-14 amendment). Recommended: decision-pending for the owner at the epic decision sheet.
    location: >-
      packages/shared/src/bootstrap.ts probe/stale branch; scripts/gen-bootstrap.mjs marker stamping; AD-14 version marker
    severity: medium
---

<intent-contract>

## Intent

**Problem:** `bootstrap()` never reads the governance preset, so a server started with `IRIS_GOVERNANCE_PRESET=read-only` installs the IRIS side on connect (35 classes uploaded and compiled, the `/api/executemcp/v2` web application, the `%ALL` namespace and mapping, `^UnitTestRoot`; reproduced on a throwaway on `1.2.0+8.5cedcac20ae9`, see Design Notes). No operator can turn the automatic install off (issue #1 point 3, owner decision (2)).

**Approach:** Add `IRIS_AUTO_INSTALL` and a per-profile `autoInstall` field, resolved per profile at startup; the read-only preset forces it off and an explicit "on" with that preset fails startup. With it off, bootstrap only reads; on a `missing`, `stale` or `unconfigured` IRIS side the one gateway (`IrisHttpClient`) refuses every request to `/api/executemcp/` for that profile, and the framework answers the call with the new refusal `IRIS_SIDE_NOT_INSTALLED`. Every other branch, and everything with the setting on, behaves as today.

## Boundaries & Constraints

**Always:**
- Resolution per profile, first match wins: the profile's own `IRIS_PROFILES` `autoInstall` (JSON boolean) → `IRIS_AUTO_INSTALL` (`true`/`false`, any case; empty = unset) → `IRIS_GOVERNANCE_PRESET=read-only` forces off → on. Sources: `IRIS_PROFILES`, `IRIS_AUTO_INSTALL`, `IRIS_GOVERNANCE_PRESET`, `default`. Never inherited from the `default` entry; Server Manager profiles never carry the field; the governance file is not a channel (AD-9).
- Fail fast at startup (AD-8): malformed `IRIS_AUTO_INSTALL` names the variable; a non-boolean `autoInstall` names the profile and `IRIS_PROFILES`; `IRIS_AUTO_INSTALL=true` or any profile's `autoInstall: true` together with the read-only preset names both settings (and the profile) and the way out. Never pick one silently.
- Off: bootstrap sends reads only, on every branch: no `PUT doc`, no `action/compile`, no `Setup_Configure`, `Setup_ConfigureMapping` or `Setup_EnsureUnitTestRoot`. It still runs the IPM-ownership read before deciding, exactly where the write paths run it today.
- The refusal is decided in `IrisHttpClient` (AD-1): a request path that starts with `/api/executemcp/` (case-insensitive) on a refused client throws `IrisSideNotInstalledError` before any I/O (no CSRF `HEAD`). The framework turns it into `refusalResult(REFUSAL_CODES.IRIS_SIDE_NOT_INSTALLED, ...)` even when the handler caught it, and refuses every later request of that call. No per-tool flag, no tool edit.
- Back-compat (AD-15, Rule #19): with `IRIS_AUTO_INSTALL` unset, no `autoInstall` and no read-only preset, the startup requests and `BootstrapResult` are byte-identical; new `BootstrapResult` fields are present only when the setting is off. Startup with `IRIS_AUTO_INSTALL=true` (no preset) is identical to unset.
- Credentials are never logged or put in a refusal.

**Never:**
- No new tool, action, governance key or preset change; no tool-description change (tools-list snapshot and tools-list golden rows untouched); no change to any `.cls` (no `BOOTSTRAP_VERSION` move).
- No change to IPM-owned behavior (C-4), nor to `newer`, `foreign` or `unknown` (warning, tools go on).
- No launcher setting (epic out of scope). No write of any kind to the shared instance (`localhost:52773`): live legs run on a throwaway only.
- Never run `gen:ipm`, the bare governance-baseline generator, `changeset version` or `pnpm run version`; never hand-edit frozen goldens (changes go through `sdk-golden-sanctioned-changes.json`).

## I/O & Edge-Case Matrix

**Bootstrap branches.** ON = unset or `true` (no preset). OFF = each of the three sources: `IRIS_AUTO_INSTALL=false`; `IRIS_GOVERNANCE_PRESET=read-only`; the profile's `autoInstall: false`. OFF behaves identically for the three; only the logged and reported source differs, and every OFF row is tested under all three. Requests listed are those after the health check and version negotiation (each POST is preceded by the client's CSRF `HEAD /api/atelier/`).

| Branch (how the probe finds it) | ON | OFF: requests sent (all reads) | OFF: outcome |
|---|---|---|---|
| `missing` (version query fails or empty; `GET doc/ExecuteMCPv2.Setup.cls` 404) | today: full install | version query; `GET doc/…Setup.cls`; `GET doc/ExecuteMCPv2.InstallGuard.cls` (404) | refusal armed; one `[WARN]`; `autoInstallOff`, `customRestRefused: true`; every step flag false |
| `stale` (older marker) | today: upgrade | version query; `GET doc/…InstallGuard.cls` (404) | refusal armed (`found: "stale"`, `deployedVersion`); one `[WARN]` |
| `unconfigured` (marker = this build; `Setup_IsConfigured()` 0) | today: recompile + configure | version query; `IsConfigured` query; `GET doc/…InstallGuard.cls` (404) | refusal armed (`found: "unconfigured"`, text adds the `Configure` one-liner); one `[WARN]` |
| `current` (marker equal; `IsConfigured` 1) | today | version query; `IsConfigured`; compile-check dictionary query; `GET docnames/CLS?filter=ExecuteMCPv2.` | as today (Story 44.4 report unchanged); one `[INFO]` "install is off" line; no refusal |
| `newer` / `foreign` | today | version query only | as today (one warning); plus the `[INFO]` off line; no refusal |
| `unknown` (version unreadable and Setup not provably absent, or ownership read fails non-404) | today | as today's probe | as today (one warning); plus the `[INFO]` off line; no refusal |
| IPM-owned (`InstallGuard` 200 on `missing`/`stale`/`unconfigured`) | today | as the matching row | as today (the one IPM warning naming `zpm`); plus the `[INFO]` off line; no refusal |

**Calls on a refused profile, configuration and errors.**

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Custom-REST tool | e.g. `iris_global_get` (read) on a refused profile | `isError`, `structuredContent` `{code:"IRIS_SIDE_NOT_INSTALLED", profile, namespace, found, deployedVersion?, requiredVersion, autoInstallSource}`; zero requests to IRIS for the call | text per Design Notes "Refusal and log wording"; never reaches older classes |
| Handler swallows the error | a tool that catches the custom-REST failure and continues | the refusal result replaces whatever the handler returned; no request after the first refusal | per-call recorder |
| Mixed tool | `iris_execute_tests` (guard read on custom REST, then Atelier `Setup_EnsureUnitTestRoot`, `/work`) | refusal at the guard read; the Atelier calls are never sent | as above |
| Atelier-only tool | `iris_server_info`, `iris_doc_get` on a refused profile | works as today | none |
| Cross-profile | `resolveProfileClient("p2")` where only p2 is refused | p2's requests refused, the caller's own profile unaffected | refusal per profile |
| Per-profile, non-inheritance | `IRIS_PROFILES={"default":{"autoInstall":false},"p2":{}}` | `default` off (`IRIS_PROFILES`); `p2` on (`default`) | none |
| Per-profile beside an installing profile | `p1:{autoInstall:false}`, `p2:{}`, both `missing` | p1 sends no write and refuses; p2 installs | none |
| Precedence | profile `false` + `IRIS_AUTO_INSTALL=true`; profile `true` + `IRIS_AUTO_INSTALL=false` | off (`IRIS_PROFILES`); on (`IRIS_PROFILES`) | none |
| Variable off under preset | `IRIS_AUTO_INSTALL=false` + read-only | off, source `IRIS_AUTO_INSTALL` | none |
| Server Manager profile | SM-imported profile, `IRIS_AUTO_INSTALL=false` | off, source `IRIS_AUTO_INSTALL` | none |
| Conflict: variable | `IRIS_AUTO_INSTALL=true` + `IRIS_GOVERNANCE_PRESET=read-only` | startup fails (process exits 1 via `Fatal:`), nothing sent to IRIS | message names both settings and the way out |
| Conflict: profile | `p2:{autoInstall:true}` + read-only | startup fails | names `IRIS_PROFILES`, profile `p2`, `autoInstall`, the preset |
| Malformed | `IRIS_AUTO_INSTALL=yes`; `p2:{autoInstall:"true"}` | startup fails | names `IRIS_AUTO_INSTALL` / `profile "p2": "autoInstall" must be a boolean (true/false).` (`IRIS_PROFILES`) |
| Empty variable | `IRIS_AUTO_INSTALL=` | unset | none |
| Discovery | any | each roster entry gains `autoInstall` (boolean) and `autoInstallSource`, after `dataPolicySource` | none |
| Back-compat | nothing set | startup requests and `BootstrapResult` byte-identical on every branch; no new log line | none |

</intent-contract>

## Code Map

- `packages/shared/src/bootstrap.ts` -- `probeCustomRest` :313-348 (version query :182-205 and `IsConfigured` :366-386 are `SqlProc` reads of `Setup.cls` :172-183, :226-229; `documentAbsence` :224-242 is a `GET doc`); `bootstrap()` :1070-1251 (`current` :1117-1140, `leftToIpm` :996-1019 runs before every write path :1142-1148); `warnDeploymentLeftAlone` :884-934; `PACKAGE_SEMVER` :33; `IPM_MODULE_NAME`. Add the OFF path after the probe (reuse `leftToIpm` for the ownership read; `current`/`newer`/`foreign`/`unknown` code unchanged) and the refusal text/fields builder.
- `packages/shared/src/server-base.ts` -- startup bootstrap of `default` inline in `start()` :2979-2999 (passes `this.config`, not the registry profile); lazy path `getOrCreateClient` :3127-3170 → `establishProfile` :3183-3225 → `attemptProfileBootstrap` :3235-3255; `handleToolCall` client resolution :1964-1985, `resolveProfileClientForCtx` :2002-2008, handler call and catch :2030-2054; `this.preset = parseGovernancePreset()` :2865; `applyDataPolicies(...)` just above it (the resolution precedent). Arm the client's refusal from the `BootstrapResult` in both bootstrap paths.
- `packages/shared/src/http-client.ts` -- `request` :321, `headRequest` :448 (the gate goes first in both); `bindSignal` :530-554 (the Proxy pattern the per-call recorder extends).
- `packages/shared/src/data-policy.ts` -- `resolveDataPolicy` :126-145, `applyDataPolicies` :149-158, `parseOperatorDataPolicy` :95-105: the sibling the new resolution mirrors.
- `packages/shared/src/config.ts` -- `IrisConnectionConfig` :11-90 (`dataPolicy`/`dataPolicySource` :87-89 precedent); `IRIS_SQL_READ_ONLY` parse :253-265 (the boolean-variable precedent); table doc :130-160.
- `packages/shared/src/profiles.ts` -- `ProfileOverride` :157-170; `mergeProfile` `https` boolean check :326-334, `dataPolicy` :352-363, return spread :410; Server Manager builds its own override (`server-manager-source.ts:674`) and never sets the field.
- `packages/shared/src/governance.ts` -- `GovernancePreset`, `parseGovernancePreset` :717-729.
- `packages/shared/src/server-discovery.ts` -- `ProfileRosterEntry` :84-127, `buildRosterEntry` :203-219. Description :410-430 unchanged.
- `packages/shared/src/refusals.ts` -- `REFUSAL_CODES` :15-40; `errors.ts` -- error classes; `index.ts` -- exports.
- Custom-REST callers (Rule #56 enumeration 2026-11-25, `grep "/api/executemcp/v2"` over `packages/*/src`): 49 tool files across all five servers plus `test-production-guard.ts:23`, each a path literal passed to `ctx.http`; no `fetch` outside `http-client.ts:250`; `new IrisHttpClient` only in `profiles.ts:780` and the credentials CLI. The one tool that reaches an `ExecuteMCPv2` class through Atelier is `iris_execute_tests` (`execute.ts:988` `ensureUnitTestRoot`), after its custom-REST guard read (`execute.ts:974`).
- Tests to extend: `packages/iris-mcp-all/src/__tests__/bootstrap-guard-legs.ts` (`runServer` :486 drives the built dev server over stdio via startup or a lazy `other` profile; `seedInstance` :178, `GUARD_DOC`, `VERSION_QUERY`), `stateful-fake-atelier.ts` (records every request; Setup/InstallGuard docs; `Setup_*` SqlProcs; unknown routes answer 404), `story-42-2-bootstrap-guard-orchestration.test.ts` (the hermetic precedent; also the back-compat pin of the ON legs). `process-gate-helpers.ts` `atelierQuery` serves the live oracles.
- Goldens: `fixtures/sdk-wire-golden.json` holds `iris_server_profiles` output (rows `call:omitted-arguments-profiles`, `call:server-profiles`, `scripts/lib/sdk-wire-golden-core.mjs:134-135`); `sdk-handler-golden.json` `startup` (fake `current`, `scripts/lib/fake-iris-listener.mjs`); ledger `fixtures/sdk-golden-sanctioned-changes.json` (schema in `scripts/lib/golden-sanctioned-changes.mjs:30-45`; the CHANGELOG must name each sanction id, `story-43-4-sanctioned-golden-changes.test.ts:902`).
- Docs: `README.md` Quick Start :54, variable table :131-154, IPM section :351-371 (`hands it back` :367), roster bullet :598, back-compat list :736-750, read-only section :476-492, refusal table :520-530; `CHANGELOG.md` top (`## [Unreleased] - Story 45.1: ...` convention); `.changeset/story-45-1-sql-statements-honor-sql-privileges.md` (shape).

## Tasks & Acceptance

**Execution:**
- `packages/shared/src/auto-install.ts` (new) -- `AutoInstallSource`; `parseOperatorAutoInstall(env)`; `resolveAutoInstall(profile, operator, preset)` and `applyAutoInstall(registry, operator, preset)` (writes `autoInstall`/`autoInstallSource` on every profile, throws the two conflict errors); conflict texts per the matrix. Mirrors `data-policy.ts` (Rule 2: a separate module because the value domain and the conflict rule differ). -- AC 45.2.1.
- `packages/shared/src/config.ts`, `profiles.ts` -- add `autoInstall?`/`autoInstallSource?` to `IrisConnectionConfig`; `ProfileOverride.autoInstall`, parsed in `mergeProfile` as a JSON boolean (`https` precedent), recorded with source `IRIS_PROFILES`; doc tables. `loadConfig` never sets it. -- AC 45.2.1.
- `packages/shared/src/bootstrap.ts` -- read `config.autoInstall === false` (with `autoInstallSource`); OFF path per the branch table; `BootstrapResult` gains `autoInstallOff?: AutoInstallSource` and `customRestRefused?: true` (present only when off / armed); the one startup line per profile; export a builder for the refusal text and fields (C-2 wording in Design Notes). Contract-only comments. -- AC 45.2.2, 45.2.3.
- `packages/shared/src/errors.ts`, `refusals.ts`, `http-client.ts`, `index.ts` -- `IrisSideNotInstalledError` (carries text and fields); `REFUSAL_CODES.IRIS_SIDE_NOT_INSTALLED`; `IrisHttpClient` gains a setter for the refusal and the prefix gate in `request` and `headRequest`; exports. -- AC 45.2.2.
- `packages/shared/src/server-base.ts` -- in `start()` call `applyAutoInstall(this.profiles, parseOperatorAutoInstall(), this.preset)` right after the preset parse; the startup bootstrap passes `{...this.config, autoInstall, autoInstallSource}` of the registry's `default` profile (connection fields unchanged); both bootstrap paths arm the profile client's refusal when `customRestRefused`; `handleToolCall` wraps `ctx.http` and `resolveProfileClient` results in a per-call recorder (extend `bindSignal`'s Proxy) and returns the refusal result when one was raised, whatever the handler did. -- AC 45.2.1, 45.2.2.
- `packages/shared/src/server-discovery.ts` -- roster entry adds `autoInstall` and `autoInstallSource` (after `dataPolicySource`); description unchanged. -- AC 45.2.1.
- `packages/shared/src/__tests__/auto-install.test.ts`, `bootstrap-auto-install.test.ts`, `http-client` and `server-base` tests (new or extended) -- every matrix row at unit level: resolution, precedence, non-inheritance, SM, conflicts, malformed, empty; each bootstrap branch × ON/OFF(3 sources) with the recorded request list and result; ON-vs-unset byte-identity per branch; gate before any I/O, prefix only, case-insensitive; swallowed-error replacement and later-request refusal; no password in logs or refusal. Update existing roster and refusal-catalog tests that pin the old shape (shared surfaces). -- matrix.
- `packages/iris-mcp-all/src/__tests__/story-45-2-auto-install-orchestration.test.ts` (new, default suite, fails without fresh dists) -- extend `bootstrap-guard-legs.ts` (an optional list of extra tool calls for `runServer`) and the stateful fake: the built `iris-dev-mcp` over stdio, via startup and via the lazy `other` profile, for each OFF source: `missing` and `stale` (seeded older marker) → zero write requests and zero `/api/executemcp/` requests, `iris_global_get` returns `IRIS_SIDE_NOT_INSTALLED`, `iris_server_info` works, one `[WARN]`; per-profile pair on two fakes; both conflicts and `IRIS_AUTO_INSTALL=yes` exit non-zero with their messages and send nothing. A write = `PUT`, `DELETE`, `POST action/compile`, or an `action/query` naming `Setup_Configure`, `Setup_ConfigureMapping` or `Setup_EnsureUnitTestRoot`. -- AC 45.2.4.
- Live proof (recorded, not committed; Rule #48) -- on an UNSEEDED throwaway (no IRIS side), a scratchpad script run through `throwaway-iris.mjs exec`: snapshot with the five Design-Notes oracle queries (Atelier `action/query` as `_SYSTEM`) → start the built `iris-dev-mcp` with `IRIS_GOVERNANCE_PRESET=read-only` over a real MCP stdio session, call `iris_global_get` (expect `IRIS_SIDE_NOT_INSTALLED`) and `iris_server_info` (expect success) → snapshot again, equal to the first → start once without the preset → the classes, the web application, `%ALL` with the `ExecuteMCPv2` mapping and `^UnitTestRoot` are present. Record each snapshot and result under `## Verification`, then `down`. Not a block of `story-42-2-bootstrap-guard-live-gate.test.ts`: its `beforeAll` deploys a reference install before any block, so no clean IRIS side exists in that file, and the `%ALL` mapping makes a second namespace unclean too. -- AC 45.2.4 live.
- `packages/iris-mcp-all/src/__tests__/fixtures/sdk-golden-sanctioned-changes.json` -- `replace` entries under `S-45.2-read-only-no-install`, story `45.2`, for each server's two discovery rows (the roster entry in `structuredContent` and the `content[0].text`), derived by running the wire-golden test. -- AC 45.2.1 / 45.2.5.
- `README.md` -- variable-table row `IRIS_AUTO_INSTALL` (default on; read-only forces off; conflict fails startup; per-profile `autoInstall`, never inherited; SM takes the variable); the `IRIS_PROFILES`/roster bullets name `autoInstall`/`autoInstallSource`; Quick Start :54 says it installs "unless the automatic install is off"; read-only section gains "Installs nothing on IRIS" with the C-2 upgrade note; IPM :367 "hands it back" only with the automatic install on; back-compat list and single-server list name the variable; refusal table row `IRIS_SIDE_NOT_INSTALLED`. -- AC 45.2.6, Rule #43.
- `CHANGELOG.md` -- `## [Unreleased] - Story 45.2: Auto-Install Setting, Off Under Read-Only` above 45.1, naming `` `S-45.2-read-only-no-install` ``, the new code, the discovery fields, the C-2 upgrade note verbatim, and "no class changed; `BOOTSTRAP_VERSION` unchanged". -- AC 45.2.6.
- `.changeset/story-45-2-auto-install-setting-off-under-read-only.md` -- `"@iris-mcp/shared": patch` plus the five server packages `patch` (the Planner raises to minor). -- AC 45.2.6.

**Acceptance Criteria:**
- Given the built servers and nothing set, when the handler golden, the wire golden (with the ledger) and `story-42-2-bootstrap-guard-orchestration.test.ts` run, then all pass with their frozen fixtures unchanged apart from the new ledger entries (AC 45.2.5).
- Given the resolution with the read-only branch removed (mutation), when `story-45-2-auto-install-orchestration.test.ts` runs, then the read-only `missing` legs go red because the server sends document PUTs; restored, green (AC 45.2.4 proven red; path: the built server's start over stdio against the fake).
- Given an unseeded throwaway, when the recorded live proof runs, then the read-only start leaves the snapshot identical, `iris_global_get` answers `IRIS_SIDE_NOT_INSTALLED`, `iris_server_info` succeeds, and the later normal start installs (AC 45.2.4 live).
- Given a server whose stderr is captured with a known password in the env, when any matrix row runs, then the password never appears in stderr or in a refusal (AC 45.2.3).
- Given the changed tree, when `pnpm gen:ipm:check`, `pnpm gen:governance-baseline:check`, `pnpm gen:tools-list-snapshot:check` and `pnpm gen:bootstrap` (no diff) run, then all pass unchanged.

### Review Findings

Code review 2026-11-25 (`bmad-code-review`, full mode, frozen diff `fd7a20cb..825f341e`; layers Blind Hunter, Edge Case Hunter, Verification Gap, Acceptance Auditor all DELIVERED; review CLEAN). 25 raw rows, 12 patched root causes, 1 deferred (owner decision), 9 rejected; high 0.

- [x] [Review][Patch] Changeset bumps `patch`, decision #160 says `minor` for all six packages (Edge+Blind+VG) [.changeset/story-45-2-auto-install-setting-off-under-read-only.md:2-7; doc-claims pin updated]
- [x] [Review][Patch] Refusal's upgrade sentence named only read-only servers, not servers with the install off (C-2) (Auditor) [packages/shared/src/bootstrap.ts buildIrisSideRefusal]
- [x] [Review][Patch] Upgrade note said "a release that changes the IRIS-side classes (1.3.0 is one)"; every release restamps the marker semver, so every upgrade reads `stale` (Blind) [bootstrap.ts refusal text; README.md read-only bullet; CHANGELOG.md upgrade note; changeset]
- [x] [Review][Patch] Refusal text and the startup `[WARN]` never said to restart this server after the IRIS side is installed (the refusal is armed at connect) (Edge+Blind) [bootstrap.ts buildIrisSideRefusal, warnCustomRestRefused]
- [x] [Review][Patch] CHANGELOG and changeset said `current` logs "one warning"; it logs none (Auditor) [CHANGELOG.md:12; changeset:14]
- [x] [Review][Patch] Comment "asking for the same profile twice returns the same object" is false on the wire path (Edge+Blind) [packages/shared/src/server-base.ts handleToolCall]
- [x] [Review][Patch] README install-on sections (marker table, self-heal) did not say what happens with the install off; Quick Start and IPM sentences omitted the profile field (Blind) [README.md]
- [x] [Review][Patch] `readProductionGuard` `@returns` did not mention the rethrown `IrisSideNotInstalledError` (Blind) [packages/iris-dev-mcp/src/tools/test-production-guard.ts:65]
- [x] [Review][Patch] Nothing pinned the audit entry of a refused call (`error`, decision #160) (VG gap) [server-base-auto-install.test.ts "the audit entry of a refused call"]
- [x] [Review][Patch] `refusedFor()` fake returned `autoInstallOff: IRIS_GOVERNANCE_PRESET` for every profile, including ones whose install was on, and the lazy test asserted that impossible channel (Rule #54) (VG) [server-base-auto-install.test.ts]
- [x] [Review][Patch] `story-45-2-doc-claims.test.ts` did not check that its dist oracle is fresh (VG) [story-45-2-doc-claims.test.ts]
- [x] [Review][Patch] Missing `mutation:` lines for AC 45.2.6 (doc claims), AC 45.2.5 ledger checker and AC 45.2.3 stderr half (VG) [## Verification below]
- [x] [Review][Defer] Install-off profiles refuse after every server upgrade, not only class-changing ones [bootstrap.ts stale branch; gen-bootstrap.mjs] — deferred: owner decision (frontmatter `deferred:`), the code follows the spec

Rejected:
- low, spec-bound: `unknown` with an older marker logs both the `[WARN]` (which says the install is off) and the `[INFO]` off line; the matrix row requires the INFO line (Auditor).
- low: with the install off, the `newer`/`foreign`/`unknown`/IPM warnings still suggest "delete Setup and restart"; rare, the INFO line beside it says the install is off, and the README table now qualifies the remedies; a fix threads `off` into every remedy (Edge). reopen_if: a user report of following that remedy on an install-off server.
- spec-bound: `missing`/`unconfigured` plus a non-404 InstallGuard read ends `unknown` and is not refused (decisions #158(b), #159; matrix row `unknown`) (Edge).
- low, theoretical: `stop()` then `start()` in one process keeps non-default `profileMeta`, so a rebuilt client is not re-armed; no production caller re-enters `start()` (Edge).
- low, theoretical: an injected `options.config` carrying `autoInstall: false` without a source disagrees with the registry; `loadConfig` never sets the field (Edge).
- low, theoretical: exported `buildIrisSideRefusal` casts `probeStatus`; its one caller checks `customRestRefused` (Edge).
- low, spec-bound: the `[INFO]` text "found X, nothing to install." is the Design Notes wording (Blind).
- by-design: the discovery description does not list the new fields (decision #158(c)); exposing the armed state is new scope (Blind).
- by-design: the changeset test skips once `changeset version` consumes the file, as documented (VG).

## Spec Change Log

- 2026-11-25 (lead, spec gate, decision #158): amendments 1-3 applied to `epics.md` (AC 45.2.1 discovery fields under the wire golden, AC 45.2.2 "never reaches older classes" made precise, AC 45.2.4 both start paths), each tagged. Amendment 4 is a line reference only; no `epics.md` text change. Decisions (a)-(d) accepted as written; (b) because the spine's AD-14 "when" rule binds `unknown` to today's behavior, and the residual equals the owner-accepted IPM-owned stale case (C-4). The observed startup-config/registry mismatch is ledger DW-767 (burndown).

- 2026-11-25 (lead, Planner ruling on decision #158): binding additions, everything else stands. (1) Two real-start-path pins for the gateway refusal: the fake records zero `/api/executemcp/` requests for the refused call, and an Atelier-only tool still works on the refused profile. (2) CHANGELOG Behavior-changes gets a separate bullet under `S-45.2-read-only-no-install`: `iris_execute_tests` and `iris_test_coverage` now refuse on a profile whose IRIS side is not installed while the install is off (today a 404 on their guard read lets them run unguarded). (3) `unknown` stays as today (no write, one warning, tools go on) with: (a) when the marker reads older, including only the ownership/InstallGuard read failing with a non-404, the one warning says plainly the IRIS-side classes are older than this server and may behave differently, and gives the refusal's way out (one start with the automatic install on, or `zpm "install iris-execute-mcp-v2 <semver>"`); (b) the README residuals text lists this case next to the IPM-owned stale case (C-4); (c) a test pins `unknown` + install off (no write, exactly one warning, a custom-REST call runs unrefused) with a proven-red mutation (make `unknown` refuse, or drop the warning).

## Review Triage Log

### 2026-11-25 — Review pass
- verdicts: 24 findings from the three finding layers — high 0, medium 8, low 16, false 0, maybe-false 0; plus 6 descriptive intent-alignment observations (no verdict, one row)
- findings:
  - `[medium]` `patch` Blind: `iris_execute_tests`/`iris_test_coverage` refusal claimed but no test drives the real tools — real (orchestration test uses `iris_global_get` only); patched: extra calls for both real tools on the refused legs.
  - `[low]` `reject` Blind: way-out hints name only the winning channel (`IRIS_AUTO_INSTALL`/profile) though the read-only preset can sit underneath — wording is fixed by the spec's C-2 and the niche combination fails clearly at startup if the operator sets `true`; fix would add preset state to three messages.
  - `[medium]` `patch` Blind: nothing says a restart is needed after the IRIS side is installed (refusal armed once at connect) — real; README (and CHANGELOG clause) now say so; refusal and warning texts are spec-fixed.
  - `[low]` `patch` Blind: whole-call refusal can contradict "Nothing was changed" in the README row when an earlier request of a multi-profile or mixed tool already wrote — real wording inaccuracy; README row rescoped.
  - `[medium]` `patch` Blind: `iris_sql_query` is custom REST and refused on a not-installed profile, but the README read-only paragraph presents it as always usable — real; one sentence added.
  - `[low]` `defer` Blind: sibling docs (`tool_support.md`, client-config pages, launcher README, `packages/shared/README.md` refusal-code table and new exports) do not name `IRIS_AUTO_INSTALL`/`IRIS_SIDE_NOT_INSTALLED` — spec scoped docs to README + CHANGELOG (#43: the closing rollup enriches); recorded in `deferred`.
  - `[low]` `reject` Blind: profile name reaches the refusal through an unchecked cast (`{...config, name} as IrisConnectionConfig`) — works, and the fields test pins `profile`; no reachable defect.
  - `[low]` `reject` Blind: `recordSideRefusal` guards an allowlist of five method names — the same shape as the `bindSignal` precedent; `IrisHttpClient` has no other request method and a new one would meet the prefix gate in `request`.
  - `[low]` `reject` Blind: changeset is `patch` for every package — the spec fixes `patch` ("the Planner raises to minor").
  - `[low]` `reject` Edge: `missing`/`unconfigured` plus a failed ownership read ends as `unknown` and arms no refusal — `unknown` stays as today (decision #158 (b), Planner ruling 3); nothing is written.
  - `[low]` `reject` Edge: IPM-owned `missing`/`unconfigured` side is not refused — the matrix row says IPM-owned behaves as today (C-4).
  - `[low]` `reject` Edge: `current` with an uncompiled class while off is not refused — the matrix says `current` behaves as today (Story 44.4 report unchanged).
  - `[low]` `reject` Edge: gate misses dot-segments, percent-encoding or `/api/executemcp` without a slash — every caller passes a `/api/executemcp/v2...` literal (Rule #56 enumeration), so no real input reaches it (Rule #54).
  - `[low]` `reject` Edge: a refusal after earlier writes in the call is reported as a pure refusal — same root as the README "Nothing was changed" row, handled there.
  - `[medium]` `defer` Edge: `deriveAuditOutcome` records `IRIS_SIDE_NOT_INSTALLED` as `error`, not `denied` — real but it changes an audit-log outcome the spec does not name and the existing precedent is a decision for the lead; recorded in `deferred`.
  - `[low]` `reject` Edge: `record()` map is keyed by the wire view so "asking for the same profile twice returns the same object" is not true on the wire path — pre-existing `bindSignal` behavior (a fresh view per call); nothing in this diff compares identity there.
  - `[medium]` `patch` Edge: the refusal is armed once and never cleared until restart — same root as the restart note above.
  - `[low]` `reject` Edge (claim): wrapping `ctx.http` in a Proxy on every call changes identity with the install on — the full suites and the byte-identity pins are green and `instanceof`/methods are preserved.
  - `[low]` `reject` Edge (claim): startup passes `this.config` plus the setting — DW-767, observed and already ledgered.
  - `[medium]` `patch` Verification-gap: real `iris_execute_tests`/`iris_test_coverage` never driven against a refused profile — same root as the first row.
  - `[medium]` `patch` Verification-gap: `resolve-profile-client.test.ts` now compares the server cache with itself — replaced with a real relation to the cached client.
  - `[medium]` `patch` Verification-gap: no `mutation:` line for the conflict/malformed throws, roster fields, lazy-path arming, the later-request guard, the `resolveProfileClient` wrapping, the `olderOff` wording and the password pins — each mutation run and recorded.
  - `[low]` `patch` Verification-gap: a unit test builds an `unknown` result the real bootstrap cannot return — uses the real shape.
  - `[low]` `reject` Verification-gap: the `ExtraCall` cast reads `structuredContent` unchecked — a missing shape fails the test, so it cannot pass wrongly.
  - Intent-alignment (descriptive, no verdict; none routed): (1) the gateway holds the mechanism and bootstrap/framework arm it, by the spec's design (setter on `IrisHttpClient`); (2) the per-call recorder is a second layer in `http-client.ts`, by design; (3) DW-767 mismatch of startup config and registry `default`, ledgered; (4) `unknown` after a failed ownership read on a stale side is not refused, per ruling 3; (5) the tests run against a stateful fake plus the recorded throwaway proof, not a live IRIS in the default suite, per the spec; (6) `iris_execute_tests`/`iris_test_coverage` refusal is decision (a), now pinned.

## Design Notes

**Governing ADs:** AD-1 (one gateway: the refusal lives in `IrisHttpClient`), AD-8 (fail fast naming the variable; one establishment path per profile), AD-9 (channels, non-inheritance, operator controls), AD-14 (bootstrap OFF path, IPM ownership, the compile check on `current`), AD-15 (`S-45.2-read-only-no-install`; additive discovery fields; back-compat pin), AD-31 (no IRIS-side change; operator policy is separate).

**Probe record (2026-11-25).** Source: every custom-REST request is a `/api/executemcp/v2...` path literal passed to `ctx.http` (Code Map enumeration); there is no other client or `fetch`. The probe's reads are `SqlProc` queries of `Setup.cls` (`GetBootstrapVersion`, `IsConfigured`; both read-only) and Atelier `GET doc` for `Setup` and `InstallGuard`. Throwaway `intersystems/irishealth-community:2026.2@sha256:462de1fb…af0a`, `HSCUSTOM`, unseeded, port 52792; removed afterwards, `docker ps -a --filter label=iris-mcp.owner=throwaway` empty:
- Before: 0 `ExecuteMCPv2.*` classes, no `/api/executemcp/v2`, no `%ALL`, no `%ALL` mapping, `^UnitTestRoot` undefined in `HSCUSTOM` and `USER`.
- The built `iris-dev-mcp` (`1.2.0+8.5cedcac20ae9`) started with `IRIS_GOVERNANCE_PRESET=read-only` deployed and compiled, configured the web application, mapped the package and set `^UnitTestRoot` (`/usr/irissys/mgr/`) — issue #1 point 3 reproduced. After: 35 classes, web app present, `%ALL` present, mapping `%ALL`/`ExecuteMCPv2`, `^UnitTestRoot` set in `HSCUSTOM` only.
- Snapshot oracles, all answered HTTP 200 through Atelier `action/query` as `_SYSTEM`: `SELECT COUNT(*) AS N FROM %Dictionary.ClassDefinition WHERE ID %STARTSWITH 'ExecuteMCPv2.'` (namespace); in `%SYS`: `SELECT Name FROM Security.Applications WHERE Name = '/api/executemcp/v2'`, `SELECT Name FROM Config.Namespaces WHERE Name = '%ALL'` (answers two identical rows when present: test existence, not count), `SELECT Namespace, Name FROM Config.MapPackages WHERE Namespace = '%ALL'`; `SELECT Name, Value FROM %Library.Global_Get(?, '^UnitTestRoot')` with the namespace (no row when undefined).

**Refusal and log wording (C-2).** Text: `The ExecuteMCPv2 service on IRIS is not available to server profile "<p>": <finding>. The automatic install is off for this profile (<source>), so this server installs, upgrades and repairs nothing on IRIS; tools that use only the Atelier API keep working. To use this tool, an operator installs or upgrades the IRIS side once: start one server against <host>:<port> <way-out>, or run zpm "install iris-execute-mcp-v2 <semver>" in '<ns>' as a user with %Admin_Manage. An instance that only read-only servers use needs this once after every release that changes the IRIS-side classes.` Findings: missing `the ExecuteMCPv2 classes are not installed in '<ns>'`; stale `the ExecuteMCPv2 classes in '<ns>' are from an older build (<deployed>; this server needs <BOOTSTRAP_VERSION>)`; unconfigured `the ExecuteMCPv2 classes in '<ns>' are current, but the /api/executemcp/v2 web application is not registered (Do ##class(ExecuteMCPv2.Setup).Configure("<ns>") as a user with %Admin_Manage also fixes this)`. `<source>`/`<way-out>`: preset `IRIS_GOVERNANCE_PRESET=read-only` / `without the read-only preset`; variable `IRIS_AUTO_INSTALL=false` / `with IRIS_AUTO_INSTALL unset or true`; profile `autoInstall: false in IRIS_PROFILES` / `with the profile's autoInstall removed or true`. The `[WARN]` startup line uses the same finding, source and way out; the `[INFO]` line for the other branches is `Bootstrap: the automatic install is off for profile "<p>" (<source>); found <status>, nothing to install.` CHANGELOG and README carry the upgrade note: "After upgrading the servers to a release that changes the IRIS-side classes (1.3.0 is one), an instance that only read-only servers, or servers with the automatic install off, connect to refuses its custom-REST tools with `IRIS_SIDE_NOT_INSTALLED` until an operator upgrades the IRIS side once: one start with the automatic install on, or `zpm`. Upgrading is a deliberate admin step." The release notes are the Planner's, at `1.3.0`.

**Decisions.** (a) A call that sends any custom-REST request on a refused profile refuses, so `iris_execute_tests`/`iris_test_coverage` on a `missing` side refuse where today their guard's 404 let them run unguarded (inside S-45.2). (b) `unknown` keeps today's behavior even when the marker read as older and only the ownership read failed (the AC's literal rule; nothing is written either way). (c) The discovery description is not changed (no tools-list churn); the README roster bullet names the fields. (d) The golden ledger entries reuse `S-45.2-read-only-no-install` (the 44.1 precedent of additive fields under the story's sanction).

**Observed, not changed:** the startup bootstrap passes `this.config` (the `IRIS_*` values) while the `default` client uses the registry profile, which an `IRIS_PROFILES` `default` entry can override; changing that would move behavior outside AD-15's unused-feature pin, so this story only adds the resolved `autoInstall` to what it passes.

**epics.md amendments for the lead:**
1. AC 45.2.4 names the start path `McpServerBase.start → establishProfile → bootstrap`. The `default` profile bootstraps inline in `start()` (`server-base.ts:2979`); non-default profiles, and a `default` whose start-time health check failed, go `getOrCreateClient → establishProfile → attemptProfileBootstrap → bootstrap`. Both paths are armed and the proof covers both (startup and the lazy `other` profile).
2. AC 45.2.2 "the call never reaches older classes" / "no tool reaches the custom REST service by another path": true for tool calls once the gate exists, but `iris_execute_tests` also calls `ExecuteMCPv2.Setup_EnsureUnitTestRoot()` through Atelier `action/query`; it is reached only after its custom-REST guard read, which the gateway refuses, and the per-call recorder stops every later request. The bootstrap probe itself calls the deployed `Setup` class's `GetBootstrapVersion`/`IsConfigured` (reads) on a stale side. The off-path request list also includes two Atelier `GET doc` reads (`Setup`, `InstallGuard`), not only `SqlProc` queries.
3. AC 45.2.1 discovery fields are additive (AD-15) but the frozen wire golden holds the `iris_server_profiles` output of all five servers, so they ship with sanctioned-change ledger entries; AC 45.2.5's byte-identity covers startup requests, `BootstrapResult` and every pre-existing output field.
4. AC 45.2.6 cites the IPM section's "hands it back" sentence; it is at `README.md:367` (the uninstall note is :371).

**Extend, don't copy:** resolution mirrors `data-policy.ts` (separate module, reason above); the boolean variable parse follows `IRIS_SQL_READ_ONLY`; the per-call recorder extends `bindSignal`'s Proxy; the hermetic test extends `bootstrap-guard-legs.ts` and the stateful fake; the live block extends the 42.2 live gate.

**Integration ACs:** Consumers: every custom-REST tool of the five servers (e.g. `iris_global_get` answers `IRIS_SIDE_NOT_INSTALLED` against the fake, orchestration test) and `iris_server_profiles` (roster fields). Consumes: the bootstrap probe, `IrisHttpClient`, the stateful fake and a real throwaway. Consumed-by: Story 45.3 (its uninstall docs rely on `IRIS_AUTO_INSTALL=false`), Story 45.5 (capstone point 3 replays the read-only start; README "What the safety settings protect" points here).

## Verification

Shared surfaces: `REFUSAL_CODES` (catalog test, README refusal table), the discovery roster (`server-discovery.test.ts`, data-policy server/startup tests, wire golden), `IrisConnectionConfig`/`IrisProfile` shape (profiles tests), the startup log, `bootstrap-guard-legs.ts`, the 42.2 live gate (CI `bootstrap-guard` suite), `CHANGELOG.md`, README doc-claim tests. Every test added or changed passes on a fresh environment, in either order.

**Commands** (foreground, `timeout: 600000`, one test file per call where a run could exceed it):
- `pnpm build` -- expected: success.
- `pnpm --filter @iris-mcp/shared test` -- expected: green.
- `IRIS_HOST=127.0.0.1 IRIS_PORT=1 IRIS_NAMESPACE=HSCUSTOM IRIS_HTTPS=false IRIS_TEST_HOST=127.0.0.1 IRIS_TEST_PORT=1 pnpm --filter @iris-mcp/all test` (`IRIS_REQUIRE_LIVE` unset; the FULL suite, split into file batches if one call cannot finish) -- expected: green, before the commit.
- Each server package's own tests under the same env (`pnpm --filter @iris-mcp/dev test`, `admin`, `interop`, `ops`, `data`) -- expected: green.
- `pnpm gen:ipm:check`, `pnpm gen:governance-baseline:check`, `pnpm gen:tools-list-snapshot:check`, `pnpm run gen:bootstrap` (no diff) -- expected: OK.
- Throwaway: `node scripts/throwaway-iris.mjs up --image intersystems/irishealth-community:2026.2@sha256:462de1fb3597272fde0e03afad006af1b18b59c90f1c1fb5566c79b027a7af0a --namespace HSCUSTOM --host-port 52792 --state <scratch file>` (unseeded: do NOT run `ci-seed-throwaway.mjs` before the live proof); `... exec --state <f> -- node <scratch live-proof script>`; `... down --state <f>`. Then a second fresh unseeded container the same way (new state file) for `... exec --state <f2> -- pnpm --filter @iris-mcp/all exec vitest run src/__tests__/story-42-2-bootstrap-guard-live-gate.test.ts` -- expected: green (the ON legs unchanged on a real instance; the gate needs an instance with no IRIS side, so never reuse the first container); `... down --state <f2>`. After each: `docker ps -a --filter label=iris-mcp.owner=throwaway` empty. One container at a time, port 52792.

**Mutations (Rule 19), record each as `mutation: <change> -> <red>`:**
- AC 45.2.1/45.2.4: remove the read-only branch of `resolveAutoInstall` -> orchestration read-only legs red (PUTs sent) and the auto-install unit precedence test red.
- AC 45.2.2: remove the prefix gate in `IrisHttpClient` -> the custom-REST leg red (request reaches the fake, no refusal code).
- AC 45.2.2: drop the framework's refusal substitution -> the swallowed-error unit test red.
- AC 45.2.5: make `BootstrapResult` carry `autoInstallOff` when on -> the ON-vs-unset byte-identity test red; resolve unset as off -> the 42.2 orchestration upgrade legs red.
- AC 45.2.1: let a profile inherit `autoInstall` from the `default` entry -> the non-inheritance test red.

### Recorded results (implementation, 2026-11-25)

**Automated.** `pnpm turbo run build --force` ok; `pnpm type-check` and `pnpm lint` ok; `@iris-mcp/shared` 95 files / 2809 tests green; `dev` 1576, `admin` 518, `interop` 754, `ops` 350, `data` 231 green (closed-port env); the FULL `@iris-mcp/all` suite 243 of 244 files green on the final tree, the one failure (`qa-42-9-doc-claims`, two new README lines naming `zpm "install ..."` without the 1.1.0 qualifier) fixed in the README and re-run green together with every `doc-claims`/`changelog`/`readme` file (43 files, 796 tests). `gen:ipm:check`, `gen:governance-baseline:check`, `gen:tools-list-snapshot:check` OK; `pnpm run gen:bootstrap` "not rewritten", `BOOTSTRAP_VERSION` stays `1.2.0+8.5cedcac20ae9`. New tests: `auto-install.test.ts` (24), `bootstrap-auto-install.test.ts` (47), `http-client-side-refusal.test.ts` (14), `server-base-auto-install.test.ts` (23), `story-45-2-auto-install-orchestration.test.ts` (22). The 42.2 hermetic orchestration test (38) and the wire/handler goldens pass with their frozen fixtures unchanged apart from the 10 new ledger entries (`45.2/discovery-roster/<server>`, `45.2/discovery-text/<server>`, registered in `story-43-4-sanctioned-golden-changes.test.ts`).

**Live proof (throwaway, unseeded, `intersystems/irishealth-community:2026.2@sha256:462de1fb...af0a`, `HSCUSTOM`, port 52792; the shared instance was never touched).** Scratch script run through `throwaway-iris.mjs exec`; oracles are the five Design-Notes queries over Atelier `action/query` as `_SYSTEM`.
- Snapshot before: `classes: 0`, `webApp: []`, `allNamespacePresent: false`, `mapping: []`, `unitTestRoot: []`.
- Built `iris-dev-mcp` with `IRIS_GOVERNANCE_PRESET=read-only` over a real MCP stdio session: `iris_global_get` -> `isError`, `code: "IRIS_SIDE_NOT_INSTALLED"` (text: `The ExecuteMCPv2 service on IRIS is not available to server profile "default": the ExecuteMCPv2 classes are not installed in 'HSCUSTOM'. The automatic install is off ...`); `iris_server_info` -> success; one `[WARN] Bootstrap: the automatic install is off for profile "default" (IRIS_GOVERNANCE_PRESET=read-only): ...`.
- Snapshot after the read-only run: identical to the first (`snapshotsEqual: true`).
- The same build started once without the preset: `Bootstrap: REST service not found, running full install`, `deployed 35 classes`, compiled, web application configured, mapped, `^UnitTestRoot ensured in 'HSCUSTOM' (value: /usr/irissys/mgr/)`; snapshot after: `classes: 35`, `webApp: [{Name: "/api/executemcp/v2"}]`, `allNamespacePresent: true`, `mapping: [{Namespace: "%ALL", Name: "ExecuteMCPv2"}]`, `unitTestRoot: [{Name: "^UnitTestRoot", Value: "/usr/irissys/mgr/"}]`. No warning.
- A second fresh unseeded container (new state file, same port): `story-42-2-bootstrap-guard-live-gate.test.ts` 13 of 13 green (ON legs unchanged on a real instance). Both containers removed with `down`; `docker ps -a --filter label=iris-mcp.owner=throwaway` empty afterwards.

**Mutations (each applied, run, observed red, reverted byte-identical with `cmp` against a copy taken before; the shared dist rebuilt after each change).**
- `mutation: remove the read-only branch of resolveAutoInstall -> red`: unit `resolveAutoInstall ... the read-only preset forces it off` and `applyAutoInstall ... the read-only preset turns every profile off` (2 failed); orchestration 7 failed, among them every `preset via startup|other, missing|stale` leg (the server sent 39 and 37 writes, `expected [ ...(39) ] to deeply equal []`).
- `mutation: remove the prefix gate in IrisHttpClient (assertCustomRestAllowed body emptied) -> red`: `http-client-side-refusal` + `server-base-auto-install` 15 failed; orchestration 14 failed (`the refused call sent nothing to /api/executemcp/: expected [ Array(1) ] to deeply equal []`, no refusal code).
- `mutation: drop the framework's refusal substitution (refusedResult always undefined) -> red`: `server-base-auto-install` 6 failed (the swallowed-error test, the mixed-tool test, the throw-after-refusal test, both per-profile tests and the base refusal test); orchestration 14 failed.
- `mutation: BootstrapResult carries autoInstallOff when the install is on -> red`: `bootstrap-auto-install` `ON equals unset, byte for byte, on every branch` red on all 7 branches (`strictly equal ... (9)` vs `(8)` members).
- `mutation: resolve an unset autoInstall as off (config.autoInstall !== true) -> red`: ON-versus-unset unit rows 8 failed, and `story-42-2-bootstrap-guard-orchestration.test.ts` 10 failed (older-sequence, legacy-bare-hash, current-after-upgrade, the race rows, the unknown rows that expect an install).
- `mutation: a profile inherits the default entry's own autoInstall -> red`: `auto-install.test.ts` `never inherits the default entry's value: default off (IRIS_PROFILES), p2 on (default)` (1 failed).
- Planner ruling (decision #158), `unknown` + install off: `mutation: make unknown refuse (customRestRefused = true on the unknown branch) -> red`: `bootstrap-auto-install` 3 failed (`unknown: as today, plus one INFO line, and no refusal` x3 channels) and the orchestration `unknown ... a custom-REST call is NOT refused` (`the custom-REST call ran: it reached the instance: expected 0 to be greater than 0`). `mutation: drop the unknown warning (warnDeploymentLeftAlone removed on that branch) -> red`: `bootstrap-auto-install` 3 failed and the orchestration unknown test (`exactly one warning: expected [] to have a length of 1 but got +0`).

**Review round 1 (lead), additions.** The orchestration test now also drives the real `iris_execute_tests` (level `class`, so it reaches the guard read; a package target stops earlier at package discovery) and `iris_test_coverage` on every `missing` and `stale` leg (all three channels, startup and lazy `other`), with `IRIS_GOVERNANCE={"global":{"iris_execute_tests":true,"iris_test_coverage":true}}` (both are default-disabled writes; the explicit `true` enables them, over the read-only preset too). Each returns the same `IRIS_SIDE_NOT_INSTALLED` structuredContent as `iris_global_get`, with zero `/api/executemcp/` requests and zero `/work` or `Setup_EnsureUnitTestRoot` requests. `test-production-guard.test.ts` gains two tests (`readProductionGuard` rethrows the refusal; `iris_execute_tests` rejects at the guard read with no later call). `resolve-profile-client.test.ts` now relates the view to the server's cached client with a marker set on the cached client. `server-base-auto-install.test.ts` uses the real `unknown` result shape (`deployed: false`, `readFailure` set). Only `vitest run <file>` was used; shared `src` mutations were run through the shared unit tests, which import `src`.
- `mutation: readProductionGuard swallows the refusal (returns undefined for IrisSideNotInstalledError) -> red`: `test-production-guard.test.ts` 2 failed (`promise resolved "undefined" instead of rejecting`; the handler resolved instead of rejecting). Note: the orchestration legs stay green under this mutation by design, because the per-call recorder still refuses every later request and the framework still answers with the refusal; the dist-level orchestration run could not be re-mutated without a rebuild, so this guard-level unit test is what pins it.
- `mutation: IRIS_AUTO_INSTALL=true + read-only no longer throws -> red`: `auto-install.test.ts` 1 + `server-base-auto-install.test.ts` 1 failed. `mutation: profile autoInstall:true + read-only no longer throws -> red`: 3 failed (2 unit, 1 startup row). `mutation: malformed IRIS_AUTO_INSTALL no longer throws -> red`: 2 failed.
- `mutation: buildRosterEntry drops autoInstall/autoInstallSource -> red`: `server-discovery.test.ts` (roster allow-list) + `server-base-auto-install.test.ts` discovery row, 2 failed.
- `mutation: attemptProfileBootstrap does not arm the client (lazy path only) -> red`: `server-base-auto-install.test.ts` 2 failed (the lazy `p2` leg and the per-profile leg). Run at unit level, not in the orchestration, because the built dist cannot be rebuilt in this round.
- `mutation: recordSideRefusal no longer throws the recorded refusal on later requests -> red`: `http-client-side-refusal.test.ts` 1 + `server-base-auto-install.test.ts` mixed-tool test 1 failed.
- `mutation: handleToolCall does not wrap resolveProfileClient results in record(...) -> red`: `server-base-auto-install.test.ts` per-profile leg 1 failed, plus `resolve-profile-client.test.ts` identity row 1 failed.
- `mutation: the olderOff wording branch of warnDeploymentLeftAlone disabled -> red` and `mutation: leftToIpm no longer passes olderOff through -> red`: `bootstrap-auto-install.test.ts` 1 failed each (`a stale deployment whose ownership cannot be read ... says the classes are older`).
- `mutation: config.password added to the refusal text -> red`: `bootstrap-auto-install.test.ts` 4 failed (the three `the password never reaches ...` rows and the exact-text row) and `server-base-auto-install.test.ts` 1 failed.
- `mutation: ctx.resolveProfileClient builds its own IrisHttpClient -> red`: `resolve-profile-client.test.ts` 2 failed.
- Every mutation was reverted with `cp` from a copy taken before and checked with `cmp` (identical); `git status` shows no change to those source files beyond the story's own.

**Code review (2026-11-25), additions.** Each mutation applied with the Edit tool, run, restored from a copy and checked with `cmp` (identical); the dists rebuilt (`pnpm turbo run build --force`) after the last restore. The refusal text now differs from the Design Notes C-2 template in two sentences (lead directive: the C-2 note must reach a `stale` reader): "Then restart this server: the refusal is decided when the profile connects." and "After every upgrade of the servers (each release stamps its version into the IRIS-side classes), an instance that only read-only servers, or servers with the automatic install off, connect to needs this once: upgrading the IRIS side is a deliberate admin step."; the `[WARN]` way out ends "then restart this server.".
- `mutation: the refusal's last sentence back to "An instance that only read-only servers use needs this once after every release that changes the IRIS-side classes." -> red`: `bootstrap-auto-install.test.ts` 2 failed (`missing: the fields ... and the upgrade note`, `stale: ... older-build finding`).
- `mutation: drop "Then restart this server ..." from the refusal and ", then restart this server." from the [WARN] line -> red`: `bootstrap-auto-install.test.ts` 11 failed (the 9 OFF-branch legs x channel, and both `buildIrisSideRefusal` rows).
- `mutation: buildIrisSideRefusal names IRIS_GOVERNANCE_PRESET whatever the channel -> red`: `server-base-auto-install.test.ts` lazy-default leg (expects `IRIS_AUTO_INSTALL`; it was green before the review because the fake returned the preset).
- `mutation: deriveAuditOutcome maps IRIS_SIDE_NOT_INSTALLED to denied -> red`: `server-base-auto-install.test.ts` `the audit entry of a refused call` (AC 45.2.2 audit pin, decision #160).
- `mutation: the changeset's ops bump back to patch -> red`: `story-45-2-doc-claims.test.ts` `the changeset ... minor` (AC 45.2.6, decision #160).
- `mutation: the README upgrade note back to "After upgrading the servers to a release that changes the IRIS-side classes (1.3.0 is one)" -> red`: `story-45-2-doc-claims.test.ts` README read-only section row (AC 45.2.6).
- `mutation: the 45.2/discovery-roster/dev ledger entry's new value without autoInstallSource -> red`: `story-43-4-sanctioned-golden-changes.test.ts` `the ledger > every sanction is registered with a shape ...` (AC 45.2.5, the `S-45.2-read-only-no-install` shape checker).
- `mutation: touch packages/shared/src/refusals.ts after the build (content unchanged) -> red`: `story-45-2-doc-claims.test.ts` `the oracle > is a fresh build of the shared package`.
- `mutation: the [WARN] line appends config.password (the log half of AC 45.2.3; the refusal half was pinned before) -> red`: `bootstrap-auto-install.test.ts` `the password never reaches a log line, the result or the refusal` x3 channels.

## Auto Run Result

Status: done
Blocking condition: none

**Summary.** The automatic install is now a per-profile setting (`IRIS_AUTO_INSTALL`, per-profile `autoInstall`, read-only preset forces off, explicit "on" with the preset fails startup). With it off, bootstrap sends reads only on every branch; on a `missing`, `stale` or `unconfigured` side the profile's `IrisHttpClient` refuses every `/api/executemcp/` request before any I/O and the framework answers with `IRIS_SIDE_NOT_INSTALLED`, even when a handler swallowed the error. `iris_server_profiles` rows gain `autoInstall` and `autoInstallSource`. No `.cls` changed (`BOOTSTRAP_VERSION` stays `1.2.0+8.5cedcac20ae9`). Planner ruling on decision #158 folded in: gateway pins through the real start path, the CHANGELOG bullet for `iris_execute_tests`/`iris_test_coverage`, and `unknown` kept as today with the older-marker warning wording, README residual and a pinned, mutation-verified test.

**Files changed.**
- `packages/shared/src/auto-install.ts` (new) -- resolution, parse and conflict errors.
- `packages/shared/src/{config,profiles,errors,refusals,http-client,bootstrap,server-base,server-discovery,index}.ts` -- field, error class, refusal code, prefix gate and per-call recorder, off path and refusal builder, arming on both bootstrap paths, roster fields.
- `packages/shared/src/__tests__/{auto-install,bootstrap-auto-install,http-client-side-refusal,server-base-auto-install}.test.ts` (new) and updates to `env-harness`, `refusals`, `resolve-profile-client`, `server-discovery`, `startup-env`.
- `packages/iris-dev-mcp/src/__tests__/test-production-guard.test.ts` -- pins the guard read rethrowing the refusal.
- `packages/iris-mcp-all/src/__tests__/story-45-2-auto-install-orchestration.test.ts` (new), `bootstrap-guard-legs.ts` (`runServerCalls`), `story-43-4-sanctioned-golden-changes.test.ts`, `fixtures/sdk-golden-sanctioned-changes.json` (10 entries under `S-45.2-read-only-no-install`).
- `README.md`, `CHANGELOG.md`, `.changeset/story-45-2-auto-install-setting-off-under-read-only.md`.

**Review.** 24 findings from three layers plus 6 descriptive intent observations (rows in `## Review Triage Log`): patches applied 7 (5 medium, 2 low: real-tool orchestration legs, resolve-profile-client self-comparison, impossible `unknown` fixture, missing mutation records, README refusal-row scope, README `iris_sql_query` caveat, README/CHANGELOG restart note); deferred 2 (sibling docs, low; audit outcome `error` vs `denied`, medium); rejected 15 with reasons in the log.

**Follow-up review recommended: true.** Five medium findings were patched. The risk to check: the patch round ran source mutations in the working tree and restored them byte-identical (`cmp`), and added real-tool orchestration legs that enable the two default-disabled tools through `IRIS_GOVERNANCE`; the final full runs below are green, but the patched legs and the new guard unit test were reviewed only by the lead's triage, not by a second layer pass.

**Verification performed.** `pnpm build`, `pnpm lint`, `pnpm type-check` ok; `pnpm check:live-guards` (75 armed files, 0 findings), `gen:governance-baseline:check`, `gen:ipm:check`, `gen:tools-list-snapshot:check` (115 entries), `node scripts/check-epics-sync.mjs` ok; `gen:bootstrap` unchanged (35 classes). Closed-port env, after the review patches: `@iris-mcp/shared` 95 files / 2809 tests, `@iris-mcp/dev` 84 files / 1578 passed (344 skipped), full `@iris-mcp/all` 244 files / 6522 passed (737 skipped, live-only), all green. Live throwaway proof, mutation records and the 42.2 live gate (13 of 13) are under `## Verification` above; both throwaways removed, label filter empty.

**Residual risks.** DW-767 (startup bootstrap uses `this.config` while an `IRIS_PROFILES` `default` entry can differ) is unchanged and ledgered. `unknown` with install off keeps serving older classes with one warning, and an IPM-owned stale side likewise (C-4). The refusal is decided at connect and cleared only by a restart (documented). The implementation round used `perl -pi` and one node script for the ledger (Rule #55 deviation, each verified by tests and `git diff --stat`).
