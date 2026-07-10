/**
 * Tests for `iris_env_diff` (Epic 27, Story 27.0 — AC 27.0.3).
 *
 * Mocked-HTTP unit tests covering: the documents-diff happy path across TWO
 * mocked profile clients (all four buckets: onlyInSource/onlyInTarget/differs/
 * identical), idempotence (same inputs -> same buckets), `ignoreTimestamps`
 * semantics (default true ignores timestamp-only differences; explicit false
 * also flags them), missing-`spec` refusal, `allowWide` wire-forwarding +
 * surfacing the endpoint's Rule #38 refusal, unknown-profile refusal (no HTTP
 * calls issued), not-yet-implemented-domain refusal, the IrisApiError
 * envelope, non-IrisApiError rethrow, and Zod schema bounds.
 *
 * `ctx.resolveProfileClient` is overridden per test with a `vi.fn()` that maps
 * profile name -> its own mock `IrisHttpClient` (the shared `createMockCtx`
 * default just returns the single `ctx.http` mock regardless of name, which
 * cannot exercise TWO distinct profiles).
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { ToolContext } from "@iris-mcp/shared";
import { IrisApiError, ProfileResolutionError } from "@iris-mcp/shared";
import { envDiffTool } from "../tools/env-diff.js";
import { createMockHttp, createMockCtx, envelope } from "./test-helpers.js";
import { vi } from "vitest";

/** Build a /dev/doc/hashes-shaped result from a compact entry list. */
function hashesResult(
  entries: Array<{ name: string; hash: string; timestamp?: string }>,
) {
  return {
    documents: entries.map((e) => ({
      name: e.name,
      hash: e.hash,
      timestamp: e.timestamp ?? "2026-01-01 00:00:00.000",
    })),
    count: entries.length,
  };
}

