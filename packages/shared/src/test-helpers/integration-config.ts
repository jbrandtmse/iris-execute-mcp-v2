/**
 * Shared integration test configuration helper.
 *
 * Provides a common `getIntegrationConfig()` function and `declare global`
 * augmentation used by all MCP server integration test files.
 *
 * This eliminates duplicate `getConfig()` / `declare global` blocks across
 * iris-data-mcp, iris-ops-mcp, and iris-interop-mcp integration tests.
 */

import { loadConfig } from "../config.js";
import type { IrisConnectionConfig } from "../config.js";

declare global {
  var __IRIS_AVAILABLE__: boolean;
  var __ATELIER_VERSION__: number;
  var __CUSTOM_REST_AVAILABLE__: boolean;
  /** DocDB availability flag (set by iris-data-mcp integration-setup). */
  var __DOCDB_AVAILABLE__: boolean;
}

/**
 * Build an {@link IrisConnectionConfig} from environment variables with
 * sensible defaults for local IRIS development instances.
 *
 * This is the canonical integration test config factory shared across
 * all MCP server packages.
 */
export function getIntegrationConfig(): IrisConnectionConfig {
  return loadConfig({
    IRIS_HOST: process.env.IRIS_HOST ?? "localhost",
    IRIS_PORT: process.env.IRIS_PORT ?? "52773",
    IRIS_USERNAME: process.env.IRIS_USERNAME ?? "_SYSTEM",
    IRIS_PASSWORD: process.env.IRIS_PASSWORD ?? "SYS",
    IRIS_NAMESPACE: process.env.IRIS_NAMESPACE ?? "HSCUSTOM",
    IRIS_HTTPS: process.env.IRIS_HTTPS ?? "false",
  });
}
