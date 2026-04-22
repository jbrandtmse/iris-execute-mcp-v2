import { describe, it, expect, beforeEach } from "vitest";
import type { ToolContext } from "@iris-mcp/shared";
import { IrisApiError } from "@iris-mcp/shared";
import {
  analyticsMdxTool,
  analyticsCubesTool,
  horologToIso,
} from "../tools/analytics.js";
import {
  createMockHttp,
  createMockCtx,
  envelope,
} from "@iris-mcp/shared/test-helpers";

// ── iris_analytics_mdx ────────────────────────────────────────

describe("iris_analytics_mdx", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should have scope NS", () => {
    expect(analyticsMdxTool.scope).toBe("NS");
  });

  it("should have readOnlyHint: true annotation", () => {
    expect(analyticsMdxTool.annotations.readOnlyHint).toBe(true);
  });

  it("should have destructiveHint: false annotation", () => {
    expect(analyticsMdxTool.annotations.destructiveHint).toBe(false);
  });

  it("should execute MDX query and return structured result", async () => {
    const mdxResult = {
      columns: ["Measure1"],
      rows: [{ label: "Row1", values: [42] }],
      rowCount: 1,
      columnCount: 1,
    };
    mockHttp.post.mockResolvedValue(envelope(mdxResult));

    const result = await analyticsMdxTool.handler(
      { query: "SELECT [Measures].[Count] ON 0 FROM [MyCube]" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/analytics/mdx",
      {
        query: "SELECT [Measures].[Count] ON 0 FROM [MyCube]",
        namespace: "USER",
      },
    );
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual(mdxResult);
  });

  it("should pass namespace to the request body", async () => {
    mockHttp.post.mockResolvedValue(envelope({ columns: [], rows: [] }));

    await analyticsMdxTool.handler(
      { query: "SELECT 1 ON 0 FROM [Cube]", namespace: "ANALYTICS" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/analytics/mdx",
      expect.objectContaining({ namespace: "ANALYTICS" }),
    );
  });

  it("should use resolveNamespace for default namespace", async () => {
    mockHttp.post.mockResolvedValue(envelope({ columns: [], rows: [] }));

    await analyticsMdxTool.handler({ query: "SELECT 1 ON 0 FROM [C]" }, ctx);

    expect(mockHttp.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ namespace: "USER" }),
    );
  });

  it("should handle IrisApiError for invalid MDX", async () => {
    mockHttp.post.mockRejectedValue(
      new IrisApiError(
        500,
        [],
        "/api/executemcp/v2/analytics/mdx",
        "Invalid MDX syntax",
      ),
    );

    const result = await analyticsMdxTool.handler(
      { query: "INVALID MDX" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("Error executing MDX query");
  });

  it("should rethrow non-IrisApiError errors", async () => {
    mockHttp.post.mockRejectedValue(new Error("Network failure"));

    await expect(
      analyticsMdxTool.handler({ query: "SELECT 1 ON 0 FROM [C]" }, ctx),
    ).rejects.toThrow("Network failure");
  });

  it("should handle non-envelope response", async () => {
    const plainResponse = { columns: ["A"], rows: [], rowCount: 0, columnCount: 1 };
    mockHttp.post.mockResolvedValue(plainResponse);

    const result = await analyticsMdxTool.handler(
      { query: "SELECT 1 ON 0 FROM [C]" },
      ctx,
    );

    expect(result.structuredContent).toEqual(plainResponse);
  });

  it("should return structured result with columns and rows", async () => {
    const mdxResult = {
      columns: ["Revenue", "Units"],
      rows: [
        { label: "Product A", values: [1000, 50] },
        { label: "Product B", values: [2000, 75] },
      ],
      rowCount: 2,
      columnCount: 2,
    };
    mockHttp.post.mockResolvedValue(envelope(mdxResult));

    const result = await analyticsMdxTool.handler(
      { query: "SELECT {[Measures].[Revenue],[Measures].[Units]} ON 0 FROM [Sales]" },
      ctx,
    );

    expect(result.isError).toBeUndefined();
    const content = JSON.parse(result.content[0]!.text);
    expect(content.columns).toEqual(["Revenue", "Units"]);
    expect(content.rows).toHaveLength(2);
    expect(content.rowCount).toBe(2);
    expect(content.columnCount).toBe(2);
  });
});

