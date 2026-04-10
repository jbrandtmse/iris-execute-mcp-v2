import { describe, it, expect, beforeEach } from "vitest";
import type { ToolContext } from "@iris-mcp/shared";
import { IrisApiError } from "@iris-mcp/shared";
import {
  credentialManageTool,
  credentialListTool,
} from "../tools/credential.js";
import { createMockHttp, createMockCtx, envelope } from "@iris-mcp/shared/test-helpers";

// ── iris_credential_manage ──────────────────────────────────────

describe("iris_credential_manage", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should have correct tool metadata", () => {
    expect(credentialManageTool.name).toBe("iris_credential_manage");
    expect(credentialManageTool.annotations?.destructiveHint).toBe(true);
    expect(credentialManageTool.annotations?.readOnlyHint).toBe(false);
    expect(credentialManageTool.scope).toBe("NS");
  });

  it("should send POST with create action", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "created", id: "SMTP-Relay", username: "admin" }),
    );

    const result = await credentialManageTool.handler(
      { action: "create", id: "SMTP-Relay", username: "admin", password: "secret123" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/interop/credential",
      expect.objectContaining({
        action: "create",
        id: "SMTP-Relay",
        username: "admin",
        password: "secret123",
        namespace: "USER",
      }),
    );

    const structured = result.structuredContent as { action: string; id: string; username: string };
    expect(structured.action).toBe("created");
    expect(structured.id).toBe("SMTP-Relay");
    expect(structured.username).toBe("admin");
    expect(result.isError).toBeUndefined();
  });

  it("should send POST with update action", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "updated", id: "SMTP-Relay" }),
    );

    const result = await credentialManageTool.handler(
      { action: "update", id: "SMTP-Relay", password: "newpass" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/interop/credential",
      expect.objectContaining({
        action: "update",
        id: "SMTP-Relay",
        password: "newpass",
      }),
    );

    const structured = result.structuredContent as { action: string; id: string };
    expect(structured.action).toBe("updated");
  });

  it("should send POST with delete action", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "deleted", id: "SMTP-Relay" }),
    );

    const result = await credentialManageTool.handler(
      { action: "delete", id: "SMTP-Relay" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/interop/credential",
      expect.objectContaining({
        action: "delete",
        id: "SMTP-Relay",
      }),
    );

    const structured = result.structuredContent as { action: string; id: string };
    expect(structured.action).toBe("deleted");
  });

  it("should pass resolved namespace in body", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "created", id: "Test" }),
    );

    await credentialManageTool.handler(
      { action: "create", id: "Test", namespace: "MYNS" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/interop/credential",
      expect.objectContaining({ namespace: "MYNS" }),
    );
  });

  it("should not include username/password in body when not provided", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "deleted", id: "Test" }),
    );

    await credentialManageTool.handler(
      { action: "delete", id: "Test" },
      ctx,
    );

    const callBody = mockHttp.post.mock.calls[0]![1] as Record<string, unknown>;
    expect(callBody.username).toBeUndefined();
    expect(callBody.password).toBeUndefined();
  });

  it("should return isError on IrisApiError", async () => {
    mockHttp.post.mockRejectedValue(
      new IrisApiError(400, [{ error: "Invalid" }], "/api/executemcp/v2/interop/credential", "Credential error"),
    );

    const result = await credentialManageTool.handler(
      { action: "create", id: "Bad" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Error managing credential");
    expect(result.content[0]?.text).toContain("Bad");
  });

  it("should rethrow non-IrisApiError", async () => {
    mockHttp.post.mockRejectedValue(new Error("Network failure"));

    await expect(
      credentialManageTool.handler({ action: "create", id: "Test" }, ctx),
    ).rejects.toThrow("Network failure");
  });
});

// ── iris_credential_list ────────────────────────────────────────

describe("iris_credential_list", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should have correct tool metadata", () => {
    expect(credentialListTool.name).toBe("iris_credential_list");
    expect(credentialListTool.annotations?.readOnlyHint).toBe(true);
    expect(credentialListTool.annotations?.destructiveHint).toBe(false);
    expect(credentialListTool.scope).toBe("NS");
  });

  it("should send GET with namespace query param", async () => {
    mockHttp.get.mockResolvedValue(
      envelope({
        credentials: [
          { id: "SMTP-Relay", username: "admin" },
          { id: "DB-Conn", username: "dbuser" },
        ],
        count: 2,
      }),
    );

    const result = await credentialListTool.handler({}, ctx);

    expect(mockHttp.get).toHaveBeenCalledWith(
      expect.stringContaining("/api/executemcp/v2/interop/credential"),
    );
    expect(mockHttp.get).toHaveBeenCalledWith(
      expect.stringContaining("namespace=USER"),
    );

    const structured = result.structuredContent as {
      credentials: Array<{ id: string; username: string }>;
      count: number;
    };
    expect(structured.credentials).toHaveLength(2);
    expect(structured.count).toBe(2);
    expect(result.isError).toBeUndefined();
  });

  it("should never include password in response", async () => {
    mockHttp.get.mockResolvedValue(
      envelope({
        credentials: [{ id: "Test", username: "user1" }],
        count: 1,
      }),
    );

    const result = await credentialListTool.handler({}, ctx);

    const text = result.content[0]?.text ?? "";
    expect(text).not.toContain("password");
    expect(text).not.toContain("Password");

    const structured = result.structuredContent as {
      credentials: Array<Record<string, unknown>>;
    };
    for (const cred of structured.credentials) {
      expect(cred).not.toHaveProperty("password");
    }
  });

  it("should pass custom namespace", async () => {
    mockHttp.get.mockResolvedValue(
      envelope({ credentials: [], count: 0 }),
    );

    await credentialListTool.handler({ namespace: "PROD" }, ctx);

    expect(mockHttp.get).toHaveBeenCalledWith(
      expect.stringContaining("namespace=PROD"),
    );
  });

  it("should return isError on IrisApiError", async () => {
    mockHttp.get.mockRejectedValue(
      new IrisApiError(500, [{ error: "Server error" }], "/api/executemcp/v2/interop/credential", "List error"),
    );

    const result = await credentialListTool.handler({}, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Error listing credentials");
  });

  it("should rethrow non-IrisApiError", async () => {
    mockHttp.get.mockRejectedValue(new Error("Timeout"));

    await expect(
      credentialListTool.handler({}, ctx),
    ).rejects.toThrow("Timeout");
  });
});
