/**
 * Story 29.1 (Epic 29, spec `07-observability-audit-log.md` §3-§5) —
 * strengthening tests added at QA time, beyond `audit-outcome-fidelity.test.ts`
 * and `audit-concurrency-shutdown.test.ts` (the dev's own tests, which already
 * cover AC 29.1.1/29.1.2/29.1.3 individually). These two tests target the
 * INTERACTION the dev's tests leave unexercised:
 *
 * 1. `deriveAuditAction` (schema-aware, AC 29.1.2) and the denial-fidelity
 *    branch (`denyReason`/`presetApplied`, AC 29.1.1) both fire on the SAME
 *    call for a multi-action tool — the dev's denial tests only used a
 *    no-action tool (`iris_new_write`), so a denied entry's `action` field was
 *    never proven to survive correctly (as opposed to `null`) when the call
 *    that got denied was itself an in-enum action.
 * 2. The dev's concurrency test (`audit-concurrency-shutdown.test.ts`) only
 *    fires calls that all resolve to the SAME outcome (`"ok"`) — proving
 *    non-interleaving and contiguous `seq` for a homogeneous field shape.
 *    Because `AuditLogger.log` conditionally adds `error`/`denyReason`/
 *    `presetApplied` PER ENTRY based on that entry's own `outcome`, a
 *    concurrency bug that let those conditional fields bleed across
 *    concurrently-queued entries (e.g. a shared/reused entry object) would
 *    NOT be caught by a homogeneous-outcome batch. This test fires a mixed
 *    batch (ok + denied + error, interleaved by construction) and asserts
 *    every entry's fields belong ONLY to its own outcome.
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

/**
 * A multi-action tool where one action is a WRITE (denied by the default
 * write-disabled seed, `defaultSeed`, with NO governance config at all — Rule
 * #28) and the others are READS (enabled by default). This lets a single
 * batch of concurrent calls against ONE tool produce all three outcomes
 * without needing `IRIS_GOVERNANCE`/`IRIS_GOVERNANCE_PRESET` env plumbing.
 */
