/**
 * Story 43.1 (AD-3, AD-15, AD-19, AD-32; project rules #19, #36, #46) - the 2025-11-25 wire that the framework owns on top of the
 * MCP SDK v2: `tools/list`, `tools/call`, `prompts/get` and `resources/read`.
 *
 * A fixture `McpServerBase` is started through its real `start()` with the stdio transport replaced by one half of an in-memory
 * pair, and a real SDK v2 `Client` (legacy negotiation) is connected to the other half. Every row of the story's I/O matrix that
 * can run without an IRIS instance is driven from the client; the raw key order of a `tools/list` entry, and the in-process
 * callback a unit test reaches through `_registeredTools`, are read off the registered request handlers. The expected texts are
 * the v1 texts that `story-43-1-sdk-wire-golden.test.ts` pins on the five built servers.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/client";

// The server connects to this half of an in-memory pair instead of the process's stdio.
const linked = vi.hoisted(() => ({ clientHalf: undefined as unknown }));
vi.mock("@modelcontextprotocol/server/stdio", async () => {
  const { InMemoryTransport } = await import("@modelcontextprotocol/server");
  class FakeStdioServerTransport {
    constructor() {
      const [clientHalf, serverHalf] = InMemoryTransport.createLinkedPair();
      linked.clientHalf = clientHalf;
      return serverHalf as unknown as FakeStdioServerTransport;
    }
  }
  return { StdioServerTransport: FakeStdioServerTransport };
});

import { McpServerBase, withServerParam } from "../server-base.js";
import type { McpServerBaseOptions } from "../server-base.js";
import type { IrisConnectionConfig } from "../config.js";
import type { PromptDefinition, ToolDefinition } from "../tool-types.js";
import { auditLines, stageDefaultStartup } from "./test-helpers.js";
import { makeEnvHarness } from "./env-harness.js";

const READ_ANNOTATIONS = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

/** The arguments the handler of `iris_wire_echo` received, in call order. */
const echoCalls: unknown[] = [];

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

const echoTool: ToolDefinition = {
  name: "iris_wire_echo",
  title: "Wire echo",
  description: "Echo the arguments the handler received.",
  inputSchema: z.object({
    name: z.string().describe("A name"),
    mode: z.enum(["fast", "slow"]).optional().describe("A mode"),
    text: z.string().refine((value) => value !== "bad", "text must not be bad").optional(),
    namespace: z.string().optional(),
  }),
  annotations: READ_ANNOTATIONS,
  scope: "NS",
  mutates: "read",
  handler: async (args) => {
    echoCalls.push(args);
    return { content: [{ type: "text" as const, text: JSON.stringify(args) }] };
  },
};

/** A tool with a refinement on the whole object, which the wire validation does not apply (the dispatch does). */
const refinedTool: ToolDefinition = {
  name: "iris_wire_refined",
  title: "Wire refined",
  description: "Needs a name to start.",
  inputSchema: z
    .object({
      action: z.enum(["start", "stop"]),
      name: z.string().optional(),
      namespace: z.string().optional(),
    })
    .refine((data) => data.action !== "start" || !!data.name, {
      message: "'name' is required for 'start'",
      path: ["name"],
    }),
  annotations: READ_ANNOTATIONS,
  scope: "NS",
  mutates: { start: "read", stop: "read" },
  handler: async () => ({ content: [{ type: "text" as const, text: "refined ok" }] }),
};

const writeTool: ToolDefinition = {
  name: "iris_wire_write",
  title: "Wire write",
  description: "A write, disabled by default.",
  inputSchema: z.object({ value: z.string() }),
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  scope: "NS",
  mutates: "write",
  handler: async () => ({ content: [{ type: "text" as const, text: "written" }] }),
};

const hiddenTool: ToolDefinition = { ...echoTool, name: "iris_wire_hidden", title: "Wire hidden" };

