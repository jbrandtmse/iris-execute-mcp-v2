/**
 * Resource management tools for the IRIS Administration MCP server.
 *
 * Provides two tools for managing IRIS security resources via the custom REST endpoint:
 * - {@link resourceManageTool} — Create, modify, or delete a security resource;
 *   AND (Story 15.5, additive) grant/revoke/list SQL object privileges
 *   (schema / table / column level).
 * - {@link resourceListTool} — List all security resources
 *
 * The resource (create/modify/delete) actions call the custom REST service at
 * `/api/executemcp/v2/security/resource` and execute in %SYS. The SQL-privilege
 * actions (grant/revoke/listPrivileges, Story 15.5) call
 * `/api/executemcp/v2/security/sqlprivilege` and execute in the TARGET namespace
 * (SQL privileges are namespace-scoped).
 *
 * **Governed-write extension (Epic 15, Story 15.5).** The original resource
 * actions (create/delete/modify) are pre-existing Epic-14 baseline keys and
 * remain grandfathered-enabled — their parameters, defaults, and output shapes
 * are UNCHANGED. The NEW SQL-privilege actions are classified via `mutates`:
 * `grant`/`revoke` are writes (default-DISABLED until enabled via
 * IRIS_GOVERNANCE) and `listPrivileges` is a read (enabled by default).
 */

import { IrisApiError, type ToolDefinition } from "@iris-mcp/shared";
import { z } from "zod";

/** Base URL for the custom ExecuteMCPv2 REST service. */
const BASE_URL = "/api/executemcp/v2";

// ── iris_resource_manage ───────────────────────────────────────

