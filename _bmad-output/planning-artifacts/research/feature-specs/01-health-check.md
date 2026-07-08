# Spec 01 — `iris_health_check`: Composite Health Diagnostic

**Server:** `@iris-mcp/ops` (package tool) | **Priority:** 1 (quick win) | **Effort:** ~3 stories
**Governance:** `mutates: "read"` → enabled by default | **Prereqs:** none
**Read first:** [`00-conventions.md`](00-conventions.md), `packages/iris-ops-mcp/src/tools/metrics.ts`,
`packages/iris-ops-mcp/src/tools/infrastructure.ts`, `src/ExecuteMCPv2/REST/Monitor.cls`, `src/ExecuteMCPv2/REST/Config.cls`

## 1. Objective

One tool call answers "is this IRIS instance healthy?" with a structured verdict. Today an AI
session needs 6+ calls (metrics, journal, mirror, locks, license, alerts, database list) and
must invent its own thresholds. This tool composes those probes server-side into a single
round-trip and applies documented, overridable thresholds. It is the intended *first call* of
any diagnostic session and the suite's answer to Postgres MCP Pro's health checks.

## 2. Tool contract

```
name:  iris_health_check
scope: "NONE"   (instance-wide; probes run in %SYS server-side)
annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
mutates: "read"
```

**Input schema (all optional):**

| Param | Type | Default | Description |
|---|---|---|---|
| `areas` | `string[]` (enum below) | all | Subset of areas to check |
| `thresholds` | object (below) | defaults below | Override warning/critical thresholds |
| `server` | (framework-provided) | `default` | Profile selection — do not add manually |

`thresholds` object (every field optional number):
`journalPctWarn=80, journalPctCrit=92, dbFreePctWarn=10, dbFreePctCrit=3, licensePctWarn=80,
licensePctCrit=95, lockTablePctWarn=50, lockTablePctCrit=85`.

**Direction correction (Story 23.0 finding, AC 23.0.2):** only `dbFreePctWarn`/`dbFreePctCrit` are
"free space AT-OR-BELOW this % triggers" (descending, `value <= threshold` — the metric IS a free-%, low is bad).
`journalPctWarn`/`Crit`, `licensePctWarn`/`Crit`, and `lockTablePctWarn`/`Crit` are all
**"% UTILIZED/FULL AT-OR-ABOVE this % triggers"** (ascending — the metric is a used/full-%, high is
bad), matching their §3 Dev Notes framing ("% full", "used/max %", "utilization %"). A literal
"free space below 80%" reading of `journalPctWarn=80` would flip a healthy, mostly-empty journal
into a false "warning" — live-verified on the dev instance: journal is 29.6% full / 70.4% free
(healthy under the correct "% full ≥ 80" reading; would incorrectly warn under the free-%-floor
misreading since 70.4% < 80). TS 23.2 MUST implement journal/license/lockTable as ascending
(`value >= threshold`) and only dbFreePct as descending (`value <= threshold`).

**Areas enum:** `databases`, `journal`, `mirror`, `locks`, `license`, `ecp`, `alerts`,
`interop` (production queues, only meaningful on interop-enabled namespaces), `system` (global
**reference** + routine activity sample). `memory` is **dropped and NOT surfaced anywhere** (Story
23.0 finding — no reliable instance-wide "memory health" source exists, see §3 table). `system` does
NOT report memory/buffer data (`SYS.Stats.Global` = global *references*, not buffers), so read
"folded into `system`" as "the area is removed," NOT "memory is now covered by `system`".

**Output (`structuredContent`):**

```json
{
  "verdict": "healthy" | "warning" | "critical",
  "checkedAt": "<ISO 8601>",
  "server": "<profile name>",
  "findings": [
    { "area": "journal", "level": "ok" | "warning" | "critical" | "notApplicable" | "error",
      "metric": "journalSpacePct", "value": 92.4, "threshold": 92,
      "explanation": "Journal directory is 92.4% full (critical threshold 92%). Purge or expand." }
  ],
  "raw": { "<area>": { /* raw probe values, always included for the areas checked */ } }
}
```

