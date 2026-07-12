/**
 * Story 29.0 QA follow-up — basic `outcome` derivation through the REAL
 * interceptor (`McpServerBase.handleToolCall` -> `recordAuditEntry` ->
 * `deriveAuditOutcome`, `server-base.ts:1360`/`:1431`).
 *
 * `audit-interceptor.test.ts` (dev's no-op proof) only ever exercises the
 * "ok" outcome (a successful `iris_doc_get` call). `audit.test.ts` exercises
 * `outcome: "error"` too, but only at the `AuditLogger.log()` unit level —
 * the caller hand-builds the `AuditEntryInput`, so `deriveAuditOutcome`'s
 * actual mapping from a resolved `CallToolResult` (governance-denied /
 * handler-threw) is never invoked by any existing test.
 *
 * The story's own Dev Notes ("Scope seam vs Story 29.1") call this BASIC
 * mapping ("denied when `structuredContent.code === GOVERNANCE_DISABLED`;
 * error when `isError === true`; else ok") explicitly IN SCOPE for 29.0 —
 * rigorous fidelity (structured `denyReason`, `presetApplied`, sanitized-
 * error-only) is 29.1's job, but the basic "does this branch produce the
 * right `outcome` string" behavior belongs here and was untested. These two
 * tests close that gap end-to-end (real tool call -> real written JSONL
 * entry), without touching 29.1 territory.
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

/** A NEW (non-baseline) single-op WRITE tool: seed-disabled by default, no
 * IRIS_GOVERNANCE override needed to prove the "denied" branch. */
function makeWriteTool(handlerSpy: ReturnType<typeof vi.fn>): ToolDefinition {
  return {
    name: "iris_new_write",
    title: "Governed write",
    description: "A NEW single-op write action (seed-disabled).",
    inputSchema: z.object({ value: z.string().optional() }),
    annotations: { readOnlyHint: false },
    scope: "NS",
    mutates: "write",
    handler: handlerSpy,
  };
}

/** A read tool whose handler always throws, to exercise the "error" branch. */
function makeThrowingTool(): ToolDefinition {
  return {
    name: "iris_doc_get",
    title: "Get Document",
    description: "Retrieve a document by name.",
    inputSchema: z.object({ name: z.string() }),
    annotations: { readOnlyHint: true },
    scope: "NS",
    handler: async () => {
      throw new Error("boom: simulated handler failure");
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

describe("audit interceptor: outcome derivation (Epic 29, Story 29.0)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const originalFetch = globalThis.fetch;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let exitMock: any;
  const savedEnv = {
    IRIS_AUDIT_LOG: process.env.IRIS_AUDIT_LOG,
    IRIS_AUDIT_LOG_MAX_MB: process.env.IRIS_AUDIT_LOG_MAX_MB,
    IRIS_AUDIT_LOG_PARAMS: process.env.IRIS_AUDIT_LOG_PARAMS,
    IRIS_GOVERNANCE: process.env.IRIS_GOVERNANCE,
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

  it("records outcome:\"denied\" for a governance-disabled call, with no error field, handler never invoked", async () => {
    const dir = mkdtempSync(join(tmpdir(), "iris-audit-outcome-denied-"));
    const auditPath = join(dir, "audit.log");
    process.env.IRIS_AUDIT_LOG = auditPath;

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    fetchMock.mockResolvedValueOnce(versionResponse());

    const handlerSpy = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "should not run" }],
    }));
    const server = new McpServerBase(
      makeServerOpts([makeWriteTool(handlerSpy)], makeConfig()),
    );
    await server.start("stdio");

    const result = await invokeTool(server, "iris_new_write", { value: "x" });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ code: "GOVERNANCE_DISABLED" });
    expect(handlerSpy).not.toHaveBeenCalled();

    const lines = await waitForLineCount(auditPath, 2);
    const entry = JSON.parse(lines[1] as string);
    expect(entry.tool).toBe("iris_new_write");
    expect(entry.outcome).toBe("denied");
    expect(entry.error).toBeUndefined();
    expect(entry.paramKeys).toEqual(["value"]);
    expect(entry.seq).toBe(1);

    rmSync(dir, { recursive: true, force: true });
  });

  it("records outcome:\"error\" with the sanitized message when a tool handler throws", async () => {
    const dir = mkdtempSync(join(tmpdir(), "iris-audit-outcome-error-"));
    const auditPath = join(dir, "audit.log");
    process.env.IRIS_AUDIT_LOG = auditPath;

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    fetchMock.mockResolvedValueOnce(versionResponse());

    const server = new McpServerBase(
      makeServerOpts([makeThrowingTool()], makeConfig()),
    );
    await server.start("stdio");

    const result = await invokeTool(server, "iris_doc_get", { name: "Foo.cls" });
    expect(result.isError).toBe(true);

    const lines = await waitForLineCount(auditPath, 2);
    const entry = JSON.parse(lines[1] as string);
    expect(entry.tool).toBe("iris_doc_get");
    expect(entry.outcome).toBe("error");
    expect(entry.error).toBe("Tool error: boom: simulated handler failure");
    expect(entry.seq).toBe(1);

    rmSync(dir, { recursive: true, force: true });
  });
});
