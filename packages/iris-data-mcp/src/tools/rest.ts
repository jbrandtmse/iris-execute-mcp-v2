/**
 * REST API management tools for the IRIS Data & Analytics MCP server.
 *
 * Provides one tool for managing IRIS REST API dispatch classes:
 * - {@link restManageTool} — List, get details, or delete REST applications
 *
 * Most operations call the IRIS built-in Management API at
 * `/api/mgmnt/v2/{namespace}/...`. When the caller requests `scope: "all"`
 * for a `list` action, the tool falls back to the custom ExecuteMCPv2
 * webapp endpoint (`/api/executemcp/v2/security/webapp`) because
 * `%REST.API.GetAllRESTApps` filters out hand-written `%CSP.REST` subclasses
 * by design.
 */

import { IrisApiError, type ToolDefinition } from "@iris-mcp/shared";
import { z } from "zod";
import { extractResult, toStructured } from "./docdb.js";

/** Base URL for the IRIS Management REST API (spec-first apps only). */
const BASE_MGMNT_URL = "/api/mgmnt/v2";
/** Base URL for the custom ExecuteMCPv2 REST service (covers all %CSP.REST apps). */
const BASE_EXECUTEMCP_URL = "/api/executemcp/v2";

// ── iris_rest_manage ──────────────────────────────────────────

export const restManageTool: ToolDefinition = {
  name: "iris_rest_manage",
  title: "Manage REST API",
  description:
    "List, get details, or delete REST API dispatch classes on IRIS. " +
    "'list' returns REST application dispatch classes in the namespace. " +
    "Use scope:'spec-first' (default) for OpenAPI-spec-first apps " +
    "(shown with swaggerSpec URLs), or scope:'all' to include " +
    "hand-written %CSP.REST subclasses (swaggerSpec will be null for those). " +
    "'get' returns REST application details (dispatch class, URL map, routes) for a named application. " +
    "'delete' removes a REST application.",
  inputSchema: z.object({
    action: z
      .enum(["list", "get", "delete"])
      .describe("Action to perform: 'list', 'get', or 'delete'"),
    scope: z
      .enum(["spec-first", "all"])
      .optional()
      .default("spec-first")
      .describe(
        "For 'list' action only. 'spec-first' (default) returns only " +
          "OpenAPI-spec-first apps via the Mgmnt API. 'all' includes " +
          "hand-written %CSP.REST dispatch classes via the ExecuteMCPv2 " +
          "webapp endpoint (swaggerSpec is null for those).",
      ),
    application: z
      .string()
      .min(1)
      .optional()
      .describe(
        "REST application path (required for 'get' and 'delete', e.g., '/api/myapp')",
      ),
    namespace: z
      .string()
      .optional()
      .describe("Target namespace (default: configured namespace)"),
  }),
  annotations: {
    destructiveHint: true,
    readOnlyHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  scope: "NS",
  handler: async (args, ctx) => {
    const { action, scope, application, namespace } = args as {
      action: string;
      scope?: "spec-first" | "all";
      application?: string;
      namespace?: string;
    };

    const ns = ctx.resolveNamespace(namespace);
    // Zod `.default("spec-first")` only fires when inputs are parsed through
    // Zod. The tool registry typically passes raw args, so the `scope` may be
    // `undefined` at runtime — fall back here to preserve the contract.
    const effectiveScope: "spec-first" | "all" = scope ?? "spec-first";

    try {
      let response: unknown;

      if (action === "list") {
        if (effectiveScope === "all") {
          // Bug #13 Path A: %REST.API.GetAllRESTApps filters out hand-written
          // %CSP.REST dispatch classes by design. Use the ExecuteMCPv2 webapp
          // endpoint instead, which returns every web application regardless
          // of spec-first status. Filter client-side for entries with a
          // non-empty dispatchClass, then normalize to match the Mgmnt API
          // response shape so callers can consume either scope uniformly.
          const webappPath = `${BASE_EXECUTEMCP_URL}/security/webapp?namespace=${encodeURIComponent(ns)}`;
          const webappResponse = await ctx.http.get(webappPath);
          const rawWebapps = (webappResponse as { result?: unknown }).result;
          const webapps: Array<Record<string, unknown>> = Array.isArray(
            rawWebapps,
          )
            ? (rawWebapps as Array<Record<string, unknown>>)
            : [];
          const restApps = webapps
            .filter((w) => {
              const dc = w.dispatchClass;
              return typeof dc === "string" && dc.length > 0;
            })
            .map((w) => ({
              name: w.name,
              dispatchClass: w.dispatchClass,
              namespace: w.namespace,
              swaggerSpec: null as string | null,
            }));
          const structured = { items: restApps, count: restApps.length };
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(structured, null, 2),
              },
            ],
            structuredContent: structured,
          };
        }
        response = await ctx.http.get(
          `${BASE_MGMNT_URL}/${encodeURIComponent(ns)}/`,
        );
      } else if (action === "get") {
        if (!application) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: 'application' is required for 'get' action",
              },
            ],
            isError: true,
          };
        }
        response = await ctx.http.get(
          `${BASE_MGMNT_URL}/${encodeURIComponent(ns)}/${encodeURIComponent(application)}`,
        );
      } else {
        // delete
        if (!application) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: 'application' is required for 'delete' action",
              },
            ],
            isError: true,
          };
        }
        response = await ctx.http.delete(
          `${BASE_MGMNT_URL}/${encodeURIComponent(ns)}/${encodeURIComponent(application)}`,
        );
      }

      const result = extractResult(response);
      const structured = toStructured(result);
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(structured, null, 2) },
        ],
        structuredContent: structured,
      };
    } catch (error: unknown) {
      if (error instanceof IrisApiError) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error managing REST application: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};
