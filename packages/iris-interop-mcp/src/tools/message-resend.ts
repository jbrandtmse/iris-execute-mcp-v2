/**
 * Interoperability message resend / replay tool for the IRIS Interoperability
 * MCP server (Epic 26, Story 26.2).
 *
 * Provides {@link messageResendTool} — `iris_message_resend` — a three-action
 * wrapper over the Story 26.1 REST handlers (`ExecuteMCPv2.REST.MessageResend`):
 *
 * - **preview** (read): resendability verdicts for up to 100 header IDs.
 *   Never mutates. `POST /interop/message/resend/preview`.
 * - **resend** (write): resend up to 100 explicit header IDs via the pinned
 *   `Ens.MessageHeader:ResendDuplicatedMessage` API.
 *   `POST /interop/message/resend` `{action:"resend", ...}`.
 * - **resendFiltered** (write): bounded item/status/time-window scan with a
 *   dry-run-first double gate — executing requires `dryRun:false` AND
 *   `confirm:true` (Epic-20 double-gate pattern).
 *   `POST /interop/message/resend` `{action:"resendFiltered", ...}`.
 *
 * **Governance (Rule #28/#32):** `resend`/`resendFiltered` are truthfully
 * classified `write` and are DEFAULT-DISABLED under tool governance — resend
 * duplicates clinical/business data flow downstream; it is NOT a
 * recovery-of-last-resort like `iris_production_control:clean`, so this tool
 * deliberately does NOT use `defaultEnabled` (spec `04-message-resend.md`
 * preamble). `preview` is a read and is enabled by default.
 *
 * Every dangerous input is rejected by the ObjectScript handler BEFORE any
 * mutation (numeric header IDs, item+from required, ≤7-day window, ≤500
 * match cap, the dryRun/confirm double-gate, production-running precheck);
 * the Zod schema here is defense-in-depth plus good client-facing errors
 * (CR 26.1-1/-3/-5 — see the Dev Agent Record for exactly which deferred
 * Story 26.1 review items this schema closes).
 *
 * **Timestamps (CORRECTED — Story 26.0 AC 26.0.4, NO `horologToIso`):**
 * `Ens.MessageHeader.TimeCreated`/`TimeProcessed` are `Ens.DataType.UTC`
 * (`%TimeStamp`) columns; SQL SELECT already returns an ODBC-formatted
 * string (e.g. `"2026-07-02 10:00:01.298"`), never raw `$HOROLOG` — there is
 * no `horologToIso` helper in this package and none is needed. A small local
 * transform renders ISO-8601 (`" " -> "T"`, append `"Z"`); the original ODBC
 * string is preserved in a sibling `*Raw` field (Rule #11 spirit).
 */

import { IrisApiError, type ToolDefinition } from "@iris-mcp/shared";
import { z } from "zod";

/** Base URL for the custom ExecuteMCPv2 REST service. */
const BASE_URL = "/api/executemcp/v2";

/** `Ens.DataType.MessageStatus` display labels accepted by `resendFiltered`'s `status` filter. */
const STATUS_LABELS = [
  "Created",
  "Queued",
  "Delivered",
  "Discarded",
  "Suspended",
  "Deferred",
  "Aborted",
  "Errored",
  "Completed",
] as const;

/**
 * A single header ID: a numeric string or a number, always a positive
 * integer (CR 26.1-3 — the TS layer rejects a JSON object / non-numeric
 * string before the request ever reaches IRIS).
 */
const headerIdSchema = z.union([
  // `/^[1-9]\d*$/` (not `/^\d+$/`) keeps the string arm symmetric with the
  // number arm's `.positive()`: rejects "0" and leading-zero strings like
  // "007" (which IRIS would otherwise silently coerce to header 7 on the
  // write path) so both arms agree on the "positive integer" contract.
  z.string().regex(/^[1-9]\d*$/, "Header ID must be a positive integer"),
  z.number().int().positive(),
]);

// ── response shapes (ExecuteMCPv2.REST.MessageResend) ──────────────

interface PreviewHeaderRaw {
  id: number;
  found: boolean;
  error?: string;
  sessionId?: number;
  type?: string;
  sourceItem?: string;
  targetItem?: string;
  status?: string;
  isError?: boolean;
  timeCreated?: string;
  timeProcessed?: string;
  bodyClassName?: string;
  bodyClassExists?: boolean;
  correspondingMessageId?: number;
  bodySummary?: string;
  verdict?: string;
  reason?: string;
}

interface PreviewResult {
  headers: PreviewHeaderRaw[];
  count: number;
}

interface ResendItemRaw {
  originalId: number;
  newHeaderId?: number;
  ok: boolean;
  error?: string;
}

