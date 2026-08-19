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
 *
 * **`listPrivileges` bounding (Story 35.4, additive parameters only — E-1: no
 * new tool, no new action key).** `listPrivileges` was unbounded: a grantee
 * holding `%All` (e.g. `_SYSTEM`) returned 15,341 rows / 2,900,478 characters
 * live-measured 2026-08-17/18, exceeding the client transport limit. Two
 * independent, additive fixes, both server-side in
 * `ExecuteMCPv2.REST.Security:SqlPrivilegeList`:
 *   1. `maxRows` (new optional param, default 100/max 1000, mirroring
 *      `iris_audit_manage:view`) stops the fetch loop from materializing rows
 *      past the cap — an OUTPUT bound, not a scan bound (see the handler's
 *      class-doc comment for the live timing that established this). A
 *      capped response carries `rowsCapped: true`; omitted when not capped,
 *      so an under-cap caller's shape is byte-identical to pre-35.4 (AC 35.4.5).
 *   2. The `%All` short-circuit (Rule #6): every row whose
 *      `GRANTED_VIA = "SuperUser"` is omitted from `privileges` (that is the
 *      derived cross-product responsible for the 15,341-row blowup); any REAL
 *      non-derived grant is still enumerated. The decision is made per-ROW,
 *      off a value the query already computed — the handler never resolves
 *      the grantee's roles, so there is no role graph to walk incompletely
 *      and no principal-name matching to get wrong. An instance-wide sweep of
 *      all 46 users and roles (Story 35.4 code review) found `SuperUser` rows
 *      emitted if and only if the principal effectively holds `%All`, with
 *      powerful non-`%All` controls such as `Admin` returning 0 derived rows.
 *      A `reason` string and a `superUserPrivilegesOmitted` count are added
 *      ONLY when rows were actually omitted — a grantee with no derived rows
 *      is unaffected (verified live against the `%Developer` and `Admin`
 *      controls: byte-for-byte unchanged).
 * `cursor` (new optional param) pages the tool-layer's already-bounded
 * `privileges` array via `ctx.paginate`, following the `cursor` + `ctx.paginate`
 * convention used by `audit.ts`/`database.ts`/`ldap.ts`/`mapping.ts`. Unlike
 * `audit.ts`'s `view` handler (which rebuilds its result from only
 * `events`/`count`/`nextCursor`, silently dropping any other wire field), this
 * handler SPREADS the raw wire result before overriding `privileges`/`count`/
 * `nextCursor`, so `rowsCapped`/`reason`/`superUserPrivilegesOmitted` survive
 * into the tool's response — otherwise the truncation/short-circuit signal
 * this story adds would be computed server-side and then thrown away here.
 * `maxRows` is the ceiling on what the server returns at all; `cursor` pages
 * WITHIN that ceiling at `DEFAULT_PAGE_SIZE` (50, `server-base.ts:83`). The
 * two therefore interact, and the interaction is resolved DELIBERATELY here
 * (`audit.ts` has the same latent one, undocumented):
 *   - Pagination is OPT-IN. A caller supplying neither `maxRows` nor `cursor`
 *     is not paginated at all and receives the raw wire result — required by
 *     AC 35.4.5, since `ctx.paginate`'s unconditional 50-row slice would
 *     otherwise silently truncate an under-cap caller holding 51-100
 *     privileges and hand them a `nextCursor` they never asked for.
 *   - Supplying either parameter opts in: pages are 50 rows, and `nextCursor`
 *     walks to the `maxRows` ceiling but never past it. To see rows beyond
 *     the ceiling, raise `maxRows`; to see rows 51..maxRows, page. Each page
 *     re-runs the server query and the cursor offset is positional, so the
 *     same `maxRows` must be resent with every `cursor`.
 *   - `maxRows` is itself clamped to 1000 server-side, so a grantee with more
 *     than 1000 REAL grants cannot be fully enumerated through this action.
 *     That is an accepted limit, not an oversight: the action exists to make
 *     privileged grantees inspectable, and the `%All` short-circuit removes
 *     the only known cause of counts that large.
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
    "IRIS_GOVERNANCE; listPrivileges is a read and enabled by default. " +
    "'listPrivileges' accepts 'maxRows' (default 100, max 1000 — values above " +
    "1000 are clamped) and 'cursor'. 'maxRows' bounds OUTPUT only: the server " +
    "stops pumping its result cursor at the cap, so rows past it are never " +
    "materialized, but the underlying privilege computation is NOT reduced — " +
    "this is not timeout protection. A capped response carries " +
    "'rowsCapped: true'. Pagination is opt-in: pass 'maxRows' or 'cursor' and " +
    "the response is paged 50 rows at a time within the 'maxRows' ceiling " +
    "(resend the SAME 'maxRows' with each 'cursor', since every page re-runs " +
    "the query); pass neither and you get every row the server returned, " +
    "unpaged. The cursor cannot cross the 'maxRows' ceiling, and 'maxRows' " +
    "itself is capped at 1000, so a grantee with more than 1000 real grants " +
    "cannot be fully enumerated through this action. A grantee holding the " +
    "'%All' super-role (e.g. '_SYSTEM'), directly or through a nested role " +
    "chain, has its derived (GRANTED_VIA=SuperUser) rows omitted " +
    "automatically — a 'reason' field and a 'superUserPrivilegesOmitted' " +
    "count appear when rows were actually omitted; any real, non-derived " +
    "grant is still listed. The omission keys off each row's GRANTED_VIA " +
    "value, so it holds however the grantee acquired '%All'.",
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
    // ── listPrivileges bounding (Story 35.4, additive) ──
    maxRows: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        "Max privilege rows for listPrivileges (default 100; values above " +
          "1000 are clamped server-side). Bounds OUTPUT only, not the " +
          "privilege scan — see the action description. Passing it also " +
          "opts into 50-row pagination.",
      ),
    cursor: z
      .string()
      .optional()
      .describe(
        "Pagination cursor from a previous listPrivileges response's " +
          "nextCursor field. Pages 50 rows at a time within the maxRows " +
          "ceiling; resend the same maxRows with it, because each page " +
          "re-runs the server query and the offset is positional.",
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
      maxRows,
      cursor,
    } = args as {
      action: string;
      name?: string;
      description?: string;
      publicPermission?: string;
      target?: string;
      privilege?: string;
      grantee?: string;
      namespace?: string;
      maxRows?: number;
      cursor?: string;
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
      if (maxRows !== undefined) qs.set("maxRows", String(maxRows));
      const sqlPath = `${BASE_URL}/security/sqlprivilege?${qs.toString()}`;
      try {
        const response = await ctx.http.get(sqlPath);
        const rawResult = response.result as {
          privileges?: Array<Record<string, unknown>>;
          [key: string]: unknown;
        };
        const allPrivileges = Array.isArray(rawResult?.privileges)
          ? rawResult.privileges
          : [];
        // Pagination is OPT-IN (AC 35.4.5). `ctx.paginate` slices at
        // DEFAULT_PAGE_SIZE (50, `server-base.ts:83`) unconditionally, so
        // applying it to every call would truncate a caller who passed
        // NOTHING and whose grantee holds 51-100 privileges — they fit under
        // the server's 100-row default cap, yet would silently receive 50
        // rows, a `count` of 50, and a `nextCursor` they never asked for.
        // That is exactly the population AC 35.4.5 protects, so a caller who
        // supplies neither `maxRows` nor `cursor` gets the raw wire result
        // untouched — byte-identical to the pre-35.4 shape. Supplying either
        // one opts into the sibling `cursor`/`ctx.paginate` convention
        // (`audit.ts`/`database.ts`/`ldap.ts`/`mapping.ts`), which is how a
        // caller obtains the first `nextCursor` at all.
        const paginationRequested =
          maxRows !== undefined || cursor !== undefined;
        // Spread the raw wire result (grantee/level/target/rowsCapped/reason/
        // superUserPrivilegesOmitted) rather than rebuilding from scratch, so
        // the server-side truncation/short-circuit signal this story adds
        // survives into the tool response — see the module doc comment.
        let result: Record<string, unknown>;
        if (paginationRequested) {
          const { page, nextCursor } = ctx.paginate(allPrivileges, cursor);
          result = {
            ...rawResult,
            privileges: page,
            count: page.length,
            ...(nextCursor ? { nextCursor } : {}),
          };
        } else {
          result = { ...rawResult, privileges: allPrivileges };
        }
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
