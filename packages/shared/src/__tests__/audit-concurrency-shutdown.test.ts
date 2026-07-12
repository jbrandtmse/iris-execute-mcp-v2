/**
 * Story 29.1 (Epic 29, spec `07-observability-audit-log.md` §5) — AC 29.1.3:
 * concurrency non-interleaving with strictly-contiguous per-session `seq`,
 * and the shutdown-flush wiring (`AuditLogger.shutdown()` reachable from a
 * real `McpServerBase.stop()` call, not merely callable on the logger in
 * isolation).
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

/** A read tool whose handler resolves after a scrambled per-call delay, so
 * concurrent calls complete out of start order — proving `seq` tracks
 * COMPLETION order (via the audit interceptor's synchronous `log()` call
 * right after each call's own `dispatchToolCall` resolves) and stays
 * contiguous regardless. */
function makeProbeTool(): ToolDefinition {
  return {
    name: "iris_concurrent_probe",
    title: "Concurrency probe",
    description: "Resolves after a scrambled delay derived from `idx`.",
    inputSchema: z.object({ idx: z.number() }),
    annotations: { readOnlyHint: true },
    scope: "NS",
    mutates: "read",
    handler: async (rawArgs: unknown) => {
      const args = rawArgs as { idx: number };
      const delayMs = (args.idx * 7) % 17;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return { content: [{ type: "text" as const, text: `idx=${args.idx}` }] };
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
  timeoutMs = 5000,
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

describe("audit concurrency + shutdown flush (Epic 29, Story 29.1, AC 29.1.3)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const originalFetch = globalThis.fetch;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let exitMock: any;
  const savedEnv = {
    IRIS_AUDIT_LOG: process.env.IRIS_AUDIT_LOG,
    IRIS_AUDIT_LOG_MAX_MB: process.env.IRIS_AUDIT_LOG_MAX_MB,
    IRIS_AUDIT_LOG_PARAMS: process.env.IRIS_AUDIT_LOG_PARAMS,
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

  it("N (>=20) concurrent handleToolCalls produce well-formed, non-interleaved JSONL with contiguous seq 1..N, then stop() flushes a final shutdown line", async () => {
    const dir = mkdtempSync(join(tmpdir(), "iris-audit-concurrency-"));
    const auditPath = join(dir, "audit.log");
    process.env.IRIS_AUDIT_LOG = auditPath;

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    fetchMock.mockResolvedValueOnce(versionResponse());

    const server = new McpServerBase(
      makeServerOpts([makeProbeTool()], makeConfig()),
    );
    await server.start("stdio");

    const N = 25;
    const results = await Promise.all(
      Array.from({ length: N }, (_, idx) =>
        invokeTool(server, "iris_concurrent_probe", { idx }),
      ),
    );
    for (const result of results) {
      expect(result.isError).toBeFalsy();
    }

    // header + N entries.
    const lines = await waitForLineCount(auditPath, N + 1);
    expect(lines).toHaveLength(N + 1);

    // Every line parses as one complete, valid JSON object — the write
    // queue's serialization means no line is ever split or merged.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parsed: any[] = lines.map((line) => JSON.parse(line));

    expect(parsed[0].type).toBe("sessionStart");
    const entries = parsed.slice(1);
    expect(entries).toHaveLength(N);
    for (const entry of entries) {
      expect(entry.tool).toBe("iris_concurrent_probe");
      expect(entry.outcome).toBe("ok");
    }

    // seq values are exactly 1..N, contiguous, no dupes/gaps — regardless of
    // the scrambled completion order the probe tool's variable delay caused.
    const seqs = entries.map((e) => e.seq as number).sort((a, b) => a - b);
    expect(seqs).toEqual(Array.from({ length: N }, (_, i) => i + 1));
    expect(new Set(seqs).size).toBe(N);

    // Now exercise the shutdown-flush wiring (AC 29.1.3): stop() must AWAIT
    // the queue draining before resolving, so the final line is guaranteed
    // present by the time we read the file back (no polling needed for it).
    await server.stop();

    const finalLines = readFileSync(auditPath, "utf-8")
      .split("\n")
      .filter((line) => line.trim().length > 0);
    expect(finalLines).toHaveLength(N + 2); // header + N entries + shutdown
    const shutdownLine = JSON.parse(finalLines[finalLines.length - 1] as string);
    expect(shutdownLine.type).toBe("shutdown");
    expect(shutdownLine.droppedEntries).toBe(0);

    rmSync(dir, { recursive: true, force: true });
  });

  it("stop() is wired to AuditLogger.shutdown(): the final droppedEntries line is present and the queue is drained", async () => {
    const dir = mkdtempSync(join(tmpdir(), "iris-audit-stop-wiring-"));
    const auditPath = join(dir, "audit.log");
    process.env.IRIS_AUDIT_LOG = auditPath;

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    fetchMock.mockResolvedValueOnce(versionResponse());

    const server = new McpServerBase(
      makeServerOpts([makeProbeTool()], makeConfig()),
    );
    await server.start("stdio");

    const result = await invokeTool(server, "iris_concurrent_probe", { idx: 1 });
    expect(result.isError).toBeFalsy();

    await server.stop();

    // No polling: stop() must have awaited the write queue draining, so the
    // shutdown line is guaranteed on disk synchronously after it resolves.
    const lines = readFileSync(auditPath, "utf-8")
      .split("\n")
      .filter((line) => line.trim().length > 0);
    expect(lines).toHaveLength(3); // header + 1 entry + shutdown
    const shutdownLine = JSON.parse(lines[2] as string);
    expect(shutdownLine.type).toBe("shutdown");
    expect(shutdownLine.droppedEntries).toBe(0);

    rmSync(dir, { recursive: true, force: true });
  });

  it("stop() is a safe no-op when auditing is off (no IRIS_AUDIT_LOG configured)", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    fetchMock.mockResolvedValueOnce(versionResponse());

    const server = new McpServerBase(
      makeServerOpts([makeProbeTool()], makeConfig()),
    );
    await server.start("stdio");

    await expect(server.stop()).resolves.toBeUndefined();
  });

  it("stop() is idempotent-safe to call more than once", async () => {
    const dir = mkdtempSync(join(tmpdir(), "iris-audit-stop-twice-"));
    const auditPath = join(dir, "audit.log");
    process.env.IRIS_AUDIT_LOG = auditPath;

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    fetchMock.mockResolvedValueOnce(versionResponse());

    const server = new McpServerBase(
      makeServerOpts([makeProbeTool()], makeConfig()),
    );
    await server.start("stdio");

    await expect(server.stop()).resolves.toBeUndefined();
    await expect(server.stop()).resolves.toBeUndefined();

    rmSync(dir, { recursive: true, force: true });
  });
});
