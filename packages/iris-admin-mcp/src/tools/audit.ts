/**
 * IRIS audit configuration & log management tool for the IRIS Administration
 * MCP server.
 *
 * Provides {@link auditManageTool} — a single multi-action tool to inspect and
 * configure instance auditing and manage the audit log via the custom REST
 * endpoint `/api/executemcp/v2/security/audit`. Operations execute in the
 * `%SYS` namespace on the IRIS server.
 *
 * **Governed write tool (Epic 15, Story 15.4) — the BROADEST Epic-15 tool**
 * (7 actions across two IRIS subsystems: `Security.System` /
 * `Security.Events` instance audit config, and `%SYS.Audit` for the audit
 * log). The `mutates` classification map classifies every action: `status`
 * and `view` are reads (enabled by default), while `enable`/`disable`/
 * `configureEvent`/`purge`/`export` are writes that the governance layer
 * default-DISABLES until an operator opts in via `IRIS_GOVERNANCE`. The tool
 * does NOT declare a `server` field — the framework injects it (architecture
 * decision D2).
 *
 * **Relationship to the read-only `iris_audit_events` tool (AC 15.4.2):**
 * the existing read-only `iris_audit_events` tool (in `@iris-mcp/ops`) is a
 * thin convenience reader of recent audit-log records. This tool COMPLEMENTS
 * it: `view` here is the same audit-log read (with richer filters), while the
 * write actions add audit CONFIGURATION (turn instance auditing on/off,
 * enable/disable individual audit events) and audit-log LIFECYCLE management
 * (purge bounded ranges, export to a server-side file). `iris_audit_events`
 * remains UNCHANGED — this tool is strictly additive.
 *
 * **`purge` is destructive (AC 15.4.5):** `purge` deletes audit-log records.
 * It is gated behind an explicit `confirm: true` parameter AND a bounded scope
 * (at least one of begin/end/user/event/source/type) so an unbounded silent
 * wipe is impossible from this tool; it returns the count deleted. The
 * tool-level `annotations.destructiveHint` is `true`.
 *
 * **`export` path control (AC 15.4.5):** `export` writes a server-side file.
 * The caller supplies a bare file NAME (not a path); the server writes it into
 * a fixed audit-export directory and rejects any path-separator / traversal
 * characters, then returns the resolved location + count.
 */

import { IrisApiError, type ToolDefinition } from "@iris-mcp/shared";
import { z } from "zod";

/** Base URL for the custom ExecuteMCPv2 REST service. */
const BASE_URL = "/api/executemcp/v2";

// ── iris_audit_manage ───────────────────────────────────────────

