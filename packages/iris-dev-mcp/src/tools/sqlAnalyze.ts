/**
 * SQL analysis tool for the IRIS Development MCP server.
 *
 * Provides {@link sqlAnalyzeTool} — `iris_sql_analyze` — a single multi-action,
 * READ-ONLY tool to diagnose SQL performance against an IRIS namespace via the
 * Atelier query endpoint (the same surface `iris_sql_execute` uses). Actions:
 *
 * - **explain** (read): show the query plan via the `EXPLAIN <query>` SQL
 *   statement, which returns a single `Plan` column (XML `<plans><plan>…`).
 *   Requires `query`.
 * - **stats** (read): per-statement cumulative runtime statistics from
 *   `INFORMATION_SCHEMA.STATEMENTS`.
 * - **indexUsage** (read): derive the maps/indexes a query reads from its
 *   `EXPLAIN` plan text. Requires `query`.
 * - **running** (read): currently-executing statements from
 *   `INFORMATION_SCHEMA.CURRENT_STATEMENTS`.
 * - **advise** (read, Epic 28 Story 28.3): the SQL Performance Advisor. Given
 *   `query` (or `workload: true` for the top-N recent statements), calls the
 *   Story 28.1 ObjectScript endpoint `POST /dev/sql/advise-data` for the raw
 *   plan/dictionary materials and runs them through the Story 28.2 pure-TS
 *   heuristic engine ({@link analyzeAdviceData} in `./sqlAdvisor.js`) to
 *   produce ranked, evidence-cited findings (`full-scan`, `missing-index`,
 *   `stale-stats`, `unused-index`, `plan-anomaly`). **Strictly advisory** —
 *   it recommends and cites evidence, and never applies anything (no
 *   `applyIndex`/write action ships in v1, spec §8).
 *
 * **TypeScript/SQL-only for the first four actions.** There is NO
 * `ExecuteMCPv2.*` ObjectScript handler behind them and NO bootstrap
 * contribution (settled in `17-0-api-probes.md` Area 3) — each is built from
 * SQL and posted through `atelierPath(…, "action/query")`. `advise` is the
 * exception: it is the FIRST caller of the new `/dev/sql/advise-data` custom
 * REST route (Story 28.1); `advise`'s `workload` mode ALSO uses the Atelier
 * `action/query` path (like the other four) to enumerate the recent
 * statement workload before advising each one.
 *
 * **INFORMATION_SCHEMA table names are UNDERSCORED** (`CURRENT_STATEMENTS`,
 * `STATEMENTS`, …) per `17-0-api-probes.md` DISCREPANCY #2; the no-underscore
 * names return `SQLCODE -30`.
 *
 * **Governance (frozen-foundation model).** All five action keys are NEW
 * post-foundation keys (absent from the frozen `governance-baseline.ts`), so each
 * MUST be classified in `mutates` or registration throws
 * (`assertGovernanceClassification`). All five are reads → declared
 * `mutates: "read"` → default-ENABLED via `defaultSeed`. The `server` field is
 * framework-injected (architecture decision D2), so it is not declared on the
 * schema.
 *
 * SQL errors (invalid syntax, missing tables, etc.) are returned as MCP tool
 * errors with `isError: true` (mirrors `iris_sql_execute`).
 */

import { atelierPath, IrisApiError, type ToolContext, type ToolDefinition, type ToolResult } from "@iris-mcp/shared";
import { z } from "zod";
import { analyzeAdviceData, type AdviseData, type AdvisorAnalysisResult, type AdvisorFinding } from "./sqlAdvisor.js";

/** Default maximum number of rows returned for tabular actions. */
const DEFAULT_MAX_ROWS = 1000;

/**
 * Extract row objects from an Atelier query response envelope.
 *
 * The query response returns `result.content` as an array of row objects, e.g.
 * `[{ Col1: "val", Col2: 42 }, …]`.
 */
function rowObjects(response: { result?: unknown }): Record<string, unknown>[] {
  const content = (response.result as { content?: Record<string, unknown>[] })?.content;
  return Array.isArray(content) ? content : [];
}

