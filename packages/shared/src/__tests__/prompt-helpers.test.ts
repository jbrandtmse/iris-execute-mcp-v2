/**
 * CR 25.1-4 (resolved Story 26.4) — shared `arg()`/note-branch presence
 * helpers for {@link PromptDefinition.build} implementations.
 *
 * Every prompt file previously hand-rolled its own local `arg()` (collapses
 * `undefined`/`""` to a placeholder) while the surrounding note-branch logic
 * independently keyed off `value !== undefined` alone — so an explicit
 * empty-string argument took the "provided" branch's wording yet rendered
 * the placeholder. {@link isArgProvided} is now the SINGLE definition of
 * "provided" that both {@link argOrPlaceholder} and every prompt's
 * note-branch check share, so the two can never diverge again.
 */

import { describe, it, expect } from "vitest";
import { isArgProvided, argOrPlaceholder } from "../prompt-helpers.js";

describe("isArgProvided", () => {
  it("is false for undefined (omitted optional argument)", () => {
    expect(isArgProvided(undefined)).toBe(false);
  });

  it("is false for an explicit empty string", () => {
    expect(isArgProvided("")).toBe(false);
  });

  it("is true for a non-empty string", () => {
    expect(isArgProvided("USER")).toBe(true);
  });

  it("is true for a string that is only whitespace (not collapsed)", () => {
    expect(isArgProvided(" ")).toBe(true);
  });
});

describe("argOrPlaceholder", () => {
  it("returns the placeholder for undefined", () => {
    expect(argOrPlaceholder(undefined, "<namespace>")).toBe("<namespace>");
  });

  it("returns the placeholder for an explicit empty string (matches isArgProvided)", () => {
    expect(argOrPlaceholder("", "<namespace>")).toBe("<namespace>");
  });

  it("returns the value when provided", () => {
    expect(argOrPlaceholder("USER", "<namespace>")).toBe("USER");
  });

  it("agrees with isArgProvided on every input (no divergence possible)", () => {
    for (const value of [undefined, "", "x", " ", "0"]) {
      const provided = isArgProvided(value);
      const rendered = argOrPlaceholder(value, "<placeholder>");
      expect(provided ? rendered === value : rendered === "<placeholder>").toBe(true);
    }
  });
});
