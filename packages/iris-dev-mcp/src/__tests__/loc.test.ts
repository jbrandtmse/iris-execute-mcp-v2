/**
 * Tests for `iris_loc_count` (Epic 22, Story 22.0 — AC 22.0.7/22.0.9/22.0.11).
 *
 * Mocked-HTTP unit tests covering: the EXACT wire URL incl. Rule #10
 * wire-explicit defaults (includeGenerated=false, topN=20, spec always sent),
 * explicit-parameter wiring, the client-side spec-required guard (whitespace-only
 * spec rejected BEFORE any HTTP), summary-table and CSV text renderings
 * (reference `cos_loc_counter.sh` shapes), structuredContent = endpoint result
 * object VERBATIM, the IrisApiError envelope, non-IrisApiError rethrow, and Zod
 * schema bounds.
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { ToolContext } from "@iris-mcp/shared";
import { IrisApiError } from "@iris-mcp/shared";
import { locCountTool } from "../tools/loc.js";
import { createMockHttp, createMockCtx, envelope } from "./test-helpers.js";

/** A realistic endpoint result (decisions D4 + D5 shape). */
function sampleResult(overrides?: Partial<Record<string, unknown>>) {
  return {
    filesParsed: 3,
    totalLines: 700,
    blankLines: 80,
    sourceCodeLoc: 400,
    sourceCommentLoc: 120,
    testCodeLoc: 70,
    testCommentLoc: 30,
    codePct: 67.1,
    sourceCodePct: 57.1,
    testCodePct: 10,
    commentPct: 21.4,
    whitespacePct: 11.4,
    topDocuments: [
      {
        name: "Demo.Loc.Big.cls",
        type: "cls",
        totalLines: 400,
        codeLoc: 250,
        commentLoc: 90,
        isTest: false,
      },
      {
        name: "Demo.Tests.BigTest.cls",
        type: "cls",
        totalLines: 300,
        codeLoc: 220,
        commentLoc: 60,
        isTest: true,
      },
    ],
    truncatedTopN: false,
    ...overrides,
  };
}

