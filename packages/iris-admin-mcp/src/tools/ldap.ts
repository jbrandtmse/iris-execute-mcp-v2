/**
 * IRIS LDAP configuration tool for the IRIS Administration MCP server.
 *
 * Provides {@link ldapManageTool} — a single multi-action tool to list,
 * inspect, create, modify, delete, and validity-test LDAP configurations for
 * delegated authentication via the custom REST endpoint
 * `/api/executemcp/v2/security/ldap`. Operations execute in the `%SYS`
 * namespace on the IRIS server (backed by `Security.LDAPConfigs`).
 *
 * **Governed write tool (Epic 15, Story 15.2).** The `mutates` classification
 * map below classifies all six actions: `list`/`get`/`test` are reads (enabled
 * by default), while `create`/`modify`/`delete` are writes that the governance
 * layer default-DISABLES until an operator opts in via `IRIS_GOVERNANCE`. The
 * tool does NOT declare a `server` field — the framework injects it
 * (architecture decision D2).
 *
 * **`test` scope (AC 15.2.5, Rule #16):** a live probe confirmed neither
 * `Security.LDAPConfigs` nor `%SYS.LDAP` exposes a single high-level
 * connection-test class method — only low-level primitives (`Init`, `Connect`,
 * `Binds`/`SimpleBinds`, `SearchExts`). Rather than fabricate a connection,
 * `test` is scoped DOWN to a non-mutating **config-validity check**: the config
 * exists, its required fields are populated, and its host names are
 * syntactically valid. Classified `read` (available by default for
 * diagnostics).
 *
 * **Bind-password redaction (AC 15.2.4, Rule #9):** `LDAPSearchPassword` is the
 * one secret field on the config. The live probe confirmed
 * `Security.LDAPConfigs.Get()` DOES populate it, so it is redacted server-side
 * (defense in depth) AND never surfaced by this tool's output mapping.
 */

import { IrisApiError, type ToolDefinition } from "@iris-mcp/shared";
import { z } from "zod";

/** Base URL for the custom ExecuteMCPv2 REST service. */
const BASE_URL = "/api/executemcp/v2";

// ── iris_ldap_manage ────────────────────────────────────────────

