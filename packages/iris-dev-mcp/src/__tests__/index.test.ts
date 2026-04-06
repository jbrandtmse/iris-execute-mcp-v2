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

    it("should export the document CRUD, compilation, intelligence, format, SQL, server, and global tools", () => {
      expect(tools).toHaveLength(17);
      const names = tools.map((t) => t.name);
      expect(names).toContain("iris.doc.get");
      expect(names).toContain("iris.doc.put");
      expect(names).toContain("iris.doc.delete");
      expect(names).toContain("iris.doc.list");
      expect(names).toContain("iris.doc.compile");
      expect(names).toContain("iris.doc.index");
      expect(names).toContain("iris.doc.search");
      expect(names).toContain("iris.macro.info");
      expect(names).toContain("iris.doc.convert");
      expect(names).toContain("iris.doc.xml_export");
      expect(names).toContain("iris.sql.execute");
      expect(names).toContain("iris.server.info");
      expect(names).toContain("iris.server.namespace");
      expect(names).toContain("iris.global.get");
      expect(names).toContain("iris.global.set");
      expect(names).toContain("iris.global.kill");
      expect(names).toContain("iris.global.list");
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
    it("should create a server instance with 17 tools", () => {
      const server = new McpServerBase({
        name: "@iris-mcp/dev",
        version: "0.0.0",
        tools,
      });
      expect(server).toBeDefined();
      expect(server.toolCount).toBe(17);
    });

    it("should report all tool names", () => {
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
        "iris.doc.compile",
        "iris.doc.index",
        "iris.doc.search",
        "iris.macro.info",
        "iris.doc.convert",
        "iris.doc.xml_export",
        "iris.sql.execute",
        "iris.server.info",
        "iris.server.namespace",
        "iris.global.get",
        "iris.global.set",
        "iris.global.kill",
        "iris.global.list",
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
