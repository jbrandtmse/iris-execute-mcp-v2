import { describe, it, expect, beforeEach } from "vitest";
import type { ToolContext } from "@iris-mcp/shared";
import { IrisApiError } from "@iris-mcp/shared";
import {
  productionManageTool,
  productionControlTool,
  productionStatusTool,
  productionSummaryTool,
} from "../tools/production.js";
import { createMockHttp, createMockCtx, envelope } from "@iris-mcp/shared/test-helpers";

// ── iris_production_manage ────────────��────────────────────────

describe("iris_production_manage", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should send POST with create action and name in body", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "created", name: "MyApp.Production" }),
    );

    const result = await productionManageTool.handler(
      { action: "create", name: "MyApp.Production" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/interop/production",
      expect.objectContaining({
        action: "create",
        name: "MyApp.Production",
        namespace: "USER",
      }),
    );

    const structured = result.structuredContent as { action: string; name: string };
    expect(structured.action).toBe("created");
    expect(structured.name).toBe("MyApp.Production");
    expect(result.isError).toBeUndefined();
  });

  it("should send POST with delete action", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "deleted", name: "MyApp.Production" }),
    );

    const result = await productionManageTool.handler(
      { action: "delete", name: "MyApp.Production" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/interop/production",
      expect.objectContaining({
        action: "delete",
        name: "MyApp.Production",
      }),
    );

    const structured = result.structuredContent as { action: string; name: string };
    expect(structured.action).toBe("deleted");
  });

  it("passes an orphan delete's orphanRemoved flag through verbatim (Story 38.0, DW-55)", async () => {
    // Shape the deployed handler returns when only the Ens.Config.Production row
    // remained (live-captured 2026-10-15 by InteropProductionDeleteTest's route).
    const orphanResult = {
      action: "deleted",
      name: "ExecuteMCPv2.Temp.Story380Orphan",
      orphanRemoved: true,
    };
    mockHttp.post.mockResolvedValue(envelope(orphanResult));

    const result = await productionManageTool.handler(
      { action: "delete", name: "ExecuteMCPv2.Temp.Story380Orphan" },
      ctx,
    );

    expect(result.structuredContent).toEqual(orphanResult);
    expect(result.isError).toBeUndefined();
  });

  it("description names the refused delete states and the orphan cleanup (Story 38.0, DW-54/DW-55)", () => {
    const desc = productionManageTool.description ?? "";
    expect(desc).toContain("current production must be Stopped");
    for (const state of ["Running", "Suspended", "Troubled", "NetworkStopped"]) {
      expect(desc).toContain(state);
    }
    expect(desc).toContain("nothing is deleted");
    expect(desc).toContain("Ens.Config.Production row remains");
    expect(desc).toContain("orphanRemoved: true");
    // The old blanket claim ("must be stopped first") is superseded.
    expect(desc).not.toContain("must be stopped first");
  });

  it("description says delete accepts only a production class and refuses any other (Story 38.7, DW-533)", () => {
    const desc = productionManageTool.description ?? "";
    expect(desc).toContain(
      "'delete' accepts only a production class (one that extends Ens.Production): any other class is refused and nothing is deleted.",
    );
  });

  it("maps the delete refusal for a class that is not a production to isError with IRIS's text (Story 38.7, DW-533)", async () => {
    const text =
      "Class 'MyApp.Plain' is not a production class (it does not extend Ens.Production), so nothing was deleted. Name a production class.";
    // The shape the shared client throws for an Atelier-level error in an HTTP 200 envelope (http-client.ts),
    // with the error entry as the route answered it live on 2026-10-16 (IRIS 2026.2 build 221U).
    mockHttp.post.mockRejectedValue(
      new IrisApiError(
        200,
        [{ error: `ERROR #5001: ${text}` }],
        "/api/executemcp/v2/interop/production",
        "IRIS reported errors for POST /api/executemcp/v2/interop/production. Review the error details and correct the request.",
        {},
      ),
    );

    const result = await productionManageTool.handler({ action: "delete", name: "MyApp.Plain" }, ctx);

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(result.content[0]?.text).toBe(
      "Error managing production 'MyApp.Plain': IRIS reported errors for POST /api/executemcp/v2/interop/production. " +
        `Review the error details and correct the request. Details: ERROR #5001: ${text}`,
    );
  });

  it("should pass resolved namespace in body", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "created", name: "Test.Prod" }),
    );

    await productionManageTool.handler(
      { action: "create", name: "Test.Prod", namespace: "MYNS" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/interop/production",
      expect.objectContaining({ namespace: "MYNS" }),
    );
  });

  it("should return isError on IrisApiError", async () => {
    mockHttp.post.mockRejectedValue(
      new IrisApiError(400, [{ error: "Invalid" }], "/api/executemcp/v2/interop/production", "Production error"),
    );

    const result = await productionManageTool.handler(
      { action: "create", name: "Bad.Prod" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Error managing production");
    expect(result.content[0]?.text).toContain("Bad.Prod");
  });

  it("should propagate non-IrisApiError exceptions", async () => {
    mockHttp.post.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      productionManageTool.handler({ action: "create", name: "Test" }, ctx),
    ).rejects.toThrow("ECONNREFUSED");
  });

  it("should have destructiveHint: true annotation", () => {
    expect(productionManageTool.annotations).toEqual({
      destructiveHint: true,
      readOnlyHint: false,
      idempotentHint: false,
      openWorldHint: false,
    });
  });

  it("should have scope NS", () => {
    expect(productionManageTool.scope).toBe("NS");
  });

  // AC 12.3.6 — create action returns created envelope with name
  it("create action returns created envelope with name", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "created", name: "TESTMCP.Prod" }),
    );

    const result = await productionManageTool.handler(
      { action: "create", name: "TESTMCP.Prod", namespace: "HSCUSTOM" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/interop/production",
      expect.objectContaining({
        action: "create",
        name: "TESTMCP.Prod",
        namespace: "HSCUSTOM",
      }),
    );

    const structured = result.structuredContent as { action: string; name: string };
    expect(structured.action).toBe("created");
    expect(structured.name).toBe("TESTMCP.Prod");
    expect(result.isError).toBeUndefined();
  });

  // AC 12.3.6 — create action rejects empty name at Zod layer
  it("create action rejects empty name at Zod layer", () => {
    const result = productionManageTool.inputSchema.safeParse({
      action: "create",
      name: "",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain("empty");
    }
  });
});

