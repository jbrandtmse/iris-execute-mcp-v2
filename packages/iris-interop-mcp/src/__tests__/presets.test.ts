/**
 * Story 30.1 — Preset roster coverage + count guards for iris-interop-mcp.
 *
 * Rot-proofing (spec 11 §2.4, Rule #53): every registered tool must carry an
 * explicit `include`/`exclude` disposition for EVERY named preset, with no
 * overlap. `assertPresetCoverage` is the same function `McpServerBase`'s
 * constructor runs (see `../index.ts`) — this test catches a transcription
 * slip at `pnpm test` time rather than first server launch.
 *
 * Also pins the exact roster sizes from spec §2.5's "Roster summary" table
 * (Rule #36 oracle discipline).
 */

import { describe, it, expect } from "vitest";
import { assertPresetCoverage, TOOL_PAIRS } from "@iris-mcp/shared";
import { tools } from "../tools/index.js";
import { toolPresets } from "../tools/presets.js";

const toolNames = tools.map((t) => t.name);

describe("iris-interop-mcp tool visibility presets (Story 30.1)", () => {
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

  it("pins the exact roster sizes from spec section 2.5 plus iris_message_search and iris_message_body (interop: core 11/13, developer 24/0)", () => {
    expect(toolPresets.core.include.length).toBe(11);
    expect(toolPresets.core.exclude.length).toBe(13);
    expect(toolPresets.developer.include.length).toBe(24);
    expect(toolPresets.developer.exclude.length).toBe(0);
  });

  it("includes iris_message_search in both presets (Story 39.1, Rule #53)", () => {
    expect(toolPresets.core.include).toContain("iris_message_search");
    expect(toolPresets.developer.include).toContain("iris_message_search");
  });

  it("includes iris_message_body in both presets: reading a found message is the next step of the everyday forensic loop (Story 39.5, L-4, Rule #53)", () => {
    expect(toolPresets.core.include).toContain("iris_message_body");
    expect(toolPresets.developer.include).toContain("iris_message_body");
    expect(toolPresets.core.exclude).not.toContain("iris_message_body");
  });

  it("core holds 12 runtime tools (11 package tools + iris_server_profiles), inside the ~13 guideline (L-4, AD-7)", () => {
    expect(toolPresets.core.include.length + 1).toBe(12);
  });

  describe("TOOL_PAIRS co-visibility", () => {
    it("every pair interop-mcp owns both members of is together-in or together-out of every preset", () => {
      const toolNameSet = new Set(toolNames);
      let owned = 0;
      for (const [a, b] of TOOL_PAIRS) {
        if (!toolNameSet.has(a) || !toolNameSet.has(b)) continue; // pair not owned by this package
        owned += 1;
        for (const preset of ["core", "developer"] as const) {
          const roster = toolPresets[preset];
          expect(
            roster.include.includes(a),
            `"${a}" and "${b}" must be co-visible in preset "${preset}"`,
          ).toBe(roster.include.includes(b));
        }
      }
      expect(owned, "interop-mcp owns exactly one pair").toBe(1);
    });

    it("iris_message_search / iris_message_body are co-visible: both in core and both in developer (Story 39.5)", () => {
      expect(TOOL_PAIRS).toContainEqual(["iris_message_search", "iris_message_body"]);
      for (const preset of ["core", "developer"] as const) {
        expect(toolPresets[preset].include, preset).toContain("iris_message_search");
        expect(toolPresets[preset].include, preset).toContain("iris_message_body");
      }
    });
  });

  it("core stays within the researched ≤13-runtime-tool window (+1 for iris_server_profiles)", () => {
    expect(toolPresets.core.include.length + 1).toBeLessThanOrEqual(13);
  });
});
