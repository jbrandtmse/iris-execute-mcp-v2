/**
 * Story 30.1 — QA end-to-end coverage for iris-ops-mcp's wired `toolPresets`.
 *
 * Complements the dev's `presets.test.ts` (pure roster-shape assertions on
 * the `toolPresets` data — coverage, counts, TOOL_PAIRS-in-data). This file
 * proves the roster actually takes effect through the REAL construction
 * path Story 30.1 wired in `index.ts` (`toolPresets` passed to
 * `new McpServerBase({...})`), using the package's OWN real tools — not a
 * synthetic fixture. Mirrors `packages/iris-dev-mcp/src/__tests__/presets.e2e.test.ts`
 * (see that file for the full end-to-end wire-level coverage, including
 * `tools/list`/`tools/call` and the `TOOL_PAIRS` proof; ops-mcp owns no
 * `TOOL_PAIRS` member so that seam does not apply here).
 *
 * No live IRIS: every test constructs but never `start()`s the server.
 * Discoverable by the default `pnpm turbo run test` suite.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { McpServerBase, SERVER_DISCOVERY_TOOL_NAME } from "@iris-mcp/shared";
import { tools } from "../tools/index.js";
import { toolPresets } from "../tools/presets.js";

const toolNames = tools.map((t) => t.name);

const savedEnv = {
  IRIS_TOOLS_PRESET: process.env.IRIS_TOOLS_PRESET,
  IRIS_TOOLS_DISABLE: process.env.IRIS_TOOLS_DISABLE,
  IRIS_TOOLS_ENABLE: process.env.IRIS_TOOLS_ENABLE,
};

function clearVisibilityEnv(): void {
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

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  restoreEnv();
  vi.restoreAllMocks();
});

describe("E2E — iris-ops-mcp real McpServerBase construction with the wired toolPresets roster", () => {
  it("IRIS_TOOLS_PRESET=core yields exactly core.include + iris_server_profiles", () => {
    clearVisibilityEnv();
    process.env.IRIS_TOOLS_PRESET = "core";
    const server = new McpServerBase({
      name: "@iris-mcp/ops",
      version: "0.0.0",
      tools,
      toolPresets,
    });

    expect(server.getToolNames().sort()).toEqual(
      [...toolPresets.core.include, SERVER_DISCOVERY_TOOL_NAME].sort(),
    );
    // Representative non-monitoring tools stay hidden under core.
    expect(server.getToolNames()).not.toContain("iris_backup_manage");
    expect(server.getToolNames()).not.toContain("iris_config_manage");
  });

  it("IRIS_TOOLS_PRESET=developer yields exactly developer.include + iris_server_profiles (distinct roster from core, same size)", () => {
    clearVisibilityEnv();
    process.env.IRIS_TOOLS_PRESET = "developer";
    const server = new McpServerBase({
      name: "@iris-mcp/ops",
      version: "0.0.0",
      tools,
      toolPresets,
    });

    expect(server.getToolNames().sort()).toEqual(
      [...toolPresets.developer.include, SERVER_DISCOVERY_TOOL_NAME].sort(),
    );
    // core and developer are both 9-tool rosters for ops-mcp but NOT
    // identical — developer trades iris_metrics_alerts/iris_license_info for
    // iris_metrics_interop/iris_task_history.
    expect(server.getToolNames()).toContain("iris_metrics_interop");
    expect(server.getToolNames()).not.toContain("iris_metrics_alerts");
  });

  it("no IRIS_TOOLS_PRESET (⇒ full) yields every package tool + iris_server_profiles, even with toolPresets wired (Rule #19 back-compat)", () => {
    clearVisibilityEnv();
    const withRoster = new McpServerBase({
      name: "@iris-mcp/ops",
      version: "0.0.0",
      tools,
      toolPresets,
    });
    const withoutRoster = new McpServerBase({
      name: "@iris-mcp/ops",
      version: "0.0.0",
      tools,
    });

    expect(withRoster.getToolNames().sort()).toEqual(
      [...toolNames, SERVER_DISCOVERY_TOOL_NAME].sort(),
    );
    expect(withRoster.getToolNames().sort()).toEqual(
      withoutRoster.getToolNames().sort(),
    );
  });
});
