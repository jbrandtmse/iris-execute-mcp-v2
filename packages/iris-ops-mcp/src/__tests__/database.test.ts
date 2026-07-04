import { describe, it, expect, beforeEach } from "vitest";
import type { ToolContext } from "@iris-mcp/shared";
import { IrisApiError } from "@iris-mcp/shared";
import { databaseActionTool } from "../tools/database.js";
import {
  createMockHttp,
  createMockCtx,
  envelope,
} from "@iris-mcp/shared/test-helpers";

// ── iris_database_action ────────────────────────────────────────

const DIR = "c:\\InterSystems\\IRIS\\mgr\\testdb\\";

describe("iris_database_action", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  // ── shape / governance metadata ──

  it("should have scope NONE", () => {
    expect(databaseActionTool.scope).toBe("NONE");
  });

  it("should classify every action as a write in mutates", () => {
    expect(databaseActionTool.mutates).toEqual({
      mount: "write",
      dismount: "write",
      compact: "write",
      defragment: "write",
      truncate: "write",
      expandVolume: "write",
    });
  });

  it("should carry destructiveHint at the tool scope (dismount/truncate)", () => {
    expect(databaseActionTool.annotations.destructiveHint).toBe(true);
  });

  // ── namespace param: accepted-but-ignored (Story 18.0, CR 16.2-1) ──

  it("namespace description states the value has NO EFFECT (%SYS-scoped)", () => {
    const shape = (
      databaseActionTool.inputSchema as unknown as {
        shape: { namespace: { description?: string } };
      }
    ).shape;
    const desc = shape.namespace.description ?? "";
    expect(desc).toContain("NO EFFECT");
    expect(desc).toContain("%SYS-scoped");
  });

  it("namespace param is still accepted and forwarded without error (back-compat)", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "mount", directory: DIR, success: 1 }),
    );

    const result = await databaseActionTool.handler(
      { action: "mount", directory: DIR, namespace: "%SYS" },
      ctx,
    );

    expect(result.isError).toBeUndefined();
    expect(mockHttp.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ namespace: "%SYS" }),
    );
  });

  // ── numeric range validation (CR 16.2-2) ──

  it("rejects out-of-range percentFull / negative targetSize / non-positive initialSize", () => {
    const schema = databaseActionTool.inputSchema as unknown as {
      safeParse: (v: unknown) => { success: boolean };
    };
    // percentFull must be 1-100
    expect(
      schema.safeParse({ action: "compact", directory: DIR, percentFull: 0 })
        .success,
    ).toBe(false);
    expect(
      schema.safeParse({ action: "compact", directory: DIR, percentFull: 150 })
        .success,
    ).toBe(false);
    // targetSize must be non-negative; 0 is the documented "return all" default
    expect(
      schema.safeParse({ action: "truncate", directory: DIR, targetSize: -1 })
        .success,
    ).toBe(false);
    expect(
      schema.safeParse({ action: "truncate", directory: DIR, targetSize: 0 })
        .success,
    ).toBe(true);
    // initialSize must be positive (a new volume needs a size)
    expect(
      schema.safeParse({
        action: "expandVolume",
        directory: DIR,
        newVolDir: "d:\\v2\\",
        initialSize: 0,
      }).success,
    ).toBe(false);
    // valid values still pass
    expect(
      schema.safeParse({ action: "compact", directory: DIR, percentFull: 90 })
        .success,
    ).toBe(true);
  });

  it("an empty-string namespace is accepted and dropped from the POST body (accepted-but-ignored)", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "mount", directory: DIR, success: 1 }),
    );

    const result = await databaseActionTool.handler(
      { action: "mount", directory: DIR, namespace: "" },
      ctx,
    );

    // Empty string is treated as "not supplied" — accepted without error and
    // never placed on the wire (the param has no effect either way).
    expect(result.isError).toBeUndefined();
    const body = mockHttp.post.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(body).not.toHaveProperty("namespace");
  });

  // ── mount ──

  it("mount should POST /monitor/database/action with {action, directory}", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "mount", directory: DIR, readonly: 0, success: 1 }),
    );

    const result = await databaseActionTool.handler(
      { action: "mount", directory: DIR },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      expect.stringContaining("/api/executemcp/v2/monitor/database/action"),
      { action: "mount", directory: DIR },
    );
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain("success");
  });

  it("mount should forward the readonly flag when supplied", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "mount", directory: DIR, readonly: 1, success: 1 }),
    );

    await databaseActionTool.handler(
      { action: "mount", directory: DIR, readonly: true },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ readonly: true }),
    );
  });

  it("mount should surface the read-only status in the text output", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "mount", directory: DIR, readonly: 1, success: 1 }),
    );

    const result = await databaseActionTool.handler(
      { action: "mount", directory: DIR, readonly: true },
      ctx,
    );

    expect(result.content[0]?.text ?? "").toContain("Read-only: yes");
  });

  it("mount should report read-only no when mounted read-write", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "mount", directory: DIR, readonly: 0, success: 1 }),
    );

    const result = await databaseActionTool.handler(
      { action: "mount", directory: DIR },
      ctx,
    );

    expect(result.content[0]?.text ?? "").toContain("Read-only: no");
  });

  it("mount should omit readonly from the body when not supplied", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "mount", directory: DIR, readonly: 0, success: 1 }),
    );

    await databaseActionTool.handler({ action: "mount", directory: DIR }, ctx);

    const body = mockHttp.post.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(body).not.toHaveProperty("readonly");
  });

  // ── dismount ──

  it("dismount should POST {action, directory}", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "dismount", directory: DIR, success: 1 }),
    );

    const result = await databaseActionTool.handler(
      { action: "dismount", directory: DIR },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      expect.any(String),
      { action: "dismount", directory: DIR },
    );
    expect(result.isError).toBeUndefined();
  });

  // ── compact ──

  it("compact should forward percentFull and surface mbProcessed/mbCompressed", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({
        action: "compact",
        directory: DIR,
        percentFull: 80,
        mbProcessed: 120,
        mbCompressed: 95,
        success: 1,
      }),
    );

    const result = await databaseActionTool.handler(
      { action: "compact", directory: DIR, percentFull: 80 },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ percentFull: 80 }),
    );
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("MB processed: 120");
    expect(text).toContain("MB after compaction: 95");
    const sc = result.structuredContent as {
      mbProcessed: number;
      mbCompressed: number;
    };
    expect(sc.mbProcessed).toBe(120);
    expect(sc.mbCompressed).toBe(95);
  });

  it("compact should omit percentFull from the body when not supplied", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "compact", directory: DIR, success: 1 }),
    );

    await databaseActionTool.handler({ action: "compact", directory: DIR }, ctx);

    const body = mockHttp.post.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(body).not.toHaveProperty("percentFull");
  });

  // ── defragment ──

  it("defragment should POST {action, directory}", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "defragment", directory: DIR, success: 1 }),
    );

    const result = await databaseActionTool.handler(
      { action: "defragment", directory: DIR },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(expect.any(String), {
      action: "defragment",
      directory: DIR,
    });
    expect(result.isError).toBeUndefined();
  });

  it("defragment should surface the server result via structuredContent", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "defragment", directory: DIR, success: 1 }),
    );

    const result = await databaseActionTool.handler(
      { action: "defragment", directory: DIR },
      ctx,
    );

    const sc = result.structuredContent as {
      action: string;
      directory: string;
      success: number;
    };
    expect(sc.action).toBe("defragment");
    expect(sc.directory).toBe(DIR);
    expect(sc.success).toBe(1);
  });

  // ── truncate ──

  it("truncate should forward targetSize and surface returnSize", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({
        action: "truncate",
        directory: DIR,
        targetSize: 0,
        returnSize: 64,
        success: 1,
      }),
    );

    const result = await databaseActionTool.handler(
      { action: "truncate", directory: DIR, targetSize: 0 },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ targetSize: 0 }),
    );
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("New size: 64 MB");
    const sc = result.structuredContent as { returnSize: number };
    expect(sc.returnSize).toBe(64);
  });

  // ── expandVolume ──

  it("expandVolume should forward newVolDir + initialSize", async () => {
    const newVol = "d:\\IRIS\\vol2\\";
    mockHttp.post.mockResolvedValue(
      envelope({
        action: "expandVolume",
        directory: DIR,
        newVolDir: newVol,
        initialSize: 100,
        success: 1,
      }),
    );

    const result = await databaseActionTool.handler(
      {
        action: "expandVolume",
        directory: DIR,
        newVolDir: newVol,
        initialSize: 100,
      },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ newVolDir: newVol, initialSize: 100 }),
    );
    expect(result.content[0]?.text ?? "").toContain(newVol);
  });

  it("expandVolume should omit initialSize from the body when not supplied", async () => {
    const newVol = "d:\\IRIS\\vol2\\";
    mockHttp.post.mockResolvedValue(
      envelope({
        action: "expandVolume",
        directory: DIR,
        newVolDir: newVol,
        success: 1,
      }),
    );

    await databaseActionTool.handler(
      { action: "expandVolume", directory: DIR, newVolDir: newVol },
      ctx,
    );

    const body = mockHttp.post.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(body).toHaveProperty("newVolDir", newVol);
    expect(body).not.toHaveProperty("initialSize");
  });

  it("expandVolume without newVolDir returns a clear error and does NOT call the server", async () => {
    const result = await databaseActionTool.handler(
      { action: "expandVolume", directory: DIR },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("newVolDir");
    expect(mockHttp.post).not.toHaveBeenCalled();
  });

  // ── required-directory validation ──

  it("missing directory returns a clear error and does NOT call the server", async () => {
    const result = await databaseActionTool.handler(
      { action: "compact", directory: "" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("'directory' is required");
    expect(mockHttp.post).not.toHaveBeenCalled();
  });

  it("omitted directory (undefined) returns a clear error and does NOT call the server", async () => {
    const result = await databaseActionTool.handler(
      { action: "mount" } as { action: "mount"; directory: string },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("'directory' is required");
    expect(mockHttp.post).not.toHaveBeenCalled();
  });

  // ── optional namespace passthrough ──

  it("should forward an optional namespace in the body", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "dismount", directory: DIR, success: 1 }),
    );

    await databaseActionTool.handler(
      { action: "dismount", directory: DIR, namespace: "%SYS" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ namespace: "%SYS" }),
    );
  });

  // ── server error / refusal surfacing ──

  it("an invalid/missing directory rejected by the server surfaces as isError (clean, not a crash)", async () => {
    mockHttp.post.mockRejectedValue(
      new IrisApiError(
        500,
        [
          {
            error:
              "ERROR #5001: Database directory 'c:\\nope\\' does not exist or is not a configured IRIS database.",
          },
        ],
        "/api/executemcp/v2/monitor/database/action",
        "ERROR #5001: Database directory 'c:\\nope\\' does not exist or is not a configured IRIS database.",
      ),
    );

    const result = await databaseActionTool.handler(
      { action: "dismount", directory: "c:\\nope\\" },
      ctx,
    );

    expect(result.isError).toBe(true);
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("Error performing 'dismount' on database");
    expect(text).toContain("does not exist");
  });

  it("a DB-in-use failure on truncate surfaces the server %Status reason", async () => {
    mockHttp.post.mockRejectedValue(
      new IrisApiError(
        500,
        [{ error: "ERROR #5001: Conflicting database operation in progress" }],
        "/api/executemcp/v2/monitor/database/action",
        "ERROR #5001: Conflicting database operation in progress",
      ),
    );

    const result = await databaseActionTool.handler(
      { action: "truncate", directory: DIR },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Conflicting database operation");
  });

  it("should propagate non-IrisApiError exceptions", async () => {
    mockHttp.post.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      databaseActionTool.handler({ action: "mount", directory: DIR }, ctx),
    ).rejects.toThrow("ECONNREFUSED");
  });
});
