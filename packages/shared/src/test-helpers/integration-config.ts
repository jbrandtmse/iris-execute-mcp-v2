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
import { liveConnectionEnv, liveGateTarget } from "./live-target.js";

declare global {
  var __IRIS_AVAILABLE__: boolean;
  var __ATELIER_VERSION__: number;
  var __CUSTOM_REST_AVAILABLE__: boolean;
  /** DocDB availability flag (set by iris-data-mcp integration-setup). */
  var __DOCDB_AVAILABLE__: boolean;
}

/**
 * Build an {@link IrisConnectionConfig} for the integration tests from the
 * armed live target (`resolveLiveTarget`): `IRIS_REQUIRE_LIVE` 1/true plus the
 * five `IRIS_*` variables, none defaulted. When the run is not armed the
 * config points at the inert, never-contacted target and every integration
 * file skips on `__IRIS_AVAILABLE__ === false`; when it is armed with a
 * variable missing this throws, naming it.
 *
 * This is the canonical integration test config factory shared across
 * all MCP server packages. `overrides` replace individual `IRIS_*` settings
 * of the resolved target (a test that needs a second namespace).
 */
export function getIntegrationConfig(
  overrides?: Partial<Record<string, string>>,
): IrisConnectionConfig {
  const { target } = liveGateTarget();
  return loadConfig({
    ...liveConnectionEnv(target),
    ...overrides,
    // Forwarded so an operator can reproduce locale-dependent %Status
    // rendering through the integration suite (Story 35.3 review). Left
    // undefined when unexported — `loadConfig` then applies its documented
    // default rather than an empty value.
    IRIS_ACCEPT_LANGUAGE: process.env.IRIS_ACCEPT_LANGUAGE,
  });
}
