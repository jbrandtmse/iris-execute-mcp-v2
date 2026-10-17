/**
 * Governance keys that name nothing (Story 39.0, DW-565, ACs 1 and 3).
 *
 * A key inside a layer that is none of a tool's keys is accepted and does nothing: a
 * typo (`iris_doc_putt`), a bare name for a per-action tool (`iris_doc_edit`), an action
 * on a single-operation tool, or an action the tool lacks. `unmatchedGovernanceKeys`
 * classifies such keys; `McpServerBase.start()` warns about the ones its own tools prove
 * dead, and `iris-mcp-governance check` reports the ones no tool of the suite has.
 *
 * Expected message texts come from the Story 39.0 intent contract (its I/O matrix), never
 * from the implementation (Rule #36). The "every key of the universe" row builds its
 * document and its key map from the REAL built dist through `universe --json`, so the
 * classifier never reports a key of a real tool dead against the universe derivation
 * (`check`'s map). The server's own map, `governanceKeysByTool` over its registered
 * tools, is exercised on the built dev and interop servers by the Story 38.7 process
 * gate in `@iris-mcp/all`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { BootstrapResult } from "../bootstrap.js";
import { runCli } from "../cli/governance.js";
import {
  governanceKeysByTool,
  unknownProfileWarnings,
  unmatchedGovernanceKeys,
  type GovernanceConfig,
} from "../governance.js";
import { SERVER_DISCOVERY_TOOL_NAME } from "../server-discovery.js";
import type { ServerDiscoveryResult } from "../server-discovery.js";
import type { ToolDefinition } from "../tool-types.js";
import { callTool, makeEnvHarness, stageDefaultStartup } from "./test-helpers.js";

// Mock ONLY the `bootstrap` export so establishment never reaches a real IRIS.
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

// Import AFTER vi.mock so server-base picks up the mocked bootstrap.
const { McpServerBase } = await import("../server-base.js");
type McpServerBaseOptions = import("../server-base.js").McpServerBaseOptions;

// This file lives at packages/shared/src/__tests__/, four levels below the monorepo root.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

// -- Fixture tools: names and action enums mirror real tools, so the keys are real --

function tool(name: string, actions?: readonly string[]): ToolDefinition {
  const shape: Record<string, z.ZodTypeAny> = { value: z.string().optional() };
  if (actions !== undefined) shape["action"] = z.enum(actions as [string, ...string[]]);
  return {
    name,
    title: name,
    description: `Fixture tool ${name}.`,
    inputSchema: z.object(shape),
    annotations: { readOnlyHint: true },
    scope: "NS",
    mutates: actions === undefined ? "read" : Object.fromEntries(actions.map((action) => [action, "read" as const])),
    handler: async () => ({ content: [{ type: "text" as const, text: "ok" }] }),
  };
}

const DOC_EDIT_ACTIONS = ["apply", "regenerateStorage"] as const;
const CONTROL_ACTIONS = ["start", "stop", "restart", "update", "recover", "clean"] as const;

const DOC_EDIT = tool("iris_doc_edit", DOC_EDIT_ACTIONS);
const DOC_PUT = tool("iris_doc_put");
const CONTROL = tool("iris_production_control", CONTROL_ACTIONS);

const SRC = "IRIS_GOVERNANCE";
const keysByTool = governanceKeysByTool([DOC_EDIT, DOC_PUT, CONTROL]);

/** One finding's message for a key in a one-layer document. */
function messagesFor(
  config: GovernanceConfig,
  scope: "server" | "suite",
  source = SRC,
  keys: ReadonlyMap<string, readonly string[]> = keysByTool,
): string[] {
  return unmatchedGovernanceKeys(config, source, keys, scope).map((finding) => finding.message);
}

// ====================================================================
// governanceKeysByTool
// ====================================================================

describe("governanceKeysByTool", () => {
  it("lists tool:action per action-enum value in enum order, and the bare name otherwise", () => {
    expect(keysByTool.get("iris_doc_edit")).toEqual(["iris_doc_edit:apply", "iris_doc_edit:regenerateStorage"]);
    expect(keysByTool.get("iris_doc_put")).toEqual(["iris_doc_put"]);
    expect(keysByTool.get("iris_production_control")).toEqual(CONTROL_ACTIONS.map((action) => `iris_production_control:${action}`));
  });

  it("is keyed by tool name, so a tool listed twice contributes one entry", () => {
    expect([...governanceKeysByTool([DOC_PUT, DOC_PUT]).keys()]).toEqual(["iris_doc_put"]);
  });
});

// ====================================================================
// unmatchedGovernanceKeys: forms (a) to (d), in both scopes
// ====================================================================

