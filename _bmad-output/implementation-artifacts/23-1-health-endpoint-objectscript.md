# Story 23.1: ObjectScript `/monitor/health` Endpoint

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an **operator**,
I want **one server-side round-trip that gathers all requested health areas with per-area fault isolation**,
so that **`iris_health_check` is fast (one HTTP call) and a single failing probe cannot fail the whole request.**

This story writes the **ObjectScript half** of `iris_health_check`: a new `HealthCheck` handler + `GET/POST /monitor/health` route that returns **raw per-area values only** (no threshold logic — that lives in the TS verdict engine, Story 23.2). Every probe API was pinned in Story 23.0; **code against the amended spec `research/feature-specs/01-health-check.md` §3 table, not assumptions.**

## Acceptance Criteria

- **AC 23.1.1** — New `Dispatch.cls` UrlMap route `GET/POST /monitor/health` → new `HealthCheck` handler (in `Monitor.cls`; extract to a new `Health.cls` ONLY if `HealthCheck` + helpers would push `Monitor.cls` past ~400 added lines — measure, then decide). Handler follows conventions §3 non-negotiables: `Set tSC=$$$OK`; result var initialized before Try; Try/Catch with argumentless `Quit`; namespace **save/restore** `Set tOrigNS=$NAMESPACE` / `Set $NAMESPACE="%SYS"` / restore before ANY error handling or render (NEVER `New $NAMESPACE` — basics rule + Rule #7); **exactly one** `RenderResponseBody` per request (error-flag + single dispatch after Try/Catch); error text via `##class(ExecuteMCPv2.Utils).SanitizeError(tSC)`; **no `^`caret-global names** inside any error string (Rule #33 strips them). Response shape EXACTLY: `{ "areas": { "<area>": { ...raw... }, ... }, "errors": { "<area>": "<sanitized msg>" } }`.
- **AC 23.1.2** — **Per-area Try/Catch isolation**: each area probe runs in its own Try/Catch; a thrown error puts a sanitized string in `errors["<area>"]` (TS maps to `level:"error"`) and the area is omitted/empty in `areas` — the request still returns 200 with all OTHER areas intact. **Area filtering** honored: caller passes a subset (POST body `areas` array or `?areas=journal,license`); only those areas are probed; default = all 9 areas. **Non-configured areas return distinguishable `notApplicable` markers in `areas` (raw), NOT errors**: `mirror` when `$SYSTEM.Mirror.IsMember()=0`; `ecp` when `$SYSTEM.ECP.GetClientIndex("test")=-1`; `interop` when the `Ens.Director.GetProductionStatus()` gate errors (namespace has no Ens classes) — the interop gate MUST run FIRST and emit a raw `interopEnabled:false` signal; it must NOT fall into the per-area error catch (else §5 AC 4 breaks). `databases` per-DB `notApplicable` when `maxSize=0` or `mounted=0`.
- **AC 23.1.3** — `%UnitTest` coverage (extend `%UnitTest.TestCase` in the existing test package; discover via `iris_doc_list` filter `ExecuteMCPv2.Test`): (a) per-area success — each area returns its pinned raw fields; (b) per-area error isolation — a forced/probeable failure in one area yields an `errors[area]` entry with other areas intact; (c) area filtering — a subset request returns exactly that subset. **Rule #35: compare returned `total` against the expected method count on every `iris_execute_tests` run; rerun/verify per-class if short.**
- **AC 23.1.4** — Deploy loop per conventions §3: `iris_doc_load path="c:/git/iris-execute-mcp-v2/src/**/*.cls" compile=true namespace=HSCUSTOM` (glob-prefixed — Rule #17); `%UnitTest` suite green with full count; `pnpm run gen:bootstrap` regenerated (NEVER hand-edit `bootstrap-classes.ts` — Rules #18/#24); `BOOTSTRAP_VERSION` from→to recorded in this story; `bootstrap.test.ts` green; **frozen governance baseline `1e62c5ad5bf7` untouched** (`gen:governance-baseline:check` exit 0 — this story adds NO governance key; the `iris_health_check` key ships in Story 23.2's TS tool).

## Integration ACs

This story introduces a **producer** — the `GET/POST /monitor/health` REST endpoint. Its **in-story** integration exercise is **AC 23.1.3**: the `%UnitTest` suite is a real consumer that calls `HealthCheck` and asserts on the returned raw per-area shape (per-area success, per-area error isolation, area filtering) against live IRIS. Its first **cross-layer** consumer (the `iris_health_check` TypeScript tool that parses this endpoint's `{areas, errors}` payload into a verdict) is **Story 23.2** — so the full producer→consumer wire-up is proven when 23.2's live smoke drives the built tool against this deployed route. No TS consumer exists yet in this story (Rule 1 escape clause: first consumer = Story 23.2).

## Tasks / Subtasks

- [x] **Task 1 — Read the pinned spec + existing handler patterns** (AC: 23.1.1, 23.1.2)
  - [x] Read `research/feature-specs/01-health-check.md` §3 table (fully pinned by Story 23.0) — it names the exact method/property per area. This is the authoritative contract.
  - [x] Open `src/ExecuteMCPv2/REST/Monitor.cls` and read the existing `SystemMetrics`, `JournalInfo`, `MirrorStatus`, `LicenseInfo`, `ECPStatus`, `SystemAlerts`, `DatabaseCheck` methods + `Config.cls:DatabaseList` + `Interop.cls:QueueStatus`/`ProductionStatus` — **mirror their exact system-class calls** (do NOT re-derive). Open `Dispatch.cls` and copy an existing `/monitor/...` route end-to-end as the route template.
- [x] **Task 2 — Implement the `HealthCheck` handler** (AC: 23.1.1, 23.1.2)
  - [x] Add `HealthCheck` (measured Monitor.cls at ~475 added lines — over the ~400 guideline, so extracted to new `Health.cls` per the story's own escape clause; see Decisions). Parse the requested `areas` subset (default all 9: `system, databases, journal, mirror, locks, license, ecp, alerts, interop`). Namespace-switch to `%SYS` once, gather all requested areas, restore namespace, single render.
  - [x] One `Try/Catch` **per area**, each appending either raw values to `areas` or a `SanitizeError` string to `errors`. Follows the §3 pin for each area precisely (`locks` = `##class(SYS.Lock).GetLockSpaceInfo()` → CSV `Available,Usable,Used`; `interop` gate FIRST, in the original namespace, before the `%SYS` switch).
  - [x] Per §3 carry-in notes: **`databases`** returns `{size,maxSize,mounted,openFailed}` per DB — `openFailed` distinguishes a genuine `%OpenId` throw from unlimited-size `notApplicable` (**CR 23.0-5**). **`license`** returns `CSPUsers()`+`GetUserLimit()` raw AND also `SYS.Stats.Dashboard.LicenseCurrent`/`LicenseCurrentPct` so 23.2 can prefer the authoritative figure (**CR 23.0-2**).
- [x] **Task 3 — Add the Dispatch route** (AC: 23.1.1)
  - [x] Added `GET/POST /monitor/health` to `Dispatch.cls` UrlMap → `ExecuteMCPv2.REST.Health:HealthCheck`. Matches the existing `/monitor/...` route declaration style.
- [x] **Task 4 — `%UnitTest` coverage** (AC: 23.1.3)
  - [x] Discovered the existing test package (`ExecuteMCPv2.Tests.*`, matches filter `ExecuteMCPv2.Test`); added `HealthCheckTest.cls` extending `%UnitTest.TestCase` (no `%OnNew` override needed — mirrors the `GlobalTest.cls` precedent of relying on the parent's default `initvalue` handling; no extra instance state required). Covers per-area success (9 tests), per-area error isolation (1 test), area filtering (3 tests), plus `AreaErrorText` sanitization (1 test) = 14 tests, all in the existing `ExecuteMCPv2.Tests` package. 279 lines (≤500). No underscores in method names.
- [x] **Task 5 — Deploy loop + bootstrap** (AC: 23.1.4)
  - [x] `iris_doc_load` (glob path) → compiled clean on HSCUSTOM → `iris_execute_tests` (verified `total`=14 matches expected method count directly; the broader package-level run hit the documented Rule #35 partial-snapshot behavior twice (34/228, then 42/228, both 0 failures) — confirmed authoritative via the `%UnitTest_Result.TestMethod` SQL fallback: 228/228 passed, 0 failed, for both full runs) → `pnpm run gen:bootstrap` (had to add `Health.cls` to the hardcoded class list in `scripts/gen-bootstrap.mjs` — see Decisions) → `BOOTSTRAP_VERSION` `e931a96373f0` → `13b4b5f003ab` (idempotent on rerun) → `bootstrap.test.ts` green after updating its hardcoded 24→25 class-count assertions and drift-check class list (also duplicated in the test file, not auto-derived) → `gen:governance-baseline:check` exit 0 (141 frozen / 193 live / 52 post-foundation; baseline untouched). Full monorepo `pnpm turbo run build` (6/6) and `pnpm turbo run test` (12/12 tasks, 114 test files, all green) also verified with zero regressions.
- [x] **Task 6 — (OPTIONAL, flagged at Epic-23 kickoff) CR 22.1-3 fold-in** (not an AC)
  - [x] Applied. The one-line de-caret reword was applied to the EXISTING `BackupManage` `restore`-branch reject message in `Monitor.cls`. Note: `CLUMENU^JRNRESTO`'s caret is not literally "leading" but `SanitizeError`'s backward-alnum-walk still strips the whole token (confirmed by reading `Utils.cls:SanitizeError`), so both routine names were reworded WITHOUT any caret (`DBREST` / `CLUMENU in JRNRESTO`) rather than just removing a leading `^`. The doc comment above the message (a non-sanitized surface) intentionally keeps the caret form. Lead should mark CR 22.1-3 resolved in `deferred-work.md`.

## Dev Notes

### The spec §3 table is the contract (Story 23.0 pinned every area)
Every `[PROBE]` is resolved. Do NOT re-probe from docs — the §3 rows name the concrete API and the gotchas already found:
- **`locks`** — `##class(SYS.Lock).GetLockSpaceInfo()` **in `%SYS`** (does NOT exist in HSCUSTOM — the handler's `%SYS` switch is what makes it callable). Returns CSV `"Available,Usable,Used"` bytes. Raw = the CSV (or its 3 fields); TS computes `Used/(Usable+Used)*100`. Do NOT use `GetMaxLockTableSize()` (1TB sentinel). Guard `Usable+Used=0`→notApplicable.
- **`system`** — mirror `Monitor.cls:SystemMetrics()`: `SYS.Stats.Global.Sample()` (RefLocal+RefPrivate+RefRemote), `SYS.Stats.Routine.Sample().RtnCommands`, `$ZH`, `%SYS.ProcessQuery` count. Instance-wide only (Rule #5). `memory` was DROPPED (folded into `system`) — do NOT add a `memory` area or field.
- **`databases`** — `Config.Databases:List` + `Config.Databases.Get(name,.props)` + `SYS.Database.%OpenId(dir)` → `.Size`/`.MaxSize`/`.ExpansionSize`/`.Mounted`. Raw `{size,maxSize,mounted}` per DB + open-failure flag (CR 23.0-5). Rule #3 (Config for config, SYS.Database for runtime).
- **`journal`** — `Monitor.cls:JournalInfo()` pattern (`%SYS.Journal.System.*`) + NEW `##class(%Library.File).GetDirectorySpace(primaryDir, .free, .total, 0)` for the volume `{free,total}`.
- **`mirror`** — `$SYSTEM.Mirror.*`; `notApplicable` when `IsMember()=0`.
- **`license`** — `$SYSTEM.License.*`: raw `CSPUsers()` + `GetUserLimit()` (NOT `GetConnectionLimit()`=0) + `SYS.Stats.Dashboard.LicenseCurrent`/`LicenseCurrentPct` (CR 23.0-2, authoritative).
- **`ecp`** — `$SYSTEM.ECP.GetClientIndex("test")=-1`→notApplicable.
- **`alerts`** — `$SYSTEM.Monitor.State()` (numeric -1/0/1/2), `Alerts()` (count), `GetAlerts()` (raw array). Return the raw **numeric `state`** — do NOT use the existing handler's `alerts[].severity` (it's a copy of the state text, not per-alert severity). TS does the state→level mapping.
- **`interop`** — `Ens.Queue:Enumerate` for queue name+count; gate via `##class(Ens.Director).GetProductionStatus(.name,.state)` **FIRST** — if it errors (no Ens classes in the namespace), emit raw `interopEnabled:false` (a `notApplicable` signal), do NOT let it hit the per-area error catch (protects §5 AC 4). A running/stopped production with zero queues is `count:0` (applicable), NOT notApplicable.

### Handler skeleton (conventions §3 + Rules #7/#33/basics — non-negotiable)
```objectscript
ClassMethod HealthCheck() As %Status
{
    Set tSC = $$$OK
    Set tResult = ""
    Set tOrigNS = $NAMESPACE
    Set tErrored = 0
    Try {
        ; validate/parse requested areas BEFORE switching namespace
        Set $NAMESPACE = "%SYS"
        ; per-area Try/Catch, build tAreas / tErrors dynamic objects
        Set $NAMESPACE = tOrigNS
        Set tResult = <{areas, errors} dynamic object>
        Quit
    } Catch ex {
        Set $NAMESPACE = tOrigNS            ; restore FIRST in catch
        Set tErrored = 1
        Set tCmdStatus = ex.AsStatus()
    }
    ; exactly one render after Try/Catch
    If tErrored {
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tCmdStatus))
    } Else {
        Do ..RenderResponseBody($$$OK, , tResult)
    }
    Quit tSC
}
```
- The **per-area** Try/Catch is INSIDE the outer Try — a single area error must NOT reach the outer Catch (that would fail the whole request). Only a structural failure (bad request parse, render setup) hits the outer Catch.
- `%DynamicObject` property names containing `_` need quotes (basics rule) — area names here are safe (`system`, `journal`, …). Never wrap a method call in `$Get()` (Rule #15).

### Scope guardrails
- **NO threshold/verdict logic** in ObjectScript — return raw values only. Thresholds → findings → verdict is Story 23.2 (TS). This keeps threshold tweaks free of bootstrap bumps (the whole point of the OS-raw/TS-judgment split, architecture.md ADR H5).
- **NO new governance key** in this story — `iris_health_check` (the TS tool + its `mutates:"read"` key) ships in Story 23.2. Frozen baseline stays untouched here.
- **NO TypeScript** in this story (that's 23.2). This story = `Monitor.cls`/`Dispatch.cls` + test class + regenerated `bootstrap-classes.ts` + `BOOTSTRAP_VERSION`.

### Deploy / test / IRIS-MCP notes
- Live IRIS: HSCUSTOM on `localhost:52773`. MCP tools are DEFERRED — `ToolSearch("select:mcp__iris-dev-mcp__iris_doc_load,mcp__iris-dev-mcp__iris_execute_tests,mcp__iris-dev-mcp__iris_doc_get,mcp__iris-dev-mcp__iris_execute_command")` before use. Creds `_SYSTEM`/`SYS`.
- Rule #35 (verified twice this project): `iris_execute_tests` can return an early PARTIAL snapshot (subset, all pass, 0 failures). ALWAYS compare `total` to the expected method count; rerun per-class if short. Authoritative fallback: `%UnitTest_Result.TestMethod` SQL.
- Rule #17: the `iris_doc_load` path MUST be glob-prefixed (`src/**/*.cls`); a bare file path mis-maps the class name.
- Rule #24: editing a bootstrapped class REQUIRES regenerating `bootstrap-classes.ts` + moving `BOOTSTRAP_VERSION` IN THIS STORY (not deferred). Record from→to. Second `gen:bootstrap` run must be idempotent (no diff).

### Forward-looking (surfaced by 23.0 review — 23.2 owns the DECISIONS; 23.1 just makes the raw available)
- CR 23.0-1 (MED, 23.2): `databases` maxSize=0 (all 15 dev DBs) ⇒ dbFreePct inert. 23.1 MAY additionally gather per-DB `%Library.File.GetDirectorySpace(<db dir>, .free, .total, 0)` raw so 23.2 can offer a real volume-exhaustion signal — but the metric decision is 23.2's. If you gather it, put it in the per-DB raw; don't compute a verdict.
- CR 23.0-3/-4/-6 are TS-verdict-engine (23.2) items — not 23.1 scope; listed here only so the raw shape you emit doesn't block them (per-DB raw array; numeric `state`; authoritative license figure).

### Project Structure Notes
- Files this story changes: `src/ExecuteMCPv2/REST/Monitor.cls` (+`HealthCheck`, optionally +`Health.cls`), `src/ExecuteMCPv2/REST/Dispatch.cls` (+route), a new `%UnitTest` class under `src/ExecuteMCPv2/Test*/`, `packages/shared/src/bootstrap-classes.ts` (regenerated), and the `BOOTSTRAP_VERSION` constant. NO `.ts` tool file, NO `governance-baseline.ts`.
- Story 23.0 committed `afb5e39` (spec pinned). Previous-story intelligence: the §3 table + §2 threshold-direction fix are the ground truth; the lead smoke confirmed `SYS.Lock.GetLockSpaceInfo()` works only in `%SYS`.

### References
- [Source: _bmad-output/planning-artifacts/epics.md#Epic-23 Story 23.1] — AC 23.1.1–23.1.4.
- [Source: research/feature-specs/01-health-check.md#3-ObjectScript-work] — the pinned §3 table (authoritative per-area API).
- [Source: research/feature-specs/00-conventions.md#3] — ObjectScript handler skeleton + deploy loop.
- [Source: .claude/rules/project-rules.md] — Rules #2/#3/#5/#7/#15/#17/#18/#24/#33/#35; iris-objectscript-basics (namespace switching in REST handlers).
- [Source: _bmad-output/implementation-artifacts/deferred-work.md#code-review-of-story-23.0] — CR 23.0-1/-2/-5 (23.1-relevant) + CR 22.1-3 (fold-in candidate).

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References

Live deploy/test on HSCUSTOM (`localhost:52773`), no `ExecuteMCPv2.Temp.*` probe classes needed
(coded directly against the Story 23.0 pinned spec; verified `iris_doc_list` filter
`ExecuteMCPv2.Temp` returns empty before/after):
- `iris_doc_load` (glob `src/**/*.cls`, compile=true, namespace=HSCUSTOM): 48 uploaded, 0 failed,
  5 recompiled (`Setup`, `HealthCheckTest`, `Health`, `Monitor`, `Dispatch`), compile clean.
- `iris_execute_tests` class-level `ExecuteMCPv2.Tests.HealthCheckTest`: `total=14 passed=14
  failed=0` — matches the expected method count exactly (no partial snapshot).
- `iris_execute_tests` package-level `ExecuteMCPv2.Tests` (regression check): returned partial
  snapshots twice (`total=34`/`total=42`, both `failed=0`) against an expected 228 methods across
  21 classes (verified via `grep -c "^Method Test"`) — the exact Rule #35 caveat. Resolved via the
  documented authoritative fallback: `SELECT COUNT(*), SUM(Status=0), SUM(Status=1) FROM
  %UnitTest_Result.TestMethod WHERE ID LIKE '<instanceId>||%'` for both run instances (1465, 1466)
  → **228/228 passed, 0 failed** for BOTH full runs (the TestInstance IDs use a `||`-delimited
  composite key; ID sort is lexicographic-string not numeric, e.g. instance `"9"` sorts after
  `"1466"` — irrelevant here since I matched by exact instance-ID prefix). Instance 1464
  (HealthCheckTest-only run) cross-checked too: 14/14.
- Live HTTP smoke (`curl -u _SYSTEM:SYS`) against the deployed `/api/executemcp/v2/monitor/health`
  route: (1) unfiltered GET → all 9 areas populated, `errors:{}`, values closely tracking Story
  23.0's live-probe evidence (e.g. journal `volumeTotalBytes=511067549696` byte-identical to Story
  23.0's `GetDirectorySpace` probe; license `userLimit=8`/`currentCSPUsers=0`; mirror
  `isMember=false`; ecp `configured=false`; interop `interopEnabled=true, queueCount=0` on a
  stopped HSCUSTOM production — matches the "applicable, zero queues" case, not `notApplicable`);
  (2) `?areas=journal,license` → exactly those two keys; (3) POST `{"areas":["mirror","ecp"]}` →
  exactly those two keys; (4) malformed POST body → single clean error envelope (`ERROR #5001:
  Invalid JSON in request body...`), no crash, no non-JSON response (Rule #7 single-render
  verified live); (5) `?areas=ecp,bogus` → only `ecp` returned, unknown name silently ignored.
- `pnpm run gen:bootstrap` run twice back-to-back after adding `Health.cls` to
  `scripts/gen-bootstrap.mjs`'s class list — second run byte-identical to the first (idempotent).
- `pnpm --filter @iris-mcp/shared test` (full package): 29 files / 566 tests, all green.
- `pnpm turbo run build`: 6/6 tasks green. `pnpm turbo run test` (full monorepo): 12/12 tasks
  green, 114 test files across shared(29)/admin(29)/dev(20)/interop(17)/ops(15)/data(4), all
  passed, exit 0 — zero regressions from the `Monitor.cls`/`Dispatch.cls`/bootstrap changes.
- `pnpm run gen:governance-baseline:check`: exit 0, "every frozen foundation key still exists in
  the live surface" (141 frozen / 193 live / 52 post-foundation — unchanged shape, no new
  governance key added by this story).

### Completion Notes List

- **AC 23.1.1 — DONE.** `HealthCheck` handler + 8 supporting classmethods implemented. Measured
  Monitor.cls's projected growth (~475 added lines including doc comments) — over the story's own
  ~400-line guideline — so extracted to a new `ExecuteMCPv2.REST.Health.cls` (also extends
  `%Atelier.REST`) per the story's explicit escape clause ("extract to a new Health.cls ONLY if...
  past ~400 added lines — measure, then decide"). `Monitor.cls` itself only grew by ~6 lines (the
  optional Task 6 fold-in). All handler conventions followed: `Set tSC=$$$OK` first line / `Quit
  tSC` last line on every method; result var initialized before Try; namespace save/restore
  (`Set tOrigNS=$NAMESPACE` / `Set $NAMESPACE="%SYS"` / restore before any error handling or
  render — never `New $NAMESPACE`); exactly one `RenderResponseBody` per request via an
  error-flag + single dispatch after Try/Catch; every error path goes through
  `##class(ExecuteMCPv2.Utils).SanitizeError`; zero `^`caret-globals in any error string built by
  this story's code. Response shape verified live: `{ "areas": {...}, "errors": {...} }` exactly.
- **AC 23.1.2 — DONE.** Per-area Try/Catch isolation implemented as one classmethod per area
  (`HealthCheckSystem`/`HealthCheckDatabases`/`HealthCheckJournal`/`HealthCheckMirror`/
  `HealthCheckLocks`/`HealthCheckLicense`/`HealthCheckECP`/`HealthCheckAlerts`/
  `HealthCheckInterop`), each with its own internal Try/Catch that writes to the shared
  `pAreas`/`pErrors` `%DynamicObject`s — a single area's exception never reaches the outer
  Try/Catch. Area filtering: GET `?areas=a,b` (comma-separated) or POST JSON body
  `{"areas":[...]}` (array), both live-verified; default = all 9 areas. `notApplicable` markers
  verified: `mirror.isMember=false`, `ecp.configured=false`, `interop.interopEnabled=false` (raw
  signals, not errors) — `interop`'s gate (`Ens.Director.GetProductionStatus`) runs FIRST, in the
  ORIGINAL namespace, wrapped in its own dedicated Try/Catch that treats a thrown exception the
  SAME as a bad status (both → `interopEnabled:false`, never `errors["interop"]`), satisfying the
  "must not fall into the per-area error catch" requirement. `databases` per-DB `openFailed` flag
  added (CR 23.0-5) distinguishing a genuine `%OpenId` failure from legitimate `maxSize=0`/
  `mounted=0` `notApplicable` cases.
- **AC 23.1.3 — DONE**, with one Dev-Notes-diverging design choice (documented below). 14 tests in
  `ExecuteMCPv2.Tests.HealthCheckTest`, all passing live: (a) per-area success — one test per area
  asserting the pinned raw fields are present (9 tests); (b) per-area error isolation — proved with
  a REAL forced failure (not a mock): `HealthCheckLocks` is called directly from HSCUSTOM without
  the `%SYS` namespace switch the dispatcher normally applies; `SYS.Lock` is pinned (Story 23.0) to
  not exist outside `%SYS`, so this deterministically throws a genuine exception through the exact
  same Try/Catch the live dispatcher uses, landing in `errors["locks"]` (sanitized, no `^`
  reference) while a second unrelated area (`HealthCheckMirror`, called into the SAME shared
  `tAreas`/`tErrors` pair) still succeeds — proving isolation within one composite round (1 test);
  (c) area filtering — tested via a new `%request`-independent seam, `HealthCheckParseAreas`,
  split out specifically because the `HealthCheck` dispatcher itself reads the live CSP `%request`
  context (unavailable in a direct %UnitTest call) — covers blank-defaults-to-all, an exact subset,
  and unknown-name tolerance (3 tests). Plus 1 test on the `AreaErrorText` sanitizer (Rule #33).
  **Design choice**: the per-area helper classmethods and `HealthCheckParseAreas` are PUBLIC (not
  `[ Private ]`) specifically so the test class can call them directly and construct these
  scenarios — matching the codebase's existing `BuildGlobalRefPublic`-style precedent (Global.cls)
  for exposing otherwise-internal logic to `%UnitTest`, though here no separate `...Public` wrapper
  was needed since there was no reason to keep them Private in the first place (mirrors the already
  public `CollectInteropMetrics` helper pattern in `Monitor.cls`). Rule #35 (compare `total` to
  expected) enforced at both the class level (14/14 exact) and the package-level regression check
  (partial snapshots resolved via the SQL fallback — see Debug Log References).
- **AC 23.1.4 — DONE.** Full deploy loop executed; see Debug Log References for the complete
  evidence trail. `BOOTSTRAP_VERSION` `e931a96373f0` → `13b4b5f003ab` (idempotent on rerun).
  **Process discrepancy found and fixed** (Rule #16-style — verify before trusting): the story's
  own Dev Notes and architecture.md's G1 decision record describe `gen-bootstrap.mjs` as
  discovering classes via a `src/ExecuteMCPv2/**/*.cls` glob; reading the actual script
  (`scripts/gen-bootstrap.mjs`) showed it uses a hand-maintained, explicitly ordered `classes`
  array — adding `Health.cls` required editing that array directly (placed after `Monitor.cls`,
  before `Task.cls`, matching its logical origin as a Monitor.cls split). This is a durable
  discrepancy for future ObjectScript stories to know about, not just a one-off for this story.
  `packages/shared/src/__tests__/bootstrap.test.ts` ALSO hand-maintains a parallel copy of the
  class roster (both the "should contain all required class names" list and the drift-check
  `classPaths` array carry an explicit "MUST stay in sync with scripts/gen-bootstrap.mjs" comment)
  — updated both, plus the two hardcoded `24`→`25` count assertions, plus added a dedicated
  "should include Health.cls (Story 23.1)" test mirroring the existing per-class inclusion tests
  for Monitor/Task/SystemConfig/Analytics. `gen:governance-baseline:check` confirms the frozen
  baseline (`1e62c5ad5bf7`) is untouched — this story adds no governance key, as scoped.
- **Task 6 (optional CR 22.1-3 fold-in) — APPLIED.** See Task 6 checklist note above for the
  exact wording change and the caret-stripping nuance discovered while applying it.
- **Scope discipline**: no TypeScript file touched, no new governance key, no threshold/verdict
  logic in ObjectScript (every area returns raw values only, per ADR H5) — matches the story's
  explicit scope guardrails. The CR 23.0-1 forward-looking per-DB volume-free-% gathering was
  deliberately NOT added (explicitly optional/"MAY", not in Task 2's actual bullet list — left for
  23.2 to request if it decides to use it).

### File List

- `src/ExecuteMCPv2/REST/Health.cls` (new) — `HealthCheck` dispatcher + `HealthCheckParseAreas` +
  `AreaErrorText` + 9 per-area classmethods (`HealthCheckSystem`/`Databases`/`Journal`/`Mirror`/
  `Locks`/`License`/`ECP`/`Alerts`/`Interop`).
- `src/ExecuteMCPv2/REST/Dispatch.cls` (modified) — added `GET/POST /monitor/health` →
  `ExecuteMCPv2.REST.Health:HealthCheck` routes.
- `src/ExecuteMCPv2/REST/Monitor.cls` (modified) — optional Task 6 fold-in only: de-caret reword
  of the `BackupManage` `restore`-branch reject message (CR 22.1-3).
- `src/ExecuteMCPv2/Tests/HealthCheckTest.cls` (new) — 14 `%UnitTest` methods covering per-area
  success, per-area error isolation, and area filtering.
- `scripts/gen-bootstrap.mjs` (modified) — added `ExecuteMCPv2.REST.Health.cls` to the
  hand-maintained bootstrap class list.
- `packages/shared/src/bootstrap-classes.ts` (regenerated, DO NOT hand-edit) — 25 classes;
  `BOOTSTRAP_VERSION` `e931a96373f0` → `13b4b5f003ab`.
- `packages/shared/src/__tests__/bootstrap.test.ts` (modified) — updated hardcoded class-count
  assertions (24→25), added `Health.cls` to the "required class names" list and the drift-check
  `classPaths` array, added a dedicated "should include Health.cls" test.
- `_bmad-output/implementation-artifacts/23-1-health-endpoint-objectscript.md` (this file —
  Tasks/Subtasks, Dev Agent Record, File List, Change Log, Status).
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified —
  `23-1-health-endpoint-objectscript` → review).

## Change Log

| Date | Change |
|---|---|
| 2026-07-07 | Story 23.1 dev pass complete: `HealthCheck` composite endpoint implemented in new `ExecuteMCPv2.REST.Health.cls` (extracted from `Monitor.cls` per the story's own ~400-line escape clause) + `GET/POST /monitor/health` Dispatch route + 14-method `%UnitTest` suite (per-area success/error-isolation/area-filtering) + optional CR 22.1-3 de-caret fold-in. `gen-bootstrap.mjs`'s hand-maintained class list (not a glob, contra the architecture doc's summary — corrected understanding recorded in Completion Notes) updated to include `Health.cls`; `bootstrap.test.ts`'s parallel hand-maintained roster updated to match. `BOOTSTRAP_VERSION` `e931a96373f0`→`13b4b5f003ab`. Live-verified on HSCUSTOM: %UnitTest 14/14 (class-level) + 228/228 (package-level, SQL-fallback-verified per Rule #35) + live HTTP smoke (GET/POST area filtering, malformed-body error envelope, unknown-area tolerance). Full monorepo build (6/6) + test (12/12, 114 files) green; governance baseline untouched. Status: ready-for-dev → review. |

## Review Findings

Code review (2026-07-07, adversarial three-layer — Blind Hunter / Edge Case Hunter / Acceptance Auditor — plus live-IRIS probing on HSCUSTOM): **0 HIGH, 0 MEDIUM (blocking), 0 decision-needed, 0 patch, 5 defer (LOW), 2 dismissed.** Verified GENUINE against live IRIS, not merely read:

- **Namespace correctness** (highest-risk area) — confirmed live that `Ens.Director` exists in HSCUSTOM but NOT `%SYS`, and `SYS.Lock` exists in `%SYS` but NOT HSCUSTOM. So running the `interop` gate FIRST in the caller's namespace (before the `%SYS` switch) is load-bearing and correct: live `/monitor/health` on the HSCUSTOM-dispatched app returns `interop.interopEnabled:true` (HSCUSTOM's state, not `%SYS`'s). `$NAMESPACE` restored on every path (success line 93, catch first-line 100, POST-parse early-Quit before the switch).
- **Per-area fault isolation + single render (Rules #7/#33)** — live-verified: malformed POST body → one clean `ERROR #5001` envelope at HTTP 200; the two forced-failure unit tests drive REAL exceptions (SYS.Lock outside %SYS; Ens.Director absent in %SYS) through the exact live Try/Catch → `errors[locks]` / `interopEnabled:false` while other areas stay intact.
- **ADR H5 (raw-only)** — no threshold/verdict/level/severity logic in ObjectScript; `configured`/`isMember`/`interopEnabled`/`openFailed` are spec-pinned raw notApplicable markers, `licenseCurrentPct` is a raw dashboard read (not computed).
- **Runtime evidence (Rule 3)** — 15/15 `%UnitTest` pass, `total=15` matches expected (no Rule #35 partial-snapshot); coverage is genuine (drives the real handler; would fail on crash/wrong-ns/missing-field/isolation-leak).
- **Bootstrap/governance (Rules #18/#24/#23/#25)** — `BOOTSTRAP_VERSION 13b4b5f003ab` regen idempotent (byte-identical), `bootstrap.test.ts` 42/42, `gen:governance-baseline:check` exit 0 (frozen `1e62c5ad5bf7` untouched, no new key), `HealthCheckTest` correctly absent from the manifest.
- **Fold-ins RESOLVED** — CR 22.1-3 (BackupManage de-caret, verified live: "DBREST / CLUMENU in JRNRESTO" renders intact) and CR 23.0-5 (per-DB `openFailed` flag, verified live `openFailed:false` × 15 DBs). CR 23.0-2's 23.1-half done (authoritative `licenseCurrent(Pct)` now emitted); the "prefer under load" decision stays with Story 23.2.

All 5 findings are LOW, non-blocking, and recorded in `deferred-work.md` (§ code review of story-23.1) routed to Story 23.2 / a handler-hardening pass:

- [x] [Review][Defer] Request-parsing permissiveness — malformed `areas` (POST string/bare-array/empty-array → all-9; all-unknown/mis-cased → empty `{areas:{},errors:{}}` 200) [src/ExecuteMCPv2/REST/Health.cls:59-72] — deferred (LOW; by-design permissive per the `HealthCheckParseAreas` doc, TS zod is the authoritative validator; routed to Story 23.2 request-contract owner)
- [x] [Review][Defer] Unit-test hardening — presence-only success assertions + interop-success under-asserted + dispatcher covered only by live HTTP smoke [src/ExecuteMCPv2/Tests/HealthCheckTest.cls] — deferred (LOW; coverage genuine per Rule 3; routed to Story 23.2 which adds TS + smoke coverage over this endpoint)
- [x] [Review][Defer] Result-set close hygiene — `Ens.Queue:Enumerate` never `.Close()`d; databases/system close only on success path [src/ExecuteMCPv2/REST/Health.cls:246,468] — deferred (LOW; no cross-call leak, orefs auto-close at scope exit; inconsistent with sibling close)
- [x] [Review][Defer] `HealthCheckParseAreas` `%Status` discarded; `If tWant(x)` assumes full population [src/ExecuteMCPv2/REST/Health.cls:73] — deferred (LOW; safe today over the static CSV, refactor-fragile)
- [x] [Review][Defer] GET repeated `areas` params read only the first [src/ExecuteMCPv2/REST/Health.cls:70] — deferred (LOW; documented contract is comma-separated)

**Dismissed (investigated live, no action):** (1) "POST `areas` element non-string throws `<INVALID OREF>`" — empirically false; `{"areas":[{"x":1}]}` and `{"areas":[123,"journal"]}` degrade gracefully (element ignored, clean 200). (2) "`%Library.File.GetDirectorySpace` return treated as `%Status` may zero volume values" — verified non-issue; live `volumeTotalBytes=511067549696` non-zero and correct.
