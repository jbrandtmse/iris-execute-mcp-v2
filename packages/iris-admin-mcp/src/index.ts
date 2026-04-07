#!/usr/bin/env node

/**
 * @iris-mcp/admin -- IRIS Administration Tools MCP Server
 *
 * Entry point that creates an {@link McpServerBase} instance with
 * the registered administration tool definitions and connects the
 * configured transport (stdio by default).
 */

import { createRequire } from "node:module";
import { McpServerBase, resolveTransport } from "@iris-mcp/shared";
import { tools } from "./tools/index.js";

// Read version from package.json using createRequire (ESM-safe)
const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

const server = new McpServerBase({
  name: "@iris-mcp/admin",
  version: pkg.version,
  tools,
  needsCustomRest: true,
});

const transport = resolveTransport();

server.start(transport).catch((err: unknown) => {
  console.error("Fatal:", err);
  process.exit(1);
});
