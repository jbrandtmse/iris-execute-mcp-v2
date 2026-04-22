import { describe, it, expect, beforeEach } from "vitest";
import type { ToolContext } from "@iris-mcp/shared";
import { IrisApiError } from "@iris-mcp/shared";
import {
  metricsSystemTool,
  metricsAlertsTool,
  metricsInteropTool,
} from "../tools/metrics.js";
import {
  createMockHttp,
  createMockCtx,
  envelope,
} from "@iris-mcp/shared/test-helpers";

// ── iris_metrics_system ─────────────────────────────────────

describe("iris_metrics_system", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should have scope NONE", () => {
    expect(metricsSystemTool.scope).toBe("NONE");
  });

  it("should have readOnlyHint annotation", () => {
    expect(metricsSystemTool.annotations.readOnlyHint).toBe(true);
  });

  it("should call GET /monitor/system", async () => {
    const systemData = {
      metrics: [
        {
          name: "iris_process_count",
          help: "Current number of IRIS processes",
          type: "gauge",
          value: 42,
        },
        {
          name: "iris_global_references_total",
          help: "Total global references since startup",
          type: "counter",
          value: 123456789,
        },
        {
          name: "iris_cache_hit_ratio",
          help: "Buffer cache hit ratio",
          type: "gauge",
          value: 0.9987,
        },
      ],
      databases: [
        { name: "IRIS", directory: "/iris/mgr/", sizeMB: 1024, maxSizeMB: 0 },
        { name: "USER", directory: "/iris/mgr/user/", sizeMB: 256, maxSizeMB: 0 },
      ],
    };
    mockHttp.get.mockResolvedValue(envelope(systemData));

    const result = await metricsSystemTool.handler({}, ctx);

    expect(mockHttp.get).toHaveBeenCalledWith(
      expect.stringContaining("/api/executemcp/v2/monitor/system"),
    );
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual(systemData);
  });

  it("should format metrics as Prometheus text exposition", async () => {
    const systemData = {
      metrics: [
        {
          name: "iris_process_count",
          help: "Current number of IRIS processes",
          type: "gauge",
          value: 42,
        },
      ],
      databases: [],
    };
    mockHttp.get.mockResolvedValue(envelope(systemData));

    const result = await metricsSystemTool.handler({}, ctx);

    const text = result.content[0]?.text ?? "";
    expect(text).toContain("# HELP iris_process_count");
    expect(text).toContain("# TYPE iris_process_count gauge");
    expect(text).toContain("iris_process_count 42");
  });

  it("should format database metrics with labels", async () => {
    const systemData = {
      metrics: [],
      databases: [
        { name: "IRIS", directory: "/iris/mgr/", sizeMB: 1024, maxSizeMB: 2048 },
      ],
    };
    mockHttp.get.mockResolvedValue(envelope(systemData));

    const result = await metricsSystemTool.handler({}, ctx);

    const text = result.content[0]?.text ?? "";
    expect(text).toContain('iris_db_size_mb{db="IRIS"} 1024');
    expect(text).toContain('iris_db_max_size_mb{db="IRIS"} 2048');
  });

  it("should return isError on IrisApiError", async () => {
    mockHttp.get.mockRejectedValue(
      new IrisApiError(
        500,
        [{ error: "Server error" }],
        "/api/executemcp/v2/monitor/system",
        "Server error",
      ),
    );

    const result = await metricsSystemTool.handler({}, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain(
      "Error retrieving system metrics",
    );
  });

  it("should propagate non-IrisApiError exceptions", async () => {
    mockHttp.get.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(metricsSystemTool.handler({}, ctx)).rejects.toThrow(
      "ECONNREFUSED",
    );
  });

  it("should handle empty metrics and databases gracefully", async () => {
    mockHttp.get.mockResolvedValue(
      envelope({ metrics: [], databases: [] }),
    );

    const result = await metricsSystemTool.handler({}, ctx);

    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toBeDefined();
  });

  it("iris_metrics_system forwards system-wide counter values", async () => {
    // Locks the response-shape contract for Bug #9: the server-side handler
    // moved from per-process $ZU(190,N) to instance-wide
    // SYS.Stats.Global.Sample() / SYS.Stats.Routine.Sample(). The tool layer
    // must forward the resulting counter values unchanged — values in the
    // millions-to-billions range after 33+ hours of uptime.
    const systemData = {
      metrics: [
        {
          name: "iris_global_references_total",
          help:
            "Total global references since startup (instance-wide, from SYS.Stats.Global)",
          type: "counter",
          value: 15234567,
        },
        {
          name: "iris_routine_commands_total",
          help:
            "Total routine commands since startup (instance-wide, from SYS.Stats.Routine)",
          type: "counter",
          value: 8912345,
        },
      ],
      databases: [],
    };
    mockHttp.get.mockResolvedValue(envelope(systemData));

    const result = await metricsSystemTool.handler({}, ctx);

    const structured = result.structuredContent as {
      metrics: Array<{ name: string; value: number }>;
      databases: unknown[];
    };
    const globalRefs = structured.metrics.find(
      (m) => m.name === "iris_global_references_total",
    );
    const rtnCmds = structured.metrics.find(
      (m) => m.name === "iris_routine_commands_total",
    );
    expect(globalRefs?.value).toBe(15234567);
    expect(rtnCmds?.value).toBe(8912345);
    expect(result.isError).toBeUndefined();
  });
});

