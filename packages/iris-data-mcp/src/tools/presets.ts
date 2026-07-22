/**
 * Tool visibility preset rosters for iris-data-mcp (Epic 30, architecture
 * decision I2; Story 30.1). Transcribed EXACTLY from the product-owner-
 * approved spec §2.5 note (approved 2026-07-12 — "implement as written").
 *
 * iris-data-mcp's 7 tools are already inside the researched 5-15 sweet spot,
 * so both `core` and `developer` include all 7 (`exclude: []`) — the coverage
 * assert (`assertPresetCoverage`, see `index.ts`) still applies uniformly, so
 * the roster is declared explicitly rather than omitted.
 *
 * [Source: research/feature-specs/11-tool-visibility-presets.md#2.5 "iris-data-mcp"]
 */

import type { ToolPresetRosters } from "@iris-mcp/shared";

/** data-mcp's `core`/`developer` visibility rosters (§2.5) — full inclusion for both. */
export const toolPresets: ToolPresetRosters = {
  core: {
    include: [
      "iris_docdb_manage",
      "iris_docdb_document",
      "iris_docdb_find",
      "iris_docdb_property",
      "iris_analytics_mdx",
      "iris_analytics_cubes",
      "iris_rest_manage",
    ],
    exclude: [],
  },
  developer: {
    include: [
      "iris_docdb_manage",
      "iris_docdb_document",
      "iris_docdb_find",
      "iris_docdb_property",
      "iris_analytics_mdx",
      "iris_analytics_cubes",
      "iris_rest_manage",
    ],
    exclude: [],
  },
};
