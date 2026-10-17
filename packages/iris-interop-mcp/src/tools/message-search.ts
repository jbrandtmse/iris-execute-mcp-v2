/**
 * Interoperability message search tool for the IRIS Interoperability MCP server (Story 39.1).
 *
 * Provides {@link messageSearchTool} - `iris_message_search` - a read-only search of
 * `Ens.MessageHeader`, over the `ExecuteMCPv2.REST.MessageSearch` route. Its `action` enum is fixed:
 *
 * - **headers** (read): header rows for a required time window, filtered by item, source, target,
 *   status, session, body class and error flag, paged by a keyset cursor. A row never carries body
 *   content, `ErrorStatus` or `Description`.
 * - **body** and **searchTable** (reads): declared now so the governance keys and the preset rows
 *   never change; they answer with the `NOT_IMPLEMENTED` refusal and make no IRIS call.
 *
 * All three keys are reads, so all are enabled by default. Every filter value is matched by equality
 * and bound as a parameter on the IRIS side; this layer validates and normalizes for good client errors.
 *
 * Timestamps in are ISO 8601 with `Z` or an offset and go to IRIS as canonical UTC. Timestamps out are
 * `toISOString()` UTC with a `...Raw` sibling that keeps the stored value.
 */

import { IrisApiError, REFUSAL_CODES, refusalResult, type ToolDefinition } from "@iris-mcp/shared";
import { z } from "zod";
import { STATUS_LABELS } from "./message-resend.js";

/** Base URL for the custom ExecuteMCPv2 REST service. */
const BASE_URL = "/api/executemcp/v2";

/** Rows per page when the caller names no `limit`, and the most a page may hold. */
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

/** The actions that exist now. */
const AVAILABLE_ACTIONS = ["headers"] as const;

// -- Response shapes (ExecuteMCPv2.REST.MessageSearch) ----------------

/** One header row as IRIS returns it: times are the stored UTC strings. */
export interface RawHeaderRow {
  id: number;
  sessionId: number;
  type: string;
  status: string;
  isError: boolean;
  sourceItem: string;
  targetItem: string;
  bodyClassName: string;
  bodyId: string;
  timeCreated: string;
  timeProcessed: string;
  correspondingMessageId: number | null;
}

interface SearchResult {
  action: string;
  interopEnabled: boolean;
  rows: RawHeaderRow[];
  hasMore: boolean;
  limit: number;
  from: string;
  to: string;
}

/**
 * The header-row shape every interoperability search surface shares: UTC ISO 8601 times with a `...Raw`
 * sibling holding the stored value, `""` for a time that is empty or malformed, and `null` for a
 * missing corresponding message.
 */
export interface HeaderRow {
  id: number;
  sessionId: number;
  type: string;
  status: string;
  isError: boolean;
  sourceItem: string;
  targetItem: string;
  bodyClassName: string;
  bodyId: string;
  timeCreated: string;
  timeCreatedRaw: string;
  timeProcessed: string;
  timeProcessedRaw: string;
  correspondingMessageId: number | null;
}

// -- Timestamps -----------------------------------------------------

/** The form IRIS stores an `Ens.DataType.UTC` value in: `yyyy-mm-dd hh:mm:ss`, then an optional fraction. */
const STORED_UTC = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?$/;

/** ISO 8601 with a zone: `Z`, or an offset of `+hh`, `+hhmm` or `+hh:mm`. */
const ISO_WITH_ZONE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}(?::?\d{2})?)$/;

const MIN_YEAR = 1841;
const MAX_YEAR = 9999;

/** Milliseconds from a fraction of a second written as digits: the first three, right-padded with zeros. */
function fractionToMs(fraction: string | undefined): number {
  return fraction === undefined ? 0 : Number(fraction.slice(0, 3).padEnd(3, "0"));
}

/**
 * The epoch milliseconds of a calendar time in UTC, or `undefined` when a component is out of range
 * (month 13, February 30, hour 24, second 60) or the year is outside IRIS's range.
 */
function utcEpoch(parts: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  ms: number;
}): number | undefined {
  const { year, month, day, hour, minute, second, ms } = parts;
  if (year < MIN_YEAR || year > MAX_YEAR) return undefined;
  if (hour > 23 || minute > 59 || second > 59) return undefined;
  const epoch = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  const check = new Date(epoch);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    return undefined;
  }
  return epoch;
}

/**
 * Convert a stored UTC value (`"2001-02-03 08:00:00.5"`) to `toISOString()` form
 * (`"2001-02-03T08:00:00.500Z"`). Strict: returns `""`, never throws, when the value is empty, not a
 * stored UTC timestamp, or not a real date.
 */
