import { describe, it, expect, beforeEach } from "vitest";
import type { ToolContext, PaginateResult } from "@iris-mcp/shared";
import { IrisApiError, encodeCursor, decodeCursor } from "@iris-mcp/shared";
import {
  ruleListTool,
  ruleGetTool,
} from "../tools/rule.js";
import { createMockHttp, createMockCtx, envelope } from "@iris-mcp/shared/test-helpers";

// ── iris_rule_list ─────────────────────────────────────────────

describe("iris_rule_list", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should have correct tool metadata", () => {
    expect(ruleListTool.name).toBe("iris_rule_list");
    expect(ruleListTool.annotations?.readOnlyHint).toBe(true);
    expect(ruleListTool.annotations?.destructiveHint).toBe(false);
    expect(ruleListTool.scope).toBe("NS");
  });

  it("should send GET with namespace query param", async () => {
    mockHttp.get.mockResolvedValue(
      envelope({
        rules: [
          { name: "MyPackage.Rules.RoutingRule" },
          { name: "MyPackage.Rules.ValidationRule" },
        ],
        count: 2,
      }),
    );

    const result = await ruleListTool.handler({}, ctx);

    expect(mockHttp.get).toHaveBeenCalledWith(
      expect.stringContaining("/api/executemcp/v2/interop/rule"),
    );
    expect(mockHttp.get).toHaveBeenCalledWith(
      expect.stringContaining("namespace=USER"),
    );

    const structured = result.structuredContent as {
      rules: Array<{ name: string }>;
      count: number;
    };
    expect(structured.rules).toHaveLength(2);
    expect(structured.count).toBe(2);
    expect(result.isError).toBeUndefined();
  });

  it("should pass custom namespace", async () => {
    mockHttp.get.mockResolvedValue(
      envelope({ rules: [], count: 0 }),
    );

    await ruleListTool.handler({ namespace: "PROD" }, ctx);

    expect(mockHttp.get).toHaveBeenCalledWith(
      expect.stringContaining("namespace=PROD"),
    );
  });

  it("should return isError on IrisApiError", async () => {
    mockHttp.get.mockRejectedValue(
      new IrisApiError(500, [{ error: "Server error" }], "/api/executemcp/v2/interop/rule", "List error"),
    );

    const result = await ruleListTool.handler({}, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Error listing business rules");
  });

  it("should rethrow non-IrisApiError", async () => {
    mockHttp.get.mockRejectedValue(new Error("Timeout"));

    await expect(
      ruleListTool.handler({}, ctx),
    ).rejects.toThrow("Timeout");
  });

  // FEAT-3: prefix/filter/pagination

  it("FEAT-3: should filter by prefix (client-side)", async () => {
    mockHttp.get.mockResolvedValue(
      envelope({
        rules: [
          { name: "MyPackage.Rules.RoutingRule" },
          { name: "MyPackage.Rules.ValidationRule" },
          { name: "OtherPackage.Rules.SomeRule" },
        ],
        count: 3,
      }),
    );

    const result = await ruleListTool.handler(
      { prefix: "MyPackage.Rules" },
      ctx,
    );

    const structured = result.structuredContent as {
      rules: Array<{ name: string }>;
      count: number;
      total: number;
    };
    expect(structured.rules).toHaveLength(2);
    expect(structured.total).toBe(2);
    expect(structured.rules.every((r) => r.name.startsWith("MyPackage.Rules"))).toBe(true);
  });

  it("FEAT-3: should filter by substring (case-insensitive, client-side)", async () => {
    mockHttp.get.mockResolvedValue(
      envelope({
        rules: [
          { name: "MyPackage.Rules.RoutingRule" },
          { name: "MyPackage.Rules.routingvalidation" },
          { name: "MyPackage.Rules.ValidationRule" },
        ],
        count: 3,
      }),
    );

    const result = await ruleListTool.handler(
      { filter: "routing" },
      ctx,
    );

    const structured = result.structuredContent as {
      rules: Array<{ name: string }>;
      count: number;
    };
    // Both "RoutingRule" and "routingvalidation" should match (case-insensitive)
    expect(structured.rules).toHaveLength(2);
    expect(structured.rules.some((r) => r.name.includes("RoutingRule"))).toBe(true);
    expect(structured.rules.some((r) => r.name.includes("routingvalidation"))).toBe(true);
  });

  it("FEAT-3: should return nextCursor for pagination", async () => {
    const rules = Array.from({ length: 5 }, (_, i) => ({ name: `Pkg.Rule${i}` }));
    mockHttp.get.mockResolvedValue(
      envelope({ rules, count: 5 }),
    );

    // Use a paginating context that respects pageSize
    const paginatingCtx: ToolContext = {
      ...ctx,
      paginate<T>(items: T[], cursor?: string, pageSize?: number): PaginateResult<T> {
        const offset = decodeCursor(cursor);
        const size = pageSize ?? 100;
        const page = items.slice(offset, offset + size);
        const nextOffset = offset + size;
        const nextCursor = nextOffset < items.length ? encodeCursor(nextOffset) : undefined;
        return { page, nextCursor };
      },
    };

    const result = await ruleListTool.handler(
      { pageSize: 2 },
      paginatingCtx,
    );

    const structured = result.structuredContent as {
      rules: Array<{ name: string }>;
      count: number;
      nextCursor?: string;
    };
    expect(structured.rules).toHaveLength(2);
    expect(structured.nextCursor).toBeDefined();
  });
});

