/**
 * Data transformation tools for the IRIS Interoperability MCP server.
 *
 * Provides two tools for inspecting and testing Ensemble data transformations:
 * - {@link transformListTool} — List all DTL transform classes in the namespace
 * - {@link transformTestTool} — Execute a transformation against sample input
 *
 * All tools call the custom REST service at `/api/executemcp/v2/interop/transform`.
 */

import { IrisApiError, type ToolDefinition } from "@iris-mcp/shared";
import { z } from "zod";

/** Base URL for the custom ExecuteMCPv2 REST service. */
const BASE_URL = "/api/executemcp/v2";

// ── iris_transform_list ────────────────────────────────────────

/** Default page size for transform/rule list pagination (FEAT-3). */
const DEFAULT_PAGE_SIZE = 100;
/** Maximum page size for transform/rule list pagination (FEAT-3). */
const MAX_PAGE_SIZE = 1000;

export const transformListTool: ToolDefinition = {
  name: "iris_transform_list",
  title: "List Data Transformations",
  description:
    "List all data transformation (DTL) classes in the namespace. Returns non-abstract " +
    "classes that extend Ens.DataTransformDTL or Ens.DataTransform, showing their " +
    "fully-qualified class names. " +
    "Use 'prefix' to narrow by dotted-package prefix (e.g. 'MyPackage.Transforms'). " +
    "Use 'filter' for a case-insensitive substring match. " +
    "Use 'cursor'/'nextCursor' for pagination (default page size: 100, max: 1000). " +
    "Note: filtering is client-side — the full list is fetched from the server each page request.",
  inputSchema: z.object({
    prefix: z
      .string()
      .optional()
      .describe(
        "Dotted-prefix filter (client-side). Only transforms whose name starts with this prefix are returned. " +
          "Example: 'MyPackage.Transforms' matches 'MyPackage.Transforms.ToHL7' but not 'OtherPackage.Transforms.ToHL7'.",
      ),
    filter: z
      .string()
      .optional()
      .describe(
        "Case-insensitive substring filter (client-side). Applied after prefix. " +
          "Example: 'hl7' matches any transform whose name contains 'hl7', 'HL7', or 'Hl7'.",
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

    const path = `${BASE_URL}/interop/transform?${params}`;

    try {
      const response = await ctx.http.get(path);
      // Server returns {transforms: [{name: "..."}], count: N} or similar
      const raw = response.result as { transforms?: Array<{ name: string }> } | Array<{ name: string }>;
      const allItems: Array<{ name: string }> = Array.isArray(raw)
        ? (raw as Array<{ name: string }>)
        : ((raw as { transforms?: Array<{ name: string }> }).transforms ?? []);

      // FEAT-3: client-side prefix + filter
      const filtered = allItems.filter((item) => {
        if (prefix && !item.name.startsWith(prefix)) return false;
        if (filter && !item.name.toLowerCase().includes(filter.toLowerCase())) return false;
        return true;
      });

      const effectivePageSize = Math.min(pageSize ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
      const { page, nextCursor } = ctx.paginate(filtered, cursor, effectivePageSize);

      const result = {
        transforms: page,
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
              text: `Error listing data transformations: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};

// ── iris_transform_test ────────────────────────────────────────

export const transformTestTool: ToolDefinition = {
  name: "iris_transform_test",
  title: "Test Data Transformation",
  description:
    "Execute a data transformation against sample input and return the output. " +
    "Requires the transform class name, source message class name, and a JSON object " +
    "of property values to populate the source message. The transformation is executed " +
    "and the resulting output object is returned.",
  inputSchema: z.object({
    className: z
      .string()
      .describe("Fully-qualified transform class name (e.g., 'MyPackage.Transforms.MyDTL')"),
    sourceClass: z
      .string()
      .describe("Fully-qualified source message class name"),
    sourceData: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("JSON object of property values to populate the source message"),
    namespace: z
      .string()
      .optional()
      .describe("Target namespace. Defaults to the server's configured namespace; pass an explicit value to query a different namespace per call without changing the connection default."),
  }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  scope: "NS",
  handler: async (args, ctx) => {
    const { className, sourceClass, sourceData, namespace } = args as {
      className: string;
      sourceClass: string;
      sourceData?: Record<string, unknown>;
      namespace?: string;
    };

    const ns = ctx.resolveNamespace(namespace);
    const body: Record<string, unknown> = {
      className,
      sourceClass,
      namespace: ns,
    };
    if (sourceData !== undefined) body.sourceData = sourceData;

    const path = `${BASE_URL}/interop/transform/test`;

    try {
      const response = await ctx.http.post(path, body);
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
              text: `Error testing transformation '${className}': ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};