function makeMixedOutcomeTool(): ToolDefinition {
  return {
    name: "iris_mixed_probe",
    title: "Mixed-outcome probe",
    description: "A multi-action tool exercising ok/denied/error in one batch.",
    inputSchema: z.object({
      action: z.enum(["readOk", "writeDenied", "throwsError"]),
    }),
    annotations: { readOnlyHint: false },
    scope: "NS",
    mutates: { readOk: "read", writeDenied: "write", throwsError: "read" },
    handler: async (rawArgs: unknown) => {
      const args = rawArgs as {
        action: "readOk" | "writeDenied" | "throwsError";
      };
      if (args.action === "throwsError") {
        throw new Error("boom-error: simulated handler failure");
      }
      // "writeDenied" is denied by the governance gate BEFORE the handler is
      // ever invoked, so reaching here with that action would itself be a bug.
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

describe("audit mixed-outcome + denial/action interaction (Epic 29, Story 29.1 — QA strengthening)", () => {
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

  it("a denied entry for a multi-action tool still carries the CORRECT (non-null) action, alongside denyReason", async () => {
    const dir = mkdtempSync(join(tmpdir(), "iris-audit-denied-action-"));
    const auditPath = join(dir, "audit.log");
    process.env.IRIS_AUDIT_LOG = auditPath;
    // Deliberately NO IRIS_GOVERNANCE / IRIS_GOVERNANCE_PRESET: the write
    // action is denied purely by the default write-disabled seed (Rule #28),
    // so `presetApplied` must be absent (no preset is even active) while
    // `action` must still resolve to the real enum member that was denied.

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    fetchMock.mockResolvedValueOnce(versionResponse());

    const server = new McpServerBase(
      makeServerOpts([makeMixedOutcomeTool()], makeConfig()),
    );
    await server.start("stdio");

    const result = await invokeTool(server, "iris_mixed_probe", {
      action: "writeDenied",
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ code: "GOVERNANCE_DISABLED" });

    const lines = await waitForLineCount(auditPath, 2);
    const entry = JSON.parse(lines[1] as string);
    expect(entry.outcome).toBe("denied");
    expect(entry.action).toBe("writeDenied");
    expect(entry.denyReason).toBe("GOVERNANCE_DISABLED");
    expect(entry.presetApplied).toBeUndefined();
    expect(entry.error).toBeUndefined();

    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it("a mixed concurrent batch (ok + denied + error) produces contiguous seq with each entry's fields belonging ONLY to its own outcome", async () => {
    const dir = mkdtempSync(join(tmpdir(), "iris-audit-mixed-concurrency-"));
    const auditPath = join(dir, "audit.log");
    process.env.IRIS_AUDIT_LOG = auditPath;

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    fetchMock.mockResolvedValueOnce(versionResponse());

    const server = new McpServerBase(
      makeServerOpts([makeMixedOutcomeTool()], makeConfig()),
    );
    await server.start("stdio");

    const actions: Array<"readOk" | "writeDenied" | "throwsError"> = [
      "readOk",
      "writeDenied",
      "throwsError",
    ];
    const N = 24; // 8 of each action, interleaved by construction order.
    const calls = Array.from({ length: N }, (_, idx) =>
      invokeTool(server, "iris_mixed_probe", {
        action: actions[idx % actions.length] as string,
      }),
    );
    const results = await Promise.all(calls);

    // Sanity on the immediate results (not the log): 1/3 ok, 1/3 denied error, 1/3 thrown error.
    const okCount = results.filter((r) => !r.isError).length;
    const errCount = results.filter((r) => r.isError).length;
    expect(okCount).toBe(N / 3);
    expect(errCount).toBe((2 * N) / 3);

    const lines = await waitForLineCount(auditPath, N + 1);
    expect(lines).toHaveLength(N + 1);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parsed: any[] = lines.map((line) => JSON.parse(line));
    expect(parsed[0].type).toBe("sessionStart");
    const entries = parsed.slice(1);
    expect(entries).toHaveLength(N);

    // seq is exactly 1..N, contiguous, no dupes — regardless of the mixed
    // outcome shapes racing through the SAME serialized write queue.
    const seqs = entries.map((e) => e.seq as number).sort((a, b) => a - b);
    expect(seqs).toEqual(Array.from({ length: N }, (_, i) => i + 1));
    expect(new Set(seqs).size).toBe(N);

    const byAction = {
      readOk: entries.filter((e) => e.action === "readOk"),
      writeDenied: entries.filter((e) => e.action === "writeDenied"),
      throwsError: entries.filter((e) => e.action === "throwsError"),
    };
    expect(byAction.readOk).toHaveLength(N / 3);
    expect(byAction.writeDenied).toHaveLength(N / 3);
    expect(byAction.throwsError).toHaveLength(N / 3);

    // Every "ok" entry: outcome ok, no error/denyReason/presetApplied bled in.
    for (const entry of byAction.readOk) {
      expect(entry.outcome).toBe("ok");
      expect(entry.error).toBeUndefined();
      expect(entry.denyReason).toBeUndefined();
      expect(entry.presetApplied).toBeUndefined();
    }

    // Every "writeDenied" entry: outcome denied, denyReason present, NO error
    // field and no presetApplied (no preset active) bled in from a
    // concurrently-written "error" or "ok" entry.
    for (const entry of byAction.writeDenied) {
      expect(entry.outcome).toBe("denied");
      expect(entry.denyReason).toBe("GOVERNANCE_DISABLED");
      expect(entry.presetApplied).toBeUndefined();
      expect(entry.error).toBeUndefined();
    }

    // Every "throwsError" entry: outcome error, sanitized single-line message,
    // no denyReason/presetApplied bled in.
    for (const entry of byAction.throwsError) {
      expect(entry.outcome).toBe("error");
      expect(entry.error).toBe("Tool error: boom-error: simulated handler failure");
      expect(entry.denyReason).toBeUndefined();
      expect(entry.presetApplied).toBeUndefined();
    }

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
});
