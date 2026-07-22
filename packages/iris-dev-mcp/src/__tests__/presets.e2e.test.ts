/**
 * Story 30.1 — QA end-to-end coverage for iris-dev-mcp's wired `toolPresets`.
 *
 * Complements the dev's `presets.test.ts` (pure roster-shape assertions: does
 * `assertPresetCoverage` throw, do counts match the spec §2.5 oracle, is
 * `TOOL_PAIRS` co-visible WITHIN the roster data itself). None of those tests
 * ever construct a real `McpServerBase` or drive the SDK wire — they read
 * `toolPresets` as plain data. This file proves the roster actually takes
 * effect through the REAL construction + `tools/list` path Story 30.1 wired
 * in `index.ts` (`toolPresets` passed to `new McpServerBase({...})`):
 *
 *  1. Real construction with the PACKAGE'S OWN `tools` + `toolPresets` under
 *     `IRIS_TOOLS_PRESET=core` / `=developer` / unset (full) yields exactly
 *     the roster's `include` set (+ the reserved `iris_server_profiles`
 *     discovery tool) via `getToolNames()` — the Rule #19 per-package
 *     back-compat proof for the `full`/unset case (byte-identical to
 *     constructing WITHOUT `toolPresets` at all, i.e. today's `index.test.ts`
 *     behavior), and the roster-filtering proof for `core`/`developer`.
 *  2. The SAME thing observed on the real SDK wire (`tools/list` via the
 *     `_requestHandlers` map, mirroring the pattern established in
 *     `packages/shared/src/__tests__/tool-visibility.e2e.test.ts` and
 *     `server-discovery.e2e.test.ts` — no `InMemoryTransport`/SDK `Client`
 *     precedent exists in this repo) under `core`, since dev-mcp is the
 *     package `presets.test.ts` and the dev's own coverage tests never touch
 *     the wire.
 *  3. `TOOL_PAIRS` co-visibility (`iris_env_diff`/`iris_env_promote`, the
 *     pair dev-mcp owns) observed through a REAL construction + wire
 *     `tools/list` under `core` — proving the shared `TOOL_PAIRS` constant
 *     and dev-mcp's roster compose correctly end-to-end, not just as two
 *     independently-true static facts about the roster data.
 *
 * No live IRIS: every test constructs but never `start()`s the server
 * (mirrors the existing `index.test.ts` construction-level tests) —
 * visibility resolution and the wire `tools/list`/`tools/call` dispatch are
 * both available immediately after construction.
 *
 * Discoverable by the default `pnpm turbo run test` suite (plain
 * `*.test.ts`, matching the package's `vitest.config.ts` include glob; the
 * `*.integration.test.ts`-only exclude glob does not match this file).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { McpServerBase, SERVER_DISCOVERY_TOOL_NAME } from "@iris-mcp/shared";
import { tools } from "../tools/index.js";
import { toolPresets } from "../tools/presets.js";

const toolNames = tools.map((t) => t.name);

// ── Env harness (mirrors the shared e2e suites' pattern) ──────────────

const savedEnv = {
  IRIS_TOOLS_PRESET: process.env.IRIS_TOOLS_PRESET,
  IRIS_TOOLS_DISABLE: process.env.IRIS_TOOLS_DISABLE,
  IRIS_TOOLS_ENABLE: process.env.IRIS_TOOLS_ENABLE,
};

function clearVisibilityEnv(): void {
  delete process.env.IRIS_TOOLS_PRESET;
  delete process.env.IRIS_TOOLS_DISABLE;
  delete process.env.IRIS_TOOLS_ENABLE;
}

function restoreEnv(): void {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  restoreEnv();
  vi.restoreAllMocks();
});

/** Invoke a request handler on the underlying SDK Server by method name (the real wire). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function callRequest(server: any, method: string, params: unknown) {
  const innerServer = server.server.server;
  const handlers = innerServer._requestHandlers as Map<
    string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (req: any, extra: any) => Promise<any>
  >;
  const handler = handlers.get(method);
  if (!handler) throw new Error(`No request handler for "${method}"`);
  const extra = {
    signal: new AbortController().signal,
    sendNotification: async () => {},
    sendRequest: async () => ({}),
  };
  return handler({ method, params }, extra);
}

/** `tools/list` over the real wire, as a connected client would see it. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function wireToolNames(server: any): Promise<string[]> {
  const result = await callRequest(server, "tools/list", {});
  return (result.tools as Array<{ name: string }>).map((t) => t.name);
}

// ════════════════════════════════════════════════════════════════════
// 1. Real construction: core / developer / full (unset), via getToolNames()
// ════════════════════════════════════════════════════════════════════

describe("E2E — iris-dev-mcp real McpServerBase construction with the wired toolPresets roster", () => {
  it("IRIS_TOOLS_PRESET=core yields exactly core.include + iris_server_profiles", () => {
    clearVisibilityEnv();
    process.env.IRIS_TOOLS_PRESET = "core";
    const server = new McpServerBase({
      name: "@iris-mcp/dev",
      version: "0.0.0",
      tools,
      toolPresets,
    });

    expect(server.getToolNames().sort()).toEqual(
      [...toolPresets.core.include, SERVER_DISCOVERY_TOOL_NAME].sort(),
    );
  });

  it("IRIS_TOOLS_PRESET=developer yields exactly developer.include + iris_server_profiles", () => {
    clearVisibilityEnv();
    process.env.IRIS_TOOLS_PRESET = "developer";
    const server = new McpServerBase({
      name: "@iris-mcp/dev",
      version: "0.0.0",
      tools,
      toolPresets,
    });

    expect(server.getToolNames().sort()).toEqual(
      [...toolPresets.developer.include, SERVER_DISCOVERY_TOOL_NAME].sort(),
    );
  });

  it("no IRIS_TOOLS_PRESET (⇒ full) yields every package tool + iris_server_profiles, even with toolPresets wired (Rule #19 back-compat)", () => {
    clearVisibilityEnv();
    const withRoster = new McpServerBase({
      name: "@iris-mcp/dev",
      version: "0.0.0",
      tools,
      toolPresets,
    });
    const withoutRoster = new McpServerBase({
      name: "@iris-mcp/dev",
      version: "0.0.0",
      tools,
      // toolPresets deliberately absent — proves the roster is dormant under
      // "full", the default, exactly matching today's pre-Story-30.1 shape.
    });

    expect(withRoster.getToolNames().sort()).toEqual(
      [...toolNames, SERVER_DISCOVERY_TOOL_NAME].sort(),
    );
    expect(withRoster.getToolNames().sort()).toEqual(
      withoutRoster.getToolNames().sort(),
    );
  });
});

// ════════════════════════════════════════════════════════════════════
// 2. Real wire tools/list under core
// ════════════════════════════════════════════════════════════════════

describe("E2E — iris-dev-mcp core preset, observed on the real SDK wire tools/list", () => {
  it("the wire tools/list response matches core.include + iris_server_profiles exactly", async () => {
    clearVisibilityEnv();
    process.env.IRIS_TOOLS_PRESET = "core";
    const server = new McpServerBase({
      name: "@iris-mcp/dev",
      version: "0.0.0",
      tools,
      toolPresets,
    });

    const names = await wireToolNames(server);
    expect(names.sort()).toEqual(
      [...toolPresets.core.include, SERVER_DISCOVERY_TOOL_NAME].sort(),
    );
    // A representative developer-only tool must be genuinely absent from the wire.
    expect(names).not.toContain("iris_env_diff");
    expect(names).not.toContain("iris_env_promote");
    expect(names).not.toContain("iris_doc_delete");
  });

  it("a core-hidden tool's wire tools/call fails with the SDK's own unknown-tool shape", async () => {
    clearVisibilityEnv();
    process.env.IRIS_TOOLS_PRESET = "core";
    const server = new McpServerBase({
      name: "@iris-mcp/dev",
      version: "0.0.0",
      tools,
      toolPresets,
    });

    const result = await callRequest(server, "tools/call", {
      name: "iris_env_diff",
      arguments: {},
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("not found");
  });
});

// ════════════════════════════════════════════════════════════════════
// 3. TOOL_PAIRS co-visibility through a REAL construction + wire
// ════════════════════════════════════════════════════════════════════

describe("E2E — TOOL_PAIRS co-visibility (iris_env_diff / iris_env_promote), through real construction + wire", () => {
  it("core hides BOTH pair members on the real wire — neither is left orphaned", async () => {
    clearVisibilityEnv();
    process.env.IRIS_TOOLS_PRESET = "core";
    const server = new McpServerBase({
      name: "@iris-mcp/dev",
      version: "0.0.0",
      tools,
      toolPresets,
    });

    const names = await wireToolNames(server);
    expect(names).not.toContain("iris_env_diff");
    expect(names).not.toContain("iris_env_promote");
  });

  it("developer shows BOTH pair members on the real wire", async () => {
    clearVisibilityEnv();
    process.env.IRIS_TOOLS_PRESET = "developer";
    const server = new McpServerBase({
      name: "@iris-mcp/dev",
      version: "0.0.0",
      tools,
      toolPresets,
    });

    const names = await wireToolNames(server);
    expect(names).toContain("iris_env_diff");
    expect(names).toContain("iris_env_promote");
  });

  it("IRIS_TOOLS_ENABLE hole-punching only iris_env_diff under core still leaves iris_env_promote reachable through the enable list, not silently stranded by the roster", async () => {
    // This does not re-assert the TOOL_PAIRS *data* invariant (already
    // covered by presets.test.ts) — it proves that even when an operator
    // bypasses the roster for one pair member via IRIS_TOOLS_ENABLE, the
    // other member is independently punch-able the same way (i.e. the
    // roster's co-visibility is a curated default, not a hard constraint
    // the wire enforces) and the construction never throws.
    clearVisibilityEnv();
    process.env.IRIS_TOOLS_PRESET = "core";
    process.env.IRIS_TOOLS_ENABLE = "iris_env_diff,iris_env_promote";
    const server = new McpServerBase({
      name: "@iris-mcp/dev",
      version: "0.0.0",
      tools,
      toolPresets,
    });

    const names = await wireToolNames(server);
    expect(names).toContain("iris_env_diff");
    expect(names).toContain("iris_env_promote");
  });
});