export const auditManageTool: ToolDefinition = {
  name: "iris_audit_manage",
  title: "Manage IRIS Auditing & Audit Log",
  description:
    "Configure IRIS instance auditing and manage the audit log (backed by " +
    "Security.System / Security.Events + %SYS.Audit in %SYS). Actions: " +
    "'status' (instance auditing on/off + per-event-type summary), 'view' " +
    "(recent audit-log records with filters: begin/end datetime, user, event, " +
    "source, type, maxRows), 'enable'/'disable' (turn instance auditing " +
    "on/off), 'configureEvent' (enable/disable one audit event — requires " +
    "source+type+name+enabled), 'purge' (delete a BOUNDED range of audit-log " +
    "records — DESTRUCTIVE; requires confirm:true AND at least one bound), " +
    "'export' (write matching audit-log records to a server-side file — " +
    "requires fileName, a bare name with no path separators). The mutating " +
    "actions (enable/disable/configureEvent/purge/export) are opt-in under " +
    "tool governance and are disabled by default until enabled via " +
    "IRIS_GOVERNANCE; status/view are reads and enabled by default. " +
    "COMPLEMENTS the read-only iris_audit_events tool (a thin audit-log " +
    "reader): 'view' here is the same log read with richer filters, plus this " +
    "tool adds audit configuration and log lifecycle management.",
  inputSchema: z.object({
    action: z
      .enum([
        "status",
        "enable",
        "disable",
        "configureEvent",
        "view",
        "purge",
        "export",
      ])
      .describe("Action to perform on auditing / the audit log"),
    // configureEvent params
    source: z
      .string()
      .optional()
      .describe(
        "Audit event source (e.g. '%System') — required for configureEvent; " +
          "also an optional filter for view/purge/export",
      ),
    type: z
      .string()
      .optional()
      .describe(
        "Audit event type (e.g. '%Login') — required for configureEvent; " +
          "also an optional filter for view/purge/export",
      ),
    name: z
      .string()
      .optional()
      .describe("Audit event name — required for configureEvent"),
    enabled: z
      .boolean()
      .optional()
      .describe(
        "Whether to enable (true) or disable (false) the event — required " +
          "for configureEvent",
      ),
    // view / purge / export filters
    begin: z
      .string()
      .optional()
      .describe(
        "Begin datetime filter (YYYY-MM-DD HH:MM:SS) for view/purge/export",
      ),
    end: z
      .string()
      .optional()
      .describe(
        "End datetime filter (YYYY-MM-DD HH:MM:SS) for view/purge/export",
      ),
    user: z
      .string()
      .optional()
      .describe("Username filter for view/purge/export"),
    event: z
      .string()
      .optional()
      .describe("Event name filter for view/purge/export"),
    maxRows: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Max audit records to return for view (default 100, max 1000)"),
    // purge safety
    confirm: z
      .boolean()
      .optional()
      .describe(
        "REQUIRED true for 'purge' — explicit confirmation that audit-log " +
          "records will be permanently deleted",
      ),
    // export
    fileName: z
      .string()
      .optional()
      .describe(
        "Bare output file name (no path separators) for 'export'; the server " +
          "writes it into a fixed audit-export directory and returns the " +
          "resolved location",
      ),
    namespace: z
      .string()
      .optional()
      .describe(
        "Namespace override (auditing is %SYS-scoped; usually omit)",
      ),
    cursor: z
      .string()
      .optional()
      .describe(
        "Pagination cursor from a previous 'view' response's nextCursor field",
      ),
  }),
  annotations: {
    // The tool can mutate AND includes the destructive `purge` action. MCP
    // annotations are tool-scoped; the per-action read/write distinction is
    // realized through `mutates` below.
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
  scope: "SYS",
  // Governance classification (Story 15.0 strict contract): EVERY action key is
  // classified because none are in the frozen Epic-14 baseline. Reads default
  // enabled; writes default DISABLED (opt-in via IRIS_GOVERNANCE).
  mutates: {
    status: "read",
    view: "read",
    enable: "write",
    disable: "write",
    configureEvent: "write",
    purge: "write",
    export: "write",
  },
  handler: async (args, ctx) => {
    const {
      action,
      source,
      type,
      name,
      enabled,
      begin,
      end,
      user,
      event,
      maxRows,
      confirm,
      fileName,
      cursor,
    } = args as {
      action:
        | "status"
        | "enable"
        | "disable"
        | "configureEvent"
        | "view"
        | "purge"
        | "export";
      source?: string;
      type?: string;
      name?: string;
      enabled?: boolean;
      begin?: string;
      end?: string;
      user?: string;
      event?: string;
      maxRows?: number;
      confirm?: boolean;
      fileName?: string;
      cursor?: string;
    };

    const path = `${BASE_URL}/security/audit`;

    try {
      // ── status (GET) ───────────────────────────────────────────
      if (action === "status") {
        const response = await ctx.http.get(path);
        const result = response.result;
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(result, null, 2) },
          ],
          structuredContent: result,
        };
      }

      // ── view (GET, filtered + paginated) ───────────────────────
      if (action === "view") {
        const qs = new URLSearchParams();
        qs.set("action", "view");
        if (begin !== undefined && begin !== "") qs.set("begin", begin);
        if (end !== undefined && end !== "") qs.set("end", end);
        if (user !== undefined && user !== "") qs.set("user", user);
        if (event !== undefined && event !== "") qs.set("event", event);
        if (source !== undefined && source !== "") qs.set("source", source);
        if (type !== undefined && type !== "") qs.set("type", type);
        if (maxRows !== undefined) qs.set("maxRows", String(maxRows));
        const response = await ctx.http.get(`${path}?${qs.toString()}`);
        const rawResult = response.result as {
          events?: Array<Record<string, unknown>>;
        };
        const allEvents = Array.isArray(rawResult?.events)
          ? rawResult.events
          : [];
        const { page, nextCursor } = ctx.paginate(allEvents, cursor);
        const result = {
          events: page,
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

      // ── configureEvent guard (write) ───────────────────────────
      if (action === "configureEvent") {
        if (
          source === undefined ||
          source === "" ||
          type === undefined ||
          type === "" ||
          name === undefined ||
          name === "" ||
          enabled === undefined
        ) {
          return {
            content: [
              {
                type: "text" as const,
                text:
                  "Error: the 'configureEvent' action requires 'source', " +
                  "'type', 'name', and 'enabled'.",
              },
            ],
            isError: true,
          };
        }
      }

      // ── purge guard (destructive, write) ───────────────────────
      if (action === "purge") {
        if (confirm !== true) {
          return {
            content: [
              {
                type: "text" as const,
                text:
                  "Error: 'purge' is destructive and requires confirm:true to " +
                  "proceed.",
              },
            ],
            isError: true,
          };
        }
        // Bounded scope: require at least one MEANINGFUL filter so an unbounded
        // wipe is impossible from this tool. A "*" value is the match-all
        // wildcard, NOT a bound — {confirm:true, source:"*"} (or any
        // wildcard-only scope) must be rejected, otherwise it would purge the
        // entire audit log. begin/end are real (date) bounds when non-empty.
        const isBound = (v: string | undefined): boolean =>
          v !== undefined && v !== "" && v !== "*";
        const hasBound =
          (begin !== undefined && begin !== "") ||
          (end !== undefined && end !== "") ||
          isBound(user) ||
          isBound(event) ||
          isBound(source) ||
          isBound(type);
        if (!hasBound) {
          return {
            content: [
              {
                type: "text" as const,
                text:
                  "Error: 'purge' requires a bounded scope — supply at least " +
                  "one of begin, end, or a non-wildcard user, event, source, " +
                  "or type.",
              },
            ],
            isError: true,
          };
        }
      }

      // ── export guard (write) ───────────────────────────────────
      if (action === "export") {
        if (fileName === undefined || fileName === "") {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: the 'export' action requires a 'fileName'.",
              },
            ],
            isError: true,
          };
        }
        // Defense in depth (the server is authoritative): reject obvious path
        // traversal / separators up front so the caller gets a clear message.
        if (/[\\/]|\.\./.test(fileName)) {
          return {
            content: [
              {
                type: "text" as const,
                text:
                  "Error: 'fileName' must be a bare file name with no path " +
                  "separators or '..' traversal.",
              },
            ],
            isError: true,
          };
        }
      }

      // ── enable / disable / configureEvent / purge / export (POST) ──
      const body: Record<string, unknown> = { action };
      if (action === "configureEvent") {
        body.source = source;
        body.type = type;
        body.name = name;
        body.enabled = enabled;
      } else if (action === "purge") {
        body.confirm = true;
        if (begin !== undefined && begin !== "") body.begin = begin;
        if (end !== undefined && end !== "") body.end = end;
        if (user !== undefined && user !== "") body.user = user;
        if (event !== undefined && event !== "") body.event = event;
        if (source !== undefined && source !== "") body.source = source;
        if (type !== undefined && type !== "") body.type = type;
      } else if (action === "export") {
        body.fileName = fileName;
        if (begin !== undefined && begin !== "") body.begin = begin;
        if (end !== undefined && end !== "") body.end = end;
        if (user !== undefined && user !== "") body.user = user;
        if (event !== undefined && event !== "") body.event = event;
        if (source !== undefined && source !== "") body.source = source;
        if (type !== undefined && type !== "") body.type = type;
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
        return {
          content: [
            {
              type: "text" as const,
              text: `Error performing '${action}' on auditing: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};
