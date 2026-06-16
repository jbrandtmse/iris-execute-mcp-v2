/**
 * Story 16.3 — END-TO-END coverage for `iris_backup_manage`.
 *
 * The two sibling suites each cover one half of the stack but leave the seam
 * between them untested:
 *   - `backup.test.ts` exercises the REAL handler but bypasses the server,
 *     injecting a MOCK `ctx.http` (the registered callback / governance gate /
 *     real `IrisHttpClient` are never touched).
 *   - `backup-governance.test.ts` drives the REAL `McpServerBase.handleToolCall`
 *     gate but REPLACES the handler with a spy (the handler + REST integration
 *     are never exercised through the server callback).
 *
 * This suite closes that gap: it drives the FULL path —
 *   SDK-registered callback → `handleToolCall` (Zod validation + governance
 *   gate) → the REAL `backupManageTool.handler` → the REAL `IrisHttpClient` —
 *   with ONLY the lowest layer (`globalThis.fetch`) mocked. No live IRIS, and
 *   (critically) NO real freeze/thaw is ever issued: every IRIS round-trip is a
 *   stubbed Atelier envelope.
 *
 * Runs in the DEFAULT vitest suite (`*.test.ts`, NOT `*.integration.test.ts`),
 * so it is discoverable by `pnpm test` (skill Rule 8).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { McpServerBase } from "@iris-mcp/shared";
import type { McpServerBaseOptions } from "@iris-mcp/shared";
import { backupManageTool } from "../tools/backup.js";

// ── Harness ─────────────────────────────────────────────────────────

/** Atelier version-negotiation response body (major 8). */
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

