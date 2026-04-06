/**
 * Structured logger that writes exclusively to stderr so that stdout
 * remains reserved for the MCP JSON-RPC protocol.
 *
 * Every message is prefixed with a severity tag: `[ERROR]`, `[WARN]`,
 * `[INFO]`, or `[DEBUG]`.
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

function createLogger(): Logger {
  return {
    error(message: string, ...args: unknown[]) {
      console.error(`[ERROR] ${message}`, ...args);
    },
    warn(message: string, ...args: unknown[]) {
      console.error(`[WARN] ${message}`, ...args);
    },
    info(message: string, ...args: unknown[]) {
      console.error(`[INFO] ${message}`, ...args);
    },
    debug(message: string, ...args: unknown[]) {
      console.error(`[DEBUG] ${message}`, ...args);
    },
  };
}

/** Singleton logger instance for the entire suite. */
export const logger: Logger = createLogger();
