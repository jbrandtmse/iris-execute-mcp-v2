/**
 * Story 29.1 (Epic 29, spec `07-observability-audit-log.md` §3-§5) — outcome
 * fidelity: denial `denyReason`/`presetApplied` provenance (AC 29.1.1),
 * sanitized-only `error` text (AC 29.1.1), and schema-aware `action`
 * extraction (AC 29.1.2). Builds on Story 29.0's interceptor
 * (`audit-interceptor.test.ts`, `audit-outcome-derivation.test.ts`), which
 * proved the BASIC `outcome` mapping; this file proves the rigorous fidelity
 * those tests deliberately left out of scope.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

import { McpServerBase } from "../server-base.js";
import type { McpServerBaseOptions } from "../server-base.js";
import type { ToolDefinition } from "../tool-types.js";
import type { IrisConnectionConfig } from "../config.js";

// ── Helpers (mirrors audit-interceptor.test.ts's harness) ──────────────

function makeConfig(): IrisConnectionConfig {
  return {
    host: "localhost",
    port: 52773,
    username: "testuser",
    password: "testpass",
    namespace: "HSCUSTOM",
    https: false,
    baseUrl: "http://localhost:52773",
    timeout: 60_000,
  };
}

function makeServerOpts(
  tools: ToolDefinition[],
  config: IrisConnectionConfig,
): McpServerBaseOptions {
  return { name: "test-server", version: "1.0.0", tools, config };
}

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

/** A NEW (non-baseline) single-op WRITE tool: no `action` field at all. */
function makeWriteTool(): ToolDefinition {
  return {
    name: "iris_new_write",
    title: "Governed write",
    description: "A NEW single-op write action (seed-disabled).",
    inputSchema: z.object({ value: z.string().optional() }),
    annotations: { readOnlyHint: false },
    scope: "NS",
    mutates: "write",
    handler: async () => ({
      content: [{ type: "text" as const, text: "should not run" }],
    }),
  };
}

/** A read tool whose handler throws a multi-line, "stacky" error message. */
function makeStackyThrowingTool(): ToolDefinition {
  return {
    name: "iris_doc_get",
    title: "Get Document",
    description: "Retrieve a document by name.",
    inputSchema: z.object({ name: z.string() }),
    annotations: { readOnlyHint: true },
    scope: "NS",
    handler: async () => {
      const err = new Error(
        "boom: simulated handler failure\n" +
          "    at fakeInnerFn (/some/path/file.ts:42:7)\n" +
          "    at fakeOuterFn (/some/path/other.ts:10:3)",
      );
      throw err;
    },
  };
}

/** A read tool with NO `action` field — just a plain string arg. */
function makeNoActionTool(): ToolDefinition {
  return {
    name: "iris_no_action",
    title: "No-action tool",
    description: "A tool with no `action` field at all.",
    inputSchema: z.object({ name: z.string().optional() }),
    annotations: { readOnlyHint: true },
    scope: "NS",
    mutates: "read",
    handler: async () => ({ content: [{ type: "text" as const, text: "ok" }] }),
  };
}

/** A multi-action tool: `action` is a real ZodEnum member. */
function makeMultiActionTool(): ToolDefinition {
  return {
    name: "iris_multi_action",
    title: "Multi-action tool",
    description: "A tool with a real `action` ZodEnum.",
    inputSchema: z.object({ action: z.enum(["foo", "bar"]) }),
    annotations: { readOnlyHint: true },
    scope: "NS",
    mutates: { foo: "read", bar: "read" },
    handler: async (rawArgs: unknown) => {
      const args = rawArgs as { action: "foo" | "bar" };
      return {
        content: [{ type: "text" as const, text: `action=${args.action}` }],
      };
    },
  };
}

async function invokeTool(
  server: McpServerBase,
  name: string,
  args: Record<string, unknown>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sdkTools = (server.server as any)._registeredTools;
  const entry = sdkTools[name];
  const callback = entry.callback ?? entry.handler ?? entry.cb;
  return callback(args);
}

