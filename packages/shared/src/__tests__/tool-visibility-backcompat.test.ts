/**
 * Story 30.0 — AC 30.0.4: Rule #19 back-compat capstone (DEFAULT suite).
 *
 * "With no visibility env vars set, each of the 5 servers' registered
 * tool-name set deep-equals its pre-feature snapshot." This is the epic's
 * release gate (Rule #19): the tool-visibility filter added to the
 * `McpServerBase` constructor (`server-base.ts`, Epic 30, architecture
 * decision I1) must be a PURE NO-OP when no `IRIS_TOOLS_*` env var is set —
 * every tool a server registers today must still be registered tomorrow.
 *
 * **Why this lives here, and what it constructs.** `@iris-mcp/shared` cannot
 * depend on any of the five leaf server packages (`iris-dev-mcp`,
 * `iris-admin-mcp`, `iris-interop-mcp`, `iris-ops-mcp`, `iris-data-mcp`) —
 * every one of them already depends on `@iris-mcp/shared`, so the reverse
 * edge would be a real circular workspace dependency (Rule #45: cross-package
 * checks that genuinely need every package's live tool objects belong in
 * `@iris-mcp/all`, the one package that legitimately depends on all five). A
 * dist-path import trick would dodge the `package.json` cycle but not the
 * PRACTICAL one: this package's own self-check (`pnpm --filter @iris-mcp/shared
 * test`) must be green in complete isolation, and shared is the FOUNDATION
 * the five packages build against — nothing here can require their `dist/`
 * to already exist.
 *
 * So this capstone constructs five REAL `McpServerBase` instances — the same
 * class, same constructor, same filter code path every real server flows
 * through — seeded with each package's CURRENT tool-NAME roster, transcribed
 * verbatim from the product-owner-approved spec table (`research/feature-
 * specs/11-tool-visibility-presets.md` §2.5, dated 2026-07-12) rather than a
 * live import. This is a deliberate, narrower substitution for "import the
 * real tool objects": it is NOT a substitute for per-package tool-roster
 * accuracy (each package's OWN `src/__tests__/index.test.ts` already pins
 * its real `tools` array's exact length and content — untouched by this
 * story, Rule #31 — and constructs the SAME `McpServerBase` class against
 * its real array). It IS a genuine, mechanical regression proof for exactly
 * what Epic 30 adds: that the new constructor filter never drops a
 * registered tool when no visibility env var is set, across five
 * differently-sized, differently-named tool sets. A bug in the filter would
 * break BOTH this test AND every package's own `index.test.ts`
 * simultaneously, since both drive the identical filter code.
 *
 * Discoverable by the default `vitest run` suite (plain `*.test.ts`, NOT
 * `*.integration.test.ts`). No live IRIS: construction only, no `start()`.
 * TypeScript-only — no `BOOTSTRAP_VERSION` impact, no governance-baseline
 * touch (every synthetic tool below declares an explicit `mutates`
 * classification, so `assertGovernanceClassified` never needs baseline
 * membership for these non-baseline synthetic names).
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import { McpServerBase } from "../server-base.js";
import { SERVER_DISCOVERY_TOOL_NAME } from "../server-discovery.js";
import type { ToolDefinition } from "../tool-types.js";
import { PRE_FEATURE_SNAPSHOTS } from "./pre-feature-tool-snapshot.js";

/** A minimal, representative read tool stub — visibility only cares about `name`. */
function makeTool(name: string): ToolDefinition {
  return {
    name,
    title: name,
    description: `Representative stub for ${name} (back-compat capstone).`,
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true },
    scope: "NONE",
    mutates: "read",
    handler: async () => ({
      content: [{ type: "text" as const, text: "ok" }],
    }),
  };
}

/**
 * Each package's current tool-name roster — single-sourced from
 * `./pre-feature-tool-snapshot.js` (see that module's header for provenance).
 * Moved out of this file inline-literal form in Story 32.3 (deferred item
 * 30-0-3) so the SAME constant also feeds `@iris-mcp/all`'s drift gate,
 * which compares it against each package's LIVE built-dist `tools` array.
 */

describe("AC 30.0.4 — Rule #19 back-compat capstone: no visibility env vars ⇒ every server's tool set is unchanged", () => {
  const savedEnv = {
    IRIS_TOOLS_PRESET: process.env.IRIS_TOOLS_PRESET,
    IRIS_TOOLS_DISABLE: process.env.IRIS_TOOLS_DISABLE,
    IRIS_TOOLS_ENABLE: process.env.IRIS_TOOLS_ENABLE,
  };

  function ensureNoVisibilityEnv(): void {
    delete process.env.IRIS_TOOLS_PRESET;
    delete process.env.IRIS_TOOLS_DISABLE;
    delete process.env.IRIS_TOOLS_ENABLE;
  }

  function restoreEnv(): void {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }

  for (const [packageName, toolNames] of Object.entries(PRE_FEATURE_SNAPSHOTS)) {
    it(`${packageName}: registered tool-name set deep-equals its pre-feature snapshot (${toolNames.length} tools + the reserved discovery tool)`, () => {
      ensureNoVisibilityEnv();
      try {
        const server = new McpServerBase({
          name: `@iris-mcp/${packageName}`,
          version: "0.0.0",
          tools: toolNames.map(makeTool),
        });

        const actual = server.getToolNames().slice().sort();
        const expected = [...toolNames, SERVER_DISCOVERY_TOOL_NAME].sort();

        // The mechanical proof: NOT a subset/superset check — exact set
        // equality. A filter bug that drops (or spuriously adds) even one
        // tool under empty env fails this immediately.
        expect(actual).toEqual(expected);
      } finally {
        restoreEnv();
      }
    });
  }

  it("sanity: every package's snapshot count matches its documented pre-feature total (11-tool-visibility-presets.md §2.5)", () => {
    expect(PRE_FEATURE_SNAPSHOTS["iris-dev-mcp"]).toHaveLength(28);
    expect(PRE_FEATURE_SNAPSHOTS["iris-admin-mcp"]).toHaveLength(26);
    expect(PRE_FEATURE_SNAPSHOTS["iris-interop-mcp"]).toHaveLength(22);
    expect(PRE_FEATURE_SNAPSHOTS["iris-ops-mcp"]).toHaveLength(21);
    expect(PRE_FEATURE_SNAPSHOTS["iris-data-mcp"]).toHaveLength(7);
  });
});