export function utcToIso(value: string | null | undefined): string {
  if (typeof value !== "string") return "";
  const match = STORED_UTC.exec(value);
  if (!match) return "";
  const epoch = utcEpoch({
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6]),
    ms: fractionToMs(match[7]),
  });
  return epoch === undefined ? "" : new Date(epoch).toISOString();
}

/** Format epoch milliseconds as canonical UTC: whole seconds, plus `.fff` only when non-zero, trailing zeros trimmed. */
function canonicalFromEpoch(epoch: number): string | undefined {
  const date = new Date(epoch);
  if (Number.isNaN(date.getTime())) return undefined;
  const year = date.getUTCFullYear();
  if (year < MIN_YEAR || year > MAX_YEAR) return undefined;
  const [head, fraction = ""] = date.toISOString().slice(0, -1).split(".");
  const trimmed = fraction.replace(/0+$/, "");
  return trimmed === "" ? `${head}Z` : `${head}.${trimmed}Z`;
}

/**
 * Convert a caller's timestamp to the canonical UTC form sent to IRIS: `yyyy-mm-ddThh:mm:ss`, a
 * fraction only when the millisecond part is non-zero, trailing zeros trimmed, then `Z`.
 *
 * A string must be ISO 8601 with `Z` or an offset; a naive time (no zone) is refused, because it
 * would silently be read in some other zone. A `Date` is taken as the instant it is.
 *
 * @returns The canonical string, or `undefined` when the input is not such a timestamp.
 */
export function toCanonicalUtc(input: string | Date): string | undefined {
  if (input instanceof Date) return canonicalFromEpoch(input.getTime());
  const match = ISO_WITH_ZONE.exec(input.trim());
  if (!match) return undefined;
  const local = utcEpoch({
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: match[6] === undefined ? 0 : Number(match[6]),
    ms: fractionToMs(match[7]),
  });
  if (local === undefined) return undefined;
  const zone = match[8] as string;
  let offsetMinutes = 0;
  if (zone !== "Z") {
    const digits = zone.slice(1).replace(":", "");
    const hours = Number(digits.slice(0, 2));
    const minutes = digits.length > 2 ? Number(digits.slice(2, 4)) : 0;
    if (hours > 23 || minutes > 59) return undefined;
    offsetMinutes = (zone.startsWith("-") ? -1 : 1) * (hours * 60 + minutes);
  }
  return canonicalFromEpoch(local - offsetMinutes * 60000);
}

// -- Rows and cursors ---------------------------------------------------

/** Map one IRIS header row to the shared {@link HeaderRow} shape. Never throws. */
export function mapHeaderRow(raw: RawHeaderRow): HeaderRow {
  const timeCreatedRaw = typeof raw.timeCreated === "string" ? raw.timeCreated : "";
  const timeProcessedRaw = typeof raw.timeProcessed === "string" ? raw.timeProcessed : "";
  return {
    id: raw.id,
    sessionId: raw.sessionId,
    type: raw.type,
    status: raw.status,
    isError: raw.isError === true,
    sourceItem: raw.sourceItem,
    targetItem: raw.targetItem,
    bodyClassName: raw.bodyClassName,
    bodyId: raw.bodyId,
    timeCreated: utcToIso(timeCreatedRaw),
    timeCreatedRaw,
    timeProcessed: utcToIso(timeProcessedRaw),
    timeProcessedRaw,
    correspondingMessageId: typeof raw.correspondingMessageId === "number" ? raw.correspondingMessageId : null,
  };
}

/** The position a page ended at: the last row's stored `TimeCreated` and ID. */
export interface SearchCursor {
  /** The stored `TimeCreated` value of the last row. */
  t: string;
  /** The ID of the last row. */
  id: number;
}

/** Encode a cursor as base64url JSON `{t, id}`. */
export function encodeCursor(cursor: SearchCursor): string {
  return Buffer.from(JSON.stringify({ t: cursor.t, id: cursor.id }), "utf8").toString("base64url");
}

/**
 * Decode a cursor this tool returned. Validated: base64url characters only, a JSON object with a stored
 * UTC `t` that is a real date and a positive safe integer `id`.
 *
 * @returns The cursor, or `undefined` when `value` is not one.
 */
export function decodeCursor(value: string): SearchCursor | undefined {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return undefined;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const { t, id } = parsed as { t?: unknown; id?: unknown };
    if (typeof t !== "string" || utcToIso(t) === "") return undefined;
    if (typeof id !== "number" || !Number.isSafeInteger(id) || id < 1) return undefined;
    return { t, id };
  } catch {
    return undefined;
  }
}

