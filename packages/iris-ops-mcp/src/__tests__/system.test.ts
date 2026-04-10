import { describe, it, expect, beforeEach } from "vitest";
import type { ToolContext } from "@iris-mcp/shared";
import { IrisApiError } from "@iris-mcp/shared";
import {
  journalInfoTool,
  mirrorStatusTool,
  auditEventsTool,
} from "../tools/system.js";
import {
  createMockHttp,
  createMockCtx,
  envelope,
} from "@iris-mcp/shared/test-helpers";

// ── iris_journal_info ─────────────────────────────────────

describe("iris_journal_info", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should have scope NONE", () => {
    expect(journalInfoTool.scope).toBe("NONE");
  });

  it("should have readOnlyHint annotation", () => {
    expect(journalInfoTool.annotations.readOnlyHint).toBe(true);
  });

  it("should call GET /monitor/journal", async () => {
    const journalData = {
      currentFile: "c:\\intersystems\\irishealth\\mgr\\journal\\20260407.002",
      primaryDirectory: "c:\\intersystems\\irishealth\\mgr\\journal\\",
      alternateDirectory: "c:\\intersystems\\irishealth\\mgr\\journal2\\",
      fileCount: 5,
      currentOffset: 1048576,
      freeSpaceBytes: 53687091200,
      state: "Normal",
    };
    mockHttp.get.mockResolvedValue(envelope(journalData));

    const result = await journalInfoTool.handler({}, ctx);

    expect(mockHttp.get).toHaveBeenCalledWith(
      expect.stringContaining("/api/executemcp/v2/monitor/journal"),
    );
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual(journalData);
  });

  it("should format journal info for display", async () => {
    const journalData = {
      currentFile: "c:\\intersystems\\irishealth\\mgr\\journal\\20260407.002",
      primaryDirectory: "c:\\intersystems\\irishealth\\mgr\\journal\\",
      alternateDirectory: "c:\\intersystems\\irishealth\\mgr\\journal2\\",
      fileCount: 5,
      currentOffset: 1048576,
      freeSpaceBytes: 53687091200,
      state: "Normal",
    };
    mockHttp.get.mockResolvedValue(envelope(journalData));

    const result = await journalInfoTool.handler({}, ctx);

    const text = result.content[0]?.text ?? "";
    expect(text).toContain("Journal Status:");
    expect(text).toContain("State: Normal");
    expect(text).toContain("Current File: c:\\intersystems\\irishealth\\mgr\\journal\\20260407.002");
    expect(text).toContain("Primary Directory:");
    expect(text).toContain("Alternate Directory:");
    expect(text).toContain("File Count: 5");
    expect(text).toContain("Current Offset: 1048576");
    expect(text).toContain("Free Space: 50.0 GB");
  });

  it("should return isError on IrisApiError", async () => {
    mockHttp.get.mockRejectedValue(
      new IrisApiError(
        500,
        [{ error: "Server error" }],
        "/api/executemcp/v2/monitor/journal",
        "Server error",
      ),
    );

    const result = await journalInfoTool.handler({}, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Error retrieving journal info");
  });

  it("should propagate non-IrisApiError exceptions", async () => {
    mockHttp.get.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(journalInfoTool.handler({}, ctx)).rejects.toThrow(
      "ECONNREFUSED",
    );
  });
});

// ── iris_mirror_status ────────────────────────────────────

describe("iris_mirror_status", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should have scope NONE", () => {
    expect(mirrorStatusTool.scope).toBe("NONE");
  });

  it("should have readOnlyHint annotation", () => {
    expect(mirrorStatusTool.annotations.readOnlyHint).toBe(true);
  });

  it("should call GET /monitor/mirror", async () => {
    const mirrorData = {
      isMember: false,
      mirrorName: "",
      memberType: "Not Member",
      isPrimary: false,
      isBackup: false,
      isAsyncMember: false,
      status: "Mirror not configured",
    };
    mockHttp.get.mockResolvedValue(envelope(mirrorData));

    const result = await mirrorStatusTool.handler({}, ctx);

    expect(mockHttp.get).toHaveBeenCalledWith(
      expect.stringContaining("/api/executemcp/v2/monitor/mirror"),
    );
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual(mirrorData);
  });

  it("should handle mirror not configured gracefully", async () => {
    const mirrorData = {
      isMember: false,
      mirrorName: "",
      memberType: "Not Member",
      isPrimary: false,
      isBackup: false,
      isAsyncMember: false,
      status: "Mirror not configured",
    };
    mockHttp.get.mockResolvedValue(envelope(mirrorData));

    const result = await mirrorStatusTool.handler({}, ctx);

    const text = result.content[0]?.text ?? "";
    expect(text).toContain("Mirror Status:");
    expect(text).toContain("Is Member: No");
    expect(text).toContain("Status: Mirror not configured");
    expect(text).not.toContain("Mirror Name:");
  });

  it("should display full details when mirror is configured", async () => {
    const mirrorData = {
      isMember: true,
      mirrorName: "PROD_MIRROR",
      memberType: "Primary",
      isPrimary: true,
      isBackup: false,
      isAsyncMember: false,
      status: "Active",
    };
    mockHttp.get.mockResolvedValue(envelope(mirrorData));

    const result = await mirrorStatusTool.handler({}, ctx);

    const text = result.content[0]?.text ?? "";
    expect(text).toContain("Is Member: Yes");
    expect(text).toContain("Mirror Name: PROD_MIRROR");
    expect(text).toContain("Member Type: Primary");
    expect(text).toContain("Is Primary: Yes");
    expect(text).toContain("Is Backup: No");
    expect(text).toContain("Is Async: No");
    expect(text).toContain("Status: Active");
  });

  it("should return isError on IrisApiError", async () => {
    mockHttp.get.mockRejectedValue(
      new IrisApiError(
        500,
        [{ error: "Server error" }],
        "/api/executemcp/v2/monitor/mirror",
        "Server error",
      ),
    );

    const result = await mirrorStatusTool.handler({}, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Error retrieving mirror status");
  });

  it("should propagate non-IrisApiError exceptions", async () => {
    mockHttp.get.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(mirrorStatusTool.handler({}, ctx)).rejects.toThrow(
      "ECONNREFUSED",
    );
  });
});

