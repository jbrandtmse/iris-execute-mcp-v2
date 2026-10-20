/**
 * The catalog of refusal codes: the stable, machine-readable `structuredContent.code` values
 * that a tool or the framework returns when it declines to do something.
 *
 * A refusal is an `isError: true` result that changes nothing. Its `structuredContent.code` is
 * one of the {@link REFUSAL_CODES} values (UPPER_SNAKE_CASE, each value equal to its key), and it
 * carries the fields a caller needs to act on the refusal. A code is added here, never as an
 * inline string at a call site, so the catalog test can prove the codes are unique and well formed
 * and a consumer (the audit interceptor, a client) can match on one source.
 *
 * Refusals that existed before the catalog keep their exact shape; only the code's source moved.
 */

/** Every refusal code, each value equal to its key. */
export const REFUSAL_CODES = {
  /** The governance gate denied the call before the handler ran. */
  GOVERNANCE_DISABLED: "GOVERNANCE_DISABLED",
  /** A whole-document write would drop a Storage definition the class has now. */
  STORAGE_DROPPED: "STORAGE_DROPPED",
  /** A document changed on the server between a tool's read of it and its save. */
  DOCUMENT_CONFLICT: "DOCUMENT_CONFLICT",
  /** An edit's expected text does not match the document now. */
  STALE_CONTENT: "STALE_CONTENT",
  /** Read-only mode refused a statement that is not a query. */
  SQL_READ_ONLY: "SQL_READ_ONLY",
  /** A rows-affected cap refused a statement, before it ran or by rolling it back. */
  SQL_ROWS_AFFECTED_CAP: "SQL_ROWS_AFFECTED_CAP",
  /** The requested action is declared but not available in this version. */
  NOT_IMPLEMENTED: "NOT_IMPLEMENTED",
  /** A data policy withheld the requested body data. */
  DATA_POLICY_BLOCKED: "DATA_POLICY_BLOCKED",
  /** An instance-wide monitor session is active, so a run that needs the monitor was not started. */
  MONITOR_BUSY: "MONITOR_BUSY",
  /** A run that includes %UnitTest.TestProduction tests was not started because a different production runs in the namespace. */
  PRODUCTION_BUSY: "PRODUCTION_BUSY",
  /** The person declined, dismissed or did not tick the confirmation dialog of a gate, so nothing was changed. */
  CONFIRMATION_DECLINED: "CONFIRMATION_DECLINED",
} as const;

/** One of the {@link REFUSAL_CODES} values. */
export type RefusalCode = (typeof REFUSAL_CODES)[keyof typeof REFUSAL_CODES];

/**
 * The shape every refusal result has. A type alias, not an interface, so a refusal is assignable
 * to the MCP SDK's open-ended tool result as well as to {@link ToolResult}.
 */
export type RefusalResult = {
  /** One text block: what happened, and what to do about it. */
  content: Array<{ type: "text"; text: string }>;
  /** `code` first, then the fields a caller needs to act on the refusal. */
  structuredContent: Record<string, unknown> & { code: RefusalCode };
  /** Always `true`. */
  isError: true;
};

/**
 * Build a refusal result.
 *
 * @param code - The refusal's catalog code.
 * @param text - The one text block: `<what happened>. <what to do about it>.`
 * @param fields - The fields placed after `code` in `structuredContent`; a `code` key in
 *   `fields` never replaces the catalog code.
 * @returns `{content: [text], structuredContent: {code, ...fields}, isError: true}`.
 */
export function refusalResult(
  code: RefusalCode,
  text: string,
  fields: Record<string, unknown> = {},
): RefusalResult {
  const structuredContent = { code, ...fields };
  structuredContent.code = code;
  return {
    content: [{ type: "text", text }],
    structuredContent,
    isError: true,
  };
}