// -- Output -------------------------------------------------------------

/** Ensure a value is a record suitable for MCP `structuredContent`. */
function toStructured(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) return { items: value, count: value.length };
  if (value !== null && typeof value === "object") return value as Record<string, unknown>;
  return { value };
}

function renderRow(row: HeaderRow): string {
  const flag = row.isError ? " [isError]" : "";
  return (
    `#${row.id} ${row.type} ${row.sourceItem} -> ${row.targetItem} (${row.status})${flag} ` +
    `session ${row.sessionId} @ ${row.timeCreated || row.timeCreatedRaw}`
  );
}

// -- iris_message_search --------------------------------------------

export const messageSearchTool: ToolDefinition = {
  name: "iris_message_search",
  title: "Search Interoperability Messages",
  description:
    "Search Interoperability message headers in a required time window. Use it to find messages by " +
    "item, status, session, body class or error flag before reading, diagramming or resending them. " +
    "Returns paged header rows only: id, sessionId, type, status, isError, sourceItem, targetItem, " +
    "bodyClassName, bodyId, UTC times (timeCreated, timeProcessed, each with a ...Raw sibling) and " +
    "correspondingMessageId. A row never carries message body content, error text or descriptions. " +
    "Rows come oldest first; when hasMore is true, pass nextCursor back as cursor for the next page.\n\n" +
    "Actions:\n" +
    "- **headers** (read, enabled by default): search the headers.\n" +
    "- **body** and **searchTable** (reads, enabled by default): not yet available. Calling them " +
    "(with a valid window) returns the NOT_IMPLEMENTED refusal and makes no IRIS call; use headers.\n\n" +
    "Scope: from is required (ISO 8601 with Z or an offset); to defaults to now; the window may span " +
    "at most 7 days. There is no whole-namespace mode. When paging a window close to 7 days wide, " +
    "pass the same from and to on every page, because an omitted to is recomputed as now on each " +
    "call. limit (default 100, max 500) caps the rows returned per page, not the work done: a wide " +
    "window on a busy namespace is scanned in full and can approach the ~60 s Web Gateway timeout, " +
    "so narrow the window or add filters.\n\n" +
    "Filters match by equality, not by pattern (% and _ are ordinary characters), and the name " +
    "filters ignore case: item (the source or the target), source, target, status (Created, " +
    "Queued, Delivered, Discarded, Suspended, Deferred, Aborted, Errored, Completed; rows report " +
    "Errored as Error), sessionId, bodyClass, and errorOnly (the IsError flag, which is separate from " +
    "status Error).\n\n" +
    "A namespace without Interoperability returns notApplicable: true with a reason, not an error.\n\n" +
    "GOVERNANCE - all three actions are reads and enabled by default. An operator can restrict one " +
    'with IRIS_GOVERNANCE, e.g. {"global": {"iris_message_search:headers": false}}.',
  inputSchema: z.object({
    action: z
      .enum(["headers", "body", "searchTable"])
      .describe("Action: headers (search headers). body and searchTable are not yet available (NOT_IMPLEMENTED)."),
    from: z
      .string()
      .min(1)
      .describe("Window start (REQUIRED): ISO 8601 with Z or an offset, e.g. 2026-07-01T10:00:00Z."),
    to: z
      .string()
      .optional()
      .describe("Window end: ISO 8601 with Z or an offset (default: now). At most 7 days after from."),
    item: z.string().max(128).optional().describe("Config item name; matches the source or the target."),
    source: z.string().max(128).optional().describe("Source config item name."),
    target: z.string().max(128).optional().describe("Target config item name."),
    status: z.enum(STATUS_LABELS).optional().describe("Message status filter. Rows report Errored as Error."),
    sessionId: z.number().int().positive().optional().describe("Session ID (a positive integer)."),
    bodyClass: z.string().max(220).optional().describe("Message body class name."),
    errorOnly: z
      .boolean()
      .optional()
      .describe("Only messages whose IsError flag is set (not the same as status Error)."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(MAX_LIMIT)
      .optional()
      .describe(`Rows per page (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}). An output cap, not timeout protection.`),
    cursor: z.string().optional().describe("The nextCursor of the previous page."),
    namespace: z
      .string()
      .optional()
      .describe(
        "Target namespace. Defaults to the server's configured namespace; pass an explicit " +
          "value to operate on a different namespace per call without changing the connection default.",
      ),
  }),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  scope: "NS",
  // Every key is new (absent from the frozen governance baseline), so each is classified. All are
  // reads and default-enabled; none is a write, so none carries defaultEnabled.
  mutates: {
    headers: "read",
    body: "read",
    searchTable: "read",
  },
  handler: async (args, ctx) => {
    const input = args as {
      action: "headers" | "body" | "searchTable";
      from: string;
      to?: string;
      item?: string;
      source?: string;
      target?: string;
      status?: (typeof STATUS_LABELS)[number];
      sessionId?: number;
      bodyClass?: string;
      errorOnly?: boolean;
      limit?: number;
      cursor?: string;
      namespace?: string;
    };

    const { action } = input;

    function validationError(message: string) {
      return {
        content: [{ type: "text" as const, text: message }],
        isError: true,
      };
    }

    const from = toCanonicalUtc(input.from);
    if (from === undefined) {
      return validationError(
        "'from' must be an ISO 8601 timestamp with Z or an offset, for example 2026-07-01T10:00:00Z.",
      );
    }
    let to: string;
    if (input.to === undefined) {
      to = toCanonicalUtc(new Date()) as string;
    } else {
      const converted = toCanonicalUtc(input.to);
      if (converted === undefined) {
        return validationError(
          "'to' must be an ISO 8601 timestamp with Z or an offset, for example 2026-07-01T10:00:00Z.",
        );
      }
      to = converted;
    }

    if (action !== "headers") {
      return refusalResult(
        REFUSAL_CODES.NOT_IMPLEMENTED,
        `The '${action}' action of iris_message_search is not available in this version. ` +
          "Use the 'headers' action.",
        { action, availableActions: [...AVAILABLE_ACTIONS] },
      );
    }

    let cursor: SearchCursor | undefined;
    if (input.cursor !== undefined) {
      cursor = decodeCursor(input.cursor);
      if (cursor === undefined) {
        return validationError(
          "'cursor' is not a cursor this tool returned. Search again without it to start from the first page.",
        );
      }
    }

    const ns = ctx.resolveNamespace(input.namespace);
    const limit = input.limit ?? DEFAULT_LIMIT;
    const body: Record<string, unknown> = { action: "headers", from, to, limit, namespace: ns };
    if (input.item !== undefined) body.item = input.item;
    if (input.source !== undefined) body.source = input.source;
    if (input.target !== undefined) body.target = input.target;
    if (input.status !== undefined) body.status = input.status;
    if (input.sessionId !== undefined) body.sessionId = input.sessionId;
    if (input.bodyClass !== undefined) body.bodyClass = input.bodyClass;
    if (input.errorOnly !== undefined) body.errorOnly = input.errorOnly;
    if (cursor !== undefined) {
      body.afterTimeCreated = cursor.t;
      body.afterId = cursor.id;
    }

    try {
      const response = await ctx.http.post<SearchResult>(`${BASE_URL}/interop/message/search`, body);
      const result = response.result;
      const fromRaw = result.from ?? "";
      const toRaw = result.to ?? "";
      const window = { from: utcToIso(fromRaw), fromRaw, to: utcToIso(toRaw), toRaw };

      if (result.interopEnabled === false) {
        const reason =
          `Interoperability is not configured in namespace '${ns}': it has no message headers to search. ` +
          "Search an Interoperability-enabled namespace.";
        return {
          content: [{ type: "text" as const, text: reason }],
          structuredContent: toStructured({
            action: "headers",
            notApplicable: true,
            reason,
            rows: [],
            hasMore: false,
            limit: result.limit ?? limit,
            ...window,
          }),
        };
      }

      const rows = (result.rows ?? []).map(mapHeaderRow);
      const hasMore = result.hasMore === true;
      const last = rows[rows.length - 1];
      const structured: Record<string, unknown> = {
        action: "headers",
        rows,
        hasMore,
        limit: result.limit ?? limit,
        ...window,
      };
      if (hasMore && last !== undefined) {
        structured.nextCursor = encodeCursor({ t: last.timeCreatedRaw, id: last.id });
      }

      const heading =
        rows.length === 0
          ? "No message headers matched."
          : `${rows.length} message header(s) from ${window.from || fromRaw} to ${window.to || toRaw}` +
            (hasMore ? "; more are available - pass nextCursor as cursor." : ".");
      return {
        content: [{ type: "text" as const, text: [heading, ...rows.map(renderRow)].join("\n") }],
        structuredContent: toStructured(structured),
      };
    } catch (error: unknown) {
      if (error instanceof IrisApiError) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error performing '${action}' on iris_message_search: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};
