import { describe, it, expect, beforeEach } from "vitest";
import type { ToolContext } from "@iris-mcp/shared";
import { IrisApiError } from "@iris-mcp/shared";
import { serviceManageTool } from "../tools/service.js";
import {
  createMockHttp,
  createMockCtx,
  envelope,
} from "@iris-mcp/shared/test-helpers";

// ── iris_service_manage ────────────────────────────────────────

describe("iris_service_manage", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  // ── list ──────────────────────────────────────────────────────

  it("list: GETs the service endpoint and returns services + count", async () => {
    const serviceData = [
      {
        name: "%Service_CallIn",
        enabled: true,
        public: "No",
        description: "Allow CallIn interface",
      },
      {
        name: "%Service_Telnet",
        enabled: false,
        public: "No",
        description: "Telnet server",
      },
    ];
    mockHttp.get.mockResolvedValue(envelope(serviceData));

    const result = await serviceManageTool.handler({ action: "list" }, ctx);

    expect(mockHttp.get).toHaveBeenCalledWith(
      "/api/executemcp/v2/security/service",
    );
    const structured = result.structuredContent as {
      services: typeof serviceData;
      count: number;
    };
    expect(structured.services).toHaveLength(2);
    expect(structured.count).toBe(2);
    expect(structured.services[0]?.name).toBe("%Service_CallIn");
    expect(result.isError).toBeUndefined();
  });

  it("list: handles an empty service list", async () => {
    mockHttp.get.mockResolvedValue(envelope([]));

    const result = await serviceManageTool.handler({ action: "list" }, ctx);

    const structured = result.structuredContent as {
      services: unknown[];
      count: number;
    };
    expect(structured.services).toEqual([]);
    expect(structured.count).toBe(0);
  });

  // ── get ───────────────────────────────────────────────────────

  it("get: GETs with the name query parameter and returns properties", async () => {
    const props = {
      name: "%Service_CallIn",
      enabled: true,
      description: "Allow CallIn interface",
      autheEnabled: 64,
      clientSystems: "",
    };
    mockHttp.get.mockResolvedValue(envelope(props));

    const result = await serviceManageTool.handler(
      { action: "get", name: "%Service_CallIn" },
      ctx,
    );

    expect(mockHttp.get).toHaveBeenCalledWith(
      "/api/executemcp/v2/security/service?name=%25Service_CallIn",
    );
    const structured = result.structuredContent as typeof props;
    expect(structured.name).toBe("%Service_CallIn");
    expect(structured.autheEnabled).toBe(64);
    expect(result.isError).toBeUndefined();
  });

  // ── enable / disable round-trip ───────────────────────────────

  it("enable: POSTs action+name and returns the structured result", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "enable", name: "%Service_Telnet", success: true }),
    );

    const result = await serviceManageTool.handler(
      { action: "enable", name: "%Service_Telnet" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/security/service",
      { action: "enable", name: "%Service_Telnet" },
    );
    const structured = result.structuredContent as {
      action: string;
      name: string;
      success: boolean;
    };
    expect(structured.action).toBe("enable");
    expect(structured.success).toBe(true);
    expect(result.isError).toBeUndefined();
  });

  it("disable: POSTs action+name", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "disable", name: "%Service_Telnet", success: true }),
    );

    const result = await serviceManageTool.handler(
      { action: "disable", name: "%Service_Telnet" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/security/service",
      { action: "disable", name: "%Service_Telnet" },
    );
    const structured = result.structuredContent as { action: string };
    expect(structured.action).toBe("disable");
  });

  // ── set ───────────────────────────────────────────────────────

  it("set: POSTs the settings object alongside action+name", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "set", name: "%Service_SQL", success: true }),
    );

    const settings = {
      enabled: true,
      autheEnabled: 32,
      description: "SQL service",
      clientSystems: "10.0.0.1",
    };
    const result = await serviceManageTool.handler(
      { action: "set", name: "%Service_SQL", settings },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/security/service",
      { action: "set", name: "%Service_SQL", settings },
    );
    expect(result.isError).toBeUndefined();
  });

  it("set: rejects a call with no settings (no-op guard) without POSTing", async () => {
    const result = await serviceManageTool.handler(
      { action: "set", name: "%Service_SQL" },
      ctx,
    );

    // An empty `set` would issue a no-op Modify the server reports as success —
    // the tool rejects it up front and never reaches the network.
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("settings");
    expect(mockHttp.post).not.toHaveBeenCalled();
  });

  it("set: rejects an empty settings object (no-op guard)", async () => {
    const result = await serviceManageTool.handler(
      { action: "set", name: "%Service_SQL", settings: {} },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(mockHttp.post).not.toHaveBeenCalled();
  });

  // ── required-name guards ──────────────────────────────────────

  it("get: rejects a missing name without GETting", async () => {
    const result = await serviceManageTool.handler({ action: "get" }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("name");
    expect(mockHttp.get).not.toHaveBeenCalled();
  });

  it("enable: rejects a missing name without POSTing", async () => {
    const result = await serviceManageTool.handler({ action: "enable" }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("name");
    expect(mockHttp.post).not.toHaveBeenCalled();
  });

  // ── error handling ────────────────────────────────────────────

  it("returns isError on IrisApiError, naming the service", async () => {
    mockHttp.post.mockRejectedValue(
      new IrisApiError(
        400,
        [{ error: "Service NoSuch does not exist" }],
        "/api/executemcp/v2/security/service",
        "Service NoSuch does not exist",
      ),
    );

    const result = await serviceManageTool.handler(
      { action: "enable", name: "%Service_NoSuch" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("%Service_NoSuch");
    expect(result.content[0]?.text).toContain("does not exist");
  });

  it("propagates non-IrisApiError exceptions", async () => {
    mockHttp.get.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      serviceManageTool.handler({ action: "list" }, ctx),
    ).rejects.toThrow("ECONNREFUSED");
  });

  // ── tool metadata ─────────────────────────────────────────────

  it("has scope SYS and is mutate-capable (readOnlyHint false)", () => {
    expect(serviceManageTool.scope).toBe("SYS");
    expect(serviceManageTool.annotations.readOnlyHint).toBe(false);
  });

  it("classifies every action in `mutates` (reads vs writes)", () => {
    expect(serviceManageTool.mutates).toEqual({
      list: "read",
      get: "read",
      enable: "write",
      disable: "write",
      set: "write",
    });
  });

  it("declares the action enum with all five actions", () => {
    const shape = serviceManageTool.inputSchema.shape as Record<string, unknown>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const options = (shape.action as any)?.options;
    expect(options).toEqual(["list", "get", "enable", "disable", "set"]);
  });

  it("does NOT declare a reserved `server` field (framework injects it)", () => {
    const shape = serviceManageTool.inputSchema.shape as Record<string, unknown>;
    expect(shape).not.toHaveProperty("server");
  });
});
