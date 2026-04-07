import { describe, it, expect, beforeEach } from "vitest";
import type { ToolContext } from "@iris-mcp/shared";
import { IrisApiError } from "@iris-mcp/shared";
import {
  taskManageTool,
  taskListTool,
  taskRunTool,
  taskHistoryTool,
} from "../tools/task.js";
import {
  createMockHttp,
  createMockCtx,
  envelope,
} from "@iris-mcp/shared/test-helpers";

// ── iris.task.manage ────────────────────────────────────────

describe("iris.task.manage", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should have scope NONE", () => {
    expect(taskManageTool.scope).toBe("NONE");
  });

  it("should have destructiveHint annotation", () => {
    expect(taskManageTool.annotations.destructiveHint).toBe(true);
    expect(taskManageTool.annotations.readOnlyHint).toBe(false);
  });

  it("should send POST for create action with required fields", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "created", id: 42, name: "MyTask" }),
    );

    const result = await taskManageTool.handler(
      {
        action: "create",
        name: "MyTask",
        taskClass: "%SYS.Task.IntegrityCheck",
        namespace: "USER",
        description: "Daily integrity check",
      },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/task/manage",
      expect.objectContaining({
        action: "create",
        name: "MyTask",
        taskClass: "%SYS.Task.IntegrityCheck",
        namespace: "USER",
        description: "Daily integrity check",
      }),
    );
    expect(result.isError).toBeUndefined();
    const structured = result.structuredContent as {
      action: string;
      id: number;
      name: string;
    };
    expect(structured.action).toBe("created");
    expect(structured.id).toBe(42);
    expect(structured.name).toBe("MyTask");
  });

  it("should send POST for modify action with id", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "modified", id: 5 }),
    );

    const result = await taskManageTool.handler(
      {
        action: "modify",
        id: 5,
        description: "Updated description",
        suspended: true,
      },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/task/manage",
      expect.objectContaining({
        action: "modify",
        id: 5,
        description: "Updated description",
        suspended: true,
      }),
    );
    expect(result.isError).toBeUndefined();
    const structured = result.structuredContent as {
      action: string;
      id: number;
    };
    expect(structured.action).toBe("modified");
    expect(structured.id).toBe(5);
  });

  it("should send POST for delete action with id", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "deleted", id: 7 }),
    );

    const result = await taskManageTool.handler(
      { action: "delete", id: 7 },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/task/manage",
      expect.objectContaining({ action: "delete", id: 7 }),
    );
    expect(result.isError).toBeUndefined();
    const structured = result.structuredContent as {
      action: string;
      id: number;
    };
    expect(structured.action).toBe("deleted");
    expect(structured.id).toBe(7);
  });

  it("should format create response for display", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "created", id: 10, name: "BackupTask" }),
    );

    const result = await taskManageTool.handler(
      {
        action: "create",
        name: "BackupTask",
        taskClass: "MyApp.BackupTask",
        namespace: "USER",
      },
      ctx,
    );

    const text = result.content[0]?.text ?? "";
    expect(text).toContain("Task created:");
    expect(text).toContain("ID: 10");
    expect(text).toContain("Name: BackupTask");
  });

  it("should only include defined optional fields in body", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "created", id: 1, name: "MinimalTask" }),
    );

    await taskManageTool.handler(
      {
        action: "create",
        name: "MinimalTask",
        taskClass: "MyApp.Task",
        namespace: "USER",
      },
      ctx,
    );

    const body = mockHttp.post.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(body.action).toBe("create");
    expect(body.name).toBe("MinimalTask");
    expect(body.taskClass).toBe("MyApp.Task");
    expect(body.namespace).toBe("USER");
    expect(body.description).toBeUndefined();
    expect(body.suspended).toBeUndefined();
  });

  it("should return isError on IrisApiError", async () => {
    mockHttp.post.mockRejectedValue(
      new IrisApiError(
        400,
        [{ error: "Name is required" }],
        "/api/executemcp/v2/task/manage",
        "Name is required",
      ),
    );

    const result = await taskManageTool.handler(
      { action: "create" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Error managing task");
  });

  it("should propagate non-IrisApiError exceptions", async () => {
    mockHttp.post.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      taskManageTool.handler({ action: "create" }, ctx),
    ).rejects.toThrow("ECONNREFUSED");
  });
});

// ── iris.task.list ──────────────────────────────────────────

