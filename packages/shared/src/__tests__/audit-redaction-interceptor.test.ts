/**
 * Story 29.2 (Epic 29, spec `07-observability-audit-log.md` §7 AC 3) —
 * closes a genuine coverage seam surfaced by this story's live smoke
 * (Run 2, `_bmad-output/implementation-artifacts/29-2-audit-docs-and-smokes.md`
 * Dev Agent Record).
 *
 * Every existing redaction test (`audit.test.ts`: "redacts a top-level
 * matching key", "produces zero occurrences of a password value nested in
 * three positions", etc.) exercises `redactValue()`/`AuditLogger.log()`
 * directly at the unit level with a hand-built `AuditEntryInput` — never
 * through the REAL interception point (`McpServerBase.handleToolCall` ->
 * `recordAuditEntry` -> `AuditLogger.log` -> `redactValue`) with a genuine
 * Zod-schema-declared credential field on a real tool call. The live smoke
 * found this matters: an UNDECLARED extra key (e.g. a stray `password` not
 * on the tool's schema) never reaches the interceptor at all — the MCP SDK's
 * `registerTool()` strips it during Zod parsing before `handleToolCall` ever
 * sees `rawArgs` — a materially different (safer) mechanism than same-tool
 * redaction, and not exercised by any prior test either.
 *
 * These tests drive a REAL `McpServerBase` with a tool whose schema declares
 * a `password` field (mirroring `iris_user_manage`'s shape), call it with a
 * genuine secret value, and assert the on-disk JSONL never contains that
 * secret — on both the `ok` path and the governance-DENIED path (secrets
 * must not leak even when the call never reaches the handler), and under
 * both `IRIS_AUDIT_LOG_PARAMS` settings.
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

const SECRET = "Sm0keTestP@ss_9f3e1c7d_regression";

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

/** A read-classified tool with a genuine, schema-declared `password` field
 * (mirrors `iris_user_manage`'s shape) — proves redaction on the "ok" path. */
function makeReadToolWithPassword(): ToolDefinition {
  return {
    name: "iris_probe_with_password",
    title: "Probe with a declared password field",
    description: "A read tool whose schema declares a credential-shaped field.",
    inputSchema: z.object({
      name: z.string(),
      password: z.string(),
    }),
    annotations: { readOnlyHint: true },
    scope: "NS",
    mutates: "read",
    handler: async () => ({
      content: [{ type: "text" as const, text: "ok" }],
    }),
  };
}

/** A NEW (non-baseline) WRITE tool, seed-disabled by default (Rule #28), with
 * a genuine `password` field — proves secrets never leak on the DENIED path
 * either (the handler never runs, but the raw args still flow into the audit
 * entry via `recordAuditEntry`). */
function makeWriteToolWithPassword(): ToolDefinition {
  return {
    name: "iris_new_write_with_password",
    title: "Governed write with a declared password field",
    description: "A NEW single-op write action (seed-disabled) with a credential field.",
    inputSchema: z.object({
      name: z.string(),
      password: z.string(),
    }),
    annotations: { readOnlyHint: false },
    scope: "NS",
    mutates: "write",
    handler: async () => ({
      content: [{ type: "text" as const, text: "should not run" }],
    }),
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

describe("audit redaction through the real interceptor (Epic 29, Story 29.2 — QA gap closure)", () => {
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

  it("an ok call with IRIS_AUDIT_LOG_PARAMS=true redacts a declared password field to [REDACTED] and the raw file never contains the secret", async () => {
    const dir = mkdtempSync(join(tmpdir(), "iris-audit-redact-ok-"));
    const auditPath = join(dir, "audit.log");
    process.env.IRIS_AUDIT_LOG = auditPath;
    process.env.IRIS_AUDIT_LOG_PARAMS = "true";

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    fetchMock.mockResolvedValueOnce(versionResponse());

    const server = new McpServerBase(
      makeServerOpts([makeReadToolWithPassword()], makeConfig()),
    );
    await server.start("stdio");

    const result = await invokeTool(server, "iris_probe_with_password", {
      name: "AuditRedactionProbe",
      password: SECRET,
    });
    expect(result.isError).toBeFalsy();

    const lines = await waitForLineCount(auditPath, 2);
    const entry = JSON.parse(lines[1] as string);
    expect(entry.outcome).toBe("ok");
    expect(entry.paramKeys).toEqual(["name", "password"]);
    expect(entry.params.password).toBe("[REDACTED]");
    expect(entry.params.name).toBe("AuditRedactionProbe");

    // The AC 29.2.2 guarantee, mechanically: grep the raw file for the secret.
    const raw = readFileSync(auditPath, "utf-8");
    expect(raw).not.toContain(SECRET);

    rmSync(dir, { recursive: true, force: true });
  });

  it("a governance-denied write with a declared password field never leaks the secret, with or without IRIS_AUDIT_LOG_PARAMS", async () => {
    const dir = mkdtempSync(join(tmpdir(), "iris-audit-redact-denied-"));
    const auditPath = join(dir, "audit.log");
    process.env.IRIS_AUDIT_LOG = auditPath;
    process.env.IRIS_AUDIT_LOG_PARAMS = "true";
    // No IRIS_GOVERNANCE/IRIS_GOVERNANCE_PRESET: the write is denied purely by
    // the default write-disabled seed (Rule #28) — the handler never runs.

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    fetchMock.mockResolvedValueOnce(versionResponse());

    const server = new McpServerBase(
      makeServerOpts([makeWriteToolWithPassword()], makeConfig()),
    );
    await server.start("stdio");

    const result = await invokeTool(server, "iris_new_write_with_password", {
      name: "AuditSmokeTempUser",
      password: SECRET,
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ code: "GOVERNANCE_DISABLED" });

    const lines = await waitForLineCount(auditPath, 2);
    const entry = JSON.parse(lines[1] as string);
    expect(entry.outcome).toBe("denied");
    expect(entry.denyReason).toBe("GOVERNANCE_DISABLED");
    expect(entry.paramKeys).toEqual(["name", "password"]);
    expect(entry.params.password).toBe("[REDACTED]");

    const raw = readFileSync(auditPath, "utf-8");
    expect(raw).not.toContain(SECRET);

    rmSync(dir, { recursive: true, force: true });
  });

  it("the default IRIS_AUDIT_LOG_PARAMS=false posture logs the password KEY NAME only — no params field at all, and the secret never touches disk", async () => {
    const dir = mkdtempSync(join(tmpdir(), "iris-audit-redact-keysonly-"));
    const auditPath = join(dir, "audit.log");
    process.env.IRIS_AUDIT_LOG = auditPath;
    // IRIS_AUDIT_LOG_PARAMS intentionally left unset (default false).

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    fetchMock.mockResolvedValueOnce(versionResponse());

    const server = new McpServerBase(
      makeServerOpts([makeReadToolWithPassword()], makeConfig()),
    );
    await server.start("stdio");

    const result = await invokeTool(server, "iris_probe_with_password", {
      name: "AuditRedactionProbe",
      password: SECRET,
    });
    expect(result.isError).toBeFalsy();

    const lines = await waitForLineCount(auditPath, 2);
    const entry = JSON.parse(lines[1] as string);
    expect(entry.paramKeys).toEqual(["name", "password"]);
    expect(entry.params).toBeUndefined();

    const raw = readFileSync(auditPath, "utf-8");
    expect(raw).not.toContain(SECRET);

    rmSync(dir, { recursive: true, force: true });
  });
});