describe("unmatchedGovernanceKeys classifies each dead key in one of four forms (Story 39.0 matrix)", () => {
  it("(a) a bare name for a per-action tool: governed per action, listing the tool's keys in derivation order", () => {
    const config: GovernanceConfig = { global: { iris_doc_edit: false } };
    const expected = [
      'IRIS_GOVERNANCE: "iris_doc_edit" under "global" has no effect, because iris_doc_edit is governed per action. Set the actions you mean instead: iris_doc_edit:apply, iris_doc_edit:regenerateStorage.',
    ];
    expect(messagesFor(config, "server")).toEqual(expected);
    expect(messagesFor(config, "suite")).toEqual(expected);
  });

  it("(b) an action on a single-operation tool: the tool takes no action", () => {
    const config: GovernanceConfig = { global: { "iris_doc_put:apply": false } };
    const expected = [
      'IRIS_GOVERNANCE: "iris_doc_put:apply" under "global" has no effect, because iris_doc_put takes no action. Use "iris_doc_put" instead.',
    ];
    expect(messagesFor(config, "server")).toEqual(expected);
    expect(messagesFor(config, "suite")).toEqual(expected);
  });

  it("(c) an action the tool lacks, in a file profile layer: lists the tool's keys, names the file and the profile", () => {
    const config: GovernanceConfig = { profiles: { default: { "iris_production_control:strat": false } } };
    const source = "IRIS_GOVERNANCE_FILE (path: /etc/iris/governance.json)";
    const expected = [
      'IRIS_GOVERNANCE_FILE (path: /etc/iris/governance.json): "iris_production_control:strat" under profile "default" has no effect, because iris_production_control has no action "strat". Use one of: iris_production_control:start, iris_production_control:stop, iris_production_control:restart, iris_production_control:update, iris_production_control:recover, iris_production_control:clean.',
    ];
    expect(messagesFor(config, "server", source)).toEqual(expected);
    expect(messagesFor(config, "suite", source)).toEqual(expected);
  });

  it('(c) the action is everything after the first ":", and letter case matters', () => {
    expect(messagesFor({ global: { "iris_doc_edit:Apply": true, "iris_doc_edit:apply:extra": true } }, "server")).toEqual([
      'IRIS_GOVERNANCE: "iris_doc_edit:Apply" under "global" has no effect, because iris_doc_edit has no action "Apply". Use one of: iris_doc_edit:apply, iris_doc_edit:regenerateStorage.',
      'IRIS_GOVERNANCE: "iris_doc_edit:apply:extra" under "global" has no effect, because iris_doc_edit has no action "apply:extra". Use one of: iris_doc_edit:apply, iris_doc_edit:regenerateStorage.',
    ]);
  });

  it("(d) a key whose tool nothing has: reported in suite scope only, since another server may enforce it", () => {
    const config: GovernanceConfig = { global: { iris_doc_putt: false, "iris_made_up:thing": true } };
    expect(messagesFor(config, "server")).toEqual([]);
    expect(messagesFor(config, "suite")).toEqual([
      'IRIS_GOVERNANCE: "iris_doc_putt" under "global" has no effect, because no tool of the suite has this key. Check it for a typo; iris-mcp-governance universe lists every key.',
      'IRIS_GOVERNANCE: "iris_made_up:thing" under "global" has no effect, because no tool of the suite has this key. Check it for a typo; iris-mcp-governance universe lists every key.',
    ]);
  });

  it("a key that is one of a tool's keys is never reported", () => {
    const config: GovernanceConfig = {
      global: { iris_doc_put: false, "iris_doc_edit:apply": true },
      profiles: { prod: { "iris_production_control:clean": false } },
    };
    expect(messagesFor(config, "server")).toEqual([]);
    expect(messagesFor(config, "suite")).toEqual([]);
  });

  it("walks global first, then each profile in document order, and returns the structured finding", () => {
    const config: GovernanceConfig = {
      profiles: { prod: { iris_doc_edit: true }, default: { "iris_doc_put:x": true } },
      global: { iris_doc_putt: true },
    };
    const findings = unmatchedGovernanceKeys(config, SRC, keysByTool, "suite");
    expect(findings.map(({ layer, key }) => [layer, key])).toEqual([
      ['"global"', "iris_doc_putt"],
      ['profile "prod"', "iris_doc_edit"],
      ['profile "default"', "iris_doc_put:x"],
    ]);
    expect(findings[0]).toEqual({
      source: SRC,
      layer: '"global"',
      key: "iris_doc_putt",
      message: expect.stringContaining('"iris_doc_putt" under "global" has no effect'),
    });
  });

  it("an absent config, or one without layers, has no findings", () => {
    expect(unmatchedGovernanceKeys(undefined, SRC, keysByTool, "suite")).toEqual([]);
    expect(unmatchedGovernanceKeys({}, SRC, keysByTool, "suite")).toEqual([]);
  });

  it("never reads a value: a layer whose values would throw on access still classifies by name", () => {
    const layer: Record<string, boolean> = {};
    for (const key of ["iris_doc_edit", "iris_doc_putt"]) {
      Object.defineProperty(layer, key, {
        enumerable: true,
        get() {
          throw new Error(`the value of ${key} was read`);
        },
      });
    }
    const messages = messagesFor({ global: layer }, "suite");
    expect(messages).toHaveLength(2);
    for (const message of messages) expect(message).not.toMatch(/\b(true|false)\b/);
  });

  it("keys named like Object.prototype members are classified by lookup, never by property access", () => {
    expect(messagesFor({ global: { toString: true, hasOwnProperty: true } }, "server")).toEqual([]);
    expect(messagesFor({ global: { toString: true, hasOwnProperty: true } }, "suite")).toHaveLength(2);
  });
});

