import { describe, it, expect } from "vitest";
import {
  deriveKeysForTool,
  computeBaselineDrift,
  SERVER_PACKAGES,
  VANISHED_HINT,
} from "../governance-baseline-derivation.js";

// ════════════════════════════════════════════════════════════════════
// Shared governance derivation + drift helpers (Story 22.1, CR 16.0-1 / CR 16.0-2).
//
// These unit-test the helpers the generator (`gen-governance-baseline.mjs`) and the
// `governance.test.ts` drift guard now BOTH import — so the CLI `--check` and the in-suite
// drift check can never derive a different surface (CR 16.0-1), and the vanished-key
// exit-1 logic gets direct coverage WITHOUT mutating the real dists or the frozen baseline
// (the gap `governance-baseline-check.test.ts` documented it could not close — CR 16.0-2).
// ════════════════════════════════════════════════════════════════════

// A minimal fake Zod ZodEnum action field: exposes `.options` like a bare `z.enum([...])`.
const fakeEnum = (options: unknown[]) => ({ options });

describe("deriveKeysForTool (shared derivation — CR 16.0-1 lock-step)", () => {
  it("emits per-action keys for a multi-action tool", () => {
    const tool = {
      name: "iris_x",
      inputSchema: { shape: { action: fakeEnum(["read", "wipe"]) } },
    };
    expect(deriveKeysForTool(tool)).toEqual(["iris_x:read", "iris_x:wipe"]);
  });

  it("emits the bare tool name for a single-op tool (no action enum)", () => {
    const tool = { name: "iris_y", inputSchema: { shape: {} } };
    expect(deriveKeysForTool(tool)).toEqual(["iris_y"]);
  });

  it("treats a non-enum action (e.g. z.string, no .options) as single-op", () => {
    // A `z.string()` action field never unwraps to an options array → bare key.
    const tool = { name: "iris_s", inputSchema: { shape: { action: {} } } };
    expect(deriveKeysForTool(tool)).toEqual(["iris_s"]);
  });

  it("unwraps a wrapped action enum the SAME way the gate does (lock-step)", () => {
    // Mimic z.enum([...]).optional(): `.options` is undefined; `.unwrap()` peels to the
    // enum — exactly what unwrapActionOptions (the gate's function) does.
    const inner = fakeEnum(["a", "b"]);
    const wrapped = { unwrap: () => inner };
    const tool = { name: "iris_z", inputSchema: { shape: { action: wrapped } } };
    expect(deriveKeysForTool(tool)).toEqual(["iris_z:a", "iris_z:b"]);
  });

  it("throws (never silently downgrades) on malformed tool shapes", () => {
    expect(() =>
      deriveKeysForTool({ inputSchema: { shape: {} } }),
    ).toThrow(/missing\/empty "name"/);
    expect(() => deriveKeysForTool({ name: "iris_q" })).toThrow(
      /missing "inputSchema"/,
    );
    expect(() =>
      deriveKeysForTool({
        name: "iris_e",
        inputSchema: { shape: { action: fakeEnum([]) } },
      }),
    ).toThrow(/EMPTY "action" enum/);
    expect(() =>
      deriveKeysForTool({
        name: "iris_n",
        inputSchema: { shape: { action: fakeEnum([1, 2]) } },
      }),
    ).toThrow(/non-string "action" enum option/);
  });

  it("names the package in the error when a label is supplied", () => {
    expect(() => deriveKeysForTool({ name: "iris_q" }, "iris-dev-mcp")).toThrow(
      /iris-dev-mcp\/iris_q is missing "inputSchema"/,
    );
  });
});

describe("computeBaselineDrift (frozen-baseline drift — CR 16.0-2 vanished-key exit-1)", () => {
  it("detects a vanished frozen key (a real back-compat regression)", () => {
    const committed = ["a", "b", "c"];
    const live = ["a", "c"]; // "b" vanished from the live surface
    const { vanished, postFoundation } = computeBaselineDrift(committed, live);
    expect(vanished).toEqual(["b"]);
    expect(postFoundation).toEqual([]);
  });

  it("allows post-foundation growth (new live keys are NOT a regression)", () => {
    const committed = ["a", "b"];
    const live = ["a", "b", "c", "d"]; // grew past the frozen foundation
    const { vanished, postFoundation } = computeBaselineDrift(committed, live);
    expect(vanished).toEqual([]);
    expect(postFoundation).toEqual(["c", "d"]);
  });

  it("reports multiple vanished keys sorted ascending", () => {
    const { vanished } = computeBaselineDrift(["z", "a", "m"], ["a"]);
    expect(vanished).toEqual(["m", "z"]);
  });

  it("is clean when the live surface exactly covers the committed foundation", () => {
    const { vanished, postFoundation } = computeBaselineDrift(
      ["a", "b"],
      ["a", "b"],
    );
    expect(vanished).toEqual([]);
    expect(postFoundation).toEqual([]);
  });

  it("accepts Set inputs as well as arrays", () => {
    const { vanished } = computeBaselineDrift(
      new Set(["a", "b"]),
      new Set(["a"]),
    );
    expect(vanished).toEqual(["b"]);
  });
});

describe("shared constants", () => {
  it("SERVER_PACKAGES lists the five governed server packages", () => {
    expect([...SERVER_PACKAGES]).toEqual([
      "iris-dev-mcp",
      "iris-admin-mcp",
      "iris-interop-mcp",
      "iris-ops-mcp",
      "iris-data-mcp",
    ]);
  });

  it("VANISHED_HINT names the back-compat regression", () => {
    expect(VANISHED_HINT).toContain("back-compat regression");
    expect(VANISHED_HINT).toContain("do NOT regenerate the frozen baseline");
  });
});
