import { describe, it, expect, beforeEach } from "vitest";
import type { ToolContext } from "@iris-mcp/shared";
import { IrisApiError } from "@iris-mcp/shared";
import {
  ruleListTool,
  ruleGetTool,
} from "../tools/rule.js";
import { createMockHttp, createMockCtx, envelope } from "@iris-mcp/shared/test-helpers";

// ── iris.rule.list ─────────────────────────────────────────────

describe("iris.rule.list", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should have correct tool metadata", () => {
    expect(ruleListTool.name).toBe("iris.rule.list");
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
});

// ── iris.rule.get ──────────────────────────────────────────────

describe("iris.rule.get", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should have correct tool metadata", () => {
    expect(ruleGetTool.name).toBe("iris.rule.get");
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
