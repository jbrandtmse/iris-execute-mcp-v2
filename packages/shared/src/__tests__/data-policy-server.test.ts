/**
 * Story 39.2: the PHI data policy on a real `McpServerBase` (AD-3, AD-8, AD-9, AD-19).
 *
 * Boots the server through `makeEnvHarness`/`stageDefaultStartup`/`callTool` (no live IRIS) and pins:
 * the startup resolution of each channel, every fail-fast and warning row, the roster fields of
 * `iris_server_profiles`, the policy a handler sees in `ctx.config`, the audit entry's `dataPolicy`
 * field, the declared PHI inputs under `IRIS_AUDIT_LOG_PARAMS`, a policy refusal, and the registration
 * checks of a `ToolDefinition.dataPolicy` declaration.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { McpServerBase } from "../server-base.js";
import type { ToolDefinition } from "../tool-types.js";
import { SERVER_DISCOVERY_TOOL_NAME } from "../server-discovery.js";
import type { ServerDiscoveryResult } from "../server-discovery.js";
import { REFUSAL_CODES, refusalResult } from "../refusals.js";
import { makeEnvHarness } from "./env-harness.js";
import { callTool, stageDefaultStartup } from "./test-helpers.js";

const env = makeEnvHarness();
beforeEach(env.setup);
afterEach(env.teardown);

let tempDir: string | undefined;
afterEach(() => {
  if (tempDir !== undefined) rmSync(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

/** A fresh temp directory, removed after the test. */
function scratch(): string {
  tempDir ??= mkdtempSync(join(tmpdir(), "data-policy-server-"));
  return tempDir;
}

/** Write a governance file holding `document` and return its path. */
function governanceFile(document: unknown): string {
  const path = join(scratch(), "governance.json");
  writeFileSync(path, JSON.stringify(document));
  return path;
}

/**
 * A governed tool: `preview` is the governed action, `other` is not. Its handler reports the policy it
 * sees in `ctx.config` and, per `mode`, a policy summary, a refusal, or nothing.
 */
function governedTool(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    name: "iris_synth_phi",
    title: "Synthetic PHI tool",
    description: "A synthetic tool for the data-policy tests.",
    inputSchema: z.object({
      action: z.enum(["preview", "other"]),
      value: z.string().optional(),
      mode: z.enum(["summary", "refuse", "badSummary", "plain"]).optional(),
      namespace: z.string().optional(),
    }),
    annotations: { readOnlyHint: true },
    scope: "NS",
    mutates: { preview: "read", other: "read" },
    dataPolicy: { actions: ["preview"], phiInputs: ["value"] },
    handler: async (args, ctx) => {
      const a = args as { mode?: string };
      if (a.mode === "refuse") {
        return refusalResult(REFUSAL_CODES.DATA_POLICY_BLOCKED, "The block data policy withholds every message body. Set IRIS_DATA_POLICY.");
      }
      const seen = { configPolicy: ctx.config.dataPolicy, configSource: ctx.config.dataPolicySource };
      if (a.mode === "summary") {
        return {
          content: [{ type: "text" as const, text: "ok" }],
          structuredContent: { ...seen, dataPolicy: { policy: "block", redacted: 4, blocked: 3 } },
        };
      }
      if (a.mode === "badSummary") {
        return {
          content: [{ type: "text" as const, text: "ok" }],
          structuredContent: { ...seen, dataPolicy: { policy: "bogus", redacted: -1, blocked: 1.5 } },
        };
      }
      return { content: [{ type: "text" as const, text: "ok" }], structuredContent: seen };
    },
    ...overrides,
  };
}

/** A tool with no `dataPolicy` declaration. */
function undeclaredTool(): ToolDefinition {
  return {
    name: "iris_synth_plain",
    title: "Synthetic plain tool",
    description: "A synthetic tool outside the data policy.",
    inputSchema: z.object({ value: z.string().optional() }),
    annotations: { readOnlyHint: true },
    scope: "NS",
    mutates: "read",
    handler: async () => ({ content: [{ type: "text" as const, text: "ok" }], structuredContent: { ok: true } }),
  };
}

/** Construct and start a server on the mocked fetch. */
async function startServer(tools: ToolDefinition[] = [governedTool(), undeclaredTool()]): Promise<McpServerBase> {
  stageDefaultStartup(env.fetchMock);
  const server = new McpServerBase({ name: "test-server", version: "1.0.0", tools });
  await server.start("stdio");
  return server;
}