/**
 * Shape an array of row objects into a tabular `{ columns, rows, rowCount }`
 * structure, applying a maxRows limit (mirrors `iris_sql_execute`).
 */
function toTabular(
  allRowObjects: Record<string, unknown>[],
  maxRows: number,
): { columns: string[]; rows: unknown[][]; rowCount: number; truncated?: boolean; totalAvailable?: number } {
  const columns: string[] =
    allRowObjects.length > 0 ? Object.keys(allRowObjects[0] as Record<string, unknown>) : [];
  const limited = allRowObjects.slice(0, maxRows);
  const truncated = allRowObjects.length > maxRows;
  const rows = limited.map((row) => columns.map((col) => row[col]));
  return {
    columns,
    rows,
    rowCount: rows.length,
    ...(truncated ? { truncated: true, totalAvailable: allRowObjects.length } : {}),
  };
}

/**
 * Build a LIKE predicate body for a case-insensitive SUBSTRING match on a user
 * `filter` value, safe against both string-literal breakout AND LIKE-wildcard
 * leakage.
 *
 * - Single quotes are doubled (`''`) so the value cannot break out of the SQL
 *   string literal (standard IRIS escape).
 * - `%`, `_`, and the escape char `\` are themselves escaped with a leading `\`
 *   and an explicit `ESCAPE '\'` clause, so a filter like `50%` or `a_b` is
 *   matched as a LITERAL substring (the advertised semantics) rather than as a
 *   wildcard. Without this, `%`/`_` in a filter would silently broaden the match.
 *
 * Returns e.g. ` LIKE '%' || UPPER('A\_B') || '%' ESCAPE '\'` (already wrapped
 * for a `UPPER(<col>) LIKE …` predicate).
 */
function likeSubstringPredicate(filter: string): string {
  // Escape the LIKE escape char first, then the wildcards, then the quote.
  const escaped = filter
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_")
    .replace(/'/g, "''");
  return " LIKE '%' || UPPER('" + escaped + "') || '%' ESCAPE '\\'";
}

/**
 * Parse the maps/indexes named in an IRIS `EXPLAIN` plan text.
 *
 * Plan text contains lines like `Read master map Ens_Config.Item.IDKEY, looping
 * on ID.` or `Read index map Sample.Person.NameIDX, …`. We capture the map/index
 * reference token following `master map`, `index map`, `bitmap`, or a bare
 * `map`. Returns a de-duplicated list preserving first-seen order.
 */
function parsePlanIndexes(planText: string): string[] {
  const indexes: string[] = [];
  const seen = new Set<string>();
  // Match "master map X", "index map X", "bitmap index map X", "map X" — the
  // reference token (X) is a dotted package.class.indexname run of word/%/dot.
  const re = /\b(?:master map|index map|bitmap(?: index map)?|temp-file|map)\s+([A-Za-z%][\w.%]*)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(planText)) !== null) {
    const name = m[1];
    if (name && !seen.has(name)) {
      seen.add(name);
      indexes.push(name);
    }
  }
  return indexes;
}

// ── advise (Epic 28, Story 28.3) ─────────────────────────────────────

/** Custom-REST base path (mirrors `loc.ts`'s convention). */
const BASE_URL = "/api/executemcp/v2";

/** The Story 28.1 data endpoint `advise` calls for both `query` and (per
 *  statement) `workload` mode. */
const ADVISE_DATA_PATH = `${BASE_URL}/dev/sql/advise-data`;

/** Workload mode defaults (spec §3): caps analysis breadth, which IS real
 *  scan work (Rule #38) — each statement analyzed is a full round-trip to
 *  the advise-data endpoint (EXPLAIN + dictionary reads), not merely an
 *  output-size limit. */
const DEFAULT_ADVISE_TOPN = 5;
const MAX_ADVISE_TOPN = 20;

/**
 * Ensure a value is a record suitable for MCP `structuredContent` (never a
 * bare array). Local copy — mirrors `iris-data-mcp/docdb.ts`'s `toStructured`;
 * there is no shared exported version (each server keeps its own copy per
 * [[feedback_mcp_structured_content]]). The `advise` result is already an
 * object literal in practice, but every other action's structuredContent is
 * routed through the same discipline, so this is defensive consistency, not
 * dead code.
 */
