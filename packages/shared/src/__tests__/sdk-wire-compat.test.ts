/**
 * Story 43.1 (AD-3, AD-15, AD-19, AD-32; project rules #19, #36, #46) - the 2025-11-25 wire that the framework owns on top of the
 * MCP SDK v2: `tools/list`, `tools/call`, `prompts/get` and `resources/read`.
 * Story 43.2 (AD-3, AD-15, AD-32; Rules #10, #19) - the same server also serves revision 2026-07-28 through `serveStdio`: the
 * instance factory, the probe-discard path, the era line, `stop()` and the re-entry guard.
 *
 * A fixture `McpServerBase` is started through its real `start()` with the stdio transport replaced by one half of an in-memory
 * pair, and a real SDK v2 `Client` (legacy negotiation, or the pinned modern one) is connected to the other half. Every row of the
 * story's I/O matrix that can run without an IRIS instance is driven from the client; the raw key order of a `tools/list` entry, and
 * the in-process callback a unit test reaches through `_registeredTools`, are read off the registered request handlers. The expected
 * texts are the v1 texts that `story-43-1-sdk-wire-golden.test.ts` pins on the five built servers. The `serveStdio` rows that need
 * raw frames are sent through the client half of the pair.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/client";
import type { VersionNegotiationOptions } from "@modelcontextprotocol/client";

// The server connects to this half of an in-memory pair instead of the process's stdio.
const linked = vi.hoisted(() => ({ clientHalf: undefined as unknown }));
vi.mock("@modelcontextprotocol/server/stdio", async (importOriginal) => {
  const original = await importOriginal<typeof import("@modelcontextprotocol/server/stdio")>();
  const { InMemoryTransport } = await import("@modelcontextprotocol/server");
  class FakeStdioServerTransport {
    constructor() {
      const [clientHalf, serverHalf] = InMemoryTransport.createLinkedPair();
      linked.clientHalf = clientHalf;
      return serverHalf as unknown as FakeStdioServerTransport;
    }
  }
  return { ...original, StdioServerTransport: FakeStdioServerTransport };
});

import { McpServerBase, withServerParam } from "../server-base.js";
import type { McpServerBaseOptions } from "../server-base.js";
import type { IrisConnectionConfig } from "../config.js";
import { logger } from "../logger.js";
import type { PromptDefinition, ToolDefinition } from "../tool-types.js";
import { AuditLogger } from "../audit.js";
import { auditLines, callTool, stageDefaultStartup } from "./test-helpers.js";
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
  /** Resolves when the next `notifications/tools/list_changed` reaches the client. */
  nextListChanged: () => Promise<void>;
}

/** An answer to `elicitation/create`: what the person chose and, for an accept, what the form held. */
interface ElicitationAnswer {
  [member: string]: unknown;
  action: "accept" | "decline" | "cancel";
  content?: Record<string, string | number | boolean | string[]>;
}

/** How a booted client answers `elicitation/create`, and what it declares. */
interface ClientOptions {
  capabilities?: Record<string, unknown>;
  onElicitation?: (params: Record<string, unknown>) => ElicitationAnswer;
}

/**
 * Start a fixture server through its real `start()` and connect a v2 client to it over the in-memory pair. The client
 * negotiates `versionNegotiation`, which is the plain 2025 handshake unless a row asks for another mode. `clientOptions`
 * adds the capabilities the client declares and, when it declares `elicitation`, the handler that answers the server's dialog.
 */
