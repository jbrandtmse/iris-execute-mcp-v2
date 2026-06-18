import { describe, it, expect, beforeEach } from "vitest";
import type { ToolContext } from "@iris-mcp/shared";
import { IrisApiError } from "@iris-mcp/shared";
import { backupManageTool } from "../tools/backup.js";
import {
  createMockHttp,
  createMockCtx,
  envelope,
} from "@iris-mcp/shared/test-helpers";

// ── iris_backup_manage ──────────────────────────────────────────

const PATH = "/api/executemcp/v2/monitor/backup/manage";

describe("iris_backup_manage", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  // ── shape / governance metadata ──

  it("should have scope NONE", () => {
    expect(backupManageTool.scope).toBe("NONE");
  });

  it("should classify run/freeze/thaw as write and listHistory as read", () => {
    expect(backupManageTool.mutates).toEqual({
      run: "write",
      freeze: "write",
      thaw: "write",
      listHistory: "read",
    });
  });

  it("should carry destructiveHint at the tool scope (freeze)", () => {
    expect(backupManageTool.annotations.destructiveHint).toBe(true);
  });

  it("should be non-idempotent (run starts a new backup each call)", () => {
    expect(backupManageTool.annotations.idempotentHint).toBe(false);
  });

  it("should NOT advertise a restore action in the enum", () => {
    // restore is deferred (AC 16.3.3) — must not be exposed as a callable action.
    expect(backupManageTool.mutates).not.toHaveProperty("restore");
  });

  // ── namespace param: accepted-but-ignored (Story 18.0, CR 16.3-namespace) ──

  it("namespace description states the value has NO EFFECT (%SYS-scoped)", () => {
    const shape = (
      backupManageTool.inputSchema as unknown as {
        shape: { namespace: { description?: string } };
      }
    ).shape;
    const desc = shape.namespace.description ?? "";
    expect(desc).toContain("NO EFFECT");
    expect(desc).toContain("%SYS-scoped");
  });

  it("namespace param is still accepted and forwarded without error (back-compat)", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "listHistory", count: 0, entries: [] }),
    );

    const result = await backupManageTool.handler(
      { action: "listHistory", namespace: "%SYS" },
      ctx,
    );

    expect(result.isError).toBeUndefined();
    expect(mockHttp.post).toHaveBeenCalledWith(
      PATH,
      expect.objectContaining({ namespace: "%SYS" }),
    );
  });

  it("an empty-string namespace is accepted and dropped from the POST body (accepted-but-ignored)", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "listHistory", count: 0, entries: [] }),
    );

    const result = await backupManageTool.handler(
      { action: "listHistory", namespace: "" },
      ctx,
    );

    // Empty string is treated as "not supplied" — accepted without error and
    // never placed on the wire (the param has no effect either way).
    expect(result.isError).toBeUndefined();
    const body = mockHttp.post.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(body).not.toHaveProperty("namespace");
  });

  // ── run ──

  it("run should POST {action, taskName} and report success", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "run", taskName: "NightlyFull", jobbackup: 0, success: 1 }),
    );

    const result = await backupManageTool.handler(
      { action: "run", taskName: "NightlyFull" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(expect.stringContaining(PATH), {
      action: "run",
      taskName: "NightlyFull",
    });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain("NightlyFull");
    expect(result.content[0]?.text).toContain("success");
  });

  it("run should forward backupType (informational) and jobbackup when supplied", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({
        action: "run",
        taskName: "NightlyFull",
        backupType: "full",
        jobbackup: 1,
        success: 1,
      }),
    );

    await backupManageTool.handler(
      {
        action: "run",
        taskName: "NightlyFull",
        backupType: "full",
        jobbackup: true,
      },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ backupType: "full", jobbackup: true }),
    );
  });

  it("run should report background-job mode when jobbackup is set", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "run", taskName: "NightlyFull", jobbackup: 1, success: 1 }),
    );

    const result = await backupManageTool.handler(
      { action: "run", taskName: "NightlyFull", jobbackup: true },
      ctx,
    );

    expect(result.content[0]?.text ?? "").toContain("background job");
  });

  it("run without taskName returns a clear error and does NOT call the server", async () => {
    const result = await backupManageTool.handler({ action: "run" }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("'taskName' is required");
    expect(mockHttp.post).not.toHaveBeenCalled();
  });

  it("run with empty taskName returns a clear error and does NOT call the server", async () => {
    const result = await backupManageTool.handler(
      { action: "run", taskName: "" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("'taskName' is required");
    expect(mockHttp.post).not.toHaveBeenCalled();
  });

  // ── freeze ──

  it("freeze should POST {action} and surface a frozen status", async () => {
    mockHttp.post.mockResolvedValue(envelope({ action: "freeze", success: 1 }));

    const result = await backupManageTool.handler({ action: "freeze" }, ctx);

    expect(mockHttp.post).toHaveBeenCalledWith(expect.any(String), {
      action: "freeze",
    });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text ?? "").toContain("frozen");
  });

  it("freeze should forward logFile and description when supplied", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "freeze", logFile: "c:\\tmp\\freeze.log", success: 1 }),
    );

    await backupManageTool.handler(
      {
        action: "freeze",
        logFile: "c:\\tmp\\freeze.log",
        description: "snapshot prep",
      },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        logFile: "c:\\tmp\\freeze.log",
        description: "snapshot prep",
      }),
    );
  });

  // ── thaw ──

  it("thaw should POST {action} and surface a thawed status", async () => {
    mockHttp.post.mockResolvedValue(envelope({ action: "thaw", success: 1 }));

    const result = await backupManageTool.handler({ action: "thaw" }, ctx);

    expect(mockHttp.post).toHaveBeenCalledWith(expect.any(String), {
      action: "thaw",
    });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text ?? "").toContain("thawed");
  });

  it("thaw should forward username/password when supplied", async () => {
    mockHttp.post.mockResolvedValue(envelope({ action: "thaw", success: 1 }));

    await backupManageTool.handler(
      { action: "thaw", username: "backupadmin", password: "secret" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ username: "backupadmin", password: "secret" }),
    );
  });

  // ── listHistory ──

  it("listHistory should POST {action} and render history entries", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({
        action: "listHistory",
        count: 2,
        entries: [
          {
            timestamp: "2026-06-15 23:00:00",
            type: "Full",
            status: "Completed",
            device: "c:\\backups\\full.bck",
            logFile: "c:\\backups\\full.log",
            description: "nightly",
            list: "All",
          },
          {
            timestamp: "2026-06-14 23:00:00",
            type: "Incremental",
            status: "Completed",
            description: "incr",
          },
        ],
      }),
    );

    const result = await backupManageTool.handler(
      { action: "listHistory" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(expect.any(String), {
      action: "listHistory",
    });
    expect(result.isError).toBeUndefined();
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("2 entries");
    expect(text).toContain("Full");
    expect(text).toContain("Completed");
    expect(text).toContain("nightly");
    const sc = result.structuredContent as { entries: unknown[] };
    expect(sc.entries).toHaveLength(2);
  });

  it("listHistory should render a clear message when there is no history", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "listHistory", count: 0, entries: [] }),
    );

    const result = await backupManageTool.handler(
      { action: "listHistory" },
      ctx,
    );

    expect(result.content[0]?.text ?? "").toContain("No backup history");
  });

  // ── optional namespace passthrough ──

  it("should forward an optional namespace in the body", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "listHistory", count: 0, entries: [] }),
    );

    await backupManageTool.handler(
      { action: "listHistory", namespace: "%SYS" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ namespace: "%SYS" }),
    );
  });

  // ── server error / refusal surfacing ──

  it("a server error (e.g. unknown task) surfaces as isError, not a crash", async () => {
    mockHttp.post.mockRejectedValue(
      new IrisApiError(
        500,
        [{ error: "ERROR #5001: Backup task 'Nope' is not defined" }],
        PATH,
        "ERROR #5001: Backup task 'Nope' is not defined",
      ),
    );

    const result = await backupManageTool.handler(
      { action: "run", taskName: "Nope" },
      ctx,
    );

    expect(result.isError).toBe(true);
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("Error performing 'run' backup operation");
    expect(text).toContain("is not defined");
  });

  it("a server restore-refusal surfaces the not-supported message (deferred restore)", async () => {
    // restore is not in the enum, but the server defends against it. We pass it
    // through to confirm the not-supported message is surfaced cleanly.
    mockHttp.post.mockRejectedValue(
      new IrisApiError(
        400,
        [{ error: "Restore is not supported via this tool." }],
        PATH,
        "Restore is not supported via this tool.",
      ),
    );

    const result = await backupManageTool.handler(
      { action: "restore" } as unknown as { action: "run" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("not supported");
  });

  it("should propagate non-IrisApiError exceptions", async () => {
    mockHttp.post.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      backupManageTool.handler({ action: "listHistory" }, ctx),
    ).rejects.toThrow("ECONNREFUSED");
  });
});
