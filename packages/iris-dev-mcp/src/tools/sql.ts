/**
 * SQL tools for the IRIS Development MCP server.
 *
 * {@link sqlExecuteTool} runs any SQL statement against an IRIS namespace;
 * {@link sqlQueryTool} runs queries only. Both post to the ExecuteMCPv2
 * `/dev/sql/execute` endpoint through {@link runSql}, which prepares the
 * statement once on the IRIS side, classifies it by its statement type, applies
 * the read-only and rows-affected controls inside IRIS, and executes it in the
 * same request.
 *
 * Controls (each can only tighten the operator's setting, never loosen it):
 * - read-only: the `readOnly` parameter, `IRIS_SQL_READ_ONLY`, or the
 *   {@link sqlQueryTool} tool itself;
 * - rows-affected cap: the `maxRowsAffected` parameter and
 *   `IRIS_SQL_MAX_ROWS_AFFECTED`, the smaller of the two applying;
 * - `IRIS_SQL_MAX_ROWS` and `IRIS_SQL_TIMEOUT`, as before.
 *
 * SQL errors (invalid syntax, missing tables, etc.) are returned as MCP tool
 * errors with `isError: true`; a refused statement is a refusal result with a
 * catalog code.
 */

import {
  IrisApiError,
  REFUSAL_CODES,
  refusalResult,
  type RequestOptions,
  type ToolContext,
  type ToolDefinition,
  type ToolResult,
} from "@iris-mcp/shared";
import { z } from "zod";

/** Default maximum number of rows returned when maxRows is not specified. */
const DEFAULT_MAX_ROWS = 1000;

/** The ExecuteMCPv2 SQL endpoint both tools post to. */
const SQL_EXECUTE_PATH = "/api/executemcp/v2/dev/sql/execute";

/** The effects of a statement that a rolled-back transaction does not undo. */
const RESIDUAL_EFFECTS =
  "The transaction undoes SQL changes and journaled global sets made by functions and triggers, but not " +
  "$INCREMENT/$SEQUENCE counters (row ID counters included), process-private or IRISTEMP globals, changes made with " +
  "%NOJOURN by a function, procedure or trigger the statement runs, work that parallel query worker processes do (%PARALLEL), " +
  "JOB or device output, other external effects, " +
  "or a function, procedure or trigger that starts, commits or rolls back a transaction (reported as an error when the " +
  "transaction level the tool opened has changed, which a commit followed by a new TSTART does not show; some changes " +
  "may be saved).";

/** The IRIS_SQL_MAX_ROWS / IRIS_SQL_TIMEOUT sentence shared by both descriptions. */
const MAX_ROWS_AND_TIMEOUT =
  "An operator may set IRIS_SQL_MAX_ROWS (a ceiling on the number of rows returned \u2014 the response " +
  "carries rowsCapped: true when it clamps the caller's request; it bounds the returned row count " +
  "post-fetch, not the server-side result set or transfer) and/or IRIS_SQL_TIMEOUT " +
  "(per-request timeout in seconds) as environment variables; both are opt-in and unset by default.";

/** The rows `runSql` maps, in the object `action/query` serialized them as. */
type RowObject = Record<string, unknown>;

/** The arguments both tools accept (`iris_sql_query` never passes `readOnly` or `maxRowsAffected`). */
interface SqlArgs {
  query: string;
  parameters?: unknown[];
  maxRows?: number;
  namespace?: string;
  readOnly?: boolean;
  maxRowsAffected?: number;
  countOnly?: boolean;
}

/** `result` of the `/dev/sql/execute` response, for each of its outcomes. */
interface SqlEndpointResult {
  outcome: "ok" | "readOnly" | "countOnly" | "capNotCountable" | "noJournal" | "overCap" | "transactionEnded";
  statementType: number;
  statementTypeName: string;
  content?: RowObject[];
  rowsAffected?: number;
  totalCount?: number;
}

/** Where a control's effective value came from. */
type ReadOnlySource = "tool" | "operator" | "parameter";
type CapSource = "operator" | "parameter";

/** The statement types whose affected rows IRIS counts: INSERT, UPDATE and DELETE. */
function isDml(statementType: number): boolean {
  return statementType >= 2 && statementType <= 4;
}