// ── iris_metrics_alerts ─────────────────────────────────────

describe("iris_metrics_alerts", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should have scope NONE", () => {
    expect(metricsAlertsTool.scope).toBe("NONE");
  });

  it("should have readOnlyHint annotation", () => {
    expect(metricsAlertsTool.annotations.readOnlyHint).toBe(true);
  });

  it("should call GET /monitor/alerts", async () => {
    const alertData = {
      state: 0,
      stateText: "OK",
      alertCount: 0,
      alerts: [],
      lastAlert: "",
    };
    mockHttp.get.mockResolvedValue(envelope(alertData));

    const result = await metricsAlertsTool.handler({}, ctx);

    expect(mockHttp.get).toHaveBeenCalledWith(
      expect.stringContaining("/api/executemcp/v2/monitor/alerts"),
    );
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual(alertData);
  });

  it("should format OK state with no alerts", async () => {
    const alertData = {
      state: 0,
      stateText: "OK",
      alertCount: 0,
      alerts: [],
      lastAlert: "",
    };
    mockHttp.get.mockResolvedValue(envelope(alertData));

    const result = await metricsAlertsTool.handler({}, ctx);

    const text = result.content[0]?.text ?? "";
    expect(text).toContain("System State: OK (0)");
    expect(text).toContain("Alert Count: 0");
    expect(text).toContain("No active alerts.");
  });

  it("should format alerts when present", async () => {
    const alertData = {
      state: 2,
      stateText: "Alert",
      alertCount: 1,
      alerts: [
        {
          index: 1,
          message: "Database IRISAUDIT is 90% full",
          severity: "Alert",
          category: "system",
        },
      ],
      lastAlert: "2026-04-07 10:00:00",
    };
    mockHttp.get.mockResolvedValue(envelope(alertData));

    const result = await metricsAlertsTool.handler({}, ctx);

    const text = result.content[0]?.text ?? "";
    expect(text).toContain("System State: Alert (2)");
    expect(text).toContain("Alert Count: 1");
    expect(text).toContain("Last Alert: 2026-04-07 10:00:00");
    expect(text).toContain("[Alert] system: Database IRISAUDIT is 90% full");
  });

  it("should return isError on IrisApiError", async () => {
    mockHttp.get.mockRejectedValue(
      new IrisApiError(
        500,
        [{ error: "Server error" }],
        "/api/executemcp/v2/monitor/alerts",
        "Server error",
      ),
    );

    const result = await metricsAlertsTool.handler({}, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain(
      "Error retrieving system alerts",
    );
  });

  it("should propagate non-IrisApiError exceptions", async () => {
    mockHttp.get.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(metricsAlertsTool.handler({}, ctx)).rejects.toThrow(
      "ECONNREFUSED",
    );
  });
});

