/**
 * Business rule tools for the IRIS Interoperability MCP server.
 *
 * Provides two read-only tools for inspecting Ensemble business rules:
 * - {@link ruleListTool} — List all business rule classes in the namespace
 * - {@link ruleGetTool} — Get the full rule definition including conditions and actions
 *
 * All tools call the custom REST service at `/api/executemcp/v2/interop/rule`.
 */

import { IrisApiError, type ToolDefinition } from "@iris-mcp/shared";
import { z } from "zod";

/** Base URL for the custom ExecuteMCPv2 REST service. */
const BASE_URL = "/api/executemcp/v2";

// ── iris_rule_list ─────────────────────────────────────────────

/** Default page size for rule list pagination (FEAT-3). */
const DEFAULT_PAGE_SIZE = 100;
/** Maximum page size for rule list pagination (FEAT-3). */
const MAX_PAGE_SIZE = 1000;

export const ruleListTool: ToolDefinition = {
  name: "iris_rule_list",
  title: "List Business Rules",
  description:
    "List all business rule classes in the namespace. Returns non-abstract classes " +
    "that extend Ens.Rule.Definition, showing their fully-qualified class names. " +
    "Use 'prefix' to narrow by dotted-package prefix (e.g. 'MyPackage.Rules'). " +
    "Use 'filter' for a case-insensitive substring match. " +
    "Use 'cursor'/'nextCursor' for pagination (default page size: 100, max: 1000). " +
    "Note: filtering is client-side — the full list is fetched from the server each page request.",
  inputSchema: z.object({
    prefix: z
      .string()
      .optional()
      .describe(
        "Dotted-prefix filter (client-side). Only rules whose name starts with this prefix are returned. " +
          "Example: 'MyPackage.Rules' matches 'MyPackage.Rules.RoutingRule' but not 'OtherPackage.Rules.X'.",
      ),
    filter: z
      .string()
      .optional()
      .describe(
        "Case-insensitive substring filter (client-side). Applied after prefix. " +
          "Example: 'routing' matches any rule whose name contains 'routing', 'Routing', or 'ROUTING'.",
      ),
    cursor: z
      .string()
      .optional()
      .describe("Pagination cursor from a previous response's nextCursor field"),
    pageSize: z
      .number()
      .int()
      .min(1)
      .max(MAX_PAGE_SIZE)
      .optional()
      .describe(`Page size (default: ${DEFAULT_PAGE_SIZE}, max: ${MAX_PAGE_SIZE})`),
    namespace: z
      .string()
      .optional()
      .describe("Target namespace. Defaults to the server's configured namespace; pass an explicit value to query a different namespace per call without changing the connection default."),
  }),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  scope: "NS",
  handler: async (args, ctx) => {
    const { namespace, prefix, filter, cursor, pageSize } = args as {
      namespace?: string;
      prefix?: string;
      filter?: string;
      cursor?: string;
      pageSize?: number;
    };

    const ns = ctx.resolveNamespace(namespace);
    const params = new URLSearchParams();
    params.set("namespace", ns);

    const path = `${BASE_URL}/interop/rule?${params}`;

    try {
      const response = await ctx.http.get(path);
      // Server returns {rules: [{name: "..."}], count: N} or similar
      const raw = response.result as { rules?: Array<{ name: string }> } | Array<{ name: string }>;
      const allItems: Array<{ name: string }> = Array.isArray(raw)
        ? (raw as Array<{ name: string }>)
        : ((raw as { rules?: Array<{ name: string }> }).rules ?? []);

      // FEAT-3: client-side prefix + filter
      const filtered = allItems.filter((item) => {
        if (prefix && !item.name.startsWith(prefix)) return false;
        if (filter && !item.name.toLowerCase().includes(filter.toLowerCase())) return false;
        return true;
      });

      const effectivePageSize = Math.min(pageSize ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
      const { page, nextCursor } = ctx.paginate(filtered, cursor, effectivePageSize);

      const result = {
        rules: page,
        count: page.length,
        total: filtered.length,
        ...(prefix ? { prefix } : {}),
        ...(filter ? { filter } : {}),
        ...(nextCursor ? { nextCursor } : {}),
      };
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(result, null, 2) },
        ],
        structuredContent: result,
      };
    } catch (error: unknown) {
      if (error instanceof IrisApiError) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error listing business rules: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};

// ── iris_rule_get ──────────────────────────────────────────────

export const ruleGetTool: ToolDefinition = {
  name: "iris_rule_get",
  title: "Get Business Rule",
  description:
    "Get the full definition of a business rule class including conditions, actions, " +
    "and routing logic. Returns the rule class as UDL text with XData blocks containing " +
    "the rule XML definition.",
  inputSchema: z.object({
    name: z
      .string()
      .describe("Fully-qualified rule class name (e.g., 'MyPackage.Rules.MyRule')"),
    namespace: z
      .string()
      .optional()
      .describe("Target namespace. Defaults to the server's configured namespace; pass an explicit value to query a different namespace per call without changing the connection default."),
  }),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  scope: "NS",
  handler: async (args, ctx) => {
    const { name, namespace } = args as {
      name: string;
      namespace?: string;
    };

    const ns = ctx.resolveNamespace(namespace);
    const params = new URLSearchParams();
    params.set("namespace", ns);
    params.set("name", name);

    const path = `${BASE_URL}/interop/rule/get?${params}`;

    try {
      const response = await ctx.http.get(path);
      const result = response.result;
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(result, null, 2) },
        ],
        structuredContent: result,
      };
    } catch (error: unknown) {
      if (error instanceof IrisApiError) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error getting rule '${name}': ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};
