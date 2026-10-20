/**
 * Story 38.4 (AC-6, AC-9) - parent keys: a new key that re-exposes an existing key's capability seeds
 * disabled when that key is explicitly disabled (AD-4, AD-6).
 *
 * Three describes:
 *
 *  1. The engine, with synthetic tools: every explicit layer, profile scoping, the child winning, the
 *     parent's first explicit verdict deciding, the read-only preset, the `parent` source, and the
 *     registration-time throws of `buildParentKeys` and `assertParentKeysKnown`.
 *  2. The gate, through the real `McpServerBase.handleToolCall`: the denial's exact serialization, the
 *     attribution (`inheritedFrom` instead of `presetApplied`), and the discovery tool and the resource
 *     reporting the verdict the gate enforces.
 *  3. Back-compat (AC-9): with no parent explicitly disabled, every baseline key's policy and source is
 *     `toEqual` with and without the parent map, under each configuration that does not disable a parent.
 *
 * The harness mirrors `refusals.test.ts`: a mocked `bootstrap`, a `fetchMock` for the default profile's
 * startup HEAD and GET, and hermetic env save/restore.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { BootstrapResult } from "../bootstrap.js";
import { GOVERNANCE_BASELINE } from "../governance-baseline.js";
import { BASELINE_ACTION_CLASSIFICATIONS } from "../baseline-classifications.js";
import {
  assertParentKeysKnown,
  buildDefaultEnabledWrites,
  buildMutatesLookup,
  buildParentKeys,
  configSource,
  effective,
  getEffectiveConfigSources,
  getEffectivePolicy,
  inheritedParentDisable,
  type GovernanceConfig,
  type GovernancePreset,
} from "../governance.js";
import type { ToolDefinition } from "../tool-types.js";

const okBootstrap: BootstrapResult = {
  probeFound: true,
  probeStatus: "current",
  deployed: true,
  compiled: true,
  configured: true,
  mapped: true,
  unitTestRootEnsured: true,
  errors: [],
};

const bootstrapSpy = vi.fn(async () => okBootstrap);
vi.mock("../bootstrap.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../bootstrap.js")>();
  return { ...actual, bootstrap: bootstrapSpy };
});

const { McpServerBase } = await import("../server-base.js");

// ---------------------------------------------------------------------------
// Synthetic tools.
// ---------------------------------------------------------------------------

/** Two baseline keys for the engine's synthetic world. */
const WORLD_BASELINE: ReadonlySet<string> = new Set(["iris_parent", "iris_other"]);

/** A multi-action child tool: `apply` ships enabled, `other` is a default-disabled write. */
function child(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    name: "iris_child",
    title: "Child",
    description: "A narrower way to do what iris_parent does.",
    inputSchema: z.object({ action: z.enum(["apply", "other"]) }),
    annotations: { readOnlyHint: false },
    scope: "NS",
    mutates: { apply: "write", other: "write" },
    defaultEnabled: ["apply"],
    parent: "iris_parent",
    handler: async () => ({ content: [{ type: "text" as const, text: "ran" }] }),
    ...overrides,
  };
}

/** `tool` without the named optional fields. */
function without(tool: ToolDefinition, ...keys: Array<keyof ToolDefinition>): ToolDefinition {
  const copy: Record<string, unknown> = { ...tool };
  for (const key of keys) delete copy[key];
  return copy as unknown as ToolDefinition;
}

/** A grandfathered tool: no `mutates`, its key is a baseline member. */
function plain(name: string): ToolDefinition {
  return {
    name,
    title: name,
    description: "A pre-existing tool.",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: false },
    scope: "NS",
    handler: async () => ({ content: [{ type: "text" as const, text: "ran" }] }),
  };
}

const CHILD_TOOLS = [child()];
const MUTATES = buildMutatesLookup(CHILD_TOOLS);
const DEFAULT_ENABLED = buildDefaultEnabledWrites(CHILD_TOOLS);
const PARENT_KEYS = buildParentKeys(CHILD_TOOLS, WORLD_BASELINE);
const WORLD_KEYS = ["iris_parent", "iris_other", "iris_child:apply", "iris_child:other"];

/** Resolve one key in the synthetic world. */
function resolve(
  key: string,
  config: GovernanceConfig,
  options: { profile?: string; preset?: GovernancePreset; file?: GovernanceConfig } = {},
): { value: boolean; source: string } {
  const profile = options.profile ?? "default";
  return {
    value: effective(
      key,
      profile,
      config,
      MUTATES,
      WORLD_BASELINE,
      DEFAULT_ENABLED,
      options.preset,
      {},
      options.file,
      PARENT_KEYS,
    ),
    source: configSource(key, profile, config, MUTATES, options.preset, {}, options.file, PARENT_KEYS),
  };
}

const INHERITED = { value: false, source: "parent" };

