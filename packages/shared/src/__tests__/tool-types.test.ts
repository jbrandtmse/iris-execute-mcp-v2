import { describe, it, expect } from "vitest";
import { z } from "zod";
import type {
  ToolAnnotations,
  ToolDefinition,
  ToolContext,
  ToolResult,
  ToolScope,
} from "../tool-types.js";

// ── Tests ───────────────────────────────────────────────────────────

describe("tool-types", () => {
  describe("ToolAnnotations", () => {
    it("should accept a full annotations object", () => {
      const annotations: ToolAnnotations = {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      };
      expect(annotations.readOnlyHint).toBe(true);
      expect(annotations.destructiveHint).toBe(false);
      expect(annotations.idempotentHint).toBe(true);
      expect(annotations.openWorldHint).toBe(false);
    });

    it("should accept an empty annotations object", () => {
      const annotations: ToolAnnotations = {};
      expect(annotations.readOnlyHint).toBeUndefined();
    });

    it("should accept partial annotations", () => {
      const annotations: ToolAnnotations = { readOnlyHint: true };
      expect(annotations.readOnlyHint).toBe(true);
      expect(annotations.destructiveHint).toBeUndefined();
    });
  });

  describe("ToolScope", () => {
    it("should accept all valid scope values", () => {
      const scopes: ToolScope[] = ["NS", "SYS", "BOTH", "NONE"];
      expect(scopes).toHaveLength(4);
      expect(scopes).toContain("NS");
      expect(scopes).toContain("SYS");
      expect(scopes).toContain("BOTH");
      expect(scopes).toContain("NONE");
    });
  });

  describe("ToolResult", () => {
    it("should accept a minimal result with content only", () => {
      const result: ToolResult = {
        content: [{ type: "text", text: "Hello" }],
      };
      expect(result.content).toHaveLength(1);
      expect(result.content[0]?.type).toBe("text");
      expect(result.structuredContent).toBeUndefined();
      expect(result.isError).toBeUndefined();
    });

    it("should accept a result with structured content", () => {
      const data = { classes: ["MyClass", "OtherClass"] };
      const result: ToolResult = {
        content: [{ type: "text", text: JSON.stringify(data) }],
        structuredContent: data,
      };
      expect(result.structuredContent).toEqual(data);
    });

    it("should accept a result with isError flag", () => {
      const result: ToolResult = {
        content: [{ type: "text", text: "Something went wrong" }],
        isError: true,
      };
      expect(result.isError).toBe(true);
    });
  });

  describe("ToolDefinition", () => {
    it("should accept a complete tool definition", () => {
      const tool: ToolDefinition = {
        name: "iris.doc.get",
        title: "Get Document",
        description: "Retrieve a document from IRIS by name.",
        inputSchema: z.object({
          name: z.string().describe("Document name"),
          namespace: z.string().optional().describe("IRIS namespace"),
        }),
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
        scope: "NS",
        handler: async (_args, _ctx) => ({
          content: [{ type: "text", text: "result" }],
        }),
      };

      expect(tool.name).toBe("iris.doc.get");
      expect(tool.scope).toBe("NS");
      expect(tool.annotations.readOnlyHint).toBe(true);
    });

    it("should accept a SYS-scoped tool", () => {
      const tool: ToolDefinition = {
        name: "iris.sys.info",
        title: "System Info",
        description: "Get IRIS system information.",
        inputSchema: z.object({}),
        annotations: { readOnlyHint: true },
        scope: "SYS",
        handler: async () => ({
          content: [{ type: "text", text: "info" }],
        }),
      };
      expect(tool.scope).toBe("SYS");
    });

    it("should accept optional outputSchema", () => {
      const tool: ToolDefinition = {
        name: "iris.test",
        title: "Test Tool",
        description: "A test tool.",
        inputSchema: z.object({ id: z.string() }),
        outputSchema: {
          type: "object",
          properties: {
            result: { type: "string" },
          },
        },
        annotations: {},
        scope: "NONE",
        handler: async () => ({
          content: [{ type: "text", text: "ok" }],
        }),
      };
      expect(tool.outputSchema).toBeDefined();
    });
  });

  describe("ToolContext", () => {
    it("should satisfy the interface contract", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockHttp = {} as any;
      const ctx: ToolContext = {
        resolveNamespace: (override?: string) => override ?? "HSCUSTOM",
        http: mockHttp,
        atelierVersion: 7,
        config: {
          host: "localhost",
          port: 52773,
          username: "test",
          password: "test",
          namespace: "HSCUSTOM",
          https: false,
          baseUrl: "http://localhost:52773",
        },
      };

      expect(ctx.resolveNamespace()).toBe("HSCUSTOM");
      expect(ctx.resolveNamespace("USER")).toBe("USER");
      expect(ctx.atelierVersion).toBe(7);
    });
  });
});
