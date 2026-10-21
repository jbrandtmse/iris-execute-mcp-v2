import { describe, it, expect, beforeEach } from "vitest";
import type { ToolContext } from "@iris-mcp/shared";
import { IrisApiError } from "@iris-mcp/shared";
import { auditManageTool } from "../tools/audit.js";
import {
  createMockHttp,
  createMockCtx,
  envelope,
} from "@iris-mcp/shared/test-helpers";

// ── iris_audit_manage ───────────────────────────────────────────

describe("iris_audit_manage", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  // ── status (read) ─────────────────────────────────────────────

  it("status: GETs the audit endpoint and returns auditEnabled + event summary", async () => {
    const statusData = {
      auditEnabled: true,
      events: [
        {
          source: "%System",
          type: "%Login",
          name: "Login",
          description: "User login",
          enabled: "Yes",
          total: 10,
          written: 10,
          lost: 0,
        },
      ],
      eventCount: 1,
    };
    mockHttp.get.mockResolvedValue(envelope(statusData));

    const result = await auditManageTool.handler({ action: "status" }, ctx);

    expect(mockHttp.get).toHaveBeenCalledWith(
      "/api/executemcp/v2/security/audit",
    );
    const structured = result.structuredContent as typeof statusData;
    expect(structured.auditEnabled).toBe(true);
    expect(structured.events).toHaveLength(1);
    expect(result.isError).toBeUndefined();
  });

  // ── view (read, filtered) ─────────────────────────────────────

  it("view: GETs with all filters mapped onto the query string", async () => {
    mockHttp.get.mockResolvedValue(
      envelope({
        events: [
          { timestamp: "2026-06-16 10:00:00", username: "alice", event: "Login" },
        ],
        count: 1,
        maxRows: 50,
      }),
    );

    const result = await auditManageTool.handler(
      {
        action: "view",
        begin: "2026-06-01 00:00:00",
        end: "2026-06-16 23:59:59",
        user: "alice",
        event: "Login",
        source: "%System",
        type: "%Login",
        maxRows: 50,
      },
      ctx,
    );

    expect(mockHttp.get).toHaveBeenCalledTimes(1);
    const calledUrl = mockHttp.get.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain("/api/executemcp/v2/security/audit?");
    expect(calledUrl).toContain("action=view");
    expect(calledUrl).toContain("begin=2026-06-01");
    expect(calledUrl).toContain("end=2026-06-16");
    expect(calledUrl).toContain("user=alice");
    expect(calledUrl).toContain("event=Login");
    expect(calledUrl).toContain("source=%25System");
    expect(calledUrl).toContain("type=%25Login");
    expect(calledUrl).toContain("maxRows=50");

    const structured = result.structuredContent as {
      events: unknown[];
      count: number;
    };
    expect(structured.events).toHaveLength(1);
    expect(structured.count).toBe(1);
    expect(result.isError).toBeUndefined();
  });

  it("view: omits empty filters from the query string", async () => {
    mockHttp.get.mockResolvedValue(envelope({ events: [], count: 0 }));

    await auditManageTool.handler({ action: "view" }, ctx);

    const calledUrl = mockHttp.get.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain("action=view");
    expect(calledUrl).not.toContain("begin=");
    expect(calledUrl).not.toContain("user=");
    expect(calledUrl).not.toContain("maxRows=");
  });

  it("view: returns an empty event list cleanly", async () => {
    mockHttp.get.mockResolvedValue(envelope({ events: [], count: 0 }));

    const result = await auditManageTool.handler({ action: "view" }, ctx);
    const structured = result.structuredContent as {
      events: unknown[];
      count: number;
    };
    expect(structured.events).toEqual([]);
    expect(structured.count).toBe(0);
  });

  // ── enable / disable (write) ──────────────────────────────────

  it("enable: POSTs action=enable", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "enable", auditEnabled: true, success: true }),
    );

    const result = await auditManageTool.handler({ action: "enable" }, ctx);

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/security/audit",
      { action: "enable" },
    );
    const structured = result.structuredContent as { auditEnabled: boolean };
    expect(structured.auditEnabled).toBe(true);
  });

  it("disable: POSTs action=disable", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "disable", auditEnabled: false, success: true }),
    );

    const result = await auditManageTool.handler({ action: "disable" }, ctx);

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/security/audit",
      { action: "disable" },
    );
    const structured = result.structuredContent as { auditEnabled: boolean };
    expect(structured.auditEnabled).toBe(false);
  });

  // ── configureEvent (write) ────────────────────────────────────

  it("configureEvent: POSTs source+type+name+enabled", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({
        action: "configureEvent",
        source: "%System",
        type: "%Login",
        name: "Login",
        enabled: false,
        success: true,
      }),
    );

    const result = await auditManageTool.handler(
      {
        action: "configureEvent",
        source: "%System",
        type: "%Login",
        name: "Login",
        enabled: false,
      },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/security/audit",
      {
        action: "configureEvent",
        source: "%System",
        type: "%Login",
        name: "Login",
        enabled: false,
      },
    );
    const structured = result.structuredContent as { success: boolean };
    expect(structured.success).toBe(true);
  });

  it("configureEvent: rejects missing source/type/name/enabled without POSTing", async () => {
    const result = await auditManageTool.handler(
      { action: "configureEvent", source: "%System" },
      ctx,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("configureEvent");
    expect(mockHttp.post).not.toHaveBeenCalled();
  });

  it("configureEvent: enabled:false is honored (not treated as missing)", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "configureEvent", success: true }),
    );
    const result = await auditManageTool.handler(
      {
        action: "configureEvent",
        source: "s",
        type: "t",
        name: "n",
        enabled: false,
      },
      ctx,
    );
    // enabled:false must NOT trip the "missing" guard.
    expect(result.isError).toBeUndefined();
    expect(mockHttp.post).toHaveBeenCalled();
  });

  // ── purge (destructive, write) ────────────────────────────────

  it("purge: requires confirm:true — refuses without POSTing", async () => {
    const result = await auditManageTool.handler(
      { action: "purge", end: "2026-01-01 00:00:00" },
      ctx,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("confirm");
    expect(mockHttp.post).not.toHaveBeenCalled();
  });

  it("purge: requires a bounded scope even with confirm:true", async () => {
    const result = await auditManageTool.handler(
      { action: "purge", confirm: true },
      ctx,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("bounded scope");
    expect(mockHttp.post).not.toHaveBeenCalled();
  });

  it("purge: with confirm:true + a bound, POSTs and returns the deleted count", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "purge", deleted: 42, success: true }),
    );

    const result = await auditManageTool.handler(
      { action: "purge", confirm: true, end: "2026-01-01 00:00:00" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/security/audit",
      { action: "purge", confirm: true, end: "2026-01-01 00:00:00" },
    );
    const structured = result.structuredContent as { deleted: number };
    expect(structured.deleted).toBe(42);
  });

  // ── export (write, path-controlled) ───────────────────────────

  it("export: POSTs fileName + filters and returns location + count", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({
        action: "export",
        location: "/iris/mgr/auditexport/dump.xml",
        exported: 7,
        success: true,
      }),
    );

    const result = await auditManageTool.handler(
      { action: "export", fileName: "dump.xml", user: "bob" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/security/audit",
      { action: "export", fileName: "dump.xml", user: "bob" },
    );
    const structured = result.structuredContent as {
      location: string;
      exported: number;
    };
    expect(structured.location).toContain("dump.xml");
    expect(structured.exported).toBe(7);
  });

  it("export: rejects a missing fileName without POSTing", async () => {
    const result = await auditManageTool.handler({ action: "export" }, ctx);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("fileName");
    expect(mockHttp.post).not.toHaveBeenCalled();
  });

  it("export: rejects a path-traversal fileName without POSTing", async () => {
    for (const bad of ["../etc/passwd", "sub/dir.xml", "a\\b.xml"]) {
      mockHttp.post.mockClear();
      const result = await auditManageTool.handler(
        { action: "export", fileName: bad },
        ctx,
      );
      expect(result.isError, `fileName '${bad}' must be rejected`).toBe(true);
      expect(result.content[0]?.text).toContain("path separators");
      expect(mockHttp.post).not.toHaveBeenCalled();
    }
  });

  // ── error handling ────────────────────────────────────────────

  it("returns isError on IrisApiError (preserves text)", async () => {
    mockHttp.get.mockRejectedValue(
      new IrisApiError(
        400,
        [{ error: "Auditing requires %Admin_Secure:Use" }],
        "/api/executemcp/v2/security/audit",
        "Auditing requires %Admin_Secure:Use",
      ),
    );

    const result = await auditManageTool.handler({ action: "status" }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("%Admin_Secure");
  });

  it("propagates non-IrisApiError exceptions", async () => {
    mockHttp.get.mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(
      auditManageTool.handler({ action: "status" }, ctx),
    ).rejects.toThrow("ECONNREFUSED");
  });

  // ── tool metadata ─────────────────────────────────────────────

  it("has scope SYS, is mutate-capable, and is destructiveHint:true", () => {
    expect(auditManageTool.scope).toBe("SYS");
    expect(auditManageTool.annotations.readOnlyHint).toBe(false);
    expect(auditManageTool.annotations.destructiveHint).toBe(true);
  });

  it("classifies every action in `mutates` (status/view=read; rest=write)", () => {
    expect(auditManageTool.mutates).toEqual({
      status: "read",
      view: "read",
      enable: "write",
      disable: "write",
      configureEvent: "write",
      purge: "write",
      export: "write",
    });
  });

  it("declares the action enum with all seven actions", () => {
    const shape = auditManageTool.inputSchema.shape as Record<string, unknown>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const options = (shape.action as any)?.options;
    expect(options).toEqual([
      "status",
      "enable",
      "disable",
      "configureEvent",
      "view",
      "purge",
      "export",
    ]);
  });

  it("does NOT declare a reserved `server` field (framework injects it)", () => {
    const shape = auditManageTool.inputSchema.shape as Record<string, unknown>;
    expect(shape).not.toHaveProperty("server");
  });

  it("description notes the relationship to iris_audit_events", () => {
    expect(auditManageTool.description).toContain("iris_audit_events");
  });
});

