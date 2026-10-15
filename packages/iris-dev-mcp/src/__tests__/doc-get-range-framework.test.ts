/**
 * Story 38.2 - `iris_doc_get` line-range arguments through the real framework (the "Bad number" row
 * of the I/O matrix, AC-2).
 *
 * `doc-get-range.test.ts` calls the handler directly. These tests boot the REAL `McpServerBase` and
 * invoke the tool through the SDK-registered callback (the `handleToolCall` path), so the arguments
 * are validated by the framework's own extended schema: an invalid `startLine` or `endLine` is
 * refused with the framework's `Invalid arguments: <parameter>: ...` result before the handler runs
 * (the only `fetch` calls are the two startup calls), and a numeric string is coerced. A boolean
 * `metadataOnly` sent as the string "true" or "false" (as some clients send it) is coerced before the
 * range-with-metadataOnly check (the "Range + metadataOnly" row). A connected client reaches the
 * SDK's `tools/call` request handler, which validates the same advertised schema BEFORE that
 * callback runs: one case drives that handler and pins what a client sees (the SDK's
 * `Invalid arguments for tool iris_doc_get: ...`, the handler not called, a numeric string
 * coerced). `fetch` is mocked at the network boundary, so no live IRIS is needed. The harness
 * mirrors `loc-e2e.test.ts`, and also clears every startup input that changes which tools register
 * or what startup does (tool visibility, governance, Server Manager discovery, the audit log), so a
 * value exported in the shell cannot change the result.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { McpServerBase } from "@iris-mcp/shared";
import { docGetTool } from "../tools/doc.js";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/** Invoke a tool through the SDK-registered callback (the handleToolCall path). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function callTool(server: any, name: string, args: unknown) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sdkTools = (server.server as any)._registeredTools;
  const entry = sdkTools[name];
  const callback = entry.callback ?? entry.handler ?? entry.cb;
  return callback(args);
}

/** Invoke a tool through the SDK's `tools/call` request handler, which validates the arguments first (what a client reaches). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function callToolOverWire(server: any, name: string, args: unknown) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handler = (server.server.server as any)._requestHandlers.get("tools/call");
  const extra = { signal: new AbortController().signal, sendNotification: async () => {}, sendRequest: async () => ({}) };
  return handler({ method: "tools/call", params: { name, arguments: args } }, extra);
}

/** Startup inputs that change which tools register or what startup does; cleared before every test. */
const CLEARED_ENV = [
  "IRIS_PROFILES",
  "IRIS_GOVERNANCE",
  "IRIS_GOVERNANCE_FILE",
  "IRIS_GOVERNANCE_PRESET",
  "IRIS_TOOLS_PRESET",
  "IRIS_TOOLS_ENABLE",
  "IRIS_TOOLS_DISABLE",
  "IRIS_SERVER_MANAGER",
  "IRIS_AUDIT_LOG",
] as const;

function makeEnvHarness() {
  let fetchMock: ReturnType<typeof vi.fn>;
  const originalFetch = globalThis.fetch;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let exitMock: any;
  const savedEnv: Record<string, string | undefined> = {
    IRIS_USERNAME: process.env.IRIS_USERNAME,
    IRIS_PASSWORD: process.env.IRIS_PASSWORD,
    IRIS_HOST: process.env.IRIS_HOST,
    IRIS_NAMESPACE: process.env.IRIS_NAMESPACE,
    ...Object.fromEntries(CLEARED_ENV.map((key) => [key, process.env[key]])),
  };

  function setup(): void {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    exitMock = vi
      .spyOn(process, "exit")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockImplementation((() => {}) as any);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    for (const key of CLEARED_ENV) delete process.env[key];
    process.env.IRIS_USERNAME = "u";
    process.env.IRIS_PASSWORD = "p";
    process.env.IRIS_HOST = "default.example.com";
    process.env.IRIS_NAMESPACE = "DEFAULTNS";
  }

  function teardown(): void {
    globalThis.fetch = originalFetch;
    exitMock.mockRestore();
    vi.restoreAllMocks();
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }

  return {
    setup,
    teardown,
    get fetchMock() {
      return fetchMock;
    },
  };
}

/** Stage the default profile's startup HEAD (health) and GET (Atelier version 8). */
function stageDefaultStartup(fetchMock: ReturnType<typeof vi.fn>): void {
  fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
  fetchMock.mockResolvedValueOnce(jsonResponse({ status: { errors: [] }, console: [], result: { version: "8.0.0" } }));
}

