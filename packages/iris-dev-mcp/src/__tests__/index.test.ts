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

    it("should export the document CRUD, compilation, intelligence, format, SQL, server, global, and execute tools", () => {
      expect(tools).toHaveLength(21);
      const names = tools.map((t) => t.name);
      expect(names).toContain("iris_doc_get");
      expect(names).toContain("iris_doc_put");
      expect(names).toContain("iris_doc_delete");
      expect(names).toContain("iris_doc_list");
      expect(names).toContain("iris_doc_compile");
      expect(names).toContain("iris_doc_index");
      expect(names).toContain("iris_doc_search");
      expect(names).toContain("iris_macro_info");
      expect(names).toContain("iris_doc_convert");
      expect(names).toContain("iris_doc_xml_export");
      expect(names).toContain("iris_sql_execute");
      expect(names).toContain("iris_server_info");
      expect(names).toContain("iris_server_namespace");
      expect(names).toContain("iris_global_get");
      expect(names).toContain("iris_global_set");
      expect(names).toContain("iris_global_kill");
      expect(names).toContain("iris_global_list");
      expect(names).toContain("iris_execute_command");
      expect(names).toContain("iris_execute_classmethod");
      expect(names).toContain("iris_doc_load");
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
    it("should create a server instance with 21 tools", () => {
      const server = new McpServerBase({
        name: "@iris-mcp/dev",
        version: "0.0.0",
        tools,
      });
      expect(server).toBeDefined();
      expect(server.toolCount).toBe(21);
    });

    it("should report all tool names", () => {
      const server = new McpServerBase({
        name: "@iris-mcp/dev",
        version: "0.0.0",
        tools,
      });
      expect(server.getToolNames()).toEqual([
        "iris_doc_get",
        "iris_doc_put",
        "iris_doc_delete",
        "iris_doc_list",
        "iris_doc_compile",
        "iris_doc_index",
        "iris_doc_search",
        "iris_macro_info",
        "iris_doc_convert",
        "iris_doc_xml_export",
        "iris_sql_execute",
        "iris_server_info",
        "iris_server_namespace",
        "iris_global_get",
        "iris_global_set",
        "iris_global_kill",
        "iris_global_list",
        "iris_execute_command",
        "iris_execute_classmethod",
        "iris_execute_tests",
        "iris_doc_load",
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

    it("should return a tool definition for iris_doc_get", () => {
      const server = new McpServerBase({
        name: "@iris-mcp/dev",
        version: "0.0.0",
        tools,
      });
      const tool = server.getTool("iris_doc_get");
      expect(tool).toBeDefined();
      expect(tool?.name).toBe("iris_doc_get");
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
