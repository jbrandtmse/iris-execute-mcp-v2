/**
 * Story 15.4 AC 15.4.2 / 15.4.8 — `iris_audit_manage` governance coverage gaps.
 *
 * Complementary to the dev's `audit-governance.test.ts`, which proves (through
 * the REAL `McpServerBase.handleToolCall` gate, default suite): all five writes
 * (enable/disable/configureEvent/purge/export) denied under empty config, the
 * two reads (status/view) allowed, and a GLOBAL opt-in of `purge` flips that one
 * write while `export` stays denied.
 *
 * This suite covers the points that suite did not:
 *
 *   GATE (real `McpServerBase.handleToolCall`):
 *   - the MIRROR-IMAGE opt-in: a GLOBAL opt-in of `export` (a DIFFERENT write —
 *     the dev only opted `purge` in) flips `export` to allowed while every OTHER
 *     write (enable/disable/configureEvent/purge) stays denied — per-action
 *     granularity proved from the other side, across all four siblings.
 *   - reads (`status`/`view`) stay allowed EVEN WHEN a partial IRIS_GOVERNANCE
 *     is present that only toggles a write — a non-empty config does not
 *     accidentally gate the always-on reads. (The dev proved reads under EMPTY
 *     config only.)
 *   - the gate forwards the FULL purge args (incl. `confirm` + the bound) to the
 *     now-allowed handler — proving the gate is a pass-through, not a filter,
 *     once a write is enabled. The handler-side confirm/bound guard is therefore
 *     still reachable behind the gate.
 *
 *   ENGINE (pure `defaultSeed` / `buildMutatesLookup` against the REAL frozen
 *   `GOVERNANCE_BASELINE` — like Stories 15.2/15.3 engine-level back-compat
 *   proof):
 *   - the seven audit keys are NOT in the frozen Epic-14 baseline (the
 *     back-compat invariant, AC 15.4.8) and resolve by `mutates`: the two reads
 *     default-ENABLED, the five writes default-DISABLED.
 *   - the baseline is the frozen `1e62c5ad5bf7` (141 keys) — unchanged by this
 *     tool (AC 15.4.8).
 *   - the tool's own `mutates` map registers cleanly through `buildMutatesLookup`
 *     and yields EXACTLY the seven expected keys (no bare `iris_audit_manage`,
 *     no extras).
 *   - the existing read-only `iris_audit_events` (ops) tool is ADDITIVE-only:
 *     none of its conceptual key shapes are touched, and the audit-manage keys
 *     do not collide with it (sanity that this story is purely additive,
 *     AC 15.4.8).
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
import { auditManageTool } from "../tools/audit.js";

// ── Harness (mirrors audit-governance.test.ts) ──────────────────────────

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

function spiedAuditTool(spy: ReturnType<typeof vi.fn>): ToolDefinition {
  return { ...auditManageTool, handler: spy };
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

describe("iris_audit_manage governance coverage — gate (AC 15.4.2 gaps)", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  it("a GLOBAL opt-in of `export` flips it while every other write stays denied", async () => {
    process.env.IRIS_GOVERNANCE = JSON.stringify({
      global: { "iris_audit_manage:export": true },
    });
    stageDefaultStartup(env.fetchMock);

    const handlerSpy = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "ran" }],
      structuredContent: { action: "export", location: "x/dump.xml", exported: 3 },
    }));
    const server = new McpServerBase(
      makeServerOpts([spiedAuditTool(handlerSpy)]),
    );
    await server.start("stdio");

    // `export` is now allowed → handler runs.
    const allowed = await callTool(server, "iris_audit_manage", {
      action: "export",
      fileName: "dump.xml",
    });
    expect(allowed.isError).toBeFalsy();
    expect(handlerSpy).toHaveBeenCalledTimes(1);

    // Every OTHER write stays denied (per-action granularity, all four siblings).
    const stillDenied: Array<{ action: string; args: Record<string, unknown> }> =
      [
        { action: "enable", args: { action: "enable" } },
        { action: "disable", args: { action: "disable" } },
        {
          action: "configureEvent",
          args: {
            action: "configureEvent",
            source: "%System",
            type: "%Login",
            name: "Login",
            enabled: false,
          },
        },
        {
          action: "purge",
          args: { action: "purge", confirm: true, end: "2026-01-01 00:00:00" },
        },
      ];
    for (const { action, args } of stillDenied) {
      const denied = await callTool(server, "iris_audit_manage", args);
      expect(denied.isError, `${action} must stay denied`).toBe(true);
      expect(denied.structuredContent).toMatchObject({
        code: "GOVERNANCE_DISABLED",
        action: `iris_audit_manage:${action}`,
      });
    }
    // Only the single `export` call reached the handler.
    expect(handlerSpy).toHaveBeenCalledTimes(1);
  });

  it("reads (status/view) stay allowed even when a partial IRIS_GOVERNANCE only toggles a write", async () => {
    process.env.IRIS_GOVERNANCE = JSON.stringify({
      global: { "iris_audit_manage:purge": true },
    });
    stageDefaultStartup(env.fetchMock);

    const handlerSpy = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "ran" }],
      structuredContent: { auditEnabled: true, events: [] },
    }));
    const server = new McpServerBase(
      makeServerOpts([spiedAuditTool(handlerSpy)]),
    );
    await server.start("stdio");

    const statusRes = await callTool(server, "iris_audit_manage", {
      action: "status",
    });
    const viewRes = await callTool(server, "iris_audit_manage", {
      action: "view",
    });

    expect(statusRes.isError).toBeFalsy();
    expect(viewRes.isError).toBeFalsy();
    expect(handlerSpy).toHaveBeenCalledTimes(2);
  });

  it("an enabled `purge` receives the full args (confirm + bound) intact — gate is a pass-through", async () => {
    process.env.IRIS_GOVERNANCE = JSON.stringify({
      global: { "iris_audit_manage:purge": true },
    });
    stageDefaultStartup(env.fetchMock);

    const handlerSpy = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "ran" }],
      structuredContent: { action: "purge", deleted: 4, success: true },
    }));
    const server = new McpServerBase(
      makeServerOpts([spiedAuditTool(handlerSpy)]),
    );
    await server.start("stdio");

    const result = await callTool(server, "iris_audit_manage", {
      action: "purge",
      confirm: true,
      end: "2026-01-01 00:00:00",
      user: "alice",
    });

    expect(result.isError).toBeFalsy();
    expect(handlerSpy).toHaveBeenCalledTimes(1);
    const [forwardedArgs] = handlerSpy.mock.calls[0] as unknown as [
      { action: string; confirm: boolean; end: string; user: string },
    ];
    // The gate forwards every arg verbatim (it gates, it does not filter args) —
    // so the handler-side confirm/bound guard remains reachable behind the gate.
    expect(forwardedArgs.action).toBe("purge");
    expect(forwardedArgs.confirm).toBe(true);
    expect(forwardedArgs.end).toBe("2026-01-01 00:00:00");
    expect(forwardedArgs.user).toBe("alice");
  });
});

// ════════════════════════════════════════════════════════════════════════
// ENGINE coverage — defaultSeed / buildMutatesLookup vs the frozen baseline
// ════════════════════════════════════════════════════════════════════════

describe("iris_audit_manage governance coverage — engine + back-compat (AC 15.4.8)", () => {
  const AUDIT_READ_KEYS = [
    "iris_audit_manage:status",
    "iris_audit_manage:view",
  ] as const;
  const AUDIT_WRITE_KEYS = [
    "iris_audit_manage:enable",
    "iris_audit_manage:disable",
    "iris_audit_manage:configureEvent",
    "iris_audit_manage:purge",
    "iris_audit_manage:export",
  ] as const;
  const AUDIT_KEYS = [...AUDIT_READ_KEYS, ...AUDIT_WRITE_KEYS] as const;

  it("the frozen Epic-14 baseline is unchanged (141 keys, hash 1e62c5ad5bf7)", () => {
    expect(GOVERNANCE_BASELINE.size).toBe(141);
    expect(GOVERNANCE_BASELINE_HASH).toBe("1e62c5ad5bf7");
  });

  it("none of the seven audit-manage keys are in the frozen baseline (new keys → opt-in writes)", () => {
    for (const key of AUDIT_KEYS) {
      expect(GOVERNANCE_BASELINE.has(key), `${key} must NOT be baselined`).toBe(
        false,
      );
    }
    // Defensive: no audit-manage key sneaked in under a different spelling.
    for (const key of GOVERNANCE_BASELINE) {
      expect(key).not.toContain("iris_audit_manage");
    }
  });

  it("buildMutatesLookup yields exactly the seven expected key classifications", () => {
    const lookup = buildMutatesLookup([auditManageTool]);
    for (const key of AUDIT_READ_KEYS) {
      expect(lookup.get(key), `${key} → read`).toBe("read");
    }
    for (const key of AUDIT_WRITE_KEYS) {
      expect(lookup.get(key), `${key} → write`).toBe("write");
    }
    // No bare `iris_audit_manage` key (the tool has an action enum) and no extras.
    expect(lookup.has("iris_audit_manage")).toBe(false);
    const auditEntries = [...lookup.keys()].filter((k) =>
      k.startsWith("iris_audit_manage"),
    );
    expect(auditEntries.sort()).toEqual([...AUDIT_KEYS].sort());
  });

  it("defaultSeed: the two reads default-ENABLED; the five writes default-DISABLED", () => {
    const lookup = buildMutatesLookup([auditManageTool]);
    for (const key of AUDIT_READ_KEYS) {
      expect(defaultSeed(key, lookup), `${key} default-enabled`).toBe(true);
    }
    for (const key of AUDIT_WRITE_KEYS) {
      expect(defaultSeed(key, lookup), `${key} default-disabled`).toBe(false);
    }
  });

  it("the audit-manage keys do not collide with the existing iris_audit_events tool (additive only, AC 15.4.8)", () => {
    // `iris_audit_events` (ops) is a distinct tool name; no audit-manage key
    // shares its identity, so this story cannot silently alter it.
    for (const key of AUDIT_KEYS) {
      expect(key.startsWith("iris_audit_events")).toBe(false);
    }
    // And the baseline (Epic-14 frozen surface) does not contain audit-manage.
    expect([...GOVERNANCE_BASELINE].some((k) => k.startsWith("iris_audit_manage"))).toBe(
      false,
    );
  });
});