function toStructured(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) {
    return { items: value, count: value.length };
  }
  if (value !== null && typeof value === "object") {
    return value as Record<string, unknown>;
  }
  return { value };
}

const CONFIDENCE_RANK: Record<AdvisorFinding["confidence"], number> = {
  high: 0,
  medium: 1,
  low: 2,
};

/** Rank findings evidence-first: high confidence before medium before low
 *  (stable sort — ties keep their original/insertion order). */
function rankByConfidence(findings: AdvisorFinding[]): AdvisorFinding[] {
  return [...findings].sort((a, b) => CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence]);
}

/**
 * Render the `advise` action's text content: evidence-first, ranked by
 * confidence. When there are zero findings, say so explicitly along with
 * what WAS checked (spec §3 "no silent empty") rather than an empty string.
 * Always closes with the advisory disclaimer (spec §6 / Rule #30).
 */
function renderAdviseText(
  mode: "query" | "workload",
  findings: AdvisorFinding[],
  analyzed: { statements: number; skipped: number },
  notes: string[],
  checkedSummary: string,
): string {
  const disclaimer = "Recommendations are heuristic; verify with 'explain' before applying any change.";
  const noteSuffix = notes.length > 0 ? ` Notes: ${notes.join("; ")}.` : "";

  if (findings.length === 0) {
    return (
      `No performance findings (mode: ${mode}). Checked ${checkedSummary} ` +
      `(analyzed: ${analyzed.statements}, skipped: ${analyzed.skipped}).${noteSuffix}\n\n${disclaimer}`
    );
  }

  const ranked = rankByConfidence(findings);
  const lines = ranked.map((f, i) => {
    const ddl = f.suggestedDdl ? `\n   Suggested DDL: ${f.suggestedDdl}` : "";
    const stmt = f.statement ? ` — ${f.statement}` : "";
    return (
      `${i + 1}. [${f.confidence}] ${f.type}${stmt}\n` +
      `   Evidence: ${f.evidence}\n` +
      `   Recommendation: ${f.recommendation}${ddl}`
    );
  });

  return (
    `${findings.length} finding(s) (mode: ${mode}, checked ${checkedSummary}, ` +
    `analyzed: ${analyzed.statements}, skipped: ${analyzed.skipped}), ranked by confidence:\n\n` +
    `${lines.join("\n\n")}${noteSuffix}\n\n${disclaimer}`
  );
}

/**
 * Call the Story 28.1 `/dev/sql/advise-data` endpoint for one SQL statement
 * and run its raw materials through the Story 28.2 heuristic engine. Throws
 * {@link IrisApiError} on a malformed/non-preparable statement (the SAME
 * error path the four existing actions use) — the caller catches it.
 */
async function adviseStatement(
  ctx: ToolContext,
  ns: string,
  statement: string,
): Promise<AdvisorAnalysisResult> {
  const response = await ctx.http.post<AdviseData>(ADVISE_DATA_PATH, {
    query: statement,
    namespace: ns,
  });
  const raw = (response.result ?? {}) as AdviseData;
  return analyzeAdviceData(raw, { query: statement });
}

/**
 * Handle the `advise` action (AC 28.3.1). Validates `query` XOR `workload`
 * before any I/O, then either advises one statement (`query` mode) or the
 * top-N recent statements from `INFORMATION_SCHEMA.STATEMENTS` (`workload`
 * mode, spec §3/§4 — the Story 28.0-pinned source), aggregating findings.
 */
