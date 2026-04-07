/**
 * Structured logger that writes exclusively to stderr so that stdout
 * remains reserved for the MCP JSON-RPC protocol.
 *
 * Every message is prefixed with a severity tag: `[ERROR]`, `[WARN]`,
 * `[INFO]`, or `[DEBUG]`.
 *
 * **Log-Level Filtering:** Set the `LOG_LEVEL` environment variable to
 * `ERROR`, `WARN`, `INFO`, or `DEBUG` (default) to control which
 * messages are emitted. Only messages at or above the configured level
 * are output.
 *
 * **Security:** Never log credentials, session cookies, or full
 * request/response bodies through this logger.
 */

export interface Logger {
  error(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
}

/** Numeric log levels — lower number = higher severity. */
export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
}

/**
 * Parse the `LOG_LEVEL` environment variable into a {@link LogLevel}.
 *
 * Returns {@link LogLevel.DEBUG} when the variable is unset or
 * contains an unrecognised value (preserving current default behaviour).
 */
export function parseLogLevel(envValue?: string): LogLevel {
  if (!envValue) return LogLevel.DEBUG;
  switch (envValue.toUpperCase()) {
    case "ERROR":
      return LogLevel.ERROR;
    case "WARN":
      return LogLevel.WARN;
    case "INFO":
      return LogLevel.INFO;
    case "DEBUG":
      return LogLevel.DEBUG;
    default:
      return LogLevel.DEBUG;
  }
}

function createLogger(): Logger {
  const configuredLevel = parseLogLevel(process.env["LOG_LEVEL"]);

  return {
    error(message: string, ...args: unknown[]) {
      if (LogLevel.ERROR <= configuredLevel) {
        console.error(`[ERROR] ${message}`, ...args);
      }
    },
    warn(message: string, ...args: unknown[]) {
      if (LogLevel.WARN <= configuredLevel) {
        console.error(`[WARN] ${message}`, ...args);
      }
    },
    info(message: string, ...args: unknown[]) {
      if (LogLevel.INFO <= configuredLevel) {
        console.error(`[INFO] ${message}`, ...args);
      }
    },
    debug(message: string, ...args: unknown[]) {
      if (LogLevel.DEBUG <= configuredLevel) {
        console.error(`[DEBUG] ${message}`, ...args);
      }
    },
  };
}

/** Singleton logger instance for the entire suite. */
export const logger: Logger = createLogger();