async function startServerWithDocGet(): Promise<unknown> {
  const server = new McpServerBase({
    name: "@iris-mcp/dev",
    version: "0.0.0",
    tools: [docGetTool],
    needsCustomRest: false,
  });
  await server.start("stdio");
  return server;
}

const TS = "2026-09-01 04:29:37.877";
const CONTENT = ["Class Test.Fixture Extends %RegisteredObject", "{", "}", ""];

/** The Atelier `GET /doc` response for the fixture class (the real 9-key result shape). */
function classGetResponse(): Response {
  return jsonResponse({
    status: { errors: [], summary: "" },
    console: [],
    result: { name: "Test.Fixture.cls", db: "HSCUSTOM", ts: TS, upd: false, cat: "CLS", status: "", enc: false, flags: 0, content: CONTENT },
  });
}

/** The ranged result for lines 2-3 of the fixture class. */
const LINES_2_TO_3 = { name: "Test.Fixture.cls", ts: TS, startLine: 2, endLine: 3, totalLines: 4, lines: ["{", "}"] };

describe("iris_doc_get line-range arguments through the real framework (Story 38.2, AC-2)", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  it.each([
    ["startLine", 0],
    ["startLine", -1],
    ["startLine", 1.5],
    ["startLine", "abc"],
    ["endLine", 0],
    ["endLine", -1],
    ["endLine", 1.5],
    ["endLine", "abc"],
  ])("%s = %j is refused with the framework's Invalid arguments result, and the handler is not called", async (key, value) => {
    stageDefaultStartup(env.fetchMock);
    const server = await startServerWithDocGet();

    const result = await callTool(server, "iris_doc_get", { name: "Test.Fixture.cls", [key]: value });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text as string).toMatch(new RegExp(`^Invalid arguments: ${key}: `));
    expect(env.fetchMock).toHaveBeenCalledTimes(2);
  });

  it("metadataOnly sent as a string is coerced: 'true' with a range is refused before any request, 'false' with a range is an ordinary ranged read", async () => {
    stageDefaultStartup(env.fetchMock);
    const server = await startServerWithDocGet();

    const refused = await callTool(server, "iris_doc_get", { name: "Test.Fixture.cls", metadataOnly: "true", startLine: 1 });

    expect(refused.isError).toBe(true);
    expect(refused.content[0]?.text as string).toMatch(/^startLine and endLine cannot be combined with metadataOnly\. /);
    expect(env.fetchMock).toHaveBeenCalledTimes(2);

    env.fetchMock.mockResolvedValueOnce(classGetResponse());

    const result = await callTool(server, "iris_doc_get", {
      name: "Test.Fixture.cls",
      metadataOnly: "false",
      startLine: 2,
      endLine: 3,
    });

    expect(env.fetchMock).toHaveBeenCalledTimes(3);
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual(LINES_2_TO_3);
  });

  it("numeric strings are coerced: one GET on the bare document path, then the ranged result", async () => {
    stageDefaultStartup(env.fetchMock);
    const server = await startServerWithDocGet();
    env.fetchMock.mockResolvedValueOnce(classGetResponse());

    const result = await callTool(server, "iris_doc_get", { name: "Test.Fixture.cls", startLine: "2", endLine: "3" });

    expect(env.fetchMock).toHaveBeenCalledTimes(3);
    const url = env.fetchMock.mock.calls[2]?.[0] as string;
    expect(url.endsWith("/api/atelier/v8/DEFAULTNS/doc/Test.Fixture.cls")).toBe(true);
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual(LINES_2_TO_3);
  });

  it("over the SDK tools/call handler a client reaches: startLine 0 is refused before the tool runs, and numeric strings are coerced", async () => {
    stageDefaultStartup(env.fetchMock);
    const server = await startServerWithDocGet();

    const refused = await callToolOverWire(server, "iris_doc_get", { name: "Test.Fixture.cls", startLine: 0 });

    expect(refused.isError).toBe(true);
    expect(refused.content[0]?.text as string).toMatch(/Invalid arguments for tool iris_doc_get: [\s\S]*startLine/);
    expect(env.fetchMock).toHaveBeenCalledTimes(2);

    env.fetchMock.mockResolvedValueOnce(classGetResponse());
    const result = await callToolOverWire(server, "iris_doc_get", { name: "Test.Fixture.cls", startLine: "2", endLine: "3" });

    expect(env.fetchMock).toHaveBeenCalledTimes(3);
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual(LINES_2_TO_3);
  });
});
