# Story 17.3: `iris_sql_analyze` — SQL Analysis

**Status:** done

**Epic:** 17 — Interop & Dev Tools (`iris-interop-mcp` + `iris-dev-mcp`)

## Story

**As a** developer, **I want** show-plan, runtime stats, index usage, and currently-running statements, **so that** I can diagnose SQL performance via the agent.

## Acceptance Criteria

- **AC 17.3.1** — New tool `iris_sql_analyze` in `@iris-mcp/dev`. Actions: `explain` (show plan), `stats` (runtime statistics), `indexUsage`, `running` (current statements). All four are READ-ONLY.
- **AC 17.3.2** — **TypeScript/SQL-only — NO new ObjectScript handler, NO bootstrap contribution** (settled in `17-0-api-probes.md` Area 3 / "Determinations settled"). Backed by the Atelier query endpoint (mirror `iris_sql_execute` in `packages/iris-dev-mcp/src/tools/sql.ts`):
  - `explain` → `EXPLAIN <query>` (returns a `Plan` column).
  - `running` → `SELECT … FROM INFORMATION_SCHEMA.CURRENT_STATEMENTS`.
  - `stats` → `SELECT … FROM INFORMATION_SCHEMA.STATEMENTS` (optionally `STATEMENT_DAILY_STATS`/`STATEMENT_HOURLY_STATS`).
  - `indexUsage` → derive from the `EXPLAIN` plan text (indexes/maps named) and/or `INFORMATION_SCHEMA.STATEMENT_RELATIONS`.
  - **Use the UNDERSCORED table names** (`CURRENT_STATEMENTS`, `STATEMENT_DAILY_STATS`, `STATEMENT_HOURLY_STATS`) per `17-0-api-probes.md` DISCREPANCY #2 — the no-underscore names return `SQLCODE -30`.
