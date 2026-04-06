import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { McpServerBase } from "@iris-mcp/shared";
import type { McpServerBaseOptions } from "@iris-mcp/shared";
import { tools } from "../tools/index.js";

// ── Tests ───────────────────────────────────────────────────────────

describe("iris-dev-mcp", () => {
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

    it("should export the document CRUD tools", () => {
      expect(tools).toHaveLength(4);
      const names = tools.map((t) => t.name);
      expect(names).toContain("iris.doc.get");
      expect(names).toContain("iris.doc.put");
      expect(names).toContain("iris.doc.delete");
      expect(names).toContain("iris.doc.list");
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

  describe("McpServerBase instantiation with doc tools", () => {
    it("should create a server instance with 4 doc tools", () => {
      const server = new McpServerBase({
        name: "@iris-mcp/dev",
        version: "0.0.0",
        tools,
      });
      expect(server).toBeDefined();
      expect(server.toolCount).toBe(4);
    });

    it("should report all doc tool names", () => {
      const server = new McpServerBase({
        name: "@iris-mcp/dev",
        version: "0.0.0",
        tools,
      });
      expect(server.getToolNames()).toEqual([
        "iris.doc.get",
        "iris.doc.put",
        "iris.doc.delete",
        "iris.doc.list",
      ]);
    });

    it("should expose the underlying MCP SDK server", () => {
      const server = new McpServerBase({
        name: "@iris-mcp/dev",
        version: "0.0.0",
        tools,
      });
      expect(server.server).toBeDefined();
    });

    it("should return a tool definition for iris.doc.get", () => {
      const server = new McpServerBase({
        name: "@iris-mcp/dev",
        version: "0.0.0",
        tools,
      });
      const tool = server.getTool("iris.doc.get");
      expect(tool).toBeDefined();
      expect(tool?.name).toBe("iris.doc.get");
    });

    it("should return undefined for unknown tool lookup", () => {
      const server = new McpServerBase({
        name: "@iris-mcp/dev",
        version: "0.0.0",
        tools,
      });
      expect(server.getTool("nonexistent")).toBeUndefined();
    });
  });
});
