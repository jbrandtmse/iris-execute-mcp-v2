/**
 * Transport resolution for IRIS MCP servers.
 *
 * `stdio` is the only supported transport (architecture decision AD-23).
 * Every configured value other than `stdio` is a configuration error.
 */

/** The only supported transport value. */
const SUPPORTED_TRANSPORT = "stdio";

/**
 * Resolve the MCP transport from CLI arguments and the `MCP_TRANSPORT`
 * environment variable.
 *
 * Returns `"stdio"` when no transport is configured (no `--transport` flag,
 * and `MCP_TRANSPORT` unset or empty) or when every configured value is
 * exactly `stdio`.
 *
 * Throws a configuration error, before any IRIS traffic, when a configured
 * value is anything else (`http` included). The match is exact and
 * case-sensitive. Every configured value is checked, so one channel never
 * hides a bad value on the other:
 *
 * - Each `--transport <value>` and `--transport=<value>` occurrence is checked
 *   in argument order. A `--transport` with no following argument, or
 *   `--transport=` with nothing after it, is the empty value `""` and is
 *   rejected.
 * - A non-empty `MCP_TRANSPORT` is checked after the flags. An empty
 *   `MCP_TRANSPORT` means "not configured".
 *
 * Writes nothing to stdout or stderr on any path: stdout carries MCP, and the
 * caller reports the thrown error.
 */
export function resolveTransport(): "stdio" {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    let value: string | undefined;
    if (arg === "--transport") {
      value = args[i + 1] ?? "";
      i++;
    } else if (arg?.startsWith("--transport=")) {
      value = arg.slice("--transport=".length);
    }
    if (value !== undefined && value !== SUPPORTED_TRANSPORT) {
      throw new Error(
        `Unsupported transport ${JSON.stringify(value)} from --transport: ` +
          `${SUPPORTED_TRANSPORT} is the only supported transport. ` +
          `Remove --transport or pass --transport ${SUPPORTED_TRANSPORT}.`,
      );
    }
  }

  const envTransport = process.env["MCP_TRANSPORT"];
  if (envTransport && envTransport !== SUPPORTED_TRANSPORT) {
    throw new Error(
      `Unsupported transport ${JSON.stringify(envTransport)} from MCP_TRANSPORT: ` +
        `${SUPPORTED_TRANSPORT} is the only supported transport. ` +
        `Unset MCP_TRANSPORT or set it to "${SUPPORTED_TRANSPORT}".`,
    );
  }

  return SUPPORTED_TRANSPORT;
}