describe("iris_loc_count", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  // ── metadata ────────────────────────────────────────────────────

  it("should have name iris_loc_count, scope NS, and mutates read", () => {
    expect(locCountTool.name).toBe("iris_loc_count");
    expect(locCountTool.scope).toBe("NS");
    expect(locCountTool.mutates).toBe("read");
  });

  it("should have read-only, idempotent, closed-world annotations", () => {
    expect(locCountTool.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it("should document the required spec, whole-namespace timeout risk, and generated-exclusion default", () => {
    expect(locCountTool.description).toContain("REQUIRED");
    expect(locCountTool.description).toContain("timeout");
    expect(locCountTool.description).toContain("EXCLUDED by default");
  });

  it("should document the system-document exclusion and the overlapping-spec quirk (CR 22.0-4)", () => {
    expect(locCountTool.description).toContain("System (%-prefixed) documents");
    expect(locCountTool.description).toContain("non-overlapping spec parts");
  });

  // ── request wiring (Rule #10 wire-explicit defaults) ────────────

  it("should GET the loc endpoint with wire-explicit defaults (Rule #10)", async () => {
    mockHttp.get.mockResolvedValue(envelope(sampleResult()));

    await locCountTool.handler({ spec: "ExecuteMCPv2.*.cls" }, ctx);

    const calledPath = mockHttp.get.mock.calls[0]?.[0] as string;
    expect(calledPath).toBe(
      "/api/executemcp/v2/dev/loc?namespace=USER&spec=ExecuteMCPv2.*.cls&includeGenerated=false&topN=20",
    );
  });

  it("should send explicit namespace, includeGenerated, and topN when provided", async () => {
    mockHttp.get.mockResolvedValue(envelope(sampleResult()));

    await locCountTool.handler(
      {
        spec: "MyPkg.*.cls,*.mac",
        namespace: "MYNS",
        includeGenerated: true,
        topN: 5,
      },
      ctx,
    );

    const calledPath = mockHttp.get.mock.calls[0]?.[0] as string;
    expect(calledPath).toContain("namespace=MYNS");
    expect(calledPath).toContain("spec=MyPkg.*.cls%2C*.mac");
    expect(calledPath).toContain("includeGenerated=true");
    expect(calledPath).toContain("topN=5");
  });

  it("should trim surrounding whitespace off the spec before sending", async () => {
    mockHttp.get.mockResolvedValue(envelope(sampleResult()));

    await locCountTool.handler({ spec: "  MyPkg.*.cls  " }, ctx);

    const calledPath = mockHttp.get.mock.calls[0]?.[0] as string;
    expect(calledPath).toContain("spec=MyPkg.*.cls&");
  });

  it("should NOT send format on the wire (client-side rendering only)", async () => {
    mockHttp.get.mockResolvedValue(envelope(sampleResult()));

    await locCountTool.handler({ spec: "MyPkg.*.cls", format: "csv" }, ctx);

    const calledPath = mockHttp.get.mock.calls[0]?.[0] as string;
    expect(calledPath).not.toContain("format=");
  });

  // ── client-side spec guard ──────────────────────────────────────

  it("should reject a whitespace-only spec BEFORE any HTTP call", async () => {
    const result = await locCountTool.handler({ spec: "   " }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("'spec' must be a non-empty document spec");
    expect(mockHttp.get).not.toHaveBeenCalled();
  });

  // ── text renderings ─────────────────────────────────────────────

  it("should render the reference summary table by default", async () => {
    mockHttp.get.mockResolvedValue(envelope(sampleResult()));

    const result = await locCountTool.handler({ spec: "MyPkg.*.cls" }, ctx);

    const expected = [
      "+---------------------------+-----------+",
      "| Metric                    |     Value |",
      "+---------------------------+-----------+",
      "| Files Parsed              |         3 |",
      "| Total Lines (Raw)         |       700 |",
      "| Blank Lines               |        80 |",
      "| Source Code LOC           |       400 |",
      "| Source Comment LOC        |       120 |",
      "| Test Code LOC             |        70 |",
      "| Test Comment LOC          |        30 |",
      "+---------------------------+-----------+",
      "| Code %                    |     67.1% |",
      "|   Source Code %           |     57.1% |",
      "|   Test Code %             |     10.0% |",
      "| Comment %                 |     21.4% |",
      "| Whitespace %              |     11.4% |",
      "+---------------------------+-----------+",
    ].join("\n");
    expect(result.isError).toBeUndefined();
    expect(result.content).toHaveLength(1);
    expect(result.content[0]?.text).toBe(expected);
  });

  it("should render the reference metric,value CSV rows when format is csv", async () => {
    mockHttp.get.mockResolvedValue(envelope(sampleResult()));

    const result = await locCountTool.handler({ spec: "MyPkg.*.cls", format: "csv" }, ctx);

    const expected = [
      "metric,value",
      "files_parsed,3",
      "total_lines,700",
      "blank_lines,80",
      "source_code_loc,400",
      "source_comment_loc,120",
      "test_code_loc,70",
      "test_comment_loc,30",
      "code_pct,67.1",
      "source_code_pct,57.1",
      "test_code_pct,10.0",
      "comment_pct,21.4",
      "whitespace_pct,11.4",
    ].join("\n");
    expect(result.content[0]?.text).toBe(expected);
  });

  it("should not crash rendering a malformed success envelope with missing numeric fields (CR 22.0-6)", async () => {
    // A broken server could return HTTP 200 + an empty result object; the
    // renderer must degrade (zeroed percentages) instead of throwing TypeError.
    mockHttp.get.mockResolvedValue(envelope({}));

    const result = await locCountTool.handler({ spec: "MyPkg.*.cls" }, ctx);

    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain("| Code %                    |      0.0% |");
  });

  // ── structuredContent contract ──────────────────────────────────

  it("should return the endpoint result OBJECT verbatim as structuredContent", async () => {
    const endpointResult = sampleResult();
    mockHttp.get.mockResolvedValue(envelope(endpointResult));

    const result = await locCountTool.handler({ spec: "MyPkg.*.cls" }, ctx);

    // Object (never a bare array) — established MCP structuredContent constraint.
    expect(Array.isArray(result.structuredContent)).toBe(false);
    expect(result.structuredContent).toEqual(endpointResult);
  });

  // ── error handling ──────────────────────────────────────────────

  it("should return an isError envelope for IrisApiError", async () => {
    mockHttp.get.mockRejectedValue(
      new IrisApiError(
        500,
        [],
        "/api/executemcp/v2/dev/loc",
        "Required parameter 'spec' is missing or empty",
      ),
    );

    const result = await locCountTool.handler({ spec: "MyPkg.*.cls" }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Error counting lines of code:");
    expect(result.content[0]?.text).toContain("spec");
  });

  it("should rethrow non-IrisApiError failures", async () => {
    mockHttp.get.mockRejectedValue(new TypeError("network down"));

    await expect(locCountTool.handler({ spec: "MyPkg.*.cls" }, ctx)).rejects.toThrow(
      "network down",
    );
  });

  // ── Zod schema bounds ───────────────────────────────────────────

  it("should reject an empty spec, out-of-range topN, and unknown format via the schema", () => {
    const schema = locCountTool.inputSchema;
    expect(schema.safeParse({ spec: "" }).success).toBe(false);
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ spec: "A.*.cls", topN: 0 }).success).toBe(false);
    expect(schema.safeParse({ spec: "A.*.cls", topN: 101 }).success).toBe(false);
    expect(schema.safeParse({ spec: "A.*.cls", topN: 2.5 }).success).toBe(false);
    expect(schema.safeParse({ spec: "A.*.cls", format: "xml" }).success).toBe(false);
    expect(schema.safeParse({ spec: "A.*.cls" }).success).toBe(true);
    expect(
      schema.safeParse({
        spec: "A.*.cls,*.mac",
        namespace: "NS",
        includeGenerated: true,
        topN: 100,
        format: "csv",
      }).success,
    ).toBe(true);
  });
});
