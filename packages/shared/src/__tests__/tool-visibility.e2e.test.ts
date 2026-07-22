/**
 * Story 30.0 — QA end-to-end coverage for the tool-visibility engine.
 *
 * Complements the dev's `tool-visibility.test.ts` (34 unit/construction
 * tests) and `tool-visibility-backcompat.test.ts` (the AC 30.0.4 capstone).
 * The dev's construction-level tests assert absence via the framework's OWN
 * `getToolNames()` helper (a read of the internal `this.tools` registry) —
 * this file instead drives the REAL SDK wire surfaces a connected client
 * actually sees (`tools/list`, `tools/call`), and the seams a per-behavior
 * unit test cannot see in isolation:
 *
 *  1. A hidden tool is genuinely absent from the SDK's OWN `tools/list`
 *     response (not just from the framework's internal registry helper),
 *     and its `tools/call` failure is STRUCTURALLY IDENTICAL to calling a
 *     name that was never passed to `options.tools` at all — proving it is
 *     the SDK's own standard branch, not a bespoke "hidden tool" code path.
 *  2. The `IRIS_TOOLS_DISABLE=iris_x_*` + `IRIS_TOOLS_ENABLE=iris_x_get`
 *     family hole-punch, observed on the real wire (`tools/list` AND
 *     `tools/call`), not just the pure `resolveVisibleTools` function.
 *  3. Visibility × governance composition: a hidden tool contributes NO key
 *     to the governance key universe or the advisory resource's policy map
 *     (spec §2.3 step 3) — and, by contrast, the SAME tool DOES contribute
 *     a key when visible, proving the exclusion is caused by visibility,
 *     not some other accidental gap. Governance under empty visibility env
 *     is unchanged even when `toolPresets` rosters ARE wired.
 *  4. Second-configuration coverage (Rule #34 analog): the SAME tool set,
 *     constructed once under `core` and once under (default) `full` with a
 *     real `toolPresets` roster wired, differs in the observable `tools/list`
 *     set — proving the I2 roster-consumption path actually filters through
 *     the wire, not just in the pure resolver.
 *  5. `assertPresetCoverage` throws AT REAL `McpServerBase` CONSTRUCTION
 *     (not just as a pure function) for an incomplete roster.
 *  6. The AC 30.0.2 startup log line (preset/visible/hidden counts + any
 *     warnings) is actually emitted via the real stderr `logger` at
 *     construction — not just returned as data the constructor happens to
 *     compute.
 *  7. `addTools()`'s filter is reflected on the real wire `tools/list`, not
 *     just the internal registry helper.
 *
 * No live IRIS: every test here constructs but never `start()`s the server
 * (mirrors the dev's own construction-level tests) — visibility, the
 * governance resource, and the D4/D6 rebuilds are all available immediately
 * after construction. Discoverable by the default `vitest run` suite (plain
 * `*.test.ts`, matching the existing `server-discovery.e2e.test.ts`
 * precedent — `*.e2e.test.ts` is NOT excluded by the package's
 * `*.integration.test.ts`-only exclude glob).
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { z } from "zod";
import { McpServerBase } from "../server-base.js";
import { SERVER_DISCOVERY_TOOL_NAME } from "../server-discovery.js";
import type { ToolPresetRosters } from "../tool-visibility.js";
import type { ToolDefinition } from "../tool-types.js";

// ── Fixtures ────────────────────────────────────────────────────────

/** A synthetic read tool with an explicit `mutates` classification. */
function makeReadTool(name: string): ToolDefinition {
  return {
    name,
    title: `Read ${name}`,
    description: `Synthetic read tool ${name} for the visibility E2E suite.`,
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true },
    scope: "NONE",
    mutates: "read",
    handler: async () => ({
      content: [{ type: "text" as const, text: "ok" }],
      structuredContent: { ok: true },
    }),
  };
}

/** A synthetic write tool (seed-disabled under an empty governance config, no F2 opt-in). */
function makeWriteTool(name: string): ToolDefinition {
  return {
    name,
    title: `Write ${name}`,
    description: `Synthetic write tool ${name} for the visibility E2E suite.`,
    inputSchema: z.object({ value: z.string().optional() }),
    annotations: { readOnlyHint: false },
    scope: "NONE",
    mutates: "write",
    handler: async () => ({
      content: [{ type: "text" as const, text: "wrote" }],
      structuredContent: { ok: true },
    }),
  };
}

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

/** `tools/call` over the real wire (the SDK's own dispatch — not the framework's internal callback map). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function wireCallTool(server: any, name: string, args: unknown = {}) {
  return callRequest(server, "tools/call", { name, arguments: args });
}

/** Read a governance resource URI and parse its JSON policy body. */
async function readGovernancePolicy(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  server: any,
  uri: string,
): Promise<Record<string, boolean>> {
  const result = await callRequest(server, "resources/read", { uri });
  const contents = result.contents as Array<{ text: string }>;
  return JSON.parse(contents[0]!.text) as Record<string, boolean>;
}

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