describe("iris_env_diff", () => {
  let sourceHttp: ReturnType<typeof createMockHttp>;
  let targetHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    // Distinct default namespaces per mock (mirrors two real profiles with
    // different configured defaults, e.g. default->HSCUSTOM, sademo->SADEMO)
    // so namespace-resolution tests can prove each side routes independently
    // (Story 27.0 cycle 2 -- CR 27.0-3 fix).
    sourceHttp = createMockHttp("HSCUSTOM");
    targetHttp = createMockHttp("SADEMO");
    ctx = createMockCtx(sourceHttp);
    ctx.resolveProfileClient = vi.fn(async (name: string) => {
      if (name === "source") return sourceHttp;
      if (name === "target") return targetHttp;
      throw new ProfileResolutionError(name, ["default", "source", "target"]);
    });
  });

  // ── metadata ────────────────────────────────────────────────────

  it("should have name iris_env_diff, scope NONE, and scalar mutates read", () => {
    expect(envDiffTool.name).toBe("iris_env_diff");
    expect(envDiffTool.scope).toBe("NONE");
    expect(envDiffTool.mutates).toBe("read");
  });

  it("should have read-only, idempotent, closed-world annotations", () => {
    expect(envDiffTool.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it("should document the required spec, the wide-spec timeout risk, and read-only default-enabled state", () => {
    expect(envDiffTool.description).toContain("REQUIRED");
    expect(envDiffTool.description.toLowerCase()).toContain("timeout");
    expect(envDiffTool.description.toLowerCase()).toContain("read-only");
  });

  // ── documents-diff happy path: all four buckets ──────────────────

  it("should bucket onlyInSource / onlyInTarget / differs / identical across two profiles", async () => {
    sourceHttp.post.mockResolvedValue(
      envelope(
        hashesResult([
          { name: "OnlyInSource.cls", hash: "AAAA" },
          { name: "Differs.cls", hash: "SOURCEHASH" },
          { name: "Same.cls", hash: "SAMEHASH" },
        ]),
      ),
    );
    targetHttp.post.mockResolvedValue(
      envelope(
        hashesResult([
          { name: "OnlyInTarget.cls", hash: "BBBB" },
          { name: "Differs.cls", hash: "TARGETHASH" },
          { name: "Same.cls", hash: "SAMEHASH" },
        ]),
      ),
    );

    const result = await envDiffTool.handler(
      { source: "source", target: "target", spec: "MyPkg.*.cls" },
      ctx,
    );

    expect(result.isError).toBeUndefined();
    const sc = result.structuredContent as {
      domains: {
        documents: {
          onlyInSource: string[];
          onlyInTarget: string[];
          differs: Array<{ name: string; sourceHash: string; targetHash: string }>;
          identical: number;
        };
      };
      summary: { driftCount: number; identicalCount: number };
    };
    expect(sc.domains.documents.onlyInSource).toEqual(["OnlyInSource.cls"]);
    expect(sc.domains.documents.onlyInTarget).toEqual(["OnlyInTarget.cls"]);
    expect(sc.domains.documents.differs).toEqual([
      { name: "Differs.cls", sourceHash: "SOURCEHASH", targetHash: "TARGETHASH", sourceTs: "2026-01-01 00:00:00.000", targetTs: "2026-01-01 00:00:00.000" },
    ]);
    expect(sc.domains.documents.identical).toBe(1);
    expect(sc.summary.driftCount).toBe(3);
    expect(sc.summary.identicalCount).toBe(1);
  });

  it("should render onlyInTarget as explicitly informational, never a deletion signal", async () => {
    sourceHttp.post.mockResolvedValue(envelope(hashesResult([])));
    targetHttp.post.mockResolvedValue(
      envelope(hashesResult([{ name: "TargetOnly.cls", hash: "X" }])),
    );
    const result = await envDiffTool.handler(
      { source: "source", target: "target", spec: "*.cls", allowWide: true },
      ctx,
    );
    // The disclaimer itself legitimately uses the word "deletion" (to say it is
    // NOT one) — assert the full disclaiming phrase, and that no ACTION verb
    // ("will delete", "removed", "deletes") appears anywhere near it.
    expect(result.content[0]?.text).toContain("informational");
    expect(result.content[0]?.text).toContain("NOT a deletion signal");
    expect(result.content[0]?.text).not.toContain("will delete");
    expect(result.content[0]?.text).not.toContain("removed");
    expect(result.content[0]?.text.toLowerCase()).not.toContain("deletes ");
  });

  // ── idempotence ───────────────────────────────────────────────────

  it("should produce byte-identical buckets across repeated calls with the same inputs (idempotent)", async () => {
    sourceHttp.post.mockResolvedValue(
      envelope(hashesResult([{ name: "A.cls", hash: "H1" }, { name: "B.cls", hash: "H2" }])),
    );
    targetHttp.post.mockResolvedValue(
      envelope(hashesResult([{ name: "A.cls", hash: "H1" }, { name: "B.cls", hash: "H2-DIFF" }])),
    );

    const args = { source: "source", target: "target", spec: "MyPkg.*.cls" };
    const first = await envDiffTool.handler(args, ctx);
    const second = await envDiffTool.handler(args, ctx);
    expect(second.structuredContent).toEqual(first.structuredContent);
  });

  // ── ignoreTimestamps semantics ────────────────────────────────────

  it("ignoreTimestamps:true (default) treats a same-hash/different-timestamp pair as identical", async () => {
    sourceHttp.post.mockResolvedValue(
      envelope(hashesResult([{ name: "A.cls", hash: "SAME", timestamp: "2026-01-01 00:00:00.000" }])),
    );
    targetHttp.post.mockResolvedValue(
      envelope(hashesResult([{ name: "A.cls", hash: "SAME", timestamp: "2026-06-01 00:00:00.000" }])),
    );
    const result = await envDiffTool.handler(
      { source: "source", target: "target", spec: "A.cls" },
      ctx,
    );
    const sc = result.structuredContent as {
      domains: { documents: { differs: unknown[]; identical: number } };
    };
    expect(sc.domains.documents.differs).toEqual([]);
    expect(sc.domains.documents.identical).toBe(1);
  });

  it("ignoreTimestamps:false ALSO flags a same-hash/different-timestamp pair as differs", async () => {
    sourceHttp.post.mockResolvedValue(
      envelope(hashesResult([{ name: "A.cls", hash: "SAME", timestamp: "2026-01-01 00:00:00.000" }])),
    );
    targetHttp.post.mockResolvedValue(
      envelope(hashesResult([{ name: "A.cls", hash: "SAME", timestamp: "2026-06-01 00:00:00.000" }])),
    );
    const result = await envDiffTool.handler(
      { source: "source", target: "target", spec: "A.cls", ignoreTimestamps: false },
      ctx,
    );
    const sc = result.structuredContent as {
      domains: { documents: { differs: Array<{ sourceHash: string; targetHash: string }>; identical: number } };
    };
    expect(sc.domains.documents.identical).toBe(0);
    expect(sc.domains.documents.differs).toHaveLength(1);
    // Distinguishable from a content difference: hashes are EQUAL, only Ts differs.
    expect(sc.domains.documents.differs[0]!.sourceHash).toBe(sc.domains.documents.differs[0]!.targetHash);
  });

  // ── spec required ──────────────────────────────────────────────

  it("should reject a missing spec for the documents domain BEFORE any HTTP call", async () => {
    const result = await envDiffTool.handler({ source: "source", target: "target" }, ctx);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("spec");
    expect(sourceHttp.post).not.toHaveBeenCalled();
    expect(targetHttp.post).not.toHaveBeenCalled();
  });

  it("should reject a whitespace-only spec BEFORE any HTTP call", async () => {
    const result = await envDiffTool.handler(
      { source: "source", target: "target", spec: "   " },
      ctx,
    );
    expect(result.isError).toBe(true);
    expect(sourceHttp.post).not.toHaveBeenCalled();
  });

  // ── allowWide wire-forwarding + endpoint refusal surfaced ────────

  it("should NOT send allowWide on the wire when omitted", async () => {
    sourceHttp.post.mockResolvedValue(envelope(hashesResult([])));
    targetHttp.post.mockResolvedValue(envelope(hashesResult([])));
    await envDiffTool.handler({ source: "source", target: "target", spec: "MyPkg.*.cls" }, ctx);
    const body = sourceHttp.post.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(body).not.toHaveProperty("allowWide");
  });

  it("should send allowWide:true on the wire when explicitly passed", async () => {
    sourceHttp.post.mockResolvedValue(envelope(hashesResult([])));
    targetHttp.post.mockResolvedValue(envelope(hashesResult([])));
    await envDiffTool.handler(
      { source: "source", target: "target", spec: "*", allowWide: true },
      ctx,
    );
    const sourceBody = sourceHttp.post.mock.calls[0]?.[1] as Record<string, unknown>;
    const targetBody = targetHttp.post.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(sourceBody.allowWide).toBe(true);
    expect(targetBody.allowWide).toBe(true);
    expect(sourceBody.spec).toBe("*");
  });

  it("should surface the endpoint's Rule #38 wide-spec refusal as an isError envelope", async () => {
    sourceHttp.post.mockRejectedValue(
      new IrisApiError(
        500,
        [],
        "/api/executemcp/v2/dev/doc/hashes",
        "spec '*' scans the whole namespace; pass allowWide:true to override.",
      ),
    );
    const result = await envDiffTool.handler(
      { source: "source", target: "target", spec: "*" },
      ctx,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("allowWide");
  });

  // ── namespace wire-forwarding + resolution (Story 27.0 cycle 2, CR 27.0-3) ─

  it("should send each profile's OWN resolved default namespace on the wire when omitted, and echo it in structuredContent (never blank)", async () => {
    sourceHttp.post.mockResolvedValue(envelope(hashesResult([])));
    targetHttp.post.mockResolvedValue(envelope(hashesResult([])));
    const result = await envDiffTool.handler(
      { source: "source", target: "target", spec: "A.cls" },
      ctx,
    );
    // sourceHttp/targetHttp were created with DIFFERENT default namespaces
    // (HSCUSTOM / SADEMO respectively, see beforeEach) -- each side's POST
    // body must carry its OWN client's namespace, not a shared/blank value.
    expect((sourceHttp.post.mock.calls[0]?.[1] as Record<string, unknown>).namespace).toBe(
      "HSCUSTOM",
    );
    expect((targetHttp.post.mock.calls[0]?.[1] as Record<string, unknown>).namespace).toBe(
      "SADEMO",
    );
    const sc = result.structuredContent as {
      source: { namespace: string };
      target: { namespace: string };
    };
    expect(sc.source.namespace).toBe("HSCUSTOM");
    expect(sc.target.namespace).toBe("SADEMO");
  });

  it("should send an explicit namespace identically to both sides, overriding each profile's own default, and echo it in structuredContent", async () => {
    sourceHttp.post.mockResolvedValue(envelope(hashesResult([])));
    targetHttp.post.mockResolvedValue(envelope(hashesResult([])));
    const result = await envDiffTool.handler(
      { source: "source", target: "target", spec: "A.cls", namespace: "SADEMO" },
      ctx,
    );
    expect((sourceHttp.post.mock.calls[0]?.[1] as Record<string, unknown>).namespace).toBe(
      "SADEMO",
    );
    expect((targetHttp.post.mock.calls[0]?.[1] as Record<string, unknown>).namespace).toBe(
      "SADEMO",
    );
    const sc = result.structuredContent as {
      source: { namespace: string };
      target: { namespace: string };
    };
    expect(sc.source.namespace).toBe("SADEMO");
    expect(sc.target.namespace).toBe("SADEMO");
  });

  // ── unknown profile ────────────────────────────────────────────

  it("should reject an unknown source/target profile BEFORE any HTTP call", async () => {
    const result = await envDiffTool.handler(
      { source: "bogus", target: "target", spec: "A.cls" },
      ctx,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("bogus");
    expect(sourceHttp.post).not.toHaveBeenCalled();
    expect(targetHttp.post).not.toHaveBeenCalled();
  });

  // ── not-yet-implemented domains (27.1 scope) ─────────────────────

  it("should refuse a not-yet-implemented domain, naming Story 27.1, with NO HTTP calls", async () => {
    const result = await envDiffTool.handler(
      { source: "source", target: "target", domains: ["mappings"] },
      ctx,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("mappings");
    expect(result.content[0]?.text).toContain("27.1");
    expect(sourceHttp.post).not.toHaveBeenCalled();
  });

  it("should refuse a mixed request that includes an unimplemented domain even alongside 'documents'", async () => {
    const result = await envDiffTool.handler(
      { source: "source", target: "target", domains: ["documents", "config"], spec: "A.cls" },
      ctx,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("config");
    expect(sourceHttp.post).not.toHaveBeenCalled();
  });

  // ── error handling ──────────────────────────────────────────────

  it("should return an isError envelope for a generic IrisApiError", async () => {
    sourceHttp.post.mockRejectedValue(
      new IrisApiError(500, [], "/api/executemcp/v2/dev/doc/hashes", "boom"),
    );
    const result = await envDiffTool.handler(
      { source: "source", target: "target", spec: "A.cls" },
      ctx,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Error diffing environments");
  });

  it("should rethrow non-IrisApiError failures", async () => {
    sourceHttp.post.mockRejectedValue(new TypeError("network down"));
    await expect(
      envDiffTool.handler({ source: "source", target: "target", spec: "A.cls" }, ctx),
    ).rejects.toThrow("network down");
  });

  // ── Zod schema bounds ───────────────────────────────────────────

  it("should require non-empty source/target and validate the domains enum", () => {
    const schema = envDiffTool.inputSchema;
    expect(schema.safeParse({ source: "", target: "target" }).success).toBe(false);
    expect(schema.safeParse({ source: "source", target: "" }).success).toBe(false);
    expect(schema.safeParse({ source: "source" }).success).toBe(false);
    expect(schema.safeParse({ target: "target" }).success).toBe(false);
    expect(
      schema.safeParse({ source: "source", target: "target", domains: ["bogus"] }).success,
    ).toBe(false);
    expect(
      schema.safeParse({ source: "source", target: "target", domains: [] }).success,
    ).toBe(false);
    expect(schema.safeParse({ source: "source", target: "target" }).success).toBe(true);
    expect(
      schema.safeParse({
        source: "source",
        target: "target",
        domains: ["documents"],
        spec: "A.*.cls",
        allowWide: false,
        namespace: "HSCUSTOM",
        ignoreTimestamps: true,
      }).success,
    ).toBe(true);
  });
});
