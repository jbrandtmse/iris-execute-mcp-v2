/**
 * Story 25.1 QA — per-server prompt advertisement, end-to-end
 * (AC 25.1.1, AC 25.0.3).
 *
 * `iris-data-mcp` ships NO prompts in v1 (Story 25.1 AC 25.1.1 Task 1 note:
 * "data-mcp gets none in v1") — its `src/index.ts` never passes a `prompts`
 * option to `McpServerBase` at all. This test proves that absence holds at
 * the REAL server-construction level (not merely "no prompts/index.ts file
 * exists"): the real `@iris-mcp/data` server, built exactly as
 * `src/index.ts` constructs it, must advertise NO `prompts` capability and
 * register NO `prompts/list`/`prompts/get` handler — mirroring
 * `packages/shared/src/__tests__/prompts.test.ts`'s "a no-prompts server
 * registers NO prompts/list handler at all" assertion, but against this
 * package's actual production `tools` array (not a fixture). No live IRIS:
 * registration is fully synchronous and constructor-scoped, so this never
 * calls `start()`.
 */

import { describe, it, expect } from "vitest";
import { McpServerBase } from "@iris-mcp/shared";
import { tools } from "../tools/index.js";

/**
 * Invoke a request handler registered on the underlying `Server` by method
 * name (e.g. "prompts/list"). Drives the REAL SDK dispatch exactly as a
 * connected client would (mirrors `packages/shared/src/__tests__/prompts.test.ts`).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function callRequest(server: any, method: string, params: unknown) {
  const innerServer = server.server.server;
  const handlers = innerServer._requestHandlers as Map<
    string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (req: any, extra: any) => Promise<any>
  >;
  const handler = handlers.get(method);
  if (!handler) {
    throw new Error(`No request handler registered for "${method}"`);
  }
  const extra = {
    signal: new AbortController().signal,
    sendNotification: async () => {},
    sendRequest: async () => ({}),
  };
  return handler({ method, params }, extra);
}

function makeRealServer(): McpServerBase {
  // Deliberately mirrors src/index.ts exactly: no `prompts` key at all.
  return new McpServerBase({
    name: "@iris-mcp/data",
    version: "0.0.1",
    tools,
    needsCustomRest: true,
  });
}

describe("iris-data-mcp real server advertises NO prompts (AC 25.1.1 — v1 ships no data-mcp prompts)", () => {
  it("does not advertise a prompts capability", () => {
    const server = makeRealServer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const caps = (server as any).server.server.getCapabilities();
    expect(caps.prompts).toBeUndefined();
    // Sanity: tools/resources capabilities are still present (this server is
    // otherwise fully functional — only prompts is intentionally absent).
    expect(caps.tools).toEqual({ listChanged: true });
    expect(caps.resources).toEqual({ listChanged: true });
  });

  it("registers no prompts/list request handler", async () => {
    const server = makeRealServer();
    await expect(callRequest(server, "prompts/list", {})).rejects.toThrow(
      /No request handler registered for "prompts\/list"/,
    );
  });

  it("registers no prompts/get request handler", async () => {
    const server = makeRealServer();
    await expect(
      callRequest(server, "prompts/get", { name: "check-system-health", arguments: {} }),
    ).rejects.toThrow(/No request handler registered for "prompts\/get"/);
  });
});
