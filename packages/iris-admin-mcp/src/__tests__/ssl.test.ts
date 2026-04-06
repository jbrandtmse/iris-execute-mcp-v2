import { describe, it, expect, beforeEach } from "vitest";
import type { ToolContext } from "@iris-mcp/shared";
import { IrisApiError } from "@iris-mcp/shared";
import { sslManageTool, sslListTool } from "../tools/ssl.js";
import {
  createMockHttp,
  createMockCtx,
  envelope,
} from "@iris-mcp/shared/test-helpers";

// ── iris.ssl.manage ─────────────────────────────────────────────

describe("iris.ssl.manage", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should send POST with action and name for create", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "created", name: "MySSLConfig" }),
    );

    const result = await sslManageTool.handler(
      {
        action: "create",
        name: "MySSLConfig",
        certFile: "/path/to/cert.pem",
        keyFile: "/path/to/key.pem",
        verifyPeer: 1,
      },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/security/ssl",
      expect.objectContaining({
        action: "create",
        name: "MySSLConfig",
        certFile: "/path/to/cert.pem",
        keyFile: "/path/to/key.pem",
        verifyPeer: 1,
      }),
    );

    const structured = result.structuredContent as {
      action: string;
      name: string;
    };
    expect(structured.action).toBe("created");
    expect(structured.name).toBe("MySSLConfig");
    expect(result.isError).toBeUndefined();
  });

  it("should send POST for modify with only provided fields", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "modified", name: "MySSLConfig" }),
    );

    await sslManageTool.handler(
      {
        action: "modify",
        name: "MySSLConfig",
        description: "Updated description",
      },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/security/ssl",
      expect.objectContaining({
        action: "modify",
        name: "MySSLConfig",
        description: "Updated description",
      }),
    );
  });

  it("should send POST for delete with only name", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "deleted", name: "OldConfig" }),
    );

    const result = await sslManageTool.handler(
      { action: "delete", name: "OldConfig" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/security/ssl",
      expect.objectContaining({
        action: "delete",
        name: "OldConfig",
      }),
    );

    const structured = result.structuredContent as {
      action: string;
      name: string;
    };
    expect(structured.action).toBe("deleted");
  });

  it("should include all optional properties when provided", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "created", name: "FullConfig" }),
    );

    await sslManageTool.handler(
      {
        action: "create",
        name: "FullConfig",
        description: "Full SSL config",
        certFile: "/certs/server.crt",
        keyFile: "/certs/server.key",
        caFile: "/certs/ca.crt",
        caPath: "/certs/ca/",
        cipherList: "TLS_AES_256_GCM_SHA384",
        protocols: 24,
        verifyPeer: 1,
        verifyDepth: 9,
        type: 1,
        enabled: true,
      },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/security/ssl",
      expect.objectContaining({
        action: "create",
        name: "FullConfig",
        description: "Full SSL config",
        certFile: "/certs/server.crt",
        keyFile: "/certs/server.key",
        caFile: "/certs/ca.crt",
        caPath: "/certs/ca/",
        cipherList: "TLS_AES_256_GCM_SHA384",
        protocols: 24,
        verifyPeer: 1,
        verifyDepth: 9,
        type: 1,
        enabled: 1,
      }),
    );
  });

  it("should convert enabled boolean to number", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "created", name: "BoolTest" }),
    );

    await sslManageTool.handler(
      { action: "create", name: "BoolTest", enabled: false },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/security/ssl",
      expect.objectContaining({ enabled: 0 }),
    );
  });

  it("should return isError on IrisApiError", async () => {
    mockHttp.post.mockRejectedValue(
      new IrisApiError(
        400,
        [{ error: "Invalid" }],
        "/api/executemcp/v2/security/ssl",
        "Invalid SSL configuration",
      ),
    );

    const result = await sslManageTool.handler(
      { action: "create", name: "BadConfig" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain(
      "Error managing SSL/TLS configuration",
    );
    expect(result.content[0]?.text).toContain("BadConfig");
  });

  it("should propagate non-IrisApiError exceptions", async () => {
    mockHttp.post.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      sslManageTool.handler({ action: "create", name: "test" }, ctx),
    ).rejects.toThrow("ECONNREFUSED");
  });

  it("should have correct annotations (destructiveHint: true)", () => {
    expect(sslManageTool.annotations).toEqual({
      destructiveHint: true,
      readOnlyHint: false,
      idempotentHint: false,
      openWorldHint: false,
    });
  });

  it("should have scope SYS", () => {
    expect(sslManageTool.scope).toBe("SYS");
  });
});

// ── iris.ssl.list ──────────────────────────────────────────────

describe("iris.ssl.list", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should return list of SSL configurations with count", async () => {
    const configData = [
      {
        name: "DefaultSSL",
        description: "Default SSL config",
        certFile: "/certs/server.crt",
        keyFile: "/certs/server.key",
        caFile: "",
        caPath: "",
        cipherList: "",
        protocols: 24,
        verifyPeer: 0,
        verifyDepth: 9,
        type: 0,
        enabled: true,
      },
      {
        name: "ClientSSL",
        description: "Client SSL config",
        certFile: "",
        keyFile: "",
        caFile: "/certs/ca.crt",
        caPath: "",
        cipherList: "",
        protocols: 24,
        verifyPeer: 1,
        verifyDepth: 9,
        type: 0,
        enabled: true,
      },
    ];
    mockHttp.get.mockResolvedValue(envelope(configData));

    const result = await sslListTool.handler({}, ctx);

    expect(mockHttp.get).toHaveBeenCalledWith(
      "/api/executemcp/v2/security/ssl",
    );

    const structured = result.structuredContent as {
      sslConfigs: typeof configData;
      count: number;
    };
    expect(structured.sslConfigs).toHaveLength(2);
    expect(structured.count).toBe(2);
    expect(structured.sslConfigs[0]?.name).toBe("DefaultSSL");
    expect(structured.sslConfigs[1]?.name).toBe("ClientSSL");
    expect(result.isError).toBeUndefined();
  });

  it("should handle empty SSL configuration list", async () => {
    mockHttp.get.mockResolvedValue(envelope([]));

    const result = await sslListTool.handler({}, ctx);

    const structured = result.structuredContent as {
      sslConfigs: unknown[];
      count: number;
    };
    expect(structured.sslConfigs).toEqual([]);
    expect(structured.count).toBe(0);
  });

  it("should return isError on IrisApiError", async () => {
    mockHttp.get.mockRejectedValue(
      new IrisApiError(
        500,
        [{ error: "Server error" }],
        "/api/executemcp/v2/security/ssl",
        "Server error",
      ),
    );

    const result = await sslListTool.handler({}, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain(
      "Error listing SSL/TLS configurations",
    );
  });

  it("should propagate non-IrisApiError exceptions", async () => {
    mockHttp.get.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(sslListTool.handler({}, ctx)).rejects.toThrow("ECONNREFUSED");
  });

  it("should have correct annotations (readOnlyHint: true)", () => {
    expect(sslListTool.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it("should have scope SYS", () => {
    expect(sslListTool.scope).toBe("SYS");
  });

  it("should accept cursor parameter in schema", () => {
    const shape = sslListTool.inputSchema.shape as Record<string, unknown>;
    expect(shape).toHaveProperty("cursor");
  });
});
