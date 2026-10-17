/**
 * Interoperability message body reader for the IRIS Interoperability MCP server (Story 39.5).
 *
 * Provides {@link messageBodyTool} - `iris_message_body` - a read of the bodies of 1 to 20 message headers,
 * over the `ExecuteMCPv2.REST.MessageBody` route. It is the first consumer of the PHI data policy's body
 * text (AD-26): the policy is applied here, per body, to text IRIS has read whole.
 *
 * - **What IRIS reads.** The request names which bodies IRIS may read at all (`bodyRead`), from the policy:
 *   `block` reads none, `redact` reads HL7 v2 only (complete, never cut), `allow` reads every renderable kind.
 *   So under `redact` the content of no other body leaves IRIS, and the drop rules below are a second line.
 * - **What this layer does.** HL7 v2 text goes complete and unsanitized through `redactHl7`; sanitization and
 *   truncation come after redaction. Every other kind is withheld under `redact`, and every body under
 *   `block`, each with one of the fixed block reasons. A caller `dataPolicy` can only tighten the operator's
 *   policy.
 *
 * The tool is a read, enabled by default, one governance key.
 */

import {
  BLOCK_REASONS,
  DATA_POLICIES,
  HL7_BODY_TEXT_MAX_CHARS,
  IrisApiError,
  decideBodyPolicy,
  effectiveDataPolicy,
  isBodyKind,
  redactHl7,
  tightenDataPolicy,
  type BodyKind,
  type BodyPolicyOutcome,
  type DataPolicy,
  type DataPolicySummary,
  type ToolDefinition,
} from "@iris-mcp/shared";
import { z } from "zod";
import { headerIdSchema } from "./message-resend.js";

/** Base URL for the custom ExecuteMCPv2 REST service. */
const BASE_URL = "/api/executemcp/v2";

/** The most header IDs one call reads. */
const MAX_HEADER_IDS = 20;

/** The `maxChars` default, and the most it may be (the route's own `bodyTextMaxChars` limit). */
const DEFAULT_MAX_CHARS = 10000;
const MAX_MAX_CHARS = 1048576;

// -- The wire ---------------------------------------------------------

/** Which bodies the route may read: none (`kind`), HL7 v2 only (`hl7`) or every renderable kind (`all`). */
export type BodyReadMode = "kind" | "hl7" | "all";

/** The two fields of a body request that the policy decides. */
export interface BodyReadWire {
  bodyRead: BodyReadMode;
  bodyTextMaxChars: number;
}

/**
 * The route fields for a policy, both always sent (the documented defaults are explicit on the wire):
 * `block` reads no body, `redact` reads HL7 v2 bodies up to {@link HL7_BODY_TEXT_MAX_CHARS} characters, and
 * `allow` reads every renderable kind with a limit of `max(maxChars, 65536)`, so that a caller can raise
 * `maxChars` to read a longer HL7 v2 body whole.
 *
 * @param policy - The policy that applies to the call.
 * @param maxChars - The caller's output cap.
 */
export function bodyReadWire(policy: DataPolicy, maxChars: number): BodyReadWire {
  if (policy === "block") return { bodyRead: "kind", bodyTextMaxChars: HL7_BODY_TEXT_MAX_CHARS };
  if (policy === "redact") return { bodyRead: "hl7", bodyTextMaxChars: HL7_BODY_TEXT_MAX_CHARS };
  return { bodyRead: "all", bodyTextMaxChars: Math.max(maxChars, HL7_BODY_TEXT_MAX_CHARS) };
}

// -- Response shapes (ExecuteMCPv2.REST.MessageBody) --------------------

/** One item as IRIS returns it. Only these fields are ever read. */
export interface BodyReaderRawItem {
  id: number;
  found: boolean;
  error?: string;
  bodyClassName?: string;
  bodyId?: string | number;
  bodyKind?: string;
  bodyAvailable?: boolean;
  bodyText?: string;
  bodyTextComplete?: boolean;
  bodyTextOmitted?: string;
}

