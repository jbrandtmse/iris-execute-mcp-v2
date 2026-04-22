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

    it("should export metrics, jobs, system, task, and config tools", () => {
      expect(tools.length).toBeGreaterThanOrEqual(16);
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
    it("should create a server instance with 17 tools", () => {
      const server = new McpServerBase({
        name: "@iris-mcp/ops",
        version: "0.0.1",
        tools,
        needsCustomRest: true,
      });
      expect(server).toBeDefined();
      expect(server.toolCount).toBe(17);
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

    it("should return tool names array with 17 entries", () => {
      const server = new McpServerBase({
        name: "@iris-mcp/ops",
        version: "0.0.1",
        tools,
        needsCustomRest: true,
      });
      const names = server.getToolNames();
      expect(names).toHaveLength(17);
      expect(names).toContain("iris_metrics_system");
      expect(names).toContain("iris_metrics_alerts");
      expect(names).toContain("iris_metrics_interop");
      expect(names).toContain("iris_alerts_manage");
      expect(names).toContain("iris_jobs_list");
      expect(names).toContain("iris_locks_list");
      expect(names).toContain("iris_journal_info");
      expect(names).toContain("iris_mirror_status");
      expect(names).toContain("iris_audit_events");
      expect(names).toContain("iris_database_check");
      expect(names).toContain("iris_license_info");
      expect(names).toContain("iris_ecp_status");
      expect(names).toContain("iris_task_manage");
      expect(names).toContain("iris_task_list");
      expect(names).toContain("iris_task_run");
      expect(names).toContain("iris_task_history");
      expect(names).toContain("iris_config_manage");
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
