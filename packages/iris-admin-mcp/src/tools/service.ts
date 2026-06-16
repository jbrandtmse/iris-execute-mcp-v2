/**
 * IRIS service configuration tool for the IRIS Administration MCP server.
 *
 * Provides {@link serviceManageTool} — a single multi-action tool to list,
 * inspect, and toggle IRIS services and their authentication settings via the
 * custom REST endpoint `/api/executemcp/v2/security/service`. Operations execute
 * in the `%SYS` namespace on the IRIS server (backed by `Security.Services`).
 *
 * **First governed write tool in the suite (Epic 15, Story 15.1).** The `mutates`
 * classification map below is the first real consumer of the Story 15.0
 * `mutates`/default-seed machinery: `list`/`get` are reads (enabled by default),
 * while `enable`/`disable`/`set` are writes that the governance layer
 * default-DISABLES until an operator opts in via `IRIS_GOVERNANCE`. The tool does
 * NOT declare a `server` field — the framework injects it (architecture
 * decision D2).
 */

import { IrisApiError, type ToolDefinition } from "@iris-mcp/shared";
import { z } from "zod";

/** Base URL for the custom ExecuteMCPv2 REST service. */
const BASE_URL = "/api/executemcp/v2";

// ── iris_service_manage ────────────────────────────────────────

export const serviceManageTool: ToolDefinition = {
  name: "iris_service_manage",
  title: "Manage IRIS Service",
  description:
    "List, inspect, and toggle IRIS services and their authentication settings " +
    "(backed by Security.Services in %SYS). Actions: 'list' (all services), " +
    "'get' (one service's properties — requires name), 'enable'/'disable' (toggle " +
    "a service on/off — requires name), 'set' (update auth settings via the " +
    "'settings' object — requires name). Use this to harden an instance, e.g. " +
    "disable %Service_Telnet. The mutating actions (enable/disable/set) are " +
    "opt-in under tool governance and are disabled by default until enabled via " +
    "IRIS_GOVERNANCE. Settings fields: 'enabled' (boolean), 'autheEnabled' " +
    "(integer auth-method bitmask), 'description', 'clientSystems' (allowed IP " +
    "list). Service names start with '%Service_' (e.g. %Service_SQL, " +
    "%Service_CallIn, %Service_Telnet).",
  inputSchema: z.object({
    action: z
      .enum(["list", "get", "enable", "disable", "set"])
      .describe("Action to perform on the service(s)"),
    name: z
      .string()
      .optional()
      .describe(
        "Service name (required for get/enable/disable/set), e.g. '%Service_SQL'",
      ),
    settings: z
      .object({
        enabled: z
          .boolean()
          .optional()
          .describe("Whether the service is enabled"),
        autheEnabled: z
          .number()
          .optional()
          .describe(
            "Authentication methods bitmask (Security.Services.AutheEnabled)",
          ),
        description: z
          .string()
          .optional()
          .describe("Full description of the service"),
        clientSystems: z
          .string()
          .optional()
          .describe("Allowed client IP connections (semicolon-separated list)"),
      })
      .optional()
      .describe("Settings to apply for the 'set' action"),
    namespace: z
      .string()
      .optional()
      .describe("Namespace override (services are %SYS-scoped; usually omit)"),
    cursor: z
      .string()
      .optional()
      .describe(
        "Pagination cursor from a previous 'list' response's nextCursor field",
      ),
  }),
  annotations: {
    // The tool can mutate (enable/disable/set). MCP annotations are tool-scoped;
    // the per-action read/write distinction is realized through `mutates` below.
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  scope: "SYS",
  // Governance classification (Story 15.0 strict contract): EVERY action key is
  // classified because none are in the frozen Epic-14 baseline. Reads default
  // enabled; writes default DISABLED (opt-in via IRIS_GOVERNANCE).
  mutates: {
    list: "read",
    get: "read",
    enable: "write",
    disable: "write",
    set: "write",
  },
  handler: async (args, ctx) => {
    const { action, name, settings, cursor } = args as {
      action: "list" | "get" | "enable" | "disable" | "set";
      name?: string;
      settings?: {
        enabled?: boolean;
        autheEnabled?: number;
        description?: string;
        clientSystems?: string;
      };
      cursor?: string;
    };

    const path = `${BASE_URL}/security/service`;

    try {
      if (action === "list") {
        const response = await ctx.http.get(path);
        const rawResult = response.result as Array<Record<string, unknown>>;
        const allServices = Array.isArray(rawResult) ? rawResult : [];
        const { page, nextCursor } = ctx.paginate(allServices, cursor);
        const result = {
          services: page,
          count: page.length,
          ...(nextCursor ? { nextCursor } : {}),
        };
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(result, null, 2) },
          ],
          structuredContent: result,
        };
      }

      if (action === "get") {
        // `name` is required for get: the server's GET endpoint treats an absent
        // ?name= as "list all", so an empty name would silently return the whole
        // service inventory under a `get` action (wrong result shape). Reject it
        // here so the caller gets a clear error instead of a surprising list.
        if (name === undefined || name === "") {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: 'name' is required for the 'get' action (e.g. '%Service_SQL').",
              },
            ],
            isError: true,
          };
        }
        // GET with the service name as a query parameter; the handler returns the
        // service's properties.
        const getPath = `${path}?name=${encodeURIComponent(name)}`;
        const response = await ctx.http.get(getPath);
        const result = response.result;
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(result, null, 2) },
          ],
          structuredContent: result,
        };
      }

      // enable / disable / set — POST a mutating request body.
      // `name` is required for every write action.
      if (name === undefined || name === "") {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: 'name' is required for the '${action}' action (e.g. '%Service_SQL').`,
            },
          ],
          isError: true,
        };
      }
      // `set` must apply at least one field; an empty settings object would issue
      // a no-op Modify that the server reports as success — reject it up front so
      // the caller is not told a do-nothing call succeeded.
      if (
        action === "set" &&
        (settings === undefined || Object.keys(settings).length === 0)
      ) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Error: the 'set' action requires a non-empty 'settings' object (one or more of: enabled, autheEnabled, description, clientSystems).",
            },
          ],
          isError: true,
        };
      }
      const body: Record<string, unknown> = { action, name };
      if (action === "set" && settings !== undefined) body.settings = settings;

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
        const label = name ? `service '${name}'` : "services";
        return {
          content: [
            {
              type: "text" as const,
              text: `Error performing '${action}' on ${label}: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};
