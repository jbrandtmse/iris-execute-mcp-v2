/**
 * Interoperability message search tool for the IRIS Interoperability MCP server (Story 39.1).
 *
 * Provides {@link messageSearchTool} - `iris_message_search` - a read-only search of
 * `Ens.MessageHeader`, over the `ExecuteMCPv2.REST.MessageSearch` route. Its `action` enum is fixed:
 *
 * - **headers** (read): header rows for a required time window, filtered by item, source, target,
 *   status, session, body class and error flag, paged by a keyset cursor. A row never carries body
 *   content, `ErrorStatus` or `Description`.
 * - **body** (read, Story 39.3): the same header rows, for the headers whose body satisfies a list of
 *   structured `{property, op, value}` filters over one exact body class. It never returns a body value.
 *   The PHI data policy governs it: under `block` it is refused with `DATA_POLICY_BLOCKED` before any IRIS
 *   call; under `redact` and `allow` it runs.
 * - **searchTable** (read, Story 39.4): the same header rows, for the headers whose body has the Search
 *   Table entries a list of `{property, op, value}` filters asks for, over one exact Search Table class
 *   (for example an HL7 medical record number). It never returns a Search Table value. The data policy
 *   governs it exactly as it governs `body`.
 *
 * All three keys are reads, so all are enabled by default. Every filter value is matched on the IRIS side
 * and bound as a parameter, a filter's property and operator are resolved there too, and this layer
 * validates and normalizes for good client errors only.
 *
 * Timestamps in are ISO 8601 with `Z` or an offset and go to IRIS as canonical UTC. Timestamps out are
 * `toISOString()` UTC with a `...Raw` sibling that keeps the stored value.
 */

import {
  IrisApiError,
  REFUSAL_CODES,
  effectiveDataPolicy,
  refusalResult,
  type DataPolicySummary,
  type ToolDefinition,
} from "@iris-mcp/shared";
import { z } from "zod";
import { STATUS_LABELS } from "./message-resend.js";

/** Base URL for the custom ExecuteMCPv2 REST service. */
const BASE_URL = "/api/executemcp/v2";

/** Rows per page when the caller names no `limit`, and the most a page may hold. */
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

/**
 * The operators of a body or Search Table filter. The IRIS side owns the map from each to its SQL fragment
 * (`ExecuteMCPv2.REST.MessageSearch.BodyOpSql`).
 */
export const BODY_FILTER_OPS = [
  "eq",
  "ne",
  "lt",
  "le",
  "gt",
  "ge",
  "contains",
  "startsWith",
  "isNull",
  "notNull",
] as const;

/** One structured condition on a body property, or on a property of a Search Table class. */
export interface BodyFilter {
  /** The exact, case-sensitive name of a property of the body class or Search Table class. */
  property: string;
  /** The operator. */
  op: (typeof BODY_FILTER_OPS)[number];
  /** The value to compare with; absent for `isNull` and `notNull`. */
  value?: string | number | boolean;
}

/** The most filters one body or Search Table search takes, and the longest string value of one. */
const MAX_BODY_FILTERS = 10;
const MAX_FILTER_VALUE = 1024;

/** The text of the refusal a `block` data policy gives the body action. */
const BODY_BLOCKED_TEXT =
  "The block data policy withholds message body data, and a body search reveals what bodies hold, so " +
  "the body action is refused. Use the headers action, or ask the operator for a looser IRIS_DATA_POLICY " +
  "for this profile.";

/** The text of the refusal a `block` data policy gives the searchTable action. */
const SEARCH_TABLE_BLOCKED_TEXT =
  "The block data policy withholds message body data, and a Search Table lookup reveals values taken from " +
  "message bodies, so the searchTable action is refused. Use the headers action, or ask the operator for a " +
  "looser IRIS_DATA_POLICY for this profile.";

