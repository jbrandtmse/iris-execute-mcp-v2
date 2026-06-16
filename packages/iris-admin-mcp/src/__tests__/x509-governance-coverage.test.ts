/**
 * Story 15.3 AC 15.3.2 / 15.3.9 — `iris_x509_manage` governance coverage gaps.
 *
 * Complementary to the dev's `x509-governance.test.ts`, which proves (through the
 * REAL `McpServerBase.handleToolCall` gate, default suite): `import` denied,
 * `delete` denied, `list`/`get` allowed, and a GLOBAL opt-in of `import` flips
 * that one write while `delete` stays denied.
 *
 * This suite covers the points that suite did not:
 *
 *   GATE (real `McpServerBase.handleToolCall`):
 *   - the MIRROR-IMAGE opt-in: a GLOBAL opt-in of `delete` (the OTHER write — the
 *     dev only opted `import` in) flips `delete` to allowed while `import` stays
 *     denied (per-action granularity, proved from the other side).
 *   - reads (`list`/`get`) stay allowed EVEN WHEN a partial IRIS_GOVERNANCE is
 *     present that only toggles a write — a non-empty config does not accidentally
 *     gate the always-on reads. (The dev proved reads under EMPTY config only.)
 *   - the gate forwards the FULL import args (incl. the write-only `certificate`
 *     and `privateKey`) to the now-allowed handler — proving the gate is a
 *     pass-through, not a filter, once a write is enabled.
 *
 *   ENGINE (pure `defaultSeed` / `buildMutatesLookup` against the REAL frozen
 *   `GOVERNANCE_BASELINE` — like Story 15.2's engine-level back-compat proof):
 *   - the four x509 keys are NOT in the frozen Epic-14 baseline (the back-compat
 *     invariant, AC 15.3.9) and resolve by `mutates`: the two reads
 *     default-ENABLED, the two writes default-DISABLED.
 *   - the baseline is the frozen `1e62c5ad5bf7` (141 keys) — unchanged by this
 *     tool (AC 15.3.9).
 *   - the tool's own `mutates` map registers cleanly through `buildMutatesLookup`
 *     (no reserved/typo classification) and yields EXACTLY the four expected keys
 *     (no bare `iris_x509_manage`, no extras).
 *
 * No live IRIS; the default profile's startup HEAD/GET are stubbed; the gate
 * handler is a spy so we can assert invocation/non-invocation and inspect args.
 * Default vitest suite (`*.test.ts`, NOT `.integration.test.ts`).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  McpServerBase,
  buildMutatesLookup,
  defaultSeed,
  GOVERNANCE_BASELINE,
  GOVERNANCE_BASELINE_HASH,
} from "@iris-mcp/shared";
import type { McpServerBaseOptions, ToolDefinition } from "@iris-mcp/shared";
import { x509ManageTool } from "../tools/x509.js";

// ── Harness (mirrors x509-governance.test.ts) ───────────────────────────

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function callTool(server: any, name: string, args: unknown) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sdkTools = (server.server as any)._registeredTools;
  const entry = sdkTools[name];
  const callback = entry.callback ?? entry.handler ?? entry.cb;
  return callback(args);
}

function makeServerOpts(tools: ToolDefinition[]): McpServerBaseOptions {
  return {
    name: "@iris-mcp/admin",
    version: "0.0.0",
    tools,
    needsCustomRest: false,
  };
}

function spiedX509Tool(spy: ReturnType<typeof vi.fn>): ToolDefinition {
  return { ...x509ManageTool, handler: spy };
}

function makeEnvHarness() {
  let fetchMock: ReturnType<typeof vi.fn>;
  const originalFetch = globalThis.fetch;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let exitMock: any;
  const savedEnv = {
    IRIS_USERNAME: process.env.IRIS_USERNAME,
    IRIS_PASSWORD: process.env.IRIS_PASSWORD,
    IRIS_HOST: process.env.IRIS_HOST,
    IRIS_NAMESPACE: process.env.IRIS_NAMESPACE,
    IRIS_PROFILES: process.env.IRIS_PROFILES,
    IRIS_GOVERNANCE: process.env.IRIS_GOVERNANCE,
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
    delete process.env.IRIS_GOVERNANCE;
    delete process.env.IRIS_PROFILES;
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

function stageDefaultStartup(fetchMock: ReturnType<typeof vi.fn>): void {
  fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
  fetchMock.mockResolvedValueOnce(versionResponse());
}

// ════════════════════════════════════════════════════════════════════════
// GATE coverage — real McpServerBase.handleToolCall
// ════════════════════════════════════════════════════════════════════════

describe("iris_x509_manage governance coverage — gate (AC 15.3.2 gaps)", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  it("a GLOBAL opt-in of `delete` flips it to allowed while `import` stays denied", async () => {
    process.env.IRIS_GOVERNANCE = JSON.stringify({
      global: { "iris_x509_manage:delete": true },
    });
    stageDefaultStartup(env.fetchMock);

    const handlerSpy = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "ran" }],
      structuredContent: { action: "deleted", alias: "old-cert" },
    }));
    const server = new McpServerBase(makeServerOpts([spiedX509Tool(handlerSpy)]));
    await server.start("stdio");

    const result = await callTool(server, "iris_x509_manage", {
      action: "delete",
      alias: "old-cert",
    });

    expect(result.isError).toBeFalsy();
    expect(handlerSpy).toHaveBeenCalledTimes(1);
    const [forwardedArgs] = handlerSpy.mock.calls[0] as unknown as [
      { action: string; alias: string },
    ];
    expect(forwardedArgs.action).toBe("delete");
    expect(forwardedArgs.alias).toBe("old-cert");

    // `import` was NOT opted in → still denied (per-action granularity).
    const denied = await callTool(server, "iris_x509_manage", {
      action: "import",
      alias: "cert",
      certificate: "TUlJQg==",
    });
    expect(denied.isError).toBe(true);
    expect(denied.structuredContent).toMatchObject({
      code: "GOVERNANCE_DISABLED",
      action: "iris_x509_manage:import",
    });
    expect(handlerSpy).toHaveBeenCalledTimes(1);
  });

  it("an enabled `import` receives the full args (certificate + write-only privateKey) intact", async () => {
    process.env.IRIS_GOVERNANCE = JSON.stringify({
      global: { "iris_x509_manage:import": true },
    });
    stageDefaultStartup(env.fetchMock);

    const handlerSpy = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "ran" }],
      structuredContent: { action: "imported", success: true },
    }));
    const server = new McpServerBase(makeServerOpts([spiedX509Tool(handlerSpy)]));
    await server.start("stdio");

    const result = await callTool(server, "iris_x509_manage", {
      action: "import",
      alias: "with-key",
      certificate: "TUlJQg==",
      privateKey: "a2V5",
      privateKeyPassword: "pw",
    });

    expect(result.isError).toBeFalsy();
    expect(handlerSpy).toHaveBeenCalledTimes(1);
    // The gate is a pass-through: every arg (incl. the write-only key material)
    // is forwarded verbatim to the now-allowed handler — the gate gates, it does
    // not filter args.
    const [forwardedArgs] = handlerSpy.mock.calls[0] as unknown as [
      {
        action: string;
        alias: string;
        certificate: string;
        privateKey: string;
        privateKeyPassword: string;
      },
    ];
    expect(forwardedArgs.certificate).toBe("TUlJQg==");
    expect(forwardedArgs.privateKey).toBe("a2V5");
    expect(forwardedArgs.privateKeyPassword).toBe("pw");
  });

  it("reads (list/get) stay allowed even when a partial IRIS_GOVERNANCE only toggles a write", async () => {
    // A config that opts a single write in must not disturb the always-on reads.
    process.env.IRIS_GOVERNANCE = JSON.stringify({
      global: { "iris_x509_manage:import": true },
    });
    stageDefaultStartup(env.fetchMock);

    const handlerSpy = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "ran" }],
      structuredContent: { credentials: [], count: 0 },
    }));
    const server = new McpServerBase(makeServerOpts([spiedX509Tool(handlerSpy)]));
    await server.start("stdio");

    const listed = await callTool(server, "iris_x509_manage", { action: "list" });
    const got = await callTool(server, "iris_x509_manage", {
      action: "get",
      alias: "server-cert",
    });

    expect(listed.isError).toBeFalsy();
    expect(got.isError).toBeFalsy();
    expect(handlerSpy).toHaveBeenCalledTimes(2);
  });
});

// ════════════════════════════════════════════════════════════════════════
// ENGINE coverage — defaultSeed / buildMutatesLookup vs the frozen baseline
// ════════════════════════════════════════════════════════════════════════

describe("iris_x509_manage governance coverage — engine + back-compat (AC 15.3.9)", () => {
  const X509_KEYS = [
    "iris_x509_manage:list",
    "iris_x509_manage:get",
    "iris_x509_manage:import",
    "iris_x509_manage:delete",
  ] as const;

  it("the frozen Epic-14 baseline is unchanged (141 keys, hash 1e62c5ad5bf7)", () => {
    expect(GOVERNANCE_BASELINE.size).toBe(141);
    expect(GOVERNANCE_BASELINE_HASH).toBe("1e62c5ad5bf7");
  });

  it("none of the four x509 keys are in the frozen baseline (new keys → opt-in writes)", () => {
    for (const key of X509_KEYS) {
      expect(GOVERNANCE_BASELINE.has(key), `${key} must NOT be baselined`).toBe(
        false,
      );
    }
    // Defensive: no x509 key sneaked in under a different spelling.
    for (const key of GOVERNANCE_BASELINE) {
      expect(key.toLowerCase()).not.toContain("x509");
    }
  });

  it("buildMutatesLookup yields exactly the four expected key classifications", () => {
    const lookup = buildMutatesLookup([x509ManageTool]);
    expect(lookup.get("iris_x509_manage:list")).toBe("read");
    expect(lookup.get("iris_x509_manage:get")).toBe("read");
    expect(lookup.get("iris_x509_manage:import")).toBe("write");
    expect(lookup.get("iris_x509_manage:delete")).toBe("write");
    // No bare `iris_x509_manage` key (the tool has an action enum) and no extras.
    expect(lookup.has("iris_x509_manage")).toBe(false);
    const x509Entries = [...lookup.keys()].filter((k) =>
      k.startsWith("iris_x509_manage"),
    );
    expect(x509Entries.sort()).toEqual([...X509_KEYS].sort());
  });

  it("defaultSeed: reads default-ENABLED; writes default-DISABLED", () => {
    const lookup = buildMutatesLookup([x509ManageTool]);
    // Reads — enabled by default (back-compat: behave as today).
    expect(defaultSeed("iris_x509_manage:list", lookup)).toBe(true);
    expect(defaultSeed("iris_x509_manage:get", lookup)).toBe(true);
    // Writes — opt-in, disabled until enabled via IRIS_GOVERNANCE.
    expect(defaultSeed("iris_x509_manage:import", lookup)).toBe(false);
    expect(defaultSeed("iris_x509_manage:delete", lookup)).toBe(false);
  });
});