describe("the engine: buildParentKeys, inheritedParentDisable and the cascade", () => {
  it("maps every governance key of a declaring tool to its parent", () => {
    expect([...PARENT_KEYS]).toEqual([
      ["iris_child:apply", "iris_parent"],
      ["iris_child:other", "iris_parent"],
    ]);
  });

  it("maps the bare tool name for a single-operation tool", () => {
    const single = without(
      child({ name: "iris_single", inputSchema: z.object({}), mutates: "write" }),
      "defaultEnabled",
    );
    expect([...buildParentKeys([single], WORLD_BASELINE)]).toEqual([["iris_single", "iris_parent"]]);
  });

  it("is empty when no tool declares a parent", () => {
    expect(buildParentKeys([plain("iris_a"), plain("iris_b")], WORLD_BASELINE).size).toBe(0);
  });

  it("with nothing configured, apply is its default and other is disabled, neither reporting a parent", () => {
    expect(resolve("iris_child:apply", {})).toEqual({ value: true, source: "default" });
    expect(resolve("iris_child:other", {})).toEqual({ value: false, source: "default" });
  });

  describe("an explicit disable of the parent at each of the four layers", () => {
    const layers: Array<[string, GovernanceConfig, GovernanceConfig | undefined]> = [
      ["env profile", { profiles: { default: { iris_parent: false } } }, undefined],
      ["env global", { global: { iris_parent: false } }, undefined],
      ["file profile", {}, { profiles: { default: { iris_parent: false } } }],
      ["file global", {}, { global: { iris_parent: false } }],
    ];
    for (const [layer, config, file] of layers) {
      it(`${layer}: both keys of the child inherit the disable and report the parent source`, () => {
        const options = file === undefined ? {} : { file };
        expect(resolve("iris_child:apply", config, options)).toEqual(INHERITED);
        expect(resolve("iris_child:other", config, options)).toEqual(INHERITED);
        expect(inheritedParentDisable("iris_child:apply", "default", config, PARENT_KEYS, file)).toBe("iris_parent");
        // The parent itself reports the layer that set it, never `parent`.
        expect(resolve("iris_parent", config, options)).toEqual({
          value: false,
          source: layer.startsWith("env") ? "env" : "file",
        });
      });
    }

    it("a profile-scoped disable reaches only that profile", () => {
      const config: GovernanceConfig = { profiles: { prod: { iris_parent: false } } };
      expect(resolve("iris_child:apply", config, { profile: "prod" })).toEqual(INHERITED);
      expect(resolve("iris_child:apply", config, { profile: "default" })).toEqual({ value: true, source: "default" });
      expect(resolve("iris_child:apply", config, { profile: "staging" })).toEqual({ value: true, source: "default" });
    });

    it("a file-profile disable reaches only that profile", () => {
      const file: GovernanceConfig = { profiles: { prod: { iris_parent: false } } };
      expect(resolve("iris_child:apply", {}, { profile: "prod", file })).toEqual(INHERITED);
      expect(resolve("iris_child:apply", {}, { profile: "default", file })).toEqual({ value: true, source: "default" });
    });
  });

  describe("an explicit setting on the child still wins", () => {
    const layers: Array<[string, GovernanceConfig, GovernanceConfig | undefined, string]> = [
      ["env profile", { profiles: { default: { "iris_child:apply": true } }, global: { iris_parent: false } }, undefined, "env"],
      ["env global", { global: { "iris_child:apply": true, iris_parent: false } }, undefined, "env"],
      ["file profile", { global: { iris_parent: false } }, { profiles: { default: { "iris_child:apply": true } } }, "file"],
      ["file global", { global: { iris_parent: false } }, { global: { "iris_child:apply": true } }, "file"],
    ];
    for (const [layer, config, file, source] of layers) {
      it(`${layer}: apply is enabled and reports ${source}`, () => {
        const options = file === undefined ? {} : { file };
        expect(resolve("iris_child:apply", config, options)).toEqual({ value: true, source });
        // The other key of the same tool still inherits.
        expect(resolve("iris_child:other", config, options)).toEqual(INHERITED);
      });
    }

    it("an explicit child false is reported by its own layer, not as an inherited verdict", () => {
      expect(resolve("iris_child:apply", { global: { "iris_child:apply": false } })).toEqual({
        value: false,
        source: "env",
      });
    });

    it("an explicit child false while the parent is also disabled is reported by the child's own layer", () => {
      const config: GovernanceConfig = { global: { iris_parent: false, "iris_child:apply": false } };
      expect(resolve("iris_child:apply", config)).toEqual({ value: false, source: "env" });
      // The other key of the same tool has no setting of its own, so it still inherits.
      expect(resolve("iris_child:other", config)).toEqual(INHERITED);
    });

    it("a higher-layer child setting beats a lower-layer parent disable", () => {
      expect(
        resolve("iris_child:apply", { global: { "iris_child:apply": true } }, { file: { global: { iris_parent: false } } }),
      ).toEqual({ value: true, source: "env" });
    });
  });

  describe("only the parent's first explicit verdict counts", () => {
    it("env enables the parent and the file disables it: the parent is enabled, so the child is not disabled", () => {
      const config: GovernanceConfig = { global: { iris_parent: true } };
      const file: GovernanceConfig = { global: { iris_parent: false } };
      expect(resolve("iris_parent", config, { file })).toEqual({ value: true, source: "env" });
      expect(resolve("iris_child:apply", config, { file })).toEqual({ value: true, source: "default" });
      expect(inheritedParentDisable("iris_child:apply", "default", config, PARENT_KEYS, file)).toBeUndefined();
    });

    it("the env profile layer decides before the env global layer", () => {
      const disabledByProfile: GovernanceConfig = {
        profiles: { default: { iris_parent: false } },
        global: { iris_parent: true },
      };
      expect(resolve("iris_child:apply", disabledByProfile)).toEqual(INHERITED);
      const enabledByProfile: GovernanceConfig = {
        profiles: { default: { iris_parent: true } },
        global: { iris_parent: false },
      };
      expect(resolve("iris_child:apply", enabledByProfile)).toEqual({ value: true, source: "default" });
    });

    it("the env global layer decides before the file layers", () => {
      expect(
        resolve("iris_child:apply", { global: { iris_parent: true } }, { file: { profiles: { default: { iris_parent: false } } } }),
      ).toEqual({ value: true, source: "default" });
    });

    it("the file profile layer decides before the file global layer", () => {
      expect(
        resolve("iris_child:apply", {}, { file: { profiles: { default: { iris_parent: true } }, global: { iris_parent: false } } }),
      ).toEqual({ value: true, source: "default" });
      expect(
        resolve("iris_child:apply", {}, { file: { profiles: { default: { iris_parent: false } }, global: { iris_parent: true } } }),
      ).toEqual(INHERITED);
    });

    it("the parent enabled explicitly leaves the child at its own seed", () => {
      expect(resolve("iris_child:apply", { global: { iris_parent: true } })).toEqual({ value: true, source: "default" });
      expect(resolve("iris_child:other", { global: { iris_parent: true } })).toEqual({ value: false, source: "default" });
    });
  });

  describe("the read-only preset", () => {
    it("blocks apply by the preset when the parent is not disabled, and reports the preset", () => {
      expect(resolve("iris_child:apply", {}, { preset: "read-only" })).toEqual({ value: false, source: "preset" });
    });

    it("an inherited disable is reported as the parent source, not the preset", () => {
      expect(resolve("iris_child:apply", { global: { iris_parent: false } }, { preset: "read-only" })).toEqual(INHERITED);
    });

    it("an explicit child setting beats the preset and the inherited disable", () => {
      expect(
        resolve("iris_child:apply", { global: { "iris_child:apply": true, iris_parent: false } }, { preset: "read-only" }),
      ).toEqual({ value: true, source: "env" });
    });
  });

  describe("the policy and source maps over a key list", () => {
    it("getEffectivePolicy and getEffectiveConfigSources agree with effective and configSource", () => {
      const config: GovernanceConfig = { global: { iris_parent: false } };
      const policy = getEffectivePolicy("default", config, WORLD_KEYS, MUTATES, WORLD_BASELINE, DEFAULT_ENABLED, undefined, {}, undefined, PARENT_KEYS);
      const sources = getEffectiveConfigSources("default", config, WORLD_KEYS, MUTATES, undefined, {}, undefined, PARENT_KEYS);
      expect(policy).toEqual({
        iris_parent: false,
        iris_other: true,
        "iris_child:apply": false,
        "iris_child:other": false,
      });
      expect(sources).toEqual({
        iris_parent: "env",
        iris_other: "default",
        "iris_child:apply": "parent",
        "iris_child:other": "parent",
      });
    });

    it("an unrelated key is unaffected by a parent disable", () => {
      expect(resolve("iris_other", { global: { iris_parent: false } })).toEqual({ value: true, source: "default" });
    });
  });

  describe("registration-time checks (the matrix row 'Registration')", () => {
    it("rejects a reserved parent name, naming the tool and the parent", () => {
      expect(() => buildParentKeys([child({ parent: "constructor" })], WORLD_BASELINE)).toThrow(
        /Tool "iris_child" declares a reserved `parent` key "constructor"/,
      );
    });

    it("rejects an empty or non-string parent", () => {
      expect(() => buildParentKeys([child({ parent: "" })], WORLD_BASELINE)).toThrow(/Tool "iris_child" declares an invalid `parent`/);
      expect(() => buildParentKeys([child({ parent: 5 as unknown as string })], WORLD_BASELINE)).toThrow(
        /Tool "iris_child" declares an invalid `parent`/,
      );
    });

    it("rejects a parent that is one of the tool's own keys", () => {
      expect(() => buildParentKeys([child({ parent: "iris_child:other" })], WORLD_BASELINE)).toThrow(
        /Tool "iris_child" declares its own key "iris_child:other" as its `parent`/,
      );
    });

    it("rejects a declaring tool that owns a baseline key", () => {
      const baseline = new Set([...WORLD_BASELINE, "iris_child:other"]);
      expect(() => buildParentKeys([child()], baseline)).toThrow(
        /Tool "iris_child" declares `parent` "iris_parent" but owns the baseline key "iris_child:other"/,
      );
    });

    it("rejects a parent that itself has a parent, naming both tools", () => {
      const grandchild = child({ name: "iris_grandchild", parent: "iris_child:apply" });
      expect(() => buildParentKeys([child(), grandchild], WORLD_BASELINE)).toThrow(
        /Tool "iris_grandchild" declares `parent` "iris_child:apply", which is itself a child of "iris_parent" \(declared by tool "iris_child"\)/,
      );
    });

    it("assertParentKeysKnown passes when every parent is in the key universe", () => {
      expect(() => assertParentKeysKnown(PARENT_KEYS, WORLD_KEYS)).not.toThrow();
      expect(() => assertParentKeysKnown(new Map(), [])).not.toThrow();
    });

    it("assertParentKeysKnown names the tool and the parent when the parent is unknown", () => {
      const keys = buildParentKeys([child({ parent: "iris_missing" })], WORLD_BASELINE);
      expect(() => assertParentKeysKnown(keys, WORLD_KEYS)).toThrow(
        /Tool "iris_child" declares `parent` "iris_missing" \(for key "iris_child:apply"\), which is neither a baseline key nor a registered tool or action key/,
      );
    });
  });
});

