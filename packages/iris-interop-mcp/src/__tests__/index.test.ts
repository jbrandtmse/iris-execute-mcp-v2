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
      expect(tools).toHaveLength(19);
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
    it("should create a server instance with 19 tools", () => {
      const server = new McpServerBase({
        name: "@iris-mcp/interop",
        version: "0.0.1",
        tools,
        needsCustomRest: true,
      });
      expect(server).toBeDefined();
      expect(server.toolCount).toBe(19);
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

    it("should return tool names for all 19 interop tools", () => {
      const server = new McpServerBase({
        name: "@iris-mcp/interop",
        version: "0.0.1",
        tools,
        needsCustomRest: true,
      });
      const names = server.getToolNames();
      expect(names).toHaveLength(19);
      expect(names).toContain("iris_production_manage");
      expect(names).toContain("iris_production_control");
      expect(names).toContain("iris_production_status");
      expect(names).toContain("iris_production_summary");
      expect(names).toContain("iris_production_item");
      expect(names).toContain("iris_production_autostart");
      expect(names).toContain("iris_production_logs");
      expect(names).toContain("iris_production_queues");
      expect(names).toContain("iris_production_messages");
      expect(names).toContain("iris_production_adapters");
      expect(names).toContain("iris_credential_manage");
      expect(names).toContain("iris_credential_list");
      expect(names).toContain("iris_lookup_manage");
      expect(names).toContain("iris_lookup_transfer");
      expect(names).toContain("iris_rule_list");
      expect(names).toContain("iris_rule_get");
      expect(names).toContain("iris_transform_list");
      expect(names).toContain("iris_transform_test");
      expect(names).toContain("iris_interop_rest");
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
      expect(server.getTool("iris_production_manage")).toBeDefined();
      expect(server.getTool("iris_production_control")).toBeDefined();
      expect(server.getTool("iris_production_status")).toBeDefined();
      expect(server.getTool("iris_production_summary")).toBeDefined();
      expect(server.getTool("iris_production_item")).toBeDefined();
      expect(server.getTool("iris_production_autostart")).toBeDefined();
      expect(server.getTool("iris_production_logs")).toBeDefined();
      expect(server.getTool("iris_production_queues")).toBeDefined();
      expect(server.getTool("iris_production_messages")).toBeDefined();
      expect(server.getTool("iris_production_adapters")).toBeDefined();
      expect(server.getTool("iris_credential_manage")).toBeDefined();
      expect(server.getTool("iris_credential_list")).toBeDefined();
      expect(server.getTool("iris_lookup_manage")).toBeDefined();
      expect(server.getTool("iris_lookup_transfer")).toBeDefined();
      expect(server.getTool("iris_rule_list")).toBeDefined();
      expect(server.getTool("iris_rule_get")).toBeDefined();
      expect(server.getTool("iris_transform_list")).toBeDefined();
      expect(server.getTool("iris_transform_test")).toBeDefined();
      expect(server.getTool("iris_interop_rest")).toBeDefined();
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
