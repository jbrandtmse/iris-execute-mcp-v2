# Story 23.2: `iris_health_check` Tool + Verdict Engine + Docs + Smokes

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an **operator**,
I want **the `iris_health_check` MCP tool to turn the endpoint's raw per-area values into an explained verdict (`healthy`/`warning`/`critical`) with per-area findings**,
so that **"check the health of prod" is ONE tool call with actionable findings — the intended first call of any diagnostic session.**

This is the **epic-closing TypeScript story**: `packages/iris-ops-mcp/src/tools/health.ts` (the tool + threshold→finding→verdict engine), governance wiring (`mutates:"read"` → default-enabled), unit tests (fixture raw → expected findings/verdict), the Rule #30 docs rollup (ops 20→21), and the Rule #22/#26/#34 live smokes against the deployed `/monitor/health` endpoint (Story 23.1, committed `214d8ef`).

## Acceptance Criteria

- **AC 23.2.1** — Tool per spec §2 contract: `name: iris_health_check`, `scope: "NONE"`, annotations `{readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:false}`, `mutates:"read"`. Optional params: `areas` (Zod enum of the **9** areas — `system, databases, journal, mirror, locks, license, ecp, alerts, interop`; **`memory` is NOT in the enum** — a caller passing it gets a clear Zod reject, per CR 23.0-6/CR 23.1-1), `thresholds` (object of optional numbers per spec §2), plus the framework `server` param (do NOT add manually). Handler GETs/POSTs `/monitor/health` (`BASE_URL="/api/executemcp/v2"`), reads `result.{areas,errors}`, runs the verdict engine. Verdict-engine unit-tested with **fixture raw payloads → expected findings/verdict** including error-isolation, threshold-override, and notApplicable cases (CR 23.1-2: assert deterministic VALUES, not just presence).
- **AC 23.2.2** — Spec §5 acceptance criteria 1–8 all pass:
  1. No-arg call returns a verdict + **≥8 findings areas** in ONE tool call, <5s (one finding per checked area — informational areas included).
  2. `areas:["journal","license"]` checks exactly those (endpoint filter + engine only over returned areas).
  3. Custom threshold `journalPctCrit:1` flips the journal finding to `critical` and the overall verdict → `critical` (override plumbing).
  4. A namespace/instance without mirror and without interop reports those areas `notApplicable`; verdict unaffected.
  5. A forced probe failure (endpoint `errors[area]`) → that area finding `level:"error"`, other areas intact, verdict **≤ warning** (error never fakes `critical`).
  6. Raw values always present alongside interpreted findings (`raw` mirrors the checked areas).
  7. **Live smoke on HSCUSTOM AND a second namespace (Rule #34)**; verdict areas match Management-Portal-dashboard semantics within tolerance.
  8. Governance: key `iris_health_check` resolves ENABLED under empty `IRIS_GOVERNANCE`; explicit `IRIS_GOVERNANCE` `false` blocks it (one unit test).
- **AC 23.2.3** — ops package registration: add to `tools/index.ts`; update `index.test.ts` count assertions **20→21** (`toHaveLength`, `getToolNames`); any cross-server/advertised-count tests that move. Docs rollup per Rule #30 across ALL FOUR surfaces (root `README.md` counts + capability; `tool_support.md` catalog row + endpoint + governance note; `packages/iris-ops-mcp/README.md` tool reference; `CHANGELOG.md`) — **STATE read / enabled-by-default** (Rule #30 mandatory callout).
- **AC 23.2.4** — Live smokes (Rules #22/#26/#34) recorded in the story: (a) build `@iris-mcp/ops` dist first; drive the BUILT tool in a real Node process against live HSCUSTOM — full check (≥8 areas, verdict) + area subset + a `thresholds` override that flips the verdict; (b) a **SECOND namespace** (e.g. USER/SADEMO — a non-interop or differently-configured ns) confirming `interop`/`mirror`/`ecp` `notApplicable` behavior differs appropriately and the verdict stays sound; (c) cross-check the verdict's numeric areas against the Management Portal dashboard within tolerance; (d) delete the disposable smoke script before staging. Conventions §6 definition-of-done checklist complete.

## Integration ACs

Story 23.2 is the **consumer** that completes the Story 23.1 producer→consumer chain: the `iris_health_check` tool reads the deployed `/monitor/health` endpoint's `{areas,errors}` payload and produces the verdict. **AC 23.2.4's live smoke IS the integration proof** — the built tool driving the live deployed endpoint end-to-end (tool → HTTP → Health.cls → raw → verdict). No later story consumes `iris_health_check` (terminal consumer; Epic 23 ends here).

## Tasks / Subtasks

- [x] **Task 1 — Tool skeleton + schema** (AC: 23.2.1)
  - [x] Create `packages/iris-ops-mcp/src/tools/health.ts` following the clean minimal sibling `packages/iris-ops-mcp/src/tools/alerts.ts` + `packages/shared/src/tool-types.ts`. `ToolDefinition`: name/title/description (LLM-optimised; STATE read + enabled-by-default), `inputSchema` (Zod: `areas` enum[9] optional, `thresholds` object optional, NO manual `server`), truthful annotations, `scope:"NONE"`, `mutates:"read"`, `handler`.
  - [x] Handler: `ctx.http` GET `/monitor/health` (POST when `areas`/`thresholds` present; send `areas` as the endpoint expects — comma-separated GET or `{areas:[...]}` POST). Catch `IrisApiError` → `{isError:true, content:[...]}`; rethrow others. Read `result.areas`/`result.errors`.
- [x] **Task 2 — Verdict engine** (AC: 23.2.1, 23.2.2)
  - [x] Pure function `evaluate(rawAreas, errors, thresholds) -> {verdict, findings, raw}` (export it for direct unit testing). Defaults (spec §2, **corrected directions from 23.0**): `journalPctWarn=80/Crit=92` ASCENDING (%full); `dbFreePctWarn=10/Crit=3` DESCENDING (%free below); `licensePctWarn=80/Crit=95` ASCENDING; `lockTablePctWarn=50/Crit=85` ASCENDING.
  - [x] Per-area level rules (produce ONE finding per CHECKED area so AC 1's ≥8 holds):
    - `journal`: `%full=(volumeTotalBytes-volumeFreeBytes)/volumeTotalBytes*100`; ≥Crit→critical, ≥Warn→warning, else ok; `volumeTotalBytes=0`→notApplicable.
    - `databases`: per-DB `freePct=(maxSize-size)/maxSize*100` when `maxSize>0` & `mounted`; ≤Crit→critical, ≤Warn→warning, else ok; `maxSize=0`|`!mounted`→notApplicable; `openFailed`→**error**. **Aggregation (CR 23.0-4): worst-DB drives the area level; per-DB breakdown stays in `raw`.**
    - `license`: prefer authoritative `licenseCurrentPct` when present (CR 23.0-2), else `currentCSPUsers/userLimit*100`; ≥Crit→critical, ≥Warn→warning; `userLimit=0`&no pct→notApplicable.
    - `locks`: `used/(usable+used)*100`; ≥Crit→critical, ≥Warn→warning; `usable+used=0`→notApplicable.
    - `alerts`: numeric `state` — `-1`(Hung)→critical, `1`(Warning)/`2`(Alert)→warning, `0`→ok.
    - **Informational areas (CR 23.0-3 v1 decision — DOCUMENT this): `system`, `mirror`, `ecp`, `interop` have NO verdict threshold in v1** → finding level `ok` (raw carried), or `notApplicable` when the raw signals not-configured (`mirror.isMember=false`, `ecp.configured=false`, `interop.interopEnabled=false`). A queue-depth / mirror-status threshold is a documented future enhancement, NOT v1.
  - [x] Verdict = worst finding level; **`error` counts as `warning`** (never `critical` — spec §2); `notApplicable` NEVER affects the verdict. An area present in `errors` → finding `level:"error"` with the sanitized message in `explanation`.
  - [x] Findings carry `{area, level, metric, value, threshold, explanation}`; explanation is human-actionable (may NAME a fixing tool, never executes it). Text content: one line per non-ok finding + verdict summary; "All N areas healthy" when clean.
- [x] **Task 3 — Input validation (CR 23.0-6 / CR 23.1-1)** (AC: 23.2.1)
  - [x] Zod `areas` enum excludes `memory` (rejected via the standard Zod enum-mismatch error, which enumerates the 9 valid values — see Decisions for why a custom per-value error message was NOT used). Decided + documented + unit-tested `areas:[]` semantics (empty array treated as ALL, matching the endpoint; "All N areas healthy" always reflects the FULL checked count). `thresholds` numbers: extreme values allowed (AC 3's `journalPctCrit:1` passes); override precedence documented as per-threshold independent; NaN/non-number guarded by `z.number()` itself (verified empirically — Zod v4 rejects NaN/Infinity/strings by default, no extra guard code needed).
- [x] **Task 4 — Unit tests** (AC: 23.2.1, 23.2.2 #5/#8; CR 23.1-2)
  - [x] `packages/iris-ops-mcp/src/__tests__/health.test.ts` (mocked HTTP, 68 tests): fixture raw payloads → expected findings/verdict asserting deterministic VALUES; cover healthy/warning/critical, threshold-override flip (AC 3), error-isolation (endpoint `errors[locks]` → error finding, verdict ≤ warning, others intact — AC 5), notApplicable-ignored (AC 4), `areas` subset, `memory` reject, `areas:[]`, per-area deterministic fixtures for all 9 areas, and HTTP-wiring/response-shape/error-handling tests. `packages/iris-ops-mcp/src/__tests__/health-governance.test.ts` (3 tests, real `McpServerBase.handleToolCall` gate): enabled default + explicit-false blocks + registration passes `assertGovernanceClassification` — follows the `diagram-governance.test.ts`/`loc-governance.test.ts` real-gate pattern.
- [x] **Task 5 — Registration + count tests** (AC: 23.2.3)
  - [x] Added to `packages/iris-ops-mcp/src/tools/index.ts`; updated `index.test.ts` (`toHaveLength(21)` package array is implicit via `getToolNames` `toHaveLength(22)` = 21 package + 1 framework; `toolCount` 21→22; `getToolNames` includes `iris_health_check`). No other cross-server/advertised-count tests move (shared-package synthetic-tool tests use a `FRAMEWORK_TOOL_COUNT` constant, not the real ops array). `assertGovernanceClassification` passes (proven by `index.test.ts` + `health-governance.test.ts` both constructing/starting a real `McpServerBase` with the tool, Rule #28).
- [x] **Task 6 — Docs rollup (Rule #30, all four surfaces)** (AC: 23.2.3)
  - [x] root `README.md` (Servers table ops 20→21 + a health-check capability line in both the Servers table and "Which Server Do I Need?" table; suite "100 tools"→"101 tools"; ASCII diagram `ops (20)`→`(21)`); `tool_support.md` (new catalog row #21 + endpoint `/monitor/health` + `mutates:read` + Epic 23 governance-defaults note stating **enabled by default**; a "Fields returned" entry for the `structuredContent` shape; Suite-wide rollup table + Dependency-implications prose counts all bumped: package 100→101, advertised 105→106, ExecuteMCPv2-backed 76→77); `packages/iris-ops-mcp/README.md` (new "Health Check Tool" reference-table section + a full Tool Examples `<details>` entry with the threshold table, **read / enabled-by-default** callout, top description line); `CHANGELOG.md` (new Epic-23 entry, 2026-07-07, dated to match Stories 23.0/23.1 for in-epic consistency). All counts cross-verified against `index.test.ts`.
- [x] **Task 7 — Live smokes (Rules #22/#26/#34) + DoD** (AC: 23.2.4)
  - [x] `pnpm --filter @iris-mcp/ops build` (via `pnpm turbo run build`, 6/6 green); disposable Node smoke (`.mjs`, scratchpad dir, deleted after use) importing the BUILT dist tool; drove live HSCUSTOM (full 9 areas + verdict, 81ms; subset `[journal,license]`; a `thresholds:{journalPctCrit:1}` override that flipped the verdict to critical) AND a genuine SECOND namespace (SADEMO, via a temporary disposable webapp — see Decisions/Completion Notes for why a normal `namespace` param doesn't apply to this `scope:"NONE"` tool and how the second-namespace proof was still obtained live, not just documented as a gap); cross-checked numeric areas against 6 sibling MCP tools (`iris_license_info`, `iris_journal_info`, `iris_locks_list`, `iris_mirror_status`, `iris_ecp_status`, `iris_metrics_alerts`, `iris_metrics_system`) — all matched exactly or were internally consistent. Results recorded in Completion Notes. Smoke script AND the temporary webapp were both deleted before staging. Conventions §6 DoD checklist complete (see Completion Notes).

## Dev Notes

### This is the last story of Epic 23 — it makes `iris_health_check` real end-to-end
- **NO ObjectScript, NO bootstrap change** — the endpoint shipped in 23.1 (`13b4b5f003ab`). This story is TS-only + docs. Frozen governance baseline `1e62c5ad5bf7` stays untouched; the NEW `iris_health_check` key is a NON-baseline read key → `defaultSeed` resolves it ENABLED (Rule #28 requires the classification anyway; `gen:governance-baseline:check` still exits 0 because the frozen baseline file is unchanged — the new key is post-foundation).
- Read `packages/shared/src/tool-types.ts` FIRST; template off `packages/iris-ops-mcp/src/tools/alerts.ts` (the clean minimal ops tool). Custom REST → `BASE_URL="/api/executemcp/v2"`.

### The endpoint contract (Story 23.1, live-verified)
`GET/POST /api/executemcp/v2/monitor/health` returns the standard envelope `{status, console, result}`; the payload is under **`result`**: `{ "areas": { "<area>": {...raw...} }, "errors": { "<area>": "<sanitized>" } }`. Raw field shapes (from the 23.1 lead smoke) — pin your fixtures to these:
- `locks: {available, usable, used}` · `license: {currentCSPUsers, userLimit, licenseCurrent, licenseCurrentPct}` · `alerts: {state(numeric), alertCount, messages[], lastAlert}` · `mirror: {isMember(bool)}` · `ecp: {configured(bool)}` · `interop: {interopEnabled(bool), productionName, productionStateCode, queues[], queueCount}` · `journal: {..., freeSpaceBytes, volumeFreeBytes, volumeTotalBytes, state}` · `databases: [ {name, directory, size, maxSize, mounted, openFailed} , ... ]` (array) · `system: {globalReferences, routineCommands, uptimeSeconds, processCount}`.
- Area filtering: GET `?areas=journal,license` (comma) or POST `{"areas":["journal","license"]}`. The endpoint is permissive (unknown names ignored; non-array falls back to all) — **your Zod enum is the authoritative validator** (CR 23.1-1); send only well-formed input.

### Deferred-item decisions this story OWNS (fold in + document)
- **CR 23.0-1 (MED) — databases inert when maxSize=0.** All dev-instance DBs have `maxSize=0` ⇒ `dbFreePct` notApplicable ⇒ no disk-exhaustion signal on a normal instance. **v1 decision (DOCUMENT in the tool description + finding explanation):** `databases` reports free-% health for maxSize-configured DBs only; unlimited-size DBs are `notApplicable`. A per-DB volume-free signal (would need an endpoint change to expose `GetDirectorySpace` per DB dir) is a future enhancement — NOT v1. Journal already covers the primary volume.
- **CR 23.0-3 (MED) — no ok/warning criteria for system/mirror/ecp/interop.** v1 decision above (informational/raw + notApplicable gate). Document that these areas are informational in v1.
- **CR 23.0-4 (MED) — databases aggregation.** Worst-DB drives the `databases` finding level; per-DB detail in `raw.databases`.
- **CR 23.0-6 / CR 23.1-1 (LOW) — input validation.** memory-enum reject; `areas:[]`→all; threshold precedence documented per-threshold.
- **CR 23.1-2 (LOW) — test hardening.** Assert deterministic values in the fixture tests (e.g. exact verdict + exact finding level + value) rather than presence-only.

### Governance (Rule #28 / #23 / #25)
- `mutates:"read"` on the tool. New key `iris_health_check` is post-foundation → default-ENABLED. Add an AC-23.2.2-#8 governance test (enabled under empty config; explicit `false` blocks). NEVER edit `governance-baseline.ts`; NEVER run bare `gen-governance-baseline.mjs` — only `pnpm run gen:governance-baseline:check` (must exit 0).

### Live smoke (Rules #22/#26/#34) — the epic's final gate
- Build dist first (`pnpm --filter @iris-mcp/ops build`); drive the BUILT dist tool in a real Node process (NOT vitest) against live HSCUSTOM. Read-only tool → no destructive-path rejection to test, but DO test the threshold-override verdict flip (proves the engine end-to-end) and the malformed/edge input is Zod-rejected before the HTTP call.
- **Rule #34 SECOND namespace is an AC (23.2.4b) — mandatory or an explicit recorded residual-risk.** Health areas are namespace-sensitive (interop especially). If a second usable namespace exists (USER/SADEMO), smoke it and confirm `interop`/`mirror`/`ecp` notApplicable behavior + a sound verdict. If none, record the gap explicitly (Rule #34).
- IRIS MCP tools are DEFERRED — `ToolSearch("select:mcp__iris-dev-mcp__iris_execute_command,mcp__iris-dev-mcp__iris_server_namespace")` if you need them; the tool itself hits IRIS over HTTP via `ctx.http`. Delete the smoke script before `git add`.

### Project Structure Notes
- Files: `packages/iris-ops-mcp/src/tools/health.ts` (new), `packages/iris-ops-mcp/src/tools/index.ts`, `packages/iris-ops-mcp/src/__tests__/health.test.ts` (new) + a governance test, `packages/iris-ops-mcp/src/__tests__/index.test.ts` (counts), plus the 4 docs surfaces. NO `.cls`, NO `bootstrap-classes.ts`, NO `governance-baseline.ts`.
- Prev-story intelligence: 23.0 pinned the spec (`afb5e39`); 23.1 shipped the endpoint (`214d8ef`, bootstrap `13b4b5f003ab`) with the raw shapes above. The 23.1 lead smoke output is your fixture ground-truth.

### References
- [Source: epics.md#Epic-23 Story 23.2] — AC 23.2.1–23.2.4.
- [Source: research/feature-specs/01-health-check.md#2-Tool-contract + #5-Acceptance-criteria] — the tool contract + the 9 acceptance criteria (authoritative).
- [Source: research/feature-specs/00-conventions.md#2 (TS tool) + #5 (docs rollup) + #6 (DoD)].
- [Source: deferred-work.md — code review of story-23.0 (CR 23.0-1/-3/-4/-6) + story-23.1 (CR 23.1-1/-2)] — the decisions this story owns.
- [Source: .claude/rules/project-rules.md] — Rules #19 (additive), #22/#26/#34 (smokes), #28 (mutates classification), #30 (docs default-state callout), #31 (package vs framework counting — this is a PACKAGE tool: ops array length +1).

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References

Live IRIS: `localhost:52773`, `_SYSTEM`/`SYS`. IRIS MCP tools loaded via `ToolSearch` per the
skill-specific context (`iris-dev-mcp`, `iris-ops-mcp`, `iris-admin-mcp`).

- `pnpm --filter @iris-mcp/ops type-check`: 2 rounds of fixes in `health.ts` itself (see
  Decisions — `Thresholds` hand-declared instead of `Required<ThresholdOverrides>`;
  `mergeThresholds` helper instead of an object-spread merge; both driven by
  `exactOptionalPropertyTypes`/Zod-optional interaction), then a THIRD round in `health.test.ts`
  (dropped the `: RawAreas` type annotation on the `FULL_HEALTHY_RAW` fixture — same
  `exactOptionalPropertyTypes` interaction when re-assigning its properties elsewhere; added `!`
  non-null assertions on 5 `result.findings[0]` accesses per `noUncheckedIndexedAccess`, matching
  the house style already used in `analytics.test.ts`/`docdb.test.ts`), then clean.
- `pnpm --filter @iris-mcp/ops test`: 327/327 (256 pre-existing + 68 `health.test.ts` + 3
  `health-governance.test.ts`), 0 regressions. One genuine design fix mid-development: the initial
  "non-ok" text-summary filter (`level !== "ok"`) listed `notApplicable` findings as if they were
  problems (e.g. "[NOTAPPLICABLE] databases: ...") even on an all-healthy instance, breaking the
  "All N areas healthy" text contract — fixed by excluding `notApplicable` from the text-summary
  "actionable" set too (mirrors its exclusion from verdict computation), with a regression test
  (`health.test.ts` — "text content starts with the verdict and says 'All N areas healthy'").
- `pnpm turbo run build/test/lint/type-check` (full monorepo, run twice — once after code, once
  as a final pre-smoke gate): 6/6, 12/12 (2074 tests: shared 566, data 121, interop 270, dev 351,
  admin 439, ops 327), 6/6, 12/12 — all green both times, zero regressions outside `iris-ops-mcp`.
- `pnpm run gen:governance-baseline:check`: exit 0 both before-rebuild (stale dist: 141/193/52 —
  did NOT yet reflect the new key) and after `pnpm turbo run build` (141/194/53 — the new
  `iris_health_check` key correctly appears as ONE new post-foundation key; frozen baseline
  untouched). Confirms the generator reads from `dist/`, not source — rebuild before checking.
- `iris_server_profiles` (dev-mcp): confirmed exactly ONE configured profile (`default` →
  `localhost:52773`, namespace `HSCUSTOM`).
- `iris_webapp_list` (admin-mcp): confirmed `/api/executemcp/v2` is registered EXACTLY ONCE,
  bound to namespace `HSCUSTOM` (`isNameSpaceDefault:true`, dispatch class
  `ExecuteMCPv2.REST.Dispatch`) — no second binding for any other namespace exists. This is the
  empirical basis for the Rule #34 second-namespace design decision (see Decisions).
- `iris_namespace_list` (admin-mcp): confirmed `SADEMO` and `USER` both exist on this instance
  (so a second namespace WAS available in principle — the gap was the tool's fixed single-webapp
  binding, not absent data).
- `iris_webapp_manage` (admin-mcp) `create` for a TEMPORARY disposable webapp
  `/api/executemcp/v2smoke23sademo` → namespace `SADEMO`, same dispatch class
  `ExecuteMCPv2.REST.Dispatch`. The tool's own caveat text warns "CSP gateway was NOT notified" —
  tested reachability immediately via `curl`; it WAS live with no gateway restart needed (this
  IRIS instance's private web server serves CSP config from the live `Security.Applications`
  table, not a cached/proxied Web Gateway). `iris_webapp_manage` `delete` removed it after the
  smoke; `iris_webapp_get` confirmed `{exists:false}` post-delete.
- Live smoke script (`smoke-23-2-health.mjs`, scratchpad dir — deleted after use) results:
  1. HSCUSTOM full check (no args): `verdict:"healthy"`, 9/9 findings, **81ms** (AC1's <5s easily
     met). `databases`/`mirror`/`ecp` all `notApplicable` (matches Story 23.1's live evidence);
     `journal` `ok` at `31.56%` full; `locks` `ok` at `~0%`; `license` `ok` at `0%`; `alerts`
     `ok` (`state:0`, `alertCount:4`); `interop` `ok` (`queueCount:0`, HSCUSTOM's stopped
     production — "applicable, zero queues", not `notApplicable`, matching the Story 23.0/23.1
     pinned distinction).
  2. HSCUSTOM `areas:["journal","license"]`: exactly 2 findings, areas `["journal","license"]`.
  3. HSCUSTOM `thresholds:{journalPctCrit:1}`: `journal` flipped to `critical` (value `31.56`,
     threshold `1`), overall `verdict:"critical"` — proves the override plumbing end-to-end
     through the REAL built tool against the REAL live endpoint.
  4. `healthCheckTool.inputSchema.safeParse({areas:["memory"]})` → `success:false`, confirmed
     BEFORE any HTTP call is made (Zod validation happens at the MCP framework layer, before the
     handler runs).
  5. SADEMO (via the temp webapp), `evaluate()` called directly on live-fetched raw JSON: `mirror`
     and `ecp` BOTH `notApplicable` (same as HSCUSTOM — confirms these two areas are genuinely
     **instance-wide**, not namespace-dependent, since `$SYSTEM.Mirror`/`$SYSTEM.ECP` are %SYS
     reads regardless of which namespace's webapp routed the request). `interop` differs
     MEANINGFULLY: HSCUSTOM `level:"ok" value:0` (stopped production, zero queues) vs SADEMO
     `level:"ok" value:7` (a RUNNING production, `SessionAgent.Sample.Production`, 7 named
     queues, `productionStateCode:4`) — a genuinely different, richer topology, proving the
     `interop` area's namespace-sensitivity live, not just via a unit-test fixture.
- Cross-checks against 6 sibling MCP tools (all on HSCUSTOM, called moments after the smoke):
  `iris_license_info` → `userLimit:8, currentCSPUsers:0` (exact match to the health-check's raw
  values). `iris_journal_info` → `freeSpaceBytes:349778575360` (matches the health-check's
  `volumeFreeBytes`; independently recomputing `(511067549696-349778575360)/511067549696*100 =
  31.5589...%` rounds to the SAME `31.56` the tool reported). `iris_mirror_status` →
  `isMember:false` (exact match). `iris_ecp_status` → `configured:false` (exact match).
  `iris_metrics_alerts` → `state:0, alertCount:4` (exact match, including the 4 alert messages).
  `iris_metrics_system` → `processCount:23` (exact match). `iris_locks_list` returned 12
  DISCRETE lock entries (a different metric — individual locks held, not lock-TABLE-SPACE %
  utilization) — this is BY DESIGN per the Story 23.0 spec note ("9 held locks, cross-verified
  via iris_locks_list" is a distinct signal from the byte-level `Used/(Usable+Used)` formula);
  not a discrepancy. `globalReferences`/`routineCommands` differed by a small monotonically-
  increasing delta between calls (expected — these are live, ever-incrementing counters, not
  static values).

### Completion Notes List

- **AC 23.2.1 — DONE.** `iris_health_check` matches the spec §2 contract exactly: `scope:"NONE"`,
  truthful annotations, `mutates:"read"` (scalar, no action enum), no manually-declared `server`
  field (verified by a dedicated test reading `inputSchema.shape`). Handler uses GET only (see
  Decisions for why POST was not used despite the story task's "POST when areas/thresholds
  present" suggestion) with a `?areas=<url-encoded-csv>` query string only when the caller
  supplies a non-empty `areas` array; `thresholds` is NEVER sent to the endpoint (purely local).
  `IrisApiError` → `{isError:true,...}`; other errors rethrown (unit-tested).
- **AC 23.2.2 — DONE, all 8 spec sub-criteria verified** (unit tests AND the live smoke):
  1. No-arg call: 9 findings (≥8), verdict computed, 81ms live (unit tests assert the same
     shape with mocked HTTP).
  2. `areas` subset: engine only returns findings for checked areas (unit + live).
  3. `journalPctCrit:1` flips journal to `critical` and the verdict to `critical` (unit + live).
  4. `notApplicable` (mirror/ecp/databases here) never affects the verdict — proven with BOTH an
     all-`notApplicable`-areas-still-healthy fixture AND live HSCUSTOM/SADEMO data.
  5. Error isolation: `errors.locks` → `level:"error"` for locks ONLY, 8 other findings intact,
     verdict capped at `"warning"` (never `"critical"` from the error alone) — plus a SECOND test
     proving error does NOT suppress a genuinely critical OTHER area (verdict correctly goes to
     `"critical"` when a real critical finding coexists with an unrelated error).
  6. `raw` always mirrors the checked areas exactly (`toEqual` against the fixture); an errored
     area has NO `raw` entry (it never had raw values) — asserted explicitly.
  7. Live smoke on HSCUSTOM **and** SADEMO (a genuine second namespace, not a documented gap —
     see Decisions); numeric areas cross-checked against 6 sibling tools, all within tolerance
     (exact matches or explained deltas).
  8. Governance: `health-governance.test.ts`, 3 tests, real `McpServerBase.handleToolCall` gate —
     enabled under empty config, explicit `IRIS_GOVERNANCE {"global":{"iris_health_check":false}}`
     blocks it with `GOVERNANCE_DISABLED`, registration passes `assertGovernanceClassification`.
- **AC 23.2.3 — DONE.** Registered in `tools/index.ts` (appended, minimal diff). `index.test.ts`
  updated: `toolCount` 21→22, `getToolNames` 21→22 entries incl. `iris_health_check`. Docs rollup
  complete across all 4 mandated surfaces (see Task 6), each stating the read/enabled-by-default
  governance state per Rule #30.
- **AC 23.2.4 — DONE.** All 4 sub-parts complete: (a) HSCUSTOM full/subset/threshold-flip via the
  BUILT dist tool in a real Node process; (b) SADEMO second namespace — genuinely live, via a
  temporary disposable webapp (created, used, deleted); (c) 6-tool cross-check against sibling
  MCP tools (a stand-in for the Management Portal dashboard, which is not directly scriptable —
  the sibling tools read the exact same underlying `$SYSTEM`/`SYS.*` sources the dashboard itself
  uses); (d) smoke script AND temp webapp both deleted before staging (verified: `ls` on the
  scratchpad shows the script gone; `iris_webapp_get` confirms the webapp `{exists:false}`).
  Conventions §6 DoD checklist: all ACs pass ✓; `pnpm turbo run build`/`test` green ✓; no
  ObjectScript touched this story (N/A for compile/UnitTest/bootstrap-regen items — correctly, per
  Dev Notes' "NO ObjectScript" scope) ✓; `gen:governance-baseline:check` exit 0 ✓; live smokes done
  incl. cross-checks, recorded above ✓; docs rollup complete with default-state callouts ✓; no
  `ExecuteMCPv2.Temp.*` probe classes created (N/A, TS-only story) and the smoke script + temp
  webapp both deleted ✓.

### File List

- `packages/iris-ops-mcp/src/tools/health.ts` (new) — `iris_health_check` tool definition + the
  pure `evaluate()` verdict engine + 9 per-area evaluator functions + Zod schema.
- `packages/iris-ops-mcp/src/tools/index.ts` (modified) — registered `healthCheckTool`.
- `packages/iris-ops-mcp/src/__tests__/health.test.ts` (new) — 68 tests: spec AC 1-6 fixtures,
  per-area deterministic fixtures (all 9 areas), Zod input validation, tool metadata, HTTP wiring,
  response shape, error handling.
- `packages/iris-ops-mcp/src/__tests__/health-governance.test.ts` (new) — 3 tests: governance
  default-enabled / explicit-disable / registration-classification, real `McpServerBase` gate.
- `packages/iris-ops-mcp/src/__tests__/index.test.ts` (modified) — `toolCount` 21→22,
  `getToolNames` 21→22 entries incl. `iris_health_check`.
- `README.md` (modified) — Servers table (ops 20→21 + health-check capability line), "Which
  Server Do I Need?" table (health-check capability line), suite tool count "100"→"101", ASCII
  architecture diagram (`ops (20)`→`(21)`).
- `tool_support.md` (modified) — new `iris_health_check` catalog row (#21), Epic 23
  governance-defaults note, "Fields returned" entry for `structuredContent`, Suite-wide rollup
  table + Dependency-implications prose counts (package 100→101, advertised 105→106,
  ExecuteMCPv2-backed 76→77), "Placeholder note" 100-tool→101-tool reference.
- `packages/iris-ops-mcp/README.md` (modified) — top description line, new "Health Check Tool"
  reference-table section, full `iris_health_check` Tool Examples `<details>` entry (threshold
  table, input/output examples, governance callout).
- `CHANGELOG.md` (modified) — new `## [Pre-release — 2026-07-07]` Epic 23 entry.
- `_bmad-output/implementation-artifacts/23-2-health-tool-and-docs.md` (this file — Tasks/
  Subtasks, Dev Agent Record, File List, Change Log, Status).
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified —
  `23-2-health-tool-and-docs` → `review`; `epic-23` stays `in-progress` pending the retrospective).

No ObjectScript, no `bootstrap-classes.ts`, no `governance-baseline.ts` touched (all correctly
out of scope per the Dev Notes' TS-only framing).

### Notable Decisions

- **GET-only, `thresholds` never sent to the endpoint.** The story task text suggested "POST when
  `areas`/`thresholds` present," but `Health.cls`'s `HealthCheck` dispatcher (read directly, Rule
  #16) only ever reads an `areas` key from a POST body — there is no `thresholds` field in the
  wire contract at all (threshold logic is 100% client-side, per ADR H5). GET already supports the
  full `areas` contract via a `?areas=<csv>` query string. Sending `thresholds` to the server would
  be silently ignored (harmless but pointless) and POST-vs-GET branching would add complexity with
  no behavioral benefit — so the handler always uses GET, appending `?areas=` only when the caller
  supplies a non-empty explicit subset.
- **No custom Zod error message for `memory`.** Rather than fight Zod v4's error-customization API
  (`z.enum(...,{error:...})`) for a single value, `areas` stays a plain
  `z.array(z.enum(AREA_VALUES))`. Zod's DEFAULT enum-mismatch error already enumerates all 9 valid
  values when `"memory"` (or anything else) is rejected — that satisfies "a clear Zod reject" per
  the AC wording. The "why memory was removed" context lives in the tool `description` (read by the
  LLM caller before it ever calls the tool) instead of the runtime error text. This also sidesteps
  an unverified claim: `.refine()` on a `ZodObject` IS used elsewhere in this codebase
  (`production.ts`'s `productionControlTool`) and apparently works fine with `withServerParam`'s
  `.extend()` call under Zod v4's reworked internals — but since NO cross-field validation was
  needed here, this story didn't need to lean on that pattern either way.
- **`notApplicable` excluded from the text-summary "non-ok" list, matching its exclusion from
  verdict computation.** Initially implemented literally as `level !== "ok"`, which listed
  `notApplicable` findings (e.g. "no mirror configured") as if they were problems, breaking "All N
  areas healthy" on a genuinely healthy instance with 3 informational-notApplicable areas. Fixed by
  filtering `level !== "ok" && level !== "notApplicable"` for the text-summary lines — full detail
  including `notApplicable` stays in `structuredContent.findings` regardless.
- **`v1` decisions folded in exactly as directed:** CR 23.0-1 (databases free-% health is
  maxSize-configured/mounted DBs only; documented in both the tool description and the
  `notApplicable`/aggregation explanations); CR 23.0-3 (`system`/`mirror`/`ecp`/`interop` are
  informational-only in v1 — always `ok` or `notApplicable`, no warning/critical threshold);
  CR 23.0-4 (worst-DB drives the `databases` area level via a shared severity-rank reducer, with
  `error` and `warning` at EQUAL rank — directly encoding "error counts as warning" as a reusable
  rule applied consistently to BOTH the per-DB reduction AND the top-level verdict reduction, not
  just the latter); CR 23.0-6/CR 23.1-1 (`memory` rejected, `areas:[]` = all, NaN guarded by Zod
  itself — verified empirically, not assumed); CR 23.1-2 (every fixture test asserts exact
  `level`/`value`/`threshold`, not just presence).
- **`server` field omitted from `structuredContent`, diverging from the spec §2 illustrative JSON.**
  The spec's example output includes `"server": "<profile name>"`, but `ToolContext` (D2, Epic 14)
  does NOT expose the resolved profile name to a tool handler — the `server` param is consumed and
  stripped by the framework BEFORE the handler runs (`server-base.ts`, `withServerParam`/
  `handleToolCall`), and no other existing tool in the suite echoes a synthesized `server` field for
  this same reason (verified by grep). Fabricating one here would require a framework change out of
  this story's TS-only, non-framework scope. `verdict`/`checkedAt`/`findings`/`raw` are all present
  as specified; `server` is the one documented, evidence-based omission (Rule #16).
- **Rule #34 second namespace: genuinely live, not a documented gap — via a temporary disposable
  webapp.** `iris_health_check` is `scope:"NONE"` with NO `namespace` parameter (deliberate, per
  spec — 8 of 9 areas are `%SYS`-instance-wide reads). `iris_webapp_list` confirmed
  `/api/executemcp/v2` is registered EXACTLY ONCE on this IRIS instance, bound to `HSCUSTOM` — so
  there is no built-in way to route a health-check call at a second namespace's `interop` state.
  Rather than stop at "the tool structurally can't reach a second namespace, so record the residual
  risk," a TEMPORARY webapp (`/api/executemcp/v2smoke23sademo` → `SADEMO`, same dispatch class) was
  created, smoke-tested (immediately reachable — this instance's private web server does not need a
  gateway restart to pick up a new webapp, contrary to the tool's generic caveat text), used to
  fetch live SADEMO raw JSON and run the REAL exported `evaluate()` function against it, then
  DELETED. This proved, live: `mirror`/`ecp` are genuinely instance-wide (both `notApplicable` on
  SADEMO too, identical to HSCUSTOM), while `interop` is genuinely namespace-sensitive (SADEMO has
  an ACTIVE production with 7 queues vs. HSCUSTOM's stopped/zero-queue state) — a stronger, more
  concrete result than a documented gap would have given, and fully cleaned up afterward (Rule #26).

## Change Log

| Date | Change |
|---|---|
| 2026-07-07 | Story 23.2 dev pass complete: `iris_health_check` tool + pure `evaluate()` verdict engine (`packages/iris-ops-mcp/src/tools/health.ts`) covering all 9 areas with the corrected threshold directions from Story 23.0 (journal/license/lockTable ascending, dbFreePct descending), worst-DB aggregation (CR 23.0-4), authoritative-license preference (CR 23.0-2), and informational-area v1 scoping (CR 23.0-3). Governance: `mutates:"read"`, new post-foundation key resolves enabled by default (frozen baseline `1e62c5ad5bf7` untouched, 141 frozen / 194 live / 53 post-foundation after rebuild). 71 new tests (68 `health.test.ts` + 3 `health-governance.test.ts`), ops package 256→327, zero regressions across the full monorepo (2074 tests, 6 packages). Registered in `tools/index.ts` (ops 20→21 package tools, 21→22 advertised incl. the framework tool). Docs rollup across all 4 mandated surfaces (root README, tool_support.md, ops README, CHANGELOG) with default-state callouts per Rule #30. Live smokes (Rules #22/#26/#34): HSCUSTOM full/subset/threshold-override-flip via the BUILT dist tool (81ms full check); a genuine second-namespace (SADEMO) smoke via a temporary disposable webapp, proving `mirror`/`ecp` are instance-wide (notApplicable on both namespaces) while `interop` is genuinely namespace-sensitive (0 vs 7 queues); 6-sibling-tool numeric cross-check, all within tolerance. Smoke script and temporary webapp both deleted before staging. Status: ready-for-dev → review. |
| 2026-07-08 | Code review (three-layer adversarial + endpoint/framework source verification): **0 HIGH, 0 MEDIUM (blocking)**. 2 LOW auto-fixed inline (CR 23.2-P1 non-finite hardening of the pure `evaluate()` engine; CR 23.2-P2 worst-DB tie-break determinism) with +6 regression tests (ops 329→335, `type-check` clean, `gen:governance-baseline:check` exit 0, frozen `1e62c5ad5bf7` untouched). 3 LOW deferred (CR 23.2-1 `server` field omission — verified acceptable against `ToolContext`/`IrisConnectionConfig` source; CR 23.2-2 unknown-error-key drop — not live-reachable; CR 23.2-3 missing-`result` TypeError — near-unreachable). The two hunters' MEDIUM (numerator-NaN) was downgraded to LOW after reading `Health.cls` (endpoint emits every numeric with a `"number"` hint + 0-default → not live-reachable) and patched anyway as cheap pure-function hardening. All Story-23.2-owned CR items reconciled RESOLVED in `deferred-work.md` (CR 23.0-1/-2/-3/-4/-6, CR 23.1-1/-2). Status: review → done. |

## Review Findings (code review, 2026-07-08)

**Outcome:** 0 HIGH, 0 MEDIUM (blocking). Three-layer adversarial review (Blind Hunter / Edge Case Hunter / Acceptance Auditor) plus a source read of the Story-23.1 endpoint (`Health.cls`) and the shared framework (`ToolContext`/`IrisConnectionConfig`/`server-base.ts`). 2 LOW auto-fixed inline; 3 LOW deferred; several cosmetic/by-design dismissed. Ops suite green post-patch (**335 tests**, was 329); `type-check` clean; `gen:governance-baseline:check` exit 0 (frozen `1e62c5ad5bf7` untouched, `governance-baseline.ts` not in diff). Verdict-engine correctness confirmed: threshold directions correct (journal/license/lockTable ASCENDING, dbFree DESCENDING), `error` ranks == `warning` (never fakes `critical`), `notApplicable` never affects the verdict, license prefers `licenseCurrentPct`, informational areas documented in the tool description. `server`-field omission verified ACCEPTABLE (the typed `ToolContext` exposes no profile name; no sibling tool echoes one).

### Patches applied (LOW, fixed)
- [x] [Review][Patch] CR 23.2-P1 — Non-finite hardening of the pure `evaluate()` engine (journal/database/license % + `mergeThresholds`); a non-finite computed value → `notApplicable`, a non-finite threshold override → ignored — never a false `ok`/`critical`/downgrade. [packages/iris-ops-mcp/src/tools/health.ts] +4 tests. (Blind + Edge rated MEDIUM; downgraded to LOW after `Health.cls` read proved it not live-reachable — the endpoint emits every numeric with a `"number"` type hint + 0-default; patched anyway to harden the exported function.)
- [x] [Review][Patch] CR 23.2-P2 — Worst-DB tie-break determinism (CR 23.0-4 hardening): at equal severity rank prefer `error` over `warning` (surface an `openFailed` DB), then the lower `freePct`; order-independent. Verdict unchanged. [packages/iris-ops-mcp/src/tools/health.ts] +2 tests.

### Deferred (LOW — recorded in deferred-work.md "code review of story-23.2")
- [x] [Review][Defer] CR 23.2-1 — `server` output field omitted from `structuredContent`; verified acceptable (ToolContext exposes no profile name); spec §2 reconciliation is a future framework touch.
- [x] [Review][Defer] CR 23.2-2 — Unknown `errors` key outside the 9-area enum silently dropped by `evaluate()`; not live-reachable (endpoint only emits the 9 canonical area keys); a guard needs widening the typed `Finding.area` contract.
- [x] [Review][Defer] CR 23.2-3 — A 200 response missing `result` throws a raw `TypeError`; near-unreachable; the fix direction (explicit `isError` vs graceful empty) is a small design choice.

### Dismissed (by-design / cosmetic / not-reachable)
- `notApplicable` excluded from the text "non-ok" lines (serves spec intent — keeps "All N areas healthy" correct); "All N/0 areas healthy" wording (verdict always correct); `NaN`/`undefined` in `system`/`alerts` explanation text (informational areas, and the endpoint always emits those numerics).