/** What the data-policy line says a body or Search Table result holds. */
const POLICY_LINE_TAIL = {
  body: "the body action returns no body content.",
  searchTable: "the searchTable action returns no Search Table or body values.",
} as const;

/** The note a Search Table result that matched nothing adds: an index holds only what was indexed. */
const SEARCH_TABLE_NO_MATCH_NOTE =
  "A Search Table holds only the messages indexed when they were processed (or by BuildIndex), so no " +
  "match does not prove that no message holds the value.";

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
  /** The searchTable action only: false when the namespace has no Search Table property at all. */
  searchTablesConfigured?: boolean;
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
    "item, status, session, body class or error flag, by what their bodies hold (body action), or by an " +
    "indexed Search Table value such as an HL7 medical record number (searchTable action), " +
    "before reading, diagramming or resending them. " +
    "Returns paged header rows only: id, sessionId, type, status, isError, sourceItem, targetItem, " +
    "bodyClassName, bodyId, UTC times (timeCreated, timeProcessed, each with a ...Raw sibling) and " +
    "correspondingMessageId. A row never carries message body content, error text or descriptions. " +
    "Rows come oldest first; when hasMore is true, pass nextCursor back as cursor for the next page.\n\n" +
    "Actions:\n" +
    "- **headers** (read, enabled by default): search the headers.\n" +
    "- **body** (read, enabled by default): search by body content. It requires bodyClass, the exact " +
    "name of a persistent body class in the namespace (only headers of exactly that class match; " +
    "a subclass is a different class), and filters: 1 to 10 conditions combined with AND, each " +
    "{property, op, value}. property is the exact, case-sensitive name of one property of bodyClass " +
    "(letters and digits; not an SQL column name, not a dotted path). op is eq, ne, lt, le, gt, ge, " +
    "contains, startsWith, isNull or notNull. value is a string of 1 to 1024 characters, a number or a " +
    "boolean; leave it out for isNull and notNull. eq, ne, lt, le, gt, ge and startsWith compare by the " +
    "property's collation, so a default string property ignores case; contains is a case-sensitive " +
    "substring test; % and _ are ordinary characters; ne never matches an empty (null) value. Values are " +
    "compared in IRIS logical form: a date property takes its day number and a time property its seconds " +
    "since midnight, not a formatted string; a timestamp property takes its stored text, such as " +
    "'2001-02-03 08:00:00', not an ISO 8601 'T' form; a number " +
    "is sent in IRIS canonical form (0.5 becomes .5), so give a text property a string. A header whose " +
    "body no longer exists never matches. On EnsLib.HL7.Message, RawContent holds only the first 10,000 " +
    "characters of the message, so a search on it does not see later text. A stream " +
    "property accepts only isNull and notNull. Properties without a column are refused: list and array " +
    "collections, embedded (serial) objects, relationships, multidimensional properties, and transient " +
    "or calculated properties that are not SQL-computed. Everything is validated on the IRIS side and " +
    "every value is bound as a parameter. The result is the header rows of the matching messages, " +
    "plus dataPolicy; it never contains a body value. The body action is under the PHI data policy " +
    "(IRIS_DATA_POLICY, set per profile; default redact): under block it is refused with the " +
    "DATA_POLICY_BLOCKED code and no IRIS call, so use headers or ask the operator for a looser policy; " +
    "under redact and allow it runs. Which headers match still shows what the bodies hold, so an " +
    "operator who does not accept that uses block or restricts the body key.\n" +
    "- **searchTable** (read, enabled by default): find messages by an indexed Search Table value, such as " +
    "the HL7 messages of one medical record number. It requires searchTableClass, the exact name of a " +
    "compiled virtual-document Search Table class in the namespace, such as EnsLib.HL7.SearchTable, and " +
    "filters: 1 to 10 conditions combined with AND, each {property, op, value}, with the same operators and " +
    "value rules as the body action. property is the exact, case-sensitive name of a property that class " +
    "defines or inherits from its Search Table superclasses (not a column name). EnsLib.HL7.SearchTable has " +
    "MSHTypeName (MSH-9 as ADT_A01), MSHControlID (MSH-10), PatientID (PID-2, every PID-3 repetition and " +
    "PID-4: use it for a medical record number), PatientName (PID-5) and PatientAcct (PID-18). A message " +
    "matches eq, lt, le, gt, ge, contains or startsWith when it has at least one non-empty entry for the " +
    "property whose stored value satisfies it, so a multi-valued property such as PatientID matches on any " +
    "of its values. ne matches when the message has no entry equal to the value, not when some entry " +
    "differs. isNull matches when it has no non-empty entry (a message that was never indexed included) and " +
    "notNull when it has at least one. Values are normalized as the Search Table stores them: a default " +
    "property ignores case (give the value in any case); a String:CaseSensitive property such as " +
    "MSHControlID compares exactly; an Integer, Numeric or Boolean property takes only eq, ne, isNull and " +
    "notNull, with its value normalized (0007 is 7), because a range or substring of a stored number is " +
    "meaningless; a | is stored as +; and the Search Table stores each value truncated to 256 characters, " +
    "so a value longer than 256 characters is refused. " +
    "Only headers of the Search Table's document class match (EnsLib.HL7.Message for EnsLib.HL7.SearchTable), " +
    "because its entries are keyed by that class's IDs; bodyClass, when given, must be the exact name of a " +
    "compiled class that is or extends it, and replaces it. Custom search tables (Ens.CustomSearchTable " +
    "subclasses) are not supported. An unknown property is refused with an error that lists the class's " +
    "configured property names. A namespace with no Search Table property returns notApplicable: true. " +
    "A Search Table holds only the messages indexed when they were processed (or rebuilt with BuildIndex), " +
    "so no match does not prove that no message holds the value. Everything is validated on the IRIS side " +
    "and every value is bound as a parameter. The result is the header rows of the matching messages, plus " +
    "dataPolicy; it never contains a Search Table value. The searchTable action is under the PHI data " +
    "policy like body: under block it is refused with the DATA_POLICY_BLOCKED code and no IRIS call; under " +
    "redact and allow it runs. Which headers match still shows what the bodies hold, so an operator who " +
    "does not accept that uses block or restricts the searchTable key.\n\n" +
    "Scope: from is required (ISO 8601 with Z or an offset); to defaults to now; the window may span " +
    "at most 7 days. There is no whole-namespace mode. When paging a window close to 7 days wide, " +
    "pass the same from and to on every page, because an omitted to is recomputed as now on each " +
    "call. limit (default 100, max 500) caps the rows returned per page, not the work done: a wide " +
    "window on a busy namespace is scanned in full and can approach the ~60 s Web Gateway timeout, " +
    "so narrow the window or add filters. The body action reads the headers in the window first and " +
    "each body by its ID, so a body filter does not reduce the work; the searchTable action also reads the " +
    "headers in the window first and probes the Search Table by each header's body ID, so a Search Table " +
    "filter does not reduce that work either.\n\n" +
    "Header filters match by equality, not by pattern (% and _ are ordinary characters), and the name " +
    "filters ignore case: item (the source or the target), source, target, status (Created, " +
    "Queued, Delivered, Discarded, Suspended, Deferred, Aborted, Errored, Completed; rows report " +
    "Errored as Error), sessionId, bodyClass (on the headers action), and errorOnly (the IsError flag, " +
    "which is separate from status Error). The filters parameter belongs to the body and searchTable " +
    "actions only, and searchTableClass to the searchTable action only; the other actions refuse them.\n\n" +
    "A namespace without Interoperability returns notApplicable: true with a reason, not an error.\n\n" +
    "GOVERNANCE - all three actions are reads and enabled by default. An operator can restrict one " +
    'with IRIS_GOVERNANCE, e.g. {"global": {"iris_message_search:headers": false}}; the other keys are ' +
    "iris_message_search:body and iris_message_search:searchTable.",
  inputSchema: z.object({
    action: z
      .enum(["headers", "body", "searchTable"])
      .describe(
        "Action: headers (search headers), body (search by body content; needs bodyClass and filters), " +
          "searchTable (search by an indexed Search Table value; needs searchTableClass and filters).",
      ),
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
    bodyClass: z
      .string()
      .max(220)
      .optional()
      .describe(
        "Message body class name. On headers it filters by class name (ignoring case). On body it is " +
          "REQUIRED: the exact name of a persistent class with an SQL table, such as Ens.StringRequest. " +
          "On searchTable it is optional: the exact name of a compiled class that is or extends the " +
          "Search Table's document class, which it replaces as the header class to match.",
      ),
    searchTableClass: z
      .string()
      .max(220)
      .optional()
      .describe(
        "searchTable action only (REQUIRED there; the other actions refuse it): the exact name of a " +
          "compiled virtual-document Search Table class in the namespace, such as EnsLib.HL7.SearchTable.",
      ),
    filters: z
      .array(
        z.object({
          property: z
            .string()
            .min(1)
            .max(128)
            .regex(/^[A-Za-z][A-Za-z0-9]*$/)
            .describe("The exact, case-sensitive name of one property of bodyClass (or of searchTableClass)."),
          op: z.enum(BODY_FILTER_OPS).describe("The operator."),
          value: z
            .union([z.string().min(1).max(MAX_FILTER_VALUE), z.number(), z.boolean()])
            .optional()
            .describe("The value to compare with (required except for isNull and notNull)."),
        }),
      )
      .min(1)
      .max(MAX_BODY_FILTERS)
      .optional()
      .describe(
        "body and searchTable actions only (REQUIRED there; the headers action refuses it): 1 to 10 " +
          "conditions on body properties (body) or Search Table properties (searchTable), combined with " +
          "AND. Each is {property, op, value}.",
      ),
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
  // The PHI data policy governs the body and searchTable actions (Stories 39.3 and 39.4, AD-26): a body
  // search and a Search Table lookup reveal what bodies hold. `filters` carries the search values, so the
  // audit log redacts it under redact and block.
  dataPolicy: { actions: ["body", "searchTable"], phiInputs: ["filters"] },
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
      searchTableClass?: string;
      filters?: BodyFilter[];
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

    if (action === "headers" && input.filters !== undefined) {
      return validationError("'filters' applies only to the body and searchTable actions.");
    }
    if (action !== "searchTable" && input.searchTableClass !== undefined) {
      return validationError("'searchTableClass' applies only to the searchTable action.");
    }

    // The PHI data policy of the call's profile (Stories 39.3 and 39.4, AD-26). A body search and a Search
    // Table lookup reveal what bodies hold, so `block` refuses them after the window parse and the action
    // checks, before every other check of the action and before any IRIS call.
    const policy = effectiveDataPolicy(ctx.config);
    if (policy === "block" && (action === "body" || action === "searchTable")) {
      return refusalResult(
        REFUSAL_CODES.DATA_POLICY_BLOCKED,
        action === "body" ? BODY_BLOCKED_TEXT : SEARCH_TABLE_BLOCKED_TEXT,
        { action, policy: "block" },
      );
    }

    if (action === "body") {
      if (input.bodyClass === undefined || input.bodyClass === "") {
        return validationError("'bodyClass' is required for the body action: the exact name of the body class.");
      }
    }
    if (action === "searchTable") {
      if (input.searchTableClass === undefined || input.searchTableClass === "") {
        return validationError(
          "'searchTableClass' is required for the searchTable action: the exact name of a Search Table class, " +
            "such as EnsLib.HL7.SearchTable.",
        );
      }
    }
    if (action === "body" || action === "searchTable") {
      if (input.filters === undefined || input.filters.length === 0) {
        return validationError(
          action === "body"
            ? `'filters' is required for the body action: 1 to ${MAX_BODY_FILTERS} {property, op, value} conditions.`
            : `'filters' is required for the searchTable action: 1 to ${MAX_BODY_FILTERS} {property, op, value} ` +
                "conditions on its Search Table properties.",
        );
      }
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
    const body: Record<string, unknown> = { action, from, to, limit, namespace: ns };
    if (input.item !== undefined) body.item = input.item;
    if (input.source !== undefined) body.source = input.source;
    if (input.target !== undefined) body.target = input.target;
    if (input.status !== undefined) body.status = input.status;
    if (input.sessionId !== undefined) body.sessionId = input.sessionId;
    if (input.bodyClass !== undefined) body.bodyClass = input.bodyClass;
    if (action === "searchTable") body.searchTableClass = input.searchTableClass;
    if (action === "body" || action === "searchTable") body.filters = input.filters;
    if (input.errorOnly !== undefined) body.errorOnly = input.errorOnly;
    if (cursor !== undefined) {
      body.afterTimeCreated = cursor.t;
      body.afterId = cursor.id;
    }

    // What the policy did over a body search or a Search Table lookup: it returns header rows only, so
    // nothing is redacted or withheld. The headers action carries no such field.
    const dataPolicy: DataPolicySummary | undefined =
      action === "headers" ? undefined : { policy, redacted: 0, blocked: 0 };
    const policyLine =
      action === "headers" || dataPolicy === undefined
        ? []
        : [`Data policy ${dataPolicy.policy}: header rows only; ${POLICY_LINE_TAIL[action]}`];

    try {
      const response = await ctx.http.post<SearchResult>(`${BASE_URL}/interop/message/search`, body);
      const result = response.result;
      const fromRaw = result.from ?? "";
      const toRaw = result.to ?? "";
      const window = { from: utcToIso(fromRaw), fromRaw, to: utcToIso(toRaw), toRaw };

      const notApplicable = (reason: string) => ({
        content: [{ type: "text" as const, text: [reason, ...policyLine].join("\n") }],
        structuredContent: toStructured({
          action,
          notApplicable: true,
          reason,
          rows: [],
          hasMore: false,
          limit: result.limit ?? limit,
          ...window,
          ...(dataPolicy !== undefined ? { dataPolicy } : {}),
        }),
      });

      if (result.interopEnabled === false) {
        return notApplicable(
          `Interoperability is not configured in namespace '${ns}': it has no message headers to search. ` +
            "Search an Interoperability-enabled namespace.",
        );
      }
      if (action === "searchTable" && result.searchTablesConfigured === false) {
        return notApplicable(
          `No Search Table is configured in namespace '${ns}': it has no Search Table properties ` +
            "(Ens.Config.SearchTableProp is empty), so there is nothing to look up. Compile or deploy a " +
            "Search Table class there, or use the headers or body action.",
        );
      }

      const rows = (result.rows ?? []).map(mapHeaderRow);
      const hasMore = result.hasMore === true;
      const last = rows[rows.length - 1];
      const structured: Record<string, unknown> = {
        action,
        rows,
        hasMore,
        limit: result.limit ?? limit,
        ...window,
      };
      if (hasMore && last !== undefined) {
        structured.nextCursor = encodeCursor({ t: last.timeCreatedRaw, id: last.id });
      }
      if (dataPolicy !== undefined) structured.dataPolicy = dataPolicy;

      const heading =
        rows.length === 0
          ? ["No message headers matched.", ...(action === "searchTable" ? [SEARCH_TABLE_NO_MATCH_NOTE] : [])].join(" ")
          : `${rows.length} message header(s) from ${window.from || fromRaw} to ${window.to || toRaw}` +
            (hasMore ? "; more are available - pass nextCursor as cursor." : ".");
      return {
        content: [{ type: "text" as const, text: [heading, ...rows.map(renderRow), ...policyLine].join("\n") }],
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