describe("a document holding every key of the universe has no dead key (Story 39.0, AC-3)", () => {
  it("is clean in both scopes for the keys the REAL built dist derives", { timeout: 60_000 }, async () => {
    const stdout = { text: "", write(chunk: string): void { this.text += chunk; } };
    const stderr = { text: "", write(chunk: string): void { this.text += chunk; } };
    const code = await runCli(["universe", "--root", REPO_ROOT, "--json"], { env: {}, stdout, stderr });
    expect(code, stderr.text).toBe(0);
    const universe = JSON.parse(stdout.text) as {
      packages: { tools: { name: string; keys: string[] }[] }[];
      frameworkTool: { name: string; keys: string[] };
      keys: string[];
    };
    const byTool = new Map<string, readonly string[]>();
    for (const pkg of universe.packages) for (const t of pkg.tools) byTool.set(t.name, t.keys);
    byTool.set(universe.frameworkTool.name, universe.frameworkTool.keys);

    const everything = Object.fromEntries(universe.keys.map((key) => [key, true]));
    const config: GovernanceConfig = { global: everything, profiles: { default: everything } };
    expect(universe.keys.length).toBeGreaterThan(100);
    expect(messagesFor(config, "suite", SRC, byTool)).toEqual([]);
    expect(messagesFor(config, "server", SRC, byTool)).toEqual([]);
  });
});

// ====================================================================
// McpServerBase.start(): the server warns about the keys its own tools prove dead
// ====================================================================

const ENV_OPTIONS = {
  onSetup: () => bootstrapSpy.mockClear(),
} as const;

function makeServerOpts(tools: ToolDefinition[]): McpServerBaseOptions {
  return { name: "test-server", version: "1.0.0", tools, needsCustomRest: false };
}