- **AC 17.3.3** — Input: `action`; `query` (required for `explain` and `indexUsage`); optional filter params for `stats`/`running` (e.g. a `filter`/`schema` substring, `maxRows`); `server`; `namespace`. Output: a structuredContent OBJECT per action — `explain` → `{ action, plan }` (or `{columns,rows}`); `running`/`stats` → `{ action, columns, rows, rowCount }`; `indexUsage` → `{ action, indexes:[…] }` (and/or plan rows). SQL errors → MCP `isError:true` (mirror sql.ts).
- **AC 17.3.4** — **Governance:** the four NEW action keys are absent from the frozen baseline → they MUST carry a `mutates` classification or registration throws (`assertGovernanceClassification`). Declare `mutates: { explain: "read", stats: "read", indexUsage: "read", running: "read" }` — all reads → default-ENABLED. (The probe doc's "no mutates" note is superseded: a new non-baseline key with NO `mutates` fails the registration assertion even though reads default-enabled.) `governance-baseline.ts` stays frozen `1e62c5ad5bf7` (141 keys); verify `pnpm run gen:governance-baseline:check` exit 0.
- **AC 17.3.5** — Unit tests (mocked http) covering each action (`explain`/`stats`/`indexUsage`/`running`) + the SQL-error path + a governance proof that all four actions are ALLOWED under empty `IRIS_GOVERNANCE` (reads default-enabled) through the real `McpServerBase.handleToolCall` gate. DEFAULT suite (`*.test.ts`). Bump `index.test.ts` dev tool-count assertion (+1).
- **AC 17.3.6** — **NO `BOOTSTRAP_VERSION` change, NO `bootstrap-classes.ts` regen, NO ObjectScript** (this story is pure TypeScript). Confirm `git diff` shows no change to `bootstrap-classes.ts`/`BOOTSTRAP_VERSION`/`src/ExecuteMCPv2/**` and `bootstrap.test.ts` stays green at `39dc932907cb` (the Story 17.2 value). Strictly additive — `iris_sql_execute` and all other dev tools unchanged.

## Tasks / Subtasks

- [x] **Task 1 (AC 17.3.1–17.3.3)** — Create `packages/iris-dev-mcp/src/tools/sqlAnalyze.ts` exporting `sqlAnalyzeTool` (name `iris_sql_analyze`, scope `"NS"`, `mutates` all-read per AC 17.3.4). Mirror `sql.ts`: `atelierPath(ctx.atelierVersion, ns, "action/query")`, `ctx.http.post(path, {query})`, parse `result.content[]` rows, return a structuredContent OBJECT. Build the per-action SQL: `explain`→`"EXPLAIN " + query`; `running`→`SELECT * FROM INFORMATION_SCHEMA.CURRENT_STATEMENTS` (+ optional namespace/filter); `stats`→`SELECT … FROM INFORMATION_SCHEMA.STATEMENTS` (+ optional filter); `indexUsage`→run `EXPLAIN <query>` and extract the indexes/maps named in the plan text (and/or query `INFORMATION_SCHEMA.STATEMENT_RELATIONS`). Validate `query` is present for `explain`/`indexUsage` with a clear error.
- [x] **Task 2 (AC 17.3.1)** — Register `sqlAnalyzeTool` in `packages/iris-dev-mcp/src/tools/index.ts`.
- [x] **Task 3 (AC 17.3.5)** — Add `sqlAnalyze.test.ts` (unit, mocked http — each action's SQL is built correctly + the response is shaped to an object + SQL-error path) and `sqlAnalyze-governance.test.ts` (real-gate proof — all 4 actions ALLOWED under empty config). Bump `index.test.ts` dev tool-count (+1).
- [x] **Task 4 (AC 17.3.4/17.3.6)** — `pnpm run gen:governance-baseline:check` (exit 0, frozen `1e62c5ad5bf7`). Confirm NO bootstrap/ObjectScript change (`git diff` clean for those paths; `bootstrap.test.ts` green at `39dc932907cb`). Full monorepo `turbo run test`/`lint`/`build` green.

## Dev Notes

### Primary reference — READ FIRST
`_bmad-output/implementation-artifacts/17-0-api-probes.md` **Area 3** (authoritative). Live-verified determinations:
- **Atelier/SQL-only** — no ObjectScript handler, no bootstrap. This story is TypeScript only.
- `EXPLAIN <query>` works via the Atelier query endpoint and returns a `Plan` column (one row, XML `<plans><plan>…</plan></plans>` with `SQL:`, `Cost:`, module/loop text). Confirmed live: `EXPLAIN SELECT TOP 1 * FROM Ens_Config.Item`.
- **INFORMATION_SCHEMA tables are UNDERSCORED** (DISCREPANCY #2): `CURRENT_STATEMENTS` (running — 22 cols incl. `SQLStatementID,ProcessID,UserName,Namespace,ExecutionStart,ExecutionDuration,Status`), `STATEMENTS` (stats — 33 cols incl. `Hash,Statement,Plan,StatCount,StatTotal,StatAverage,StatStdDev,Timestamp`), `STATEMENT_DAILY_STATS`/`STATEMENT_HOURLY_STATS`, `STATEMENT_RELATIONS`. The no-underscore names FAIL (`SQLCODE -30`).

### Pattern to mirror exactly
`packages/iris-dev-mcp/src/tools/sql.ts` (`sqlExecuteTool`) — same `atelierPath(ctx.atelierVersion, ns, "action/query")` call, same `result.content[]` → columns/rows parsing, same `IrisApiError` → `isError` catch, same structuredContent-as-object shape. `iris_sql_analyze` is essentially `sql.ts` with a per-action SQL builder in front. For `mutates`, copy the record-form from `packages/iris-ops-mcp/src/tools/process.ts` (but all-`read` here). Governance test harness: `packages/iris-ops-mcp/src/__tests__/process-governance.test.ts` (adapt to assert all-ALLOWED).

### Governance — reads STILL need `mutates` (registration assertion)
`server-base.ts rebuildGovernedKeys` derives a key per `action` enum value → `iris_sql_analyze:{explain,stats,indexUsage,running}`. These are NOT in the frozen baseline. `assertGovernanceClassification` (called at registration) THROWS on any non-baseline key lacking a `mutates` class — **including reads**. So declare `mutates: { explain:"read", stats:"read", indexUsage:"read", running:"read" }`. Reads resolve to default-enabled via `defaultSeed` (mutates !== "write" → enabled). Do NOT add keys to `governance-baseline.ts`; verify it stays `1e62c5ad5bf7` via `gen:governance-baseline:check`. Never run the bare generator (Rule #25).

### NO bootstrap, NO ObjectScript (Rule #24 — this story contributes nothing)
Per the 17.0 determination, `iris_sql_analyze` needs no `ExecuteMCPv2.*` handler. Do NOT edit any `.cls`, do NOT run `gen:bootstrap`, do NOT touch `BOOTSTRAP_VERSION`/`bootstrap-classes.ts`. `bootstrap.test.ts` must stay green at `39dc932907cb` (Story 17.2's value) with no diff.

### structuredContent
Object, not array. For tabular actions use `{ action, columns, rows, rowCount }` (mirror sql.ts's `{columns,rows,rowCount}` + an `action` discriminator). For `explain` a `{ action, plan }` (the Plan text/rows). For `indexUsage` a `{ action, indexes:[…], plan? }`.

### `server` + `namespace`
`namespace` via `ctx.resolveNamespace(namespace)` (mirror sql.ts). `server` is injected/stripped by the shared `withServerParam` layer — do not hand-handle it.

### Testing standards
- Unit (mocked http): assert the exact SQL built per action (EXPLAIN prefix; the underscored INFORMATION_SCHEMA table names), the object-shaped result, and the SQL-error path.
- Governance: real-gate proof — all 4 actions ALLOWED under empty `IRIS_GOVERNANCE`.
- Lead live smoke (later gate): drive the deployed tool's SQL paths against live HSCUSTOM read-only (EXPLAIN a real query; SELECT from CURRENT_STATEMENTS/STATEMENTS) — no writes.

### References
- `17-0-api-probes.md` Area 3 + Summary discrepancy #2 + "Determinations settled" (17.3 = TS/SQL-only)
- `epics.md:3617–3625` (Story 17.3 ACs + impl notes)
- `.claude/rules/project-rules.md` Rules #16, #23, #24, #25; governance contract in `packages/shared/src/governance.ts` (`assertGovernanceClassification`, `defaultSeed`)
- Patterns: `packages/iris-dev-mcp/src/tools/sql.ts`, `packages/iris-ops-mcp/src/tools/process.ts` (mutates), `packages/iris-ops-mcp/src/__tests__/process-governance.test.ts`

## Integration ACs

No NEW service consumed by other stories — `iris_sql_analyze` is a standalone leaf read tool in `@iris-mcp/dev`. No in-epic consumer; exercised by its own unit + governance tests (AC 17.3.5) and the lead's live read-only smoke. (Rule 1 escape clause.)

## Dev Agent Record

### Agent Model Used
claude-opus-4-8[1m] (dev-story)

### Debug Log References
- Live read-only verification (HSCUSTOM) via `iris_sql_execute`:
  - `EXPLAIN SELECT TOP 1 * FROM Ens_Config.Item` → `Plan` column, one row; plan text named `Read master map Ens_Config.Item.IDKEY` (confirms the `explain`/`indexUsage` plan shape + parse anchor).
  - `SELECT TOP 1 SQLStatementID,ProcessID,UserName,Namespace,ExecutionDuration,Status FROM INFORMATION_SCHEMA.CURRENT_STATEMENTS` → 1 row (confirms `running` underscored-table name).
  - `SELECT TOP 1 Hash,StatCount,StatTotal,StatAverage FROM INFORMATION_SCHEMA.STATEMENTS` → 1 row (confirms `stats` underscored-table name).
- `npm run gen:governance-baseline:check` → exit 0, frozen foundation keys 141 (`1e62c5ad5bf7` unchanged); live keys grew (post-foundation new keys allowed = the 4 new `iris_sql_analyze:*` keys).
- `git diff` shows ZERO change to `packages/shared/src/bootstrap-classes.ts`, `BOOTSTRAP_VERSION`, or `src/ExecuteMCPv2/**`; `bootstrap`/`profiles-bootstrap` tests green at `39dc932907cb`.

### Completion Notes List
- New `iris_sql_analyze` tool in `@iris-mcp/dev` — four READ-ONLY actions (`explain`/`stats`/`indexUsage`/`running`), TypeScript/SQL-only, NO ObjectScript, NO bootstrap contribution (per `17-0-api-probes.md` Area 3).
- Mirrors `sql.ts`: `atelierPath(…, "action/query")` + `ctx.http.post(path, {query})` + `result.content[]` → tabular parsing; `IrisApiError` → `isError:true`; non-`IrisApiError` rethrown.
- Per-action SQL builder: `explain`/`indexUsage` → `"EXPLAIN " + query` (validated `query` present, returns `isError` before any I/O if absent); `running` → `SELECT * FROM INFORMATION_SCHEMA.CURRENT_STATEMENTS`; `stats` → `SELECT Hash, Statement, StatCount, … FROM INFORMATION_SCHEMA.STATEMENTS`. UNDERSCORED INFORMATION_SCHEMA names (DISCREPANCY #2). Optional `filter` adds a case-insensitive `LIKE` predicate (single-quote escaped) — `running` on `UserName`, `stats` on `Statement`. Optional `maxRows` (default 1000) with truncation reporting.
- `indexUsage` runs `EXPLAIN` then parses the plan text for `master map` / `index map` / `bitmap` / `map` references → de-duplicated `indexes[]`, returned with the raw `plan`.
- structuredContent is an OBJECT per action: `explain` → `{action, plan}`; `indexUsage` → `{action, indexes, plan}`; `running`/`stats` → `{action, columns, rows, rowCount[, truncated, totalAvailable]}`. Unit tests assert `Array.isArray(structuredContent) === false`.
- **Governance:** declared `mutates: { explain:"read", stats:"read", indexUsage:"read", running:"read" }` — required because all four keys are NEW (absent from the frozen baseline) and `assertGovernanceClassification` throws on any unclassified non-baseline key (including reads). Reads resolve default-ENABLED via `defaultSeed`. `governance-baseline.ts` untouched (frozen `1e62c5ad5bf7`).
- Tests: `sqlAnalyze.test.ts` (16 unit, mocked http — per-action SQL build, object-shape, filter/maxRows, namespace override, SQL-error + rethrow paths) and `sqlAnalyze-governance.test.ts` (5 real-gate — all 4 actions ALLOWED under empty `IRIS_GOVERNANCE` through `McpServerBase.handleToolCall` + registration-no-throw proof). `index.test.ts` dev tool-count bumped 24→25 and ordered-name arrays updated.
- Strictly additive: `iris_sql_execute` and all other dev tools unchanged. Full monorepo `turbo run lint build test` green (18 tasks).

### File List
- `packages/iris-dev-mcp/src/tools/sqlAnalyze.ts` (new) — `sqlAnalyzeTool` implementation
- `packages/iris-dev-mcp/src/tools/index.ts` (modified) — import + register `sqlAnalyzeTool`
- `packages/iris-dev-mcp/src/__tests__/sqlAnalyze.test.ts` (new) — unit tests
- `packages/iris-dev-mcp/src/__tests__/sqlAnalyze-governance.test.ts` (new) — real-gate governance proof
- `packages/iris-dev-mcp/src/__tests__/index.test.ts` (modified) — dev tool-count 24→25 + ordered names
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified) — story → in-progress → review

## Review Findings (code review — 2026-06-16)

Three-layer adversarial review (Blind Hunter, Edge Case Hunter, Acceptance Auditor). **All six ACs (17.3.1–17.3.6) PASS.** Full suite green (sqlAnalyze 16 unit + 5 governance + 16 e2e = 37; index 8; bootstrap 41), `@iris-mcp/dev` lint + build clean, governance baseline `--check` exit 0 (frozen `1e62c5ad5bf7`, 141 keys git-clean), `BOOTSTRAP_VERSION` unchanged at `39dc932907cb`, zero diff to `bootstrap-classes.ts`/`src/ExecuteMCPv2/**`.

**Verified:**
- Pattern fidelity to `sql.ts` — `atelierPath(ctx.atelierVersion, ns, "action/query")`, `result.content[]` parse, `IrisApiError`→`isError:true`, non-`IrisApiError` rethrow, structuredContent OBJECT (never array, asserted per action).
- Per-action SQL matches `17-0-api-probes.md` Area 3 exactly — `EXPLAIN <query>` (returns `Plan` column); UNDERSCORED `INFORMATION_SCHEMA.CURRENT_STATEMENTS` (running) + `INFORMATION_SCHEMA.STATEMENTS` (stats). E2e adds explicit negative regression guards against the no-underscore (`SQLCODE -30`) form.
- Governance (Rule #23/#25) — `mutates` all-`read` classified (required even for reads; the probe doc's "no mutates" note is correctly superseded by the spec); the governance test genuinely drives `McpServerBase.handleToolCall` (real schema + `mutates`, spy handler) proving all 4 allowed-by-default AND registration-no-throw. Baseline frozen, git-clean.
- Rule #24 (Story-17.3 contributes NO ObjectScript) — confirmed: no `.cls` edit, no `gen:bootstrap`, `bootstrap.test.ts` green.
- `indexUsage` plan-text regex reasonable; QA parser-branch tests (bitmap/temp-file/bare-map + dedup) non-vacuous. `iris_sql_execute` + all other dev tools unchanged (additive).

**Patches applied inline (2 — auto-resolved):**
- **CR 17.3-1 (MED) — `filter` LIKE-wildcard leak.** The `stats`/`running` filter doubled single-quotes (correct quote-breakout escape) but did NOT escape LIKE wildcards `%`/`_`, so `50%`/`a_b` silently broadened the match vs the advertised "substring filter" semantics (NOT an injection). Fix: new `likeSubstringPredicate(filter)` helper escapes `\`, then `%`/`_`, then doubles `'`, and appends `ESCAPE '\'`; both call sites use it. 2 unit assertions updated for the `ESCAPE` clause; 2 new e2e tests (`%`/`_` + backslash escaping). `packages/iris-dev-mcp/src/tools/sqlAnalyze.ts`.
- **CR 17.3-2 (LOW) — whitespace-only `query` bypass.** The `explain`/`indexUsage` required-`query` guard rejected `undefined`/`""` but let `"   "` fall through to a server-side SQL error. Fix: guard now uses `query.trim() === ""`. 2 new e2e tests (whitespace-only rejected pre-HTTP for both actions). `packages/iris-dev-mcp/src/tools/sqlAnalyze.ts`.

**Dismissed (by-design / noise):** `EXPLAIN <query>` direct interpolation (intended pass-through, read-only, user's own query — same trust model as `iris_sql_execute`); `parsePlanIndexes` bare-`map` precision trade-off (acceptable for machine-generated plan text); `String(...Plan ?? "")` (Plan is a live-verified string column); `maxRows` 0/negative (Zod rejects pre-handler); `toTabular` heterogeneous keys (standard SQL assumption, mirrors `sql.ts`); optional `schema` param + daily/hourly stats tables (spec "e.g."/"optionally" — out of scope).

See `_bmad-output/implementation-artifacts/deferred-work.md` ("code review of story 17.3") — no items deferred (both findings resolved inline).

## Change Log

| Date | Change |
|---|---|
| 2026-06-16 | Story 17.3 created (lead). Grounded in `17-0-api-probes.md` Area 3 (TS/SQL-only determination + underscored INFORMATION_SCHEMA names). New `iris_sql_analyze` (dev): explain/stats/indexUsage/running, all reads → `mutates` all-`read` (required for registration even though reads default-enabled). NO ObjectScript, NO bootstrap contribution. Frozen governance baseline (Rule #23/#25). Status → ready-for-dev. |
| 2026-06-16 | Story 17.3 implemented (dev). New `sqlAnalyzeTool` (`iris_sql_analyze`) + registration; per-action SQL builder mirroring `sql.ts`; structuredContent objects per action; `indexUsage` plan-text parse. `mutates` all-`read`. Unit (16) + real-gate governance (5) tests added; `index.test.ts` count 24→25. Live read-only verified (EXPLAIN + CURRENT_STATEMENTS + STATEMENTS on HSCUSTOM). Governance baseline frozen `1e62c5ad5bf7` (check exit 0). NO bootstrap/ObjectScript change (`39dc932907cb` unchanged). Full monorepo lint/build/test green. Status → review. |
| 2026-06-16 | Code review (3-layer). All 6 ACs PASS. 2 patches applied inline: (CR 17.3-1 MED) `filter` LIKE-wildcard escaping via new `likeSubstringPredicate` helper + `ESCAPE '\'` clause; (CR 17.3-2 LOW) reject whitespace-only `query` via `.trim()`. +4 e2e tests (e2e 12→16; sqlAnalyze suite 37 total). Lint/build/governance-baseline-check (exit 0, `1e62c5ad5bf7`)/bootstrap.test (`39dc932907cb`) all green. No items deferred. Status remains review. |
