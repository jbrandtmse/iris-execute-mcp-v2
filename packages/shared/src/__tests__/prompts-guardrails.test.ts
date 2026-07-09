/**
 * Story 25.0 — MCP `prompts` Capability guardrail tests.
 *
 * ORTHOGONAL to `prompts.test.ts` (the dev's 13 tests) — does not repeat any
 * assertion made there. Strengthens coverage the story's ACs call for but the
 * dev suite leaves thin:
 *
 *   AC 25.0.1 — protocol-level `initialize` handshake (not just reading the
 *               internal `getCapabilities()` accessor) proves the capability
 *               delta end-to-end, for both the no-prompts and with-prompts
 *               cases; plus a mechanical proof that prompts never leak into
 *               the `tools/list` surface (the server-level analogue of
 *               Rule #31 — prompts are not tools).
 *   AC 25.0.2 — both `prompts/get` error paths are asserted to be REAL
 *               `McpError` instances carrying `ErrorCode.InvalidParams`
 *               (`instanceof` + `.code`), not merely a message-matching regex
 *               — the story text explicitly requires "SDK-native InvalidParams".
 *   AC 25.0.3 — per-instance isolation strengthened at the REGISTRATION layer:
 *               (a) two prompts with the SAME name on ONE server instance hit
 *               the SDK's own duplicate-registration guard; (b) two prompts
 *               with the SAME name on two DIFFERENT server instances do NOT
 *               collide and each instance renders its own distinct content —
 *               proving the duplicate-name guard itself is per-instance, not
 *               a shared/global registry. Also proves prompt registration
 *               (added last in the constructor, per Dev Notes) does not
 *               perturb the earlier-registered governance resource surface.
 *
 * Harness mirrors `prompts.test.ts` / `governance-resource.test.ts`'s
 * `callRequest` / `advertisedCapabilities` helpers (drives the REAL MCP SDK
 * request handlers registered on the underlying `Server`). No env vars, no
 * fetch mocking, no bootstrap mocking needed — prompt/tool/resource
 * registration is fully synchronous and constructor-scoped, so none of these
 * tests call `start()`.
 */

