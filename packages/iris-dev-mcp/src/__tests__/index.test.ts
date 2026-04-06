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

    it("should export an empty array", () => {
      expect(tools).toHaveLength(0);
    });

    it("should be a ToolDefinition[] (empty array is assignable)", () => {
      // Type-level check: ensure it's accepted by McpServerBaseOptions
      const opts: McpServerBaseOptions = {
        name: "test",
        version: "0.0.0",
        tools,
      };
      expect(opts.tools).toBe(tools);
    });
  });

  describe("McpServerBase instantiation with empty tools", () => {
    it("should create a server instance with no tools", () => {
      const server = new McpServerBase({
        name: "@iris-mcp/dev",
        version: "0.0.0",
        tools,
      });
      expect(server).toBeDefined();
      expect(server.toolCount).toBe(0);
    });

    it("should report empty tool names list", () => {
      const server = new McpServerBase({
        name: "@iris-mcp/dev",
        version: "0.0.0",
        tools,
      });
      expect(server.getToolNames()).toEqual([]);
    });

    it("should expose the underlying MCP SDK server", () => {
      const server = new McpServerBase({
        name: "@iris-mcp/dev",
        version: "0.0.0",
        tools,
      });
      expect(server.server).toBeDefined();
    });

    it("should return undefined for any tool lookup", () => {
      const server = new McpServerBase({
        name: "@iris-mcp/dev",
        version: "0.0.0",
        tools,
      });
      expect(server.getTool("nonexistent")).toBeUndefined();
    });
  });
});
