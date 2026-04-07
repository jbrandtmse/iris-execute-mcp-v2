import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { McpServerBase } from "@iris-mcp/shared";
import type { McpServerBaseOptions } from "@iris-mcp/shared";
import { tools } from "../tools/index.js";
import { resolveTransport } from "@iris-mcp/shared";

// ── Tests ───────────────────────────────────────────────────────────

describe("iris-admin-mcp", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("tools/index.ts", () => {
    it("should export an array", () => {
      expect(Array.isArray(tools)).toBe(true);
    });

    it("should export 22 tool definitions", () => {
      expect(tools).toHaveLength(22);
    });

    it("should be a ToolDefinition[] accepted by McpServerBaseOptions", () => {
      const opts: McpServerBaseOptions = {
        name: "test",
        version: "0.0.0",
        tools,
      };
      expect(opts.tools).toBe(tools);
    });
  });

  describe("McpServerBase instantiation", () => {
    it("should create a server instance with 22 tools", () => {
      const server = new McpServerBase({
        name: "@iris-mcp/admin",
        version: "0.0.0",
        tools,
        needsCustomRest: true,
      });
      expect(server).toBeDefined();
      expect(server.toolCount).toBe(22);
    });

    it("should report correct tool names", () => {
      const server = new McpServerBase({
        name: "@iris-mcp/admin",
        version: "0.0.0",
        tools,
        needsCustomRest: true,
      });
      const names = server.getToolNames();
      expect(names).toContain("iris.namespace.manage");
      expect(names).toContain("iris.namespace.list");
      expect(names).toContain("iris.database.manage");
      expect(names).toContain("iris.database.list");
      expect(names).toContain("iris.mapping.manage");
      expect(names).toContain("iris.mapping.list");
      expect(names).toContain("iris.user.manage");
      expect(names).toContain("iris.user.get");
      expect(names).toContain("iris.user.roles");
      expect(names).toContain("iris.user.password");
      expect(names).toContain("iris.role.manage");
      expect(names).toContain("iris.role.list");
      expect(names).toContain("iris.resource.manage");
      expect(names).toContain("iris.resource.list");
      expect(names).toContain("iris.permission.check");
      expect(names).toContain("iris.webapp.manage");
      expect(names).toContain("iris.webapp.get");
      expect(names).toContain("iris.webapp.list");
      expect(names).toContain("iris.ssl.manage");
      expect(names).toContain("iris.ssl.list");
      expect(names).toContain("iris.oauth.manage");
      expect(names).toContain("iris.oauth.list");
    });

    it("should expose the underlying MCP SDK server", () => {
      const server = new McpServerBase({
        name: "@iris-mcp/admin",
        version: "0.0.0",
        tools,
        needsCustomRest: true,
      });
      expect(server.server).toBeDefined();
    });

    it("should return undefined for unknown tool lookup", () => {
      const server = new McpServerBase({
        name: "@iris-mcp/admin",
        version: "0.0.0",
        tools,
        needsCustomRest: true,
      });
      expect(server.getTool("nonexistent")).toBeUndefined();
    });

    it("should find registered tools by name", () => {
      const server = new McpServerBase({
        name: "@iris-mcp/admin",
        version: "0.0.0",
        tools,
        needsCustomRest: true,
      });
      expect(server.getTool("iris.namespace.manage")).toBeDefined();
      expect(server.getTool("iris.database.list")).toBeDefined();
    });
  });

  describe("resolveTransport()", () => {
    const originalArgv = process.argv;
    const originalEnv = process.env["MCP_TRANSPORT"];

    afterEach(() => {
      process.argv = originalArgv;
      if (originalEnv === undefined) {
        delete process.env["MCP_TRANSPORT"];
      } else {
        process.env["MCP_TRANSPORT"] = originalEnv;
      }
    });

    it("should default to stdio when no args or env var", () => {
      process.argv = ["node", "index.js"];
      delete process.env["MCP_TRANSPORT"];
      expect(resolveTransport()).toBe("stdio");
    });

    it("should return http from --transport=http CLI arg", () => {
      process.argv = ["node", "index.js", "--transport=http"];
      delete process.env["MCP_TRANSPORT"];
      expect(resolveTransport()).toBe("http");
    });

    it("should return http from --transport http CLI arg", () => {
      process.argv = ["node", "index.js", "--transport", "http"];
      delete process.env["MCP_TRANSPORT"];
      expect(resolveTransport()).toBe("http");
    });

    it("should return stdio from MCP_TRANSPORT env var", () => {
      process.argv = ["node", "index.js"];
      process.env["MCP_TRANSPORT"] = "stdio";
      expect(resolveTransport()).toBe("stdio");
    });

    it("should return http from MCP_TRANSPORT env var", () => {
      process.argv = ["node", "index.js"];
      process.env["MCP_TRANSPORT"] = "http";
      expect(resolveTransport()).toBe("http");
    });

    it("should fall back to stdio for unrecognised MCP_TRANSPORT", () => {
      process.argv = ["node", "index.js"];
      process.env["MCP_TRANSPORT"] = "invalid";
      expect(resolveTransport()).toBe("stdio");
    });

    it("should prefer CLI arg over env var", () => {
      process.argv = ["node", "index.js", "--transport=http"];
      process.env["MCP_TRANSPORT"] = "stdio";
      expect(resolveTransport()).toBe("http");
    });
  });
});