import { describe, it, expect } from "vitest";
import { McpError, ErrorCode, LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";
import { McpServerBase } from "../server-base.js";
import type { McpServerBaseOptions } from "../server-base.js";
import type { PromptDefinition } from "../tool-types.js";
import { SERVER_DISCOVERY_TOOL_NAME } from "../server-discovery.js";

// ── Fixture prompts (Story 25.0 ships NO real content — Story 25.1 does) ──

const noArgsPrompt: PromptDefinition = {
  name: "guardrail-no-args",
  title: "Guardrail: No Args",
  description: "A fixture prompt with no arguments.",
  arguments: [],
  build: () => "no-args rendered",
};

const requiredArgPrompt: PromptDefinition = {
  name: "guardrail-required-arg",
  title: "Guardrail: Required Arg",
  description: "A fixture prompt with one required argument.",
  arguments: [
    { name: "topic", description: "The topic to render.", required: true },
  ],
  build: (args) => `topic=${args.topic}`,
};

const FIXTURE_PROMPTS: PromptDefinition[] = [noArgsPrompt, requiredArgPrompt];

function makeServerOpts(prompts?: PromptDefinition[]): McpServerBaseOptions {
  return {
    name: "test-server",
    version: "1.0.0",
    tools: [],
    ...(prompts !== undefined && { prompts }),
  };
}

/**
 * Invoke a request handler registered on the underlying `Server` by method
 * name (e.g. "prompts/list", "initialize", "tools/list"). Drives the REAL SDK
 * dispatch exactly as a connected client would.
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

// ════════════════════════════════════════════════════════════════════
// AC 25.0.2 — error paths must be genuine SDK McpError/InvalidParams.
// ════════════════════════════════════════════════════════════════════

describe("Story 25.0 guardrails — prompts/get error paths are real McpError (AC 25.0.2)", () => {
  it("unknown prompt name rejects with an McpError carrying ErrorCode.InvalidParams", async () => {
    const server = new McpServerBase(makeServerOpts(FIXTURE_PROMPTS));
    const promise = callRequest(server, "prompts/get", {
      name: "no-such-prompt",
      arguments: {},
    });
    await expect(promise).rejects.toBeInstanceOf(McpError);
    await expect(promise).rejects.toMatchObject({
      code: ErrorCode.InvalidParams,
      name: "McpError",
    });
  });

  it("missing required argument rejects with an McpError carrying ErrorCode.InvalidParams", async () => {
    const server = new McpServerBase(makeServerOpts(FIXTURE_PROMPTS));
    const promise = callRequest(server, "prompts/get", {
      name: "guardrail-required-arg",
      arguments: {},
    });
    await expect(promise).rejects.toBeInstanceOf(McpError);
    await expect(promise).rejects.toMatchObject({
      code: ErrorCode.InvalidParams,
      name: "McpError",
    });
  });

  it("a no-args prompt's prompts/get RENDERS when the `arguments` key is omitted entirely (MCP marks `arguments` optional)", async () => {
    // Pinned against the ACTUAL SDK behavior (Rule #36 — observe, don't
    // assume). The MCP wire schema (`GetPromptRequestParamsSchema`) marks
    // `arguments` OPTIONAL, so a spec-compliant client MAY omit it entirely
    // for a no-arg prompt. `registerPrompt()` (server-base.ts) therefore
    // passes NO `argsSchema` for a no-argument prompt, so the SDK wires the
    // no-args callback form (`cb(extra)`) and does NOT validate
    // `request.params.arguments` — an omitted `arguments` renders correctly
    // instead of being refused with InvalidParams (CR 25.0-1). Regression
    // guard: this is exactly the path a real no-arg prompt (Story 25.1's
    // `objectscript-review`) is fetched by a strictly-spec-compliant client.
    const server = new McpServerBase(makeServerOpts(FIXTURE_PROMPTS));
    const result = await callRequest(server, "prompts/get", {
      name: "guardrail-no-args",
    });
    expect(result.messages).toEqual([
      { role: "user", content: { type: "text", text: "no-args rendered" } },
    ]);
  });
});

// ════════════════════════════════════════════════════════════════════
// AC 25.0.1 — protocol-level initialize handshake (not internal-state peek).
// ════════════════════════════════════════════════════════════════════

describe("Story 25.0 guardrails — protocol-level initialize handshake (AC 25.0.1)", () => {
  const initParams = {
    protocolVersion: LATEST_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: "guardrail-test-client", version: "1.0.0" },
  };

  it("a no-prompts server's REAL initialize response omits the prompts key", async () => {
    const server = new McpServerBase(makeServerOpts());
    const result = await callRequest(server, "initialize", initParams);
    expect(result.protocolVersion).toBe(LATEST_PROTOCOL_VERSION);
    expect(result.serverInfo).toEqual({ name: "test-server", version: "1.0.0" });
    expect(result.capabilities).toEqual({
      tools: { listChanged: true },
      resources: { listChanged: true },
    });
    expect(result.capabilities.prompts).toBeUndefined();
  });

  it("a with-prompts server's REAL initialize response advertises prompts:{listChanged:true}", async () => {
    const server = new McpServerBase(makeServerOpts(FIXTURE_PROMPTS));
    const result = await callRequest(server, "initialize", initParams);
    expect(result.capabilities).toEqual({
      tools: { listChanged: true },
      resources: { listChanged: true },
      prompts: { listChanged: true },
    });
  });
});

// ════════════════════════════════════════════════════════════════════
// AC 25.0.1 / Rule #31-flavored — prompts never leak into the tools surface.
// ════════════════════════════════════════════════════════════════════

describe("Story 25.0 guardrails — prompts do not perturb the tools/resources surfaces", () => {
  it("tools/list contains ONLY the framework discovery tool — no fixture prompt names appear as tools", async () => {
    const server = new McpServerBase(makeServerOpts(FIXTURE_PROMPTS));
    const result = await callRequest(server, "tools/list", {});
    const names = (result.tools as Array<{ name: string }>).map((t) => t.name);
    expect(names).toEqual([SERVER_DISCOVERY_TOOL_NAME]);
    expect(names).not.toContain("guardrail-no-args");
    expect(names).not.toContain("guardrail-required-arg");
  });

  it("resources/list still exposes the governance default resource with prompts registered (registration-order non-interference)", async () => {
    // Prompts are registered LAST in the constructor (per Dev Notes), after the
    // governance resource. Confirms that ordering doesn't clobber or shadow
    // the earlier-registered resources/list handler.
    const server = new McpServerBase(makeServerOpts(FIXTURE_PROMPTS));
    const result = await callRequest(server, "resources/list", {});
    const uris = (result.resources as Array<{ uri: string }>).map((r) => r.uri);
    expect(uris).toContain("iris-governance://default");
  });
});

// ════════════════════════════════════════════════════════════════════
// AC 25.0.3 — duplicate-name guard is per-instance, not global.
// ════════════════════════════════════════════════════════════════════

describe("Story 25.0 guardrails — duplicate prompt name guard is per-instance (AC 25.0.3)", () => {
  it("two prompts with the SAME name on ONE server instance hit the SDK's duplicate-registration guard", () => {
    const dupA: PromptDefinition = {
      name: "dup-name",
      title: "Dup A",
      description: "First registration.",
      arguments: [],
      build: () => "A",
    };
    const dupB: PromptDefinition = {
      name: "dup-name",
      title: "Dup B",
      description: "Second registration, same name.",
      arguments: [],
      build: () => "B",
    };
    expect(() => new McpServerBase(makeServerOpts([dupA, dupB]))).toThrow(
      /Prompt dup-name is already registered/,
    );
  });

  it("two prompts with the SAME name on TWO DIFFERENT server instances do NOT collide, and each instance renders its own distinct content", async () => {
    const sharedNameV1: PromptDefinition = {
      name: "shared-name",
      title: "Shared V1",
      description: "Version registered on server X.",
      arguments: [],
      build: () => "rendered-by-server-X",
    };
    const sharedNameV2: PromptDefinition = {
      name: "shared-name",
      title: "Shared V2",
      description: "Version registered on server Y.",
      arguments: [],
      build: () => "rendered-by-server-Y",
    };

    // Constructing both must NOT throw — the duplicate-registration guard is
    // scoped to a single McpServer instance's own `_registeredPrompts` map,
    // not a module-level/global registry.
    const serverX = new McpServerBase(makeServerOpts([sharedNameV1]));
    const serverY = new McpServerBase(makeServerOpts([sharedNameV2]));

    const resultX = await callRequest(serverX, "prompts/get", {
      name: "shared-name",
      arguments: {},
    });
    const resultY = await callRequest(serverY, "prompts/get", {
      name: "shared-name",
      arguments: {},
    });

    expect(resultX.messages[0].content.text).toBe("rendered-by-server-X");
    expect(resultY.messages[0].content.text).toBe("rendered-by-server-Y");
  });
});