// ── iris_analytics_cubes ──────────────────────────────────────

describe("iris_analytics_cubes", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should have scope NS", () => {
    expect(analyticsCubesTool.scope).toBe("NS");
  });

  it("should have destructiveHint: false annotation", () => {
    expect(analyticsCubesTool.annotations.destructiveHint).toBe(false);
  });

  it("should list cubes via GET", async () => {
    // Story 11.4 Bug #14: lastBuildTime is converted from $HOROLOG to ISO and
    // the raw string is preserved in lastBuildTimeRaw. "2026-01-01" is not a
    // valid $HOROLOG (no comma) so the ISO field becomes "" but the raw value
    // is kept so callers can still debug unexpected server payloads.
    const cubeList = {
      cubes: [
        { name: "MyCube", sourceClass: "My.CubeClass", factCount: 100, lastBuildTime: "2026-01-01" },
      ],
      count: 1,
    };
    mockHttp.get.mockResolvedValue(envelope(cubeList));

    const result = await analyticsCubesTool.handler(
      { action: "list" },
      ctx,
    );

    expect(mockHttp.get).toHaveBeenCalledWith(
      expect.stringContaining("/api/executemcp/v2/analytics/cubes?namespace=USER"),
    );
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      cubes: [
        {
          name: "MyCube",
          sourceClass: "My.CubeClass",
          factCount: 100,
          lastBuildTime: "",
          lastBuildTimeRaw: "2026-01-01",
        },
      ],
      count: 1,
    });
  });

  it("should list cubes with custom namespace", async () => {
    mockHttp.get.mockResolvedValue(envelope({ cubes: [], count: 0 }));

    await analyticsCubesTool.handler(
      { action: "list", namespace: "ANALYTICS" },
      ctx,
    );

    expect(mockHttp.get).toHaveBeenCalledWith(
      expect.stringContaining("namespace=ANALYTICS"),
    );
  });

  it("should build a cube via POST", async () => {
    const buildResult = { cube: "MyCube", action: "build", status: "completed" };
    mockHttp.post.mockResolvedValue(envelope(buildResult));

    const result = await analyticsCubesTool.handler(
      { action: "build", cube: "MyCube" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/analytics/cubes",
      { action: "build", cube: "MyCube", namespace: "USER" },
    );
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual(buildResult);
  });

  it("should sync a cube via POST", async () => {
    const syncResult = {
      cube: "MyCube",
      action: "sync",
      status: "completed",
      factsUpdated: 5,
    };
    mockHttp.post.mockResolvedValue(envelope(syncResult));

    const result = await analyticsCubesTool.handler(
      { action: "sync", cube: "MyCube" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/analytics/cubes",
      { action: "sync", cube: "MyCube", namespace: "USER" },
    );
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual(syncResult);
  });

  it("should return error when build is called without cube", async () => {
    const result = await analyticsCubesTool.handler(
      { action: "build" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("'cube' is required");
  });

  it("should return error when sync is called without cube", async () => {
    const result = await analyticsCubesTool.handler(
      { action: "sync" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("'cube' is required");
  });

  it("should handle IrisApiError gracefully", async () => {
    mockHttp.get.mockRejectedValue(
      new IrisApiError(
        500,
        [],
        "/api/executemcp/v2/analytics/cubes",
        "Internal error",
      ),
    );

    const result = await analyticsCubesTool.handler(
      { action: "list" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("Error managing cubes");
  });

  it("should rethrow non-IrisApiError errors", async () => {
    mockHttp.get.mockRejectedValue(new Error("Connection reset"));

    await expect(
      analyticsCubesTool.handler({ action: "list" }, ctx),
    ).rejects.toThrow("Connection reset");
  });

  it("should handle non-envelope response for list", async () => {
    const plainResponse = { cubes: [], count: 0 };
    mockHttp.get.mockResolvedValue(plainResponse);

    const result = await analyticsCubesTool.handler(
      { action: "list" },
      ctx,
    );

    expect(result.structuredContent).toEqual(plainResponse);
  });

  it("should use resolveNamespace for build action", async () => {
    mockHttp.post.mockResolvedValue(envelope({ status: "completed" }));

    await analyticsCubesTool.handler(
      { action: "build", cube: "TestCube", namespace: "PROD" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ namespace: "PROD" }),
    );
  });

  it("should list cubes without requiring cube parameter", async () => {
    mockHttp.get.mockResolvedValue(envelope({ cubes: [], count: 0 }));

    const result = await analyticsCubesTool.handler(
      { action: "list" },
      ctx,
    );

    expect(result.isError).toBeUndefined();
    expect(mockHttp.get).toHaveBeenCalled();
    expect(mockHttp.post).not.toHaveBeenCalled();
  });

  // Bug #14: lastBuildTime was being forwarded as the raw $HOROLOG string
  // (e.g. "67360,85964.1540167") instead of a human-readable ISO 8601
  // timestamp. Fix: convert in the TS layer on `list`, preserve the raw
  // form under `lastBuildTimeRaw` so debugging and round-trip stay possible.
  it("converts lastBuildTime horolog to ISO 8601 and preserves raw (Bug #14)", async () => {
    const cubeList = {
      cubes: [
        {
          name: "MYCUBE",
          sourceClass: "My.CubeClass",
          factCount: 100,
          lastBuildTime: "67360,85964.1540167",
        },
      ],
      count: 1,
    };
    mockHttp.get.mockResolvedValue(envelope(cubeList));

    const result = await analyticsCubesTool.handler(
      { action: "list" },
      ctx,
    );

    const structured = result.structuredContent as {
      cubes: Array<Record<string, unknown>>;
      count: number;
    };
    expect(structured.cubes[0]?.lastBuildTime).toBe(
      "2025-06-04T23:52:44.154Z",
    );
    expect(structured.cubes[0]?.lastBuildTimeRaw).toBe(
      "67360,85964.1540167",
    );
    // Other fields preserved.
    expect(structured.cubes[0]?.name).toBe("MYCUBE");
    expect(structured.cubes[0]?.factCount).toBe(100);
  });

  // Bug #14: robustness — empty string, undefined, and garbage must never
  // throw; the ISO field becomes "" and the raw value is preserved when
  // it's a string. This guards against unexpected server payloads.
  it("handles missing/malformed horolog gracefully (Bug #14)", async () => {
    const cubeList = {
      cubes: [
        { name: "CUBE_EMPTY", lastBuildTime: "" },
        { name: "CUBE_GARBAGE", lastBuildTime: "garbage" },
        { name: "CUBE_MISSING" }, // no lastBuildTime field at all
      ],
      count: 3,
    };
    mockHttp.get.mockResolvedValue(envelope(cubeList));

    const result = await analyticsCubesTool.handler(
      { action: "list" },
      ctx,
    );

    expect(result.isError).toBeUndefined();
    const structured = result.structuredContent as {
      cubes: Array<Record<string, unknown>>;
    };
    // Empty input — ISO empty, raw preserved.
    expect(structured.cubes[0]?.lastBuildTime).toBe("");
    expect(structured.cubes[0]?.lastBuildTimeRaw).toBe("");
    // Garbage input — ISO empty (no comma → early return), raw preserved.
    expect(structured.cubes[1]?.lastBuildTime).toBe("");
    expect(structured.cubes[1]?.lastBuildTimeRaw).toBe("garbage");
    // Missing field — ISO empty, raw becomes "" (not a string).
    expect(structured.cubes[2]?.lastBuildTime).toBe("");
    expect(structured.cubes[2]?.lastBuildTimeRaw).toBe("");
  });

  // Bug #14: horologToIso is exported so round-trip sanity tests can assert
  // specific conversions without threading them through the handler.
  it("horologToIso converts known horolog pairs deterministically (Bug #14)", () => {
    // 67360,85964.1540167 → 2025-06-04 23:52:44.154 UTC (computed via the
    // same formula IRIS uses: epoch 1840-12-31, days*86400+seconds).
    expect(horologToIso("67360,85964.1540167")).toBe(
      "2025-06-04T23:52:44.154Z",
    );
    // Day 1 second 0 → 1841-01-01T00:00:00.000Z
    expect(horologToIso("1,0")).toBe("1841-01-01T00:00:00.000Z");
    // Bad inputs — empty string.
    expect(horologToIso("")).toBe("");
    expect(horologToIso("nope")).toBe("");
    expect(horologToIso(null as unknown)).toBe("");
    expect(horologToIso(undefined as unknown)).toBe("");
    expect(horologToIso(123 as unknown)).toBe("");
  });
});
