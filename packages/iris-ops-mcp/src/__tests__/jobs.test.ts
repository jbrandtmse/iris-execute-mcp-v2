import { describe, it, expect, beforeEach } from "vitest";
import type { ToolContext } from "@iris-mcp/shared";
import { IrisApiError } from "@iris-mcp/shared";
import { jobsListTool, locksListTool } from "../tools/jobs.js";
import {
  createMockHttp,
  createMockCtx,
  envelope,
} from "@iris-mcp/shared/test-helpers";

// ── iris_jobs_list ─────────────────────────────────────────

describe("iris_jobs_list", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should have scope NONE", () => {
    expect(jobsListTool.scope).toBe("NONE");
  });

  it("should have readOnlyHint annotation", () => {
    expect(jobsListTool.annotations.readOnlyHint).toBe(true);
  });

  it("should call GET /monitor/jobs", async () => {
    const jobsData = {
      jobs: [
        {
          pid: 1234,
          namespace: "USER",
          routine: "MyApp.Main",
          state: "RUNW",
          userName: "_SYSTEM",
          clientIPAddress: "127.0.0.1",
          jobType: 0,
          commandsExecuted: 5000,
          globalReferences: 12000,
          inTransaction: 0,
          cpuTime: 42,
        },
        {
          pid: 5678,
          namespace: "%SYS",
          routine: "",
          state: "READ",
          userName: "Admin",
          clientIPAddress: "",
          jobType: 1,
          commandsExecuted: 100,
          globalReferences: 200,
          inTransaction: 1,
          cpuTime: 5,
        },
      ],
      count: 2,
    };
    mockHttp.get.mockResolvedValue(envelope(jobsData));

    const result = await jobsListTool.handler({}, ctx);

    expect(mockHttp.get).toHaveBeenCalledWith(
      expect.stringContaining("/api/executemcp/v2/monitor/jobs"),
    );
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual(jobsData);
  });

  it("should format jobs for display", async () => {
    const jobsData = {
      jobs: [
        {
          pid: 1234,
          namespace: "USER",
          routine: "MyApp.Main",
          state: "RUNW",
          userName: "_SYSTEM",
          clientIPAddress: "127.0.0.1",
          jobType: 0,
          commandsExecuted: 5000,
          globalReferences: 12000,
          inTransaction: 0,
          cpuTime: 42,
        },
      ],
      count: 1,
    };
    mockHttp.get.mockResolvedValue(envelope(jobsData));

    const result = await jobsListTool.handler({}, ctx);

    const text = result.content[0]?.text ?? "";
    expect(text).toContain("IRIS Jobs (1 process(es)):");
    expect(text).toContain("PID: 1234");
    expect(text).toContain("Namespace: USER");
    expect(text).toContain("Routine: MyApp.Main");
    expect(text).toContain("State: RUNW");
    expect(text).toContain("User: _SYSTEM");
    expect(text).toContain("Client IP: 127.0.0.1");
    expect(text).toContain("Commands: 5000 | Globals: 12000 | CPU: 42");
  });

  it("should show in-transaction indicator", async () => {
    const jobsData = {
      jobs: [
        {
          pid: 5678,
          namespace: "%SYS",
          routine: "",
          state: "READ",
          userName: "Admin",
          clientIPAddress: "",
          jobType: 1,
          commandsExecuted: 100,
          globalReferences: 200,
          inTransaction: 1,
          cpuTime: 5,
        },
      ],
      count: 1,
    };
    mockHttp.get.mockResolvedValue(envelope(jobsData));

    const result = await jobsListTool.handler({}, ctx);

    const text = result.content[0]?.text ?? "";
    expect(text).toContain("** In Transaction **");
  });

  it("should handle empty jobs list", async () => {
    mockHttp.get.mockResolvedValue(
      envelope({ jobs: [], count: 0 }),
    );

    const result = await jobsListTool.handler({}, ctx);

    expect(result.isError).toBeUndefined();
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("0 process(es)");
  });

  it("should return isError on IrisApiError", async () => {
    mockHttp.get.mockRejectedValue(
      new IrisApiError(
        500,
        [{ error: "Server error" }],
        "/api/executemcp/v2/monitor/jobs",
        "Server error",
      ),
    );

    const result = await jobsListTool.handler({}, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain(
      "Error retrieving jobs list",
    );
  });

  it("should propagate non-IrisApiError exceptions", async () => {
    mockHttp.get.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(jobsListTool.handler({}, ctx)).rejects.toThrow(
      "ECONNREFUSED",
    );
  });
});