Verdict = worst finding level (`error` counts as `warning` — a probe failing must not fake a
`critical` instance verdict; the finding's explanation carries the probe error, sanitized).
`notApplicable` (e.g., mirror not configured, interop not enabled) never affects the verdict.
Text content: one line per non-ok finding + verdict summary; "All N areas healthy" when clean.

## 3. ObjectScript work

New route `GET/POST /monitor/health` in `Dispatch.cls` → new method `HealthCheck` in
`Monitor.cls` (keep it in Monitor.cls unless it exceeds ~400 lines; then a new `Health.cls`
following the same conventions). One request gathers ALL requested areas and returns one JSON
object; per-area Try/Catch so a single failing probe yields `level:"error"` for that area
without failing the request.

**Probe sources — reuse the exact system-class calls the existing handlers already make.**
Before coding, open each existing handler method and copy its data-access pattern (do NOT
re-derive from docs). **Story 23.0 resolved every `[PROBE]` below via source read + live probe
on HSCUSTOM (evidence in `23-0-health-probe-and-thresholds.md` Dev Agent Record).**

| Area | Pinned source (Story 23.0) | Notes |
|---|---|---|
| `system` | `Monitor.cls:SystemMetrics()` — `##class(SYS.Stats.Global).Sample()` (RefLocal+RefPrivate+RefRemote), `##class(SYS.Stats.Routine).Sample().RtnCommands`, `$ZH` (uptime), `%SYS.ProcessQuery` COUNT(*) (process count) | Instance-wide samplers only — never `$ZU` per-process (Rule #5). Unchanged raw shape; absorbs the dropped `memory` area conceptually but adds NO new fields. |
| `databases` | `Config.cls:DatabaseList()` pattern — `Config.Databases:List` + `Config.Databases.Get(name,.props)` + `##class(SYS.Database).%OpenId(dir)` for `.Size`/`.MaxSize`/`.ExpansionSize` | **Also read `.Mounted`** from the same already-open `SYS.Database` object (Config.cls:DatabaseList doesn't read it today, but sibling handler `Monitor.cls:DatabaseCheck()` already does on the identical object — precedented one-line addition, not new invention). Raw = `{size, maxSize, mounted}` per DB; TS computes `freePct=(maxSize-size)/maxSize*100` only when `maxSize>0`, else `notApplicable` — **live-verified: all 15 databases on the dev instance have `maxSize=0` (IRIS's own "recommended" unlimited setting)**, so `dbFreePct` is `notApplicable` for every DB here; also `notApplicable` when `mounted=0`. |
| `journal` | `Monitor.cls:JournalInfo()` pattern — `##class(%SYS.Journal.System).GetCurrentFileName/GetPrimaryDirectory/GetAlternateDirectory/GetCurrentFileCount/GetCurrentFileOffset/GetFreeSpace/GetStateString` | **New raw field needed** (the existing handler has no total): `##class(%Library.File).GetDirectorySpace(primaryDirectory, .free, .total, 0)` (Flag=0=bytes) gives a `{free, total}` pair for the primary journal directory's volume. Live-verified `free` from `GetDirectorySpace` is byte-identical to the existing `GetFreeSpace()` value when primary=alternate (true on this instance). `%full = (total-free)/total*100`; threshold is **ascending** (see §2 direction correction) — live reading 29.6% full (healthy). |
| `mirror` | `Monitor.cls:MirrorStatus()` — `$SYSTEM.Mirror.IsMember/MirrorName/GetMemberType/IsPrimary/IsBackup/IsAsyncMember/GetStatus` | `notApplicable` when `IsMember()=0` — live-verified not a mirror member on the dev instance. |
| `locks` | **PINNED**: `##class(SYS.Lock).GetLockSpaceInfo()` (namespace `%SYS`) → CSV `"Available,Usable,Used"` (bytes) | Live-verified byte-identical to raw `$zu(156,6)`, which is exactly what InterSystems' own `%Monitor.System.LockTable` sensor (the shipped Lock Table health/alert class) uses internally. `UtilizationPct = Used/(Usable+Used)*100` — the EXACT formula that sensor uses. Do **NOT** use `##class(SYS.Lock).GetMaxLockTableSize()` as the denominator — live-verified it returns a ~1TB-minus-64KB theoretical ceiling (a sentinel, not real capacity), which would make utilization read as permanently ~0%. Live reading: Available=305,653,680 Usable=305,645,056 Used=6,224 → 0.0020% utilized (9 held locks, cross-verified via `iris_locks_list`). The 1st CSV field `Available` is intentionally **UNUSED** (it exceeds `Usable+Used` by a small reserved-overhead margin): reading `%Monitor.System.LockTable.GetSample()` confirms the sensor computes `UsedSpace=$p(lt,",",3)`, `TotalSpace=$p(lt,",",2)+UsedSpace`, i.e. exactly `Used/(Usable+Used)`. Guard `Usable+Used=0` (unexpected/short CSV) ⇒ `notApplicable`. |
| `license` | `Monitor.cls:LicenseInfo()` — `$SYSTEM.License.KeyCustomerName/KeyLicenseCapacity/KeyExpirationDate/GetConnectionLimit/GetUserLimit/KeyCoresLicensed/KeyCPUsLicensed/CSPUsers` | `licensePct = currentCSPUsers/userLimit*100`. **MUST use `GetUserLimit()` (live=8) as the denominator, NOT `GetConnectionLimit()`** (live=0 on this Community Edition instance — that method is documented as "max connections PER USER", an unrelated per-user cap, NOT overall license capacity; using it as a %-denominator would divide by zero / be semantically wrong). Cross-verified against `SYS.Stats.Dashboard.LicenseCurrentPct=0` (exact match: 0 of 8 used). **Guard: when `userLimit=0` (core-based / unlimited-user licenses) ⇒ `notApplicable`** (same zero-denominator rule as `databases`' `maxSize=0`; do not divide by zero). Note `SYS.Stats.Dashboard.LicenseCurrent`/`LicenseCurrentPct` is IRIS's own authoritative license-usage figure (the Management Portal dashboard value) and needs no denominator — 23.1/23.2 should prefer it if `CSPUsers()` proves to under-count non-CSP consumption under load (see deferred item). |
| `ecp` | `Monitor.cls:ECPStatus()` — `$SYSTEM.ECP.GetClientIndex("test")` = -1 ⇒ `notApplicable` | Live-verified not configured on the dev instance. |
| `alerts` | `Monitor.cls:SystemAlerts()` — `$SYSTEM.Monitor.State()` (numeric -1/0/1/2), `$SYSTEM.Monitor.Alerts()` (count), `$SYSTEM.Monitor.GetAlerts()` (raw message array) | **Wording correction**: "severity ≥ 2 ⇒ warning" cannot key off `alerts[].severity` in the existing handler's JSON — that field is a copy of the overall `stateText` STRING, not a genuine per-alert numeric severity (the existing handler sets `tAlert.severity = tStateText` for every entry). Use the top-level numeric `state` field instead — return the raw numeric `state` and have TS map **every non-OK state**: `state=0`⇒ok, `state=1` (Warning)⇒warning, `state=2` (Alert)⇒warning, `state=-1` (Hung)⇒critical. (An earlier draft's "`state >= 2` or `state = -1`" omitted `state=1`=Warning — `SystemAlerts()`/`Monitor.cls:145` defines 1=Warning — which would silently hide an IRIS-flagged warning; 23.2 may refine the Alert-vs-Hung critical split.) `alertCount` is context only. Live-verified: `state=0` ("OK") with `alertCount=4` (nonzero alert history coexists with a healthy current state) — proves `alertCount` alone is not a reliable signal. |
| `memory` | **DROPPED — NOT an area** (row retained for evidence only; do NOT regenerate the areas enum from this table — it is 9 areas, memory excluded) | Evidence: (1) `SYS.Stats.Dashboard.Sample()` — InterSystems' own System Dashboard data source (doc comment: "contains all of the data that's available on the Dashboard") — has Normal/Warning/Troubled fields for DatabaseSpace/JournalStatus/JournalSpace/LockTable/WriteDaemon but **no memory/buffer field at all**, evidencing IRIS has no standard "memory health" concept. (2) `SYS.Stats.Buffer:Sample` (global buffer pool, live-verified working, NOT `[Internal]`) reports LRU/cache-turnover mechanics where low availability is normal/healthy caching, not exhaustion — would produce false-positive alerts. (3) `SYS.History.SharedMemoryData.Sample()` (shared memory heap) DOES report genuine bytes-used (live-verified ~60% used) but only via a 3-step `%New→Sample→Finalise` dance — direct `Sample()` alone left fields blank (live-verified) — and every method is `[Internal]`-flagged, unlike the non-Internal single-call Rule #5 precedents (`SYS.Stats.Global`/`Routine`). No reliable, uniformly-shaped, non-Internal instance-wide source exists. |
| `interop` | `Interop.cls:QueueStatus()` — `Ens.Queue:Enumerate` named query (name+count per queue); gate via `##class(Ens.Director).GetProductionStatus(.name,.state)` (that gate is NOT inside `QueueStatus()` itself — it mirrors sibling `Interop.cls:ProductionStatus()` / `Monitor.cls` line 544) | `notApplicable` when `GetProductionStatus()` errors (namespace has no interop classes at all) — NOT when a production simply isn't running. **23.1 must run the gate FIRST and emit a raw `notApplicable` signal (e.g. `interopEnabled:false`) into the areas payload — the missing-Ens-classes case must NOT fall into the per-area `error` catch, or TS maps it to `level:"error"`⇒verdict `warning` and breaks §5 AC 4.** Live-verified: HSCUSTOM with `stateCode=2`/"Stopped" and no active production still returns `Ens.Queue:Enumerate` cleanly (`count=0`, not an error) — a normal "applicable, zero queues" result, distinct from `notApplicable`. |

Threshold evaluation happens in TypeScript (keep ObjectScript dumb: it returns raw values;
TS applies thresholds → findings → verdict). This keeps threshold changes free of bootstrap bumps.
**TS MUST guard every percentage against a zero/missing denominator** — `databases` (`maxSize=0`),
`license` (`userLimit=0`), `locks` (`Usable+Used=0`), `journal` (`total=0`) — yielding
`notApplicable`, never a divide-by-zero.

**Handler requirements:** standard skeleton per conventions §3 (single render, namespace
save/restore, SanitizeError, no caret-globals in messages). Response shape:
`{ "areas": { "journal": {...raw...}, ... }, "errors": { "<area>": "<sanitized msg>" } }`.

## 4. Story breakdown

1. **Story 1 — Probe & threshold research (0.5): DONE (23-0-health-probe-and-thresholds.md).** For
   each `[PROBE]` above, read the existing handler source + `irislib` class source; pin exact
   properties. Cross-check threshold defaults against Management Portal dashboard semantics on the
   live instance. Deliverable: amended table in this spec (fill every `[PROBE]`), probe classes
   deleted. Outcome: `locks` pinned to `SYS.Lock.GetLockSpaceInfo()`; `memory` dropped (folded into
   `system` — no reliable instance-wide source, evidenced in §3); threshold direction corrected in
   §2 (journal/license/lockTable are ascending %-utilized, only dbFreePct is descending %-free);
   `databases` needs an added `.Mounted` read and `journal` needs an added
   `%Library.File.GetDirectorySpace` total — both noted in §3. Areas enum is now 9 (was 10).
2. **Story 2 (= epic Story 23.1) — ObjectScript endpoint (1):** `/monitor/health` handler + `%UnitTest` tests
   (per-area success, per-area error isolation, area filtering). Deploy loop + bootstrap regen
   per conventions §3.
3. **Story 3 (= epic Story 23.2) — TS tool + docs (1):** `packages/iris-ops-mcp/src/tools/health.ts`, threshold/
   verdict engine + unit tests (fixture raw payloads → expected findings/verdict, including
   error-isolation and notApplicable cases), registration + count updates, docs rollup
   (conventions §5 — note read/enabled-by-default), live smokes.

## 5. Acceptance criteria

1. `iris_health_check` with no args returns a verdict and ≥ 8 findings areas against the live
   dev instance in ONE tool call, < 5s.
2. `areas: ["journal","license"]` checks exactly those areas.
3. A custom threshold (`journalPctCrit: 1`) flips the journal finding to `critical` and the
   verdict accordingly (proves override plumbing).
4. On a namespace/instance without mirror and without interop, those areas report
   `notApplicable` and the verdict is unaffected.
5. A forced probe failure (unit-test level: mocked area error) yields `level:"error"` for that
   area, other areas intact, verdict ≤ `warning`.
6. Raw values always present alongside interpreted findings.
7. Live smoke on HSCUSTOM **and a second namespace** (Rule #34); verdict areas match
   Management Portal dashboard within expected tolerance.
8. Governance: key `iris_health_check` resolves enabled under empty `IRIS_GOVERNANCE`;
   explicit `false` blocks it (one unit test).
9. Conventions §6 definition-of-done checklist complete.

## 6. Out of scope

- Historical trending / scheduled checks (pairs with Spec 07 later).
- Auto-remediation of findings (the explanation may NAME the fixing tool, e.g.
  "run iris_task_run on the journal purge task", but never executes it).
- Per-database deep integrity (exists as `iris_database_check`).
