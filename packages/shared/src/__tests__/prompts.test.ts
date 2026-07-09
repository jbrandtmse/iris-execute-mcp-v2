/**
 * Story 25.0 — MCP `prompts` Capability (Framework Plumbing + Back-Compat).
 *
 * Exercises the {@link PromptDefinition} → {@link McpServerBase} wiring with
 * NO real prompt content (that is Story 25.1) — only small fixture prompts —
 * and NO live IRIS: prompt registration happens entirely in the constructor,
 * so none of these tests call `start()`.
 *
 *   AC 25.0.1 — a server constructed with an empty/absent `prompts` array
 *               advertises NO `prompts` capability and is byte-for-byte
 *               unchanged (mechanical capability snapshot, Rule #19); a
 *               server WITH >=1 prompt additionally advertises
 *               `prompts: { listChanged: true }`.
 *   AC 25.0.2 — `prompts/list` returns name/title/description/arguments;
 *               `prompts/get` with valid args renders a single user-role text
 *               message via `build(args)`; unknown name -> InvalidParams;
 *               missing required argument -> InvalidParams (both are the
 *               SDK's OWN error paths, not hand-rolled).
 *   AC 25.0.3 — per-server prompt assignment: a fixture-prompts server
 *               exposes EXACTLY those prompts; a no-prompts server exposes
 *               none (prompts are per-instance, not global).
 *
 * Harness mirrors `governance-resource.test.ts`'s `callRequest` /
 * `advertisedCapabilities` helpers (drives the REAL MCP SDK request handlers
 * registered on the underlying `Server`). No env vars, no fetch mocking, no
 * bootstrap mocking needed — prompt registration is fully synchronous and
 * constructor-scoped.
 */

import { describe, it, expect } from "vitest";
import { McpServerBase } from "../server-base.js";
import type { McpServerBaseOptions } from "../server-base.js";
import type { PromptDefinition } from "../tool-types.js";

// ── Fixture prompts (Story 25.0 ships NO real content — Story 25.1 does) ──

/** No arguments at all. */
const noArgsPrompt: PromptDefinition = {
  name: "fixture-no-args",
  title: "Fixture: No Args",
  description: "A fixture prompt with no arguments.",
  arguments: [],
  build: () => "no-args rendered",
};

/** One REQUIRED argument. */
const requiredArgPrompt: PromptDefinition = {
  name: "fixture-required-arg",
  title: "Fixture: Required Arg",
  description: "A fixture prompt with one required argument.",
  arguments: [
    { name: "topic", description: "The topic to render.", required: true },
  ],
  build: (args) => `topic=${args.topic}`,
};

/** One OPTIONAL argument. */
const optionalArgPrompt: PromptDefinition = {
  name: "fixture-optional-arg",
  title: "Fixture: Optional Arg",
  description: "A fixture prompt with one optional argument.",
  arguments: [
    { name: "detail", description: "Optional detail level.", required: false },
  ],
  build: (args) => `detail=${args.detail ?? "(none)"}`,
};

const FIXTURE_PROMPTS: PromptDefinition[] = [
  noArgsPrompt,
  requiredArgPrompt,
  optionalArgPrompt,
];

function makeServerOpts(
  prompts?: PromptDefinition[],
): McpServerBaseOptions {
  return {
    name: "test-server",
    version: "1.0.0",
    tools: [],
    ...(prompts !== undefined && { prompts }),
  };
}