interface ResendSummary {
  total: number;
  succeeded: number;
  failed: number;
}

interface ResendResult {
  action: "resend";
  results: ResendItemRaw[];
  summary: ResendSummary;
}

interface SampleRowRaw {
  id: number;
  sourceItem: string;
  targetItem: string;
  status: string;
  timeCreated: string;
  sessionId: number;
}

interface ResendFilteredDryRunResult {
  action: "resendFiltered";
  dryRun: true;
  matchCount: number;
  sample: SampleRowRaw[];
  item: string;
  status: string;
  from: string;
  to: string;
  maxMessages: number;
}

interface ResendFilteredExecutedResult {
  action: "resendFiltered";
  dryRun: false;
  matchCount: number;
  results: ResendItemRaw[];
  summary: ResendSummary;
}

type ResendFilteredResult =
  | ResendFilteredDryRunResult
  | ResendFilteredExecutedResult;

// ── helpers ──────────────────────────────────────────────────────

/**
 * Ensure a value is a record suitable for MCP `structuredContent`.
 * MCP requires structuredContent to be a JSON object (record), not an
 * array (project memory `feedback_mcp_structured_content`). Every response
 * shape this tool handles is already an object, but this guard is kept as
 * defense-in-depth, mirroring the local helper in `iris-data-mcp/docdb.ts`.
 */
function toStructured(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) {
    return { items: value, count: value.length };
  }
  if (value !== null && typeof value === "object") {
    return value as Record<string, unknown>;
  }
  return { value };
}

/**
 * Convert an ODBC timestamp (`"2026-07-02 10:00:01.298"`) to ISO-8601
 * (`"2026-07-02T10:00:01.298Z"`). Passes non-ODBC-shaped or empty values
 * through unchanged; never throws.
 */
function odbcToIso(value: string): string {
  const spaceIdx = value.indexOf(" ");
  if (spaceIdx === -1) return value;
  return `${value.slice(0, spaceIdx)}T${value.slice(spaceIdx + 1)}Z`;
}

/** Map one preview header, adding ISO timestamps + `*Raw` ODBC siblings. */
function mapPreviewHeader(
  h: PreviewHeaderRaw,
): PreviewHeaderRaw & { timeCreatedRaw?: string; timeProcessedRaw?: string } {
  const mapped: PreviewHeaderRaw & {
    timeCreatedRaw?: string;
    timeProcessedRaw?: string;
  } = { ...h };
  if (typeof h.timeCreated === "string" && h.timeCreated.length > 0) {
    mapped.timeCreatedRaw = h.timeCreated;
    mapped.timeCreated = odbcToIso(h.timeCreated);
  }
  if (typeof h.timeProcessed === "string" && h.timeProcessed.length > 0) {
    mapped.timeProcessedRaw = h.timeProcessed;
    mapped.timeProcessed = odbcToIso(h.timeProcessed);
  }
  return mapped;
}

/** Map one resendFiltered dry-run sample row, adding ISO timestamp + `*Raw` ODBC sibling. */
function mapSampleRow(row: SampleRowRaw): SampleRowRaw & { timeCreatedRaw?: string } {
  const mapped: SampleRowRaw & { timeCreatedRaw?: string } = { ...row };
  if (typeof row.timeCreated === "string" && row.timeCreated.length > 0) {
    mapped.timeCreatedRaw = row.timeCreated;
    mapped.timeCreated = odbcToIso(row.timeCreated);
  }
  return mapped;
}

function renderPreviewLine(h: PreviewHeaderRaw): string {
  if (!h.found) return `#${h.id}: NOT FOUND — ${h.error ?? "unknown error"}`;
  const flags: string[] = [];
  if (h.isError) flags.push("isError");
  if (h.bodyClassName && h.bodyClassExists === false) flags.push("body class missing");
  const suffix = flags.length > 0 ? ` [${flags.join(", ")}]` : "";
  return (
    `#${h.id} [${h.verdict ?? "?"}] ${h.type ?? "?"} ${h.sourceItem ?? "?"} -> ` +
    `${h.targetItem ?? "?"} (${h.status ?? "?"})${suffix} — ${h.reason ?? ""}`
  );
}

function renderResendLine(r: ResendItemRaw): string {
  return r.ok
    ? `#${r.originalId} -> new header #${r.newHeaderId}`
    : `#${r.originalId} FAILED: ${r.error ?? "unknown error"}`;
}

/**
 * CR 26.2-1 fallback: a malformed HTTP-200 body (server contract drift) that
 * omits `summary` would otherwise throw a TypeError reading `.succeeded` —
 * mirrors the `?? []` guard already applied to `result.results`/`result.sample`.
 */
