# Spec 06 — SQL Performance Advisor: `iris_sql_analyze` `advise` Action

**Server:** `@iris-mcp/dev` (extends existing tool) | **Priority:** 6 (signature feature) | **Effort:** ~4 stories
**Governance:** new action on existing tool — add `advise: "read"` to `iris_sql_analyze`'s
per-action `mutates` map (its four existing actions are already classified reads, Epic 17). No writes in v1.
**Prereqs:** none | **Read first:** [`00-conventions.md`](00-conventions.md),
`packages/iris-dev-mcp/src/tools/` (the sql-analyze tool file), the ObjectScript handler behind
`/dev/sql/analyze` (find it via `Dispatch.cls` UrlMap), `irislib/%SYSTEM/SQL*.cls`,
project Rule #36 (reference-parity ground-truth pinning — this spec's test discipline)

## 1. Objective

Turn the existing plan/stats primitives into an **advisor**: given a query (or the current
statement workload), return findings with evidence — the market-proven differentiator that
made Postgres MCP Pro the category leader. Strictly advisory: it recommends, cites evidence,
and never applies anything.

## 2. MANDATORY Story 0 — statistics & plan-marker probe (Rules #14/#16)

IRIS has **no native index advisor**; the advisor is heuristics over plan text + dictionary +
runtime stats. Every heuristic input must be pinned live before speccing details:

1. **Plan markers:** run the existing `explain` action against a fixture set (§5) on live IRIS;
   catalog the EXACT plan-text markers for: full master-map read (table scan), index map read,
   temp-file/intermediate build, subquery/join strategies. Record marker strings verbatim —
   these become the parser's contract.
2. **Dictionary surfaces:** pin how to enumerate a table's indices + their columns
   (`%Dictionary.CompiledIndex` via SQL or object access) and the class↔table mapping.
3. **Tuning stats:** pin where TuneTable results live and how to read staleness
   (`ExtentSize`, per-property selectivity, last-tune info) — check
   `%SYS.PTools`/`%SQL.Statement` metadata and the existing `stats` action's source first;
   prefer whatever surface the existing action already reads.
4. **Statement workload:** the existing `running`/`stats` actions expose current/recent
   statements `[verify]`; pin what "top recent statements" data is actually available on
   2023.1+ Community Edition (SQL Statement Index: `INFORMATION_SCHEMA.STATEMENTS` family)
   for the `workload` input mode.
5. Deliverable: amended §4 heuristics table with pinned sources; probe classes deleted.

## 3. Tool contract (delta to existing `iris_sql_analyze`)

New action `advise`:

| Param | Type | Notes |
|---|---|---|
| `action` | `"advise"` (added to enum) | |
| `query` | `string?` | The SQL to advise on. Mutually exclusive with `workload` |
| `workload` | `boolean?` | Advise on top recent statements instead of one query (availability per Story-0 finding; if unavailable on the platform, return a clear capability error) |
| `topN` | `number?` default 5, max 20 | Workload mode: how many statements to analyze. **This caps analysis breadth, which IS scan work — document per Rule #38** |
| `namespace` | existing param | |

**Output (`structuredContent`):**
```json
{ "mode": "query" | "workload",
  "findings": [ {
    "type": "full-scan" | "missing-index" | "stale-stats" | "unused-index" | "plan-anomaly",
    "confidence": "high" | "medium" | "low",
    "statement": "<the SQL>",
    "evidence": "Plan shows 'Read master map ...' over table X with WHERE on col Y; no index on Y (checked %Dictionary).",
    "recommendation": "Consider: CREATE INDEX YIdx ON TableX (Y). Verify with EXPLAIN after creation.",
    "suggestedDdl": "CREATE INDEX ...", // only for missing-index, else omitted
    "planExcerpt": "<relevant plan lines>" } ],
  "analyzed": { "statements": 1, "skipped": 0 } }
```

Text content: findings ranked by confidence, evidence-first. When no findings: say so
explicitly with what WAS checked (no silent empty).

## 4. Heuristics (initial set — refine per Story 0)