interface BodyResult {
  interopEnabled: boolean;
  items: BodyReaderRawItem[];
  count: number;
}

/** How a shown text is written. */
export type BodyFormat = "er7" | "xml" | "json" | "text";

/** An item of the tool's result for a header that was found. */
export interface BodyReaderFoundItem {
  id: number;
  found: true;
  bodyClassName: string;
  bodyId: string;
  bodyKind: BodyKind;
  bodyPolicy: BodyPolicyOutcome;
  /** With `text` and `truncated`, when the body is shown. */
  format?: BodyFormat;
  text?: string;
  truncated?: boolean;
  /** The fixed reason, when the body is not shown. */
  notShown?: string;
}

/** An item for a header that does not exist or could not be read. */
export interface BodyReaderMissingItem {
  id: number;
  found: false;
  error: string;
}

export type BodyReaderItem = BodyReaderFoundItem | BodyReaderMissingItem;

// -- Text -------------------------------------------------------------

/**
 * Make a body text safe to carry in a result: CRLF and a lone CR become LF (an ER7 segment is one line), and
 * every other C0 control character except TAB and LF, and DEL, becomes U+FFFD.
 */
export function sanitizeBodyText(text: string): string {
  return (
    text
      .replace(/\r\n|\r/g, "\n")
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "\uFFFD")
  );
}

/**
 * Cut `text` to at most `maxChars` UTF-16 code units, never between the two halves of a surrogate pair (the
 * cut then ends one unit earlier). `truncated` is `true` when anything was cut.
 */
export function cutText(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  let end = maxChars;
  const last = end > 0 ? text.charCodeAt(end - 1) : 0;
  const next = text.charCodeAt(end);
  if (last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) end -= 1;
  return { text: text.slice(0, end), truncated: true };
}

/** The format a kind's text is shown in; a kind with no renderer has none. */
const FORMATS: Partial<Record<BodyKind, BodyFormat>> = {
  hl7v2: "er7",
  xmlvdoc: "xml",
  persistent: "json",
  stream: "text",
  streamContainer: "text",
  literal: "text",
};

/** The fixed reasons a body is not shown for a cause other than the policy. They hold no body content. */
const NOT_SHOWN = {
  missing: "The body class is not compiled in this namespace, so the body cannot be read.",
  unavailable: "The body does not open (it may have been purged), so it cannot be read.",
  noRenderer: (kind: BodyKind): string => `No renderer reads a ${kind} body, so only its class and ID are shown.`,
  tooLarge: (cap: number): string =>
    `The HL7 v2 body is longer than ${cap} characters, so it is not shown; a larger maxChars (at most ${MAX_MAX_CHARS}) reads it whole.`,
  unreadable: "The body could not be read.",
} as const;

// -- The policy ---------------------------------------------------------

/**
 * Apply the PHI data policy to the items of a body read, and shape them for the result.
 *
 * Each field of an item is read by name, from the ten the route returns (`id`, `found`, `error`,
 * `bodyClassName`, `bodyId`, `bodyKind`, `bodyAvailable`, `bodyText`, `bodyTextComplete`, `bodyTextOmitted`);
 * nothing else IRIS sends reaches the result. A found item is decided by {@link decideBodyPolicy}, with
 * the kind from `bodyKind` (a value outside the nine tokens is kind `other`, and is treated as available, so
 * `block` and `redact` withhold it) and `available` true when `bodyAvailable` is `true` or the kind is `literal`
 * (a literal header's value is its own body):
 *  - `blocked`: withheld with the plan's reason; any `bodyText` IRIS sent is dropped, and so is the `bodyId`
 *    of a literal header;
 *  - `redact` (an HL7 v2 body under `redact`): its complete `bodyText` goes to `redactHl7` before anything
 *    else touches it. An `ok` result is `redacted` with the redacted text; a refusal is `blocked` with
 *    `hl7Unparseable(<engine reason>)`; `bodyTextOmitted: "tooLarge"` is `hl7TooLarge`; anything else,
 *    including a text IRIS reports as incomplete, is `hl7Unreadable`;
 *  - `none`: an unavailable body is not shown (`missing` or does-not-open); under `allow`, the text IRIS
 *    sent is shown in the format of the kind, or the reason it was not read is given.
 * A shown text is sanitized and then cut to `maxChars`; `truncated` is set when it was cut or IRIS reported
 * `bodyTextComplete: false`.
 *
 * @param items - The route's items, in request order.
 * @param policy - The policy that applies to the call (already tightened).
 * @param maxChars - The caller's output cap per body.
 * @returns The shaped items and what the policy did over them.
 */