/** A tool that declares an `outputSchema`; `kind` picks what its handler returns. */
const structuredTool: ToolDefinition = {
  name: "iris_wire_structured",
  title: "Wire structured",
  description: "Returns structured content.",
  inputSchema: z.object({ kind: z.enum(["ok", "wrong", "missing", "error"]) }),
  outputSchema: z.object({ count: z.number() }),
  annotations: READ_ANNOTATIONS,
  scope: "NONE",
  mutates: "read",
  handler: async (args) => {
    const { kind } = args as { kind: string };
    const text = [{ type: "text" as const, text: kind }];
    switch (kind) {
      case "ok":
        return { content: text, structuredContent: { count: 1 } };
      case "wrong":
        return { content: text, structuredContent: { count: "one" } };
      case "missing":
        return { content: text };
      default:
        return { content: text, isError: true };
    }
  },
};

/** A tool whose handler result carries `isError` and `structuredContent` together. */
const orderTool: ToolDefinition = {
  name: "iris_wire_order",
  title: "Wire order",
  description: "Returns a result with every member.",
  inputSchema: z.object({ failed: z.boolean() }),
  annotations: READ_ANNOTATIONS,
  scope: "NONE",
  mutates: "read",
  handler: async (args) => ({
    content: [{ type: "text" as const, text: "order" }],
    isError: (args as { failed: boolean }).failed,
    structuredContent: { member: 1 },
  }),
};

const PROMPTS: PromptDefinition[] = [
  {
    name: "wire-required",
    title: "Wire required",
    description: "One required argument.",
    arguments: [{ name: "topic", description: "The topic.", required: true }],
    build: (args) => `topic=${args.topic}`,
  },
  {
    name: "wire-optional",
    title: "Wire optional",
    description: "One optional argument.",
    arguments: [{ name: "detail", description: "The detail.", required: false }],
    build: (args) => `detail=${args.detail ?? "(none)"}`,
  },
  { name: "wire-none", title: "Wire none", description: "No arguments.", arguments: [], build: () => "none" },
  {
    name: "wire-throws",
    title: "Wire throws",
    description: "Its build throws.",
    arguments: [],
    build: () => {
      throw new Error("boom");
    },
  },
];

const env = makeEnvHarness();
let workDir: string;
const opened: Array<{ server: McpServerBase; client: Client }> = [];

beforeEach(() => {
  env.setup();
  echoCalls.length = 0;
  workDir = mkdtempSync(join(tmpdir(), "sdk-wire-compat-"));
});

afterEach(async () => {
  for (const { server, client } of opened.splice(0)) {
    await client.close().catch(() => {});
    await server.stop().catch(() => {});
  }
  env.teardown();
  rmSync(workDir, { recursive: true, force: true });
});

interface Booted {
  server: McpServerBase;
  client: Client;
  /** How many `notifications/tools/list_changed` the client has received. */
  listChanged: () => number;
}

/** Start a fixture server through its real `start()` and connect a v2 client to it over the in-memory pair. */
async function boot(options: Partial<McpServerBaseOptions> = {}): Promise<Booted> {
  stageDefaultStartup(env.fetchMock);
  const server = new McpServerBase({
    name: "wire-compat",
    version: "1.0.0",
    config: makeConfig(),
    tools: [echoTool, refinedTool, writeTool, hiddenTool, structuredTool],
    prompts: PROMPTS,
    ...options,
  });
  await server.start("stdio");
  const client = new Client({ name: "wire-compat-client", version: "0.0.0" }, { versionNegotiation: { mode: "legacy" } });
  let changes = 0;
  client.setNotificationHandler("notifications/tools/list_changed", () => {
    changes += 1;
  });
  await client.connect(linked.clientHalf as Parameters<Client["connect"]>[0]);
  opened.push({ server, client });
  return { server, client, listChanged: () => changes };
}

/** The text of the first content block of a tool result. */
function textOf(result: unknown): string {
  return ((result as { content: Array<{ text: string }> }).content[0] as { text: string }).text;
}