async function handleAdvise(
  args: {
    query?: string | undefined;
    workload?: boolean | undefined;
    topN?: number | undefined;
    namespace?: string | undefined;
  },
  ctx: ToolContext,
): Promise<ToolResult> {
  const { query, workload, topN, namespace } = args;
  const hasQuery = typeof query === "string" && query.trim() !== "";

  if (hasQuery && workload) {
    return {
      content: [
        {
          type: "text" as const,
          text: "'advise' accepts either 'query' or 'workload: true', not both.",
        },
      ],
      isError: true,
    };
  }
  if (!hasQuery && !workload) {
    return {
      content: [
        {
          type: "text" as const,
          text: "'advise' requires either a 'query' parameter or 'workload: true'.",
        },
      ],
      isError: true,
    };
  }

  const ns = ctx.resolveNamespace(namespace);

  if (workload) {
    // Defensive clamp in addition to the schema's own min(1)/max(20) bounds
    // (Rule #38 — this value is embedded directly in SQL text below, so it
    // must never escape the documented bounds regardless of caller path).
    // Floor + finiteness guard so a non-integer/NaN reaching the handler
    // OUTSIDE the zod path can never produce `SELECT TOP 2.5` / `SELECT TOP
    // NaN` — the belt-and-suspenders claim only holds if the value is a bounded
    // integer, not merely range-clamped.
    const requestedTopN = Math.floor(Number(topN ?? DEFAULT_ADVISE_TOPN));
    const topNValue = Number.isFinite(requestedTopN)
      ? Math.min(Math.max(requestedTopN, 1), MAX_ADVISE_TOPN)
      : DEFAULT_ADVISE_TOPN;
    const workloadSql =
      `SELECT TOP ${topNValue} Hash, Statement, StatCount, StatTotal, StatAverage, ` +
      "StatStdDev, StatRowCount, Timestamp FROM INFORMATION_SCHEMA.STATEMENTS ORDER BY Timestamp DESC";

    let rows: Record<string, unknown>[];
    try {
      const response = await ctx.http.post(atelierPath(ctx.atelierVersion, ns, "action/query"), {
        query: workloadSql,
      });
      rows = rowObjects(response);
    } catch (error: unknown) {
      if (error instanceof IrisApiError) {
        return {
          content: [
            {
              type: "text" as const,
              text:
                "Workload mode is unavailable on this IRIS edition/version — the recent-statement " +
                `workload source query failed: ${error.message}. Try 'query' mode with a specific ` +
                "SQL statement instead.",
            },
          ],
          isError: true,
        };
      }
      throw error;
    }

    const allFindings: AdvisorFinding[] = [];
    const noteSet = new Set<string>();
    let analyzedCount = 0;
    let skippedCount = 0;
    // CR 28.3-2: track a per-statement advise-data FAILURE distinct from a
    // blank-Statement client-side skip. Both currently roll into the same
    // `skippedCount`/`analyzed.skipped` field (unchanged, back-compat), but
    // `errorCount` additionally lets the all-failed case below be told apart
    // from the all-blank case (neither of which is a "no problems found").
    let errorCount = 0;
    for (const row of rows) {
      const stmt = String((row as Record<string, unknown>).Statement ?? "").trim();
      if (stmt === "") {
        skippedCount++;
        continue;
      }
      try {
        const { findings, notes } = await adviseStatement(ctx, ns, stmt);
        for (const f of findings) allFindings.push(f);
        for (const n of notes) noteSet.add(n);
        analyzedCount++;
      } catch (error: unknown) {
        // A per-statement advise-data call that fails with an IrisApiError
        // (e.g. a non-SELECT or a form the platform can no longer prepare
        // verbatim) is skipped, not fatal — the workload as a whole still
        // aggregates. An UNEXPECTED (non-IrisApiError) failure is rethrown so
        // the framework surfaces it, mirroring `query` mode and the four
        // pre-existing actions — a blanket catch would silently mask a
        // transient connectivity/framework error as a benign "skip".
        if (error instanceof IrisApiError) {
          skippedCount++;
          errorCount++;
          continue;
        }
        throw error;
      }
    }

    const analyzed = { statements: analyzedCount, skipped: skippedCount };
    const notes = Array.from(noteSet);

    // CR 28.3-2: a TOTAL per-statement outage (every non-blank statement's
    // advise-data call failed with an IrisApiError, e.g. a mis-deployed
    // route) previously rendered a benign "No performance findings" — never
    // wrong, but misleading given `analyzed:0` was silently masking N real
    // failures. Only fires when there was at least one non-blank statement
    // AND every single one of them errored (never fires for an all-blank
    // workload, which stays the existing "no findings" success shape).
    if (rows.length > 0 && analyzedCount === 0 && errorCount > 0) {
      return {
        content: [
          {
            type: "text" as const,
            text:
              `The advisor could not analyze any of the ${errorCount} recent statement(s) — ` +
              `every 'advise-data' call failed. Checked ${rows.length} recent statement(s) ` +
              `(top ${topNValue}). Try 'query' mode with a specific SQL statement to see the ` +
              "underlying error.",
          },
        ],
        isError: true,
      };
    }

    const result = {
      mode: "workload" as const,
      findings: allFindings,
      analyzed,
      notes,
    };
    const text = renderAdviseText(
      "workload",
      allFindings,
      analyzed,
      notes,
      `${rows.length} recent statement(s) (top ${topNValue})`,
    );
    return { content: [{ type: "text" as const, text }], structuredContent: toStructured(result) };
  }

  // query mode
  try {
    const { findings, notes } = await adviseStatement(ctx, ns, query as string);
    const analyzed = { statements: 1, skipped: 0 };
    const result = { mode: "query" as const, findings, analyzed, notes };
    const text = renderAdviseText("query", findings, analyzed, notes, "1 statement");
    return { content: [{ type: "text" as const, text }], structuredContent: toStructured(result) };
  } catch (error: unknown) {
    if (error instanceof IrisApiError) {
      return {
        content: [{ type: "text" as const, text: `SQL error: ${error.message}` }],
        isError: true,
      };
    }
    throw error;
  }
}

