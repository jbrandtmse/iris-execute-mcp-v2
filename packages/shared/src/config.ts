/**
 * IRIS connection configuration and environment variable loader.
 *
 * Reads connection parameters from environment variables and produces
 * a validated {@link IrisConnectionConfig} object.
 */

/** Configuration required to connect to an IRIS instance over HTTP. */
export interface IrisConnectionConfig {
  /** Hostname or IP of the IRIS server. */
  host: string;
  /** Web server port. */
  port: number;
  /** IRIS username for authentication. */
  username: string;
  /** IRIS password for authentication. */
  password: string;
  /** Target namespace. */
  namespace: string;
  /** Whether to use HTTPS. */
  https: boolean;
  /**
   * `Accept-Language` header value sent on every request (`IRIS_ACCEPT_LANGUAGE`,
   * default {@link DEFAULT_ACCEPT_LANGUAGE}). Pins IRIS's request-locale
   * negotiation so `%Status` error text renders in a predictable language
   * instead of whatever locale an unspecified header resolves to (Story
   * 35.3). {@link loadConfig} always sets this explicitly (Rule #10 — send
   * documented defaults explicitly on the wire); optional here (Rule #19
   * conditional-field idiom, same as `sqlMaxRows`/`sqlTimeoutMs`) only so
   * hand-built config literals elsewhere (tests, ad-hoc registries) keep
   * compiling unchanged. {@link IrisHttpClient} falls back to
   * {@link DEFAULT_ACCEPT_LANGUAGE} when a config omits it, so the header is
   * still sent on every request regardless.
   */
  acceptLanguage?: string;
  /** Computed base URL (`http(s)://host:port`). */
  baseUrl: string;
  /** Default HTTP request timeout in milliseconds. */
  timeout: number;
  /**
   * Optional operator-set hard cap on `iris_sql_execute`'s effective row
   * limit (`IRIS_SQL_MAX_ROWS`). `undefined` when unset — no cap applied
   * (today's behavior).
   */
  sqlMaxRows?: number;
  /**
   * Optional operator-set per-request timeout (in milliseconds, pre-converted
   * from the `IRIS_SQL_TIMEOUT` env var which is specified in seconds) for
   * `iris_sql_execute`'s HTTP call. `undefined` when unset — no per-request
   * timeout override is passed (today's behavior).
   */
  sqlTimeoutMs?: number;
  /**
   * Optional operator-set DEFAULT wait budget (in milliseconds, pre-converted
   * from the `IRIS_TEST_TIMEOUT` env var which is specified in seconds) for
   * `iris_execute_tests`'s poll loop (Story 36.1 AC 36.1.4). Sits BELOW an
   * explicit per-call `timeout` argument and ABOVE the tool's own hard-coded
   * 120-second default in the resolution order (`timeout` arg > this >
   * 120s). `undefined` when unset — the tool's 120-second default applies
   * unchanged (today's behavior).
   */
  testTimeoutMs?: number;
}

/**
 * Default `Accept-Language` header value (Story 35.3) — English, matching
 * the instance's own `enuw` locale in the common case. Exported so
 * {@link IrisHttpClient} can fall back to the same documented default when a
 * hand-built config omits `acceptLanguage`, without duplicating the literal.
 */
export const DEFAULT_ACCEPT_LANGUAGE = "en-US,en;q=0.9";

/**
 * Load IRIS connection configuration from environment variables.
 *
 * | Variable          | Default      |
 * |-------------------|--------------|
 * | IRIS_HOST         | localhost    |
 * | IRIS_PORT         | 52773        |
 * | IRIS_USERNAME     | *(required)* |
 * | IRIS_PASSWORD     | *(required)* |
 * | IRIS_NAMESPACE    | HSCUSTOM     |
 * | IRIS_HTTPS        | false        |
 * | IRIS_TIMEOUT      | 60000        |
 * | IRIS_SQL_MAX_ROWS | *(unset — no cap)*  |
 * | IRIS_SQL_TIMEOUT  | *(unset — no per-request override)*, seconds |
 * | IRIS_TEST_TIMEOUT | *(unset — `iris_execute_tests` keeps its 120s default)*, seconds |
 * | IRIS_ACCEPT_LANGUAGE | `en-US,en;q=0.9` |
 *
 * @throws {Error} When IRIS_USERNAME or IRIS_PASSWORD is not set.
 * @throws {Error} When IRIS_ACCEPT_LANGUAGE is set to a value that is not a
 *   valid HTTP header field-value (non-printable-ASCII, CR, or LF).
 * @throws {Error} When IRIS_SQL_MAX_ROWS or IRIS_SQL_TIMEOUT is set to a
 *   non-positive or non-numeric value.
 * @throws {Error} When IRIS_TEST_TIMEOUT is set to a non-positive or
 *   non-numeric value.
 */
