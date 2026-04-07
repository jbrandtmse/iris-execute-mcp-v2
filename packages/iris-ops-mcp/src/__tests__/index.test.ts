import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { McpServerBase } from "@iris-mcp/shared";
import type { McpServerBaseOptions } from "@iris-mcp/shared";
import { tools } from "../tools/index.js";
import { resolveTransport } from "@iris-mcp/shared";

// ── Tests ───────────────────────────────────────────────────────────

describe("iris-ops-mcp", () => {
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

    it("should export metrics tools", () => {
      expect(tools.length).toBeGreaterThanOrEqual(3);
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
    it("should create a server instance with 3 tools", () => {
      const server = new McpServerBase({
        name: "@iris-mcp/ops",
        version: "0.0.1",
        tools,
        needsCustomRest: true,
      });
      expect(server).toBeDefined();
      expect(server.toolCount).toBe(3);
    });

    it("should accept needsCustomRest: true", () => {
      const server = new McpServerBase({
        name: "@iris-mcp/ops",
        version: "0.0.1",
        tools,
        needsCustomRest: true,
      });
      expect(server).toBeDefined();
    });

    it("should expose the underlying MCP SDK server", () => {
      const server = new McpServerBase({
        name: "@iris-mcp/ops",
        version: "0.0.1",
        tools,
        needsCustomRest: true,
      });
      expect(server.server).toBeDefined();
    });

    it("should return tool names array with 3 entries", () => {
      const server = new McpServerBase({
        name: "@iris-mcp/ops",
        version: "0.0.1",
        tools,
        needsCustomRest: true,
      });
      const names = server.getToolNames();
      expect(names).toHaveLength(3);
      expect(names).toContain("iris.metrics.system");
      expect(names).toContain("iris.metrics.alerts");
      expect(names).toContain("iris.metrics.interop");
    });

    it("should return undefined for nonexistent tool lookup", () => {
      const server = new McpServerBase({
        name: "@iris-mcp/ops",
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