/** The roster of `iris_server_profiles`, keyed by profile name. */
async function roster(server: McpServerBase): Promise<Record<string, { dataPolicy: string; dataPolicySource: string }>> {
  const result = await callTool(server, SERVER_DISCOVERY_TOOL_NAME, {});
  const discovery = result.structuredContent as ServerDiscoveryResult;
  return Object.fromEntries(discovery.profiles.map((p) => [p.name, { dataPolicy: p.dataPolicy, dataPolicySource: p.dataPolicySource }]));
}

/** The text of every `[WARN]` line the server logged. */
function warnings(): string[] {
  return (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls
    .map((call) => String(call[0]))
    .filter((line) => line.includes("[WARN]"));
}

describe("startup resolution (AC-1)", () => {
  it("with no configuration, every profile is redact from default", async () => {
    process.env.IRIS_PROFILES = JSON.stringify({ p: {} });
    const server = await startServer();
    expect(await roster(server)).toEqual({
      default: { dataPolicy: "redact", dataPolicySource: "default" },
      p: { dataPolicy: "redact", dataPolicySource: "default" },
    });
  });

  it("walks the whole precedence, removing one layer at a time", async () => {
    const file = governanceFile({ dataPolicy: { global: "allow", profiles: { p: "allow" } } });

    process.env.IRIS_PROFILES = JSON.stringify({ p: { dataPolicy: "block" } });
    process.env.IRIS_DATA_POLICY = "allow";
    process.env.IRIS_GOVERNANCE_FILE = file;
    expect(await roster(await startServer())).toMatchObject({
      p: { dataPolicy: "block", dataPolicySource: "IRIS_PROFILES" },
      default: { dataPolicy: "allow", dataPolicySource: "IRIS_DATA_POLICY" },
    });

    env.setup();
    process.env.IRIS_PROFILES = JSON.stringify({ p: {} });
    process.env.IRIS_DATA_POLICY = "allow";
    process.env.IRIS_GOVERNANCE_FILE = governanceFile({ dataPolicy: { global: "block", profiles: { p: "block" } } });
    expect(await roster(await startServer())).toMatchObject({ p: { dataPolicy: "allow", dataPolicySource: "IRIS_DATA_POLICY" } });

    env.setup();
    process.env.IRIS_PROFILES = JSON.stringify({ p: {} });
    process.env.IRIS_GOVERNANCE_FILE = governanceFile({ dataPolicy: { global: "block", profiles: { p: "allow" } } });
    expect(await roster(await startServer())).toMatchObject({
      p: { dataPolicy: "allow", dataPolicySource: "IRIS_GOVERNANCE_FILE:profiles" },
      default: { dataPolicy: "block", dataPolicySource: "IRIS_GOVERNANCE_FILE:global" },
    });

    env.setup();
    process.env.IRIS_PROFILES = JSON.stringify({ p: {} });
    process.env.IRIS_GOVERNANCE_FILE = governanceFile({ dataPolicy: { global: "allow" } });
    expect(await roster(await startServer())).toMatchObject({
      p: { dataPolicy: "allow", dataPolicySource: "IRIS_GOVERNANCE_FILE:global" },
    });

    env.setup();
    process.env.IRIS_PROFILES = JSON.stringify({ p: {} });
    expect(await roster(await startServer())).toMatchObject({ p: { dataPolicy: "redact", dataPolicySource: "default" } });
  });

  it("never inherits a value from the default entry", async () => {
    process.env.IRIS_PROFILES = JSON.stringify({ default: { dataPolicy: "allow" }, p: {} });
    expect(await roster(await startServer())).toEqual({
      default: { dataPolicy: "allow", dataPolicySource: "IRIS_PROFILES" },
      p: { dataPolicy: "redact", dataPolicySource: "default" },
    });
  });

  it("gives a Server Manager profile the file's profile value", async () => {
    const dir = scratch();
    const settings = join(dir, "settings.json");
    writeFileSync(
      settings,
      JSON.stringify({
        "intersystems.servers": {
          sm: { webServer: { scheme: "http", host: "sm.example.com", port: 52773 }, username: "smuser", password: "smpw" },
        },
      }),
    );
    process.env.IRIS_SERVER_MANAGER = "auto";
    process.env.IRIS_SM_SETTINGS_PATHS = settings;
    process.env.IRIS_GOVERNANCE_FILE = governanceFile({ dataPolicy: { profiles: { sm: "block" } } });
    expect(await roster(await startServer())).toMatchObject({
      sm: { dataPolicy: "block", dataPolicySource: "IRIS_GOVERNANCE_FILE:profiles" },
      default: { dataPolicy: "redact", dataPolicySource: "default" },
    });
  });

  it("accepts IRIS_DATA_POLICY in any letter case, and treats an empty one as unset", async () => {
    process.env.IRIS_DATA_POLICY = "BLOCK";
    expect(await roster(await startServer())).toEqual({ default: { dataPolicy: "block", dataPolicySource: "IRIS_DATA_POLICY" } });
    env.setup();
    process.env.IRIS_DATA_POLICY = "";
    expect(await roster(await startServer())).toEqual({ default: { dataPolicy: "redact", dataPolicySource: "default" } });
  });

  it("warns about a profile name under dataPolicy.profiles that no profile carries, and starts", async () => {
    process.env.IRIS_GOVERNANCE_FILE = governanceFile({ dataPolicy: { profiles: { ghost: "block" } } });
    const server = await startServer();
    const matching = warnings().filter((line) => line.includes("ghost") && line.includes("dataPolicy.profiles"));
    expect(matching).toHaveLength(1);
    expect(await roster(server)).toEqual({ default: { dataPolicy: "redact", dataPolicySource: "default" } });
  });

  it("a governance file without dataPolicy starts exactly as before", async () => {
    process.env.IRIS_GOVERNANCE_FILE = governanceFile({ global: { iris_synth_plain: true }, comment: "x" });
    expect(await roster(await startServer())).toEqual({ default: { dataPolicy: "redact", dataPolicySource: "default" } });
    expect(warnings().filter((line) => line.includes("dataPolicy"))).toEqual([]);
  });

  it("hands a handler the policy that applies to the profile the call names", async () => {
    process.env.IRIS_PROFILES = JSON.stringify({ p: { dataPolicy: "allow" } });
    process.env.IRIS_DATA_POLICY = "block";
    const server = await startServer();
    const onDefault = await callTool(server, "iris_synth_phi", { action: "preview" });
    expect(onDefault.structuredContent).toMatchObject({ configPolicy: "block", configSource: "IRIS_DATA_POLICY" });
    stageDefaultStartup(env.fetchMock);
    const onP = await callTool(server, "iris_synth_phi", { action: "preview", server: "p" });
    expect(onP.structuredContent).toMatchObject({ configPolicy: "allow", configSource: "IRIS_PROFILES" });
  });
});

describe("startup fails fast, naming the channel (AD-8)", () => {
  it("IRIS_DATA_POLICY with a value that is not a policy", async () => {
    process.env.IRIS_DATA_POLICY = "open";
    await expect(startServer()).rejects.toThrow('IRIS_DATA_POLICY must be "block", "redact" or "allow". Received: "open".');
  });

  it("an IRIS_PROFILES entry whose dataPolicy is not a policy", async () => {
    process.env.IRIS_PROFILES = JSON.stringify({ p: { dataPolicy: 3 } });
    await expect(startServer()).rejects.toThrow(
      'IRIS_PROFILES is invalid: profile "p": "dataPolicy" must be "block", "redact" or "allow".',
    );
  });

  it("a governance file whose dataPolicy is not an object, without echoing the value", async () => {
    const file = governanceFile({ dataPolicy: "SYNTHPHI-block" });
    process.env.IRIS_GOVERNANCE_FILE = file;
    const failure = await startServer().then(
      () => undefined,
      (error: unknown) => error as Error,
    );
    expect(failure?.message).toContain("IRIS_GOVERNANCE_FILE is invalid:");
    expect(failure?.message).toContain('"dataPolicy" must be a JSON object');
    expect(failure?.message).toContain(`(path: ${file})`);
    expect(failure?.message).not.toContain("SYNTHPHI");
  });

  it("a governance file whose dataPolicy.global is not a policy, or that holds another key", async () => {
    process.env.IRIS_GOVERNANCE_FILE = governanceFile({ dataPolicy: { global: "x" } });
    await expect(startServer()).rejects.toThrow('"dataPolicy.global" must be "block", "redact" or "allow".');
    env.setup();
    process.env.IRIS_GOVERNANCE_FILE = governanceFile({ dataPolicy: { extra: "x" } });
    await expect(startServer()).rejects.toThrow('"dataPolicy.extra" is not a recognized key.');
  });

  it("IRIS_GOVERNANCE carrying a dataPolicy key", async () => {
    process.env.IRIS_GOVERNANCE = JSON.stringify({ dataPolicy: {} });
    await expect(startServer()).rejects.toThrow(
      'IRIS_GOVERNANCE is invalid: "dataPolicy" is read only from IRIS_GOVERNANCE_FILE. Set IRIS_DATA_POLICY for every profile, or "dataPolicy" on an IRIS_PROFILES entry for one.',
    );
  });
});

/** Poll (bounded) until the file holds at least `minLines` non-empty lines. */
async function auditLines(path: string, minLines: number): Promise<Array<Record<string, unknown>>> {
  const start = Date.now();
  for (;;) {
    if (existsSync(path)) {
      const lines = readFileSync(path, "utf-8").split("\n").filter((line) => line.trim() !== "");
      if (lines.length >= minLines) return lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    }
    if (Date.now() - start > 3000) throw new Error(`Timed out waiting for ${minLines} audit line(s)`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("the audit entry's dataPolicy field and PHI inputs (AC-5, AD-19)", () => {
  function auditEnv(params = false): string {
    const path = join(scratch(), "audit.jsonl");
    process.env.IRIS_AUDIT_LOG = path;
    if (params) process.env.IRIS_AUDIT_LOG_PARAMS = "true";
    return path;
  }

  it("records the policy and the counts of a governed call, and keeps outcome ok", async () => {
    const path = auditEnv();
    const server = await startServer();
    await callTool(server, "iris_synth_phi", { action: "preview", mode: "summary" });
    const [, entry] = await auditLines(path, 2);
    expect(entry).toMatchObject({
      tool: "iris_synth_phi",
      action: "preview",
      outcome: "ok",
      dataPolicy: { policy: "block", redacted: 4, blocked: 3 },
    });
  });

  it("falls back to the profile's policy and zero counts when the response's are not valid", async () => {
    const path = auditEnv();
    process.env.IRIS_DATA_POLICY = "allow";
    const server = await startServer();
    await callTool(server, "iris_synth_phi", { action: "preview", mode: "badSummary" });
    await callTool(server, "iris_synth_phi", { action: "preview", mode: "plain" });
    const entries = await auditLines(path, 3);
    expect(entries[1]?.dataPolicy).toEqual({ policy: "allow", redacted: 0, blocked: 0 });
    expect(entries[2]?.dataPolicy).toEqual({ policy: "allow", redacted: 0, blocked: 0 });
  });

  it("omits the field for an action the tool does not list, and for a tool that declares nothing", async () => {
    const path = auditEnv();
    const server = await startServer();
    await callTool(server, "iris_synth_phi", { action: "other" });
    await callTool(server, "iris_synth_plain", {});
    const entries = await auditLines(path, 3);
    expect("dataPolicy" in (entries[1] as object)).toBe(false);
    expect("dataPolicy" in (entries[2] as object)).toBe(false);
  });

  it("omits the field when the profile did not resolve", async () => {
    const path = auditEnv();
    const server = await startServer();
    const result = await callTool(server, "iris_synth_phi", { action: "preview", server: "nosuch" });
    expect(result.isError).toBe(true);
    const [, entry] = await auditLines(path, 2);
    expect(entry).toMatchObject({ profile: "nosuch", outcome: "error" });
    expect("dataPolicy" in (entry as object)).toBe(false);
  });

  it("records a policy refusal as outcome error with its text and a dataPolicy field", async () => {
    const path = auditEnv();
    const server = await startServer();
    const result = await callTool(server, "iris_synth_phi", { action: "preview", mode: "refuse" });
    expect(result.isError).toBe(true);
    expect(result.structuredContent.code).toBe("DATA_POLICY_BLOCKED");
    const [, entry] = await auditLines(path, 2);
    expect(entry).toMatchObject({
      outcome: "error",
      error: expect.stringContaining("The block data policy withholds every message body."),
      dataPolicy: { policy: "redact", redacted: 0, blocked: 0 },
    });
    expect("denyReason" in (entry as object)).toBe(false);
  });

  it("records a governance denial as outcome denied with the profile's policy", async () => {
    const path = auditEnv();
    process.env.IRIS_GOVERNANCE = JSON.stringify({ global: { "iris_synth_phi:preview": false } });
    process.env.IRIS_DATA_POLICY = "block";
    const server = await startServer();
    const result = await callTool(server, "iris_synth_phi", { action: "preview" });
    expect(result.isError).toBe(true);
    const [, entry] = await auditLines(path, 2);
    expect(entry).toMatchObject({ outcome: "denied", denyReason: "GOVERNANCE_DISABLED", dataPolicy: { policy: "block", redacted: 0, blocked: 0 } });
  });

  it("redacts a declared PHI input under redact, under block and for an unknown server, and logs it under allow", async () => {
    const cases: Array<{ label: string; policy: string | undefined; server?: string; redacted: boolean }> = [
      { label: "default (redact)", policy: undefined, redacted: true },
      { label: "block", policy: "block", redacted: true },
      { label: "an unknown server", policy: "allow", server: "nosuch", redacted: true },
      { label: "allow", policy: "allow", redacted: false },
    ];
    for (const row of cases) {
      env.setup();
      const path = auditEnv(true);
      if (row.policy !== undefined) process.env.IRIS_DATA_POLICY = row.policy;
      const server = await startServer();
      await callTool(server, "iris_synth_phi", { action: "preview", value: "SYNTHPHI-X", ...(row.server ? { server: row.server } : {}) });
      const [, entry] = await auditLines(path, 2);
      const params = entry?.params as Record<string, unknown>;
      expect(params.value, row.label).toBe(row.redacted ? "[REDACTED]" : "SYNTHPHI-X");
      expect(params.action, row.label).toBe("preview");
      expect(entry?.paramKeys, row.label).toEqual(expect.arrayContaining(["value", "action"]));
      expect(JSON.stringify(entry).includes("SYNTHPHI-X"), row.label).toBe(!row.redacted);
      rmSync(path, { force: true });
    }
  });

  it("does not match parameter names: an undeclared input named like a PHI field is logged", async () => {
    const path = auditEnv(true);
    const tool = governedTool({ dataPolicy: { actions: ["preview"] } });
    const server = await startServer([tool]);
    await callTool(server, "iris_synth_phi", { action: "preview", value: "SYNTHPHI-Y" });
    const [, entry] = await auditLines(path, 2);
    expect((entry?.params as Record<string, unknown>).value).toBe("SYNTHPHI-Y");
  });
});

describe("a ToolDefinition.dataPolicy declaration is checked at registration", () => {
  const build = (tool: ToolDefinition) => () => new McpServerBase({ name: "test-server", version: "1.0.0", tools: [tool] });

  it("accepts a declaration that matches the tool", () => {
    expect(build(governedTool())).not.toThrow();
  });

  it("throws, naming the tool, for an action that is not an action of the tool", () => {
    expect(build(governedTool({ dataPolicy: { actions: ["bogus"] } }))).toThrow(
      /Tool "iris_synth_phi" declares dataPolicy actions \["bogus"\]/,
    );
  });

  it("throws for actions on a tool that has no action enum", () => {
    expect(build({ ...undeclaredTool(), dataPolicy: { actions: ["preview"] } })).toThrow(/Tool "iris_synth_plain" declares dataPolicy actions/);
  });

  it("throws for a phiInputs key that is not in the input schema", () => {
    expect(build(governedTool({ dataPolicy: { phiInputs: ["absent"] } }))).toThrow(
      /Tool "iris_synth_phi" declares dataPolicy phiInputs \["absent"\]/,
    );
  });

  it("throws for the framework's server parameter", () => {
    expect(build(governedTool({ dataPolicy: { phiInputs: ["server"] } }))).toThrow(
      /Tool "iris_synth_phi" declares dataPolicy phiInputs "server"/,
    );
  });

  it("checks a tool added later too", () => {
    const server = new McpServerBase({ name: "test-server", version: "1.0.0", tools: [undeclaredTool()] });
    expect(() => server.addTools([governedTool({ dataPolicy: { actions: ["bogus"] } })])).toThrow(/declares dataPolicy actions/);
  });

  it("checks a tool added later that configuration hides", () => {
    process.env.IRIS_TOOLS_DISABLE = "iris_synth_phi";
    const server = new McpServerBase({ name: "test-server", version: "1.0.0", tools: [undeclaredTool()] });
    expect(() => server.addTools([governedTool({ dataPolicy: { phiInputs: ["absent"] } })])).toThrow(
      /Tool "iris_synth_phi" declares dataPolicy phiInputs \["absent"\]/,
    );
  });
});
