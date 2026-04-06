/**
 * Error class hierarchy for the IRIS MCP suite.
 *
 * Three error types cover every failure category:
 * - {@link IrisConnectionError} &mdash; network / connectivity issues
 * - {@link IrisApiError} &mdash; IRIS HTTP 4xx/5xx responses
 * - {@link McpProtocolError} &mdash; MCP-level protocol errors
 */

/**
 * Thrown when the client cannot reach IRIS (timeout, DNS, network failure).
 *
 * Message format: `{what happened}. {what to do about it}.`
 */
export class IrisConnectionError extends Error {
  /** Machine-readable error code (e.g. "TIMEOUT", "NETWORK_ERROR"). */
  readonly code: string;
  /** Human-readable recovery suggestion. */
  readonly suggestion: string;

  constructor(code: string, message: string, suggestion: string) {
    super(`${message}. ${suggestion}.`);
    this.name = "IrisConnectionError";
    this.code = code;
    this.suggestion = suggestion;
  }
}

/**
 * Thrown when IRIS responds with a 4xx or 5xx status, or when the Atelier
 * envelope contains errors in `status.errors[]`.
 */
export class IrisApiError extends Error {
  /** HTTP status code returned by IRIS. */
  readonly statusCode: number;
  /** Error entries from the Atelier `status.errors` array. */
  readonly errors: unknown[];
  /** Request URL that triggered the error (path only, no credentials). */
  readonly originalUrl: string;

  constructor(
    statusCode: number,
    errors: unknown[],
    originalUrl: string,
    message?: string,
  ) {
    const summary =
      message ??
      `IRIS returned HTTP ${statusCode}. Check the request parameters and try again.`;
    super(summary);
    this.name = "IrisApiError";
    this.statusCode = statusCode;
    this.errors = errors;
    this.originalUrl = originalUrl;
  }
}

/**
 * Thrown for MCP-level protocol violations (unknown tool, malformed arguments).
 */
export class McpProtocolError extends Error {
  /** JSON-RPC error code (e.g. -32602 for invalid params). */
  readonly code: number;

  constructor(code: number, message: string) {
    super(message);
    this.name = "McpProtocolError";
    this.code = code;
  }
}
