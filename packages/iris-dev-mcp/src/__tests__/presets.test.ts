/**
 * Story 30.1 — Preset roster coverage + pairs + count guards for iris-dev-mcp.
 *
 * Rot-proofing (spec 11 §2.4, Rule #53): every registered tool must carry an
 * explicit `include`/`exclude` disposition for EVERY named preset, with no
 * overlap. `assertPresetCoverage` is the same function `McpServerBase`'s
 * constructor runs (see `../index.ts`) — this test catches a transcription
 * slip at `pnpm test` time rather than first server launch.
 *
 * Also pins the exact roster sizes from spec §2.5's "Roster summary" table
 * (Rule #36 oracle discipline) and proves the `TOOL_PAIRS` co-visibility
 * guarantee for `iris_env_diff`/`iris_env_promote`, the pair dev-mcp owns.
 */

import { describe, it, expect } from "vitest";
import { assertPresetCoverage, TOOL_PAIRS } from "@iris-mcp/shared";
import { tools } from "../tools/index.js";
import { toolPresets } from "../tools/presets.js";

const toolNames = tools.map((t) => t.name);

describe("iris-dev-mcp tool visibility presets (Story 30.1)", () => {
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

  it("pins the exact roster sizes (dev: core 14/18, developer 32/0 - Story 36.2 added iris_test_status and Story 40.1 added iris_test_coverage, both developer-include/core-exclude; Story 38.4 added iris_doc_edit and Story 38.5 added iris_sql_query to both)", () => {
    expect(toolPresets.core.include.length).toBe(14);
    expect(toolPresets.core.exclude.length).toBe(18);
    expect(toolPresets.developer.include.length).toBe(32);
    expect(toolPresets.developer.exclude.length).toBe(0);
  });

  it("core holds 15 runtime tools (14 package tools + iris_server_profiles): the 13 is a guideline, not a hard limit (L-4, Project Lead decision 2026-10-14; AD-7)", () => {
    expect(toolPresets.core.include.length + 1).toBe(15);
  });

  it("iris_sql_query is included in both presets: querying is part of the everyday loop, and iris_sql_execute is blocked under the read-only preset (Story 38.5)", () => {
    expect(toolPresets.core.include).toContain("iris_sql_query");
    expect(toolPresets.developer.include).toContain("iris_sql_query");
    expect(toolPresets.core.exclude).not.toContain("iris_sql_query");
    expect(toolPresets.core.include).toContain("iris_sql_execute");
  });

  it("iris_doc_edit is included in both presets, because it is in the everyday authoring loop (Story 38.4)", () => {
    expect(toolPresets.core.include).toContain("iris_doc_edit");
    expect(toolPresets.developer.include).toContain("iris_doc_edit");
    expect(toolPresets.core.exclude).not.toContain("iris_doc_edit");
  });

  describe("TOOL_PAIRS co-visibility", () => {
    it("every pair dev-mcp owns both members of is together-in or together-out of every preset", () => {
      const toolNameSet = new Set(toolNames);
      for (const [a, b] of TOOL_PAIRS) {
        if (!toolNameSet.has(a) || !toolNameSet.has(b)) continue; // pair not owned by this package
        for (const preset of ["core", "developer"] as const) {
          const roster = toolPresets[preset];
          const aIn = roster.include.includes(a);
          const bIn = roster.include.includes(b);
          expect(
            aIn,
            `"${a}" and "${b}" must be co-visible in preset "${preset}"`,
          ).toBe(bIn);
        }
      }
    });

    it("iris_doc_get / iris_doc_edit are co-visible: both in core and both in developer (Story 38.4)", () => {
      expect(TOOL_PAIRS).toContainEqual(["iris_doc_get", "iris_doc_edit"]);
      for (const preset of ["core", "developer"] as const) {
        expect(toolPresets[preset].include, preset).toContain("iris_doc_get");
        expect(toolPresets[preset].include, preset).toContain("iris_doc_edit");
      }
    });

    it("iris_test_coverage / iris_test_status are co-visible: both excluded from core and both included in developer (Story 40.1; no core row moves)", () => {
      expect(TOOL_PAIRS).toContainEqual(["iris_test_coverage", "iris_test_status"]);
      expect(toolPresets.core.exclude).toContain("iris_test_coverage");
      expect(toolPresets.core.exclude).toContain("iris_test_status");
      expect(toolPresets.core.include).not.toContain("iris_test_coverage");
      expect(toolPresets.developer.include).toContain("iris_test_coverage");
      expect(toolPresets.developer.include).toContain("iris_test_status");
    });

    it("iris_env_diff / iris_env_promote are both excluded from core and both included in developer", () => {
      expect(toolPresets.core.exclude).toContain("iris_env_diff");
      expect(toolPresets.core.exclude).toContain("iris_env_promote");
      expect(toolPresets.developer.include).toContain("iris_env_diff");
      expect(toolPresets.developer.include).toContain("iris_env_promote");
    });
  });
});
