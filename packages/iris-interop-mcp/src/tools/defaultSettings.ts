/**
 * System Default Settings tool for the IRIS Interoperability MCP server.
 *
 * Provides {@link defaultSettingsManageTool} — `iris_default_settings_manage` —
 * a single multi-action tool to manage Interoperability System Default Settings
 * (`Ens.Config.DefaultSettings`), the production-portable settings override layer.
 *
 * A default setting is identified by a 4-tuple
 * (`production` / `item` / `hostClass` / `setting`), each slot defaulting to `"*"`
 * (the class `InitialExpression`) meaning "applies to all" for that dimension.
 *
 * Actions:
 * - **list** (read): all settings rows, optionally filtered by any tuple slot →
 *   `GET /api/executemcp/v2/interop/defaultsettings`.
 * - **get** (read): the single row for an exact tuple →
 *   `POST /api/executemcp/v2/interop/defaultsettings`.
 * - **set** (write): create or update the row for a tuple →
 *   `POST /api/executemcp/v2/interop/defaultsettings`.
 * - **delete** (write): remove the row for a tuple →
 *   `POST /api/executemcp/v2/interop/defaultsettings`.
 *
 * **Governance (Story 17.1, frozen-foundation model).** The four action keys are
 * NEW post-foundation keys (absent from the frozen `governance-baseline.ts`), so
 * EVERY action is classified in `mutates`: `list`/`get` are reads (enabled by
 * default), while `set`/`delete` are writes that the governance layer
 * default-DISABLES until an operator opts in via `IRIS_GOVERNANCE`. The `server`
 * field is framework-injected (architecture decision D2), so it is not declared
 * on the schema. `%Save()`/`%DeleteId()` auto-update production mod flags on the
 * server — no manual production recompile.
 */

import { IrisApiError, type ToolDefinition } from "@iris-mcp/shared";
import { z } from "zod";

/** Base URL for the custom ExecuteMCPv2 REST service. */
const BASE_URL = "/api/executemcp/v2";

// ── iris_default_settings_manage ──────────────────────────────

export const defaultSettingsManageTool: ToolDefinition = {
  name: "iris_default_settings_manage",
  title: "Manage System Default Settings",
  description:
    "Manage Interoperability System Default Settings (Ens.Config.DefaultSettings) — " +
    "the production-portable settings override layer. A setting is keyed by a 4-tuple " +
    "(production / item / hostClass / setting); any omitted slot defaults to '*' " +
    "(applies to all). Actions:\n\n" +
    "- **list** (read): all settings rows, optionally filtered by any of the four key " +
    "slots passed as filters.\n" +
    "- **get** (read): the single row for the exact tuple (returns found:false if absent).\n" +
    "- **set** (write): create or update the row for a tuple. Requires 'value'; accepts " +
    "optional 'description' and 'deployable'.\n" +
    "- **delete** (write): remove the row for a tuple.\n\n" +
    "The mutating actions (set/delete) are opt-in under tool governance and are DISABLED " +
    "by default until enabled via IRIS_GOVERNANCE. Saves and deletes auto-update the " +
    "production modification flags on the server — no manual recompile is required.",
  inputSchema: z.object({
    action: z
      .enum(["list", "get", "set", "delete"])
      .describe("Action to perform on the default setting(s)"),
    production: z
      .string()
      .optional()
      .describe(
        "Production name key slot. For get/set/delete it is part of the exact tuple key " +
          "and defaults to '*' (= the catch-all row) when omitted. For 'list' it is an " +
          "OPTIONAL exact-match filter: OMIT it to return all productions; passing the " +
          "literal '*' filters to only the wildcard-scoped ('*') rows, not all rows.",
      ),
    item: z
      .string()
      .optional()
      .describe(
        "Item (config item) name key slot (defaults to '*' = all items). Filter for " +
          "'list'; part of the exact tuple key for get/set/delete.",
      ),
    hostClass: z
      .string()
      .optional()
      .describe(
        "Host class name key slot (defaults to '*' = all host classes). Filter for " +
          "'list'; part of the exact tuple key for get/set/delete.",
      ),
    setting: z
      .string()
      .optional()
      .describe(
        "Setting name key slot (defaults to '*' = all settings). Filter for 'list'; " +
          "part of the exact tuple key for get/set/delete.",
      ),
    value: z
      .string()
      .optional()
      .describe("Setting value (required for 'set')."),
    description: z
      .string()
      .optional()
      .describe("Optional human-readable description (for 'set')."),
    deployable: z
      .boolean()
      .optional()
      .describe("Optional deployable flag — whether the setting is export-portable (for 'set')."),
    namespace: z
      .string()
      .optional()
      .describe(
        "Target namespace. Defaults to the server's configured namespace; pass an explicit " +
          "value to operate on a different namespace per call without changing the connection default.",
      ),
  }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
  scope: "NS",
  // Governance classification (Story 15.0 strict contract): EVERY action key is
  // classified because none are in the frozen Epic-14 baseline. The reads default
  // enabled; the writes default DISABLED (opt-in via IRIS_GOVERNANCE).
  mutates: {
    list: "read",
    get: "read",
    set: "write",
    delete: "write",
  },
  handler: async (args, ctx) => {
    const { action, production, item, hostClass, setting, value, description, deployable, namespace } =
      args as {
        action: "list" | "get" | "set" | "delete";
        production?: string;
        item?: string;
        hostClass?: string;
        setting?: string;
        value?: string;
        description?: string;
        deployable?: boolean;
        namespace?: string;
      };

    const ns = ctx.resolveNamespace(namespace);

    try {
      if (action === "list") {
        const params = new URLSearchParams();
        params.set("namespace", ns);
        if (production !== undefined) params.set("production", production);
        if (item !== undefined) params.set("item", item);
        if (hostClass !== undefined) params.set("hostClass", hostClass);
        if (setting !== undefined) params.set("setting", setting);

        const path = `${BASE_URL}/interop/defaultsettings?${params}`;
        const response = await ctx.http.get(path);
        const result = response.result;
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(result, null, 2) },
          ],
          structuredContent: result,
        };
      }

      // get / set / delete — POST the action + tuple.
      const body: Record<string, unknown> = { action, namespace: ns };
      if (production !== undefined) body.production = production;
      if (item !== undefined) body.item = item;
      if (hostClass !== undefined) body.hostClass = hostClass;
      if (setting !== undefined) body.setting = setting;
      if (action === "set") {
        if (value !== undefined) body.value = value;
        if (description !== undefined) body.description = description;
        if (deployable !== undefined) body.deployable = deployable;
      }

      const path = `${BASE_URL}/interop/defaultsettings`;
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
              text: `Error managing default settings (${action}): ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};