// ---------------------------------------------------------------------------
// The gate, through the real McpServerBase.
// ---------------------------------------------------------------------------

function versionResponse(): Response {
  return new Response(
    JSON.stringify({ status: { errors: [] }, console: [], result: { version: "8.0.0" } }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function callTool(server: any, name: string, args: unknown) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const entry = (server.server as any)._registeredTools[name];
  return (entry.callback ?? entry.handler ?? entry.cb)(args);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function readResource(server: any, uri: string): Promise<{ policy: Record<string, boolean>; configSource: Record<string, string> }> {
  const handlers = server.server.server._requestHandlers as Map<
    string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (req: any, extra: any) => Promise<any>
  >;
  const handler = handlers.get("resources/read");
  if (!handler) throw new Error("No resources/read handler");
  const extra = {
    signal: new AbortController().signal,
    sendNotification: async () => {},
    sendRequest: async () => ({}),
    mcpReq: { requestState: () => undefined },
  };
  const result = await handler({ method: "resources/read", params: { uri } }, extra);
  return JSON.parse(result.contents[0].text);
}

const CLEARED_ENV = [
  "IRIS_SERVER_MANAGER",
  "IRIS_SM_SERVERS",
  "IRIS_SM_SETTINGS_PATHS",
  "IRIS_SM_WORKSPACE",
  "IRIS_CREDENTIAL_HELPER",
  "IRIS_PROFILES",
  "IRIS_GOVERNANCE",
  "IRIS_GOVERNANCE_FILE",
  "IRIS_GOVERNANCE_PRESET",
  "IRIS_TOOLS_DISABLE",
  "IRIS_TOOLS_ENABLE",
  "IRIS_TOOLS_PRESET",
  "IRIS_AUDIT_LOG",
  "IRIS_AUDIT_LOG_MAX_MB",
  "IRIS_AUDIT_LOG_PARAMS",
] as const;

describe("the gate: inherited denials, attribution and reporting", () => {
  const originalFetch = globalThis.fetch;
  const savedEnv: Record<string, string | undefined> = Object.fromEntries(
    [...CLEARED_ENV, "IRIS_USERNAME", "IRIS_PASSWORD", "IRIS_HOST", "IRIS_NAMESPACE"].map((name) => [name, process.env[name]]),
  );
  let fetchMock: ReturnType<typeof vi.fn>;
  let tempDir: string | undefined;

  beforeEach(() => {
    bootstrapSpy.mockClear();
    fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    fetchMock.mockResolvedValueOnce(versionResponse());
    globalThis.fetch = fetchMock;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(process, "exit").mockImplementation((() => {}) as any);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    for (const name of CLEARED_ENV) delete process.env[name];
    process.env.IRIS_USERNAME = "u";
    process.env.IRIS_PASSWORD = "p";
    process.env.IRIS_HOST = "default.example.com";
    process.env.IRIS_NAMESPACE = "DEFAULTNS";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    if (tempDir !== undefined) rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  /** Write a governance file and point IRIS_GOVERNANCE_FILE at it. */
  function governanceFile(content: unknown): void {
    tempDir = mkdtempSync(join(tmpdir(), "iris-governance-parent-"));
    const path = join(tempDir, "governance.json");
    writeFileSync(path, JSON.stringify(content));
    process.env.IRIS_GOVERNANCE_FILE = path;
  }

  /** A server with `iris_doc_put` (a baseline key) and the child tool declaring it as its parent. */
  async function start(
    childOverrides: Partial<ToolDefinition> = {},
    options: { tools?: ToolDefinition[] } = {},
  ) {
    const parentSpy = vi.fn(async () => ({ content: [{ type: "text" as const, text: "parent ran" }] }));
    const childSpy = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "child ran" }],
      structuredContent: { ok: true },
    }));
    const tools = options.tools ?? [
      { ...plain("iris_doc_put"), handler: parentSpy },
      child({ name: "iris_child_edit", parent: "iris_doc_put", handler: childSpy, ...childOverrides }),
    ];
    const server = new McpServerBase({ name: "test-server", version: "1.0.0", tools, needsCustomRest: false });
    await server.start("stdio");
    return { server, parentSpy, childSpy };
  }

  const APPLY = { action: "apply" };
  const OTHER = { action: "other" };

  it("with nothing configured, apply runs and other is denied with the plain denial (no attribution)", async () => {
    const { server, childSpy } = await start();

    const applied = await callTool(server, "iris_child_edit", APPLY);
    expect(applied.isError).toBeFalsy();
    expect(childSpy).toHaveBeenCalledTimes(1);

    const denied = await callTool(server, "iris_child_edit", OTHER);
    expect(JSON.stringify(denied)).toBe(
      '{"content":[{"type":"text","text":"action \'iris_child_edit:other\' is disabled by governance policy for server \'default\'"}],"structuredContent":{"code":"GOVERNANCE_DISABLED","action":"iris_child_edit:other","server":"default"},"isError":true}',
    );
    expect(childSpy).toHaveBeenCalledTimes(1);
  });

  it("read-only blocks apply with presetApplied and no inheritedFrom", async () => {
    process.env.IRIS_GOVERNANCE_PRESET = "read-only";
    const { server, childSpy } = await start();

    const denied = await callTool(server, "iris_child_edit", APPLY);

    expect(JSON.stringify(denied)).toBe(
      '{"content":[{"type":"text","text":"action \'iris_child_edit:apply\' is disabled by governance policy for server \'default\'"}],"structuredContent":{"code":"GOVERNANCE_DISABLED","action":"iris_child_edit:apply","server":"default","presetApplied":"read-only"},"isError":true}',
    );
    expect(childSpy).not.toHaveBeenCalled();
  });

  describe("a disabled parent at each explicit layer denies both keys of the child", () => {
    const INHERITED_APPLY =
      '{"content":[{"type":"text","text":"action \'iris_child_edit:apply\' is disabled by governance policy for server \'default\' (inherited from \'iris_doc_put\')"}],"structuredContent":{"code":"GOVERNANCE_DISABLED","action":"iris_child_edit:apply","server":"default","inheritedFrom":"iris_doc_put"},"isError":true}';
    const configure: Array<[string, () => void]> = [
      ["env global", () => (process.env.IRIS_GOVERNANCE = JSON.stringify({ global: { iris_doc_put: false } }))],
      [
        "env profile",
        () => (process.env.IRIS_GOVERNANCE = JSON.stringify({ profiles: { default: { iris_doc_put: false } } })),
      ],
      ["file global", () => governanceFile({ global: { iris_doc_put: false } })],
      ["file profile", () => governanceFile({ profiles: { default: { iris_doc_put: false } } })],
    ];
    for (const [layer, apply] of configure) {
      it(`${layer}: the denial is serialized exactly, carries inheritedFrom and no presetApplied, and the handler is not called`, async () => {
        apply();
        const { server, childSpy } = await start();

        const denied = await callTool(server, "iris_child_edit", APPLY);
        const deniedOther = await callTool(server, "iris_child_edit", OTHER);

        expect(JSON.stringify(denied)).toBe(INHERITED_APPLY);
        expect(deniedOther.structuredContent).toEqual({
          code: "GOVERNANCE_DISABLED",
          action: "iris_child_edit:other",
          server: "default",
          inheritedFrom: "iris_doc_put",
        });
        expect(deniedOther.content[0].text).toBe(
          "action 'iris_child_edit:other' is disabled by governance policy for server 'default' (inherited from 'iris_doc_put')",
        );
        expect(childSpy).not.toHaveBeenCalled();
      });
    }

    it("an explicit false on the parent is a denial of the parent itself with no inheritedFrom", async () => {
      process.env.IRIS_GOVERNANCE = JSON.stringify({ global: { iris_doc_put: false } });
      const { server, parentSpy } = await start();

      const denied = await callTool(server, "iris_doc_put", {});

      expect(denied.structuredContent).toEqual({ code: "GOVERNANCE_DISABLED", action: "iris_doc_put", server: "default" });
      expect(parentSpy).not.toHaveBeenCalled();
    });

    it("the inherited verdict is profile-scoped: another profile's calls still run", async () => {
      process.env.IRIS_PROFILES = JSON.stringify({ prod: { host: "prod.example.com", namespace: "PRODNS" } });
      process.env.IRIS_GOVERNANCE = JSON.stringify({ profiles: { default: { iris_doc_put: false } } });
      const { server, childSpy } = await start();
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
      fetchMock.mockResolvedValueOnce(versionResponse());
      await server.getOrCreateClient("prod", false);

      const onDefault = await callTool(server, "iris_child_edit", APPLY);
      const onProd = await callTool(server, "iris_child_edit", { ...APPLY, server: "prod" });

      expect(onDefault.structuredContent.inheritedFrom).toBe("iris_doc_put");
      expect(onProd.isError).toBeFalsy();
      expect(childSpy).toHaveBeenCalledTimes(1);
    });
  });

  it("with the parent disabled and the read-only preset, the denial names the parent and not the preset", async () => {
    process.env.IRIS_GOVERNANCE = JSON.stringify({ global: { iris_doc_put: false } });
    process.env.IRIS_GOVERNANCE_PRESET = "read-only";
    const { server } = await start();

    const denied = await callTool(server, "iris_child_edit", APPLY);

    expect(denied.structuredContent).toEqual({
      code: "GOVERNANCE_DISABLED",
      action: "iris_child_edit:apply",
      server: "default",
      inheritedFrom: "iris_doc_put",
    });
    expect("presetApplied" in denied.structuredContent).toBe(false);
  });

  describe("an explicit setting on the child wins over the inherited disable", () => {
    const configure: Array<[string, () => void]> = [
      [
        "env global",
        () => (process.env.IRIS_GOVERNANCE = JSON.stringify({ global: { iris_doc_put: false, "iris_child_edit:apply": true } })),
      ],
      [
        "env profile",
        () =>
          (process.env.IRIS_GOVERNANCE = JSON.stringify({
            global: { iris_doc_put: false },
            profiles: { default: { "iris_child_edit:apply": true } },
          })),
      ],
      [
        "file global",
        () => {
          process.env.IRIS_GOVERNANCE = JSON.stringify({ global: { iris_doc_put: false } });
          governanceFile({ global: { "iris_child_edit:apply": true } });
        },
      ],
      [
        "file profile",
        () => {
          process.env.IRIS_GOVERNANCE = JSON.stringify({ global: { iris_doc_put: false } });
          governanceFile({ profiles: { default: { "iris_child_edit:apply": true } } });
        },
      ],
    ];
    for (const [layer, apply] of configure) {
      it(`${layer}: apply runs, and the other key still inherits`, async () => {
        apply();
        const { server, childSpy } = await start();

        const applied = await callTool(server, "iris_child_edit", APPLY);
        const other = await callTool(server, "iris_child_edit", OTHER);

        expect(applied.isError).toBeFalsy();
        expect(childSpy).toHaveBeenCalledTimes(1);
        expect(other.structuredContent.inheritedFrom).toBe("iris_doc_put");
      });
    }

    it("an explicit false on apply while the parent is also disabled is the key's own denial, with no inheritedFrom", async () => {
      process.env.IRIS_GOVERNANCE = JSON.stringify({
        global: { iris_doc_put: false, "iris_child_edit:apply": false },
      });
      const { server, childSpy } = await start();

      const denied = await callTool(server, "iris_child_edit", APPLY);
      const deniedOther = await callTool(server, "iris_child_edit", OTHER);

      expect(JSON.stringify(denied)).toBe(
        '{"content":[{"type":"text","text":"action \'iris_child_edit:apply\' is disabled by governance policy for server \'default\'"}],"structuredContent":{"code":"GOVERNANCE_DISABLED","action":"iris_child_edit:apply","server":"default"},"isError":true}',
      );
      // The other key of the same tool has no setting of its own, so it still inherits.
      expect(deniedOther.structuredContent.inheritedFrom).toBe("iris_doc_put");
      expect(childSpy).not.toHaveBeenCalled();
    });
  });

  it("a parent enabled at a higher layer than the file's disable leaves apply running", async () => {
    process.env.IRIS_GOVERNANCE = JSON.stringify({ global: { iris_doc_put: true } });
    governanceFile({ global: { iris_doc_put: false } });
    const { server, childSpy } = await start();

    const applied = await callTool(server, "iris_child_edit", APPLY);

    expect(applied.isError).toBeFalsy();
    expect(childSpy).toHaveBeenCalledTimes(1);
  });

  it("an explicit enable of the other action runs its handler", async () => {
    process.env.IRIS_GOVERNANCE = JSON.stringify({ global: { "iris_child_edit:other": true } });
    const { server, childSpy } = await start();

    const result = await callTool(server, "iris_child_edit", OTHER);

    expect(result.isError).toBeFalsy();
    expect(childSpy).toHaveBeenCalledTimes(1);
  });

  it("a hidden parent still seeds the child disabled, and construction succeeds (the parent is a baseline key)", async () => {
    process.env.IRIS_TOOLS_DISABLE = "iris_doc_put";
    process.env.IRIS_GOVERNANCE = JSON.stringify({ global: { iris_doc_put: false } });

    const { server, childSpy } = await start();
    const denied = await callTool(server, "iris_child_edit", APPLY);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((server.server as any)._registeredTools["iris_doc_put"]).toBeUndefined();
    expect(denied.structuredContent.inheritedFrom).toBe("iris_doc_put");
    expect(childSpy).not.toHaveBeenCalled();
  });

  describe("construction throws on a bad parent, naming the tool and the parent", () => {
    const build = (tools: ToolDefinition[]) => () =>
      new McpServerBase({ name: "test-server", version: "1.0.0", tools, needsCustomRest: false });

    it("a parent that is neither a baseline key nor a registered key", () => {
      expect(build([child({ name: "iris_child_edit", parent: "iris_unknown_tool" })])).toThrow(
        /Tool "iris_child_edit" declares `parent` "iris_unknown_tool"/,
      );
    });

    it("a parent that is the key of another registered tool without a parent is accepted", () => {
      const tools = [
        plain("iris_doc_put"),
        without(child({ name: "iris_target" }), "parent"),
        child({ name: "iris_child_edit", parent: "iris_target:apply" }),
      ];
      expect(build(tools)).not.toThrow();
    });

    it("a parent that is the tool's own key", () => {
      expect(build([child({ name: "iris_child_edit", parent: "iris_child_edit:apply" })])).toThrow(
        /Tool "iris_child_edit" declares its own key "iris_child_edit:apply" as its `parent`/,
      );
    });

    it("a parent that itself has a parent", () => {
      const tools = [
        plain("iris_doc_put"),
        child({ name: "iris_child_edit", parent: "iris_doc_put" }),
        child({ name: "iris_grandchild", parent: "iris_child_edit:apply" }),
      ];
      expect(build(tools)).toThrow(/Tool "iris_grandchild" declares `parent` "iris_child_edit:apply"/);
    });

    it("a tool that owns a baseline key and declares a parent", () => {
      const declaring = { ...plain("iris_doc_get"), parent: "iris_doc_put" };
      expect(build([plain("iris_doc_put"), declaring])).toThrow(
        /Tool "iris_doc_get" declares `parent` "iris_doc_put" but owns the baseline key "iris_doc_get"/,
      );
    });
  });

  describe("discovery and the resource report the verdict the gate enforces", () => {
    it("iris_server_profiles reports the inherited policy and the parent source for both keys", async () => {
      process.env.IRIS_GOVERNANCE = JSON.stringify({ global: { iris_doc_put: false } });
      const { server } = await start();

      const discovery = await callTool(server, "iris_server_profiles", {});

      const { policy, configSource: sources } = discovery.structuredContent.governance;
      expect(policy["iris_child_edit:apply"]).toBe(false);
      expect(policy["iris_child_edit:other"]).toBe(false);
      expect(sources["iris_child_edit:apply"]).toBe("parent");
      expect(sources["iris_child_edit:other"]).toBe("parent");
      expect(policy["iris_doc_put"]).toBe(false);
      expect(sources["iris_doc_put"]).toBe("env");
    });

    it("the governance resource reports the same verdict and source", async () => {
      process.env.IRIS_GOVERNANCE = JSON.stringify({ global: { iris_doc_put: false } });
      const { server } = await start();

      const resource = await readResource(server, "iris-governance://default");

      expect(resource.policy["iris_child_edit:apply"]).toBe(false);
      expect(resource.configSource["iris_child_edit:apply"]).toBe("parent");
      expect(resource.configSource["iris_child_edit:other"]).toBe("parent");
    });

    it("iris_server_profiles with allProfiles reports the inherited verdict for the profile that disables the parent only", async () => {
      process.env.IRIS_PROFILES = JSON.stringify({ prod: { host: "prod.example.com", namespace: "PRODNS" } });
      process.env.IRIS_GOVERNANCE = JSON.stringify({ profiles: { default: { iris_doc_put: false } } });
      const { server } = await start();

      const discovery = await callTool(server, "iris_server_profiles", { allProfiles: true });

      const { policies, configSources } = discovery.structuredContent.governance;
      for (const action of ["apply", "other"]) {
        expect(policies.default[`iris_child_edit:${action}`], action).toBe(false);
        expect(configSources.default[`iris_child_edit:${action}`], action).toBe("parent");
      }
      expect(policies.prod["iris_child_edit:apply"]).toBe(true);
      expect(configSources.prod["iris_child_edit:apply"]).toBe("default");
    });

    it("with nothing configured, apply is enabled by default and other is disabled, both from the default seed", async () => {
      const { server } = await start();

      const discovery = await callTool(server, "iris_server_profiles", {});

      const { policy, configSource: sources } = discovery.structuredContent.governance;
      expect(policy["iris_child_edit:apply"]).toBe(true);
      expect(policy["iris_child_edit:other"]).toBe(false);
      expect(sources["iris_child_edit:apply"]).toBe("default");
      expect(sources["iris_child_edit:other"]).toBe("default");
    });

    it("the policy the discovery tool reports is the policy the gate enforces, for every configuration here", async () => {
      process.env.IRIS_GOVERNANCE = JSON.stringify({
        global: { iris_doc_put: false, "iris_child_edit:other": true },
      });
      const { server } = await start();

      const discovery = await callTool(server, "iris_server_profiles", {});
      const policy = discovery.structuredContent.governance.policy as Record<string, boolean>;

      for (const action of ["apply", "other"]) {
        const result = await callTool(server, "iris_child_edit", { action });
        expect(result.isError === true, action).toBe(!policy[`iris_child_edit:${action}`]);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Back-compat (AC-9).
// ---------------------------------------------------------------------------

describe("back-compat: with no parent explicitly disabled, every baseline key is byte-identical (AC-9)", () => {
  const baselineKeys = [...GOVERNANCE_BASELINE];
  const parentKeys = buildParentKeys(
    [child({ name: "iris_doc_edit_like", parent: "iris_doc_put" })],
    GOVERNANCE_BASELINE,
  );
  const mutates = buildMutatesLookup([child({ name: "iris_doc_edit_like" })]);
  const defaultEnabled = buildDefaultEnabledWrites([child({ name: "iris_doc_edit_like" })]);

  const configurations: Array<[string, GovernanceConfig, GovernancePreset | undefined, GovernanceConfig | undefined]> = [
    ["nothing configured", {}, undefined, undefined],
    ["the read-only preset", {}, "read-only", undefined],
    ["the full preset", {}, "full", undefined],
    ["the parent enabled explicitly", { global: { iris_doc_put: true } }, undefined, undefined],
    [
      "unrelated keys disabled in the env and in the file",
      { global: { iris_doc_get: false }, profiles: { prod: { iris_sql_execute: false } } },
      undefined,
      { global: { iris_global_get: false }, profiles: { default: { iris_doc_list: false } } },
    ],
    [
      "the parent enabled in the env and disabled in the file",
      { global: { iris_doc_put: true } },
      undefined,
      { global: { iris_doc_put: false } },
    ],
    ["the parent disabled", { global: { iris_doc_put: false } }, "read-only", { global: { iris_doc_get: false } }],
  ];

  for (const [title, config, preset, file] of configurations) {
    it(`${title}: the policy and the source of every baseline key are equal with and without the parent map`, () => {
      for (const profile of ["default", "prod"]) {
        const without = getEffectivePolicy(profile, config, baselineKeys, mutates, GOVERNANCE_BASELINE, defaultEnabled, preset, BASELINE_ACTION_CLASSIFICATIONS, file);
        const withMap = getEffectivePolicy(profile, config, baselineKeys, mutates, GOVERNANCE_BASELINE, defaultEnabled, preset, BASELINE_ACTION_CLASSIFICATIONS, file, parentKeys);
        expect(withMap, `${title} ${profile}`).toEqual(without);

        const sourcesWithout = getEffectiveConfigSources(profile, config, baselineKeys, mutates, preset, BASELINE_ACTION_CLASSIFICATIONS, file);
        const sourcesWith = getEffectiveConfigSources(profile, config, baselineKeys, mutates, preset, BASELINE_ACTION_CLASSIFICATIONS, file, parentKeys);
        expect(sourcesWith, `${title} ${profile}`).toEqual(sourcesWithout);
        expect(Object.values(sourcesWith)).not.toContain("parent");
      }
    });
  }

  it("with no parent explicitly disabled, the child's own keys are unchanged by the parent map too (policy and source)", () => {
    const keys = [...baselineKeys, "iris_doc_edit_like:apply", "iris_doc_edit_like:other"];
    const withoutDisable = configurations.filter(([title]) => title !== "the parent disabled");
    expect(withoutDisable.length, "every configuration but the one that disables the parent").toBe(configurations.length - 1);
    for (const [title, config, preset, file] of withoutDisable) {
      const without = getEffectivePolicy("default", config, keys, mutates, GOVERNANCE_BASELINE, defaultEnabled, preset, BASELINE_ACTION_CLASSIFICATIONS, file);
      const withMap = getEffectivePolicy("default", config, keys, mutates, GOVERNANCE_BASELINE, defaultEnabled, preset, BASELINE_ACTION_CLASSIFICATIONS, file, parentKeys);
      expect(withMap, title).toEqual(without);
      const sourcesWithout = getEffectiveConfigSources("default", config, keys, mutates, preset, BASELINE_ACTION_CLASSIFICATIONS, file);
      const sourcesWith = getEffectiveConfigSources("default", config, keys, mutates, preset, BASELINE_ACTION_CLASSIFICATIONS, file, parentKeys);
      expect(sourcesWith, title).toEqual(sourcesWithout);
    }
  });

  it("with the parent map empty, the new keys' policy and source equal the run without it, whatever the configuration", () => {
    const keys = [...baselineKeys, "iris_doc_edit_like:apply", "iris_doc_edit_like:other"];
    for (const [, config, preset, file] of configurations) {
      const without = getEffectivePolicy("default", config, keys, mutates, GOVERNANCE_BASELINE, defaultEnabled, preset, BASELINE_ACTION_CLASSIFICATIONS, file);
      const empty = getEffectivePolicy("default", config, keys, mutates, GOVERNANCE_BASELINE, defaultEnabled, preset, BASELINE_ACTION_CLASSIFICATIONS, file, new Map());
      expect(empty).toEqual(without);
    }
  });

  it("the parent map changes only the child's keys, and only when the parent is disabled", () => {
    const keys = [...baselineKeys, "iris_doc_edit_like:apply", "iris_doc_edit_like:other"];
    const config: GovernanceConfig = { global: { iris_doc_put: false } };
    const without = getEffectivePolicy("default", config, keys, mutates, GOVERNANCE_BASELINE, defaultEnabled, undefined, BASELINE_ACTION_CLASSIFICATIONS);
    const withMap = getEffectivePolicy("default", config, keys, mutates, GOVERNANCE_BASELINE, defaultEnabled, undefined, BASELINE_ACTION_CLASSIFICATIONS, undefined, parentKeys);
    const changed = Object.keys(without).filter((key) => without[key] !== withMap[key]);
    expect(changed).toEqual(["iris_doc_edit_like:apply"]);
  });
});