/** The underlying Server's advertised capabilities (what _oninitialize returns). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function advertisedCapabilities(server: any): Record<string, unknown> {
  return server.server.server.getCapabilities();
}

/**
 * Invoke a request handler registered on the underlying `Server` by method
 * name (e.g. "prompts/list"). Drives the REAL SDK dispatch exactly as a
 * connected client would.
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
// AC 25.0.1 — capability snapshot: no-prompts back-compat + with-prompts delta.
// ════════════════════════════════════════════════════════════════════

describe("Story 25.0 — `prompts` capability snapshot (AC 25.0.1)", () => {
  it("a server with NO prompts advertises the exact today's capability set (no `prompts` key)", () => {
    const server = new McpServerBase(makeServerOpts());
    const caps = advertisedCapabilities(server);

    // Mechanical proof (Rule #19): deep-equal today's baseline capability
    // object exactly — no stray `prompts` key, no other drift.
    expect(caps).toEqual({
      tools: { listChanged: true },
      resources: { listChanged: true },
    });
    expect(caps.prompts).toBeUndefined();
  });

  it("a server with an EMPTY prompts array is identical to an absent prompts option", () => {
    const server = new McpServerBase(makeServerOpts([]));
    const caps = advertisedCapabilities(server);
    expect(caps).toEqual({
      tools: { listChanged: true },
      resources: { listChanged: true },
    });
    expect(caps.prompts).toBeUndefined();
  });

  it("a server WITH >=1 prompt additionally advertises prompts:{listChanged:true}, tools/resources unchanged", () => {
    const server = new McpServerBase(makeServerOpts([noArgsPrompt]));
    const caps = advertisedCapabilities(server);

    expect(caps).toEqual({
      tools: { listChanged: true },
      resources: { listChanged: true },
      prompts: { listChanged: true },
    });
  });
});

// ════════════════════════════════════════════════════════════════════
// AC 25.0.2 — prompts/list shape.
// ════════════════════════════════════════════════════════════════════

describe("Story 25.0 — prompts/list (AC 25.0.2)", () => {
  it("returns each registered prompt's name/title/description/arguments", async () => {
    const server = new McpServerBase(makeServerOpts(FIXTURE_PROMPTS));
    const result = await callRequest(server, "prompts/list", {});
    const prompts = result.prompts as Array<{
      name: string;
      title?: string;
      description?: string;
      arguments?: Array<{ name: string; description?: string; required?: boolean }>;
    }>;

    expect(prompts).toHaveLength(3);

    const noArgs = prompts.find((p) => p.name === "fixture-no-args");
    expect(noArgs).toMatchObject({
      name: "fixture-no-args",
      title: "Fixture: No Args",
      description: "A fixture prompt with no arguments.",
    });
    expect(noArgs?.arguments ?? []).toHaveLength(0);

    const required = prompts.find((p) => p.name === "fixture-required-arg");
    expect(required).toMatchObject({
      name: "fixture-required-arg",
      title: "Fixture: Required Arg",
      description: "A fixture prompt with one required argument.",
    });
    expect(required?.arguments).toEqual([
      { name: "topic", description: "The topic to render.", required: true },
    ]);

    const optional = prompts.find((p) => p.name === "fixture-optional-arg");
    expect(optional).toMatchObject({
      name: "fixture-optional-arg",
      title: "Fixture: Optional Arg",
      description: "A fixture prompt with one optional argument.",
    });
    expect(optional?.arguments).toEqual([
      { name: "detail", description: "Optional detail level.", required: false },
    ]);
  });

  it("a no-prompts server registers NO prompts/list handler at all (matches the absent capability)", async () => {
    // The SDK only wires prompts/list, prompts/get once registerPrompt() is
    // called at least once (setPromptRequestHandlers). An absent/empty
    // `prompts` array never calls it, so the handler itself is absent — a
    // stronger proof than "returns empty": a real client would never even
    // send prompts/list since the capability (AC 25.0.1) was never advertised.
    const server = new McpServerBase(makeServerOpts());
    await expect(callRequest(server, "prompts/list", {})).rejects.toThrow(
      /No request handler registered for "prompts\/list"/,
    );
  });
});

// ════════════════════════════════════════════════════════════════════
// AC 25.0.2 — prompts/get render + error paths.
// ════════════════════════════════════════════════════════════════════

describe("Story 25.0 — prompts/get render (AC 25.0.2)", () => {
  it("renders build(args) as a single user-role text message (no-args prompt)", async () => {
    const server = new McpServerBase(makeServerOpts(FIXTURE_PROMPTS));
    const result = await callRequest(server, "prompts/get", {
      name: "fixture-no-args",
      arguments: {},
    });
    expect(result.messages).toEqual([
      {
        role: "user",
        content: { type: "text", text: "no-args rendered" },
      },
    ]);
  });

  it("renders build(args) with a required argument supplied", async () => {
    const server = new McpServerBase(makeServerOpts(FIXTURE_PROMPTS));
    const result = await callRequest(server, "prompts/get", {
      name: "fixture-required-arg",
      arguments: { topic: "backup" },
    });
    expect(result.messages).toEqual([
      {
        role: "user",
        content: { type: "text", text: "topic=backup" },
      },
    ]);
  });

  it("renders build(args) with an optional argument omitted", async () => {
    const server = new McpServerBase(makeServerOpts(FIXTURE_PROMPTS));
    const result = await callRequest(server, "prompts/get", {
      name: "fixture-optional-arg",
      arguments: {},
    });
    expect(result.messages).toEqual([
      {
        role: "user",
        content: { type: "text", text: "detail=(none)" },
      },
    ]);
  });

  it("renders build(args) with an optional argument supplied", async () => {
    const server = new McpServerBase(makeServerOpts(FIXTURE_PROMPTS));
    const result = await callRequest(server, "prompts/get", {
      name: "fixture-optional-arg",
      arguments: { detail: "verbose" },
    });
    expect(result.messages).toEqual([
      {
        role: "user",
        content: { type: "text", text: "detail=verbose" },
      },
    ]);
  });

  it("an unknown prompt name -> standard JSON-RPC InvalidParams error (SDK convention)", async () => {
    const server = new McpServerBase(makeServerOpts(FIXTURE_PROMPTS));
    await expect(
      callRequest(server, "prompts/get", {
        name: "no-such-prompt",
        arguments: {},
      }),
    ).rejects.toThrow(/no-such-prompt/);
  });

  it("a missing required argument -> the SDK's argument-validation InvalidParams error", async () => {
    const server = new McpServerBase(makeServerOpts(FIXTURE_PROMPTS));
    await expect(
      callRequest(server, "prompts/get", {
        name: "fixture-required-arg",
        arguments: {},
      }),
    ).rejects.toThrow(/Invalid arguments for prompt/);
  });
});

// ════════════════════════════════════════════════════════════════════
// AC 25.0.3 — per-server (per-instance) prompt assignment / isolation.
// ════════════════════════════════════════════════════════════════════

describe("Story 25.0 — per-server prompt assignment (AC 25.0.3)", () => {
  it("a fixture-prompts server exposes EXACTLY its own prompts; a no-prompts server exposes none", async () => {
    const withPrompts = new McpServerBase(makeServerOpts(FIXTURE_PROMPTS));
    const withoutPrompts = new McpServerBase(makeServerOpts());

    const listWith = await callRequest(withPrompts, "prompts/list", {});
    const namesWith = (listWith.prompts as Array<{ name: string }>)
      .map((p) => p.name)
      .sort();
    expect(namesWith).toEqual(
      ["fixture-no-args", "fixture-optional-arg", "fixture-required-arg"].sort(),
    );

    // The no-prompts server never wires ANY prompt request handler (matches
    // the absent-capability behavior asserted in the prompts/list suite
    // above) — the strongest possible proof of no cross-contamination: it is
    // not merely that the other instance's prompts are missing from the
    // list, the whole prompts surface does not exist on this instance.
    await expect(callRequest(withoutPrompts, "prompts/list", {})).rejects.toThrow(
      /No request handler registered for "prompts\/list"/,
    );
    await expect(
      callRequest(withoutPrompts, "prompts/get", {
        name: "fixture-no-args",
        arguments: {},
      }),
    ).rejects.toThrow(/No request handler registered for "prompts\/get"/);
  });

  it("two servers with DIFFERENT single-prompt arrays each expose only their own prompt", async () => {
    const serverA = new McpServerBase(makeServerOpts([noArgsPrompt]));
    const serverB = new McpServerBase(makeServerOpts([requiredArgPrompt]));

    const listA = await callRequest(serverA, "prompts/list", {});
    expect((listA.prompts as Array<{ name: string }>).map((p) => p.name)).toEqual([
      "fixture-no-args",
    ]);

    const listB = await callRequest(serverB, "prompts/list", {});
    expect((listB.prompts as Array<{ name: string }>).map((p) => p.name)).toEqual([
      "fixture-required-arg",
    ]);
  });
});