/** A successful Atelier envelope wrapping the custom-REST `result` payload. */
function okEnvelope(result: unknown): Response {
  return new Response(
    JSON.stringify({ status: { errors: [] }, console: [], result }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

/** An Atelier envelope carrying an application-level error (non-empty errors). */
function errorEnvelope(message: string, httpStatus = 500): Response {
  return new Response(
    JSON.stringify({
      status: { errors: [{ error: message }], summary: message },
      console: [],
      result: {},
    }),
    { status: httpStatus, headers: { "Content-Type": "application/json" } },
  );
}

/** Invoke a tool through the SDK-registered callback (the handleToolCall path). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function callTool(server: any, name: string, args: unknown) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sdkTools = (server.server as any)._registeredTools;
  const entry = sdkTools[name];
  const callback = entry.callback ?? entry.handler ?? entry.cb;
  return callback(args);
}

function makeServerOpts(): McpServerBaseOptions {
  return {
    name: "@iris-mcp/ops",
    version: "0.0.0",
    // The REAL tool (real handler) — this is what makes the suite end-to-end.
    tools: [backupManageTool],
    // The custom REST endpoint is reached via the profile client; the bootstrap
    // is mocked through fetch below.
    needsCustomRest: false,
  };
}

function makeEnvHarness() {
  let fetchMock: ReturnType<typeof vi.fn>;
  const originalFetch = globalThis.fetch;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let exitMock: any;
  const savedEnv = {
    IRIS_USERNAME: process.env.IRIS_USERNAME,
    IRIS_PASSWORD: process.env.IRIS_PASSWORD,
    IRIS_HOST: process.env.IRIS_HOST,
    IRIS_NAMESPACE: process.env.IRIS_NAMESPACE,
    IRIS_PROFILES: process.env.IRIS_PROFILES,
    IRIS_GOVERNANCE: process.env.IRIS_GOVERNANCE,
  };

  function setup(): void {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    exitMock = vi
      .spyOn(process, "exit")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockImplementation((() => {}) as any);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    delete process.env.IRIS_GOVERNANCE;
    delete process.env.IRIS_PROFILES;
    process.env.IRIS_USERNAME = "u";
    process.env.IRIS_PASSWORD = "p";
    process.env.IRIS_HOST = "default.example.com";
    process.env.IRIS_NAMESPACE = "DEFAULTNS";
  }

  function teardown(): void {
    globalThis.fetch = originalFetch;
    exitMock.mockRestore();
    vi.restoreAllMocks();
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }

  return {
    setup,
    teardown,
    get fetchMock() {
      return fetchMock;
    },
  };
}

// (Startup HEAD/GET are handled by the URL-routing fetch mock below.)

/**
 * Route the fetch mock by method + URL rather than by call order. This is robust
 * against the `IrisHttpClient`'s implicit preflights:
 *   - startup HEAD `/api/atelier/` (health) → 200, GET `/api/atelier/` (version).
 *   - a CSRF-establishing HEAD `/api/atelier/` before the FIRST mutating POST.
 * Only the actual POST to `/monitor/backup/manage` returns `backupResponse`.
 *
 * @param backupResponse - the Response the backup endpoint POST should return.
 */
function routeFetch(
  fetchMock: ReturnType<typeof vi.fn>,
  backupResponse: Response,
): void {
  fetchMock.mockImplementation(
    async (url: unknown, init?: { method?: string; body?: string }) => {
      const u = String(url);
      const method = (init?.method ?? "GET").toUpperCase();
      if (u.includes("/monitor/backup/manage")) {
        return backupResponse;
      }
      // Version negotiation (GET /api/atelier/).
      if (method === "GET" && u.includes("/api/atelier/")) {
        return versionResponse();
      }
      // Health check + CSRF preflight (HEAD /api/atelier/).
      return new Response(null, { status: 200 });
    },
  );
}

/** The JSON body of the POST to the backup endpoint (order-independent). */
function backupPostBody(
  fetchMock: ReturnType<typeof vi.fn>,
): Record<string, unknown> {
  const call = fetchMock.mock.calls.find((c) =>
    String(c[0]).includes("/monitor/backup/manage"),
  );
  const init = call?.[1] as { body?: string } | undefined;
  return init?.body ? JSON.parse(init.body) : {};
}

/** True if a POST was issued to the backup endpoint. */
function backupPosted(fetchMock: ReturnType<typeof vi.fn>): boolean {
  return fetchMock.mock.calls.some((c) =>
    String(c[0]).includes("/monitor/backup/manage"),
  );
}

// ════════════════════════════════════════════════════════════════════
// End-to-end: registered callback → gate → real handler → real client.
// ════════════════════════════════════════════════════════════════════

describe("iris_backup_manage end-to-end (registered server path)", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  // ── listHistory (read; enabled by default) ──

  it("listHistory renders entries end-to-end and returns structuredContent (item c)", async () => {
    routeFetch(
      env.fetchMock,
      okEnvelope({
        action: "listHistory",
        count: 2,
        entries: [
          {
            timestamp: "2026-06-15 23:00:00",
            type: "Full",
            status: "Completed",
            device: "c:\\backups\\full.bck",
            logFile: "c:\\backups\\full.log",
            description: "nightly full",
            list: "All",
          },
          {
            timestamp: "2026-06-14 23:00:00",
            type: "Incremental",
            status: "Completed",
            description: "incr",
          },
        ],
      }),
    );

    const server = new McpServerBase(makeServerOpts());
    await server.start("stdio");

    const result = await callTool(server, "iris_backup_manage", {
      action: "listHistory",
    });

    expect(result.isError).toBeFalsy();
    const text: string = result.content[0].text;
    expect(text).toContain("2 entries");
    expect(text).toContain("Full");
    expect(text).toContain("Completed");
    expect(text).toContain("nightly full");

    // structuredContent surfaces the full entry shape (timestamp/type/file/desc).
    const sc = result.structuredContent as {
      action: string;
      count: number;
      entries: Array<Record<string, unknown>>;
    };
    expect(sc.action).toBe("listHistory");
    expect(sc.count).toBe(2);
    expect(sc.entries).toHaveLength(2);
    expect(sc.entries[0]).toMatchObject({
      timestamp: "2026-06-15 23:00:00",
      type: "Full",
      status: "Completed",
      logFile: "c:\\backups\\full.log",
      description: "nightly full",
    });

    // The handler POSTed to the backup endpoint with {action:"listHistory"}.
    expect(backupPosted(env.fetchMock), "a POST to the backup endpoint was made").toBe(
      true,
    );
    expect(backupPostBody(env.fetchMock)).toMatchObject({ action: "listHistory" });
  });

  it("listHistory renders an empty-history message end-to-end", async () => {
    routeFetch(
      env.fetchMock,
      okEnvelope({ action: "listHistory", count: 0, entries: [] }),
    );

    const server = new McpServerBase(makeServerOpts());
    await server.start("stdio");

    const result = await callTool(server, "iris_backup_manage", {
      action: "listHistory",
    });

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("No backup history");
  });

  // ── run (write; default-disabled, opt-in to reach the handler) ──

  it("run (governance-enabled) forwards taskName + optional device/jobbackup end-to-end (items a, b)", async () => {
    process.env.IRIS_GOVERNANCE = JSON.stringify({
      global: { "iris_backup_manage:run": true },
    });
    routeFetch(
      env.fetchMock,
      okEnvelope({
        action: "run",
        taskName: "NightlyFull",
        jobbackup: 1,
        backupType: "full",
        success: 1,
      }),
    );

    const server = new McpServerBase(makeServerOpts());
    await server.start("stdio");

    const result = await callTool(server, "iris_backup_manage", {
      action: "run",
      taskName: "NightlyFull",
      backupType: "full",
      jobbackup: true,
      device: "c:\\backups\\manual.bck",
    });

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("NightlyFull");
    expect(result.content[0].text).toContain("background job");

    // The real handler assembled the POST body with all run fields, incl. the
    // optional `device` (not covered by the unit suite).
    expect(backupPostBody(env.fetchMock)).toMatchObject({
      action: "run",
      taskName: "NightlyFull",
      backupType: "full",
      jobbackup: true,
      device: "c:\\backups\\manual.bck",
    });
  });

  it("run is DENIED end-to-end under empty governance — handler/REST never reached (item e)", async () => {
    // No IRIS_GOVERNANCE set → run is a default-disabled write.
    routeFetch(env.fetchMock, okEnvelope({ action: "run", success: 1 }));

    const server = new McpServerBase(makeServerOpts());
    await server.start("stdio");

    const result = await callTool(server, "iris_backup_manage", {
      action: "run",
      taskName: "NightlyFull",
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      code: "GOVERNANCE_DISABLED",
      action: "iris_backup_manage:run",
      server: "default",
    });
    // Gate short-circuited BEFORE the handler → no backup POST was ever issued.
    expect(backupPosted(env.fetchMock)).toBe(false);
  });

  // ── freeze / thaw (write; default-disabled) request shape via the real handler ──

  it("freeze (governance-enabled) surfaces a frozen status and POSTs {action:freeze} end-to-end (item b)", async () => {
    process.env.IRIS_GOVERNANCE = JSON.stringify({
      global: { "iris_backup_manage:freeze": true },
    });
    // Stubbed envelope — NO real freeze is ever issued (item: do NOT quiesce).
    routeFetch(
      env.fetchMock,
      okEnvelope({ action: "freeze", success: 1, logFile: "c:\\tmp\\freeze.log" }),
    );

    const server = new McpServerBase(makeServerOpts());
    await server.start("stdio");

    const result = await callTool(server, "iris_backup_manage", {
      action: "freeze",
      logFile: "c:\\tmp\\freeze.log",
      description: "snapshot prep",
    });

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("frozen");
    expect(backupPostBody(env.fetchMock)).toMatchObject({
      action: "freeze",
      logFile: "c:\\tmp\\freeze.log",
      description: "snapshot prep",
    });
  });

  it("thaw (governance-enabled) surfaces a thawed status and forwards credentials end-to-end (item b)", async () => {
    process.env.IRIS_GOVERNANCE = JSON.stringify({
      global: { "iris_backup_manage:thaw": true },
    });
    routeFetch(env.fetchMock, okEnvelope({ action: "thaw", success: 1 }));

    const server = new McpServerBase(makeServerOpts());
    await server.start("stdio");

    const result = await callTool(server, "iris_backup_manage", {
      action: "thaw",
      username: "backupadmin",
      password: "secret",
    });

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("thawed");
    expect(backupPostBody(env.fetchMock)).toMatchObject({
      action: "thaw",
      username: "backupadmin",
      password: "secret",
    });
  });

  // ── server-error path end-to-end (item f) ──

  it("an IRIS application error on run surfaces as isError end-to-end, not a thrown crash (item f)", async () => {
    process.env.IRIS_GOVERNANCE = JSON.stringify({
      global: { "iris_backup_manage:run": true },
    });
    // ONLY the backup POST fails; the startup/CSRF preflights stay healthy.
    routeFetch(
      env.fetchMock,
      errorEnvelope("ERROR #5001: Backup task 'Nope' is not defined"),
    );

    const server = new McpServerBase(makeServerOpts());
    await server.start("stdio");

    const result = await callTool(server, "iris_backup_manage", {
      action: "run",
      taskName: "Nope",
    });

    expect(result.isError).toBe(true);
    const text: string = result.content[0].text;
    expect(text).toContain("is not defined");
  });

  // ── restore-not-supported via the registered path (item d) ──

  it("action=restore is rejected by Zod at the gate (not in the enum) — no crash, no REST call (item d)", async () => {
    routeFetch(env.fetchMock, okEnvelope({ action: "run", success: 1 }));

    const server = new McpServerBase(makeServerOpts());
    await server.start("stdio");

    // `restore` is intentionally absent from the action enum (deferred,
    // AC 16.3.3). Through the registered callback, Zod validation in
    // handleToolCall rejects it cleanly as a structured error — the handler and
    // the REST layer are never reached, and nothing crashes.
    const result = await callTool(server, "iris_backup_manage", {
      action: "restore",
    });

    expect(result.isError).toBe(true);
    // No backup POST was issued (validation short-circuited before the handler).
    expect(backupPosted(env.fetchMock)).toBe(false);
  });
});
