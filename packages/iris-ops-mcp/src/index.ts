#!/usr/bin/env node

/**
 * @iris-mcp/ops -- IRIS Operations & Monitoring MCP Server
 *
 * Entry point that creates an {@link McpServerBase} instance with
 * the registered operations tool definitions and connects the
 * configured transport (stdio by default).
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
  name: "@iris-mcp/ops",
  version: pkg.version,
  tools,
  toolPresets,
  prompts,
  needsCustomRest: true,
});

const transport = resolveTransport();

server.start(transport).catch((err: unknown) => {
  console.error("Fatal:", err);
  process.exit(1);
});