// ── iris_locks_list ────────────────────────────────────────

describe("iris_locks_list", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should have scope NONE", () => {
    expect(locksListTool.scope).toBe("NONE");
  });

  it("should have readOnlyHint annotation", () => {
    expect(locksListTool.annotations.readOnlyHint).toBe(true);
  });

  it("should call GET /monitor/locks", async () => {
    const locksData = {
      locks: [
        {
          lockName: "^MyGlobal(1,2)",
          ownerPid: 13792,
          owner: "|13792|X||1",
          mode: "X",
          flags: "",
          counts: "1",
        },
      ],
      count: 1,
    };
    mockHttp.get.mockResolvedValue(envelope(locksData));

    const result = await locksListTool.handler({}, ctx);

    expect(mockHttp.get).toHaveBeenCalledWith(
      expect.stringContaining("/api/executemcp/v2/monitor/locks"),
    );
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual(locksData);
  });

  it("should format locks for display", async () => {
    const locksData = {
      locks: [
        {
          lockName: "^MyGlobal(1,2)",
          ownerPid: 13792,
          owner: "|13792|X||1",
          mode: "X",
          flags: "Z",
          counts: "3",
        },
      ],
      count: 1,
    };
    mockHttp.get.mockResolvedValue(envelope(locksData));

    const result = await locksListTool.handler({}, ctx);

    const text = result.content[0]?.text ?? "";
    expect(text).toContain("IRIS Locks (1 lock(s)):");
    expect(text).toContain("Lock: ^MyGlobal(1,2)");
    expect(text).toContain("Owner PID: 13792");
    expect(text).toContain("Mode: X");
    expect(text).toContain("Counts: 3");
    expect(text).toContain("Flags: Z");
  });

  it("should show no active locks message when empty", async () => {
    mockHttp.get.mockResolvedValue(
      envelope({ locks: [], count: 0 }),
    );

    const result = await locksListTool.handler({}, ctx);

    expect(result.isError).toBeUndefined();
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("0 lock(s)");
    expect(text).toContain("No active locks.");
  });

  it("should handle multiple locks", async () => {
    const locksData = {
      locks: [
        {
          lockName: "^GlobalA(1)",
          ownerPid: 100,
          owner: "|100|S||1",
          mode: "S",
          flags: "",
          counts: "1",
        },
        {
          lockName: "^GlobalB(2,3)",
          ownerPid: 200,
          owner: "|200|X||2",
          mode: "X",
          flags: "",
          counts: "2",
        },
      ],
      count: 2,
    };
    mockHttp.get.mockResolvedValue(envelope(locksData));

    const result = await locksListTool.handler({}, ctx);

    const text = result.content[0]?.text ?? "";
    expect(text).toContain("2 lock(s)");
    expect(text).toContain("^GlobalA(1)");
    expect(text).toContain("^GlobalB(2,3)");
  });

  it("should return isError on IrisApiError", async () => {
    mockHttp.get.mockRejectedValue(
      new IrisApiError(
        500,
        [{ error: "Server error" }],
        "/api/executemcp/v2/monitor/locks",
        "Server error",
      ),
    );

    const result = await locksListTool.handler({}, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain(
      "Error retrieving locks list",
    );
  });

  it("should propagate non-IrisApiError exceptions", async () => {
    mockHttp.get.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(locksListTool.handler({}, ctx)).rejects.toThrow(
      "ECONNREFUSED",
    );
  });
});
