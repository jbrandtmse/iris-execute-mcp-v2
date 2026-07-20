/**
 * Story 30.0 — Visibility Engine (shared).
 *
 * Unit-level coverage for every edge in spec 11 §2.2 (`parseToolVisibilityConfig`
 * / `resolveVisibleTools` / `assertPresetCoverage`), plus a construction-level
 * proof that the {@link McpServerBase} constructor filter (AC 30.0.2) actually
 * removes a hidden tool from the SDK registry — absent from `getToolNames()`
 * AND uncallable via the real `tools/call` wire path with the SDK's OWN
 * standard unknown-tool error (never a custom `GOVERNANCE_DISABLED`-shaped
 * envelope) — and that `addTools` applies the identical filter to a
 * dynamically-added tool.
 *
 * Discoverable by the default `vitest run` suite (plain `*.test.ts`, NOT
 * `*.integration.test.ts`). No live IRIS: the constructor-level tests never
 * call `start()`, so no fetch/bootstrap mocking is needed. TypeScript-only —
 * no `BOOTSTRAP_VERSION` impact, no governance-baseline touch.
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  TOOL_PRESET_NAMES,
  parseToolVisibilityConfig,
  resolveVisibleTools,
  assertPresetCoverage,
} from "../tool-visibility.js";
import type { ToolPresetRosters } from "../tool-visibility.js";
import { McpServerBase } from "../server-base.js";
import { SERVER_DISCOVERY_TOOL_NAME } from "../server-discovery.js";
import type { ToolDefinition } from "../tool-types.js";

// ── Fixtures ────────────────────────────────────────────────────────

/** A synthetic read tool with an explicit `mutates` classification, so visibility can be tested independently of governance-baseline membership. */
function makeTool(name: string): ToolDefinition {
  return {
    name,
    title: `Tool ${name}`,
    description: `Synthetic tool ${name} for visibility engine tests.`,
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

// ════════════════════════════════════════════════════════════════════
// parseToolVisibilityConfig — AC 30.0.1
// ════════════════════════════════════════════════════════════════════

describe("parseToolVisibilityConfig", () => {
  it("defaults to preset 'full' with empty disable/enable when unset", () => {
    const config = parseToolVisibilityConfig({});
    expect(config).toEqual({ preset: "full", disable: [], enable: [] });
  });

  it("empty-string IRIS_TOOLS_PRESET also defaults to 'full'", () => {
    const config = parseToolVisibilityConfig({ IRIS_TOOLS_PRESET: "" });
    expect(config.preset).toBe("full");
  });

  it.each(TOOL_PRESET_NAMES)("accepts the valid preset value %s", (preset) => {
    const config = parseToolVisibilityConfig({ IRIS_TOOLS_PRESET: preset });
    expect(config.preset).toBe(preset);
  });

  it("throws naming the valid values for an unknown IRIS_TOOLS_PRESET", () => {
    expect(() =>
      parseToolVisibilityConfig({ IRIS_TOOLS_PRESET: "read_only" }),
    ).toThrow(/IRIS_TOOLS_PRESET is invalid/);
    try {
      parseToolVisibilityConfig({ IRIS_TOOLS_PRESET: "read_only" });
      expect.unreachable();
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain("full");
      expect(message).toContain("core");
      expect(message).toContain("developer");
      expect(message).toContain('"read_only"');
    }
  });

  it("trims whitespace and drops empty entries in DISABLE/ENABLE", () => {
    const config = parseToolVisibilityConfig({
      IRIS_TOOLS_DISABLE: " iris_doc_get ,, iris_doc_put ,",
      IRIS_TOOLS_ENABLE: "iris_global_get,  iris_global_set  ",
    });
    expect(config.disable).toEqual(["iris_doc_get", "iris_doc_put"]);
    expect(config.enable).toEqual(["iris_global_get", "iris_global_set"]);
  });

  it("supports a trailing-* wildcard token without rejecting it", () => {
    const config = parseToolVisibilityConfig({
      IRIS_TOOLS_DISABLE: "iris_doc_*",
    });
    expect(config.disable).toEqual(["iris_doc_*"]);
  });

  it("rejects a bare '*' token in IRIS_TOOLS_DISABLE", () => {
    expect(() =>
      parseToolVisibilityConfig({ IRIS_TOOLS_DISABLE: "*" }),
    ).toThrow(/IRIS_TOOLS_DISABLE is invalid/);
  });

  it("rejects a bare '*' token in IRIS_TOOLS_ENABLE", () => {
    expect(() =>
      parseToolVisibilityConfig({ IRIS_TOOLS_ENABLE: "iris_doc_get,*" }),
    ).toThrow(/IRIS_TOOLS_ENABLE is invalid/);
  });

  it("does not reject a bare '*' embedded as a trailing-wildcard family pattern", () => {
    // "iris_doc_*" is fine; only the standalone "*" token is rejected.
    expect(() =>
      parseToolVisibilityConfig({ IRIS_TOOLS_DISABLE: "iris_doc_*" }),
    ).not.toThrow();
  });
});

// ════════════════════════════════════════════════════════════════════
// resolveVisibleTools — AC 30.0.2 precedence + AC 30.0.1 warnings
// ════════════════════════════════════════════════════════════════════

describe("resolveVisibleTools", () => {
  const toolNames = ["iris_doc_get", "iris_doc_put", "iris_doc_delete", "iris_global_get"];
  const reservedName = SERVER_DISCOVERY_TOOL_NAME;

  it("default-visible: with no config, every tool (+ the reserved tool) is visible", () => {
    const { visible, warnings } = resolveVisibleTools({
      toolNames,
      config: { preset: "full", disable: [], enable: [] },
      rosters: undefined,
      reservedName,
    });
    expect([...visible].sort()).toEqual(
      [...toolNames, reservedName].sort(),
    );
    expect(warnings).toEqual([]);
  });

  it("DISABLE hides a literal tool", () => {
    const { visible } = resolveVisibleTools({
      toolNames,
      config: { preset: "full", disable: ["iris_doc_delete"], enable: [] },
      rosters: undefined,
      reservedName,
    });
    expect(visible.has("iris_doc_delete")).toBe(false);
    expect(visible.has("iris_doc_get")).toBe(true);
  });

  it("trailing-* wildcard expands DISABLE across a family", () => {
    const { visible } = resolveVisibleTools({
      toolNames,
      config: { preset: "full", disable: ["iris_doc_*"], enable: [] },
      rosters: undefined,
      reservedName,
    });
    expect(visible.has("iris_doc_get")).toBe(false);
    expect(visible.has("iris_doc_put")).toBe(false);
    expect(visible.has("iris_doc_delete")).toBe(false);
    expect(visible.has("iris_global_get")).toBe(true);
  });

  it("precedence: ENABLE beats DISABLE — the family-except-one hole-punch", () => {
    const { visible } = resolveVisibleTools({
      toolNames,
      config: {
        preset: "full",
        disable: ["iris_doc_*"],
        enable: ["iris_doc_get"],
      },
      rosters: undefined,
      reservedName,
    });
    expect(visible.has("iris_doc_get")).toBe(true); // punched hole
    expect(visible.has("iris_doc_put")).toBe(false); // still hidden
    expect(visible.has("iris_doc_delete")).toBe(false); // still hidden
  });

  it("precedence: DISABLE beats a preset roster's include", () => {
    const rosters: ToolPresetRosters = {
      core: {
        include: toolNames,
        exclude: [],
      },
      developer: { include: toolNames, exclude: [] },
    };
    const { visible } = resolveVisibleTools({
      toolNames,
      config: { preset: "core", disable: ["iris_doc_get"], enable: [] },
      rosters,
      reservedName,
    });
    expect(visible.has("iris_doc_get")).toBe(false);
    expect(visible.has("iris_doc_put")).toBe(true);
  });

  it("precedence: ENABLE beats a preset roster's exclude", () => {
    const rosters: ToolPresetRosters = {
      core: {
        include: ["iris_doc_get", "iris_global_get"],
        exclude: ["iris_doc_put", "iris_doc_delete"],
      },
      developer: { include: toolNames, exclude: [] },
    };
    const { visible } = resolveVisibleTools({
      toolNames,
      config: { preset: "core", disable: [], enable: ["iris_doc_put"] },
      rosters,
      reservedName,
    });
    expect(visible.has("iris_doc_put")).toBe(true); // punched hole
    expect(visible.has("iris_doc_delete")).toBe(false); // still excluded by the roster
  });

  it("preset roster governs default visibility when no DISABLE/ENABLE apply", () => {
    const rosters: ToolPresetRosters = {
      core: {
        include: ["iris_doc_get", "iris_global_get"],
        exclude: ["iris_doc_put", "iris_doc_delete"],
      },
      developer: { include: toolNames, exclude: [] },
    };
    const { visible } = resolveVisibleTools({
      toolNames,
      config: { preset: "core", disable: [], enable: [] },
      rosters,
      reservedName,
    });
    expect(visible.has("iris_doc_get")).toBe(true);
    expect(visible.has("iris_global_get")).toBe(true);
    expect(visible.has("iris_doc_put")).toBe(false);
    expect(visible.has("iris_doc_delete")).toBe(false);
  });

  it("'full' preset ignores rosters entirely (every tool default-visible)", () => {
    const rosters: ToolPresetRosters = {
      core: { include: [], exclude: toolNames },
      developer: { include: [], exclude: toolNames },
    };
    const { visible } = resolveVisibleTools({
      toolNames,
      config: { preset: "full", disable: [], enable: [] },
      rosters,
      reservedName,
    });
    for (const name of toolNames) expect(visible.has(name)).toBe(true);
  });

  it("warns (does not throw) when the SAME literal name appears in both DISABLE and ENABLE, and ENABLE wins", () => {
    const { visible, warnings } = resolveVisibleTools({
      toolNames,
      config: {
        preset: "full",
        disable: ["iris_doc_get"],
        enable: ["iris_doc_get"],
      },
      rosters: undefined,
      reservedName,
    });
    expect(visible.has("iris_doc_get")).toBe(true);
    expect(warnings.some((w) => w.includes("iris_doc_get"))).toBe(true);
  });

  it("a wildcard-vs-literal overlap (the intended hole-punch) does NOT trigger the literal-duplicate warning", () => {
    const { warnings } = resolveVisibleTools({
      toolNames,
      config: {
        preset: "full",
        disable: ["iris_doc_*"],
        enable: ["iris_doc_get"],
      },
      rosters: undefined,
      reservedName,
    });
    expect(warnings.some((w) => w.includes("both IRIS_TOOLS_DISABLE"))).toBe(
      false,
    );
  });

  it("warns on an unknown literal tool name (shared env block across servers)", () => {
    const { warnings } = resolveVisibleTools({
      toolNames,
      config: { preset: "full", disable: ["iris_totally_unknown_tool"], enable: [] },
      rosters: undefined,
      reservedName,
    });
    expect(
      warnings.some((w) => w.includes("iris_totally_unknown_tool")),
    ).toBe(true);
  });

  it("warns on a wildcard that matches zero registered tools", () => {
    const { warnings } = resolveVisibleTools({
      toolNames,
      config: { preset: "full", disable: ["iris_nonexistent_*"], enable: [] },
      rosters: undefined,
      reservedName,
    });
    expect(
      warnings.some((w) => w.includes('"iris_nonexistent_*"') && w.includes("zero")),
    ).toBe(true);
  });

  it("throws when the reserved discovery tool is named LITERALLY in DISABLE", () => {
    expect(() =>
      resolveVisibleTools({
        toolNames,
        config: { preset: "full", disable: [reservedName], enable: [] },
        rosters: undefined,
        reservedName,
      }),
    ).toThrow(new RegExp(reservedName));
  });

  it("a wildcard that WOULD match the reserved tool silently skips it — no throw, no warning, always visible", () => {
    const { visible, warnings } = resolveVisibleTools({
      toolNames,
      config: { preset: "full", disable: ["iris_*"], enable: [] },
      rosters: undefined,
      reservedName,
    });
    // The wildcard hides every real package tool…
    for (const name of toolNames) expect(visible.has(name)).toBe(false);
    // …but the reserved tool is unaffected, and no warning names it.
    expect(visible.has(reservedName)).toBe(true);
    expect(warnings.some((w) => w.includes(reservedName))).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════
// assertPresetCoverage — AC 30.0.3
// ════════════════════════════════════════════════════════════════════

describe("assertPresetCoverage", () => {
  const toolNames = ["iris_doc_get", "iris_doc_put", "iris_doc_delete"];

  it("is a no-op when rosters is undefined", () => {
    expect(() => assertPresetCoverage(undefined, toolNames)).not.toThrow();
  });

  it("passes on an exact, non-overlapping cover for every named preset", () => {
    const rosters: ToolPresetRosters = {
      core: { include: ["iris_doc_get"], exclude: ["iris_doc_put", "iris_doc_delete"] },
      developer: { include: toolNames, exclude: [] },
    };
    expect(() => assertPresetCoverage(rosters, toolNames)).not.toThrow();
  });

  it("throws naming the tool + preset when a tool is missing from both include and exclude", () => {
    const rosters: ToolPresetRosters = {
      core: { include: ["iris_doc_get"], exclude: ["iris_doc_put"] }, // iris_doc_delete missing
      developer: { include: toolNames, exclude: [] },
    };
    expect(() => assertPresetCoverage(rosters, toolNames)).toThrow(
      /"iris_doc_delete".*preset "core"/,
    );
  });

  it("throws naming the tool + preset when a tool appears in BOTH include and exclude", () => {
    const rosters: ToolPresetRosters = {
      core: {
        include: ["iris_doc_get", "iris_doc_put"],
        exclude: ["iris_doc_put", "iris_doc_delete"],
      },
      developer: { include: toolNames, exclude: [] },
    };
    expect(() => assertPresetCoverage(rosters, toolNames)).toThrow(
      /"iris_doc_put".*BOTH.*preset "core"/,
    );
  });
});

// ════════════════════════════════════════════════════════════════════
// Constructor-level: the real McpServerBase filter (AC 30.0.2) + addTools
// ════════════════════════════════════════════════════════════════════

describe("McpServerBase constructor tool-visibility filter (AC 30.0.2)", () => {
  const savedEnv = {
    IRIS_TOOLS_PRESET: process.env.IRIS_TOOLS_PRESET,
    IRIS_TOOLS_DISABLE: process.env.IRIS_TOOLS_DISABLE,
    IRIS_TOOLS_ENABLE: process.env.IRIS_TOOLS_ENABLE,
  };

  function restoreEnv(): void {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }

  it("a tool hidden via IRIS_TOOLS_DISABLE is absent from getToolNames()", () => {
    delete process.env.IRIS_TOOLS_PRESET;
    process.env.IRIS_TOOLS_DISABLE = "iris_vis_hidden";
    delete process.env.IRIS_TOOLS_ENABLE;
    try {
      const server = new McpServerBase({
        name: "vis-test",
        version: "0.0.0",
        tools: [makeTool("iris_vis_hidden"), makeTool("iris_vis_shown")],
      });
      const names = server.getToolNames();
      expect(names).not.toContain("iris_vis_hidden");
      expect(names).toContain("iris_vis_shown");
      expect(names).toContain(SERVER_DISCOVERY_TOOL_NAME);
    } finally {
      restoreEnv();
    }
  });

  it("calling a hidden tool via the real tools/call wire returns the SDK's standard unknown-tool error, not a GOVERNANCE_DISABLED envelope", async () => {
    delete process.env.IRIS_TOOLS_PRESET;
    process.env.IRIS_TOOLS_DISABLE = "iris_vis_hidden2";
    delete process.env.IRIS_TOOLS_ENABLE;
    try {
      const server = new McpServerBase({
        name: "vis-test-2",
        version: "0.0.0",
        tools: [makeTool("iris_vis_hidden2"), makeTool("iris_vis_shown2")],
      });

      // The SDK's own CallToolRequestSchema handler resolves an unknown-tool
      // call to a standard, uncustomized error result (it never reaches our
      // registerTool callback, since the hidden tool was never registered) —
      // the SDK internally maps its thrown `McpError(InvalidParams, "Tool …
      // not found")` to this shape. The key assertions: the SDK's own "not
      // found" wording is present, and NONE of the governance denial's
      // structured envelope (`structuredContent.code === "GOVERNANCE_DISABLED"`)
      // appears — proving this is a DIFFERENT failure surface, not a reachable
      // (but denied) governed call.
      const hiddenResult = await callRequest(server, "tools/call", {
        name: "iris_vis_hidden2",
        arguments: {},
      });
      expect(hiddenResult.isError).toBe(true);
      expect(hiddenResult.content[0].text).toContain("iris_vis_hidden2");
      expect(hiddenResult.content[0].text).toContain("not found");
      expect(hiddenResult.structuredContent).toBeUndefined();

      // The visible sibling tool is REGISTERED (reaches our own dispatch
      // logic, not the SDK's "not found" branch) — it fails here only
      // because the server was never start()ed (no live IRIS connection is
      // needed for this visibility-only test), a DIFFERENT error surface
      // than the hidden tool's "not found".
      const result = await callRequest(server, "tools/call", {
        name: "iris_vis_shown2",
        arguments: {},
      });
      expect(result.content[0].text).not.toContain("not found");
    } finally {
      restoreEnv();
    }
  });

  it("with no visibility env vars, tools/list is unaffected (byte-for-byte back-compat sanity)", async () => {
    restoreEnv();
    const server = new McpServerBase({
      name: "vis-test-3",
      version: "0.0.0",
      tools: [makeTool("iris_vis_a"), makeTool("iris_vis_b")],
    });
    const result = await callRequest(server, "tools/list", {});
    const names = (result.tools as Array<{ name: string }>).map((t) => t.name);
    expect(names.sort()).toEqual(
      ["iris_vis_a", "iris_vis_b", SERVER_DISCOVERY_TOOL_NAME].sort(),
    );
  });

  it("addTools() applies the same filter: a hidden-by-config tool added at runtime is not registered", () => {
    delete process.env.IRIS_TOOLS_PRESET;
    process.env.IRIS_TOOLS_DISABLE = "iris_vis_dynamic_hidden";
    delete process.env.IRIS_TOOLS_ENABLE;
    try {
      const server = new McpServerBase({
        name: "vis-test-4",
        version: "0.0.0",
        tools: [makeTool("iris_vis_static")],
      });
      server.addTools([
        makeTool("iris_vis_dynamic_hidden"),
        makeTool("iris_vis_dynamic_shown"),
      ]);
      const names = server.getToolNames();
      expect(names).not.toContain("iris_vis_dynamic_hidden");
      expect(names).toContain("iris_vis_dynamic_shown");
    } finally {
      restoreEnv();
    }
  });

  it("assertPresetCoverage's no-op (absent rosters) lets construction proceed under IRIS_TOOLS_PRESET=core with every tool visible", () => {
    delete process.env.IRIS_TOOLS_DISABLE;
    delete process.env.IRIS_TOOLS_ENABLE;
    process.env.IRIS_TOOLS_PRESET = "core";
    try {
      const server = new McpServerBase({
        name: "vis-test-5",
        version: "0.0.0",
        tools: [makeTool("iris_vis_c"), makeTool("iris_vis_d")],
        // toolPresets deliberately absent — Story 30.1 wires it.
      });
      const names = server.getToolNames();
      expect(names).toContain("iris_vis_c");
      expect(names).toContain("iris_vis_d");
    } finally {
      restoreEnv();
    }
  });
});
