---
title: 'Story 45.2: Auto-Install Setting, Off Under Read-Only'
type: 'feature'
created: '2026-11-25'
status: 'ready-for-dev'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-45-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-iris-execute-mcp-v2-2026-10-14/ARCHITECTURE-SPINE.md'
warnings: ['oversized']
deferred: []
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

## Spec Change Log

- 2026-11-25 (lead, spec gate, decision #158): amendments 1-3 applied to `epics.md` (AC 45.2.1 discovery fields under the wire golden, AC 45.2.2 "never reaches older classes" made precise, AC 45.2.4 both start paths), each tagged. Amendment 4 is a line reference only; no `epics.md` text change. Decisions (a)-(d) accepted as written; (b) because the spine's AD-14 "when" rule binds `unknown` to today's behavior, and the residual equals the owner-accepted IPM-owned stale case (C-4). The observed startup-config/registry mismatch is ledger DW-767 (burndown).

## Review Triage Log

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

## Auto Run Result

Status: ready-for-dev
Blocking condition: none (halted after planning, as directed)