export const ldapManageTool: ToolDefinition = {
  name: "iris_ldap_manage",
  title: "Manage IRIS LDAP Configuration",
  description:
    "List, inspect, create, modify, delete, and validity-test IRIS LDAP " +
    "configurations for delegated authentication (backed by " +
    "Security.LDAPConfigs in %SYS). Actions: 'list' (all configs), 'get' (one " +
    "config's properties — requires name), 'test' (non-mutating validity check: " +
    "config exists, required fields present, host syntactically valid — requires " +
    "name), 'create'/'modify' (requires name + settings), 'delete' (requires " +
    "name). The mutating actions (create/modify/delete) are opt-in under tool " +
    "governance and are disabled by default until enabled via IRIS_GOVERNANCE. " +
    "NOTE: IRIS exposes no high-level LDAP connection-test API, so 'test' is a " +
    "config-validity check, NOT a live bind to the LDAP server. The bind search " +
    "password (LDAPSearchPassword) is NEVER returned in any response — it is " +
    "redacted. Settings fields (for create/modify): 'description', 'ldapBaseDN' " +
    "(required for create), 'ldapBaseDNForGroups' (required for create), " +
    "'ldapHostNames' (space-separated host[:port] list), 'ldapSearchUsername', " +
    "'ldapSearchPassword' (write-only), 'ldapClientTimeout', 'ldapServerTimeout', " +
    "'ldapUniqueDNIdentifier', 'ldapFlags' (bitmask: bit0 ActiveDirectory, bit1 " +
    "SSL/TLS, bit3 UseGroups, bit6 enabled, bit7 KerberosOnly), 'ldapCACertFile'.",
  inputSchema: z.object({
    action: z
      .enum(["list", "get", "create", "modify", "delete", "test"])
      .describe("Action to perform on the LDAP configuration(s)"),
    name: z
      .string()
      .optional()
      .describe(
        "LDAP configuration name (required for get/create/modify/delete/test)",
      ),
    settings: z
      .object({
        description: z
          .string()
          .optional()
          .describe("LDAP configuration description"),
        ldapBaseDN: z
          .string()
          .optional()
          .describe(
            "Search base DN (e.g. 'DC=example,DC=com') — required for create",
          ),
        ldapBaseDNForGroups: z
          .string()
          .optional()
          .describe("Search base DN for groups — required for create"),
        ldapHostNames: z
          .string()
          .optional()
          .describe(
            "LDAP server host name(s), space-separated, optional :port suffix",
          ),
        ldapSearchUsername: z
          .string()
          .optional()
          .describe("Username of the LDAP search user"),
        ldapSearchPassword: z
          .string()
          .optional()
          .describe(
            "Password of the LDAP search user (write-only; never returned)",
          ),
        ldapClientTimeout: z
          .number()
          .optional()
          .describe("Client timeout (ms) before a Server Down is returned"),
        ldapServerTimeout: z
          .number()
          .optional()
          .describe("Server timeout (ms) before the connection is terminated"),
        ldapUniqueDNIdentifier: z
          .string()
          .optional()
          .describe(
            "Unique per-user identifying attribute (e.g. 'sAMAccountName')",
          ),
        ldapFlags: z
          .number()
          .optional()
          .describe(
            "LDAP connection flags bitmask (bit0 ActiveDirectory, bit1 SSL/TLS, " +
              "bit3 UseGroups, bit6 enabled, bit7 KerberosOnly)",
          ),
        ldapCACertFile: z
          .string()
          .optional()
          .describe("Path to the CA certificate file (PEM) for TLS (Unix only)"),
      })
      .optional()
      .describe("Settings to apply for the 'create'/'modify' actions"),
    namespace: z
      .string()
      .optional()
      .describe("Namespace override (LDAP configs are %SYS-scoped; usually omit)"),
    cursor: z
      .string()
      .optional()
      .describe(
        "Pagination cursor from a previous 'list' response's nextCursor field",
      ),
  }),
  annotations: {
    // The tool can mutate (create/modify/delete). MCP annotations are
    // tool-scoped; the per-action read/write distinction is realized through
    // `mutates` below.
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  scope: "SYS",
  // Governance classification (Story 15.0 strict contract): EVERY action key is
  // classified because none are in the frozen Epic-14 baseline. Reads default
  // enabled; writes default DISABLED (opt-in via IRIS_GOVERNANCE). `test` is a
  // non-mutating config-validity check → read (AC 15.2.5).
  mutates: {
    list: "read",
    get: "read",
    test: "read",
    create: "write",
    modify: "write",
    delete: "write",
  },
  handler: async (args, ctx) => {
    const { action, name, settings, cursor } = args as {
      action: "list" | "get" | "create" | "modify" | "delete" | "test";
      name?: string;
      settings?: Record<string, unknown>;
      cursor?: string;
    };

    const path = `${BASE_URL}/security/ldap`;

    try {
      if (action === "list") {
        const response = await ctx.http.get(path);
        const rawResult = response.result as Array<Record<string, unknown>>;
        const allConfigs = Array.isArray(rawResult) ? rawResult : [];
        const { page, nextCursor } = ctx.paginate(allConfigs, cursor);
        const result = {
          configs: page,
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

      if (action === "get" || action === "test") {
        // `name` is required for get/test. For get, an absent ?name= would make
        // the server return the whole inventory (wrong shape under a `get`
        // action); for test there is nothing to validate without a name. Reject
        // up front so the caller gets a clear error.
        if (name === undefined || name === "") {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: 'name' is required for the '${action}' action.`,
              },
            ],
            isError: true,
          };
        }
        const qsAction = action === "test" ? "&test=1" : "";
        const getPath = `${path}?name=${encodeURIComponent(name)}${qsAction}`;
        const response = await ctx.http.get(getPath);
        const result = response.result;
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(result, null, 2) },
          ],
          structuredContent: result,
        };
      }

      // create / modify / delete — POST a mutating request body.
      // `name` is required for every write action.
      if (name === undefined || name === "") {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: 'name' is required for the '${action}' action.`,
            },
          ],
          isError: true,
        };
      }
      // create/modify must apply at least one field; an empty settings object
      // would issue a no-op the server may report as success — reject it up
      // front so the caller is not told a do-nothing call succeeded.
      if (
        (action === "create" || action === "modify") &&
        (settings === undefined || Object.keys(settings).length === 0)
      ) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: the '${action}' action requires a non-empty 'settings' object.`,
            },
          ],
          isError: true,
        };
      }
      const body: Record<string, unknown> = { action, name };
      if (
        (action === "create" || action === "modify") &&
        settings !== undefined
      ) {
        body.settings = settings;
      }

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
        const label = name ? `LDAP config '${name}'` : "LDAP configs";
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
