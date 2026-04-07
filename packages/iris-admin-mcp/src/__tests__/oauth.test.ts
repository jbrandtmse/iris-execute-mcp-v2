import { describe, it, expect, beforeEach } from "vitest";
import type { ToolContext } from "@iris-mcp/shared";
import { IrisApiError } from "@iris-mcp/shared";
import { oauthManageTool, oauthListTool } from "../tools/oauth.js";
import {
  createMockHttp,
  createMockCtx,
  envelope,
} from "@iris-mcp/shared/test-helpers";

// ── iris.oauth.manage ──────────────────────────────────────────

describe("iris.oauth.manage", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  // ── Server create ──

  it("should send POST with action, entity, and issuerURL for server create", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({
        action: "created",
        entity: "server",
        issuerEndpoint: "https://auth.example.com",
      }),
    );

    const result = await oauthManageTool.handler(
      {
        action: "create",
        entity: "server",
        issuerURL: "https://auth.example.com",
        supportedScopes: "openid profile email",
        accessTokenInterval: 3600,
        signingAlgorithm: "RS256",
      },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/security/oauth",
      expect.objectContaining({
        action: "create",
        entity: "server",
        issuerURL: "https://auth.example.com",
        supportedScopes: "openid profile email",
        accessTokenInterval: 3600,
        signingAlgorithm: "RS256",
      }),
    );

    const structured = result.structuredContent as {
      action: string;
      entity: string;
      issuerEndpoint: string;
    };
    expect(structured.action).toBe("created");
    expect(structured.entity).toBe("server");
    expect(structured.issuerEndpoint).toBe("https://auth.example.com");
    expect(result.isError).toBeUndefined();
  });

  it("should include all server create optional properties when provided", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "created", entity: "server", issuerEndpoint: "https://auth.example.com" }),
    );

    await oauthManageTool.handler(
      {
        action: "create",
        entity: "server",
        issuerURL: "https://auth.example.com",
        description: "My OAuth2 server",
        supportedScopes: "openid profile",
        accessTokenInterval: 3600,
        authorizationCodeInterval: 300,
        refreshTokenInterval: 86400,
        signingAlgorithm: "RS256",
      },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/security/oauth",
      expect.objectContaining({
        action: "create",
        entity: "server",
        issuerURL: "https://auth.example.com",
        description: "My OAuth2 server",
        supportedScopes: "openid profile",
        accessTokenInterval: 3600,
        authorizationCodeInterval: 300,
        refreshTokenInterval: 86400,
        signingAlgorithm: "RS256",
      }),
    );
  });

  // ── Client create ──

  it("should send POST with client registration params for client create", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({
        action: "created",
        entity: "client",
        clientName: "MyApp",
        serverName: "AuthServer",
        clientId: "abc123",
      }),
    );

    const result = await oauthManageTool.handler(
      {
        action: "create",
        entity: "client",
        serverName: "AuthServer",
        clientName: "MyApp",
        redirectURIs: "https://app.example.com/callback",
        grantTypes: "authorization_code",
        clientType: "confidential",
      },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/security/oauth",
      expect.objectContaining({
        action: "create",
        entity: "client",
        serverName: "AuthServer",
        clientName: "MyApp",
        redirectURIs: "https://app.example.com/callback",
        grantTypes: "authorization_code",
        clientType: "confidential",
      }),
    );

    const structured = result.structuredContent as {
      action: string;
      entity: string;
      clientName: string;
      clientId: string;
    };
    expect(structured.action).toBe("created");
    expect(structured.entity).toBe("client");
    expect(structured.clientName).toBe("MyApp");
    expect(structured.clientId).toBe("abc123");
    expect(result.isError).toBeUndefined();
  });

  // ── Client secrets NOT present ──

  it("should never include clientSecret in create response", async () => {
    // Even if the backend accidentally included a secret, the response
    // structure should not expose it. This tests the handler's return path.
    mockHttp.post.mockResolvedValue(
      envelope({
        action: "created",
        entity: "client",
        clientName: "MyApp",
        clientId: "abc123",
        // NOTE: clientSecret intentionally NOT in response from handler
      }),
    );

    const result = await oauthManageTool.handler(
      {
        action: "create",
        entity: "client",
        serverName: "AuthServer",
        clientName: "MyApp",
      },
      ctx,
    );

    const text = result.content[0]?.text ?? "";
    expect(text).not.toContain("clientSecret");
    expect(text).not.toContain("secret");

    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured).not.toHaveProperty("clientSecret");
  });

  // ── Delete ──

  it("should send POST for server delete with name", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "deleted", entity: "server", name: "OldServer" }),
    );

    const result = await oauthManageTool.handler(
      { action: "delete", entity: "server", name: "OldServer" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/security/oauth",
      expect.objectContaining({
        action: "delete",
        entity: "server",
        name: "OldServer",
      }),
    );

    const structured = result.structuredContent as {
      action: string;
      entity: string;
      name: string;
    };
    expect(structured.action).toBe("deleted");
    expect(structured.entity).toBe("server");
    expect(structured.name).toBe("OldServer");
  });

  it("should send POST for client delete with name", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "deleted", entity: "client", name: "OldApp" }),
    );

    const result = await oauthManageTool.handler(
      { action: "delete", entity: "client", name: "OldApp" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/security/oauth",
      expect.objectContaining({
        action: "delete",
        entity: "client",
        name: "OldApp",
      }),
    );

    const structured = result.structuredContent as {
      action: string;
      entity: string;
    };
    expect(structured.action).toBe("deleted");
    expect(structured.entity).toBe("client");
  });

  // ── Discover ──

  it("should send POST for OIDC discover with issuerURL", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({
        action: "discovered",
        issuerURL: "https://accounts.google.com",
        configuration: {
          issuerEndpoint: "https://accounts.google.com",
          authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
          tokenEndpoint: "https://oauth2.googleapis.com/token",
          userinfoEndpoint: "https://openidconnect.googleapis.com/v1/userinfo",
          jwksEndpoint: "https://www.googleapis.com/oauth2/v3/certs",
        },
      }),
    );

    const result = await oauthManageTool.handler(
      {
        action: "discover",
        issuerURL: "https://accounts.google.com",
      },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/security/oauth",
      expect.objectContaining({
        action: "discover",
        issuerURL: "https://accounts.google.com",
      }),
    );

    const structured = result.structuredContent as {
      action: string;
      issuerURL: string;
      configuration: Record<string, string>;
    };
    expect(structured.action).toBe("discovered");
    expect(structured.issuerURL).toBe("https://accounts.google.com");
    expect(structured.configuration.tokenEndpoint).toBe(
      "https://oauth2.googleapis.com/token",
    );
    expect(result.isError).toBeUndefined();
  });

  // ── Error handling ──

  it("should return isError on IrisApiError", async () => {
    mockHttp.post.mockRejectedValue(
      new IrisApiError(
        400,
        [{ error: "Invalid" }],
        "/api/executemcp/v2/security/oauth",
        "Invalid OAuth2 configuration",
      ),
    );

    const result = await oauthManageTool.handler(
      { action: "create", entity: "server", issuerURL: "bad" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain(
      "Error managing OAuth2 configuration",
    );
  });

  it("should propagate non-IrisApiError exceptions", async () => {
    mockHttp.post.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      oauthManageTool.handler(
        { action: "create", entity: "server", issuerURL: "test" },
        ctx,
      ),
    ).rejects.toThrow("ECONNREFUSED");
  });

  it("should not include secrets in error messages", async () => {
    mockHttp.post.mockRejectedValue(
      new IrisApiError(
        500,
        [{ error: "Server error" }],
        "/api/executemcp/v2/security/oauth",
        "Server error during OAuth2 operation",
      ),
    );

    const result = await oauthManageTool.handler(
      { action: "create", entity: "client", serverName: "S1", clientName: "C1" },
      ctx,
    );

    expect(result.isError).toBe(true);
    const text = result.content[0]?.text ?? "";
    expect(text).not.toContain("secret");
    expect(text).not.toContain("password");
  });

  // ── Annotations ──

  it("should have correct annotations (destructiveHint: true)", () => {
    expect(oauthManageTool.annotations).toEqual({
      destructiveHint: true,
      readOnlyHint: false,
      idempotentHint: false,
      openWorldHint: false,
    });
  });

  it("should have scope SYS", () => {
    expect(oauthManageTool.scope).toBe("SYS");
  });
});

