import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import {
  McpServerBase,
  encodeCursor,
  decodeCursor,
  buildToolContext,
} from "../server-base.js";
import type { McpServerBaseOptions } from "../server-base.js";
import type { ToolDefinition } from "../tool-types.js";
import type { IrisConnectionConfig } from "../config.js";
import { IrisHttpClient } from "../http-client.js";

// ── Helpers ─────────────────────────────────────────────────────────

function makeConfig(): IrisConnectionConfig {
  return {
    host: "localhost",
    port: 52773,
    username: "testuser",
    password: "testpass",
    namespace: "HSCUSTOM",
    https: false,
    baseUrl: "http://localhost:52773",
    timeout: 60_000,
  };
}

function makeGetDocTool(
  handlerFn?: ToolDefinition["handler"],
): ToolDefinition {
  return {
    name: "iris_doc_get",
    title: "Get Document",
    description: "Retrieve a document by name.",
    inputSchema: z.object({
      name: z.string().describe("Document name"),
      namespace: z.string().optional().describe("Target namespace"),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    scope: "NS",
    handler:
      handlerFn ??
      (async (_args, ctx) => ({
        content: [{ type: "text" as const, text: `ns=${ctx.resolveNamespace()}` }],
      })),
  };
}

function makeSysInfoTool(): ToolDefinition {
  return {
    name: "iris_sys_info",
    title: "System Info",
    description: "Get system information.",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true },
    scope: "SYS",
    // Non-baseline synthetic fixture: declare a `mutates` class so it satisfies
    // the Story 15.0 registration assertion (every non-baseline key must classify).
    mutates: "read",
    handler: async (_args, ctx) => ({
      content: [
        { type: "text" as const, text: `ns=${ctx.resolveNamespace()}` },
      ],
    }),
  };
}

function makeServerOpts(
  tools: ToolDefinition[] = [],
  config?: IrisConnectionConfig,
): McpServerBaseOptions {
  const opts: McpServerBaseOptions = {
    name: "test-server",
    version: "1.0.0",
    tools,
  };
  if (config !== undefined) {
    opts.config = config;
  }
  return opts;
}

// ── Tests ───────────────────────────────────────────────────────────

describe("server-base", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("McpServerBase constructor", () => {
    it("should create a server with no tools", () => {
      const server = new McpServerBase(makeServerOpts());
      expect(server.toolCount).toBe(0);
      expect(server.getToolNames()).toEqual([]);
    });

    it("should register tools on construction", () => {
      const server = new McpServerBase(
        makeServerOpts([makeGetDocTool(), makeSysInfoTool()]),
      );
      expect(server.toolCount).toBe(2);
      expect(server.getToolNames()).toContain("iris_doc_get");
      expect(server.getToolNames()).toContain("iris_sys_info");
    });

    it("should provide access to the underlying MCP SDK server", () => {
      const server = new McpServerBase(makeServerOpts());
      expect(server.server).toBeDefined();
    });

    it("should retrieve a tool definition by name", () => {
      const tool = makeGetDocTool();
      const server = new McpServerBase(makeServerOpts([tool]));
      const retrieved = server.getTool("iris_doc_get");
      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe("iris_doc_get");
      expect(retrieved?.scope).toBe("NS");
    });

    it("should return undefined for unknown tool names", () => {
      const server = new McpServerBase(makeServerOpts());
      expect(server.getTool("nonexistent")).toBeUndefined();
    });
  });

  // ── Story 15.0 AC 15.0.3 / 15.0.6(b) — registration classification gate ──
  //
  // Every NON-baseline tool/action key MUST declare `mutates`. The
  // registration-time assertion throws (naming the key) for an unclassified new
  // tool — read OR write — and is exempt for baseline/grandfathered tools.
  describe("registration classification assertion (Story 15.0 AC 15.0.3)", () => {
    /** A NEW (non-baseline) tool with NO `mutates` declared. */
    function makeUnclassifiedTool(name: string): ToolDefinition {
      return {
        name,
        title: name,
        description: "A new tool that forgot to classify mutates.",
        inputSchema: z.object({}),
        annotations: {},
        scope: "NONE",
        handler: async () => ({ content: [{ type: "text" as const, text: "ok" }] }),
      };
    }

    it("THROWS at construction for a new non-baseline tool missing `mutates`", () => {
      expect(
        () =>
          new McpServerBase(
            makeServerOpts([makeUnclassifiedTool("iris_unclassified_new")]),
          ),
      ).toThrow(/iris_unclassified_new/);
    });

    it("THROWS at construction whether the forgotten tool is read- or write-like", () => {
      // The gate is classification-presence, not class-value: a destructive
      // annotation does NOT exempt it — `mutates` must be declared explicitly.
      const writeLike: ToolDefinition = {
        ...makeUnclassifiedTool("iris_destructive_new"),
        annotations: { destructiveHint: true, readOnlyHint: false },
      };
      expect(() => new McpServerBase(makeServerOpts([writeLike]))).toThrow(
        /iris_destructive_new/,
      );
    });

    it("does NOT throw when the new tool declares `mutates`", () => {
      const classified: ToolDefinition = {
        ...makeUnclassifiedTool("iris_classified_new"),
        mutates: "read",
      };
      expect(() => new McpServerBase(makeServerOpts([classified]))).not.toThrow();
    });

    it("does NOT throw for a baseline tool that omits `mutates` (grandfathered)", () => {
      // `iris_doc_get` is a real baseline key → exempt from classification.
      expect(() => new McpServerBase(makeServerOpts([makeGetDocTool()]))).not.toThrow();
    });

    it("THROWS via addTools() for a dynamically-added unclassified tool", () => {
      const server = new McpServerBase(makeServerOpts([]));
      expect(() =>
        server.addTools([makeUnclassifiedTool("iris_added_unclassified")]),
      ).toThrow(/iris_added_unclassified/);
    });
  });

  describe("addTools and removeTools (listChanged)", () => {
    it("should add tools dynamically", () => {
      const server = new McpServerBase(makeServerOpts());
      expect(server.toolCount).toBe(0);

      server.addTools([makeGetDocTool()]);
      expect(server.toolCount).toBe(1);
      expect(server.getTool("iris_doc_get")).toBeDefined();
    });

    it("should add multiple tools at once", () => {
      const server = new McpServerBase(makeServerOpts());
      server.addTools([makeGetDocTool(), makeSysInfoTool()]);
      expect(server.toolCount).toBe(2);
    });

    it("should remove tools dynamically", () => {
      const server = new McpServerBase(
        makeServerOpts([makeGetDocTool(), makeSysInfoTool()]),
      );
      expect(server.toolCount).toBe(2);

      server.removeTools(["iris_doc_get"]);
      expect(server.toolCount).toBe(1);
      expect(server.getTool("iris_doc_get")).toBeUndefined();
      expect(server.getTool("iris_sys_info")).toBeDefined();
    });

    it("should handle removing non-existent tools gracefully", () => {
      const server = new McpServerBase(makeServerOpts([makeGetDocTool()]));
      // Should not throw
      server.removeTools(["nonexistent"]);
      expect(server.toolCount).toBe(1);
    });
  });

  describe("cursor-based pagination", () => {
    it("should encode and decode cursor round-trip", () => {
      const cursor = encodeCursor(42);
      expect(typeof cursor).toBe("string");
      expect(decodeCursor(cursor)).toBe(42);
    });

    it("should decode undefined cursor as offset 0", () => {
      expect(decodeCursor(undefined)).toBe(0);
    });

    it("should decode empty string cursor as offset 0", () => {
      expect(decodeCursor("")).toBe(0);
    });

    it("should decode malformed cursor as offset 0", () => {
      expect(decodeCursor("not-valid-base64")).toBe(0);
    });

    it("should decode base64 with wrong shape as offset 0", () => {
      const badCursor = Buffer.from(
        JSON.stringify({ notOffset: 10 }),
      ).toString("base64");
      expect(decodeCursor(badCursor)).toBe(0);
    });

    it("should throw when encoding a negative offset", () => {
      expect(() => encodeCursor(-1)).toThrow("non-negative");
    });

    it("should throw when encoding NaN offset", () => {
      expect(() => encodeCursor(NaN)).toThrow("non-negative");
    });

    it("should decode negative offset cursor as 0", () => {
      // Manually craft a cursor with a negative offset
      const badCursor = Buffer.from(
        JSON.stringify({ offset: -5 }),
      ).toString("base64");
      expect(decodeCursor(badCursor)).toBe(0);
    });

    it("should paginate within a single page", () => {
      const server = new McpServerBase(makeServerOpts());
      const items = Array.from({ length: 10 }, (_, i) => i);
      const result = server.paginate(items, undefined);
      expect(result.page).toEqual(items);
      expect(result.nextCursor).toBeUndefined();
    });

    it("should paginate across multiple pages", () => {
      const server = new McpServerBase(makeServerOpts());
      const items = Array.from({ length: 120 }, (_, i) => i);

      // Page 1 (default 50)
      const page1 = server.paginate(items, undefined);
      expect(page1.page).toHaveLength(50);
      expect(page1.page[0]).toBe(0);
      expect(page1.nextCursor).toBeDefined();

      // Page 2
      const page2 = server.paginate(items, page1.nextCursor);
      expect(page2.page).toHaveLength(50);
      expect(page2.page[0]).toBe(50);
      expect(page2.nextCursor).toBeDefined();

      // Page 3 (last, partial)
      const page3 = server.paginate(items, page2.nextCursor);
      expect(page3.page).toHaveLength(20);
      expect(page3.page[0]).toBe(100);
      expect(page3.nextCursor).toBeUndefined();
    });

    it("should support custom page sizes", () => {
      const server = new McpServerBase(makeServerOpts());
      const items = [1, 2, 3, 4, 5];

      const page1 = server.paginate(items, undefined, 2);
      expect(page1.page).toEqual([1, 2]);
      expect(page1.nextCursor).toBeDefined();

      const page2 = server.paginate(items, page1.nextCursor, 2);
      expect(page2.page).toEqual([3, 4]);
      expect(page2.nextCursor).toBeDefined();

      const page3 = server.paginate(items, page2.nextCursor, 2);
      expect(page3.page).toEqual([5]);
      expect(page3.nextCursor).toBeUndefined();
    });

    it("should return default page size of 50", () => {
      const server = new McpServerBase(makeServerOpts());
      expect(server.pageSize).toBe(50);
    });

    it("should return empty page when cursor offset exceeds total items", () => {
      const server = new McpServerBase(makeServerOpts());
      const items = [1, 2, 3];
      // Manually create a cursor beyond the end
      const farCursor = encodeCursor(100);
      const result = server.paginate(items, farCursor);
      expect(result.page).toEqual([]);
      expect(result.nextCursor).toBeUndefined();
    });
  });

  describe("namespace resolution (buildToolContext)", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockHttp = {} as any;
    const config = makeConfig(); // namespace: "HSCUSTOM"

    it("NS scope: returns config default when no override", () => {
      const ctx = buildToolContext("NS", config, mockHttp, 7);
      expect(ctx.resolveNamespace()).toBe("HSCUSTOM");
    });

    it("NS scope: returns override when provided", () => {
      const ctx = buildToolContext("NS", config, mockHttp, 7);
      expect(ctx.resolveNamespace("USER")).toBe("USER");
    });

    it("SYS scope: always returns %SYS regardless of override", () => {
      const ctx = buildToolContext("SYS", config, mockHttp, 7);
      expect(ctx.resolveNamespace()).toBe("%SYS");
      expect(ctx.resolveNamespace("USER")).toBe("%SYS");
    });

    it("BOTH scope: behaves like NS (default or override)", () => {
      const ctx = buildToolContext("BOTH", config, mockHttp, 7);
      expect(ctx.resolveNamespace()).toBe("HSCUSTOM");
      expect(ctx.resolveNamespace("PRODUCTION")).toBe("PRODUCTION");
    });

    it("NONE scope: returns empty string", () => {
      const ctx = buildToolContext("NONE", config, mockHttp, 7);
      expect(ctx.resolveNamespace()).toBe("");
      expect(ctx.resolveNamespace("USER")).toBe("");
    });

    it("should pass through http client and atelierVersion", () => {
      const ctx = buildToolContext("NS", config, mockHttp, 8);
      expect(ctx.http).toBe(mockHttp);
      expect(ctx.atelierVersion).toBe(8);
      expect(ctx.config).toBe(config);
    });
  });

  describe("ToolContext.paginate (buildToolContext)", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockHttp = {} as any;
    const config = makeConfig();

    it("should return all items when they fit in a single page", () => {
      const ctx = buildToolContext("NS", config, mockHttp, 7);
      const items = [1, 2, 3, 4, 5];
      const result = ctx.paginate(items, undefined);
      expect(result.page).toEqual(items);
      expect(result.nextCursor).toBeUndefined();
    });

    it("should paginate across multiple pages using default page size", () => {
      const ctx = buildToolContext("NS", config, mockHttp, 7);
      const items = Array.from({ length: 120 }, (_, i) => i);

      // Page 1 (default 50)
      const page1 = ctx.paginate(items, undefined);
      expect(page1.page).toHaveLength(50);
      expect(page1.page[0]).toBe(0);
      expect(page1.nextCursor).toBeDefined();

      // Page 2
      const page2 = ctx.paginate(items, page1.nextCursor);
      expect(page2.page).toHaveLength(50);
      expect(page2.page[0]).toBe(50);
      expect(page2.nextCursor).toBeDefined();

      // Page 3 (last, partial)
      const page3 = ctx.paginate(items, page2.nextCursor);
      expect(page3.page).toHaveLength(20);
      expect(page3.page[0]).toBe(100);
      expect(page3.nextCursor).toBeUndefined();
    });

    it("should support custom page sizes", () => {
      const ctx = buildToolContext("NS", config, mockHttp, 7);
      const items = [1, 2, 3, 4, 5];

      const page1 = ctx.paginate(items, undefined, 2);
      expect(page1.page).toEqual([1, 2]);
      expect(page1.nextCursor).toBeDefined();

      const page2 = ctx.paginate(items, page1.nextCursor, 2);
      expect(page2.page).toEqual([3, 4]);
      expect(page2.nextCursor).toBeDefined();

      const page3 = ctx.paginate(items, page2.nextCursor, 2);
      expect(page3.page).toEqual([5]);
      expect(page3.nextCursor).toBeUndefined();
    });

    it("should respect custom page size passed to buildToolContext", () => {
      const ctx = buildToolContext("NS", config, mockHttp, 7, 3);
      const items = [1, 2, 3, 4, 5];

      const page1 = ctx.paginate(items, undefined);
      expect(page1.page).toEqual([1, 2, 3]);
      expect(page1.nextCursor).toBeDefined();

      const page2 = ctx.paginate(items, page1.nextCursor);
      expect(page2.page).toEqual([4, 5]);
      expect(page2.nextCursor).toBeUndefined();
    });

    it("should handle empty items array", () => {
      const ctx = buildToolContext("NS", config, mockHttp, 7);
      const result = ctx.paginate([], undefined);
      expect(result.page).toEqual([]);
      expect(result.nextCursor).toBeUndefined();
    });

    it("should handle undefined cursor as first page", () => {
      const ctx = buildToolContext("NS", config, mockHttp, 7, 2);
      const result = ctx.paginate([1, 2, 3], undefined);
      expect(result.page).toEqual([1, 2]);
    });
  });

  describe("tool response format", () => {
    it("should define tools that return content array", async () => {
      const handler = vi.fn(async () => ({
        content: [{ type: "text" as const, text: "hello" }],
      }));
      const tool = makeGetDocTool(handler);
      const result = await tool.handler({}, {} as never);
      expect(result.content).toHaveLength(1);
      expect(result.content[0]?.type).toBe("text");
    });

    it("should support structuredContent in tool results", async () => {
      const data = { id: "1", className: "MyClass" };
      const handler = vi.fn(async () => ({
        content: [{ type: "text" as const, text: JSON.stringify(data) }],
        structuredContent: data,
      }));
      const tool = makeGetDocTool(handler);
      const result = await tool.handler({}, {} as never);
      expect(result.structuredContent).toEqual(data);
    });

    it("should support isError flag in tool results", async () => {
      const handler = vi.fn(async () => ({
        content: [{ type: "text" as const, text: "error occurred" }],
        isError: true,
      }));
      const tool = makeGetDocTool(handler);
      const result = await tool.handler({}, {} as never);
      expect(result.isError).toBe(true);
    });
  });

  describe("Zod validation", () => {
    it("should validate tool input schema with valid args", () => {
      const tool = makeGetDocTool();
      const result = tool.inputSchema.safeParse({
        name: "MyClass.cls",
        namespace: "USER",
      });
      expect(result.success).toBe(true);
    });

    it("should reject invalid arguments with Zod parse error", () => {
      const tool = makeGetDocTool();
      // Missing required 'name' field
      const result = tool.inputSchema.safeParse({});
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.length).toBeGreaterThan(0);
      }
    });

    it("should reject wrong argument types", () => {
      const tool = makeGetDocTool();
      const result = tool.inputSchema.safeParse({ name: 123 });
      expect(result.success).toBe(false);
    });

    it("should accept optional fields as absent", () => {
      const tool = makeGetDocTool();
      const result = tool.inputSchema.safeParse({ name: "MyClass.cls" });
      expect(result.success).toBe(true);
    });
  });

  describe("start() method", () => {
    let fetchMock: ReturnType<typeof vi.fn>;
    const originalFetch = globalThis.fetch;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let exitMock: any;

    beforeEach(() => {
      fetchMock = vi.fn();
      globalThis.fetch = fetchMock;
      // Mock process.exit to prevent test from terminating
      exitMock = vi
        .spyOn(process, "exit")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .mockImplementation((() => {}) as any);
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
      exitMock.mockRestore();
    });

    it("should call process.exit when health check fails", async () => {
      // Health check will fail because fetch throws
      fetchMock.mockRejectedValue(new TypeError("Connection refused"));

      const server = new McpServerBase(
        makeServerOpts([], makeConfig()),
      );

      // start() calls process.exit(1) on health check failure and
      // then returns early (guarded by `return` after process.exit).
      await server.start("stdio");
      expect(exitMock).toHaveBeenCalledWith(1);
    });

    it("should throw for HTTP transport (not yet implemented)", async () => {
      // Set up health check to succeed
      fetchMock.mockResolvedValueOnce(
        new Response(null, { status: 200 }),
      );
      // Negotiation call
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: { errors: [] },
            console: [],
            result: { version: "8.0.0" },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );

      const server = new McpServerBase(
        makeServerOpts([], makeConfig()),
      );

      await expect(server.start("http")).rejects.toThrow(
        "HTTP transport not yet implemented",
      );
    });
  });

  describe("outputSchema registration", () => {
    it("should register a tool with outputSchema and pass it to SDK", () => {
      const outputSchema = z.object({
        result: z.string(),
        count: z.number(),
      });
      const tool: ToolDefinition = {
        name: "iris_test_output",
        title: "Test Output",
        description: "Test tool with output schema.",
        inputSchema: z.object({ query: z.string() }),
        outputSchema,
        annotations: { readOnlyHint: true },
        scope: "NONE",
        // Non-baseline synthetic fixture → must classify (Story 15.0 AC 15.0.3).
        mutates: "read",
        handler: async () => ({
          content: [{ type: "text" as const, text: "ok" }],
          structuredContent: { result: "hello", count: 1 },
        }),
      };

      const server = new McpServerBase(makeServerOpts([tool]));
      expect(server.toolCount).toBe(1);

      const registered = server.getTool("iris_test_output");
      expect(registered).toBeDefined();
      expect(registered?.outputSchema).toBeDefined();
      expect(registered?.outputSchema?.shape).toHaveProperty("result");
      expect(registered?.outputSchema?.shape).toHaveProperty("count");
    });

    it("should register a tool without outputSchema (regression guard)", () => {
      const tool = makeGetDocTool();
      const server = new McpServerBase(makeServerOpts([tool]));
      expect(server.toolCount).toBe(1);

      const registered = server.getTool("iris_doc_get");
      expect(registered).toBeDefined();
      expect(registered?.outputSchema).toBeUndefined();
    });
  });

  describe("tool annotations", () => {
    it("should preserve all annotation hints on registered tools", () => {
      const tool = makeGetDocTool();
      const server = new McpServerBase(makeServerOpts([tool]));
      const registered = server.getTool("iris_doc_get");
      expect(registered?.annotations).toEqual({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      });
    });

    it("should handle empty annotations", () => {
      const tool: ToolDefinition = {
        name: "iris_test",
        title: "Test",
        description: "Test tool",
        inputSchema: z.object({}),
        annotations: {},
        scope: "NONE",
        // Non-baseline synthetic fixture → must classify (Story 15.0 AC 15.0.3).
        mutates: "read",
        handler: async () => ({
          content: [{ type: "text" as const, text: "ok" }],
        }),
      };
      const server = new McpServerBase(makeServerOpts([tool]));
      const registered = server.getTool("iris_test");
      expect(registered?.annotations).toEqual({});
    });
  });

  // ── Per-profile client registry (Epic 14, AC 14.1.4 / 14.1.7) ──────
  //
  // The single `this.http` was replaced by a per-profile ProfileClientRegistry
  // (architecture decision D1). The default profile is established eagerly in
  // start(); non-default profiles are established lazily on first
  // getOrCreateClient (D1/D8). handleToolCall stays on the default profile
  // (per-call `server` selection is Story 14.2 / D2).
  describe("per-profile client registry (AC 14.1.4 / 14.1.7)", () => {
    let fetchMock: ReturnType<typeof vi.fn>;
    const originalFetch = globalThis.fetch;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let exitMock: any;
    const savedEnv = {
      IRIS_USERNAME: process.env.IRIS_USERNAME,
      IRIS_PASSWORD: process.env.IRIS_PASSWORD,
      IRIS_HOST: process.env.IRIS_HOST,
      IRIS_PROFILES: process.env.IRIS_PROFILES,
    };

    /** Atelier version-negotiation response body. */
    function versionResponse(): Response {
      return new Response(
        JSON.stringify({
          status: { errors: [] },
          console: [],
          result: { version: "8.0.0" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    beforeEach(() => {
      fetchMock = vi.fn();
      globalThis.fetch = fetchMock;
      exitMock = vi
        .spyOn(process, "exit")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .mockImplementation((() => {}) as any);
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
      exitMock.mockRestore();
      // Restore env we may have mutated.
      for (const [k, v] of Object.entries(savedEnv)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    });

    it("establishes the default profile eagerly in start() and reuses that client", async () => {
      // Health check + version negotiation succeed.
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
      fetchMock.mockResolvedValueOnce(versionResponse());

      const server = new McpServerBase(makeServerOpts([], makeConfig()));
      await server.start("stdio");

      // getOrCreateClient("default") returns the eagerly-created client and does
      // NOT issue more fetches (no re-negotiation).
      const callsAfterStart = fetchMock.mock.calls.length;
      const { client, atelierVersion } = await server.getOrCreateClient(
        "default",
        false,
      );
      expect(client).toBeInstanceOf(IrisHttpClient);
      expect(atelierVersion).toBe(8); // negotiated major version from "8.0.0"
      expect(fetchMock.mock.calls.length).toBe(callsAfterStart);
    });

    it("lazily establishes a non-default profile with its own isolated client", async () => {
      process.env.IRIS_USERNAME = "u";
      process.env.IRIS_PASSWORD = "p";
      process.env.IRIS_HOST = "default.example.com";
      process.env.IRIS_PROFILES = JSON.stringify({
        other: { host: "other.example.com" },
      });

      // start(): default profile health check + negotiation.
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
      fetchMock.mockResolvedValueOnce(versionResponse());

      // No injected config → start() uses loadProfileRegistry() (reads env).
      const server = new McpServerBase(makeServerOpts([]));
      await server.start("stdio");

      const defaultClient = await server.getOrCreateClient("default", false);

      // First touch of "other": its own health check + negotiation.
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
      fetchMock.mockResolvedValueOnce(versionResponse());

      const otherClient = await server.getOrCreateClient("other", false);

      // Distinct instances → session isolation across profiles.
      expect(otherClient.client).toBeInstanceOf(IrisHttpClient);
      expect(otherClient.client).not.toBe(defaultClient.client);

      // The "other" profile's request targeted its own host.
      const otherHealthCall = fetchMock.mock.calls.find((c) =>
        String(c[0]).includes("other.example.com"),
      );
      expect(otherHealthCall).toBeDefined();

      // Second touch of "other" returns the cached client without new fetches.
      const callsBeforeRepeat = fetchMock.mock.calls.length;
      const otherAgain = await server.getOrCreateClient("other", false);
      expect(otherAgain.client).toBe(otherClient.client);
      expect(fetchMock.mock.calls.length).toBe(callsBeforeRepeat);
    });

    it("getOrCreateClient throws a structured error for an unknown profile", async () => {
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
      fetchMock.mockResolvedValueOnce(versionResponse());

      const server = new McpServerBase(makeServerOpts([], makeConfig()));
      await server.start("stdio");

      await expect(server.getOrCreateClient("nope", false)).rejects.toThrow(
        /Unknown server profile "nope"/,
      );
    });

    it("handleToolCall still resolves the default profile client (back-compat)", async () => {
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
      fetchMock.mockResolvedValueOnce(versionResponse());

      const tool = makeGetDocTool();
      const server = new McpServerBase(makeServerOpts([tool], makeConfig()));
      await server.start("stdio");

      // Invoke the SDK-registered callback (the path handleToolCall drives).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sdkTools = (server.server as any)._registeredTools;
      const entry = sdkTools["iris_doc_get"];
      const callback = entry.callback ?? entry.handler ?? entry.cb;
      const result = await callback({ name: "Foo.cls" });

      expect(result.isError).toBeFalsy();
      // Default profile namespace resolution still works (HSCUSTOM from config).
      expect(result.content[0].text).toContain("HSCUSTOM");
    });
  });
});