export function applyBodyReaderPolicy(
  items: readonly BodyReaderRawItem[],
  policy: DataPolicy,
  maxChars: number,
): { items: BodyReaderItem[]; summary: DataPolicySummary } {
  let redacted = 0;
  let blocked = 0;
  const readCap = bodyReadWire(policy, maxChars).bodyTextMaxChars;

  const shape = (raw: BodyReaderRawItem): BodyReaderItem => {
    if (raw.found !== true) {
      return {
        id: raw.id,
        found: false,
        error: typeof raw.error === "string" ? raw.error : `Header ${raw.id} could not be read.`,
      };
    }
    const knownKind = isBodyKind(raw.bodyKind);
    const kind: BodyKind = isBodyKind(raw.bodyKind) ? raw.bodyKind : "other";
    const available = knownKind ? raw.bodyAvailable === true || kind === "literal" : true;
    const plan = decideBodyPolicy(kind, available, policy);
    const base = {
      id: raw.id,
      found: true as const,
      bodyClassName: typeof raw.bodyClassName === "string" ? raw.bodyClassName : "",
      bodyId: kind === "literal" && policy !== "allow" ? "" : String(raw.bodyId ?? ""),
      bodyKind: kind,
    };

    const withheld = (reason: string): BodyReaderFoundItem => {
      blocked += 1;
      return { ...base, bodyPolicy: { outcome: "blocked", reason }, notShown: reason };
    };
    const shown = (text: string, outcome: BodyPolicyOutcome, alsoCut: boolean): BodyReaderFoundItem => {
      const cut = cutText(sanitizeBodyText(text), maxChars);
      return {
        ...base,
        bodyPolicy: outcome,
        format: FORMATS[kind] as BodyFormat,
        text: cut.text,
        truncated: cut.truncated || alsoCut,
      };
    };

    if (plan.outcome === "blocked") return withheld(plan.reason);

    if (plan.outcome === "redact") {
      if (typeof raw.bodyText === "string" && raw.bodyTextComplete !== false) {
        const result = redactHl7(raw.bodyText);
        if (!result.ok) return withheld(BLOCK_REASONS.hl7Unparseable(result.reason));
        redacted += 1;
        return shown(result.text, { outcome: "redacted", redactedFields: result.redactedFields }, false);
      }
      if (raw.bodyTextOmitted === "tooLarge") return withheld(BLOCK_REASONS.hl7TooLarge());
      return withheld(BLOCK_REASONS.hl7Unreadable());
    }

    // The policy leaves this body alone: it is not available, or the policy is allow.
    const none: BodyPolicyOutcome = { outcome: "none" };
    if (!available) {
      return { ...base, bodyPolicy: none, notShown: kind === "missing" ? NOT_SHOWN.missing : NOT_SHOWN.unavailable };
    }
    if (typeof raw.bodyText === "string" && FORMATS[kind] !== undefined) {
      return shown(raw.bodyText, none, raw.bodyTextComplete === false);
    }
    if (raw.bodyTextOmitted === "tooLarge" && kind === "hl7v2") {
      return { ...base, bodyPolicy: none, notShown: NOT_SHOWN.tooLarge(readCap) };
    }
    if (raw.bodyTextOmitted === "noRenderer" || FORMATS[kind] === undefined) {
      return { ...base, bodyPolicy: none, notShown: NOT_SHOWN.noRenderer(kind) };
    }
    return { ...base, bodyPolicy: none, notShown: NOT_SHOWN.unreadable };
  };

  const shaped = items.map(shape);
  return { items: shaped, summary: { policy, redacted, blocked } };
}

