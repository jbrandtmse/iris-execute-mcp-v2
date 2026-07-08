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
`journalPctWarn=80, journalPctCrit=92, dbFreePctWarn=10, dbFreePctCrit=3` (free space BELOW
these % triggers), `licensePctWarn=80, licensePctCrit=95, lockTablePctWarn=50, lockTablePctCrit=85`.

**Areas enum:** `memory`, `databases`, `journal`, `mirror`, `locks`, `license`, `ecp`, `alerts`,
`interop` (production queues, only meaningful on interop-enabled namespaces), `system` (global
buffer + routine activity sample).

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
re-derive from docs):

| Area | Source of truth (existing code to mirror) | Notes |
|---|---|---|
| `system` | `Monitor.cls` metrics handler (`SYS.Stats.Global.Sample()`, `SYS.Stats.Routine.Sample()`) | Instance-wide samplers only — never `$ZU` per-process (Rule #5) |
| `databases` | `Config.cls` DatabaseList (`Config.Databases` list + `SYS.Database.%OpenId(dir)`) | free % = (MaxSize/Size math as existing tool does); skip unmounted with `notApplicable` |
| `journal` | existing journal-info handler | % full of journal directory |
| `mirror` | existing mirror-status handler | `notApplicable` when no mirror configured |
| `locks` | existing locks handler | lock table utilization % `[PROBE]` — verify which property exposes table usage (likely via `SYS.Lock` or `%SYS.LockQuery`); mirror the existing handler's source |
| `license` | existing license handler (`$SYSTEM.License`) | current used / max % |
| `ecp` | existing ECP handler | `notApplicable` when no ECP configured |
| `alerts` | existing alerts handler (`$SYSTEM.Monitor` state) | count of active alerts; severity ≥ 2 ⇒ warning |
| `memory` | `[PROBE]` global buffer / shared memory stats | Verify API against `irislib` (`SYS.Stats.*` family) before speccing exact fields; if no reliable instance-wide source exists, fold into `system` and drop `memory` as a separate area |
| `interop` | existing production-queues logic (Interop.cls) | queue depth > 0 on any item ⇒ include counts; only when namespace is interop-enabled, else `notApplicable` |

Threshold evaluation happens in TypeScript (keep ObjectScript dumb: it returns raw values;
TS applies thresholds → findings → verdict). This keeps threshold changes free of bootstrap bumps.

**Handler requirements:** standard skeleton per conventions §3 (single render, namespace
save/restore, SanitizeError, no caret-globals in messages). Response shape:
`{ "areas": { "journal": {...raw...}, ... }, "errors": { "<area>": "<sanitized msg>" } }`.

## 4. Story breakdown

1. **Story 1 — Probe & threshold research (0.5):** For each `[PROBE]` above, read the existing
   handler source + `irislib` class source; pin exact properties. Cross-check threshold defaults
   against Management Portal dashboard semantics on the live instance. Deliverable: amended
   table in this spec (fill every `[PROBE]`), probe classes deleted.
2. **Story 2 — ObjectScript endpoint (1):** `/monitor/health` handler + `%UnitTest` tests
   (per-area success, per-area error isolation, area filtering). Deploy loop + bootstrap regen
   per conventions §3.
3. **Story 3 — TS tool + docs (1):** `packages/iris-ops-mcp/src/tools/health.ts`, threshold/
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
