/**
 * Story 29.3 (deferred-work burn-down) — CR 29.1-1.
 *
 * `deriveAuditAction` (`server-base.ts`) reads PRE-Zod `rawArgs.action` while
 * `computeGovernanceKey` reads POST-Zod `validatedArgs.action`. For every
 * SHIPPED tool this is equivalent (every `action` field is a required
 * `z.enum([...])`, never `.default(...)`), but a FUTURE tool declaring
 * `action: z.enum([...]).default("x")` would silently diverge: an omitted
 * `action` call governs on the Zod-filled default (`tool:x`) while the audit
 * log records `action: null`.
 *
 * NOTE: `.default()`-wrapped action enums are a DELIBERATELY-supported shape
 * in this codebase's governance layer — `unwrapActionOptions` explicitly
 * peels through `.optional()`/`.default()`/`.nullable()` (Story 15.0,
 * `governance-classification.test.ts`'s `iris_wrapped_manage` synthetic
 * fixture exercises exactly this). A registration-time BAN was considered and
 * rejected: it would break that intentionally-supported wrapped-action-enum
 * architecture. Instead, this file unit-tests the pure detection helper
 * ({@link actionFieldHasDefault}), and the cross-package pin for "no SHIPPED
 * tool's `action` field carries a `.default(...)`" lives in
 * `packages/iris-mcp-all/src/__tests__/action-default-audit-pin.test.ts`
 * (the only package that can enumerate every real tool across all 5
 * servers, per Rule #45) — that is the actual terminal-disposition proof for
 * CR 29.1-1's "no shipped tool triggers it" claim.
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";

import { actionFieldHasDefault } from "../governance.js";

describe("CR 29.1-1: actionFieldHasDefault (pure helper)", () => {
  it("true for a ZodDefault-wrapped enum", () => {
    const field = z.enum(["foo", "bar"]).default("foo");
    expect(actionFieldHasDefault(field)).toBe(true);
  });

  it("true for a ZodDefault wrapping a ZodOptional-wrapped enum (nested peel)", () => {
    const field = z.enum(["foo", "bar"]).optional().default("foo");
    expect(actionFieldHasDefault(field)).toBe(true);
  });

  it("false for a required (bare) enum -- the shipped shape", () => {
    const field = z.enum(["foo", "bar"]);
    expect(actionFieldHasDefault(field)).toBe(false);
  });

  it("false for an optional (non-defaulted) enum", () => {
    const field = z.enum(["foo", "bar"]).optional();
    expect(actionFieldHasDefault(field)).toBe(false);
  });

  it("false for a nullable (non-defaulted) enum", () => {
    const field = z.enum(["foo", "bar"]).nullable();
    expect(actionFieldHasDefault(field)).toBe(false);
  });

  it("false for an absent/undefined action field", () => {
    expect(actionFieldHasDefault(undefined)).toBe(false);
  });

  it("false for a plain (non-enum) field", () => {
    expect(actionFieldHasDefault(z.string())).toBe(false);
  });
});