// -- Output -------------------------------------------------------------

/** The content lines of one item: a heading, then its text or the reason it is not shown. */
function renderItem(item: BodyReaderItem): string[] {
  if (!item.found) return [`#${item.id}: ${item.error}`];
  return [
    `#${item.id} ${item.bodyClassName} [${item.bodyKind}] ${item.bodyPolicy.outcome}`,
    item.text !== undefined ? item.text : (item.notShown ?? ""),
  ];
}

const policyLine = (summary: DataPolicySummary): string =>
  `Data policy ${summary.policy}: ${summary.redacted} redacted, ${summary.blocked} withheld.`;

const clampLine = (requested: DataPolicy, applied: DataPolicy): string =>
  `The requested data policy ${requested} is looser than the profile's ${applied}, so ${applied} applies.`;

// -- iris_message_body -----------------------------------------------------

export const messageBodyTool: ToolDefinition = {
  name: "iris_message_body",
  title: "Read Interoperability Message Bodies",
  description:
    "Read the bodies of 1 to 20 Interoperability messages by header ID, such as the ids " +
    "iris_message_search returns: use it after a search to see what a message carried. Returns one item per " +
    "ID, in request order (a repeated ID gives a repeated item): the body class and ID, the body kind and " +
    "the body rendered by kind. An HL7 v2 body is shown as ER7 text (format er7). An XML virtual document " +
    "is shown as XML (xml). A persistent object is shown as JSON (json): its JSON export when its class " +
    "extends %JSON.Adaptor, otherwise a dump of its public properties, where a stream is its class and " +
    "size only and a list or array is its count. A stream or a stream container is shown as text (text), " +
    "and so is the value of a header with no body class. Any other body (another virtual document such as " +
    "X12 or EDIFACT, a class that is not compiled, a body that no longer opens) is shown as its class and " +
    "ID with a reason in notShown. A header that does not exist is {id, found: false, error}.\n\n" +
    "maxChars (default 10000, max 1048576) caps the text shown per body: a longer text is cut, with " +
    "truncated: true. It caps the output only. An XML or JSON body is serialized whole before it is cut. An " +
    "HL7 v2 body is read only whole: IRIS never cuts one, so a body longer than 65536 characters is not " +
    "shown, and under the allow policy a larger maxChars (at most 1048576) reads a longer one.\n\n" +
    "PHI data policy (IRIS_DATA_POLICY, set per profile; default redact). block withholds every body. " +
    "redact shows an HL7 v2 body only after a reviewed keep-list redaction (a field nobody reviewed is " +
    "replaced by ***), complete or not at all, and withholds every other kind of body and any HL7 v2 body " +
    "longer than 65536 characters, each with a reason in notShown; the content of a withheld body is never " +
    "read out of IRIS. allow shows bodies as stored. dataPolicy can only tighten the profile's policy: a " +
    "looser value is ignored and dataPolicyClamped: true says so. Each body carries bodyPolicy (redacted, " +
    "blocked or none) and the result carries dataPolicy {policy, redacted, blocked} with the counts. The " +
    "policy reduces exposure; it is not a compliance certification. Text is sanitized after redaction: CR " +
    "and CRLF become LF and other C0 control characters and DEL are replaced by U+FFFD.\n\n" +
    "A namespace without Interoperability returns notApplicable: true with a reason, not an error.\n\n" +
    "GOVERNANCE - a read, enabled by default (and enabled under the read-only preset). An operator can " +
    'restrict it with IRIS_GOVERNANCE, e.g. {"global": {"iris_message_body": false}}.',
  inputSchema: z.object({
    headerIds: z
      .array(headerIdSchema)
      .min(1)
      .max(MAX_HEADER_IDS)
      .describe(
        `Header IDs to read (1-${MAX_HEADER_IDS} positive integers, number or string of digits), such as the ` +
          "id values iris_message_search returns.",
      ),
    maxChars: z
      .number()
      .int()
      .min(1)
      .max(MAX_MAX_CHARS)
      .optional()
      .describe(
        `Most characters of text shown per body (default ${DEFAULT_MAX_CHARS}, max ${MAX_MAX_CHARS}). An ` +
          "output cap: the body is read whole first (HL7 v2) or serialized whole (XML, JSON). Under allow it " +
          "also raises the HL7 v2 read limit above 65536.",
      ),
    dataPolicy: z
      .enum(DATA_POLICIES)
      .optional()
      .describe(
        "A data policy for this call: block, redact or allow. It can only tighten the profile's policy; a " +
          "looser one is ignored and reported as dataPolicyClamped.",
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
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  scope: "NS",
  // One key, new (absent from the frozen governance baseline), so it is classified. It is a read, so it is
  // enabled by default and stays enabled under the read-only preset.
  mutates: "read",
  // The PHI data policy governs every call (Story 39.5, AD-26): it returns message-body text. A single key
  // has no actions to list, and its inputs (header IDs, a policy name, a cap) carry no PHI, so no
  // `phiInputs`. The audit entry carries `dataPolicy` from the response's own counts.
  dataPolicy: {},
  handler: async (args, ctx) => {
    const input = args as {
      headerIds: Array<string | number>;
      maxChars?: number;
      dataPolicy?: DataPolicy;
      namespace?: string;
    };

    // The policy of the call's profile, read on every call (AD-9, AD-3); a caller's value only tightens it.
    const tightened = tightenDataPolicy(effectiveDataPolicy(ctx.config), input.dataPolicy);
    const policy = tightened.policy;
    const maxChars = input.maxChars ?? DEFAULT_MAX_CHARS;
    const wire = bodyReadWire(policy, maxChars);
    const ns = ctx.resolveNamespace(input.namespace);

    const clamp =
      tightened.clamped && input.dataPolicy !== undefined ? [clampLine(input.dataPolicy, policy)] : [];
    const clampFlag = tightened.clamped ? { dataPolicyClamped: true } : {};

    try {
      const response = await ctx.http.post<BodyResult>(`${BASE_URL}/interop/message/body`, {
        headerIds: input.headerIds,
        namespace: ns,
        bodyRead: wire.bodyRead,
        bodyTextMaxChars: wire.bodyTextMaxChars,
      });
      const result = response.result;

      if (result.interopEnabled === false) {
        const reason =
          `Interoperability is not configured in namespace '${ns}': it has no message headers to read. ` +
          "Read an Interoperability-enabled namespace.";
        const summary: DataPolicySummary = { policy, redacted: 0, blocked: 0 };
        return {
          content: [{ type: "text" as const, text: [reason, policyLine(summary), ...clamp].join("\n") }],
          structuredContent: {
            notApplicable: true,
            reason,
            items: [],
            count: 0,
            maxChars,
            dataPolicy: summary,
            ...clampFlag,
          },
        };
      }

      const governed = applyBodyReaderPolicy(result.items ?? [], policy, maxChars);
      const lines = [
        ...governed.items.flatMap(renderItem),
        policyLine(governed.summary),
        ...clamp,
      ];
      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
        structuredContent: {
          items: governed.items,
          count: governed.items.length,
          maxChars,
          dataPolicy: governed.summary,
          ...clampFlag,
        },
      };
    } catch (error: unknown) {
      if (error instanceof IrisApiError) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error reading message bodies with iris_message_body: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};
