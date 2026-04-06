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

// ── iris.sql.execute ──────────────────────────────────────────────

export const sqlExecuteTool: ToolDefinition = {
  name: "iris.sql.execute",
  title: "Execute SQL",
  description:
    "Execute a SQL query against an IRIS namespace and return column names and row data. " +
    "Supports parameterized queries to prevent SQL injection. " +
    "Use maxRows to limit result set size (default: 1000).",
  inputSchema: z.object({
    query: z
      .string()
      .describe("SQL query to execute"),
    parameters: z
      .array(z.unknown())
      .optional()
      .describe("Parameterized query values to prevent SQL injection"),
    maxRows: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("Maximum number of rows to return (default: 1000)"),
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

      // The Atelier query response has result.content with columns and rows
      const content = (response.result as { content?: unknown[] })?.content;
      const queryResult = Array.isArray(content) ? content[0] : undefined;

      const columns: string[] =
        (queryResult as { columns?: string[] })?.columns ?? [];
      const allRows: unknown[][] =
        (queryResult as { rows?: unknown[][] })?.rows ?? [];

      // Apply maxRows limit
      const limit = maxRows ?? DEFAULT_MAX_ROWS;
      const rows = allRows.slice(0, limit);
      const truncated = allRows.length > limit;

      const result = {
        columns,
        rows,
        rowCount: rows.length,
        ...(truncated ? { truncated: true, totalAvailable: allRows.length } : {}),
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