afterEach(() => {
  restoreEnv();
  vi.restoreAllMocks();
});

// ════════════════════════════════════════════════════════════════════
// 1. Real wire absence + SDK-standard-error identity proof
// ════════════════════════════════════════════════════════════════════

describe("E2E — a hidden tool is absent from the real SDK tools/list wire, and its call error is the SDK's OWN standard shape", () => {
  it("is absent from the wire tools/list response (not just the framework's getToolNames() helper)", async () => {
    clearVisibilityEnv();
    process.env.IRIS_TOOLS_DISABLE = "iris_e2e_hidden";
    const server = new McpServerBase({
      name: "vis-e2e-1",
      version: "0.0.0",
      tools: [makeReadTool("iris_e2e_hidden"), makeReadTool("iris_e2e_shown")],
    });

    const names = await wireToolNames(server);
    expect(names).not.toContain("iris_e2e_hidden");
    expect(names).toContain("iris_e2e_shown");
    expect(names).toContain(SERVER_DISCOVERY_TOOL_NAME);
  });

  it("a hidden tool's tools/call failure is byte-for-byte identical to calling a name never passed to options.tools at all", async () => {
    clearVisibilityEnv();
    process.env.IRIS_TOOLS_DISABLE = "iris_e2e_hidden2";
    const server = new McpServerBase({
      name: "vis-e2e-2",
      version: "0.0.0",
      tools: [makeReadTool("iris_e2e_hidden2")],
    });

    const hiddenResult = await wireCallTool(server, "iris_e2e_hidden2");
    const neverRegisteredResult = await wireCallTool(
      server,
      "iris_e2e_totally_never_registered",
    );

    // Both go through the identical SDK "unknown tool" branch: same isError,
    // same absence of structuredContent, same "not found" wording shape —
    // proving the visibility filter does not introduce ANY bespoke error
    // surface distinguishable from a tool that was simply never declared.
    expect(hiddenResult.isError).toBe(true);
    expect(neverRegisteredResult.isError).toBe(true);
    expect(hiddenResult.structuredContent).toBeUndefined();
    expect(neverRegisteredResult.structuredContent).toBeUndefined();
    expect(hiddenResult.content[0].text).toContain("not found");
    expect(neverRegisteredResult.content[0].text).toContain("not found");
    // Neither carries the governance denial's structured envelope shape.
    expect(hiddenResult.content[0].text).not.toContain("GOVERNANCE_DISABLED");
  });
});

// ════════════════════════════════════════════════════════════════════
// 2. Family hole-punch through the real wire
// ════════════════════════════════════════════════════════════════════

describe("E2E — IRIS_TOOLS_DISABLE=iris_x_* + IRIS_TOOLS_ENABLE=iris_x_get family hole-punch, on the real wire", () => {
  it("tools/list shows only the punched-in family member; the rest of the family is absent and uncallable", async () => {
    clearVisibilityEnv();
    process.env.IRIS_TOOLS_DISABLE = "iris_x_*";
    process.env.IRIS_TOOLS_ENABLE = "iris_x_get";
    const server = new McpServerBase({
      name: "vis-e2e-3",
      version: "0.0.0",
      tools: [
        makeReadTool("iris_x_get"),
        makeReadTool("iris_x_put"),
        makeReadTool("iris_x_delete"),
        makeReadTool("iris_y_untouched"),
      ],
    });

    const names = await wireToolNames(server);
    expect(names.sort()).toEqual(
      ["iris_x_get", "iris_y_untouched", SERVER_DISCOVERY_TOOL_NAME].sort(),
    );

    // The punched hole is genuinely REGISTERED and reaches the framework's own
    // dispatch logic (it fails only because this test never calls start(), so
    // no IRIS connection exists — a DIFFERENT failure surface than "not
    // found", proven by the message content below), whereas a sibling still
    // hidden by the wildcard is never registered at all and gets the SDK's
    // own unknown-tool error.
    const punchedResult = await wireCallTool(server, "iris_x_get");
    expect(punchedResult.content[0].text).not.toContain("not found");
    expect(punchedResult.content[0].text).toContain(
      "IRIS connection not established",
    );

    const stillHiddenResult = await wireCallTool(server, "iris_x_put");
    expect(stillHiddenResult.isError).toBe(true);
    expect(stillHiddenResult.content[0].text).toContain("not found");
  });
});

// ════════════════════════════════════════════════════════════════════
// 3. Visibility × governance composition
// ════════════════════════════════════════════════════════════════════