describe("iris.task.list", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should have scope NONE", () => {
    expect(taskListTool.scope).toBe("NONE");
  });

  it("should have readOnlyHint annotation", () => {
    expect(taskListTool.annotations.readOnlyHint).toBe(true);
    expect(taskListTool.annotations.destructiveHint).toBe(false);
  });

  it("should call GET /task/list", async () => {
    const taskData = {
      tasks: [
        {
          id: 1,
          name: "Integrity Check",
          description: "Daily integrity check",
          taskClass: "%SYS.Task.IntegrityCheck",
          namespace: "%SYS",
          suspended: "0",
          priority: "Normal",
          runInterval: "Daily",
          nextScheduledDate: "2026-04-08",
          nextScheduledTime: "03:00:00",
          lastStarted: "2026-04-07 03:00:00",
          lastFinished: "2026-04-07 03:01:30",
          lastStatus: "Completed",
          lastResult: "Success",
        },
      ],
      count: 1,
    };
    mockHttp.get.mockResolvedValue(envelope(taskData));

    const result = await taskListTool.handler({}, ctx);

    expect(mockHttp.get).toHaveBeenCalledWith(
      "/api/executemcp/v2/task/list",
    );
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual(taskData);
  });

  it("should format task list for display", async () => {
    const taskData = {
      tasks: [
        {
          id: 1,
          name: "Integrity Check",
          description: "Daily check",
          taskClass: "%SYS.Task.IntegrityCheck",
          namespace: "%SYS",
          suspended: "0",
          priority: "Normal",
          runInterval: "Daily",
          nextScheduledDate: "2026-04-08",
          nextScheduledTime: "03:00:00",
          lastStarted: "2026-04-07 03:00:00",
          lastFinished: "2026-04-07 03:01:30",
          lastStatus: "Completed",
          lastResult: "Success",
        },
      ],
      count: 1,
    };
    mockHttp.get.mockResolvedValue(envelope(taskData));

    const result = await taskListTool.handler({}, ctx);

    const text = result.content[0]?.text ?? "";
    expect(text).toContain("Scheduled Tasks (1 task(s)):");
    expect(text).toContain("[1] Integrity Check:");
    expect(text).toContain("Class: %SYS.Task.IntegrityCheck");
    expect(text).toContain("Namespace: %SYS");
    expect(text).toContain("Suspended: No");
    expect(text).toContain("Priority: Normal");
    expect(text).toContain("Run Interval: Daily");
    expect(text).toContain("Next Run: 2026-04-08 03:00:00");
    expect(text).toContain("Last Started: 2026-04-07 03:00:00");
    expect(text).toContain("Last Status: Completed (Success)");
  });

  it("should show suspended: Yes for suspended tasks", async () => {
    const taskData = {
      tasks: [
        {
          id: 2,
          name: "Suspended Task",
          description: "",
          taskClass: "MyApp.Task",
          namespace: "USER",
          suspended: "1",
          priority: "Normal",
          runInterval: "Daily",
          nextScheduledDate: "",
          nextScheduledTime: "",
          lastStarted: "",
          lastFinished: "",
          lastStatus: "",
          lastResult: "",
        },
      ],
      count: 1,
    };
    mockHttp.get.mockResolvedValue(envelope(taskData));

    const result = await taskListTool.handler({}, ctx);

    const text = result.content[0]?.text ?? "";
    expect(text).toContain("Suspended: Yes");
  });

  it("should show no tasks message when empty", async () => {
    const taskData = { tasks: [], count: 0 };
    mockHttp.get.mockResolvedValue(envelope(taskData));

    const result = await taskListTool.handler({}, ctx);

    const text = result.content[0]?.text ?? "";
    expect(text).toContain("0 task(s)");
    expect(text).toContain("No scheduled tasks found");
  });

  it("should return isError on IrisApiError", async () => {
    mockHttp.get.mockRejectedValue(
      new IrisApiError(
        500,
        [{ error: "Server error" }],
        "/api/executemcp/v2/task/list",
        "Server error",
      ),
    );

    const result = await taskListTool.handler({}, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Error retrieving task list");
  });

  it("should propagate non-IrisApiError exceptions", async () => {
    mockHttp.get.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(taskListTool.handler({}, ctx)).rejects.toThrow(
      "ECONNREFUSED",
    );
  });
});

// ── iris.task.run ───────────────────────────────────────────

describe("iris.task.run", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should have scope NONE", () => {
    expect(taskRunTool.scope).toBe("NONE");
  });

  it("should have destructiveHint false annotation", () => {
    expect(taskRunTool.annotations.destructiveHint).toBe(false);
    expect(taskRunTool.annotations.readOnlyHint).toBe(false);
  });

  it("should send POST /task/run with task id", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({
        triggered: true,
        id: 3,
        message: "Task execution triggered (async)",
      }),
    );

    const result = await taskRunTool.handler({ id: 3 }, ctx);

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/task/run",
      { id: 3 },
    );
    expect(result.isError).toBeUndefined();
    const structured = result.structuredContent as {
      triggered: boolean;
      id: number;
      message: string;
    };
    expect(structured.triggered).toBe(true);
    expect(structured.id).toBe(3);
  });

  it("should format run response for display", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({
        triggered: true,
        id: 5,
        message: "Task execution triggered (async)",
      }),
    );

    const result = await taskRunTool.handler({ id: 5 }, ctx);

    const text = result.content[0]?.text ?? "";
    expect(text).toContain("Task Run Triggered:");
    expect(text).toContain("ID: 5");
    expect(text).toContain("Task execution triggered (async)");
  });

  it("should accept string task id", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({
        triggered: true,
        id: "7",
        message: "Task execution triggered (async)",
      }),
    );

    const result = await taskRunTool.handler({ id: "7" }, ctx);

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/task/run",
      { id: "7" },
    );
    expect(result.isError).toBeUndefined();
  });

  it("should return isError on IrisApiError", async () => {
    mockHttp.post.mockRejectedValue(
      new IrisApiError(
        404,
        [{ error: "Task not found" }],
        "/api/executemcp/v2/task/run",
        "Task not found",
      ),
    );

    const result = await taskRunTool.handler({ id: 999 }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Error running task");
  });

  it("should propagate non-IrisApiError exceptions", async () => {
    mockHttp.post.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(taskRunTool.handler({ id: 1 }, ctx)).rejects.toThrow(
      "ECONNREFUSED",
    );
  });
});

