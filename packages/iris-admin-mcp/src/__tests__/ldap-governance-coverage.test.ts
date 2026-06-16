/**
 * Story 15.2 AC 15.2.2 / 15.2.5 / 15.2.9 — `iris_ldap_manage` governance
 * coverage gaps.
 *
 * Complementary to the dev's `ldap-governance.test.ts`, which proves (through the
 * REAL `McpServerBase.handleToolCall` gate, default suite): `create` denied,
 * `modify`/`delete` denied, `list`/`get`/`test` allowed, and a GLOBAL opt-in of
 * `create` flips that one write while `delete` stays denied.
 *
 * This suite covers the points that suite did not:
 *
 *   GATE (real `McpServerBase.handleToolCall`):
 *   - a GLOBAL opt-in of `modify` (the OTHER settings-bearing write — the dev
 *     only opted `create` in) flips `modify` to allowed AND the handler receives
 *     the `settings` object intact (proving the gate forwards the full args once
 *     allowed), while `create`/`delete` stay denied (per-action granularity).
 *   - reads (`list`/`get`/`test`) stay allowed EVEN WHEN a partial
 *     IRIS_GOVERNANCE is present that only toggles a write — a non-empty config
 *     does not accidentally gate the always-on reads. This nails `test`
 *     specifically (the scoped-down config-validity read) staying ungated.
 *
 *   ENGINE (pure `defaultSeed` / `buildMutatesLookup` against the REAL frozen
 *   `GOVERNANCE_BASELINE`):
 *   - the six ldap keys are NOT in the frozen Epic-14 baseline (the back-compat
 *     invariant, AC 15.2.9) and resolve by `mutates`: the three reads
 *     (incl. `test`) default-ENABLED, the three writes default-DISABLED.
 *   - the baseline hash is the frozen `1e62c5ad5bf7` (141 keys) — unchanged by
 *     this tool (AC 15.2.9).
 *   - the tool's own `mutates` map registers cleanly through `buildMutatesLookup`
 *     (no reserved/typo classification) and yields exactly the six expected keys.
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
import { ldapManageTool } from "../tools/ldap.js";

// ── Harness (mirrors ldap-governance.test.ts) ───────────────────────────

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

function spiedLdapTool(spy: ReturnType<typeof vi.fn>): ToolDefinition {
  return { ...ldapManageTool, handler: spy };
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

describe("iris_ldap_manage governance coverage — gate (AC 15.2.2 gaps)", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  it("a GLOBAL opt-in of `modify` flips it to allowed and forwards `settings` intact", async () => {
    process.env.IRIS_GOVERNANCE = JSON.stringify({
      global: { "iris_ldap_manage:modify": true },
    });
    stageDefaultStartup(env.fetchMock);

    const handlerSpy = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "ran" }],
      structuredContent: { action: "modified", success: true },
    }));
    const server = new McpServerBase(makeServerOpts([spiedLdapTool(handlerSpy)]));
    await server.start("stdio");

    const settings = { description: "Updated", ldapFlags: 89 };
    const result = await callTool(server, "iris_ldap_manage", {
      action: "modify",
      name: "workgroup.com",
      settings,
    });

    expect(result.isError).toBeFalsy();
    expect(handlerSpy).toHaveBeenCalledTimes(1);
    // The gate forwarded the full args (incl. settings) to the now-allowed write.
    const [forwardedArgs] = handlerSpy.mock.calls[0] as unknown as [
      { action: string; name: string; settings: typeof settings },
    ];
    expect(forwardedArgs.action).toBe("modify");
    expect(forwardedArgs.name).toBe("workgroup.com");
    expect(forwardedArgs.settings).toEqual(settings);

    // `create` and `delete` were NOT opted in → still denied (per-action).
    for (const action of ["create", "delete"]) {
      const denied = await callTool(server, "iris_ldap_manage", {
        action,
        name: "workgroup.com",
        ...(action === "create"
          ? { settings: { ldapBaseDN: "DC=x,DC=com" } }
          : {}),
      });
      expect(denied.isError, `${action} must stay denied`).toBe(true);
      expect(denied.structuredContent).toMatchObject({
        code: "GOVERNANCE_DISABLED",
        action: `iris_ldap_manage:${action}`,
      });
    }
    expect(handlerSpy).toHaveBeenCalledTimes(1);
  });

  it("reads (list/get/test) stay allowed even when a partial IRIS_GOVERNANCE only toggles a write", async () => {
    // A config that opts a single write in must not disturb the always-on reads —
    // in particular the scoped-down `test` config-validity read.
    process.env.IRIS_GOVERNANCE = JSON.stringify({
      global: { "iris_ldap_manage:delete": true },
    });
    stageDefaultStartup(env.fetchMock);

    const handlerSpy = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "ran" }],
      structuredContent: { configs: [], count: 0 },
    }));
    const server = new McpServerBase(makeServerOpts([spiedLdapTool(handlerSpy)]));
    await server.start("stdio");

    await callTool(server, "iris_ldap_manage", { action: "list" });
    const got = await callTool(server, "iris_ldap_manage", {
      action: "get",
      name: "workgroup.com",
    });
    const tested = await callTool(server, "iris_ldap_manage", {
      action: "test",
      name: "workgroup.com",
    });

    expect(got.isError).toBeFalsy();
    expect(tested.isError).toBeFalsy();
    expect(handlerSpy).toHaveBeenCalledTimes(3);
  });
});

// ════════════════════════════════════════════════════════════════════════
// ENGINE coverage — defaultSeed / buildMutatesLookup vs the frozen baseline
// ════════════════════════════════════════════════════════════════════════

describe("iris_ldap_manage governance coverage — engine + back-compat (AC 15.2.9)", () => {
  const LDAP_KEYS = [
    "iris_ldap_manage:list",
    "iris_ldap_manage:get",
    "iris_ldap_manage:test",
    "iris_ldap_manage:create",
    "iris_ldap_manage:modify",
    "iris_ldap_manage:delete",
  ] as const;

  it("the frozen Epic-14 baseline is unchanged (141 keys, hash 1e62c5ad5bf7)", () => {
    expect(GOVERNANCE_BASELINE.size).toBe(141);
    expect(GOVERNANCE_BASELINE_HASH).toBe("1e62c5ad5bf7");
  });

  it("none of the six ldap keys are in the frozen baseline (new keys → opt-in writes)", () => {
    for (const key of LDAP_KEYS) {
      expect(GOVERNANCE_BASELINE.has(key), `${key} must NOT be baselined`).toBe(
        false,
      );
    }
    // Defensive: no LDAP key sneaked in under a different spelling.
    for (const key of GOVERNANCE_BASELINE) {
      expect(key.toLowerCase()).not.toContain("ldap");
    }
  });

  it("buildMutatesLookup yields exactly the six expected key classifications", () => {
    const lookup = buildMutatesLookup([ldapManageTool]);
    expect(lookup.get("iris_ldap_manage:list")).toBe("read");
    expect(lookup.get("iris_ldap_manage:get")).toBe("read");
    expect(lookup.get("iris_ldap_manage:test")).toBe("read");
    expect(lookup.get("iris_ldap_manage:create")).toBe("write");
    expect(lookup.get("iris_ldap_manage:modify")).toBe("write");
    expect(lookup.get("iris_ldap_manage:delete")).toBe("write");
    // No bare `iris_ldap_manage` key (the tool has an action enum) and no extras.
    expect(lookup.has("iris_ldap_manage")).toBe(false);
    const ldapEntries = [...lookup.keys()].filter((k) =>
      k.startsWith("iris_ldap_manage"),
    );
    expect(ldapEntries.sort()).toEqual([...LDAP_KEYS].sort());
  });

  it("defaultSeed: reads (incl. test) default-ENABLED; writes default-DISABLED", () => {
    const lookup = buildMutatesLookup([ldapManageTool]);
    // Reads — including the scoped-down `test` (AC 15.2.5 → classified read).
    expect(defaultSeed("iris_ldap_manage:list", lookup)).toBe(true);
    expect(defaultSeed("iris_ldap_manage:get", lookup)).toBe(true);
    expect(defaultSeed("iris_ldap_manage:test", lookup)).toBe(true);
    // Writes — opt-in, disabled until enabled via IRIS_GOVERNANCE.
    expect(defaultSeed("iris_ldap_manage:create", lookup)).toBe(false);
    expect(defaultSeed("iris_ldap_manage:modify", lookup)).toBe(false);
    expect(defaultSeed("iris_ldap_manage:delete", lookup)).toBe(false);
  });
});
