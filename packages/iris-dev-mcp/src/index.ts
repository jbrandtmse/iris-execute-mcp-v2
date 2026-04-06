#!/usr/bin/env node

/**
 * @iris-mcp/dev -- IRIS Development Tools MCP Server
 *
 * Entry point that creates an {@link McpServerBase} instance with
 * the registered development tool definitions and connects the
 * configured transport (stdio by default).
 */

import { createRequire } from "node:module";
import { McpServerBase } from "@iris-mcp/shared";
import { tools } from "./tools/index.js";

// Read version from package.json using createRequire (ESM-safe)
const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

/** Determine transport from CLI args or environment variable. */
function resolveTransport(): "stdio" | "http" {
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

const server = new McpServerBase({
  name: "@iris-mcp/dev",
  version: pkg.version,
  tools,
  needsCustomRest: true,
});

const transport = resolveTransport();

server.start(transport).catch((err: unknown) => {
  console.error("Fatal:", err);
  process.exit(1);
});