function failure(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

/**
 * Run a SQL statement for `iris_sql_execute` or `iris_sql_query`.
 *
 * Resolves the effective read-only mode and rows-affected cap, posts the one request, maps an
 * executed result through the row mapping both tools have always used, adds the new fields, and
 * maps every declined outcome to its refusal or error text.
 */
async function runSql(args: SqlArgs, ctx: ToolContext, tool: "iris_sql_execute" | "iris_sql_query"): Promise<ToolResult> {
  const { query, parameters, maxRows, namespace } = args;
  const ns = ctx.resolveNamespace(namespace);

  // Read-only: the query tool is always read-only; for the execute tool a parameter can add it
  // but never remove the operator's.
  const operatorReadOnly = tool === "iris_sql_execute" && ctx.config.sqlReadOnly === true;
  const readOnly = tool === "iris_sql_query" || args.readOnly === true || operatorReadOnly;
  const readOnlySource: ReadOnlySource = tool === "iris_sql_query" ? "tool" : operatorReadOnly ? "operator" : "parameter";
  const readOnlyForced = operatorReadOnly && args.readOnly !== true;

  // Rows-affected cap: the smaller of the caller's value and the operator's ceiling.
  const ceiling = tool === "iris_sql_execute" ? ctx.config.sqlMaxRowsAffected : undefined;
  const requestedCap = tool === "iris_sql_execute" ? args.maxRowsAffected : undefined;
  const cap =
    ceiling !== undefined && requestedCap !== undefined
      ? Math.min(ceiling, requestedCap)
      : (ceiling ?? requestedCap ?? null);
  const capSource: CapSource = ceiling !== undefined && (requestedCap === undefined || requestedCap > ceiling) ? "operator" : "parameter";
  const capName = capSource === "operator" ? "IRIS_SQL_MAX_ROWS_AFFECTED" : "maxRowsAffected";
  const countOnly = args.countOnly === true;

  const body: Record<string, unknown> = { query };
  if (parameters && parameters.length > 0) {
    body.parameters = parameters;
  }
  body.namespace = ns;
  body.readOnly = readOnly;
  body.countOnly = countOnly;
  body.maxRowsAffected = cap;

  // IRIS_SQL_TIMEOUT (operator-set, forwarded per-request in ms). Unset ->
  // no options object is passed to http.post at all.
  const options: RequestOptions | undefined =
    ctx.config.sqlTimeoutMs !== undefined ? { timeout: ctx.config.sqlTimeoutMs } : undefined;

  try {
    const response = options
      ? await ctx.http.post(SQL_EXECUTE_PATH, body, options)
      : await ctx.http.post(SQL_EXECUTE_PATH, body);
    const result = response.result as SqlEndpointResult;
    const typeName = result.statementTypeName;

    switch (result.outcome) {
      case "readOnly": {
        const remedy =
          readOnlySource === "parameter"
            ? "Run it without readOnly to execute it."
            : readOnlySource === "operator"
              ? "The operator's IRIS_SQL_READ_ONLY setting makes every call read-only; run a SELECT instead."
              : "iris_sql_query runs only queries; run other statements with iris_sql_execute.";
        return refusalResult(
          REFUSAL_CODES.SQL_READ_ONLY,
          `Statement was not run in namespace '${ns}': it is a ${typeName} statement, and read-only mode runs only queries (SELECT). ` +
            `Nothing was changed. ${remedy}`,
          { namespace: ns, statementType: typeName, readOnlySource },
        );
      }
      case "countOnly":
        return failure(
          `countOnly counts the rows a query returns, and this is a ${typeName} statement, so nothing was run. ` +
            "Remove countOnly, or pass a SELECT.",
        );
      case "capNotCountable": {
        const remedy =
          capSource === "parameter"
            ? "Run it without maxRowsAffected."
            : "The operator's IRIS_SQL_MAX_ROWS_AFFECTED ceiling applies to every call, so this statement cannot run through iris_sql_execute here.";
        return refusalResult(
          REFUSAL_CODES.SQL_ROWS_AFFECTED_CAP,
          `Statement was not run in namespace '${ns}': it is a ${typeName} statement, and under a rows-affected cap ` +
            `(${cap}, from ${capName}) only SELECT, INSERT, UPDATE and DELETE run, because those are the statements ` +
            `whose affected rows IRIS counts. Nothing was changed. ${remedy}`,
          { namespace: ns, statementType: typeName, maxRowsAffected: cap, capSource },
        );
      }
      case "noJournal": {
        const remedy =
          ceiling === undefined
            ? "Remove %NOJOURN from the statement text, a comment or a string included, or run it without maxRowsAffected."
            : "Remove %NOJOURN from the statement text, a comment or a string included; the operator's IRIS_SQL_MAX_ROWS_AFFECTED ceiling applies to every call.";
        return refusalResult(
          REFUSAL_CODES.SQL_ROWS_AFFECTED_CAP,
          `Statement was not run in namespace '${ns}': it is a ${typeName} statement whose text contains %NOJOURN, which turns ` +
            `journaling off, so a rows-affected cap (${cap}, from ${capName}) cannot undo it. Nothing was changed. ${remedy}`,
          { namespace: ns, statementType: typeName, maxRowsAffected: cap, capSource },
        );
      }
      case "overCap": {
        const affected = result.rowsAffected as number;
        const count =
          affected < 0
            ? "an unknown number of rows (IRIS reports -1, as it does for TRUNCATE TABLE)"
            : `${affected} rows`;
        const remedy =
          capSource === "parameter"
            ? `Narrow the statement to at most ${cap} rows, or raise maxRowsAffected.`
            : `Narrow the statement to at most ${cap} rows; a call cannot raise the operator's IRIS_SQL_MAX_ROWS_AFFECTED ceiling.`;
        return refusalResult(
          REFUSAL_CODES.SQL_ROWS_AFFECTED_CAP,
          `Statement was rolled back in namespace '${ns}': the ${typeName} affected ${count}, more than the cap of ${cap} ` +
            `(from ${capName}). Its row changes were undone. ${remedy}`,
          { namespace: ns, statementType: typeName, rowsAffected: affected, maxRowsAffected: cap, capSource },
        );
      }
      case "transactionEnded":
        return failure(
          `Statement changed the transaction this tool opened in namespace '${ns}': a function, procedure or trigger it ran ` +
            "started, committed or rolled back a transaction, so the tool could not check or undo its effects reliably and " +
            "some changes may be saved. Check the data the statement touches before running it again.",
        );
      default:
        break;
    }

    // result.content is an array of row objects, e.g. [{ Col1: "val", Col2: 42 }],
    // as the Atelier query action returned them.
    const allRowObjects = Array.isArray(result.content) ? result.content : [];

    // Derive column names from the first row's keys
    const columns: string[] = allRowObjects.length > 0 ? Object.keys(allRowObjects[0] as RowObject) : [];

    // Apply maxRows limit, clamped by the operator-set IRIS_SQL_MAX_ROWS
    // hard cap when configured (unset -> effectiveLimit === requested).
    const requested = maxRows ?? DEFAULT_MAX_ROWS;
    const rowsCap = ctx.config.sqlMaxRows;
    const effectiveLimit = rowsCap !== undefined ? Math.min(requested, rowsCap) : requested;
    const rowsCapped = rowsCap !== undefined && rowsCap < requested && !countOnly;

    const limited = allRowObjects.slice(0, effectiveLimit);
    const truncated = allRowObjects.length > effectiveLimit;

    // Convert row objects to positional arrays for tabular output
    const rows = limited.map((row) => columns.map((col) => row[col]));

    const output = {
      columns,
      rows,
      rowCount: rows.length,
      ...(truncated ? { truncated: true, totalAvailable: allRowObjects.length } : {}),
      ...(rowsCapped ? { rowsCapped: true } : {}),
      ...(isDml(result.statementType) && result.rowsAffected !== undefined ? { rowsAffected: result.rowsAffected } : {}),
      ...(countOnly && result.totalCount !== undefined ? { totalCount: result.totalCount } : {}),
      ...(readOnlyForced ? { readOnlyForced: true } : {}),
      ...(isDml(result.statementType) && cap !== null && capSource === "operator" ? { maxRowsAffectedCapped: true } : {}),
    };

    return {
      content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
      structuredContent: output,
    };
  } catch (error: unknown) {
    if (error instanceof IrisApiError) {
      return failure(`SQL error: ${error.message}`);
    }
    throw error;
  }
}

// -- iris_sql_execute ------------------------------------------------

export const sqlExecuteTool: ToolDefinition = {
  name: "iris_sql_execute",
  title: "Execute SQL",
  description:
    "Execute a SQL query against an IRIS namespace and return column names and row data. " +
    "Supports parameterized queries to prevent SQL injection. " +
    "Use maxRows to limit result set size (default: 1000). " +
    `${MAX_ROWS_AND_TIMEOUT} ` +
    "Safety controls: readOnly (default: false) runs only queries (SELECT) and refuses every other statement, CALL included, " +
    "with SQL_READ_ONLY; maxRowsAffected (default: no cap) is a ceiling on the rows an INSERT, UPDATE or DELETE may change; " +
    "a statement that changes more is rolled back and refused with SQL_ROWS_AFFECTED_CAP, and under a cap only SELECT, INSERT, " +
    "UPDATE and DELETE run, because those are the statements whose affected rows IRIS counts (the count is the statement's own " +
    "row count: rows that triggers, cascades or functions change are not counted, and a SELECT is not bounded by it), and an INSERT, " +
    "UPDATE or DELETE whose text contains %NOJOURN (a comment or a string counts) is refused with SQL_ROWS_AFFECTED_CAP before it runs " +
    "under a cap, because it turns journaling off and the rollback could not undo it; countOnly (default: false) " +
    "returns only totalCount, the number of rows a SELECT returns, and transfers no rows. " +
    "An operator may set IRIS_SQL_READ_ONLY=true (every call is read-only; unset by default) and IRIS_SQL_MAX_ROWS_AFFECTED " +
    "(a non-negative integer ceiling no call can raise; unset by default); a call can only tighten them, and the result carries " +
    "readOnlyForced or maxRowsAffectedCapped when one of them applied. " +
    "An INSERT, UPDATE or DELETE result carries rowsAffected (IRIS reports -1 for TRUNCATE TABLE). " +
    "Read-only mode is statement-level read-only, not side-effect-free: the statement runs inside a transaction that is always " +
    `rolled back. ${RESIDUAL_EFFECTS} A capped statement that is rolled back leaves the same effects. ` +
    "Under the read-only governance preset this tool is blocked: use iris_sql_query to run queries.",
  inputSchema: z.object({
    query: z
      .string()
      .describe("SQL query to execute (e.g., 'SELECT Name FROM %Dictionary.ClassDefinition WHERE Name %STARTSWITH ?')"),
    parameters: z
      .array(z.unknown())
      .optional()
      .describe("Parameterized query values as a JSON array matching ? placeholders in the query (e.g., [\"MyApp.\"] for a single parameter)"),
    maxRows: z
      .coerce.number()
      .int()
      .min(1)
      .optional()
      .describe("Maximum number of rows to return as an integer (default: 1000)"),
    readOnly: z
      .boolean()
      .optional()
      .describe("Run only queries (SELECT) and refuse any other statement before it runs (default: false; IRIS_SQL_READ_ONLY=true forces it on)"),
    maxRowsAffected: z
      .coerce.number()
      .int()
      .min(0)
      .optional()
      .describe(
        "Roll back and refuse an INSERT, UPDATE or DELETE that changes more than this many rows; 0 is a dry count " +
          "(default: no cap; IRIS_SQL_MAX_ROWS_AFFECTED sets a ceiling this cannot raise). Under a cap only SELECT, INSERT, UPDATE and DELETE run, " +
          "and one whose text contains %NOJOURN is refused.",
      ),
    countOnly: z
      .boolean()
      .optional()
      .describe("Return only totalCount, the number of rows a SELECT returns, and transfer no rows (default: false)"),
    namespace: z
      .string()
      .optional()
      .describe("Target namespace (default: configured)"),
  }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  scope: "NS",
  handler: async (args, ctx) => runSql(args as SqlArgs, ctx, "iris_sql_execute"),
};

// -- iris_sql_query --------------------------------------------------

export const sqlQueryTool: ToolDefinition = {
  name: "iris_sql_query",
  title: "Query SQL",
  description:
    "Run a SQL query (SELECT) against an IRIS namespace and return column names and row data. " +
    "Use it for queries, including under the read-only governance preset, where iris_sql_execute is blocked. " +
    "Supports parameterized queries to prevent SQL injection. Use maxRows to limit result set size (default: 1000). " +
    "Returns {columns, rows, rowCount}; with countOnly it returns totalCount, the number of rows the query returns, and transfers no rows. " +
    "Governance: this tool is enabled by default; it is disabled when an operator explicitly disables iris_sql_execute, " +
    "unless iris_sql_query is set explicitly. " +
    "This tool is statement-level read-only, not side-effect-free: only SELECT runs, every other statement (CALL included) is refused with " +
    "SQL_READ_ONLY before it runs, and the query runs inside a transaction that is always rolled back. " +
    `${RESIDUAL_EFFECTS} ` +
    `${MAX_ROWS_AND_TIMEOUT}`,
  inputSchema: z.object({
    query: z
      .string()
      .describe("SQL query to run (a SELECT, e.g., 'SELECT Name FROM %Dictionary.ClassDefinition WHERE Name %STARTSWITH ?')"),
    parameters: z
      .array(z.unknown())
      .optional()
      .describe("Parameterized query values as a JSON array matching ? placeholders in the query (e.g., [\"MyApp.\"] for a single parameter)"),
    maxRows: z
      .coerce.number()
      .int()
      .min(1)
      .optional()
      .describe("Maximum number of rows to return as an integer (default: 1000)"),
    countOnly: z
      .boolean()
      .optional()
      .describe("Return only totalCount, the number of rows the query returns, and transfer no rows (default: false)"),
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
  mutates: "read",
  parent: "iris_sql_execute",
  handler: async (args, ctx) => runSql(args as SqlArgs, ctx, "iris_sql_query"),
};
