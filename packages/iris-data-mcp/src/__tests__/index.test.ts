import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { McpServerBase } from "@iris-mcp/shared";
import type { McpServerBaseOptions } from "@iris-mcp/shared";
import { tools } from "../tools/index.js";
import { resolveTransport } from "@iris-mcp/shared";

// ── Tests ───────────────────────────────────────────────────────────

describe("iris-data-mcp", () => {
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

    it("should export 7 tools (4 DocDB + 2 analytics + 1 REST)", () => {
      expect(tools.length).toBe(7);
    });

    it("should export the expected tool names", () => {
      const names = tools.map((t) => t.name);
      expect(names).toContain("iris_docdb_manage");
      expect(names).toContain("iris_docdb_document");
      expect(names).toContain("iris_docdb_find");
      expect(names).toContain("iris_docdb_property");
      expect(names).toContain("iris_analytics_mdx");
      expect(names).toContain("iris_analytics_cubes");
      expect(names).toContain("iris_rest_manage");
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
    it("should create a server instance with 7 package tools (+1 framework tool)", () => {
      const server = new McpServerBase({
        name: "@iris-mcp/data",
        version: "0.0.1",
        tools,
        needsCustomRest: true,
      });
      expect(server).toBeDefined();
      // 7 package tools + the framework `iris_server_profiles` discovery tool
      // (Epic 19, decision E1 — registered on every server by the shared base).
      expect(server.toolCount).toBe(8);
    });

    it("should accept needsCustomRest: true", () => {
      const server = new McpServerBase({
        name: "@iris-mcp/data",
        version: "0.0.1",
        tools,
        needsCustomRest: true,
      });
      expect(server).toBeDefined();
    });

    it("should expose the underlying MCP SDK server", () => {
      const server = new McpServerBase({
        name: "@iris-mcp/data",
        version: "0.0.1",
        tools,
        needsCustomRest: true,
      });
      expect(server.server).toBeDefined();
    });

    it("should return 7 package tool names (+1 framework tool)", () => {
      const server = new McpServerBase({
        name: "@iris-mcp/data",
        version: "0.0.1",
        tools,
        needsCustomRest: true,
      });
      const names = server.getToolNames();
      // 7 package tools + the framework discovery tool (Epic 19, decision E1).
      expect(names).toHaveLength(8);
      expect(names).toContain("iris_docdb_manage");
      expect(names).toContain("iris_docdb_document");
      expect(names).toContain("iris_docdb_find");
      expect(names).toContain("iris_docdb_property");
      expect(names).toContain("iris_analytics_mdx");
      expect(names).toContain("iris_analytics_cubes");
      expect(names).toContain("iris_rest_manage");
      expect(names).toContain("iris_server_profiles");
    });

    it("should return undefined for nonexistent tool lookup", () => {
      const server = new McpServerBase({
        name: "@iris-mcp/data",
        version: "0.0.1",
        tools,
        needsCustomRest: true,
      });
      expect(server.getTool("nonexistent")).toBeUndefined();
    });
  });

  describe("resolveTransport()", () => {
    const originalArgv = process.argv;
    const originalEnv = process.env["MCP_TRANSPORT"];
    const ENV_HTTP_MESSAGE =
      'Unsupported transport "http" from MCP_TRANSPORT: stdio is the only supported transport. Unset MCP_TRANSPORT or set it to "stdio".';
    const FLAG_HTTP_MESSAGE =
      'Unsupported transport "http" from --transport: stdio is the only supported transport. Remove --transport or pass --transport stdio.';

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

    it("should return stdio from MCP_TRANSPORT env var", () => {
      process.argv = ["node", "index.js"];
      process.env["MCP_TRANSPORT"] = "stdio";
      expect(resolveTransport()).toBe("stdio");
    });

    it("should reject --transport=http CLI arg as a configuration error", () => {
      process.argv = ["node", "index.js", "--transport=http"];
      delete process.env["MCP_TRANSPORT"];
      expect(() => resolveTransport()).toThrow(FLAG_HTTP_MESSAGE);
    });

    it("should reject --transport http CLI arg as a configuration error", () => {
      process.argv = ["node", "index.js", "--transport", "http"];
      delete process.env["MCP_TRANSPORT"];
      expect(() => resolveTransport()).toThrow(FLAG_HTTP_MESSAGE);
    });

    it("should reject MCP_TRANSPORT=http as a configuration error", () => {
      process.argv = ["node", "index.js"];
      process.env["MCP_TRANSPORT"] = "http";
      expect(() => resolveTransport()).toThrow(ENV_HTTP_MESSAGE);
    });

    it("should reject an unrecognised MCP_TRANSPORT instead of falling back to stdio", () => {
      process.argv = ["node", "index.js"];
      process.env["MCP_TRANSPORT"] = "invalid";
      expect(() => resolveTransport()).toThrow(
        'Unsupported transport "invalid" from MCP_TRANSPORT: stdio is the only supported transport. Unset MCP_TRANSPORT or set it to "stdio".',
      );
    });

    it("should check the CLI arg even when MCP_TRANSPORT is stdio", () => {
      process.argv = ["node", "index.js", "--transport=http"];
      process.env["MCP_TRANSPORT"] = "stdio";
      expect(() => resolveTransport()).toThrow(FLAG_HTTP_MESSAGE);
    });
  });
});
