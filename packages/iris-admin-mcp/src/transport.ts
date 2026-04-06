/**
 * Transport resolution for the iris-admin-mcp server.
 *
 * Determines which MCP transport to use based on CLI arguments
 * or the `MCP_TRANSPORT` environment variable.
 */

/** Determine transport from CLI args or environment variable. */
export function resolveTransport(): "stdio" | "http" {
  // Check CLI args: --transport=http or --transport http
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--transport" && args[i + 1]) {
      const value = args[i + 1];
      if (value === "http" || value === "stdio") return value;
    }
    if (arg?.startsWith("--transport=")) {
      const value = arg.slice("--transport=".length);
      if (value === "http" || value === "stdio") return value;
    }
  }

  // Check environment variable
  const envTransport = process.env["MCP_TRANSPORT"];
  if (envTransport === "http" || envTransport === "stdio") return envTransport;
  if (envTransport) {
    console.error(
      `Warning: unrecognised MCP_TRANSPORT "${envTransport}", falling back to stdio`,
    );
  }

  return "stdio";
}