| Finding | Trigger | Evidence requirements |
|---|---|---|
| `full-scan` | Plan contains the pinned master-map-read marker AND the statement has a WHERE/JOIN predicate | Plan excerpt + table name |
| `missing-index` | `full-scan` fired AND ≥1 equality/range predicate column has no index containing it as leading subscript | Predicate column(s), existing-index list consulted, suggested DDL. Confidence `high` only for single-column equality; `medium` otherwise. **Never suggest for system classes (`%*`, `INFORMATION_SCHEMA`)** |
| `stale-stats` | Table's tune metadata missing OR ExtentSize wildly diverges from actual row count (cheap `SELECT COUNT(*)` capped/estimated — skip when table is large; use the dictionary extent estimate only, no full counts) | Tune timestamp/values vs observed |
| `unused-index` | Reuse the existing `indexUsage` action's data: index with zero usage over its observation window on a table the workload touches | Usage counts; confidence `low` (observation windows lie) |
| `plan-anomaly` | Temp-file/intermediate markers on simple-looking statements | Plan excerpt; confidence `low` |

All parsing lives ObjectScript-side? **No — split:** ObjectScript returns raw materials (plan
text via existing explain path, index dictionary rows, tune metadata — one new consolidated
route `POST /dev/sql/advise-data` returning all three for a statement); the heuristic engine
lives in TypeScript (testable with fixture JSON, no bootstrap bump per heuristic tweak).

## 5. Fixture & test discipline (Rule #36 — non-negotiable)

Create `ExecuteMCPv2.Test.AdvisorFixture` schema on the live instance (a scratch table with
known columns, one index, deliberately un-tuned): fixture queries with KNOWN correct advice
(missing index on unindexed column; no finding on indexed lookup; stale stats before TuneTable,
clean after). **Capture the actual plan text from the live instance into TS test fixtures** —
expected values must be reference-captured, never hand-reasoned. The TS heuristic tests replay
captured plans; the ObjectScript tests verify the data endpoint shape. Document the IRIS
version the plans were captured on (plan text varies by version — the parser must treat
unrecognized plans as `no findings + "plan format not recognized"`, never crash or guess).

## 6. Story breakdown

1. **Story 0 — probe (1):** §2. Amend spec.
2. **Story 1 — data endpoint (1):** `/dev/sql/advise-data` ObjectScript (plan + indices + tune
   metadata in one response) + unit tests + deploy/bootstrap.
3. **Story 2 — heuristic engine (1):** TS engine + captured-fixture tests (every heuristic:
   fires-when-should + does-NOT-fire-when-shouldn't) + graceful unknown-plan handling.
4. **Story 3 — tool surface + docs + smokes (1):** `advise` action wiring + `mutates` map
   update + governance test (new read enabled by default, Rule #28) + docs rollup (advisory
   disclaimer: "recommendations are heuristic; verify with explain before applying") + live
   smokes: fixture-table advise on HSCUSTOM AND a second namespace (Rule #34); workload mode
   (or its capability error) live.

## 7. Acceptance criteria

1. On the fixture set: `missing-index` fires with correct suggested DDL on the seeded case;
   NO finding on the properly-indexed case; `stale-stats` fires before tune and clears after.
   All expected values reference-captured (Rule #36) — cite the capture command in test comments.
2. Unrecognized plan text → `findings: []` + explicit "not recognized" note (fuzz with garbage).
3. Every finding carries evidence + plan excerpt; zero findings without citations.
4. No recommendations against `%*`/system schemas.
5. `advise` classified read + enabled by default; existing four actions' behavior byte-for-byte
   unchanged (snapshot test on their outputs — Rule #19).
6. Workload mode works on the live platform or fails with a clear capability message
   (per Story-0 finding) — never a raw error.
7. Docs rollup complete incl. the advisory disclaimer; conventions §6 checklist complete.

## 8. Out of scope (v1)

- `applyIndex` write action (future story; would be `write`, default-disabled).
- Cost-based ranking across findings; historical trend analysis.
- Frozen-plan management, parallel-query tuning, sharding advice.