// ── iris_metrics_interop ────────────────────────────────────

describe("iris_metrics_interop", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should have scope NONE", () => {
    expect(metricsInteropTool.scope).toBe("NONE");
  });

  it("should have readOnlyHint annotation", () => {
    expect(metricsInteropTool.annotations.readOnlyHint).toBe(true);
  });

  it("should call GET /monitor/interop without namespace", async () => {
    const interopData = {
      namespaces: [
        {
          namespace: "USER",
          productionName: "User.Production",
          productionState: "Running",
          productionStateCode: 1,
          queueDepth: 5,
          errorCount24h: 2,
          messageCount24h: 1500,
        },
      ],
      count: 1,
    };
    mockHttp.get.mockResolvedValue(envelope(interopData));

    const result = await metricsInteropTool.handler({}, ctx);

    expect(mockHttp.get).toHaveBeenCalledWith(
      "/api/executemcp/v2/monitor/interop",
    );
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual(interopData);
  });

  it("should include namespace query param when provided", async () => {
    mockHttp.get.mockResolvedValue(
      envelope({ namespaces: [], count: 0 }),
    );

    await metricsInteropTool.handler({ namespace: "MYNS" }, ctx);

    const calledPath = mockHttp.get.mock.calls[0]?.[0] as string;
    expect(calledPath).toContain("namespace=MYNS");
  });

  it("should format interop metrics for display", async () => {
    const interopData = {
      namespaces: [
        {
          namespace: "USER",
          productionName: "User.Production",
          productionState: "Running",
          productionStateCode: 1,
          queueDepth: 5,
          errorCount24h: 2,
          messageCount24h: 1500,
        },
      ],
      count: 1,
    };
    mockHttp.get.mockResolvedValue(envelope(interopData));

    const result = await metricsInteropTool.handler({}, ctx);

    const text = result.content[0]?.text ?? "";
    expect(text).toContain("Namespace: USER");
    expect(text).toContain("User.Production [Running]");
    expect(text).toContain("Queue Depth: 5");
    expect(text).toContain("Errors (24h): 2");
    expect(text).toContain("Messages (24h): 1500");
  });

  it("should handle empty namespaces gracefully", async () => {
    mockHttp.get.mockResolvedValue(
      envelope({ namespaces: [], count: 0 }),
    );

    const result = await metricsInteropTool.handler({}, ctx);

    expect(result.isError).toBeUndefined();
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("0 namespace(s)");
  });

  it("should return isError on IrisApiError", async () => {
    mockHttp.get.mockRejectedValue(
      new IrisApiError(
        500,
        [{ error: "Server error" }],
        "/api/executemcp/v2/monitor/interop",
        "Server error",
      ),
    );

    const result = await metricsInteropTool.handler({}, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain(
      "Error retrieving interop metrics",
    );
  });

  it("should propagate non-IrisApiError exceptions", async () => {
    mockHttp.get.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(metricsInteropTool.handler({}, ctx)).rejects.toThrow(
      "ECONNREFUSED",
    );
  });

  it("should encode namespace parameter in URL", async () => {
    mockHttp.get.mockResolvedValue(
      envelope({ namespaces: [], count: 0 }),
    );

    await metricsInteropTool.handler({ namespace: "MY NS" }, ctx);

    const calledPath = mockHttp.get.mock.calls[0]?.[0] as string;
    expect(calledPath).toContain("namespace=MY%20NS");
  });
});
