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
}

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
 *
 * @throws {Error} When IRIS_USERNAME or IRIS_PASSWORD is not set.
 * @throws {Error} When IRIS_SQL_MAX_ROWS or IRIS_SQL_TIMEOUT is set to a
 *   non-positive or non-numeric value.
 */
export function loadConfig(
  env: Record<string, string | undefined> = process.env,
): IrisConnectionConfig {
  const host = env.IRIS_HOST ?? "localhost";
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
    ...(sqlMaxRows !== undefined ? { sqlMaxRows } : {}),
    ...(sqlTimeoutMs !== undefined ? { sqlTimeoutMs } : {}),
  };
}