// ── iris_production_control ────────────────────────────────────

describe("iris_production_control", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should send POST for start with name in body", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "started", name: "MyApp.Production" }),
    );

    const result = await productionControlTool.handler(
      { action: "start", name: "MyApp.Production" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/interop/production/control",
      expect.objectContaining({
        action: "start",
        name: "MyApp.Production",
        namespace: "USER",
      }),
    );

    const structured = result.structuredContent as { action: string; name: string };
    expect(structured.action).toBe("started");
  });

  it("should send POST for stop action", async () => {
    mockHttp.post.mockResolvedValue(envelope({ action: "stopped" }));

    await productionControlTool.handler({ action: "stop" }, ctx);

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/interop/production/control",
      expect.objectContaining({ action: "stop" }),
    );
  });

  // AC 12.2.4 — stop action returns success envelope (structuredContent shape)
  it("stop action returns success envelope", async () => {
    mockHttp.post.mockResolvedValue(envelope({ action: "stopped" }));

    const result = await productionControlTool.handler({ action: "stop" }, ctx);

    const structured = result.structuredContent as { action: string };
    expect(structured.action).toBe("stopped");
    expect(result.isError).toBeUndefined();
  });

  it("should send POST for restart with name", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "restarted", name: "MyApp.Production" }),
    );

    await productionControlTool.handler(
      { action: "restart", name: "MyApp.Production" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/interop/production/control",
      expect.objectContaining({ action: "restart", name: "MyApp.Production" }),
    );
  });

  // AC 12.2.4 — restart action forwards name + timeout + force
  it("restart action forwards name + timeout + force", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "restarted", name: "MyApp.Production" }),
    );

    await productionControlTool.handler(
      { action: "restart", name: "MyApp.Production", timeout: 90, force: true },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/interop/production/control",
      expect.objectContaining({
        action: "restart",
        name: "MyApp.Production",
        timeout: 90,
        force: true,
      }),
    );
  });

  // CR 20.0-1 — timeout/force honored only by stop/restart; documented per-action so the
  // advertised contract matches the server (recover/update/start/clean ignore them).
  it("documents timeout/force as honored only by stop and restart", () => {
    const shape = (
      productionControlTool.inputSchema as unknown as {
        shape: {
          timeout: { description?: string };
          force: { description?: string };
        };
      }
    ).shape;
    const timeoutDesc = shape.timeout.description ?? "";
    const forceDesc = shape.force.description ?? "";
    expect(timeoutDesc).toContain("stop");
    expect(timeoutDesc).toContain("restart");
    expect(forceDesc).toContain("stop");
    expect(forceDesc).toContain("restart");
    // The tool description states the per-action applicability explicitly.
    expect(productionControlTool.description).toContain(
      "IGNORED for 'start', 'update', 'recover', and 'clean'",
    );
  });

  it("should send POST for update action", async () => {
    mockHttp.post.mockResolvedValue(envelope({ action: "updated" }));

    await productionControlTool.handler({ action: "update" }, ctx);

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/interop/production/control",
      expect.objectContaining({ action: "update" }),
    );
  });

  it("should send POST for recover action", async () => {
    mockHttp.post.mockResolvedValue(envelope({ action: "recovered" }));

    await productionControlTool.handler({ action: "recover" }, ctx);

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/interop/production/control",
      expect.objectContaining({ action: "recover" }),
    );
  });

  it("should include optional timeout and force when provided", async () => {
    mockHttp.post.mockResolvedValue(envelope({ action: "stopped" }));

    await productionControlTool.handler(
      { action: "stop", timeout: 60, force: true },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/interop/production/control",
      expect.objectContaining({ timeout: 60, force: true }),
    );
  });

  it("should return isError on IrisApiError", async () => {
    mockHttp.post.mockRejectedValue(
      new IrisApiError(500, [{ error: "Failed" }], "/api/executemcp/v2/interop/production/control", "Control error"),
    );

    const result = await productionControlTool.handler(
      { action: "start", name: "Test" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Error controlling production");
  });

  it("should propagate non-IrisApiError exceptions", async () => {
    mockHttp.post.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      productionControlTool.handler({ action: "start", name: "Test" }, ctx),
    ).rejects.toThrow("ECONNREFUSED");
  });

  it("should have destructiveHint: true annotation", () => {
    expect(productionControlTool.annotations).toEqual({
      destructiveHint: true,
      readOnlyHint: false,
      idempotentHint: false,
      openWorldHint: false,
    });
  });

  it("should have scope NS", () => {
    expect(productionControlTool.scope).toBe("NS");
  });

  it("should reject start without name via Zod refinement", () => {
    const result = productionControlTool.inputSchema.safeParse({ action: "start" });
    expect(result.success).toBe(false);
  });

  it("should reject restart without name via Zod refinement", () => {
    const result = productionControlTool.inputSchema.safeParse({ action: "restart" });
    expect(result.success).toBe(false);
  });

  it("should accept stop without name via Zod refinement", () => {
    const result = productionControlTool.inputSchema.safeParse({ action: "stop" });
    expect(result.success).toBe(true);
  });

  it("should accept start with name via Zod refinement", () => {
    const result = productionControlTool.inputSchema.safeParse({
      action: "start",
      name: "MyApp.Production",
    });
    expect(result.success).toBe(true);
  });

  // ── Story 20.0: clean action ───────────────────────────────────────

  // AC 20.0.1 / 20.0.2 — clean default (no killAppData) routes cleaned/killAppData:0
  it("clean default (no killAppData) sends action=clean and returns cleaned shape", async () => {
    mockHttp.post.mockResolvedValue(envelope({ action: "cleaned", killAppData: 0 }));

    const result = await productionControlTool.handler({ action: "clean" }, ctx);

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/interop/production/control",
      expect.objectContaining({ action: "clean", namespace: "USER" }),
    );
    // killAppData/confirm are NOT forwarded when omitted (conditional append).
    const body = mockHttp.post.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(body).not.toHaveProperty("killAppData");
    expect(body).not.toHaveProperty("confirm");

    const structured = result.structuredContent as { action: string; killAppData: number };
    expect(structured.action).toBe("cleaned");
    expect(structured.killAppData).toBe(0);
    expect(result.isError).toBeUndefined();
  });

  // AC 20.0.3 — killAppData:true,confirm:true forwards both fields
  it("clean with killAppData:true and confirm:true forwards both", async () => {
    mockHttp.post.mockResolvedValue(envelope({ action: "cleaned", killAppData: 1 }));

    await productionControlTool.handler(
      { action: "clean", killAppData: true, confirm: true },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/interop/production/control",
      expect.objectContaining({
        action: "clean",
        killAppData: true,
        confirm: true,
      }),
    );
  });

  // AC 20.0.3 — killAppData:true without confirm still forwards to the server,
  // which performs the double-gate refusal (the guard is IRIS-side by design so
  // it cannot be bypassed). The TS handler must not silently drop killAppData.
  it("clean with killAppData:true but no confirm still forwards killAppData (server double-gates)", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "cleaned", killAppData: 0 }),
    );

    await productionControlTool.handler(
      { action: "clean", killAppData: true },
      ctx,
    );

    const body = mockHttp.post.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(body.killAppData).toBe(true);
    expect(body).not.toHaveProperty("confirm");
  });

  it("should accept clean via Zod refinement (name not required)", () => {
    const result = productionControlTool.inputSchema.safeParse({ action: "clean" });
    expect(result.success).toBe(true);
  });

  it("schema exposes killAppData and confirm fields", () => {
    const shape = productionControlTool.inputSchema.shape as Record<string, unknown>;
    expect(shape).toHaveProperty("killAppData");
    expect(shape).toHaveProperty("confirm");
  });

  // AC 20.0.5 — clean is truthfully mutates:write AND marked defaultEnabled.
  it("declares mutates:{clean:write} and defaultEnabled:[clean]; destructiveHint stays true", () => {
    expect(productionControlTool.mutates).toEqual({ clean: "write" });
    expect(productionControlTool.defaultEnabled).toEqual(["clean"]);
    expect(productionControlTool.annotations.destructiveHint).toBe(true);
  });

  // AC 20.0.7 — the 5 existing actions' request bodies + output shapes unchanged.
  // Full-object toEqual on the body forwarded per action (mechanical back-compat).
  it("existing actions forward byte-for-byte unchanged bodies (AC 20.0.7)", async () => {
    const cases: Array<{ args: Record<string, unknown>; body: Record<string, unknown> }> = [
      {
        args: { action: "start", name: "P.Prod" },
        body: { action: "start", namespace: "USER", name: "P.Prod" },
      },
      {
        args: { action: "stop", timeout: 60, force: true },
        body: { action: "stop", namespace: "USER", timeout: 60, force: true },
      },
      {
        args: { action: "restart", name: "P.Prod", timeout: 90, force: false },
        body: { action: "restart", namespace: "USER", name: "P.Prod", timeout: 90, force: false },
      },
      {
        args: { action: "update" },
        body: { action: "update", namespace: "USER" },
      },
      {
        args: { action: "recover" },
        body: { action: "recover", namespace: "USER" },
      },
    ];

    for (const { args, body } of cases) {
      mockHttp.post.mockReset();
      mockHttp.post.mockResolvedValue(envelope({ action: `${args.action}ed` }));
      await productionControlTool.handler(args, ctx);
      expect(mockHttp.post).toHaveBeenCalledTimes(1);
      const sent = mockHttp.post.mock.calls[0]?.[1] as Record<string, unknown>;
      // Full-object equality: no field added or dropped for existing actions.
      expect(sent).toEqual(body);
    }
  });
});