/** What a rejected client call carries. */
async function failureOf(call: Promise<unknown>): Promise<{ code: unknown; message: string }> {
  try {
    await call;
  } catch (error) {
    return { code: (error as { code?: unknown }).code, message: String((error as Error).message) };
  }
  throw new Error("the call did not reject");
}

/** A request handler registered on the SDK server, called the way the in-process tests of this package call it. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function callRequest(server: McpServerBase, method: string, params: unknown): Promise<any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handler = (server.server.server as any)._requestHandlers.get(method) as (request: unknown, extra: unknown) => Promise<unknown>;
  return handler({ method, params }, { signal: new AbortController().signal, mcpReq: { requestState: () => undefined } });
}

describe("initialize and capabilities", () => {
  it("negotiates 2025-11-25 and advertises prompts only on a server that registers one", async () => {
    const withPrompts = await boot();
    expect(withPrompts.client.getNegotiatedProtocolVersion()).toBe("2025-11-25");
    expect(withPrompts.client.getServerCapabilities()).toMatchObject({ tools: { listChanged: true }, resources: { listChanged: true }, prompts: { listChanged: true } });
  });

  it("a server without prompts has no prompts capability, and answers prompts/list with method-not-found", async () => {
    const { client } = await boot({ prompts: [] });
    expect(client.getServerCapabilities()?.prompts).toBeUndefined();
    const failure = await failureOf(client.request({ method: "prompts/list", params: {} }));
    expect(failure.code).toBe(-32601);
  });

  it("an initialize that asks for 2026-07-28 is answered with 2025-11-25", async () => {
    const { server } = await boot();
    const result = await callRequest(server, "initialize", {
      protocolVersion: "2026-07-28",
      capabilities: {},
      clientInfo: { name: "newer", version: "0.0.0" },
    });
    expect(result.protocolVersion).toBe("2025-11-25");
  });
});

describe("tools/list", () => {
  it("lists every visible tool in registration order with the v1 entry keys, and the framework tool last", async () => {
    const { server } = await boot();
    const result = await callRequest(server, "tools/list", {});
    const names = (result.tools as Array<{ name: string }>).map((tool) => tool.name);
    expect(names).toEqual(["iris_wire_echo", "iris_wire_refined", "iris_wire_write", "iris_wire_hidden", "iris_wire_structured", "iris_server_profiles"]);
    for (const tool of result.tools as Array<Record<string, unknown>>) {
      const keys = Object.keys(tool);
      expect(keys.slice(0, 6), String(tool.name)).toEqual(["name", "title", "description", "inputSchema", "annotations", "execution"]);
      expect(tool.execution).toEqual({ taskSupport: "forbidden" });
    }
    const structured = (result.tools as Array<Record<string, unknown>>).find((tool) => tool.name === "iris_wire_structured") as Record<string, unknown>;
    expect(Object.keys(structured).at(-1)).toBe("outputSchema");
  });

  it("serves the input schema as draft-07 JSON Schema of the extended object, with the optional server parameter", async () => {
    const { server } = await boot();
    const result = await callRequest(server, "tools/list", {});
    const entry = (result.tools as Array<{ name: string; inputSchema: Record<string, unknown> }>).find((tool) => tool.name === "iris_wire_echo");
    expect(entry?.inputSchema).toEqual(z.toJSONSchema(z.object(withServerParam(echoTool.inputSchema, echoTool.name).shape), { target: "draft-7", io: "input" }));
    expect(entry?.inputSchema.$schema).toBe("http://json-schema.org/draft-07/schema#");
    expect(Object.keys(entry?.inputSchema.properties as object)).toContain("server");
  });

  it("serves the output schema as draft-07 JSON Schema with io output", async () => {
    const { server } = await boot();
    const result = await callRequest(server, "tools/list", {});
    const entry = (result.tools as Array<{ name: string; outputSchema?: Record<string, unknown> }>).find((tool) => tool.name === "iris_wire_structured");
    expect(entry?.outputSchema).toEqual(z.toJSONSchema(z.object({ count: z.number() }), { target: "draft-7", io: "output" }));
  });

  it("omits a hidden tool, and reaches the client as the same list", async () => {
    process.env.IRIS_TOOLS_DISABLE = "iris_wire_hidden";
    const { client } = await boot();
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    expect(names).not.toContain("iris_wire_hidden");
    expect(names).toContain("iris_wire_echo");
  });
});

describe("tools/call: unknown, hidden and schema-invalid calls", () => {
  it("an unknown tool is the in-band not-found result", async () => {
    const { client } = await boot();
    const result = await client.callTool({ name: "no_such_tool", arguments: {} });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe("MCP error -32602: Tool no_such_tool not found");
  });

  it("a hidden tool is the same not-found result", async () => {
    process.env.IRIS_TOOLS_DISABLE = "iris_wire_hidden";
    const { client } = await boot();
    const result = await client.callTool({ name: "iris_wire_hidden", arguments: { name: "x" } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe("MCP error -32602: Tool iris_wire_hidden not found");
  });

  it.each([
    ["a wrong type", { name: 12345 }, "expected string"],
    ["an enum mismatch", { name: "x", mode: "medium" }, "Invalid option"],
    ["a field-level refine", { name: "x", text: "bad" }, "text must not be bad"],
  ])("%s is the in-band input-validation error, and neither governance nor the handler runs", async (_label, args, fragment) => {
    const { client } = await boot();
    const result = await client.callTool({ name: "iris_wire_echo", arguments: args });
    expect(result.isError).toBe(true);
    const text = textOf(result);
    expect(text.startsWith("MCP error -32602: Input validation error: Invalid arguments for tool iris_wire_echo: ")).toBe(true);
    const expected = z.object(withServerParam(echoTool.inputSchema, echoTool.name).shape).safeParse(args);
    expect(expected.success).toBe(false);
    expect(text.endsWith((expected as { error: { message: string } }).error.message)).toBe(true);
    expect(text).toContain(fragment);
    expect(echoCalls).toEqual([]);
  });

  it("a schema-invalid call to a disabled write is the validation error, not a governance denial", async () => {
    const { client } = await boot();
    const result = await client.callTool({ name: "iris_wire_write", arguments: { value: 5 } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("Input validation error: Invalid arguments for tool iris_wire_write: ");
    expect(result.structuredContent).toBeUndefined();
  });

  it("arguments omitted entirely fail the same way, for a tool and for the discovery tool", async () => {
    const { client } = await boot();
    for (const name of ["iris_wire_echo", "iris_server_profiles"]) {
      const result = await client.callTool({ name });
      expect(result.isError, name).toBe(true);
      expect(textOf(result), name).toContain(`Invalid arguments for tool ${name}: `);
      expect(textOf(result), name).toContain("expected object, received undefined");
    }
  });

  it("a refinement on the whole object is applied by the dispatch, with its own text", async () => {
    const { client } = await boot();
    const result = await client.callTool({ name: "iris_wire_refined", arguments: { action: "start" } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe("Invalid arguments: name: 'name' is required for 'start'");
  });
});

describe("tools/call: valid calls", () => {
  it("the handler receives the parsed arguments: no framework server field, no unknown key", async () => {
    const { client } = await boot();
    const result = await client.callTool({ name: "iris_wire_echo", arguments: { name: "doc", server: "default", stray: 1 } });
    expect(result.isError).toBeFalsy();
    expect(echoCalls).toEqual([{ name: "doc" }]);
  });

  it("a default-disabled write is a structured governance denial", async () => {
    const { client } = await boot();
    const result = await client.callTool({ name: "iris_wire_write", arguments: { value: "x" } });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({ code: "GOVERNANCE_DISABLED", action: "iris_wire_write", server: "default" });
  });

  it("the discovery tool answers with structured content", async () => {
    const { client } = await boot();
    const result = await client.callTool({ name: "iris_server_profiles", arguments: {} });
    expect(result.isError).toBeFalsy();
    expect((result.structuredContent as { defaultProfile: string }).defaultProfile).toBe("default");
  });

  it("a failure of the dispatch itself is the in-band error result with the failure's message", async () => {
    const { server, client } = await boot();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (server as any).dispatchToolCall = async () => {
      throw new Error("dispatch exploded");
    };
    const result = await client.callTool({ name: "iris_wire_echo", arguments: { name: "x" } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe("dispatch exploded");
  });

  it("a callback reached through _registeredTools keeps the dispatch's own validation text", async () => {
    const { server } = await boot();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const entry = (server.server as any)._registeredTools["iris_wire_echo"];
    const result = await (entry.callback ?? entry.handler)({ name: 5 });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/^Invalid arguments: name: /);
  });
});

describe("tools/call: a result that carries isError and structuredContent", () => {
  // The SDK re-encodes a tools/call result in the order of its result schema, so the members of such a result are listed as content,
  // structuredContent, isError. The dispatch builds them as content, isError, structuredContent, the order of the SDK v1 wire. The
  // value is the same JSON object either way; only the member order differs, and no public SDK option keeps the dispatch's order.
  it.each([[false], [true]])("keeps every member and its value when isError is %s", async (failed) => {
    const { server } = await boot({ tools: [orderTool] });
    const result = await callRequest(server, "tools/call", { name: "iris_wire_order", arguments: { failed } });
    expect(Object.keys(result).sort()).toEqual(["content", "isError", "structuredContent"]);
    expect(result).toEqual({ content: [{ type: "text", text: "order" }], isError: failed, structuredContent: { member: 1 } });
  });
});

describe("tools/call: a declared outputSchema", () => {
  it("accepts structured content the schema accepts", async () => {
    const { client } = await boot();
    const result = await client.callTool({ name: "iris_wire_structured", arguments: { kind: "ok" } });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ count: 1 });
  });

  it("refuses structured content the schema rejects, in-band", async () => {
    const { client } = await boot();
    const result = await client.callTool({ name: "iris_wire_structured", arguments: { kind: "wrong" } });
    expect(result.isError).toBe(true);
    expect(textOf(result).startsWith("MCP error -32602: Output validation error: Invalid structured content for tool iris_wire_structured: ")).toBe(true);
  });

  it("refuses a result without structured content, in-band", async () => {
    const { client } = await boot();
    const result = await client.callTool({ name: "iris_wire_structured", arguments: { kind: "missing" } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe("MCP error -32602: Output validation error: Tool iris_wire_structured has an output schema but no structured content was provided");
  });

  it("leaves an error result alone", async () => {
    const { client } = await boot();
    const result = await client.callTool({ name: "iris_wire_structured", arguments: { kind: "error" } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe("error");
  });
});

describe("prompts", () => {
  it("lists the prompts with their arguments, and none for a prompt that declares none", async () => {
    const { client } = await boot();
    const listed = (await client.listPrompts()).prompts;
    expect(listed.map((prompt) => prompt.name)).toEqual(["wire-required", "wire-optional", "wire-none", "wire-throws"]);
    expect(listed[0]?.arguments).toEqual([{ name: "topic", description: "The topic.", required: true }]);
    expect(listed[2]?.arguments).toBeUndefined();
  });

  it("renders a prompt from arguments, and from an empty arguments object", async () => {
    const { client } = await boot();
    expect(textOf({ content: [(await client.getPrompt({ name: "wire-required", arguments: { topic: "t" } })).messages[0]?.content] })).toBe("topic=t");
    expect(textOf({ content: [(await client.getPrompt({ name: "wire-optional", arguments: {} })).messages[0]?.content] })).toBe("detail=(none)");
  });

  it("DW-617: a prompts/get with no arguments key renders exactly as with an empty arguments object", async () => {
    const { client } = await boot();
    const withEmpty = await client.getPrompt({ name: "wire-optional", arguments: {} });
    const omitted = await client.getPrompt({ name: "wire-optional" });
    expect(omitted).toEqual(withEmpty);
  });

  it("a prompt with a required argument rejects an omitted arguments like an empty one, with the v1 text", async () => {
    const { client } = await boot();
    const empty = await failureOf(client.getPrompt({ name: "wire-required", arguments: {} }));
    const omitted = await failureOf(client.getPrompt({ name: "wire-required" }));
    expect(empty.code).toBe(-32602);
    expect(empty.message.startsWith("MCP error -32602: Invalid arguments for prompt wire-required: ")).toBe(true);
    expect(omitted).toEqual(empty);
  });

  it("an unknown prompt is -32602, and a build that throws is -32603 naming the prompt", async () => {
    const { client } = await boot();
    expect(await failureOf(client.getPrompt({ name: "no_such_prompt" }))).toEqual({ code: -32602, message: "MCP error -32602: Prompt no_such_prompt not found" });
    expect(await failureOf(client.getPrompt({ name: "wire-throws" }))).toEqual({
      code: -32603,
      message: "MCP error -32603: Prompt 'wire-throws' failed to render: boom",
    });
  });
});

describe("resources", () => {
  it("lists the governance resource and its template, and reads the default policy", async () => {
    const { client } = await boot();
    expect((await client.listResources()).resources.map((resource) => resource.uri)).toContain("iris-governance://default");
    expect((await client.listResourceTemplates()).resourceTemplates.map((template) => template.uriTemplate)).toEqual(["iris-governance://{profile}"]);
    const read = await client.readResource({ uri: "iris-governance://default" });
    const body = JSON.parse((read.contents[0] as { text: string }).text) as { policy: Record<string, boolean> };
    expect(body.policy.iris_wire_write).toBe(false);
    expect(body.policy.iris_wire_echo).toBe(true);
  });

  it("an unknown profile and a URI that matches no resource are -32602 with the v1 text", async () => {
    const { client } = await boot();
    const unknown = await failureOf(client.readResource({ uri: "iris-governance://ghost" }));
    expect(unknown.code).toBe(-32602);
    expect(unknown.message.startsWith('MCP error -32602: Unknown server profile "ghost".')).toBe(true);
    expect(await failureOf(client.readResource({ uri: "file:///no/such/resource" }))).toEqual({
      code: -32602,
      message: "MCP error -32602: Resource file:///no/such/resource not found",
    });
  });
});

describe("removeTools and addTools", () => {
  it("one call that removes tools sends exactly one list_changed, however many it removes", async () => {
    const { server, client, listChanged } = await boot();
    const before = listChanged();
    server.removeTools(["iris_wire_echo", "iris_wire_structured"]);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(listChanged() - before).toBe(1);
    expect((await client.listTools()).tools.map((tool) => tool.name)).not.toContain("iris_wire_echo");
    const gone = await client.callTool({ name: "iris_wire_echo", arguments: { name: "x" } });
    expect(textOf(gone)).toBe("MCP error -32602: Tool iris_wire_echo not found");
  });

  it("a call that removes nothing sends nothing", async () => {
    const { server, listChanged } = await boot();
    const before = listChanged();
    server.removeTools(["nonexistent"]);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(listChanged() - before).toBe(0);
  });

  it("one call that adds tools sends exactly one list_changed, however many it adds", async () => {
    const { server, client, listChanged } = await boot({ tools: [echoTool] });
    const before = listChanged();
    server.addTools([
      { ...echoTool, name: "iris_wire_added_a", title: "Wire added A" },
      { ...echoTool, name: "iris_wire_added_b", title: "Wire added B" },
    ]);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(listChanged() - before).toBe(1);
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining(["iris_wire_added_a", "iris_wire_added_b"]));
  });

  it("a removed name can be registered again and is served", async () => {
    const { server, client } = await boot();
    server.removeTools(["iris_wire_echo"]);
    server.addTools([echoTool]);
    const result = await client.callTool({ name: "iris_wire_echo", arguments: { name: "again" } });
    expect(result.isError).toBeFalsy();
    expect(echoCalls).toEqual([{ name: "again" }]);
  });
});

describe("the audit trail (DW-579, AD-19)", () => {
  /** Start with auditing on and parameters logged, and return the file the entries land in. */
  async function bootAudited(): Promise<{ booted: Booted; file: string }> {
    const file = join(workDir, "audit.jsonl");
    process.env.IRIS_AUDIT_LOG = file;
    process.env.IRIS_AUDIT_LOG_PARAMS = "true";
    process.env.IRIS_TOOLS_DISABLE = "iris_wire_hidden";
    return { booted: await boot(), file };
  }

  /** The tool-call entries of the audit file (its `sessionStart` line is skipped), once it holds `count` of them. */
  async function toolEntries(file: string, count: number): Promise<Array<Record<string, unknown>>> {
    const lines = await auditLines(file, count + 1);
    return lines.filter((line) => typeof line.tool === "string");
  }

  it("a schema-invalid call writes exactly one entry: outcome error, the raw key names, no params; unknown and hidden tools write none", async () => {
    const { booted, file } = await bootAudited();
    const { client } = booted;
    await client.callTool({ name: "no_such_tool", arguments: {} });
    await client.callTool({ name: "iris_wire_hidden", arguments: { name: "x" } });
    const invalid = await client.callTool({
      name: "iris_wire_refined",
      arguments: { server: "default", namespace: "NS1", action: "start", name: 777 },
    });
    expect(invalid.isError).toBe(true);
    await client.callTool({ name: "iris_wire_echo", arguments: { name: "doc" } });

    const lines = await toolEntries(file, 2);
    expect(lines).toHaveLength(2);
    const [entry, valid] = lines as [Record<string, unknown>, Record<string, unknown>];
    expect(entry).toMatchObject({
      tool: "iris_wire_refined",
      action: "start",
      profile: "default",
      namespace: "NS1",
      outcome: "error",
      error: textOf(invalid),
    });
    expect([...(entry.paramKeys as string[])].sort()).toEqual(["action", "name", "namespace"]);
    expect(Object.prototype.hasOwnProperty.call(entry, "params")).toBe(false);
    expect(JSON.stringify(entry)).not.toContain("777");

    expect(valid).toMatchObject({ tool: "iris_wire_echo", outcome: "ok", profile: "default", namespace: "HSCUSTOM", paramKeys: ["name"], params: { name: "doc" } });
  });

  it("a call with arguments omitted entirely writes the same single entry, with no key names", async () => {
    const { booted, file } = await bootAudited();
    const result = await booted.client.callTool({ name: "iris_wire_echo" });
    expect(result.isError).toBe(true);
    const lines = await toolEntries(file, 1);
    expect(lines).toHaveLength(1);
    const [entry] = lines as [Record<string, unknown>];
    expect(entry).toMatchObject({
      tool: "iris_wire_echo",
      action: null,
      profile: "default",
      namespace: "HSCUSTOM",
      outcome: "error",
      error: textOf(result),
      paramKeys: [],
    });
    expect(Object.prototype.hasOwnProperty.call(entry, "params")).toBe(false);
  });

  it("a non-string server, namespace or action falls back to default, the profile's namespace and null", async () => {
    const { booted, file } = await bootAudited();
    await booted.client.callTool({
      name: "iris_wire_refined",
      arguments: { server: 1, namespace: 2, action: 3, name: "x" },
    });
    const [entry] = await toolEntries(file, 1);
    expect(entry).toMatchObject({ tool: "iris_wire_refined", action: null, profile: "default", namespace: "HSCUSTOM", outcome: "error" });
    expect([...((entry as Record<string, unknown>).paramKeys as string[])].sort()).toEqual(["action", "name", "namespace"]);
  });

  it("an action outside the enum is not recorded", async () => {
    const { booted, file } = await bootAudited();
    await booted.client.callTool({ name: "iris_wire_refined", arguments: { action: "bogus-value" } });
    const [entry] = await toolEntries(file, 1);
    expect((entry as Record<string, unknown>).action).toBeNull();
    expect(JSON.stringify(entry)).not.toContain("bogus-value");
  });
});
