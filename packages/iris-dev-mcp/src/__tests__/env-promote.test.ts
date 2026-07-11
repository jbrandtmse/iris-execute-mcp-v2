/**
 * Story 27.2 — unit tests for `iris_env_promote`'s `plan` action (AC
 * 27.2.1/27.2.2/27.2.3).
 *
 * `plan` is a PURE TRANSFORM of a prior `iris_env_diff` `structuredContent`
 * result -- no IRIS connection is made, so every test here is mocked-HTTP-free
 * (fixture-only). `ctx` is still passed to the handler (satisfying the
 * `ToolContext` type) via `createMockCtx()`, but the handler never touches it
 * for `plan`.
 *
 * Section (g) retains ONE minimal `execute` smoke (the pre-27.3 stub test,
 * updated for the real Gate-1/plan-required refusal) -- full `execute` gate
 * and per-step-dispatch coverage (Story 27.3, AC 27.3.1/27.3.2/27.3.3) lives
 * in the dedicated `env-promote-execute.test.ts`.
 *
 * Not named `*.integration.test.ts` (Rule #21) -- runs in the default suite.
 */

import { describe, it, expect, vi } from "vitest";
import { envPromoteTool, computePlanHash } from "../tools/env-promote.js";
import { createMockCtx } from "./test-helpers.js";

const ctx = createMockCtx();

/**
 * A diff fixture with drift (create + update + target-only) in ALL FIVE
 * domains, matching the exact `EnvDiffResult` shape produced by
 * `iris_env_diff` (env-diff.ts:191-329). Subject names are deliberately
 * chosen ("AAA..." before "ZZZ...") so alphabetical sub-ordering matches
 * insertion order within each domain -- this keeps the ordering assertions
 * below unambiguous.
 */
function fullDriftDiff(): Record<string, unknown> {
  return {
    source: { profile: "stage", namespace: "HSCUSTOM" },
    target: { profile: "prod", namespace: "HSCUSTOM" },
    domains: {
      mappings: {
        onlyInSource: ["global::HSCUSTOM::AAA_New"],
        onlyInTarget: ["global::HSCUSTOM::OldGlobal"],
        differs: [
          {
            type: "global",
            namespace: "HSCUSTOM",
            name: "ZZZ_Changed",
            sourceValue: { database: "IRISDB" },
            targetValue: { database: "OTHERDB" },
          },
        ],
        identical: 5,
      },
      documents: {
        onlyInSource: ["AAA_New.cls"],
        onlyInTarget: ["OldClass.cls"],
        differs: [
          {
            name: "ZZZ_Changed.cls",
            sourceHash: "a".repeat(64),
            targetHash: "b".repeat(64),
            sourceTs: "2026-07-01 00:00:00.000",
            targetTs: "2026-07-02 00:00:00.000",
          },
        ],
        identical: 40,
      },
      defaultSettings: {
        onlyInSource: [
          { production: "AAAProd", item: "Item1", hostClass: "HostA", setting: "Timeout", value: "30" },
        ],
        onlyInTarget: [
          { production: "MyProd", item: "Item1", hostClass: "HostA", setting: "Retries", value: "3" },
        ],
        differs: [
          {
            production: "ZZZProd",
            item: "Item1",
            hostClass: "HostA",
            setting: "PoolSize",
            sourceValue: "5",
            targetValue: "10",
          },
          {
            production: "ZZZProd",
            item: "Item2",
            hostClass: "HostB",
            setting: "Password",
            redacted: "[REDACTED:differs]",
          },
        ],
        identical: 8,
      },
      webapps: {
        onlyInSource: ["AAA_new_app"],
        onlyInTarget: ["/api/old"],
        differs: [{ name: "ZZZ_changed_app", sourceValue: { enabled: true }, targetValue: { enabled: false } }],
        identical: 3,
      },
      config: {
        onlyInSource: ["Errlog"],
        onlyInTarget: ["SomeOldKey"],
        differs: [{ key: "Maxprocesses", sourceValue: 100, targetValue: 200 }],
        identical: 10,
      },
    },
    summary: { driftCount: 12, identicalCount: 66 },
  };
}

// ── (a) ordering ─────────────────────────────────────────────────────

