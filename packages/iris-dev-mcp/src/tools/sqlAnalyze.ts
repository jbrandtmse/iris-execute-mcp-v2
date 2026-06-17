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
 *
 * **TypeScript/SQL-only.** There is NO `ExecuteMCPv2.*` ObjectScript handler and
 * NO bootstrap contribution (settled in `17-0-api-probes.md` Area 3) — every
 * action is built from SQL and posted through `atelierPath(…, "action/query")`.
 *
 * **INFORMATION_SCHEMA table names are UNDERSCORED** (`CURRENT_STATEMENTS`,
 * `STATEMENTS`, …) per `17-0-api-probes.md` DISCREPANCY #2; the no-underscore
 * names return `SQLCODE -30`.
 *
 * **Governance (frozen-foundation model).** The four action keys are NEW
 * post-foundation keys (absent from the frozen `governance-baseline.ts`), so each
 * MUST be classified in `mutates` or registration throws
 * (`assertGovernanceClassification`). All four are reads → declared
 * `mutates: "read"` → default-ENABLED via `defaultSeed`. The `server` field is
 * framework-injected (architecture decision D2), so it is not declared on the
 * schema.
 *
 * SQL errors (invalid syntax, missing tables, etc.) are returned as MCP tool
 * errors with `isError: true` (mirrors `iris_sql_execute`).
 */

import { atelierPath, IrisApiError, type ToolDefinition } from "@iris-mcp/shared";
import { z } from "zod";

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
    "UserName) and 'maxRows'.\n\n" +
    "All four actions are READ-ONLY and enabled by default.",
  inputSchema: z.object({
    action: z
      .enum(["explain", "stats", "indexUsage", "running"])
      .describe("Analysis action to perform"),
    query: z
      .string()
      .optional()
      .describe("SQL query to analyze (REQUIRED for 'explain' and 'indexUsage')"),
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
  // Governance classification (Story 15.0 strict contract): the four action keys
  // are NEW (absent from the frozen Epic-14 baseline), so EVERY action must be
  // classified or registration throws — INCLUDING reads. All four are reads →
  // default-ENABLED via defaultSeed (mutates !== "write").
  mutates: {
    explain: "read",
    stats: "read",
    indexUsage: "read",
    running: "read",
  },
  handler: async (args, ctx) => {
    const { action, query, filter, maxRows, namespace } = args as {
      action: "explain" | "stats" | "indexUsage" | "running";
      query?: string;
      filter?: string;
      maxRows?: number;
      namespace?: string;
    };

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
