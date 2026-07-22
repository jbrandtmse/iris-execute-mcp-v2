/**
 * Story 30.1 — Preset roster coverage + count guards for iris-data-mcp.
 *
 * Rot-proofing (spec 11 §2.4, Rule #53): every registered tool must carry an
 * explicit `include`/`exclude` disposition for EVERY named preset, with no
 * overlap. `assertPresetCoverage` is the same function `McpServerBase`'s
 * constructor runs (see `../index.ts`) — this test catches a transcription
 * slip at `pnpm test` time rather than first server launch.
 *
 * data-mcp's 7 tools are already inside the researched 5-15 sweet spot, so
 * both presets declare full inclusion (`exclude: []`) — the coverage assert
 * still applies uniformly (spec §2.5).
 */

import { describe, it, expect } from "vitest";
import { assertPresetCoverage } from "@iris-mcp/shared";
import { tools } from "../tools/index.js";
import { toolPresets } from "../tools/presets.js";

const toolNames = tools.map((t) => t.name);

describe("iris-data-mcp tool visibility presets (Story 30.1)", () => {
  it("assertPresetCoverage does not throw for the wired rosters", () => {
    expect(() => assertPresetCoverage(toolPresets, toolNames)).not.toThrow();
  });

  describe.each(["core", "developer"] as const)("%s preset coverage", (preset) => {
    it("include ∪ exclude equals the package tool-name set exactly, with no overlap", () => {
      const roster = toolPresets[preset];
      const includeSet = new Set(roster.include);
      const excludeSet = new Set(roster.exclude);
      const toolNameSet = new Set(toolNames);

      expect(
        roster.include.filter((name) => excludeSet.has(name)),
        `tool(s) in BOTH include and exclude for preset "${preset}"`,
      ).toEqual([]);
      expect(
        toolNames.filter((name) => !includeSet.has(name) && !excludeSet.has(name)),
        `tool(s) missing a visibility disposition for preset "${preset}"`,
      ).toEqual([]);
      expect(
        roster.include.filter((name) => !toolNameSet.has(name)),
        `include name(s) not a registered tool for preset "${preset}"`,
      ).toEqual([]);
      expect(
        roster.exclude.filter((name) => !toolNameSet.has(name)),
        `exclude name(s) not a registered tool for preset "${preset}"`,
      ).toEqual([]);
    });
  });

  it("pins the exact roster sizes from spec §2.5 (data: core 7/0, developer 7/0)", () => {
    expect(toolPresets.core.include.length).toBe(7);
    expect(toolPresets.core.exclude.length).toBe(0);
    expect(toolPresets.developer.include.length).toBe(7);
    expect(toolPresets.developer.exclude.length).toBe(0);
  });

  it("core stays within the researched ≤13-runtime-tool window (+1 for iris_server_profiles)", () => {
    expect(toolPresets.core.include.length + 1).toBeLessThanOrEqual(13);
  });
});