describe("iris_env_promote:plan -- ordering (AC 27.2.1)", () => {
  it("emits steps grouped mappings -> documents -> defaultSettings -> webapps -> config, index monotonic 1..N", async () => {
    const result = await envPromoteTool.handler(
      { action: "plan", source: "stage", target: "prod", diff: fullDriftDiff() },
      ctx,
    );

    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as {
      steps: Array<{ index: number; domain: string; direction: string }>;
    };

    expect(structured.steps.map((s) => s.domain)).toEqual([
      "mappings",
      "mappings",
      "documents",
      "documents",
      "defaultSettings",
      "defaultSettings",
      "defaultSettings",
      "webapps",
      "webapps",
      "config",
      "config",
    ]);
    expect(structured.steps.map((s) => s.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(structured.steps.every((s) => s.direction === "sourceToTarget")).toBe(true);
  });

  it("orders steps within a domain by subject (create 'AAA_New' before update 'ZZZ_Changed')", async () => {
    const result = await envPromoteTool.handler(
      { action: "plan", source: "stage", target: "prod", diff: fullDriftDiff() },
      ctx,
    );
    const structured = result.structuredContent as {
      steps: Array<{ domain: string; operation: string; subject: string }>;
    };
    const mappingSteps = structured.steps.filter((s) => s.domain === "mappings");
    expect(mappingSteps.map((s) => s.subject)).toEqual([
      "global::HSCUSTOM::AAA_New",
      "global::HSCUSTOM::ZZZ_Changed",
    ]);
    expect(mappingSteps.map((s) => s.operation)).toEqual(["createMapping", "updateMapping"]);
  });
});

// ── (b) warnings + no-delete (AC 27.2.2) ────────────────────────────

describe("iris_env_promote:plan -- onlyInTarget -> warnings, never steps (AC 27.2.2)", () => {
  it("emits exactly one warning per domain's onlyInTarget entry, and zero delete/remove steps", async () => {
    const result = await envPromoteTool.handler(
      { action: "plan", source: "stage", target: "prod", diff: fullDriftDiff() },
      ctx,
    );
    const structured = result.structuredContent as {
      steps: Array<{ operation: string; subject: string }>;
      warnings: Array<{ domain: string; subject: string; detail: string }>;
      summary: { stepCount: number; warningCount: number };
    };

    expect(structured.warnings).toHaveLength(5);
    expect(structured.warnings.map((w) => w.domain)).toEqual([
      "mappings",
      "documents",
      "defaultSettings",
      "webapps",
      "config",
    ]);
    // Every warning names the correct target-only subject and the uniform detail text.
    expect(structured.warnings.map((w) => w.subject)).toEqual([
      "global::HSCUSTOM::OldGlobal",
      "OldClass.cls",
      "MyProd||Item1||HostA||Retries",
      "/api/old",
      "SomeOldKey",
    ]);
    expect(structured.warnings.every((w) => w.detail === "exists on target only -- not promoted, not deleted")).toBe(
      true,
    );

    // NO delete/remove operation exists ANYWHERE in any plan -- the load-bearing safety invariant.
    const operations = structured.steps.map((s) => s.operation.toLowerCase());
    expect(operations.some((op) => op.includes("delete") || op.includes("remove"))).toBe(false);

    // None of the target-only subjects leaked into the steps list.
    const stepSubjects = new Set(structured.steps.map((s) => s.subject));
    for (const warning of structured.warnings) {
      expect(stepSubjects.has(warning.subject)).toBe(false);
    }

    expect(structured.summary).toEqual({ stepCount: structured.steps.length, warningCount: 5 });
  });

  it("a diff with ONLY onlyInTarget items (no onlyInSource/differs) produces zero steps and all warnings", async () => {
    const diff = {
      source: { profile: "stage", namespace: "HSCUSTOM" },
      target: { profile: "prod", namespace: "HSCUSTOM" },
      domains: {
        mappings: { onlyInSource: [], onlyInTarget: ["global::HSCUSTOM::OnlyOnTarget"], differs: [], identical: 0 },
        webapps: { onlyInSource: [], onlyInTarget: ["/api/target-only"], differs: [], identical: 0 },
      },
      summary: { driftCount: 2, identicalCount: 0 },
    };
    const result = await envPromoteTool.handler({ action: "plan", source: "stage", target: "prod", diff }, ctx);
    const structured = result.structuredContent as {
      steps: unknown[];
      warnings: Array<{ domain: string }>;
    };
    expect(structured.steps).toEqual([]);
    expect(structured.warnings).toHaveLength(2);
  });
});

// ── (c) plan hash (AC 27.2.3) ────────────────────────────────────────

describe("iris_env_promote:plan -- planHash (AC 27.2.3)", () => {
  it("embeds a 64-char hex planHash in structuredContent", async () => {
    const result = await envPromoteTool.handler(
      { action: "plan", source: "stage", target: "prod", diff: fullDriftDiff() },
      ctx,
    );
    const structured = result.structuredContent as { planHash: string };
    expect(structured.planHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("computePlanHash is deterministic (same diff, same hash) regardless of top-level key order", () => {
    const diffA = fullDriftDiff();
    // Rebuild with keys inserted in the REVERSE order -- same logical content.
    const diffB = {
      summary: diffA.summary,
      domains: diffA.domains,
      target: diffA.target,
      source: diffA.source,
    };
    expect(computePlanHash(diffA)).toBe(computePlanHash(diffB));
  });

  it("computePlanHash is deterministic regardless of NESTED object key order", () => {
    const diffA = { source: { a: 1, b: 2 }, target: { profile: "x", namespace: "y" }, domains: {} };
    const diffB = { source: { b: 2, a: 1 }, target: { namespace: "y", profile: "x" }, domains: {} };
    expect(computePlanHash(diffA)).toBe(computePlanHash(diffB));
  });

  it("computePlanHash is sensitive to a value change (mutated diff -> different hash)", () => {
    const diffA = fullDriftDiff();
    const diffB = fullDriftDiff();
    (diffB.summary as { driftCount: number }).driftCount = 999;
    expect(computePlanHash(diffA)).not.toBe(computePlanHash(diffB));
  });

  it("two 'plan' calls against the same diff produce the SAME planHash (idempotent)", async () => {
    const diff = fullDriftDiff();
    const result1 = await envPromoteTool.handler({ action: "plan", source: "stage", target: "prod", diff }, ctx);
    const result2 = await envPromoteTool.handler({ action: "plan", source: "stage", target: "prod", diff }, ctx);
    const s1 = result1.structuredContent as { planHash: string };
    const s2 = result2.structuredContent as { planHash: string };
    expect(s1.planHash).toBe(s2.planHash);
  });
});

// ── (d) differs / onlyInSource -> exact step shape ──────────────────

describe("iris_env_promote:plan -- per-domain step shape (operation/subject/detail/direction)", () => {
  it("mappings: onlyInSource -> createMapping; differs -> updateMapping, both with full field shape", async () => {
    const result = await envPromoteTool.handler(
      { action: "plan", source: "stage", target: "prod", diff: fullDriftDiff() },
      ctx,
    );
    const structured = result.structuredContent as { steps: Array<Record<string, unknown>> };
    const mappingSteps = structured.steps.filter((s) => s.domain === "mappings");

    expect(mappingSteps[0]).toEqual({
      index: 1,
      domain: "mappings",
      operation: "createMapping",
      subject: "global::HSCUSTOM::AAA_New",
      detail: "create global mapping (exists on source only)",
      direction: "sourceToTarget",
    });
    expect(mappingSteps[1]).toEqual({
      index: 2,
      domain: "mappings",
      operation: "updateMapping",
      subject: "global::HSCUSTOM::ZZZ_Changed",
      detail: "update global mapping value (source differs from target)",
      direction: "sourceToTarget",
    });
  });

  it("documents: differs carries a truncated hash-to-hash detail and the batching note", async () => {
    const result = await envPromoteTool.handler(
      { action: "plan", source: "stage", target: "prod", diff: fullDriftDiff() },
      ctx,
    );
    const structured = result.structuredContent as { steps: Array<Record<string, unknown>> };
    const docSteps = structured.steps.filter((s) => s.domain === "documents");
    expect(docSteps[1]).toMatchObject({
      operation: "putAndCompile",
      subject: "ZZZ_Changed.cls",
      detail: `put and compile (hash ${"a".repeat(12)}... -> ${"b".repeat(12)}..., batched put+compile)`,
    });
  });

  it("webapps and config: create/update detail text and operation verbs", async () => {
    const result = await envPromoteTool.handler(
      { action: "plan", source: "stage", target: "prod", diff: fullDriftDiff() },
      ctx,
    );
    const structured = result.structuredContent as { steps: Array<Record<string, unknown>> };
    const webappSteps = structured.steps.filter((s) => s.domain === "webapps");
    expect(webappSteps.map((s) => s.operation)).toEqual(["modifyWebApp", "modifyWebApp"]);
    expect(webappSteps[0]?.detail).toBe("create web application (exists on source only)");
    expect(webappSteps[1]?.detail).toBe("update web application properties (source differs from target)");

    const configSteps = structured.steps.filter((s) => s.domain === "config");
    expect(configSteps.map((s) => s.operation)).toEqual(["setConfig", "setConfig"]);
    expect(configSteps[0]?.detail).toBe("set config property (exists on source only)");
    expect(configSteps[1]?.detail).toBe("set config property ('100' -> '200')");
  });
});

// ── (e) redaction survives ───────────────────────────────────────────

describe("iris_env_promote:plan -- credential redaction survives (spec §4/§7)", () => {
  it("a redacted SDS differs entry yields a step whose detail carries the marker, never the plaintext", async () => {
    const result = await envPromoteTool.handler(
      { action: "plan", source: "stage", target: "prod", diff: fullDriftDiff() },
      ctx,
    );
    const structured = result.structuredContent as { steps: Array<Record<string, unknown>> };
    const passwordStep = structured.steps.find(
      (s) => s.domain === "defaultSettings" && String(s.subject).includes("Password"),
    );
    expect(passwordStep).toBeDefined();
    expect(passwordStep?.detail).toBe("update value [REDACTED:differs]");
    // Never falls back to reading an absent sourceValue/targetValue as "undefined".
    expect(String(passwordStep?.detail)).not.toContain("undefined");

    // The plaintext never appears ANYWHERE in the serialized plan.
    const serialized = JSON.stringify(result.structuredContent);
    expect(serialized).not.toMatch(/hunter2|correct-horse|s3cr3t-plaintext/i);
    expect(serialized).toContain("[REDACTED:differs]");
  });

  it("a redacted (non-differs) onlyInSource/onlyInTarget SDS value is carried through as given (already redacted upstream)", async () => {
    const diff = {
      source: { profile: "stage", namespace: "HSCUSTOM" },
      target: { profile: "prod", namespace: "HSCUSTOM" },
      domains: {
        defaultSettings: {
          onlyInSource: [
            { production: "P", item: "I", hostClass: "H", setting: "Secret", value: "[REDACTED]" },
          ],
          onlyInTarget: [],
          differs: [],
          identical: 0,
        },
      },
      summary: { driftCount: 1, identicalCount: 0 },
    };
    const result = await envPromoteTool.handler({ action: "plan", source: "stage", target: "prod", diff }, ctx);
    const structured = result.structuredContent as { steps: Array<Record<string, unknown>> };
    expect(structured.steps[0]?.detail).toBe("create setting (value: [REDACTED])");
  });
});

// ── (f) missing / malformed diff -> clean refusal ───────────────────

describe("iris_env_promote:plan -- missing/malformed diff refusal", () => {
  it("refuses when 'diff' is omitted entirely", async () => {
    const result = await envPromoteTool.handler({ action: "plan", source: "stage", target: "prod" }, ctx);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("'diff' is required");
    expect(result.structuredContent).toBeUndefined();
  });

  it("refuses when 'diff' has no 'domains' object", async () => {
    const result = await envPromoteTool.handler(
      { action: "plan", source: "stage", target: "prod", diff: { foo: "bar" } },
      ctx,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("domains");
  });

  it("refuses when 'diff' is missing source/target profile references", async () => {
    const result = await envPromoteTool.handler(
      { action: "plan", source: "stage", target: "prod", diff: { domains: {} } },
      ctx,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("source");
  });

  it("succeeds with an empty (all domains errored / none requested) diff -- zero steps, zero warnings, no error", async () => {
    const diff = {
      source: { profile: "stage", namespace: "HSCUSTOM" },
      target: { profile: "prod", namespace: "HSCUSTOM" },
      domains: {},
      errors: { mappings: "Interoperability schema not found" },
      summary: { driftCount: 0, identicalCount: 0 },
    };
    const result = await envPromoteTool.handler({ action: "plan", source: "stage", target: "prod", diff }, ctx);
    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as { steps: unknown[]; warnings: unknown[] };
    expect(structured.steps).toEqual([]);
    expect(structured.warnings).toEqual([]);
    // The errored domain is named in the human-readable text, not structuredContent.
    expect(result.content[0]?.text).toContain("mappings");
  });
});

// ── (g) execute -- 'plan' is required (a minimal smoke; full gate/dispatch
// coverage lives in the dedicated env-promote-execute.test.ts, Story 27.3) ──

describe("iris_env_promote:execute -- 'plan' is required", () => {
  it("refuses with a clear message and makes ZERO HTTP calls when 'plan' is omitted (confirm/steps alone are not enough)", async () => {
    const http = ctx.http as unknown as Record<"get" | "put" | "post" | "delete", ReturnType<typeof vi.fn>>;
    const result = await envPromoteTool.handler(
      { action: "execute", source: "stage", target: "prod", steps: [1], confirm: true },
      ctx,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("'plan' is required");
    expect(result.structuredContent).toBeUndefined();
    expect(http.get).not.toHaveBeenCalled();
    expect(http.put).not.toHaveBeenCalled();
    expect(http.post).not.toHaveBeenCalled();
  });
});

// ── (h) CR hardening: redaction fails CLOSED on a malformed marker ────

describe("iris_env_promote:plan -- CR hardening: redaction fails closed on a non-string marker", () => {
  it("a differs SDS entry with a NON-STRING `redacted` marker + stray raw values never emits the plaintext", async () => {
    const distinctSecret = "cr-27.2-DISTINCT-FAKE-SECRET-9931";
    const diff = {
      source: { profile: "stage", namespace: "HSCUSTOM" },
      target: { profile: "prod", namespace: "HSCUSTOM" },
      domains: {
        defaultSettings: {
          onlyInSource: [],
          onlyInTarget: [],
          // Malformed: `redacted` is present but NOT the contracted string, and
          // (contract-violating) raw values are still attached. The plan must
          // STILL refuse to read the raw values -- fail closed, not open.
          differs: [
            {
              production: "P",
              item: "I",
              hostClass: "H",
              setting: "Password",
              redacted: true,
              sourceValue: distinctSecret,
              targetValue: `${distinctSecret}-target`,
            },
          ],
          identical: 0,
        },
      },
      summary: { driftCount: 1, identicalCount: 0 },
    };
    const result = await envPromoteTool.handler({ action: "plan", source: "stage", target: "prod", diff }, ctx);
    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as { steps: Array<Record<string, unknown>> };
    expect(structured.steps).toHaveLength(1);
    // The raw secret appears NOWHERE in structuredContent OR the rendered text.
    const serialized = JSON.stringify(result.structuredContent) + "\n" + (result.content[0]?.text ?? "");
    expect(serialized).not.toContain(distinctSecret);
    // The step took the redacted branch -- it did NOT fall through to the
    // "('<src>' -> '<tgt>')" value-echo form.
    expect(String(structured.steps[0]?.detail)).not.toContain("' -> '");
  });
});

// ── (i) CR hardening: builders are total on malformed (null) array elements ──

describe("iris_env_promote:plan -- CR hardening: malformed (null) record-array elements are skipped, not thrown on", () => {
  it("a null element in a record bucket is skipped; valid siblings still plan; no thrown 'Tool error' envelope", async () => {
    const diff = {
      source: { profile: "stage", namespace: "HSCUSTOM" },
      target: { profile: "prod", namespace: "HSCUSTOM" },
      domains: {
        defaultSettings: {
          onlyInSource: [null],
          onlyInTarget: [null],
          differs: [
            null,
            { production: "P", item: "I", hostClass: "H", setting: "Valid", sourceValue: "a", targetValue: "b" },
          ],
          identical: 0,
        },
        config: {
          onlyInSource: ["ValidKey"],
          onlyInTarget: [],
          differs: [null],
          identical: 0,
        },
      },
      summary: { driftCount: 0, identicalCount: 0 },
    };
    const result = await envPromoteTool.handler({ action: "plan", source: "stage", target: "prod", diff }, ctx);
    // Clean success (NOT a thrown/generic "Tool error"): null elements are
    // defensively dropped, valid ones survive -- the builders stay total.
    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as {
      steps: Array<{ domain: string; subject: string }>;
      warnings: unknown[];
    };
    // defaultSettings: 1 valid differ; config: 1 valid onlyInSource. All null elements skipped.
    expect(structured.steps).toHaveLength(2);
    expect(structured.steps.map((s) => s.domain)).toEqual(["defaultSettings", "config"]);
    expect(structured.warnings).toEqual([]); // the null onlyInTarget was skipped, not turned into a warning
  });
});