// ── Story 43.3: confirmation (the purge gate) ───────────────────

type ConfirmFn = NonNullable<ToolContext["confirm"]>;
type ConfirmRequest = Parameters<ConfirmFn>[0];
type ConfirmOutcome = Awaited<ReturnType<ConfirmFn>>;

const AUDIT_PATH = "/api/executemcp/v2/security/audit";
const END_ONLY = { action: "purge", confirm: true, end: "2026-01-01 00:00:00" };

/** The confirmation request the purge gate must make for `scope`. */
function purgeAsk(scope: string): ConfirmRequest {
  return {
    operation: "permanently delete audit-log records",
    target: "the IRIS audit log",
    scope,
  };
}

describe("Story 43.3: confirmation", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;
  /** Every `confirm` and every POST, in the order they happened. */
  let log: string[];
  let requests: ConfirmRequest[];

  /** Put a `confirm` on `ctx` that records its request and answers `outcome`. */
  function answerWith(outcome: ConfirmOutcome): void {
    ctx.confirm = async (request: ConfirmRequest) => {
      log.push("confirm");
      requests.push(request);
      return outcome;
    };
  }

  /** A fresh context with no `confirm` and its own HTTP mock, for a "today's behavior" reference run. */
  function bareContext(): {
    http: ReturnType<typeof createMockHttp>;
    ctx: ToolContext;
  } {
    const http = createMockHttp();
    http.post.mockResolvedValue(
      envelope({ action: "purge", deleted: 3, success: true }),
    );
    return { http, ctx: createMockCtx(http) };
  }

  /** A refusal-shaped result, the shape `ctx.confirm` hands back on a decline. */
  function declinedResult() {
    return {
      content: [
        {
          type: "text" as const,
          text:
            "The person declined the confirmation for: permanently delete " +
            "audit-log records. Nothing was changed. Do not repeat this call " +
            "unless the person asks for it again.",
        },
      ],
      structuredContent: {
        code: "CONFIRMATION_DECLINED",
        action: "purge",
        response: "decline",
      },
      isError: true as const,
    };
  }

  beforeEach(() => {
    log = [];
    requests = [];
    mockHttp = createMockHttp();
    mockHttp.post.mockImplementation(async () => {
      log.push("post");
      return envelope({ action: "purge", deleted: 3, success: true });
    });
    ctx = createMockCtx(mockHttp);
  });

  // ── purge asks, then writes ───────────────────────────────────

  it("purge: asks exactly once with the fixed operation/target and a one-filter scope, then POSTs", async () => {
    answerWith({ proceed: true });

    await auditManageTool.handler({ ...END_ONLY }, ctx);

    expect(requests).toEqual([
      {
        operation: "permanently delete audit-log records",
        target: "the IRIS audit log",
        scope: "records matching end=2026-01-01 00:00:00",
      },
    ]);
    expect(log).toEqual(["confirm", "post"]);
    expect(mockHttp.post).toHaveBeenCalledTimes(1);
  });

  it("purge: scope lists all six filters in the order begin, end, user, event, source, type", async () => {
    answerWith({ proceed: true });

    // The argument keys are deliberately NOT in scope order.
    await auditManageTool.handler(
      {
        action: "purge",
        confirm: true,
        type: "%Login",
        source: "%System",
        event: "Login",
        user: "alice",
        end: "2026-06-30 23:59:59",
        begin: "2026-01-01 00:00:00",
      },
      ctx,
    );

    expect(requests).toEqual([
      purgeAsk(
        "records matching begin=2026-01-01 00:00:00, " +
          "end=2026-06-30 23:59:59, user=alice, event=Login, " +
          "source=%System, type=%Login",
      ),
    ]);
    expect(log).toEqual(["confirm", "post"]);
  });

  it("purge: scope leaves out empty-string filters", async () => {
    answerWith({ proceed: true });

    await auditManageTool.handler(
      {
        action: "purge",
        confirm: true,
        begin: "",
        end: "2026-01-01 00:00:00",
        user: "",
        event: "Login",
        source: "",
        type: "",
      },
      ctx,
    );

    expect(requests).toEqual([
      purgeAsk("records matching end=2026-01-01 00:00:00, event=Login"),
    ]);
  });

  it("purge: a supplied '*' wildcard is shown in the scope as user=*", async () => {
    answerWith({ proceed: true });

    await auditManageTool.handler(
      {
        action: "purge",
        confirm: true,
        end: "2026-01-01 00:00:00",
        user: "*",
      },
      ctx,
    );

    expect(requests).toEqual([
      purgeAsk("records matching end=2026-01-01 00:00:00, user=*"),
    ]);
    expect(log).toEqual(["confirm", "post"]);
  });

  // ── purge refuses before it asks ──────────────────────────────

  it("purge: confirm missing refuses as today and never asks", async () => {
    answerWith({ proceed: true });
    const bare = bareContext();
    const args = { action: "purge", end: "2026-01-01 00:00:00" };

    const result = await auditManageTool.handler({ ...args }, ctx);
    const today = await auditManageTool.handler({ ...args }, bare.ctx);

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: "Error: 'purge' is destructive and requires confirm:true to proceed.",
        },
      ],
      isError: true,
    });
    expect(result).toEqual(today);
    expect(requests).toEqual([]);
    expect(log).toEqual([]);
    expect(mockHttp.post).not.toHaveBeenCalled();
  });

  it("purge: confirm:false refuses as today and never asks", async () => {
    answerWith({ proceed: true });
    const bare = bareContext();
    const args = { action: "purge", confirm: false, end: "2026-01-01 00:00:00" };

    const result = await auditManageTool.handler({ ...args }, ctx);
    const today = await auditManageTool.handler({ ...args }, bare.ctx);

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: "Error: 'purge' is destructive and requires confirm:true to proceed.",
        },
      ],
      isError: true,
    });
    expect(result).toEqual(today);
    expect(requests).toEqual([]);
    expect(log).toEqual([]);
    expect(mockHttp.post).not.toHaveBeenCalled();
  });

  it("purge: no bound at all (only a '*' wildcard) refuses as today and never asks", async () => {
    answerWith({ proceed: true });
    const bare = bareContext();
    const args = { action: "purge", confirm: true, source: "*" };

    const result = await auditManageTool.handler({ ...args }, ctx);
    const today = await auditManageTool.handler({ ...args }, bare.ctx);

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text:
            "Error: 'purge' requires a bounded scope " +
            String.fromCharCode(0x2014) +
            " supply at least " +
            "one of begin, end, or a non-wildcard user, event, source, or type.",
        },
      ],
      isError: true,
    });
    expect(result).toEqual(today);
    expect(requests).toEqual([]);
    expect(log).toEqual([]);
    expect(mockHttp.post).not.toHaveBeenCalled();
    expect(bare.http.post).not.toHaveBeenCalled();
  });

  // ── the answer decides ────────────────────────────────────────

  it("purge: a declined outcome returns its result unchanged and writes nothing", async () => {
    const declined = declinedResult();
    answerWith({ proceed: false, result: declined });

    const result = await auditManageTool.handler({ ...END_ONLY }, ctx);

    expect(result).toBe(declined);
    expect(log).toEqual(["confirm"]);
    expect(mockHttp.post).not.toHaveBeenCalled();
  });

  it("purge: a proceed outcome POSTs the same path and body as a context with no confirm", async () => {
    const bare = bareContext();
    const args = {
      action: "purge",
      confirm: true,
      end: "2026-01-01 00:00:00",
      user: "alice",
    };
    const today = await auditManageTool.handler({ ...args }, bare.ctx);

    answerWith({ proceed: true });
    const result = await auditManageTool.handler({ ...args }, ctx);

    expect(bare.http.post).toHaveBeenCalledTimes(1);
    expect(mockHttp.post).toHaveBeenCalledTimes(1);
    expect(mockHttp.post.mock.calls[0]).toEqual(bare.http.post.mock.calls[0]);
    expect(mockHttp.post.mock.calls[0]).toEqual([
      AUDIT_PATH,
      {
        action: "purge",
        confirm: true,
        end: "2026-01-01 00:00:00",
        user: "alice",
      },
    ]);
    expect(result).toEqual(today);
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      action: "purge",
      deleted: 3,
      success: true,
    });
  });

  it("purge: with no ctx.confirm on the context it writes as today", async () => {
    expect(ctx.confirm).toBeUndefined();

    const result = await auditManageTool.handler({ ...END_ONLY }, ctx);

    expect(mockHttp.post).toHaveBeenCalledTimes(1);
    expect(mockHttp.post).toHaveBeenCalledWith(AUDIT_PATH, {
      action: "purge",
      confirm: true,
      end: "2026-01-01 00:00:00",
    });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      action: "purge",
      deleted: 3,
      success: true,
    });
    expect(log).toEqual(["post"]);
  });

  // ── no other action asks ──────────────────────────────────────

  it.each([
    ["status", { action: "status" }],
    ["view", { action: "view" }],
    ["enable", { action: "enable" }],
    ["disable", { action: "disable" }],
    [
      "configureEvent",
      {
        action: "configureEvent",
        source: "%System",
        type: "%Login",
        name: "Login",
        enabled: false,
      },
    ],
    ["export", { action: "export", fileName: "dump.xml", user: "bob" }],
  ])("%s: never calls confirm", async (_name, args) => {
    // A decline would end the call, so a stray ask is visible in the result too.
    answerWith({ proceed: false, result: declinedResult() });
    mockHttp.get.mockResolvedValue(
      envelope({ auditEnabled: true, events: [], eventCount: 0, count: 0 }),
    );

    const result = await auditManageTool.handler({ ...args }, ctx);

    expect(requests).toEqual([]);
    expect(log).not.toContain("confirm");
    expect(result.isError).toBeUndefined();
  });
});