// ── iris_rule_get ──────────────────────────────────────────────

describe("iris_rule_get", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should have correct tool metadata", () => {
    expect(ruleGetTool.name).toBe("iris_rule_get");
    expect(ruleGetTool.annotations?.readOnlyHint).toBe(true);
    expect(ruleGetTool.annotations?.destructiveHint).toBe(false);
    expect(ruleGetTool.scope).toBe("NS");
  });

  it("should send GET with name and namespace query params", async () => {
    mockHttp.get.mockResolvedValue(
      envelope({
        name: "MyPackage.Rules.RoutingRule",
        definition: "Class MyPackage.Rules.RoutingRule Extends Ens.Rule.Definition { ... }",
      }),
    );

    const result = await ruleGetTool.handler(
      { name: "MyPackage.Rules.RoutingRule" },
      ctx,
    );

    expect(mockHttp.get).toHaveBeenCalledWith(
      expect.stringContaining("/api/executemcp/v2/interop/rule/get"),
    );
    expect(mockHttp.get).toHaveBeenCalledWith(
      expect.stringContaining("name=MyPackage.Rules.RoutingRule"),
    );
    expect(mockHttp.get).toHaveBeenCalledWith(
      expect.stringContaining("namespace=USER"),
    );

    const structured = result.structuredContent as {
      name: string;
      definition: string;
    };
    expect(structured.name).toBe("MyPackage.Rules.RoutingRule");
    expect(structured.definition).toContain("RoutingRule");
    expect(result.isError).toBeUndefined();
  });

  it("should pass custom namespace", async () => {
    mockHttp.get.mockResolvedValue(
      envelope({ name: "Test.Rule", definition: "..." }),
    );

    await ruleGetTool.handler({ name: "Test.Rule", namespace: "PROD" }, ctx);

    expect(mockHttp.get).toHaveBeenCalledWith(
      expect.stringContaining("namespace=PROD"),
    );
  });

  it("should return isError on IrisApiError", async () => {
    mockHttp.get.mockRejectedValue(
      new IrisApiError(404, [{ error: "Not found" }], "/api/executemcp/v2/interop/rule/get", "Rule error"),
    );

    const result = await ruleGetTool.handler(
      { name: "NonExistent.Rule" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Error getting rule");
    expect(result.content[0]?.text).toContain("NonExistent.Rule");
  });

  it("should rethrow non-IrisApiError", async () => {
    mockHttp.get.mockRejectedValue(new Error("Network failure"));

    await expect(
      ruleGetTool.handler({ name: "Test.Rule" }, ctx),
    ).rejects.toThrow("Network failure");
  });
});