// ── iris_audit_events ─────────────────────────────────────

describe("iris_audit_events", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should have scope NONE", () => {
    expect(auditEventsTool.scope).toBe("NONE");
  });

  it("should have readOnlyHint annotation", () => {
    expect(auditEventsTool.annotations.readOnlyHint).toBe(true);
  });

  it("should call GET /monitor/audit with no filters", async () => {
    const auditData = {
      events: [
        {
          timestamp: "2026-04-07 10:30:00",
          username: "_SYSTEM",
          eventSource: "%System",
          eventType: "Login",
          event: "LoginSuccess",
          description: "User logged in",
          clientIPAddress: "127.0.0.1",
          namespace: "HSCUSTOM",
        },
      ],
      count: 1,
      maxRows: 100,
    };
    mockHttp.get.mockResolvedValue(envelope(auditData));

    const result = await auditEventsTool.handler({}, ctx);

    expect(mockHttp.get).toHaveBeenCalledWith(
      "/api/executemcp/v2/monitor/audit",
    );
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual(auditData);
  });

  it("should pass filter query parameters", async () => {
    const auditData = { events: [], count: 0, maxRows: 50 };
    mockHttp.get.mockResolvedValue(envelope(auditData));

    await auditEventsTool.handler(
      {
        beginDate: "2026-04-07",
        endDate: "2026-04-08",
        username: "_SYSTEM",
        eventType: "Login",
        maxRows: 50,
      },
      ctx,
    );

    const calledPath = mockHttp.get.mock.calls[0]?.[0] as string;
    expect(calledPath).toContain("/api/executemcp/v2/monitor/audit?");
    expect(calledPath).toContain("beginDate=2026-04-07");
    expect(calledPath).toContain("endDate=2026-04-08");
    expect(calledPath).toContain("username=_SYSTEM");
    expect(calledPath).toContain("eventType=Login");
    expect(calledPath).toContain("maxRows=50");
  });

  it("should format audit events for display", async () => {
    const auditData = {
      events: [
        {
          timestamp: "2026-04-07 10:30:00",
          username: "_SYSTEM",
          eventSource: "%System",
          eventType: "Login",
          event: "LoginSuccess",
          description: "User logged in successfully",
          clientIPAddress: "127.0.0.1",
          namespace: "HSCUSTOM",
        },
      ],
      count: 1,
      maxRows: 100,
    };
    mockHttp.get.mockResolvedValue(envelope(auditData));

    const result = await auditEventsTool.handler({}, ctx);

    const text = result.content[0]?.text ?? "";
    expect(text).toContain("Audit Events (1 event(s), maxRows=100):");
    expect(text).toContain("[2026-04-07 10:30:00] %System/Login/LoginSuccess");
    expect(text).toContain("User: _SYSTEM");
    expect(text).toContain("IP: 127.0.0.1");
    expect(text).toContain("NS: HSCUSTOM");
    expect(text).toContain("User logged in successfully");
  });

  it("should show no events message when empty", async () => {
    const auditData = { events: [], count: 0, maxRows: 100 };
    mockHttp.get.mockResolvedValue(envelope(auditData));

    const result = await auditEventsTool.handler({}, ctx);

    const text = result.content[0]?.text ?? "";
    expect(text).toContain("0 event(s)");
    expect(text).toContain("No audit events found");
  });

  it("should handle event with no client IP", async () => {
    const auditData = {
      events: [
        {
          timestamp: "2026-04-07 10:30:00",
          username: "_SYSTEM",
          eventSource: "%System",
          eventType: "Startup",
          event: "SystemStart",
          description: "",
          clientIPAddress: "",
          namespace: "",
        },
      ],
      count: 1,
      maxRows: 100,
    };
    mockHttp.get.mockResolvedValue(envelope(auditData));

    const result = await auditEventsTool.handler({}, ctx);

    const text = result.content[0]?.text ?? "";
    expect(text).toContain("IP: (local)");
    expect(text).toContain("NS: (none)");
  });

  it("should return isError on IrisApiError", async () => {
    mockHttp.get.mockRejectedValue(
      new IrisApiError(
        500,
        [{ error: "Server error" }],
        "/api/executemcp/v2/monitor/audit",
        "Server error",
      ),
    );

    const result = await auditEventsTool.handler({}, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Error retrieving audit events");
  });

  it("should propagate non-IrisApiError exceptions", async () => {
    mockHttp.get.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(auditEventsTool.handler({}, ctx)).rejects.toThrow(
      "ECONNREFUSED",
    );
  });

  it("should only include provided filters in query string", async () => {
    const auditData = { events: [], count: 0, maxRows: 100 };
    mockHttp.get.mockResolvedValue(envelope(auditData));

    await auditEventsTool.handler({ username: "Admin" }, ctx);

    const calledPath = mockHttp.get.mock.calls[0]?.[0] as string;
    expect(calledPath).toContain("username=Admin");
    expect(calledPath).not.toContain("beginDate");
    expect(calledPath).not.toContain("endDate");
    expect(calledPath).not.toContain("eventType");
    expect(calledPath).not.toContain("maxRows");
  });
});