/** Poll (bounded) until the file has at least `minLines` non-empty lines. */
async function waitForLineCount(
  filePath: string,
  minLines: number,
  timeoutMs = 2000,
): Promise<string[]> {
  const start = Date.now();
  for (;;) {
    if (existsSync(filePath)) {
      const lines = readFileSync(filePath, "utf-8")
        .split("\n")
        .filter((line) => line.trim().length > 0);
      if (lines.length >= minLines) return lines;
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timed out waiting for ${minLines} line(s) in ${filePath}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

// ── Tests ───────────────────────────────────────────────────────────

describe("audit outcome fidelity (Epic 29, Story 29.1)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const originalFetch = globalThis.fetch;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let exitMock: any;
  const savedEnv = {
    IRIS_AUDIT_LOG: process.env.IRIS_AUDIT_LOG,
    IRIS_AUDIT_LOG_MAX_MB: process.env.IRIS_AUDIT_LOG_MAX_MB,
    IRIS_AUDIT_LOG_PARAMS: process.env.IRIS_AUDIT_LOG_PARAMS,
    IRIS_GOVERNANCE: process.env.IRIS_GOVERNANCE,
    IRIS_GOVERNANCE_PRESET: process.env.IRIS_GOVERNANCE_PRESET,
  };

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    exitMock = vi
      .spyOn(process, "exit")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockImplementation((() => {}) as any);
    delete process.env.IRIS_AUDIT_LOG;
    delete process.env.IRIS_AUDIT_LOG_MAX_MB;
    delete process.env.IRIS_AUDIT_LOG_PARAMS;
    delete process.env.IRIS_GOVERNANCE;
    delete process.env.IRIS_GOVERNANCE_PRESET;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    exitMock.mockRestore();
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    vi.restoreAllMocks();
  });

  // ── Task 1: denyReason + presetApplied provenance (AC 29.1.1) ────────

  it("a preset-caused denial carries denyReason AND presetApplied (copied, not recomputed)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "iris-audit-deny-preset-"));
    const auditPath = join(dir, "audit.log");
    process.env.IRIS_AUDIT_LOG = auditPath;
    process.env.IRIS_GOVERNANCE_PRESET = "read-only";

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    fetchMock.mockResolvedValueOnce(versionResponse());

    const server = new McpServerBase(
      makeServerOpts([makeWriteTool()], makeConfig()),
    );
    await server.start("stdio");

    const result = await invokeTool(server, "iris_new_write", { value: "x" });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      code: "GOVERNANCE_DISABLED",
      presetApplied: "read-only",
    });

    const lines = await waitForLineCount(auditPath, 2);
    const entry = JSON.parse(lines[1] as string);
    expect(entry.outcome).toBe("denied");
    expect(entry.denyReason).toBe("GOVERNANCE_DISABLED");
    expect(entry.presetApplied).toBe("read-only");
    expect(entry.error).toBeUndefined();

    rmSync(dir, { recursive: true, force: true });
  });

  it("an explicit-override denial does NOT carry presetApplied, even with a preset active", async () => {
    const dir = mkdtempSync(join(tmpdir(), "iris-audit-deny-explicit-"));
    const auditPath = join(dir, "audit.log");
    process.env.IRIS_AUDIT_LOG = auditPath;
    // "full" would otherwise pass everything through (presetSeed === undefined
    // for "full"), so ANY denial here must be attributable to the explicit
    // override below, not the preset.
    process.env.IRIS_GOVERNANCE_PRESET = "full";
    process.env.IRIS_GOVERNANCE = JSON.stringify({
      global: { iris_new_write: false },
    });

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    fetchMock.mockResolvedValueOnce(versionResponse());

    const server = new McpServerBase(
      makeServerOpts([makeWriteTool()], makeConfig()),
    );
    await server.start("stdio");

    const result = await invokeTool(server, "iris_new_write", { value: "x" });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ code: "GOVERNANCE_DISABLED" });
    expect(result.structuredContent.presetApplied).toBeUndefined();

    const lines = await waitForLineCount(auditPath, 2);
    const entry = JSON.parse(lines[1] as string);
    expect(entry.outcome).toBe("denied");
    expect(entry.denyReason).toBe("GOVERNANCE_DISABLED");
    expect(entry.presetApplied).toBeUndefined();

    rmSync(dir, { recursive: true, force: true });
  });

  it("an \"ok\" outcome carries neither denyReason, presetApplied, nor error", async () => {
    const dir = mkdtempSync(join(tmpdir(), "iris-audit-ok-fields-"));
    const auditPath = join(dir, "audit.log");
    process.env.IRIS_AUDIT_LOG = auditPath;

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    fetchMock.mockResolvedValueOnce(versionResponse());

    const server = new McpServerBase(
      makeServerOpts([makeNoActionTool()], makeConfig()),
    );
    await server.start("stdio");

    const result = await invokeTool(server, "iris_no_action", { name: "Foo" });
    expect(result.isError).toBeFalsy();

    const lines = await waitForLineCount(auditPath, 2);
    const entry = JSON.parse(lines[1] as string);
    expect(entry.outcome).toBe("ok");
    expect(entry.denyReason).toBeUndefined();
    expect(entry.presetApplied).toBeUndefined();
    expect(entry.error).toBeUndefined();

    rmSync(dir, { recursive: true, force: true });
  });

  // ── Task 2: error message = sanitized only (AC 29.1.1) ───────────────

  it("a handler throwing a multi-line/stacky Error logs only the sanitized single-line message", async () => {
    const dir = mkdtempSync(join(tmpdir(), "iris-audit-error-sanitized-"));
    const auditPath = join(dir, "audit.log");
    process.env.IRIS_AUDIT_LOG = auditPath;

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    fetchMock.mockResolvedValueOnce(versionResponse());

    const server = new McpServerBase(
      makeServerOpts([makeStackyThrowingTool()], makeConfig()),
    );
    await server.start("stdio");

    const result = await invokeTool(server, "iris_doc_get", { name: "Foo.cls" });
    expect(result.isError).toBe(true);

    const lines = await waitForLineCount(auditPath, 2);
    const entry = JSON.parse(lines[1] as string);
    expect(entry.outcome).toBe("error");
    expect(entry.error).toBe(
      "Tool error: boom: simulated handler failure\n" +
        "    at fakeInnerFn (/some/path/file.ts:42:7)\n" +
        "    at fakeOuterFn (/some/path/other.ts:10:3)",
    );
    // The RAW line on disk must never contain a caret-global token (Rules
    // #8/#9/#33) — this handler's message never named one, but pin the
    // invariant on the serialized line as a whole (not just error.message)
    // so a future redaction regression on the write path is caught here too.
    expect(lines[1] as string).not.toMatch(/\^[A-Za-z%]/);
    // And never the literal `.stack` property's "Error: <message>\n    at ..."
    // V8 header form appended twice (i.e. we must not have serialized
    // `error.stack` in addition to `error.message`).
    expect((lines[1] as string).match(/simulated handler failure/g)).toHaveLength(1);

    rmSync(dir, { recursive: true, force: true });
  });

  // ── Task 3: schema-aware `action` extraction (AC 29.1.2) ─────────────

  it("a tool WITHOUT an action field + a stray action:\"foo\" arg -> entry.action === null", async () => {
    const dir = mkdtempSync(join(tmpdir(), "iris-audit-action-stray-"));
    const auditPath = join(dir, "audit.log");
    process.env.IRIS_AUDIT_LOG = auditPath;

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    fetchMock.mockResolvedValueOnce(versionResponse());

    const server = new McpServerBase(
      makeServerOpts([makeNoActionTool()], makeConfig()),
    );
    await server.start("stdio");

    // "action" is NOT declared on iris_no_action's inputSchema; a stray value
    // must not be echoed into the audit entry's `action` field.
    const result = await invokeTool(server, "iris_no_action", {
      name: "Foo",
      action: "foo",
    });
    expect(result.isError).toBeFalsy();

    const lines = await waitForLineCount(auditPath, 2);
    const entry = JSON.parse(lines[1] as string);
    expect(entry.action).toBeNull();

    rmSync(dir, { recursive: true, force: true });
  });

  it("a multi-action tool with a real in-enum action -> entry.action === that action", async () => {
    const dir = mkdtempSync(join(tmpdir(), "iris-audit-action-real-"));
    const auditPath = join(dir, "audit.log");
    process.env.IRIS_AUDIT_LOG = auditPath;

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    fetchMock.mockResolvedValueOnce(versionResponse());

    const server = new McpServerBase(
      makeServerOpts([makeMultiActionTool()], makeConfig()),
    );
    await server.start("stdio");

    const result = await invokeTool(server, "iris_multi_action", { action: "bar" });
    expect(result.isError).toBeFalsy();

    const lines = await waitForLineCount(auditPath, 2);
    const entry = JSON.parse(lines[1] as string);
    expect(entry.action).toBe("bar");

    rmSync(dir, { recursive: true, force: true });
  });

  it("a single-action-less tool with no action arg at all -> entry.action === null", async () => {
    const dir = mkdtempSync(join(tmpdir(), "iris-audit-action-none-"));
    const auditPath = join(dir, "audit.log");
    process.env.IRIS_AUDIT_LOG = auditPath;

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    fetchMock.mockResolvedValueOnce(versionResponse());

    const server = new McpServerBase(
      makeServerOpts([makeNoActionTool()], makeConfig()),
    );
    await server.start("stdio");

    const result = await invokeTool(server, "iris_no_action", { name: "Foo" });
    expect(result.isError).toBeFalsy();

    const lines = await waitForLineCount(auditPath, 2);
    const entry = JSON.parse(lines[1] as string);
    expect(entry.action).toBeNull();

    rmSync(dir, { recursive: true, force: true });
  });

  it("a multi-action tool called with a non-member action value -> entry.action === null", async () => {
    const dir = mkdtempSync(join(tmpdir(), "iris-audit-action-nonmember-"));
    const auditPath = join(dir, "audit.log");
    process.env.IRIS_AUDIT_LOG = auditPath;

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    fetchMock.mockResolvedValueOnce(versionResponse());

    const server = new McpServerBase(
      makeServerOpts([makeMultiActionTool()], makeConfig()),
    );
    await server.start("stdio");

    // Zod itself will reject "baz" (not a member of ["foo","bar"]) — this
    // exercises the isError-validation-failure return point, still through
    // the SAME recordAuditEntry/deriveAuditAction derivation.
    const result = await invokeTool(server, "iris_multi_action", { action: "baz" });
    expect(result.isError).toBe(true);

    const lines = await waitForLineCount(auditPath, 2);
    const entry = JSON.parse(lines[1] as string);
    expect(entry.action).toBeNull();

    rmSync(dir, { recursive: true, force: true });
  });
});