// ── iris_sql_analyze ──────────────────────────────────────────────

export const sqlAnalyzeTool: ToolDefinition = {
  name: "iris_sql_analyze",
  title: "Analyze SQL",
  description:
    "Diagnose SQL performance against an IRIS namespace (read-only). Actions:\n\n" +
    "- **explain** (read): show the query plan via `EXPLAIN <query>` (returns the " +
    "plan text). Requires 'query'.\n" +
    "- **stats** (read): per-statement cumulative runtime statistics from " +
    "INFORMATION_SCHEMA.STATEMENTS. Optional 'filter' (substring on the Statement " +
    "text) and 'maxRows'.\n" +
    "- **indexUsage** (read): the maps/indexes a query reads, derived from its " +
    "`EXPLAIN` plan. Requires 'query'.\n" +
    "- **running** (read): currently-executing statements from " +
    "INFORMATION_SCHEMA.CURRENT_STATEMENTS. Optional 'filter' (substring on " +
    "UserName) and 'maxRows'.\n" +
    "- **advise** (read, SQL Performance Advisor): evidence-cited findings " +
    "(full-scan, missing-index, stale-stats, unused-index, plan-anomaly) for a " +
    "'query' or the recent statement 'workload' (mutually exclusive). 'topN' " +
    "(default 5, max 20) caps workload breadth — each statement analyzed is a " +
    "full round-trip, i.e. real scan work, not just an output-size cap. " +
    "Recommendations are heuristic; verify with 'explain' before applying any " +
    "change — this action never applies anything itself.\n\n" +
    "All five actions are READ-ONLY and enabled by default.",
  inputSchema: z.object({
    action: z
      .enum(["explain", "stats", "indexUsage", "running", "advise"])
      .describe("Analysis action to perform"),
    query: z
      .string()
      .optional()
      .describe(
        "SQL query to analyze (REQUIRED for 'explain' and 'indexUsage'; for " +
          "'advise', mutually exclusive with 'workload')",
      ),
    filter: z
      .string()
      .optional()
      .describe(
        "Optional case-insensitive substring filter for 'stats' (matches the " +
          "Statement text) and 'running' (matches UserName)",
      ),
    maxRows: z
      .coerce.number()
      .int()
      .min(1)
      .optional()
      .describe("Maximum number of rows to return for tabular actions (default: 1000)"),
    workload: z
      .boolean()
      .optional()
      .describe(
        "'advise' only: advise on the top-N recent statements instead of one " +
          "'query' (mutually exclusive with 'query')",
      ),
    topN: z
      .coerce.number()
      .int()
      .min(1)
      .max(20)
      .optional()
      .describe(
        "'advise' + 'workload' only: number of recent statements to analyze " +
          "(default: 5, max: 20). This caps analysis breadth, which IS scan work " +
          "— each statement is a full endpoint round-trip.",
      ),
    namespace: z
      .string()
      .optional()
      .describe("Target namespace (default: configured)"),
  }),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  scope: "NS",
  // Governance classification (Story 15.0 strict contract): all five action keys
  // are NEW (absent from the frozen Epic-14 baseline), so EVERY action must be
  // classified or registration throws — INCLUDING reads. All five are reads →
  // default-ENABLED via defaultSeed (mutates !== "write").
  mutates: {
    explain: "read",
    stats: "read",
    indexUsage: "read",
    running: "read",
    advise: "read",
  },
  handler: async (args, ctx) => {
    const { action, query, filter, maxRows, namespace, workload, topN } = args as {
      action: "explain" | "stats" | "indexUsage" | "running" | "advise";
      query?: string;
      filter?: string;
      maxRows?: number;
      namespace?: string;
      workload?: boolean;
      topN?: number;
    };

    // `advise` (Epic 28, Story 28.3) is a fully separate flow (a different
    // endpoint + the heuristic engine) — dispatch it before any of the
    // four pre-existing actions' code paths, which stay byte-for-byte
    // untouched below (Rule #19).
    if (action === "advise") {
      return handleAdvise({ query, workload, topN, namespace }, ctx);
    }

    // Validate `query` presence for the plan-based actions before any I/O.
    // Reject undefined/empty AND whitespace-only — a blank `EXPLAIN    ` would
    // otherwise fall through to a server-side SQL error instead of this clean
    // client-side message.
    if ((action === "explain" || action === "indexUsage") && (query === undefined || query.trim() === "")) {
      return {
        content: [
          {
            type: "text" as const,
            text: `'${action}' requires a 'query' parameter.`,
          },
        ],
        isError: true,
      };
    }

    const ns = ctx.resolveNamespace(namespace);
    const path = atelierPath(ctx.atelierVersion, ns, "action/query");
    const limit = maxRows ?? DEFAULT_MAX_ROWS;

    // Build the per-action SQL.
    let sql: string;
    if (action === "explain" || action === "indexUsage") {
      sql = "EXPLAIN " + query;
    } else if (action === "running") {
      sql = "SELECT * FROM INFORMATION_SCHEMA.CURRENT_STATEMENTS";
      if (filter !== undefined && filter !== "") {
        sql += " WHERE UPPER(UserName)" + likeSubstringPredicate(filter);
      }
    } else {
      // stats
      sql =
        "SELECT Hash, Statement, StatCount, StatTotal, StatAverage, StatStdDev, " +
        "StatRowCount, Timestamp FROM INFORMATION_SCHEMA.STATEMENTS";
      if (filter !== undefined && filter !== "") {
        sql += " WHERE UPPER(Statement)" + likeSubstringPredicate(filter);
      }
    }

    try {
      const response = await ctx.http.post(path, { query: sql });
      const allRowObjects = rowObjects(response);

      if (action === "explain") {
        // EXPLAIN returns a single `Plan` column / one row.
        const planText =
          allRowObjects.length > 0
            ? String((allRowObjects[0] as Record<string, unknown>).Plan ?? "")
            : "";
        const result = { action, plan: planText };
        return {
          content: [{ type: "text" as const, text: planText || "(no plan returned)" }],
          structuredContent: result,
        };
      }

      if (action === "indexUsage") {
        const planText =
          allRowObjects.length > 0
            ? String((allRowObjects[0] as Record<string, unknown>).Plan ?? "")
            : "";
        const indexes = parsePlanIndexes(planText);
        const result = { action, indexes, plan: planText };
        const summary =
          indexes.length > 0
            ? `Indexes/maps read:\n${indexes.map((i) => `  - ${i}`).join("\n")}`
            : "No maps/indexes identified in the plan.";
        return {
          content: [{ type: "text" as const, text: summary }],
          structuredContent: result,
        };
      }

      // running / stats — tabular.
      const tabular = toTabular(allRowObjects, limit);
      const result = { action, ...tabular };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    } catch (error: unknown) {
      if (error instanceof IrisApiError) {
        return {
          content: [
            {
              type: "text" as const,
              text: `SQL error: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};
