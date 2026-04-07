import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { McpServerBase } from "@iris-mcp/shared";
import type { McpServerBaseOptions } from "@iris-mcp/shared";
import { tools } from "../tools/index.js";
import { resolveTransport } from "@iris-mcp/shared";

// ── Tests ───────────────────────────────────────────────────────────

describe("iris-interop-mcp", () => {
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

    it("should export production tool definitions", () => {
      expect(tools).toHaveLength(6);
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
    it("should create a server instance with 6 tools", () => {
      const server = new McpServerBase({
        name: "@iris-mcp/interop",
        version: "0.0.1",
        tools,
        needsCustomRest: true,
      });
      expect(server).toBeDefined();
      expect(server.toolCount).toBe(6);
    });

    it("should accept needsCustomRest: true", () => {
      const server = new McpServerBase({
        name: "@iris-mcp/interop",
        version: "0.0.1",
        tools,
        needsCustomRest: true,
      });
      expect(server).toBeDefined();
    });

    it("should expose the underlying MCP SDK server", () => {
      const server = new McpServerBase({
        name: "@iris-mcp/interop",
        version: "0.0.1",
        tools,
        needsCustomRest: true,
      });
      expect(server.server).toBeDefined();
    });

    it("should return tool names for all 6 production tools", () => {
      const server = new McpServerBase({
        name: "@iris-mcp/interop",
        version: "0.0.1",
        tools,
        needsCustomRest: true,
      });
      const names = server.getToolNames();
      expect(names).toHaveLength(6);
      expect(names).toContain("iris.production.manage");
      expect(names).toContain("iris.production.control");
      expect(names).toContain("iris.production.status");
      expect(names).toContain("iris.production.summary");
      expect(names).toContain("iris.production.item");
      expect(names).toContain("iris.production.autostart");
    });

    it("should return undefined for nonexistent tool lookup", () => {
      const server = new McpServerBase({
        name: "@iris-mcp/interop",
        version: "0.0.1",
        tools,
        needsCustomRest: true,
      });
      expect(server.getTool("nonexistent")).toBeUndefined();
    });

    it("should find production tools by name", () => {
      const server = new McpServerBase({
        name: "@iris-mcp/interop",
        version: "0.0.1",
        tools,
        needsCustomRest: true,
      });
      expect(server.getTool("iris.production.manage")).toBeDefined();
      expect(server.getTool("iris.production.control")).toBeDefined();
      expect(server.getTool("iris.production.status")).toBeDefined();
      expect(server.getTool("iris.production.summary")).toBeDefined();
      expect(server.getTool("iris.production.item")).toBeDefined();
      expect(server.getTool("iris.production.autostart")).toBeDefined();
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

    it("should return http from MCP_TRANSPORT env var", () => {
      process.argv = ["node", "index.js"];
      process.env["MCP_TRANSPORT"] = "http";
      expect(resolveTransport()).toBe("http");
    });

    it("should prefer CLI arg over env var", () => {
      process.argv = ["node", "index.js", "--transport=http"];
      process.env["MCP_TRANSPORT"] = "stdio";
      expect(resolveTransport()).toBe("http");
    });
  });
});
