/**
 * SQL execution tool for the IRIS Development MCP server.
 *
 * Provides {@link sqlExecuteTool} to run SQL queries against an IRIS
 * namespace via the Atelier REST API. Supports parameterized queries
 * and configurable row limits to prevent unbounded result sets.
 *
 * SQL errors (invalid syntax, missing tables, etc.) are returned as
 * MCP tool errors with `isError: true`.
 */

import { atelierPath, IrisApiError, type ToolDefinition } from "@iris-mcp/shared";
import { z } from "zod";

/** Default maximum number of rows returned when maxRows is not specified. */
const DEFAULT_MAX_ROWS = 1000;

// ── iris_sql_execute ──────────────────────────────────────────────

export const sqlExecuteTool: ToolDefinition = {
  name: "iris_sql_execute",
  title: "Execute SQL",
  description:
    "Execute a SQL query against an IRIS namespace and return column names and row data. " +
    "Supports parameterized queries to prevent SQL injection. " +
    "Use maxRows to limit result set size (default: 1000).",
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
  handler: async (args, ctx) => {
    const { query, parameters, maxRows, namespace } = args as {
      query: string;
      parameters?: unknown[];
      maxRows?: number;
      namespace?: string;
    };

    const ns = ctx.resolveNamespace(namespace);
    const path = atelierPath(ctx.atelierVersion, ns, "action/query");

    const body: Record<string, unknown> = { query };
    if (parameters && parameters.length > 0) {
      body.parameters = parameters;
    }

    try {
      const response = await ctx.http.post(path, body);

      // The Atelier query response returns result.content as an array of
      // row objects, e.g. [{ Col1: "val", Col2: 42 }, …].
      const content = (response.result as { content?: Record<string, unknown>[] })?.content;
      const allRowObjects = Array.isArray(content) ? content : [];

      // Derive column names from the first row's keys
      const columns: string[] =
        allRowObjects.length > 0 ? Object.keys(allRowObjects[0] as Record<string, unknown>) : [];

      // Apply maxRows limit
      const limit = maxRows ?? DEFAULT_MAX_ROWS;
      const limited = allRowObjects.slice(0, limit);
      const truncated = allRowObjects.length > limit;

      // Convert row objects to positional arrays for tabular output
      const rows = limited.map((row) => columns.map((col) => row[col]));

      const result = {
        columns,
        rows,
        rowCount: rows.length,
        ...(truncated ? { truncated: true, totalAvailable: allRowObjects.length } : {}),
      };

      return {
        content: [
          { type: "text", text: JSON.stringify(result, null, 2) },
        ],
        structuredContent: result,
      };
    } catch (error: unknown) {
      if (error instanceof IrisApiError) {
        return {
          content: [
            {
              type: "text",
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