async function boot(
  options: Partial<McpServerBaseOptions> = {},
  versionNegotiation: VersionNegotiationOptions = { mode: "legacy" },
  clientOptions: ClientOptions = {},
): Promise<Booted> {
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
  const client = new Client(
    { name: "wire-compat-client", version: "0.0.0" },
    { versionNegotiation, ...(clientOptions.capabilities !== undefined ? { capabilities: clientOptions.capabilities } : {}) },
  );
  let changes = 0;
  const waiters: Array<() => void> = [];
  client.setNotificationHandler("notifications/tools/list_changed", () => {
    changes += 1;
    for (const resolve of waiters.splice(0)) resolve();
  });
  if (clientOptions.capabilities?.["elicitation"] !== undefined) {
    const answer = clientOptions.onElicitation ?? (() => ({ action: "cancel" as const }));
    client.setRequestHandler("elicitation/create", (request) => answer(request.params as Record<string, unknown>));
  }
  await client.connect(linked.clientHalf as Parameters<Client["connect"]>[0]);
  opened.push({ server, client });
  return {
    server,
    client,
    listChanged: () => changes,
    nextListChanged: () => new Promise<void>((resolve) => waiters.push(resolve)),
  };
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

describe("tools/call: a result that carries isError and structuredContent keeps every member", () => {
  // The owned tools/call hands back every member of such a result with its value. This row reads the handler's result in-process,
  // so it pins members and values, not their order; the order on the wire is the SDK's result schema order (content,
  // structuredContent, isError), the same as on the SDK v1 wire, and story-43-1-qa-handler-golden.test.ts pins those bytes
  // against the v1 capture.
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
    const { server, client, listChanged, nextListChanged } = await boot();
    const before = listChanged();
    const notified = nextListChanged();
    server.removeTools(["iris_wire_echo", "iris_wire_structured"]);
    await notified;
    await client.listTools();
    expect(listChanged() - before).toBe(1);
    expect((await client.listTools()).tools.map((tool) => tool.name)).not.toContain("iris_wire_echo");
    const gone = await client.callTool({ name: "iris_wire_echo", arguments: { name: "x" } });
    expect(textOf(gone)).toBe("MCP error -32602: Tool iris_wire_echo not found");
  });

  it("a call that removes nothing sends nothing", async () => {
    const { server, client, listChanged } = await boot();
    const before = listChanged();
    server.removeTools(["nonexistent"]);
    await client.listTools();
    expect(listChanged() - before).toBe(0);
  });

  it("one call that adds tools sends exactly one list_changed, however many it adds", async () => {
    const { server, client, listChanged, nextListChanged } = await boot({ tools: [echoTool] });
    const before = listChanged();
    const notified = nextListChanged();
    server.addTools([
      { ...echoTool, name: "iris_wire_added_a", title: "Wire added A" },
      { ...echoTool, name: "iris_wire_added_b", title: "Wire added B" },
    ]);
    await notified;
    await client.listTools();
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
    // The session id, the timestamp, the sequence number and the duration are generated, and any of them can hold the digits 777.
    const generated = ["session", "ts", "seq", "durationMs"];
    const content = Object.fromEntries(Object.entries(entry).filter(([key]) => !generated.includes(key)));
    expect(JSON.stringify(content)).not.toContain("777");

    expect(valid).toMatchObject({ tool: "iris_wire_echo", outcome: "ok", profile: "default", namespace: "HSCUSTOM", paramKeys: ["name"], params: { name: "doc" } });
  });

  it("a call with arguments omitted entirely writes the same single entry, with no key names", async () => {
    const { booted, file } = await bootAudited();
    const result = await booted.client.callTool({ name: "iris_wire_echo" });
    expect(result.isError).toBe(true);
    // A valid call after it marks the end: its entry is the second, so a second entry for the omitted call would be seen.
    await booted.client.callTool({ name: "iris_wire_echo", arguments: { name: "marker" } });
    const lines = await toolEntries(file, 2);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatchObject({ tool: "iris_wire_echo", outcome: "ok", params: { name: "marker" } });
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

describe("Story 43.2: both eras over serveStdio", () => {
  const MODERN_ERA = "2026-07-28";
  const ENVELOPE = {
    "io.modelcontextprotocol/protocolVersion": MODERN_ERA,
    "io.modelcontextprotocol/clientCapabilities": {},
    "io.modelcontextprotocol/clientInfo": { name: "raw-client", version: "0.0.0" },
  };
  const MODERN_ERA_LINE = "Serving MCP protocol revision 2026-07-28 (server/discover)";
  const LEGACY_ERA_LINE = "Serving the 2025-era MCP handshake (initialize)";

  /** The client half of the in-memory pair, as the raw rows use it. */
  interface ClientHalf {
    onmessage?: (message: Record<string, unknown>) => void;
    start: () => Promise<void>;
    send: (message: Record<string, unknown>) => Promise<void>;
    close: () => Promise<void>;
  }

  /** What a raw session answered: the `result`, or the `error`. */
  interface RawAnswer {
    result?: Record<string, unknown>;
    error?: { code: number; message: string };
  }

  const halves: ClientHalf[] = [];
  const servers: McpServerBase[] = [];
  let infoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    infoSpy = vi.spyOn(logger, "info");
  });

  afterEach(async () => {
    for (const half of halves.splice(0)) await half.close().catch(() => {});
    for (const server of servers.splice(0)) await server.stop().catch(() => {});
    infoSpy.mockRestore();
  });

  /** The era lines written so far, in order. */
  const eraLines = (): string[] =>
    infoSpy.mock.calls.map((call) => String(call[0])).filter((line) => line === MODERN_ERA_LINE || line === LEGACY_ERA_LINE);

  /** Start a fixture server through `start()` and return it with a raw JSON-RPC session on the client half of its pair. */
  async function startRaw(
    extraTools: ToolDefinition[] = [],
  ): Promise<{ server: McpServerBase; request: (method: string, params?: Record<string, unknown>) => Promise<RawAnswer>; notify: (method: string) => Promise<void> }> {
    stageDefaultStartup(env.fetchMock);
    const server = new McpServerBase({
      name: "wire-compat",
      version: "1.0.0",
      config: makeConfig(),
      tools: [echoTool, refinedTool, writeTool, hiddenTool, structuredTool, ...extraTools],
      prompts: PROMPTS,
    });
    servers.push(server);
    await server.start("stdio");
    const half = linked.clientHalf as ClientHalf;
    halves.push(half);
    const waiting = new Map<number, (answer: RawAnswer) => void>();
    half.onmessage = (message) => {
      if (typeof message.id === "number" && message.method === undefined) waiting.get(message.id)?.(message as RawAnswer);
    };
    await half.start();
    let nextId = 1;
    return {
      server,
      request: (method, params = {}) =>
        new Promise((resolve) => {
          const id = nextId++;
          waiting.set(id, resolve);
          void half.send({ jsonrpc: "2.0", id, method, params });
        }),
      notify: (method) => half.send({ jsonrpc: "2.0", method }),
    };
  }

  const initializeParams = (protocolVersion: string): Record<string, unknown> => ({
    protocolVersion,
    capabilities: {},
    clientInfo: { name: "raw-client", version: "0.0.0" },
  });

  /** What the current instance of a server has registered on the SDK. */
  function registered(server: McpServerBase): Record<string, string[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sdk = server.server as any;
    return {
      tools: Object.keys(sdk._registeredTools),
      prompts: Object.keys(sdk._registeredPrompts),
      resources: Object.keys(sdk._registeredResources),
      templates: Object.keys(sdk._registeredResourceTemplates),
    };
  }

  /** A `tools/list` entry without the member the 2026-07-28 revision removes. */
  const withoutExecution = (tools: Array<Record<string, unknown>>): Array<Record<string, unknown>> =>
    tools.map((tool) => {
      const copy = { ...tool };
      delete copy.execution;
      return copy;
    });

  it("a client pinned to 2026-07-28 negotiates the modern era, and lists the legacy tools without the mandated field", async () => {
    const legacy = await boot();
    const modern = await boot({}, { mode: { pin: MODERN_ERA } });
    expect(legacy.client.getProtocolEra()).toBe("legacy");
    expect(modern.client.getProtocolEra()).toBe("modern");
    expect(modern.client.getNegotiatedProtocolVersion()).toBe(MODERN_ERA);
    const legacyTools = (await legacy.client.listTools()).tools as unknown as Array<Record<string, unknown>>;
    const modernTools = (await modern.client.listTools()).tools as unknown as Array<Record<string, unknown>>;
    expect(legacyTools.every((tool) => tool.execution !== undefined)).toBe(true);
    expect(modernTools.every((tool) => tool.execution === undefined)).toBe(true);
    expect(modernTools).toEqual(withoutExecution(legacyTools));
  });

  it("a modern call is denied, refused and served exactly as on the 2025 era, and the handler sees the same arguments", async () => {
    const legacy = await boot();
    const modern = await boot({}, { mode: { pin: MODERN_ERA } });
    for (const { client } of [legacy, modern]) {
      const denied = await client.callTool({ name: "iris_wire_write", arguments: { value: "x" } });
      expect(denied.isError).toBe(true);
      expect(denied.structuredContent).toEqual({ code: "GOVERNANCE_DISABLED", action: "iris_wire_write", server: "default" });
    }
    const invalidLegacy = await legacy.client.callTool({ name: "iris_wire_echo", arguments: { name: 12345 } });
    const invalidModern = await modern.client.callTool({ name: "iris_wire_echo", arguments: { name: 12345 } });
    expect(invalidModern.isError).toBe(true);
    expect(textOf(invalidModern)).toBe(textOf(invalidLegacy));
    expect(echoCalls).toEqual([]);
    const ok = await modern.client.callTool({ name: "iris_wire_echo", arguments: { name: "doc", server: "default", stray: 1 } });
    expect(ok.isError).toBeFalsy();
    expect(echoCalls).toEqual([{ name: "doc" }]);
  });

  it("a server/discover opening is answered by the instance built at construction, and one factory call serves the modern era", async () => {
    const { server, request } = await startRaw();
    const built = server.server;
    const discovered = await request("server/discover", { _meta: ENVELOPE });
    expect(discovered.error).toBeUndefined();
    expect(discovered.result?.supportedVersions).toEqual([MODERN_ERA]);
    expect(discovered.result?.resultType).toBe("complete");
    expect(server.server).toBe(built);
    expect(eraLines()).toEqual([MODERN_ERA_LINE]);
  });

  it("a server/discover probe followed by an initialize makes two factory calls, and the second instance is complete and serves the 2025 era", async () => {
    const { server, request, notify } = await startRaw();
    const built = server.server;
    const listBefore = await callRequest(server, "tools/list", {});
    const registeredBefore = registered(server);

    await request("server/discover", { _meta: ENVELOPE });
    const initialized = await request("initialize", initializeParams("2025-11-25"));
    expect(initialized.result?.protocolVersion).toBe("2025-11-25");
    await notify("notifications/initialized");

    expect(eraLines()).toEqual([MODERN_ERA_LINE, LEGACY_ERA_LINE]);
    expect(server.server).not.toBe(built);
    expect(registered(server)).toEqual(registeredBefore);
    expect(await callRequest(server, "tools/list", {})).toEqual(listBefore);
    const served = await request("tools/list");
    expect((served.result?.tools as unknown[]).length).toBe((listBefore.tools as unknown[]).length);
    expect(served.result?.resultType).toBeUndefined();
    const prompt = await request("prompts/get", { name: "wire-none" });
    expect(prompt.error).toBeUndefined();
    expect(prompt.result?.messages).toEqual([{ role: "user", content: { type: "text", text: "none" } }]);
  });

  it("a probe followed by an initialize that asks for 2026-07-28 without the envelope is answered with 2025-11-25", async () => {
    const { request } = await startRaw();
    await request("server/discover", { _meta: ENVELOPE });
    const initialized = await request("initialize", initializeParams(MODERN_ERA));
    expect(initialized.result?.protocolVersion).toBe("2025-11-25");
    expect(eraLines()).toEqual([MODERN_ERA_LINE, LEGACY_ERA_LINE]);
  });

  it("tools added or removed after the probe is discarded reach the instance that serves", async () => {
    const { server, request, notify } = await startRaw();
    await request("server/discover", { _meta: ENVELOPE });
    await request("initialize", initializeParams("2025-11-25"));
    await notify("notifications/initialized");
    server.removeTools(["iris_wire_echo"]);
    server.addTools([{ ...echoTool, name: "iris_wire_added", title: "Wire added" }]);
    const names = registered(server).tools;
    expect(names).not.toContain("iris_wire_echo");
    expect(names).toContain("iris_wire_added");
    const listed = await request("tools/list");
    const listedNames = (listed.result?.tools as Array<{ name: string }>).map((tool) => tool.name);
    expect(listedNames).not.toContain("iris_wire_echo");
    expect(listedNames).toContain("iris_wire_added");
  });

  it("a 2025 client and a modern client each cause one factory call, with one era line", async () => {
    await boot();
    expect(eraLines()).toEqual([LEGACY_ERA_LINE]);
    infoSpy.mockClear();
    await boot({}, { mode: { pin: MODERN_ERA } });
    expect(eraLines()).toEqual([MODERN_ERA_LINE]);
  });

  it("the instance built at construction is the one that serves a connected client", async () => {
    stageDefaultStartup(env.fetchMock);
    const server = new McpServerBase({ name: "wire-compat", version: "1.0.0", config: makeConfig(), tools: [echoTool], prompts: PROMPTS });
    const built = server.server;
    await server.start("stdio");
    const client = new Client({ name: "wire-compat-client", version: "0.0.0" }, { versionNegotiation: { mode: "legacy" } });
    await client.connect(linked.clientHalf as Parameters<Client["connect"]>[0]);
    opened.push({ server, client });
    expect(server.server).toBe(built);
    expect(built.isConnected()).toBe(true);
  });

  it("stop() closes the serving handle: the instance and the transport", async () => {
    const { server, client } = await boot();
    expect(server.server.isConnected()).toBe(true);
    await server.stop();
    expect(server.server.isConnected()).toBe(false);
    await expect(client.listTools()).rejects.toThrow();
  });

  it("stop() on a server that was never started does not throw, and closes the instance built at construction", async () => {
    const idle = new McpServerBase({ name: "wire-compat", version: "1.0.0", config: makeConfig(), tools: [echoTool] });
    await expect(idle.stop()).resolves.toBeUndefined();

    const connected = new McpServerBase({ name: "wire-compat", version: "1.0.0", config: makeConfig(), tools: [echoTool] });
    const { InMemoryTransport } = await import("@modelcontextprotocol/server");
    const [, serverHalf] = InMemoryTransport.createLinkedPair();
    await connected.server.connect(serverHalf);
    expect(connected.server.isConnected()).toBe(true);
    await expect(connected.stop()).resolves.toBeUndefined();
    expect(connected.server.isConnected()).toBe(false);
  });

  it("stop() before any client message closes the transport the stdio entry opened", async () => {
    stageDefaultStartup(env.fetchMock);
    const server = new McpServerBase({ name: "wire-compat", version: "1.0.0", config: makeConfig(), tools: [echoTool] });
    servers.push(server);
    await server.start("stdio");
    const half = linked.clientHalf as ClientHalf & { onclose?: () => void };
    halves.push(half);
    let transportClosed = false;
    half.onclose = () => {
      transportClosed = true;
    };
    await half.start();
    expect(transportClosed).toBe(false);
    await server.stop();
    expect(transportClosed).toBe(true);
  });

  it("a repeated tool name throws the SDK's text from the constructor and from addTools, and addTools leaves the tools as they were", () => {
    expect(() => new McpServerBase({ name: "wire-compat", version: "1.0.0", config: makeConfig(), tools: [echoTool, echoTool] })).toThrow(
      "Tool iris_wire_echo is already registered",
    );
    const server = new McpServerBase({ name: "wire-compat", version: "1.0.0", config: makeConfig(), tools: [echoTool] });
    const before = registered(server).tools;
    expect(before).toContain("iris_wire_echo");
    expect(() => server.addTools([echoTool])).toThrow("Tool iris_wire_echo is already registered");
    expect(registered(server).tools).toEqual(before);
  });

  it("a second start() while serving throws an error naming the re-entry, before it contacts IRIS or attaches anything", async () => {
    const { server } = await boot();
    const half = linked.clientHalf;
    const requests = env.fetchMock.mock.calls.length;
    await expect(server.start("stdio")).rejects.toThrow(/re-entry/);
    expect(linked.clientHalf).toBe(half);
    expect(env.fetchMock.mock.calls.length).toBe(requests);
  });

  it("start() serves again after stop()", async () => {
    const { server } = await boot();
    await server.stop();
    stageDefaultStartup(env.fetchMock);
    await server.start("stdio");
    const client = new Client({ name: "wire-compat-client", version: "0.0.0" }, { versionNegotiation: { mode: "legacy" } });
    await client.connect(linked.clientHalf as Parameters<Client["connect"]>[0]);
    opened.push({ server, client });
    expect((await client.listTools()).tools.map((tool) => tool.name)).toContain("iris_wire_echo");
    expect(registered(server).tools).toContain("iris_wire_echo");
  });

  describe("Story 43.3: confirmation through elicitation", () => {
    type Era = "legacy" | "modern";
    type Answer = ElicitationAnswer;
    const ERAS: Array<[Era, VersionNegotiationOptions]> = [
      ["legacy", { mode: "legacy" }],
      ["modern", { mode: { pin: MODERN_ERA } }],
    ];
    const FORM = { elicitation: { form: {} } };
    const ASKING_ENVELOPE = { ...ENVELOPE, "io.modelcontextprotocol/clientCapabilities": FORM };
    const SCHEMA = {
      type: "object",
      properties: { confirm: { type: "boolean", title: "Confirm", description: "Tick to confirm this change.", default: false } },
      required: ["confirm"],
    };
    const TICKED: Answer = { action: "accept", content: { confirm: true } };
    const CANCELLED_TEXT =
      "Cancelled by the client before a result was sent. An IRIS request still in flight was aborted; a write IRIS had already received may still have completed.";
    const message = (value: string): string =>
      `Confirm: write a value.\nTarget: value ${value}\nScope: one write\nServer: default (localhost:52773)\n` +
      "Tick Confirm and accept to run it now. Decline or cancel to change nothing.";

    /** The values the handler of `iris_wire_confirm` wrote, whether the context it saw had `confirm`, and the dialogs the client was asked. */
    const executions: string[] = [];
    const sawConfirm: boolean[] = [];
    const asked: Array<Record<string, unknown>> = [];

    /** A write that asks the person right before it writes, the way a gate does. */
    const confirmTool: ToolDefinition = {
      name: "iris_wire_confirm",
      title: "Wire confirm",
      description: "A write that asks the person before it runs.",
      inputSchema: z.object({ value: z.string(), also: z.string().optional() }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
      scope: "NS",
      mutates: "write",
      handler: async (args, ctx) => {
        const { value } = args as { value: string };
        sawConfirm.push(ctx.confirm !== undefined);
        const outcome = await ctx.confirm?.({ operation: "write a value", target: `value ${value}`, scope: "one write" });
        if (outcome !== undefined && !outcome.proceed) return outcome.result;
        executions.push(value);
        return { content: [{ type: "text" as const, text: `wrote ${value}` }] };
      },
    };

    /** A second write with the same inputs and handler, to prove a state is bound to the tool it was minted for. */
    const confirmToolB: ToolDefinition = { ...confirmTool, name: "iris_wire_confirm_b", title: "Wire confirm B" };

    /** A tool that makes one request to IRIS through the context's client. */
    const reachTool: ToolDefinition = {
      name: "iris_wire_reach",
      title: "Wire reach",
      description: "Make one request to IRIS.",
      inputSchema: z.object({ name: z.string() }),
      annotations: READ_ANNOTATIONS,
      scope: "NS",
      mutates: "read",
      handler: async (args, ctx) => {
        await ctx.http.get(`/api/atelier/v8/HSCUSTOM/doc/${(args as { name: string }).name}`);
        return { content: [{ type: "text" as const, text: "reached" }] };
      },
    };

    /** A tool that makes one request to IRIS through a client it asked the context for by profile name, as a promotion does. */
    const reachProfileTool: ToolDefinition = {
      ...reachTool,
      name: "iris_wire_reach_profile",
      title: "Wire reach profile",
      handler: async (args, ctx) => {
        const client = await ctx.resolveProfileClient("default");
        await client.get(`/api/atelier/v8/HSCUSTOM/doc/${(args as { name: string }).name}`);
        return { content: [{ type: "text" as const, text: "reached" }] };
      },
    };

    beforeEach(() => {
      executions.length = 0;
      sawConfirm.length = 0;
      asked.length = 0;
    });

    /** Enable the write, which is disabled by default. */
    function governed(): void {
      process.env.IRIS_GOVERNANCE = JSON.stringify({ global: { iris_wire_confirm: true, iris_wire_confirm_b: true } });
    }

    /** Turn auditing on with parameters, and return the file the entries land in. */
    function auditOn(): string {
      const file = join(workDir, "audit.jsonl");
      process.env.IRIS_AUDIT_LOG = file;
      process.env.IRIS_AUDIT_LOG_PARAMS = "true";
      return file;
    }

    /** The entries of the file once the entry of a marker call is in it: the marker call is last, so nothing earlier is still queued. */
    async function entriesAfterMarker(call: (name: string, args: Record<string, unknown>) => Promise<unknown>, file: string): Promise<Array<Record<string, unknown>>> {
      await call("iris_wire_echo", { name: "marker" });
      const deadline = Date.now() + 3000;
      for (;;) {
        const entries = existsSync(file)
          ? readFileSync(file, "utf-8")
              .split("\n")
              .filter((line) => line.trim().length > 0)
              .map((line) => JSON.parse(line) as Record<string, unknown>)
              .filter((entry) => typeof entry.tool === "string")
          : [];
        const marker = entries.findIndex((entry) => entry.tool === "iris_wire_echo");
        if (marker >= 0) return entries.slice(0, marker);
        if (Date.now() > deadline) throw new Error("the marker entry never reached the audit file");
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }

    describe.each(ERAS)("on the %s era", (_era, negotiation) => {
      /** A server with the write enabled, auditing on, and a client that declares form elicitation and answers with `answer`. */
      async function asking(answer: Answer, capabilities: Record<string, unknown> = FORM): Promise<{ booted: Booted; file: string; call: (name: string, args: Record<string, unknown>) => Promise<Record<string, unknown>> }> {
        governed();
        const file = auditOn();
        const booted = await boot({ tools: [confirmTool, echoTool] }, negotiation, {
          capabilities,
          onElicitation: (params) => {
            asked.push(params);
            return answer;
          },
        });
        return { booted, file, call: (name, args) => booted.client.callTool({ name, arguments: args }) as Promise<Record<string, unknown>> };
      }

      it("accept: asks once with the template and the form, runs once, and writes one entry that says accepted", async () => {
        const { file, call } = await asking(TICKED);

        const result = await call("iris_wire_confirm", { value: "a" });

        expect(textOf(result)).toBe("wrote a");
        expect(result.isError).toBeFalsy();
        expect(executions).toEqual(["a"]);
        expect(asked).toHaveLength(1);
        expect(asked[0]).toMatchObject({ mode: "form", message: message("a"), requestedSchema: SCHEMA });
        expect(asked[0]?.requestedSchema).toStrictEqual(SCHEMA);
        const entries = await entriesAfterMarker(call, file);
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({
          tool: "iris_wire_confirm",
          action: null,
          profile: "default",
          outcome: "ok",
          paramKeys: ["value"],
          params: { value: "a" },
          confirmation: "accepted",
        });
        expect(entries[0]?.denyReason).toBeUndefined();
      });

      it.each([
        ["decline", { action: "decline" } as Answer, "declined", "The person declined the confirmation for: write a value. Nothing was changed. Do not repeat this call unless the person asks for it again."],
        ["cancel", { action: "cancel" } as Answer, "cancelled", "The person dismissed the confirmation dialog for: write a value. Nothing was changed. Do not repeat this call unless the person asks for it again."],
        ["unconfirmed", { action: "accept", content: { confirm: false } } as Answer, "unconfirmed", "The person accepted the confirmation dialog for: write a value without ticking Confirm. Nothing was changed. Do not repeat this call unless the person asks for it again."],
        ["an accept with no content", { action: "accept" } as Answer, "unconfirmed", "The person accepted the confirmation dialog for: write a value without ticking Confirm. Nothing was changed. Do not repeat this call unless the person asks for it again."],
      ])("%s: ends the call with CONFIRMATION_DECLINED, never asks again, and writes one denied entry", async (label, answer, recorded, text) => {
        const { file, call } = await asking(answer);

        const result = await call("iris_wire_confirm", { value: "a" });

        expect(result.isError).toBe(true);
        expect(textOf(result)).toBe(text);
        expect(result.structuredContent).toEqual({
          code: "CONFIRMATION_DECLINED",
          action: "iris_wire_confirm",
          response: label === "decline" || label === "cancel" ? label : "unconfirmed",
        });
        expect(executions).toEqual([]);
        expect(asked).toHaveLength(1);
        const entries = await entriesAfterMarker(call, file);
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({ tool: "iris_wire_confirm", outcome: "denied", denyReason: "CONFIRMATION_DECLINED", confirmation: recorded });
        expect(entries[0]?.error).toBeUndefined();
      });

      it("fallback: a client that declares no capability is never asked, and the call runs as it always did", async () => {
        const { file, call } = await asking(TICKED, {});
        const result = await call("iris_wire_confirm", { value: "a" });
        expect(textOf(result)).toBe("wrote a");
        expect(asked).toEqual([]);
        expect(executions).toEqual(["a"]);
        const entries = await entriesAfterMarker(call, file);
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({ outcome: "ok" });
        expect(Object.prototype.hasOwnProperty.call(entries[0], "confirmation")).toBe(false);
      });

      it("fallback: a client that declares url elicitation alone is never asked", async () => {
        const { call } = await asking(TICKED, { elicitation: { url: {} } });
        const result = await call("iris_wire_confirm", { value: "a" });
        expect(textOf(result)).toBe("wrote a");
        expect(asked).toEqual([]);
      });

      it("fallback: a client that declares a bare elicitation is asked, as the SDK counts it as form", async () => {
        const { call } = await asking(TICKED, { elicitation: {} });
        const result = await call("iris_wire_confirm", { value: "a" });
        expect(textOf(result)).toBe("wrote a");
        expect(asked).toHaveLength(1);
      });

      it("governance first: a disabled write is refused before any dialog, and is audited denied with no confirmation", async () => {
        const file = auditOn();
        const { client } = await boot({ tools: [confirmTool, echoTool] }, negotiation, {
          capabilities: FORM,
          onElicitation: (params) => {
            asked.push(params);
            return TICKED;
          },
        });
        const call = (name: string, args: Record<string, unknown>): Promise<unknown> => client.callTool({ name, arguments: args });

        const result = await client.callTool({ name: "iris_wire_confirm", arguments: { value: "a" } });

        expect(result.structuredContent).toEqual({ code: "GOVERNANCE_DISABLED", action: "iris_wire_confirm", server: "default" });
        expect(asked).toEqual([]);
        expect(executions).toEqual([]);
        const entries = await entriesAfterMarker(call, file);
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({ outcome: "denied", denyReason: "GOVERNANCE_DISABLED" });
        expect(Object.prototype.hasOwnProperty.call(entries[0], "confirmation")).toBe(false);
      });

      it("the in-process callback gets no confirm and writes as it always did", async () => {
        governed();
        const { server } = await boot({ tools: [confirmTool] }, negotiation, { capabilities: FORM, onElicitation: () => TICKED });
        const result = await callTool(server, "iris_wire_confirm", { value: "a" });
        expect(textOf(result)).toBe("wrote a");
        expect(sawConfirm).toEqual([false]);
        expect(executions).toEqual(["a"]);
      });
    });

    describe("a request context that lacks pieces", () => {
      /** The owned `tools/call` handler, called with a hand-made context. */
      async function callWith(server: McpServerBase, params: unknown, ctx: unknown): Promise<{ content: Array<{ text: string }>; isError?: boolean }> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const handler = (server.server.server as any)._requestHandlers.get("tools/call") as (request: unknown, ctx: unknown) => Promise<unknown>;
        return (await handler({ method: "tools/call", params }, ctx)) as { content: Array<{ text: string }>; isError?: boolean };
      }

      it.each([
        // The 2025 era reads what the client declared at `initialize`, so a context without an envelope still asks.
        ["legacy", { mode: "legacy" } as VersionNegotiationOptions, 1],
        // The 2026-07-28 era reads the request's envelope, which a stub context lacks, so there is no dialog.
        ["modern", { mode: { pin: MODERN_ERA } } as VersionNegotiationOptions, 0],
      ])("%s: a stub context with no signal and no envelope neither throws nor binds anything", async (_era, negotiation, dialogs) => {
        governed();
        const { server } = await boot({ tools: [confirmTool, reachTool] }, negotiation, {
          capabilities: FORM,
          onElicitation: (params) => {
            asked.push(params);
            return TICKED;
          },
        });

        const result = await callWith(server, { name: "iris_wire_confirm", arguments: { value: "a" } }, { mcpReq: { requestState: () => undefined } });

        expect(result.content[0]?.text).toBe("wrote a");
        expect(executions).toEqual(["a"]);
        expect(asked).toHaveLength(dialogs);
      });

      it.each(ERAS)("%s: a signal that is already aborted reaches no fetch, and the call is audited error with the cancelled text", async (_era, negotiation) => {
        const file = auditOn();
        const { server, client } = await boot({ tools: [reachTool, echoTool] }, negotiation);
        const aborted = new AbortController();
        aborted.abort();
        const before = env.fetchMock.mock.calls.length;

        const result = await callWith(
          server,
          { name: "iris_wire_reach", arguments: { name: "A.cls" } },
          { signal: aborted.signal, mcpReq: { requestState: () => undefined, signal: aborted.signal } },
        );

        expect(env.fetchMock.mock.calls.length).toBe(before);
        expect(result.isError).toBe(true);
        expect(result.content[0]?.text).toBe(
          "Tool error: Request GET /api/atelier/v8/HSCUSTOM/doc/A.cls was cancelled by the client. No answer is expected for a cancelled call.",
        );
        const entries = await entriesAfterMarker((name, args) => client.callTool({ name, arguments: args }), file);
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({ tool: "iris_wire_reach", outcome: "error", error: CANCELLED_TEXT });
      });

      it.each(ERAS)("%s: a client asked for by profile name carries the signal too: an aborted one reaches no fetch", async (_era, negotiation) => {
        const file = auditOn();
        const { server, client } = await boot({ tools: [reachProfileTool, echoTool] }, negotiation);
        const aborted = new AbortController();
        aborted.abort();
        const before = env.fetchMock.mock.calls.length;

        const result = await callWith(
          server,
          { name: "iris_wire_reach_profile", arguments: { name: "A.cls" } },
          { signal: aborted.signal, mcpReq: { requestState: () => undefined, signal: aborted.signal } },
        );

        expect(env.fetchMock.mock.calls.length).toBe(before);
        expect(result.isError).toBe(true);
        expect(result.content[0]?.text).toBe(
          "Tool error: Request GET /api/atelier/v8/HSCUSTOM/doc/A.cls was cancelled by the client. No answer is expected for a cancelled call.",
        );
        const entries = await entriesAfterMarker((name, args) => client.callTool({ name, arguments: args }), file);
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({ tool: "iris_wire_reach_profile", outcome: "error", error: CANCELLED_TEXT });
      });

      it.each(ERAS)("%s: the same call through a client asked for by profile name, with a live signal, reaches IRIS", async (_era, negotiation) => {
        const { server } = await boot({ tools: [reachProfileTool] }, negotiation);
        env.fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ status: { errors: [] }, console: [], result: {} }), { status: 200 }));
        const before = env.fetchMock.mock.calls.length;
        const live = new AbortController();

        const result = await callWith(
          server,
          { name: "iris_wire_reach_profile", arguments: { name: "A.cls" } },
          { signal: live.signal, mcpReq: { requestState: () => undefined, signal: live.signal } },
        );

        expect(result.content[0]?.text).toBe("reached");
        expect(env.fetchMock.mock.calls.length).toBeGreaterThan(before);
      });

      it.each(ERAS)("%s: the same call with a live signal reaches IRIS", async (_era, negotiation) => {
        const { server } = await boot({ tools: [reachTool] }, negotiation);
        env.fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ status: { errors: [] }, console: [], result: {} }), { status: 200 }));
        const before = env.fetchMock.mock.calls.length;
        const live = new AbortController();

        const result = await callWith(
          server,
          { name: "iris_wire_reach", arguments: { name: "A.cls" } },
          { signal: live.signal, mcpReq: { requestState: () => undefined, signal: live.signal } },
        );

        expect(result.content[0]?.text).toBe("reached");
        expect(env.fetchMock.mock.calls.length).toBeGreaterThan(before);
      });

      it.each(ERAS)("%s: a call cancelled after IRIS answered, whose handler then succeeds, is still audited error with the cancelled text, never ok", async (_era, negotiation) => {
        const file = auditOn();
        const { server, client } = await boot({ tools: [reachTool, echoTool] }, negotiation);
        const live = new AbortController();
        // IRIS answers, and the cancel lands while the answer is on its way: the request has completed, so nothing aborts it.
        env.fetchMock.mockImplementationOnce(async () => {
          live.abort();
          return new Response(JSON.stringify({ status: { errors: [] }, console: [], result: {} }), { status: 200 });
        });

        const result = await callWith(
          server,
          { name: "iris_wire_reach", arguments: { name: "A.cls" } },
          { signal: live.signal, mcpReq: { requestState: () => undefined, signal: live.signal } },
        );

        expect(result.content[0]?.text, "the handler ran to its end").toBe("reached");
        const entries = await entriesAfterMarker((name, args) => client.callTool({ name, arguments: args }), file);
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({ tool: "iris_wire_reach", outcome: "error", error: CANCELLED_TEXT });
      });

      it.each(ERAS)("%s: a call cancelled before its dialog is shown is audited at once as the cancelled call, and leaves no pending ask", async (_era, negotiation) => {
        governed();
        auditOn();
        const log = vi.spyOn(AuditLogger.prototype, "log");
        const { server } = await boot({ tools: [confirmTool] }, negotiation, {
          capabilities: FORM,
          onElicitation: (params) => {
            asked.push(params);
            return TICKED;
          },
        });
        const aborted = new AbortController();
        aborted.abort();

        const result = await callWith(
          server,
          { name: "iris_wire_confirm", arguments: { value: "a" } },
          { signal: aborted.signal, mcpReq: { requestState: () => undefined, signal: aborted.signal, envelope: ASKING_ENVELOPE } },
        );

        expect(result).toStrictEqual({ content: [{ type: "text", text: CANCELLED_TEXT }], isError: true });
        expect(asked).toEqual([]);
        expect(executions).toEqual([]);
        const calls = (): Array<Record<string, unknown>> =>
          log.mock.calls.map((call) => call[0] as unknown as Record<string, unknown>).filter((entry) => entry.tool === "iris_wire_confirm");
        expect(calls()).toHaveLength(1);
        expect(calls()[0]).toMatchObject({ outcome: "error", error: CANCELLED_TEXT });
        expect(calls()[0]).not.toHaveProperty("confirmation");

        await server.stop();
        expect(calls(), "no unanswered entry follows at shutdown").toHaveLength(1);
      });
    });

    describe("on the modern era, over raw frames", () => {
      /** The first and later rounds of one `tools/call` of the write, with the retry members of the 2026-07-28 revision. */
      async function rawSession(): Promise<{
        server: McpServerBase;
        file: string;
        request: (method: string, params?: Record<string, unknown>) => Promise<RawAnswer>;
        round: (args: Record<string, unknown>, extra?: Record<string, unknown>, meta?: Record<string, unknown>) => Promise<RawAnswer>;
        marker: () => Promise<Array<Record<string, unknown>>>;
      }> {
        governed();
        const file = auditOn();
        const { server, request } = await startRaw([confirmTool, confirmToolB]);
        const discovered = await request("server/discover", { _meta: ENVELOPE });
        expect(discovered.error).toBeUndefined();
        const round = (args: Record<string, unknown>, extra: Record<string, unknown> = {}, meta: Record<string, unknown> = ASKING_ENVELOPE) =>
          request("tools/call", { name: "iris_wire_confirm", arguments: args, _meta: meta, ...extra });
        const marker = (): Promise<Array<Record<string, unknown>>> =>
          entriesAfterMarker(async (name, args) => {
            const answered = await request("tools/call", { name, arguments: args, _meta: ENVELOPE });
            expect(answered.error).toBeUndefined();
          }, file);
        return { server, file, request, round, marker };
      }

      const stateOf = (answer: RawAnswer): string => {
        expect(answer.result?.resultType).toBe("input_required");
        return answer.result?.requestState as string;
      };
      const accept = (state: string): Record<string, unknown> => ({ inputResponses: { confirm: TICKED }, requestState: state });

      it("the first round returns the question and a state, runs nothing, and writes no entry", async () => {
        const { round, marker } = await rawSession();

        const first = await round({ value: "a" });

        expect(first.error).toBeUndefined();
        expect(first.result?.resultType).toBe("input_required");
        const inputRequests = first.result?.inputRequests as Record<string, { method: string; params: Record<string, unknown> }>;
        expect(Object.keys(inputRequests)).toEqual(["confirm"]);
        expect(inputRequests.confirm?.method).toBe("elicitation/create");
        expect(inputRequests.confirm?.params).toStrictEqual({ mode: "form", message: message("a"), requestedSchema: SCHEMA });
        expect(typeof first.result?.requestState).toBe("string");
        expect(executions).toEqual([]);
        expect(await marker()).toEqual([]);
      });

      it("the retry with the state and an accept runs once and writes one entry", async () => {
        const { round, marker } = await rawSession();
        const state = stateOf(await round({ value: "a" }));

        const second = await round({ value: "a" }, accept(state));

        expect(second.result?.resultType).toBe("complete");
        expect((second.result?.content as Array<{ text: string }>)[0]?.text).toBe("wrote a");
        expect(executions).toEqual(["a"]);
        const entries = await marker();
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({ tool: "iris_wire_confirm", outcome: "ok", confirmation: "accepted" });
      });

      it("replay: a state that decided a call is asked again and never runs a second time", async () => {
        const { round, marker } = await rawSession();
        const state = stateOf(await round({ value: "a" }));
        await round({ value: "a" }, accept(state));

        const replay = await round({ value: "a" }, accept(state));

        expect(replay.error).toBeUndefined();
        expect(stateOf(replay)).not.toBe(state);
        expect(executions).toEqual(["a"]);
        expect(await marker()).toHaveLength(1);
      });

      it("replay: a state that decided a call is still refused in the last second of its life, past the 600 seconds since it was used", async () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        try {
          vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
          const { round } = await rawSession();
          const state = stateOf(await round({ value: "a" }));
          await round({ value: "a" }, accept(state));

          // The state counts its life in whole seconds, so it is still good 600.5 seconds after it was minted.
          vi.setSystemTime(new Date("2026-01-01T00:10:00.500Z"));
          const replay = await round({ value: "a" }, accept(state));

          expect(replay.error).toBeUndefined();
          expect(replay.result?.resultType).toBe("input_required");
        } finally {
          vi.useRealTimers();
        }
        expect(executions).toEqual(["a"]);
      });

      it("another server process never honors a state: the key is per process, so a state minted by one is asked again by the other", async () => {
        governed();
        const minting = await startRaw([confirmTool]);
        await minting.request("server/discover", { _meta: ENVELOPE });
        const other = await startRaw([confirmTool]);
        await other.request("server/discover", { _meta: ENVELOPE });
        const state = stateOf(await minting.request("tools/call", { name: "iris_wire_confirm", arguments: { value: "a" }, _meta: ASKING_ENVELOPE }));

        const elsewhere = await other.request("tools/call", {
          name: "iris_wire_confirm",
          arguments: { value: "a" },
          _meta: ASKING_ENVELOPE,
          ...accept(state),
        });

        expect(elsewhere.error).toBeUndefined();
        expect(stateOf(elsewhere)).not.toBe(state);
        expect(executions).toEqual([]);
      });

      it("tampered: a state with one character changed is asked again and never runs", async () => {
        const { round } = await rawSession();
        const state = stateOf(await round({ value: "a" }));
        const body = state.slice(0, state.lastIndexOf("."));
        const mac = state.slice(state.lastIndexOf(".") + 1);
        const flipped = (text: string, at: number): string => `${text.slice(0, at)}${text[at] === "A" ? "B" : "A"}${text.slice(at + 1)}`;

        for (const tampered of [flipped(state, 5), `${body}.${flipped(mac, 3)}`]) {
          const again = await round({ value: "a" }, accept(tampered));
          expect(again.error).toBeUndefined();
          expect(stateOf(again)).not.toBe(tampered);
        }
        expect(executions).toEqual([]);
      });

      it("forged: an accept with no state, a made-up state, or a well-formed payload under a wrong signature is asked and never runs", async () => {
        const { round } = await rawSession();
        const real = stateOf(await round({ value: "a" }));
        const body = JSON.parse(Buffer.from(real.split(".")[1] as string, "base64url").toString("utf8")) as { p: Record<string, unknown>; exp: number };
        const signedWrong = `v1.${Buffer.from(JSON.stringify({ p: { ...body.p, nonce: "forged-nonce" }, exp: body.exp })).toString("base64url")}.AAAA`;

        const withoutState = await round({ value: "a" }, { inputResponses: { confirm: TICKED } });
        const madeUp = await round({ value: "a" }, accept("v1.e30.AAAA"));
        const wrongSignature = await round({ value: "a" }, accept(signedWrong));
        const notEvenAString = await round({ value: "a" }, { inputResponses: { confirm: TICKED }, requestState: 7 });

        expect(withoutState.result?.resultType).toBe("input_required");
        expect(madeUp.result?.resultType).toBe("input_required");
        expect(wrongSignature.result?.resultType).toBe("input_required");
        expect(notEvenAString.error?.code).toBe(-32602);
        expect(executions).toEqual([]);
      });

      it("a state minted for other arguments is asked again for the new ones, with a new state", async () => {
        const { round } = await rawSession();
        const state = stateOf(await round({ value: "a" }));

        const changed = await round({ value: "b" }, accept(state));

        const newState = stateOf(changed);
        expect(newState).not.toBe(state);
        const asking = (changed.result?.inputRequests as Record<string, { params: { message: string } }>).confirm?.params.message;
        expect(asking).toBe(message("b"));
        expect(executions).toEqual([]);
        // The new state decides the new arguments, and the old one still cannot decide them.
        const decided = await round({ value: "b" }, accept(newState));
        expect((decided.result?.content as Array<{ text: string }>)[0]?.text).toBe("wrote b");
        expect(executions).toEqual(["b"]);
      });

      it("a state minted for one tool is not honored by another tool called with the same arguments", async () => {
        const { round, request } = await rawSession();
        const state = stateOf(await round({ value: "a" }));

        const other = await request("tools/call", {
          name: "iris_wire_confirm_b",
          arguments: { value: "a" },
          _meta: ASKING_ENVELOPE,
          ...accept(state),
        });

        expect(other.result?.resultType).toBe("input_required");
        expect(other.result?.requestState).not.toBe(state);
        expect(executions).toEqual([]);
      });

      it("a state is bound to every argument of the call: one more argument is not honored", async () => {
        const { round } = await rawSession();
        const state = stateOf(await round({ value: "a" }));

        const other = await round({ value: "a", also: "x" }, accept(state));

        expect(other.result?.resultType).toBe("input_required");
        expect(executions).toEqual([]);
      });

      it("expired: a state older than 600 seconds is asked again and never runs", async () => {
        const { round } = await rawSession();
        const state = stateOf(await round({ value: "a" }));
        vi.useFakeTimers({ toFake: ["Date"] });
        try {
          vi.setSystemTime(Date.now() + 601_000);
          const late = await round({ value: "a" }, accept(state));
          expect(late.error).toBeUndefined();
          expect(late.result?.resultType).toBe("input_required");
        } finally {
          vi.useRealTimers();
        }
        expect(executions).toEqual([]);
      });

      it("a state is still good just inside its lifetime", async () => {
        const { round } = await rawSession();
        const state = stateOf(await round({ value: "a" }));
        vi.useFakeTimers({ toFake: ["Date"] });
        try {
          vi.setSystemTime(Date.now() + 590_000);
          const inTime = await round({ value: "a" }, accept(state));
          expect(inTime.result?.resultType).toBe("complete");
        } finally {
          vi.useRealTimers();
        }
        expect(executions).toEqual(["a"]);
      });

      it("a valid decline is honored even when the retry no longer declares the capability", async () => {
        const { round, marker } = await rawSession();
        const state = stateOf(await round({ value: "a" }));

        const declined = await round({ value: "a" }, { inputResponses: { confirm: { action: "decline" } }, requestState: state }, ENVELOPE);

        expect(declined.result?.isError).toBe(true);
        expect(declined.result?.structuredContent).toEqual({ code: "CONFIRMATION_DECLINED", action: "iris_wire_confirm", response: "decline" });
        const entries = await marker();
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({ outcome: "denied", denyReason: "CONFIRMATION_DECLINED", confirmation: "declined" });
      });

      it("a valid accept is honored even when the retry no longer declares the capability", async () => {
        const { round } = await rawSession();
        const state = stateOf(await round({ value: "a" }));

        const accepted = await round({ value: "a" }, accept(state), ENVELOPE);

        expect((accepted.result?.content as Array<{ text: string }>)[0]?.text).toBe("wrote a");
        expect(executions).toEqual(["a"]);
      });

      it("a client whose envelope declares no capability gets the fallback, whatever it sends back", async () => {
        const { round } = await rawSession();
        const plain = await round({ value: "a" }, {}, ENVELOPE);
        const forged = await round({ value: "b" }, { inputResponses: { confirm: TICKED } }, ENVELOPE);
        expect((plain.result?.content as Array<{ text: string }>)[0]?.text).toBe("wrote a");
        expect((forged.result?.content as Array<{ text: string }>)[0]?.text).toBe("wrote b");
        expect(executions).toEqual(["a", "b"]);
      });
    });

    describe("on the legacy era, over raw frames", () => {
      const SMUGGLED = { "io.modelcontextprotocol/clientCapabilities": FORM };

      it("a 2025 client that declared no elicitation cannot claim one through _meta", async () => {
        governed();
        const { request } = await startRaw([confirmTool]);
        const initialized = await request("initialize", initializeParams("2025-11-25"));
        expect(initialized.result?.protocolVersion).toBe("2025-11-25");

        const answer = await request("tools/call", { name: "iris_wire_confirm", arguments: { value: "a" }, _meta: SMUGGLED });

        expect(answer.error).toBeUndefined();
        expect((answer.result?.content as Array<{ text: string }>)[0]?.text).toBe("wrote a");
        expect(answer.result?.resultType).toBeUndefined();
        expect(executions).toEqual(["a"]);
      });

      it("a plain call that carries an accept and a made-up state is not honored by a client that declared nothing", async () => {
        governed();
        const { request } = await startRaw([confirmTool]);
        await request("initialize", initializeParams("2025-11-25"));

        const answer = await request("tools/call", {
          name: "iris_wire_confirm",
          arguments: { value: "a" },
          inputResponses: { confirm: TICKED },
          requestState: "v1.e30.AAAA",
        });

        expect((answer.result?.content as Array<{ text: string }>)[0]?.text).toBe("wrote a");
        expect(asked).toEqual([]);
      });
    });

    describe("a dialog that nobody answers (decision 14)", () => {
      /** The audit entries the server has handed to the writer, read at the writer so no file I/O is needed. */
      function loggedEntries(log: ReturnType<typeof vi.spyOn>): Array<Record<string, unknown>> {
        return log.mock.calls.map((call) => call[0] as Record<string, unknown>);
      }

      const UNANSWERED = "The confirmation dialog was not answered. Nothing was changed.";

      async function asked600(): Promise<{
        server: McpServerBase;
        file: string;
        log: ReturnType<typeof vi.spyOn>;
        first: RawAnswer;
        round: (args: Record<string, unknown>, extra?: Record<string, unknown>) => Promise<RawAnswer>;
      }> {
        governed();
        const file = auditOn();
        const log = vi.spyOn(AuditLogger.prototype, "log");
        const { server, request } = await startRaw([confirmTool]);
        await request("server/discover", { _meta: ENVELOPE });
        const round = (args: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
          request("tools/call", { name: "iris_wire_confirm", arguments: args, _meta: ASKING_ENVELOPE, ...extra });
        const first = await round({ value: "a" });
        return { server, file, log, first, round };
      }

      it("the sweep timer fires at the lifetime of the state and writes the entry (fake timers)", async () => {
        governed();
        const file = auditOn();
        const log = vi.spyOn(AuditLogger.prototype, "log");
        const { request } = await startRaw([confirmTool]);
        await request("server/discover", { _meta: ENVELOPE });
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
        try {
          const first = await request("tools/call", { name: "iris_wire_confirm", arguments: { value: "a" }, _meta: ASKING_ENVELOPE });
          expect(first.result?.resultType).toBe("input_required");
          expect(vi.getTimerCount()).toBe(1);
          expect(loggedEntries(log)).toEqual([]);

          await vi.advanceTimersByTimeAsync(599_999);
          expect(loggedEntries(log)).toEqual([]);

          await vi.advanceTimersByTimeAsync(1);
          const entries = loggedEntries(log);
          expect(entries).toHaveLength(1);
          expect(entries[0]).toMatchObject({
            tool: "iris_wire_confirm",
            action: null,
            profile: "default",
            namespace: "HSCUSTOM",
            outcome: "error",
            error: UNANSWERED,
            paramKeys: ["value"],
            params: { value: "a" },
            confirmation: "unanswered",
          });
          expect(vi.getTimerCount()).toBe(0);
          await vi.advanceTimersByTimeAsync(1_200_000);
          expect(loggedEntries(log)).toHaveLength(1);
        } finally {
          vi.useRealTimers();
        }
        const written = await auditLines(file, 2);
        expect(written[1]).toMatchObject({ tool: "iris_wire_confirm", outcome: "error", error: UNANSWERED, confirmation: "unanswered" });
        expect(Object.prototype.hasOwnProperty.call(written[1], "denyReason")).toBe(false);
        expect(executions).toEqual([]);
      });

      it("an answered dialog leaves nothing to sweep: no unanswered entry follows when its lifetime has passed", async () => {
        governed();
        auditOn();
        const log = vi.spyOn(AuditLogger.prototype, "log");
        const { request } = await startRaw([confirmTool]);
        await request("server/discover", { _meta: ENVELOPE });
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
        try {
          const call = (extra: Record<string, unknown> = {}) =>
            request("tools/call", { name: "iris_wire_confirm", arguments: { value: "a" }, _meta: ASKING_ENVELOPE, ...extra });
          const first = await call();
          expect(vi.getTimerCount()).toBe(1);
          await call({ inputResponses: { confirm: TICKED }, requestState: first.result?.requestState });
          expect(loggedEntries(log)).toHaveLength(1);

          await vi.advanceTimersByTimeAsync(1_200_000);

          expect(loggedEntries(log)).toHaveLength(1);
          expect(loggedEntries(log)[0]).toMatchObject({ outcome: "ok", confirmation: "accepted" });
        } finally {
          vi.useRealTimers();
        }
      });

      it("two dialogs asked at different times are each ended at their own lifetime", async () => {
        governed();
        auditOn();
        const log = vi.spyOn(AuditLogger.prototype, "log");
        const { request } = await startRaw([confirmTool]);
        await request("server/discover", { _meta: ENVELOPE });
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
        try {
          const ask = (value: string) =>
            request("tools/call", { name: "iris_wire_confirm", arguments: { value }, _meta: ASKING_ENVELOPE });
          await ask("a");
          await vi.advanceTimersByTimeAsync(300_000);
          await ask("b");

          await vi.advanceTimersByTimeAsync(300_000);
          expect(loggedEntries(log).map((entry) => (entry.params as { value: string }).value)).toEqual(["a"]);

          await vi.advanceTimersByTimeAsync(300_000);
          expect(loggedEntries(log).map((entry) => (entry.params as { value: string }).value)).toEqual(["a", "b"]);
          expect(vi.getTimerCount()).toBe(0);
        } finally {
          vi.useRealTimers();
        }
      });

      it("an answer that arrives after its dialog was written unanswered is asked again and never runs, though the state has half a second left", async () => {
        governed();
        auditOn();
        const log = vi.spyOn(AuditLogger.prototype, "log");
        const { request } = await startRaw([confirmTool]);
        await request("server/discover", { _meta: ENVELOPE });
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
        try {
          // A whole second: the state counts its life in whole seconds, so it is still good until 601 seconds from now.
          vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
          const call = (extra: Record<string, unknown> = {}) =>
            request("tools/call", { name: "iris_wire_confirm", arguments: { value: "a" }, _meta: ASKING_ENVELOPE, ...extra });
          const first = await call();
          await vi.advanceTimersByTimeAsync(600_000);
          expect(loggedEntries(log)).toHaveLength(1);
          expect(loggedEntries(log)[0]).toMatchObject({ outcome: "error", confirmation: "unanswered" });

          await vi.advanceTimersByTimeAsync(500);
          const late = await call({ inputResponses: { confirm: TICKED }, requestState: first.result?.requestState });

          expect(late.result?.resultType).toBe("input_required");
          expect(executions).toEqual([]);
          expect(loggedEntries(log), "the entry that says nothing changed stays the only one").toHaveLength(1);
        } finally {
          vi.useRealTimers();
        }
      });

      it("a retry that echoes its state with no answer is asked again, and the call still ends as one entry", async () => {
        const { server, log, first, round } = await asked600();
        const state = first.result?.requestState as string;

        const again = await round({ value: "a" }, { requestState: state });
        expect(again.result?.resultType).toBe("input_required");
        expect(again.result?.requestState).not.toBe(state);
        const declined = await round({ value: "a" }, { inputResponses: { confirm: { action: "decline" } }, requestState: again.result?.requestState });
        expect(declined.result?.isError).toBe(true);
        await server.stop();

        const entries = loggedEntries(log);
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({ tool: "iris_wire_confirm", outcome: "denied", confirmation: "declined" });
        expect(executions).toEqual([]);
      });

      it("stop() writes every pending ask before the audit writer shuts down", async () => {
        const { server, file, log, first } = await asked600();
        expect(first.result?.resultType).toBe("input_required");
        expect(loggedEntries(log)).toEqual([]);

        await server.stop();

        const entries = loggedEntries(log);
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({ tool: "iris_wire_confirm", outcome: "error", error: UNANSWERED, confirmation: "unanswered" });
        const written = await auditLines(file, 3);
        expect(written.map((line) => line.type ?? line.tool)).toEqual(["sessionStart", "iris_wire_confirm", "shutdown"]);
        expect(executions).toEqual([]);
      });

      it("closing the connection writes the entry, and stop() afterwards writes nothing more", async () => {
        const { server, log, first } = await asked600();
        expect(first.result?.resultType).toBe("input_required");

        await (linked.clientHalf as { close: () => Promise<void> }).close();
        await vi.waitFor(() => expect(loggedEntries(log)).toHaveLength(1));
        await server.stop();

        expect(loggedEntries(log)).toHaveLength(1);
        expect(loggedEntries(log)[0]).toMatchObject({ outcome: "error", confirmation: "unanswered" });
      });

      it("the sweep timer never keeps the process alive", async () => {
        governed();
        auditOn();
        const handles: Array<{ delay: number; handle: { hasRef: () => boolean } }> = [];
        const realSetTimeout = globalThis.setTimeout;
        vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number, ...rest: unknown[]) => {
          const handle = (realSetTimeout as unknown as (...args: unknown[]) => { hasRef: () => boolean })(callback, delay, ...rest);
          handles.push({ delay: delay ?? 0, handle });
          return handle;
        }) as unknown as typeof setTimeout);
        const { server, request } = await startRaw([confirmTool]);
        await request("server/discover", { _meta: ENVELOPE });

        await request("tools/call", { name: "iris_wire_confirm", arguments: { value: "a" }, _meta: ASKING_ENVELOPE });

        const sweep = handles.filter((entry) => entry.delay > 590_000 && entry.delay <= 600_000);
        expect(sweep).toHaveLength(1);
        expect(sweep[0]?.handle.hasRef()).toBe(false);
        await server.stop();
      });

      it("no entry and no timer exist while auditing is off", async () => {
        governed();
        const log = vi.spyOn(AuditLogger.prototype, "log");
        const { request } = await startRaw([confirmTool]);
        await request("server/discover", { _meta: ENVELOPE });
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
        try {
          const first = await request("tools/call", { name: "iris_wire_confirm", arguments: { value: "a" }, _meta: ASKING_ENVELOPE });
          expect(first.result?.resultType).toBe("input_required");
          expect(vi.getTimerCount()).toBe(0);
        } finally {
          vi.useRealTimers();
        }
        expect(log).not.toHaveBeenCalled();
      });
    });
  });
});
