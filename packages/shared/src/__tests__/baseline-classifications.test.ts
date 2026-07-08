/**
 * Story 24.0 — Baseline read/write classifications: completeness guard.
 *
 * `BASELINE_ACTION_CLASSIFICATIONS` (baseline-classifications.ts) is a
 * hand-curated map with NO generator behind it — so unlike
 * `governance-baseline.ts` (which the generator + `gen:governance-baseline:
 * check` keeps honest), this map can silently drift from the frozen 141-key
 * baseline as either file changes over time. This is the Rule #20
 * mechanical-proof pattern applied to that drift risk: a test that FAILS,
 * NAMING THE OFFENDING KEY(S), the moment the two key sets diverge.
 *
 * Discoverable by the default `vitest run` suite (`*.test.ts`, NOT
 * `*.integration.test.ts`, which `packages/shared/vitest.config.ts`
 * excludes — Rule #21). No live IRIS required; pure data-shape assertions.
 *
 * This story adds NO consumer of the map (Story 24.1's `presetSeed` is the
 * first reader) and NEVER touches `governance-baseline.ts` (Rule #23) or
 * runs the bare generator (Rule #25) — see AC 24.0.3.
 */

import { describe, it, expect } from "vitest";
import { GOVERNANCE_BASELINE } from "../governance-baseline.js";
import { BASELINE_ACTION_CLASSIFICATIONS } from "../baseline-classifications.js";

describe("BASELINE_ACTION_CLASSIFICATIONS completeness (AC 24.0.1)", () => {
  const mapKeys = new Set(Object.keys(BASELINE_ACTION_CLASSIFICATIONS));

  it("is non-empty and has exactly as many entries as the frozen baseline (fast tripwire)", () => {
    expect(mapKeys.size).toBeGreaterThan(0);
    expect(mapKeys.size).toBe(GOVERNANCE_BASELINE.size);
  });

  it("has NO missing keys — every GOVERNANCE_BASELINE key is present in the map", () => {
    const missing = [...GOVERNANCE_BASELINE].filter((key) => !mapKeys.has(key));
    // Named, not counted: a bare `.size` mismatch would hide WHICH key drifted.
    expect(missing).toEqual([]);
  });

  it("has NO extra keys — every map key is a real GOVERNANCE_BASELINE key", () => {
    const extra = [...mapKeys].filter((key) => !GOVERNANCE_BASELINE.has(key));
    expect(extra).toEqual([]);
  });

  it("classifies every key as exactly \"read\" or \"write\" (no typos, no other values)", () => {
    const invalid = Object.entries(BASELINE_ACTION_CLASSIFICATIONS)
      .filter(([, value]) => value !== "read" && value !== "write")
      .map(([key, value]) => `${key}=${String(value)}`);
    expect(invalid).toEqual([]);
  });

  it("never hand-copies the baseline key list — the map is checked against the LIVE import", () => {
    // Sanity check that this test suite is actually exercising the real
    // GOVERNANCE_BASELINE export (not an empty/stale stand-in), which would
    // make the missing/extra assertions above vacuously pass.
    expect(GOVERNANCE_BASELINE.size).toBeGreaterThan(100);
  });
});
