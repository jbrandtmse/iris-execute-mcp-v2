import { describe, it, expect, beforeEach } from "vitest";
import type { ToolContext } from "@iris-mcp/shared";
import { IrisApiError } from "@iris-mcp/shared";
import { configManageTool } from "../tools/config.js";
import {
  createMockHttp,
  createMockCtx,
  envelope,
} from "@iris-mcp/shared/test-helpers";

// ── iris.config.manage ─────────────────────────────────────

describe("iris.config.manage", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should have scope NONE", () => {
    expect(configManageTool.scope).toBe("NONE");
  });

  it("should have destructiveHint annotation for set action safety", () => {
    expect(configManageTool.annotations.destructiveHint).toBe(true);
    expect(configManageTool.annotations.readOnlyHint).toBe(false);
  });

  // ── get action ──────────────────────────────────────────

  describe("get action", () => {
    it("should send POST with action get and default section", async () => {
      const configData = {
        section: "config",
        properties: {
          Maxprocesses: 300,
          globals: 400,
          routines: 200,
          gmheap: 37568,
          locksiz: 33554432,
        },
      };
      mockHttp.post.mockResolvedValue(envelope(configData));

      const result = await configManageTool.handler(
        { action: "get" },
        ctx,
      );

      expect(mockHttp.post).toHaveBeenCalledWith(
        "/api/executemcp/v2/system/config",
        { action: "get" },
      );
      expect(result.isError).toBeUndefined();
      expect(result.structuredContent).toEqual(configData);
    });

    it("should send POST with action get and config section", async () => {
      const configData = {
        section: "config",
        properties: {
          Maxprocesses: 300,
          globals: 400,
        },
      };
      mockHttp.post.mockResolvedValue(envelope(configData));

      const result = await configManageTool.handler(
        { action: "get", section: "config" },
        ctx,
      );

      expect(mockHttp.post).toHaveBeenCalledWith(
        "/api/executemcp/v2/system/config",
        { action: "get", section: "config" },
      );
      expect(result.isError).toBeUndefined();
    });

    it("should send POST with action get and startup section", async () => {
      const startupData = {
        section: "startup",
        properties: {
          SystemMode: "",
          DefaultPort: "1972",
        },
      };
      mockHttp.post.mockResolvedValue(envelope(startupData));

      const result = await configManageTool.handler(
        { action: "get", section: "startup" },
        ctx,
      );

      expect(mockHttp.post).toHaveBeenCalledWith(
        "/api/executemcp/v2/system/config",
        { action: "get", section: "startup" },
      );
      expect(result.isError).toBeUndefined();
      expect(result.structuredContent).toEqual(startupData);
    });

    it("should send POST with action get and locale section", async () => {
      const localeData = {
        section: "locale",
        properties: {
          Name: "enu8",
          Description: "English (United States)",
        },
      };
      mockHttp.post.mockResolvedValue(envelope(localeData));

      const result = await configManageTool.handler(
        { action: "get", section: "locale" },
        ctx,
      );

      expect(mockHttp.post).toHaveBeenCalledWith(
        "/api/executemcp/v2/system/config",
        { action: "get", section: "locale" },
      );
      expect(result.isError).toBeUndefined();
      expect(result.structuredContent).toEqual(localeData);
    });

    it("should format get response for display", async () => {
      const configData = {
        section: "config",
        properties: {
          Maxprocesses: 300,
          globals: 400,
          routines: 200,
        },
      };
      mockHttp.post.mockResolvedValue(envelope(configData));

      const result = await configManageTool.handler(
        { action: "get", section: "config" },
        ctx,
      );

      const text = result.content[0]?.text ?? "";
      expect(text).toContain("System Configuration");
      expect(text).toContain("config");
      expect(text).toContain("Maxprocesses: 300");
      expect(text).toContain("globals: 400");
      expect(text).toContain("routines: 200");
    });
  });

  // ── set action ──────────────────────────────────────────

  describe("set action", () => {
    it("should send POST with action set and properties", async () => {
      const setResult = {
        action: "modified",
        count: 2,
        message:
          "Configuration updated successfully. Some changes may require a restart to take effect.",
      };
      mockHttp.post.mockResolvedValue(envelope(setResult));

      const result = await configManageTool.handler(
        {
          action: "set",
          section: "config",
          properties: { Maxprocesses: 512, globals: 600 },
        },
        ctx,
      );

      expect(mockHttp.post).toHaveBeenCalledWith(
        "/api/executemcp/v2/system/config",
        {
          action: "set",
          section: "config",
          properties: { Maxprocesses: 512, globals: 600 },
        },
      );
      expect(result.isError).toBeUndefined();
      expect(result.structuredContent).toEqual(setResult);
    });

    it("should format set response for display", async () => {
      const setResult = {
        action: "modified",
        count: 1,
        message:
          "Configuration updated successfully. Some changes may require a restart to take effect.",
      };
      mockHttp.post.mockResolvedValue(envelope(setResult));

      const result = await configManageTool.handler(
        {
          action: "set",
          properties: { Maxprocesses: 256 },
        },
        ctx,
      );

      const text = result.content[0]?.text ?? "";
      expect(text).toContain("Configuration Updated:");
      expect(text).toContain("Properties modified: 1");
      expect(text).toContain("Configuration updated successfully");
    });

    it("should only include defined optional fields in body", async () => {
      mockHttp.post.mockResolvedValue(
        envelope({ action: "modified", count: 1, message: "OK" }),
      );

      await configManageTool.handler(
        {
          action: "set",
          properties: { globals: 500 },
        },
        ctx,
      );

      const body = mockHttp.post.mock.calls[0]?.[1] as Record<
        string,
        unknown
      >;
      expect(body.action).toBe("set");
      expect(body.properties).toEqual({ globals: 500 });
      expect(body.section).toBeUndefined();
    });
  });

  // ── export action ───────────────────────────────────────

  describe("export action", () => {
    it("should send POST with action export", async () => {
      const exportData = {
        system: {
          installDirectory: "c:\\intersystems\\irishealth\\",
          product: "IRIS for Windows",
          version: "2025.1",
          os: "Windows",
        },
        config: {
          Maxprocesses: 300,
          globals: 400,
          routines: 200,
        },
      };
      mockHttp.post.mockResolvedValue(envelope(exportData));

      const result = await configManageTool.handler(
        { action: "export" },
        ctx,
      );

      expect(mockHttp.post).toHaveBeenCalledWith(
        "/api/executemcp/v2/system/config",
        { action: "export" },
      );
      expect(result.isError).toBeUndefined();
      expect(result.structuredContent).toEqual(exportData);
    });

    it("should format export response for display", async () => {
      const exportData = {
        system: {
          installDirectory: "c:\\intersystems\\irishealth\\",
          product: "IRIS for Windows",
          version: "2025.1",
          os: "Windows",
        },
        config: {
          Maxprocesses: 300,
          globals: 400,
        },
      };
      mockHttp.post.mockResolvedValue(envelope(exportData));

      const result = await configManageTool.handler(
        { action: "export" },
        ctx,
      );

      const text = result.content[0]?.text ?? "";
      expect(text).toContain("System Configuration Export:");
      expect(text).toContain("Product: IRIS for Windows");
      expect(text).toContain("Version: 2025.1");
      expect(text).toContain("OS: Windows");
      expect(text).toContain("Install Directory:");
      expect(text).toContain("Maxprocesses: 300");
      expect(text).toContain("globals: 400");
    });
  });

  // ── error handling ──────────────────────────────────────

  describe("error handling", () => {
    it("should return isError on IrisApiError", async () => {
      mockHttp.post.mockRejectedValue(
        new IrisApiError(
          400,
          [{ error: "Invalid action" }],
          "/api/executemcp/v2/system/config",
          "Invalid action",
        ),
      );

      const result = await configManageTool.handler(
        { action: "get" },
        ctx,
      );

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain(
        "Error managing configuration",
      );
    });

    it("should propagate non-IrisApiError exceptions", async () => {
      mockHttp.post.mockRejectedValue(new Error("ECONNREFUSED"));

      await expect(
        configManageTool.handler({ action: "get" }, ctx),
      ).rejects.toThrow("ECONNREFUSED");
    });

    it("should return isError for invalid section from server", async () => {
      mockHttp.post.mockRejectedValue(
        new IrisApiError(
          400,
          [{ error: "Invalid section" }],
          "/api/executemcp/v2/system/config",
          "Parameter 'section' must be one of: config, startup, locale",
        ),
      );

      const result = await configManageTool.handler(
        { action: "get", section: "config" },
        ctx,
      );

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain(
        "Error managing configuration",
      );
    });

    it("should return isError when set action fails", async () => {
      mockHttp.post.mockRejectedValue(
        new IrisApiError(
          400,
          [{ error: "Only config section supports modification" }],
          "/api/executemcp/v2/system/config",
          "Only config section supports modification",
        ),
      );

      const result = await configManageTool.handler(
        {
          action: "set",
          section: "config",
          properties: { Maxprocesses: 999 },
        },
        ctx,
      );

      expect(result.isError).toBe(true);
    });
  });
});
