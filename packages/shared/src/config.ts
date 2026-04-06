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
 *
 * @throws {Error} When IRIS_USERNAME or IRIS_PASSWORD is not set.
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

  const protocol = https ? "https" : "http";
  const baseUrl = `${protocol}://${host}:${port}`;

  return { host, port, username, password, namespace, https, baseUrl };
}