describe("start() warns about a governance key its own tools prove dead, and keeps running (Story 39.0, AC-1)", () => {
  const env = makeEnvHarness(ENV_OPTIONS);
  beforeEach(env.setup);
  afterEach(env.teardown);

  /** The `[WARN]` lines `start()` wrote about a key that has no effect. */
  function deadKeyWarnings(): string[] {
    return vi
      .mocked(console.error)
      .mock.calls.map((call) => String(call[0]))
      .filter((line) => line.includes("has no effect"));
  }

  /** Start a server with `tools` and the current environment; return the policy it reports. */
  async function startedPolicy(tools: ToolDefinition[]) {
    stageDefaultStartup(env.fetchMock);
    const server = new McpServerBase(makeServerOpts(tools));
    await server.start("stdio");
    const result = await callTool(server, SERVER_DISCOVERY_TOOL_NAME, {});
    const governance = (result.structuredContent as ServerDiscoveryResult).governance;
    return { policy: governance.policy, configSource: governance.configSource };
  }

  it("a bare per-action tool name: exactly one WARN, form (a), and the policy equals the no-governance report", async () => {
    const baseline = await startedPolicy([DOC_EDIT, DOC_PUT]);
    env.teardown();
    env.setup();

    process.env.IRIS_GOVERNANCE = JSON.stringify({ global: { iris_doc_edit: false } });
    const report = await startedPolicy([DOC_EDIT, DOC_PUT]);

    expect(deadKeyWarnings()).toEqual([
      '[WARN] IRIS_GOVERNANCE: "iris_doc_edit" under "global" has no effect, because iris_doc_edit is governed per action. Set the actions you mean instead: iris_doc_edit:apply, iris_doc_edit:regenerateStorage.',
    ]);
    expect(report).toEqual(baseline);
    expect(env.exitMock).not.toHaveBeenCalled();
  });

  it("an action on a single-operation tool: one WARN, form (b)", async () => {
    process.env.IRIS_GOVERNANCE = JSON.stringify({ global: { "iris_doc_put:apply": false } });
    await startedPolicy([DOC_EDIT, DOC_PUT]);
    expect(deadKeyWarnings()).toEqual([
      '[WARN] IRIS_GOVERNANCE: "iris_doc_put:apply" under "global" has no effect, because iris_doc_put takes no action. Use "iris_doc_put" instead.',
    ]);
  });

  it("an unknown action in a file, profile layer: one WARN, form (c), naming the path, the profile and the six keys", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "iris-gov-dead-key-"));
    const file = path.join(dir, "governance.json");
    writeFileSync(file, JSON.stringify({ profiles: { default: { "iris_production_control:strat": false } } }), "utf8");
    process.env.IRIS_GOVERNANCE_FILE = file;
    try {
      await startedPolicy([CONTROL]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    expect(deadKeyWarnings()).toEqual([
      `[WARN] IRIS_GOVERNANCE_FILE (path: ${file}): "iris_production_control:strat" under profile "default" has no effect, because iris_production_control has no action "strat". Use one of: ${CONTROL_ACTIONS.map((action) => `iris_production_control:${action}`).join(", ")}.`,
    ]);
  });

  it("a key of a tool this server does not register, and a key no tool has, log nothing here", async () => {
    process.env.IRIS_GOVERNANCE = JSON.stringify({ global: { iris_production_control: false, iris_doc_putt: false } });
    await startedPolicy([DOC_EDIT, DOC_PUT]);
    expect(deadKeyWarnings()).toEqual([]);
  });

  it("a hidden tool counts as registered: the bare key warns, the real action key does not", async () => {
    process.env.IRIS_TOOLS_DISABLE = "iris_doc_edit";
    process.env.IRIS_GOVERNANCE = JSON.stringify({ global: { iris_doc_edit: false, "iris_doc_edit:apply": false } });
    await startedPolicy([DOC_EDIT, DOC_PUT]);
    expect(deadKeyWarnings()).toEqual([
      '[WARN] IRIS_GOVERNANCE: "iris_doc_edit" under "global" has no effect, because iris_doc_edit is governed per action. Set the actions you mean instead: iris_doc_edit:apply, iris_doc_edit:regenerateStorage.',
    ]);
  });

  it("the framework tool's own key is a valid key", async () => {
    process.env.IRIS_GOVERNANCE = JSON.stringify({ global: { [SERVER_DISCOVERY_TOOL_NAME]: true, [`${SERVER_DISCOVERY_TOOL_NAME}:x`]: true } });
    await startedPolicy([DOC_PUT]);
    expect(deadKeyWarnings()).toEqual([
      `[WARN] IRIS_GOVERNANCE: "${SERVER_DISCOVERY_TOOL_NAME}:x" under "global" has no effect, because ${SERVER_DISCOVERY_TOOL_NAME} takes no action. Use "${SERVER_DISCOVERY_TOOL_NAME}" instead.`,
    ]);
  });

  it("a valid document logs no such line, in either channel", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "iris-gov-valid-"));
    const file = path.join(dir, "governance.json");
    writeFileSync(file, JSON.stringify({ global: { "iris_doc_edit:apply": false }, profiles: { default: { iris_doc_put: false } } }), "utf8");
    process.env.IRIS_GOVERNANCE_FILE = file;
    process.env.IRIS_GOVERNANCE = JSON.stringify({ global: { iris_doc_put: true }, profiles: { default: { "iris_production_control:clean": false } } });
    try {
      await startedPolicy([DOC_EDIT, DOC_PUT, CONTROL]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    expect(deadKeyWarnings()).toEqual([]);
  });

  it("warns for both channels, the environment first, after the unknown-profile warnings", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "iris-gov-both-"));
    const file = path.join(dir, "governance.json");
    writeFileSync(file, JSON.stringify({ global: { iris_doc_put: true, "iris_doc_put:x": true } }), "utf8");
    process.env.IRIS_GOVERNANCE_FILE = file;
    process.env.IRIS_GOVERNANCE = JSON.stringify({ global: { iris_doc_edit: true }, profiles: { prdo: { iris_doc_put: true } } });
    try {
      await startedPolicy([DOC_EDIT, DOC_PUT]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    const warnings = vi
      .mocked(console.error)
      .mock.calls.map((call) => String(call[0]))
      .filter((line) => line.startsWith("[WARN]") && line.includes("IRIS_GOVERNANCE"));
    expect(warnings).toEqual([
      `[WARN] ${unknownProfileWarnings({ profiles: { prdo: {} } }, "IRIS_GOVERNANCE", ["default"])[0]}`,
      '[WARN] IRIS_GOVERNANCE: "iris_doc_edit" under "global" has no effect, because iris_doc_edit is governed per action. Set the actions you mean instead: iris_doc_edit:apply, iris_doc_edit:regenerateStorage.',
      `[WARN] IRIS_GOVERNANCE_FILE (path: ${file}): "iris_doc_put:x" under "global" has no effect, because iris_doc_put takes no action. Use "iris_doc_put" instead.`,
    ]);
  });
});