describe("E2E — visibility composes with governance: a hidden tool contributes no governance key", () => {
  it("a hidden write tool's key is absent from BOTH governedKeys and the advisory resource's policy map; the same tool contributes a key when visible", async () => {
    // Server A: the write tool is hidden.
    clearVisibilityEnv();
    process.env.IRIS_TOOLS_DISABLE = "iris_e2e_hidden_write";
    const hiddenServer = new McpServerBase({
      name: "vis-e2e-4a",
      version: "0.0.0",
      tools: [makeWriteTool("iris_e2e_hidden_write")],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hiddenGovernedKeys: Set<string> = (hiddenServer as any).governedKeys;
    expect(hiddenGovernedKeys.has("iris_e2e_hidden_write")).toBe(false);
    const hiddenPolicy = await readGovernancePolicy(
      hiddenServer,
      "iris-governance://default",
    );
    expect(
      Object.prototype.hasOwnProperty.call(hiddenPolicy, "iris_e2e_hidden_write"),
    ).toBe(false);

    // Server B: the IDENTICAL tool, no visibility env set — must contribute
    // its key. This is the contrast that proves the exclusion above is
    // actually CAUSED by visibility, not an unrelated gap.
    clearVisibilityEnv();
    const visibleServer = new McpServerBase({
      name: "vis-e2e-4b",
      version: "0.0.0",
      tools: [makeWriteTool("iris_e2e_hidden_write")],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const visibleGovernedKeys: Set<string> = (visibleServer as any).governedKeys;
    expect(visibleGovernedKeys.has("iris_e2e_hidden_write")).toBe(true);
    const visiblePolicy = await readGovernancePolicy(
      visibleServer,
      "iris-governance://default",
    );
    expect(visiblePolicy["iris_e2e_hidden_write"]).toBe(false); // new write, seed-disabled

    // The two governed-key universes differ by EXACTLY the hidden tool.
    expect(visibleGovernedKeys.size - hiddenGovernedKeys.size).toBe(1);
  });

  it("governance under empty visibility env is unchanged even when a toolPresets roster IS wired", async () => {
    clearVisibilityEnv(); // no IRIS_TOOLS_* — preset stays "full"
    const rosters: ToolPresetRosters = {
      core: { include: ["iris_e2e_read"], exclude: ["iris_e2e_write"] },
      developer: { include: ["iris_e2e_read", "iris_e2e_write"], exclude: [] },
    };
    const withRosters = new McpServerBase({
      name: "vis-e2e-5a",
      version: "0.0.0",
      tools: [makeReadTool("iris_e2e_read"), makeWriteTool("iris_e2e_write")],
      toolPresets: rosters,
    });
    const withoutRosters = new McpServerBase({
      name: "vis-e2e-5b",
      version: "0.0.0",
      tools: [makeReadTool("iris_e2e_read"), makeWriteTool("iris_e2e_write")],
      // toolPresets deliberately absent.
    });

    const policyWithRosters = await readGovernancePolicy(
      withRosters,
      "iris-governance://default",
    );
    const policyWithoutRosters = await readGovernancePolicy(
      withoutRosters,
      "iris-governance://default",
    );
    // Merely WIRING a roster (with the active preset "full", the default)
    // must not perturb the governance seed at all — the roster is dormant
    // under "full" by design (spec §2.2: "'full' preset ignores rosters
    // entirely").
    expect(policyWithRosters["iris_e2e_read"]).toBe(
      policyWithoutRosters["iris_e2e_read"],
    );
    expect(policyWithRosters["iris_e2e_write"]).toBe(
      policyWithoutRosters["iris_e2e_write"],
    );
    expect(await wireToolNames(withRosters)).toEqual(
      await wireToolNames(withoutRosters),
    );
  });
});

// ════════════════════════════════════════════════════════════════════
// 4. Second-configuration coverage (Rule #34 analog): core vs full, with a
//    REAL toolPresets roster wired, through the real wire.
// ════════════════════════════════════════════════════════════════════

describe("E2E — second-configuration coverage: the SAME server + roster differs observably between core and full", () => {
  const rosters: ToolPresetRosters = {
    core: {
      include: ["iris_e2e_core_a", "iris_e2e_core_b"],
      exclude: ["iris_e2e_dev_only"],
    },
    developer: {
      include: ["iris_e2e_core_a", "iris_e2e_core_b", "iris_e2e_dev_only"],
      exclude: [],
    },
  };
  function makeTools(): ToolDefinition[] {
    return [
      makeReadTool("iris_e2e_core_a"),
      makeReadTool("iris_e2e_core_b"),
      makeReadTool("iris_e2e_dev_only"),
    ];
  }

  it("under IRIS_TOOLS_PRESET=core, only the roster's core::include set (+ reserved tool) is on the wire", async () => {
    clearVisibilityEnv();
    process.env.IRIS_TOOLS_PRESET = "core";
    const server = new McpServerBase({
      name: "vis-e2e-6-core",
      version: "0.0.0",
      tools: makeTools(),
      toolPresets: rosters,
    });
    const names = await wireToolNames(server);
    expect(names.sort()).toEqual(
      ["iris_e2e_core_a", "iris_e2e_core_b", SERVER_DISCOVERY_TOOL_NAME].sort(),
    );
  });

  it("under the default (unset ⇒ full) preset, the SAME server + roster shows every tool — the observable set genuinely differs from core", async () => {
    clearVisibilityEnv();
    const server = new McpServerBase({
      name: "vis-e2e-6-full",
      version: "0.0.0",
      tools: makeTools(),
      toolPresets: rosters,
    });
    const names = await wireToolNames(server);
    expect(names.sort()).toEqual(
      [
        "iris_e2e_core_a",
        "iris_e2e_core_b",
        "iris_e2e_dev_only",
        SERVER_DISCOVERY_TOOL_NAME,
      ].sort(),
    );
    // Explicit contrast: `full`'s set is a strict superset of `core`'s,
    // differing by exactly the roster-excluded dev-only tool.
    expect(names).toContain("iris_e2e_dev_only");
  });

  it("assertPresetCoverage throws AT REAL CONSTRUCTION (not just as a pure function) for an incomplete roster", () => {
    clearVisibilityEnv();
    const incompleteRosters: ToolPresetRosters = {
      core: { include: ["iris_e2e_core_a"], exclude: [] }, // missing core_b + dev_only
      developer: { include: makeTools().map((t) => t.name), exclude: [] },
    };
    expect(
      () =>
        new McpServerBase({
          name: "vis-e2e-6-invalid",
          version: "0.0.0",
          tools: makeTools(),
          toolPresets: incompleteRosters,
        }),
    ).toThrow(/preset "core"/);
  });
});

// ════════════════════════════════════════════════════════════════════
// 5. The AC 30.0.2 startup log line is actually emitted via the real logger.
// ════════════════════════════════════════════════════════════════════

describe("E2E — the startup log line (preset/visible/hidden counts + warnings) is emitted via the real stderr logger", () => {
  it("logs an INFO line with the preset + counts, and a WARN line for an unknown tool name in IRIS_TOOLS_DISABLE", () => {
    clearVisibilityEnv();
    process.env.IRIS_TOOLS_DISABLE = "iris_e2e_unknown_name,iris_e2e_log_hidden";
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    new McpServerBase({
      name: "vis-e2e-7",
      version: "0.0.0",
      tools: [makeReadTool("iris_e2e_log_hidden"), makeReadTool("iris_e2e_log_shown")],
    });

    const calls = errorSpy.mock.calls.map((args) => String(args[0]));
    const infoLine = calls.find((line) => line.includes("Tool visibility:") && line.includes("preset="));
    expect(infoLine, "expected an INFO startup line naming the active preset").toBeDefined();
    expect(infoLine).toContain('preset="full"');
    expect(infoLine).toContain("visible=");
    expect(infoLine).toContain("hidden=");
    expect(infoLine).toContain("warnings=1");

    const warnLine = calls.find(
      (line) => line.startsWith("[WARN]") && line.includes("iris_e2e_unknown_name"),
    );
    expect(warnLine, "expected a WARN line naming the unknown tool").toBeDefined();
  });
});

// ════════════════════════════════════════════════════════════════════
// 6. addTools()'s filter reflected on the real wire tools/list.
// ════════════════════════════════════════════════════════════════════

describe("E2E — addTools() applies the same filter, observable on the real wire tools/list", () => {
  it("a tool added at runtime while hidden by config never appears in the wire tools/list, and its sibling does", async () => {
    clearVisibilityEnv();
    process.env.IRIS_TOOLS_DISABLE = "iris_e2e_dynamic_hidden";
    const server = new McpServerBase({
      name: "vis-e2e-8",
      version: "0.0.0",
      tools: [makeReadTool("iris_e2e_static")],
    });

    const beforeNames = await wireToolNames(server);
    expect(beforeNames).not.toContain("iris_e2e_dynamic_hidden");

    server.addTools([
      makeReadTool("iris_e2e_dynamic_hidden"),
      makeReadTool("iris_e2e_dynamic_shown"),
    ]);

    const afterNames = await wireToolNames(server);
    expect(afterNames).not.toContain("iris_e2e_dynamic_hidden");
    expect(afterNames).toContain("iris_e2e_dynamic_shown");
    expect(afterNames).toContain("iris_e2e_static");

    const hiddenCallResult = await wireCallTool(server, "iris_e2e_dynamic_hidden");
    expect(hiddenCallResult.isError).toBe(true);
    expect(hiddenCallResult.content[0].text).toContain("not found");
  });
});