export function loadConfig(
  env: Record<string, string | undefined> = process.env,
): IrisConnectionConfig {
  const host = env.IRIS_HOST ?? "localhost";
  // 32-3-R6 (Story 32.4): IRIS_HOST is a bare hostname, never a URL — a
  // userinfo-carrying value (`admin:hunter2@host`) would land verbatim in
  // `baseUrl`, hence in the `iris_server_profiles` roster of the reserved
  // default profile and of every host-less `IRIS_PROFILES` entry. The value
  // is deliberately NOT echoed in the message (it can embed a credential).
  // `:` is rejected (a host is not host:port — use IRIS_PORT) EXCEPT inside
  // a bracketed IPv6 literal (`[::1]`), which composes a valid baseUrl and
  // worked before this guard existed (Rule #19 — a bare `::1` never worked:
  // `baseUrl` derivation does not bracket it). `?`/`#` are rejected too
  // (32.4 review): they compose a baseUrl whose query/fragment swallows the
  // port and every request path, so no working configuration used them.
  const isBracketedIpv6 = /^\[[0-9a-fA-F:]+\]$/.test(host);
  if (/[@/\s\\?#]/.test(host) || (!isBracketedIpv6 && host.includes(":"))) {
    throw new Error(
      `IRIS_HOST must be a bare hostname — it must not contain "@", "/", "\\", "?", "#", or ` +
        `whitespace, and no ":" outside a bracketed IPv6 literal like "[::1]" (URL userinfo, ` +
        `a scheme, or an inline port is not a host; use IRIS_PORT for the port).`,
    );
  }
  const port = Number(env.IRIS_PORT ?? "52773");

  if (Number.isNaN(port) || port <= 0 || port > 65535) {
    throw new Error(
      `IRIS_PORT must be a valid port number (1-65535). Received: "${env.IRIS_PORT}".`,
    );
  }

  const username = env.IRIS_USERNAME;
  const password = env.IRIS_PASSWORD;
  const namespace = env.IRIS_NAMESPACE ?? "HSCUSTOM";
  const https = env.IRIS_HTTPS === "true";

  if (!username) {
    throw new Error(
      "IRIS_USERNAME environment variable is required. Set it to a valid IRIS username.",
    );
  }
  if (!password) {
    throw new Error(
      "IRIS_PASSWORD environment variable is required. Set it to the password for the IRIS user.",
    );
  }

  const rawTimeout = env.IRIS_TIMEOUT;
  const timeout = rawTimeout !== undefined ? Number(rawTimeout) : 60_000;
  if (Number.isNaN(timeout) || timeout <= 0) {
    throw new Error(
      `IRIS_TIMEOUT must be a positive number of milliseconds. Received: "${rawTimeout}".`,
    );
  }

  // IRIS_SQL_MAX_ROWS: optional positive integer hard cap on iris_sql_execute's
  // effective row limit. Unset -> sqlMaxRows stays undefined (no cap, today's
  // behavior).
  const rawSqlMaxRows = env.IRIS_SQL_MAX_ROWS;
  let sqlMaxRows: number | undefined;
  if (rawSqlMaxRows !== undefined && rawSqlMaxRows !== "") {
    const parsed = Number(rawSqlMaxRows);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error(
        `IRIS_SQL_MAX_ROWS must be a positive integer. Received: "${rawSqlMaxRows}".`,
      );
    }
    sqlMaxRows = parsed;
  }

  // IRIS_SQL_TIMEOUT: optional positive number of SECONDS forwarded as a
  // per-request timeout (milliseconds) to iris_sql_execute's HTTP call.
  // Stored pre-converted to milliseconds on IrisConnectionConfig.sqlTimeoutMs.
  // Unset -> sqlTimeoutMs stays undefined (no per-request override, today's
  // behavior).
  const rawSqlTimeout = env.IRIS_SQL_TIMEOUT;
  let sqlTimeoutMs: number | undefined;
  if (rawSqlTimeout !== undefined && rawSqlTimeout !== "") {
    const parsed = Number(rawSqlTimeout);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error(
        `IRIS_SQL_TIMEOUT must be a positive number of seconds. Received: "${rawSqlTimeout}".`,
      );
    }
    sqlTimeoutMs = parsed * 1000;
  }

  // IRIS_TEST_TIMEOUT (Story 36.1 AC 36.1.4): optional positive number of
  // SECONDS forwarded as `iris_execute_tests`'s DEFAULT poll-loop wait budget
  // (milliseconds), sitting between an explicit per-call `timeout` argument
  // and the tool's own 120-second hard-coded default. Parsed identically to
  // IRIS_SQL_TIMEOUT above (same finite-positive-number contract, same
  // empty-string-is-unset convention). Unset -> testTimeoutMs stays
  // undefined (today's 120s default, unchanged).
  const rawTestTimeout = env.IRIS_TEST_TIMEOUT;
  let testTimeoutMs: number | undefined;
  if (rawTestTimeout !== undefined && rawTestTimeout !== "") {
    const parsed = Number(rawTestTimeout);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error(
        `IRIS_TEST_TIMEOUT must be a positive number of seconds. Received: "${rawTestTimeout}".`,
      );
    }
    testTimeoutMs = parsed * 1000;
  }

  // IRIS_ACCEPT_LANGUAGE: pins the HTTP client's Accept-Language header so
  // request-locale negotiation (independent of the per-worker-process
  // message-table selection — Rule #13) is explicit and operator-overridable
  // rather than left to whatever Node's fetch sends when the caller sets no
  // header (undici injects `Accept-Language: *`, which IRIS resolves to the
  // alphabetically-first locale — see the Story 35.3 record). Rule #10: send
  // documented defaults explicitly on the wire.
  //
  // Story 35.3 code review: empty/whitespace-only is treated as UNSET, and an
  // invalid header value is rejected at load time — matching the convention
  // the two optional siblings above already use (`raw !== ""`) and the
  // fail-fast-with-a-named-error convention every other IRIS_* var uses.
  // Without the empty guard, `IRIS_ACCEPT_LANGUAGE=` (a blank .env line, a
  // blank MCP-client config field, `-e IRIS_ACCEPT_LANGUAGE` in docker) put an
  // EMPTY `Accept-Language:` header on the wire — verified live — silently
  // un-pinning the very locale this variable exists to pin. Without the
  // validity guard, a CR/LF- or non-ASCII-bearing value made `fetch` throw a
  // `TypeError` that `IrisHttpClient` maps to `NETWORK_ERROR` ("Failed to
  // connect to IRIS ... verify the host and port"), so EVERY request failed
  // with a diagnostic pointing at the wrong thing entirely.
  const rawAcceptLanguage = env.IRIS_ACCEPT_LANGUAGE;
  let acceptLanguage = DEFAULT_ACCEPT_LANGUAGE;
  if (rawAcceptLanguage !== undefined && rawAcceptLanguage.trim() !== "") {
    // Header field-values are ASCII (RFC 9110); undici enforces this by
    // throwing on CR/LF and on any code point outside ByteString range.
    if (!/^[\t\x20-\x7E]+$/.test(rawAcceptLanguage)) {
      throw new Error(
        `IRIS_ACCEPT_LANGUAGE must be a valid HTTP header value — printable ASCII only, ` +
          `with no carriage returns, line feeds, or control characters. Received: ` +
          `${JSON.stringify(rawAcceptLanguage)}. Example: "en-US,en;q=0.9".`,
      );
    }
    acceptLanguage = rawAcceptLanguage;
  }

  const protocol = https ? "https" : "http";
  const baseUrl = `${protocol}://${host}:${port}`;

  return {
    host,
    port,
    username,
    password,
    namespace,
    https,
    baseUrl,
    timeout,
    acceptLanguage,
    ...(sqlMaxRows !== undefined ? { sqlMaxRows } : {}),
    ...(sqlTimeoutMs !== undefined ? { sqlTimeoutMs } : {}),
    ...(testTimeoutMs !== undefined ? { testTimeoutMs } : {}),
  };
}