// ── iris.task.history ───────────────────────────────────────

describe("iris.task.history", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should have scope NONE", () => {
    expect(taskHistoryTool.scope).toBe("NONE");
  });

  it("should have readOnlyHint annotation", () => {
    expect(taskHistoryTool.annotations.readOnlyHint).toBe(true);
    expect(taskHistoryTool.annotations.destructiveHint).toBe(false);
  });

  it("should call GET /task/history with no params", async () => {
    const historyData = {
      history: [
        {
          taskName: "Integrity Check",
          lastStart: "2026-04-07 03:00:00",
          completed: "2026-04-07 03:01:30",
          status: "Completed",
          result: "Success",
          namespace: "%SYS",
          username: "_SYSTEM",
          taskId: "1",
        },
      ],
      count: 1,
    };
    mockHttp.get.mockResolvedValue(envelope(historyData));

    const result = await taskHistoryTool.handler({}, ctx);

    expect(mockHttp.get).toHaveBeenCalledWith(
      "/api/executemcp/v2/task/history",
    );
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual(historyData);
  });

  it("should pass taskId query parameter when specified", async () => {
    const historyData = {
      history: [
        {
          taskName: "Integrity Check",
          lastStart: "2026-04-07 03:00:00",
          completed: "2026-04-07 03:01:30",
          status: "Completed",
          result: "Success",
          namespace: "%SYS",
          username: "_SYSTEM",
          taskId: "1",
        },
      ],
      count: 1,
    };
    mockHttp.get.mockResolvedValue(envelope(historyData));

    await taskHistoryTool.handler({ taskId: 1 }, ctx);

    const calledPath = mockHttp.get.mock.calls[0]?.[0] as string;
    expect(calledPath).toContain("/api/executemcp/v2/task/history?");
    expect(calledPath).toContain("taskId=1");
  });

  it("should format history for display", async () => {
    const historyData = {
      history: [
        {
          taskName: "Integrity Check",
          lastStart: "2026-04-07 03:00:00",
          completed: "2026-04-07 03:01:30",
          status: "Completed",
          result: "Success",
          namespace: "%SYS",
          username: "_SYSTEM",
          taskId: "1",
        },
      ],
      count: 1,
    };
    mockHttp.get.mockResolvedValue(envelope(historyData));

    const result = await taskHistoryTool.handler({}, ctx);

    const text = result.content[0]?.text ?? "";
    expect(text).toContain("Task History (1 entries):");
    expect(text).toContain("Integrity Check (Task 1):");
    expect(text).toContain("Started: 2026-04-07 03:00:00");
    expect(text).toContain("Completed: 2026-04-07 03:01:30");
    expect(text).toContain("Status: Completed");
    expect(text).toContain("Result: Success");
    expect(text).toContain("Namespace: %SYS");
    expect(text).toContain("User: _SYSTEM");
  });

  it("should show no history message when empty", async () => {
    const historyData = { history: [], count: 0 };
    mockHttp.get.mockResolvedValue(envelope(historyData));

    const result = await taskHistoryTool.handler({}, ctx);

    const text = result.content[0]?.text ?? "";
    expect(text).toContain("0 entries");
    expect(text).toContain("No task history found");
  });

  it("should accept string taskId parameter", async () => {
    mockHttp.get.mockResolvedValue(
      envelope({ history: [], count: 0 }),
    );

    await taskHistoryTool.handler({ taskId: "3" }, ctx);

    const calledPath = mockHttp.get.mock.calls[0]?.[0] as string;
    expect(calledPath).toContain("taskId=3");
  });

  it("should return isError on IrisApiError", async () => {
    mockHttp.get.mockRejectedValue(
      new IrisApiError(
        500,
        [{ error: "Server error" }],
        "/api/executemcp/v2/task/history",
        "Server error",
      ),
    );

    const result = await taskHistoryTool.handler({}, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain(
      "Error retrieving task history",
    );
  });

  it("should propagate non-IrisApiError exceptions", async () => {
    mockHttp.get.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(taskHistoryTool.handler({}, ctx)).rejects.toThrow(
      "ECONNREFUSED",
    );
  });
});