const EMPTY_SUMMARY: ResendSummary = { total: 0, succeeded: 0, failed: 0 };

function renderResendSummary(summary: ResendSummary | undefined | null): string {
  const s = summary ?? EMPTY_SUMMARY;
  return `${s.succeeded}/${s.total} succeeded, ${s.failed} failed`;
}

// ── iris_message_resend ─────────────────────────────────────

export const messageResendTool: ToolDefinition = {
  name: "iris_message_resend",
  title: "Resend Interoperability Messages",
  description:
    "Resend / replay Interoperability messages via the pinned " +
    "Ens.MessageHeader:ResendDuplicatedMessage API. Actions:\n\n" +
    "- **preview** (read, enabled by default): per header ID (1-100) — id, " +
    "session, source/target item, status, time, body classname (+ existence " +
    "check), a first-~1KB body summary, and a resendability verdict + reason " +
    "(Request-type Status=Error headers are the correct retry target; " +
    "Response-type error headers are flagged as likely a no-op). Never mutates.\n" +
    "- **resend** (write, DEFAULT-DISABLED): resend up to 100 explicit " +
    "headerIds directly. Per-header result {originalId, newHeaderId?, ok, " +
    "error?}; a bad header does not abort the batch.\n" +
    "- **resendFiltered** (write, DEFAULT-DISABLED): resend messages matching " +
    "item + status (default 'Errored') + a from/to time window (max 7 days). " +
    "DRY-RUN-FIRST WORKFLOW: dryRun defaults to true and returns only the " +
    "match count + first-20 sample, resending NOTHING; executing requires " +
    "BOTH dryRun:false AND confirm:true, otherwise the call is refused with " +
    "no changes made. maxMessages caps the batch (default 100, HARD CAP 500) " +
    "— a match count over the cap is refused (not truncated-and-executed); " +
    "narrow the window or item filter and retry.\n\n" +
    "GOVERNANCE — resend/resendFiltered are default-disabled writes (resend " +
    "duplicates data flow downstream; it is not a last-resort recovery action " +
    "like iris_production_control:clean). Enable via IRIS_GOVERNANCE, e.g.:\n" +
    '{"global": {"iris_message_resend:resend": true, ' +
    '"iris_message_resend:resendFiltered": true}}\n\n' +
    "DUPLICATION HAZARD: resending an already-processed message delivers its " +
    "data again downstream — the target sees a brand-new message, not a " +
    "correction. Always preview first and confirm the message is actually " +
    "worth retrying (e.g. a genuinely failed Request, not a completed one).",
  inputSchema: z.object({
    action: z
      .enum(["preview", "resend", "resendFiltered"])
      .describe("Action to perform: preview (read), resend or resendFiltered (writes, default-disabled)"),
    headerIds: z
      .array(headerIdSchema)
      .min(1)
      .max(100)
      .optional()
      .describe(
        "Header IDs (1-100 numeric values, string or number) — required for " +
          "'preview' and 'resend'. Ignored by 'resendFiltered'.",
      ),
    headOfQueue: z
      .boolean()
      .optional()
      .describe("(resend only) Enqueue the resent message at the head of its target queue (default: false)."),
    item: z
      .string()
      .optional()
      .describe(
        "(resendFiltered, REQUIRED) Config item name — matches either the " +
          "SourceConfigName or TargetConfigName of candidate messages.",
      ),
    status: z
      .enum(STATUS_LABELS)
      .optional()
      .describe("(resendFiltered) Message status filter (default: 'Errored')."),
    from: z
      .string()
      .optional()
      .describe(
        "(resendFiltered, REQUIRED) Window start — ISO-8601 or ODBC timestamp. " +
          "The from/to window may not exceed 7 days.",
      ),
    to: z
      .string()
      .optional()
      .describe("(resendFiltered) Window end — ISO-8601 or ODBC timestamp (default: now)."),
    maxMessages: z
      .number()
      .int()
      .min(1)
      .max(500)
      .optional()
      .describe(
        "(resendFiltered) Cap on matched/resent messages (default: 100, HARD CAP: 500). " +
          "A match count over this cap is refused, not truncated-and-executed.",
      ),
    dryRun: z
      .boolean()
      .optional()
      .describe(
        "(resendFiltered) Default true: return count + a first-20 sample and " +
          "resend NOTHING. Must be explicitly false (with confirm:true) to execute.",
      ),
    confirm: z
      .boolean()
      .optional()
      .describe(
        "(resendFiltered) Must be true together with dryRun:false to execute " +
          "the resend; otherwise the call is refused with no changes made.",
      ),
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
  // Governance classification (Rule #28): every action key is NEW/post-foundation
  // (absent from the frozen governance-baseline.ts), so every action MUST be
  // classified. `resend`/`resendFiltered` are truthfully `write` and are NOT
  // given `defaultEnabled` (Rule #32) — resend duplicates data flow downstream,
  // unlike a recovery-of-last-resort action.
  mutates: {
    preview: "read",
    resend: "write",
    resendFiltered: "write",
  },
  handler: async (args, ctx) => {
    const input = args as {
      action: "preview" | "resend" | "resendFiltered";
      headerIds?: Array<string | number>;
      headOfQueue?: boolean;
      item?: string;
      status?: (typeof STATUS_LABELS)[number];
      from?: string;
      to?: string;
      maxMessages?: number;
      dryRun?: boolean;
      confirm?: boolean;
      namespace?: string;
    };

    const { action, namespace } = input;
    const ns = ctx.resolveNamespace(namespace);

    function validationError(message: string) {
      return {
        content: [{ type: "text" as const, text: message }],
        isError: true,
      };
    }

    try {
      if (action === "preview") {
        if (!input.headerIds || input.headerIds.length === 0) {
          return validationError(
            "'headerIds' is required for action 'preview' (1-100 numeric header IDs).",
          );
        }
        const body = { headerIds: input.headerIds, namespace: ns };
        const response = await ctx.http.post<PreviewResult>(
          `${BASE_URL}/interop/message/resend/preview`,
          body,
        );
        const result = response.result;
        const headers = (result.headers ?? []).map(mapPreviewHeader);
        const text =
          headers.length > 0
            ? headers.map(renderPreviewLine).join("\n")
            : "No headers found.";
        return {
          content: [{ type: "text" as const, text }],
          structuredContent: toStructured({ ...result, headers }),
        };
      }

      if (action === "resend") {
        if (!input.headerIds || input.headerIds.length === 0) {
          return validationError(
            "'headerIds' is required for action 'resend' (1-100 numeric header IDs).",
          );
        }
        const body: Record<string, unknown> = {
          action: "resend",
          headerIds: input.headerIds,
          namespace: ns,
        };
        if (input.headOfQueue !== undefined) body.headOfQueue = input.headOfQueue;

        const response = await ctx.http.post<ResendResult>(
          `${BASE_URL}/interop/message/resend`,
          body,
        );
        const result = response.result;
        const results = result.results ?? [];
        const text = [
          `Resend: ${renderResendSummary(result.summary)}`,
          ...results.map(renderResendLine),
        ].join("\n");
        return {
          content: [{ type: "text" as const, text }],
          structuredContent: toStructured(result),
        };
      }

      // resendFiltered
      if (!input.item) {
        return validationError("'item' is required for action 'resendFiltered'.");
      }
      if (!input.from) {
        return validationError("'from' is required for action 'resendFiltered'.");
      }

      const body: Record<string, unknown> = {
        action: "resendFiltered",
        item: input.item,
        from: input.from,
        namespace: ns,
      };
      if (input.status !== undefined) body.status = input.status;
      if (input.to !== undefined) body.to = input.to;
      if (input.maxMessages !== undefined) body.maxMessages = input.maxMessages;
      if (input.dryRun !== undefined) body.dryRun = input.dryRun;
      if (input.confirm !== undefined) body.confirm = input.confirm;

      const response = await ctx.http.post<ResendFilteredResult>(
        `${BASE_URL}/interop/message/resend`,
        body,
      );
      const result = response.result;

      if (result.dryRun === true) {
        const sample = (result.sample ?? []).map(mapSampleRow);
        const text = [
          `DRY RUN: ${result.matchCount} message(s) match the filter (showing up to ` +
            `${sample.length}); resent NOTHING. Pass dryRun:false and confirm:true to execute.`,
          ...sample.map(
            (row) =>
              `#${row.id} ${row.sourceItem} -> ${row.targetItem} (${row.status}) @ ${row.timeCreated}`,
          ),
        ].join("\n");
        return {
          content: [{ type: "text" as const, text }],
          structuredContent: toStructured({ ...result, sample }),
        };
      }

      const results = result.results ?? [];
      const text = [
        `resendFiltered: ${result.matchCount} matched, ${renderResendSummary(result.summary)}`,
        ...results.map(renderResendLine),
      ].join("\n");
      return {
        content: [{ type: "text" as const, text }],
        structuredContent: toStructured(result),
      };
    } catch (error: unknown) {
      if (error instanceof IrisApiError) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error performing '${action}' on iris_message_resend: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};
