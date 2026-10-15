#!/usr/bin/env node

/**
 * @iris-mcp/admin -- IRIS Administration Tools MCP Server
 *
 * Entry point that creates an {@link McpServerBase} instance with
 * the registered administration tool definitions and connects the
 * stdio transport, the only supported transport; any other configured
 * transport is a fatal configuration error.
 */

import { createRequire } from "node:module";
import { McpServerBase, resolveTransport } from "@iris-mcp/shared";
import { tools } from "./tools/index.js";
import { toolPresets } from "./tools/presets.js";
import { prompts } from "./prompts/index.js";

// Read version from package.json using createRequire (ESM-safe)
const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

const server = new McpServerBase({
  name: "@iris-mcp/admin",
  version: pkg.version,
  tools,
  toolPresets,
  prompts,
  needsCustomRest: true,
});

try {
  await server.start(resolveTransport());
} catch (err: unknown) {
  console.error("Fatal:", err);
  process.exit(1);
}
