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

export const ruleListTool: ToolDefinition = {
  name: "iris_rule_list",
  title: "List Business Rules",
  description:
    "List all business rule classes in the namespace. Returns non-abstract classes " +
    "that extend Ens.Rule.Definition, showing their fully-qualified class names.",
  inputSchema: z.object({
    namespace: z
      .string()
      .optional()
      .describe("Target namespace (default: configured namespace)"),
  }),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  scope: "NS",
  handler: async (args, ctx) => {
    const { namespace } = args as { namespace?: string };

    const ns = ctx.resolveNamespace(namespace);
    const params = new URLSearchParams();
    params.set("namespace", ns);

    const path = `${BASE_URL}/interop/rule?${params}`;

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
      .describe("Target namespace (default: configured namespace)"),
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