// ─��� iris_production_status ─────────────────────────────────────

describe("iris_production_status", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should send GET with namespace query param", async () => {
    const statusData = { name: "MyApp.Production", state: "Running", stateCode: 1 };
    mockHttp.get.mockResolvedValue(envelope(statusData));

    const result = await productionStatusTool.handler({}, ctx);

    expect(mockHttp.get).toHaveBeenCalledWith(
      expect.stringContaining("/api/executemcp/v2/interop/production/status"),
    );

    const structured = result.structuredContent as typeof statusData;
    expect(structured.name).toBe("MyApp.Production");
    expect(structured.state).toBe("Running");
    expect(structured.stateCode).toBe(1);
    expect(result.isError).toBeUndefined();
  });

  it("should include detail=1 query param when detail is true", async () => {
    mockHttp.get.mockResolvedValue(
      envelope({ name: "Test.Prod", state: "Running", stateCode: 1, items: [] }),
    );

    await productionStatusTool.handler({ detail: true }, ctx);

    const calledPath = mockHttp.get.mock.calls[0]?.[0] as string;
    expect(calledPath).toContain("detail=1");
  });

  it("should pass namespace query param from resolved namespace", async () => {
    mockHttp.get.mockResolvedValue(
      envelope({ name: "", state: "Stopped", stateCode: 2 }),
    );

    await productionStatusTool.handler({ namespace: "MYNS" }, ctx);

    const calledPath = mockHttp.get.mock.calls[0]?.[0] as string;
    expect(calledPath).toContain("namespace=MYNS");
  });

  it("should return isError on IrisApiError", async () => {
    mockHttp.get.mockRejectedValue(
      new IrisApiError(500, [{ error: "Server error" }], "/api/executemcp/v2/interop/production/status", "Server error"),
    );

    const result = await productionStatusTool.handler({}, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Error getting production status");
  });

  it("should propagate non-IrisApiError exceptions", async () => {
    mockHttp.get.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      productionStatusTool.handler({}, ctx),
    ).rejects.toThrow("ECONNREFUSED");
  });

  it("should have readOnlyHint: true annotation", () => {
    expect(productionStatusTool.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it("should have scope NS", () => {
    expect(productionStatusTool.scope).toBe("NS");
  });
});

// ── iris_production_summary ────────────────────────────────────

describe("iris_production_summary", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should send GET to summary endpoint with no namespace", async () => {
    const summaryData = [
      { namespace: "HSCUSTOM", name: "MyApp.Production", state: "Running", stateCode: 1 },
      { namespace: "USER", name: "Test.Production", state: "Stopped", stateCode: 2 },
    ];
    mockHttp.get.mockResolvedValue(envelope(summaryData));

    const result = await productionSummaryTool.handler({}, ctx);

    expect(mockHttp.get).toHaveBeenCalledWith(
      "/api/executemcp/v2/interop/production/summary",
    );

    const structured = result.structuredContent as {
      productions: typeof summaryData;
      count: number;
    };
    expect(structured.productions).toHaveLength(2);
    expect(structured.count).toBe(2);
    expect(structured.productions[0]?.namespace).toBe("HSCUSTOM");
    expect(result.isError).toBeUndefined();
  });

  it("should handle empty production list", async () => {
    mockHttp.get.mockResolvedValue(envelope([]));

    const result = await productionSummaryTool.handler({}, ctx);

    const structured = result.structuredContent as {
      productions: unknown[];
      count: number;
    };
    expect(structured.productions).toEqual([]);
    expect(structured.count).toBe(0);
  });

  it("should use scope NONE (no namespace concept)", () => {
    expect(productionSummaryTool.scope).toBe("NONE");
  });

  it("should return isError on IrisApiError", async () => {
    mockHttp.get.mockRejectedValue(
      new IrisApiError(500, [{ error: "Server error" }], "/api/executemcp/v2/interop/production/summary", "Server error"),
    );

    const result = await productionSummaryTool.handler({}, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Error getting production summary");
  });

  it("should propagate non-IrisApiError exceptions", async () => {
    mockHttp.get.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      productionSummaryTool.handler({}, ctx),
    ).rejects.toThrow("ECONNREFUSED");
  });

  it("should have readOnlyHint: true annotation", () => {
    expect(productionSummaryTool.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it("should accept cursor parameter in schema", () => {
    const shape = productionSummaryTool.inputSchema.shape as Record<string, unknown>;
    expect(shape).toHaveProperty("cursor");
  });
});

// -- Story 43.3: confirmation (clean) --------------------------

describe("Story 43.3: confirmation (clean)", () => {
  const CONTROL_PATH = "/api/executemcp/v2/interop/production/control";
  const WIPE_OPERATION = "clean the production and wipe its persistent business state";
  const WIPE_SCOPE =
    "all Ens.AppData business state: HL7 sequence numbers, file and FTP done-file tables, " +
    "batch and control-number state; already-processed data can be ingested again";
  const WIPE_ARGS = { action: "clean", killAppData: true, confirm: true };

  type ConfirmFn = NonNullable<ToolContext["confirm"]>;
  type ConfirmRequest = Parameters<ConfirmFn>[0];
  type ConfirmOutcome = Awaited<ReturnType<ConfirmFn>>;

  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    mockHttp.post.mockResolvedValue(envelope({ action: "cleaned", killAppData: 1 }));
    ctx = createMockCtx(mockHttp);
  });

  /**
   * A hand-written confirm that records every request, and how many POSTs had been made when it was
   * asked, and answers with `answer`.
   */
  function recordingConfirm(answer: ConfirmOutcome) {
    const requests: ConfirmRequest[] = [];
    const postsBefore: number[] = [];
    const confirm: ConfirmFn = async (request) => {
      requests.push(request);
      postsBefore.push(mockHttp.post.mock.calls.length);
      return answer;
    };
    return { confirm, requests, postsBefore };
  }

  it("asks once with the fixed operation, the namespace target and the wipe scope, before the POST", async () => {
    const { confirm, requests, postsBefore } = recordingConfirm({ proceed: true });

    await productionControlTool.handler(WIPE_ARGS, { ...ctx, confirm });

    expect(requests).toStrictEqual([
      { operation: WIPE_OPERATION, target: "namespace USER", scope: WIPE_SCOPE },
    ]);
    expect(postsBefore).toEqual([0]);
    expect(mockHttp.post).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a name", { ...WIPE_ARGS, name: "MyApp.Production" }, "namespace USER, production MyApp.Production"],
    ["an explicit namespace", { ...WIPE_ARGS, namespace: "MYNS" }, "namespace MYNS"],
    [
      "a name and an explicit namespace",
      { ...WIPE_ARGS, name: "MyApp.Production", namespace: "MYNS" },
      "namespace MYNS, production MyApp.Production",
    ],
  ])("states the target when the call gives %s", async (_label, args, target) => {
    const { confirm, requests } = recordingConfirm({ proceed: true });

    await productionControlTool.handler(args, { ...ctx, confirm });

    expect(requests).toStrictEqual([{ operation: WIPE_OPERATION, target, scope: WIPE_SCOPE }]);
  });

  const notAsked: Array<[string, Record<string, unknown>, Record<string, unknown>]> = [
    ["clean without killAppData", { action: "clean" }, { action: "clean", namespace: "USER" }],
    [
      "clean with confirm and no killAppData",
      { action: "clean", confirm: true },
      { action: "clean", namespace: "USER", confirm: true },
    ],
    [
      "clean with killAppData false",
      { action: "clean", killAppData: false, confirm: true },
      { action: "clean", namespace: "USER", killAppData: false, confirm: true },
    ],
    [
      "clean with killAppData true and confirm missing",
      { action: "clean", killAppData: true },
      { action: "clean", namespace: "USER", killAppData: true },
    ],
    [
      "clean with killAppData true and confirm false",
      { action: "clean", killAppData: true, confirm: false },
      { action: "clean", namespace: "USER", killAppData: true, confirm: false },
    ],
  ];

  it.each(notAsked)("does not ask for %s, and the request still goes to IRIS", async (_label, args, body) => {
    const { confirm, requests } = recordingConfirm({ proceed: true });

    await productionControlTool.handler(args, { ...ctx, confirm });

    expect(requests).toHaveLength(0);
    expect(mockHttp.post.mock.calls).toStrictEqual([[CONTROL_PATH, body]]);
  });

  const otherActions: Array<[string, Record<string, unknown>, Record<string, unknown>]> = [
    ["start", { action: "start", name: "P.Prod" }, { action: "start", namespace: "USER", name: "P.Prod" }],
    ["stop", { action: "stop" }, { action: "stop", namespace: "USER" }],
    ["restart", { action: "restart", name: "P.Prod" }, { action: "restart", namespace: "USER", name: "P.Prod" }],
    ["update", { action: "update" }, { action: "update", namespace: "USER" }],
    ["recover", { action: "recover" }, { action: "recover", namespace: "USER" }],
  ];

  it.each(otherActions)("does not ask for %s", async (_label, args, body) => {
    const { confirm, requests } = recordingConfirm({ proceed: true });

    await productionControlTool.handler(args, { ...ctx, confirm });

    expect(requests).toHaveLength(0);
    expect(mockHttp.post.mock.calls).toStrictEqual([[CONTROL_PATH, body]]);
  });

  it.each(otherActions)("does not ask for %s even when killAppData and confirm are true", async (_label, args, body) => {
    const { confirm, requests } = recordingConfirm({ proceed: true });

    await productionControlTool.handler({ ...args, killAppData: true, confirm: true }, { ...ctx, confirm });

    expect(requests).toHaveLength(0);
    expect(mockHttp.post.mock.calls).toStrictEqual([
      [CONTROL_PATH, { ...body, killAppData: true, confirm: true }],
    ]);
  });

  it("returns a declined outcome unchanged and makes no POST", async () => {
    const declinedResult = {
      content: [{ type: "text" as const, text: "The person declined the confirmation." }],
      isError: true,
    };
    const { confirm, requests } = recordingConfirm({ proceed: false, result: declinedResult });

    const result = await productionControlTool.handler(WIPE_ARGS, { ...ctx, confirm });

    expect(result).toBe(declinedResult);
    expect(requests).toHaveLength(1);
    expect(mockHttp.post).not.toHaveBeenCalled();
  });

  it.each([
    ["no name", WIPE_ARGS, { action: "clean", namespace: "USER", killAppData: true, confirm: true }],
    [
      "a name",
      { ...WIPE_ARGS, name: "MyApp.Production" },
      { action: "clean", namespace: "USER", name: "MyApp.Production", killAppData: true, confirm: true },
    ],
  ])("posts exactly as it does without a confirm when the outcome is proceed (%s)", async (_label, args, body) => {
    const without = await productionControlTool.handler(args, ctx);
    const withoutCalls = [...mockHttp.post.mock.calls];
    mockHttp.post.mockClear();

    const { confirm } = recordingConfirm({ proceed: true });
    const result = await productionControlTool.handler(args, { ...ctx, confirm });

    expect(withoutCalls).toStrictEqual([[CONTROL_PATH, body]]);
    expect(mockHttp.post.mock.calls).toStrictEqual(withoutCalls);
    expect(result).toStrictEqual(without);
    expect(result.structuredContent).toEqual({ action: "cleaned", killAppData: 1 });
    expect(result.isError).toBeUndefined();
  });

  it("runs as it does today when the context has no confirm", async () => {
    expect(ctx.confirm).toBeUndefined();

    const result = await productionControlTool.handler(WIPE_ARGS, ctx);

    expect(mockHttp.post.mock.calls).toStrictEqual([
      [CONTROL_PATH, { action: "clean", namespace: "USER", killAppData: true, confirm: true }],
    ]);
    expect(result.structuredContent).toEqual({ action: "cleaned", killAppData: 1 });
    expect(result.isError).toBeUndefined();
  });
});