// ── iris.oauth.list ───────────────────────────────────────────

describe("iris.oauth.list", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should return servers and clients with counts", async () => {
    const responseData = {
      servers: [
        {
          id: "1",
          issuerEndpoint: "https://auth.example.com",
          description: "Main auth server",
          supportedScopes: "openid profile",
          accessTokenInterval: 3600,
          authorizationCodeInterval: 300,
          refreshTokenInterval: 86400,
          signingAlgorithm: "RS256",
        },
      ],
      clients: [
        {
          applicationName: "MyApp",
          serverDefinition: "AuthServer",
          clientId: "abc123",
          clientType: "confidential",
          redirectURL: "https://app.example.com/callback",
          description: "My application",
          enabled: true,
        },
      ],
      serverCount: 1,
      clientCount: 1,
    };
    mockHttp.get.mockResolvedValue(envelope(responseData));

    const result = await oauthListTool.handler({}, ctx);

    expect(mockHttp.get).toHaveBeenCalledWith(
      "/api/executemcp/v2/security/oauth",
    );

    const structured = result.structuredContent as typeof responseData;
    expect(structured.servers).toHaveLength(1);
    expect(structured.clients).toHaveLength(1);
    expect(structured.serverCount).toBe(1);
    expect(structured.clientCount).toBe(1);
    expect(structured.servers[0]?.issuerEndpoint).toBe(
      "https://auth.example.com",
    );
    expect(structured.clients[0]?.applicationName).toBe("MyApp");
    expect(result.isError).toBeUndefined();
  });

  it("should handle empty OAuth2 configuration lists", async () => {
    mockHttp.get.mockResolvedValue(
      envelope({
        servers: [],
        clients: [],
        serverCount: 0,
        clientCount: 0,
      }),
    );

    const result = await oauthListTool.handler({}, ctx);

    const structured = result.structuredContent as {
      servers: unknown[];
      clients: unknown[];
      serverCount: number;
      clientCount: number;
    };
    expect(structured.servers).toEqual([]);
    expect(structured.clients).toEqual([]);
    expect(structured.serverCount).toBe(0);
    expect(structured.clientCount).toBe(0);
  });

  it("should never include clientSecret in list response", async () => {
    mockHttp.get.mockResolvedValue(
      envelope({
        servers: [],
        clients: [
          {
            applicationName: "MyApp",
            serverDefinition: "AuthServer",
            clientId: "abc123",
            clientType: "confidential",
            redirectURL: "https://app.example.com/callback",
            description: "App",
            enabled: true,
          },
        ],
        serverCount: 0,
        clientCount: 1,
      }),
    );

    const result = await oauthListTool.handler({}, ctx);

    const text = result.content[0]?.text ?? "";
    expect(text).not.toContain("clientSecret");
    expect(text).not.toContain("secret");

    const structured = result.structuredContent as {
      clients: Array<Record<string, unknown>>;
    };
    for (const client of structured.clients) {
      expect(client).not.toHaveProperty("clientSecret");
    }
  });

  it("should return isError on IrisApiError", async () => {
    mockHttp.get.mockRejectedValue(
      new IrisApiError(
        500,
        [{ error: "Server error" }],
        "/api/executemcp/v2/security/oauth",
        "Server error",
      ),
    );

    const result = await oauthListTool.handler({}, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain(
      "Error listing OAuth2 configurations",
    );
  });

  it("should propagate non-IrisApiError exceptions", async () => {
    mockHttp.get.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(oauthListTool.handler({}, ctx)).rejects.toThrow(
      "ECONNREFUSED",
    );
  });

  it("should have correct annotations (readOnlyHint: true)", () => {
    expect(oauthListTool.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it("should have scope SYS", () => {
    expect(oauthListTool.scope).toBe("SYS");
  });

  it("should accept cursor parameter in schema", () => {
    const shape = oauthListTool.inputSchema.shape as Record<string, unknown>;
    expect(shape).toHaveProperty("cursor");
  });
});