export const resourceManageTool: ToolDefinition = {
  name: "iris_resource_manage",
  title: "Manage Resource",
  description:
    "Create, modify, or delete an IRIS security resource. For 'create', name is required. " +
    "For 'modify', only provided fields are updated. For 'delete', only the name is needed. " +
    "ALSO manages fine-grained SQL object privileges (additive, Story 15.5): " +
    "'grant'/'revoke' a SQL privilege at schema, table, or column level, and " +
    "'listPrivileges' to list the current grants for a user or role. For the " +
    "SQL-privilege actions supply 'target' (a schema, 'schema.table', or " +
    "'schema.table(col1,col2)' for column level), 'privilege' (one or more of " +
    "SELECT,INSERT,UPDATE,DELETE,REFERENCES — comma-delimited, or '*' for all), " +
    "and 'grantee' (a SQL user or role). SQL privileges are namespace-scoped — " +
    "pass 'namespace' to target a non-default namespace. The grant/revoke actions " +
    "are opt-in under tool governance and disabled by default until enabled via " +
    "IRIS_GOVERNANCE; listPrivileges is a read and enabled by default.",
  inputSchema: z.object({
    action: z
      .enum([
        "create",
        "modify",
        "delete",
        "grant",
        "revoke",
        "listPrivileges",
      ])
      .describe("Action to perform on the resource or SQL privilege"),
    name: z
      .string()
      .optional()
      .describe(
        "Resource name (e.g., 'MyDB', '%Development') — required for create/modify/delete",
      ),
    description: z
      .string()
      .optional()
      .describe("Description of the resource"),
    publicPermission: z
      .string()
      .optional()
      .describe(
        "Default public permission for the resource (e.g., '', 'R', 'RW', 'RWU')",
      ),
    // ── SQL-privilege fields (Story 15.5 — grant/revoke/listPrivileges) ──
    target: z
      .string()
      .optional()
      .describe(
        "SQL privilege target for grant/revoke/listPrivileges: a schema, " +
          "'schema.table', or 'schema.table(col1,col2)' for column-level. For " +
          "listPrivileges, omit for an object-level listing or pass 'schema.table' " +
          "for a column-level listing.",
      ),
    privilege: z
      .string()
      .optional()
      .describe(
        "SQL privilege(s) for grant/revoke: one or more of " +
          "SELECT,INSERT,UPDATE,DELETE,REFERENCES (comma-delimited) or '*' for all.",
      ),
    grantee: z
      .string()
      .optional()
      .describe(
        "SQL user or role for grant/revoke/listPrivileges (the privilege holder).",
      ),
    namespace: z
      .string()
      .optional()
      .describe(
        "Target namespace for the SQL-privilege actions (privileges are " +
          "namespace-scoped). Defaults to the connection's namespace.",
      ),
  }),
  annotations: {
    destructiveHint: true,
    readOnlyHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  scope: "SYS",
  // Governance classification (Story 15.5). Only the NEW (non-baseline) actions
  // are classified; create/delete/modify are pre-existing Epic-14 baseline keys
  // and stay grandfathered-enabled (baseline membership wins in defaultSeed).
  mutates: {
    grant: "write",
    revoke: "write",
    listPrivileges: "read",
  },
  handler: async (args, ctx) => {
    const {
      action,
      name,
      description,
      publicPermission,
      target,
      privilege,
      grantee,
      namespace,
    } = args as {
      action: string;
      name?: string;
      description?: string;
      publicPermission?: string;
      target?: string;
      privilege?: string;
      grantee?: string;
      namespace?: string;
    };

    // ── SQL-privilege actions (Story 15.5) ─────────────────────────
    if (action === "grant" || action === "revoke") {
      const sqlPath = `${BASE_URL}/security/sqlprivilege`;
      const body: Record<string, string> = { action };
      if (target !== undefined) body.target = target;
      if (privilege !== undefined) body.privilege = privilege;
      if (grantee !== undefined) body.grantee = grantee;
      if (namespace !== undefined) body.namespace = namespace;
      try {
        const response = await ctx.http.post(sqlPath, body);
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
                text: `Error performing SQL privilege '${action}' on '${target ?? ""}': ${error.message}`,
              },
            ],
            isError: true,
          };
        }
        throw error;
      }
    }

    if (action === "listPrivileges") {
      const qs = new URLSearchParams();
      if (grantee !== undefined) qs.set("grantee", grantee);
      if (target !== undefined && target !== "") qs.set("target", target);
      if (namespace !== undefined && namespace !== "")
        qs.set("namespace", namespace);
      const sqlPath = `${BASE_URL}/security/sqlprivilege?${qs.toString()}`;
      try {
        const response = await ctx.http.get(sqlPath);
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
                text: `Error listing SQL privileges for '${grantee ?? ""}': ${error.message}`,
              },
            ],
            isError: true,
          };
        }
        throw error;
      }
    }

    // ── Resource actions (create/modify/delete) — UNCHANGED (AC 15.5.6) ──
    const body: Record<string, string> = { action, name: name ?? "" };
    if (description !== undefined) body.description = description;
    if (publicPermission !== undefined) body.publicPermission = publicPermission;

    const path = `${BASE_URL}/security/resource`;

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
              text: `Error managing resource '${name}': ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};

// ── iris_resource_list ─────────────────────────────────────────

export const resourceListTool: ToolDefinition = {
  name: "iris_resource_list",
  title: "List Resources",
  description:
    "List all IRIS security resources with their description, public permission, and type.",
  inputSchema: z.object({
    cursor: z
      .string()
      .optional()
      .describe(
        "Pagination cursor from a previous response's nextCursor field",
      ),
  }),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  scope: "SYS",
  handler: async (args, ctx) => {
    const { cursor } = args as { cursor?: string };

    const path = `${BASE_URL}/security/resource`;

    try {
      const response = await ctx.http.get(path);
      const rawResult = response.result as Array<{
        name: string;
        description: string;
        publicPermission: string;
        type: string;
      }>;
      const allResources = Array.isArray(rawResult) ? rawResult : [];
      const { page, nextCursor } = ctx.paginate(allResources, cursor);
      const result = {
        resources: page,
        count: page.length,
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
              text: `Error listing resources: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};
